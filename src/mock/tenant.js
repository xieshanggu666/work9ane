// 多租户运营与权限中心：租户（组织）、角色（RBAC 权限目录）、成员（员工账号）
// 纯前端演示：平台方 1 个 + 入驻组织（租户）2 个，员工按角色聚合权限，数据按 tenantId 隔离。

// 权限目录（key → 名称 / 所属模块）。模块用于权限中心分组展示与全链路审计归类。
export const PERMISSION_GROUPS = [
  {
    group: '活动与积分',
    icon: '🎡',
    perms: [
      { key: 'activity:manage', name: '活动管理（新建/暂停/重置/删除）' },
      { key: 'points:view', name: '积分流水与任务台账查看' }
    ]
  },
  {
    group: '风控',
    icon: '🛡️',
    perms: [
      { key: 'risk:review', name: '风控审核（放行/撤销）' },
      { key: 'risk:rule', name: '风控规则配置' }
    ]
  },
  {
    group: '采购与库存',
    icon: '🛒',
    perms: [
      { key: 'purchase:apply', name: '发起采购申请（活动奖品/商城商品）' },
      { key: 'purchase:approve', name: '采购审批（通过/驳回）' },
      { key: 'purchase:inbound', name: '分批验收入库（登记验收差异）' },
      { key: 'supplier:bill', name: '发起供应商账单（按采购批次拟单）' },
      { key: 'supplier:review', name: '供应商账单财务复核' },
      { key: 'supplier:settle', name: '供应商结算付款与对账回写' }
    ]
  },
  {
    group: '预算与成本',
    icon: '💰',
    perms: [
      { key: 'budget:manage', name: '预算编制与调整申请（租户/活动预算）' },
      { key: 'budget:approve', name: '预算财务审批（生效/驳回/冻结/关闭）' }
    ]
  },
  {
    group: '物流与售后',
    icon: '📦',
    perms: [
      { key: 'ship:send', name: '运营接单发货' },
      { key: 'ship:trace', name: '物流轨迹同步' },
      { key: 'aftersale:review', name: '售后审核（拒收/退货/补发/缺货继续履约）' }
    ]
  },
  {
    group: '卡券与对账',
    icon: '🎟️',
    perms: [
      { key: 'coupon:redeem', name: '卡券核销' },
      { key: 'recon:run', name: '执行对账' },
      { key: 'recon:review', name: '对账复核' },
      { key: 'recon:compensate', name: '对账补偿修正' }
    ]
  },
  {
    group: '组织与审计',
    icon: '🏢',
    perms: [
      { key: 'org:member', name: '成员账号管理' },
      { key: 'org:role', name: '角色权限管理' },
      { key: 'audit:view', name: '全链路审计查看' }
    ]
  },
  {
    group: '平台方',
    icon: '⚙️',
    perms: [
      { key: 'tenant:manage', name: '租户开通/停用/配置' }
    ]
  }
]

export const PERMISSION_LABELS = PERMISSION_GROUPS.reduce((m, g) => {
  g.perms.forEach((p) => { m[p.key] = p.name })
  return m
}, {})

// 预置角色目录（可在权限中心按租户复制并自定义权限）
// builtin 角色不允许删除/改名；org_admin 为租户管理员，隐式拥有除 tenant:manage 外的全部本租户权限
export const ROLE_TEMPLATES = [
  {
    key: 'org_admin', name: '组织管理员', builtin: true, system: true,
    desc: '租户超级管理员：拥有本租户全部运营、风控、物流、卡券、对账、组织与审计权限（不含平台方租户管理）',
    icon: '👑',
    permissions: '*' // 特殊：除平台方权限外的全部权限
  },
  {
    key: 'ops_activity', name: '活动运营', builtin: true,
    desc: '负责抽奖活动与积分任务运营，可管理活动、发起奖品/商品采购、发起供应商账单、编制预算与调整申请、查看积分台账',
    icon: '🎪',
    permissions: ['activity:manage', 'points:view', 'ship:trace', 'purchase:apply', 'supplier:bill', 'budget:manage']
  },
  {
    key: 'risk_analyst', name: '风控专员', builtin: true,
    desc: '负责风险审核单处理与风控规则配置',
    icon: '🛡️',
    permissions: ['risk:review', 'risk:rule', 'points:view']
  },
  {
    key: 'logistics_clerk', name: '物流客服', builtin: true,
    desc: '负责实物接单发货、采购分批验收入库、物流轨迹同步与售后审核',
    icon: '📦',
    permissions: ['ship:send', 'ship:trace', 'aftersale:review', 'points:view', 'purchase:inbound']
  },
  {
    key: 'finance_auditor', name: '财务对账', builtin: true,
    desc: '负责预算财务审批、采购审批、供应商账单复核与结算、卡券核销、积分库存对账、复核补偿与全链路审计查看（只读业务运营）',
    icon: '🧮',
    permissions: ['coupon:redeem', 'recon:run', 'recon:review', 'recon:compensate', 'audit:view', 'points:view',
      'budget:approve', 'purchase:approve', 'supplier:review', 'supplier:settle']
  },
  {
    key: 'service_readonly', name: '客服（只读）', builtin: true,
    desc: '仅可查看积分台账与同步物流轨迹辅助答疑，不可做任何审核/账务操作',
    icon: '🎧',
    permissions: ['points:view', 'ship:trace']
  }
]

// 平台方（超管）角色：跨租户，含 tenant:manage
export const PLATFORM_ROLE = {
  key: 'platform_admin', name: '平台超级管理员', builtin: true, system: true,
  desc: '平台方：跨全部租户查看运营数据、开通/停用租户、审计全平台链路；不直接参与单租户业务操作',
  icon: '⚙️',
  permissions: '*'
}

// 租户（组织）
export const TENANTS = [
  {
    id: 't-star',
    name: '星河商贸（上海）有限公司',
    shortName: '星河商贸',
    icon: '🌟',
    plan: '旗舰版',
    status: 'active',              // active | suspended
    contact: '王星河',
    phone: '138****8888',
    region: '华东 · 上海',
    createdAt: '2026-01-15',
    modules: ['抽奖活动', '积分中心', '风控申诉', '物流发货', '售后补发', '采购入库', '供应商结算', '预算成本', '卡券核销', '积分库存对账'],
    dataIsolation: '强隔离：活动/库存/单据/卡券/对账按 tenantId 物理标记，查询与操作强制带租户上下文',
    remark: '默认演示租户：全部种子业务数据归属本租户'
  },
  {
    id: 't-cloud',
    name: '云雀数字科技（杭州）有限公司',
    shortName: '云雀数科',
    icon: '🐦',
    plan: '标准版',
    status: 'active',
    contact: '陈云雀',
    phone: '139****6666',
    region: '华东 · 杭州',
    createdAt: '2026-05-08',
    modules: ['抽奖活动', '积分中心', '风控申诉', '物流发货', '售后补发', '采购入库', '供应商结算', '预算成本', '卡券核销', '积分库存对账'],
    dataIsolation: '强隔离：与星河商贸数据互不可见，仅平台方账号可跨租户切换',
    remark: '第二租户：用于演示数据隔离（自有活动/商品/卡券/审核单/发货单）'
  }
]

// 员工成员账号（m-*）；客户（消费者）账号不属于组织成员
// homeTenantId：归属租户；status：active | disabled（停用后登录/操作被拒绝并留痕）
export const MEMBERS = [
  // —— 星河商贸 t-star ——
  { id: 'm-star-admin', tenantId: 't-star', name: '王星河', avatar: '👑', roleKey: 'org_admin', status: 'active', phone: '138****8888', email: 'boss@star.example', ip: '10.10.1.8', joinedAt: '2026-01-15', lastLoginAt: '' },
  { id: 'm-star-ops', tenantId: 't-star', name: '运营小张', avatar: '🧑‍💼', roleKey: 'ops_activity', status: 'active', phone: '138****0001', email: 'ops@star.example', ip: '10.10.1.21', joinedAt: '2026-02-01', lastLoginAt: '' },
  { id: 'm-star-risk', tenantId: 't-star', name: '风控小赵', avatar: '🕵️', roleKey: 'risk_analyst', status: 'active', phone: '138****0002', email: 'risk@star.example', ip: '10.10.1.33', joinedAt: '2026-02-10', lastLoginAt: '' },
  { id: 'm-star-ship', tenantId: 't-star', name: '仓配小李', avatar: '📦', roleKey: 'logistics_clerk', status: 'active', phone: '138****0003', email: 'ship@star.example', ip: '10.10.1.45', joinedAt: '2026-03-01', lastLoginAt: '' },
  { id: 'm-star-fin', tenantId: 't-star', name: '财务小周', avatar: '🧮', roleKey: 'finance_auditor', status: 'active', phone: '138****0004', email: 'fin@star.example', ip: '10.10.1.52', joinedAt: '2026-03-12', lastLoginAt: '' },
  { id: 'm-star-cs', tenantId: 't-star', name: '客服小吴', avatar: '🎧', roleKey: 'service_readonly', status: 'disabled', phone: '138****0005', email: 'cs@star.example', ip: '10.10.1.60', joinedAt: '2026-04-01', lastLoginAt: '2026-09-10 09:20', disabledReason: '离职停用（演示：停用账号尝试登录将被拒绝并审计）' },
  // —— 云雀数科 t-cloud ——
  { id: 'm-cloud-admin', tenantId: 't-cloud', name: '陈云雀', avatar: '👑', roleKey: 'org_admin', status: 'active', phone: '139****6666', email: 'boss@cloud.example', ip: '172.16.2.8', joinedAt: '2026-05-08', lastLoginAt: '' },
  { id: 'm-cloud-ops', tenantId: 't-cloud', name: '运营小冯', avatar: '🧑‍💻', roleKey: 'ops_activity', status: 'active', phone: '139****6001', email: 'ops@cloud.example', ip: '172.16.2.20', joinedAt: '2026-05-20', lastLoginAt: '' },
  { id: 'm-cloud-fin', tenantId: 't-cloud', name: '财务小许', avatar: '🧮', roleKey: 'finance_auditor', status: 'active', phone: '139****6002', email: 'fin@cloud.example', ip: '172.16.2.31', joinedAt: '2026-06-01', lastLoginAt: '' }
]

// 平台方账号（不归属任何租户，可切换租户上下文）
export const PLATFORM_MEMBERS = [
  { id: 'm-platform', tenantId: '', name: '平台超管', avatar: '⚙️', roleKey: 'platform_admin', status: 'active', phone: '100****0000', email: 'admin@platform.example', ip: '192.168.0.1', joinedAt: '2025-12-01', lastLoginAt: '' }
]

// 演示消费者（客户）账号：跨租户参与活动/兑换（平台钱包），按 tenantId 隔离其在各租户的业务
export const CUSTOMER = {
  id: 'u-1001',
  name: '运营测试用户',
  avatar: '🦊',
  homeTenantId: 't-star'
}

// 第二租户（云雀数科）的卡券模板
export const CLOUD_COUPONS = [
  {
    id: 'cc-welcome', name: '云雀新人立减券', type: 'cash',
    emoji: '🐦', denomination: 5, threshold: 0, face: '', validityDays: 20,
    desc: '云雀数科新客专享代金券，0 积分活动奖品'
  },
  {
    id: 'cc-svip', name: '云雀 SVIP 季卡', type: 'voucher',
    emoji: '💎', denomination: 0, threshold: 0, face: '90天会员权益', validityDays: 45,
    desc: '高价值券类奖品，命中风控时预占库存、放行后交付发券'
  }
]
