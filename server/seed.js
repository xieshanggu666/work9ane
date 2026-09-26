// 服务端原生种子：多租户活动/商品/卡券/组织成员，以及多用户积分账户。
import { ACTIVITIES } from './mock-activities.js'
import { CLOUD_ACTIVITIES, CLOUD_GOODS, CLOUD_COUPONS } from './mock-cloud.js'
import { SHOP_GOODS } from './mock-shop.js'
import { COUPONS, TASKS } from './mock-activities.js'
import { TENANTS, MEMBERS, PLATFORM_MEMBERS } from './mock-org.js'

export function buildSeed() {
  const activities = [
    ...ACTIVITIES.map((a) => ({ ...JSON.parse(JSON.stringify(a)), tenantId: 't-star', prizes: a.prizes.map((p) => ({ ...p, frozen: p.frozen || 0 })) })),
    ...CLOUD_ACTIVITIES.map((a) => ({ ...JSON.parse(JSON.stringify(a)), tenantId: 't-cloud', prizes: a.prizes.map((p) => ({ ...p, frozen: p.frozen || 0 })) }))
  ]
  const goods = [
    ...SHOP_GOODS.map((g) => ({ ...g, frozen: 0, tenantId: 't-star' })),
    ...CLOUD_GOODS.map((g) => ({ ...g, frozen: 0, tenantId: 't-cloud' }))
  ]
  // 营销预算种子（审批通过即生效，参与实时占用控制；额度按演示压测留足余量）
  const bg = (id, tenantId, scopeType, scopeId, scopeName, unit, amount, extra = {}) => ({
    id, bNo: 'BG' + id.toUpperCase().replace(/-/g, ''), tenantId, scopeType, scopeId, scopeName, unit,
    name: extra.name || (scopeType === 'activity' ? `活动预算：${scopeName}` : `${scopeName}${unit === 'points' ? '积分' : '营销资金'}预算`),
    purpose: extra.purpose || '年度营销预算（种子）',
    amount, startDate: '2026-01-01', endDate: '2026-12-31',
    status: extra.status || 'active',
    applicant: extra.applicant || '运营小张', applicantId: extra.applicantId || 'm-star-ops',
    createdAt: '2026-01-05', time: '10:00:00', ts: Date.parse('2026-01-05T10:00:00'),
    reviewedAt: extra.status === 'pending' ? '' : '2026-01-06 09:30:00',
    reviewer: extra.status === 'pending' ? '' : (extra.reviewer || '财务小周'),
    reviewNote: extra.reviewNote || '', frozenAt: '', closedAt: '',
    adjustments: [], version: 1, parentId: ''
  })
  const budgets = [
    bg('bg-star-pt', 't-star', 'tenant', 't-star', '星河商贸', 'points', 200000),
    bg('bg-star-mn', 't-star', 'tenant', 't-star', '星河商贸', 'money', 50000),
    bg('bg-star-a1p', 't-star', 'activity', 'act-1', '周年庆幸运转盘', 'points', 5000),
    bg('bg-star-a1m', 't-star', 'activity', 'act-1', '周年庆幸运转盘', 'money', 30000),
    bg('bg-star-a2p', 't-star', 'activity', 'act-2', '新人刮刮乐', 'points', 3000),
    bg('bg-star-a2m', 't-star', 'activity', 'act-2', '新人刮刮乐', 'money', 5000),
    bg('bg-star-nd', 't-star', 'tenant', 't-star', '星河商贸', 'money', 20000,
      { status: 'pending', name: '国庆大促追加预算（待审批）', purpose: '国庆档加码投放申请', reviewedAt: '', reviewer: '' }),
    bg('bg-cloud-pt', 't-cloud', 'tenant', 't-cloud', '云雀数科', 'points', 50000,
      { applicant: '运营小冯', applicantId: 'm-cloud-ops', reviewer: '财务小许' }),
    bg('bg-cloud-mn', 't-cloud', 'tenant', 't-cloud', '云雀数科', 'money', 10000,
      { applicant: '运营小冯', applicantId: 'm-cloud-ops', reviewer: '财务小许' }),
    bg('bg-cloud-a1p', 't-cloud', 'activity', 'cact-1', '云雀上线幸运转盘', 'points', 3000,
      { applicant: '运营小冯', applicantId: 'm-cloud-ops', reviewer: '财务小许' }),
    bg('bg-cloud-a1m', 't-cloud', 'activity', 'cact-1', '云雀上线幸运转盘', 'money', 8000,
      { applicant: '运营小冯', applicantId: 'm-cloud-ops', reviewer: '财务小许' })
  ]
  return {
    tenants: TENANTS.map((t) => ({ ...t })),
    members: [...PLATFORM_MEMBERS, ...MEMBERS].map((m) => ({ ...m })),
    customRoles: [],
    activities,
    goods,
    tasks: TASKS.map((t) => ({ ...t })),
    couponTpls: [...COUPONS, ...CLOUD_COUPONS].map((c) => ({ ...c })),
    budgets,
    // 多用户积分账户：演示用户 + 两个并发压测用户
    balances: { 'u-1001': 1000, 'u-1002': 500, 'u-1003': 500 }
  }
}

export const DEMO_USERS = [
  { id: 'u-1001', name: '运营测试用户', avatar: '🦊' },
  { id: 'u-1002', name: '并发用户乙', avatar: '🐼' },
  { id: 'u-1003', name: '并发用户丙', avatar: '🐨' }
]
