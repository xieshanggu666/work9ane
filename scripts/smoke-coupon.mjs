// 卡券账户与核销模块 —— 逻辑冒烟测试（esbuild 打包后在 node 运行）
import { setActivePinia, createPinia } from 'pinia'
import { usePlatformStore } from '@/store/platform'

setActivePinia(createPinia())
const s = usePlatformStore()
s.init()

let failed = 0
const assert = (cond, msg) => {
  if (cond) console.log('  ✅', msg)
  else { console.error('  ❌', msg); failed++ }
}
const today = s.todayDate

console.log('— 种子卡券账户：待核销/已核销/已过期 + 风控预占待交付 —')
const cpAvail = s.coupons.find((c) => c.id === 'seed-cp1')
const cpRedeem = s.coupons.find((c) => c.id === 'seed-cp2')
const cpExpired = s.coupons.find((c) => c.id === 'seed-cp4')
assert(cpAvail?.status === 'available' && cpAvail.code === 'CP-A1B2C-3D4E5', '种子：满50减10券待核销，券码正确')
assert(cpRedeem?.status === 'redeemed' && cpRedeem.redeemOperator === '运营小张', '种子：视频周卡已核销且有核销人/时间')
assert(cpExpired?.status === 'expired', '种子：13 天前的满减券已过期')
assert(s.couponStats.available === 1 && s.couponStats.redeemed === 2 && s.couponStats.expired === 1,
  `卡券看板统计正确（${JSON.stringify(s.couponStats)}）`)
assert(s.myHeldCoupons.length === 1 && s.myHeldCoupons[0].prizeName === '视频月卡', '风控冻结中的视频月卡进入"预占待交付"')
assert(s.myCouponTodoCount === 1 && s.pendingRedeemCount === 1, '用户/运营卡券角标=1')
assert(!s.couponOfRecord('seed-r2'), '冻结期未发券（券码不存在）')
assert(!s.couponOfRecord('seed-r5'), '已撤销单未发券（券从未发出）')
assert(s.goods.find((g) => g.id === 'g1').remain === 197, 'g1 满减券库存按 3 笔有效兑换核销（200→197）')
assert(s.goods.find((g) => g.id === 'g2').remain === 99, 'g2 视频周卡库存按 1 笔有效兑换核销（100→99，撤销单已回补）')

console.log('— 正常兑换发券：券码唯一、有效期、不入物流 —')
s.setRole('user')
s.riskRules.enabled = false
const ptsBefore = s.points
const rec1 = s.redeem('g1') // 满50减10优惠券
assert(rec1?.status === 'normal' && rec1.couponId === 'c-discount-10', '兑换券类商品落账正常且带 couponId')
const c1 = s.couponOfRecord(rec1.id)
assert(!!c1 && c1.status === 'available' && /^CP-[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(c1.code), '自动发券：待核销、券码格式正确')
assert(s.coupons.filter((x) => x.code === c1.code).length === 1, '券码全局唯一')
assert(s.points === ptsBefore - 30, '兑换扣减 30 积分')
assert(!s.shipmentOfRecord(rec1.id), '券类不产生发货单（与实物互斥）')
// 有效期：30 天券到期日 = 发券日 +29 天
const expectExpire = (() => { const d = new Date(`${today} 00:00:00`); d.setDate(d.getDate() + 29); const m = String(d.getMonth()+1).padStart(2,'0'); const dd = String(d.getDate()).padStart(2,'0'); return `${d.getFullYear()}-${m}-${dd}` })()
assert(c1.expireDate === expectExpire, `有效期自兑换日起 30 天（${c1.expireDate}，预期 ${expectExpire}）`)
assert(s.issueCouponForRecord(rec1) === null, '重复发券幂等返回 null（一业务记录一券）')

console.log('— 运营核销：权限/不存在/重复/过期拦截 —')
assert(s.redeemCoupon(c1.code) === null, '用户视角核销被拦截')
s.setRole('operator')
assert(s.redeemCoupon('CP-ZZZ99-ZZZ99') === null, '不存在券码拦截')
const r1 = s.redeemCoupon(c1.code, { channel: '到店扫码', note: '门店核销' })
assert(r1?.coupon.status === 'redeemed' && !!r1.coupon.redeemedAt && r1.coupon.redeemOperator === s.user.name,
  '核销成功：状态→已核销，记录核销人/时间')
const dup = s.redeemCoupon(` ${c1.code.toLowerCase()} `, {})
assert(dup?.duplicated === true, '重复核销被幂等拦截（券码归一化容忍空格/大小写）')
const expR = s.redeemCoupon(cpExpired.code, {})
assert(expR?.expired === true, '已过期券核销被拦截')
assert(s.couponLogs.some((l) => l.action === 'redeem' && l.code === c1.code), '核销写入卡券台账')
assert(s.auditLogs.some((l) => l.action === 'coupon-redeem'), '核销写入操作记录')

console.log('— 风控联动：冻结预占（不发券）→ 放行交付发券；撤销释放 —')
s.setRole('user')
s.riskRules.enabled = true
s.riskRules.blacklist = [s.user.id] // 黑名单保证稳定命中风控
const ptsF = s.points
const recF = s.redeem('g1')
assert(recF?.status === 'frozen', '券兑换命中风控冻结')
assert(!s.couponOfRecord(recF.id), '冻结期只预占库存、券未发至账户')
const g1 = s.goods.find((g) => g.id === 'g1')
assert(g1.frozen >= 1, '券库存预占（frozen+1，remain 已扣）')
const orderF = s.riskOrders.find((o) => o.recordId === recF.id)
assert(s.myHeldCoupons.some((r) => r.id === recF.id), '用户卡券页可见预占待交付')
assert(s.couponLogs.some((l) => l.action === 'hold' && l.recordId === recF.id), '预占写入卡券台账')
s.setRole('operator')
s.releaseRisk(orderF.id, '核实正常放行')
const c2 = s.couponOfRecord(recF.id)
assert(!!c2 && c2.status === 'available' && c2.source === '风控放行', '放行后发券交付，来源标注风控放行')
assert(c2.issueDate === today && c2.expireDate === expectExpire, '有效期自放行日起算（不是冻结日）')
assert(s.couponLogs.some((l) => l.action === 'deliver' && l.code === c2.code), '交付写入 deliver 台账')
assert(s.points === ptsF - 30, '放行不重复扣积分（冻结时已扣）')

// 再构造一笔冻结后撤销：券库存回补、券始终不存在
s.setRole('user')
const recF2 = s.redeem('g1')
assert(recF2?.status === 'frozen', '第二笔券兑换冻结')
const remainAfterFreeze = s.goods.find((g) => g.id === 'g1').remain
const orderF2 = s.riskOrders.find((o) => o.recordId === recF2.id)
s.setRole('operator')
s.revokeRisk(orderF2.id, '演示撤销')
assert(!s.couponOfRecord(recF2.id), '撤销后无券（从未发放）')
assert(s.goods.find((g) => g.id === 'g1').remain === remainAfterFreeze + 1, '撤销回补券库存')
assert(s.couponLogs.some((l) => l.action === 'revoke' && l.recordId === recF2.id), '释放写入 revoke 台账')

console.log('— 抽奖中奖券：视频月卡正常发券；冻结视频月卡走预占/交付 —')
s.setRole('user')
s.riskRules.blacklist = []
s.riskRules.enabled = false
// 强制本抽命中视频月卡（epic 券奖品）
const monthCard = s.activities.find((a) => a.id === 'act-2').prizes.find((p) => p.id === 'p2')
const ow = monthCard.weight
monthCard.weight = 99999
const recDraw = s.draw('act-2') // 刮刮乐 10 积分/抽
monthCard.weight = ow
assert(recDraw?.status === 'normal' && recDraw.prizeName === '视频月卡' && recDraw.couponId === 'c-video-month',
  `抽到券奖品视频月卡（实际 ${recDraw?.prizeName}）`)
const c3 = s.couponOfRecord(recDraw.id)
assert(!!c3 && c3.status === 'available' && c3.type === 'voucher' && c3.face === '30天会员权益',
  '视频月卡券已发放：兑换券类型、权益文案正确')
assert(!s.shipmentOfRecord(recDraw.id), '券奖品不产生发货单')

console.log('— 到期扫描：构造一张当日到期券，过期流转幂等 —')
// 完成一次性任务补足积分（完善信息 30 + 邀请好友 50），再兑换一张有效券；
// 脚本短时连续兑换易触发连兑风控，演示核销/到期不关心风控，这里关闭相关规则
s.completeTask('t-bind'); s.completeTask('t-invite')
s.riskRules.enabled = false
s.riskRules.rapidRedeemMax = 0
// 再兑换一张有效券，然后把它的到期时刻改成"已过期但状态仍 available"（模拟扫描未覆盖）
s.setRole('user')
const recStale = s.redeem('g1')
const stale = s.couponOfRecord(recStale.id)
assert(!!stale && stale.status === 'available', '到期扫描前置：先取得一张待核销券')
stale.expireTs = Date.now() - 1000
stale.expireDate = '2026-09-01'
s.setRole('operator')
// redeemCoupon 内部会先做到期扫描，再在状态机层二次拦截：过期券核销必须失败
assert(s.redeemCoupon(stale.code)?.expired === true, '核销入口：过期券先自动到期再被拦截（双重保险）')
assert(stale.status === 'expired', '过期券状态已流转为 expired')
assert(s.sweepCouponExpiry(true) === 0, '到期扫描幂等（不重复处理）')
assert(s.redeemCoupon(stale.code)?.expired === true, '扫描后过期券核销仍被拦截')

console.log('— P6 卡券对账：初始平衡 → 注入漏发检出 → 复核补发 → 再对账平账 —')
s.riskRules.enabled = false
s.riskRules.rapidRedeemMax = 0
s.runRecon(today, true)
const bill0 = s.reconBillOf(today)
assert(bill0.diffs.coupons.length === 0, `今日 P6 无卡券差异（实际 ${bill0.diffs.coupons.length} 项）`)
assert(bill0.diffs.openCount === 0, '今日整体账实相符（积分/库存/卡券/冻结）')
// 权限：用户不可复核/补偿
s.setRole('user')
s.injectCouponGap() // 注入函数不做角色限制（演示），但补偿必须运营；注入移除当前第一张待核销券
s.runRecon(today, true)
const miss = s.reconBillOf(today).diffs.coupons.find((x) => x.kind === 'missing')
assert(!!miss && miss.autoFixable && miss.target === '满50减10优惠券', 'P6 检出券账户漏发（业务记录在、券缺失），标记可自动补发')
assert(s.compensateRecon(today) === null, '用户视角补偿被拦截')
s.setRole('operator')
s.reviewRecon(today, '核对业务记录，券确属漏发')
const compRes = s.compensateRecon(today)
assert(compRes?.couponCount === 1, `补偿补发 1 张新券（实际 ${compRes?.couponCount}）`)
s.runRecon(today, true)
const bill1 = s.reconBillOf(today)
assert(bill1.diffs.coupons.length === 0 && bill1.diffs.openCount === 0, '补券后重新对账：P6 平账')
assert(s.couponOfRecord(miss.recordId)?.comp === true, '补发新券带对账补券标记并回指原业务记录')
const compCoupon = s.couponOfRecord(miss.recordId)
assert(s.couponLogs.some((l) => l.action === 'comp' && l.code === compCoupon.code), '补券写入 comp 台账')
assert(s.compensateRecon(today) === null, '重复补偿幂等（不重复发券）')
assert(s.coupons.filter((c) => c.recordId === miss.recordId).length === 1, '原业务记录仍只对应一张券')
// 补发的新券可正常核销
assert(s.redeemCoupon(compCoupon.code)?.coupon.status === 'redeemed', '补发新券可正常核销')

console.log('— 看板 / 角标 / 库存同步 —')
assert(s.dashboard.couponIssued >= 7, `看板累计发券统计（实际 ${s.dashboard.couponIssued}）`)
assert(s.dashboard.couponRedeemed >= 4, `看板已核销统计（实际 ${s.dashboard.couponRedeemed}）`)
// 本测试产生的两笔冻结券单均已处理；种子中 seed-rk2（视频月卡，已申诉待运营处理）仍合法预占 1 张
assert(s.dashboard.couponHeld === 1, `预占仅剩种子申诉单（实际 ${s.dashboard.couponHeld}）`)
assert(s.couponStats.held === 1, '卡券预占看板=1（种子已申诉视频月卡）')
assert(s.myHeldCoupons.some((r) => r.id === 'seed-r2'), '预占中的是种子视频月卡（放行可发券、撤销会释放）')
// 券库存仍与有效兑换勾稽（P5 不因发券/核销/补券产生差异）
s.runRecon(today, true)
assert(!s.reconBillOf(today).diffs.stock.some((x) => x.diff !== 0), '券商品库存账实相符（补券是账务补发，不重复扣库存）')

console.log('— 卡券台账 append-only 留痕完整 —')
;['issue', 'hold', 'deliver', 'revoke', 'redeem', 'expire', 'comp'].forEach((a) => {
  assert(s.couponLogs.some((l) => l.action === a), `卡券台账包含「${a}」`)
})

console.log(failed ? `\n共 ${failed} 项失败` : '\n全部通过 🎉')
process.exit(failed ? 1 : 0)
