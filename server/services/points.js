// 积分服务：按 userId 分户、append-only 流水、单调 ts 与余额快照；
// 扣分预占（frozen）与发奖（reward/release/refund/task-comp/recon-comp）统一走幂等键判重。
import { genId, BizError } from '../util.js'

export class PointsService {
  constructor(k) {
    this.k = k
  }

  balanceOf(userId) {
    return this.k.state.balances[userId] || 0
  }

  // 流水是否已按业务凭证记账（扣分预占/发奖/补偿统一判重，断点重放不重复扣分发奖）
  existsByRef(kind, refId, extra = {}) {
    if (!refId) return false
    return this.k.state.pointFlows.some((p) =>
      p.kind === kind && p.refId === refId &&
      (!extra.userId || p.userId === extra.userId))
  }

  // 记账（调用方需持有 points:<userId> 锁；余额不足直接抛错由上层回滚整笔业务）
  // 返回 { flow, duplicated }：同一 (kind, refId) 命中幂等时返回既有流水、余额不动。
  async post({ userId, delta, note, kind = 'normal', tenantId = '', bizDate, date,
               refId = '', refType = '', traceId = '' }) {
    const d = bizDate || date || this.k.todayDate()
    if (refId && this.existsByRef(kind, refId, { userId })) {
      const flow = this.k.state.pointFlows.find(
        (p) => p.kind === kind && p.refId === refId && p.userId === userId)
      return { flow, duplicated: true }
    }
    if (delta < 0 && this.balanceOf(userId) + delta < 0) {
      throw new BizError('POINTS_NOT_ENOUGH', '积分余额不足', 409, { balance: this.balanceOf(userId), need: -delta })
    }
    const flow = {
      id: genId('pr'),
      userId,
      date: date || this.k.todayDate(),
      bizDate: d,
      tenantId,
      traceId,
      time: this.k.nowTime(),
      delta,
      balance: 0, // 投影时回填，保证快照与分户余额永远一致
      note,
      kind, // normal | frozen | release | refund | reward | task-comp | recon-comp
      refId, refType
    }
    await this.k.commit([{ type: 'points.post', flow, effectId: `points:${kind}:${refId || flow.id}:${userId}` }])
    return { flow: this.k.state.pointFlows.find((f) => f.id === flow.id), duplicated: false }
  }

  flowsOf(userId) {
    return this.k.state.pointFlows
      .filter((p) => p.userId === userId)
      .sort((a, b) => b.ts - a.ts)
  }

  flowsOfTenant(tenantId) {
    return this.k.state.pointFlows
      .filter((p) => (p.tenantId || 't-star') === tenantId)
      .sort((a, b) => a.ts - b.ts)
  }
}
