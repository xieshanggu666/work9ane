// 奖品采购入库 —— 逻辑冒烟测试
// 覆盖：RBAC 三权分立（运营发起 / 财务审批 / 仓配验收）、状态机、驳回/撤销、
//       分批验收超量拦截与幂等、入库抬升 remain/stock 与 P5 勾稽、
//       缺货补发售后挂起 waiting_stock → 采购入库 → 从待处理售后继续履约、租户隔离、审计留痕。
import { setActivePinia, createPinia } from 'pinia'
import { usePlatformStore } from '@/store/platform'

setActivePinia(createPinia())
const s = usePlatformStore()
s.init()
const today = s.todayDate

let failed = 0
const assert = (cond, msg) => {
  if (cond) console.log('  ✅', msg)
  else { console.error('  ❌', msg); failed++ }
}
const g6 = () => s.goods.find((g) => g.id === g6id)
const g6id = 'g6'
const p1 = () => s.activities.find((a) => a.id === 'act-1').prizes.find((p) => p.id === 'p1')

console.log('— 种子：采购四态（待审批 iPhone / 验收中公仔 / 已完成保温杯 / 差异结案福袋）+ 缺货挂起售后 + 供应商账单 —')
assert(s.purchaseOrders.length === 4, `采购单种子 4 张（实际 ${s.purchaseOrders.length}）`)
const po1 = s.purchaseOrders.find((o) => o.id === 'seed-po1')
const po2 = s.purchaseOrders.find((o) => o.id === 'seed-po2')
const po3 = s.purchaseOrders.find((o) => o.id === 'seed-po3')
const po4 = s.purchaseOrders.find((o) => o.id === 'seed-po4')
assert(po1.status === 'received' && po1.inboundQty === 50 && po1.batches.length === 2, '保温杯采购：已完成，两批 30+20')
assert(po2.status === 'receiving' && po2.inboundQty === 6 && po2.qty === 10 && po2.afterSaleId === 'seed-as3',
  '公仔采购：分批验收中 6/10，关联缺货售后单')
assert(po3.status === 'pending' && po3.targetType === 'prize', 'iPhone 采购：待审批（活动奖品）')
assert(po4.status === 'diff_closed' && po4.inboundQty === 8 && po4.shortQty === 2 && po4.rejectedQty === 2,
  '福袋采购：验收差异结案（合格 8 / 短少 2 / 验退 2）')
assert(s.acceptDiffs.length === 2 && s.acceptDiffs.every((d) => d.poId === 'seed-po4'), '验收差异台账 2 条（短少 + 验退，append-only）')
assert(s.supplierBills.length === 2, '供应商账单种子 2 张（保温杯已结算 / 福袋复核通过待结算）')
assert(s.inboundBatches.length === 4, '验收批次台账 4 条（append-only）')
assert(s.pendingPurchaseCount === 1 && s.pendingInboundCount === 1, '采购角标：待审批 1 / 待入库 1')
const as3 = s.afterSales.find((a) => a.id === 'seed-as3')
assert(as3.status === 'waiting_stock' && as3.type === 'reship', '种子售后单：公仔补发缺货挂起「待补货」')
assert(s.waitingStockAfterSaleCount === 1, '待补货售后角标=1')
// 库存口径：保温杯 150→200 且 remain=200（入库抬升 stock）；公仔 stock 8、remain 6
const p3 = s.activities.find((a) => a.id === 'act-1').prizes.find((x) => x.id === 'p3')
assert(p3.stock === 200 && p3.remain === 200, '保温杯库存随采购入库抬升（stock/remain = 200）')
assert(g6().stock === 8 && g6().remain === 6, '公仔首批入库 6：stock 2→8、remain 0→6（剩 4 待收）')

console.log('— RBAC：运营发起 / 财务审批 / 仓配验收，三权分立 —')
s.loginAsCustomer()
assert(s.createPurchaseOrder({ targetType: 'goods', targetId: 'g6', qty: 1, reason: 'x' }) === null, '消费者发起采购被拦截')
s.loginAsMember('m-star-ops')
assert(s.can('purchase:apply') && !s.can('purchase:approve') && !s.can('purchase:inbound'),
  '活动运营：仅发起权限')
assert(s.reviewPurchaseOrder(po3.id, true) === false, '运营无审批权限，审批被拦截')
s.loginAsMember('m-star-ship')
assert(s.can('purchase:inbound') && !s.can('purchase:apply') && !s.can('purchase:approve'),
  '物流客服：仅验收权限')
assert(s.createPurchaseOrder({ targetType: 'goods', targetId: 'g6', qty: 1, reason: 'x' }) === null, '仓配无发起权限')
s.loginAsMember('m-star-fin')
assert(s.can('purchase:approve') && !s.can('purchase:inbound'), '财务：可审批、不可验收')
assert(s.inboundPurchase(po2.id, { qty: 1 }) === null, '财务无验收权限，入库被拦截')

console.log('— 审批 / 驳回 / 撤销状态机 —')
s.loginAsMember('m-star-ops')
const myPo = s.createPurchaseOrder({ targetType: 'goods', targetId: 'g6', qty: 3, reason: '运营补货测试', supplierName: '潮玩供应仓', unitPrice: 18 })
assert(!!myPo && myPo.status === 'pending', '运营发起采购成功（待审批）')
// 仓配不能撤销别人的单
s.loginAsMember('m-star-ship')
assert(s.cancelPurchaseOrder(myPo.id) === false, '非发起人/管理员撤销被拦截')
// 发起人可在审批前撤销
s.loginAsMember('m-star-ops')
assert(s.cancelPurchaseOrder(myPo.id) === true && myPo.status === 'canceled', '发起人审批前撤销成功')
assert(s.cancelPurchaseOrder(myPo.id) === false, '已撤销单重复撤销被状态机拦截')
// 财务驳回
const rejectPo = s.createPurchaseOrder({ targetType: 'prize', activityId: 'act-1', targetId: 'p1', qty: 1, reason: '应被驳回', supplierName: '数码直供（深圳）', unitPrice: 5999 })
s.loginAsMember('m-star-fin')
assert(s.reviewPurchaseOrder(rejectPo.id, false, '预算不足') === true, '财务驳回采购')
assert(rejectPo.status === 'rejected' && rejectPo.approver === '财务小周', '采购单 → 已驳回（记录审批人）')
assert(s.reviewPurchaseOrder(rejectPo.id, true) === false, '已驳回单不可再审')
const stockBeforeReject = p1().stock
assert(p1().stock === stockBeforeReject, '驳回不动库存（stock/remain 均不变）')

console.log('— 全链路：发起 → 审批 → 分批验收入库 → 自动完结 —')
s.loginAsMember('m-star-ops')
const po = s.createPurchaseOrder({ targetType: 'goods', targetId: 'g6', qty: 5, reason: '商城补货', supplierName: '潮玩供应仓', unitPrice: 18 })
const g6Before = g6().remain
const g6StockBefore = g6().stock
s.loginAsMember('m-star-fin')
assert(s.reviewPurchaseOrder(po.id, true, '同意') === true, '审批通过 → 已审批待入库')
assert(po.status === 'approved' && g6().remain === g6Before, '审批本身不动库存')
s.loginAsMember('m-star-ship')
// 表单与数量校验
assert(s.inboundPurchase(po.id, { qty: 0 }) === null, '验收数量需为正整数')
assert(s.inboundPurchase(po.id, { qty: 6 }) === null, '单次验收超审批数量被拦截')
const b1 = s.inboundPurchase(po.id, { qty: 2, carrier: '供应商甲', note: '首批 2 件' })
assert(!!b1 && b1.remainBefore === g6Before && b1.remainAfter === g6Before + 2, '首批验收 2 件，记录入库前后快照')
assert(g6().remain === g6Before + 2 && g6().stock === g6StockBefore + 2, '入库同步抬升 remain 与 stock')
assert(po.status === 'receiving' && po.inboundQty === 2, '采购单 → 分批验收中（2/5）')
// 超剩余待收拦截
assert(s.inboundPurchase(po.id, { qty: 4 }) === null, '累计验收不得超过审批数量（剩 3）')
const b2 = s.inboundPurchase(po.id, { qty: 3, carrier: '供应商甲' })
assert(!!b2 && po.status === 'received' && po.inboundQty === 5, '次批 3 件入满 → 入库完成')
assert(g6().remain === g6Before + 5 && g6().stock === g6StockBefore + 5, '累计入库 5 件全部反映到库存')
assert(!!po.receivedAt, '完结记录入库完成时间')
assert(s.inboundPurchase(po.id, { qty: 1 }) === null, '已完成采购单不可再验收（幂等）')
assert(s.inboundBatches.filter((b) => b.poId === po.id).length === 2, '两批验收均写入 append-only 台账')

console.log('— 缺货补发：待补货售后 → 采购入库 → 从待处理售后继续履约 —')
// seed-as3 公仔：首批 6 件入库后 remain=6 已足（本流程前又入了 5 件，余量充足）
const remainBeforeResume = g6().remain
const shipCountBefore = s.shipments.length
s.loginAsMember('m-star-admin')
assert(s.reviewAfterSale('seed-as3', true, '采购到货，继续补发') === true, '继续履约审核通过')
assert(as3.status === 'done' && !!as3.reshipmentId, '售后单 → 已完成并关联补发发货单')
assert(g6().remain === remainBeforeResume - 1, '补发再扣库存 1 件')
assert(s.shipments.length === shipCountBefore + 1, '生成一张补发发货单')
const reship = s.shipments.find((o) => o.id === as3.reshipmentId)
assert(reship && reship.status === 'to_ship' && reship.source === '售后补发' && reship.originId === 'seed-sp6',
  '补发单沿用原收货信息、进入待发货队列')
assert(s.waitingStockAfterSaleCount === 0, '待补货队列清零')
assert(s.reviewAfterSale('seed-as3', true) === false, '已完成售后单重复继续履约被拦截')

console.log('— P5 库存勾稽：采购入库自动平账，无需调整凭证 —')
s.runRecon(today, true)
const bill = s.reconBillOf(today)
const g6Row = bill.diffs.stock.find((x) => x.targetId === 'g6')
assert(g6Row && g6Row.diff === 0, `公仔账实相符（stock ${g6Row.stock} = 初始 ${g6Row.initialStock} + 采购 ${g6Row.purchased} − 消耗 ${g6Row.consumed}，diff=${g6Row?.diff}）`)
assert(g6Row.purchased === 6 + 5, 'P5 采购入库量 = 种子首批 6 + 本流程 5')
const p3Row = bill.diffs.stock.find((x) => x.targetType === 'prize' && x.targetId === 'p3')
assert(p3Row && p3Row.purchased === 50 && p3Row.diff === 0, '保温杯采购 50 件纳入 P5 勾稽且账实相符')
assert(bill.diffs.stock.filter((x) => x.diff !== 0).length === 0, `今日 P5 全部账实相符（openCount=${bill.diffs.openCount}）`)
assert(s.stockAdjustments.filter((x) => x.tenantId === 't-star').length === 0, '采购入库不产生库存调整凭证（正常入库抬库存，非盘盈盘亏）')

console.log('— 租户隔离：云雀数科看不到星河采购单；星河员工不可跨租户 —')
s.loginAsMember('m-platform')
s.switchTenant('t-cloud')
assert(s.scopedPurchaseOrders.length === 0, '云雀采购列表为空（星河种子采购不可见）')
s.switchTenant('t-star')
s.loginAsMember('m-star-ship')
assert(s.switchTenant('t-cloud') === false, '星河仓配不能切入云雀租户（强隔离）')
assert(s.activeTenantId === 't-star' && s.inboundPurchase(po2.id, { qty: 4 }) !== null,
  '回到星河上下文后仓配可继续验收本租户采购（剩余 4 件入满）')
assert(po2.status === 'received' && po2.inboundQty === 10, '种子公仔采购入满完结（6 + 4）')
assert(s.inboundPurchase(po2.id, { qty: 1 }) === null, '完结后重复验收拦截')

console.log('— 审计留痕：采购全链路动作齐全 —')
;['purchase-apply', 'purchase-approve', 'purchase-reject', 'purchase-cancel', 'purchase-inbound',
  'aftersale-shortage', 'aftersale-approve'].forEach((a) => {
  assert(s.auditLogs.some((l) => l.action === a && l.tenantId === 't-star'), `审计包含「${a}」`)
})
const inboundLog = s.auditLogs.find((l) => l.action === 'purchase-inbound' && l.detail.includes('定制保温杯'))
assert(!!inboundLog && inboundLog.module === 'purchase', '采购入库审计归类到 purchase 模块')
assert(s.auditLogs.some((l) => l.action === 'purchase-inbound' && l.detail.includes('库存 0→6')),
  '验收留痕含库存前后快照')

console.log(failed ? `\n共 ${failed} 项失败` : '\n全部通过 🎉')
process.exit(failed ? 1 : 0)
