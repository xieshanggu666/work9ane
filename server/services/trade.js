// 交易编排服务（服务端履约链路核心）：
// 一次抽奖/兑换 = 一笔交易 Saga，串行编排「风控 → 积分扣分预占 → 库存预占/扣减 → 业务记录 → 发奖（积分/券/实物）→ 任务结算」。
//
// 幂等与补偿（统一）：
//  - 客户端 idempotencyKey：整笔交易重放直接返回首次结果，不重复扣分/扣库存/发奖；
//  - 库存事件 effectId、积分流水 (kind,refId) 均幂等，崩溃恢复重放 WAL 不产生重复副作用；
//  - 交易中断（processing 状态）由 resumeAll() 在启动/手工触发时续办到终态（frozen/normal）；
//  - 风控放行/撤销本身也是 Saga（见 risk.js），跨日审核按业务日 bizDate 补计任务、实际处理日另记。
import { genId, BizError } from '../util.js'

function drawByWeight(prizes) {
  const total = prizes.reduce((s, p) => s + p.weight, 0)
  let r = Math.random() * total
  for (let i = 0; i < prizes.length; i++) {
    r -= prizes[i].weight
    if (r < 0) return i
  }
  return prizes.length - 1
}

export class TradeService {
  constructor(deps) {
    this.k = deps.k
    this.locks = deps.locks
    this.audit = deps.audit
    this.points = deps.points
    this.inventory = deps.inventory
    this.coupons = deps.coupons
    this.ship = deps.ship
    this.tasks = deps.tasks
    this.risk = deps.risk
    this.budget = deps.budget
  }

  // 营销预算占用条目（预算与成本控制闭环）：
  // 抽奖成本=活动积分消耗；积分奖励=抽中的积分奖品；兑换成本=商品积分消耗（均按租户/活动两级预算占用）。
  _drawBudgetItems(act, prize, cost) {
    const items = []
    if (cost > 0) {
      items.push({ unit: 'points', amount: cost, scopeType: 'activity', scopeId: act.id,
        category: 'draw', kind: 'draw-cost' })
    }
    const pointPrize = prize && prize.name.includes('积分') ? (parseInt(prize.name, 10) || 0) : 0
    if (pointPrize > 0) {
      items.push({ unit: 'points', amount: pointPrize, scopeType: 'activity', scopeId: act.id,
        category: 'points', kind: 'points-reward' })
    }
    return items
  }
  _redeemBudgetItems(g) {
    return g.cost > 0
      ? [{ unit: 'points', amount: g.cost, scopeType: 'tenant', scopeId: g.tenantId || 't-star', category: 'redeem', kind: 'redeem-cost' }]
      : []
  }
  // 预算占用落账（正常落账 settle / 风控冻结 reserve；按记录维度幂等）
  async _budgetOccupy(mode, items, rec, ctx) {
    for (const it of items) {
      await this.budget.occupy(mode, it, {
        category: it.category, kind: it.kind,
        refType: 'record', refId: `${rec.id}:${it.kind}`,
        bizNo: rec.activityName || rec.goodsName || '',
        summary: `${mode === 'reserve' ? '预占' : '成本'}：${it.kind === 'draw-cost' ? '抽奖参与' : it.kind === 'points-reward' ? '积分奖品' : '积分兑换'}【${rec.prizeName || rec.goodsName}】×${it.amount}${it.unit === 'points' ? ' 积分' : ' 元'}`,
        tenantId: rec.tenantId, userId: rec.userId, traceId: rec.traceId
      }, ctx)
    }
  }

  // 业务日切换：到期扫描 + 兜底结算上一业务日全部用户的抽奖任务（幂等），保留冻结权益支持跨日审核
  async rollover(ctx = null, opts = {}) {
    await this.coupons.sweepExpiry(true)
    const current = this.k.todayDate()
    // 兜底结算：找出前两个业务日内所有有抽奖记录的 (用户,租户,业务日) 组合，逐户幂等结算
    const combos = new Map()
    this.k.state.records.filter((r) => r.type === 'draw').forEach((r) => {
      combos.set(`${r.date}|${r.tenantId || 't-star'}|${r.userId}`, {
        date: r.date, tenantId: r.tenantId || 't-star', userId: r.userId
      })
    })
    let settled = 0
    for (const c of combos.values()) {
      const claims = await this.tasks.settle(c.date, c.tenantId, c.userId)
      settled += claims.length
    }
    if (opts.log !== false) {
      await this.audit.log('day-rollover', '',
        `业务日检查 ${current}：卡券到期扫描完成，兜底结算 ${settled} 笔任务（幂等），审核中冻结权益保留支持跨日审核`,
        { tenantId: '', ctx })
    }
    return { day: current, settled }
  }

  // —— 抽奖 ——
  async draw(activityId, ctx, opts = {}) {
    await this.rollover(ctx, { log: false })
    const idemKey = opts.idempotencyKey ? `draw:${ctx.tenantId}:${ctx.userId}:${opts.idempotencyKey}` : ''
    if (idemKey && this.k.hasIdem(idemKey)) {
      const id = this.k.idemResult(idemKey)
      return { trade: this.k.state.records.find((r) => r.id === id), idempotent: true }
    }
    const act = this.k.state.activities.find((a) => a.id === activityId)
    if (!act || act.status !== 'running' || act.tenantId !== ctx.tenantId) {
      throw new BizError('ACTIVITY_UNAVAILABLE', '活动未在运行或不属于当前租户', 404)
    }
    const day = this.k.todayDate()
    // 奖品抽取在活动锁内二次确认库存后定稿，先取候选集（保证并发下人人看到一致权重）
    const prizeCandidates = act.prizes.filter((p) => p.remain > 0 || p.rarity === 'none')
    if (!prizeCandidates.length) throw new BizError('ALL_SOLD_OUT', '奖品已抽完', 409)
    const cost = act.costType === 'points' ? act.cost : 0
    const lockKeys = [`act:${act.id}`, `points:${ctx.userId}`].sort()

    return this._withLocks(lockKeys, async () => {
      // 锁内重新加载活动（其他并发请求可能已扣库存）
      const live = this.k.state.activities.find((a) => a.id === activityId)
      if (live.status !== 'running') throw new BizError('ACTIVITY_UNAVAILABLE', '活动未在运行', 409)
      const dayCount = this.k.state.records.filter(
        (r) => r.type === 'draw' && r.activityId === act.id && r.date === day &&
          r.status !== 'revoked' && r.userId === ctx.userId
      ).length
      if (dayCount >= live.dailyLimit) throw new BizError('DAILY_LIMIT', `今日已达抽奖上限（${live.dailyLimit} 次）`, 409)
      const totalCount = this.k.state.records.filter(
        (r) => r.type === 'draw' && r.activityId === act.id && r.status !== 'revoked' && r.userId === ctx.userId
      ).length
      if (totalCount >= live.totalLimit) throw new BizError('TOTAL_LIMIT', `累计已达抽奖上限（${live.totalLimit} 次）`, 409)
      const drawable = live.prizes.filter((p) => p.remain > 0 || p.rarity === 'none')
      if (!drawable.length) throw new BizError('ALL_SOLD_OUT', '奖品已抽完', 409)
      if (cost > 0 && this.points.balanceOf(ctx.userId) < cost) {
        throw new BizError('POINTS_NOT_ENOUGH', '积分不足，无法参与', 409)
      }
      const prize = drawable[drawByWeight(drawable)]
      const riskHits = this.risk.evalDraw(ctx.tenantId, ctx.userId, live, prize, day)
      // 营销预算预检：抽奖成本/积分奖励占用超出租户/活动预算（或预算被冻结/关闭）时整笔拦截
      const budgetItems = this._drawBudgetItems(live, prize, cost)
      this.budget.guard(budgetItems, act.tenantId)
      const traceId = this.k.newTraceId()
      const recId = genId('r')
      const rec = {
        id: recId, type: 'draw', status: 'init',
        tenantId: act.tenantId, userId: ctx.userId, userName: ctx.name,
        traceId, date: day, time: this.k.nowTime(), ts: this.k.nowTs(),
        activityId: act.id, activityName: act.name,
        prizeId: prize.id, prizeName: prize.name, rarity: prize.rarity,
        couponId: prize.couponId || '', icon: prize.emoji,
        cost, riskHits: riskHits.join(','), processing: true, stages: {},
        budgetItems
      }
      await this.k.commit([{ type: 'insert', table: 'records', row: rec }])
      if (idemKey) await this.k.commit([{ type: 'idem.put', key: idemKey, result: recId, at: this.k.nowTs() }])

      if (riskHits.length) {
        await this._freezeDraw(live, prize, rec, cost, riskHits, ctx)
      } else {
        await this._completeDraw(live, prize, rec, cost, ctx)
      }
      return { trade: this.k.state.records.find((r) => r.id === recId), idempotent: false }
    })
  }

  async _stage(rec, name) {
    if (rec.stages[name]) return
    await this.k.commit([{ type: 'upsert', table: 'records', row: { ...rec, stages: { ...rec.stages, [name]: true } } }])
  }

  // 正常落账分支：扣分 → 扣库存 → 积分奖品入账 → normal → 发券/发货 → 任务结算
  async _completeDraw(act, prize, rec, cost, ctx) {
    // 1) 扣分（幂等 kind=normal refId）
    if (cost > 0 && !rec.stages.cost) {
      await this.points.post({
        userId: rec.userId, delta: -cost, note: `参与活动【${act.name}】`,
        kind: 'normal', tenantId: act.tenantId,
        refId: `draw-cost:${rec.id}`, refType: 'trade', traceId: rec.traceId
      })
      await this._stage(this.k.state.records.find((r) => r.id === rec.id), 'cost')
      this.k.maybeFault('draw.afterCost')
    }
    // 2) 扣减奖品库存（幂等 effectId）
    if (prize.rarity !== 'none' && !rec.stages.stock) {
      const target = this.inventory.targetOf('prize', act.id, prize.id)
      await this.k.commit([
        { type: 'inv.mut', key: target.key, dRemain: -1, dFrozen: 0, effectId: `draw-stock:${rec.id}`,
          kind: 'draw-deduct', bizDate: rec.date, refType: 'record', refId: rec.id,
          tenantId: act.tenantId, traceId: rec.traceId }
      ])
      await this._stage(this.k.state.records.find((r) => r.id === rec.id), 'stock')
    }
    // 3) 积分奖品入账
    const cur = this.k.state.records.find((r) => r.id === rec.id)
    const pointDelta = prize.name.includes('积分') ? (parseInt(prize.name, 10) || 0) : 0
    if (pointDelta && !cur.stages.rewardPoints) {
      await this.points.post({
        userId: rec.userId, delta: pointDelta, note: `抽奖获得：${prize.name}`,
        kind: 'reward', tenantId: act.tenantId,
        refId: `draw-reward:${rec.id}`, refType: 'trade', traceId: rec.traceId
      })
      await this._stage(this.k.state.records.find((r) => r.id === rec.id), 'rewardPoints')
    }
    // 3.5) 营销预算占用：抽奖成本 + 积分奖励实时占用租户/活动预算（幂等，崩溃续办不重复占用）
    const curB = this.k.state.records.find((r) => r.id === rec.id)
    if (!curB.stages.budget) {
      await this._budgetOccupy('settle', curB.budgetItems || this._drawBudgetItems(act, prize, cost), curB, ctx)
      await this._stage(this.k.state.records.find((r) => r.id === rec.id), 'budget')
    }
    // 4) 终态 normal
    const cur2 = this.k.state.records.find((r) => r.id === rec.id)
    await this.k.commit([{ type: 'upsert', table: 'records', row: { ...cur2, status: 'normal', processing: false } }])
    // 5) 审计 + 发券/发货（幂等）
    if (!cur2.stages.audit) {
      await this.audit.log('draw', rec.id,
        `参与抽奖【${act.name}】抽中【${prize.name}】${cost ? `，消耗 ${cost} 积分` : '（免费）'}`,
        { tenantId: act.tenantId, ctx, traceId: rec.traceId })
      await this._stage(this.k.state.records.find((r) => r.id === rec.id), 'audit')
    }
    const finalRec = this.k.state.records.find((r) => r.id === rec.id)
    if (!finalRec.stages.deliver) {
      if (prize.couponId) await this.coupons.issueForRecord(finalRec)
      else await this.ship.createForRecord(finalRec)
      await this._stage(this.k.state.records.find((r) => r.id === rec.id), 'deliver')
      this.k.maybeFault('draw.afterDeliver')
    }
    // 6) 任务结算（幂等台账）
    if (!this.k.state.records.find((r) => r.id === rec.id).stages.settle) {
      await this.tasks.settle(rec.date, act.tenantId, rec.userId, rec.traceId)
      await this._stage(this.k.state.records.find((r) => r.id === rec.id), 'settle')
    }
  }

  // 风控冻结分支：扣分预占（frozen 流水）+ 库存预占（remain-1/frozen+1）+ 审核单；不发奖、不计任务
  async _freezeDraw(act, prize, rec, cost, riskHits, ctx) {
    if (cost > 0 && !rec.stages.cost) {
      await this.points.post({
        userId: rec.userId, delta: -cost, note: `冻结：参与【${act.name}】待风控审核`,
        kind: 'frozen', tenantId: act.tenantId,
        refId: `freeze-cost:${rec.id}`, refType: 'risk-freeze', traceId: rec.traceId
      })
      await this._stage(this.k.state.records.find((r) => r.id === rec.id), 'cost')
      this.k.maybeFault('freeze.afterCost')
    }
    // 营销预算预占：冻结中的抽奖成本/积分奖励按 reserve 占用预算（放行核销、撤销释放）
    if (!rec.stages.budget) {
      await this._budgetOccupy('reserve', rec.budgetItems || this._drawBudgetItems(act, prize, cost), rec, ctx)
      await this._stage(this.k.state.records.find((r) => r.id === rec.id), 'budget')
    }
    if (prize.rarity !== 'none' && !rec.stages.stock) {
      const target = this.inventory.targetOf('prize', act.id, prize.id)
      await this.k.commit([
        { type: 'inv.mut', key: target.key, dRemain: -1, dFrozen: 1, effectId: `freeze-stock:${rec.id}`,
          kind: 'hold', bizDate: rec.date, refType: 'risk-order', refId: rec.riskOrderId || rec.id,
          tenantId: act.tenantId, traceId: rec.traceId }
      ])
      await this._stage(this.k.state.records.find((r) => r.id === rec.id), 'stock')
    }
    const cur = this.k.state.records.find((r) => r.id === rec.id)
    const order = await this.risk.createOrder({
      bizType: 'draw', recordId: rec.id, activityId: act.id,
      targetId: prize.id, targetName: prize.name, icon: prize.emoji, rarity: prize.rarity,
      cost, stockHeld: prize.rarity === 'none' ? 0 : 1, riskHits,
      tenantId: act.tenantId, userId: ctx.userId, userName: ctx.name, traceId: rec.traceId
    })
    if (prize.couponId && !cur.stages.couponHold) {
      await this.coupons.addLog('hold', null, cur, { orderId: order.id, traceId: rec.traceId, tenantId: act.tenantId })
      await this._stage(this.k.state.records.find((r) => r.id === rec.id), 'couponHold')
    }
    await this.k.commit([{
      type: 'upsert', table: 'records',
      row: { ...this.k.state.records.find((r) => r.id === rec.id), status: 'frozen', riskOrderId: order.id, processing: false }
    }])
  }

  // —— 积分兑换 ——
  async redeem(goodsId, ctx, opts = {}) {
    await this.rollover(ctx, { log: false })
    const idemKey = opts.idempotencyKey ? `redeem:${ctx.tenantId}:${ctx.userId}:${opts.idempotencyKey}` : ''
    if (idemKey && this.k.hasIdem(idemKey)) {
      const id = this.k.idemResult(idemKey)
      return { trade: this.k.state.records.find((r) => r.id === id), idempotent: true }
    }
    const g = this.k.state.goods.find((x) => x.id === goodsId)
    if (!g || (g.tenantId || 't-star') !== ctx.tenantId) {
      throw new BizError('GOODS_NOT_FOUND', '商品不存在或不属于当前租户', 404)
    }
    const lockKeys = [`goods:${g.id}`, `points:${ctx.userId}`].sort()
    return this._withLocks(lockKeys, async () => {
      const live = this.k.state.goods.find((x) => x.id === goodsId)
      if (live.remain <= 0) throw new BizError('ALL_SOLD_OUT', '商品已兑完', 409)
      if (this.points.balanceOf(ctx.userId) < live.cost) throw new BizError('POINTS_NOT_ENOUGH', '积分不足', 409)
      const riskHits = this.risk.evalRedeem(ctx.tenantId, ctx.userId, live)
      // 营销预算预检：兑换成本占用超出租户积分预算（或预算被冻结/关闭）时整笔拦截
      const budgetItems = this._redeemBudgetItems(live)
      this.budget.guard(budgetItems, live.tenantId || 't-star')
      const traceId = this.k.newTraceId()
      const recId = genId('rg')
      const rec = {
        id: recId, type: 'redeem', status: 'init',
        tenantId: live.tenantId || 't-star', userId: ctx.userId, userName: ctx.name,
        traceId, date: this.k.todayDate(), time: this.k.nowTime(), ts: this.k.nowTs(),
        goodsId: live.id, goodsName: live.name, couponId: live.couponId || '', icon: live.icon,
        cost: live.cost, riskHits: riskHits.join(','), processing: true, stages: {},
        budgetItems
      }
      await this.k.commit([{ type: 'insert', table: 'records', row: rec }])
      if (idemKey) await this.k.commit([{ type: 'idem.put', key: idemKey, result: recId, at: this.k.nowTs() }])

      if (riskHits.length) {
        await this._freezeRedeem(live, rec, riskHits, ctx)
      } else {
        await this._completeRedeem(live, rec, ctx)
      }
      return { trade: this.k.state.records.find((r) => r.id === recId), idempotent: false }
    })
  }

  async _completeRedeem(g, rec, ctx) {
    if (!rec.stages.cost) {
      await this.points.post({
        userId: rec.userId, delta: -g.cost, note: `兑换：${g.name}`,
        kind: 'normal', tenantId: g.tenantId,
        refId: `redeem-cost:${rec.id}`, refType: 'trade', traceId: rec.traceId
      })
      await this._stage(this.k.state.records.find((r) => r.id === rec.id), 'cost')
      this.k.maybeFault('redeem.afterCost')
    }
    // 营销预算占用：兑换成本实时占用租户积分预算（幂等）
    if (!rec.stages.budget) {
      await this._budgetOccupy('settle', rec.budgetItems || this._redeemBudgetItems(g), rec, ctx)
      await this._stage(this.k.state.records.find((r) => r.id === rec.id), 'budget')
    }
    if (!rec.stages.stock) {
      const target = this.inventory.targetOf('goods', null, g.id)
      await this.k.commit([
        { type: 'inv.mut', key: target.key, dRemain: -1, dFrozen: 0, effectId: `redeem-stock:${rec.id}`,
          kind: 'redeem-deduct', bizDate: rec.date, refType: 'record', refId: rec.id,
          tenantId: g.tenantId, traceId: rec.traceId }
      ])
      await this._stage(this.k.state.records.find((r) => r.id === rec.id), 'stock')
    }
    const cur = this.k.state.records.find((r) => r.id === rec.id)
    await this.k.commit([{ type: 'upsert', table: 'records', row: { ...cur, status: 'normal', processing: false } }])
    if (!cur.stages.audit) {
      await this.audit.log('redeem', rec.id, `积分兑换【${g.name}】，扣减 ${g.cost} 积分`,
        { tenantId: g.tenantId, ctx, traceId: rec.traceId })
      await this._stage(this.k.state.records.find((r) => r.id === rec.id), 'audit')
    }
    const finalRec = this.k.state.records.find((r) => r.id === rec.id)
    if (!finalRec.stages.deliver) {
      if (g.couponId) await this.coupons.issueForRecord(finalRec)
      else await this.ship.createForRecord(finalRec)
      await this._stage(this.k.state.records.find((r) => r.id === rec.id), 'deliver')
      this.k.maybeFault('redeem.afterDeliver')
    }
  }

  async _freezeRedeem(g, rec, riskHits, ctx) {
    if (!rec.stages.cost) {
      await this.points.post({
        userId: rec.userId, delta: -g.cost, note: `冻结：兑换【${g.name}】待风控审核`,
        kind: 'frozen', tenantId: g.tenantId,
        refId: `freeze-cost:${rec.id}`, refType: 'risk-freeze', traceId: rec.traceId
      })
      await this._stage(this.k.state.records.find((r) => r.id === rec.id), 'cost')
      this.k.maybeFault('freeze.afterCost')
    }
    // 营销预算预占：冻结中的兑换成本按 reserve 占用预算（放行核销、撤销释放）
    if (!rec.stages.budget) {
      await this._budgetOccupy('reserve', rec.budgetItems || this._redeemBudgetItems(g), rec, ctx)
      await this._stage(this.k.state.records.find((r) => r.id === rec.id), 'budget')
    }
    if (!rec.stages.stock) {
      const target = this.inventory.targetOf('goods', null, g.id)
      await this.k.commit([
        { type: 'inv.mut', key: target.key, dRemain: -1, dFrozen: 1, effectId: `freeze-stock:${rec.id}`,
          kind: 'hold', bizDate: rec.date, refType: 'risk-order', refId: rec.riskOrderId || rec.id,
          tenantId: g.tenantId, traceId: rec.traceId }
      ])
      await this._stage(this.k.state.records.find((r) => r.id === rec.id), 'stock')
    }
    const cur = this.k.state.records.find((r) => r.id === rec.id)
    const order = await this.risk.createOrder({
      bizType: 'redeem', recordId: rec.id,
      targetId: g.id, targetName: g.name, icon: g.icon, cost: g.cost, stockHeld: 1,
      riskHits, tenantId: g.tenantId, userId: ctx.userId, userName: ctx.name, traceId: rec.traceId
    })
    if (g.couponId && !cur.stages.couponHold) {
      await this.coupons.addLog('hold', null, cur, { orderId: order.id, traceId: rec.traceId, tenantId: g.tenantId })
      await this._stage(this.k.state.records.find((r) => r.id === rec.id), 'couponHold')
    }
    await this.k.commit([{
      type: 'upsert', table: 'records',
      row: { ...this.k.state.records.find((r) => r.id === rec.id), status: 'frozen', riskOrderId: order.id, processing: false }
    }])
  }

  // 多键有序加锁（避免死锁）
  async _withLocks(keys, fn) {
    const sorted = [...new Set(keys)].sort()
    let i = 0
    const run = async () => {
      if (i >= sorted.length) return fn()
      const key = sorted[i++]
      return this.locks.run(key, run)
    }
    return run()
  }

  // 故障续办：扫描所有 processing 交易（崩溃在落账途中），按已记录 stages 幂等续办
  async resumeAll(ctx = { name: '系统' }) {
    const resumed = []
    for (const rec of [...this.k.state.records]) {
      if (!rec.processing) continue
      const r = await this.resumeOne(rec, ctx)
      if (r) resumed.push(rec.id)
    }
    return resumed
  }

  async resumeOne(rec, ctx) {
    const traceId = rec.traceId
    if (rec.type === 'draw') {
      const act = this.k.state.activities.find((a) => a.id === rec.activityId)
      const prize = act?.prizes.find((p) => p.id === rec.prizeId)
      if (!prize) return false
      const riskHits = (rec.riskHits || '').split(',').filter(Boolean)
      if (riskHits.length) {
        // 冻结分支续办：成本/库存/预算占用事件本身幂等，补执行也不重复扣；审核单已存在则仅收尾
        const live = this.k.state.records.find((x) => x.id === rec.id)
        if (rec.cost > 0) {
          await this.points.post({
            userId: rec.userId, delta: -rec.cost, note: `冻结：参与【${act.name}】待风控审核`,
            kind: 'frozen', tenantId: rec.tenantId,
            refId: `freeze-cost:${rec.id}`, refType: 'risk-freeze', traceId
          })
        }
        await this._budgetOccupy('reserve', live.budgetItems || this._drawBudgetItems(act, prize, rec.cost || 0), live, ctx)
        if (prize.rarity !== 'none') {
          const target = this.inventory.targetOf('prize', act.id, prize.id)
          await this.k.commit([
            { type: 'inv.mut', key: target.key, dRemain: -1, dFrozen: 1, effectId: `freeze-stock:${rec.id}`,
              kind: 'hold', bizDate: rec.date, refType: 'risk-order', refId: rec.riskOrderId || rec.id,
              tenantId: rec.tenantId, traceId }
          ])
        }
        let order = this.k.state.riskOrders.find((o) => o.recordId === rec.id)
        if (!order) {
          order = await this.risk.createOrder({
            bizType: 'draw', recordId: rec.id, activityId: act.id,
            targetId: prize.id, targetName: prize.name, icon: prize.emoji, rarity: prize.rarity,
            cost: rec.cost || 0, stockHeld: prize.rarity === 'none' ? 0 : 1, riskHits,
            tenantId: rec.tenantId, userId: rec.userId, userName: rec.userName, traceId
          })
        }
        if (prize.couponId && !this.k.state.couponLogs.some((l) => l.recordId === rec.id && l.action === 'hold')) {
          await this.coupons.addLog('hold', null, live, { orderId: order.id, traceId, tenantId: rec.tenantId })
        }
        await this.k.commit([{
          type: 'upsert', table: 'records',
          row: { ...this.k.state.records.find((x) => x.id === rec.id), status: 'frozen', riskOrderId: order.id, processing: false }
        }])
      } else {
        await this._completeDraw(act, prize, rec, rec.cost || 0, ctx)
      }
    } else {
      const g = this.k.state.goods.find((x) => x.id === rec.goodsId)
      if (!g) return false
      const riskHits = (rec.riskHits || '').split(',').filter(Boolean)
      if (riskHits.length) {
        const live = this.k.state.records.find((x) => x.id === rec.id)
        await this.points.post({
          userId: rec.userId, delta: -g.cost, note: `冻结：兑换【${g.name}】待风控审核`,
          kind: 'frozen', tenantId: g.tenantId,
          refId: `freeze-cost:${rec.id}`, refType: 'risk-freeze', traceId
        })
        await this._budgetOccupy('reserve', live.budgetItems || this._redeemBudgetItems(g), live, ctx)
        const target = this.inventory.targetOf('goods', null, g.id)
        await this.k.commit([
          { type: 'inv.mut', key: target.key, dRemain: -1, dFrozen: 1, effectId: `freeze-stock:${rec.id}`,
            kind: 'hold', bizDate: rec.date, refType: 'risk-order', refId: rec.riskOrderId || rec.id,
            tenantId: g.tenantId, traceId }
        ])
        let order = this.k.state.riskOrders.find((o) => o.recordId === rec.id)
        if (!order) {
          order = await this.risk.createOrder({
            bizType: 'redeem', recordId: rec.id,
            targetId: g.id, targetName: g.name, icon: g.icon, cost: g.cost, stockHeld: 1,
            riskHits, tenantId: g.tenantId, userId: rec.userId, userName: rec.userName, traceId
          })
        }
        if (g.couponId && !this.k.state.couponLogs.some((l) => l.recordId === rec.id && l.action === 'hold')) {
          await this.coupons.addLog('hold', null, live, { orderId: order.id, traceId, tenantId: g.tenantId })
        }
        await this.k.commit([{
          type: 'upsert', table: 'records',
          row: { ...this.k.state.records.find((x) => x.id === rec.id), status: 'frozen', riskOrderId: order.id, processing: false }
        }])
      } else {
        await this._completeRedeem(g, rec, ctx)
      }
    }
    const after = this.k.state.records.find((x) => x.id === rec.id)
    if (after.processing) {
      await this.k.commit([{ type: 'upsert', table: 'records', row: { ...after, processing: false, status: after.status === 'init' ? 'normal' : after.status } }])
    }
    await this.audit.log('saga-resume', rec.id,
      `故障续办：交易 ${rec.id}（${rec.type === 'draw' ? `抽奖【${rec.prizeName}】` : `兑换【${rec.goodsName}】`}）从中断点续办至 ${this.k.state.records.find((x) => x.id === rec.id).status}，扣分/库存/发奖幂等无重复`,
      { tenantId: rec.tenantId, ctx, traceId })
    return true
  }
}
