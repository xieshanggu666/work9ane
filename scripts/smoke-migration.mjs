// 历史台账迁移冒烟测试：
//  1) 旧 Pinia store 快照 → 服务端事件库（行级固定 id 幂等）；
//  2) 迁移前校验拦截断裂快照（整批拒绝、零落库）；
//  3) 迁移后余额链/库存/冻结/卡券全部可重放，历史 5 积分漏记由 P1/P2 检出并补偿平账；
//  4) 迁移批次幂等（同批次重跑零增量）。
import { tmpdir } from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { createApp } from '../server/app.js'
import { MigrationService } from '../server/services/migration.js'
import { AuditService } from '../server/services/audit.js'
import { extractLegacySnapshot } from '../server/legacy-snapshot.js'
import { BizError } from '../server/util.js'

let failed = 0
const assert = (cond, msg) => {
  if (cond) console.log('  ✅', msg)
  else { console.error('  ❌', msg); failed++ }
}
const tmpDb = (name) => {
  const f = path.join(tmpdir(), `lottery-mig-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jsonl`)
  fs.rmSync(f, { force: true })
  return f
}

async function main() {
  const snapshot = extractLegacySnapshot()
  console.log(`— 提取旧台账快照：流水 ${snapshot.pointRecords.length} 行、记录 ${snapshot.records.length} 笔、卡券 ${snapshot.coupons.length} 张 —`)

  console.log('— 迁移前校验：断裂快照被整批拒绝 —')
  let app = await createApp({ dbFile: tmpDb('invalid'), seed: false, autoResume: false })
  const migration = new MigrationService({ k: app.k, audit: new AuditService(app.k) })
  const bad = JSON.parse(JSON.stringify(snapshot))
  // 篡改一条历史流水的余额快照 → 余额链断裂
  bad.pointRecords[0].balance = bad.pointRecords[0].balance + 999
  const errors = migration.validate(bad)
  assert(errors.some((e) => e.includes('余额链断裂')), `校验检出余额链断裂（${errors.find((e) => e.includes('余额链断裂'))?.slice(0, 40)}…）`)
  let rejected = null
  try {
    await migration.run(bad, { batchId: 'mig-bad-1' })
  } catch (e) { rejected = e }
  assert(rejected instanceof BizError && rejected.status === 422, `校验失败整批拒绝（${rejected?.code}）`)
  assert(app.k.state.pointFlows.length === 0 && app.k.state.tenants.length === 0, '拒绝后零事件落库')
  await app.k.close()

  console.log('— 正式迁移：行级固定 id 重建事件库 —')
  const db = tmpDb('good')
  app = await createApp({ dbFile: db, seed: false, autoResume: false })
  const mig = new MigrationService({ k: app.k, audit: new AuditService(app.k) })
  const validErrors = mig.validate(JSON.parse(JSON.stringify(snapshot)))
  assert(validErrors.length === 0, `原始旧快照校验通过（${validErrors.length} 项问题）`)
  const { manifest } = await mig.run(JSON.parse(JSON.stringify(snapshot)), { ctx: { name: '迁移专员' } })
  assert(manifest.counts.pointFlows === snapshot.pointRecords.length,
    `manifest 统计原始流水 ${manifest.counts.pointFlows} 行（另追加 1 行期初结转调平余额链）`)
  assert(app.k.state.pointFlows.length === snapshot.pointRecords.length + 1,
    `事件库流水 = 原始 ${snapshot.pointRecords.length} 行 + 1 行期初结转（实际 ${app.k.state.pointFlows.length}）`)
  assert(manifest.counts.records === snapshot.records.length, `业务记录迁移 ${manifest.counts.records} 笔`)
  assert(manifest.counts.coupons === snapshot.coupons.length, `卡券迁移 ${manifest.counts.coupons} 张`)
  assert(manifest.status === 'done' && manifest.checksum.length === 64, '迁移批次带 sha256 校验和')

  // 分户余额勾稽（旧平台钱包为单用户 u-1001）
  const bal = app.points.balanceOf('u-1001')
  assert(bal === snapshot.legacyPoints, `分户余额 ${bal} == 旧 store points ${snapshot.legacyPoints}`)
  // 余额链逐笔连续
  const sorted = app.k.state.pointFlows.filter((p) => p.userId === 'u-1001').sort((a, b) => a.ts - b.ts)
  let run = 0, chainOk = true
  for (const p of sorted) { run += p.delta; if (p.balance !== run) { chainOk = false; break } }
  assert(chainOk, `重放 ${sorted.length} 行流水余额快照逐笔连续，链尾 ${run} == 分户余额 ${bal}`)

  // 租户/活动/库存迁移
  assert(app.k.state.tenants.length === 2, '双租户迁移')
  assert(app.k.state.activities.length === 3, '活动迁移（星河 2 + 云雀 1）')
  const iphone = app.k.state.activities.find((a) => a.id === 'act-1').prizes.find((p) => p.id === 'p1')
  assert(iphone.remain === 2 && iphone.frozen === 1, `冻结预占迁移（iPhone remain=${iphone.remain}/frozen=${iphone.frozen}）`)
  assert(app.k.state.riskOrders.length === snapshot.riskOrders.length, '风控审核单（含跨日待审）迁移')
  assert(app.k.state.shipments.length === snapshot.shipments.length, '发货单迁移')
  assert(app.k.state.afterSales.length === snapshot.afterSales.length, '售后单迁移')
  assert(app.k.state.taskClaims.length === snapshot.taskClaims.length, '任务领奖台账迁移')

  // 审计含迁移批次记录
  assert(app.k.state.auditLogs.some((l) => l.action === 'migration-run'), '迁移操作写审计留痕')
  await app.k.close()

  console.log('— 重启恢复 + 迁移批次幂等 —')
  app = await createApp({ dbFile: db, seed: false, autoResume: false })
  const mig2 = new MigrationService({ k: app.k, audit: new AuditService(app.k) })
  const flowsBefore = app.k.state.pointFlows.length
  const again = await mig2.run(JSON.parse(JSON.stringify(snapshot)), { ctx: { name: '迁移专员' } })
  assert(again.idempotent === true, '同批次重跑识别为幂等')
  assert(app.k.state.pointFlows.length === flowsBefore, '重跑零增量流水/事件')
  assert(app.k.state.migrations.length === 1, '迁移批次仅一条 manifest')

  console.log('— 迁移后对账：历史业务日 5 积分漏记检出并补偿平账 —')
  // 旧种子预置：上一业务日 seed-tc-gap（5 积分台账已落、流水漏记）
  const dates = [...new Set(app.k.state.records.map((r) => r.date))].sort()
  const yd = dates[dates.length - 2] || dates[0]
  const diffs = app.recon.compute(yd, 't-star')
  const gapItem = diffs.tasks.find((t) => t.claimId === 'seed-tc-gap')
  assert(!!gapItem && gapItem.reward === 5, `P2 检出历史漏记领奖台账（业务日 ${yd}）`)
  assert(diffs.points.residual === 5, `P1 历史积分净额残差=5（实际 ${diffs.points.residual}）`)
  const today = app.k.todayDate()
  const adminCtx = { identityKind: 'staff', memberId: 'm-star-admin', userId: 'm-star-admin', name: '王星河', tenantId: 't-star', ip: '10.10.1.8' }
  let bill = await app.recon.run(yd, 't-star', adminCtx)
  assert(bill.status === 'pending', '历史差异单待复核')
  await app.recon.review(yd, 't-star', '迁移后复核，准予补记', adminCtx)
  const balBefore = app.points.balanceOf('u-1001')
  const res = await app.recon.compensate(yd, 't-star', '', adminCtx)
  assert(res.actions.some((a) => a.type === 'task' && a.delta === 5), '跨日补偿补记 +5 积分')
  assert(app.points.balanceOf('u-1001') === balBefore + 5, `分户余额 +5（${balBefore} → ${app.points.balanceOf('u-1001')}）`)
  const after = app.recon.compute(yd, 't-star')
  assert(after.openCount === 0, `历史业务日补偿后平账（open=${after.openCount}）`)
  const compFlow = app.k.state.pointFlows.find((p) => p.kind === 'task-comp' && p.refId === 'seed-tc-gap')
  assert(compFlow && compFlow.bizDate === yd && compFlow.date === today,
    `补偿流水归属业务日 ${yd}、实际处理日 ${today}（跨日留痕）`)
  // 今日与云雀租户仍平衡
  assert(app.recon.compute(today, 't-star').openCount === 0, '迁移后今日 t-star 对账平衡')
  assert(app.recon.compute(today, 't-cloud').openCount === 0, '迁移后 t-cloud 对账平衡（租户独立）')

  console.log('— 迁移后业务可继续：新交易/审核/任务结算走同一套服务端链路 —')
  const customer = { identityKind: 'customer', userId: 'u-1001', memberId: '', name: '运营测试用户', tenantId: 't-star', ip: '127.0.0.1' }
  app.k.state.riskRules['t-star'] = { ...app.k.state.riskRules['t-star'], enabled: false, dailyDrawThreshold: 0, rapidDrawMax: 0 }
  const r = await app.trade.redeem('g1', customer, { idempotencyKey: 'post-mig-1' })
  assert(r.trade.status === 'normal' && !!app.k.state.coupons.find((c) => c.recordId === r.trade.id),
    '迁移后新兑换正常落账并发券')
  const r2 = await app.trade.redeem('g1', customer, { idempotencyKey: 'post-mig-1' })
  assert(r2.idempotent === true && r2.trade.id === r.trade.id, '迁移后新交易幂等键生效')
  assert(app.recon.compute(today, 't-star').openCount === 0, '新业务发生后今日仍账实相符')

  await app.k.close()
  if (failed) { console.error(`\n共 ${failed} 项失败 ❌`); process.exit(1) }
  console.log('\n全部通过 🎉')
  process.exit(0)
}
main()
