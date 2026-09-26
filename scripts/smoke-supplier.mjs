// 供应商结算与采购对账闭环 —— 逻辑冒烟测试
// 覆盖：种子（验收差异/已结算账单）、RBAC（运营拟单/财务复核结算）、
//       验退拒收 + 到货短少差异结案、账单金额（按实收合格、补发占用不重复付款）、
//       复核驳回重提、结算回写库存对账快照、P7 采购结算对账、P1–P6 openCount 不被污染、租户隔离、审计留痕。
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
const g4 = () => s.goods.find((g) => g.id === 'g4')
const g6 = () => s.goods.find((g) => g.id === 'g6')

console.log('— 种子：验收差异 + 供应商账单（已结算/待结算）—')
assert(s.acceptDiffs.length === 2, `验收差异台账 2 条（实际 ${s.acceptDiffs.length}）`)
const po4 = s.purchaseOrders.find((o) => o.id === 'seed-po4')
assert(po4.status === 'diff_closed' && po4.shortQty === 2 && po4.rejectedQty === 2 && po4.inboundQty === 8,
  '福袋采购差异结案：合格 8 / 短少 2 / 验退 2')
const sb1 = s.supplierBills.find((b) => b.id === 'seed-sb1')
const sb2 = s.supplierBills.find((b) => b.id === 'seed-sb2')
assert(sb1.status === 'settled' && sb1.payableAmount === 625 && sb1.reconWriteback,
  '保温杯账单已结算 625 元并回写库存对账快照')
assert(sb2.status === 'approved' && sb2.payableAmount === 79.2, '福袋账单复核通过待结算（8 合格 × 9.9 = 79.2）')
assert(po4.settledBillId === '' && s.purchaseOrders.find((o) => o.id === 'seed-po1').settledBillId === 'seed-sb1',
  '已结算账单回写采购单 settledBillId')
assert(s.pendingSettleReviewCount === 1, '财务待办角标=1（福袋待结算）')

console.log('— RBAC：运营拟单 / 财务复核结算，三权分立 —')
s.loginAsCustomer()
assert(s.createSupplierBill('seed-po4') === null, '消费者发起账单被拦截')
s.loginAsMember('m-star-ship')
assert(!s.can('supplier:bill') && !s.can('supplier:review') && !s.can('supplier:settle'),
  '物流客服无供应商结算权限')
assert(s.createSupplierBill('seed-po4') === null, '仓配拟单被拦截')
s.loginAsMember('m-star-ops')
assert(s.can('supplier:bill') && !s.can('supplier:review') && !s.can('supplier:settle'),
  '活动运营：可拟单，不可复核/结算')
assert(s.reviewSupplierBill(sb2.id, true) === false, '运营复核账单被拦截')
s.loginAsMember('m-star-fin')
assert(!s.can('supplier:bill') && s.can('supplier:review') && s.can('supplier:settle'),
  '财务：可复核与结算，不可拟单')
assert(s.createSupplierBill('seed-po4') === null, '财务拟单被拦截')

console.log('— 财务结算种子账单：按实收合格付款并回写库存对账 —')
const g4Before = g4().remain
const before = s.settleSupplierBill(sb2.id, '对公付款 79.2 元，凭证号 YU-0901')
assert(!!before && before.status === 'settled' && before.payableAmount === 79.2, '福袋账单结算完成（79.2 元）')
assert(po4.settledBillId === sb2.id, '结算回写采购单关联')
assert(!!before.reconWriteback && before.reconWriteback.acceptedQty === 8 &&
  before.reconWriteback.shortQty === 2 && before.reconWriteback.rejectedQty === 2 &&
  before.reconWriteback.payableAmount === 79.2, '库存对账快照：合格 8 / 短少 2 / 验退 2 / 应付 79.2')
assert(g4().remain === g4Before, '结算本身不动库存（仅回写对账快照）')
assert(s.settleSupplierBill(sb2.id) === null, '已结算账单重复结算被拦截')

console.log('— 验退拒收 + 到货短少：差异登记与差异结案 —')
s.loginAsMember('m-star-ops')
const po = s.createPurchaseOrder({
  targetType: 'goods', targetId: 'g4', qty: 10, reason: '差异验收测试',
  supplierName: '好运礼品厂', unitPrice: 10
})
assert(!!po && po.status === 'pending', '运营发起采购（带供应商与单价）')
s.loginAsMember('m-star-fin')
assert(s.reviewPurchaseOrder(po.id, true, '同意') === true, '财务审批通过')
s.loginAsMember('m-star-ship')
// 到货 5、合格 3、验退 2
const b1 = s.inboundPurchase(po.id, { qty: 3, deliveredQty: 5, note: '2 件破损验退' })
assert(!!b1 && b1.rejectedQty === 2 && po.status === 'receiving' && po.rejectedQty === 2,
  '首批：到货 5 / 合格 3 / 验退 2，采购单验收中；库存只抬 3')
assert(s.acceptDiffs.some((d) => d.poId === po.id && d.type === 'rejected' && d.qty === 2),
  '验退拒收登记 append-only 验收差异')
// 剩余 7 件供应商确认短少不再补发：本批合格 2、短少 5 结案
const g4r0 = g4().remain
const b2 = s.inboundPurchase(po.id, { qty: 2, deliveredQty: 2, closeShortage: true, shortReason: '供应商缺货仅能补发 2 件' })
assert(!!b2 && b2.shortQty === 5 && po.status === 'diff_closed' && po.shortQty === 5 && po.inboundQty === 5,
  '次批：合格 2、短少 5，采购单差异结案（合格合计 5、短少 5）')
assert(g4().remain === g4r0 + 2, '库存仅按合格量抬升 2（短少未到货不抬、验退不抬）')
assert(s.acceptDiffs.some((d) => d.poId === po.id && d.type === 'short' && d.qty === 5),
  '到货短少登记 append-only 验收差异')
assert(s.inboundPurchase(po.id, { qty: 1 }) === null, '差异结案后不可再验收')

console.log('— 账单金额：实收合格计价，差异不计价 —')
s.loginAsMember('m-star-ops')
const bill = s.createSupplierBill(po.id, { submit: true, note: '按实收合格 5 件结算' })
assert(!!bill && bill.status === 'reviewing', '运营按采购单拟账并提交财务复核')
assert(bill.acceptedQty === 5 && bill.shortQty === 5 && bill.rejectedQty === 2 &&
  bill.grossAmount === 50 && bill.payableAmount === 50,
  '账单：合格 5 × 10 = 50；短少/验退未到货或不入库，均不计价')
assert(s.createSupplierBill(po.id) === null, '同一采购单重复拟单被拦截（一单一结算）')

console.log('— 复核驳回 → 运营修订重提 → 复核通过 —')
s.loginAsMember('m-star-fin')
assert(s.reviewSupplierBill(bill.id, false, '请补充批次差异凭证') === true, '财务驳回账单')
assert(bill.status === 'rejected', '账单 → 复核驳回（保留不删）')
s.loginAsMember('m-star-ops')
const reBill = s.submitSupplierBill(bill.id, { note: '差异凭证已补：破损照片 + 供应商短少确认函' })
assert(!!reBill && reBill.status === 'reviewing' && reBill.id === bill.id, '运营修订后重提（沿用账单 id，留痕连续）')
s.loginAsMember('m-star-fin')
assert(s.reviewSupplierBill(bill.id, true, '凭证齐全，按 50 元结算') === true, '财务复核通过')
assert(bill.status === 'approved' && bill.reviewer === '财务小周', '账单 → 复核通过待结算')

console.log('— 结算付款与库存对账回写（含批次勾稽行）—')
const settled = s.settleSupplierBill(bill.id, '付款 50')
assert(!!settled && settled.status === 'settled' && settled.payableAmount === 50, '结算付款 50 元')
assert(settled.reconWriteback.rows.length === 2, '回写快照含 2 个采购批次对账行')
const wb1 = settled.reconWriteback.rows.find((r) => r.batchId === b1.id)
assert(wb1.deliveredQty === 5 && wb1.acceptedQty === 3 && wb1.rejectedQty === 2 && wb1.billableQty === 3,
  '批次 1 回写：到货 5 / 合格 3 / 验退 2 / 计价 3')
const wb2 = settled.reconWriteback.rows.find((r) => r.batchId === b2.id)
assert(wb2.acceptedQty === 2 && wb2.shortQty === 5 && wb2.billableQty === 2,
  '批次 2 回写：合格 2 / 短少 5 / 计价 2')

console.log('— 售后补发：结算自动勾稽补发占用，不重复计价（待补发/已补发两态）—')
// seed-po2 公仔采购在 smoke 之前仍是 receiving 6/10；先入满，再继续补发售后，再拟单
s.loginAsMember('m-star-ship')
const po2 = s.purchaseOrders.find((o) => o.id === 'seed-po2')
const as3 = s.afterSales.find((a) => a.id === 'seed-as3')
const g6r = g6().remain
assert(s.inboundPurchase(po2.id, { qty: 4 }) !== null, '公仔采购剩余 4 件入满')
assert(po2.status === 'received' && po2.inboundQty === 10, '公仔采购入库完成 10 件')
// 补发履约前拟单：提示 reshipPending，全额计价
s.loginAsMember('m-star-ops')
const pre = s.createSupplierBill(po2.id, { submit: false })
assert(pre.reshipPending === 1 && pre.billableQty === 10 && pre.payableAmount === 180,
  '补发未履约：账单按 10 件全额计价 180，并提示补发待履约')
// 继续补发履约（库存扣 1）→ 运营提交复核，财务复核时自动扣减
s.loginAsMember('m-star-admin')
assert(s.reviewAfterSale(as3.id, true, '继续补发') === true, '售后补发履约完成')
const preBill = s.supplierBills.find((b) => b.poId === po2.id)
assert(g6().remain === g6r + 4 - 1, '补发履约再扣库存 1 件')
s.loginAsMember('m-star-ops')
assert(s.submitSupplierBill(preBill.id, { note: pre.note })?.status === 'reviewing', '运营提交账单复核（补发已履约）')
s.loginAsMember('m-star-fin')
assert(s.reviewSupplierBill(preBill.id, true, '复核以最新台账重算') === true, '复核时重算：勾稽补发占用')
assert(preBill.reshipQty === 1 && preBill.billableQty === 9 && preBill.reshipDeduct === 18 &&
  preBill.payableAmount === 162, '复核金额：10 × 18 − 补发占用 1 × 18 = 162')
const settled2 = s.settleSupplierBill(preBill.id, '付款 162')
assert(!!settled2 && settled2.payableAmount === 162, '结算 162 元（补发件不重复付款）')
const reshipRow = settled2.reconWriteback.rows.find((r) => r.reshipQty === 1)
assert(!!reshipRow && reshipRow.billableQty === reshipRow.acceptedQty - 1,
  '回写快照中补发占用按批次摊到验收行（计价件数 = 合格 − 补发占用）')
assert(s.auditLogs.some((l) => l.action === 'supplier-recon-reship'), '售后补发回写留有专项审计')

console.log('— P7 采购结算对账：未闭环项检出，且不污染 P1–P6 openCount —')
const recon = s.computeSupplierRecon()
const rows = recon.items
assert(rows.find((r) => r.poId === 'seed-po1')?.issues.length === 0, '保温杯采购：结算闭环无差异')
assert(rows.find((r) => r.poId === po.id)?.issues.length === 0, '差异结案采购：已结算闭环')
assert(rows.find((r) => r.poId === po2.id)?.issues.length === 0, '售后补发采购：已结算且补发已回写')
const finBill = s.runRecon(today, true)
assert(finBill.diffs.purchase.items.length === rows.length, '财务对账差异单内嵌 P7 采购结算段')
// 直接验证 openCount 不含 purchase
const withoutP7 = (finBill.diffs.points.residual !== 0 ? 1 : 0) + finBill.diffs.tasks.length +
  (finBill.diffs.chain ? 1 : 0) + finBill.diffs.frozen.length +
  finBill.diffs.stock.filter((x) => x.diff !== 0).length + finBill.diffs.coupons.length
assert(finBill.diffs.openCount === withoutP7, `openCount=${finBill.diffs.openCount} 仅含 P1–P6（不含采购结算）`)

console.log('— 审计留痕：供应商结算全动作 + 验收差异 —')
;['supplier-bill-create', 'supplier-bill-approve', 'supplier-bill-reject', 'supplier-settle',
  'accept-diff-short', 'accept-diff-reject', 'supplier-recon-reship'].forEach((a) => {
  assert(s.auditLogs.some((l) => l.action === a && l.tenantId === 't-star'), `审计包含「${a}」`)
})
assert(s.auditLogs.some((l) => l.module === 'supplier'), '供应商结算审计归类 supplier 模块')

console.log('— 租户隔离：云雀数科看不到星河的账单/差异 —')
s.loginAsMember('m-platform')
s.switchTenant('t-cloud')
assert(s.scopedSupplierBills.length === 0, '云雀供应商账单为空')
assert(s.scopedAcceptDiffs.length === 0, '云雀验收差异为空')
assert(s.computeSupplierRecon().items.length === 0, '云雀采购结算对账为空')

console.log(failed ? `\n共 ${failed} 项失败` : '\n全部通过 🎉')
process.exit(failed ? 1 : 0)
