// 积分库存对账 —— 逻辑冒烟测试（esbuild 打包后在 node 运行）
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
const d1 = today // 别名
let bill = null
const openCount = (date) => s.reconBillOf(date)?.diffs.openCount

console.log('— 种子初始：今日账实相符 —')
s.runRecon(today, true)
bill = s.reconBillOf(today)
assert(bill.status === 'balanced', `今日初始对账平衡（openCount=${bill.diffs.openCount}）`)
assert(bill.diffs.points.residual === 0, `P1 积分净额残差=0（应有 ${bill.diffs.points.expectedNet} / 流水 ${bill.diffs.points.ledgerNet}）`)
assert(bill.diffs.chain === null, 'P3 余额链连续，余额与最新流水快照一致')
assert(bill.diffs.frozen.length === 0, 'P4 冻结单据/预占全部一致')
assert(!bill.diffs.stock.some((x) => x.diff !== 0), 'P5 库存账实相符')

console.log('— 种子初始：历史业务日存在一笔任务奖励漏记 —')
const yd = s.reconDates.find((d) => d !== today)
s.runRecon(yd, true)
const yb = s.reconBillOf(yd)
assert(yb.status === 'pending', `${yd} 差异单待复核（status=${yb.status}）`)
const gap = yb.diffs.tasks.find((t) => t.claimId === 'seed-tc-gap')
assert(gap && gap.reward === 5, 'P2 检出历史漏记领奖台账（每日签到 5 积分）')
assert(yb.diffs.points.residual === 5, `P1 积分净额残差=5（实际 ${yb.diffs.points.residual}，业务真实、流水少记）`)

console.log('— 非运营无权复核/补偿 —')
s.setRole('user')
assert(s.reviewRecon(yd) === false, '用户视角复核被拦截')
assert(s.compensateRecon(yd) === null, '用户视角补偿被拦截')

console.log('— 运营复核 + 跨日补偿（历史漏记） —')
s.setRole('operator')
assert(s.compensateRecon(yd) === null, '未复核不能直接补偿')
s.reviewRecon(yd, '核对台账属实，准予补记')
const ptsBefore = s.points
const res = s.compensateRecon(yd)
assert(res && res.pointDelta === 5, `补偿补记 +5 积分（实际 ${res?.pointDelta}）`)
assert(s.points === ptsBefore + 5, '补偿同步余额 +5')
const yb2 = s.reconBillOf(yd)
assert(yb2.status === 'compensated', '历史差异单已补偿平账')
assert(yb2.diffs.tasks.length === 0 && yb2.diffs.points.residual === 0, '重新对账：P1/P2 全部抹平')
assert(yb2.diffs.chain === null, 'P3 余额链随补偿入账自愈')
const compFlow = s.pointRecords.find((p) => p.kind === 'task-comp' && p.refId === 'seed-tc-gap')
assert(compFlow && compFlow.bizDate === yd && compFlow.date === today,
  '补偿流水 append-only：归属业务日为昨日、实际处理日为今日（跨日可追溯）')
assert(yb2.compensations.length === 1 && yb2.runs.length >= 2, '补偿凭证与多次执行痕迹保留')

console.log('— 幂等：重复执行/重复补偿不产生重复流水 —')
const flowN = s.pointRecords.length
s.runRecon(yd, true)
s.runRecon(yd, true)
const yb3 = s.reconBillOf(yd)
assert(yb3.status === 'balanced' || yb3.status === 'compensated', '重复执行保持平账，不重建差异单')
assert(s.pointRecords.length === flowN, '平账后重复执行不新增流水')
assert(s.compensateRecon(yd) === null, '已平账单重复补偿零操作')
assert(s.pointRecords.length === flowN, '无重复补偿流水')

console.log('— 历史流水留存：超过演示条数也不裁剪底账，不制造虚假缺笔 —')
const historyDates = s.reconDates
const oldestDate = historyDates[historyDates.length - 1]
const oldestClaims = s.taskClaims.filter((c) => c.bizDate === oldestDate)
const flowCountBefore = s.pointRecords.length
const pointsBeforeRetention = s.points
for (let i = 0; i < 301; i++) {
  s.addPointRecord(0, `留存压测流水 ${i + 1}`, 'normal', { ts: Date.now() + i })
}
assert(s.pointRecords.length === flowCountBefore + 301,
  `流水超过 300 条仍完整保留（实际 ${s.pointRecords.length}）`)
assert(s.points === pointsBeforeRetention, '零发生额压测流水不影响余额')
assert(!!s.pointRecords.find((p) => p.id === 'seed-pr1'),
  '最老任务发奖流水未被裁剪')
assert(oldestClaims.every((c) => s._taskClaimFlow(c)),
  '每个历史领奖台账仍能精确勾稽到发奖流水')
s.runRecon(oldestDate, true)
const oldestBill = s.reconBillOf(oldestDate)
assert(oldestBill.status === 'balanced' && oldestBill.diffs.openCount === 0,
  `历史业务日无虚假差异（residual=${oldestBill.diffs.points.residual}，缺笔=${oldestBill.diffs.tasks.length}）`)
assert(oldestBill.diffs.chain === null, '完整流水重放后余额链连续')
const compForOldestBefore = s.pointRecords
  .filter((p) => p.kind === 'task-comp' && oldestClaims.some((c) => c.id === p.refId)).length
assert(s.compensateRecon(oldestDate) === null, '已发任务奖励不会被对账补偿再次补发')
const compForOldestAfter = s.pointRecords
  .filter((p) => p.kind === 'task-comp' && oldestClaims.some((c) => c.id === p.refId)).length
assert(compForOldestAfter === compForOldestBefore, '未新增任何历史任务补偿流水')
s.runRecon(oldestDate, true)

console.log('— 今日注入差异：任务漏记 + 库存盘亏 —')
s.injectTaskFlowGap()
s.injectStockLoss()
s.runRecon(today, true)
const tb = s.reconBillOf(today)
assert(tb.status === 'pending', '今日差异单待复核')
const tGap = tb.diffs.tasks.find((t) => t.claimId === `inject-gap-t-star-${today}`)
assert(tGap && tGap.reward === 30, 'P2 检今日任务漏记 +30')
assert(tb.diffs.points.residual === 30, `P1 残差=30（实际 ${tb.diffs.points.residual}）`)
const g1 = s.goods.find((x) => x.id === 'g1')
const stockDiff = tb.diffs.stock.find((x) => x.targetId === 'g1')
assert(stockDiff && stockDiff.diff === 1, `P5 检出 g1 盘亏：应有比账面多 1（实际 diff=${stockDiff?.diff}，账 ${g1.remain}）`)

console.log('— 复核后一次性补偿积分与库存 —')
const beforeRemain = g1.remain
const ptsBefore2 = s.points
const adjN = s.stockAdjustments.length
s.reviewRecon(today)
const r2 = s.compensateRecon(today)
assert(r2.pointDelta === 30, `积分补记 +30（实际 ${r2.pointDelta}）`)
assert(r2.stockCount === 1, `库存校正 1 项（实际 ${r2.stockCount}）`)
assert(g1.remain === beforeRemain, `盘亏按调整凭证核销，实物账不变（${g1.remain}）`)
assert(s.stockAdjustments[0].delta === -1, '库存调整凭证 -1（盘亏核销，非凭空回补）')
assert(s.points === ptsBefore2 + 30, '余额同步 +30')
assert(s.stockAdjustments.length === adjN + 1, '库存校正台账追加一条（append-only）')
const tb2 = s.reconBillOf(today)
assert(tb2.status === 'compensated', '今日差异单补偿平账')
assert(!tb2.diffs.stock.some((x) => x.diff !== 0), 'P5 全部账实相符')

console.log('— 跨日审核联动：风控放行按审核日入账，任务奖励归属原业务日 —')
s.riskRules.enabled = false
s.runRecon(today, true) // 补偿后今日仍平衡
assert(openCount(today) === 0, '补偿平账后今日无未平差异')
const ptsBefore3 = s.points
s.releaseRisk('seed-rk6', '跨日放行演示') // 归属昨日的冻结单今日放行 → 任务按昨日补计 +15
assert(s.points === ptsBefore3 + 15, '跨日放行补发任务奖励 +15（今日实际发放）')
s.runRecon(today, true)
assert(openCount(today) === 0, `跨日审核后今日账实相符（openCount=${openCount(today)}，补计归属昨日不串当日）`)
s.runRecon(yd, true)
assert(openCount(yd) === 0, `昨日差异单纳入跨日补计后仍平衡（openCount=${openCount(yd)}）`)
const yBill = s.reconBillOf(yd)
assert(yBill.diffs.points.detail.some((e) => e.label.includes('今日抽奖3次') && e.delta === 15),
  '昨日对账明细包含跨日补计 +15（标注实际入账日）')
assert(s.pointRecords.some((p) => p.note.includes('补计') && p.bizDate === yd && p.date === today),
  '补计流水：bizDate=昨日、date=今日')

console.log('— 看板与角标同步 —')
assert(s.dashboard.reconDays >= 2, `看板：已对账业务日 ${s.dashboard.reconDays}`)
assert(s.dashboard.reconOpen === 0, `看板：待复核差异单 ${s.dashboard.reconOpen}（全部已平）`)
assert(s.dashboard.reconCompensated === 35, `看板：对账补偿积分 35（实际 ${s.dashboard.reconCompensated}；跨日自动结算的 +15 属正常任务结算，不计补偿）`)
assert(s.dashboard.stockAdjCount === 1, `看板：库存校正 1 次（实际 ${s.dashboard.stockAdjCount}）`)
assert(s.reconOpenCount === 0, 'Tab 角标：无待处理差异单')

console.log('— 原始记录保留 —')
assert(s.records.find((r) => r.id === 'seed-r6')?.status === 'released', '原始业务记录状态完整（放行）')
assert(s.stockAdjustments[0].before === s.stockAdjustments[0].after && s.stockAdjustments[0].after === g1.remain,
  '库存校正保留实物账前/后快照（盘亏以调整凭证核销，实物不凭空回补）')
assert(s.auditLogs.filter((l) => l.action === 'recon-comp').length >= 2, '审计日志保留全部补偿操作')

console.log(failed ? `\n共 ${failed} 项失败` : '\n全部通过 🎉')
process.exit(failed ? 1 : 0)
