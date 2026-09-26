// 实物收货发货流程 —— 逻辑冒烟测试（esbuild 打包后在 node 运行）
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

console.log('— 种子发货单：已发货购物卡 + 待填地址帆布袋 + 已退回盲盒 + 已收货帆布袋 —')
const sp1 = s.shipments.find((o) => o.id === 'seed-sp1')
const sp2 = s.shipments.find((o) => o.id === 'seed-sp2')
assert(sp1 && sp1.status === 'shipped', '种子：500元购物卡已发货（待用户确认收货）')
assert(sp1.traces.length === 3 && sp1.traces[2].stage === 'delivering', '种子：购物卡物流轨迹已同步至派送中')
assert(sp2 && sp2.status === 'pending_address', '种子：定制帆布袋待填写收货信息')
assert(s.shipmentStats.total === 6 && s.shipmentStats.shipped === 1 && s.shipmentStats.pendingAddress === 1 &&
  s.shipmentStats.received === 3 && s.shipmentStats.returned === 1,
  `发货看板统计正确（${JSON.stringify(s.shipmentStats)}）`)
assert(s.myShipTodoCount === 2, `用户待办角标=2（实际 ${s.myShipTodoCount}：待填地址+待收货）`)
assert(s.pendingShipCount === 0, `运营待发货角标=0（地址未提交，实际 ${s.pendingShipCount}）`)
// 库存按既有规则核销：g3 remain 已扣 2（seed-r7 待填地址 + seed-r13 已收货）
assert(s.goods.find((g) => g.id === 'g3').remain === 48, '帆布袋库存已核销 2（50→48）')

console.log('— 用户确认种子购物卡收货 —')
s.setRole('user')
assert(s.receiveShipment('nonexist') === false, '不存在的发货单拦截')
assert(s.receiveShipment(sp1.id) === true, '确认收货成功')
assert(sp1.status === 'received' && !!sp1.receivedAt, '状态→已收货，记录收货时间')
assert(s.myShipTodoCount === 1, `待办角标降为 1（实际 ${s.myShipTodoCount}）`)
assert(s.receiveShipment(sp1.id) === false, '重复确认收货被状态机拦截')

console.log('— 用户填写帆布袋收货信息（校验 + 状态推进） —')
const bad = { receiver: '', phone: '123', region: '', address: '' }
assert(s.submitShipAddress(sp2.id, bad) === false, '空姓名/错误手机号/空地址被拦截')
const okAddr = { receiver: '张三', phone: '13812345678', region: '北京市海淀区', address: '中关村大街1号' }
assert(s.submitShipAddress(sp2.id, okAddr) === true, '合法收货信息提交成功')
assert(sp2.status === 'to_ship' && sp2.receiver === '张三' && sp2.phone === '13812345678', '状态→待发货，信息已保存')
assert(s.pendingShipCount === 1, `运营待发货角标=1（实际 ${s.pendingShipCount}）`)
assert(s.myShipTodoCount === 0, `用户待办清零（实际 ${s.myShipTodoCount}）`)
// 发货前允许修改地址
assert(s.submitShipAddress(sp2.id, { ...okAddr, address: '中关村大街99号' }) === true, '发货前可更新收货地址')
assert(sp2.address === '中关村大街99号', '地址更新生效')

console.log('— 权限隔离：用户不能发货、运营不能代填 —')
assert(s.shipShipment(sp2.id, { carrier: '顺丰速运', trackingNo: 'SF1' }) === false, '用户视角发货被拦截')
s.setRole('operator')
assert(s.submitShipAddress(sp2.id, okAddr) === false, '运营视角代填地址被拦截')

console.log('— 运营接单发货 —')
assert(s.shipShipment(sp2.id, { carrier: '', trackingNo: '' }) === false, '缺快递公司/单号拦截')
assert(s.shipShipment(sp2.id, { carrier: '顺丰速运', trackingNo: 'SF999' }) === true, '接单发货成功')
assert(sp2.status === 'shipped' && sp2.carrier === '顺丰速运' && sp2.trackingNo === 'SF999' && !!sp2.shippedAt,
  '状态→已发货，物流信息与时间已记录')
assert(s.shipShipment(sp2.id, { carrier: '圆通', trackingNo: 'YT1' }) === false, '重复发货被状态机幂等拦截')
assert(s.pendingShipCount === 0, '运营待发货队列清零')

console.log('— 发货后地址锁定 —')
s.setRole('user')
assert(s.submitShipAddress(sp2.id, { ...okAddr, receiver: '李四' }) === false, '已发货后地址不可修改')
assert(s.receiveShipment(sp2.id) === true, '用户确认收货，订单完成')
assert(sp2.status === 'received', '状态→已收货')

console.log('— 风控联动：冻结不生成、撤销不生成、放行才生成 —')
// 初始 255 积分：g4 盲盒福袋 200 积分达高价值阈值（150），风控默认开启 → 冻结
const pts0 = s.points
const recFrozen = s.redeem('g4')
assert(recFrozen?.status === 'frozen', '高价值实物兑换触发风控冻结')
assert(!s.shipmentOfRecord(recFrozen.id), '冻结期间不生成发货单（奖品未发放）')
const frozenOrder = s.riskOrders.find((o) => o.recordId === recFrozen.id)
s.setRole('operator')
s.revokeRisk(frozenOrder.id, '演示撤销：积分库存返还')
assert(s.shipmentOfRecord(recFrozen.id) === null, '撤销后仍无发货单（业务作废）')
assert(s.points === pts0, '撤销返还兑换积分')

console.log('— 正常兑换：实物生成发货单，虚拟不生成 —')
s.setRole('user')
s.riskRules.enabled = false
// 完成任务补足积分：签到5 + 视频10 + 分享8 = 23，累计 255+23=278
s.completeTask('t-checkin'); s.completeTask('t-watch'); s.completeTask('t-share')
const recVirtual = s.redeem('g1') // 满50减10优惠券：虚拟
assert(recVirtual?.status === 'normal', '虚拟券卡兑换成功')
assert(!s.shipmentOfRecord(recVirtual.id), '虚拟商品不生成发货单')
const recPhys = s.redeem('g3') // 定制帆布袋：实物（150 积分）
assert(recPhys?.status === 'normal', '实物商品兑换成功')
const spNew = s.shipmentOfRecord(recPhys.id)
assert(spNew && spNew.status === 'pending_address', '实物兑换自动生成「待填地址」发货单')

console.log('— 正常抽奖：实物中奖生成发货单，积分奖品不生成 —')
// act-1 今日已占用 2 次（种子冻结+放行），仅剩 1 抽：临时抬高实物保温杯权重，保证本抽必中实物
const cup = s.activities.find((a) => a.id === 'act-1').prizes.find((p) => p.id === 'p3')
const origWeight = cup.weight
cup.weight = 99999
const drawRec = s.draw('act-1')
cup.weight = origWeight
assert(drawRec && drawRec.status === 'normal' && drawRec.prizeName === '定制保温杯',
  `免费转盘抽到实物：${drawRec?.prizeName || '（未抽到，库存可能不足）'}`)
if (drawRec) {
  const spDraw = s.shipmentOfRecord(drawRec.id)
  assert(spDraw && spDraw.targetName === drawRec.prizeName && spDraw.bizType === 'draw', '实物中奖生成发货单且关联抽奖记录')
  assert(s.createShipment(drawRec) === null, '重复创建发货单幂等返回 null')
}

console.log('— 风控放行冻结实物后补发发货单 —')
// 再构造一笔冻结 → 放行：积分已剩 278-30-150=98，攒一次性任务积分（完善信息30+邀请好友50=80）→178
s.completeTask('t-bind'); s.completeTask('t-invite')
s.riskRules.enabled = true
const recF2 = s.redeem('g3') // 150 积分高价值实物 → 冻结
assert(recF2?.status === 'frozen', '第二笔实物兑换冻结')
assert(!s.shipmentOfRecord(recF2.id), '冻结期间无发货单')
const f2Order = s.riskOrders.find((o) => o.recordId === recF2.id)
s.setRole('operator')
s.releaseRisk(f2Order.id, '核实正常放行')
const spRel = s.shipmentOfRecord(recF2.id)
assert(spRel && spRel.status === 'pending_address', '风控放行后生成「待填地址」发货单（冻结期不预生成）')

console.log('— 审计留痕完整 —')
const shipLogActions = ['ship-create', 'ship-address', 'ship-send', 'ship-receive']
shipLogActions.forEach((a) => {
  assert(s.auditLogs.some((l) => l.action === a), `操作记录包含「${a}」`)
})

console.log('— 全流程后今日对账仍平衡（发货不影响积分/库存勾稽） —')
s.riskRules.enabled = false
s.runRecon(today, true)
const bill = s.reconBillOf(today)
assert(bill.diffs.openCount === 0,
  `今日账实相符（openCount=${bill.diffs.openCount}：残差 ${bill.diffs.points.residual}、库存 ${bill.diffs.stock.filter((x) => x.diff).length} SKU）`)

console.log(failed ? `\n共 ${failed} 项失败` : '\n全部通过 🎉')
process.exit(failed ? 1 : 0)
