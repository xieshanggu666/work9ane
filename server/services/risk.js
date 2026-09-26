// 风控服务：规则评估（按租户隔离）、审核单状态机、放行/撤销 Saga（幂等 + 故障续办）。
// 冻结语义：成本积分以 frozen 流水预占（撤销 refund、放行核销）；库存 hold 预占（放行 consume、撤销 release 回补）；
// 券类冻结只预占库存不发券（放行 deliver、撤销 revoke 台账）；冻结记录暂缓任务进度，放行补计、撤销不计。
import { genId, BizError } from '../util.js'

export const RULE_LABELS = {
  blacklist: '黑名单用户',
  highValue: '高价值奖品/兑换',
  dailyBurst: '当日抽奖频次超限',
  rapidDraw: '短时间连续抽奖',
  rapidRedeem: '短时间连续兑换'
}

export function makeDefaultRules() {
  return {
    enabled: true,
    highValueRarities: ['legendary', 'epic'],
    dailyDrawThreshold: 4,
    rapidDrawSeconds: 30,
    rapidDrawMax: 3,
    rapidRedeemSeconds: 60,
    rapidRedeemMax: 2,
    highValueRedeemCost: 150,
    blacklist: []
  }
}

export class RiskService {
  constructor(deps) {
    this.k = deps.k
    this.audit = deps.audit
    this.points = deps.points
    this.inventory = deps.inventory
    this.coupons = deps.coupons
    this.ship = deps.ship
    this.tasks = deps.tasks
    this.budget = deps.budget
  }

  // 营销预算：风控审核时核销/释放该记录的全部预算预占（按 recordId 匹配 reserve 台账，幂等）
  async _budgetConvert(rec, direction, ctx, traceId) {
    if (!this.budget) return
    const kinds = rec.type === 'draw' ? ['draw-cost', 'points-reward'] : ['redeem-cost']
    for (const kind of kinds) {
      const refs = {
        category: kind === 'redeem-cost' ? 'redeem' : kind === 'draw-cost' ? 'draw' : 'points',
        kind, traceId: traceId || rec.traceId,
        summary: `${direction === 'settle' ? '风控放行核销预占' : '风控撤销释放预占'}：${rec.prizeName || rec.goodsName}`
      }
      if (direction === 'settle') await this.budget.settleReserved('record', `${rec.id}:${kind}`, refs, ctx)
      else await this.budget.releaseReserved('record', `${rec.id}:${kind}`, refs, ctx)
    }
  }

  rulesOf(tenantId) {
    if (!this.k.state.riskRules[tenantId]) {
      this.k.state.riskRules[tenantId] = makeDefaultRules()
    }
    return this.k.state.riskRules[tenantId]
  }

  async updateRules(tenantId, patch, ctx) {
    const before = { ...this.rulesOf(tenantId) }
    const next = {
      ...before, ...patch,
      highValueRarities: patch.highValueRarities ? [...patch.highValueRarities] : before.highValueRarities,
      blacklist: patch.blacklist ? [...patch.blacklist] : before.blacklist
    }
    await this.k.commit([{ type: 'risk-rules.put', tenantId, rules: next }])
    const changes = Object.keys(patch)
      .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(next[key]))
      .map((key) => `${key}: ${JSON.stringify(before[key])} → ${JSON.stringify(next[key])}`)
    await this.audit.log('config', '', `调整租户【${tenantId}】风控规则：${changes.join('；') || '配置已保存（无变化）'}`,
      { tenantId, ctx })
    return next
  }

  dailyDrawCount(tenantId, userId, activityId, day) {
    return this.k.state.records.filter(
      (r) => r.type === 'draw' && r.activityId === activityId && r.date === day &&
        r.status !== 'revoked' && (r.tenantId || 't-star') === tenantId && r.userId === userId
    ).length
  }

  // 抽奖风控评估（在任何扣减之前）
  evalDraw(tenantId, userId, activity, prize, day = this.k.todayDate()) {
    const hit = []
    const r = this.rulesOf(tenantId)
    if (!r.enabled) return hit
    if (r.blacklist.includes(userId)) hit.push('blacklist')
    if (r.highValueRarities.includes(prize.rarity)) hit.push('highValue')
    if (r.dailyDrawThreshold > 0 && this.dailyDrawCount(tenantId, userId, activity.id, day) + 1 >= r.dailyDrawThreshold) {
      hit.push('dailyBurst')
    }
    if (r.rapidDrawSeconds > 0 && r.rapidDrawMax > 0) {
      const since = this.k.nowTs() - r.rapidDrawSeconds * 1000
      const recent = this.k.state.records.filter(
        (x) => x.type === 'draw' && x.status !== 'revoked' && x.ts && x.ts >= since &&
          (x.tenantId || 't-star') === tenantId && x.userId === userId
      ).length
      if (recent + 1 >= r.rapidDrawMax) hit.push('rapidDraw')
    }
    return hit
  }

  evalRedeem(tenantId, userId, goods) {
    const hit = []
    const r = this.rulesOf(tenantId)
    if (!r.enabled) return hit
    if (r.blacklist.includes(userId)) hit.push('blacklist')
    if (goods.cost >= r.highValueRedeemCost) hit.push('highValue')
    if (r.rapidRedeemSeconds > 0 && r.rapidRedeemMax > 0) {
      const since = this.k.nowTs() - r.rapidRedeemSeconds * 1000
      const recent = this.k.state.records.filter(
        (x) => x.type === 'redeem' && x.status !== 'revoked' && x.ts && x.ts >= since &&
          (x.tenantId || 't-star') === tenantId && x.userId === userId
      ).length
      if (recent + 1 >= r.rapidRedeemMax) hit.push('rapidRedeem')
    }
    return hit
  }

  // 建立审核单（trade saga 冻结分支调用）
  async createOrder(params) {
    const order = {
      id: genId('rk'),
      bizType: params.bizType,
      status: 'pending',
      tenantId: params.tenantId,
      userId: params.userId, userName: params.userName || '',
      recordId: params.recordId,
      activityId: params.activityId || null,
      targetId: params.targetId,
      targetName: params.targetName,
      icon: params.icon || '',
      rarity: params.rarity || null,
      frozenPoints: params.cost || 0,
      stockHeld: params.stockHeld || 0,
      rules: (params.riskHits || []).map((code) => ({ code, label: RULE_LABELS[code] || code })),
      appealReason: '', appealAt: '', reviewNote: '', reviewer: '',
      createdAt: this.k.todayDate(), time: this.k.nowTime(), ts: this.k.nowTs(),
      reviewedAt: '',
      // 续办：审核动作执行中标记（崩溃后 boot 扫描 processing 单继续完成）
      processing: '', processingRunId: '',
      stages: {}
    }
    await this.k.commit([{ type: 'insert', table: 'riskOrders', row: order }])
    await this.audit.log('freeze', order.id,
      `${params.bizType === 'draw' ? '抽奖' : '兑换'}【${params.targetName}】命中规则：${order.rules.map((x) => x.label).join('、')}，冻结${order.frozenPoints}积分${order.stockHeld ? `、预占库存×${order.stockHeld}` : ''}${params.bizType === 'draw' ? '；该笔暂缓计入抽奖任务进度' : ''}`,
      { tenantId: order.tenantId, traceId: params.traceId })
    return order
  }

  async appeal(orderId, reason, ctx) {
    const o = this.k.state.riskOrders.find((x) => x.id === orderId)
    if (!o) throw new BizError('ORDER_NOT_FOUND', '审核单不存在', 404)
    if (ctx.identityKind !== 'customer') throw new BizError('ROLE_DENIED', '运营视角无需申诉，请切换到用户视角', 403)
    if (o.userId !== ctx.userId) {
      this.audit.log('perm-denied', o.id, '⛔ 只能对自己的单据申诉',
        { tenantId: o.tenantId, ctx, result: 'denied', module: 'risk' })
      throw new BizError('FORBIDDEN', '只能对自己的单据申诉', 403)
    }
    if (!['pending', 'appealed'].includes(o.status)) throw new BizError('STATE_DENIED', '该单据已处理，无法申诉', 409)
    const text = (reason || '').trim()
    if (!text) throw new BizError('BAD_FORM', '请填写申诉理由')
    const traceId = this.k.newTraceId()
    const row = { ...o, status: 'appealed', appealReason: text, appealAt: `${this.k.todayDate()} ${this.k.nowTime()}` }
    await this.k.commit([{ type: 'upsert', table: 'riskOrders', row: row }])
    await this.audit.log('appeal', o.id, `用户提交申诉：${text}`, { tenantId: o.tenantId, ctx, traceId })
    return row
  }

  // 放行/撤销统一入口：先登记 processing 标记（续办锚点），再执行幂等 Saga
  async review(orderId, action, note, ctx) {
    const o = this.k.state.riskOrders.find((x) => x.id === orderId)
    if (!o) throw new BizError('ORDER_NOT_FOUND', '审核单不存在', 404)
    if (!['pending', 'appealed'].includes(o.status) && !o.processing) {
      throw new BizError('IDEMPOTENT', '该单据已处理，请勿重复操作', 409)
    }
    if (!o.processing) {
      const runId = genId('run')
      await this.k.commit([{
        type: 'upsert', table: 'riskOrders',
        row: { ...o, processing: action, processingRunId: runId, stages: {}, reviewer: ctx.name }
      }])
    }
    if (action === 'release') await this._completeRelease(orderId, note, ctx)
    else await this._completeRevoke(orderId, note, ctx)
    return this.k.state.riskOrders.find((x) => x.id === orderId)
  }

  async _setStage(o, name) {
    if (o.stages[name]) return
    await this.k.commit([{ type: 'upsert', table: 'riskOrders', row: { ...o, stages: { ...o.stages, [name]: true } } }])
  }

  async _completeRelease(orderId, note, ctx) {
    const o0 = this.k.state.riskOrders.find((x) => x.id === orderId)
    const rec = this.k.state.records.find((r) => r.id === o0.recordId)
    if (!rec) throw new BizError('RECORD_MISSING', '关联业务记录缺失，无法处理', 409)
    const traceId = rec.traceId || this.k.newTraceId()
    const tid = o0.tenantId

    // 1) 核销预占库存（幂等 effectId；续办重放不重复核销）
    if (o0.stockHeld && !o0.stages.consume) {
      const stockKey = this.k.stockKeyOf(
        o0.bizType === 'draw' ? 'prize' : 'goods',
        o0.bizType === 'draw' ? o0.activityId : null,
        o0.targetId
      )
      if (this.k.findStock(stockKey)) {
        await this.k.commit([
          { type: 'inv.mut', key: stockKey, dRemain: 0, dFrozen: -o0.stockHeld, effectId: `release-consume:${o0.id}`,
            // 核销预占的库存消耗归属冻结时的业务日（跨日放行不串处理日库存账），实际核销日另记 date
            kind: 'consume-held', bizDate: o0.createdAt, date: this.k.todayDate(),
            refType: 'risk-order', refId: o0.id, tenantId: tid, traceId }
        ])
      }
      await this._setStage(this.k.state.riskOrders.find((x) => x.id === orderId), 'consume')
      this.k.maybeFault('release.afterConsume')
    }

    // 1.5) 营销预算：冻结预占核销为实际成本（放行即确认营销支出，幂等）
    if (!o0.stages.budget) {
      await this._budgetConvert(rec, 'settle', ctx, traceId)
      await this._setStage(this.k.state.riskOrders.find((x) => x.id === orderId), 'budget')
    }

    // 2) 积分奖品放行才入账（归属原参与业务日 bizDate；跨日审核流水续在链尾、对账不串当日）
    if (o0.bizType === 'draw') {
      const n = parseInt(o0.targetName, 10) || 0
      if (o0.targetName.includes('积分') && n > 0 && !o0.stages.points) {
        await this.points.post({
          userId: rec.userId, delta: n,
          note: `审核放行：抽奖奖品【${o0.targetName}】`,
          kind: 'release', tenantId: tid, bizDate: o0.createdAt,
          refId: `release:${rec.id}`, refType: 'risk-release', traceId
        })
        await this._setStage(this.k.state.riskOrders.find((x) => x.id === orderId), 'points')
      }
    }

    // 3) 单据/记录终态
    const o1 = this.k.state.riskOrders.find((x) => x.id === orderId)
    await this.k.commit([
      { type: 'upsert', table: 'riskOrders', row: {
          ...o1, status: 'released', reviewNote: note || '', reviewer: o1.reviewer || ctx.name,
          reviewedAt: `${this.k.todayDate()} ${this.k.nowTime()}`,
          processing: '', processingRunId: ''
        } },
      { type: 'upsert', table: 'records', row: { ...rec, status: 'released' } }
    ])
    const rec2 = this.k.state.records.find((r) => r.id === rec.id)

    // 4) 发奖：券交付 / 实物发货单（幂等：按 recordId）
    if (!o1.stages.deliver) {
      if (rec2.couponId) {
        await this.coupons.issueForRecord(rec2, { source: '风控放行', orderId: o1.id })
      } else {
        await this.ship.createForRecord(rec2)
      }
      await this._setStage(this.k.state.riskOrders.find((x) => x.id === orderId), 'deliver')
      this.k.maybeFault('release.afterDeliver')
    }

    // 5) 抽奖放行按归属业务日补计任务（跨日不串当日；台账幂等）
    if (o0.bizType === 'draw' && !this.k.state.riskOrders.find((x) => x.id === orderId).stages.settle) {
      await this.tasks.settle(rec2.date, tid, rec2.userId, traceId)
      await this._setStage(this.k.state.riskOrders.find((x) => x.id === orderId), 'settle')
    }

    if (!this.k.state.riskOrders.find((x) => x.id === orderId).stages.audit) {
      await this.audit.log('release', orderId,
        `放行${o0.bizType === 'draw' ? '抽奖' : '兑换'}【${o0.targetName}】${note ? '；备注：' + note : ''}`,
        // 放行核销/发奖/任务补计归属冻结时业务日，审核动作发生在实际处理日
        { tenantId: tid, ctx, traceId, bizDate: o0.createdAt })
      await this._setStage(this.k.state.riskOrders.find((x) => x.id === orderId), 'audit')
    }
  }

  async _completeRevoke(orderId, note, ctx) {
    const o0 = this.k.state.riskOrders.find((x) => x.id === orderId)
    const rec = this.k.state.records.find((r) => r.id === o0.recordId)
    if (!rec) throw new BizError('RECORD_MISSING', '关联业务记录缺失，无法处理', 409)
    const traceId = rec.traceId || this.k.newTraceId()
    const tid = o0.tenantId

    // 1) 返还冻结成本积分（幂等：refId revoke:<recId>）
    if (o0.frozenPoints > 0 && !o0.stages.refund) {
      await this.points.post({
        userId: rec.userId, delta: o0.frozenPoints,
        note: `撤销返还：${o0.bizType === 'draw' ? '抽奖' : '兑换'}【${o0.targetName}】`,
        kind: 'refund', tenantId: tid,
        refId: `revoke:${rec.id}`, refType: 'risk-revoke', traceId
      })
      await this._setStage(this.k.state.riskOrders.find((x) => x.id === orderId), 'refund')
      this.k.maybeFault('revoke.afterRefund')
    }

    // 1.5) 营销预算：冻结预占释放（撤销即冲回营销支出占用，幂等）
    if (!o0.stages.budget) {
      await this._budgetConvert(rec, 'release', ctx, traceId)
      await this._setStage(this.k.state.riskOrders.find((x) => x.id === orderId), 'budget')
    }

    // 2) 库存回补 + frozen 释放（幂等 effectId）
    if (o0.stockHeld && !o0.stages.restock) {
      const stockKey = this.k.stockKeyOf(
        o0.bizType === 'draw' ? 'prize' : 'goods',
        o0.bizType === 'draw' ? o0.activityId : null,
        o0.targetId
      )
      if (this.k.findStock(stockKey)) {
        await this.k.commit([
          { type: 'inv.mut', key: stockKey, dRemain: o0.stockHeld, dFrozen: -o0.stockHeld, effectId: `revoke-restock:${o0.id}`,
            // 撤销回补按实际审核日入账（库存重新可售，计入处理日业务日）
            kind: 'revoke-restock', bizDate: this.k.todayDate(), date: this.k.todayDate(),
            refType: 'risk-order', refId: o0.id, tenantId: tid, traceId }
        ])
      }
      await this._setStage(this.k.state.riskOrders.find((x) => x.id === orderId), 'restock')
    }

    const o1 = this.k.state.riskOrders.find((x) => x.id === orderId)
    await this.k.commit([
      { type: 'upsert', table: 'riskOrders', row: {
          ...o1, status: 'revoked', reviewNote: note || '', reviewer: o1.reviewer || ctx.name,
          reviewedAt: `${this.k.todayDate()} ${this.k.nowTime()}`,
          processing: '', processingRunId: ''
        } },
      { type: 'upsert', table: 'records', row: { ...rec, status: 'revoked' } }
    ])

    // 3) 券预占释放台账（券从未发出）
    if (rec.couponId && !o1.stages.couponRelease) {
      await this.coupons.addLog('revoke', null, rec, { orderId: o1.id, traceId, tenantId: tid })
      await this._setStage(this.k.state.riskOrders.find((x) => x.id === orderId), 'couponRelease')
    }

    if (!this.k.state.riskOrders.find((x) => x.id === orderId).stages.audit) {
      await this.audit.log('revoke', orderId,
        `撤销${o0.bizType === 'draw' ? '抽奖' : '兑换'}【${o0.targetName}】，返还${o0.frozenPoints}积分${o0.stockHeld ? `、回补库存×${o0.stockHeld}` : ''}${rec.couponId ? '、释放预占券（未发放）' : ''}${o0.bizType === 'draw' ? '；该笔不计入抽奖任务进度（冻结期间暂缓，撤销后确认回退）' : ''}${note ? '；备注：' + note : ''}`,
        { tenantId: tid, ctx, traceId, bizDate: this.k.todayDate() })
      await this._setStage(this.k.state.riskOrders.find((x) => x.id === orderId), 'audit')
    }
  }

  // 启动/手工续办：把 processing 中的审核单执行到终态
  async resumeProcessing() {
    const resumed = []
    for (const o of [...this.k.state.riskOrders]) {
      if (o.processing) {
        if (o.processing === 'release') await this._completeRelease(o.id, o.reviewNote || '故障续办', { name: o.reviewer || '系统' })
        else await this._completeRevoke(o.id, o.reviewNote || '故障续办', { name: o.reviewer || '系统' })
        resumed.push(o.id)
      }
    }
    return resumed
  }
}
