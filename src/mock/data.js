// 奖品稀有度与外观配置
export const PRIZE_RARITY = {
  legendary: { label: '传说', color: '#ff5252', icon: '💎' },
  epic: { label: '史诗', color: '#ab47bc', icon: '🏆' },
  rare: { label: '稀有', color: '#42a5f5', icon: '🎁' },
  common: { label: '普通', color: '#78909c', icon: '🎈' },
  none: { label: '谢谢参与', color: '#9e9e9e', icon: '🤝' }
}

// 抽奖玩法类型
export const GAME_TYPES = {
  wheel: { label: '幸运转盘', desc: '指针旋转抽奖' },
  scratch: { label: '刮刮乐', desc: '刮开涂层揭晓' }
}

// 风控默认规则（运营可在「风控审核」中配置）
export const DEFAULT_RISK_RULES = {
  enabled: true,              // 风控总开关
  highValueRarities: ['legendary', 'epic'], // 命中即冻结的高价值奖品
  dailyDrawThreshold: 4,      // 当日抽奖次数达到该值即视为高频
  rapidDrawSeconds: 30,       // 抽奖短时窗口（秒）
  rapidDrawMax: 3,            // 窗口内抽奖次数达到该值即冻结
  rapidRedeemSeconds: 60,     // 兑换短时窗口（秒）
  rapidRedeemMax: 2,          // 窗口内兑换次数达到该值即冻结
  highValueRedeemCost: 150,   // 单笔兑换积分达到该值视为高价值
  blacklist: []               // 用户黑名单（用户 id，逗号分隔维护）
}

// 预置活动
export const ACTIVITIES = [
  {
    id: 'act-1',
    name: '周年庆幸运转盘',
    type: 'wheel',
    status: 'running',
    cost: 0,                 // 免费抽
    dailyLimit: 3,           // 每日限抽
    totalLimit: 20,          // 每人总限抽
    costType: 'free',
    icon: '🎡',
    desc: '周年庆回馈老用户，转盘好礼送不停',
    startAt: '2026-09-01',
    endAt: '2026-10-01',
    prizes: [
      { id: 'p1', name: 'iPhone 16', rarity: 'legendary', stock: 3, remain: 3, weight: 1, emoji: '📱', physical: true, unitPrice: 5999 },
      { id: 'p2', name: '500元购物卡', rarity: 'epic', stock: 20, remain: 20, weight: 4, emoji: '💳', physical: true, unitPrice: 500 },
      { id: 'p3', name: '定制保温杯', rarity: 'rare', stock: 150, remain: 150, weight: 15, emoji: '☕', physical: true, unitPrice: 12.5 },
      { id: 'p4', name: '30积分', rarity: 'rare', stock: 500, remain: 500, weight: 30, emoji: '🪙', physical: false },
      { id: 'p5', name: '5积分', rarity: 'common', stock: 2000, remain: 2000, weight: 50, emoji: '✨', physical: false },
      { id: 'p6', name: '谢谢参与', rarity: 'none', stock: 99999, remain: 99999, weight: 100, emoji: '🤝', physical: false }
    ]
  },
  {
    id: 'act-2',
    name: '新人刮刮乐',
    type: 'scratch',
    status: 'running',
    cost: 10,                // 积分消耗
    dailyLimit: 5,
    totalLimit: 50,
    costType: 'points',
    icon: '🎰',
    desc: '新用户专区，消耗积分刮取惊喜',
    startAt: '2026-09-10',
    endAt: '2026-09-30',
    prizes: [
      { id: 'p1', name: '蓝牙耳机', rarity: 'legendary', stock: 5, remain: 5, weight: 1, emoji: '🎧', physical: true },
      { id: 'p2', name: '视频月卡', rarity: 'epic', stock: 50, remain: 50, weight: 6, emoji: '🎬', physical: false, couponId: 'c-video-month', unitPrice: 25 },
      { id: 'p3', name: '20积分', rarity: 'rare', stock: 400, remain: 400, weight: 25, emoji: '🪙', physical: false },
      { id: 'p4', name: '5积分', rarity: 'common', stock: 800, remain: 800, weight: 50, emoji: '✨', physical: false },
      { id: 'p5', name: '谢谢参与', rarity: 'none', stock: 99999, remain: 99999, weight: 100, emoji: '🤝', physical: false }
    ]
  }
]

// 预设任务（积分来源）
// metric: 'draw' 表示抽奖类任务——按真实参与记录自动累计进度并结算，无需手动领取；
// goal 为达标次数。其余任务仍为用户手动完成后领取。
export const TASKS = [
  { id: 't-checkin', label: '每日签到', reward: 5, icon: '📅', type: 'daily' },
  { id: 't-watch', label: '观看今日视频', reward: 10, icon: '▶️', type: 'daily' },
  { id: 't-share', label: '分享活动', reward: 8, icon: '📣', type: 'daily' },
  { id: 't-draw3', label: '今日抽奖3次', reward: 15, icon: '🎲', type: 'daily', metric: 'draw', goal: 3 },
  { id: 't-bind', label: '完善个人信息', reward: 30, icon: '👤', type: 'once' },
  { id: 't-invite', label: '邀请好友注册', reward: 50, icon: '🤝', type: 'once' }
]

// 卡券模板（中奖/兑换券类奖品或商品的核销凭证定义；库存仍挂在奖品/商品上，券账户按模板快照发券）
// type: discount 满减券（threshold 门槛 + denomination 减免）| cash 代金券（denomination 面值）| voucher 兑换券（face 权益文案）
// validityDays：自发券日（风控放行的以放行日为准）起的有效天数，到期当日 23:59 前可核销
export const COUPON_TYPES = {
  discount: { label: '满减券' },
  cash: { label: '代金券' },
  voucher: { label: '兑换券' }
}
export const COUPONS = [
  {
    id: 'c-discount-10', name: '满50减10优惠券', type: 'discount',
    emoji: '🎟️', denomination: 10, threshold: 50, face: '', validityDays: 30,
    desc: '全场满 50 元可用，单笔订单限用 1 张'
  },
  {
    id: 'c-video-week', name: '视频会员周卡', type: 'voucher',
    emoji: '🎬', denomination: 0, threshold: 0, face: '7天会员权益', validityDays: 15,
    desc: '兑换后激活视频平台 7 天会员，核销时由运营录入开通账号'
  },
  {
    id: 'c-video-month', name: '视频月卡', type: 'voucher',
    emoji: '🎬', denomination: 0, threshold: 0, face: '30天会员权益', validityDays: 30,
    desc: '兑换后激活视频平台 30 天会员，核销时由运营录入开通账号'
  }
]

// 积分商城兑换商品（physical: 是否需要物流发货——实物填写收货信息、运营发货；
// couponId: 券类虚拟商品——中奖/兑换发券至卡券账户，运营扫码核销；其余虚拟商品直接到账）
export const SHOP_GOODS = [
  { id: 'g1', name: '满50减10优惠券', cost: 30, icon: '🎟️', stock: 200, remain: 200, physical: false, couponId: 'c-discount-10', unitPrice: 8 },
  { id: 'g2', name: '视频会员周卡', cost: 80, icon: '🎬', stock: 100, remain: 100, physical: false, couponId: 'c-video-week', unitPrice: 6 },
  { id: 'g3', name: '定制帆布袋', cost: 150, icon: '👜', stock: 50, remain: 50, physical: true, unitPrice: 22 },
  { id: 'g4', name: '盲盒福袋', cost: 200, icon: '🎁', stock: 30, remain: 30, physical: true, unitPrice: 9.9 },
  { id: 'g5', name: '与牛人共进午餐', cost: 500, icon: '🍽️', stock: 5, remain: 5, physical: false, unitPrice: 300 },
  // 限量实物：种子中 2 件已兑完（其中 1 笔补发售后因缺货挂起，等待采购入库后继续履约）
  { id: 'g6', name: '限量联名公仔', cost: 300, icon: '🧸', stock: 2, remain: 2, physical: true, unitPrice: 18 }
]

export const DEMO_USER = {
  id: 'u-1001',
  name: '运营测试用户',
  avatar: '🦊'
}