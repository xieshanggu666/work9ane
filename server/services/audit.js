// 全链路审计服务：append-only 审计日志；一次顶层操作与其级联流水/台账共享 traceId
import { genId } from '../util.js'

const ACTION_LABELS = {
  'login-member': '员工登录', 'login-customer': '消费者切换', 'login-denied': '登录被拒绝',
  'perm-denied': '权限拦截', 'cross-tenant-denied': '越权拦截', 'tenant-denied': '租户不可用',
  'switch-tenant': '租户切换',
  draw: '参与抽奖', redeem: '积分兑换',
  freeze: '风控冻结', release: '审核放行', revoke: '审核撤销', appeal: '用户申诉', config: '规则变更',
  'task-settle': '任务结算',
  'ship-create': '生成发货单', 'ship-address': '填写收货信息', 'ship-send': '运营发货',
  'ship-receive': '确认收货', 'ship-trace': '物流轨迹同步',
  'aftersale-apply': '售后申请', 'aftersale-approve': '售后审核通过', 'aftersale-dismiss': '售后驳回',
  'coupon-issue': '卡券发放', 'coupon-hold': '卡券预占', 'coupon-deliver': '放行发券',
  'coupon-release': '预占释放', 'coupon-redeem': '卡券核销', 'coupon-expire': '卡券到期', 'coupon-comp': '卡券补券',
  'recon-run': '对账执行', 'recon-review': '对账复核', 'recon-comp': '对账补偿',
  'supplier-bill-create': '发起供应商账单', 'supplier-bill-approve': '账单复核通过',
  'supplier-bill-reject': '账单复核驳回', 'supplier-settle': '供应商结算付款',
  'supplier-bill-pending-reship': '账单补发待履约提示', 'supplier-recon-reship': '结算补发对账回写',
  'accept-diff-short': '登记到货短少', 'accept-diff-reject': '登记验退拒收',
  'budget-apply': '编制预算', 'budget-approve': '预算审批通过', 'budget-reject': '预算审批驳回',
  'budget-cancel': '撤销预算', 'budget-freeze': '冻结预算', 'budget-activate': '解冻预算',
  'budget-close': '关闭预算', 'budget-adjust-apply': '预算调整申请', 'budget-adjust-approve': '预算调整通过',
  'budget-adjust-reject': '预算调整驳回',
  'day-rollover': '业务日切换',
  'saga-resume': '故障续办', 'migration-run': '历史台账迁移',
  'activity-create': '新建活动', 'activity-toggle': '活动状态变更'
}

const PREFIX_MODULE = [
  ['login-', 'auth'], ['switch-', 'auth'], ['perm-', 'auth'], ['cross-', 'auth'], ['tenant-', 'auth'],
  ['member-', 'org'], ['role-', 'org'],
  ['freeze', 'risk'], ['release', 'risk'], ['revoke', 'risk'], ['appeal', 'risk'], ['config', 'risk'],
  ['task-settle', 'points'],
  ['ship-', 'ship'], ['aftersale-', 'aftersale'],
  ['accept-', 'purchase'],
  ['budget-', 'budget'],
  ['supplier-', 'supplier'],
  ['coupon-', 'coupon'], ['recon-', 'recon'], ['migration-', 'recon'],
  ['saga-resume', 'system'], ['day-rollover', 'system']
]
function moduleOf(action) {
  const hit = PREFIX_MODULE.find(([p]) => action === p.replace(/-$/, '') || action.startsWith(p))
  return hit ? hit[1] : action === 'draw' ? 'activity' : action === 'redeem' ? 'points' : 'system'
}

export class AuditService {
  constructor(k) {
    this.k = k
  }

  async log(action, orderId, detail, extra = {}) {
    const ctx = extra.ctx
    const member = ctx?.identityKind === 'staff' || ctx?.identityKind === 'platform'
      ? this.k.state.members.find((m) => m.id === ctx.memberId) : null
    const row = {
      id: genId('log'),
      action,
      actionLabel: ACTION_LABELS[action] || action,
      module: extra.module || moduleOf(action),
      orderId: orderId || '',
      operator: extra.operator || (ctx ? this._name(ctx) : '系统'),
      actorKind: ctx?.identityKind || 'system',
      memberId: member?.id || ctx?.memberId || '',
      tenantId: extra.tenantId !== undefined ? (extra.tenantId || '') : (ctx?.tenantId || ''),
      traceId: extra.traceId || '',
      channel: extra.channel || (member ? '运营后台' : ctx?.identityKind === 'customer' ? '移动端 H5' : '系统'),
      ip: extra.ip || ctx?.ip || (member ? '10.0.0.1' : '112.65.*.*'),
      result: extra.result || 'success',
      detail,
      date: extra.date || this.k.todayDate(),
      time: this.k.nowTime(),
      logTs: this.k.nowTs()
    }
    await this.k.commit([{ type: 'insert', table: 'auditLogs', row }])
    return row
  }

  _name(ctx) {
    if (ctx.identityKind === 'platform') return `平台方(${ctx.name})`
    if (ctx.identityKind === 'staff') {
      const t = this.k.state.tenants.find((x) => x.id === ctx.tenantId)
      return `${t?.shortName || '租户'}·${ctx.name}`
    }
    return ctx.name
  }

  // 检索（按租户/模块/结果/traceId/关键词），最新在前
  query(filters = {}) {
    const kw = (filters.keyword || '').trim().toLowerCase()
    return this.k.state.auditLogs
      .filter((l) => {
        if (filters.tenantId && (l.tenantId || 't-star') !== filters.tenantId) return false
        if (filters.module && l.module !== filters.module) return false
        if (filters.result && l.result !== filters.result) return false
        if (filters.traceId && l.traceId !== filters.traceId) return false
        if (kw) {
          const blob = `${l.actionLabel} ${l.detail} ${l.orderId} ${l.operator} ${l.ip} ${l.traceId}`.toLowerCase()
          if (!blob.includes(kw)) return false
        }
        return true
      })
      .sort((a, b) => b.logTs - a.logTs)
  }

  // trace 链路时间线：审计 + 积分流水 + 卡券台账（按时间正序还原）
  timeline(traceId) {
    if (!traceId) return []
    const items = []
    this.k.state.auditLogs.filter((l) => l.traceId === traceId).forEach((l) =>
      items.push({ kind: 'audit', ts: l.logTs, label: l.actionLabel, operator: l.operator,
        tenantId: l.tenantId, detail: l.detail, result: l.result }))
    this.k.state.pointFlows.filter((p) => p.traceId === traceId).forEach((p) =>
      items.push({ kind: 'points', ts: p.ts, label: '积分流水', operator: p.note,
        tenantId: p.tenantId, detail: `${p.note}（${p.delta > 0 ? '+' : ''}${p.delta}，余额 ${p.balance}）`, result: 'success' }))
    this.k.state.couponLogs.filter((p) => p.traceId === traceId).forEach((p) =>
      items.push({ kind: 'coupon', ts: p.ts, label: p.actionLabel, operator: p.operator,
        tenantId: p.tenantId, detail: `${p.tplName} ${p.code} ${p.note}`.trim(), result: 'success' }))
    return items.sort((a, b) => a.ts - b.ts)
  }
}
