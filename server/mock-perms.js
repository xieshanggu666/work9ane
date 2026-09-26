// 服务端 RBAC 角色目录（与 src/mock/tenant.js 中 ROLE_TEMPLATES / PLATFORM_ROLE 保持同构）
export const ROLE_TEMPLATES = [
  {
    key: 'org_admin', name: '组织管理员', builtin: true, system: true,
    desc: '租户超级管理员：拥有本租户全部运营、风控、物流、卡券、对账、组织与审计权限（不含平台方租户管理）',
    icon: '👑',
    permissions: '*'
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
    desc: '负责实物接单发货、采购分批验收入库（含验收差异登记）、物流轨迹同步与售后审核',
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

export const PLATFORM_ROLE = {
  key: 'platform_admin', name: '平台超级管理员', builtin: true, system: true,
  desc: '平台方：跨全部租户查看运营数据、开通/停用租户、审计全平台链路；不直接参与单租户业务操作',
  icon: '⚙️',
  permissions: '*'
}

export const PERMISSION_LABELS = {
  'activity:manage': '活动管理',
  'points:view': '积分台账查看',
  'risk:review': '风控审核',
  'risk:rule': '风控规则配置',
  'ship:send': '运营接单发货',
  'ship:trace': '物流轨迹同步',
  'aftersale:review': '售后审核',
  'purchase:apply': '发起采购申请',
  'purchase:approve': '采购审批',
  'purchase:inbound': '分批验收入库',
  'budget:manage': '预算编制与调整申请',
  'budget:approve': '预算财务审批',
  'supplier:bill': '发起供应商账单',
  'supplier:review': '供应商账单复核',
  'supplier:settle': '供应商结算付款',
  'coupon:redeem': '卡券核销',
  'recon:run': '执行对账',
  'recon:review': '对账复核',
  'recon:compensate': '对账补偿修正',
  'org:member': '成员账号管理',
  'org:role': '角色权限管理',
  'audit:view': '全链路审计查看',
  'tenant:manage': '租户开通/停用/配置'
}
