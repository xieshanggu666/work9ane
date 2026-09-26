// 第二租户（云雀数科）活动/商品/卡券
export const CLOUD_COUPONS = [
  { id: 'cc-welcome', name: '云雀新人立减券', type: 'cash', emoji: '🐦', denomination: 5, threshold: 0, face: '', validityDays: 20, typeLabel: '新人立减券', desc: '云雀数科新客专享代金券，0 积分活动奖品' },
  { id: 'cc-svip', name: '云雀 SVIP 季卡', type: 'voucher', emoji: '💎', denomination: 0, threshold: 0, face: '90天会员权益', validityDays: 45, typeLabel: '兑换券', desc: '高价值券类奖品，命中风控时预占库存、放行后交付发券' }
]

export const CLOUD_ACTIVITIES = [
  {
    id: 'cact-1',
    name: '云雀上线幸运转盘',
    type: 'wheel',
    status: 'running',
    cost: 0,
    dailyLimit: 5,
    totalLimit: 50,
    costType: 'free',
    icon: '🐦',
    desc: '庆祝云雀数科上线，0 积分抽 SVIP 好礼',
    prizes: [
      { id: 'cp1', name: '云雀 SVIP 季卡', unitPrice: 68, rarity: 'legendary', stock: 10, remain: 10, frozen: 0, weight: 1, emoji: '💎', physical: false, couponId: 'cc-svip' },
      { id: 'cp2', name: '云雀定制马克杯', unitPrice: 15, rarity: 'rare', stock: 100, remain: 100, frozen: 0, weight: 20, emoji: '☕', physical: true },
      { id: 'cp3', name: '谢谢参与', rarity: 'none', stock: 99999, remain: 99999, frozen: 0, weight: 100, emoji: '🤝', physical: false }
    ]
  }
]

export const CLOUD_GOODS = [
  { id: 'cg1', name: '云雀新人立减券', cost: 0, unitPrice: 5, icon: '🐦', stock: 200, remain: 200, physical: false, couponId: 'cc-welcome' },
  { id: 'cg2', name: '云雀定制马克杯', cost: 60, unitPrice: 15, icon: '☕', stock: 80, remain: 80, physical: true }
]
