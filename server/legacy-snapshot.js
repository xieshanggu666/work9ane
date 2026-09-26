// 旧台账快照提取：初始化前端 Pinia store 并导出与 MigrationService 同构的快照 JSON。
// 仅在迁移脚本/打包测试中使用（依赖 @ 别名，经 esbuild bundle 运行）；HTTP 运行时不加载本模块。
import { setActivePinia, createPinia } from 'pinia'
import { usePlatformStore } from '@/store/platform'
import { COUPONS } from '@/mock/data'
import { CLOUD_COUPONS } from '@/mock/tenant'

export function extractLegacySnapshot() {
  setActivePinia(createPinia())
  const s = usePlatformStore()
  s.init()
  return {
    source: 'legacy-pinia-store@v1',
    migratedAt: 'all',
    tenants: JSON.parse(JSON.stringify(s.tenants)),
    members: JSON.parse(JSON.stringify(s.members)),
    customRoles: JSON.parse(JSON.stringify(s.customRoles)),
    tasks: JSON.parse(JSON.stringify(s.tasks)),
    riskRulesByTenant: JSON.parse(JSON.stringify(s.riskRulesByTenant)),
    couponTplsList: [...COUPONS, ...CLOUD_COUPONS].map((c) => ({ ...c })),
    activities: JSON.parse(JSON.stringify(s.activities)),
    goods: JSON.parse(JSON.stringify(s.goods)),
    pointRecords: JSON.parse(JSON.stringify(s.pointRecords)),
    records: JSON.parse(JSON.stringify(s.records)),
    riskOrders: JSON.parse(JSON.stringify(s.riskOrders)),
    taskClaims: JSON.parse(JSON.stringify(s.taskClaims)),
    coupons: JSON.parse(JSON.stringify(s.coupons)),
    couponLogs: JSON.parse(JSON.stringify(s.couponLogs)),
    shipments: JSON.parse(JSON.stringify(s.shipments)),
    afterSales: JSON.parse(JSON.stringify(s.afterSales)),
    reconBills: JSON.parse(JSON.stringify(s.reconBills)),
    stockAdjustments: JSON.parse(JSON.stringify(s.stockAdjustments)),
    budgets: JSON.parse(JSON.stringify(s.budgets)),
    budgetLedger: JSON.parse(JSON.stringify(s.budgetLedger)),
    auditLogs: JSON.parse(JSON.stringify(s.auditLogs)),
    legacyPoints: s.points
  }
}
