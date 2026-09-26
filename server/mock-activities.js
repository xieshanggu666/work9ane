// 服务端目录：活动/商品/卡券/任务（与前端 mock 同源同构，供无前端依赖的服务端独立运行）
export const ACTIVITIES = [
  {
    id: 'act-1',
    name: '周年庆幸运转盘',
    type: 'wheel',
    status: 'running',
    cost: 0,
    dailyLimit: 3,
    totalLimit: 20,
    costType: 'free',
    icon: '🎡',
    desc: '周年庆回馈老用户，转盘好礼送不停',
    prizes: [
      { id: 'p1', name: 'iPhone 16', unitPrice: 5999, rarity: 'legendary', stock: 3, remain: 3, frozen: 0, weight: 1, emoji: '📱', physical: true },
      { id: 'p2', name: '500元购物卡', unitPrice: 500, rarity: 'epic', stock: 20, remain: 20, frozen: 0, weight: 4, emoji: '💳', physical: true },
      { id: 'p3', name: '定制保温杯', unitPrice: 12.5, rarity: 'rare', stock: 150, remain: 150, frozen: 0, weight: 15, emoji: '☕', physical: true },
      { id: 'p4', name: '30积分', rarity: 'rare', stock: 500, remain: 500, frozen: 0, weight: 30, emoji: '🪙', physical: false },
      { id: 'p5', name: '5积分', rarity: 'common', stock: 2000, remain: 2000, frozen: 0, weight: 50, emoji: '✨', physical: false },
      { id: 'p6', name: '谢谢参与', rarity: 'none', stock: 99999, remain: 99999, frozen: 0, weight: 100, emoji: '🤝', physical: false }
    ]
  },
  {
    id: 'act-2',
    name: '新人刮刮乐',
    type: 'scratch',
    status: 'running',
    cost: 10,
    dailyLimit: 5,
    totalLimit: 50,
    costType: 'points',
    icon: '🎰',
    desc: '新用户专区，消耗积分刮取惊喜',
    prizes: [
      { id: 'p1', name: '蓝牙耳机', unitPrice: 199, rarity: 'legendary', stock: 5, remain: 5, frozen: 0, weight: 1, emoji: '🎧', physical: true },
      { id: 'p2', name: '视频月卡', unitPrice: 25, rarity: 'epic', stock: 50, remain: 50, frozen: 0, weight: 6, emoji: '🎬', physical: false, couponId: 'c-video-month' },
      { id: 'p3', name: '20积分', rarity: 'rare', stock: 400, remain: 400, frozen: 0, weight: 25, emoji: '🪙', physical: false },
      { id: 'p4', name: '5积分', rarity: 'common', stock: 800, remain: 800, frozen: 0, weight: 50, emoji: '✨', physical: false },
      { id: 'p5', name: '谢谢参与', rarity: 'none', stock: 99999, remain: 99999, frozen: 0, weight: 100, emoji: '🤝', physical: false }
    ]
  }
]

export const TASKS = [
  { id: 't-checkin', label: '每日签到', reward: 5, icon: '📅', type: 'daily' },
  { id: 't-draw3', label: '今日抽奖3次', reward: 15, icon: '🎲', type: 'daily', metric: 'draw', goal: 3 }
]

export const COUPONS = [
  { id: 'c-discount-10', name: '满50减10优惠券', type: 'discount', emoji: '🎟️', denomination: 10, threshold: 50, face: '', validityDays: 30, typeLabel: '满减券', desc: '全场满 50 元可用，单笔订单限用 1 张' },
  { id: 'c-video-week', name: '视频会员周卡', type: 'voucher', emoji: '🎬', denomination: 0, threshold: 0, face: '7天会员权益', validityDays: 15, typeLabel: '兑换券', desc: '兑换后激活视频平台 7 天会员' },
  { id: 'c-video-month', name: '视频月卡', type: 'voucher', emoji: '🎬', denomination: 0, threshold: 0, face: '30天会员权益', validityDays: 30, typeLabel: '兑换券', desc: '兑换后激活视频平台 30 天会员' }
]
