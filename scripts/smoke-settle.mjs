// 抽奖任务自动结算 —— 逻辑冒烟测试（esbuild 打包后在 node 运行）
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
const claimsOf = (bizDate) => s.taskClaims.filter((c) => c.bizDate === bizDate && c.taskId === 't-draw3')

console.log('— 种子台账（按业务日保留）—')
const today = s.todayDate
const books = s.taskDayBooks
const d1Book = books.find((b) => !b.isToday && b.tasks[0].pending === 1)
const d2Book = books[books.length - 1]
assert(s.validDrawCount(today) === 1, `今日有效参与=1（实际 ${s.validDrawCount(today)}，已放行计入）`)
assert(s.pendingDrawCount(today) === 2, `今日审核中=2（实际 ${s.pendingDrawCount(today)}，冻结暂缓计入）`)
assert(d1Book && d1Book.tasks[0].progress === 2 && !d1Book.tasks[0].claim, '昨日 2/3 未达成（1 笔冻结暂缓）')
assert(d2Book && d2Book.tasks[0].claim?.reward === 15, '前日 3/3 已结算 +15（台账保留）')
assert(claimsOf(today).length === 0, '今日未结算')

console.log('— 抽奖任务禁止手动领取 —')
const claimsBefore = s.taskClaims.length
s.completeTask('t-draw3')
assert(s.taskClaims.length === claimsBefore, '手动点击不发奖（自动结算）')

console.log('— 真实参与累计进度 + 达标自动结算 —')
s.riskRules.enabled = false // 关闭风控，走正常参与路径
const r1 = s.draw('act-2')
const r2 = s.draw('act-2')
assert(r1?.status === 'normal' && r2?.status === 'normal', '两次真实抽奖正常落账')
assert(s.validDrawCount(today) === 3, `今日有效参与=3（实际 ${s.validDrawCount(today)}）`)
assert(claimsOf(today).length === 1, '达标后自动结算，生成今日领奖记录')
assert(claimsOf(today)[0].bizDate === today && claimsOf(today)[0].grantDate === today, '领奖记录归属今日')
assert(s.pointRecords.some((p) => p.note === '任务结算：今日抽奖3次' && p.delta === 15), '积分流水同步 +15（任务结算）')
assert(claimsOf(today)[0].flowId &&
  s.pointRecords.some((p) => p.refType === 'task-claim' && p.refId === claimsOf(today)[0].id),
  '领奖台账与发奖流水通过 claimId 双向勾稽')
const st = s.drawTaskState('t-draw3')
assert(st.claimed && st.done, '任务状态：已达标已结算')

console.log('— 幂等防重复发奖 —')
const n0 = s.taskClaims.length
s.settleDrawTasks(today)
s.settleDrawTasks(today)
assert(s.taskClaims.length === n0, '重复结算不产生重复领奖记录/重复发奖')

console.log('— 跨日审核放行：按归属业务日补计 —')
s.setRole('operator')
const d1 = d1Book.date
const ptsBefore = s.points
s.releaseRisk('seed-rk6', '核实正常，放行')
assert(claimsOf(d1).length === 1, '昨日任务补计结算，生成昨日领奖记录')
assert(claimsOf(d1)[0].grantDate === today, `实际发放日为今日（grantDate=${claimsOf(d1)[0].grantDate}）`)
assert(s.points === ptsBefore + 15, `补计发奖 +15（${ptsBefore} → ${s.points}）`)
assert(s.pointRecords.some((p) => p.note.includes('补计') && p.delta === 15), '积分流水标注跨日补计')
assert(claimsOf(today).length === 1, '今日领奖记录不受跨日审核影响（不串账）')
assert(s.taskDayBooks.find((b) => b.date === d1).tasks[0].claim, '昨日台账显示已结算')

console.log('— 撤销回退：冻结单不计入，撤销后确认回退 —')
const claimsN = s.taskClaims.length
s.revokeRisk('seed-rk1', '确认风险，撤销')
const rec1 = s.records.find((r) => r.id === 'seed-r1')
assert(rec1.status === 'revoked', '冻结抽奖已撤销')
assert(s.validDrawCount(today) === 3, `今日有效参与仍=3（撤销的冻结单从未计入，实际 ${s.validDrawCount(today)}）`)
assert(s.taskClaims.length === claimsN, '撤销不产生/不回收领奖记录（该笔从未计入）')
const iphone = s.activities.find((a) => a.id === 'act-1').prizes.find((p) => p.id === 'p1')
assert(iphone.remain === 3 && iphone.frozen === 0, '撤销后库存回补、预占释放')

console.log('— 台账跨日隔离 —')
const d1After = s.taskDayBooks.find((b) => b.date === d1)
assert(d1After.tasks[0].progress === 3 && d1After.tasks[0].pending === 0, '昨日台账：3/3 已结算、无审核中')
assert(s.taskDayBooks.length === 3, `台账按业务日分册（共 ${s.taskDayBooks.length} 日）`)

console.log(failed ? `\n共 ${failed} 项失败` : '\n全部通过 🎉')
process.exit(failed ? 1 : 0)
