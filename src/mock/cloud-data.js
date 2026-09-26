// 第二租户（云雀数科 t-cloud）业务 mock：活动 / 商品
// 与星河商贸数据完全独立，用于演示租户数据隔离。仅含零积分成本活动与零/有积分商品，
// 种子业务不制造积分流水（消费者积分钱包属于平台侧跨租户余额，仅 t-star 种子参与余额链）。
export const CLOUD_ACTIVITIES = [
  {
    id: 'cact-1',
    name: '云雀上线幸运转盘',
    type: 'wheel',
    status: 'running',
    cost: 0,
    dailyLimit: 5,
    totalLimit: 30,
    costType: 'free',
    icon: '🐦',
    desc: '云雀数科开业回馈，免费转盘，奖品为自有数字权益',
    startAt: '2026-09-12',
    endAt: '2026-10-12',
    prizes: [
      { id: 'cp1', name: '云雀 SVIP 季卡', rarity: 'legendary', stock: 3, remain: 3, weight: 1, emoji: '💎', physical: false, couponId: 'cc-svip', unitPrice: 68 },
      { id: 'cp2', name: '云雀新人立减券', rarity: 'epic', stock: 80, remain: 80, weight: 10, emoji: '🐦', physical: false, couponId: 'cc-welcome', unitPrice: 5 },
      { id: 'cp3', name: '云雀积分 10 分', rarity: 'common', stock: 200, remain: 200, weight: 40, emoji: '✨', physical: false },
      { id: 'cp4', name: '谢谢参与', rarity: 'none', stock: 99999, remain: 99999, weight: 100, emoji: '🤝', physical: false }
    ]
  }
]

export const CLOUD_GOODS = [
  { id: 'cg1', name: '云雀新人立减券', cost: 0, icon: '🐦', stock: 120, remain: 120, physical: false, couponId: 'cc-welcome', unitPrice: 5 },
  { id: 'cg2', name: '云雀定制马克杯', cost: 60, icon: '☕', stock: 40, remain: 40, physical: true, unitPrice: 15 }
]
