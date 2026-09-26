// 服务装配：内核（事件溯源）+ 全部领域服务 + 引导种子 + 启动续办。
// 纯 Node 内置依赖；通过 createApp({ dbFile, seed }) 选择"原生空库+种子"或"历史迁移库"。
import { Kernel } from './kernel.js'
import { KeyedLock } from './util.js'
import { AuthService } from './services/auth.js'
import { AuditService } from './services/audit.js'
import { PointsService } from './services/points.js'
import { InventoryService } from './services/inventory.js'
import { CouponService } from './services/coupon.js'
import { ShipService } from './services/ship.js'
import { PurchaseService } from './services/purchase.js'
import { SupplierService } from './services/supplier.js'
import { BudgetService } from './services/budget.js'
import { TaskService } from './services/task.js'
import { RiskService, makeDefaultRules } from './services/risk.js'
import { TradeService } from './services/trade.js'
import { ReconService } from './services/recon.js'
import { MigrationService } from './services/migration.js'
import { OrgService } from './services/org.js'
import { buildSeed } from './seed.js'

export async function createApp(options = {}) {
  const k = new Kernel(options.dbFile || 'data/server-wal.jsonl')
  await k.boot()

  const locks = new KeyedLock()
  const audit = new AuditService(k)
  const auth = new AuthService(k, audit)
  const points = new PointsService(k)
  const inventory = new InventoryService(k)
  const coupons = new CouponService(k, audit)
  const budget = new BudgetService({ k, audit, locks })
  const ship = new ShipService(k, audit, points, inventory, budget, locks)
  const purchase = new PurchaseService(k, audit, inventory, locks, budget)
  const supplier = new SupplierService({ k, audit, locks, budget })
  const tasks = new TaskService(k, audit, points, budget)
  const risk = new RiskService({ k, audit, points, inventory, coupons, ship, tasks, budget })
  const trade = new TradeService({ k, locks, audit, points, inventory, coupons, ship, tasks, risk, budget })
  const recon = new ReconService({ k, audit, points, coupons })
  const migration = new MigrationService({ k, audit })
  const org = new OrgService(k, audit)

  const app = { k, locks, auth, audit, points, inventory, coupons, ship, purchase, supplier, budget, tasks, risk, trade, recon, migration, org }

  // 空库引导：写入原生种子（以 upsert/insert 事件入 WAL，重启自动恢复）
  const fresh = k.state.tenants.length === 0 && k.state.activities.length === 0
  if (fresh && options.seed !== false) {
    await seedFresh(k)
  } else if (fresh && options.seed === false && options.bootstrapPlatform !== false) {
    // 空库迁移模式（--no-seed）：仅引导平台骨架（超管账号），业务台账等待离线快照迁移上云
    await seedPlatformSkeleton(k)
  }

  // 启动续办：崩溃后重放 WAL，把 processing 的交易/审核单/售后审核执行到终态（幂等无重复副作用）。
  // 可通过 options.autoResume=false 关闭（测试需先还原虚拟业务日再手工续办时使用）。
  if (options.autoResume !== false) {
    const resumedTrades = await trade.resumeAll({ name: '系统启动续办' })
    const resumedOrders = await risk.resumeProcessing()
    const resumedAfterSales = await ship.resumeAfterSales({ name: '系统启动续办' })
    if (resumedTrades.length || resumedOrders.length || resumedAfterSales.length) {
      await audit.log('saga-resume', '',
        `启动续办完成：交易 ${resumedTrades.length} 笔、风控审核 ${resumedOrders.length} 笔、售后审核 ${resumedAfterSales.length} 笔已从断点续办到终态`,
        { tenantId: '' })
    }
  }

  return app
}

async function seedPlatformSkeleton(k) {
  const seed = buildSeed()
  const events = []
  // 仅平台超管（无 tenantId）+ 空自定义角色，供离线快照迁移的 HTTP 登录鉴权；
  // 租户/成员/业务数据全部由后续 /api/migration/run 重建。
  seed.members.filter((m) => !m.tenantId).forEach((m) => events.push({ type: 'upsert', table: 'members', row: m }))
  for (const e of events) await k.commit([e])
}

async function seedFresh(k) {
  const seed = buildSeed()
  const events = []
  seed.tenants.forEach((t) => events.push({ type: 'upsert', table: 'tenants', row: t }))
  seed.members.forEach((m) => events.push({ type: 'upsert', table: 'members', row: m }))
  seed.customRoles.forEach((r) => events.push({ type: 'upsert', table: 'customRoles', row: r }))
  seed.tasks.forEach((t) => events.push({ type: 'upsert', table: 'tasks', row: t }))
  seed.couponTpls.forEach((c) => events.push({ type: 'upsert', table: 'couponTpls', row: c }))
  seed.activities.forEach((a) => events.push({ type: 'upsert', table: 'activities', row: a }))
  seed.goods.forEach((g) => events.push({ type: 'upsert', table: 'goods', row: g }))
  ;(seed.budgets || []).forEach((b) => events.push({ type: 'upsert', table: 'budgets', row: b }))
  Object.entries({ 't-star': makeDefaultRules(), 't-cloud': makeDefaultRules() })
    .forEach(([tenantId, rules]) => events.push({ type: 'risk-rules.put', tenantId, rules }))
  for (const e of events) await k.commit([e])
  // 分户初始余额（以一笔初始充值流水入账，保持余额链从 0 可重放）
  for (const [userId, amount] of Object.entries(seed.balances)) {
    const flow = {
      id: `seed-balance-${userId}`, userId,
      date: k.todayDate(), bizDate: k.todayDate(), tenantId: 't-star', traceId: '',
      time: k.nowTime(), ts: k.nowTs(), delta: amount, balance: 0,
      note: '账户初始积分（种子）', kind: 'normal', refId: `seed:${userId}`, refType: 'seed'
    }
    await k.commit([{ type: 'points.post', flow, effectId: `seed-balance:${userId}` }])
  }
}
