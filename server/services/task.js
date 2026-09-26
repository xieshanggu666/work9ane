// 抽奖任务自动结算服务：进度唯一来源于真实参与记录（normal/released 计入，frozen 暂缓，revoked 不计）；
// 同一（任务 × 用户 × 归属业务日）以 taskClaims 台账幂等判重，只发一次奖；跨日放行按 bizDate 补计、grantDate 留痕。
// 多用户：进度/领奖台账按 userId 隔离，支持多用户并发结算互不串账。
import { genId, BizError } from '../util.js'

export class TaskService {
  constructor(k, audit, points, budget) {
    this.k = k
    this.audit = audit
    this.points = points
    this.budget = budget
  }

  // 手动任务领奖（签到/浏览等非抽奖任务；按 任务×用户×业务日 幂等，只发一次）
  async claim(taskId, ctx) {
    const t = this.k.state.tasks.find((x) => x.id === taskId)
    if (!t) throw new BizError('TASK_NOT_FOUND', '任务不存在', 404)
    if (t.metric === 'draw') {
      throw new BizError('TASK_AUTO_ONLY', '抽奖任务按真实参与记录自动结算，达标后自动发奖', 409)
    }
    const date = this.k.todayDate()
    const tenantId = ctx.tenantId
    const claimKey = `${taskId}:${date}:${ctx.userId}`
    const dup = this.k.state.taskClaims.find((c) => c.refKey === claimKey)
    if (dup) return { claim: dup, idempotent: true }
    if (this.budget) {
      this.budget.guard(
        [{ unit: 'points', amount: t.reward, scopeType: 'tenant', scopeId: tenantId, category: 'points', kind: 'task-reward' }],
        tenantId)
    }
    const claimId = genId('tc')
    const { flow } = await this.points.post({
      userId: ctx.userId, delta: t.reward, note: `完成任务：${t.label}`,
      kind: 'reward', tenantId, bizDate: date,
      refId: claimId, refType: 'task-manual', traceId: ''
    })
    const claim = {
      id: claimId, refKey: claimKey,
      taskId: t.id, taskLabel: t.label, reward: t.reward,
      userId: ctx.userId, tenantId,
      bizDate: date, grantDate: date,
      time: this.k.nowTime(), ts: this.k.nowTs(),
      source: 'manual', flowId: flow.id
    }
    await this.k.commit([{ type: 'insert', table: 'taskClaims', row: claim }])
    if (this.budget) {
      await this.budget.occupy('settle',
        { unit: 'points', amount: t.reward, scopeType: 'tenant', scopeId: tenantId },
        {
          category: 'points', kind: 'task-reward', refType: 'task-manual', refId: claimId,
          bizNo: t.label, summary: `任务奖励：${t.label} +${t.reward} 积分`,
          tenantId, userId: ctx.userId
        },
        ctx)
    }
    await this.audit.log('task-settle', claimId, `完成手动任务【${t.label}】，发放 ${t.reward} 积分`,
      { tenantId, ctx })
    return { claim, idempotent: false }
  }

  // 某用户当日手动任务领取状态（前端水合用）
  manualStateOf(userId, bizDate = this.k.todayDate()) {
    const map = {}
    this.k.state.tasks.filter((t) => t.metric !== 'draw').forEach((t) => {
      const key = `${t.id}:${bizDate}:${userId}`
      map[t.id] = !!this.k.state.taskClaims.find((c) => c.refKey === key ||
        (c.taskId === t.id && c.userId === userId && c.bizDate === bizDate && c.source === 'manual'))
    })
    return map
  }

  validDrawCount(bizDate, tenantId, userId) {
    return this.k.state.records.filter(
      (r) => r.type === 'draw' && r.date === bizDate && (r.tenantId || 't-star') === tenantId &&
        r.userId === userId && ['normal', 'released'].includes(r.status)
    ).length
  }

  pendingDrawCount(bizDate, tenantId, userId) {
    return this.k.state.records.filter(
      (r) => r.type === 'draw' && r.date === bizDate && r.status === 'frozen' &&
        (r.tenantId || 't-star') === tenantId && r.userId === userId
    ).length
  }

  // 结算指定用户在指定业务日的全部抽奖任务（幂等）。返回新结算的台账。
  async settle(bizDate, tenantId, userId, traceId = '') {
    const date = bizDate || this.k.todayDate()
    const drawTasks = this.k.state.tasks.filter((t) => t.metric === 'draw' && t.type === 'daily')
    if (!drawTasks.length) return []
    const valid = this.validDrawCount(date, tenantId, userId)
    const settled = []
    for (const t of drawTasks) {
      if (valid < t.goal) continue
      if (this.k.state.taskClaims.some(
        (c) => c.taskId === t.id && c.bizDate === date && (c.tenantId || 't-star') === tenantId && c.userId === userId
      )) continue
      const crossDay = date !== this.k.todayDate()
      const claimId = genId('tc')
      const { flow } = await this.points.post({
        userId,
        delta: t.reward,
        note: `任务结算：${t.label}${crossDay ? `（${date} 业务日补计）` : ''}`,
        kind: 'reward', tenantId, bizDate: date,
        refId: claimId, refType: 'task-claim', traceId
      })
      const claim = {
        id: claimId,
        taskId: t.id, taskLabel: t.label, reward: t.reward,
        userId,
        tenantId,
        bizDate: date,
        grantDate: this.k.todayDate(),
        time: this.k.nowTime(), ts: this.k.nowTs(),
        source: 'auto', flowId: flow.id
      }
      await this.k.commit([{ type: 'insert', table: 'taskClaims', row: claim }])
      // 营销预算占用：任务积分奖励实时占用租户积分预算（按台账 id 幂等，重跑/跨日补计不重复占用）
      if (this.budget) {
        await this.budget.occupy('settle',
          { unit: 'points', amount: t.reward, scopeType: 'tenant', scopeId: tenantId },
          {
            category: 'points', kind: 'task-reward',
            refType: 'task-claim', refId: claimId, bizNo: t.label,
            summary: `任务奖励：${t.label} +${t.reward} 积分`,
            tenantId, userId, traceId
          },
          { name: '系统', userId, tenantId })
      }
      await this.audit.log('task-settle', '',
        `【${this.k.state.tenants.find((x) => x.id === tenantId)?.shortName || tenantId}】用户【${userId}】抽奖任务【${t.label}】达成（${date} 有效参与 ${valid}/${t.goal}），自动发放 ${t.reward} 积分${crossDay ? '（跨日审核补计）' : ''}`,
        { tenantId, traceId })
      settled.push(claim)
    }
    return settled
  }
}
