// 服务端目录：积分商城商品（unitPrice：单件采购成本估算，用于售后补发的预算资金占用口径）
export const SHOP_GOODS = [
  { id: 'g1', name: '满50减10优惠券', cost: 30, icon: '🎟️', stock: 200, remain: 200, physical: false, couponId: 'c-discount-10', unitPrice: 8 },
  { id: 'g2', name: '视频会员周卡', cost: 80, icon: '🎬', stock: 100, remain: 100, physical: false, couponId: 'c-video-week', unitPrice: 6 },
  { id: 'g3', name: '定制帆布袋', cost: 150, icon: '👜', stock: 50, remain: 50, physical: true, unitPrice: 22 },
  { id: 'g4', name: '盲盒福袋', cost: 200, icon: '🎁', stock: 30, remain: 30, physical: true, unitPrice: 9.9 },
  { id: 'g5', name: '与牛人共进午餐', cost: 500, icon: '🍽️', stock: 5, remain: 5, physical: false, unitPrice: 300 }
]
