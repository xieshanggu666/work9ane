// 历史台账迁移服务：把旧前端 Pinia store 的快照（或任意同构历史台账 JSON）迁移到服务端事件库。
//  - 全量/批次幂等：以批次 id 判重；行级固定 id + 事件 effectId 保证中断重跑不重复扣分/扣库存/发奖；
//  - 迁移前校验：积分流水余额链连续性；库存账实；记录↔审核单状态；不通过则整批拒绝（不落任何事件）；
//  - 迁移后留痕：manifest（批次 id、来源、行计数、各类校验和/或 sha256、操作人、时间）+ 审计；
//  - 迁移完成可立即按业务日跑对账，历史漏记/盘亏/漏券由 P1–P6 检出后走统一补偿（同一套幂等补偿链路）。
import { hashJson, genId, BizError } from '../util.js'

export class MigrationService {
  constructor(deps) {
    this.k = deps.k
    this.audit = deps.audit
  }

  // 校验旧台账快照（返回错误列表；空数组表示通过）
  validate(snap) {
    const errors = []
    const requireArr = (name) => {
      if (!Array.isArray(snap[name])) errors.push(`${name} 不是数组`)
    }
    ;['activities', 'goods', 'records', 'riskOrders', 'pointRecords', 'taskClaims',
      'coupons', 'couponLogs', 'shipments', 'afterSales', 'reconBills', 'stockAdjustments',
      'tenants', 'members', 'tasks', 'customRoles'].forEach(requireArr)
    if (errors.length) return errors

    // 1) 积分余额链：旧 store 为平台钱包（历史流水无 userId），全局按 ts 重放快照即可。
    //    旧种子用一笔不落在 pointRecords 里的 "+935 起算" 调平，重放起点按 legacyPoints 反推：
    //    起点余额 = 期末余额 - 全部流水 delta 之和。
    const flowsOrdered = snap.pointRecords.slice().sort((a, b) => a.ts - b.ts)
    const startBalance = (snap.legacyPoints || 0) - flowsOrdered.reduce((s, p) => s + p.delta, 0)
    let bal0 = startBalance
    for (const p of flowsOrdered) {
      bal0 += p.delta
      if (p.balance !== bal0) {
        errors.push(`积分余额链断裂：流水 ${p.id} 应有余额 ${bal0}，快照 ${p.balance}`)
        break
      }
    }

    // 2) 库存账实（旧 store 口径）：remain 已扣除冻结预占；售后退回已在回写时 remain+1、补发 remain-1。
    //    应有 remain = 初始 - 有效业务消耗 + 退回 - 补发；账面比对 remain；frozen 须落在已扣区间内。
    const afterSaleFix = (targetType, activityId, targetId) => {
      const hit = snap.afterSales.filter((as) => as.status === 'done' && as.targetType === targetType &&
        as.targetId === targetId && (targetType !== 'prize' || as.activityId === activityId))
      return {
        returned: hit.filter((as) => ['reject', 'return'].includes(as.type)).length,
        reshipped: hit.filter((as) => as.type === 'reship').length
      }
    }
    const checkStock = (key, name, stock, remain, frozen, consumedRaw) => {
      const { returned, reshipped } = consumedRaw.fix
      const consumed = consumedRaw.n - returned + reshipped
      if (stock - consumed !== remain) {
        errors.push(`库存账实不符：${key}【${name}】应有 remain=${stock - consumed}（初始 ${stock} - 消耗 ${consumedRaw.n} + 退回 ${returned} - 补发 ${reshipped}），实际 ${remain}`)
      }
      if ((frozen || 0) < 0 || (frozen || 0) > stock - remain) {
        errors.push(`预占库存异常：${key}【${name}】frozen=${frozen || 0} 超出已扣区间 [0, ${stock - remain}]`)
      }
    }
    snap.activities.forEach((a) => {
      ;(a.prizes || []).forEach((pz) => {
        if (pz.rarity === 'none') return
        const n = snap.records.filter((r) =>
          r.type === 'draw' && r.activityId === a.id && r.prizeId === pz.id && r.status !== 'revoked').length
        checkStock(`${a.id}/${pz.id}`, pz.name, pz.stock, pz.remain, pz.frozen,
          { n, fix: afterSaleFix('prize', a.id, pz.id) })
      })
    })
    snap.goods.forEach((g) => {
      const n = snap.records.filter((r) => r.type === 'redeem' && r.goodsId === g.id && r.status !== 'revoked').length
      checkStock(g.id, g.name, g.stock, g.remain, g.frozen,
        { n, fix: afterSaleFix('goods', null, g.id) })
    })

    // 3) 在审风控单 ↔ 冻结记录
    snap.riskOrders.filter((o) => ['pending', 'appealed'].includes(o.status)).forEach((o) => {
      const rec = snap.records.find((r) => r.id === o.recordId)
      if (!rec || rec.status !== 'frozen') errors.push(`冻结单据 ${o.id} 关联记录非冻结态`)
    })

    // 4) 券码租户内唯一、券记录回指
    const codeMap = new Map()
    snap.coupons.forEach((c) => {
      const key = `${c.tenantId || 't-star'}:${(c.code || '').replace(/[\s-]/g, '').toUpperCase()}`
      if (!codeMap.has(key)) codeMap.set(key, 0)
      codeMap.set(key, codeMap.get(key) + 1)
    })
    codeMap.forEach((n, key) => { if (n > 1) errors.push(`历史券码重复：${key} ×${n}`) })

    return errors
  }

  // 执行迁移（strict=false 时即便校验有警告也允许迁移——当前实现错误均为硬错误）
  async run(snap, options = {}) {
    const batchId = options.batchId || `mig-${snap.source || 'legacy'}-${snap.migratedAt || 'all'}`
    const existed = this.k.state.migrations.find((m) => m.id === batchId)
    if (existed) return { manifest: existed, idempotent: true }

    const errors = this.validate(snap)
    const checksum = hashJson({
      flows: snap.pointRecords.map((p) => [p.id, p.delta, p.ts]),
      records: snap.records.map((r) => [r.id, r.status]),
      coupons: snap.coupons.map((c) => [c.id, c.code]),
      stock: [...snap.activities.flatMap((a) => a.prizes.map((p) => [`${a.id}:${p.id}`, p.remain, p.frozen || 0])),
        ...snap.goods.map((g) => [g.id, g.remain, g.frozen || 0])]
    })
    if (errors.length) {
      throw new BizError('MIGRATION_INVALID', `历史台账校验未通过，整批拒绝迁移（${errors.length} 项问题）`, 422, { errors, checksum })
    }

    const events = []
    const add = (e) => events.push(e)

    // 租户/成员/角色/任务/风控规则
    ;(snap.tenants || []).forEach((t) => add({ type: 'upsert', table: 'tenants', row: { ...t } }))
    ;(snap.members || []).forEach((m) => add({ type: 'upsert', table: 'members', row: { ...m } }))
    ;(snap.customRoles || []).forEach((r) => add({ type: 'upsert', table: 'customRoles', row: { ...r } }))
    ;(snap.tasks || []).forEach((t) => add({ type: 'upsert', table: 'tasks', row: { ...t } }))
    Object.entries(snap.riskRulesByTenant || {}).forEach(([tenantId, rules]) =>
      add({ type: 'risk-rules.put', tenantId, rules: JSON.parse(JSON.stringify(rules)) }))
    ;(snap.couponTplsList || snap.couponTpls || []).forEach((c) => add({ type: 'upsert', table: 'couponTpls', row: { ...c } }))

    // 活动/商品（库存保持旧账面值，含 remain/frozen）
    ;(snap.activities || []).forEach((a) => add({ type: 'upsert', table: 'activities', row: JSON.parse(JSON.stringify(a)) }))
    ;(snap.goods || []).forEach((g) => add({ type: 'upsert', table: 'goods', row: { ...g } }))

    // 积分流水：固定 id + 固定 effectId，重放幂等；按 ts 正序提交以重建余额快照。
    // 旧平台钱包流水没有 userId（单消费者时代），统一归属到迁移快照指定的 legacyOwner（默认 u-1001）。
    const legacyOwner = snap.legacyOwner || 'u-1001'
    const rawFlows = (snap.pointRecords || []).slice().sort((a, b) => a.ts - b.ts)
    // 旧 store 用一笔不入流水的起算额把期末余额调平（见 seedRiskData 注释的 "+935"）；
    // 迁移时显式补一笔"期初结转"流水置于链首，保证余额链从 0 重放连续且期末余额一致。
    const flowSum = rawFlows.reduce((s, p) => s + p.delta, 0)
    const opening = (snap.legacyPoints || 0) - flowSum
    const flows = []
    if (opening !== 0) {
      const firstTs = rawFlows.length ? Math.min(...rawFlows.map((p) => p.ts)) - 1 : Date.now()
      flows.push({
        id: 'mig-opening-balance', userId: legacyOwner,
        date: rawFlows[0]?.date || this.k.todayDate(),
        bizDate: rawFlows[0]?.bizDate || rawFlows[0]?.date || this.k.todayDate(),
        tenantId: 't-star', traceId: '',
        time: rawFlows[0]?.time || '00:00:00', ts: firstTs,
        delta: opening, balance: 0,
        note: '历史台账迁移：期初积分结转', kind: 'normal',
        refId: 'mig:opening-balance', refType: 'migration-opening'
      })
    }
    rawFlows.forEach((p) => {
      flows.push({
        id: p.id, userId: p.userId || legacyOwner,
        date: p.date, bizDate: p.bizDate || p.date,
        tenantId: p.tenantId || 't-star', traceId: p.traceId || '',
        time: p.time || '', ts: p.ts, delta: p.delta, balance: 0,
        note: p.note || '', kind: p.kind || 'normal',
        refId: p.refId || `mig:${p.id}`, refType: p.refType || ''
      })
    })
    flows.forEach((flow) => add({ type: 'points.post', flow, effectId: `mig-points:${flow.id}` }))

    // 业务记录 / 审核单 / 任务台账 / 卡券 / 台账 / 物流 / 售后 / 历史对账 / 校正 / 审计（直接 insert，固定 id）
    // 旧前端种子按"演示当天"生成 date，但 ts 固定在历史时刻；迁移按 ts 反推真实业务日，
    // 保证 P1（记录↔流水同日勾稽）、P6（发券日）与跨日审核归属正确。
    const dayOfTs = (ts, fallback) => {
      if (!ts) return fallback
      const d = new Date(ts)
      const p = (n) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    }
    const dateTables = {
      records: (row) => {
        // 旧业务记录没有冗余成本字段，按活动/商品快照补齐（P1 勾稽、冻结返还、退款依赖）
        let cost = row.cost
        if (cost === undefined) {
          if (row.type === 'draw') {
            const act = (snap.activities || []).find((a) => a.id === row.activityId)
            cost = act && act.costType === 'points' ? (act.cost || 0) : 0
          } else {
            cost = (snap.goods || []).find((g) => g.id === row.goodsId)?.cost || 0
          }
        }
        return { ...row, date: dayOfTs(row.ts, row.date), cost }
      },
      riskOrders: (row) => ({ ...row, createdAt: row.createdAt && row.ts ? dayOfTs(row.ts, row.createdAt) : row.createdAt }),
      shipments: (row) => ({ ...row, date: dayOfTs(row.ts, row.date) }),
      afterSales: (row) => ({ ...row, createdAt: row.createdAt && row.ts ? dayOfTs(row.ts, row.createdAt) : row.createdAt }),
      taskClaims: (row) => ({
        ...row,
        userId: row.userId || legacyOwner,
        bizDate: dayOfTs(row.ts, row.bizDate),
        grantDate: row.grantDate ? dayOfTs(row.ts, row.grantDate) : row.grantDate
      }),
      coupons: (row) => ({ ...row, issueDate: dayOfTs(row.ts, row.issueDate) }),
      couponLogs: (row) => ({ ...row, date: dayOfTs(row.ts, row.date) }),
      auditLogs: (row) => ({ ...row, date: dayOfTs(row.logTs || row.ts, row.date) }),
      stockAdjustments: (row) => ({ ...row, bizDate: row.bizDate, date: dayOfTs(row.ts, row.date) }),
      reconBills: (row) => ({ ...row, date: row.date, createdAt: row.createdAt })
    }
    const copyTables = ['records', 'riskOrders', 'taskClaims', 'coupons', 'couponLogs',
      'shipments', 'afterSales', 'reconBills', 'stockAdjustments', 'auditLogs']
    copyTables.forEach((table) => {
      ;(snap[table] || []).forEach((row0) => {
        const row = dateTables[table] ? dateTables[table](JSON.parse(JSON.stringify(row0))) : JSON.parse(JSON.stringify(row0))
        add({ type: 'insert', table, row })
      })
    })

    // 逐事件提交（单 WAL；中途崩溃重启后固定 id/effectId 重放幂等，批次 manifest 未落库则可安全重跑）
    for (const e of events) await this.k.commit([e])

    const manifest = {
      id: batchId,
      source: snap.source || 'legacy-pinia-store',
      migratedAt: this.k.todayDate(),
      time: this.k.nowTime(),
      ts: this.k.nowTs(),
      operator: options.ctx?.name || '系统',
      counts: {
        tenants: (snap.tenants || []).length,
        members: (snap.members || []).length,
        activities: (snap.activities || []).length,
        goods: (snap.goods || []).length,
        pointFlows: rawFlows.length,
        records: (snap.records || []).length,
        riskOrders: (snap.riskOrders || []).length,
        taskClaims: (snap.taskClaims || []).length,
        coupons: (snap.coupons || []).length,
        couponLogs: (snap.couponLogs || []).length,
        shipments: (snap.shipments || []).length,
        afterSales: (snap.afterSales || []).length,
        reconBills: (snap.reconBills || []).length,
        auditLogs: (snap.auditLogs || []).length
      },
      balances: Object.fromEntries(
        [...new Set(flows.map((p) => p.userId || 'legacy'))].map((uid) => [uid, this.k.state.balances[uid] || 0])
      ),
      checksum,
      status: 'done'
    }
    await this.k.commit([{ type: 'insert', table: 'migrations', row: manifest }])
    await this.audit.log('migration-run', batchId,
      `历史台账迁移完成（来源 ${manifest.source}）：流水 ${manifest.counts.pointFlows} 行、业务记录 ${manifest.counts.records} 笔、审核单 ${manifest.counts.riskOrders} 笔、卡券 ${manifest.counts.coupons} 张、校验和 ${checksum.slice(0, 12)}…；行级固定 id 幂等`,
      { tenantId: '', ctx: options.ctx || null })
    return { manifest, idempotent: false }
  }
}
