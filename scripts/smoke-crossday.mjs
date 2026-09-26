// 统一跨日续办逻辑冒烟测试：
//   风控放行/撤销、任务结算、售后补发（含缺货挂起→采购入库→继续履约）
//   三类 Saga 统一「processing 锚点 + stages 幂等 + 启动续办」；
//   统一按「归属业务日 bizDate / 实际处理日 date」双日分账；
//   校验积分、库存（业务账/处理日记账双口径）、审计、对账（历史业务日不串账）一致。
import { tmpdir } from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { createApp } from '../server/app.js'
import { BizError } from '../server/util.js'

let failed = 0
const assert = (cond, msg) => {
  if (cond) console.log('  ✅', msg)
  else { console.error('  ❌', msg); failed++ }
}
const tmpDb = (name) => {
  const f = path.join(tmpdir(), `lottery-xday-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jsonl`)
  fs.rmSync(f, { force: true })
  return f
}
const custCtx = (app, userId = 'u-1001') =>
  ({ identityKind: 'customer', userId, memberId: '', name: '运营测试用户', tenantId: 't-star', ip: '127.0.0.1' })
const staffCtx = (app, id) => {
  const m = app.k.state.members.find((x) => x.id === id)
  return { identityKind: 'staff', memberId: m.id, userId: m.id, name: m.name, tenantId: m.tenantId || 't-star', ip: '10.0.0.1' }
}

// —— 场景 A：售后补发跨日审核（day1 申请，day2 审核）——
// 库存/积分/审计按 day2 归属；day1 历史对账不含该笔，day2 含；双日各自平衡。
async function afterSaleCrossDay() {
  console.log('— 售后补发跨日审核：申请日与审核日分账，历史业务日不串账 —')
  const db = tmpDb('as-xday')
  let app = await createApp({ dbFile: db })
  const day1 = '2026-09-20', day2 = '2026-09-21'
  app.k.setBusinessDay(day1)
  app.k.state.riskRules['t-star'] = { ...app.k.state.riskRules['t-star'], enabled: false, dailyDrawThreshold: 0, rapidDrawMax: 0 }
  const customer = custCtx(app)
  const shipStaff = staffCtx(app, 'm-star-ship')

  // 兑换实物 g3 → 填地址 → 发货 → 收货（全部在 day1）
  const rec = await app.trade.redeem('g3', customer, { idempotencyKey: 'as-x-1' })
  const sp = await app.ship.createForRecord(app.k.state.records.find((x) => x.id === rec.trade.id))
  await app.ship.submitAddress(sp.shipment.id,
    { receiver: '张三', phone: '13812345678', region: '上海市浦东新区', address: '张江路1号' }, customer)
  await app.ship.ship(sp.shipment.id, { carrier: '顺丰', trackingNo: 'SFX' }, shipStaff)
  await app.ship.receive(sp.shipment.id, customer)
  const g3 = () => app.k.state.goods.find((g) => g.id === 'g3')
  const remainDay1 = g3().remain

  // day1 申请补发（待审核，不动账）
  const asRow = await app.ship.applyAfterSale(sp.shipment.id, 'reship', '跨日：少件申请补发', customer)
  assert(asRow.status === 'pending' && asRow.createdAt === day1, 'day1 提交补发申请（待审核）')
  assert(g3().remain === remainDay1, '待审核期间库存不动')

  // day1 对账平衡（补发尚未成立）
  const d1before = app.recon.compute(day1, 't-star')
  assert(d1before.openCount === 0, `day1 审核前对账平衡（open=${d1before.openCount}）`)

  // 跨日 day2 审核通过
  app.k.setBusinessDay(day2)
  const done = await app.ship.reviewAfterSale(asRow.id, true, '跨日审核同意补发', shipStaff)
  assert(done.status === 'done' && !!done.reshipmentId, 'day2 补发审核通过并生成补发单')
  assert(g3().remain === remainDay1 - 1, '补发按 day2 扣减库存 1')

  // 库存台账：补发扣减 bizDate/date 均为 day2（处理日=归属日），不含 day1
  const led = app.k.state.stockLedger.filter((x) => x.refId === asRow.id)
  assert(led.length === 1 && led[0].dRemain === -1 && led[0].bizDate === day2 && led[0].date === day2,
    '补发库存台账按审核日 day2 双日留痕（不串 day1）')
  // 审计：ship-create 与 aftersale-approve 落在 day2，aftersale-apply 在 day1
  const approveLog = app.k.state.auditLogs.find((l) => l.action === 'aftersale-approve' && l.orderId === asRow.id)
  const applyLog = app.k.state.auditLogs.find((l) => l.action === 'aftersale-apply' && l.orderId === asRow.id)
  assert(approveLog?.bizDate === day2 && approveLog.date === day2, '审核通过审计归属处理日 day2')
  assert(applyLog?.date === day1, '申请审计归属申请日 day1')

  // day1 历史对账：补发在 day2，不串入 day1；day1 仍平衡
  const d1 = app.recon.compute(day1, 't-star')
  const g3d1 = d1.stock.find((x) => x.targetId === 'g3')
  assert(g3d1.diff === 0 && g3d1.actual === remainDay1, `day1 库存账实仍平衡（actual=${g3d1.actual}），补发未串入`)
  assert(!g3d1 || g3d1.asReshipped === 0, 'day1 无 day2 的售后补发修正')
  // day2 对账：含补发扣减，平衡
  const d2 = app.recon.compute(day2, 't-star')
  const g3d2 = d2.stock.find((x) => x.targetId === 'g3')
  assert(g3d2.diff === 0 && g3d2.asReshipped === 1 && g3d2.actual === remainDay1 - 1,
    `day2 库存账实平衡且含补发修正（actual=${g3d2.actual}）`)
  await app.k.close()
}

// —— 场景 B：售后 Saga 崩溃续办（在退款/回补后崩溃，重启续办不重复）——
async function afterSaleCrashResume() {
  console.log('— 售后退货 Saga 崩溃续办：退款/回补幂等不重复、终态完整 —')
  const db = tmpDb('as-crash')
  let app = await createApp({ dbFile: db })
  app.k.state.riskRules['t-star'] = { ...app.k.state.riskRules['t-star'], enabled: false, dailyDrawThreshold: 0, rapidDrawMax: 0 }
  const customer = custCtx(app)
  const shipStaff = staffCtx(app, 'm-star-ship')
  const rec = await app.trade.redeem('g3', customer, { idempotencyKey: 'as-c-1' })
  const sp = await app.ship.createForRecord(app.k.state.records.find((x) => x.id === rec.trade.id))
  await app.ship.submitAddress(sp.shipment.id,
    { receiver: '李四', phone: '13812345678', region: '北京市海淀区', address: '中关村1号' }, customer)
  await app.ship.ship(sp.shipment.id, { carrier: '韵达', trackingNo: 'YDC' }, shipStaff)
  await app.ship.receive(sp.shipment.id, customer)
  const asRow = await app.ship.applyAfterSale(sp.shipment.id, 'return', '质量问题退货', customer)
  const g3 = () => app.k.state.goods.find((g) => g.id === 'g3')
  const remainBefore = g3().remain
  const pointsBefore = app.points.balanceOf('u-1001')

  // 在「库存回补后、退款前」崩溃
  app.k.injectFault('aftersale.afterRestock')
  let crashed = null
  try { await app.ship.reviewAfterSale(asRow.id, true, '同意退货', shipStaff) } catch (e) { crashed = e }
  assert(crashed instanceof BizError && crashed.code === 'CRASH_INJECTED', '退货 Saga 在回补后中断（processing 锚点）')
  const mid = app.k.state.afterSales.find((x) => x.id === asRow.id)
  assert(mid.processing === true && mid.stages.restock === true, '崩溃时锚点 + restock stage 已落库')
  await app.k.close()

  // 重启自动续办
  app = await createApp({ dbFile: db })
  const done = app.k.state.afterSales.find((x) => x.id === asRow.id)
  assert(done.status === 'done' && !done.processing, '重启后售后单自动续办到 done')
  assert(app.k.state.goods.find((g) => g.id === 'g3').remain === remainBefore + 1, '库存仅回补 1 次')
  assert(app.points.balanceOf('u-1001') === pointsBefore + 150, '积分仅退款 150 一次')
  const refunds = app.k.state.pointFlows.filter((p) => p.refId === asRow.id && p.kind === 'refund')
  assert(refunds.length === 1, `退款流水仅一笔（实际 ${refunds.length}）`)
  const restockLed = app.k.state.stockLedger.filter((x) => x.refId === asRow.id)
  assert(restockLed.length === 1 && restockLed[0].dRemain === 1, `回补台账仅一行 +1（实际 ${restockLed.length}）`)
  const spRow = app.k.state.shipments.find((x) => x.id === sp.shipment.id)
  assert(spRow.status === 'returned', '发货单续办为已退回')

  // 手工再次续办幂等（无新增）
  const again = await app.ship.resumeProcessing()
  assert(again.length === 0, '再次扫描无遗留 processing 售后单')
  const today = app.k.todayDate()
  assert(app.recon.compute(today, 't-star').openCount === 0, '续办后当日对账平衡')
  await app.k.close()
}

// —— 场景 C：缺货挂起 → 跨日采购入库 → 继续履约（处理日分账 + 预占核销）——
async function shortageCrossDayResume() {
  console.log('— 缺货挂起跨日：day1 挂起不落账，day2 入库后续办，预算预占核销不重复 —')
  const db = tmpDb('as-short')
  let app = await createApp({ dbFile: db, autoResume: false })
  app.k.state.riskRules['t-star'] = { ...app.k.state.riskRules['t-star'], enabled: false, dailyDrawThreshold: 0, rapidDrawMax: 0 }
  const day1 = '2026-09-22', day2 = '2026-09-23'
  app.k.setBusinessDay(day1)
  const customer = custCtx(app)
  const ops = staffCtx(app, 'm-star-ops'), fin = staffCtx(app, 'm-star-fin'), shipStaff = staffCtx(app, 'm-star-ship')

  // 把 g3 余量清零（fixture 只压 remain）
  {
    const row = app.k.findStock('goods:g3')
    const shrink = row.row.remain
    if (shrink > 0) {
      await app.k.commit([{ type: 'inv.mut', key: 'goods:g3', dRemain: -shrink, dFrozen: 0,
        effectId: 'fixture:g3-zero', kind: 'fixture-adjust', refType: 'test', refId: 'zero', tenantId: 't-star' }])
    }
  }
  // 造一笔已收货记录（先补 1 件用于兑换，再兑掉，最终缺货）
  await app.k.commit([{ type: 'inv.mut', key: 'goods:g3', dRemain: 1, dFrozen: 0,
    effectId: 'fixture:g3-one', kind: 'fixture-adjust', refType: 'test', refId: 'one', tenantId: 't-star' }])
  const rec = await app.trade.redeem('g3', customer, { idempotencyKey: 'as-s-1' })
  const sp = await app.ship.createForRecord(app.k.state.records.find((x) => x.id === rec.trade.id))
  await app.ship.submitAddress(sp.shipment.id,
    { receiver: '王五', phone: '13812345678', region: '广州市', address: '天河路1号' }, customer)
  await app.ship.ship(sp.shipment.id, { carrier: '中通', trackingNo: 'ZTO' }, shipStaff)
  await app.ship.receive(sp.shipment.id, customer)
  const asRow = await app.ship.applyAfterSale(sp.shipment.id, 'reship', '缺货补发', customer)
  const waiting = await app.ship.reviewAfterSale(asRow.id, true, '缺货挂起', shipStaff)
  assert(waiting.status === 'waiting_stock', 'day1 补发缺货挂起待补货')

  // day1 对账平衡（挂起不落账，无补发扣减）
  assert(app.recon.compute(day1, 't-star').openCount === 0, 'day1 挂起不落账，对账平衡')

  // 跨日 day2 采购入库 10 件 → 继续履约
  app.k.setBusinessDay(day2)
  const po = await app.purchase.createOrder(
    { targetType: 'goods', targetId: 'g3', qty: 10, reason: '跨日补发采购', afterSaleId: asRow.id, supplierName: '供应商A', unitPrice: 12 },
    ops)
  await app.purchase.reviewOrder(po.id, true, '加急', fin)
  await app.purchase.inbound(po.id, { qty: 10 }, shipStaff)
  const cont = await app.ship.reviewAfterSale(asRow.id, true, '入库后继续履约', shipStaff)
  assert(cont.status === 'done' && !!cont.reshipmentId, 'day2 继续履约完成、生成补发单')
  const g3 = app.k.state.goods.find((g) => g.id === 'g3')
  assert(g3.remain === 9, '入库 10 后补发扣 1：remain=9')

  // 预算：同一售后补发件只有一条 settle 成本（reserve 已在 day1 挂起时预占），不重复计价
  const reshipLedger = app.k.state.budgetLedger.filter((l) => l.refType === 'aftersale' && l.refId === asRow.id)
  const settleRows = reshipLedger.filter((l) => l.direction === 'settle')
  const reserveRows = reshipLedger.filter((l) => l.direction === 'reserve')
  assert(settleRows.length >= 1, '挂起预占在继续履约时核销为实际成本')
  assert(reserveRows.every((r) => r.bizDate === day1) && settleRows.every((r) => r.bizDate === day2),
    '预算台账：预占归属 day1、核销归属 day2（跨日分账）')

  // day1/day2 库存各自平衡，day1 不含 day2 的入库与补发
  const d1 = app.recon.compute(day1, 't-star')
  const d2 = app.recon.compute(day2, 't-star')
  assert(d1.openCount === 0 && d2.openCount === 0, `跨日缺货续办双日均平衡（d1=${d1.openCount}, d2=${d2.openCount}）`)
  const g3d1 = d1.stock.find((x) => x.targetId === 'g3')
  const g3d2 = d2.stock.find((x) => x.targetId === 'g3')
  assert(g3d1.asReshipped === 0 && g3d2.asReshipped === 1, '补发修正仅计入 day2')
  assert(g3d2.inbound - g3d1.inbound === 10, '采购入库 10 件仅计入 day2')
  await app.k.close()
}

async function main() {
  await afterSaleCrossDay()
  await afterSaleCrashResume()
  await shortageCrossDayResume()
  if (failed) { console.error(`\n共 ${failed} 项失败 ❌`); process.exit(1) }
  console.log('\n全部通过 🎉')
  process.exit(0)
}
main()
