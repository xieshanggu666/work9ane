// 营销预算与成本控制服务：
// 按「租户 × 活动」两级、按币种（积分 / 资金）设立预算，审批生效后参与实时占用控制。
// 占用模型（append-only 预算台账 budgetLedger，余额纯推导）：
//   reserve  预占（风控冻结中的抽奖/兑换成本、审批流程中的采购单）
//   settle   实际成本（正常落账的抽奖/积分奖励/兑换、任务奖励、供应商付款、售后补发）
//            converts=true 的 settle 由 reserve 核销转来（风控放行、采购付款）
//   release  预占释放（风控撤销、采购驳回/撤销）
// 占用合计 = 未释放预占 + 实际成本；超过生效预算或预算被冻结/关闭时，业务整体阻断（上层先预检、锁内核验）。
import { genId, BizError } from '../util.js'

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

export const BUDGET_STATUS = {
  pending: '待财务审批',
  active: '生效中',
  rejected: '已驳回',
  frozen: '已冻结',
  closed: '已关闭',
  canceled: '已撤销'
}

export class BudgetService {
  constructor(deps) {
    this.k = deps.k
    this.audit = deps.audit
    this.locks = deps.locks
  }

  // 所有预算写操作统一走租户级预算锁；调用方均在持有业务锁（act/goods/points/po）之后再获取本锁，
  // 不存在「持预算锁等待业务锁」的路径，故多键加锁无死锁环。
  lockOf(tenantId) { return `bg-lock:${tenantId || 't-star'}` }
  async withLock(tenantId, fn) { return this.locks.run(this.lockOf(tenantId), fn) }

  inT(tenantId) { return (x) => (x.tenantId || 't-star') === tenantId }
  list(tenantId) {
    return this.k.state.budgets.filter(this.inT(tenantId)).sort((a, b) => b.ts - a.ts)
  }
  ledger(tenantId) {
    return this.k.state.budgetLedger.filter(this.inT(tenantId)).sort((a, b) => b.ts - a.ts)
  }
  requireBudget(id) {
    const b = this.k.state.budgets.find((x) => x.id === id)
    if (!b) throw new BizError('BUDGET_NOT_FOUND', '预算单不存在', 404)
    return b
  }
  entryByEffect(effectId) {
    return this.k.state.budgetLedger.find((x) => x.effectId === effectId) || null
  }

  // 生效预算定位：活动类占用同时落到「活动预算 + 租户同币种预算」；无生效预算则该维度不控制
  _targets(tenantId, scopeType, scopeId, unit) {
    return this._scoped(tenantId, scopeType, scopeId, unit, ['active'])
  }
  // 预检口径：冻结预算拦截新增支出（关闭为历史终态，新支出落其他生效预算）
  _guardTargets(tenantId, scopeType, scopeId, unit) {
    return this._scoped(tenantId, scopeType, scopeId, unit, ['active', 'frozen'])
  }
  _scoped(tenantId, scopeType, scopeId, unit, statuses) {
    const all = this.k.state.budgets.filter(
      (b) => (b.tenantId || 't-star') === tenantId && b.unit === unit && statuses.includes(b.status))
    const tenant = all.find((b) => b.scopeType === 'tenant' && b.scopeId === tenantId) || null
    const activity = scopeType === 'activity'
      ? (all.find((b) => b.scopeType === 'activity' && b.scopeId === scopeId) || null)
      : null
    return { tenant, activity, rows: [activity, tenant].filter(Boolean) }
  }

  // —— 预算单审批流（RBAC 由 HTTP 层强制；这里保证租户归属与状态机） ——
  async create(form, ctx) {
    const tenantId = ctx.tenantId
    const scopeType = form.scopeType === 'activity' ? 'activity' : 'tenant'
    const unit = form.unit === 'points' ? 'points' : 'money'
    let scopeId = tenantId
    let scopeName = this.k.state.tenants.find((t) => t.id === tenantId)?.shortName || tenantId
    if (scopeType === 'activity') {
      const act = this.k.state.activities.find((a) => a.id === form.scopeId)
      if (!act || act.tenantId !== tenantId) throw new BizError('BAD_SCOPE', '活动不存在或不属于当前租户', 400)
      scopeId = act.id
      scopeName = act.name
    }
    const amount = round2(form.amount)
    if (!(amount > 0)) throw new BizError('BAD_FORM', '预算额度需为正数')
    if (amount > 1e12) throw new BizError('BAD_FORM', '预算额度异常，请核对')
    const startDate = form.startDate || this.k.todayDate()
    const endDate = form.endDate || startDate
    if (endDate < startDate) throw new BizError('BAD_FORM', '预算生效结束日不能早于开始日')
    const dup = this.k.state.budgets.some((b) =>
      (b.tenantId || 't-star') === tenantId && b.scopeType === scopeType && b.scopeId === scopeId &&
      b.unit === unit && ['pending', 'active', 'frozen'].includes(b.status))
    if (dup) throw new BizError('BUDGET_DUP', '该口径已存在生效/待审批/冻结中的预算（一口径一币种同时仅一张生效预算）', 409)
    const b = {
      id: genId('bg'), bNo: 'BG' + Date.now().toString(36).toUpperCase() + String(Math.floor(Math.random() * 90) + 10),
      tenantId, scopeType, scopeId, scopeName, unit,
      name: (form.name || '').trim() || (scopeType === 'activity' ? `活动预算：${scopeName}` : `${scopeName}${unit === 'points' ? '积分' : '营销资金'}预算`),
      purpose: (form.purpose || '').trim(),
      amount, startDate, endDate,
      status: 'pending',
      applicant: ctx.name, applicantId: ctx.memberId || ctx.userId,
      createdAt: this.k.todayDate(), time: this.k.nowTime(), ts: this.k.nowTs(),
      reviewedAt: '', reviewer: '', reviewNote: '', frozenAt: '', closedAt: '',
      adjustments: [], version: 1, parentId: ''
    }
    await this.k.commit([{ type: 'insert', table: 'budgets', row: b }])
    await this.audit.log('budget-apply', b.id,
      `编制预算【${b.name}】：${scopeType === 'activity' ? '活动' : '租户'}级${unit === 'points' ? '积分' : '资金'}预算 ${amount}${unit === 'points' ? ' 积分' : ' 元'}（${startDate} ~ ${endDate}），提交财务审批`,
      { tenantId, ctx })
    return b
  }

  async review(id, approve, note, ctx) {
    const b = this.requireBudget(id)
    if (b.tenantId !== ctx.tenantId) throw new BizError('FORBIDDEN', '预算单不属于当前租户', 403)
    if (b.status !== 'pending') throw new BizError('STATE_DENIED', '仅待审批预算可审批', 409)
    const row = {
      ...b,
      status: approve ? 'active' : 'rejected',
      reviewedAt: `${this.k.todayDate()} ${this.k.nowTime()}`,
      reviewer: ctx.name, reviewNote: (note || '').trim()
    }
    await this.k.commit([{ type: 'upsert', table: 'budgets', row }])
    await this.audit.log(approve ? 'budget-approve' : 'budget-reject', b.id,
      `${approve ? '审批通过预算' : '驳回预算'}【${b.name}】（额度 ${b.amount}${b.unit === 'points' ? ' 积分' : ' 元'}）${note ? '；意见：' + note : ''}`,
      { tenantId: b.tenantId, ctx })
    return this.requireBudget(b.id)
  }

  async cancel(id, ctx) {
    const b = this.requireBudget(id)
    if (b.tenantId !== ctx.tenantId) throw new BizError('FORBIDDEN', '预算单不属于当前租户', 403)
    if (b.status !== 'pending') throw new BizError('STATE_DENIED', '仅待审批预算可撤销', 409)
    const isAdmin = ctx.identityKind === 'platform' || ctx.roleKey === 'org_admin'
    if (!isAdmin && b.applicantId !== (ctx.memberId || ctx.userId)) {
      throw new BizError('FORBIDDEN', '只能撤销本人编制的预算申请', 403)
    }
    const row = { ...b, status: 'canceled', reviewNote: '申请人撤销' }
    await this.k.commit([{ type: 'upsert', table: 'budgets', row }])
    await this.audit.log('budget-cancel', b.id, `撤销预算【${b.name}】（审批前撤回，未参与占用控制）`, { tenantId: b.tenantId, ctx })
    return row
  }

  // 冻结（暂停一切新增占用，已发生占用保留）/ 解冻
  async setFrozen(id, frozen, note, ctx) {
    const b = this.requireBudget(id)
    if (b.tenantId !== ctx.tenantId) throw new BizError('FORBIDDEN', '预算单不属于当前租户', 403)
    const next = frozen ? 'frozen' : 'active'
    if (b.status !== (frozen ? 'active' : 'frozen')) {
      throw new BizError('STATE_DENIED', frozen ? '仅生效中预算可冻结' : '仅冻结中预算可解冻', 409)
    }
    const row = {
      ...b, status: next,
      frozenAt: frozen ? `${this.k.todayDate()} ${this.k.nowTime()}` : '',
      reviewNote: (note || b.reviewNote || '').trim()
    }
    await this.k.commit([{ type: 'upsert', table: 'budgets', row }])
    await this.audit.log(frozen ? 'budget-freeze' : 'budget-activate', b.id,
      `${frozen ? '冻结预算' : '解冻预算'}【${b.name}】${note ? '；备注：' + note : ''}${frozen ? '；冻结期新增抽奖/兑换/采购等支出一律拦截' : '；恢复实时占用控制'}`,
      { tenantId: b.tenantId, ctx })
    return this.requireBudget(b.id)
  }

  async close(id, note, ctx) {
    const b = this.requireBudget(id)
    if (b.tenantId !== ctx.tenantId) throw new BizError('FORBIDDEN', '预算单不属于当前租户', 403)
    if (!['active', 'frozen'].includes(b.status)) throw new BizError('STATE_DENIED', '仅生效/冻结预算可关闭', 409)
    const row = { ...b, status: 'closed', closedAt: `${this.k.todayDate()} ${this.k.nowTime()}`, reviewNote: (note || '').trim() }
    await this.k.commit([{ type: 'upsert', table: 'budgets', row }])
    await this.audit.log('budget-close', b.id, `关闭预算【${b.name}】（预算期终止，历史台账保留，不再接受新占用）${note ? '；备注：' + note : ''}`,
      { tenantId: b.tenantId, ctx })
    return row
  }

  // 预算调整：运营发起（pending）→ 财务审批通过后调整额度（append-only 保留调整痕迹）
  async requestAdjust(id, delta, reason, ctx) {
    const b = this.requireBudget(id)
    if (b.tenantId !== ctx.tenantId) throw new BizError('FORBIDDEN', '预算单不属于当前租户', 403)
    if (!['active', 'frozen'].includes(b.status)) throw new BizError('STATE_DENIED', '仅生效/冻结预算可申请调整', 409)
    const d = round2(delta)
    if (!(d !== 0)) throw new BizError('BAD_FORM', '调整额度不能为 0')
    if (b.amount + d < 0) throw new BizError('BAD_FORM', '调减后预算额度不能为负')
    if (b.adjustments.some((a) => a.status === 'pending')) throw new BizError('ADJUST_PENDING', '该预算已有待审批调整，请先处理', 409)
    const adj = {
      id: genId('bga'), delta: d, reason: (reason || '').trim(), status: 'pending',
      applicant: ctx.name, applicantId: ctx.memberId || ctx.userId,
      createdAt: this.k.todayDate(), time: this.k.nowTime(), ts: this.k.nowTs(),
      reviewedAt: '', reviewer: '', reviewNote: ''
    }
    if (!adj.reason) throw new BizError('BAD_FORM', '请填写调整事由')
    const row = { ...b, adjustments: [...b.adjustments, adj] }
    await this.k.commit([{ type: 'upsert', table: 'budgets', row }])
    await this.audit.log('budget-adjust-apply', b.id,
      `申请${d > 0 ? '追加' : '调减'}预算【${b.name}】 ${d > 0 ? '+' : ''}${d}${b.unit === 'points' ? ' 积分' : ' 元'}（${b.amount} → ${round2(b.amount + d)}），待财务审批`,
      { tenantId: b.tenantId, ctx })
    return adj
  }

  async reviewAdjust(id, adjustId, approve, note, ctx) {
    const b = this.requireBudget(id)
    if (b.tenantId !== ctx.tenantId) throw new BizError('FORBIDDEN', '预算单不属于当前租户', 403)
    const adj = b.adjustments.find((a) => a.id === adjustId)
    if (!adj) throw new BizError('ADJUST_NOT_FOUND', '预算调整记录不存在', 404)
    if (adj.status !== 'pending') throw new BizError('STATE_DENIED', '该调整已审批', 409)
    const nextAdj = {
      ...adj, status: approve ? 'approved' : 'rejected',
      reviewedAt: `${this.k.todayDate()} ${this.k.nowTime()}`, reviewer: ctx.name, reviewNote: (note || '').trim()
    }
    const amountBefore = b.amount
    const amountAfter = approve ? round2(b.amount + adj.delta) : b.amount
    const row = {
      ...b,
      amount: amountAfter,
      version: b.version + (approve ? 1 : 0),
      adjustments: b.adjustments.map((a) => a.id === adjustId ? nextAdj : a)
    }
    await this.k.commit([{ type: 'upsert', table: 'budgets', row }])
    await this.audit.log(approve ? 'budget-adjust-approve' : 'budget-adjust-reject', b.id,
      `${approve ? '审批通过预算调整' : '驳回预算调整'}【${b.name}】 ${adj.delta > 0 ? '+' : ''}${adj.delta}（${amountBefore} → ${amountAfter}${b.unit === 'points' ? ' 积分' : ' 元'}）${note ? '；意见：' + note : ''}`,
      { tenantId: b.tenantId, ctx })
    return this.requireBudget(b.id)
  }

  // —— 实时占用 ——
  // 预检（不落账）：在业务扣减发生前调用；超预算/预算冻结直接抛错，由上层整笔阻断。
  // 同一笔业务多条占用（抽奖成本 + 积分奖励）按预算汇总后一次性校验。
  guard(items, tenantId) {
    const needByBudget = new Map()
    for (const it of items) {
      const amount = round2(it.amount)
      if (amount <= 0) continue
      const { rows } = this._guardTargets(tenantId, it.scopeType || 'tenant', it.scopeId || tenantId, it.unit)
      for (const b of rows) needByBudget.set(b.id, (needByBudget.get(b.id) || 0) + amount)
    }
    for (const [budgetId, need0] of needByBudget) {
      const need = round2(need0)
      const b = this.k.state.budgets.find((x) => x.id === budgetId)
      if (!b) continue
      if (b.status === 'frozen') {
        throw new BizError('BUDGET_FROZEN', `预算【${b.name}】已冻结，支出被拦截`, 409, { budgetId: b.id })
      }
      if (b.status !== 'active') continue
      const sum = this.summary(b.id)
      if (sum.occupied + need > b.amount + 1e-6) {
        throw new BizError('BUDGET_EXCEEDED',
          `预算【${b.name}】余额不足：需占用 ${need}${b.unit === 'points' ? ' 积分' : ' 元'}，可用 ${round2(b.amount - sum.occupied)}（预算 ${b.amount}，已占用 ${round2(sum.occupied)}）`,
          409, { budgetId: b.id, available: round2(b.amount - sum.occupied), need })
      }
    }
  }

  // 落占用（reserve 预占 / settle 实际成本）。在租户预算锁内核验并落台账，保证并发不超额。
  // item: { unit, amount, scopeType?, scopeId? }；refs: { category, kind, refType, refId, bizNo, summary, traceId, userId, tenantId }
  async occupy(mode, item, refs, ctx) {
    const tenantId = refs.tenantId || ctx.tenantId
    const amount = round2(item.amount)
    if (!amount || amount <= 0) return []
    const scopeType = item.scopeType || 'tenant'
    const scopeId = item.scopeId || tenantId
    const effectBase = `bg-${mode}:${refs.refType}:${refs.refId}`
    return this.withLock(tenantId, async () => {
      // 锁内二次预检（与 guard 同口径），杜绝并发双花预算
      const targets = this._targets(tenantId, scopeType, scopeId, item.unit)
      for (const b of targets.rows) {
        if (b.status === 'frozen') {
          throw new BizError('BUDGET_FROZEN', `预算【${b.name}】已冻结，支出被拦截`, 409, { budgetId: b.id })
        }
        const sum = this.summary(b.id)
        if (sum.occupied + amount > b.amount + 1e-6) {
          throw new BizError('BUDGET_EXCEEDED',
            `预算【${b.name}】余额不足：需占用 ${amount}${b.unit === 'points' ? ' 积分' : ' 元'}，可用 ${round2(b.amount - sum.occupied)}`,
            409, { budgetId: b.id })
        }
      }
      const events = []
      const rows = []
      for (const b of targets.rows) {
        if (this.entryByEffect(`${effectBase}:${b.id}`)) continue // 同业务同预算幂等
        const row = {
          id: genId('bl'),
          budgetId: b.id, bNo: b.bNo,
          tenantId, scopeType: b.scopeType, scopeId: b.scopeId, unit: b.unit,
          category: refs.category, kind: refs.kind,
          direction: mode, converts: false, reserveOf: '',
          amount,
          refType: refs.refType, refId: refs.refId, bizNo: refs.bizNo || '',
          summary: refs.summary || '',
          userId: refs.userId || ctx.userId || '',
          operator: ctx.name || '系统',
          traceId: refs.traceId || '',
          bizDate: this.k.todayDate(), date: this.k.todayDate(), time: this.k.nowTime(), ts: this.k.nowTs(),
          effectId: `${effectBase}:${b.id}`
        }
        events.push({ type: 'insert', table: 'budgetLedger', row })
        rows.push(row)
      }
      if (events.length) await this.k.commit(events)
      return rows
    })
  }

  // 预占 → 实际成本（风控放行）：逐张核销原 reserve 行并追加 converts 的 settle 行
  async settleReserved(refType, refId, refs, ctx) {
    return this._convertReserved(refType, refId, 'settle', refs, ctx)
  }
  // 预占释放（风控撤销 / 采购驳回撤销 / 供应商付款时冲销采购预占）
  async releaseReserved(refType, refId, refs, ctx) {
    return this._convertReserved(refType, refId, 'release', refs, ctx)
  }

  async _convertReserved(refType, refId, direction, refs, ctx) {
    const reserves = this.k.state.budgetLedger.filter(
      (l) => l.direction === 'reserve' && l.refType === refType && l.refId === refId)
    if (!reserves.length) return []
    const tenantId = reserves[0].tenantId || 't-star'
    return this.withLock(tenantId, async () => {
      const events = []
      const out = []
      for (const rv of reserves) {
        const done = this.k.state.budgetLedger.some(
          (l) => l.reserveOf === rv.id && ['settle', 'release'].includes(l.direction))
        if (done) continue
        const b = this.requireBudget(rv.budgetId)
        // 预占核销只是列间腾挪（reserved→committed/release），占用总量不增，无需超额校验；
        // 若预算额度已被调减到小于当前占用，由看板超支告警口径提示。
        const effectId = `bg-${direction}:reserve:${rv.id}`
        if (this.entryByEffect(effectId)) continue
        const row = {
          id: genId('bl'),
          budgetId: b.id, bNo: b.bNo,
          tenantId: rv.tenantId, scopeType: b.scopeType, scopeId: b.scopeId, unit: b.unit,
          category: refs?.category || rv.category, kind: refs?.kind || rv.kind,
          direction, converts: direction === 'settle', reserveOf: rv.id,
          amount: rv.amount,
          refType: refs?.refType || refType, refId: refs?.refId || refId, bizNo: refs?.bizNo || rv.bizNo,
          summary: refs?.summary || rv.summary,
          userId: refs?.userId || rv.userId,
          operator: ctx?.name || rv.operator,
          traceId: refs?.traceId || rv.traceId,
          bizDate: this.k.todayDate(), date: this.k.todayDate(), time: this.k.nowTime(), ts: this.k.nowTs(),
          effectId
        }
        events.push({ type: 'insert', table: 'budgetLedger', row })
        out.push(row)
      }
      if (events.length) await this.k.commit(events)
      return out
    })
  }

  // 已结算成本的冲回（售后拒收/退货按申请时快照返还积分成本）：直接减 committed，append-only
  async refund(item, refs, ctx) {
    const tenantId = refs.tenantId || ctx.tenantId
    const amount = round2(item.amount)
    if (!amount || amount <= 0) return []
    const scopeType = item.scopeType || 'tenant'
    const scopeId = item.scopeId || tenantId
    const effectBase = `bg-refund:${refs.refType}:${refs.refId}`
    return this.withLock(tenantId, async () => {
      const targets = this._targets(tenantId, scopeType, scopeId, item.unit)
      const events = []
      const rows = []
      for (const b of targets.rows) {
        if (this.entryByEffect(`${effectBase}:${b.id}`)) continue
        const row = {
          id: genId('bl'),
          budgetId: b.id, bNo: b.bNo,
          tenantId, scopeType: b.scopeType, scopeId: b.scopeId, unit: b.unit,
          category: refs.category, kind: refs.kind,
          direction: 'refund', converts: false, reserveOf: '',
          amount,
          refType: refs.refType, refId: refs.refId, bizNo: refs.bizNo || '',
          summary: refs.summary || '',
          userId: refs.userId || ctx.userId || '',
          operator: ctx.name || '系统',
          traceId: refs.traceId || '',
          bizDate: this.k.todayDate(), date: this.k.todayDate(), time: this.k.nowTime(), ts: this.k.nowTs(),
          effectId: `${effectBase}:${b.id}`
        }
        events.push({ type: 'insert', table: 'budgetLedger', row })
        rows.push(row)
      }
      if (events.length) await this.k.commit(events)
      return rows
    })
  }

  // 预算占用汇总（纯推导）：reserved 未核销预占；committed 实际成本（settle − 售后退款冲回）
  summary(budgetId) {
    const rows = this.k.state.budgetLedger.filter((l) => l.budgetId === budgetId)
    const convertedIds = new Set(rows.filter((l) => l.reserveOf).map((l) => l.reserveOf))
    let reserved = 0
    let committed = 0
    const byCategory = {}
    for (const l of rows) {
      const cat = byCategory[l.category] || (byCategory[l.category] = { draw: 0, redeem: 0, points: 0, purchase: 0, supplier: 0, reship: 0 })
      if (l.direction === 'reserve' && !convertedIds.has(l.id)) {
        reserved += l.amount
        cat[l.category] = (cat[l.category] || 0) + l.amount
      } else if (l.direction === 'settle') {
        committed += l.amount
        cat[l.category] = (cat[l.category] || 0) + l.amount
      } else if (l.direction === 'refund') {
        committed -= l.amount
        cat[l.category] = (cat[l.category] || 0) - l.amount
      }
    }
    return { reserved: round2(reserved), committed: round2(committed), occupied: round2(reserved + committed), byCategory, rows: rows.length }
  }

  // 预算工作台看板（财务/运营）：待审批、预警、超支
  dashboard(tenantId) {
    const list = this.k.state.budgets.filter(this.inT(tenantId))
    const pending = list.filter((b) => b.status === 'pending').length
    const cards = list.map((b) => ({ id: b.id, status: b.status, unit: b.unit, amount: b.amount, ...this.summary(b.id) }))
    const overrun = cards.filter((c) => ['active', 'frozen'].includes(c.status) && c.occupied > c.amount + 1e-6).length
    const nearWarn = cards.filter((c) => c.status === 'active' && c.occupied <= c.amount + 1e-6 && c.amount > 0 && c.occupied / c.amount >= 0.8).length
    return {
      total: list.length, pending, active: list.filter((b) => b.status === 'active').length,
      frozen: list.filter((b) => b.status === 'frozen').length,
      overrun, nearWarn,
      occupiedPoints: cards.filter((c) => c.unit === 'points').reduce((n, c) => n + c.occupied, 0),
      occupiedMoney: cards.filter((c) => c.unit === 'money').reduce((n, c) => n + c.occupied, 0)
    }
  }
}
