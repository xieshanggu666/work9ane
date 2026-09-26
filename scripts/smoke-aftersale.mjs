// 物流轨迹与售后闭环 —— 逻辑冒烟测试（esbuild 打包后在 node 运行）
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
const g3 = () => s.goods.find((g) => g.id === 'g3')
const g4 = () => s.goods.find((g) => g.id === 'g4')
const p2 = () => s.activities.find((a) => a.id === 'act-1').prizes.find((p) => p.id === 'p2')

console.log('— 种子：昨日退货已完成（账已回写）+ 今日补发待审核 —')
const sp3 = s.shipments.find((o) => o.id === 'seed-sp3')
const sp4 = s.shipments.find((o) => o.id === 'seed-sp4')
const as1 = s.afterSales.find((a) => a.id === 'seed-as1')
const as2 = s.afterSales.find((a) => a.id === 'seed-as2')
assert(sp3?.status === 'returned' && sp3.afterSaleId === 'seed-as1', '种子：盲盒福袋发货单已退回（关联售后单）')
assert(sp3.traces.some((t) => t.stage === 'signed') && sp3.traces.some((t) => t.stage === 'returned'),
  '种子：退回单轨迹含签收与退回节点')
assert(as1?.status === 'done' && as1.refundPoints === 200 && as1.reviewedAt.startsWith(as1.createdAt),
  '种子：退货售后单已完成，退款 200 积分快照在案')
assert(s.pointRecords.some((p) => p.kind === 'refund' && p.refId === 'seed-as1' && p.refType === 'after-sale' && p.delta === 200),
  '种子：售后退款流水已入账（refId 勾稽售后单）')
assert(sp4?.status === 'received' && as2?.status === 'pending' && as2.type === 'reship',
  '种子：帆布袋已收货，补发申请待审核')
assert(s.pendingAfterSaleCount === 1 && s.myAfterSalePendingCount === 1, '售后待审核角标=1（运营/用户）')
assert(s.shipmentStats.returned === 1 && s.dashboard.shipReturned === 1 && s.dashboard.afterSalePending === 1,
  '看板：已退回 1 单、售后待审核 1 单')

console.log('— 物流轨迹同步：推进 → 终态幂等 —')
s.setRole('user')
const sp1 = s.shipments.find((o) => o.id === 'seed-sp1')
assert(sp1.traces.length === 3, '购物卡轨迹已同步至派送中（3 个节点）')
assert(s.syncShipmentTrace(sp1.id) === true, '同步物流：推进到签收')
assert(sp1.traces.length === 4 && sp1.traces[3].stage === 'signed', '轨迹追加签收节点')
assert(s.syncShipmentTrace(sp1.id) === false, '已到签收终态，重复同步幂等拦截')
assert(sp1.traces.length === 4, '轨迹不重复追加')
// 未发货单不可同步
const sp2 = s.shipments.find((o) => o.id === 'seed-sp2')
assert(s.syncShipmentTrace(sp2.id) === false, '待填地址单同步物流被拦截')
// 确认收货时轨迹已到签收则不重复补节点
assert(s.receiveShipment(sp1.id) === true, '确认收货成功')
assert(sp1.traces.filter((t) => t.stage === 'signed').length === 1, '已签收轨迹不重复补录')

console.log('— 售后申请：权限 / 状态机 / 幂等拦截 —')
assert(s.applyAfterSale(sp2.id, 'reject', 'test') === null, '待填地址单不可申请售后')
assert(s.applyAfterSale(sp1.id, 'reject', 'test') === null, '已收货单不可申请拒收（类型与状态不匹配）')
assert(s.applyAfterSale(sp1.id, 'return', '') === null, '空原因被拦截')
assert(s.applyAfterSale(sp4.id, 'reship', '再次申请') === null, '已有待审核售后单，重复申请被拦截')
s.setRole('operator')
assert(s.applyAfterSale(sp1.id, 'return', '代申请') === null, '运营视角代申请被拦截')
s.setRole('user')
assert(s.reviewAfterSale(as2.id, true) === false, '用户视角审核售后被拦截')

console.log('— 驳回：不动账，仅留痕 —')
const apply1 = s.applyAfterSale(sp1.id, 'return', '卡面有划痕，申请退货')
assert(apply1?.status === 'pending' && apply1.refundPoints === 0, '退货申请已提交（免费奖品退款额为 0）')
const ptsBeforeDismiss = s.points
const p2RemainBefore = p2().remain
s.setRole('operator')
assert(s.reviewAfterSale(apply1.id, false, '已超出售后期限') === true, '运营驳回成功')
assert(apply1.status === 'dismissed' && apply1.reviewer === s.user.name, '售后单已驳回并记录审核人')
assert(s.points === ptsBeforeDismiss && p2().remain === p2RemainBefore && sp1.status === 'received',
  '驳回不动账：积分/库存/发货单状态均不变')
assert(s.reviewAfterSale(apply1.id, true) === false, '已驳回单重复审核被状态机拦截')
// 驳回后允许重新申请
s.setRole('user')
const apply2 = s.applyAfterSale(sp1.id, 'return', '重新提交：包装未拆，仍申请退货')
assert(apply2?.status === 'pending', '驳回后可重新申请售后')

console.log('— 退货闭环：审核通过回写积分/库存/发货单/台账 —')
s.setRole('operator')
const ptsBeforeReturn = s.points
// 免费抽奖奖品 refundPoints=0：库存回补、无积分退款
assert(s.reviewAfterSale(apply2.id, true, '核实未拆封，同意退货') === true, '退货审核通过')
assert(apply2.status === 'done', '售后单 → 已完成')
assert(sp1.status === 'returned' && sp1.afterSaleId === apply2.id && !!sp1.returnedAt, '发货单 → 已退回')
assert(sp1.traces.some((t) => t.stage === 'returned'), '轨迹追加退回节点')
assert(p2().remain === p2RemainBefore + 1, '奖品库存回补 1（购物卡）')
assert(s.points === ptsBeforeReturn, '免费奖品无积分退款（refundPoints=0 不写流水）')
assert(s.reviewAfterSale(apply2.id, true) === false, '已完成单重复审核幂等拦截')

console.log('— 付费兑换退货：积分返还 + 库存回补 —')
// 造一笔新的已收货订单：兑换 g3 → 填地址 → 运营发货 → 用户收货
s.setRole('user')
s.riskRules.enabled = false
const rec = s.redeem('g3')
const spNew = s.shipmentOfRecord(rec.id)
s.submitShipAddress(spNew.id, { receiver: '张三', phone: '13812345678', region: '北京市海淀区', address: '中关村大街1号' })
s.setRole('operator')
s.shipShipment(spNew.id, { carrier: '顺丰速运', trackingNo: 'SF777' })
assert(spNew.traces.length === 1 && spNew.traces[0].stage === 'collected', '发货即生成揽收节点')
s.setRole('user')
s.receiveShipment(spNew.id)
assert(spNew.traces.some((t) => t.stage === 'signed'), '确认收货补齐签收节点')
const g3BeforeReturn = g3().remain
const ptsBeforeReturn2 = s.points
const apply3 = s.applyAfterSale(spNew.id, 'return', '布袋有污渍，申请退货退款')
assert(apply3?.refundPoints === 150, '退货申请快照退款额 150 积分')
s.setRole('operator')
assert(s.reviewAfterSale(apply3.id, true, '同意退货退款') === true, '退货审核通过')
assert(s.points === ptsBeforeReturn2 + 150, '积分返还 150（余额同步）')
assert(s.pointRecords.some((p) => p.kind === 'refund' && p.refId === apply3.id && p.delta === 150),
  '退款流水 append-only 入账并勾稽售后单')
assert(g3().remain === g3BeforeReturn + 1, '商品库存回补 1')
assert(spNew.status === 'returned', '发货单 → 已退回')

console.log('— 补发闭环：库存扣减 + 生成补发发货单 —')
const g3BeforeReship = g3().remain
const shipCountBefore = s.shipments.length
assert(s.reviewAfterSale(as2.id, true, '核实破损，安排补发') === true, '补发审核通过')
assert(as2.status === 'done' && !!as2.reshipmentId, '售后单完成并关联补发单')
assert(g3().remain === g3BeforeReship - 1, '补发扣减库存 1')
assert(s.shipments.length === shipCountBefore + 1, '生成一张补发发货单')
const reship = s.shipments.find((o) => o.id === as2.reshipmentId)
assert(reship && reship.status === 'to_ship' && reship.source === '售后补发' && reship.originId === 'seed-sp4',
  '补发单：待发货、来源售后补发、关联原单')
assert(reship.receiver === sp4.receiver && reship.address === sp4.address, '补发单沿用原收货信息')
assert(sp4.traces.some((t) => t.stage === 'reship'), '原单轨迹追加补发受理节点')
assert(s.pendingShipCount === 1, '补发单进入运营待发货队列')
// 补发单可走完整发货流程
assert(s.shipShipment(reship.id, { carrier: '韵达快递', trackingNo: 'YD666' }) === true, '补发单可正常发货')
assert(reship.traces.some((t) => t.stage === 'collected'), '补发单发货生成揽收节点')

console.log('— 缺货挂起：补发审核缺货 → waiting_stock，采购入库后从待处理售后继续履约 —')
// 再造一笔已收货订单并申请补发，然后把库存清零模拟缺货
s.setRole('user')
const rec2 = s.redeem('g3')
const spNew2 = s.shipmentOfRecord(rec2.id)
s.submitShipAddress(spNew2.id, { receiver: '张三', phone: '13812345678', region: '北京市海淀区', address: '中关村大街1号' })
s.setRole('operator')
s.shipShipment(spNew2.id, { carrier: '顺丰速运', trackingNo: 'SF888' })
s.setRole('user')
s.receiveShipment(spNew2.id)
const apply4 = s.applyAfterSale(spNew2.id, 'reship', '少发了一件，申请补发')
assert(apply4?.status === 'pending', '第二笔补发申请已提交')
const g3Zero = g3().remain // 缺货挂起前的真实余量（仅用于演示结束后把账面还原回真实水平）
g3().remain = 0 // 模拟仓库实物缺货
const ptsBeforeFail = s.points
const shipCountBeforeFail = s.shipments.length
s.setRole('operator')
assert(s.reviewAfterSale(apply4.id, true, '缺货挂起') === true, '库存不足：补发审核通过但转挂起（返回 true）')
assert(apply4.status === 'waiting_stock' && !!apply4.shortageNote, '售后单 → 待补货（不动账，等待采购入库）')
assert(s.pendingOrWaitingAfterSaleCount >= 1 && s.waitingStockAfterSaleCount >= 1, '待补货单计入待处理售后队列/角标')
assert(s.points === ptsBeforeFail && s.shipments.length === shipCountBeforeFail && g3().remain === 0,
  '挂起不落账：积分/发货单/库存均未变动')
// 驳回待补货单（可选路径）：验证 waiting_stock 不可驳回，只能继续履约
assert(s.reviewAfterSale(apply4.id, false) === false, '待补货单不可驳回（只能继续履约）')
// 走采购链路补货：从待补货售后单一键发起（采购单回指售后单，入完后从待处理售后继续履约）
const po = s.createPurchaseOrder({
  targetType: apply4.targetType, targetId: apply4.targetId, activityId: apply4.activityId,
  qty: 10, reason: '缺货补发采购', afterSaleId: apply4.id,
  supplierName: '测试供应商', unitPrice: 20
})
assert(!!po && po.afterSaleId === apply4.id, '可从待处理售后单发起采购（采购单关联售后）')
assert(s.reviewPurchaseOrder(po.id, true, '售后优先') === true, '采购审批通过')
// 分批验收：先入 4 件（未入完，采购单保持 receiving）
const b1 = s.inboundPurchase(po.id, { qty: 4, carrier: '测试供应商' })
assert(!!b1 && b1.qty === 4 && g3().remain === 4, '首批验收入库 4 件（remain 0→4，stock 同步抬升）')
assert(s.purchaseOrders.find((o) => o.id === po.id).status === 'receiving' &&
  s.purchaseOrders.find((o) => o.id === po.id).inboundQty === 4, '未入完：采购单 → 分批验收中（累计 4/10）')
// 超量验收被拦截（本次数量不得超过待收 6）
assert(s.inboundPurchase(po.id, { qty: 999 }) === null, '累计验收不得超过审批数量')
// 库存已有余量即可从待处理售后继续履约（不必等采购入完）
assert(s.reviewAfterSale(apply4.id, true, '首批到货，继续补发履约') === true, '首批入库后即可从待处理售后继续履约')
assert(apply4.status === 'done' && g3().remain === 3, '继续履约落账：补发再扣 1 件（4→3）')
// 剩余批次入完，采购单转入库完成
const b2 = s.inboundPurchase(po.id, { qty: 6, carrier: '测试供应商' })
assert(!!b2 && g3().remain === 9, '剩余 6 件验收入库（3→9），累计入满 10 件')
assert(s.purchaseOrders.find((o) => o.id === po.id).status === 'received', '入满：采购单 → 入库完成')
// 已完成采购/售后重复操作均幂等拦截
assert(s.inboundPurchase(po.id, { qty: 1 }) === null, '入库完成后重复验收被拦截')
assert(s.reviewAfterSale(apply4.id, true) === false, '已完成售后单重复审核被拦截')
// 演示环境账面还原：把模拟缺货前的真实余量补回（采购/补发链路已演示完毕）
g3().remain += g3Zero

console.log('— 对账口径：售后退款/退回/补发纳入 P1/P5，账实仍平衡 —')
s.runRecon(today, true)
const bill = s.reconBillOf(today)
assert(bill.diffs.openCount === 0,
  `今日账实相符（openCount=${bill.diffs.openCount}：残差 ${bill.diffs.points.residual}、库存 ${bill.diffs.stock.filter((x) => x.diff).length} SKU）`)
assert(bill.diffs.points.detail.some((e) => e.label.includes('售后退款') && e.delta === 150),
  'P1 应有净额明细含今日售后退款 +150')
const g3Row = bill.diffs.stock.find((x) => x.targetId === 'g3')
assert(g3Row && g3Row.asReturned === 1 && g3Row.asReshipped === 2 && g3Row.diff === 0,
  `P5 g3 勾稽含售后修正（退回 ${g3Row?.asReturned}、补发 ${g3Row?.asReshipped}、diff=${g3Row?.diff}）`)
const p2Row = bill.diffs.stock.find((x) => x.targetType === 'prize' && x.targetId === 'p2')
assert(p2Row && p2Row.asReturned === 1 && p2Row.diff === 0, 'P5 奖品购物卡勾稽含拒收/退货回补')
// 昨日：种子退货退款已勾稽，残差仍为历史漏记的 5
const yd = s.reconDates.find((d) => d !== today)
s.runRecon(yd, true)
const yb = s.reconBillOf(yd)
assert(yb.diffs.points.residual === 5, `昨日 P1 残差仍为 5（售后退款两侧勾稽，实际 ${yb.diffs.points.residual}）`)
assert(yb.diffs.points.detail.some((e) => e.label.includes('售后退款') && e.delta === 200),
  '昨日 P1 明细含种子退货退款 +200')
assert(!yb.diffs.stock.some((x) => x.diff !== 0), '昨日 P5 库存账实相符（退货回补已纳入）')

console.log('— 审计留痕 —')
;['aftersale-apply', 'aftersale-approve', 'aftersale-dismiss', 'ship-trace'].forEach((a) => {
  assert(s.auditLogs.some((l) => l.action === a), `操作记录包含「${a}」`)
})
assert(s.auditLogs.some((l) => l.action === 'aftersale-approve' && l.detail.includes('返还 150 积分')),
  '审核通过留痕含退款明细')

console.log(failed ? `\n共 ${failed} 项失败` : '\n全部通过 🎉')
process.exit(failed ? 1 : 0)
