// 租户鉴权服务：会话 token、身份（customer/staff/platform）、RBAC 权限位、租户归属强校验
import { genId, BizError } from '../util.js'
import { ROLE_TEMPLATES, PLATFORM_ROLE } from '../mock-perms.js'

export class AuthService {
  constructor(k, audit) {
    this.k = k
    this.audit = audit
    this.sessions = new Map() // token -> { identityKind, memberId, userId, tenantId, ip, channel }
  }

  get members() { return this.k.state.members }
  get tenants() { return this.k.state.tenants }

  // 客户登录（token 直接代表某消费者 + 当前逛店租户）
  loginCustomer(userId, name, { tenantId, ip = '112.65.0.1', channel = '移动端H5' } = {}) {
    const tid = tenantId || 't-star'
    const t = this.tenants.find((x) => x.id === tid)
    if (!t || t.status !== 'active') throw new BizError('TENANT_UNAVAILABLE', '租户不存在或已停用', 403)
    const token = genId('tok')
    const session = { token, identityKind: 'customer', memberId: '', userId, name, tenantId: tid, ip, channel }
    this.sessions.set(token, session)
    this.audit.log('login-customer', '', `消费者登录：${name}，数据上下文 ${t.shortName}`,
      { tenantId: tid, ctx: session, result: 'success', module: 'auth' })
    return { token, session }
  }

  // 员工/平台登录：停用账号拒绝并写 denied 审计；员工锁定归属租户
  async loginMember(memberId, { ip = '10.0.0.1', channel = '运营后台' } = {}) {
    const m = this.members.find((x) => x.id === memberId)
    if (!m) {
      await this.audit.log('login-denied', '', `⛔ 成员 ${memberId} 不存在，登录被拒绝`,
        { tenantId: '', ctx: { identityKind: 'anonymous', ip, channel }, result: 'denied', module: 'auth' })
      throw new BizError('LOGIN_DENIED', '成员不存在，登录被拒绝', 403)
    }
    if (m.status !== 'active') {
      await this.audit.log('login-denied', m.id, `⛔ 停用账号【${m.name}】尝试登录被拒绝（${m.disabledReason || '账号已停用'}）`,
        { tenantId: m.tenantId || '', ctx: { identityKind: 'anonymous', memberId: m.id, ip, channel }, result: 'denied', module: 'auth' })
      throw new BizError('LOGIN_DENIED', `账号已停用：${m.disabledReason || '请联系管理员'}`, 403, { memberId: m.id })
    }
    const token = genId('tok')
    const session = {
      token, identityKind: m.tenantId ? 'staff' : 'platform',
      memberId: m.id, userId: m.id, name: m.name,
      tenantId: m.tenantId || '', ip, channel
    }
    this.sessions.set(token, session)
    const role = this.roleOf(m.roleKey)
    this.audit.log('login-member', m.id,
      `员工登录：${m.name}（${role?.name || m.roleKey}）进入${m.tenantId ? '本租户数据上下文' : '平台方跨租户视图'}，IP ${ip}`,
      { tenantId: m.tenantId || '', ctx: session, module: 'auth' })
    return { token, session }
  }

  logout(token) { this.sessions.delete(token) }
  requireSession(token) {
    const s = this.sessions.get(token)
    if (!s) throw new BizError('UNAUTHORIZED', '未登录或会话已失效', 401)
    return s
  }
  memberOf(session) {
    return session.memberId ? this.members.find((m) => m.id === session.memberId) : null
  }
  roleOf(key) {
    return [PLATFORM_ROLE, ...ROLE_TEMPLATES, ...this.k.state.customRoles].find((r) => r.key === key) || null
  }
  actorName(session) {
    if (session.identityKind === 'platform') return `平台方(${session.name})`
    if (session.identityKind === 'staff') {
      const t = this.tenants.find((x) => x.id === session.tenantId)
      return `${t?.shortName || '租户'}·${session.name}`
    }
    return session.name
  }

  // —— RBAC 权限判定（与前端 store 同口径）——
  can(session, perm) {
    if (!session) return false
    if (session.identityKind === 'platform') return true
    if (session.identityKind !== 'staff') return false
    const m = this.memberOf(session)
    if (!m || m.status !== 'active') return false
    if (m.roleKey === 'org_admin') return perm !== 'tenant:manage'
    const role = [PLATFORM_ROLE, ...ROLE_TEMPLATES, ...this.k.state.customRoles].find((r) => r.key === m.roleKey)
    if (!role) return false
    if (role.permissions === '*') return perm !== 'tenant:manage'
    return (role.permissions || []).includes(perm)
  }

  // 权限校验 + 拒绝留痕（业务零变更）
  async requirePerm(session, perm, module = 'system', label = perm) {
    if (this.can(session, perm)) return true
    const who = session.identityKind === 'customer'
      ? '消费者身份'
      : `当前角色【${this.roleOf(this.memberOf(session)?.roleKey || '')?.name || '未知'}】`
    await this.deny(session, 'perm-denied', `${who}无「${label}」权限，操作已被拦截`, { module, perm, tenantId: session.tenantId })
    throw new BizError('PERM_DENIED', `${who}无权限：${label}`, 403)
  }

  // 租户数据归属：员工只能操作本租户；平台方任意；客户数据由 userId 校验负责
  async requireSameTenant(session, tenantId, module = 'system') {
    if (session.identityKind === 'platform') return true
    if (session.identityKind !== 'staff') return true
    const m = this.memberOf(session)
    if (m && m.tenantId === (tenantId || session.tenantId)) return true
    await this.deny(session, 'cross-tenant-denied',
      `越权访问其他租户数据被拦截（${m?.name || '员工'} 归属 ${session.tenantId}）`, { module, tenantId })
    throw new BizError('CROSS_TENANT', '越权访问其他租户数据', 403)
  }

  // 客户切换"逛店"租户
  async switchTenant(session, tenantId) {
    const t = this.tenants.find((x) => x.id === tenantId)
    if (!t || t.status !== 'active') {
      await this.deny(session, 'tenant-denied', `租户不可用（${t?.name || tenantId}），切换被拒绝`, { module: 'auth' })
      throw new BizError('TENANT_UNAVAILABLE', '租户不可用', 403)
    }
    if (session.identityKind === 'staff' && this.memberOf(session)?.tenantId !== tenantId) {
      await this.deny(session, 'cross-tenant-denied',
        `员工【${session.name}】尝试切换至非归属租户【${t.name}】被拒绝（数据强隔离）`, { module: 'auth' })
      throw new BizError('CROSS_TENANT', '员工仅可访问归属租户', 403)
    }
    session.tenantId = tenantId
    this.audit.log('switch-tenant', '',
      `${session.identityKind === 'platform' ? '平台方' : session.identityKind === 'staff' ? '员工' : '消费者'}切换数据上下文至 ${t.shortName}`,
      { tenantId, ctx: session, module: 'auth' })
    return true
  }

  async deny(session, action, detail, extra = {}) {
    await this.audit.log(action, extra.orderId || '', `⛔ ${detail}`, {
      ...extra,
      tenantId: extra.tenantId !== undefined ? extra.tenantId : session.tenantId,
      ctx: session, result: 'denied'
    })
  }
}
