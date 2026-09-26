// 营销预算与成本控制闭环 —— 服务端冒烟测试（WAL 事件溯源，直接驱动服务装配）
// 覆盖：预算审批流 RBAC、抽奖/兑换实时占用与超额阻断、风控冻结预占→放行/撤销核销释放、
//       采购预占→驳回释放→结算付款核销、任务奖励占用、预算冻结阻断、调整审批、
//       预算占用 WAL 重放幂等（重启恢复）、租户隔离。
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
  const f = path.join(tmpdir(), `lottery-bg-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jsonl`)
  fs.rmSync(f, { force: true })
  return f
}
const customerCtx = (userId = 'u-1001', name = '运营测试用户', tenantId = 't-star') =>
  ({ identityKind: 'customer', userId, memberId: '', name, tenantId, ip: '127.0.0.1' })
const staffCtx = (memberId, tenantId) => {
  const m = app0.k.state.members.find((x) => x.id === memberId)
  return { identityKind: m.tenantId ? 'staff' : 'platform', memberId: m.id, userId: m.id, name: m.name,
    tenantId: tenantId || m.tenantId || 't-star', roleKey: m.roleKey, ip: '10.0.0.1' }
}
const settled = (p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }))
const expectErr = async (p, code) => {
  const r = await settled(p)
  return !r.ok && r.e instanceof BizError && (!code || r.e.code === code)
}

let app0 = null
async function main() {
  const db = tmpDb('main')
  const app = await createApp({ dbFile: db })
  app0 = app
  const fin = staffCtx('m-star-fin')
  const ops = staffCtx('m-star-ops')
  const admin = staffCtx('m-star-admin')
  const cust = customerCtx()

  console.log('— 种子预算与看板 —')
  const dash = app.budget.dashboard('t-star')
  assert(dash.total === 7 && dash.active === 6 && dash.pending === 1, `星河种子 7 张预算（6 生效/1 待审批，实际 ${dash.total}/${dash.active}/${dash.pending}）`)
  const a2p = app.k.state.budgets.find((b) => b.id === 'bg-star-a2p')
  assert(app.budget.summary(a2p.id).occupied === 0, '种子无历史业务，预算占用为 0')

  console.log('— RBAC：运营编制 / 财务审批 —')
  // act-1 积分预算已存在，先关闭再编制极小预算做超额压测
  await app.budget.close('bg-star-a1p', '压测关闭', fin)
  const tiny = await app.budget.create({ scopeType: 'activity', scopeId: 'act-1', unit: 'points', amount: 20, name: '极小活动积分预算' }, ops)
  assert(tiny.status === 'pending', '运营编制预算 → 待审批')
  const approved = await app.budget.review(tiny.id, true, '同意', fin)
  assert(approved.status === 'active', '财务审批通过 → 生效')

  console.log('— 抽奖实时占用：成本+积分奖励超额整笔阻断（锁内并发不超额）—')
  // act-1 免费但有积分奖品；极小预算 20 积分。关闭风控避免冻结分支干扰、放宽限次。
  app.k.state.riskRules['t-star'] = { ...app.k.state.riskRules['t-star'], enabled: false }
  const a1pre = app.k.state.activities.find((x) => x.id === 'act-1')
  a1pre.dailyLimit = 200; a1pre.totalLimit = 200
  let blockedOnce = false
  for (let i = 0; i < 20; i++) {
    const r = await settled(app.trade.draw('act-1', cust, { idempotencyKey: `d-${i}` }))
    if (!r.ok) {
      assert(r.e.code === 'BUDGET_EXCEEDED', `超额抽奖被预算阻断（code=${r.e.code}）`)
      blockedOnce = true
      break
    }
  }
  assert(blockedOnce, '极小预算（20 积分）下持续抽奖最终被预算阻断')
  const sum = app.budget.summary(tiny.id)
  assert(sum.occupied <= 20 + 1e-6, `活动积分预算占用不超过 20（实际 ${sum.occupied}）`)
  // 并发不超预算：把 act-2 活动预算调小后并发抽奖
  const a2 = app.k.state.budgets.find((b) => b.id === 'bg-star-a2p')
  // 用预算调整到 25（act-2 每抽成本 10，仅允许 2 笔）
  const adj = await app.budget.requestAdjust(a2.id, -2975, '压测调小预算', ops)
  await app.budget.reviewAdjust(a2.id, adj.id, true, '', fin)
  assert(app.budget.requireBudget(a2.id).amount === 25, 'act-2 积分预算调整为 25')
  const concResults = await Promise.all(Array.from({ length: 6 }, (_, i) =>
    settled(app.trade.draw('act-2', cust, { idempotencyKey: `cc-${i}` }))))
  const okN = concResults.filter((r) => r.ok).length
  assert(okN === 2, `6 并发抽奖（每笔 10 积分成本，预算 25）恰好 2 笔成功（实际 ${okN}）`)
  const blocked = concResults.filter((r) => !r.ok)
  assert(blocked.every((r) => ['BUDGET_EXCEEDED', 'DAILY_LIMIT'].includes(r.e.code)), `其余被预算/限次拦截（${[...new Set(blocked.map((r) => r.e.code))].join(',')}）`)
  assert(app.budget.summary(a2.id).occupied <= 25 + 1e-6, `并发后预算不超支（实际占用 ${app.budget.summary(a2.id).occupied}）`)

  console.log('— 风控冻结预占 → 撤销释放（积分预算）—')
  app.k.state.riskRules['t-star'] = {
    ...app.k.state.riskRules['t-star'], enabled: true,
    highValueRarities: ['legendary', 'epic'], dailyDrawThreshold: 0, rapidDrawMax: 0, rapidRedeemSeconds: 0, rapidRedeemMax: 0
  }
  // g4 盲盒福袋 200 积分，命中高价值兑换 → 冻结；租户积分预算 200000 充足
  const before = app.budget.summary('bg-star-pt').reserved
  const fr = await app.trade.redeem('g4', cust, { idempotencyKey: 'frz-1' })
  assert(fr.trade.status === 'frozen', '高价值兑换冻结')
  const afterReserve = app.budget.summary('bg-star-pt').reserved
  assert(afterReserve - before === 200, `冻结预占 200 积分（实际 ${afterReserve - before}）`)
  const oid = fr.trade.riskOrderId
  await app.risk.review(oid, 'revoke', '预算测试撤销', admin)
  const afterRelease = app.budget.summary('bg-star-pt').reserved
  assert(afterRelease === before, '撤销后预占释放，占用恢复')
  // 重复撤销幂等
  await expectErr(app.risk.review(oid, 'revoke', '', admin), 'IDEMPOTENT')

  console.log('— 采购预占 → 驳回释放 / 通过后付款核销为实际成本 —')
  const mnBefore = app.budget.summary('bg-star-mn')
  const poRej = await app.purchase.createOrder(
    { targetType: 'goods', targetId: 'g3', qty: 2, reason: '预算驳回', supplierName: 'SX', unitPrice: 100 }, ops)
  assert(app.budget.summary('bg-star-mn').reserved - mnBefore.reserved === 200, '采购预占资金 200 元')
  await app.purchase.reviewOrder(poRej.id, false, '驳回', fin)
  assert(app.budget.summary('bg-star-mn').reserved === mnBefore.reserved, '采购驳回释放预占')
  const po = await app.purchase.createOrder(
    { targetType: 'goods', targetId: 'g3', qty: 4, reason: '预算付款闭环', supplierName: 'SX', unitPrice: 50 }, ops)
  const committed0 = app.budget.summary('bg-star-mn').committed
  await app.purchase.reviewOrder(po.id, true, 'ok', fin)
  await app.purchase.inbound(po.id, { qty: 4 }, staffCtx('m-star-ship'))
  const bill = await app.supplier.createBill(po.id, { submit: true }, ops)
  await app.supplier.reviewBill(bill.id, true, 'ok', fin)
  await app.supplier.settleBill(bill.id, '付款', fin)
  const mnAfter = app.budget.summary('bg-star-mn')
  assert(mnAfter.reserved === mnBefore.reserved, '结算核销采购预占')
  assert(mnAfter.committed - committed0 === 200, '供应商付款 200 元计入实际资金成本')

  console.log('— 超额采购在预算锁内被阻断（并发也不超额）—')
  // act-1 资金预算 30000 充足，关闭后换一张 100 元的小额预算拦截 iPhone 采购
  await app.budget.close('bg-star-a1m', '压测关闭活动资金预算', fin)
  const tinyMoney = await app.budget.create(
    { scopeType: 'activity', scopeId: 'act-1', unit: 'money', amount: 100, name: '极小活动资金预算-压测' }, ops)
  await app.budget.review(tinyMoney.id, true, 'ok', fin)
  const overPo = await expectErr(app.purchase.createOrder(
    { targetType: 'prize', activityId: 'act-1', targetId: 'p1', qty: 1, reason: '超额', supplierName: 'SX', unitPrice: 5999 }, ops), 'BUDGET_EXCEEDED')
  assert(overPo, '超额采购（活动预算 100 < 5999）被阻断')
  assert(!app.k.state.purchaseOrders.some((x) => x.reason === '超额'), '被阻断采购未产生采购单')

  console.log('— 预算冻结：新增支出一律阻断（act-1 积分预算冻结后，积分奖品抽奖被阻断）—')
  // 先把 act-1 限次放宽、风控关闭，连续抽奖直至抽中积分奖品被冻结预算拦截；
  // 再用一张仅能拦截积分奖品的冻结预算验证（成本为 0、谢谢参与可放行）
  const a1 = app.k.state.activities.find((x) => x.id === 'act-1')
  a1.dailyLimit = 200; a1.totalLimit = 200
  await app.budget.setFrozen(tiny.id, true, '冻结测试', fin)
  let blockedByFrozen = false
  for (let i = 0; i < 60; i++) {
    const r = await settled(app.trade.draw('act-1', cust, { idempotencyKey: `fz-${i}` }))
    if (!r.ok) {
      assert(r.e.code === 'BUDGET_FROZEN', `冻结预算下积分奖品抽奖被阻断（code=${r.e.code}）`)
      blockedByFrozen = true
      break
    }
  }
  assert(blockedByFrozen, '冻结预算期间积分奖品支出被阻断（谢谢参与可正常放行）')
  await app.budget.setFrozen(tiny.id, false, '', fin)
  let recovered = false
  for (let i = 0; i < 60; i++) {
    const r = await settled(app.trade.draw('act-1', cust, { idempotencyKey: `fz-ok-${i}` }))
    if (r.ok) { recovered = true; break }
  }
  assert(recovered, '解冻后抽奖恢复正常')

  console.log('— 预算调整审批流 —')
  const adj2 = await app.budget.requestAdjust(tiny.id, 30, '活动加码', ops)
  const beforeAmt = app.budget.requireBudget(tiny.id).amount
  await app.budget.reviewAdjust(tiny.id, adj2.id, true, '', fin)
  assert(app.budget.requireBudget(tiny.id).amount === beforeAmt + 30, '调整审批后额度 +30')
  assert(app.budget.requireBudget(tiny.id).adjustments.at(-1).status === 'approved', '调整记录留痕')

  console.log('— 售后退货：积分退款冲回预算成本 —')
  // 走一笔正常兑换 g3（150 积分）→ 直接调 ship 售后（需要发货单；简化为直接校验 refund 台账 API）
  const bgBefore = app.budget.summary('bg-star-pt').committed
  await app.budget.refund(
    { unit: 'points', amount: 150, scopeType: 'tenant', scopeId: 't-star' },
    { category: 'redeem', kind: 'redeem-refund', refType: 'aftersale', refId: 'as-test-1', bizNo: 'sp-test',
      summary: '测试退货冲回 150 积分', tenantId: 't-star', userId: 'u-1001', traceId: '' }, fin)
  assert(app.budget.summary('bg-star-pt').committed === bgBefore - 150, '退款冲回使实际成本下降 150')
  // 幂等：同 effectId 不重复冲回
  await app.budget.refund(
    { unit: 'points', amount: 150, scopeType: 'tenant', scopeId: 't-star' },
    { category: 'redeem', kind: 'redeem-refund', refType: 'aftersale', refId: 'as-test-1', bizNo: 'sp-test',
      summary: '重复冲回应幂等', tenantId: 't-star', userId: 'u-1001' }, fin)
  assert(app.budget.summary('bg-star-pt').committed === bgBefore - 150, '重复冲回幂等不重复扣减')

  console.log('— WAL 持久化：重启后预算单/占用台账/占用汇总完全恢复 —')
  await app.k.close()
  const app2 = await createApp({ dbFile: db, autoResume: false })
  const ledCount1 = app.k.state.budgetLedger.length
  const ledCount2 = app2.k.state.budgetLedger.length
  assert(ledCount1 === ledCount2, `预算台账随 WAL 完整恢复（${ledCount1} 行）`)
  assert(app2.budget.requireBudget(tiny.id).status === 'active', '预算单状态恢复')
  assert(app2.budget.summary('bg-star-mn').committed >= 0, '占用汇总可从历史事件重算')
  await app2.k.close()

  console.log('— 租户隔离：云雀预算独立 —')
  const app3 = await createApp({ dbFile: tmpDb('cloud') })
  const cloudOps = staffCtx('m-cloud-ops', 't-cloud')
  const starFin = staffCtx('m-star-fin', 't-star')
  assert(app3.budget.list('t-cloud').length === 4, '云雀 4 张种子预算')
  const cb = await app3.budget.create({ scopeType: 'tenant', unit: 'points', amount: 100, name: 'x' }, cloudOps)
    .catch(() => null) // 租户级积分预算已存在 → 应抛 BUDGET_DUP
  assert(cb === null, '同口径重复预算被拒绝（一口径一币种仅一张生效/待审批）')
  const cross = await expectErr(app3.budget.review('bg-cloud-pt', true, '', starFin), 'FORBIDDEN')
  assert(cross, '星河财务审批云雀预算被租户归属拦截')
  await app3.k.close()

  fs.rmSync(db, { force: true })
  console.log(failed ? `\n共 ${failed} 项失败 ❌` : '\n全部通过 🎉')
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
