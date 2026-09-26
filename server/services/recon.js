// 对账服务（服务端）：按 租户 × 业务日 计算六类口径差异并复核补偿，全部从事件状态实时推导。
//  P1 积分发生额（按用户分户推导应有净额 vs 流水净额，补偿流水单列；残差按用户归集）
//  P2 任务奖励台账逐笔勾稽（claim id 精确匹配 reward/task-comp 流水）
//  P3 余额链（按 用户×租户 append-only 流水重放，快照连续、链尾==分户余额）
//  P4 风控冻结单据（在审单↔记录状态、冻结积分=成本、预占库存=账面 frozen）
//  P5 库存账实（应有 remain = 初始 - 有效消耗 + 售后修正 + 校正凭证）
//  P6 卡券账户（有效记录必发券、券回指有效记录、券码租户内唯一、核销信息、到期流转）
// 一租户一业务日一张差异单；签名幂等；补偿只追加、按凭证幂等，跨日补偿 bizDate 归属原业务日。
import { genId, BizError } from '../util.js'

export class ReconService {
  constructor(deps) {
    this.k = deps.k
    this.audit = deps.audit
    this.points = deps.points
    this.coupons = deps.coupons
  }

  flowBizDate(p) { return p.bizDate || p.date }

  orderOfRecord(recordId) {
    return this.k.state.riskOrders.find((o) => o.recordId === recordId)
  }
  reviewDate(order) { return (order?.reviewedAt || '').slice(0, 10) }
  drawCostOf(r) {
    if (r.cost !== undefined) return r.cost
    const act = this.k.state.activities.find((a) => a.id === r.activityId)
    return act && act.costType === 'points' ? (act.cost || 0) : 0
  }
  drawPrizePoints(r) {
    return r.prizeName && r.prizeName.includes('积分') ? (parseInt(r.prizeName, 10) || 0) : 0
  }

  claimFlow(claim, usedFlowIds) {
    const linked = this.k.state.pointFlows.find((p) =>
      (p.tenantId || 't-star') === claim.tenantId && p.userId === claim.userId &&
      p.refType === 'task-claim' && p.refId === claim.id)
    if (linked) return linked
    const comp = this.k.state.pointFlows.find((p) =>
      (p.tenantId || 't-star') === claim.tenantId && p.userId === claim.userId &&
      !usedFlowIds.has(p.id) && p.kind === 'task-comp' && p.refId === claim.id)
    if (comp) return comp
    if (claim.flowId) {
      const byLedger = this.k.state.pointFlows.find((p) => p.id === claim.flowId)
      if (byLedger) return byLedger
    }
    return this.k.state.pointFlows.find((p) =>
      (p.tenantId || 't-star') === claim.tenantId && p.userId === claim.userId &&
      !usedFlowIds.has(p.id) && p.kind === 'reward' &&
      this.flowBizDate(p) === claim.bizDate && p.delta === claim.reward &&
      p.note.includes('任务结算') && p.note.includes(claim.taskLabel)) || null
  }

  compute(date, tenantId) {
    const tid = tenantId
    const inT = (x) => (x.tenantId || 't-star') === tid
    const recordsT = this.k.state.records.filter(inT)
    const flowsAllT = this.k.state.pointFlows.filter(inT)
    const ordersT = this.k.state.riskOrders.filter(inT)
    const afterSalesT = this.k.state.afterSales.filter(inT)
    const claimsT = this.k.state.taskClaims.filter(inT)
    const stockAdjT = this.k.state.stockAdjustments.filter(inT)
    const couponsT = this.k.state.coupons.filter(inT)
    const actsT = this.k.state.activities.filter((a) => a.tenantId === tid)
    const goodsT = this.k.state.goods.filter((g) => (g.tenantId || 't-star') === tid)
    const isComp = (p) => p.kind === 'recon-comp' || p.kind === 'task-comp'
    const isSeed = (p) => p.kind === 'seed' || p.refType === 'seed' || p.refType === 'migration-opening'
    const dayFlows = flowsAllT.filter((p) => this.flowBizDate(p) === date && !isSeed(p))

    // —— P1 积分发生额（总额 + 按用户归集残差）——
    let expectedNet = 0
    const expectedDetail = []
    // perUserExpected: userId -> 应有净额（不含补偿）
    const perUser = new Map()
    const addExpect = (userId, delta) => {
      expectedNet += delta
      expectedDetail.push({ userId, delta })
      perUser.set(userId, (perUser.get(userId) || 0) + delta)
    }
    recordsT.forEach((r) => {
      if (r.type === 'draw') {
        const cost = this.drawCostOf(r)
        // 成本：落账即扣，按参与业务日；撤销返还另按审核日计入
        if (cost && r.date === date) addExpect(r.userId, -cost)
        const prize = this.drawPrizePoints(r)
        if (prize && r.status === 'normal' && r.date === date) addExpect(r.userId, prize)
        // 放行发奖流水归属原参与业务日
        if (prize && r.status === 'released' && r.date === date) addExpect(r.userId, prize)
        if (r.status === 'revoked') {
          const o = this.orderOfRecord(r.id)
          if (o?.frozenPoints && this.reviewDate(o) === date) addExpect(r.userId, o.frozenPoints)
        }
      } else {
        const g = goodsT.find((x) => x.id === r.goodsId)
        const cost = g?.cost ?? r.cost ?? 0
        if (cost && r.date === date) addExpect(r.userId, -cost)
        if (r.status === 'revoked') {
          const o = this.orderOfRecord(r.id)
          if (o?.frozenPoints && this.reviewDate(o) === date) addExpect(r.userId, o.frozenPoints)
        }
      }
    })
    dayFlows.forEach((p) => {
      if (!isComp(p) && p.kind === 'reward' && p.note.startsWith('完成任务：')) addExpect(p.userId, p.delta)
    })
    claimsT.forEach((c) => {
      if (c.bizDate === date) addExpect(c.userId, c.reward)
    })
    afterSalesT.forEach((a) => {
      if (a.status === 'done' && a.refundPoints > 0 && (a.reviewedAt || '').slice(0, 10) === date) {
        addExpect(a.userId, a.refundPoints)
      }
    })

    const ledgerNet = dayFlows.filter((p) => !isComp(p)).reduce((s, p) => s + p.delta, 0)
    const compNet = dayFlows.filter(isComp).reduce((s, p) => s + p.delta, 0)
    const residual = expectedNet - ledgerNet - compNet

    // 按用户归集残差（供补偿精确入账到正确分户）
    const perUserLedger = new Map()
    dayFlows.filter((p) => !isComp(p)).forEach((p) => perUserLedger.set(p.userId, (perUserLedger.get(p.userId) || 0) + p.delta))
    const perUserComp = new Map()
    dayFlows.filter(isComp).forEach((p) => perUserComp.set(p.userId, (perUserComp.get(p.userId) || 0) + p.delta))
    const userResidual = []
    for (const [userId, exp] of perUser.entries()) {
      const res = exp - (perUserLedger.get(userId) || 0) - (perUserComp.get(userId) || 0)
      if (res !== 0) userResidual.push({ userId, residual: res })
    }

    // —— P2 任务台账逐笔 ——
    const usedFlowIds = new Set()
    const taskItems = claimsT.filter((c) => c.bizDate === date).map((c) => {
      const flow = this.claimFlow(c, usedFlowIds)
      if (flow) { usedFlowIds.add(flow.id); return null }
      return { key: `task-${c.id}`, claimId: c.id, userId: c.userId, label: c.taskLabel,
        reward: c.reward, bizDate: c.bizDate, grantDate: c.grantDate, autoFixable: true }
    }).filter(Boolean)

    // —— P3 余额链（按用户×租户重放）——
    const chainBad = []
    const userIds = new Set(flowsAllT.map((p) => p.userId))
    for (const userId of userIds) {
      const sorted = flowsAllT.filter((p) => p.userId === userId).sort((a, b) => a.ts - b.ts)
      let bal = 0
      sorted.forEach((p) => {
        bal += p.delta
        if (p.balance !== bal) chainBad.push({ id: p.id, userId, expect: bal, actual: p.balance, note: p.note })
      })
      const head = sorted[sorted.length - 1]
      const cur = this.points.balanceOf(userId)
      if (head && head.balance !== cur) {
        chainBad.push({ id: head.id, userId, expect: cur, actual: head.balance, note: '链尾余额与分户余额不一致' })
      }
    }
    const chainItem = chainBad.length
      ? { brokenRows: chainBad.length, firstBad: chainBad[0], autoFixable: false }
      : null

    // —— P4 冻结单据 ——
    const frozenItems = []
    const heldByTarget = new Map()
    ordersT.filter((o) => ['pending', 'appealed'].includes(o.status)).forEach((o) => {
      const key = o.bizType === 'draw' ? `prize:${o.activityId}:${o.targetId}` : `goods:${o.targetId}`
      heldByTarget.set(key, (heldByTarget.get(key) || 0) + (o.stockHeld || 0))
      const rec = recordsT.find((r) => r.id === o.recordId)
      if (!rec || rec.status !== 'frozen') {
        frozenItems.push({ key: `order-status-${o.id}`, orderId: o.id, kind: 'order-status',
          target: o.targetName, expect: '业务记录冻结中', actual: rec ? rec.status : '记录缺失', autoFixable: false })
      }
      const expectCost = o.bizType === 'draw' ? this.drawCostOf(rec || { cost: o.frozenPoints }) : (goodsT.find((g) => g.id === o.targetId)?.cost || 0)
      if ((o.frozenPoints || 0) !== expectCost) {
        frozenItems.push({ key: `order-points-${o.id}`, orderId: o.id, kind: 'order-points',
          target: o.targetName, expect: expectCost, actual: o.frozenPoints || 0, autoFixable: false })
      }
    })
    const checkHeld = (key, name, book) => {
      const held = heldByTarget.get(key) || 0
      if (held !== (book || 0)) {
        frozenItems.push({ key: `held-${key}`, kind: 'stock-held', target: name,
          expect: held, actual: book || 0, autoFixable: false })
      }
    }
    actsT.forEach((a) => a.prizes.forEach((p) => {
      if (p.rarity !== 'none') checkHeld(`prize:${a.id}:${p.id}`, `${a.name} / ${p.name}`, p.frozen)
    }))
    goodsT.forEach((g) => checkHeld(`goods:${g.id}`, g.name, g.frozen))

    // —— P5 库存账实 ——
    const doneAfterSales = afterSalesT.filter((a) => a.status === 'done')
    const afterSaleOf = (targetType, activityId, targetId) => {
      const hit = doneAfterSales.filter((a) => a.targetType === targetType && a.targetId === targetId &&
        (targetType !== 'prize' || a.activityId === activityId))
      return {
        returned: hit.filter((a) => ['reject', 'return'].includes(a.type)).length,
        reshipped: hit.filter((a) => a.type === 'reship').length
      }
    }
    const stockItems = []
    const pushStock = (targetType, activityId, id, name, icon, item) => {
      const isPrize = targetType === 'prize'
      const heldKey = isPrize ? `prize:${activityId}:${id}` : `goods:${id}`
      const consumedBase = recordsT.filter(
        (r) => r.status !== 'revoked' &&
          (isPrize ? (r.type === 'draw' && r.activityId === activityId && r.prizeId === id)
                   : (r.type === 'redeem' && r.goodsId === id))
      ).length
      const asFix = afterSaleOf(targetType, activityId, id)
      const consumed = consumedBase - asFix.returned + asFix.reshipped
      const adjusted = stockAdjT.filter((x) => x.targetKey === heldKey).reduce((s, x) => s + x.delta, 0)
      const expected = item.stock - consumed + adjusted
      const diff = expected - item.remain
      if (diff !== 0) {
        stockItems.push({
          key: `stock-${heldKey}`, targetType, activityId, targetId: id, targetKey: heldKey,
          name, icon, stock: item.stock, consumed, adjusted, expected, actual: item.remain,
          diff, frozenHeld: heldByTarget.get(heldKey) || 0, frozenBook: item.frozen || 0, autoFixable: diff !== 0
        })
      }
    }
    actsT.forEach((a) => a.prizes.forEach((p) => {
      if (p.rarity !== 'none') pushStock('prize', a.id, p.id, `${a.name} / ${p.name}`, p.emoji, p)
    }))
    goodsT.forEach((g) => pushStock('goods', null, g.id, g.name, g.icon, g))

    // —— P6 卡券 ——
    const couponItems = []
    recordsT
      .filter((r) => r.couponId && ['normal', 'released'].includes(r.status) &&
        (r.status === 'released' ? this.reviewDate(this.orderOfRecord(r.id)) === date : r.date === date))
      .forEach((r) => {
        const c = couponsT.find((x) => x.recordId === r.id)
        if (!c) {
          couponItems.push({
            key: `cp-missing-${r.id}`, kind: 'missing', recordId: r.id,
            target: r.type === 'draw' ? r.prizeName : r.goodsName,
            tplId: r.couponId, bizType: r.type,
            expect: '有效业务记录应发券', actual: '券账户无实例', autoFixable: true
          })
        }
      })
    if (date === this.k.todayDate()) {
      couponsT.forEach((c) => {
        const rec = recordsT.find((r) => r.id === c.recordId)
        if (!rec || ['revoked', 'frozen'].includes(rec.status)) {
          couponItems.push({ key: `cp-orphan-${c.id}`, kind: 'orphan', couponId: c.id, code: c.code,
            target: c.name, expect: '券应回指有效业务记录',
            actual: !rec ? '业务记录缺失' : `业务记录状态 ${rec.status}`, autoFixable: false })
        }
        if (c.status === 'redeemed' && (!c.redeemedAt || !c.redeemOperator)) {
          couponItems.push({ key: `cp-redeem-${c.id}`, kind: 'redeem-info', couponId: c.id, code: c.code,
            target: c.name, expect: '已核销应有核销人/时间', actual: '核销信息不完整', autoFixable: false })
        }
      })
      const codeMap = new Map()
      couponsT.forEach((c) => {
        const k = this.coupons.normCode(c.code)
        if (!codeMap.has(k)) codeMap.set(k, [])
        codeMap.get(k).push(c)
      })
      codeMap.forEach((list, k) => {
        if (k && list.length > 1) {
          couponItems.push({ key: `cp-dup-${k}`, kind: 'duplicate', code: k, target: list[0].name,
            expect: '租户内券码唯一', actual: `${list.length} 张券同码`, autoFixable: false })
        }
      })
      couponsT.filter((c) => c.status === 'available' && c.expireTs < this.k.nowTs()).forEach((c) => {
        couponItems.push({ key: `cp-expire-${c.id}`, kind: 'expired-pending', couponId: c.id, code: c.code,
          target: c.name, expect: `已于 ${c.expireDate} 到期`, actual: '账户仍标记待核销', autoFixable: true })
      })
    }

    const openCount = (residual !== 0 ? 1 : 0) + taskItems.length + (chainItem ? 1 : 0) +
      frozenItems.length + stockItems.filter((x) => x.diff !== 0).length + couponItems.length

    return {
      date, tenantId: tid, generatedAt: this.k.nowTs(),
      points: { expectedNet, ledgerNet, compNet, residual, userResidual, autoFixable: residual > 0, detail: expectedDetail },
      tasks: taskItems, chain: chainItem, frozen: frozenItems, stock: stockItems, coupons: couponItems,
      openCount
    }
  }

  signature(d) {
    return JSON.stringify({
      p: d.points.residual,
      pu: d.points.userResidual.map((x) => `${x.userId}:${x.residual}`).sort(),
      t: d.tasks.map((x) => x.claimId).sort(),
      c: d.chain ? 1 : 0,
      f: d.frozen.map((x) => `${x.key}:${x.expect}/${x.actual}`),
      s: d.stock.filter((x) => x.diff !== 0).map((x) => `${x.targetType}:${x.targetId}:${x.diff}`),
      cp: d.coupons.map((x) => x.key).sort()
    })
  }

  billOf(date, tenantId) {
    return this.k.state.reconBills.find((b) => b.date === date && (b.tenantId || 't-star') === tenantId) || null
  }

  async run(date, tenantId, ctx = null) {
    const d = date || this.k.todayDate()
    const diffs = this.compute(d, tenantId)
    const sig = this.signature(diffs)
    let bill = this.billOf(d, tenantId)
    const runAt = { at: `${this.k.todayDate()} ${this.k.nowTime()}`, ts: this.k.nowTs(),
      operator: ctx?.name || '系统', openCount: diffs.openCount, balanced: diffs.openCount === 0 }
    if (!bill) {
      bill = {
        id: genId('rc'), date: d, tenantId,
        status: diffs.openCount === 0 ? 'balanced' : 'pending',
        signature: sig, diffs, runs: [runAt], compensations: [],
        firstAt: runAt.at, reviewedAt: '', reviewer: '', reviewNote: '', createdAt: this.k.todayDate()
      }
      await this.k.commit([{ type: 'insert', table: 'reconBills', row: bill }])
    } else {
      const sameVersion = bill.signature === sig
      bill = { ...bill, diffs, signature: sig, runs: [runAt, ...bill.runs].slice(0, 50) }
      if (!sameVersion) {
        bill.status = diffs.openCount === 0 ? (bill.compensations.length ? 'compensated' : 'balanced') : 'pending'
      }
      if (sameVersion && diffs.openCount === 0 && bill.compensations.length) bill.status = 'compensated'
      await this.k.commit([{ type: 'upsert', table: 'reconBills', row: bill }])
    }
    await this.audit.log('recon-run', bill.id,
      diffs.openCount === 0
        ? `【${tenantId}】业务日 ${d} 对账完成：账实相符，无差异（应有净额 ${diffs.points.expectedNet}，流水净额 ${diffs.points.ledgerNet}）`
        : `【${tenantId}】业务日 ${d} 对账完成：发现 ${diffs.openCount} 项未平差异（积分残差 ${diffs.points.residual}、任务缺记 ${diffs.tasks.length}、库存 ${diffs.stock.filter((x) => x.diff).length} SKU、卡券 ${diffs.coupons.length}、冻结 ${diffs.frozen.length}${diffs.chain ? '、余额链断裂' : ''}）`,
      { tenantId, ctx })
    return this.billOf(d, tenantId)
  }

  async review(date, tenantId, note, ctx) {
    const bill = this.billOf(date, tenantId)
    if (!bill) throw new BizError('NO_BILL', '请先执行对账', 404)
    if (bill.diffs.openCount === 0) throw new BizError('BALANCED', '该业务日账实相符，无需复核', 409)
    const row = { ...bill, status: 'reviewed', reviewedAt: `${this.k.todayDate()} ${this.k.nowTime()}`, reviewer: ctx.name, reviewNote: (note || '').trim() }
    await this.k.commit([{ type: 'upsert', table: 'reconBills', row }])
    await this.audit.log('recon-review', bill.id,
      `复核业务日 ${date} 的对账差异：${(note || '').trim() || '确认差异属实，待补偿修正'}（原始记录保留，仅允许追加补偿流水）`,
      { tenantId, ctx })
    return this.billOf(date, tenantId)
  }

  async compensate(date, tenantId, note, ctx) {
    const bill0 = this.billOf(date, tenantId)
    if (!bill0) throw new BizError('NO_BILL', '请先执行对账', 404)
    if (bill0.status === 'pending') throw new BizError('NEED_REVIEW', '请先完成差异复核，再执行补偿', 409)
    const live = this.compute(date, tenantId)
    const actions = []
    const traceId = this.k.newTraceId()

    // 1) 任务奖励逐笔补记
    for (const item of live.tasks) {
      const claim = this.k.state.taskClaims.find((c) => c.id === item.claimId)
      if (!claim || this.claimFlow(claim, new Set())) continue
      await this.points.post({
        userId: claim.userId, delta: item.reward,
        note: `对账补偿：任务奖励补记【${item.label}】${item.grantDate !== item.bizDate ? `（归属 ${item.bizDate} 跨日补计）` : ''}`,
        kind: 'task-comp', tenantId, bizDate: item.bizDate,
        refId: item.claimId, refType: 'task-claim', traceId
      })
      actions.push({ type: 'task', userId: claim.userId, label: item.label, delta: item.reward })
    }

    // 2) 积分净额残差（按用户精确归集；>0 补，<0 人工核查不自动扣减）
    const live2 = this.compute(date, tenantId)
    const manualUsers = []
    for (const u of live2.points.userResidual) {
      if (u.residual > 0) {
        await this.points.post({
          userId: u.userId, delta: u.residual,
          note: `对账补偿：${date} 积分净额差异（业务流水少记，按差异单补记）`,
          kind: 'recon-comp', tenantId, bizDate: date,
          refId: `${bill0.id}:${u.userId}`, refType: 'recon-bill', traceId
        })
        actions.push({ type: 'points', userId: u.userId, label: `积分残差(${u.userId})`, delta: u.residual })
      } else if (u.residual < 0) {
        manualUsers.push({ userId: u.userId, amount: Math.abs(u.residual) })
      }
    }

    // 3) 库存校正（append 调整凭证，把账面对齐实物）
    const live3 = this.compute(date, tenantId)
    for (const x of live3.stock.filter((s) => s.diff !== 0)) {
      const adjId = `sa:${bill0.id}:${x.targetKey}`
      if (this.k.state.stockAdjustments.some((a) => a.id === adjId)) continue
      const target = this.k.findStock(x.targetKey)
      const before = target ? target.row.remain : 0
      const adj = {
        id: adjId, billId: bill0.id, bizDate: date, tenantId, traceId,
        date: this.k.todayDate(), time: this.k.nowTime(), ts: this.k.nowTs(),
        targetType: x.targetType, targetId: x.targetId, targetKey: x.targetKey,
        activityId: x.activityId || null, targetName: x.name,
        delta: -x.diff, before, after: before,
        reason: (note || '').trim() || (x.diff > 0
          ? '对账差异补偿：实物盘亏，按差异单登记库存调整（账面核销）'
          : '对账差异补偿：实物盘盈，按差异单登记库存调整（账面补登）'),
        operator: ctx.name
      }
      await this.k.commit([{ type: 'insert', table: 'stockAdjustments', row: adj }])
      // 只登记调整凭证（其 delta 计入"应有 remain"公式），不凭空改动实物账，避免双重核销
      actions.push({ type: 'stock', label: x.name, delta: -x.diff })
    }

    // 4) 卡券补偿
    const live4 = this.compute(date, tenantId)
    let couponCount = 0
    let couponExpiredFixed = 0
    let couponManual = 0
    for (const x of live4.coupons) {
      if (x.kind === 'missing') {
        const rec = this.k.state.records.find((r) => r.id === x.recordId)
        if (!rec || this.k.state.coupons.some((c) => c.recordId === rec.id)) continue
        const issued = await this.coupons.issueForRecord(rec, { source: '对账补券', compensateBillId: bill0.id, traceId })
        if (issued?.coupon) {
          await this.coupons.addLog('comp', issued.coupon.id, rec, {
            code: issued.coupon.code, note: `按 ${date} 差异单补发，有效期自补券日起算`, tenantId, traceId
          })
          await this.audit.log('coupon-comp', bill0.id,
            `对账补偿：业务记录【${x.target}】券账户漏发，补发新券 ${issued.coupon.code}（有效期至 ${issued.coupon.expireDate}，原始记录保留）`,
            { tenantId, ctx, traceId })
          actions.push({ type: 'coupon', label: x.target, delta: 1, code: issued.coupon.code })
          couponCount += 1
        }
      } else if (x.kind === 'expired-pending') {
        const c = this.k.state.coupons.find((y) => y.id === x.couponId)
        if (c && c.status === 'available' && c.expireTs < this.k.nowTs()) {
          await this.k.commit([{ type: 'upsert', table: 'coupons', row: { ...c, status: 'expired' } }])
          const rec = this.k.state.records.find((r) => r.id === c.recordId) || null
          await this.coupons.addLog('expire', c.id, rec, { code: c.code, note: `按 ${date} 差异单补做到期流转`, tenantId, traceId })
          couponExpiredFixed += 1
        }
      } else {
        couponManual += 1
      }
    }

    const live5 = this.compute(date, tenantId)
    const frozenManual = live5.frozen.length
    if (!actions.length && !manualUsers.length && !couponManual && !frozenManual && !live5.chain) {
      throw new BizError('ALREADY_BALANCED', '账目已平，无需重复补偿', 409)
    }

    if (actions.length) {
      const pointDelta = actions.filter((a) => a.type === 'task' || a.type === 'points').reduce((s, a) => s + a.delta, 0)
      const stockCount = actions.filter((a) => a.type === 'stock').length
      const comp = {
        id: genId('rcc'), at: `${this.k.todayDate()} ${this.k.nowTime()}`,
        pointDelta, stockCount, couponCount, note: (note || '').trim(), reviewer: ctx.name,
        items: actions.map((a) => ({ ...a }))
      }
      const bill = this.billOf(date, tenantId)
      await this.k.commit([{ type: 'upsert', table: 'reconBills', row: { ...bill, compensations: [comp, ...bill.compensations] } }])
    }

    await this.audit.log('recon-comp', bill0.id,
      `补偿业务日 ${date} 差异：` + actions.map((a) => {
        if (a.type === 'stock') return `库存【${a.label}】校正 ${a.delta > 0 ? '+' : ''}${a.delta}`
        if (a.type === 'coupon') return `卡券【${a.label}】补发新券 ${a.code}`
        return `【${a.label}】补记 +${a.delta} 积分`
      }).join('；') +
      (manualUsers.length ? `；另有积分长款 ${manualUsers.reduce((s, u) => s + u.amount, 0)}（按用户 ${manualUsers.map((u) => u.userId).join('、')}）需人工核查，未自动扣减` : '') +
      (couponManual ? `；${couponManual} 项卡券异常需人工核查` : '') +
      (frozenManual ? `；${frozenManual} 项冻结单据不一致需在风控申诉中处理` : ''),
      { tenantId, ctx, traceId })

    const refreshed = await this.run(date, tenantId, ctx)
    const finalBill = this.billOf(date, tenantId)
    if (refreshed.diffs.openCount === 0) {
      await this.k.commit([{ type: 'upsert', table: 'reconBills', row: { ...finalBill, status: 'compensated' } }])
    } else {
      await this.k.commit([{ type: 'upsert', table: 'reconBills', row: { ...finalBill, status: 'reviewed' } }])
    }
    return { bill: this.billOf(date, tenantId), actions, manualUsers, couponManual, frozenManual }
  }
}
