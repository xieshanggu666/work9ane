// 服务端目录：租户 / 成员（与 src/mock/tenant.js 同构的精简版）
export const TENANTS = [
  {
    id: 't-star',
    name: '星河商贸（上海）有限公司',
    shortName: '星河商贸',
    icon: '🌟',
    plan: '旗舰版',
    status: 'active',
    contact: '王星河',
    phone: '138****8888',
    region: '华东 · 上海',
    createdAt: '2026-01-15'
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
    createdAt: '2026-05-08'
  }
]

export const MEMBERS = [
  { id: 'm-star-admin', tenantId: 't-star', name: '王星河', avatar: '👑', roleKey: 'org_admin', status: 'active', phone: '138****8888', email: 'boss@star.example', ip: '10.10.1.8', joinedAt: '2026-01-15' },
  { id: 'm-star-ops', tenantId: 't-star', name: '运营小张', avatar: '🧑‍💼', roleKey: 'ops_activity', status: 'active', phone: '138****0001', email: 'ops@star.example', ip: '10.10.1.21', joinedAt: '2026-02-01' },
  { id: 'm-star-risk', tenantId: 't-star', name: '风控小赵', avatar: '🕵️', roleKey: 'risk_analyst', status: 'active', phone: '138****0002', email: 'risk@star.example', ip: '10.10.1.33', joinedAt: '2026-02-10' },
  { id: 'm-star-ship', tenantId: 't-star', name: '仓配小李', avatar: '📦', roleKey: 'logistics_clerk', status: 'active', phone: '138****0003', email: 'ship@star.example', ip: '10.10.1.45', joinedAt: '2026-03-01' },
  { id: 'm-star-fin', tenantId: 't-star', name: '财务小周', avatar: '🧮', roleKey: 'finance_auditor', status: 'active', phone: '138****0004', email: 'fin@star.example', ip: '10.10.1.52', joinedAt: '2026-03-12' },
  { id: 'm-star-cs', tenantId: 't-star', name: '客服小吴', avatar: '🎧', roleKey: 'service_readonly', status: 'disabled', phone: '138****0005', email: 'cs@star.example', ip: '10.10.1.60', joinedAt: '2026-04-01', disabledReason: '离职停用' },
  { id: 'm-cloud-admin', tenantId: 't-cloud', name: '陈云雀', avatar: '👑', roleKey: 'org_admin', status: 'active', phone: '139****6666', email: 'boss@cloud.example', ip: '172.16.2.8', joinedAt: '2026-05-08' },
  { id: 'm-cloud-ops', tenantId: 't-cloud', name: '运营小冯', avatar: '🧑‍💻', roleKey: 'ops_activity', status: 'active', phone: '139****6001', email: 'ops@cloud.example', ip: '172.16.2.20', joinedAt: '2026-05-20' },
  { id: 'm-cloud-fin', tenantId: 't-cloud', name: '财务小许', avatar: '🧮', roleKey: 'finance_auditor', status: 'active', phone: '139****6002', email: 'fin@cloud.example', ip: '172.16.2.31', joinedAt: '2026-06-01' }
]

export const PLATFORM_MEMBERS = [
  { id: 'm-platform', tenantId: '', name: '平台超管', avatar: '⚙️', roleKey: 'platform_admin', status: 'active', phone: '100****0000', email: 'admin@platform.example', ip: '192.168.0.1', joinedAt: '2025-12-01' }
]
