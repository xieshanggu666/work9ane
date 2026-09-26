// 组织与活动运营服务：租户开通/停用、成员 CRUD/调岗、自定义角色 CRUD、活动启停/重置库存/删除。
// 所有写操作：RBAC 已在 HTTP 层门禁；此处再做租户归属校验 + upsert/insert 事件入 WAL（随重放恢复）+ 审计留痕。
import { genId, BizError } from '../util.js'

export class OrgService {
  constructor(k, audit) {
    this.k = k
    this.audit = audit
  }

  // —— 租户（平台方 tenant:manage）——
  async createTenant(form, ctx) {
    const name = (form.name || '').trim()
    if (!name) throw new BizError('BAD_FORM', '请填写组织名称')
    const id = form.id || `t-${Date.now().toString(36)}`
    if (this.k.state.tenants.some((t) => t.id === id)) {
      throw new BizError('TENANT_EXISTS', '租户 id 已存在', 409)
    }
    const today = this.k.todayDate()
    const tenant = {
      id, name,
      shortName: (form.shortName || '').trim() || name,
      icon: form.icon || '🏢',
      plan: form.plan || '标准版',
      status: 'active',
      contact: (form.contact || '').trim(),
      phone: (form.phone || '').trim(),
      region: (form.region || '').trim(),
      createdAt: today,
      modules: form.modules || ['抽奖活动', '积分中心', '风控申诉', '物流发货', '卡券核销', '积分库存对账'],
      dataIsolation: '强隔离：数据按 tenantId 物理标记，仅本租户成员与平台方可访问',
      remark: (form.remark || '').trim()
    }
    await this.k.commit([{ type: 'upsert', table: 'tenants', row: tenant }])
    // 新租户独立默认风控规则副本（在 http 层由 risk 服务写入或调用方注入）
    if (form.rules) await this.k.commit([{ type: 'risk-rules.put', tenantId: id, rules: form.rules }])
    // 开通即创建组织管理员
    const admin = {
      id: genId('m'), tenantId: id, name: form.contact || `${tenant.shortName}管理员`, avatar: '👑',
      roleKey: 'org_admin', status: 'active', phone: form.phone || '', email: '',
      ip: '10.0.0.1', joinedAt: today, lastLoginAt: ''
    }
    await this.k.commit([{ type: 'insert', table: 'members', row: admin }])
    await this.audit.log('tenant-create', id,
      `平台开通租户【${tenant.shortName}】（${tenant.plan}），联系人 ${admin.name}，数据强隔离生效`,
      { tenantId: id, ctx })
    return { tenant, admin }
  }

  requireTenant(id) {
    const t = this.k.state.tenants.find((x) => x.id === id)
    if (!t) throw new BizError('TENANT_NOT_FOUND', '租户不存在', 404)
    return t
  }

  async toggleTenant(id, _reason, ctx) {
    const t = this.requireTenant(id)
    t.status = t.status === 'active' ? 'suspended' : 'active'
    await this.k.commit([{ type: 'upsert', table: 'tenants', row: { ...t } }])
    await this.audit.log('tenant-toggle', id,
      `平台${t.status === 'suspended' ? '停用' : '恢复启用'}租户【${t.shortName}】（停用后该租户成员登录被拒绝）`,
      { tenantId: id, ctx, result: t.status === 'suspended' ? 'denied' : 'success' })
    return t
  }

  async updateTenant(id, patch, ctx) {
    const t = this.requireTenant(id)
    const allow = ['shortName', 'name', 'icon', 'plan', 'contact', 'phone', 'region', 'remark', 'modules']
    const next = { ...t }
    allow.forEach((k) => { if (patch[k] !== undefined) next[k] = patch[k] })
    await this.k.commit([{ type: 'upsert', table: 'tenants', row: next }])
    await this.audit.log('tenant-update', id, `租户【${next.shortName}】配置变更：${Object.keys(patch).join('、')}`,
      { tenantId: id, ctx })
    return next
  }

  // —— 成员（org:member；仅本租户）——
  _requireMember(id) {
    const m = this.k.state.members.find((x) => x.id === id)
    if (!m) throw new BizError('MEMBER_NOT_FOUND', '成员不存在', 404)
    return m
  }

  async createMember(form, ctx) {
    const tenantId = form.tenantId || ctx.tenantId
    if (ctx.identityKind === 'staff' && tenantId !== ctx.tenantId) {
      throw new BizError('CROSS_TENANT', '仅可在归属租户内创建成员', 403)
    }
    const name = (form.name || '').trim()
    if (!name) throw new BizError('BAD_FORM', '请填写成员姓名')
    if (!form.roleKey) throw new BizError('BAD_FORM', '请选择角色')
    const member = {
      id: genId('m'), tenantId, name,
      avatar: form.avatar || '🧑‍💼', roleKey: form.roleKey, status: 'active',
      phone: (form.phone || '').trim(), email: (form.email || '').trim(),
      ip: form.ip || `10.${10 + Math.floor(Math.random() * 240)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`,
      joinedAt: this.k.todayDate(), lastLoginAt: ''
    }
    await this.k.commit([{ type: 'insert', table: 'members', row: member }])
    await this.audit.log('member-create', member.id,
      `新增成员【${name}】角色「${form.roleKey}」归属 ${this.k.state.tenants.find((t) => t.id === tenantId)?.shortName || tenantId}`,
      { tenantId, ctx })
    return member
  }

  async updateMember(id, patch, ctx) {
    const m = this._requireMember(id)
    if (ctx.identityKind === 'staff' && m.tenantId !== ctx.tenantId) {
      throw new BizError('CROSS_TENANT', '越权访问其他租户成员', 403)
    }
    const next = { ...m }
    ;['name', 'avatar', 'phone', 'email'].forEach((k) => { if (patch[k] !== undefined) next[k] = patch[k] })
    await this.k.commit([{ type: 'upsert', table: 'members', row: next }])
    await this.audit.log('member-update', id, `编辑成员【${next.name}】资料`, { tenantId: m.tenantId, ctx })
    return next
  }

  async assignMemberRole(id, roleKey, ctx) {
    const m = this._requireMember(id)
    if (ctx.identityKind === 'staff' && m.tenantId !== ctx.tenantId) {
      throw new BizError('CROSS_TENANT', '越权访问其他租户成员', 403)
    }
    if (!roleKey || roleKey === 'platform_admin') throw new BizError('BAD_FORM', '角色无效或不可分配')
    const next = { ...m, roleKey }
    await this.k.commit([{ type: 'upsert', table: 'members', row: next }])
    await this.audit.log('member-role', id, `成员【${m.name}】调岗：${m.roleKey} → ${roleKey}`,
      { tenantId: m.tenantId, ctx })
    return next
  }

  async toggleMember(id, reason, ctx) {
    const m = this._requireMember(id)
    if (ctx.identityKind === 'staff' && m.tenantId !== ctx.tenantId) {
      throw new BizError('CROSS_TENANT', '越权访问其他租户成员', 403)
    }
    if (m.id === ctx.memberId) throw new BizError('SELF_TOGGLE', '不能停用当前登录账号', 409)
    const toDisable = m.status === 'active'
    const next = {
      ...m,
      status: toDisable ? 'disabled' : 'active',
      disabledReason: toDisable ? ((reason || '').trim() || '管理员手动停用') : ''
    }
    await this.k.commit([{ type: 'upsert', table: 'members', row: next }])
    await this.audit.log('member-toggle', id, `${toDisable ? '停用' : '启用'}成员【${m.name}】`,
      { tenantId: m.tenantId, ctx, result: toDisable ? 'denied' : 'success' })
    return next
  }

  // —— 自定义角色（org:role；仅本租户）——
  _requireRole(roleId) {
    const r = this.k.state.customRoles.find((x) => x.id === roleId)
    if (!r) throw new BizError('ROLE_NOT_FOUND', '自定义角色不存在', 404)
    return r
  }

  async createRole(form, ctx) {
    const tenantId = ctx.tenantId
    const name = (form.name || '').trim()
    if (!name) throw new BizError('BAD_FORM', '请填写角色名称')
    const role = {
      id: genId('cr'), tenantId, key: `cr_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e4).toString(36)}`,
      name, icon: form.icon || '🛠️', builtin: false,
      desc: (form.desc || '').trim() || '租户自定义角色',
      permissions: [...new Set(form.permissions || [])].filter((p) => p !== 'tenant:manage')
    }
    await this.k.commit([{ type: 'insert', table: 'customRoles', row: role }])
    await this.audit.log('role-create', role.id,
      `【${ctx.tenantId}】新建自定义角色【${name}】，权限 ${role.permissions.length} 项`,
      { tenantId, ctx })
    return role
  }

  async updateRolePermissions(roleId, permissions, ctx) {
    const r = this._requireRole(roleId)
    if (ctx.identityKind === 'staff' && r.tenantId !== ctx.tenantId) {
      throw new BizError('CROSS_TENANT', '越权访问其他租户角色', 403)
    }
    const next = {
      ...r,
      permissions: [...new Set(permissions || [])].filter((p) => p !== 'tenant:manage')
    }
    await this.k.commit([{ type: 'upsert', table: 'customRoles', row: next }])
    await this.audit.log('role-update', roleId, `角色【${r.name}】权限变更为 ${next.permissions.length} 项`,
      { tenantId: r.tenantId, ctx })
    return next
  }

  async deleteRole(roleId, ctx) {
    const r = this._requireRole(roleId)
    if (ctx.identityKind === 'staff' && r.tenantId !== ctx.tenantId) {
      throw new BizError('CROSS_TENANT', '越权访问其他租户角色', 403)
    }
    if (this.k.state.members.some((m) => m.roleKey === r.key)) {
      throw new BizError('ROLE_IN_USE', '角色仍有成员使用，请先调岗', 409)
    }
    const rest = this.k.state.customRoles.filter((x) => x.id !== roleId)
    // 内核仅支持 upsert/insert；删除以一次性「replace 表」语义事件由 apply 不支持，
    // 改为给该行打 deleted 墓碑标记（重放后查询过滤），保留 append-only 审计语义。
    const next = { ...r, deleted: true, deletedAt: this.k.todayDate() }
    await this.k.commit([{ type: 'upsert', table: 'customRoles', row: next }])
    void rest
    await this.audit.log('role-delete', roleId, `删除自定义角色【${r.name}】（墓碑保留）`,
      { tenantId: r.tenantId, ctx })
    return { ok: true }
  }

  // —— 活动运营（activity:manage）——
  _requireActivity(id, ctx) {
    const a = this.k.state.activities.find((x) => x.id === id)
    if (!a) throw new BizError('ACTIVITY_NOT_FOUND', '活动不存在', 404)
    if (ctx.identityKind === 'staff' && a.tenantId !== ctx.tenantId) {
      throw new BizError('CROSS_TENANT', '越权访问其他租户活动', 403)
    }
    return a
  }

  async toggleActivity(id, ctx) {
    const a = this._requireActivity(id, ctx)
    const map = { running: 'paused', paused: 'running', ended: 'running' }
    const next = { ...a, status: map[a.status] || 'running' }
    await this.k.commit([{ type: 'upsert', table: 'activities', row: next }])
    await this.audit.log('activity-toggle', id,
      `活动【${a.name}】状态变更为${next.status === 'running' ? '运行中' : next.status === 'paused' ? '已暂停' : '已结束'}`,
      { tenantId: a.tenantId, ctx })
    return next
  }

  async resetActivityStock(id, ctx) {
    const a = this._requireActivity(id, ctx)
    const next = {
      ...a,
      prizes: a.prizes.map((p) => ({ ...p, remain: p.stock - (p.frozen || 0) }))
    }
    await this.k.commit([{ type: 'upsert', table: 'activities', row: next }])
    await this.audit.log('activity-stock-reset', id, `活动【${a.name}】奖品库存重置（风控预占保留）`,
      { tenantId: a.tenantId, ctx })
    return next
  }

  async deleteActivity(id, ctx) {
    const a = this._requireActivity(id, ctx)
    // append-only：打墓碑标记，历史业务记录保留
    const next = { ...a, deleted: true, status: 'ended', deletedAt: this.k.todayDate() }
    await this.k.commit([{ type: 'upsert', table: 'activities', row: next }])
    await this.audit.log('activity-delete', id, `删除活动【${a.name}】（配置删除，历史业务记录保留）`,
      { tenantId: a.tenantId, ctx })
    return { ok: true }
  }
}
