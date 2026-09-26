import { defineStore } from 'pinia'
import { ACTIVITIES, TASKS, SHOP_GOODS, DEMO_USER, DEFAULT_RISK_RULES, COUPONS, COUPON_TYPES } from '@/mock/data'
import {
  TENANTS, MEMBERS, PLATFORM_MEMBERS, ROLE_TEMPLATES, PLATFORM_ROLE,
  PERMISSION_GROUPS, PERMISSION_LABELS, CUSTOMER, CLOUD_COUPONS
} from '@/mock/tenant'
import { CLOUD_ACTIVITIES, CLOUD_GOODS } from '@/mock/cloud-data'

// 加权随机抽取（按权重选一个奖品下标）
function drawByWeight(prizes) {
  const total = prizes.reduce((s, p) => s + p.weight, 0)
  let r = Math.random() * total
  for (let i = 0; i < prizes.length; i++) {
    r -= prizes[i].weight
    if (r < 0) return i
  }
  return prizes.length - 1
}

// 生成某租户的独立默认风控规则（深拷贝，避免各租户共享数组/对象引用导致串配）
function makeDefaultRiskRules() {
  return {
    ...DEFAULT_RISK_RULES,
    highValueRarities: [...DEFAULT_RISK_RULES.highValueRarities],
    blacklist: [...DEFAULT_RISK_RULES.blacklist]
  }
}

function nowTime() {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
function todayStr() {
  // 业务日按本地自然日计算（与 nowTime 的本地时间保持一致，避免 UTC 偏移导致跨日错配）
  return dateStr(0)
}
// 相对今天偏移 offset 天的业务日字符串（负数取历史日，用于跨日台账/种子数据）
function dateStr(offsetDays = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}
// 今天某时刻（h:m）的时间戳，用于构造演示数据/风控窗口比较
function todayAt(h, m = 0) {
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.getTime()
}

// 风控规则文案
const RULE_LABELS = {
  blacklist: '黑名单用户',
  highValue: '高价值奖品/兑换',
  dailyBurst: '当日抽奖频次超限',
  rapidDraw: '短时间连续抽奖',
  rapidRedeem: '短时间连续兑换'
}
export const RISK_RULE_LABELS = RULE_LABELS

// 审核单状态文案与样式标记
export const RISK_STATUS = {
  pending: { label: '待审核', tone: 'warn' },
  appealed: { label: '已申诉', tone: 'info' },
  released: { label: '已放行', tone: 'ok' },
  revoked: { label: '已撤销', tone: 'bad' }
}

// 发货单状态文案与样式标记
// pending_address 待填地址 → to_ship 待发货（运营接单）→ shipped 已发货/待收货 → received 已收货
// returned 已退回（售后拒收/退货审核通过后回写，终态）
export const SHIP_STATUS = {
  pending_address: { label: '待填地址', tone: 'warn' },
  to_ship: { label: '待发货', tone: 'info' },
  shipped: { label: '已发货', tone: 'ok' },
  received: { label: '已收货', tone: 'muted' },
  returned: { label: '已退回', tone: 'bad' }
}

// 售后类型文案与样式标记
// reject 拒收退回（仅已发货未签收）｜ return 退货退款（仅已收货）｜ reship 补发（已发货/已收货，不退款）
export const AFTERSALE_TYPES = {
  reject: { label: '拒收退回', tone: 'bad', icon: '🚫' },
  return: { label: '退货退款', tone: 'warn', icon: '↩️' },
  reship: { label: '补发', tone: 'info', icon: '📦' }
}

// 售后单状态文案与样式标记
// pending 待审核 → done 已完成（审核通过并回写库存/积分/发货单）｜ dismissed 已驳回（不动账）
// 补发缺货时进入 waiting_stock 待补货：不动账，采购验收入库后可从待处理售后继续履约
export const AFTERSALE_STATUS = {
  pending: { label: '待审核', tone: 'warn' },
  done: { label: '已完成', tone: 'ok' },
  dismissed: { label: '已驳回', tone: 'muted' },
  waiting_stock: { label: '待补货', tone: 'bad' }
}

// 采购单状态文案与样式标记
// pending 待审批 → approved 已审批待入库 → receiving 分批验收中 → received 全部入库完成（终态）
// diff_closed 验收差异结案（到货不足/拒收少发，按实收入账后提前结案，差异转供应商结算）
// rejected 已驳回（终态，不动库存）；canceled 撤销（审批前申请人可撤回，终态）
export const PURCHASE_STATUS = {
  pending: { label: '待审批', tone: 'warn' },
  approved: { label: '已审批待入库', tone: 'info' },
  receiving: { label: '分批验收中', tone: 'info' },
  received: { label: '入库完成', tone: 'ok' },
  diff_closed: { label: '验收差异结案', tone: 'bad' },
  rejected: { label: '已驳回', tone: 'bad' },
  canceled: { label: '已撤销', tone: 'muted' }
}
// 采购单是否可对供应商结算（正常入满或差异结案后可发起供应商账单）
export const PO_SETTLEABLE = (s) => s === 'received' || s === 'diff_closed'

// 验收差异类型：short 到货短少（供应商少发）｜ rejected 拒收（到货物破损/不合格，验退不入库）
export const ACCEPT_DIFF_TYPES = {
  short: { label: '到货短少', tone: 'bad', icon: '📉' },
  rejected: { label: '验退拒收', tone: 'warn', icon: '📤' }
}

// 供应商账单（结算单）状态文案与样式标记
// draft 运营拟单 → reviewing 待财务复核 →（驳回 rejected 可修改重提）→ approved 复核通过 → settled 已结算（终态）
export const SETTLE_STATUS = {
  draft: { label: '待提交', tone: 'muted' },
  reviewing: { label: '财务复核中', tone: 'warn' },
  approved: { label: '复核通过待结算', tone: 'info' },
  rejected: { label: '复核驳回（待修订）', tone: 'bad' },
  settled: { label: '已结算', tone: 'ok' }
}

// 采购类型 / 采购用途文案
export const PURCHASE_TYPES = {
  activity: { label: '活动奖品采购', tone: 'info', icon: '🎡' },
  goods: { label: '商城商品采购', tone: 'ok', icon: '🛍️' }
}
export const PURCHASE_PURPOSE = {
  normal: '日常补货',
  aftersale: '售后缺货补发履约'
}

// 卡券账户实例状态文案与样式标记
// available 待核销（发券即入账）→ redeemed 已核销（运营扫码核销）/ expired 已过期（到期扫描）
// 风控冻结期不生成券账户实例（库存预占）：放行后发券交付，撤销则库存回补、券始终不发出
export const COUPON_STATUS = {
  available: { label: '待核销', tone: 'ok' },
  redeemed: { label: '已核销', tone: 'muted' },
  expired: { label: '已过期', tone: 'bad' }
}

// 营销预算单状态文案与样式标记
// pending 待财务审批 → active 生效（实时占用控制）；另可 reject 驳回 / cancel 申请人撤销 /
// freeze 冻结（暂停新增占用）→ activate 解冻；active/frozen → closed 关闭（终态，历史台账保留）
export const BUDGET_STATUS = {
  pending: { label: '待财务审批', tone: 'warn' },
  active: { label: '生效中', tone: 'ok' },
  rejected: { label: '已驳回', tone: 'bad' },
  frozen: { label: '已冻结', tone: 'bad' },
  closed: { label: '已关闭', tone: 'muted' },
  canceled: { label: '已撤销', tone: 'muted' }
}
// 预算币种：points 积分预算（抽奖成本/积分奖励/兑换成本/任务奖励）｜ money 资金预算（采购/供应商付款/售后补发）
export const BUDGET_UNITS = {
  points: { label: '积分预算', unit: '积分' },
  money: { label: '资金预算', unit: '元' }
}
// 预算台账占用方向
export const BUDGET_DIRECTIONS = {
  reserve: { label: '预占', tone: 'warn' },
  settle: { label: '实际成本', tone: 'ok' },
  release: { label: '预占释放', tone: 'info' },
  refund: { label: '成本冲回', tone: 'info' }
}
// 成本类别
export const BUDGET_CATEGORIES = {
  draw: '抽奖成本',
  redeem: '兑换成本',
  points: '积分奖励',
  purchase: '采购承诺',
  supplier: '供应商付款',
  reship: '售后补发'
}

// ===== 多租户与权限中心常量 =====
export const MEMBER_STATUS = {
  active: { label: '在职', tone: 'ok' },
  disabled: { label: '已停用', tone: 'bad' }
}

// 操作归类的业务模块（全链路审计按模块检索/筛选）
export const AUDIT_MODULES = {
  auth: '登录与身份',
  org: '组织与权限',
  platform: '平台租户',
  activity: '抽奖活动',
  points: '积分中心',
  risk: '风控申诉',
  ship: '物流发货',
  aftersale: '售后闭环',
  purchase: '采购入库',
  supplier: '供应商结算',
  budget: '预算成本',
  coupon: '卡券核销',
  recon: '积分库存对账',
  system: '系统'
}
// action 前缀 → 模块兜底映射（显式传 module 优先）
const ACTION_MODULE_PREFIX = [
  ['login-', 'auth'], ['switch-', 'auth'], ['identity-', 'auth'],
  ['member-', 'org'], ['role-', 'org'],
  ['tenant-', 'platform'],
  ['task-settle', 'points'],
  ['freeze', 'risk'], ['release', 'risk'], ['revoke', 'risk'], ['appeal', 'risk'], ['config', 'risk'],
  ['ship-', 'ship'],
  ['aftersale-', 'aftersale'],
  ['purchase-', 'purchase'], ['po-', 'purchase'],
  ['accept-', 'purchase'],
  ['budget-', 'budget'],
  ['supplier-', 'supplier'], ['settle-', 'supplier'],
  ['coupon-', 'coupon'],
  ['recon-', 'recon'],
  ['day-rollover', 'system']
]
function moduleOfAction(action, module) {
  if (module) return module
  const hit = ACTION_MODULE_PREFIX.find(([pre]) => action === pre.replace(/-$/, '') || action.startsWith(pre))
  return hit ? hit[1] : (action === 'draw' ? 'activity' : action === 'redeem' ? 'points' : 'system')
}

let seq = 0
const genId = (p) => `${p}-${Date.now()}-${seq++}`
// 全链路追踪号：一次用户操作（含其级联的冻结/发券/发货/对账等）共享同一 traceId
const genTraceId = () => `tr-${Date.now().toString(36)}-${(seq++).toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`
// 当前操作的隐式追踪上下文（顶层 action  beginTrace 开启，结束后清除）
let currentTrace = ''

export const usePlatformStore = defineStore('platform', {
  state: () => ({
    user: { ...DEMO_USER },
    role: 'user',               // user | operator：演示角色（用户申诉 / 运营审核）
    points: 0,                  // 用户可用积分（冻结部分不计入）
    activities: [],             // 深拷贝
    tasks: [],                  // 深拷贝（含完成状态）
    goods: [],                  // 商城商品（响应式库存 + 预占）
    records: [],                // 抽奖 / 兑换业务记录（含 frozen/released/revoked 状态）
    shipments: [],              // 实物发货单（append-only）：中奖/兑换实物且有效（正常/风控放行）后生成，走 填地址→发货→收货 流程
    pointRecords: [],           // 积分流水（append-only，财务留痕不裁剪）
    taskClaims: [],             // 任务领奖台账（append-only）：{ taskId, bizDate 归属业务日, grantDate 实际发放日, reward, flowId }，发奖与补偿的统一判重依据
    riskOrders: [],             // 风控审核单
    afterSales: [],             // 售后单（append-only）：拒收/退货/补发申请与审核回写留痕（waiting_stock：缺货待补货，入库后继续履约）
    purchaseOrders: [],         // 采购单（append-only）：运营按活动奖品/商城商品发起，审批后分批验收入库
    inboundBatches: [],         // 采购验收批次（append-only）：{ poId, qty, remainBefore/After, acceptedInbound }
    acceptDiffs: [],            // 验收差异（append-only）：到货短少/验退拒收，按采购批次登记并回写采购单
    supplierBills: [],          // 供应商账单/结算单（append-only）：运营按采购单拟单、财务复核与结算，按批次/售后补发回写库存对账
    budgets: [],                // 营销预算单（append-only 审批流）：按租户/活动 × 积分/资金设预算，财务审批后参与实时占用控制
    budgetLedger: [],           // 预算占用台账（append-only）：reserve 预占 / settle 实际成本 / release 释放 / refund 冲回，effectId 幂等
    auditLogs: [],              // 操作记录（审计日志）
    reconBills: [],             // 积分库存对账差异单（按业务日，append-only 保留执行/复核/补偿痕迹）
    stockAdjustments: [],       // 库存校正台账（append-only）：对账补偿对 remain 的修正凭证
    coupons: [],                // 卡券账户实例（append-only）：{ status: available|redeemed|expired, code 唯一券码, recordId 业务记录 }
    couponLogs: [],             // 卡券业务台账（append-only 核销/发券留痕）：issue/hold/deliver/release/redeem/expire/revoke/comp
    // 风控规则按租户隔离（tenantId → 规则对象），各租户在 init/开通时由默认规则深拷贝初始化
    riskRulesByTenant: {},
    todayDate: todayStr(),
    activeTab: 'home',
    toast: null,
    // ===== 多租户与权限中心 =====
    tenants: [],                // 租户（组织）列表
    members: [],                // 员工账号（含平台方账号 m-platform）
    customRoles: [],            // 租户自定义角色（内置角色来自 ROLE_TEMPLATES）
    identityKind: 'customer',   // customer | staff | platform：当前登录身份
    activeTenantId: 't-star',   // 当前数据上下文租户（客户"逛店"切换 / 员工归属租户 / 平台方可任意切换）
    currentMemberId: '',        // 员工身份下的成员 id
    lastDenied: null,           // 最近一次权限/越权拦截（供 UI 提示与测试断言）
    // ===== 服务端履约模式（远程桥 @/api/bridge 使用）=====
    // 本地模式（默认，零后端可浏览）下全部业务在本地 store 完成；
    // 切到 server 模式后，写操作统一走服务端 API（RBAC/幂等/KeyedLock 并发/WAL 恢复），本 store 仅为服务端快照的响应式投影。
    serverMode: false,          // 是否处于服务端履约模式
    serverConnected: false,     // 服务端最近是否可达
    serverSyncing: false,       // 是否有写操作在途/等待水合
    serverVersion: '',          // 最近水合快照版本（可用于 stale-while-revalidate 判断）
    _lastHydratedAt: 0,
    _lastRemoteTrade: null,     // 最近一笔服务端交易（抽奖动画/结果提示桥用）
    offlineMigrations: []       // 离线快照上云迁移批次记录（manifest 摘要）
  }),

  getters: {
    // 当前数据上下文租户的风控规则（与业务数据同口径隔离：
    // A 租户调整规则不得影响 B 租户的抽奖/兑换判定；新租户开通时取默认规则的独立副本）
    riskRules(s) {
      return s.riskRulesByTenant[s.activeTenantId] || s.riskRulesByTenant['t-star'] || makeDefaultRiskRules()
    },
    // 是否运营身份（员工 / 平台超管均视为运营视角；兼容旧 role 字段）
    isOperator: (s) => s.role === 'operator',
    // 当前数据上下文租户（未初始化时兜底 t-star）
    activeTenant(s) {
      return s.tenants.find((t) => t.id === s.activeTenantId) || s.tenants[0] || { id: 't-star', shortName: '星河商贸' }
    },
    // 冻结中的积分（抽奖成本 + 兑换成本；抽奖积分奖品在放行时才入账）——按当前租户隔离
    frozenPoints(s) {
      return s.riskOrders
        .filter((o) => (o.tenantId || 't-star') === s.activeTenantId)
        .filter((o) => o.status === 'pending' || o.status === 'appealed')
        .reduce((sum, o) => sum + (o.frozenPoints || 0), 0)
    },
    // 每日抽奖次数（已撤销不计入：撤销后返还限次；待审核/已放行均占用次数）——按当前租户隔离
    dailyDrawCount: (s) => (activityId) =>
      s.records.filter(
        (r) => r.type === 'draw' && r.activityId === activityId &&
          r.date === s.todayDate && r.status !== 'revoked' &&
          (r.tenantId || 't-star') === s.activeTenantId
      ).length,
    // 总抽奖次数统计——按当前租户隔离
    totalDrawCount: (s) => (activityId) =>
      s.records.filter(
        (r) => r.type === 'draw' && r.activityId === activityId && r.status !== 'revoked' &&
          (r.tenantId || 't-star') === s.activeTenantId
      ).length,
    // 有效业务记录（已撤销不计入业务与统计）
    validRecords(s) {
      return s.records.filter((r) => r.status !== 'revoked')
    },
    // 某业务日有效抽奖次数（真实参与记录：正常 + 审核放行计入；冻结暂缓、撤销回退均不计）——按租户
    validDrawCount: (s) => (date, tenantId = s.activeTenantId) =>
      s.records.filter(
        (r) => r.type === 'draw' && r.date === date &&
          (r.tenantId || 't-star') === tenantId &&
          (r.status === 'normal' || r.status === 'released')
      ).length,
    // 某业务日风控审核中的抽奖笔数（暂缓计入任务进度，放行后补计、撤销后不计）——按租户
    pendingDrawCount: (s) => (date, tenantId = s.activeTenantId) =>
      s.records.filter(
        (r) => r.type === 'draw' && r.date === date && r.status === 'frozen' &&
          (r.tenantId || 't-star') === tenantId
      ).length,
    // 抽奖任务当日状态：进度/达标/已结算/审核中笔数（进度由真实记录推导，不落库）
    drawTaskState(s) {
      return (taskId) => {
        const t = s.tasks.find((x) => x.id === taskId)
        if (!t || t.metric !== 'draw') return null
        const date = s.todayDate
        const progress = this.validDrawCount(date)
        const claim = s.taskClaims.find((c) => c.taskId === taskId && c.bizDate === date)
        return {
          goal: t.goal,
          progress,
          pending: this.pendingDrawCount(date),
          done: progress >= t.goal,
          claimed: !!claim,
          claim: claim || null
        }
      }
    },
    // 任务台账：按业务日保留每个抽奖任务的进度与领奖记录（跨日审核各记各的账，不串日）
    taskDayBooks(s) {
      const drawTasks = s.tasks.filter((t) => t.metric === 'draw')
      const dates = new Set()
      s.records.forEach((r) => { if (r.type === 'draw') dates.add(r.date) })
      s.taskClaims.forEach((c) => dates.add(c.bizDate))
      return [...dates].sort().reverse().map((date) => ({
        date,
        isToday: date === s.todayDate,
        tasks: drawTasks.map((t) => {
          const claim = s.taskClaims.find((c) => c.taskId === t.id && c.bizDate === date)
          return {
            taskId: t.id,
            label: t.label,
            goal: t.goal,
            reward: t.reward,
            progress: this.validDrawCount(date),
            pending: this.pendingDrawCount(date),
            claim: claim || null
          }
        })
      }))
    },
    // 待处理审核单数（用户端/运营端角标）——按当前租户隔离；客户只看本人单据
    pendingRiskCount(s) {
      const tid = s.activeTenantId
      return s.riskOrders.filter((o) =>
        (o.status === 'pending' || o.status === 'appealed') &&
        (o.tenantId || 't-star') === tid &&
        (s.role === 'operator' || o.userId === s.user.id)).length
    },
    // 运营看板统计（同步冻结/撤销状态）——按当前租户上下文隔离；平台超管可传 tenantId 查看指定租户
    dashboard(state) {
      return this.dashboardOf(state.activeTenantId)
    },
    dashboardOf(s) {
      return (tenantId) => {
        const tid = tenantId || s.activeTenantId
        const inT = (x) => (x.tenantId || 't-star') === tid
        const recordsT = s.records.filter(inT)
        const flowsT = s.pointRecords.filter(inT)
        const draws = recordsT.filter((r) => r.type === 'draw' && r.status !== 'revoked')
        const acts = s.activities.filter((a) => a.tenantId === tid)
        return {
          totalDraws: draws.length,
          running: acts.filter((a) => a.status === 'running').length,
          participants: Math.round(draws.length * 1.7) + 128,
          legendaryWins: draws.filter((r) => r.rarity === 'legendary').length,
          epicWins: draws.filter((r) => r.rarity === 'epic').length,
          pointsIssued: flowsT
            .filter((p) => p.delta > 0 && p.kind !== 'refund')
            .reduce((sum, p) => sum + p.delta, 0),
          goodsSold: recordsT.filter((r) => r.type === 'redeem' && r.status !== 'revoked').length,
          taskSettlements: s.taskClaims.filter((c) => (c.tenantId || 't-star') === tid && c.source === 'auto').length,
          pendingRisk: s.riskOrders.filter((o) => inT(o) && (o.status === 'pending' || o.status === 'appealed')).length,
          frozenPoints: s.riskOrders
            .filter((o) => inT(o) && (o.status === 'pending' || o.status === 'appealed'))
            .reduce((sum, o) => sum + (o.frozenPoints || 0), 0),
          // 对账看板：对账业务日数、待复核差异单数、累计补偿积分、库存校正次数
          reconDays: s.reconBills.filter((b) => (b.tenantId || 't-star') === tid).length,
          reconOpen: s.reconBills.filter((b) => inT(b) && ['pending', 'reviewed'].includes(b.status)).length,
          reconCompensated: flowsT
            .filter((p) => p.kind === 'recon-comp' || p.kind === 'task-comp')
            .reduce((sum, p) => sum + p.delta, 0),
          stockAdjCount: s.stockAdjustments.filter((x) => (x.tenantId || 't-star') === tid).length,
          // 实物发货看板：待填地址 / 待运营发货 / 已发货待收货 / 已完成 / 已退回
          shipPendingAddress: s.shipments.filter((o) => inT(o) && o.status === 'pending_address').length,
          shipToShip: s.shipments.filter((o) => inT(o) && o.status === 'to_ship').length,
          shipShipped: s.shipments.filter((o) => inT(o) && o.status === 'shipped').length,
          shipReceived: s.shipments.filter((o) => inT(o) && o.status === 'received').length,
          shipReturned: s.shipments.filter((o) => inT(o) && o.status === 'returned').length,
          // 售后看板：待审核 / 待补货 / 已完成 / 已驳回 / 补发新单量
          afterSalePending: s.afterSales.filter((a) => inT(a) && a.status === 'pending').length,
          afterSaleWaiting: s.afterSales.filter((a) => inT(a) && a.status === 'waiting_stock').length,
          afterSaleDone: s.afterSales.filter((a) => inT(a) && a.status === 'done').length,
          afterSaleDismissed: s.afterSales.filter((a) => inT(a) && a.status === 'dismissed').length,
          shipReshipped: s.shipments.filter((o) => inT(o) && o.source === '售后补发').length,
          // 采购看板：待审批 / 待入库（已审批 + 分批验收中）/ 入库完成 / 累计验收入库件数
          purchasePending: s.purchaseOrders.filter((o) => inT(o) && o.status === 'pending').length,
          purchaseToInbound: s.purchaseOrders.filter((o) => inT(o) && ['approved', 'receiving'].includes(o.status)).length,
          purchaseReceived: s.purchaseOrders.filter((o) => inT(o) && o.status === 'received').length,
          purchaseDiffClosed: s.purchaseOrders.filter((o) => inT(o) && o.status === 'diff_closed').length,
          purchaseInboundQty: s.inboundBatches.filter((b) => inT(b)).reduce((n, b) => n + (b.qty || 0), 0),
          acceptDiffCount: s.acceptDiffs.filter((d) => inT(d)).length,
          acceptShort: s.acceptDiffs.filter((d) => inT(d) && d.type === 'short').reduce((n, d) => n + d.qty, 0),
          acceptRejected: s.acceptDiffs.filter((d) => inT(d) && d.type === 'rejected').reduce((n, d) => n + d.qty, 0),
          // 供应商结算看板：账单总数 / 待财务复核 / 待结算付款 / 已结算 / 累计应付与已付金额
          supplierBills: s.supplierBills.filter((b) => inT(b)).length,
          supplierReviewing: s.supplierBills.filter((b) => inT(b) && b.status === 'reviewing').length,
          supplierApproved: s.supplierBills.filter((b) => inT(b) && b.status === 'approved').length,
          supplierSettled: s.supplierBills.filter((b) => inT(b) && b.status === 'settled').length,
          supplierPayable: s.supplierBills.filter((b) => inT(b) && ['reviewing', 'approved', 'rejected', 'draft'].includes(b.status))
            .reduce((n, b) => n + (b.payableAmount || 0), 0),
          supplierPaid: s.supplierBills.filter((b) => inT(b) && b.status === 'settled')
            .reduce((n, b) => n + (b.payableAmount || 0), 0),
          // 卡券看板：累计发券 / 待核销 / 已核销 / 已过期 / 风控预占待交付
          couponIssued: s.coupons.filter(inT).length,
          couponAvailable: s.coupons.filter((c) => inT(c) && c.status === 'available').length,
          couponRedeemed: s.coupons.filter((c) => inT(c) && c.status === 'redeemed').length,
          couponExpired: s.coupons.filter((c) => inT(c) && c.status === 'expired').length,
          couponHeld: recordsT.filter((r) => r.status === 'frozen' && r.couponId).length,
          // 营销预算看板：预算单 / 待审批 / 生效 / 冻结 / 超支 / 预警 / 累计占用
          budgetTotal: s.budgets.filter(inT).length,
          budgetPending: s.budgets.filter((b) => inT(b) && b.status === 'pending').length,
          budgetActive: s.budgets.filter((b) => inT(b) && b.status === 'active').length,
          budgetFrozen: s.budgets.filter((b) => inT(b) && b.status === 'frozen').length,
          budgetOverrun: this.budgetCards.filter((c) => (c.tenantId || 't-star') === tid && c.overrun).length,
          budgetNearWarn: this.budgetCards.filter((c) => (c.tenantId || 't-star') === tid && c.nearWarn).length,
          budgetOccupiedPoints: this.budgetCards
            .filter((c) => (c.tenantId || 't-star') === tid && c.unit === 'points')
            .reduce((n, c) => n + c.occupied, 0),
          budgetOccupiedMoney: this.budgetCards
            .filter((c) => (c.tenantId || 't-star') === tid && c.unit === 'money')
            .reduce((n, c) => n + c.occupied, 0)
        }
      }
    },
    // 某业务日的对账差异单（一租户一业务日一单，重复执行更新同单并保留痕迹）
    reconBillOf: (s) => (date, tenantId = s.activeTenantId) =>
      s.reconBills.find((b) => b.date === date && (b.tenantId || 't-star') === tenantId) || null,
    // 存在差异、尚未平账的对账单元数（看板/Tab 角标）——按当前租户
    reconOpenCount(s) {
      return s.reconBills.filter(
        (b) => (b.tenantId || 't-star') === s.activeTenantId && ['pending', 'reviewed'].includes(b.status)
      ).length
    },
    // 可选对账业务日（当前租户；兼容旧调用 reconDates / reconDates()）
    reconDates(s) {
      const list = (tenantId = s.activeTenantId) => {
        const tid = tenantId
        const dates = new Set()
        s.records.forEach((r) => { if ((r.tenantId || 't-star') === tid) dates.add(r.date) })
        s.riskOrders.forEach((o) => { if ((o.tenantId || 't-star') === tid) dates.add(o.createdAt) })
        s.taskClaims.forEach((c) => {
          if ((c.tenantId || 't-star') === tid) { dates.add(c.bizDate); dates.add(c.grantDate) }
        })
        s.inboundBatches.forEach((b) => { if ((b.tenantId || 't-star') === tid) dates.add(b.date) })
        s.reconBills.forEach((b) => { if ((b.tenantId || 't-star') === tid) dates.add(b.date) })
        dates.add(s.todayDate)
        return [...dates].sort().reverse()
      }
      // 同时支持属性访问（数组）与函数调用（指定租户）
      return Object.assign(list(s.activeTenantId), { forTenant: list })
    },
    // 业务记录对应的实物发货单（一条有效实物业务记录至多一张发货单）
    shipmentOfRecord: (s) => (recordId) => s.shipments.find((o) => o.recordId === recordId) || null,
    // 当前数据上下文租户内的发货单（员工视角；客户改走 myShipments）
    scopedShipments(s) {
      return s.shipments.filter((o) => (o.tenantId || 't-star') === s.activeTenantId)
    },
    // 当前租户内售后单
    scopedAfterSales(s) {
      return s.afterSales.filter((a) => (a.tenantId || 't-star') === s.activeTenantId)
    },
    // 当前租户内采购单
    scopedPurchaseOrders(s) {
      return s.purchaseOrders.filter((o) => (o.tenantId || 't-star') === s.activeTenantId)
    },
    // 当前租户内采购验收批次
    scopedInboundBatches(s) {
      return s.inboundBatches.filter((b) => (b.tenantId || 't-star') === s.activeTenantId)
    },
    // 当前租户内验收差异
    scopedAcceptDiffs(s) {
      return s.acceptDiffs.filter((a) => (a.tenantId || 't-star') === s.activeTenantId)
    },
    // 当前租户内供应商账单（结算单）
    scopedSupplierBills(s) {
      return s.supplierBills.filter((b) => (b.tenantId || 't-star') === s.activeTenantId)
    },
    // 当前租户内风控审核单
    scopedRiskOrders(s) {
      return s.riskOrders.filter((o) => (o.tenantId || 't-star') === s.activeTenantId)
    },
    // 当前租户内卡券实例
    scopedCoupons(s) {
      return s.coupons.filter((c) => (c.tenantId || 't-star') === s.activeTenantId)
    },
    // 当前租户内业务记录
    scopedRecords(s) {
      return s.records.filter((r) => (r.tenantId || 't-star') === s.activeTenantId)
    },
    // 当前租户内积分流水
    scopedPointRecords(s) {
      return s.pointRecords.filter((p) => (p.tenantId || 't-star') === s.activeTenantId)
    },
    // 当前租户内卡券台账
    scopedCouponLogs(s) {
      return s.couponLogs.filter((l) => (l.tenantId || 't-star') === s.activeTenantId)
    },
    // 当前租户内库存校正凭证
    scopedStockAdjustments(s) {
      return s.stockAdjustments.filter((x) => (x.tenantId || 't-star') === s.activeTenantId)
    },
    // 当前用户的发货单（最新在前）——按"逛店"租户隔离
    myShipments(s) {
      return [...s.shipments]
        .filter((o) => o.userId === s.user.id && (o.tenantId || 't-star') === s.activeTenantId)
        .sort((a, b) => b.ts - a.ts)
    },
    // 运营待接单发货数（地址已填、尚未发货）——运营 Tab 角标（按当前租户）
    pendingShipCount(s) {
      return s.shipments.filter(
        (o) => (o.tenantId || 't-star') === s.activeTenantId && o.status === 'to_ship'
      ).length
    },
    // 用户待办数（待填地址 + 已发货待确认收货）——用户 Tab 角标（按当前租户）
    myShipTodoCount(s) {
      return s.shipments.filter(
        (o) => o.userId === s.user.id && (o.tenantId || 't-star') === s.activeTenantId &&
          (o.status === 'pending_address' || o.status === 'shipped')
      ).length
    },
    // 发货看板统计（按状态 + 总量）——按当前租户
    shipmentStats(s) {
      const list = s.shipments.filter((o) => (o.tenantId || 't-star') === s.activeTenantId)
      return {
        total: list.length,
        pendingAddress: list.filter((o) => o.status === 'pending_address').length,
        toShip: list.filter((o) => o.status === 'to_ship').length,
        shipped: list.filter((o) => o.status === 'shipped').length,
        received: list.filter((o) => o.status === 'received').length,
        returned: list.filter((o) => o.status === 'returned').length
      }
    },
    // ===== 售后（拒收/退货/补发） =====
    // 发货单关联的售后单（最新一条在前；一单可有多条历史，如驳回后重新申请）
    afterSalesOfShipment: (s) => (shipmentId) =>
      s.afterSales.filter((a) => a.shipmentId === shipmentId)
        .sort((a, b) => b.ts - a.ts),
    // 当前用户的售后单（最新在前）
    myAfterSales(s) {
      return [...s.afterSales]
        .filter((a) => a.userId === s.user.id)
        .sort((a, b) => b.ts - a.ts)
    },
    // 运营待审核售后数 —— 运营 Tab 角标（按当前租户）
    pendingAfterSaleCount(s) {
      return s.afterSales.filter(
        (a) => (a.tenantId || 't-star') === s.activeTenantId && a.status === 'pending'
      ).length
    },
    // 缺货待补货售后数（采购入库后继续履约的挂起单）——按当前租户
    waitingStockAfterSaleCount(s) {
      return s.afterSales.filter(
        (a) => (a.tenantId || 't-star') === s.activeTenantId && a.status === 'waiting_stock'
      ).length
    },
    // 待处理售后（待审核 + 待补货继续履约）
    pendingOrWaitingAfterSaleCount(s) {
      return s.afterSales.filter(
        (a) => (a.tenantId || 't-star') === s.activeTenantId &&
          (a.status === 'pending' || a.status === 'waiting_stock')
      ).length
    },
    // 采购待审批数 —— 采购 Tab 角标（按当前租户）
    pendingPurchaseCount(s) {
      return s.purchaseOrders.filter(
        (o) => (o.tenantId || 't-star') === s.activeTenantId && o.status === 'pending'
      ).length
    },
    // 采购待入库数（已审批未入完 + 分批验收中）
    pendingInboundCount(s) {
      return s.purchaseOrders.filter(
        (o) => (o.tenantId || 't-star') === s.activeTenantId &&
          ['approved', 'receiving'].includes(o.status)
      ).length
    },
    // ===== 供应商结算 =====
    // 采购单对应的供应商账单（优先有效账单；仅有驳回账单时返回该单供修订展示）
    supplierBillOfPo: (s) => (poId) =>
      s.supplierBills.find((b) => b.poId === poId && b.status !== 'rejected') ||
      s.supplierBills.find((b) => b.poId === poId) || null,
    // 待拟单：已可结算（入满/差异结案）、未被账单占用的采购单（按当前租户）
    billablePurchaseCount(s) {
      const tid = s.activeTenantId
      const billed = new Set(s.supplierBills.filter((b) => b.status !== 'rejected').map((b) => b.poId))
      return s.purchaseOrders.filter(
        (o) => (o.tenantId || 't-star') === tid && PO_SETTLEABLE(o.status) && !billed.has(o.id)
      ).length
    },
    // 供应商账单各状态计数（看板/Tab 角标）
    supplierBillStats(s) {
      const list = s.supplierBills.filter((b) => (b.tenantId || 't-star') === s.activeTenantId)
      return {
        total: list.length,
        draft: list.filter((b) => b.status === 'draft').length,
        reviewing: list.filter((b) => b.status === 'reviewing').length,
        approved: list.filter((b) => b.status === 'approved').length,
        rejected: list.filter((b) => b.status === 'rejected').length,
        settled: list.filter((b) => b.status === 'settled').length
      }
    },
    // 财务待办角标：复核中（待复核）+ 复核通过待结算
    pendingSettleReviewCount(s) {
      return s.supplierBills.filter(
        (b) => (b.tenantId || 't-star') === s.activeTenantId &&
          ['reviewing', 'approved'].includes(b.status)
      ).length
    },
    // 供应商结算 Tab 角标：运营看待拟单，财务看待复核/待结算
    supplierTodoCount(s) {
      const billed = new Set(s.supplierBills.filter((b) => b.status !== 'rejected').map((b) => b.poId))
      const billable = s.purchaseOrders.filter(
        (o) => (o.tenantId || 't-star') === s.activeTenantId && PO_SETTLEABLE(o.status) && !billed.has(o.id)
      ).length
      if (s.role === 'operator') {
        return billable + s.supplierBills.filter(
          (b) => (b.tenantId || 't-star') === s.activeTenantId && ['draft', 'rejected'].includes(b.status)).length
      }
      return s.supplierBills.filter(
        (b) => (b.tenantId || 't-star') === s.activeTenantId && ['reviewing', 'approved'].includes(b.status)
      ).length
    },
    // 用户售后待办角标：我的申请仍在审核中（按当前租户）
    myAfterSalePendingCount(s) {
      return s.afterSales.filter(
        (a) => a.userId === s.user.id && (a.tenantId || 't-star') === s.activeTenantId && a.status === 'pending'
      ).length
    },
    // ===== 营销预算与成本控制 =====
    // 当前租户全部预算单（最新在前）
    scopedBudgets(s) {
      return s.budgets.filter((b) => (b.tenantId || 't-star') === s.activeTenantId)
    },
    scopedBudgetLedger(s) {
      return s.budgetLedger.filter((l) => (l.tenantId || 't-star') === s.activeTenantId)
    },
    // 预算占用汇总（纯推导）：reserved 未核销预占；committed 实际成本（settle − refund 冲回）
    budgetSummary(s) {
      return (budgetId) => {
        const rows = s.budgetLedger.filter((l) => l.budgetId === budgetId)
        const convertedIds = new Set(rows.filter((l) => l.reserveOf).map((l) => l.reserveOf))
        let reserved = 0
        let committed = 0
        const byCategory = {}
        rows.forEach((l) => {
          if (l.direction === 'reserve' && !convertedIds.has(l.id)) {
            reserved += l.amount
            byCategory[l.category] = (byCategory[l.category] || 0) + l.amount
          } else if (l.direction === 'settle') {
            committed += l.amount
            byCategory[l.category] = (byCategory[l.category] || 0) + l.amount
          } else if (l.direction === 'refund') {
            committed -= l.amount
            byCategory[l.category] = (byCategory[l.category] || 0) - l.amount
          }
        })
        const r2 = (n) => Math.round(n * 100) / 100
        return {
          reserved: r2(reserved), committed: r2(committed), occupied: r2(reserved + committed),
          available: r2(Math.max(0, (s.budgets.find((x) => x.id === budgetId)?.amount || 0) - r2(reserved + committed))),
          byCategory, rows: rows.length
        }
      }
    },
    // 预算卡片（含占用汇总与超支/预警状态）
    budgetCards(s) {
      const inT = (b) => (b.tenantId || 't-star') === s.activeTenantId
      return s.budgets.filter(inT).map((b) => {
        const sum = this.budgetSummary(b.id)
        const available = Math.round((b.amount - sum.occupied) * 100) / 100
        const ratio = b.amount > 0 ? sum.occupied / b.amount : 0
        return {
          ...b, ...sum, available, ratio,
          overrun: sum.occupied > b.amount + 1e-6,
          nearWarn: b.status === 'active' && sum.occupied <= b.amount + 1e-6 && ratio >= 0.8
        }
      }).sort((a, b) => b.ts - a.ts)
    },
    // 财务待审批预算数（含预算调整待审批）
    pendingBudgetCount(s) {
      const list = s.budgets.filter((b) => (b.tenantId || 't-star') === s.activeTenantId)
      return list.filter((b) => b.status === 'pending').length +
        list.reduce((n, b) => n + (b.adjustments || []).filter((a) => a.status === 'pending').length, 0)
    },
    // 预算 Tab 角标：财务看待审批；运营/财务看超支+预警
    budgetTodoCount(s) {
      if (s.role !== 'operator') return 0
      if (s.can('budget:approve')) {
        return this.pendingBudgetCount + this.budgetCards.filter((c) => c.overrun).length
      }
      if (s.can('budget:manage')) return this.budgetCards.filter((c) => c.overrun || c.nearWarn).length
      return 0
    },
    // ===== 卡券账户 =====
    // 卡券模板（按 id 索引；含两个租户的全部模板）
    couponTpls: () => [...COUPONS, ...CLOUD_COUPONS].reduce((m, c) => { m[c.id] = c; return m }, {}),
    // 某奖品/商品是否为券类（券类在中奖/兑换有效后发券至卡券账户，不产生发货单）
    couponOfTarget: (s) => (rec) => {
      const id = rec.type === 'draw' ? rec.couponId : rec.couponId
      if (!id) return null
      return s.couponTpls[id] || null
    },
    // 业务记录对应的卡券实例（一条有效券业务记录至多一张券，与发货单同理）
    couponOfRecord: (s) => (recordId) => s.coupons.find((c) => c.recordId === recordId) || null,
    // 当前用户的卡券账户（最新在前）——按"逛店"租户隔离
    myCoupons(s) {
      return [...s.coupons]
        .filter((c) => c.userId === s.user.id && (c.tenantId || 't-star') === s.activeTenantId)
        .sort((a, b) => b.ts - a.ts)
    },
    // 风控冻结中、待放行交付的券（预占：库存已扣，券尚未发至账户）——按当前租户；
    // 演示中冻结单均为消费者 u-1001 产生（员工登录后查看客户预占也走此口径）
    myHeldCoupons(s) {
      const customerId = CUSTOMER.id
      return s.records
        .filter((r) => r.status === 'frozen' && r.couponId &&
          (r.tenantId || 't-star') === s.activeTenantId &&
          (!r.userId || r.userId === customerId))
        .sort((a, b) => b.ts - a.ts)
    },
    // 用户卡券待办角标：待核销（含今日即将到期的提示由组件推导）——按当前租户
    myCouponTodoCount(s) {
      return s.coupons.filter(
        (c) => c.userId === s.user.id && (c.tenantId || 't-star') === s.activeTenantId && c.status === 'available'
      ).length
    },
    // 运营待核销券数（当前租户全部用户待核销券）——运营 Tab 角标
    pendingRedeemCount(s) {
      return s.coupons.filter(
        (c) => (c.tenantId || 't-star') === s.activeTenantId && c.status === 'available'
      ).length
    },
    // 卡券看板统计——按当前租户
    couponStats(s) {
      const list = s.coupons.filter((c) => (c.tenantId || 't-star') === s.activeTenantId)
      const now = Date.now()
      const todayEnd = (() => { const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime() })()
      return {
        issued: list.length,
        available: list.filter((c) => c.status === 'available').length,
        redeemed: list.filter((c) => c.status === 'redeemed').length,
        expired: list.filter((c) => c.status === 'expired').length,
        held: s.records.filter(
          (r) => (r.tenantId || 't-star') === s.activeTenantId && r.status === 'frozen' && r.couponId
        ).length,
        expiringToday: list.filter((c) => c.status === 'available' && c.expireTs <= todayEnd && c.expireTs >= now).length
      }
    },
    // ===== 多租户与权限中心：身份 / 角色 / 权限 =====
    isPlatform: (s) => s.identityKind === 'platform',
    isCustomer: (s) => s.identityKind === 'customer',
    // 当前登录成员（员工/平台方）
    currentMember(s) {
      return s.members.find((m) => m.id === s.currentMemberId) || null
    },
    // 全部角色（内置 + 各租户自定义，当前租户上下文可管理）
    allRoles(s) {
      return [PLATFORM_ROLE, ...ROLE_TEMPLATES, ...s.customRoles]
    },
    // 当前租户可选角色（平台超管角色不参与租户内分配）
    tenantRoles(s) {
      return (tid = s.activeTenantId) => [
        ...ROLE_TEMPLATES,
        ...s.customRoles.filter((r) => r.tenantId === tid)
      ]
    },
    // 角色对象（内置/自定义/平台）
    roleOfKey: (s) => (roleKey) =>
      [PLATFORM_ROLE, ...ROLE_TEMPLATES, ...s.customRoles].find((r) => r.key === roleKey) || null,
    // 成员→权限集合（org_admin / platform_admin 的 '*' 在 can 中解释）
    permissionsOf(s) {
      return (memberId) => {
        const m = s.members.find((x) => x.id === memberId)
        if (!m || m.status !== 'active') return new Set()
        const role = [PLATFORM_ROLE, ...ROLE_TEMPLATES, ...s.customRoles].find((r) => r.key === m.roleKey)
        if (!role) return new Set()
        if (role.permissions === '*') return new Set(['*'])
        return new Set(role.permissions || [])
      }
    },
    // 当前身份是否拥有某权限（客户只有 null 权限集；平台超管 = 全部；组织管理员 = 除平台方外全部）
    can(s) {
      return (perm) => {
        if (s.identityKind === 'platform') return true
        if (s.identityKind !== 'staff') return false
        const m = s.members.find((x) => x.id === s.currentMemberId)
        if (!m || m.status !== 'active') return false
        if (m.roleKey === 'org_admin') return perm !== 'tenant:manage'
        const role = [...ROLE_TEMPLATES, ...s.customRoles].find((r) => r.key === m.roleKey)
        if (!role) return false
        if (role.permissions === '*') return perm !== 'tenant:manage'
        return (role.permissions || []).includes(perm)
      }
    },
    // 当前员工是否可管理指定租户数据（本租户员工或平台超管）
    canAccessTenant(s) {
      return (tenantId) => {
        if (s.identityKind === 'platform') return true
        if (s.identityKind !== 'staff') return false
        const m = s.members.find((x) => x.id === s.currentMemberId)
        return !!m && m.status === 'active' && m.tenantId === tenantId
      }
    },
    // 某租户成员（不含平台方）
    membersOfTenant: (s) => (tenantId) => s.members.filter((m) => m.tenantId === tenantId),
    // 平台方成员
    platformMembers(s) {
      return s.members.filter((m) => !m.tenantId)
    },
    // 租户运营概览（供权限中心组织卡片）
    tenantSummary: (s) => (tenantId) => {
      const tid = tenantId
      const inT = (x) => (x.tenantId || 't-star') === tid
      return {
        members: s.members.filter((m) => m.tenantId === tid).length,
        activeMembers: s.members.filter((m) => m.tenantId === tid && m.status === 'active').length,
        activities: s.activities.filter((a) => a.tenantId === tid).length,
        riskPending: s.riskOrders.filter((o) => inT(o) && ['pending', 'appealed'].includes(o.status)).length,
        shipments: s.shipments.filter(inT).length,
        afterSalePending: s.afterSales.filter((a) => inT(a) && ['pending', 'waiting_stock'].includes(a.status)).length,
        purchases: s.purchaseOrders.filter(inT).length,
        purchasePending: s.purchaseOrders.filter((o) => inT(o) && o.status === 'pending').length,
        coupons: s.coupons.filter(inT).length,
        reconOpen: s.reconBills.filter((b) => inT(b) && ['pending', 'reviewed'].includes(b.status)).length,
        auditToday: s.auditLogs.filter((l) => inT(l) && l.date === s.todayDate).length
      }
    },
    // 审计模块标签
    auditModuleLabel: () => (key) => AUDIT_MODULES[key] || key,
    // 全链路审计：按条件检索（filters: { tenantId, module, keyword, result, traceId }），最新在前
    auditEntries(s) {
      return (filters = {}) => {
        const kw = (filters.keyword || '').trim().toLowerCase()
        return s.auditLogs.filter((l) => {
          if (filters.tenantId && (l.tenantId || 't-star') !== filters.tenantId) return false
          if (filters.module && l.module !== filters.module) return false
          if (filters.result && l.result !== filters.result) return false
          if (filters.traceId && l.traceId !== filters.traceId) return false
          if (filters.actor && !(l.operator || '').toLowerCase().includes(filters.actor.toLowerCase())) return false
          if (kw) {
            const blob = `${l.actionLabel} ${l.detail} ${l.orderId} ${l.operator} ${l.ip || ''} ${l.traceId || ''}`.toLowerCase()
            if (!blob.includes(kw)) return false
          }
          return true
        })
      }
    },
    // 全链路追踪：同一 traceId 下的审计日志 + 卡券台账 + 积分流水（按时间正序还原链路）
    traceTimeline(s) {
      return (traceId) => {
        if (!traceId) return []
        const items = []
        s.auditLogs.filter((l) => l.traceId === traceId).forEach((l) =>
          items.push({ kind: 'audit', ts: l.logTs || 0, label: l.actionLabel, operator: l.operator,
            tenantId: l.tenantId || 't-star', detail: l.detail, date: l.date, time: l.time, result: l.result || 'success' }))
        s.couponLogs.filter((l) => l.traceId === traceId).forEach((l) =>
          items.push({ kind: 'coupon', ts: l.ts || 0, label: l.actionLabel, operator: l.operator,
            tenantId: l.tenantId || 't-star', detail: l.note ? `${l.tplName} ${l.code} ${l.note}` : `${l.tplName} ${l.code}`,
            date: l.date, time: l.time, result: 'success' }))
        s.pointRecords.filter((p) => p.traceId === traceId).forEach((p) =>
          items.push({ kind: 'points', ts: p.ts || 0, label: '积分流水', operator: p.note,
            tenantId: p.tenantId || 't-star', detail: `${p.note}（${p.delta > 0 ? '+' : ''}${p.delta}，余额 ${p.balance}）`,
            date: p.date, time: p.time, result: 'success' }))
        return items.sort((a, b) => a.ts - b.ts)
      }
    }
  },

  actions: {
    init() {
      // —— 多租户：平台方 + 入驻组织 + 成员账号 ——
      this.tenants = TENANTS.map((t) => ({ ...t }))
      this.members = [...PLATFORM_MEMBERS, ...MEMBERS].map((m) => ({ ...m }))
      this.customRoles = [
        {
          id: 'cr-star-1', tenantId: 't-star', key: 'cr_star_marketing', name: '营销主管（自定义）',
          icon: '🎯', builtin: false,
          desc: '组织管理员在权限中心自建：活动运营 + 卡券核销（无风控/对账权限），演示自定义角色与最小权限',
          permissions: ['activity:manage', 'points:view', 'coupon:redeem']
        }
      ]
      // 身份上下文：默认消费者，数据上下文为其归属租户
      this.identityKind = 'customer'
      this.activeTenantId = CUSTOMER.homeTenantId
      this.currentMemberId = ''
      this.user = { id: CUSTOMER.id, name: CUSTOMER.name, avatar: CUSTOMER.avatar }

      // 风控规则按租户隔离：每个入驻租户持有默认规则的独立副本
      this.riskRulesByTenant = {}
      TENANTS.forEach((t) => { this.riskRulesByTenant[t.id] = makeDefaultRiskRules() })

      // —— 业务数据：星河商贸 t-star ——
      this.activities = ACTIVITIES.map((a) => ({
        ...a,
        tenantId: 't-star',
        prizes: a.prizes.map((p) => ({ ...p, frozen: 0 }))
      }))
      // —— 云雀数科 t-cloud ——
      CLOUD_ACTIVITIES.forEach((a) => {
        this.activities.push({
          ...a,
          tenantId: 't-cloud',
          prizes: a.prizes.map((p) => ({ ...p, frozen: 0 }))
        })
      })
      this.tasks = TASKS.map((t) => ({
        ...t,
        done: false,
        claimed: false
      }))
      this.goods = [
        ...SHOP_GOODS.map((g) => ({ ...g, frozen: 0, tenantId: 't-star' })),
        ...CLOUD_GOODS.map((g) => ({ ...g, frozen: 0, tenantId: 't-cloud' }))
      ]
      // 以当前真实业务日为种子数据的日期基准（避免种子单据的日期落在"昨天"）
      this.todayDate = todayStr()
      this.seedRiskData()
    },

    // ===== 统一业务日切换 =====
    // 所有按日重置/统计的唯一入口：业务动作前、定时器轮询、页面重新可见时调用。
    // 跨日处理：
    //  - 重置每日任务（done/claimed 复位，可重新完成领取）；一次性任务保持已完成状态
    //  - 刷新 todayDate：每日限抽、风控当日频次从新日期起算
    //  - 保留累计抽奖次数、积分余额/流水，以及审核中（pending/appealed）单据的冻结积分与预占库存，支持跨日审核
    syncBusinessDay(showHint = false) {
      // 先做卡券到期扫描（每个业务动作都经过本入口，保证出示/核销前已过期券状态已流转）
      this.sweepCouponExpiry(true)
      const current = todayStr()
      if (current === this.todayDate) return false
      const prev = this.todayDate
      // 归档前兜底结算上一业务日的抽奖任务（幂等）：已达标的防漏发，审核中的留待放行后补计
      this.settleDrawTasks(prev)
      this.todayDate = current

      // 每日任务随业务日重置（保留一次性任务的进度与领取状态；
      // 抽奖类任务进度由真实参与记录按日推导，领奖记录留存在 taskClaims 台账，无需重置）
      this.tasks.forEach((t) => {
        if (t.type === 'daily' && !t.metric) {
          t.done = false
          t.claimed = false
        }
      })

      // 冻结权益不随跨日处置：待审核/已申诉单据仍占用冻结积分与预占库存，
      // 运营可在新业务日继续放行/撤销；累计次数、历史流水/记录同样保留。
      this.addAuditLog('day-rollover', null,
        `业务日由 ${prev} 切换为 ${current}：每日任务与每日限次已重置，任务进度与领奖记录按业务日归档保留，审核中冻结权益保留`)
      if (showHint) {
        this.showToast(`🌅 已跨日至 ${current}，每日任务与抽奖次数已刷新，审核中的冻结权益保留`, 'info')
      }
      return true
    },

    showToast(msg, type = 'info') {
      this.toast = { msg, type, id: Date.now() }
    },
    clearToast() {
      this.toast = null
    },

    gotoTab(tab) {
      this.activeTab = tab
    },

    // ===== 角色切换（演示权限，兼容旧入口） =====
    // 'operator' 切换为当前租户的组织管理员；'user' 切回消费者。
    // 页内各模块原有"用户/运营"视角按钮无需改造即可驱动 RBAC 身份体系。
    setRole(role) {
      if (role === 'operator') {
        const member = this.members.find((m) => m.tenantId === this.activeTenantId && m.roleKey === 'org_admin' && m.status === 'active')
          || this.members.find((m) => m.tenantId === this.activeTenantId && m.status === 'active')
        if (member) {
          this.loginAsMember(member.id, { legacy: true, silent: true })
          this.addAuditLog('switch-role', null, `切换为运营视角（${this.activeTenant.shortName} · ${member.name}）`, { module: 'auth' })
          this.showToast(`已切换为${this.activeTenant.shortName} · ${member.name}（${this.roleLabelOf(member.roleKey)}）`, 'info')
          return
        }
      }
      this.loginAsCustomer({ silent: true })
      this.addAuditLog('switch-role', null, '切换为用户视角', { module: 'auth' })
      this.showToast('已切换为普通用户视角', 'info')
    },

    // ===== 多租户身份与权限 =====
    // 当前操作者展示名（审计留痕用）
    actorName() {
      if (this.identityKind === 'platform') return `平台方(${this.user.name})`
      if (this.identityKind === 'staff') {
        const m = this.currentMember
        const t = this.tenants.find((x) => x.id === m?.tenantId)
        return `${t?.shortName || '租户'}·${this.user.name}`
      }
      return this.user.name
    },
    roleLabelOf(roleKey) {
      return this.roleOfKey(roleKey)?.name || roleKey
    },
    // 员工登录（成员选择 / 模拟登录）：停用账号被拒绝并写拒绝审计；登录成功才切换身份
    loginAsMember(memberId, opts = {}) {
      const m = this.members.find((x) => x.id === memberId)
      if (!m) {
        this.deny('login-denied', '成员不存在，登录被拒绝', { module: 'auth' })
        return false
      }
      if (m.status !== 'active') {
        // 不切换身份上下文：保持当前身份，仅记录拒绝事件
        this.deny('login-denied',
          `停用账号【${m.name}】尝试登录被拒绝（${m.disabledReason || '账号已停用'}）`,
          { module: 'auth', tenantId: m.tenantId || '' })
        return false
      }
      const trace = this.beginTrace()
      this.identityKind = m.tenantId ? 'staff' : 'platform'
      this.currentMemberId = m.id
      if (m.tenantId) this.activeTenantId = m.tenantId
      this.user = { id: m.id, name: m.name, avatar: m.avatar }
      this.role = 'operator'
      m.lastLoginAt = `${this.todayDate} ${nowTime()}`
      if (!opts.silent) {
        this.addAuditLog('login-member', m.id,
          `员工登录：${m.name}（${this.roleLabelOf(m.roleKey)}）进入${m.tenantId ? this.activeTenant.shortName + '数据上下文' : '平台方跨租户视图'}，IP ${m.ip}`,
          { module: 'auth', tenantId: m.tenantId || '', traceId: trace })
        this.showToast(`已登录：${m.name} · ${this.roleLabelOf(m.roleKey)}`, 'success')
      }
      return true
    },
    // 切回消费者
    loginAsCustomer(opts = {}) {
      this.identityKind = 'customer'
      this.currentMemberId = ''
      this.role = 'user'
      this.user = { id: CUSTOMER.id, name: CUSTOMER.name, avatar: CUSTOMER.avatar }
      if (CUSTOMER.homeTenantId) this.activeTenantId = CUSTOMER.homeTenantId
      if (!opts.silent) {
        this.addAuditLog('login-customer', null, `切换为消费者身份（${CUSTOMER.name}），数据上下文：${this.activeTenant.shortName}`, { module: 'auth' })
        this.showToast(`已切换为消费者：${CUSTOMER.name}`, 'info')
      }
      return true
    },
    // 切换数据上下文租户：消费者可"逛店"切换；员工仅可在本租户内（越权拒绝留痕）；平台方任意切换
    switchTenant(tenantId) {
      const t = this.tenants.find((x) => x.id === tenantId)
      if (!t || t.status !== 'active') {
        this.deny('tenant-denied', `租户不可用（${t?.name || tenantId}），切换被拒绝`, { module: 'auth' })
        return false
      }
      if (this.identityKind === 'staff') {
        const m = this.currentMember
        if (m?.tenantId !== tenantId) {
          this.deny('cross-tenant-denied',
            `员工【${m?.name}】尝试切换至非归属租户【${t.name}】被拒绝（数据强隔离：仅可访问 ${this.activeTenant.shortName}）`,
            { module: 'auth' })
          return false
        }
      }
      if (tenantId === this.activeTenantId) return true
      const trace = this.beginTrace()
      const from = this.activeTenantId
      this.activeTenantId = tenantId
      this.addAuditLog('switch-tenant', null,
        `${this.identityKind === 'platform' ? '平台方' : this.identityKind === 'staff' ? '员工' : '消费者'}切换数据上下文：${this.tenants.find((x) => x.id === from)?.shortName || from} → ${t.shortName}`,
        { module: 'auth', tenantId, traceId: trace })
      this.showToast(`已切换到 ${t.icon} ${t.shortName} 的数据视图`, 'info')
      return true
    },
    // 开启一次操作链路（返回 traceId；嵌套调用复用外层链路）
    beginTrace() {
      if (currentTrace) return currentTrace
      currentTrace = genTraceId()
      return currentTrace
    },
    endTrace() { currentTrace = '' },
    // 权限/越权统一拒绝：toast + 写 result=denied 审计（不改变任何业务数据）
    deny(action, detail, extra = {}) {
      this.lastDenied = { at: Date.now(), action, detail, perm: extra.perm || '', tenantId: extra.tenantId || this.activeTenantId }
      this.addAuditLog(action, extra.orderId || '', `⛔ ${detail}`, {
        module: extra.module || 'system',
        tenantId: extra.tenantId !== undefined ? extra.tenantId : this.activeTenantId,
        result: 'denied',
        traceId: extra.traceId
      })
      this.showToast(detail.replace(/^⛔\s*/, '⛔ '), 'warn')
      return false
    },
    // 权限校验（员工/平台按 RBAC；客户始终拒绝运营类权限）。失败自动写拒绝审计。
    requirePerm(perm, module = 'system', label = '') {
      if (this.can(perm)) return true
      const need = PERMISSION_LABELS[perm] || perm
      const who = this.identityKind === 'customer' ? '消费者身份' : `当前角色【${this.roleLabelOf(this.currentMember?.roleKey || '')}】`
      return this.deny('perm-denied', `${who}无「${label || need}」权限，操作已被拦截`, { module, perm })
    },
    // 租户归属校验（员工只能操作本租户数据；平台方放行）
    requireSameTenant(tenantId, module = 'system') {
      if (this.identityKind === 'platform') return true
      if (this.identityKind !== 'staff') return true // 客户的数据归属由各业务自身的 userId 校验负责
      const m = this.currentMember
      if (m && m.tenantId === (tenantId || this.activeTenantId)) return true
      return this.deny('cross-tenant-denied',
        `越权访问其他租户数据被拦截（${m?.name || '员工'} 归属 ${this.activeTenant.shortName}）`, { module })
    },

    // ===== 积分流水（append-only，禁止改写历史行） =====
    // extra（可选）：
    //   bizDate 该笔归属业务日（跨日补偿/补计用；默认取实际发生业务日 todayDate）
    //   refId   关联业务凭证（任务台账/对账差异单 id），用于逐笔勾稽与幂等判重
    //   refType 关联类型：task-claim | recon-bill
    addPointRecord(delta, note, kind = 'normal', extra = {}) {
      // 常规流水取当前时刻；对历史业务日补账的流水（任务结算/对账补偿/放行发奖）显式续在现有链末端 +1ms，
      // 保证其"期末余额"快照在按 ts 重放时落在链尾、余额链连续
      const appendFlow = extra.bizDate && extra.bizDate !== (extra.date || this.todayDate)
      const isChainTail = kind === 'recon-comp' || kind === 'task-comp' ||
        (appendFlow && (kind === 'reward' || kind === 'release'))
      // 时间戳严格单调递增：即使同一毫秒内连续多笔（脚本批量/连续点击），按 ts 重放顺序也与入账顺序一致，
      // 避免相同时间戳排序不稳定导致余额快照链错位
      const latestTs = this.pointRecords.reduce((mx, p) => Math.max(mx, p.ts || 0), 0)
      const chainTs = isChainTail ? latestTs + 1 : Math.max(Date.now(), latestTs + 1)
      const rec = {
        id: genId('pr'),
        date: extra.date || this.todayDate,
        bizDate: extra.bizDate || extra.date || this.todayDate,
        tenantId: extra.tenantId || this.activeTenantId,
        traceId: extra.traceId || (extra.silent ? '' : currentTrace) || '',
        time: extra.time || nowTime(),
        // 即使调用方显式指定 ts（种子/压测脚本），也强制严格晚于现有链尾：
        // 历史时间戳落在当前挂钟"未来"（种子按今天固定时刻构造）时，后记账不能排到链首，否则余额快照链断裂
        ts: extra.ts ? Math.max(extra.ts, latestTs + 1) : chainTs,
        delta,
        // 余额快照：调用方先改 this.points 再记账，快照即记账后余额
        balance: extra.balance !== undefined ? extra.balance : this.points,
        note,
        kind, // normal | frozen | release | refund | reward | task-comp | recon-comp
        refId: extra.refId || '',
        refType: extra.refType || ''
      }
      this.pointRecords.unshift(rec)
      // 流水是余额链、历史对账和奖励统计的共同底账，即使超过演示列表长度也只能归档，不能删除；
      // 删除任意历史行会让业务日净额和余额快照失去勾稽，进而误判缺笔并重复补偿。
      return rec
    },

    // ===== 操作记录（全链路审计日志，append-only） =====
    // extra：module 业务模块 | tenantId 归属租户 | result success|denied | traceId 链路追踪号 | silent 不继承当前链路
    addAuditLog(action, orderId, detail, extra = {}) {
      const member = this.identityKind === 'staff' || this.identityKind === 'platform' ? this.currentMember : null
      const log = {
        id: genId('log'),
        action,
        actionLabel: {
          freeze: '风控冻结',
          release: '审核放行',
          revoke: '审核撤销',
          appeal: '用户申诉',
          config: '规则变更',
          'task-settle': '任务结算',
          'switch-role': '视角切换',
          'switch-tenant': '租户切换',
          'login-member': '员工登录',
          'login-customer': '消费者切换',
          'login-denied': '登录被拒绝',
          'perm-denied': '权限拦截',
          'cross-tenant-denied': '越权拦截',
          'tenant-denied': '租户不可用',
          'member-create': '新增成员',
          'member-update': '成员变更',
          'member-toggle': '成员停用/启用',
          'member-role': '成员调岗',
          'role-create': '新建角色',
          'role-update': '角色权限变更',
          'role-delete': '删除角色',
          'tenant-create': '开通租户',
          'tenant-toggle': '租户停用/启用',
          'tenant-update': '租户配置变更',
          draw: '参与抽奖',
          redeem: '积分兑换',
          'day-rollover': '业务日切换',
          'recon-run': '对账执行',
          'recon-review': '对账复核',
          'recon-comp': '对账补偿',
          'recon-inject': '差异注入',
          'ship-create': '生成发货单',
          'ship-address': '填写收货信息',
          'ship-send': '运营发货',
          'ship-receive': '确认收货',
          'ship-trace': '物流轨迹同步',
          'aftersale-apply': '售后申请',
          'aftersale-approve': '售后审核通过',
          'aftersale-dismiss': '售后驳回',
          'coupon-issue': '卡券发放',
          'coupon-hold': '卡券预占',
          'coupon-deliver': '放行发券',
          'coupon-release': '预占释放',
          'coupon-redeem': '卡券核销',
          'coupon-expire': '卡券到期',
          'coupon-comp': '卡券补券',
          'budget-apply': '编制预算',
          'budget-approve': '预算审批通过',
          'budget-reject': '预算审批驳回',
          'budget-cancel': '撤销预算',
          'budget-freeze': '冻结预算',
          'budget-activate': '解冻预算',
          'budget-close': '关闭预算',
          'budget-adjust-apply': '预算调整申请',
          'budget-adjust-approve': '预算调整通过',
          'budget-adjust-reject': '预算调整驳回'
        }[action] || action,
        module: moduleOfAction(action, extra.module),
        orderId: orderId || '',
        operator: extra.operator || this.actorName(),
        actorKind: this.identityKind,                 // customer | staff | platform
        memberId: member?.id || '',
        tenantId: extra.tenantId !== undefined ? (extra.tenantId || '') : this.activeTenantId,
        traceId: extra.traceId || (extra.silent ? '' : currentTrace) || '',
        channel: extra.channel || (member ? '运营后台' : '移动端 H5'),
        ip: extra.ip || member?.ip || '112.65.*.*',
        result: extra.result || 'success',
        detail,
        date: this.todayDate,
        time: nowTime(),
        logTs: Date.now()
      }
      this.auditLogs.unshift(log)
      // 审计日志为全链路留痕底账，放大容量且只淘汰最旧条目
      if (this.auditLogs.length > 500) this.auditLogs.pop()
      return log
    },

    // ===== 风控规则评估 =====
    // 取指定租户的风控规则（缺失时补一份默认副本，保证规则配置天然按租户隔离）
    ensureRiskRules(tenantId = this.activeTenantId) {
      if (!this.riskRulesByTenant[tenantId]) {
        this.riskRulesByTenant[tenantId] = makeDefaultRiskRules()
      }
      return this.riskRulesByTenant[tenantId]
    },
    // 抽奖：返回命中的规则 code 列表
    evalDrawRisk(activity, prize) {
      const hit = []
      const r = this.ensureRiskRules(activity?.tenantId || this.activeTenantId)
      if (!r.enabled) return hit
      if (r.blacklist.includes(this.user.id)) hit.push('blacklist')
      if (r.highValueRarities.includes(prize.rarity)) hit.push('highValue')
      // 当日频次：含本次将达到阈值
      const todayCount = this.dailyDrawCount(activity.id)
      if (r.dailyDrawThreshold > 0 && todayCount + 1 >= r.dailyDrawThreshold) hit.push('dailyBurst')
      // 短时连抽
      if (r.rapidDrawSeconds > 0 && r.rapidDrawMax > 0) {
        const since = Date.now() - r.rapidDrawSeconds * 1000
        const recent = this.records.filter(
          (x) => x.type === 'draw' && x.status !== 'revoked' && x.ts && x.ts >= since &&
            (x.tenantId || 't-star') === this.activeTenantId
        ).length
        if (recent + 1 >= r.rapidDrawMax) hit.push('rapidDraw')
      }
      return hit
    },
    // 兑换：返回命中的规则 code 列表
    evalRedeemRisk(goods) {
      const hit = []
      const r = this.ensureRiskRules((goods && goods.tenantId) || this.activeTenantId)
      if (!r.enabled) return hit
      if (r.blacklist.includes(this.user.id)) hit.push('blacklist')
      if (goods.cost >= r.highValueRedeemCost) hit.push('highValue')
      if (r.rapidRedeemSeconds > 0 && r.rapidRedeemMax > 0) {
        const since = Date.now() - r.rapidRedeemSeconds * 1000
        const recent = this.records.filter(
          (x) => x.type === 'redeem' && x.status !== 'revoked' && x.ts && x.ts >= since &&
            (x.tenantId || 't-star') === this.activeTenantId
        ).length
        if (recent + 1 >= r.rapidRedeemMax) hit.push('rapidRedeem')
      }
      return hit
    },

    // ===== 抽奖任务自动结算 =====
    // 进度唯一来源：真实参与记录（validDrawCount）。冻结暂缓计入、放行补计、撤销不计。
    // 幂等：同一（任务, 归属业务日）仅发奖一次——taskClaims 判重，重复调用/跨日补审不会重复发奖。
    // 跨日：按参与记录的业务日（bizDate）归属结算，实际发放日 grantDate 单独记录，积分流水同步标注。
    settleDrawTasks(bizDate, tenantId = this.activeTenantId) {
      const date = bizDate || this.todayDate
      const tid = tenantId
      const drawTasks = this.tasks.filter((t) => t.metric === 'draw' && t.type === 'daily')
      if (!drawTasks.length) return []
      const valid = this.validDrawCount(date, tid)
      const settled = []
      drawTasks.forEach((t) => {
        if (valid < t.goal) return
        if (this.taskClaims.some((c) => c.taskId === t.id && c.bizDate === date && (c.tenantId || 't-star') === tid)) return // 已结算，防重
        const crossDay = date !== this.todayDate
        const claimId = genId('tc')
        this.points += t.reward
        const flow = this.addPointRecord(
          t.reward,
          `任务结算：${t.label}${crossDay ? `（${date} 业务日补计）` : ''}`,
          'reward',
          { bizDate: date, refId: claimId, refType: 'task-claim', tenantId: tid }
        )
        this.taskClaims.push({
          id: claimId,
          taskId: t.id,
          taskLabel: t.label,
          reward: t.reward,
          tenantId: tid,
          bizDate: date,               // 任务归属业务日（按真实参与记录日期）
          grantDate: this.todayDate,   // 实际发放业务日（跨日审核补计时晚于归属日）
          time: nowTime(),
          ts: Date.now(),
          source: 'auto',
          flowId: flow.id
        })
        // 营销预算占用：任务积分奖励实时占用租户积分预算（按台账 id 幂等）
        this._budgetOccupy('settle',
          [{ unit: 'points', amount: t.reward, scopeType: 'tenant', scopeId: tid, category: 'points', kind: 'task-reward' }],
          {
            category: 'points', kind: 'task-reward', refType: 'task-claim',
            refId: claimId, bizNo: t.label, summary: `任务奖励：${t.label} +${t.reward} 积分`,
            userId: this.user.id
          }, tid)
        this.addAuditLog('task-settle', null,
          `【${this.tenants.find((x) => x.id === tid)?.shortName || tid}】抽奖任务【${t.label}】达成（${date} 有效参与 ${valid}/${t.goal}），自动发放 ${t.reward} 积分${crossDay ? '（跨日审核补计）' : ''}`,
          { module: 'points', tenantId: tid })
        settled.push(t)
      })
      if (settled.length) {
        this.showToast(
          `🎯 任务达成【${settled.map((t) => t.label).join('、')}】，+${settled.reduce((s, t) => s + t.reward, 0)} 积分已自动结算`,
          'success')
      }
      return settled
    },

    // ===== 抽奖 =====
    draw(activityId) {
      this.syncBusinessDay()
      const trace = this.beginTrace()
      const act = this.activities.find((a) => a.id === activityId)
      if (!act || act.status !== 'running' || act.tenantId !== this.activeTenantId) {
        this.showToast('活动未在运行', 'warn')
        this.endTrace()
        return null
      }
      // 每日限抽
      if (this.dailyDrawCount(activityId) >= act.dailyLimit) {
        this.showToast(`今日已达抽奖上限（${act.dailyLimit} 次）`, 'warn')
        this.endTrace()
        return null
      }
      // 总限抽
      if (this.totalDrawCount(activityId) >= act.totalLimit) {
        this.showToast(`累计已达抽奖上限（${act.totalLimit} 次）`, 'warn')
        this.endTrace()
        return null
      }
      // 可抽取奖品（排除库存为 0 的实物，但"谢谢参与"始终保留）
      const drawable = act.prizes.filter((p) => p.remain > 0 || p.rarity === 'none')
      if (!drawable.length) {
        this.showToast('奖品已抽完', 'warn')
        this.endTrace()
        return null
      }
      const idx = drawByWeight(drawable)
      const prize = drawable[idx]
      // 积分成本校验（先校验后扣减，避免无奖品时误扣）
      const cost = act.costType === 'points' ? act.cost : 0
      if (cost > 0 && this.points < cost) {
        this.showToast('积分不足，无法参与', 'warn')
        this.endTrace()
        return null
      }

      // 风控评估（在任何扣减发生之前，杜绝部分扣减）
      const riskHits = this.evalDrawRisk(act, prize)
      // 营销预算预检：以实际抽中奖品为准（成本+积分奖励同时占用），超额/冻结整笔拦截
      const budgetItems = this._drawBudgetItems(act, prize, cost)
      if (!this._budgetGuard(budgetItems, act.tenantId)) { this.endTrace(); return null }
      if (riskHits.length) {
        const frozen = this.freezeDraw(act, prize, cost, riskHits, { budgetItems })
        this.endTrace()
        return frozen
      }

      // 正常放行
      if (cost > 0) {
        this.points -= cost
        this.addPointRecord(-cost, `参与活动【${act.name}】`, 'normal', { tenantId: act.tenantId, traceId: trace })
      }
      this.saveDayLog()
      if (prize.rarity !== 'none') {
        const orig = act.prizes.find((p) => p.id === prize.id)
        orig.remain -= 1
      }
      let pointDelta = 0
      if (prize.name.includes('积分')) {
        pointDelta = parseInt(prize.name) || 0
        this.points += pointDelta
      }

      const rec = {
        id: genId('r'),
        type: 'draw',
        status: 'normal',          // normal | frozen | released | revoked
        tenantId: act.tenantId,
        userId: this.user.id,
        userName: this.user.name,
        traceId: trace,
        date: this.todayDate,
        time: nowTime(),
        ts: Date.now(),
        activityId: act.id,
        activityName: act.name,
        prizeId: prize.id,
        prizeName: prize.name,
        rarity: prize.rarity,
        couponId: prize.couponId || '',
        icon: prize.emoji
      }
      this.records.unshift(rec)
      if (pointDelta) this.addPointRecord(pointDelta, `抽奖获得：${prize.name}`, 'reward', { tenantId: act.tenantId, traceId: trace })
      // 营销预算实时占用：抽奖成本 + 积分奖励（正常落账，按记录凭证幂等）
      this._budgetOccupy('settle', budgetItems, {
        category: 'draw', kind: 'draw-cost', refType: 'record',
        refId: rec.id, bizNo: act.name, summary: `抽奖成本/积分奖励：【${act.name}】抽中【${prize.name}】`,
        userId: rec.userId, traceId: trace
      }, act.tenantId)
      this.addAuditLog('draw', rec.id,
        `参与抽奖【${act.name}】抽中【${prize.name}】${cost ? `，消耗 ${cost} 积分` : '（免费）'}`,
        { module: 'activity', tenantId: act.tenantId, traceId: trace })
      // 券类奖品：发券至卡券账户（唯一券码，用户出示、运营核销）；实物奖品生成发货单
      const coupon = this.issueCouponForRecord(rec)
      // 实物奖品：生成发货单，引导用户填写收货信息（积分奖品/券/谢谢参与不涉及物流）
      const ship = this.createShipment(rec)
      if (coupon) this.showToast(`🎟️ 获得卡券【${coupon.name}】，券码已发至「卡券核销」，有效期至 ${coupon.expireDate}`, 'success')
      else if (ship) this.showToast(`🎉 获得实物：${prize.name}，请前往「物流发货」填写收货信息`, 'success')
      else if (prize.rarity === 'legendary') this.showToast(`🎉 传说大奖！${prize.name}`, 'success')
      else this.showToast(`获得：${prize.name}`, 'success')
      // 真实参与记录落账后，按归属业务日自动结算抽奖任务（达标即发奖，幂等防重）
      this.settleDrawTasks(rec.date, rec.tenantId)
      this.endTrace()
      return rec
    },

    // 冻结抽奖：占用成本积分 + 预占奖品库存，建立审核单
    freezeDraw(act, prize, cost, riskHits, opts = {}) {
      const trace = currentTrace || this.beginTrace()
      const traceId = trace
      if (cost > 0) {
        this.points -= cost
        this.addPointRecord(-cost, `冻结：参与【${act.name}】待风控审核`, 'frozen', { tenantId: act.tenantId, traceId: trace })
      }
      if (prize.rarity !== 'none') {
        const orig = act.prizes.find((p) => p.id === prize.id)
        orig.remain -= 1
        orig.frozen += 1
      }
      const rec = {
        id: genId('r'),
        type: 'draw',
        status: 'frozen',
        tenantId: act.tenantId,
        userId: this.user.id,
        userName: this.user.name,
        traceId: trace,
        date: this.todayDate,
        time: nowTime(),
        ts: Date.now(),
        activityId: act.id,
        activityName: act.name,
        prizeId: prize.id,
        prizeName: prize.name,
        rarity: prize.rarity,
        couponId: prize.couponId || '',
        icon: prize.emoji
      }
      this.records.unshift(rec)
      // 营销预算预占：冻结中的抽奖成本/积分奖励（放行核销、撤销释放，按记录凭证幂等）
      this._budgetOccupy('reserve', opts.budgetItems || this._drawBudgetItems(act, prize, cost), {
        category: 'draw', kind: 'draw-cost', refType: 'record',
        refId: rec.id, bizNo: act.name, summary: `风控冻结预占：抽奖【${act.name}】【${prize.name}】`,
        userId: rec.userId, traceId
      }, act.tenantId)
      const order = this.createRiskOrder({
        bizType: 'draw',
        recordId: rec.id,
        activityId: act.id,
        targetId: prize.id,
        targetName: prize.name,
        icon: prize.emoji,
        rarity: prize.rarity,
        cost,
        stockHeld: prize.rarity === 'none' ? 0 : 1,
        riskHits,
        tenantId: act.tenantId
      })
      rec.riskOrderId = order.id
      if (prize.couponId) this.addCouponLog('hold', null, rec, { orderId: order.id, traceId: trace })
      this.showToast('⚠️ 该次抽奖触发风控，奖品与积分已冻结，审核通过前不计入抽奖任务进度；可在「风控申诉」中查看/申诉', 'warn')
      return rec
    },

    // ===== 任务 =====
    completeTask(taskId) {
      this.syncBusinessDay()
      const t = this.tasks.find((x) => x.id === taskId)
      if (!t || t.claimed) return
      // 抽奖类任务由真实参与记录驱动，自动结算，禁止手动领取（防刷/防重复发奖）
      if (t.metric === 'draw') {
        this.showToast('抽奖任务按真实参与记录自动结算，达标后自动发奖', 'info')
        return
      }
      t.done = true
      this.claimTask(taskId)
    },
    claimTask(taskId) {
      this.syncBusinessDay()
      const t = this.tasks.find((x) => x.id === taskId)
      if (!t || t.claimed || !t.done) return
      if (t.metric === 'draw') return // 抽奖任务奖励仅由 settleDrawTasks 发放
      const tid = this.activeTenantId
      // 营销预算预检：手动任务奖励占用租户积分预算
      if (!this._budgetGuard([{ unit: 'points', amount: t.reward, scopeType: 'tenant', scopeId: tid, category: 'points', kind: 'task-reward' }], tid)) return
      t.claimed = true
      this.points += t.reward
      this.addPointRecord(t.reward, `完成任务：${t.label}`, 'reward')
      this._budgetOccupy('settle',
        [{ unit: 'points', amount: t.reward, scopeType: 'tenant', scopeId: tid, category: 'points', kind: 'task-reward' }],
        {
          category: 'points', kind: 'task-reward', refType: 'task-manual',
          refId: `${t.id}:${this.todayDate}:${this.user.id}`, bizNo: t.label,
          summary: `任务奖励：${t.label} +${t.reward} 积分`, userId: this.user.id
        }, tid)
      this.showToast(`获得 ${t.reward} 积分`, 'success')
    },
    // 一键签到
    checkInTask() {
      this.completeTask('t-checkin')
    },

    // ===== 商城兑换 =====
    redeem(goodsId) {
      this.syncBusinessDay()
      const trace = this.beginTrace()
      const traceId = trace
      const g = this.goods.find((x) => x.id === goodsId)
      if (!g || (g.tenantId || 't-star') !== this.activeTenantId) {
        this.showToast('商品不存在或不属于当前租户', 'warn')
        this.endTrace()
        return null
      }
      if (g.remain <= 0) {
        this.showToast('商品已兑完', 'warn')
        this.endTrace()
        return null
      }
      if (this.points < g.cost) {
        this.showToast('积分不足', 'warn')
        this.endTrace()
        return null
      }

      // 风控评估（扣减前）
      const riskHits = this.evalRedeemRisk(g)
      // 营销预算预检：兑换成本超出租户积分预算（或预算冻结关闭）时整笔拦截
      const budgetItems = this._redeemBudgetItems(g)
      if (!this._budgetGuard(budgetItems, g.tenantId)) { this.endTrace(); return null }
      if (riskHits.length) {
        const frozen = this.freezeRedeem(g, riskHits, { budgetItems })
        this.endTrace()
        return frozen
      }

      this.points -= g.cost
      g.remain -= 1
      this.addPointRecord(-g.cost, `兑换：${g.name}`, 'normal', { tenantId: g.tenantId, traceId: trace })
      const rec = {
        id: genId('rg'),
        type: 'redeem',
        status: 'normal',
        tenantId: g.tenantId,
        userId: this.user.id,
        userName: this.user.name,
        traceId: trace,
        date: this.todayDate,
        time: nowTime(),
        ts: Date.now(),
        goodsId: g.id,
        goodsName: g.name,
        couponId: g.couponId || '',
        icon: g.icon
      }
      this.records.unshift(rec)
      // 营销预算实时占用：兑换成本（按记录凭证幂等）
      this._budgetOccupy('settle', budgetItems, {
        category: 'redeem', kind: 'redeem-cost', refType: 'record',
        refId: rec.id, bizNo: g.name, summary: `积分兑换成本：【${g.name}】×${g.cost} 积分`,
        userId: rec.userId, traceId
      }, g.tenantId)
      this.addAuditLog('redeem', rec.id, `积分兑换【${g.name}】，扣减 ${g.cost} 积分`, { module: 'points', tenantId: g.tenantId, traceId: trace })
      // 券类商品：发券至卡券账户；实物商品生成发货单（其余虚拟权益直接到账）
      const coupon = this.issueCouponForRecord(rec)
      const ship = this.createShipment(rec)
      if (coupon) this.showToast(`🎟️ 兑换成功：${g.name}，券码已发至「卡券核销」，有效期至 ${coupon.expireDate}`, 'success')
      else if (ship) this.showToast(`兑换成功：${g.name}，请前往「物流发货」填写收货信息`, 'success')
      else this.showToast(`兑换成功：${g.name}`, 'success')
      this.endTrace()
      return rec
    },

    // 冻结兑换：占用积分 + 预占商品库存
    freezeRedeem(g, riskHits, opts = {}) {
      const trace = currentTrace || this.beginTrace()
      const traceId = trace
      this.points -= g.cost
      g.remain -= 1
      g.frozen += 1
      this.addPointRecord(-g.cost, `冻结：兑换【${g.name}】待风控审核`, 'frozen', { tenantId: g.tenantId, traceId: trace })
      const rec = {
        id: genId('rg'),
        type: 'redeem',
        status: 'frozen',
        tenantId: g.tenantId,
        userId: this.user.id,
        userName: this.user.name,
        traceId: trace,
        date: this.todayDate,
        time: nowTime(),
        ts: Date.now(),
        goodsId: g.id,
        goodsName: g.name,
        couponId: g.couponId || '',
        icon: g.icon
      }
      this.records.unshift(rec)
      // 营销预算预占：冻结中的兑换成本（放行核销、撤销释放）
      this._budgetOccupy('reserve', opts.budgetItems || this._redeemBudgetItems(g), {
        category: 'redeem', kind: 'redeem-cost', refType: 'record',
        refId: rec.id, bizNo: g.name, summary: `风控冻结预占：积分兑换【${g.name}】×${g.cost} 积分`,
        userId: rec.userId, traceId
      }, g.tenantId)
      const order = this.createRiskOrder({
        bizType: 'redeem',
        recordId: rec.id,
        targetId: g.id,
        targetName: g.name,
        icon: g.icon,
        cost: g.cost,
        stockHeld: 1,
        riskHits,
        tenantId: g.tenantId
      })
      rec.riskOrderId = order.id
      if (g.couponId) this.addCouponLog('hold', null, rec, { orderId: order.id, traceId: trace })
      this.showToast('⚠️ 该笔兑换触发风控，积分与商品已冻结，可在「风控申诉」中查看/申诉', 'warn')
      return rec
    },

    // ===== 风控审核单 =====
    createRiskOrder({ bizType, recordId, activityId = null, targetId, targetName, icon, rarity = null, cost, stockHeld, riskHits, tenantId = this.activeTenantId }) {
      const order = {
        id: genId('rk'),
        bizType,                    // draw | redeem
        status: 'pending',          // pending | appealed | released | revoked
        tenantId,
        userId: this.user.id,
        userName: this.user.name,
        recordId,
        activityId,
        targetId,
        targetName,
        icon,
        rarity,
        frozenPoints: cost || 0,    // 冻结的成本积分
        stockHeld,                  // 预占库存数量
        rules: riskHits.map((code) => ({ code, label: RULE_LABELS[code] || code })),
        appealReason: '',
        appealAt: '',
        reviewNote: '',
        reviewer: '',
        createdAt: this.todayDate,
        time: nowTime(),
        ts: Date.now(),
        reviewedAt: ''
      }
      this.riskOrders.unshift(order)
      this.addAuditLog('freeze', order.id,
        `${bizType === 'draw' ? '抽奖' : '兑换'}【${targetName}】命中规则：${order.rules.map((r) => r.label).join('、')}，冻结${cost || 0}积分${stockHeld ? `、预占库存×${stockHeld}` : ''}${bizType === 'draw' ? '；该笔暂缓计入抽奖任务进度' : ''}`,
        { module: 'risk', tenantId })
      return order
    },

    // 用户申诉（仅本人、且单据处于待审核/已申诉可补充）
    appealRisk(orderId, reason) {
      this.syncBusinessDay()
      const trace = this.beginTrace()
      const o = this.riskOrders.find((x) => x.id === orderId)
      if (!o) { this.endTrace(); return false }
      if (this.role === 'operator') {
        this.deny('appeal-denied', '运营视角无需申诉，请切换到用户视角', { module: 'risk', tenantId: o.tenantId, traceId: trace })
        this.endTrace()
        return false
      }
      if (o.userId !== this.user.id) {
        this.deny('appeal-denied', '只能对自己的单据申诉', { module: 'risk', tenantId: o.tenantId, traceId: trace })
        this.endTrace()
        return false
      }
      if (o.status !== 'pending' && o.status !== 'appealed') {
        this.showToast('该单据已处理，无法申诉', 'warn')
        this.endTrace()
        return false
      }
      if (!reason || !reason.trim()) {
        this.showToast('请填写申诉理由', 'warn')
        this.endTrace()
        return false
      }
      o.status = 'appealed'
      o.appealReason = reason.trim()
      o.appealAt = `${this.todayDate} ${nowTime()}`
      this.addAuditLog('appeal', o.id, `用户提交申诉：${o.appealReason}`, { module: 'risk', tenantId: o.tenantId, traceId: trace })
      this.showToast('申诉已提交，等待运营审核', 'success')
      this.endTrace()
      return true
    },

    // 运营放行（幂等：仅 pending/appealed 可处理；RBAC：risk:review；数据隔离：仅本租户单）
    releaseRisk(orderId, note = '') {
      this.syncBusinessDay()
      const trace = this.beginTrace()
      const traceId = trace
      const o = this.riskOrders.find((x) => x.id === orderId)
      if (!o) { this.endTrace(); return }
      if (!this.requirePerm('risk:review', 'risk') || !this.requireSameTenant(o.tenantId, 'risk')) {
        this.endTrace()
        return
      }
      if (o.status !== 'pending' && o.status !== 'appealed') {
        this.showToast('该单据已处理，请勿重复操作', 'warn')
        this.endTrace()
        return
      }
      const rec = this.records.find((r) => r.id === o.recordId)
      if (!rec) {
        this.showToast('关联业务记录缺失，无法处理', 'warn')
        this.endTrace()
        return
      }

      if (o.bizType === 'draw') {
        // 核销预占库存（remain 已扣，仅清 frozen）
        if (o.stockHeld) {
          const act = this.activities.find((a) => a.id === o.activityId)
          const prize = act?.prizes.find((p) => p.id === o.targetId)
          if (prize) prize.frozen = Math.max(0, prize.frozen - 1)
        }
        // 积分奖品此刻才入账（归属原参与业务日；跨日审核时流水续在链尾、对账不串当日）
        const n = parseInt(o.targetName) || 0
        if (o.targetName.includes('积分') && n > 0) {
          this.points += n
          this.addPointRecord(n, `审核放行：抽奖奖品【${o.targetName}】`, 'release', {
            bizDate: o.createdAt, tenantId: o.tenantId, traceId: trace
          })
        }
      } else {
        const g = this.goods.find((x) => x.id === o.targetId)
        if (g) g.frozen = Math.max(0, g.frozen - 1)
      }

      o.status = 'released'
      o.reviewNote = note
      o.reviewer = this.user.name
      o.reviewedAt = `${this.todayDate} ${nowTime()}`
      rec.status = 'released'
      // 营销预算：冻结预占核销为实际成本（放行即确认营销支出，幂等）
      this._budgetConvertReserved('record', rec.id, 'settle', {
        summary: `风控放行核销预占：${o.bizType === 'draw' ? '抽奖' : '兑换'}【${o.targetName}】`,
        traceId
      }, o.tenantId)
      this.addAuditLog('release', o.id,
        `放行${o.bizType === 'draw' ? '抽奖' : '兑换'}【${o.targetName}】${note ? '；备注：' + note : ''}`,
        { module: 'risk', tenantId: o.tenantId, traceId: trace })
      // 放行后券类才"交付"：发券至卡券账户（冻结期仅预占库存、未发券）；实物则生成发货单
      const coupon = this.issueCouponForRecord(rec, { orderId: o.id, source: '风控放行' })
      // 放行后实物才"发奖"：生成发货单并通知用户填写收货信息（冻结期间不产生发货单）
      const ship = this.createShipment(rec)
      this.showToast(coupon
        ? `已放行【${o.targetName}】，券码已发至卡券账户（有效期自放行日起算）`
        : ship
          ? `已放行【${o.targetName}】，发货单已生成，等待用户填写收货信息`
          : `已放行【${o.targetName}】`, 'success')
      // 抽奖放行后按记录归属业务日补计任务进度（跨日审核不串当日账，幂等防重复发奖）
      if (o.bizType === 'draw') this.settleDrawTasks(rec.date, rec.tenantId)
      this.endTrace()
      return true
    },

    // 运营撤销：返还积分、回补库存、业务记录作废（幂等；RBAC：risk:review）
    revokeRisk(orderId, note = '') {
      this.syncBusinessDay()
      const trace = this.beginTrace()
      const traceId = trace
      const o = this.riskOrders.find((x) => x.id === orderId)
      if (!o) { this.endTrace(); return }
      if (!this.requirePerm('risk:review', 'risk') || !this.requireSameTenant(o.tenantId, 'risk')) {
        this.endTrace()
        return
      }
      if (o.status !== 'pending' && o.status !== 'appealed') {
        this.showToast('该单据已处理，请勿重复操作', 'warn')
        this.endTrace()
        return
      }
      const rec = this.records.find((r) => r.id === o.recordId)
      if (!rec) {
        this.showToast('关联业务记录缺失，无法处理', 'warn')
        this.endTrace()
        return
      }

      // 返还冻结的成本积分
      if (o.frozenPoints > 0) {
        this.points += o.frozenPoints
        this.addPointRecord(o.frozenPoints,
          `撤销返还：${o.bizType === 'draw' ? '抽奖' : '兑换'}【${o.targetName}】`, 'refund',
          { tenantId: o.tenantId, traceId: trace })
      }
      // 回补库存（remain 回补 + frozen 释放）
      if (o.bizType === 'draw') {
        if (o.stockHeld) {
          const act = this.activities.find((a) => a.id === o.activityId)
          const prize = act?.prizes.find((p) => p.id === o.targetId)
          if (prize) {
            prize.frozen = Math.max(0, prize.frozen - 1)
            prize.remain += 1
          }
        }
      } else {
        const g = this.goods.find((x) => x.id === o.targetId)
        if (g) {
          g.frozen = Math.max(0, g.frozen - 1)
          g.remain += 1
        }
      }

      o.status = 'revoked'
      o.reviewNote = note
      o.reviewer = this.user.name
      o.reviewedAt = `${this.todayDate} ${nowTime()}`
      rec.status = 'revoked'
      // 营销预算：冻结预占释放（撤销即冲回营销支出占用，幂等）
      this._budgetConvertReserved('record', rec.id, 'release', {
        summary: `风控撤销释放预占：${o.bizType === 'draw' ? '抽奖' : '兑换'}【${o.targetName}】`,
        traceId
      }, o.tenantId)
      // 券类预占释放：冻结期未发券，撤销后券始终不存在；库存回补由下方统一处理
      if (rec.couponId) this.addCouponLog('revoke', null, rec, { orderId: o.id, traceId: trace })
      this.addAuditLog('revoke', o.id,
        `撤销${o.bizType === 'draw' ? '抽奖' : '兑换'}【${o.targetName}】，返还${o.frozenPoints}积分${o.stockHeld ? `、回补库存×${o.stockHeld}` : ''}${rec.couponId ? '、释放预占券（未发放）' : ''}${o.bizType === 'draw' ? '；该笔不计入抽奖任务进度（冻结期间暂缓，撤销后确认回退）' : ''}${note ? '；备注：' + note : ''}`,
        { module: 'risk', tenantId: o.tenantId, traceId: trace })
      this.showToast(`已撤销【${o.targetName}】，积分与库存已返还`, 'info')
      this.endTrace()
    },

    // ===== 实物收货 / 发货流程 =====
    // 状态机：pending_address（待填地址）→ to_ship（待运营接单发货）→ shipped（已发货/待收货）→ received（已收货）
    // 仅"有效"实物业务记录（正常落账 normal / 风控放行 released）生成发货单；
    // 风控冻结中不生成（放行才发奖）、撤销作废不生成（已返还库存/积分）。
    _isPhysicalRecord(rec) {
      // 券类一律走卡券账户核销，不走物流
      if (rec.couponId) return false
      if (rec.type === 'draw') {
        if (rec.rarity === 'none') return false
        const prize = this.activities.find((a) => a.id === rec.activityId)
          ?.prizes.find((p) => p.id === rec.prizeId)
        if (prize && prize.physical !== undefined) return !!prize.physical
        return !rec.prizeName.includes('积分') // 兜底：积分奖品为虚拟
      }
      const g = this.goods.find((x) => x.id === rec.goodsId)
      if (g && g.physical !== undefined) return !!g.physical
      return true // 兜底：商城商品默认实物
    },

    // 有效实物中奖/兑换 → 生成发货单（幂等：一条业务记录至多一张）
    createShipment(rec) {
      if (!rec) return null
      if (rec.status !== 'normal' && rec.status !== 'released') return null
      if (!this._isPhysicalRecord(rec)) return null
      if (this.shipments.some((o) => o.recordId === rec.id)) return null
      const isDraw = rec.type === 'draw'
      const order = {
        id: genId('sp'),
        recordId: rec.id,
        bizType: rec.type,                   // draw | redeem
        status: 'pending_address',
        tenantId: rec.tenantId || this.activeTenantId,
        userId: rec.userId || this.user.id,
        userName: rec.userName || this.user.name,
        traceId: rec.traceId || currentTrace || '',
        icon: rec.icon,
        targetName: isDraw ? rec.prizeName : rec.goodsName,
        activityId: isDraw ? rec.activityId : null,
        source: rec.status === 'released' ? '风控放行' : (isDraw ? '中奖' : '积分兑换'),
        date: this.todayDate, time: nowTime(), ts: Date.now(),
        // 用户收货信息
        receiver: '', phone: '', region: '', address: '', addressAt: '',
        // 运营接单 / 发货
        shipper: '', carrier: '', trackingNo: '', shipNote: '', shippedAt: '',
        // 用户确认收货
        receivedAt: '',
        // 物流轨迹（append-only）：发货后同步快递节点 揽收→干线→派送→签收；售后退回/确认收货亦追加节点
        traces: [],
        // 售后回写：关联售后单与退回时间
        afterSaleId: '', returnedAt: '', originId: ''
      }
      this.shipments.unshift(order)
      this.addAuditLog('ship-create', order.id,
        `${isDraw ? '中奖' : '兑换'}实物【${order.targetName}】生成发货单，待用户填写收货信息`,
        { module: 'ship', tenantId: order.tenantId, traceId: order.traceId })
      return order
    },

    // 用户填写 / 更新收货信息（仅本人；发货前可修改，提交后进入运营待发货队列）
    submitShipAddress(shipmentId, form) {
      this.syncBusinessDay()
      const trace = this.beginTrace()
      const o = this.shipments.find((x) => x.id === shipmentId)
      if (!o) { this.endTrace(); return false }
      if (this.role === 'operator') {
        this.deny('ship-denied', '运营视角不代用户填写收货信息，请切换到用户视角', { module: 'ship', tenantId: o.tenantId, traceId: trace })
        this.endTrace()
        return false
      }
      if (o.userId !== this.user.id || (o.tenantId || 't-star') !== this.activeTenantId) {
        this.deny('ship-denied', '只能填写自己在当前租户的收货信息', { module: 'ship', tenantId: o.tenantId, traceId: trace })
        this.endTrace()
        return false
      }
      if (o.status === 'shipped' || o.status === 'received') {
        this.showToast('已发货，收货信息不可修改', 'warn')
        this.endTrace()
        return false
      }
      const receiver = (form.receiver || '').trim()
      const phone = String(form.phone || '').replace(/[\s-]/g, '')
      const region = (form.region || '').trim()
      const address = (form.address || '').trim()
      if (!receiver) { this.showToast('请填写收货人姓名', 'warn'); this.endTrace(); return false }
      if (!/^1\d{10}$/.test(phone)) { this.showToast('请填写正确的 11 位手机号', 'warn'); this.endTrace(); return false }
      if (!region) { this.showToast('请填写所在地区（省/市/区）', 'warn'); this.endTrace(); return false }
      if (!address) { this.showToast('请填写详细收货地址', 'warn'); this.endTrace(); return false }
      const first = o.status === 'pending_address'
      o.receiver = receiver
      o.phone = phone
      o.region = region
      o.address = address
      o.status = 'to_ship'
      o.addressAt = `${this.todayDate} ${nowTime()}`
      this.addAuditLog('ship-address', o.id,
        `${first ? '填写' : '更新'}收货信息：${receiver} ${phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2')} ${region} ${address}`,
        { module: 'ship', tenantId: o.tenantId, traceId: trace })
      this.showToast(first ? '📮 收货信息已提交，等待运营接单发货' : '收货信息已更新', 'success')
      this.endTrace()
      return true
    },

    // 运营接单发货（RBAC：ship:send；仅本租户、仅 to_ship，幂等防重复发货）
    shipShipment(shipmentId, form) {
      const trace = this.beginTrace()
      const o = this.shipments.find((x) => x.id === shipmentId)
      if (!o) { this.endTrace(); return false }
      if (!this.requirePerm('ship:send', 'ship') || !this.requireSameTenant(o.tenantId, 'ship')) {
        this.endTrace()
        return false
      }
      if (o.status !== 'to_ship') {
        this.showToast('该发货单当前状态不可发货（需用户先填写收货信息）', 'warn')
        this.endTrace()
        return false
      }
      const carrier = (form.carrier || '').trim()
      const trackingNo = (form.trackingNo || '').trim()
      if (!carrier) { this.showToast('请填写快递公司', 'warn'); this.endTrace(); return false }
      if (!trackingNo) { this.showToast('请填写快递单号', 'warn'); this.endTrace(); return false }
      o.carrier = carrier
      o.trackingNo = trackingNo
      o.shipNote = (form.note || '').trim()
      o.shipper = this.user.name
      o.status = 'shipped'
      o.shippedAt = `${this.todayDate} ${nowTime()}`
      // 发货即生成首个物流节点（已揽收），后续由 syncShipmentTrace 同步快递轨迹
      this._appendTrace(o, 'collected', `${carrier} 已揽收包裹（单号 ${trackingNo}）`)
      this.addAuditLog('ship-send', o.id,
        `接单发货【${o.targetName}】：${carrier} 单号 ${trackingNo}，收件人 ${o.receiver}（${o.region} ${o.address}）${o.shipNote ? '；备注：' + o.shipNote : ''}`,
        { module: 'ship', tenantId: o.tenantId, traceId: trace })
      this.showToast(`📦 已接单发货：${o.targetName}（${carrier} ${trackingNo}）`, 'success')
      this.endTrace()
      return true
    },

    // ===== 物流轨迹同步 =====
    // 追加一个轨迹节点（append-only；节点时间取当前业务日/时刻）
    _appendTrace(o, stage, text) {
      const node = { stage, text, date: this.todayDate, time: nowTime(), ts: Date.now() }
      o.traces.push(node)
      return node
    },
    // 快递标准节点流：揽收 → 干线运输 → 派送 → 签收
    _traceFlow(o) {
      return [
        { stage: 'collected', text: `${o.carrier} 已揽收包裹（单号 ${o.trackingNo}）` },
        { stage: 'transit', text: `包裹离开揽收网点，干线运输中，发往【${o.region}】` },
        { stage: 'delivering', text: `包裹到达【${o.region}】派送点，派送员王师傅 138****6666 正在派送` },
        { stage: 'signed', text: '包裹已签收，签收人：本人' }
      ]
    },
    // 同步快递轨迹：发货后每次同步向下推进一个节点（幂等：已到签收终态不再推进；退回/已收货单不推进）
    // RBAC：员工需 ship:trace；客户仅可同步本人订单
    syncShipmentTrace(shipmentId) {
      this.syncBusinessDay()
      const trace = this.beginTrace()
      const o = this.shipments.find((x) => x.id === shipmentId)
      if (!o) { this.endTrace(); return false }
      if (this.role === 'operator') {
        if (!this.requirePerm('ship:trace', 'ship') || !this.requireSameTenant(o.tenantId, 'ship')) {
          this.endTrace()
          return false
        }
      } else if (o.userId !== this.user.id || (o.tenantId || 't-star') !== this.activeTenantId) {
        this.deny('ship-denied', '只能查询自己的物流轨迹', { module: 'ship', tenantId: o.tenantId, traceId: trace })
        this.endTrace()
        return false
      }
      if (o.status !== 'shipped') {
        this.showToast(o.status === 'returned' ? '该单已退回，物流已终止' : '当前状态无需同步物流', 'info')
        this.endTrace()
        return false
      }
      const flow = this._traceFlow(o)
      const next = flow.find((f) => !o.traces.some((t) => t.stage === f.stage))
      if (!next) {
        this.showToast('物流已更新至最新（已签收）', 'info')
        this.endTrace()
        return false
      }
      this._appendTrace(o, next.stage, next.text)
      this.addAuditLog('ship-trace', o.id,
        `同步物流轨迹【${o.targetName}】（${o.carrier} ${o.trackingNo}）：${next.text}`,
        { module: 'ship', tenantId: o.tenantId, traceId: trace })
      this.showToast(`🚚 物流更新：${next.text}`, 'success')
      this.endTrace()
      return true
    },

    // 用户确认收货（仅本人、仅已发货可确认）
    receiveShipment(shipmentId) {
      const trace = this.beginTrace()
      const o = this.shipments.find((x) => x.id === shipmentId)
      if (!o) { this.endTrace(); return false }
      if (this.role === 'operator') {
        this.deny('ship-denied', '由用户本人确认收货，请切换到用户视角', { module: 'ship', tenantId: o.tenantId, traceId: trace })
        this.endTrace()
        return false
      }
      if (o.userId !== this.user.id || (o.tenantId || 't-star') !== this.activeTenantId) {
        this.deny('ship-denied', '只能确认自己的发货单', { module: 'ship', tenantId: o.tenantId, traceId: trace })
        this.endTrace()
        return false
      }
      if (o.status !== 'shipped') { this.showToast('仅已发货的订单可确认收货', 'warn'); this.endTrace(); return false }
      o.status = 'received'
      o.receivedAt = `${this.todayDate} ${nowTime()}`
      // 轨迹尚未同步到签收节点的，确认收货时补齐终态节点（幂等：已签收不重复追加）
      if (!o.traces.some((t) => t.stage === 'signed')) {
        this._appendTrace(o, 'signed', '包裹已签收，签收人：本人（用户确认收货）')
      }
      this.addAuditLog('ship-receive', o.id,
        `确认收货【${o.targetName}】（${o.carrier} ${o.trackingNo}），订单完成`,
        { module: 'ship', tenantId: o.tenantId, traceId: trace })
      this.showToast(`✅ 已确认收货：${o.targetName}`, 'success')
      this.endTrace()
      return true
    },

    // ===== 售后闭环：拒收 / 退货 / 补发 =====
    // 状态机：pending 待审核 → done 已完成（审核通过并回写）｜ dismissed 已驳回（不动账）
    // 回写口径：拒收/退货 → 库存回补 + 积分返还（append-only refund 流水）+ 发货单→已退回；
    //          补发 → 库存再扣 1 + 生成补发发货单（沿用原地址，不退款）。
    // 异常回退：审核前统一校验（库存余量/单据状态），任一不满足则整体不落账；驳回不产生任何账务变动。
    // 对账口径：售后退款计入 P1 应有净额（按审核日）；退回/补发计入 P5 有效消耗修正。

    // 售后单关联的业务记录
    _recordOfShipment(o) {
      return this.records.find((r) => r.id === o.recordId) || null
    },
    // 业务记录对应的退款积分（售后返还口径：兑换成本 / 抽奖参与成本；免费抽奖为 0）
    _refundOfRecord(rec) {
      if (!rec) return 0
      if (rec.type === 'draw') return this._drawCostOf(rec)
      return this.goods.find((g) => g.id === rec.goodsId)?.cost || 0
    },
    // 业务记录对应的库存定位快照（售后单落账时固化，后续商品/奖品变更不影响勾稽）
    _stockKeyOfRecord(rec) {
      if (!rec) return {}
      return rec.type === 'draw'
        ? { targetType: 'prize', activityId: rec.activityId, targetId: rec.prizeId }
        : { targetType: 'goods', activityId: null, targetId: rec.goodsId }
    },
    _stockTargetOf(snap) {
      return snap.targetType === 'prize'
        ? this.activities.find((a) => a.id === snap.activityId)?.prizes.find((p) => p.id === snap.targetId)
        : this.goods.find((g) => g.id === snap.targetId)
    },

    // 用户申请售后（仅本人；类型与发货单状态匹配；同一发货单已有待审核单则幂等拦截）
    applyAfterSale(shipmentId, type, reason) {
      this.syncBusinessDay()
      const trace = this.beginTrace()
      const o = this.shipments.find((x) => x.id === shipmentId)
      if (!o) { this.endTrace(); return null }
      if (this.role === 'operator') {
        this.deny('aftersale-denied', '运营视角不代用户申请售后，请切换到用户视角', { module: 'aftersale', tenantId: o.tenantId, traceId: trace })
        this.endTrace()
        return null
      }
      if (o.userId !== this.user.id || (o.tenantId || 't-star') !== this.activeTenantId) {
        this.deny('aftersale-denied', '只能对自己的发货单申请售后', { module: 'aftersale', tenantId: o.tenantId, traceId: trace })
        this.endTrace()
        return null
      }
      const meta = AFTERSALE_TYPES[type]
      if (!meta) { this.showToast('不支持的售后类型', 'warn'); this.endTrace(); return null }
      // 状态机：拒收仅限已发货未签收；退货仅限已收货；补发限已发货/已收货
      const allow = { reject: ['shipped'], return: ['received'], reship: ['shipped', 'received'] }[type]
      if (!allow.includes(o.status)) {
        this.showToast(`当前状态（${SHIP_STATUS[o.status]?.label || o.status}）不可申请${meta.label}`, 'warn')
        this.endTrace()
        return null
      }
      if (this.afterSales.some((a) => a.shipmentId === shipmentId && (a.status === 'pending' || a.status === 'waiting_stock'))) {
        this.showToast('该发货单已有待处理（待审核/待补货）的售后申请，请勿重复提交', 'warn')
        this.endTrace()
        return null
      }
      if (this.afterSales.some((a) => a.shipmentId === shipmentId && a.status === 'done' && a.type === type)) {
        this.showToast(`该发货单已完成过${meta.label}售后，不可重复申请`, 'warn')
        this.endTrace()
        return null
      }
      const text = (reason || '').trim()
      if (!text) { this.showToast('请填写售后原因', 'warn'); this.endTrace(); return null }
      const rec = this._recordOfShipment(o)
      const refund = type === 'reship' ? 0 : this._refundOfRecord(rec)
      const as = {
        id: genId('as'),
        shipmentId: o.id,
        recordId: o.recordId,
        tenantId: o.tenantId || 't-star',
        traceId: trace,
        userId: o.userId,
        userName: o.userName,
        type,
        typeLabel: meta.label,
        reason: text,
        status: 'pending',
        icon: o.icon,
        targetName: o.targetName,
        ...this._stockKeyOfRecord(rec),
        refundPoints: refund,          // 审核通过时返还的积分快照（补发为 0）
        reshipmentId: '',              // 补发审核通过后生成的新发货单
        createdAt: this.todayDate, time: nowTime(), ts: Date.now(),
        reviewedAt: '', reviewer: '', reviewNote: ''
      }
      this.afterSales.unshift(as)
      this.addAuditLog('aftersale-apply', as.id,
        `用户申请${meta.label}【${o.targetName}】（发货单 ${o.id}，${o.carrier} ${o.trackingNo}）：${text}${refund ? `；待审核返还 ${refund} 积分` : ''}`,
        { module: 'aftersale', tenantId: as.tenantId, traceId: trace })
      this.showToast(`📮 ${meta.label}申请已提交，等待运营审核`, 'success')
      this.endTrace()
      return as
    },

    // 运营审核售后（幂等：仅 pending 可审；驳回不动账；通过则一次性回写库存/积分/发货单/台账）
    // RBAC：aftersale:review；数据隔离：仅本租户售后单
    // 补发缺货：售后单转为 waiting_stock 待补货（同样不落账），采购验收入库后可从待处理售后继续履约
    reviewAfterSale(afterSaleId, approve, note = '') {
      this.syncBusinessDay()
      const trace = this.beginTrace()
      const traceId = trace
      const as = this.afterSales.find((x) => x.id === afterSaleId)
      if (!as) { this.endTrace(); return false }
      if (!this.requirePerm('aftersale:review', 'aftersale') || !this.requireSameTenant(as.tenantId, 'aftersale')) {
        this.endTrace()
        return false
      }
      // waiting_stock：采购入库后的「继续履约」入口，仅补发单、仅同意继续可执行
      const continuing = as.status === 'waiting_stock'
      if (as.status !== 'pending' && !continuing) {
        this.showToast('该售后单已处理，请勿重复操作', 'warn')
        this.endTrace()
        return false
      }
      if (continuing && !approve) {
        this.showToast('待补货售后单仅可在采购入库后继续履约，不能驳回（如需终止请新建处理）', 'warn')
        this.endTrace()
        return false
      }
      const o = this.shipments.find((x) => x.id === as.shipmentId)
      if (!o) { this.showToast('关联发货单缺失，无法审核', 'warn'); this.endTrace(); return false }
      const remark = (note || '').trim()

      if (!approve) {
        // 驳回：仅留痕，不产生任何账务/库存/状态变动（待补货单继续履约时不走此分支）
        as.status = 'dismissed'
        as.reviewedAt = `${this.todayDate} ${nowTime()}`
        as.reviewer = this.user.name
        as.reviewNote = remark
        this.addAuditLog('aftersale-dismiss', as.id,
          `驳回${as.typeLabel}申请【${as.targetName}】（发货单 ${o.id}）${remark ? '；备注：' + remark : ''}；账目与库存未变动`,
          { module: 'aftersale', tenantId: as.tenantId, traceId: trace })
        this.showToast(`已驳回【${as.targetName}】的${as.typeLabel}申请`, 'info')
        this.endTrace()
        return true
      }

      // —— 审核通过：先统一校验（异常回退：任一不满足整体不落账） ——
      const target = this._stockTargetOf(as)
      if (!target) { this.showToast('关联库存目标缺失，无法执行回写', 'warn'); this.endTrace(); return false }
      if (as.type === 'reship' && target.remain <= 0) {
        // 缺货：售后单挂起为「待补货」（不动账），采购验收入库后可从待处理售后继续履约
        // 补发资金成本实时预占（待关联采购结算时核销，不重复付款）；
        // 已有关联采购单在途的（采购预占已覆盖补发件）不重复预占
        const linkedWaitingPo = this.purchaseOrders.find((po) => po.tenantId === as.tenantId && po.afterSaleId === as.id &&
          ['pending', 'approved', 'receiving'].includes(po.status))
        const reshipPrice = Math.round((Number(target.unitPrice) || 0) * 100) / 100
        if (reshipPrice > 0 && !linkedWaitingPo) {
          this._budgetOccupy('reserve',
            [{
              unit: 'money', amount: reshipPrice,
              scopeType: as.targetType === 'prize' ? 'activity' : 'tenant',
              scopeId: as.targetType === 'prize' ? as.activityId : as.tenantId,
              category: 'reship', kind: 'reship-cost'
            }],
            {
              category: 'reship', kind: 'reship-cost', refType: 'aftersale',
              refId: as.id, bizNo: o.id,
              summary: `缺货补发预占：【${as.targetName}】×1，估价 ${reshipPrice} 元（挂起待采购，结算时核销不重复付款）`,
              userId: as.userId, traceId
            }, as.tenantId)
        }
        as.status = 'waiting_stock'
        as.reviewedAt = `${this.todayDate} ${nowTime()}`
        as.reviewer = this.user.name
        as.reviewNote = remark
        as.shortageNote = `审核通过但【${as.targetName}】库存不足（remain=0），挂起待采购补货后继续履约`
        this.addAuditLog('aftersale-shortage', as.id,
          `补发【${as.targetName}】库存不足，售后单转待补货（发货单 ${o.id}，账目与库存未变动）；请发起采购，验收入库后从待处理售后继续履约`,
          { module: 'aftersale', tenantId: as.tenantId, traceId: trace })
        this.showToast(`⚠️【${as.targetName}】库存不足，补发单已挂起为「待补货」：采购入库后可从待处理售后继续履约`, 'warn')
        this.endTrace()
        return true
      }

      if (as.type === 'reject' || as.type === 'return') {
        // 拒收/退货：库存回补 + 积分返还 + 发货单 → 已退回
        target.remain += 1
        if (as.refundPoints > 0) {
          this.points += as.refundPoints
          this.addPointRecord(as.refundPoints,
            `售后退款：${as.typeLabel}【${as.targetName}】（发货单 ${o.id}）`, 'refund',
            { refId: as.id, refType: 'after-sale', tenantId: as.tenantId, traceId: trace })
          // 营销预算：退货/拒收按申请时快照冲回已占用积分成本（预算余额恢复）
          this._budgetRefund(
            { unit: 'points', amount: as.refundPoints, scopeType: 'tenant', scopeId: as.tenantId },
            {
              category: o.bizType === 'draw' ? 'draw' : 'redeem',
              kind: o.bizType === 'draw' ? 'draw-refund' : 'redeem-refund',
              refType: 'aftersale', refId: as.id, bizNo: o.id,
              summary: `售后退款冲回预算：${as.typeLabel}【${as.targetName}】+${as.refundPoints} 积分`,
              userId: as.userId, traceId
            }, as.tenantId)
        }
        o.status = 'returned'
        o.returnedAt = `${this.todayDate} ${nowTime()}`
        o.afterSaleId = as.id
        this._appendTrace(o, 'returned',
          as.type === 'reject' ? '收件人拒收，包裹退回发货仓' : '退货包裹已退回发货仓，售后完成')
      } else {
        // 补发资金成本（按 SKU 采购成本口径 unitPrice 估算，0 表示未维护成本不占用）；
        // 关联采购单已在途的（缺货挂起→采购入库）补发成本已在采购付款中结算，不重复占用
        const linkedPo = this.purchaseOrders.find((po) => po.tenantId === as.tenantId && po.afterSaleId === as.id)
        const reshipPrice = Math.round((Number(target.unitPrice) || 0) * 100) / 100
        if (reshipPrice > 0 && !(continuing && linkedPo)) {
          this._budgetOccupy('settle',
            [{
              unit: 'money', amount: reshipPrice,
              scopeType: as.targetType === 'prize' ? 'activity' : 'tenant',
              scopeId: as.targetType === 'prize' ? as.activityId : as.tenantId,
              category: 'reship', kind: 'reship-cost'
            }],
            {
              category: 'reship', kind: 'reship-cost', refType: 'aftersale',
              refId: as.id, bizNo: o.id,
              summary: `售后补发成本：【${as.targetName}】×1，估价 ${reshipPrice} 元`,
              userId: as.userId, traceId
            }, as.tenantId)
        }
        // 补发：库存再扣 1，生成补发发货单（沿用原收货信息，直接待发货；原单保留轨迹节点）
        target.remain -= 1
        const reship = {
          id: genId('sp'),
          recordId: o.recordId,
          bizType: o.bizType,
          status: 'to_ship',
          tenantId: as.tenantId,
          traceId: trace,
          userId: o.userId, userName: o.userName,
          icon: o.icon, targetName: o.targetName, activityId: o.activityId,
          source: '售后补发',
          date: this.todayDate, time: nowTime(), ts: Date.now(),
          receiver: o.receiver, phone: o.phone, region: o.region, address: o.address,
          addressAt: o.addressAt,
          shipper: '', carrier: '', trackingNo: '', shipNote: '', shippedAt: '',
          receivedAt: '', traces: [],
          afterSaleId: as.id, returnedAt: '', originId: o.id
        }
        this.shipments.unshift(reship)
        as.reshipmentId = reship.id
        this._appendTrace(o, 'reship', `售后补发已受理，生成补发单 ${reship.id}，等待重新发货`)
        this.addAuditLog('ship-create', reship.id,
          `售后补发【${o.targetName}】生成补发发货单（原单 ${o.id}，售后单 ${as.id}），沿用原收货信息，待运营重新发货`,
          { module: 'ship', tenantId: as.tenantId, traceId: trace })
      }

      as.status = 'done'
      as.reviewedAt = `${this.todayDate} ${nowTime()}`
      as.reviewer = this.user.name
      as.reviewNote = remark
      this.addAuditLog('aftersale-approve', as.id,
        as.type === 'reship'
          ? `${continuing ? '采购入库后继续履约：' : ''}同意补发【${as.targetName}】：库存扣减 1，生成补发单 ${as.reshipmentId}${remark ? '；备注：' + remark : ''}`
          : `同意${as.typeLabel}【${as.targetName}】：库存回补 1${as.refundPoints ? `、返还 ${as.refundPoints} 积分` : ''}，发货单 ${o.id} 已退回${remark ? '；备注：' + remark : ''}`,
        { module: 'aftersale', tenantId: as.tenantId, traceId: trace })
      this.showToast(
        as.type === 'reship'
          ? `✅${continuing ? '补货到货，' : ''}已同意补发：新发货单已生成（库存 -1），等待运营发货`
          : `✅ 已同意${as.typeLabel}：库存回补 1${as.refundPoints ? `，${as.refundPoints} 积分已返还` : ''}`,
        'success')
      this.endTrace()
      return true
    },

    // ===== 奖品采购入库 =====
    // 业务链路：运营按「活动奖品 / 商城商品」发起采购（purchase:apply）→ 审批通过/驳回（purchase:approve）
    //          → 仓配分批验收入库（purchase:inbound，累计实收不超过审批数量）→ 全部入完转「入库完成」。
    // 入库口径：验收批次追加 append-only 入库台账，remain 按实收增加、stock 同步抬升账面总量，
    //          P5 对账公式 expected = stock − consumed + adjusted 天然勾稽（不另开调整凭证）。
    // 缺货补发联动：售后补发审核时缺货则挂起 waiting_stock；采购验收入库后可从「待处理售后」继续履约。
    // 采购单/验收批次 append-only，撤销/驳回不删单，全部操作审计留痕、按 tenantId 强隔离。

    // 采购资金预算条目（数量 × 协议单价；活动奖品落活动+租户预算，商品落租户预算）
    _poBudgetItem(po) {
      return {
        unit: 'money',
        amount: Math.round(po.qty * po.unitPrice * 100) / 100,
        scopeType: po.targetType === 'prize' ? 'activity' : 'tenant',
        scopeId: po.targetType === 'prize' ? po.activityId : po.tenantId,
        category: 'purchase', kind: 'purchase-commit'
      }
    },

    // 采购目标快照（奖品按活动维度 / 商品按 goodsId），返回 { target, snap }；目标不存在返回 null
    _purchaseTargetOf(targetType, activityId, targetId) {
      if (targetType === 'prize') {
        const a = this.activities.find((x) => x.id === activityId)
        const p = a?.prizes.find((x) => x.id === targetId)
        if (!a || !p) return null
        return { target: p, snap: { targetType, activityId, targetId, targetName: `${a.name} / ${p.name}`, icon: p.emoji, activityName: a.name } }
      }
      const g = this.goods.find((x) => x.id === targetId)
      if (!g) return null
      return { target: g, snap: { targetType, activityId: null, targetId: g.id, targetName: g.name, icon: g.icon, activityName: '' } }
    },

    // 运营发起采购申请（RBAC：purchase:apply；仅本租户奖品/商品；数量校验）
    createPurchaseOrder(form) {
      this.syncBusinessDay()
      const trace = this.beginTrace()
      const traceId = trace
      if (!this.requirePerm('purchase:apply', 'purchase')) { this.endTrace(); return null }
      const tid = this.activeTenantId
      const targetType = form.targetType === 'prize' ? 'prize' : 'goods'
      const hit = this._purchaseTargetOf(targetType, form.activityId || null, form.targetId)
      if (!hit || (targetType === 'prize' ? (hit.target ? this.activities.find((a) => a.id === form.activityId)?.tenantId !== tid : true) : (hit.target.tenantId || 't-star') !== tid)) {
        this.deny('purchase-denied', '采购目标不存在或不属于当前租户', { module: 'purchase', tenantId: tid, traceId: trace })
        this.endTrace()
        return null
      }
      const qty = Math.floor(Number(form.qty) || 0)
      if (qty <= 0) { this.showToast('采购数量需为正整数', 'warn'); this.endTrace(); return null }
      if (qty > 9999) { this.showToast('单笔采购数量不超过 9999', 'warn'); this.endTrace(); return null }
      const reason = (form.reason || '').trim()
      if (!reason) { this.showToast('请填写采购事由', 'warn'); this.endTrace(); return null }
      // 供应商与协议单价（结算口径：按实收合格量 × 单价，差异/售后补发扣款另计）
      const supplierName = (form.supplierName || '').trim()
      if (!supplierName) { this.showToast('请填写供应商名称（供应商结算依据）', 'warn'); this.endTrace(); return null }
      const unitPrice = Math.round(Number(form.unitPrice) * 100) / 100
      if (!(unitPrice > 0)) { this.showToast('请填写正确的协议单价（>0）', 'warn'); this.endTrace(); return null }
      if (unitPrice > 1000000) { this.showToast('单价异常，请核对后再提交', 'warn'); this.endTrace(); return null }

      // 营销预算预检：采购承诺金额（数量 × 协议单价）超出租户/活动资金预算（或预算冻结关闭）时整单拦截
      const poBudgetItem = {
        unit: 'money', amount: Math.round(qty * unitPrice * 100) / 100,
        scopeType: targetType === 'prize' ? 'activity' : 'tenant',
        scopeId: targetType === 'prize' ? form.activityId : tid
      }
      if (!this._budgetGuard([{ ...poBudgetItem, category: 'purchase', kind: 'purchase-commit' }], tid)) {
        this.endTrace(); return null
      }

      // 缺货补发联动：可从待补货售后单一键发起（固化售后快照，入完后提示继续履约）
      let linkedAfterSale = null
      if (form.afterSaleId) {
        linkedAfterSale = this.afterSales.find((a) => a.id === form.afterSaleId)
        if (!linkedAfterSale || (linkedAfterSale.tenantId || 't-star') !== tid ||
            linkedAfterSale.status !== 'waiting_stock' || linkedAfterSale.type !== 'reship' ||
            linkedAfterSale.targetType !== targetType || linkedAfterSale.targetId !== form.targetId ||
            (targetType === 'prize' && linkedAfterSale.activityId !== form.activityId)) {
          this.deny('purchase-denied', '关联售后单状态与采购目标不匹配', { module: 'purchase', tenantId: tid, traceId: trace })
          this.endTrace()
          return null
        }
      }

      const po = {
        id: genId('po'),
        poNo: 'PO' + Date.now().toString(36).toUpperCase() + String(Math.floor(Math.random() * 90) + 10),
        tenantId: tid,
        traceId: trace,
        targetType,
        activityId: hit.snap.activityId,
        activityName: hit.snap.activityName,
        targetId: hit.snap.targetId,
        targetName: hit.snap.targetName,
        icon: hit.snap.icon,
        qty,                            // 审批采购数量
        inboundQty: 0,                  // 累计验收实收
        status: 'pending',
        purpose: linkedAfterSale ? 'aftersale' : 'normal',
        purposeLabel: linkedAfterSale ? PURCHASE_PURPOSE.aftersale : PURCHASE_PURPOSE.normal,
        afterSaleId: linkedAfterSale ? linkedAfterSale.id : '',
        reason,
        supplierName,
        unitPrice,
        applicant: this.user.name,
        applicantId: this.currentMemberId || this.user.id,
        createdAt: this.todayDate, time: nowTime(), ts: Date.now(),
        approvedAt: '', approver: '', approveNote: '',
        receivedAt: '',
        shortQty: 0,                  // 累计到货短少（供应商少发：实收合格 < 审批采购）
        rejectedQty: 0,               // 累计验退拒收（到货但不合格，不入库）
        settledBillId: '',            // 已结算的供应商账单 id（结算闭环回写）
        batches: []
      }
      this.purchaseOrders.unshift(po)
      // 营销预算：采购承诺金额实时预占（驳回/撤销释放，供应商结算核销转实际付款）
      this._budgetOccupy('reserve', [this._poBudgetItem(po)], {
        category: 'purchase', kind: 'purchase-commit', refType: 'po',
        refId: po.id, bizNo: po.poNo,
        summary: `采购预占：${po.targetName} ×${qty}（${supplierName}，协议单价 ${unitPrice} 元）`,
        userId: po.applicantId, traceId
      }, tid)
      this.addAuditLog('purchase-apply', po.id,
        `发起采购【${hit.snap.targetName}】×${qty}（${targetType === 'prize' ? '活动奖品' : '商城商品'}，供应商：${supplierName}，协议单价 ${unitPrice} 元，事由：${reason}）` +
        (linkedAfterSale ? `；关联待补货售后单 ${linkedAfterSale.id}，入库后继续补发履约` : ''),
        { module: 'purchase', tenantId: tid, traceId: trace })
      this.showToast(`🛒 采购申请已提交：${hit.snap.targetName} ×${qty}，等待审批`, 'success')
      this.endTrace()
      return po
    },

    // 申请人在审批前撤销采购单（幂等：仅 pending；仅发起人本人或管理员；不动库存）
    cancelPurchaseOrder(poId) {
      const trace = this.beginTrace()
      const traceId = trace
      const po = this.purchaseOrders.find((x) => x.id === poId)
      if (!po) { this.endTrace(); return false }
      if (!this.requirePerm('purchase:apply', 'purchase') || !this.requireSameTenant(po.tenantId, 'purchase')) {
        this.endTrace(); return false
      }
      if (po.status !== 'pending') { this.showToast('仅待审批采购单可撤销', 'warn'); this.endTrace(); return false }
      const isAdmin = this.identityKind === 'platform' || this.currentMember?.roleKey === 'org_admin'
      if (!isAdmin && po.applicantId !== (this.currentMemberId || this.user.id)) {
        this.deny('purchase-denied', '只能撤销本人发起的采购申请', { module: 'purchase', tenantId: po.tenantId, traceId: trace })
        this.endTrace(); return false
      }
      po.status = 'canceled'
      po.approveNote = '申请人撤销'
      // 营销预算：撤销即释放采购预占
      this._budgetConvertReserved('po', po.id, 'release', {
        category: 'purchase', kind: 'purchase-commit',
        summary: `采购撤销释放预占：${po.targetName} ×${po.qty}`, traceId
      }, po.tenantId)
      this.addAuditLog('purchase-cancel', po.id, `撤销采购申请【${po.targetName}】×${po.qty}（审批前撤回，库存未变动）`,
        { module: 'purchase', tenantId: po.tenantId, traceId: trace })
      this.showToast('采购申请已撤销', 'info')
      this.endTrace()
      return true
    },

    // 采购审批（RBAC：purchase:approve；仅本租户、仅 pending；通过不产生库存变动，入库以验收批次为准）
    reviewPurchaseOrder(poId, approve, note = '') {
      const trace = this.beginTrace()
      const traceId = trace
      const po = this.purchaseOrders.find((x) => x.id === poId)
      if (!po) { this.endTrace(); return false }
      if (!this.requirePerm('purchase:approve', 'purchase') || !this.requireSameTenant(po.tenantId, 'purchase')) {
        this.endTrace(); return false
      }
      if (po.status !== 'pending') { this.showToast('该采购单已审批，请勿重复操作', 'warn'); this.endTrace(); return false }
      const remark = note.trim()
      if (approve) {
        po.status = 'approved'
        po.approvedAt = `${this.todayDate} ${nowTime()}`
        po.approver = this.user.name
        po.approveNote = remark
        this.addAuditLog('purchase-approve', po.id,
          `审批通过采购【${po.targetName}】×${po.qty}（申请人 ${po.applicant}），等待仓配分批验收入库${remark ? '；备注：' + remark : ''}`,
          { module: 'purchase', tenantId: po.tenantId, traceId: trace })
        this.showToast(`✅ 采购已审批：${po.targetName} ×${po.qty}，待验收入库`, 'success')
      } else {
        po.status = 'rejected'
        po.approvedAt = `${this.todayDate} ${nowTime()}`
        po.approver = this.user.name
        po.approveNote = remark
        // 营销预算：审批驳回即释放采购预占（通过则保留预占，待供应商结算核销）
        this._budgetConvertReserved('po', po.id, 'release', {
          category: 'purchase', kind: 'purchase-commit',
          summary: `采购驳回释放预占：${po.targetName} ×${po.qty}`, traceId
        }, po.tenantId)
        this.addAuditLog('purchase-reject', po.id,
          `驳回采购【${po.targetName}】×${po.qty}（申请人 ${po.applicant}）${remark ? '；备注：' + remark : ''}；库存未变动`,
          { module: 'purchase', tenantId: po.tenantId, traceId: trace })
        this.showToast('采购申请已驳回', 'info')
      }
      this.endTrace()
      return true
    },

    // 分批验收入库（RBAC：purchase:inbound；仅本租户、approved/receiving 可验）
    // 口径：deliveredQty 本批到货量（默认=合格量），qty 合格入库量（0<qty≤到货、累计不超审批数量）；
    //       到货−合格=验退拒收（破损/不合格，不抬库存，登记验收差异）；
    //       closeShortage：供应商确认少发且不再补发，剩余待收按到货短少登记差异并提前结案（diff_closed）。
    // 每批合格量：remain += qty、stock += qty，追加 append-only 验收批次与验收差异；
    // 累计入满 → received 终态；差异结案 → diff_closed 终态；关联待补货售后时提示可继续履约（不自动代审）。
    inboundPurchase(poId, form = {}) {
      this.syncBusinessDay()
      const trace = this.beginTrace()
      const po = this.purchaseOrders.find((x) => x.id === poId)
      if (!po) { this.endTrace(); return null }
      if (!this.requirePerm('purchase:inbound', 'purchase') || !this.requireSameTenant(po.tenantId, 'purchase')) {
        this.endTrace(); return null
      }
      if (!['approved', 'receiving'].includes(po.status)) {
        this.showToast('仅已审批 / 验收中的采购单可验收入库', 'warn'); this.endTrace(); return null
      }
      const qty = Math.floor(Number(form.qty) || 0)
      if (qty <= 0) { this.showToast('本批合格入库数量需为正整数', 'warn'); this.endTrace(); return null }
      const toReceive = po.qty - po.inboundQty
      if (qty > toReceive) {
        this.showToast(`本次合格入库 ${qty} 超过待收数量 ${toReceive}（审批 ${po.qty}，已收 ${po.inboundQty}）`, 'warn')
        this.endTrace(); return null
      }
      // 到货量默认=合格量（正常批次）；验退时到货 > 合格
      const deliveredRaw = form.deliveredQty === undefined || form.deliveredQty === '' || form.deliveredQty === null
        ? qty : Math.floor(Number(form.deliveredQty) || 0)
      if (deliveredRaw < qty) {
        this.showToast(`本批到货量 ${deliveredRaw} 不能少于合格入库量 ${qty}（不合格部分请填到"验退拒收"）`, 'warn')
        this.endTrace(); return null
      }
      const rejectedQty = deliveredRaw - qty
      // 差异结案：本批入库后仍有待收，供应商确认少发不再补发 → 剩余待收即短少
      const closeShortage = !!form.closeShortage && qty < toReceive
      const shortQty = closeShortage ? toReceive - qty : 0
      const hit = this._purchaseTargetOf(po.targetType, po.activityId, po.targetId)
      if (!hit) { this.showToast('采购目标已删除，无法入库', 'warn'); this.endTrace(); return null }

      const target = hit.target
      const before = target.remain
      target.remain += qty
      target.stock += qty
      po.inboundQty += qty
      po.shortQty = (po.shortQty || 0) + shortQty
      po.rejectedQty = (po.rejectedQty || 0) + rejectedQty
      const filled = po.inboundQty >= po.qty
      po.status = filled ? 'received' : (closeShortage ? 'diff_closed' : 'receiving')
      const batch = {
        id: genId('pb'),
        poId: po.id, poNo: po.poNo,
        tenantId: po.tenantId, traceId: trace,
        targetType: po.targetType, activityId: po.activityId, targetId: po.targetId,
        targetName: po.targetName, icon: po.icon,
        qty,
        deliveredQty: deliveredRaw, rejectedQty, shortQty,
        remainBefore: before, remainAfter: target.remain,
        stockBefore: target.stock - qty, stockAfter: target.stock,
        carrier: (form.carrier || '').trim() || po.supplierName,
        inspector: this.user.name,
        acceptedInbound: true,
        date: this.todayDate, time: nowTime(), ts: Date.now(),
        note: (form.note || '').trim()
      }
      this.inboundBatches.unshift(batch)
      po.batches.push(batch.id)
      if (filled) po.receivedAt = `${this.todayDate} ${nowTime()}`

      // 验收差异 append-only：验退拒收按批次登记；结案短少按采购单登记一张
      const diffs = []
      if (rejectedQty > 0) {
        const rd = {
          id: genId('ad'), type: 'rejected',
          poId: po.id, poNo: po.poNo, batchId: batch.id,
          tenantId: po.tenantId, traceId: trace,
          targetType: po.targetType, activityId: po.activityId, targetId: po.targetId,
          targetName: po.targetName, icon: po.icon,
          qty: rejectedQty, orderQty: po.qty, inboundQtyAfter: po.inboundQty,
          supplierName: po.supplierName,
          reason: (form.rejectReason || form.note || '').trim() || '到货破损/不合格，验退拒收（不入库）',
          inspector: this.user.name,
          date: this.todayDate, time: nowTime(), ts: Date.now()
        }
        this.acceptDiffs.unshift(rd)
        diffs.push(rd)
      }
      if (shortQty > 0) {
        const sd = {
          id: genId('ad'), type: 'short',
          poId: po.id, poNo: po.poNo, batchId: batch.id,
          tenantId: po.tenantId, traceId: trace,
          targetType: po.targetType, activityId: po.activityId, targetId: po.targetId,
          targetName: po.targetName, icon: po.icon,
          qty: shortQty, orderQty: po.qty, inboundQtyAfter: po.inboundQty,
          supplierName: po.supplierName,
          reason: (form.shortReason || '').trim() || '供应商到货短少且确认不再补发，按验收差异结案',
          inspector: this.user.name,
          date: this.todayDate, time: nowTime(), ts: Date.now()
        }
        this.acceptDiffs.unshift(sd)
        diffs.push(sd)
      }

      const diffText = rejectedQty
        ? `；本批到货 ${deliveredRaw}，验退拒收 ${rejectedQty}（不入库，已登记验收差异）`
        : (deliveredRaw !== qty ? '' : '')
      this.addAuditLog('purchase-inbound', po.id,
        `采购验收入库【${po.targetName}】本批合格 +${qty}（待收余 ${Math.max(po.qty - po.inboundQty, 0)}），库存 ${before}→${target.remain}` +
        (filled ? '；采购单已全部入库完成' : closeShortage ? `；供应商确认短少 ${shortQty} 件不再补发，采购单按验收差异结案` : '，剩余批次待验收') +
        (batch.carrier ? `；供应商/承运：${batch.carrier}` : '') + diffText,
        { module: 'purchase', tenantId: po.tenantId, traceId: trace })
      if (shortQty > 0) {
        this.addAuditLog('accept-diff-short', po.id,
          `验收差异【到货短少】${po.targetName} ×${shortQty}（采购 ${po.poNo} 审批 ${po.qty}、实收合格 ${po.inboundQty}）：供应商 ${po.supplierName} 确认不再补发，差异转供应商结算扣款`,
          { module: 'purchase', tenantId: po.tenantId, traceId: trace })
      }
      if (rejectedQty > 0) {
        this.addAuditLog('accept-diff-reject', po.id,
          `验收差异【验退拒收】${po.targetName} ×${rejectedQty}（采购 ${po.poNo} 批次 ${batch.id}，到货 ${deliveredRaw} / 合格 ${qty}）：不合格部分不入库，差异转供应商结算`,
          { module: 'purchase', tenantId: po.tenantId, traceId: trace })
      }

      // 缺货补发联动：全部入完且关联待补货售后时，提示去售后队列继续履约
      let linkedReady = null
      if (po.status === 'received' && po.afterSaleId) {
        linkedReady = this.afterSales.find((a) => a.id === po.afterSaleId && a.status === 'waiting_stock')
        if (linkedReady) {
          this.addAuditLog('aftersale-resume-ready', linkedReady.id,
            `采购 ${po.poNo} 验收入库完成，待补货售后单【${linkedReady.targetName}】库存已就绪，可从待处理售后继续补发履约`,
            { module: 'aftersale', tenantId: po.tenantId, traceId: trace })
        }
      }
      const tip = linkedReady
        ? `；关联的补发售后（${linkedReady.id}）已可在「待处理售后」继续履约`
        : po.afterSaleId ? '；关联售后单已处理' : ''
      this.showToast(
        `📥 验收入库 ${qty} 件：${po.targetName} 库存 ${before}→${target.remain}` +
        (filled ? '，采购单已入完' : closeShortage ? `，短少 ${shortQty} 件已差异结案` : '') + tip,
        'success')
      this.endTrace()
      return batch
    },

    // 某采购单的验收批次（时间倒序）
    inboundBatchesOf: (state) => state.inboundBatches,

    // ===== 供应商结算闭环 =====
    // 采购批次→验收/补发对账行（append-only 推导：验收批次 + 验收差异 + 关联售后的补发回写）
    _settleRowsOfPo(po) {
      const batches = this.inboundBatches
        .filter((b) => b.poId === po.id)
        .sort((a, b) => a.ts - b.ts)
      const diffsOf = (batchId) => this.acceptDiffs.filter((d) => d.poId === po.id && d.batchId === batchId)
      // 售后补发回写：采购单关联的售后补发已完成时，按批次时间顺序摊到验收合格量上
      const reshipDone = this.afterSales.some(
        (a) => a.id === po.afterSaleId && a.status === 'done' && a.type === 'reship' && !!a.reshipmentId)
      let reshipLeft = po.purpose === 'aftersale' && reshipDone ? 1 : 0
      const rows = batches.map((b, idx) => {
        const reshipQty = Math.min(reshipLeft, b.qty)
        reshipLeft -= reshipQty
        const rejected = diffsOf(b.id).filter((d) => d.type === 'rejected').reduce((n, d) => n + d.qty, 0)
        const short = diffsOf(b.id).filter((d) => d.type === 'short').reduce((n, d) => n + d.qty, 0)
        return {
          seq: idx + 1, batchId: b.id, date: b.date, time: b.time,
          deliveredQty: b.deliveredQty ?? b.qty, acceptedQty: b.qty,
          rejectedQty: rejected, shortQty: short, reshipQty,
          billableQty: b.qty - reshipQty,
          inspector: b.inspector, carrier: b.carrier, note: b.note
        }
      })
      const reshipAllocated = rows.reduce((n, r) => n + r.reshipQty, 0)
      return {
        rows,
        reshipAllocated,
        reshipPending: (po.purpose === 'aftersale' && !reshipDone) ? 1 : Math.max(0, reshipLeft)
      }
    },

    // 账单定位：同 id 若有重提（驳回旧记录 + 新记录），优先取非驳回记录
    _requireBill(billId) {
      const list = this.supplierBills.filter((b) => b.id === billId)
      return list.find((b) => b.status !== 'rejected') || list[0] || null
    },

    // 供应商账单金额推导（实收合格量结算；补发履约占用不重复付款；差异仅展示不另扣款——短少本就未到货）
    _supplierBillAmount(po) {      const price = po.unitPrice || 0
      const accepted = po.inboundQty || 0
      const { rows, reshipAllocated } = this._settleRowsOfPo(po)
      const billableQty = rows.reduce((n, r) => n + r.billableQty, 0)
      const grossAmount = Math.round(accepted * price * 100) / 100
      const reshipDeduct = Math.round(reshipAllocated * price * 100) / 100
      const payableAmount = Math.round((grossAmount - reshipDeduct) * 100) / 100
      return {
        unitPrice: price, acceptedQty: accepted, billableQty,
        shortQty: po.shortQty || 0, rejectedQty: po.rejectedQty || 0,
        reshipQty: reshipAllocated, grossAmount, reshipDeduct, payableAmount
      }
    },

    // 运营按采购单拟供应商账单（RBAC：supplier:bill；仅入满/差异结案；一张 PO 至多一张有效账单）
    createSupplierBill(poId, form = {}) {
      this.syncBusinessDay()
      const trace = this.beginTrace()
      if (!this.requirePerm('supplier:bill', 'supplier')) { this.endTrace(); return null }
      const po = this.purchaseOrders.find((x) => x.id === poId)
      if (!po) { this.endTrace(); return null }
      if (!this.requireSameTenant(po.tenantId, 'supplier')) { this.endTrace(); return null }
      if (!PO_SETTLEABLE(po.status)) {
        this.showToast('采购单入库完成（或验收差异结案）后才可发起供应商账单', 'warn'); this.endTrace(); return null
      }
      const existedAll = this.supplierBills.filter((b) => b.poId === poId)
      const existed = existedAll.find((b) => b.status === 'rejected' || b.status === 'draft') || null
      const blocking = existedAll.find((b) => !['rejected', 'draft'].includes(b.status))
      if (blocking) {
        this.showToast('该采购单已有供应商账单（一张采购单仅结算一次）', 'warn'); this.endTrace(); return null
      }
      const amount = this._supplierBillAmount(po)
      const { rows, reshipAllocated, reshipPending } = this._settleRowsOfPo(po)
      const submit = !!form.submit
      const billNo = 'SB' + Date.now().toString(36).toUpperCase() + String(Math.floor(Math.random() * 90) + 10)
      const bill = {
        id: existed?.id || genId('sb'),
        billNo, poId: po.id, poNo: po.poNo, tenantId: po.tenantId, traceId: trace,
        targetType: po.targetType, activityId: po.activityId, targetId: po.targetId,
        targetName: po.targetName, icon: po.icon,
        supplierName: po.supplierName, unitPrice: po.unitPrice,
        purpose: po.purpose, purposeLabel: po.purposeLabel, afterSaleId: po.afterSaleId || '',
        orderQty: po.qty, ...amount,
        rows, reshipPending,
        status: submit ? 'reviewing' : 'draft',
        note: (form.note || '').trim(),
        applicant: this.user.name, applicantId: this.currentMemberId || this.user.id,
        createdAt: this.todayDate, time: nowTime(), ts: Date.now(),
        submittedAt: submit ? `${this.todayDate} ${nowTime()}` : '',
        reviewedAt: '', reviewer: '', reviewNote: '',
        settledAt: '', settleOperator: '', settleNote: '',
        reconWriteback: null
      }
      if (existed) {
        // 就地更新被驳回账单（保持同一响应式对象引用，避免重提后 find(id) 命中旧快照）
        Object.keys(bill).forEach((k) => { existed[k] = bill[k] })
      } else {
        this.supplierBills.unshift(bill)
      }
      this.addAuditLog('supplier-bill-create', bill.id,
        `发起供应商账单【${bill.targetName}】${bill.billNo}：供应商 ${bill.supplierName}，实收合格 ${bill.acceptedQty} 件 × ${bill.unitPrice} 元` +
        (bill.reshipQty ? `，售后补发履约占用 ${bill.reshipQty} 件不重复付款（-${bill.reshipDeduct} 元）` : '') +
        (bill.shortQty || bill.rejectedQty ? `，验收差异短少 ${bill.shortQty}/验退 ${bill.rejectedQty}（未到货/不入库不计价）` : '') +
        `，应付 ${bill.payableAmount} 元` + (submit ? '；已提交财务复核' : '；草稿待提交'),
        { module: 'supplier', tenantId: po.tenantId, traceId: trace })
      this.showToast(submit
        ? `🧾 供应商账单 ${bill.billNo} 已提交财务复核（应付 ${bill.payableAmount} 元）`
        : `🧾 已保存供应商账单草稿 ${bill.billNo}`, submit ? 'success' : 'info')
      if (reshipPending > 0) {
        this.addAuditLog('supplier-bill-pending-reship', bill.id,
          `供应商账单【${bill.targetName}】提示：关联售后补发尚未履约完成（${po.afterSaleId} 仍待补发），本次按实收合格量全额计价，补发完成后结算将自动扣减对应件数`,
          { module: 'supplier', tenantId: po.tenantId, traceId: trace })
      }
      this.endTrace()
      return bill
    },

    // 草稿/被驳回账单：运营修改后提交（或保存草稿）
    submitSupplierBill(billId, form = {}) {
      const bill = this._requireBill(billId)
      if (!bill) return null
      return this.createSupplierBill(bill.poId, { ...form, submit: true })
    },

    // 财务复核（RBAC：supplier:review；reviewing → approved/rejected；不改账）
    reviewSupplierBill(billId, approve, note = '') {
      const trace = this.beginTrace()
      const bill0 = this._requireBill(billId)
      if (!bill0) { this.endTrace(); return false }
      if (!this.requirePerm('supplier:review', 'supplier') || !this.requireSameTenant(bill0.tenantId, 'supplier')) {
        this.endTrace(); return false
      }
      if (bill0.status !== 'reviewing') { this.showToast('该账单当前状态不可复核（需运营先提交）', 'warn'); this.endTrace(); return false }
      // 复核时以最新验收/补发台账重新推导金额（防止拟单后批次/售后状态变化）
      const po = this.purchaseOrders.find((x) => x.id === bill0.poId)
      const amount = this._supplierBillAmount(po)
      const { rows, reshipPending } = this._settleRowsOfPo(po)
      Object.assign(bill0, amount, { rows, reshipPending })
      const remark = note.trim()
      if (approve) {
        bill0.status = 'approved'
        bill0.reviewedAt = `${this.todayDate} ${nowTime()}`
        bill0.reviewer = this.user.name
        bill0.reviewNote = remark
        this.addAuditLog('supplier-bill-approve', bill0.id,
          `复核通过供应商账单 ${bill0.billNo}【${bill0.targetName}】：实收合格 ${bill0.acceptedQty} 件、应付 ${bill0.payableAmount} 元` +
          (bill0.reshipQty ? `（含售后补发占用 ${bill0.reshipQty} 件不付款）` : '') + `${remark ? '；备注：' + remark : ''}，待财务结算付款`,
          { module: 'supplier', tenantId: bill0.tenantId, traceId: trace })
        this.showToast(`✅ 账单 ${bill0.billNo} 复核通过，应付 ${bill0.payableAmount} 元，可结算`, 'success')
      } else {
        bill0.status = 'rejected'
        bill0.reviewedAt = `${this.todayDate} ${nowTime()}`
        bill0.reviewer = this.user.name
        bill0.reviewNote = remark
        this.addAuditLog('supplier-bill-reject', bill0.id,
          `复核驳回供应商账单 ${bill0.billNo}【${bill0.targetName}】${remark ? '；意见：' + remark : ''}（退回运营修订后重新提交，账单保留不删除）`,
          { module: 'supplier', tenantId: bill0.tenantId, traceId: trace })
        this.showToast(`账单 ${bill0.billNo} 已驳回，退回运营修订`, 'info')
      }
      this.endTrace()
      return true
    },

    // 财务结算（RBAC：supplier:settle；approved → settled；按采购批次与售后补发回写库存对账快照，留痕归档）
    settleSupplierBill(billId, note = '') {
      this.syncBusinessDay()
      const trace = this.beginTrace()
      const traceId = trace
      const bill0 = this._requireBill(billId)
      if (!bill0) { this.endTrace(); return null }
      if (!this.requirePerm('supplier:settle', 'supplier') || !this.requireSameTenant(bill0.tenantId, 'supplier')) {
        this.endTrace(); return null
      }
      if (bill0.status !== 'approved') { this.showToast('仅复核通过的账单可执行结算付款', 'warn'); this.endTrace(); return null }
      const po = this.purchaseOrders.find((x) => x.id === bill0.poId)
      if (!po) { this.showToast('关联采购单不存在，无法结算', 'warn'); this.endTrace(); return null }
      // 结算前以最新台账重算（拟单/复核后补发可能刚履约完成）
      const amount = this._supplierBillAmount(po)
      const { rows, reshipPending, reshipAllocated } = this._settleRowsOfPo(po)
      Object.assign(bill0, amount, { rows, reshipPending })
      const at = `${this.todayDate} ${nowTime()}`
      bill0.status = 'settled'
      bill0.settledAt = at
      bill0.settleOperator = this.user.name
      bill0.settleNote = note.trim()
      // 回写库存对账快照：按采购批次勾稽（到货/合格/验退/短少/售后补发占用/计价件数），随结算单归档
      bill0.reconWriteback = {
        at, bizDate: this.todayDate,
        targetType: po.targetType, activityId: po.activityId, targetId: po.targetId, targetKey: po.targetType === 'prize'
          ? `prize:${po.activityId}:${po.targetId}` : `goods:${po.targetId}`,
        targetName: po.targetName,
        orderQty: po.qty, acceptedQty: amount.acceptedQty, shortQty: amount.shortQty, rejectedQty: amount.rejectedQty,
        reshipQty: reshipAllocated, billableQty: amount.billableQty,
        unitPrice: amount.unitPrice, grossAmount: amount.grossAmount,
        reshipDeduct: amount.reshipDeduct, payableAmount: amount.payableAmount,
        rows: rows.map((r) => ({ ...r }))
      }
      po.settledBillId = bill0.id
      // 营销预算闭环（结算付款时落账）：
      //  1) 核销采购单在途预占（审批数量×协议单价预占的部分）；
      //  2) 按账单应付金额记实际资金成本（实收合格量×单价，含补发占用扣减）；
      //  3) 关联缺货补发已履约的，补发件在此结算（不重复计价/入库）。
      this._budgetConvertReserved('po', po.id, 'release', {
        category: 'purchase', kind: 'purchase-commit',
        summary: `供应商结算核销采购预占：${po.targetName}（账单 ${bill0.billNo}）`, traceId
      }, po.tenantId)
      if (amount.payableAmount > 0) {
        this._budgetOccupy('settle',
          [{
            unit: 'money', amount: amount.payableAmount,
            scopeType: po.targetType === 'prize' ? 'activity' : 'tenant',
            scopeId: po.targetType === 'prize' ? po.activityId : po.tenantId,
            category: 'supplier', kind: 'supplier-payment'
          }],
          {
            category: 'supplier', kind: 'supplier-payment',
            refType: 'supplier-bill', refId: bill0.id, bizNo: bill0.billNo,
            summary: `供应商付款：${po.supplierName}【${po.targetName}】应付 ${amount.payableAmount} 元（实收合格 ${amount.acceptedQty} 件）`,
            userId: po.applicantId, traceId
          }, po.tenantId)
      }
      if (reshipAllocated > 0) {
        this._budgetConvertReserved('aftersale', po.afterSaleId, 'settle', {
          category: 'reship', kind: 'reship-cost',
          summary: `缺货补发成本随采购结算：${po.targetName} ${reshipAllocated} 件`, traceId
        }, po.tenantId)
      }
      this.addAuditLog('supplier-settle', bill0.id,
        `结算付款供应商账单 ${bill0.billNo}【${bill0.targetName}】：供应商 ${bill0.supplierName} 应付 ${bill0.payableAmount} 元（实收合格 ${bill0.acceptedQty} × ${bill0.unitPrice}` +
        (bill0.reshipQty ? ` − 售后补发占用 ${bill0.reshipQty} 件 ${bill0.reshipDeduct} 元` : '') + '）；已按采购批次回写库存对账（到货/合格/验退/短少/补发占用逐批勾稽）' +
        (note.trim() ? '；备注：' + note.trim() : ''),
        { module: 'supplier', tenantId: bill0.tenantId, traceId: trace })
      if (bill0.reshipQty > 0) {
        this.addAuditLog('supplier-recon-reship', bill0.afterSaleId || bill0.id,
          `库存对账回写：采购 ${bill0.poNo} 关联售后补发 ${bill0.afterSaleId} 已履约，结算时按批次勾稽出 ${bill0.reshipQty} 件为补发占用（库存已在售后审核时扣减，不重复计价、不重复入库）`,
          { module: 'supplier', tenantId: bill0.tenantId, traceId: trace })
      }
      this.showToast(`💰 账单 ${bill0.billNo} 已结算付款 ${bill0.payableAmount} 元，库存对账已按批次回写归档`, 'success')
      this.endTrace()
      return bill0
    },

    // 采购结算对账（P7，纯推导）：逐 SKU 勾稽 验收批次/差异/售后补发/供应商账单，返回未闭环项
    // 与 P1–P6 财务对账解耦：结果不并入 openCount（避免影响积分库存对账口径），由供应商结算工作台独立闭环。
    computeSupplierRecon(tenantId = this.activeTenantId) {
      const tid = tenantId
      const inT = (x) => (x.tenantId || 't-star') === tid
      const pos = this.purchaseOrders.filter(inT)
      const items = []
      for (const po of pos) {
        if (!['received', 'diff_closed'].includes(po.status)) continue
        const bill = this.supplierBills.find((b) => b.poId === po.id)
        const batches = this.inboundBatches.filter((b) => b.poId === po.id)
        const accepted = batches.reduce((n, b) => n + (b.qty || 0), 0)
        const diffs = this.acceptDiffs.filter((d) => d.poId === po.id)
        const short = diffs.filter((d) => d.type === 'short').reduce((n, d) => n + d.qty, 0)
        const rejected = diffs.filter((d) => d.type === 'rejected').reduce((n, d) => n + d.qty, 0)
        const delivered = batches.reduce((n, b) => n + (b.deliveredQty ?? b.qty), 0)
        const reshipAs = this.afterSales.find((a) => a.id === po.afterSaleId)
        const reshipDone = !!reshipAs && reshipAs.status === 'done' && reshipAs.type === 'reship' && !!reshipAs.reshipmentId
        const issues = []
        // 1) 实收合格勾稽：PO 累计 = 批次合计
        if (po.inboundQty !== accepted) {
          issues.push({ kind: 'inbound-mismatch', label: `采购单累计实收 ${po.inboundQty} ≠ 验收批次合计 ${accepted}`, autoFixable: false })
        }
        // 2) 到货勾稽：到货 = 合格 + 验退
        if (delivered !== accepted + rejected) {
          issues.push({ kind: 'delivered-mismatch', label: `到货 ${delivered} ≠ 合格 ${accepted} + 验退 ${rejected}`, autoFixable: false })
        }
        // 3) 数量闭环：合格 + 短少 = 审批量
        if (accepted + short !== po.qty) {
          issues.push({ kind: 'qty-open', label: `合格 ${accepted} + 短少 ${short} ≠ 审批 ${po.qty}（采购单未闭环）`, autoFixable: false })
        }
        // 4) 售后补发采购：补发未完成不得结算（库存对账缺补发回写）
        if (po.purpose === 'aftersale' && !reshipDone) {
          issues.push({ kind: 'reship-pending', label: '关联售后补发尚未履约完成，结算缺补发回写（应付款含补发件，需待履约后复核）', autoFixable: false })
        }
        // 5) 已验收完成但无有效账单
        if (!bill) {
          issues.push({ kind: 'bill-missing', label: '已入库完成但尚未发起供应商账单', autoFixable: true })
        } else {
          const amount = this._supplierBillAmount(po)
          if (bill.status !== 'settled' && (bill.payableAmount !== amount.payableAmount || bill.acceptedQty !== amount.acceptedQty)) {
            issues.push({ kind: 'amount-stale', label: `账单金额/数量与最新台账不一致（账单 ${bill.payableAmount}/${bill.acceptedQty}，最新 ${amount.payableAmount}/${amount.acceptedQty}），需重新推导`, autoFixable: true })
          }
          if (bill.status === 'settled' && !bill.reconWriteback) {
            issues.push({ kind: 'writeback-missing', label: '已结算但缺少库存对账回写快照', autoFixable: false })
          }
          if (bill.status === 'reviewing' || bill.status === 'approved') {
            issues.push({ kind: 'settle-open', label: bill.status === 'reviewing' ? '账单待财务复核' : '账单复核通过，待结算付款', autoFixable: true })
          }
          if (bill.status === 'rejected') issues.push({ kind: 'bill-rejected', label: '账单被财务驳回，待运营修订重提', autoFixable: true })
        }
        items.push({
          poId: po.id, poNo: po.poNo, targetName: po.targetName, icon: po.icon,
          supplierName: po.supplierName, status: po.status,
          orderQty: po.qty, acceptedQty: accepted, shortQty: short, rejectedQty: rejected,
          reshipDone, reshipmentId: reshipAs?.reshipmentId || '',
          billId: bill?.id || '', billStatus: bill?.status || '',
          payableAmount: bill?.payableAmount ?? null, issues
        })
      }
      return {
        tenantId: tid, generatedAt: Date.now(),
        items,
        openCount: items.reduce((n, x) => n + x.issues.length, 0),
        openPo: items.filter((x) => x.issues.length).length,
        settledPo: items.filter((x) => x.billStatus === 'settled' && !x.issues.length).length
      }
    },

    // ===== 营销预算与成本控制闭环 =====
    // 预算单：按「租户/活动 × 积分/资金」编制，财务审批生效（budget:manage / budget:approve）。
    // 占用台账 append-only：reserve 预占（风控冻结成本、审批中采购）→ settle 实际成本（放行/正常落账/
    // 任务奖励/供应商付款）/ release 释放（风控撤销、采购驳回撤销）；售后退货 refund 冲回已占用积分成本。
    // 抽奖、积分奖励、采购入库及供应商结算在业务落账前实时预检 + 锁内核验，超额/冻结/关闭整笔阻断。

    // 生效预算定位：活动类占用同时落「活动预算 + 租户同币种预算」；无生效预算则该维度不控制
    _activeBudgets(tenantId, scopeType, scopeId, unit) {
      return this._scopeBudgets(tenantId, scopeType, scopeId, unit, ['active'])
    },
    // 预检口径：冻结预算拦截新增支出（已关闭预算为历史终态，新支出可落到其他生效预算）
    _guardBudgets(tenantId, scopeType, scopeId, unit) {
      return this._scopeBudgets(tenantId, scopeType, scopeId, unit, ['active', 'frozen'])
    },
    _scopeBudgets(tenantId, scopeType, scopeId, unit, statuses) {
      return this.budgets.filter(
        (b) => (b.tenantId || 't-star') === tenantId && b.unit === unit && statuses.includes(b.status) &&
          (b.scopeType === 'tenant' && b.scopeId === tenantId ||
            scopeType === 'activity' && b.scopeType === 'activity' && b.scopeId === scopeId)
      )
    },

    // 预算预检（不落账）：返回 boolean 并对超额/冻结关闭给出拦截提示
    _budgetGuard(items, tenantId = this.activeTenantId) {
      // 同一笔业务可能同时产生多条占用（抽奖成本 + 积分奖励），按「预算 × 币种」汇总后一次性校验，
      // 避免按条校验时成本恰好通过、奖励却超额导致的超支
      const needByBudget = new Map()
      for (const it of items || []) {
        const amount = Math.round((Number(it.amount) || 0) * 100) / 100
        if (amount <= 0) continue
        for (const b of this._guardBudgets(tenantId, it.scopeType || 'tenant', it.scopeId || tenantId, it.unit)) {
          needByBudget.set(b.id, (needByBudget.get(b.id) || 0) + amount)
        }
      }
      for (const [budgetId, need0] of needByBudget) {
        const need = Math.round(need0 * 100) / 100
        const b = this.budgets.find((x) => x.id === budgetId)
        if (!b) continue
        if (b.status === 'frozen') {
          this.showToast(`⛔ 预算【${b.name}】已冻结，支出被拦截`, 'warn')
          return false
        }
        if (b.status !== 'active') continue
        const sum = this.budgetSummary(b.id)
        if (sum.occupied + need > b.amount + 1e-6) {
          const unit = BUDGET_UNITS[b.unit].unit
          this.showToast(
            `⛔ 预算【${b.name}】余额不足：需占用 ${need} ${unit}，可用 ${Math.round((b.amount - sum.occupied) * 100) / 100} ${unit}（预算 ${b.amount}，已占用 ${sum.occupied}）`,
            'warn')
          return false
        }
      }
      return true
    },

    // 落占用（mode: reserve | settle）；同一（业务凭证,预算,方向）幂等
    _budgetOccupy(mode, items, refs, tenantId = this.activeTenantId) {
      const rows = []
      for (const it of items || []) {
        const amount = Math.round((Number(it.amount) || 0) * 100) / 100
        if (amount <= 0) continue
        const scopeType = it.scopeType || 'tenant'
        const scopeId = it.scopeId || tenantId
        const rowRefId = `${refs.refId}:${it.kind || refs.kind}`
        const effectBase = `bg-${mode}:${refs.refType}:${rowRefId}`
        for (const b of this._activeBudgets(tenantId, scopeType, scopeId, it.unit)) {
          const effectId = `${effectBase}:${b.id}`
          if (this.budgetLedger.some((l) => l.effectId === effectId)) continue
          const sum = this.budgetSummary(b.id)
          if (b.status === 'frozen' || b.status === 'closed') continue // 预检已拦截，兜底
          if (sum.occupied + amount > b.amount + 1e-6) continue
          rows.push({
            id: genId('bl'),
            budgetId: b.id, bNo: b.bNo,
            tenantId, scopeType: b.scopeType, scopeId: b.scopeId, unit: b.unit,
            category: it.category || refs.category, kind: it.kind || refs.kind,
            direction: mode, converts: false, reserveOf: '',
            amount,
            refType: refs.refType, refId: `${refs.refId}:${it.kind || refs.kind}`, bizNo: refs.bizNo || '',
            summary: refs.summary || '',
            userId: refs.userId || this.user.id,
            operator: this.actorName(),
            traceId: currentTrace || refs.traceId || '',
            date: this.todayDate, time: nowTime(), ts: Date.now(),
            effectId
          })
        }
      }
      if (rows.length) this.budgetLedger.unshift(...rows)
      return rows
    },

    // 预占 → 实际成本（direction='settle'，风控放行）/ 释放（direction='release'，风控撤销、采购驳回撤销、供应商付款核销采购预占）
    // 匹配该业务凭证下全部占用种类（record 类按 `${refId}:${kind}` 存多条：draw-cost/points-reward/redeem-cost）
    _budgetConvertReserved(refType, refId, direction, refs = {}, tenantId = this.activeTenantId) {
      const reserves = this.budgetLedger.filter((l) =>
        l.direction === 'reserve' && l.refType === refType &&
        (l.refId === refId || l.refId.startsWith(`${refId}:`)))
      const out = []
      reserves.forEach((rv) => {
        if (this.budgetLedger.some((l) => l.reserveOf === rv.id && ['settle', 'release'].includes(l.direction))) return
        if ((rv.tenantId || 't-star') !== tenantId) return
        const b = this.budgets.find((x) => x.id === rv.budgetId)
        if (!b) return
        const effectId = `bg-${direction}:reserve:${rv.id}`
        if (this.budgetLedger.some((l) => l.effectId === effectId)) return
        out.push({
          id: genId('bl'),
          budgetId: b.id, bNo: b.bNo,
          tenantId, scopeType: b.scopeType, scopeId: b.scopeId, unit: b.unit,
          category: refs.category || rv.category, kind: refs.kind || rv.kind,
          direction, converts: direction === 'settle', reserveOf: rv.id,
          amount: rv.amount,
          refType: refs.refType || refType, refId: refs.refId || refId, bizNo: refs.bizNo || rv.bizNo,
          summary: refs.summary || rv.summary,
          userId: rv.userId,
          operator: this.actorName(),
          traceId: currentTrace || refs.traceId || rv.traceId || '',
          date: this.todayDate, time: nowTime(), ts: Date.now(),
          effectId
        })
      })
      if (out.length) this.budgetLedger.unshift(...out)
      return out
    },

    // 已结算成本冲回（售后拒收/退货返还积分成本）
    _budgetRefund(item, refs, tenantId = this.activeTenantId) {
      const amount = Math.round((Number(item.amount) || 0) * 100) / 100
      if (amount <= 0) return []
      const scopeType = item.scopeType || 'tenant'
      const scopeId = item.scopeId || tenantId
      const out = []
      for (const b of this._activeBudgets(tenantId, scopeType, scopeId, item.unit)) {
        const effectId = `bg-refund:${refs.refType}:${refs.refId}:${b.id}`
        if (this.budgetLedger.some((l) => l.effectId === effectId)) continue
        out.push({
          id: genId('bl'),
          budgetId: b.id, bNo: b.bNo,
          tenantId, scopeType: b.scopeType, scopeId: b.scopeId, unit: b.unit,
          category: refs.category, kind: refs.kind,
          direction: 'refund', converts: false, reserveOf: '',
          amount,
          refType: refs.refType, refId: refs.refId, bizNo: refs.bizNo || '',
          summary: refs.summary || '',
          userId: refs.userId || this.user.id,
          operator: this.actorName(),
          traceId: currentTrace || refs.traceId || '',
          date: this.todayDate, time: nowTime(), ts: Date.now(),
          effectId
        })
      }
      if (out.length) this.budgetLedger.unshift(...out)
      return out
    },

    // 抽奖占用条目：活动积分成本 + 积分奖品成本（积分预算，落活动预算+租户预算）
    _drawBudgetItems(act, prize, cost) {
      const items = []
      if (cost > 0) items.push({ unit: 'points', amount: cost, scopeType: 'activity', scopeId: act.id, category: 'draw', kind: 'draw-cost' })
      const pointPrize = prize?.name?.includes('积分') ? (parseInt(prize.name) || 0) : 0
      if (pointPrize > 0) items.push({ unit: 'points', amount: pointPrize, scopeType: 'activity', scopeId: act.id, category: 'points', kind: 'points-reward' })
      return items
    },
    _redeemBudgetItems(g) {
      return g.cost > 0
        ? [{ unit: 'points', amount: g.cost, scopeType: 'tenant', scopeId: g.tenantId || 't-star', category: 'redeem', kind: 'redeem-cost' }]
        : []
    },

    // 运营编制预算（RBAC：budget:manage；一口径一币种同时仅一张生效/待审批/冻结预算）
    createBudget(form) {
      this.syncBusinessDay()
      const trace = this.beginTrace()
      if (!this.requirePerm('budget:manage', 'budget')) { this.endTrace(); return null }
      const tid = this.activeTenantId
      const scopeType = form.scopeType === 'activity' ? 'activity' : 'tenant'
      let scopeId = tid
      let scopeName = this.activeTenant.shortName
      if (scopeType === 'activity') {
        const act = this.activities.find((a) => a.id === form.scopeId && a.tenantId === tid)
        if (!act) { this.showToast('活动不存在或不属于当前租户', 'warn'); this.endTrace(); return null }
        scopeId = act.id
        scopeName = act.name
      }
      const unit = form.unit === 'points' ? 'points' : 'money'
      const amount = Math.round((Number(form.amount) || 0) * 100) / 100
      if (!(amount > 0)) { this.showToast('预算额度需为正数', 'warn'); this.endTrace(); return null }
      if (amount > 1e12) { this.showToast('预算额度异常，请核对', 'warn'); this.endTrace(); return null }
      const startDate = form.startDate || this.todayDate
      const endDate = form.endDate || startDate
      if (endDate < startDate) { this.showToast('预算结束日不能早于开始日', 'warn'); this.endTrace(); return null }
      const dup = this.budgets.some((b) =>
        (b.tenantId || 't-star') === tid && b.scopeType === scopeType && b.scopeId === scopeId && b.unit === unit &&
        ['pending', 'active', 'frozen'].includes(b.status))
      if (dup) { this.showToast('该口径已存在生效/待审批/冻结中的同币种预算（一口径同时仅一张生效预算）', 'warn'); this.endTrace(); return null }
      const b = {
        id: genId('bg'),
        bNo: 'BG' + Date.now().toString(36).toUpperCase() + String(Math.floor(Math.random() * 90) + 10),
        tenantId: tid, traceId: trace,
        scopeType, scopeId, scopeName, unit,
        name: (form.name || '').trim() || (scopeType === 'activity' ? `活动预算：${scopeName}` : `${scopeName}${unit === 'points' ? '积分' : '营销资金'}预算`),
        purpose: (form.purpose || '').trim(),
        amount, startDate, endDate,
        status: 'pending',
        applicant: this.user.name, applicantId: this.currentMemberId || this.user.id,
        createdAt: this.todayDate, time: nowTime(), ts: Date.now(),
        reviewedAt: '', reviewer: '', reviewNote: '', frozenAt: '', closedAt: '',
        adjustments: [], version: 1, parentId: ''
      }
      this.budgets.unshift(b)
      this.addAuditLog('budget-apply', b.id,
        `编制预算【${b.name}】：${scopeType === 'activity' ? '活动' : '租户'}级${BUDGET_UNITS[unit].label} ${amount} ${BUDGET_UNITS[unit].unit}（${startDate} ~ ${endDate}），提交财务审批`,
        { module: 'budget', tenantId: tid, traceId: trace })
      this.showToast(`💰 预算已提交财务审批：${b.name}（${amount} ${BUDGET_UNITS[unit].unit}）`, 'success')
      this.endTrace()
      return b
    },

    // 财务审批预算（RBAC：budget:approve；pending → active/rejected）
    reviewBudget(budgetId, approve, note = '') {
      const trace = this.beginTrace()
      const b = this.budgets.find((x) => x.id === budgetId)
      if (!b) { this.endTrace(); return false }
      if (!this.requirePerm('budget:approve', 'budget') || !this.requireSameTenant(b.tenantId, 'budget')) {
        this.endTrace(); return false
      }
      if (b.status !== 'pending') { this.showToast('仅待审批预算可审批', 'warn'); this.endTrace(); return false }
      const remark = note.trim()
      b.status = approve ? 'active' : 'rejected'
      b.reviewedAt = `${this.todayDate} ${nowTime()}`
      b.reviewer = this.user.name
      b.reviewNote = remark
      this.addAuditLog(approve ? 'budget-approve' : 'budget-reject', b.id,
        `${approve ? '审批通过预算' : '驳回预算'}【${b.name}】（额度 ${b.amount} ${BUDGET_UNITS[b.unit].unit}）${remark ? '；意见：' + remark : ''}`,
        { module: 'budget', tenantId: b.tenantId, traceId: trace })
      this.showToast(approve ? `✅ 预算【${b.name}】已生效，开始实时占用控制` : `预算【${b.name}】已驳回`, approve ? 'success' : 'info')
      this.endTrace()
      return true
    },

    // 申请人撤销待审批预算
    cancelBudget(budgetId) {
      const trace = this.beginTrace()
      const b = this.budgets.find((x) => x.id === budgetId)
      if (!b) { this.endTrace(); return false }
      if (!this.requirePerm('budget:manage', 'budget') || !this.requireSameTenant(b.tenantId, 'budget')) {
        this.endTrace(); return false
      }
      if (b.status !== 'pending') { this.showToast('仅待审批预算可撤销', 'warn'); this.endTrace(); return false }
      const isAdmin = this.identityKind === 'platform' || this.currentMember?.roleKey === 'org_admin'
      if (!isAdmin && b.applicantId !== (this.currentMemberId || this.user.id)) {
        this.deny('budget-denied', '只能撤销本人编制的预算申请', { module: 'budget', tenantId: b.tenantId, traceId: trace })
        this.endTrace(); return false
      }
      b.status = 'canceled'
      b.reviewNote = '申请人撤销'
      this.addAuditLog('budget-cancel', b.id, `撤销预算【${b.name}】（审批前撤回，未参与占用控制）`,
        { module: 'budget', tenantId: b.tenantId, traceId: trace })
      this.showToast('预算申请已撤销', 'info')
      this.endTrace()
      return true
    },

    // 财务冻结/解冻预算（冻结期新增支出一律拦截，已发生占用保留）
    setBudgetFrozen(budgetId, frozen, note = '') {
      const trace = this.beginTrace()
      const b = this.budgets.find((x) => x.id === budgetId)
      if (!b) { this.endTrace(); return false }
      if (!this.requirePerm('budget:approve', 'budget') || !this.requireSameTenant(b.tenantId, 'budget')) {
        this.endTrace(); return false
      }
      const want = frozen ? 'active' : 'frozen'
      if (b.status !== want) { this.showToast(frozen ? '仅生效中预算可冻结' : '仅冻结中预算可解冻', 'warn'); this.endTrace(); return false }
      b.status = frozen ? 'frozen' : 'active'
      if (frozen) b.frozenAt = `${this.todayDate} ${nowTime()}`
      else b.frozenAt = ''
      if (note.trim()) b.reviewNote = note.trim()
      this.addAuditLog(frozen ? 'budget-freeze' : 'budget-activate', b.id,
        `${frozen ? '冻结预算' : '解冻预算'}【${b.name}】${note.trim() ? '；备注：' + note.trim() : ''}${frozen ? '；冻结期新增抽奖/兑换/采购等支出一律拦截' : '；恢复实时占用控制'}`,
        { module: 'budget', tenantId: b.tenantId, traceId: trace })
      this.showToast(frozen ? `❄️ 预算【${b.name}】已冻结，新增支出被拦截` : `预算【${b.name}】已解冻`, 'info')
      this.endTrace()
      return true
    },

    // 财务关闭预算（终态；历史占用台账保留）
    closeBudget(budgetId, note = '') {
      const trace = this.beginTrace()
      const b = this.budgets.find((x) => x.id === budgetId)
      if (!b) { this.endTrace(); return false }
      if (!this.requirePerm('budget:approve', 'budget') || !this.requireSameTenant(b.tenantId, 'budget')) {
        this.endTrace(); return false
      }
      if (!['active', 'frozen'].includes(b.status)) { this.showToast('仅生效/冻结预算可关闭', 'warn'); this.endTrace(); return false }
      b.status = 'closed'
      b.closedAt = `${this.todayDate} ${nowTime()}`
      b.reviewNote = note.trim()
      this.addAuditLog('budget-close', b.id,
        `关闭预算【${b.name}】（预算期终止，历史台账保留，不再接受新占用）${note.trim() ? '；备注：' + note.trim() : ''}`,
        { module: 'budget', tenantId: b.tenantId, traceId: trace })
      this.showToast(`预算【${b.name}】已关闭`, 'info')
      this.endTrace()
      return true
    },

    // 预算调整申请（运营；append-only 留痕，审批通过后才改额度）
    requestBudgetAdjust(budgetId, delta, reason) {
      this.syncBusinessDay()
      const trace = this.beginTrace()
      const b = this.budgets.find((x) => x.id === budgetId)
      if (!b) { this.endTrace(); return null }
      if (!this.requirePerm('budget:manage', 'budget') || !this.requireSameTenant(b.tenantId, 'budget')) {
        this.endTrace(); return null
      }
      if (!['active', 'frozen'].includes(b.status)) { this.showToast('仅生效/冻结预算可申请调整', 'warn'); this.endTrace(); return null }
      const d = Math.round((Number(delta) || 0) * 100) / 100
      if (d === 0) { this.showToast('调整额度不能为 0', 'warn'); this.endTrace(); return null }
      if (b.amount + d < 0) { this.showToast('调减后预算额度不能为负', 'warn'); this.endTrace(); return null }
      if ((b.adjustments || []).some((a) => a.status === 'pending')) { this.showToast('该预算已有待审批调整，请先处理', 'warn'); this.endTrace(); return null }
      const text = (reason || '').trim()
      if (!text) { this.showToast('请填写调整事由', 'warn'); this.endTrace(); return null }
      const adj = {
        id: genId('bga'), delta: d, reason: text, status: 'pending',
        applicant: this.user.name, applicantId: this.currentMemberId || this.user.id,
        createdAt: this.todayDate, time: nowTime(), ts: Date.now(),
        reviewedAt: '', reviewer: '', reviewNote: ''
      }
      b.adjustments = [...(b.adjustments || []), adj]
      this.addAuditLog('budget-adjust-apply', b.id,
        `申请${d > 0 ? '追加' : '调减'}预算【${b.name}】 ${d > 0 ? '+' : ''}${d} ${BUDGET_UNITS[b.unit].unit}（${b.amount} → ${Math.round((b.amount + d) * 100) / 100}），待财务审批`,
        { module: 'budget', tenantId: b.tenantId, traceId: trace })
      this.showToast('预算调整申请已提交财务审批', 'success')
      this.endTrace()
      return adj
    },

    // 财务审批预算调整
    reviewBudgetAdjust(budgetId, adjustId, approve, note = '') {
      const trace = this.beginTrace()
      const b = this.budgets.find((x) => x.id === budgetId)
      if (!b) { this.endTrace(); return false }
      if (!this.requirePerm('budget:approve', 'budget') || !this.requireSameTenant(b.tenantId, 'budget')) {
        this.endTrace(); return false
      }
      const adj = (b.adjustments || []).find((a) => a.id === adjustId)
      if (!adj) { this.showToast('预算调整记录不存在', 'warn'); this.endTrace(); return false }
      if (adj.status !== 'pending') { this.showToast('该调整已审批', 'warn'); this.endTrace(); return false }
      const remark = note.trim()
      const before = b.amount
      adj.status = approve ? 'approved' : 'rejected'
      adj.reviewedAt = `${this.todayDate} ${nowTime()}`
      adj.reviewer = this.user.name
      adj.reviewNote = remark
      if (approve) {
        b.amount = Math.round((b.amount + adj.delta) * 100) / 100
        b.version += 1
      }
      this.addAuditLog(approve ? 'budget-adjust-approve' : 'budget-adjust-reject', b.id,
        `${approve ? '审批通过预算调整' : '驳回预算调整'}【${b.name}】 ${adj.delta > 0 ? '+' : ''}${adj.delta}（${before} → ${b.amount} ${BUDGET_UNITS[b.unit].unit}）${remark ? '；意见：' + remark : ''}`,
        { module: 'budget', tenantId: b.tenantId, traceId: trace })
      this.showToast(approve ? `✅ 预算调整已生效：${b.name} 额度 ${b.amount} ${BUDGET_UNITS[b.unit].unit}` : '预算调整已驳回', approve ? 'success' : 'info')
      this.endTrace()
      return true
    },

    // ===== 卡券账户与核销 =====
    // 生命周期：中奖/兑换有效后发券（issue）；风控冻结时只预占库存（hold，不发券），
    //          放行后交付发券（deliver），撤销释放预占（revoke，券从未发出）；
    //          用户出示券码、运营扫码/输码核销（redeem）；到期自动失效（expire）。
    // 券码全局唯一；状态机保证重复核销、过期核销被拦截；券实例、卡券台账 append-only。
    // 卡券业务台账（append-only，核销/发券留痕，不裁剪）
    addCouponLog(action, couponId, rec, extra = {}) {
      const tpl = rec?.couponId ? (this.couponTpls[rec.couponId] || null) : null
      const log = {
        id: genId('cl'),
        action,                                 // issue | hold | deliver | revoke | redeem | expire | comp
        actionLabel: {
          issue: '卡券发放', hold: '风控预占', deliver: '放行交付', revoke: '撤销释放',
          redeem: '卡券核销', expire: '到期失效', comp: '对账补券'
        }[action] || action,
        couponId: couponId || '',
        code: extra.code || '',
        tplId: rec?.couponId || extra.tplId || '',
        tplName: tpl?.name || extra.tplName || rec?.prizeName || rec?.goodsName || '',
        recordId: rec?.id || extra.recordId || '',
        bizType: rec?.type || extra.bizType || '',
        orderId: extra.orderId || '',
        tenantId: extra.tenantId || rec?.tenantId || this.activeTenantId,
        traceId: extra.traceId || rec?.traceId || currentTrace || '',
        operator: this.role === 'operator' ? `运营(${this.user.name})` : (extra.operator || this.user.name),
        note: extra.note || '',
        date: this.todayDate,
        time: nowTime(),
        ts: Date.now()
      }
      this.couponLogs.unshift(log)
      if (this.couponLogs.length > 500) this.couponLogs.pop()
      return log
    },

    // 生成全局唯一券码（大写字母+数字，剔除易混字符；碰撞重取）
    _genCouponCode() {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
      for (let i = 0; i < 10; i++) {
        let body = ''
        for (let j = 0; j < 10; j++) body += chars[Math.floor(Math.random() * chars.length)]
        const code = `CP-${body.slice(0, 5)}-${body.slice(5)}`
        if (!this.coupons.some((c) => c.code === code)) return code
      }
      return `CP-${genId('x').toUpperCase()}`
    },

    // 券码归一化：去空白/横杠后比较，容忍用户输入空格、小写、连字符
    _normCode(code) {
      return String(code || '').replace(/[\s-]/g, '').toUpperCase()
    },

    // 按券码查券实例（归一化匹配）
    couponByCode(code) {
      const key = this._normCode(code)
      if (!key) return null
      return this.coupons.find((c) => this._normCode(c.code) === key) || null
    },

    // 计算有效期（自指定业务日起 validityDays 天，到期日 23:59:59.999）
    _couponExpiry(tpl, fromDate) {
      const d = new Date(`${fromDate} 00:00:00`)
      d.setDate(d.getDate() + Math.max(0, (tpl.validityDays || 30) - 1))
      d.setHours(23, 59, 59, 999)
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      return { ts: d.getTime(), date: `${d.getFullYear()}-${m}-${day}` }
    },

    // 有效业务记录（normal/released）发券至卡券账户；幂等：一条业务记录至多一张券。
    // 风控放行交付时有效期以放行日（今日）起算；正常中奖/兑换以当日起算。
    issueCouponForRecord(rec, opts = {}) {
      if (!rec) return null
      if (rec.status !== 'normal' && rec.status !== 'released') return null
      if (!rec.couponId) return null
      if (this.coupons.some((c) => c.recordId === rec.id)) return null
      const tpl = this.couponTpls[rec.couponId]
      if (!tpl) return null
      const isDraw = rec.type === 'draw'
      const tid = rec.tenantId || this.activeTenantId
      const exp = this._couponExpiry(tpl, this.todayDate)
      const coupon = {
        id: genId('cp'),
        code: this._genCouponCode(),
        tplId: tpl.id,
        name: tpl.name,
        type: tpl.type,
        typeLabel: COUPON_TYPES[tpl.type]?.label || tpl.type,
        emoji: tpl.emoji,
        denomination: tpl.denomination || 0,
        threshold: tpl.threshold || 0,
        face: tpl.face || '',
        desc: tpl.desc || '',
        validityDays: tpl.validityDays || 30,
        status: 'available',                // available | redeemed | expired
        tenantId: tid,
        userId: rec.userId || this.user.id,
        userName: rec.userName || this.user.name,
        recordId: rec.id,
        bizType: rec.type,
        activityId: isDraw ? rec.activityId : null,
        source: opts.source || (rec.status === 'released' ? '风控放行' : (isDraw ? '中奖' : '积分兑换')),
        issueDate: this.todayDate,
        time: nowTime(),
        ts: Date.now(),
        traceId: rec.traceId || currentTrace || '',
        expireDate: exp.date,
        expireTs: exp.ts,
        // 核销信息（运营核销时补全）
        redeemedAt: '', redeemOperator: '', redeemChannel: (opts.channel || '到店扫码'), redeemNote: '',
        // 补券标记（对账补记时关联差异单）
        compensateBillId: opts.compensateBillId || '',
        comp: !!opts.compensateBillId
      }
      this.coupons.unshift(coupon)
      const action = coupon.source === '风控放行' ? 'deliver' : 'issue'
      this.addCouponLog(action, coupon.id, rec, { code: coupon.code, orderId: opts.orderId || rec.riskOrderId || '', tenantId: tid })
      this.addAuditLog(
        action === 'deliver' ? 'coupon-deliver' : 'coupon-issue',
        rec.riskOrderId || '',
        `发放卡券【${tpl.name}】（券码 ${coupon.code}，有效期至 ${exp.date}）：${isDraw ? `抽奖中奖【${rec.prizeName}】` : `积分兑换【${rec.goodsName}】`}${action === 'deliver' ? '，风控放行后交付（有效期自放行日起算）' : ''}`,
        { module: 'coupon', tenantId: tid }
      )
      return coupon
    },

    // 到期扫描：过期 available 券批量流转为 expired（幂等：只处理仍可用且到期的券；跨租户全部扫描）
    // 任何业务动作与运营核销前都会先经 syncBusinessDay 调用，杜绝出示/核销已过期券。
    sweepCouponExpiry(silent = false) {
      const now = Date.now()
      const due = this.coupons.filter((c) => c.status === 'available' && c.expireTs < now)
      if (!due.length) return 0
      due.forEach((c) => {
        c.status = 'expired'
        const rec = this.records.find((r) => r.id === c.recordId) || null
        this.addCouponLog('expire', c.id, rec, { code: c.code, tplId: c.tplId, tplName: c.name, tenantId: c.tenantId })
      })
      // 按租户汇总留痕，审计归属取当前上下文（系统扫描），日志明细带各租户券码
      const byTenant = {}
      due.forEach((c) => {
        const k = c.tenantId || 't-star'
        byTenant[k] = byTenant[k] || []
        byTenant[k].push(c)
      })
      Object.keys(byTenant).forEach((tid) => {
        const list = byTenant[tid]
        this.addAuditLog('coupon-expire', null,
          `卡券到期扫描：${list.length} 张券已过期失效（${list.map((c) => `${c.name} ${c.code}`).join('；')}）`,
          { module: 'coupon', tenantId: tid, silent: true })
      })
      if (!silent) this.showToast(`⏰ ${due.length} 张卡券已到期，自动标记为已过期`, 'info')
      return due.length
    },

    // 运营按券码核销：校验归属/状态/有效期，状态机幂等防重复核销
    // RBAC：coupon:redeem；数据隔离：仅可核销当前数据上下文租户的券（跨租户券码视为不存在并留痕）
    redeemCoupon(code, form = {}) {
      this.syncBusinessDay() // 核销前先做到期流转
      const trace = this.beginTrace()
      if (!this.requirePerm('coupon:redeem', 'coupon')) { this.endTrace(); return null }
      const c = this.couponByCode(code)
      if (!c || (c.tenantId || 't-star') !== this.activeTenantId) {
        if (c) {
          this.deny('cross-tenant-denied',
            `券码 ${c.code} 属于其他租户，当前账号无权核销（数据强隔离）`,
            { module: 'coupon', tenantId: c.tenantId, traceId: trace })
        } else {
          this.showToast('券码不存在，请核对后重试', 'warn')
        }
        this.endTrace()
        return null
      }
      if (c.status === 'redeemed') {
        this.showToast(`该券码已核销（${c.redeemedAt}，核销人 ${c.redeemOperator}），请勿重复核销`, 'warn')
        this.endTrace()
        return { duplicated: true, coupon: c }
      }
      if (c.status === 'expired' || c.expireTs < Date.now()) {
        // 双重保险：到期扫描未覆盖到（如系统时钟跳变）也不允许核销
        if (c.status !== 'expired') {
          c.status = 'expired'
          const rec = this.records.find((r) => r.id === c.recordId) || null
          this.addCouponLog('expire', c.id, rec, { code: c.code, tplId: c.tplId, tplName: c.name, tenantId: c.tenantId, traceId: trace })
        }
        this.showToast(`该券已于 ${c.expireDate} 到期，无法核销`, 'warn')
        this.endTrace()
        return { expired: true, coupon: c }
      }
      const note = (form.note || '').trim()
      const channel = (form.channel || '到店扫码').trim() || '到店扫码'
      c.status = 'redeemed'
      c.redeemedAt = `${this.todayDate} ${nowTime()}`
      c.redeemOperator = this.user.name
      c.redeemChannel = channel
      c.redeemNote = note
      const rec = this.records.find((r) => r.id === c.recordId) || null
      this.addCouponLog('redeem', c.id, rec, { code: c.code, note: note ? `${channel}：${note}` : channel, tenantId: c.tenantId, traceId: trace })
      this.addAuditLog('coupon-redeem', '',
        `核销卡券【${c.name}】券码 ${c.code}（用户 ${c.userName}，渠道 ${channel}，有效期至 ${c.expireDate}）${note ? '；备注：' + note : ''}`,
        { module: 'coupon', tenantId: c.tenantId, traceId: trace })
      this.showToast(`✅ 核销成功：${c.name}（${c.code}）`, 'success')
      this.endTrace()
      return { coupon: c }
    },

    // 演示注入：让一笔已发券在账户中"凭空消失"（业务记录在、券账户漏发），由 P6 检出并补券。
    // 稳定选取满减券类（与库存注入固定选 g1 同理），优先种子券、其次任意待核销满减券。
    injectCouponGap() {
      this.syncBusinessDay()
      const d = this.todayDate
      const tid = this.activeTenantId
      if (this.couponLogs.some((l) => l.action === 'comp' && l.date === d && (l.tenantId || 't-star') === tid)) {
        this.showToast('今日已注入过卡券漏发差异，请勿重复注入', 'warn')
        return
      }
      const c = this.scopedCoupons.find((x) => x.status === 'available' && x.tplId === 'c-discount-10')
        || this.scopedCoupons.find((x) => x.status === 'available')
      if (!c) { this.showToast('当前租户没有待核销券，无法注入漏发差异', 'warn'); return }
      const rec = this.records.find((r) => r.id === c.recordId) || null
      const removedName = c.name
      const removedRecordId = c.recordId
      this.coupons = this.coupons.filter((x) => x.id !== c.id)
      // 登记一条注入痕迹（区别于真实补券：带 inject 标记，不写 coupon 实例）
      this.addCouponLog('revoke', '', rec, { tplId: c.tplId, tplName: c.name, note: '【演示注入】券账户漏发：业务记录有效、券实例缺失', tenantId: tid })
      this.addAuditLog('recon-inject', '',
        `【演示注入】${d} 卡券【${removedName}】业务记录 ${removedRecordId} 有效但券账户实例漏发，等待 P6 对账检出`,
        { module: 'recon', tenantId: tid })
      this.showToast(`🔧 已注入演示差异：卡券【${removedName}】账户漏发（业务记录在、券缺失）`, 'warn')
    },

    // 更新风控规则（RBAC：risk:rule；仅本租户规则，不影响其他租户的抽奖/兑换判定）
    updateRiskRules(patch) {
      if (!this.requirePerm('risk:rule', 'risk')) return false
      const trace = this.beginTrace()
      const tid = this.activeTenantId
      const before = this.ensureRiskRules(tid)
      // 数组字段取独立副本，避免与其他租户/表单对象共享引用
      const next = {
        ...before,
        ...patch,
        highValueRarities: patch.highValueRarities ? [...patch.highValueRarities] : before.highValueRarities,
        blacklist: patch.blacklist ? [...patch.blacklist] : before.blacklist
      }
      this.riskRulesByTenant[tid] = next
      const changes = []
      Object.keys(patch).forEach((k) => {
        if (JSON.stringify(before[k]) !== JSON.stringify(next[k])) {
          changes.push(`${k}: ${JSON.stringify(before[k])} → ${JSON.stringify(next[k])}`)
        }
      })
      this.addAuditLog('config', null,
        `【${this.activeTenant.shortName}】调整规则：${changes.join('；') || '规则配置已保存（无变化）'}`,
        { module: 'risk', tenantId: tid, traceId: trace })
      this.showToast('风控规则已更新', 'success')
      this.endTrace()
      return true
    },

    saveDayLog() {
      // 业务动作落账前确保业务日一致（统一走业务日切换）
      this.syncBusinessDay()
      return true
    },

    // ===== 积分库存对账 =====
    // 对账口径（按业务日 D）：
    //  P1 积分发生额：业务侧（抽奖成本/中奖积分、兑换成本/撤销返还、任务奖励）推导的应有净额
    //                vs 积分流水实际净额（补偿流水单列），残差即少记/多记
    //  P2 任务奖励台账：taskClaims 每笔领奖必须有对应流水（台账 id 精确勾稽，跨日补计按 bizDate 归属）
    //  P3 余额链：append-only 流水余额快照逐笔连续，且最新一行余额 == 当前可用积分（安全网）
    //  P4 冻结单据（当前态）：在审单与业务记录状态一致、冻结积分=业务成本、预占库存=账面 frozen
    //  P5 库存账实（当前态）：应有 remain = 初始库存 - 有效消耗 + 库存校正，与实物账逐 SKU 比对
    //
    // 幂等：一业务日一张差异单，签名（各类残差指纹）不变即同一版本；重复执行只追加执行痕迹，不重建、不重复补偿。
    // 跨日：补偿流水带 bizDate 归属原业务日、date 为实际处理日；风控放行/撤销的积分动作按审核日入账。
    // 留痕：原始流水/业务记录/库存行永不改写，所有修正只追加补偿流水与库存校正台账。

    _flowBizDate(p) {
      return p.bizDate || p.date
    },
    // 领奖台账的已入账流水：新数据按 claimId 精确勾稽；历史种子/旧数据保留备注模糊匹配兜底。——按租户范围匹配
    _taskClaimFlow(claim, usedFlowIds = new Set(), tenantId = this.activeTenantId) {
      const inT = (p) => (p.tenantId || 't-star') === (tenantId || 't-star')
      const linked = this.pointRecords.find((p) =>
        inT(p) && p.refType === 'task-claim' && p.refId === claim.id
      )
      if (linked) return linked
      const comp = this.pointRecords.find((p) =>
        inT(p) && !usedFlowIds.has(p.id) && p.kind === 'task-comp' && p.refId === claim.id
      )
      if (comp) return comp
      if (claim.flowId) {
        const byLedger = this.pointRecords.find((p) => p.id === claim.flowId && inT(p))
        if (byLedger) return byLedger
      }
      return this.pointRecords.find((p) =>
        inT(p) && !usedFlowIds.has(p.id) && p.kind === 'reward' &&
        this._flowBizDate(p) === claim.bizDate && p.delta === claim.reward &&
        p.note.includes('任务结算') && p.note.includes(claim.taskLabel)
      ) || null
    },
    _orderOfRecord(recordId) {
      return this.riskOrders.find((o) => o.recordId === recordId)
    },
    _reviewDate(order) {
      return (order?.reviewedAt || '').slice(0, 10)
    },
    // 抽奖记录对应的积分成本（免费活动为 0）
    _drawCostOf(rec) {
      const act = this.activities.find((a) => a.id === rec.activityId)
      return act && act.costType === 'points' ? (act.cost || 0) : 0
    },
    // 抽奖中奖积分（仅积分奖品）
    _drawPrizePoints(rec) {
      return rec.prizeName && rec.prizeName.includes('积分') ? (parseInt(rec.prizeName) || 0) : 0
    },

    // 计算某租户某业务日的对账差异（纯推导，不落库；补偿流水/校正台账参与勾稽）
    computeReconDiffs(date, tenantId = this.activeTenantId) {
      const tid = tenantId
      const inT = (x) => (x.tenantId || 't-star') === tid
      const recordsT = this.records.filter(inT)
      const flowsAllT = this.pointRecords.filter(inT)
      const ordersT = this.riskOrders.filter(inT)
      const afterSalesT = this.afterSales.filter(inT)
      const claimsT = this.taskClaims.filter(inT)
      const stockAdjT = this.stockAdjustments.filter(inT)
      const inboundT = this.inboundBatches.filter(inT)
      const posT = this.purchaseOrders.filter(inT)
      const acceptDiffsT = this.acceptDiffs.filter(inT)
      const supplierBillsT = this.supplierBills.filter(inT)
      const couponsT = this.coupons.filter(inT)
      const actsT = this.activities.filter((a) => a.tenantId === tid)
      const goodsT = this.goods.filter((g) => (g.tenantId || 't-star') === tid)
      const flowsOn = (d) => flowsAllT.filter((p) => this._flowBizDate(p) === d)
      const isComp = (p) => p.kind === 'recon-comp' || p.kind === 'task-comp'
      const dayFlows = flowsOn(date)

      // —— P1 积分发生额 ——
      // 业务侧逐笔推导应有流水（同日同额合成明细，供差异单展示勾稽过程）
      const expectedDetail = []
      let expectedNet = 0
      const pushExpect = (delta, label, effDate) => {
        if (effDate !== date) return
        expectedNet += delta
        expectedDetail.push({ delta, label })
      }
      recordsT.forEach((r) => {
        if (r.type === 'draw') {
          // 成本：落账即扣（正常/冻结/撤销都曾扣减），撤销返还按审核日另计
          const cost = this._drawCostOf(r)
          if (cost) pushExpect(-cost, `抽奖成本：${r.activityName}`, r.date)
          // 中奖积分：正常按参与日入账；放行按审核日入账；撤销/冻结中无
          const prize = this._drawPrizePoints(r)
          if (prize && r.status === 'normal') pushExpect(prize, `抽奖中奖：${r.prizeName}`, r.date)
          // 放行发奖流水归属原参与业务日（实际发放日见流水 date，跨日不串当日净额）
          if (prize && r.status === 'released') pushExpect(prize, `审核放行发奖：${r.prizeName}（${this._reviewDate(this._orderOfRecord(r.id))} 入账）`, r.date)
          // 撤销返还冻结成本（按审核日）
          if (r.status === 'revoked') {
            const o = this._orderOfRecord(r.id)
            if (o?.frozenPoints) pushExpect(o.frozenPoints, '撤销返还：抽奖冻结积分', this._reviewDate(o))
          }
        } else if (r.type === 'redeem') {
          const g = goodsT.find((x) => x.id === r.goodsId)
          const cost = g?.cost || 0
          if (cost) pushExpect(-cost, `兑换扣减：${r.goodsName}`, r.date)
          if (r.status === 'revoked') {
            const o = this._orderOfRecord(r.id)
            if (o?.frozenPoints) pushExpect(o.frozenPoints, '撤销返还：兑换冻结积分', this._reviewDate(o))
          }
        }
      })
      // 手动任务奖励：以 reward 类"完成任务"流水为业务凭证（补记的 task-comp 补偿流不计入应有发生额）
      dayFlows.forEach((p) => {
        if (!isComp(p) && p.kind === 'reward' && p.note.startsWith('完成任务：')) {
          expectedNet += p.delta
          expectedDetail.push({ delta: p.delta, label: p.note })
        }
      })
      // 抽奖任务台账：归属业务日为 bizDate（跨日补计计入原业务日，不串审核当日账）；
      // 实际发放日 grantDate 记录在台账与流水上。缺记台账无流水，体现为 P1 残差由 P2 逐笔列出。
      claimsT.forEach((c) => {
        if (c.bizDate === date) {
          expectedNet += c.reward
          expectedDetail.push({
            delta: c.reward,
            label: `任务结算：${c.taskLabel}${c.grantDate !== c.bizDate ? `（${c.grantDate} 跨日补计）` : ''}`
          })
        }
      })
      // 售后退款：已完成的拒收/退货按审核日返还积分（补发不退款）；退款流水 kind=refund 同日入账勾稽
      afterSalesT.forEach((a) => {
        if (a.status === 'done' && a.refundPoints > 0) {
          pushExpect(a.refundPoints, `售后退款：${a.typeLabel}【${a.targetName}】（${a.createdAt} 申请）`,
            (a.reviewedAt || '').slice(0, 10))
        }
      })

      const ledgerNet = dayFlows.filter((p) => !isComp(p)).reduce((s, p) => s + p.delta, 0)
      const compNet = dayFlows.filter(isComp).reduce((s, p) => s + p.delta, 0)
      const residual = expectedNet - ledgerNet - compNet

      // —— P2 任务奖励逐笔勾稽（按归属业务日 bizDate；跨日补计的流水带相同 bizDate） ——
      // 原始发奖流与 task-comp 补偿流统一按 task-claim 台账 id 判重；旧流水无 refId 时才按任务名兜底匹配。
      const usedFlowIds = new Set()
      const taskItems = claimsT
        .filter((c) => c.bizDate === date)
        .map((c) => {
          const flow = this._taskClaimFlow(c, usedFlowIds, tid)
          if (flow) { usedFlowIds.add(flow.id); return null }
          return {
            key: `task-${c.id}`, claimId: c.id, label: c.taskLabel, reward: c.reward,
            bizDate: c.bizDate, grantDate: c.grantDate, autoFixable: true
          }
        })
        .filter(Boolean)
      // P1 残差 = 应有净额 − 原始流水净额 − 已补偿净额；P2 缺笔是其中的逐笔明细
      const pointsResidual = residual

      // —— P3 余额链连续性（当前态安全网；按租户自己的流水窗口校验） ——
      // 多租户余额为平台钱包，其他租户流水会与本租户交错，因此以"本租户第一条流水之前的全局余额"
      // 作为起点重放本租户全部流水：快照逐笔连续即链路完好（可检出真实快照篡改/错行）。
      const sorted = [...flowsAllT].sort((a, b) => a.ts - b.ts)
      const sortedAll = [...this.pointRecords].sort((a, b) => a.ts - b.ts)
      const firstTs = sorted.length ? sorted[0].ts : Infinity
      const before = sortedAll.filter((p) => p.ts < firstTs).reduce((s, p) => s + p.delta, 0)
      let bal = this.points - sortedAll.reduce((s, p) => s + p.delta, 0) + before
      let brokenRows = 0
      let firstBad = null
      sorted.forEach((p) => {
        bal += p.delta
        if (p.balance !== bal) {
          brokenRows += 1
          if (!firstBad) firstBad = { id: p.id, expect: bal, actual: p.balance, note: p.note, date: p.date }
        }
      })
      const head = sorted[sorted.length - 1]
      const headBad = head && (() => {
        // 该租户最后一条流水之后若还有其他租户流水，则其快照不等于当前全局余额属正常；只校验自身窗口连续性
        const afterDelta = sortedAll.filter((p) => p.ts > head.ts).reduce((s, p) => s + p.delta, 0)
        return head.balance + afterDelta !== this.points
      })()
      const chainItem = (brokenRows > 0 || headBad) ? {
        brokenRows,
        firstBad,
        headBalance: head ? head.balance : null,
        pointsBalance: this.points,
        autoFixable: false   // 不直接改余额/快照；P1/P2 补偿使余额与流水同步后自愈
      } : null

      // —— P4 风控冻结单据一致性（当前态） ——
      const frozenItems = []
      const heldByTarget = new Map()
      ordersT.filter((o) => o.status === 'pending' || o.status === 'appealed').forEach((o) => {
        // 预占键：奖品按 活动id+奖品id（不同活动奖品 id 可能重复），商品按 goodsId
        const key = o.bizType === 'draw' ? `prize:${o.activityId}:${o.targetId}` : `goods:${o.targetId}`
        heldByTarget.set(key, (heldByTarget.get(key) || 0) + (o.stockHeld || 0))
        const rec = recordsT.find((r) => r.id === o.recordId)
        if (!rec || rec.status !== 'frozen') {
          frozenItems.push({ key: `order-status-${o.id}`, orderId: o.id, kind: 'order-status',
            target: o.targetName, expect: '业务记录冻结中', actual: rec ? rec.status : '记录缺失', autoFixable: false })
        }
        const expectCost = o.bizType === 'draw'
          ? (actsT.find((a) => a.id === o.activityId)?.costType === 'points'
              ? (actsT.find((a) => a.id === o.activityId)?.cost || 0) : 0)
          : (goodsT.find((g) => g.id === o.targetId)?.cost || 0)
        if ((o.frozenPoints || 0) !== expectCost) {
          frozenItems.push({ key: `order-points-${o.id}`, orderId: o.id, kind: 'order-points',
            target: o.targetName, expect: expectCost, actual: o.frozenPoints || 0, autoFixable: false })
        }
      })
      // 预占库存 vs 账面 frozen（key 形如 prize:act-1:p1 / goods:g1）
      const checkHeld = (key, name, book) => {
        const held = heldByTarget.get(key) || 0
        if (held !== (book || 0)) {
          frozenItems.push({ key: `held-${key}`, kind: 'stock-held',
            target: name, expect: held, actual: book || 0, autoFixable: false })
        }
      }
      actsT.forEach((a) => a.prizes.forEach((p) => {
        if (p.rarity !== 'none') checkHeld(`prize:${a.id}:${p.id}`, `${a.name} / ${p.name}`, p.frozen)
      }))
      goodsT.forEach((g) => checkHeld(`goods:${g.id}`, g.name, g.frozen))

      // —— P5 库存账实（当前态；应有 = 初始库存 + 采购入库 - 有效消耗 + 已校正） ——
      // 有效消耗含售后修正：已完成的拒收/退货回补库存（消耗 -1），已完成的补发再消耗（+1）
      // 采购入库按验收批次实收累加（验收入库同步抬升 stock 账面总量，P5 以批次凭证为准勾稽）
      const consumedAllOf = (test) => recordsT.filter((r) => r.status !== 'revoked' && test(r)).length
      const doneAfterSales = afterSalesT.filter((a) => a.status === 'done')
      const afterSaleOf = (targetType, activityId, targetId) => {
        const hit = doneAfterSales.filter((a) => a.targetType === targetType &&
          a.targetId === targetId && (targetType !== 'prize' || a.activityId === activityId))
        return {
          returned: hit.filter((a) => a.type === 'reject' || a.type === 'return').length,
          reshipped: hit.filter((a) => a.type === 'reship').length
        }
      }
      const inboundOf = (targetType, activityId, targetId) =>
        inboundT.filter((b) => b.targetType === targetType && b.targetId === targetId &&
          (targetType !== 'prize' || b.activityId === activityId))
          .reduce((n, b) => n + (b.qty || 0), 0)
      const stockItems = []
      const pushStock = (targetType, activityId, id, name, icon, item) => {
        const isPrize = targetType === 'prize'
        const heldKey = isPrize ? `prize:${activityId}:${id}` : `goods:${id}`
        const consumedBase = isPrize
          ? consumedAllOf((r) => r.type === 'draw' && r.activityId === activityId && r.prizeId === id)
          : consumedAllOf((r) => r.type === 'redeem' && r.goodsId === id)
        const asFix = afterSaleOf(targetType, activityId, id)
        const consumed = consumedBase - asFix.returned + asFix.reshipped
        const adjusted = stockAdjT
          .filter((x) => x.targetType === targetType && x.targetKey === heldKey)
          .reduce((s, x) => s + x.delta, 0)
        const purchased = inboundOf(targetType, activityId, id)
        // stock 账面总量已随验收批次抬升（审批不预抬、驳回/撤销不动账），故直接用当前 stock 勾稽
        const expected = item.stock - consumed + adjusted
        const diff = expected - item.remain
        // 当日消耗/回补（展示用）：有效消耗按业务日，撤销回补按审核日，售后退回/补发按售后审核日
        const dayConsumed = recordsT.filter(
          (r) => isPrize
            ? (r.type === 'draw' && r.activityId === activityId && r.prizeId === id)
            : (r.type === 'redeem' && r.goodsId === id)
        ).filter((r) => {
          if (r.status === 'revoked') return this._reviewDate(this._orderOfRecord(r.id)) === date
          return r.date === date
        }).reduce((n, r) => n + (r.status === 'revoked' ? -1 : 1), 0)
        const dayAfterSale = doneAfterSales
          .filter((a) => a.targetType === targetType && a.targetId === id &&
            (targetType !== 'prize' || a.activityId === activityId) &&
            (a.reviewedAt || '').slice(0, 10) === date)
          .reduce((n, a) => n + (a.type === 'reship' ? 1 : -1), 0)
        // 当日采购验收入库（展示用，按验收批次业务日）
        const dayInbound = inboundT
          .filter((b) => b.targetType === targetType && b.targetId === id &&
            (targetType !== 'prize' || b.activityId === activityId) && b.date === date)
          .reduce((n, b) => n + (b.qty || 0), 0)
        if (diff !== 0 || dayConsumed !== 0 || dayAfterSale !== 0 || dayInbound !== 0) {
          // 供应商结算回写：该 SKU 已结算的验收批次量 / 其中售后补发占用 / 验退短少差异量
          const poOfTarget = posT.filter((o) => o.targetType === targetType && o.targetId === id &&
            (targetType !== 'prize' || o.activityId === activityId))
          const settledBills = supplierBillsT.filter((b) => b.status === 'settled' &&
            b.targetType === targetType && b.targetId === id &&
            (targetType !== 'prize' || b.activityId === activityId))
          const settledAccepted = settledBills.reduce((n, b) => n + (b.acceptedQty || 0), 0)
          const settledReship = settledBills.reduce((n, b) => n + (b.reshipQty || 0), 0)
          const settledBillsCount = settledBills.length
          stockItems.push({
            key: `stock-${heldKey}`, targetType, activityId, targetId: id, targetKey: heldKey,
            name, icon,
            stock: item.stock, initialStock: item.stock - purchased,
            purchased, consumed, adjusted, expected, actual: item.remain,
            diff, dayConsumed: dayConsumed + dayAfterSale, dayInbound,
            asReturned: asFix.returned, asReshipped: asFix.reshipped,
            poCount: poOfTarget.length,
            settledPoCount: poOfTarget.filter((o) => o.settledBillId).length,
            settledAccepted, settledReship, settledBillsCount,
            frozenHeld: heldByTarget.get(heldKey) || 0, frozenBook: item.frozen || 0,
            autoFixable: diff !== 0
          })
        }
      }
      actsT.forEach((a) => a.prizes.forEach((p) => {
        if (p.rarity !== 'none') pushStock('prize', a.id, p.id, `${a.name} / ${p.name}`, p.emoji, p)
      }))
      goodsT.forEach((g) => pushStock('goods', null, g.id, g.name, g.icon, g))

      // —— P6 卡券账户勾稽（按业务日发券 + 当前态） ——
      // 1) 有效券业务记录（normal/released 且 couponId）当日必须有券实例；撤销/冻结不得有券（漏发可补券）
      // 2) 券实例必须能回指一条有效业务记录（孤立券人工核查，不自动作废）
      // 3) 券码在租户内唯一（不同租户前缀业务隔离，重复码仅按租户内比对）
      // 4) 已核销券必须有核销人/核销时间；已过期但仍可用的券为到期未流转（可自动修复）
      const couponItems = []
      // 1) 漏发：按业务记录
      recordsT
        .filter((r) => r.couponId && (r.status === 'normal' || r.status === 'released') &&
          (r.status === 'released' ? this._reviewDate(this._orderOfRecord(r.id)) === date : r.date === date))
        .forEach((r) => {
          const c = couponsT.find((x) => x.recordId === r.id)
          if (!c) {
            couponItems.push({
              key: `cp-missing-${r.id}`, kind: 'missing', recordId: r.id,
              target: r.type === 'draw' ? r.prizeName : r.goodsName,
              tplId: r.couponId, bizType: r.type,
              expect: '有效业务记录应发券', actual: '券账户无实例', autoFixable: true
            })
          }
        })
      // 2) 孤立券 / 3) 重复码 / 4) 核销信息缺失、到期未流转（当前态，仅计入当日单避免每日重复列示）
      if (date === this.todayDate) {
        couponsT.forEach((c) => {
          const rec = recordsT.find((r) => r.id === c.recordId)
          if (!rec || rec.status === 'revoked' || rec.status === 'frozen') {
            couponItems.push({
              key: `cp-orphan-${c.id}`, kind: 'orphan', couponId: c.id, code: c.code,
              target: c.name, expect: '券应回指有效业务记录',
              actual: !rec ? '业务记录缺失' : `业务记录状态 ${rec.status}`, autoFixable: false
            })
          }
          if (c.status === 'redeemed' && (!c.redeemedAt || !c.redeemOperator)) {
            couponItems.push({
              key: `cp-redeem-${c.id}`, kind: 'redeem-info', couponId: c.id, code: c.code,
              target: c.name, expect: '已核销应有核销人/时间', actual: '核销信息不完整', autoFixable: false
            })
          }
        })
        const codeMap = new Map()
        couponsT.forEach((c) => {
          const k = this._normCode(c.code)
          if (!codeMap.has(k)) codeMap.set(k, [])
          codeMap.get(k).push(c)
        })
        codeMap.forEach((list, k) => {
          if (k && list.length > 1) {
            couponItems.push({
              key: `cp-dup-${k}`, kind: 'duplicate', code: k, target: list[0].name,
              expect: '租户内券码唯一', actual: `${list.length} 张券同码`, autoFixable: false
            })
          }
        })
        // 到期未流转：券状态仍 available 但已过到期时刻（正常应由 sweepCouponExpiry 自动处理）
        const now = Date.now()
        couponsT.filter((c) => c.status === 'available' && c.expireTs < now).forEach((c) => {
          couponItems.push({
            key: `cp-expire-${c.id}`, kind: 'expired-pending', couponId: c.id, code: c.code,
            target: c.name, expect: `已于 ${c.expireDate} 到期`, actual: '账户仍标记待核销', autoFixable: true
          })
        })
      }

      const taskOpen = taskItems.length
      const stockOpen = stockItems.filter((x) => x.diff !== 0).length
      const couponOpen = couponItems.length
      const openCount = (pointsResidual !== 0 ? 1 : 0) + taskOpen + (chainItem ? 1 : 0) +
        frozenItems.length + stockOpen + couponOpen

      // —— P7 采购结算闭环（供应商账单 / 验收差异 / 售后补发回写）——
      // 独立闭环口径：未闭环项不计入 P1–P6 的 openCount（不影响积分库存对账平账），
      // 由供应商结算工作台按 computeSupplierRecon() 处理；此处仅在差异单中留痕展示勾稽快照。
      const purchase = this.computeSupplierRecon(tid)

      return {
        date,
        tenantId: tid,
        generatedAt: Date.now(),
        points: { expectedNet, ledgerNet, compNet, residual: pointsResidual, autoFixable: pointsResidual > 0, detail: expectedDetail },
        tasks: taskItems,
        chain: chainItem,
        frozen: frozenItems,
        stock: stockItems,
        coupons: couponItems,
        purchase,
        openCount
      }
    },

    // 差异指纹（残差/缺笔/不一致项完全相同即同一版本，重复执行幂等）
    _reconSignature(d) {
      return JSON.stringify({
        p: d.points.residual,
        t: d.tasks.map((x) => x.claimId).sort(),
        c: d.chain ? 1 : 0,
        f: d.frozen.map((x) => `${x.key}:${x.expect}/${x.actual}`),
        s: d.stock.filter((x) => x.diff !== 0).map((x) => `${x.targetType}:${x.targetId}:${x.diff}`),
        cp: (d.coupons || []).map((x) => `${x.key}`).sort()
      })
    },

    // 执行对账（一租户一业务日一张单；历史日不触发业务日切换/兜底结算）
    runRecon(date, silent = false, tenantId = this.activeTenantId) {
      if ((date === this.todayDate || !date) && tenantId === this.activeTenantId) this.syncBusinessDay()
      const d = date || this.todayDate
      const tid = tenantId
      const trace = this.beginTrace()
      const diffs = this.computeReconDiffs(d, tid)
      const signature = this._reconSignature(diffs)
      let bill = this.reconBills.find((b) => b.date === d && (b.tenantId || 't-star') === tid)
      const runAt = { at: `${this.todayDate} ${nowTime()}`, ts: Date.now(),
        operator: this.actorName(),
        openCount: diffs.openCount, balanced: diffs.openCount === 0 }

      if (!bill) {
        bill = {
          id: genId('rc'), date: d, tenantId: tid,
          status: diffs.openCount === 0 ? 'balanced' : 'pending',
          signature, diffs,
          runs: [runAt], compensations: [],
          firstAt: runAt.at, reviewedAt: '', reviewer: '', reviewNote: '',
          createdAt: this.todayDate
        }
        this.reconBills.unshift(bill)
      } else {
        const sameVersion = bill.signature === signature
        bill.diffs = diffs
        bill.signature = signature
        bill.runs.unshift(runAt)
        if (bill.runs.length > 50) bill.runs.pop()
        if (!sameVersion) {
          // 业务有变化导致残差改变：已平→待复核；曾经的复核/补偿结论保留在 reviewedAt/compensations
          if (diffs.openCount === 0) bill.status = bill.compensations.length ? 'compensated' : 'balanced'
          else bill.status = 'pending'
        }
        // 同版本但当前已平：已补偿单保持"已补偿平账"（重复执行幂等，不回退状态）
        if (sameVersion && diffs.openCount === 0 && bill.compensations.length && bill.status !== 'compensated') {
          bill.status = 'compensated'
        }
      }

      this.addAuditLog('recon-run', bill.id,
        diffs.openCount === 0
          ? `【${this.tenants.find((t) => t.id === tid)?.shortName || tid}】业务日 ${d} 对账完成：账实相符，无差异（积分应有净额 ${diffs.points.expectedNet}，流水净额 ${diffs.points.ledgerNet}）`
          : `【${this.tenants.find((t) => t.id === tid)?.shortName || tid}】业务日 ${d} 对账完成：发现 ${diffs.openCount} 项未平差异（积分残差 ${diffs.points.residual}、任务缺记 ${diffs.tasks.length} 笔、库存 ${diffs.stock.filter((x) => x.diff).length} SKU、卡券 ${diffs.coupons.length} 项、冻结 ${diffs.frozen.length} 项${diffs.chain ? '、余额链断裂' : ''}）`,
        { module: 'recon', tenantId: tid, traceId: trace })
      if (!silent) {
        if (diffs.openCount === 0) this.showToast(`🧮 ${d} 对账完成：账实相符`, 'success')
        else this.showToast(`🧮 ${d} 对账完成：${diffs.openCount} 项差异待运营复核`, 'warn')
        this.endTrace()
      }
      return bill
    },

    // 运营复核差异单（RBAC：recon:review；仅本租户；不改动任何账目）
    reviewRecon(date, note = '', tenantId = this.activeTenantId) {
      const tid = tenantId
      const trace = this.beginTrace()
      if (!this.requirePerm('recon:review', 'recon') || !this.requireSameTenant(tid, 'recon')) {
        this.endTrace()
        return false
      }
      const bill = this.reconBills.find((b) => b.date === date && (b.tenantId || 't-star') === tid)
      if (!bill) { this.showToast('请先执行对账', 'warn'); this.endTrace(); return false }
      if (bill.diffs.openCount === 0) { this.showToast('该业务日账实相符，无需复核', 'info'); this.endTrace(); return false }
      bill.status = 'reviewed'
      bill.reviewedAt = `${this.todayDate} ${nowTime()}`
      bill.reviewer = this.user.name
      bill.reviewNote = note.trim()
      this.addAuditLog('recon-review', bill.id,
        `复核业务日 ${date} 的对账差异：${note.trim() || '确认差异属实，待补偿修正'}（原始记录保留，仅允许追加补偿流水）`,
        { module: 'recon', tenantId: tid, traceId: trace })
      this.showToast(`已复核 ${date} 差异单，可执行补偿修正`, 'success')
      this.endTrace()
      return true
    },

    // 复核通过后补偿：只追加补偿流水/库存校正，同步余额、库存；重复执行对已平项幂等跳过（RBAC：recon:compensate）
    compensateRecon(date, note = '', tenantId = this.activeTenantId) {
      const tid = tenantId
      const trace = this.beginTrace()
      if (!this.requirePerm('recon:compensate', 'recon') || !this.requireSameTenant(tid, 'recon')) {
        this.endTrace()
        return null
      }
      const bill0 = this.reconBills.find((b) => b.date === date && (b.tenantId || 't-star') === tid)
      if (!bill0 || bill0.status === 'pending') { this.showToast('请先完成差异复核，再执行补偿', 'warn'); this.endTrace(); return null }
      if (bill0.status === 'balanced' && !bill0.diffs.openCount) { this.showToast('该业务日账实相符，无需补偿', 'info'); this.endTrace(); return null }
      // 以最新账实重新推导（防止复核后业务又有变化导致错补）
      const live = this.computeReconDiffs(date, tid)
      const actions = []

      // 1) 任务奖励逐笔补记（余额与流水同步追加，保留原始记录）
      live.tasks.forEach((item) => {
        const claim = this.taskClaims.find((c) => c.id === item.claimId)
        if (!claim || this._taskClaimFlow(claim, new Set(), tid)) return // 台账→流水统一判重
        this.points += item.reward
        const cross = item.grantDate !== item.bizDate ? `（归属 ${item.bizDate} 跨日补计）` : ''
        this.addPointRecord(item.reward, `对账补偿：任务奖励补记【${item.label}】${cross}`, 'task-comp', {
          bizDate: item.bizDate, refId: item.claimId, refType: 'task-claim', tenantId: tid, traceId: trace
        })
        actions.push({ type: 'task', label: item.label, delta: item.reward })
      })

      // 2) 积分净额残差（>0 业务真实、流水少记 → 补流水并同步余额；<0 为长款/多记，需人工核查不自动扣减）
      const live2 = this.computeReconDiffs(date, tid)
      const pr = live2.points.residual
      if (pr > 0) {
        this.points += pr
        this.addPointRecord(pr, `对账补偿：${date} 积分净额差异（业务流水少记，按差异单补记）`, 'recon-comp', {
          bizDate: date, refId: bill0.id, refType: 'recon-bill', tenantId: tid, traceId: trace
        })
        actions.push({ type: 'points', label: '积分净额残差', delta: pr })
      }
      const manualPoints = pr < 0 ? Math.abs(pr) : 0

      // 3) 库存校正：账实差异以调整凭证把"账面应有"对齐实物（盘亏记 -1、盘盈记 +1），
      //    不凭空回补/扣减实物；追加 append-only 库存校正台账
      live2.stock.filter((x) => x.diff !== 0).forEach((x) => {
        const target = x.targetType === 'prize'
          ? this.activities.find((a) => a.id === x.activityId)?.prizes.find((p) => p.id === x.targetId)
          : this.goods.find((g) => g.id === x.targetId)
        if (!target) return
        const before = target.remain
        // 注入一笔 -diff 的账存调整凭证：expected = stock - consumed + adjusted = actual
        this.stockAdjustments.unshift({
          id: genId('sa'), billId: bill0.id, bizDate: date,
          tenantId: tid, traceId: trace,
          date: this.todayDate, time: nowTime(), ts: Date.now(),
          targetType: x.targetType, targetId: x.targetId, targetKey: x.targetKey,
          activityId: x.activityId || null, targetName: x.name,
          delta: -x.diff, before, after: before,
          reason: note.trim() || (x.diff > 0
            ? '对账差异补偿：实物盘亏，按差异单登记库存调整（账面核销）'
            : '对账差异补偿：实物盘盈，按差异单登记库存调整（账面补登）'),
          operator: this.user.name
        })
        actions.push({ type: 'stock', label: x.name, delta: -x.diff })
      })

      // 4) 卡券账户补偿（P6）：
      //    漏发券：按有效业务记录补发新券（新券码、有效期自补券日起算，append-only 不伪造历史），按 recordId 幂等；
      //    到期未流转：执行到期扫描置为 expired；
      //    孤立券/重复码/核销信息缺失：人工核查，不自动作废、不改写。
      let couponIssued = 0
      let couponExpiredFixed = 0
      let couponManual = 0
      live2.coupons.forEach((x) => {
        if (x.kind === 'missing') {
          const rec = this.records.find((r) => r.id === x.recordId)
          if (!rec || this.coupons.some((c) => c.recordId === rec.id)) return
          const c = this.issueCouponForRecord(rec, { source: '对账补券', compensateBillId: bill0.id })
          if (c) {
            // 补券台账标记为 comp（issueCouponForRecord 默认按来源写 issue/deliver，这里补一条补偿凭证勾稽差异单）
            this.addCouponLog('comp', c.id, rec, { code: c.code, note: `按 ${date} 差异单补发，有效期自补券日起算`, tenantId: tid, traceId: trace })
            this.addAuditLog('coupon-comp', bill0.id,
              `对账补偿：业务记录【${x.target}】券账户漏发，补发新券 ${c.code}（有效期至 ${c.expireDate}，原始记录保留）`,
              { module: 'recon', tenantId: tid, traceId: trace })
            actions.push({ type: 'coupon', label: x.target, delta: 1, code: c.code })
            couponIssued += 1
          }
        } else if (x.kind === 'expired-pending') {
          const c = this.coupons.find((y) => y.id === x.couponId)
          if (c && c.status === 'available' && c.expireTs < Date.now()) {
            c.status = 'expired'
            const rec = this.records.find((r) => r.id === c.recordId) || null
            this.addCouponLog('expire', c.id, rec, { code: c.code, note: `按 ${date} 差异单补做到期流转`, tenantId: tid, traceId: trace })
            actions.push({ type: 'coupon-expire', label: x.target, delta: 0, code: c.code })
            couponExpiredFixed += 1
          }
        } else {
          couponManual += 1
        }
      })

      if (!actions.length && !manualPoints && !couponManual && !live2.chain && !live2.frozen.length) {
        this.showToast('账目已平，无需重复补偿', 'info')
        this.endTrace()
        return null
      }

      const pointDelta = actions.filter((a) => a.type !== 'stock' && a.type !== 'coupon' && a.type !== 'coupon-expire')
        .reduce((s, a) => s + a.delta, 0)
      const stockCount = actions.filter((a) => a.type === 'stock').length
      const couponCount = couponIssued
      if (actions.length) {
        bill0.compensations.unshift({
          id: genId('rcc'), at: `${this.todayDate} ${nowTime()}`,
          pointDelta, stockCount, couponCount, note: note.trim(), reviewer: this.user.name,
          items: actions.map((a) => ({ ...a }))
        })
      }
      this.addAuditLog('recon-comp', bill0.id,
        `补偿业务日 ${date} 差异：` +
        actions.map((a) => {
          if (a.type === 'stock') return `库存【${a.label}】校正 ${a.delta > 0 ? '+' : ''}${a.delta}`
          if (a.type === 'coupon') return `卡券【${a.label}】补发新券 ${a.code}`
          if (a.type === 'coupon-expire') return `卡券【${a.label}】补做到期失效`
          return `【${a.label}】补记 +${a.delta} 积分`
        }).join('；') +
        (manualPoints ? `；另有积分长款 ${manualPoints}（流水多记/来源不明），已标记需人工核查，未自动扣减` : '') +
        (couponManual ? `；另有 ${couponManual} 项卡券异常（孤立券/重复码/核销信息缺失）需人工核查，未自动处理` : '') +
        (live2.frozen.length ? `；${live2.frozen.length} 项冻结单据不一致需在风控申诉中处理` : '') +
        (note.trim() ? `；备注：${note.trim()}` : '') + '；原始记录保留未改写',
        { module: 'recon', tenantId: tid, traceId: trace })

      // 重新对账刷新差异单（补偿流水/校正参与勾稽；P3 余额链随余额同步自愈）
      const refreshed = this.runRecon(date, true, tid)
      if (refreshed.diffs.openCount === 0) bill0.status = 'compensated'
      else bill0.status = 'reviewed' // 仍有长款/冻结类等需人工处理的差异

      const parts = []
      if (pointDelta) parts.push(`补记积分 +${pointDelta}`)
      if (stockCount) parts.push(`校正 ${stockCount} 项库存`)
      if (couponCount) parts.push(`补发 ${couponCount} 张卡券`)
      if (couponExpiredFixed) parts.push(`${couponExpiredFixed} 张卡券补做到期`)
      this.showToast(parts.length ? `🧮 补偿完成：${parts.join('，')}，余额/库存/卡券已同步` : '🧮 补偿已记录，剩余差异需人工处理',
        refreshed.diffs.openCount === 0 ? 'success' : 'warn')
      this.endTrace()
      return { pointDelta, stockCount, couponCount, couponExpiredFixed, manualPoints, couponManual, actions }
    },

    // ===== 演示用：注入账实差异（模拟漏记/盘亏，便于观察对账→复核→补偿闭环） =====
    // 仅制造"业务凭证存在、账目少记/实物缺失"，原始业务与库存规则保持完整，对账应能逐项检出
    injectTaskFlowGap() {
      // 模拟：一笔任务领奖台账已落、积分与流水却漏记（余额未加）→ P1 净额 + P2 台账缺笔
      this.syncBusinessDay()
      const d = this.todayDate
      const tid = this.activeTenantId
      const marker = `inject-gap-${tid}-${d}`
      if (this.taskClaims.some((c) => c.id === marker)) {
        this.showToast('今日已注入过漏记差异，请勿重复注入', 'warn')
        return
      }
      this.taskClaims.push({
        id: marker, taskId: 't-checkin', taskLabel: '每日签到（漏记演示）', reward: 30,
        tenantId: tid,
        bizDate: d, grantDate: d, time: nowTime(), ts: Date.now(), source: 'manual-gap'
      })
      this.addAuditLog('recon-inject', null,
        `【演示注入】${d} 一笔 30 积分任务奖励台账已落但积分与流水漏记，等待对账检出`,
        { module: 'recon', tenantId: tid })
      this.showToast('🔧 已注入演示差异：30 积分任务奖励漏记（台账在、账目少）', 'warn')
    },
    injectStockLoss() {
      // 模拟：商品实物盘亏 1 件（实物 remain 少 1，业务消耗记录不变）
      this.syncBusinessDay()
      const tid = this.activeTenantId
      const g = this.goods.find((x) => x.id === 'g1' && (x.tenantId || 't-star') === tid)
      if (!g || g.remain <= 0) { this.showToast('当前租户 g1 库存不足，无法注入盘亏', 'warn'); return }
      g.remain -= 1
      const d = this.todayDate
      this.addAuditLog('recon-inject', null,
        `【演示注入】${d} 商品【${g.name}】实物盘亏 1 件（业务记录完整、实物账少 1），等待对账检出`,
        { module: 'recon', tenantId: tid })
      this.showToast('🔧 已注入演示差异：满50减10优惠券盘亏 1 件', 'warn')
    },

    // ===== 活动运营管理（RBAC：activity:manage；仅本租户活动） =====
    toggleActivityStatus(id) {
      const trace = this.beginTrace()
      const a = this.activities.find((x) => x.id === id)
      if (!a) { this.endTrace(); return }
      if (!this.requirePerm('activity:manage', 'activity') || !this.requireSameTenant(a.tenantId, 'activity')) {
        this.endTrace(); return
      }
      const map = { running: 'paused', paused: 'running', ended: 'running' }
      a.status = map[a.status]
      this.addAuditLog('activity-toggle', a.id,
        `活动【${a.name}】状态变更为${a.status === 'running' ? '运行中' : a.status === 'paused' ? '已暂停' : '已结束'}`,
        { module: 'activity', tenantId: a.tenantId, traceId: trace })
      this.showToast(`活动【${a.name}】已${a.status === 'running' ? '恢复/启动' : a.status === 'paused' ? '暂停' : '结束'}`, 'info')
      this.endTrace()
    },
    resetActivityStock(id) {
      const trace = this.beginTrace()
      const a = this.activities.find((x) => x.id === id)
      if (!a) { this.endTrace(); return }
      if (!this.requirePerm('activity:manage', 'activity') || !this.requireSameTenant(a.tenantId, 'activity')) {
        this.endTrace(); return
      }
      // 重置时不动审核中预占的库存：remain 恢复为 总库存 - 冻结预占
      a.prizes.forEach((p) => { p.remain = p.stock - (p.frozen || 0) })
      this.addAuditLog('activity-stock-reset', a.id, `活动【${a.name}】奖品库存重置（风控预占保留）`,
        { module: 'activity', tenantId: a.tenantId, traceId: trace })
      this.showToast(`活动【${a.name}】奖品库存已恢复（风控预占保留）`, 'success')
      this.endTrace()
    },
    deleteActivity(id) {
      const trace = this.beginTrace()
      const a = this.activities.find((x) => x.id === id)
      if (!a) { this.endTrace(); return false }
      if (!this.requirePerm('activity:manage', 'activity') || !this.requireSameTenant(a.tenantId, 'activity')) {
        this.endTrace(); return false
      }
      this.activities = this.activities.filter((x) => x.id !== id)
      this.addAuditLog('activity-delete', id, `删除活动【${a.name}】（配置删除，历史业务记录保留）`,
        { module: 'activity', tenantId: a.tenantId, traceId: trace })
      this.showToast(`活动【${a.name}】已删除`, 'info')
      this.endTrace()
      return true
    },
    createActivity(payload) {
      const trace = this.beginTrace()
      if (!this.requirePerm('activity:manage', 'activity')) { this.endTrace(); return null }
      const tid = this.activeTenantId
      const id = 'act-' + Date.now().toString().slice(-5)
      const act = {
        id,
        tenantId: tid,
        name: payload.name,
        type: payload.type,
        status: 'running',
        cost: payload.cost || 0,
        costType: payload.costType || 'free',
        dailyLimit: payload.dailyLimit || 3,
        totalLimit: payload.totalLimit || 50,
        icon: '🎪',
        desc: payload.desc || '新活动',
        startAt: payload.startAt || this.todayDate,
        endAt: payload.endAt || this.todayDate,
        prizes: (payload.prizes || []).map((p, i) => ({
          id: 'p' + i + '-' + id,
          name: p.name,
          rarity: p.rarity || 'common',
          stock: p.stock || 10,
          remain: p.stock || 10,
          frozen: 0,
          weight: p.weight || 10,
          // 实物/虚拟：显式指定优先，兜底按奖品名（含"积分"视为虚拟积分奖品）
          physical: p.physical !== undefined ? !!p.physical : !p.name.includes('积分'),
          emoji: p.emoji || '🎁'
        }))
      }
      // 确保含"谢谢参与"
      if (!act.prizes.some((p) => p.rarity === 'none')) {
        act.prizes.push({ id: 'p-none-' + id, name: '谢谢参与', rarity: 'none', stock: 99999, remain: 99999, frozen: 0, weight: 100, emoji: '🤝' })
      }
      this.activities.unshift(act)
      this.addAuditLog('activity-create', act.id,
        `【${this.activeTenant.shortName}】新建活动【${act.name}】（${payload.type === 'wheel' ? '幸运转盘' : '刮刮乐'}，${act.prizes.length} 个奖品）`,
        { module: 'activity', tenantId: tid, traceId: trace })
      this.showToast(`活动【${act.name}】创建成功`, 'success')
      this.endTrace()
      return act
    },

    // ===== 组织成员管理（RBAC：org:member；仅本租户） =====
    createMember(form) {
      const trace = this.beginTrace()
      if (!this.requirePerm('org:member', 'org')) { this.endTrace(); return null }
      const tid = form.tenantId || this.activeTenantId
      if (!this.requireSameTenant(tid, 'org')) { this.endTrace(); return null }
      const name = (form.name || '').trim()
      if (!name) { this.showToast('请填写成员姓名', 'warn'); this.endTrace(); return null }
      if (!this.roleOfKey(form.roleKey)) { this.showToast('请选择有效角色', 'warn'); this.endTrace(); return null }
      const member = {
        id: genId('m'),
        tenantId: tid,
        name,
        avatar: form.avatar || '🧑‍💼',
        roleKey: form.roleKey,
        status: 'active',
        phone: (form.phone || '').trim(),
        email: (form.email || '').trim(),
        ip: `10.${10 + Math.floor(Math.random() * 240)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`,
        joinedAt: this.todayDate,
        lastLoginAt: ''
      }
      this.members.push(member)
      this.addAuditLog('member-create', member.id,
        `新增成员【${name}】角色「${this.roleLabelOf(form.roleKey)}」归属 ${this.tenants.find((t) => t.id === tid)?.shortName || tid}`,
        { module: 'org', tenantId: tid, traceId: trace })
      this.showToast(`成员【${name}】已创建`, 'success')
      this.endTrace()
      return member
    },
    updateMember(memberId, patch) {
      const trace = this.beginTrace()
      const m = this.members.find((x) => x.id === memberId)
      if (!m) { this.endTrace(); return false }
      if (!this.requirePerm('org:member', 'org') || !this.requireSameTenant(m.tenantId, 'org')) {
        this.endTrace(); return false
      }
      const before = { name: m.name, avatar: m.avatar, phone: m.phone, email: m.email }
      Object.assign(m, patch)
      const changes = Object.keys(patch).filter((k) => String(before[k] || '') !== String(patch[k] || ''))
      this.addAuditLog('member-update', m.id,
        `编辑成员【${m.name}】资料：${changes.map((k) => `${k}=${patch[k]}`).join('，') || '无变化'}`,
        { module: 'org', tenantId: m.tenantId, traceId: trace })
      this.showToast(`成员【${m.name}】资料已更新`, 'success')
      this.endTrace()
      return true
    },
    // 成员调岗（角色变更单独留痕，便于权限审计）
    assignMemberRole(memberId, roleKey) {
      const trace = this.beginTrace()
      const m = this.members.find((x) => x.id === memberId)
      if (!m) { this.endTrace(); return false }
      if (!this.requirePerm('org:member', 'org') || !this.requireSameTenant(m.tenantId, 'org')) {
        this.endTrace(); return false
      }
      if (!this.roleOfKey(roleKey) || roleKey === 'platform_admin') {
        this.showToast('角色无效或不可分配', 'warn'); this.endTrace(); return false
      }
      const from = this.roleLabelOf(m.roleKey)
      m.roleKey = roleKey
      this.addAuditLog('member-role', m.id,
        `成员【${m.name}】调岗：${from} → ${this.roleLabelOf(roleKey)}`,
        { module: 'org', tenantId: m.tenantId, traceId: trace })
      this.showToast(`【${m.name}】已调岗为「${this.roleLabelOf(roleKey)}」`, 'success')
      this.endTrace()
      return true
    },
    // 停用 / 启用成员（停用后登录与所有操作被拒绝并留痕；不允许停用自己）
    toggleMember(memberId, reason = '') {
      const trace = this.beginTrace()
      const m = this.members.find((x) => x.id === memberId)
      if (!m) { this.endTrace(); return false }
      if (!this.requirePerm('org:member', 'org') || !this.requireSameTenant(m.tenantId, 'org')) {
        this.endTrace(); return false
      }
      if (m.id === this.currentMemberId) {
        this.showToast('不能停用当前登录账号', 'warn'); this.endTrace(); return false
      }
      const toDisable = m.status === 'active'
      m.status = toDisable ? 'disabled' : 'active'
      if (toDisable) m.disabledReason = reason.trim() || '管理员手动停用'
      else m.disabledReason = ''
      this.addAuditLog('member-toggle', m.id,
        `${toDisable ? '停用' : '启用'}成员【${m.name}】${toDisable && reason.trim() ? '；原因：' + reason.trim() : ''}`,
        { module: 'org', tenantId: m.tenantId, traceId: trace, result: toDisable ? 'denied' : 'success' })
      this.showToast(`成员【${m.name}】已${toDisable ? '停用' : '启用'}`, toDisable ? 'warn' : 'success')
      this.endTrace()
      return true
    },

    // ===== 自定义角色（RBAC：org:role；仅本租户；内置角色不可改/删） =====
    createRole(form) {
      const trace = this.beginTrace()
      if (!this.requirePerm('org:role', 'org')) { this.endTrace(); return null }
      const tid = this.activeTenantId
      const name = (form.name || '').trim()
      if (!name) { this.showToast('请填写角色名称', 'warn'); this.endTrace(); return null }
      const role = {
        id: genId('cr'),
        tenantId: tid,
        key: 'cr_' + Date.now().toString(36),
        name,
        icon: form.icon || '🛠️',
        builtin: false,
        desc: (form.desc || '').trim() || '租户自定义角色',
        permissions: [...new Set(form.permissions || [])].filter((p) => p !== 'tenant:manage')
      }
      this.customRoles.push(role)
      this.addAuditLog('role-create', role.id,
        `【${this.activeTenant.shortName}】新建自定义角色【${name}】，权限 ${role.permissions.length} 项：${role.permissions.map((p) => PERMISSION_LABELS[p] || p).join('、') || '（空权限）'}`,
        { module: 'org', tenantId: tid, traceId: trace })
      this.showToast(`角色【${name}】已创建`, 'success')
      this.endTrace()
      return role
    },
    updateRolePermissions(roleId, permissions) {
      const trace = this.beginTrace()
      const role = this.customRoles.find((r) => r.id === roleId)
      if (!role) { this.endTrace(); return false }
      if (!this.requirePerm('org:role', 'org') || !this.requireSameTenant(role.tenantId, 'org')) {
        this.endTrace(); return false
      }
      const before = new Set(role.permissions)
      const next = [...new Set(permissions || [])].filter((p) => p !== 'tenant:manage')
      const added = next.filter((p) => !before.has(p))
      const removed = [...before].filter((p) => !next.includes(p))
      role.permissions = next
      this.addAuditLog('role-update', role.id,
        `角色【${role.name}】权限变更：新增 ${added.map((p) => PERMISSION_LABELS[p] || p).join('、') || '无'}；移除 ${removed.map((p) => PERMISSION_LABELS[p] || p).join('、') || '无'}`,
        { module: 'org', tenantId: role.tenantId, traceId: trace })
      this.showToast(`角色【${role.name}】权限已更新（即时生效）`, 'success')
      this.endTrace()
      return true
    },
    deleteRole(roleId) {
      const trace = this.beginTrace()
      const role = this.customRoles.find((r) => r.id === roleId)
      if (!role) { this.endTrace(); return false }
      if (!this.requirePerm('org:role', 'org') || !this.requireSameTenant(role.tenantId, 'org')) {
        this.endTrace(); return false
      }
      const inUse = this.members.some((m) => m.roleKey === role.key)
      if (inUse) { this.showToast(`角色【${role.name}】仍有成员使用，请先调岗`, 'warn'); this.endTrace(); return false }
      this.customRoles = this.customRoles.filter((r) => r.id !== roleId)
      this.addAuditLog('role-delete', roleId, `删除自定义角色【${role.name}】`,
        { module: 'org', tenantId: role.tenantId, traceId: trace })
      this.showToast(`角色【${role.name}】已删除`, 'info')
      this.endTrace()
      return true
    },

    // ===== 平台方：租户开通/停用/配置（RBAC：tenant:manage，仅平台超管） =====
    createTenant(form) {
      const trace = this.beginTrace()
      if (!this.requirePerm('tenant:manage', 'platform')) { this.endTrace(); return null }
      const name = (form.name || '').trim()
      if (!name) { this.showToast('请填写组织名称', 'warn'); this.endTrace(); return null }
      const id = 't-' + Date.now().toString(36)
      const tenant = {
        id,
        name,
        shortName: (form.shortName || '').trim() || name,
        icon: form.icon || '🏢',
        plan: form.plan || '标准版',
        status: 'active',
        contact: (form.contact || '').trim(),
        phone: (form.phone || '').trim(),
        region: (form.region || '').trim(),
        createdAt: this.todayDate,
        modules: ['抽奖活动', '积分中心', '风控申诉', '物流发货', '卡券核销', '积分库存对账'],
        dataIsolation: '强隔离：数据按 tenantId 物理标记，仅本租户成员与平台方可访问',
        remark: (form.remark || '').trim()
      }
      this.tenants.push(tenant)
      // 新租户持有独立的默认风控规则副本（配置互不影响）
      this.riskRulesByTenant[id] = makeDefaultRiskRules()
      // 开通即创建组织管理员账号
      const admin = {
        id: genId('m'), tenantId: id, name: form.contact || tenant.shortName + '管理员', avatar: '👑',
        roleKey: 'org_admin', status: 'active', phone: form.phone || '', email: '',
        ip: '10.0.0.1', joinedAt: this.todayDate, lastLoginAt: ''
      }
      this.members.push(admin)
      this.addAuditLog('tenant-create', id,
        `平台开通租户【${tenant.shortName}】（${tenant.plan}），联系人 ${admin.name}，数据强隔离生效`,
        { module: 'platform', tenantId: id, traceId: trace })
      this.showToast(`租户【${tenant.shortName}】已开通`, 'success')
      this.endTrace()
      return tenant
    },
    toggleTenant(tenantId, reason = '') {
      const trace = this.beginTrace()
      if (!this.requirePerm('tenant:manage', 'platform')) { this.endTrace(); return false }
      const t = this.tenants.find((x) => x.id === tenantId)
      if (!t) { this.endTrace(); return false }
      t.status = t.status === 'active' ? 'suspended' : 'active'
      this.addAuditLog('tenant-toggle', t.id,
        `平台${t.status === 'suspended' ? '停用' : '恢复启用'}租户【${t.shortName}】${reason.trim() ? '；原因：' + reason.trim() : ''}（停用后该租户成员登录被拒绝）`,
        { module: 'platform', tenantId: t.id, traceId: trace, result: t.status === 'suspended' ? 'denied' : 'success' })
      this.showToast(`租户【${t.shortName}】已${t.status === 'suspended' ? '停用' : '恢复启用'}`, t.status === 'suspended' ? 'warn' : 'success')
      this.endTrace()
      return true
    },
    updateTenant(tenantId, patch) {
      const trace = this.beginTrace()
      if (!this.requirePerm('tenant:manage', 'platform')) { this.endTrace(); return false }
      const t = this.tenants.find((x) => x.id === tenantId)
      if (!t) { this.endTrace(); return false }
      Object.assign(t, patch)
      this.addAuditLog('tenant-update', t.id, `租户【${t.shortName}】配置变更：${Object.keys(patch).join('、')}`,
        { module: 'platform', tenantId: t.id, traceId: trace })
      this.showToast(`租户【${t.shortName}】配置已更新`, 'success')
      this.endTrace()
      return true
    },

    // ===== 演示数据：预置审核单 / 冻结积分 / 预占库存 =====
    seedRiskData() {
      const uid = this.user.id
      const uname = this.user.name
      // —— 1) 待审核：传说大奖（10 积分成本 + 预占 iPhone） ——
      const a1 = this.activities.find((a) => a.id === 'act-1')
      const pLegend = a1?.prizes.find((p) => p.id === 'p1')
      if (pLegend) { pLegend.remain -= 1; pLegend.frozen += 1 }
      const rec1 = {
        id: 'seed-r1', type: 'draw', status: 'frozen',
        date: this.todayDate, time: '10:02:15', ts: todayAt(10, 2),
        activityId: 'act-1', activityName: '周年庆幸运转盘',
        prizeId: 'p1', prizeName: 'iPhone 16', rarity: 'legendary', icon: '📱',
        riskOrderId: 'seed-rk1'
      }
      this.records.push(rec1)
      this.riskOrders.push({
        id: 'seed-rk1', bizType: 'draw', status: 'pending', userId: uid, userName: uname,
        recordId: rec1.id, activityId: 'act-1', targetId: 'p1', targetName: 'iPhone 16',
        icon: '📱', rarity: 'legendary', frozenPoints: 0, stockHeld: 1,
        rules: [{ code: 'highValue', label: RULE_LABELS.highValue }],
        appealReason: '', appealAt: '', reviewNote: '', reviewer: '',
        createdAt: this.todayDate, time: '10:02:15', ts: todayAt(10, 2), reviewedAt: ''
      })

      // —— 2) 已申诉：刮刮乐史诗（10 积分成本冻结 + 预占视频月卡） ——
      const a2 = this.activities.find((a) => a.id === 'act-2')
      const pEpic = a2?.prizes.find((p) => p.id === 'p2')
      if (pEpic) { pEpic.remain -= 1; pEpic.frozen += 1 }
      this.points -= 10
      const rec2 = {
        id: 'seed-r2', type: 'draw', status: 'frozen',
        date: this.todayDate, time: '09:40:08', ts: todayAt(9, 40),
        activityId: 'act-2', activityName: '新人刮刮乐',
        prizeId: 'p2', prizeName: '视频月卡', rarity: 'epic', couponId: 'c-video-month', icon: '🎬',
        riskOrderId: 'seed-rk2'
      }
      this.records.push(rec2)
      this.riskOrders.push({
        id: 'seed-rk2', bizType: 'draw', status: 'appealed', userId: uid, userName: uname,
        recordId: rec2.id, activityId: 'act-2', targetId: 'p2', targetName: '视频月卡',
        icon: '🎬', rarity: 'epic', frozenPoints: 10, stockHeld: 1,
        rules: [{ code: 'highValue', label: RULE_LABELS.highValue }],
        appealReason: '本人正常参与活动中奖，未使用任何外挂，请求放行。',
        appealAt: `${this.todayDate} 09:45:30`, reviewNote: '', reviewer: '',
        createdAt: this.todayDate, time: '09:40:08', ts: todayAt(9, 40), reviewedAt: ''
      })
      this.pointRecords.unshift({
        id: 'seed-pr2', date: this.todayDate, time: '09:40:08', ts: todayAt(9, 40),
        delta: -10, balance: this.points, note: '冻结：参与【新人刮刮乐】待风控审核', kind: 'frozen'
      })

      // —— 3) 待审核：高价值兑换 盲盒福袋（200 积分冻结 + 预占 g4） ——
      const g4 = this.goods.find((g) => g.id === 'g4')
      if (g4) { g4.remain -= 1; g4.frozen += 1 }
      this.points -= 200
      const rec3 = {
        id: 'seed-r3', type: 'redeem', status: 'frozen',
        date: this.todayDate, time: '09:15:22', ts: todayAt(9, 15),
        goodsId: 'g4', goodsName: '盲盒福袋', icon: '🎁', riskOrderId: 'seed-rk3'
      }
      this.records.push(rec3)
      this.riskOrders.push({
        id: 'seed-rk3', bizType: 'redeem', status: 'pending', userId: uid, userName: uname,
        recordId: rec3.id, activityId: null, targetId: 'g4', targetName: '盲盒福袋',
        icon: '🎁', rarity: null, frozenPoints: 200, stockHeld: 1,
        rules: [{ code: 'highValue', label: RULE_LABELS.highValue },
                { code: 'rapidRedeem', label: RULE_LABELS.rapidRedeem }],
        appealReason: '', appealAt: '', reviewNote: '', reviewer: '',
        createdAt: this.todayDate, time: '09:15:22', ts: todayAt(9, 15), reviewedAt: ''
      })
      this.pointRecords.unshift({
        id: 'seed-pr3', date: this.todayDate, time: '09:15:22', ts: todayAt(9, 15),
        delta: -200, balance: this.points, note: '冻结：兑换【盲盒福袋】待风控审核', kind: 'frozen'
      })

      // —— 4) 已放行：500元购物卡（免费转盘，无积分冻结，库存已核销） ——
      const pEpicCard = a1?.prizes.find((p) => p.id === 'p2')
      if (pEpicCard) { pEpicCard.remain -= 1 }
      const rec4 = {
        id: 'seed-r4', type: 'draw', status: 'released',
        date: this.todayDate, time: '08:55:40', ts: todayAt(8, 55),
        activityId: 'act-1', activityName: '周年庆幸运转盘',
        prizeId: 'p2', prizeName: '500元购物卡', rarity: 'epic', icon: '💳',
        riskOrderId: 'seed-rk4'
      }
      this.records.push(rec4)
      this.riskOrders.push({
        id: 'seed-rk4', bizType: 'draw', status: 'released', userId: uid, userName: uname,
        recordId: rec4.id, activityId: 'act-1', targetId: 'p2', targetName: '500元购物卡',
        icon: '💳', rarity: 'epic', frozenPoints: 0, stockHeld: 0,
        rules: [{ code: 'highValue', label: RULE_LABELS.highValue }],
        appealReason: '系统误判，正常中奖。', appealAt: `${this.todayDate} 09:00:00`,
        reviewNote: '核实为正常用户，放行并发奖。', reviewer: '运营小张',
        createdAt: this.todayDate, time: '08:55:40', ts: todayAt(8, 55),
        reviewedAt: `${this.todayDate} 09:10:12`
      })

      // —— 5) 已撤销：视频会员周卡（80 积分冻结后返还 + 券库存预占后回补，业务记录保留为 revoked；券从未发出） ——
      const rec5 = {
        id: 'seed-r5', type: 'redeem', status: 'revoked',
        date: this.todayDate, time: '08:30:05', ts: todayAt(8, 30),
        goodsId: 'g2', goodsName: '视频会员周卡', couponId: 'c-video-week', icon: '🎬', riskOrderId: 'seed-rk5'
      }
      this.records.push(rec5)
      this.riskOrders.push({
        id: 'seed-rk5', bizType: 'redeem', status: 'revoked', userId: uid, userName: uname,
        recordId: rec5.id, activityId: null, targetId: 'g2', targetName: '视频会员周卡',
        icon: '🎬', rarity: null, frozenPoints: 80, stockHeld: 0,
        rules: [{ code: 'rapidRedeem', label: RULE_LABELS.rapidRedeem }],
        appealReason: '', appealAt: '',
        reviewNote: '命中短时连续兑换规则，自动拦截，用户未申诉。', reviewer: '系统',
        createdAt: this.todayDate, time: '08:30:05', ts: todayAt(8, 30),
        reviewedAt: `${this.todayDate} 08:35:00`
      })
      // 撤销前的冻结成本（与正常 freezeRedeem 一致：先扣 80、预占库存），08:35 撤销时返还 80、回补库存
      this.points -= 80
      this.pointRecords.unshift({
        id: 'seed-pr5f', date: this.todayDate, time: '08:30:05', ts: todayAt(8, 30) + 1,
        delta: -80, balance: this.points, note: '冻结：兑换【视频会员周卡】待风控审核', kind: 'frozen'
      })
      this.points += 80
      this.pointRecords.unshift({
        id: 'seed-pr5', date: this.todayDate, time: '08:35:00', ts: todayAt(8, 35),
        delta: 80, balance: this.points, note: '撤销返还：兑换【视频会员周卡】', kind: 'refund'
      })

      // —— 6) 历史业务日台账：演示"按业务日保留进度与领奖记录 + 跨日审核补计" ——
      const DAY = 86400000
      const d1 = dateStr(-1)   // 上一业务日
      const d2 = dateStr(-2)   // 前两业务日
      // 前两业务日：3 次有效参与（谢谢参与，无库存/积分变动）→ 当日任务已自动结算 +15
      ;[['08:10:02', 8, 10], ['08:11:15', 8, 11], ['08:12:40', 8, 12]].forEach(([time, h, m], i) => {
        this.records.push({
          id: `seed-rd2-${i}`, type: 'draw', status: 'normal',
          date: d2, time, ts: todayAt(h, m) - 2 * DAY,
          activityId: 'act-1', activityName: '周年庆幸运转盘',
          prizeId: 'p6', prizeName: '谢谢参与', rarity: 'none', icon: '🤝'
        })
      })
      this.taskClaims.push({
        id: 'seed-tc1', taskId: 't-draw3', taskLabel: '今日抽奖3次', reward: 15,
        bizDate: d2, grantDate: d2, time: '08:12:40', ts: todayAt(8, 12) - 2 * DAY, source: 'auto',
        flowId: 'seed-pr1'
      })
      this.pointRecords.unshift({
        id: 'seed-pr1', date: d2, bizDate: d2, time: '08:12:40', ts: todayAt(8, 12) - 2 * DAY,
        delta: 15, balance: 0, note: '任务结算：今日抽奖3次', kind: 'reward',
        refId: 'seed-tc1', refType: 'task-claim'
      })
      // 上一业务日：2 次有效参与 + 1 笔风控冻结（审核中暂缓计入）→ 任务 2/3 未达成；
      // 该跨日审核单放行后按归属业务日 d1 补计进度并结算，撤销则确认不计入
      ;[['18:03:11', 18, 3], ['18:05:26', 18, 5]].forEach(([time, h, m], i) => {
        this.records.push({
          id: `seed-rd1-${i}`, type: 'draw', status: 'normal',
          date: d1, time, ts: todayAt(h, m) - DAY,
          activityId: 'act-1', activityName: '周年庆幸运转盘',
          prizeId: 'p6', prizeName: '谢谢参与', rarity: 'none', icon: '🤝'
        })
      })
      const pCardD1 = a1?.prizes.find((p) => p.id === 'p2')
      // 与待审核单一致：remain 已扣、frozen 预占 1（放行核销 / 撤销回补）
      if (pCardD1) { pCardD1.remain -= 1; pCardD1.frozen += 1 }
      const rec6 = {
        id: 'seed-r6', type: 'draw', status: 'frozen',
        date: d1, time: '18:06:40', ts: todayAt(18, 6) - DAY,
        activityId: 'act-1', activityName: '周年庆幸运转盘',
        prizeId: 'p2', prizeName: '500元购物卡', rarity: 'epic', icon: '💳',
        riskOrderId: 'seed-rk6'
      }
      this.records.push(rec6)
      this.riskOrders.push({
        id: 'seed-rk6', bizType: 'draw', status: 'pending', userId: uid, userName: uname,
        recordId: rec6.id, activityId: 'act-1', targetId: 'p2', targetName: '500元购物卡',
        icon: '💳', rarity: 'epic', frozenPoints: 0, stockHeld: 1,
        rules: [{ code: 'highValue', label: RULE_LABELS.highValue }],
        appealReason: '', appealAt: '', reviewNote: '', reviewer: '',
        createdAt: d1, time: '18:06:40', ts: todayAt(18, 6) - DAY, reviewedAt: ''
      })

      // —— 7) 实物发货流程种子 ——
      // 7a) 已放行实物（seed-r4：500元购物卡）→ 用户已填地址、运营已接单发货、待用户确认收货（轨迹已同步至派送中）
      this.shipments.push({
        id: 'seed-sp1', recordId: 'seed-r4', bizType: 'draw', status: 'shipped',
        userId: uid, userName: uname, icon: '💳', targetName: '500元购物卡',
        activityId: 'act-1', source: '风控放行',
        date: this.todayDate, time: '09:12:00', ts: todayAt(9, 12),
        receiver: '李运营', phone: '138****0001', region: '上海市浦东新区',
        address: '张江高科技园区博云路2号', addressAt: `${this.todayDate} 09:20:11`,
        shipper: '运营小张', carrier: '顺丰速运', trackingNo: 'SF1024888661',
        shipNote: '内含购物卡，请当面验货', shippedAt: `${this.todayDate} 11:05:40`,
        receivedAt: '',
        traces: [
          { stage: 'collected', text: '顺丰速运 已揽收包裹（单号 SF1024888661）', date: this.todayDate, time: '11:05:40', ts: todayAt(11, 5) },
          { stage: 'transit', text: '包裹离开揽收网点，干线运输中，发往【上海市浦东新区】', date: this.todayDate, time: '13:40:12', ts: todayAt(13, 40) },
          { stage: 'delivering', text: '包裹到达【上海市浦东新区】派送点，派送员王师傅 138****6666 正在派送', date: this.todayDate, time: '15:26:03', ts: todayAt(15, 26) }
        ],
        afterSaleId: '', returnedAt: '', originId: ''
      })
      // 7b) 正常兑换实物（定制帆布袋 150 积分）→ 待用户填写收货信息
      const g3 = this.goods.find((g) => g.id === 'g3')
      if (g3) { g3.remain -= 1 }
      this.points -= 150
      const rec7 = {
        id: 'seed-r7', type: 'redeem', status: 'normal',
        date: this.todayDate, time: '13:26:55', ts: todayAt(13, 26),
        goodsId: 'g3', goodsName: '定制帆布袋', icon: '👜'
      }
      this.records.push(rec7)
      this.pointRecords.unshift({
        id: 'seed-pr7', date: this.todayDate, time: '13:26:55', ts: todayAt(13, 26),
        delta: -150, balance: this.points, note: '兑换：定制帆布袋', kind: 'normal'
      })
      this.shipments.push({
        id: 'seed-sp2', recordId: 'seed-r7', bizType: 'redeem', status: 'pending_address',
        userId: uid, userName: uname, icon: '👜', targetName: '定制帆布袋',
        activityId: null, source: '积分兑换',
        date: this.todayDate, time: '13:26:55', ts: todayAt(13, 26),
        receiver: '', phone: '', region: '', address: '', addressAt: '',
        shipper: '', carrier: '', trackingNo: '', shipNote: '', shippedAt: '', receivedAt: '',
        traces: [], afterSaleId: '', returnedAt: '', originId: ''
      })

      // —— 8) 历史业务日对账差异（演示）：上一业务日一笔 5 积分任务领奖台账已落、积分与流水漏记 ——
      // 对账应在上一业务日差异单中检出（P1 净额 +5、P2 台账缺笔），运营复核后按跨日补偿补记，原始记录保留
      this.taskClaims.push({
        id: 'seed-tc-gap', taskId: 't-checkin', taskLabel: '每日签到（历史漏记）', reward: 5,
        bizDate: d1, grantDate: d1, time: '18:40:00', ts: todayAt(18, 40) - DAY, source: 'manual-gap'
      })

      // —— 9) 售后闭环种子：昨日退货已完成（积分/库存已回写）+ 今日补发待审核 ——
      // 9a) 昨日兑换盲盒福袋（200 积分）→ 已发货已签收 → 昨日申请退货并审核通过：
      //     积分 +200 返还（昨日退款流水）、库存回补（g4 remain 净 0）、发货单 → 已退回、轨迹含退回节点
      const g4seed = this.goods.find((g) => g.id === 'g4')
      if (g4seed) { g4seed.remain -= 1 } // 昨日兑换扣减
      this.points -= 200
      const rec12 = {
        id: 'seed-r12', type: 'redeem', status: 'normal',
        date: d1, time: '16:20:33', ts: todayAt(16, 20) - DAY,
        goodsId: 'g4', goodsName: '盲盒福袋', icon: '🎁'
      }
      this.records.push(rec12)
      this.pointRecords.unshift({
        id: 'seed-pr12', date: d1, time: '16:20:33', ts: todayAt(16, 20) - DAY,
        delta: -200, balance: this.points, note: '兑换：盲盒福袋', kind: 'normal'
      })
      this.shipments.push({
        id: 'seed-sp3', recordId: 'seed-r12', bizType: 'redeem', status: 'returned',
        userId: uid, userName: uname, icon: '🎁', targetName: '盲盒福袋',
        activityId: null, source: '积分兑换',
        date: d1, time: '16:20:33', ts: todayAt(16, 20) - DAY,
        receiver: '李运营', phone: '138****0001', region: '上海市浦东新区',
        address: '张江高科技园区博云路2号', addressAt: `${d1} 16:25:01`,
        shipper: '运营小王', carrier: '京东物流', trackingNo: 'JD7731029845',
        shipNote: '', shippedAt: `${d1} 17:02:18`,
        receivedAt: `${d1} 18:30:55`,
        traces: [
          { stage: 'collected', text: '京东物流 已揽收包裹（单号 JD7731029845）', date: d1, time: '17:02:18', ts: todayAt(17, 2) - DAY },
          { stage: 'transit', text: '包裹离开揽收网点，干线运输中，发往【上海市浦东新区】', date: d1, time: '17:48:40', ts: todayAt(17, 48) - DAY },
          { stage: 'delivering', text: '包裹到达【上海市浦东新区】派送点，派送员王师傅 138****6666 正在派送', date: d1, time: '18:12:06', ts: todayAt(18, 12) - DAY },
          { stage: 'signed', text: '包裹已签收，签收人：本人（用户确认收货）', date: d1, time: '18:30:55', ts: todayAt(18, 30) - DAY },
          { stage: 'returned', text: '退货包裹已退回发货仓，售后完成', date: d1, time: '19:05:44', ts: todayAt(19, 5) - DAY }
        ],
        afterSaleId: 'seed-as1', returnedAt: `${d1} 19:05:44`, originId: ''
      })
      if (g4seed) { g4seed.remain += 1 } // 退货审核通过：库存回补
      this.points += 200
      this.pointRecords.unshift({
        id: 'seed-pr13', date: d1, time: '19:05:44', ts: todayAt(19, 5) - DAY,
        delta: 200, balance: this.points, note: '售后退款：退货退款【盲盒福袋】（发货单 seed-sp3）',
        kind: 'refund', refId: 'seed-as1', refType: 'after-sale'
      })
      this.afterSales.push({
        id: 'seed-as1', shipmentId: 'seed-sp3', recordId: 'seed-r12',
        userId: uid, userName: uname,
        type: 'return', typeLabel: '退货退款',
        reason: '福袋内容与活动描述不符，未拆封，申请退货退款',
        status: 'done', icon: '🎁', targetName: '盲盒福袋',
        targetType: 'goods', activityId: null, targetId: 'g4',
        refundPoints: 200, reshipmentId: '',
        createdAt: d1, time: '18:32:10', ts: todayAt(18, 32) - DAY,
        reviewedAt: `${d1} 19:05:44`, reviewer: '运营小张',
        reviewNote: '核实包裹未拆封已退回仓库，同意退货退款，库存与积分已回写'
      })

      // 9b) 今日再兑一件定制帆布袋（150 积分）→ 已发货已签收 → 用户申请补发（破损）待运营审核
      if (g3) { g3.remain -= 1 }
      this.points -= 150
      const rec13 = {
        id: 'seed-r13', type: 'redeem', status: 'normal',
        date: this.todayDate, time: '10:48:21', ts: todayAt(10, 48),
        goodsId: 'g3', goodsName: '定制帆布袋', icon: '👜'
      }
      this.records.push(rec13)
      this.pointRecords.unshift({
        id: 'seed-pr14', date: this.todayDate, time: '10:48:21', ts: todayAt(10, 48),
        delta: -150, balance: this.points, note: '兑换：定制帆布袋', kind: 'normal'
      })
      this.shipments.push({
        id: 'seed-sp4', recordId: 'seed-r13', bizType: 'redeem', status: 'received',
        userId: uid, userName: uname, icon: '👜', targetName: '定制帆布袋',
        activityId: null, source: '积分兑换',
        date: this.todayDate, time: '10:48:21', ts: todayAt(10, 48),
        receiver: '李运营', phone: '138****0001', region: '上海市浦东新区',
        address: '张江高科技园区博云路2号', addressAt: `${this.todayDate} 10:50:02`,
        shipper: '运营小张', carrier: '中通快递', trackingNo: 'ZT5531027768',
        shipNote: '', shippedAt: `${this.todayDate} 12:15:30`,
        receivedAt: `${this.todayDate} 15:40:22`,
        traces: [
          { stage: 'collected', text: '中通快递 已揽收包裹（单号 ZT5531027768）', date: this.todayDate, time: '12:15:30', ts: todayAt(12, 15) },
          { stage: 'transit', text: '包裹离开揽收网点，干线运输中，发往【上海市浦东新区】', date: this.todayDate, time: '13:02:11', ts: todayAt(13, 2) },
          { stage: 'delivering', text: '包裹到达【上海市浦东新区】派送点，派送员王师傅 138****6666 正在派送', date: this.todayDate, time: '14:58:47', ts: todayAt(14, 58) },
          { stage: 'signed', text: '包裹已签收，签收人：本人（用户确认收货）', date: this.todayDate, time: '15:40:22', ts: todayAt(15, 40) }
        ],
        afterSaleId: '', returnedAt: '', originId: ''
      })
      this.afterSales.push({
        id: 'seed-as2', shipmentId: 'seed-sp4', recordId: 'seed-r13',
        userId: uid, userName: uname,
        type: 'reship', typeLabel: '补发',
        reason: '收到的帆布袋提手处开线破损，申请补发一件',
        status: 'pending', icon: '👜', targetName: '定制帆布袋',
        targetType: 'goods', activityId: null, targetId: 'g3',
        refundPoints: 0, reshipmentId: '',
        createdAt: this.todayDate, time: '16:05:18', ts: todayAt(16, 5),
        reviewedAt: '', reviewer: '', reviewNote: ''
      })

      // —— 9.5) 采购入库 + 缺货补发继续履约种子 ——
      // 9.5a) 限量联名公仔（g6，初始 2 件已兑完）：今日两笔兑换均已签收
      const g6 = this.goods.find((g) => g.id === 'g6')
      if (g6) g6.remain -= 2
      this.points -= 600
      const recG6a = {
        id: 'seed-r14', type: 'redeem', status: 'normal',
        date: this.todayDate, time: '10:32:11', ts: todayAt(10, 32),
        goodsId: 'g6', goodsName: '限量联名公仔', icon: '🧸'
      }
      const recG6b = {
        id: 'seed-r15', type: 'redeem', status: 'normal',
        date: this.todayDate, time: '11:05:48', ts: todayAt(11, 5),
        goodsId: 'g6', goodsName: '限量联名公仔', icon: '🧸'
      }
      this.records.push(recG6a, recG6b)
      this.pointRecords.unshift(
        { id: 'seed-pr15', date: this.todayDate, time: '10:32:11', ts: todayAt(10, 32),
          delta: -300, balance: this.points + 300, note: '兑换：限量联名公仔', kind: 'normal' },
        { id: 'seed-pr16', date: this.todayDate, time: '11:05:48', ts: todayAt(11, 5),
          delta: -300, balance: this.points, note: '兑换：限量联名公仔', kind: 'normal' }
      )
      // 两笔均已签收（简版轨迹）
      ;[
        ['seed-sp5', 'seed-r14', '10:35:00', '12:20:00', '14:02:15'],
        ['seed-sp6', 'seed-r15', '11:08:20', '13:10:40', '16:12:30']
      ].forEach(([sid, rid, addr, shipAt, recvAt]) => {
        this.shipments.push({
          id: sid, recordId: rid, bizType: 'redeem', status: 'received',
          userId: uid, userName: uname, icon: '🧸', targetName: '限量联名公仔',
          activityId: null, source: '积分兑换',
          date: this.todayDate, time: addr, ts: todayAt(10, 35),
          receiver: '李运营', phone: '138****0001', region: '上海市浦东新区',
          address: '张江高科技园区博云路2号', addressAt: `${this.todayDate} ${addr}`,
          shipper: '仓配小李', carrier: '顺丰速运', trackingNo: sid === 'seed-sp5' ? 'SF66001' : 'SF66002',
          shipNote: '', shippedAt: `${this.todayDate} ${shipAt}`, receivedAt: `${this.todayDate} ${recvAt}`,
          traces: [
            { stage: 'collected', text: '顺丰速运 已揽收包裹', date: this.todayDate, time: shipAt, ts: todayAt(12, 20) },
            { stage: 'signed', text: '包裹已签收，签收人：本人（用户确认收货）', date: this.todayDate, time: recvAt, ts: todayAt(16, 12) }
          ],
          afterSaleId: '', returnedAt: '', originId: ''
        })
      })
      // 第二笔少件/瑕疵 → 用户申请补发；运营审核时库存为 0 → 售后单挂起「待补货」（不落账）
      this.afterSales.push({
        id: 'seed-as3', shipmentId: 'seed-sp6', recordId: 'seed-r15',
        userId: uid, userName: uname,
        type: 'reship', typeLabel: '补发',
        reason: '公仔外包装完好但内部挂件缺失，申请补发一件',
        status: 'waiting_stock', icon: '🧸', targetName: '限量联名公仔',
        targetType: 'goods', activityId: null, targetId: 'g6',
        refundPoints: 0, reshipmentId: '',
        createdAt: this.todayDate, time: '16:30:00', ts: todayAt(16, 30),
        reviewedAt: `${this.todayDate} 16:42:10`, reviewer: '仓配小李',
        reviewNote: '核实漏件属实，同意补发；库存为 0，已转采购补货',
        shortageNote: '审核通过但【限量联名公仔】库存不足（remain=0），挂起待采购补货后继续履约'
      })

      // 9.5b) 活动运营发起采购：保温杯 50 件（已审批，仓配分两批验收入库：30 + 20，已入完）
      this.purchaseOrders.push({
        id: 'seed-po1', poNo: 'POSEED0001', tenantId: 't-star', traceId: '',
        targetType: 'prize', activityId: 'act-1', activityName: '周年庆幸运转盘',
        targetId: 'p3', targetName: '周年庆幸运转盘 / 定制保温杯', icon: '☕',
        qty: 50, inboundQty: 50, status: 'received',
        purpose: 'normal', purposeLabel: PURCHASE_PURPOSE.normal, afterSaleId: '',
        supplierName: '优品礼品供应商', unitPrice: 12.5,
        shortQty: 0, rejectedQty: 0, settledBillId: 'seed-sb1',
        reason: '周年庆第二阶段投放加码，保温杯库存不足，申请补货 50 件',
        applicant: '运营小张', applicantId: 'm-star-ops',
        createdAt: dateStr(-1), time: '10:20:00', ts: todayAt(10, 20) - 86400000,
        approvedAt: `${dateStr(-1)} 11:05:00`, approver: '财务小周', approveNote: '预算内，同意采购',
        receivedAt: `${this.todayDate} 15:05:00`,
        batches: ['seed-pb1', 'seed-pb2']
      })
      // 9.5c) 为缺货补发发起采购：公仔 10 件（已审批，首批 6 件已验收入库，剩余 4 件待验收）
      this.purchaseOrders.push({
        id: 'seed-po2', poNo: 'POSEED0002', tenantId: 't-star', traceId: '',
        targetType: 'goods', activityId: null, activityName: '',
        targetId: 'g6', targetName: '限量联名公仔', icon: '🧸',
        qty: 10, inboundQty: 6, status: 'receiving',
        purpose: 'aftersale', purposeLabel: PURCHASE_PURPOSE.aftersale, afterSaleId: 'seed-as3',
        supplierName: '潮玩供应仓', unitPrice: 18,
        shortQty: 0, rejectedQty: 0, settledBillId: '',
        reason: '补发售后 seed-as3 缺货挂起，采购 10 件：1 件用于补发履约，9 件恢复商城库存',
        applicant: '运营小张', applicantId: 'm-star-ops',
        createdAt: this.todayDate, time: '16:50:00', ts: todayAt(16, 50),
        approvedAt: `${this.todayDate} 17:02:00`, approver: '财务小周', approveNote: '售后优先，同意加急采购',
        receivedAt: '',
        batches: ['seed-pb3']
      })
      // 9.5d) 待审批：iPhone 16 追加采购 2 台（演示审批队列与 RBAC：运营发起、财务/管理员审批）
      this.purchaseOrders.push({
        id: 'seed-po3', poNo: 'POSEED0003', tenantId: 't-star', traceId: '',
        targetType: 'prize', activityId: 'act-1', activityName: '周年庆幸运转盘',
        targetId: 'p1', targetName: '周年庆幸运转盘 / iPhone 16', icon: '📱',
        qty: 2, inboundQty: 0, status: 'pending',
        purpose: 'normal', purposeLabel: PURCHASE_PURPOSE.normal, afterSaleId: '',
        supplierName: '数码直供（深圳）', unitPrice: 5999,
        shortQty: 0, rejectedQty: 0, settledBillId: '',
        reason: '传说大奖仅剩库存 3（含 1 件风控预占），为国庆加码追加 2 台',
        applicant: '运营小张', applicantId: 'm-star-ops',
        createdAt: this.todayDate, time: '17:15:00', ts: todayAt(17, 15),
        approvedAt: '', approver: '', approveNote: '', receivedAt: '', batches: []
      })
      // 验收批次（append-only）：保温杯两批 + 公仔首批；库存只在实际验收时按批次抬升 remain/stock
      // 注意：必须改 store 内的响应式实例（this.activities/this.goods），不可用 import 的 mock 原对象
      const p3Store = this.activities.find((x) => x.id === 'act-1')?.prizes.find((p) => p.id === 'p3')
      if (p3Store) { p3Store.remain += 50; p3Store.stock += 50 } // 50 件已全部验收入库
      const g6Store = this.goods.find((x) => x.id === 'g6')
      if (g6Store) { g6Store.remain += 6; g6Store.stock += 6 } // 首批实收 6：remain 0→6，stock 2→8（剩 4 件待验收，审批不预抬库存）
      this.inboundBatches.push(
        { id: 'seed-pb3', poId: 'seed-po2', poNo: 'POSEED0002', tenantId: 't-star', traceId: '',
          targetType: 'goods', activityId: null, targetId: 'g6', targetName: '限量联名公仔', icon: '🧸',
          qty: 6, deliveredQty: 6, rejectedQty: 0, shortQty: 0,
          remainBefore: 0, remainAfter: 6, stockBefore: 2, stockAfter: 8,
          carrier: '潮玩供应仓', inspector: '仓配小李', acceptedInbound: true,
          date: this.todayDate, time: '17:30:00', ts: todayAt(17, 30), note: '首批 6 件验收合格（含补发预留 1 件）' },
        { id: 'seed-pb2', poId: 'seed-po1', poNo: 'POSEED0001', tenantId: 't-star', traceId: '',
          targetType: 'prize', activityId: 'act-1', targetId: 'p3', targetName: '周年庆幸运转盘 / 定制保温杯', icon: '☕',
          qty: 20, deliveredQty: 20, rejectedQty: 0, shortQty: 0,
          remainBefore: 130, remainAfter: 150, stockBefore: 180, stockAfter: 200,
          carrier: '优品礼品供应商', inspector: '仓配小李', acceptedInbound: true,
          date: this.todayDate, time: '15:05:00', ts: todayAt(15, 5), note: '第二批 20 件，采购 50 件全部入完' },
        { id: 'seed-pb1', poId: 'seed-po1', poNo: 'POSEED0001', tenantId: 't-star', traceId: '',
          targetType: 'prize', activityId: 'act-1', targetId: 'p3', targetName: '周年庆幸运转盘 / 定制保温杯', icon: '☕',
          qty: 30, deliveredQty: 30, rejectedQty: 0, shortQty: 0,
          remainBefore: 100, remainAfter: 130, stockBefore: 150, stockAfter: 180,
          carrier: '优品礼品供应商', inspector: '仓配小李', acceptedInbound: true,
          date: this.todayDate, time: '09:40:00', ts: todayAt(9, 40), note: '首批 30 件验收合格' }
      )

      // 9.6) 供应商结算闭环种子：盲盒福袋采购 10 件，到货 10 件（2 件破损验退不入库）+ 供应商短少 2 件不再补发
      //      → 合格入库 8 件、采购单按验收差异结案（diff_closed）→ 账单复核通过待结算（approved，演示财务待办）
      const g4Buy = this.goods.find((x) => x.id === 'g4')
      const g4BeforeRemain = g4Buy ? g4Buy.remain : 0
      const g4BeforeStock = g4Buy ? g4Buy.stock : 0
      if (g4Buy) { g4Buy.remain += 8; g4Buy.stock += 8 } // 仅合格 8 件抬库存（验退 2 不入库、短少 2 未到货）
      this.purchaseOrders.push({
        id: 'seed-po4', poNo: 'POSEED0004', tenantId: 't-star', traceId: '',
        targetType: 'goods', activityId: null, activityName: '',
        targetId: 'g4', targetName: '盲盒福袋', icon: '🎁',
        qty: 10, inboundQty: 8, status: 'diff_closed',
        purpose: 'normal', purposeLabel: PURCHASE_PURPOSE.normal, afterSaleId: '',
        supplierName: '好运礼品厂', unitPrice: 9.9,
        shortQty: 2, rejectedQty: 2, settledBillId: '',
        reason: '中秋活动福袋备货 10 件',
        applicant: '运营小张', applicantId: 'm-star-ops',
        createdAt: dateStr(-1), time: '14:10:00', ts: todayAt(14, 10) - 86400000,
        approvedAt: `${dateStr(-1)} 15:00:00`, approver: '财务小周', approveNote: '同意备货',
        receivedAt: `${this.todayDate} 11:20:00`,
        batches: ['seed-pb4']
      })
      this.inboundBatches.push(
        { id: 'seed-pb4', poId: 'seed-po4', poNo: 'POSEED0004', tenantId: 't-star', traceId: '',
          targetType: 'goods', activityId: null, targetId: 'g4', targetName: '盲盒福袋', icon: '🎁',
          qty: 8, deliveredQty: 10, rejectedQty: 2, shortQty: 2,
          remainBefore: g4BeforeRemain, remainAfter: g4BeforeRemain + 8,
          stockBefore: g4BeforeStock, stockAfter: g4BeforeStock + 8,
          carrier: '好运礼品厂', inspector: '仓配小李', acceptedInbound: true,
          date: this.todayDate, time: '11:20:00', ts: todayAt(11, 20), note: '到货 10 件，2 件外箱破损验退；另短少 2 件供应商确认不再补发' }
      )
      this.acceptDiffs.push(
        { id: 'seed-ad2', type: 'short', poId: 'seed-po4', poNo: 'POSEED0004', batchId: 'seed-pb4',
          tenantId: 't-star', traceId: '',
          targetType: 'goods', activityId: null, targetId: 'g4', targetName: '盲盒福袋', icon: '🎁',
          qty: 2, orderQty: 10, inboundQtyAfter: 8, supplierName: '好运礼品厂',
          reason: '供应商到货短少且确认不再补发，按验收差异结案',
          inspector: '仓配小李', date: this.todayDate, time: '11:20:00', ts: todayAt(11, 20) },
        { id: 'seed-ad1', type: 'rejected', poId: 'seed-po4', poNo: 'POSEED0004', batchId: 'seed-pb4',
          tenantId: 't-star', traceId: '',
          targetType: 'goods', activityId: null, targetId: 'g4', targetName: '盲盒福袋', icon: '🎁',
          qty: 2, orderQty: 10, inboundQtyAfter: 8, supplierName: '好运礼品厂',
          reason: '到货 2 件外盒压损内件破损，验退拒收不入库',
          inspector: '仓配小李', date: this.todayDate, time: '11:20:00', ts: todayAt(11, 20) }
      )
      // 保温杯采购已结算账单（已结算终态，按两批验收回写库存对账快照，演示完整闭环）
      this.supplierBills.push({
        id: 'seed-sb1', billNo: 'SBSEED0001', poId: 'seed-po1', poNo: 'POSEED0001', tenantId: 't-star', traceId: '',
        targetType: 'prize', activityId: 'act-1', targetId: 'p3', targetName: '周年庆幸运转盘 / 定制保温杯', icon: '☕',
        supplierName: '优品礼品供应商', unitPrice: 12.5,
        purpose: 'normal', purposeLabel: PURCHASE_PURPOSE.normal, afterSaleId: '',
        orderQty: 50, acceptedQty: 50, billableQty: 50,
        shortQty: 0, rejectedQty: 0, reshipQty: 0,
        grossAmount: 625, reshipDeduct: 0, payableAmount: 625,
        rows: [
          { seq: 1, batchId: 'seed-pb1', date: this.todayDate, time: '09:40:00', deliveredQty: 30, acceptedQty: 30, rejectedQty: 0, shortQty: 0, reshipQty: 0, billableQty: 30, inspector: '仓配小李', carrier: '优品礼品供应商', note: '首批 30 件验收合格' },
          { seq: 2, batchId: 'seed-pb2', date: this.todayDate, time: '15:05:00', deliveredQty: 20, acceptedQty: 20, rejectedQty: 0, shortQty: 0, reshipQty: 0, billableQty: 20, inspector: '仓配小李', carrier: '优品礼品供应商', note: '第二批 20 件，采购 50 件全部入完' }
        ],
        reshipPending: 0,
        status: 'settled', note: '两批验收合格，按协议单价结算',
        applicant: '运营小张', applicantId: 'm-star-ops',
        createdAt: dateStr(-1), time: '16:00:00', ts: todayAt(16, 0) - 86400000,
        submittedAt: `${dateStr(-1)} 16:05:00`,
        reviewedAt: `${this.todayDate} 09:55:00`, reviewer: '财务小周', reviewNote: '批次勾稽无误，同意结算',
        settledAt: `${this.todayDate} 10:05:00`, settleOperator: '财务小周', settleNote: '已对公付款 625 元',
        reconWriteback: {
          at: `${this.todayDate} 10:05:00`, bizDate: this.todayDate,
          targetType: 'prize', activityId: 'act-1', targetId: 'p3', targetKey: 'prize:act-1:p3',
          targetName: '周年庆幸运转盘 / 定制保温杯',
          orderQty: 50, acceptedQty: 50, shortQty: 0, rejectedQty: 0, reshipQty: 0, billableQty: 50,
          unitPrice: 12.5, grossAmount: 625, reshipDeduct: 0, payableAmount: 625,
          rows: [
            { seq: 1, batchId: 'seed-pb1', deliveredQty: 30, acceptedQty: 30, rejectedQty: 0, shortQty: 0, reshipQty: 0, billableQty: 30 },
            { seq: 2, batchId: 'seed-pb2', deliveredQty: 20, acceptedQty: 20, rejectedQty: 0, shortQty: 0, reshipQty: 0, billableQty: 20 }
          ]
        }
      })
      // 盲盒福袋账单：复核通过待结算（应付按实收合格 8 件 = 79.2 元；验退/短少不计价）
      this.supplierBills.push({
        id: 'seed-sb2', billNo: 'SBSEED0002', poId: 'seed-po4', poNo: 'POSEED0004', tenantId: 't-star', traceId: '',
        targetType: 'goods', activityId: null, targetId: 'g4', targetName: '盲盒福袋', icon: '🎁',
        supplierName: '好运礼品厂', unitPrice: 9.9,
        purpose: 'normal', purposeLabel: PURCHASE_PURPOSE.normal, afterSaleId: '',
        orderQty: 10, acceptedQty: 8, billableQty: 8,
        shortQty: 2, rejectedQty: 2, reshipQty: 0,
        grossAmount: 79.2, reshipDeduct: 0, payableAmount: 79.2,
        rows: [
          { seq: 1, batchId: 'seed-pb4', date: this.todayDate, time: '11:20:00', deliveredQty: 10, acceptedQty: 8, rejectedQty: 2, shortQty: 2, reshipQty: 0, billableQty: 8, inspector: '仓配小李', carrier: '好运礼品厂', note: '到货 10 件，2 件验退、2 件短少结案' }
        ],
        reshipPending: 0,
        status: 'approved', note: '按实收合格 8 件结算，验退短少差异留存',
        applicant: '运营小张', applicantId: 'm-star-ops',
        createdAt: this.todayDate, time: '11:40:00', ts: todayAt(11, 40),
        submittedAt: `${this.todayDate} 11:42:00`,
        reviewedAt: `${this.todayDate} 13:15:00`, reviewer: '财务小周', reviewNote: '验收差异属实，按合格 8 件付款',
        settledAt: '', settleOperator: '', settleNote: '', reconWriteback: null
      })

      // —— 10) 卡券账户与核销种子 ——
      // 10a) 今日正常兑换：满50减10优惠券（30 积分）→ 待核销，用户可出示券码
      const g1now = this.goods.find((g) => g.id === 'g1')
      if (g1now) g1now.remain -= 1
      this.points -= 30
      const rec8 = {
        id: 'seed-r8', type: 'redeem', status: 'normal',
        date: this.todayDate, time: '14:02:11', ts: todayAt(14, 2),
        goodsId: 'g1', goodsName: '满50减10优惠券', couponId: 'c-discount-10', icon: '🎟️'
      }
      this.records.push(rec8)
      this.pointRecords.unshift({
        id: 'seed-pr8', date: this.todayDate, time: '14:02:11', ts: todayAt(14, 2),
        delta: -30, balance: this.points, note: '兑换：满50减10优惠券', kind: 'normal'
      })

      // 10b) 今日正常兑换：视频会员周卡（80 积分）→ 今日已由运营核销
      const g2now = this.goods.find((g) => g.id === 'g2')
      if (g2now) g2now.remain -= 1
      this.points -= 80
      const rec9 = {
        id: 'seed-r9', type: 'redeem', status: 'normal',
        date: this.todayDate, time: '11:18:40', ts: todayAt(11, 18),
        goodsId: 'g2', goodsName: '视频会员周卡', couponId: 'c-video-week', icon: '🎬'
      }
      this.records.push(rec9)
      this.pointRecords.unshift({
        id: 'seed-pr9', date: this.todayDate, time: '11:18:40', ts: todayAt(11, 18),
        delta: -80, balance: this.points, note: '兑换：视频会员周卡', kind: 'normal'
      })

      // 10c) 10 天前兑换：满50减10优惠券（30 积分）→ 30 天有效，今日已核销（历史核销留痕）
      if (g1now) g1now.remain -= 1
      this.points -= 30
      const rec10 = {
        id: 'seed-r10', type: 'redeem', status: 'normal',
        date: dateStr(-10), time: '10:30:00', ts: todayAt(10, 30) - 10 * DAY,
        goodsId: 'g1', goodsName: '满50减10优惠券', couponId: 'c-discount-10', icon: '🎟️'
      }
      this.records.push(rec10)
      this.pointRecords.unshift({
        id: 'seed-pr10', date: dateStr(-10), time: '10:30:00', ts: todayAt(10, 30) - 10 * DAY,
        delta: -30, balance: this.points, note: '兑换：满50减10优惠券', kind: 'normal'
      })

      // 10d) 13 天前兑换：满50减10优惠券（30 积分）→ 已过期（发券 + 到期两条台账）
      if (g1now) g1now.remain -= 1
      this.points -= 30
      const rec11 = {
        id: 'seed-r11', type: 'redeem', status: 'normal',
        date: dateStr(-13), time: '09:05:00', ts: todayAt(9, 5) - 13 * DAY,
        goodsId: 'g1', goodsName: '满50减10优惠券', couponId: 'c-discount-10', icon: '🎟️'
      }
      this.records.push(rec11)
      this.pointRecords.unshift({
        id: 'seed-pr11', date: dateStr(-13), time: '09:05:00', ts: todayAt(9, 5) - 13 * DAY,
        delta: -30, balance: this.points, note: '兑换：满50减10优惠券', kind: 'normal'
      })

      // 卡券实例（直接落账户；状态机字段完整，供出示/核销/到期/对账各场景演示）
      const tplDisc = this.couponTpls['c-discount-10']
      const tplWeek = this.couponTpls['c-video-week']
      const mkCouponSeed = (id, tpl, rec, status, issueDate, patch = {}) => {
        const exp = this._couponExpiry(tpl, issueDate)
        return {
          id, code: patch.code, tplId: tpl.id, name: tpl.name, type: tpl.type,
          typeLabel: COUPON_TYPES[tpl.type]?.label || tpl.type, emoji: tpl.emoji,
          denomination: tpl.denomination || 0, threshold: tpl.threshold || 0,
          face: tpl.face || '', desc: tpl.desc || '', validityDays: tpl.validityDays || 30,
          status, userId: uid, userName: uname, recordId: rec.id, bizType: rec.type,
          activityId: null, source: '积分兑换',
          issueDate, time: rec.time, ts: rec.ts + 1,
          expireDate: exp.date, expireTs: exp.ts,
          redeemedAt: '', redeemOperator: '', redeemChannel: '', redeemNote: '',
          compensateBillId: '', comp: false, ...patch
        }
      }
      const cpAvail = mkCouponSeed('seed-cp1', tplDisc, rec8, 'available', this.todayDate, { code: 'CP-A1B2C-3D4E5' })
      const cpRedeemToday = mkCouponSeed('seed-cp2', tplWeek, rec9, 'redeemed', this.todayDate, {
        code: 'CP-W7K8M-9P2QR', redeemedAt: `${this.todayDate} 15:20:36`,
        redeemOperator: '运营小张', redeemChannel: '到店扫码', redeemNote: '门店 POS 扫码核销，已开通 7 天会员'
      })
      const cpRedeemHist = mkCouponSeed('seed-cp3', tplDisc, rec10, 'redeemed', dateStr(-10), {
        code: 'CP-H5J6N-8K3LM', redeemedAt: `${dateStr(-8)} 16:02:09`,
        redeemOperator: '运营小王', redeemChannel: '到店扫码', redeemNote: '历史核销'
      })
      const cpExpired = mkCouponSeed('seed-cp4', tplDisc, rec11, 'expired', dateStr(-13), { code: 'CP-E9X2T-6V4ZW' })
      this.coupons.push(cpExpired, cpRedeemHist, cpRedeemToday, cpAvail)

      // 卡券业务台账（append-only，按时间倒序：核销/发放/到期/预占/释放）
      this.couponLogs = [
        { id: 'seed-cl9', action: 'redeem', actionLabel: '卡券核销', couponId: cpRedeemToday.id, code: cpRedeemToday.code, tplId: tplWeek.id, tplName: tplWeek.name, recordId: rec9.id, bizType: 'redeem', orderId: '', operator: '运营(运营小张)', note: '到店扫码：门店 POS 扫码核销，已开通 7 天会员', date: this.todayDate, time: '15:20:36', ts: todayAt(15, 20) },
        { id: 'seed-cl8', action: 'issue', actionLabel: '卡券发放', couponId: cpAvail.id, code: cpAvail.code, tplId: tplDisc.id, tplName: tplDisc.name, recordId: rec8.id, bizType: 'redeem', orderId: '', operator: uname, note: '', date: this.todayDate, time: '14:02:11', ts: todayAt(14, 2) + 1 },
        { id: 'seed-cl7', action: 'issue', actionLabel: '卡券发放', couponId: cpRedeemToday.id, code: cpRedeemToday.code, tplId: tplWeek.id, tplName: tplWeek.name, recordId: rec9.id, bizType: 'redeem', orderId: '', operator: uname, note: '', date: this.todayDate, time: '11:18:40', ts: todayAt(11, 18) + 1 },
        { id: 'seed-cl6', action: 'hold', actionLabel: '风控预占', couponId: '', code: '', tplId: 'c-video-month', tplName: '视频月卡', recordId: 'seed-r2', bizType: 'draw', orderId: 'seed-rk2', operator: uname, note: '风控冻结，券库存预占、待放行交付', date: this.todayDate, time: '09:40:08', ts: todayAt(9, 40) },
        { id: 'seed-cl5', action: 'redeem', actionLabel: '卡券核销', couponId: cpRedeemHist.id, code: cpRedeemHist.code, tplId: tplDisc.id, tplName: tplDisc.name, recordId: rec10.id, bizType: 'redeem', orderId: '', operator: '运营(运营小王)', note: '到店扫码：历史核销', date: dateStr(-8), time: '16:02:09', ts: todayAt(16, 2) - 8 * DAY },
        { id: 'seed-cl4', action: 'issue', actionLabel: '卡券发放', couponId: cpRedeemHist.id, code: cpRedeemHist.code, tplId: tplDisc.id, tplName: tplDisc.name, recordId: rec10.id, bizType: 'redeem', orderId: '', operator: uname, note: '', date: dateStr(-10), time: '10:30:00', ts: todayAt(10, 30) - 10 * DAY + 1 },
        { id: 'seed-cl3', action: 'expire', actionLabel: '到期失效', couponId: cpExpired.id, code: cpExpired.code, tplId: tplDisc.id, tplName: tplDisc.name, recordId: rec11.id, bizType: 'redeem', orderId: '', operator: '系统', note: '到期日 23:59 后自动失效', date: dateStr(-11), time: '00:00:05', ts: todayAt(0, 0) - 11 * DAY + 5000 },
        { id: 'seed-cl2', action: 'issue', actionLabel: '卡券发放', couponId: cpExpired.id, code: cpExpired.code, tplId: tplDisc.id, tplName: tplDisc.name, recordId: rec11.id, bizType: 'redeem', orderId: '', operator: uname, note: '', date: dateStr(-13), time: '09:05:00', ts: todayAt(9, 5) - 13 * DAY + 1 },
        { id: 'seed-cl1', action: 'revoke', actionLabel: '撤销释放', couponId: '', code: '', tplId: 'c-video-week', tplName: '视频会员周卡', recordId: 'seed-r5', bizType: 'redeem', orderId: 'seed-rk5', operator: '系统', note: '风控撤销，券库存回补、券未发放', date: this.todayDate, time: '08:35:00', ts: todayAt(8, 35) }
      ]

      // 初始可用积分 255（含一笔历史漏记：业务台账 +5 未入账）：
      // 种子实时积分变动 -1280（冻结 -10/-200、撤销冻结 -80 后返还 +80 净 0、
      // 实物帆布袋 -150×2、限量公仔 -300×2、售后退货 -200 后退款 +200 净 0、卡券兑换 满减券×3 -90 与周卡 -80），起点补 1535 → 255。
      // 种子流水合计 -1265，rebalanceSeedPoints 倒推重放后链连续、最新快照 255。
      // 对账检出并补偿历史漏记 +5 后余额 260，与补偿流水链配平。
      this.points += 1535
      // 修正流水余额快照（append-only，重排后顺序写入当时余额）
      this.rebalanceSeedPoints()

      // 审计日志（最新在前）
      this.auditLogs = [
        { id: 'seed-log-po3', action: 'purchase-apply', actionLabel: '发起采购', orderId: 'seed-po3', operator: '运营(运营小张)', detail: `发起采购【iPhone 16】×2（活动奖品，事由：传说大奖库存不足，国庆加码），待审批`, date: this.todayDate, time: '17:15:00' },
        { id: 'seed-log-pb3', action: 'purchase-inbound', actionLabel: '验收入库', orderId: 'seed-po2', operator: '运营(仓配小李)', detail: `采购验收入库【限量联名公仔】本批 +6（待收余 4），库存 0→6；供应商/承运：潮玩供应仓`, date: this.todayDate, time: '17:30:00' },
        { id: 'seed-log-po2', action: 'purchase-approve', actionLabel: '采购审批', orderId: 'seed-po2', operator: '运营(财务小周)', detail: '审批通过采购【限量联名公仔】×10（申请人 运营小张，关联售后 seed-as3 缺货补发），等待仓配分批验收入库；备注：售后优先，同意加急采购', date: this.todayDate, time: '17:02:00' },
        { id: 'seed-log-po2a', action: 'purchase-apply', actionLabel: '发起采购', orderId: 'seed-po2', operator: '运营(运营小张)', detail: `发起采购【限量联名公仔】×10（商城商品，事由：补发售后 seed-as3 缺货挂起）；关联待补货售后单 seed-as3，入库后继续补发履约`, date: this.todayDate, time: '16:50:00' },
        { id: 'seed-log-as3', action: 'aftersale-shortage', actionLabel: '缺货待补货', orderId: 'seed-as3', operator: '运营(仓配小李)', detail: '补发【限量联名公仔】库存不足，售后单转待补货（发货单 seed-sp6，账目与库存未变动）；请发起采购，验收入库后从待处理售后继续履约', date: this.todayDate, time: '16:42:10' },
        { id: 'seed-log-pb2', action: 'purchase-inbound', actionLabel: '验收入库', orderId: 'seed-po1', operator: '运营(仓配小李)', detail: '采购验收入库【定制保温杯】本批 +20（待收余 0），库存 130→150；采购单已全部入库完成', date: this.todayDate, time: '15:05:00' },
        { id: 'seed-log-pb1', action: 'purchase-inbound', actionLabel: '验收入库', orderId: 'seed-po1', operator: '运营(仓配小李)', detail: '采购验收入库【定制保温杯】本批 +30（待收余 20），库存 100→130；供应商/承运：优品礼品供应商', date: this.todayDate, time: '09:40:00' },
        { id: 'seed-log-po1a', action: 'purchase-approve', actionLabel: '采购审批', orderId: 'seed-po1', operator: '运营(财务小周)', detail: '审批通过采购【定制保温杯】×50（申请人 运营小张），等待仓配分批验收入库；备注：预算内，同意采购', date: dateStr(-1), time: '11:05:00' },
        { id: 'seed-log-po1', action: 'purchase-apply', actionLabel: '发起采购', orderId: 'seed-po1', operator: '运营(运营小张)', detail: '发起采购【周年庆幸运转盘 / 定制保温杯】×50（活动奖品，事由：周年庆第二阶段投放加码）', date: dateStr(-1), time: '10:20:00' },
        { id: 'seed-log12', action: 'coupon-redeem', actionLabel: '卡券核销', orderId: '', operator: '运营(运营小张)', detail: `核销卡券【视频会员周卡】券码 ${cpRedeemToday.code}（用户 ${uname}，渠道 到店扫码，有效期至 ${cpRedeemToday.expireDate}）；备注：门店 POS 扫码核销，已开通 7 天会员`, date: this.todayDate, time: '15:20:36' },
        { id: 'seed-log11', action: 'coupon-issue', actionLabel: '卡券发放', orderId: '', operator: uname, detail: `发放卡券【满50减10优惠券】（券码 ${cpAvail.code}，有效期至 ${cpAvail.expireDate}）：积分兑换【满50减10优惠券】`, date: this.todayDate, time: '14:02:11' },
        { id: 'seed-log10', action: 'coupon-hold', actionLabel: '卡券预占', orderId: 'seed-rk2', operator: uname, detail: '抽奖【视频月卡】风控冻结：券库存预占 1，券码待放行后交付', date: this.todayDate, time: '09:40:08' },
        { id: 'seed-log9', action: 'ship-create', actionLabel: '生成发货单', orderId: 'seed-sp2', operator: uname, detail: '兑换实物【定制帆布袋】生成发货单，待用户填写收货信息', date: this.todayDate, time: '13:26:55' },
        { id: 'seed-log8', action: 'ship-send', actionLabel: '运营发货', orderId: 'seed-sp1', operator: '运营小张', detail: '接单发货【500元购物卡】：顺丰速运 单号 SF1024888661，收件人 李运营（上海市浦东新区 张江高科技园区博云路2号）；备注：内含购物卡，请当面验货', date: this.todayDate, time: '11:05:40' },
        { id: 'seed-log5', action: 'revoke', actionLabel: '审核撤销', orderId: 'seed-rk5', operator: '系统', detail: '撤销兑换【视频会员周卡】，返还80积分、回补库存×1、释放预占券（未发放）；备注：命中短时连续兑换规则，自动拦截，用户未申诉。', date: this.todayDate, time: '08:35:00' },
        { id: 'seed-log4', action: 'release', actionLabel: '审核放行', orderId: 'seed-rk4', operator: '运营小张', detail: '放行抽奖【500元购物卡】；备注：核实为正常用户，放行并发奖。', date: this.todayDate, time: '09:10:12' },
        { id: 'seed-log3', action: 'appeal', actionLabel: '用户申诉', orderId: 'seed-rk2', operator: uname, detail: '用户提交申诉：本人正常参与活动中奖，未使用任何外挂，请求放行。', date: this.todayDate, time: '09:45:30' },
        { id: 'seed-log2', action: 'freeze', actionLabel: '风控冻结', orderId: 'seed-rk3', operator: uname, detail: '兑换【盲盒福袋】命中规则：高价值奖品/兑换、短时间连续兑换，冻结200积分、预占库存×1', date: this.todayDate, time: '09:15:22' },
        { id: 'seed-log1', action: 'freeze', actionLabel: '风控冻结', orderId: 'seed-rk1', operator: uname, detail: '抽奖【iPhone 16】命中规则：高价值奖品/兑换，冻结0积分、预占库存×1；该笔暂缓计入抽奖任务进度', date: this.todayDate, time: '10:02:15' },
        { id: 'seed-log6', action: 'freeze', actionLabel: '风控冻结', orderId: 'seed-rk6', operator: uname, detail: `抽奖【500元购物卡】命中规则：高价值奖品/兑换，冻结0积分、预占库存×1；该笔暂缓计入抽奖任务进度（归属业务日 ${d1}，跨日审核单）`, date: d1, time: '18:06:40' },
        { id: 'seed-log7', action: 'task-settle', actionLabel: '任务结算', orderId: '', operator: '系统', detail: `抽奖任务【今日抽奖3次】达成（${d2} 有效参与 3/3），自动发放 15 积分`, date: d2, time: '08:12:40' }
      ]

      // —— 11) 星河商贸种子数据统一补打租户/追踪标记（历史种子按默认租户 t-star 归属） ——
      const tagStar = (list, fields = {}) => list.forEach((x) => {
        if (x.tenantId === undefined) x.tenantId = 't-star'
        Object.assign(x, fields)
      })
      tagStar(this.activities)
      tagStar(this.goods)
      tagStar(this.records, { userId: uid, userName: uname })
      tagStar(this.riskOrders)
      tagStar(this.shipments)
      tagStar(this.afterSales)
      tagStar(this.purchaseOrders)
      tagStar(this.inboundBatches)
      tagStar(this.acceptDiffs)
      tagStar(this.supplierBills)
      tagStar(this.coupons)
      tagStar(this.couponLogs)
      tagStar(this.pointRecords)
      tagStar(this.taskClaims)
      this.auditLogs.forEach((l) => {
        if (l.tenantId === undefined) l.tenantId = 't-star'
        if (l.module === undefined) l.module = moduleOfAction(l.action)
        if (l.result === undefined) l.result = 'success'
        if (l.traceId === undefined) l.traceId = ''
        if (l.actorKind === undefined) l.actorKind = l.operator && l.operator.startsWith('运营') ? 'staff' : (l.operator === '系统' ? 'system' : 'customer')
        if (l.memberId === undefined) {
          const opName = (l.operator || '').replace(/^运营\((.*)\)$/, '$1')
          const memberMap = { '运营小张': 'm-star-ops', '运营小王': 'm-cloud-ops', '仓配小李': 'm-star-ship', '财务小周': 'm-star-fin' }
          l.memberId = memberMap[opName] || ''
        }
        if (l.ip === undefined) l.ip = l.actorKind === 'staff' ? '10.10.1.21' : '112.65.*.*'
        if (l.channel === undefined) l.channel = l.actorKind === 'staff' ? '运营后台' : '移动端 H5'
        if (l.logTs === undefined) {
          const hh = parseInt((l.time || '00:00:00').slice(0, 2)) || 0
          const mm = parseInt((l.time || '00:00:00').slice(3, 5)) || 0
          l.logTs = todayAt(hh, mm)
        }
      })

      // —— 12) 第二租户云雀数科种子：独立活动/商品/卡券/审核单/发货单，与星河商贸数据强隔离 ——
      this.seedCloudTenant()

      // —— 13) 营销预算与成本控制种子：预算单审批流 + 历史台账快照（与种子业务占用勾稽） ——
      this.seedBudgets()
    },

    // 营销预算种子（append-only 预算单 + 历史占用快照）
    seedBudgets() {
      const mkBg = (id, tenantId, scopeType, scopeId, scopeName, unit, amount, extra = {}) => ({
        id, bNo: 'BG' + id.replace(/-/g, '').toUpperCase().slice(2),
        tenantId, traceId: '', scopeType, scopeId, scopeName, unit,
        name: extra.name || (scopeType === 'activity' ? `活动预算：${scopeName}` : `${scopeName}${unit === 'points' ? '积分' : '营销资金'}预算`),
        purpose: extra.purpose || '年度营销预算（种子）',
        amount, startDate: '2026-01-01', endDate: '2026-12-31',
        status: extra.status || 'active',
        applicant: extra.applicant || '运营小张', applicantId: extra.applicantId || 'm-star-ops',
        createdAt: '2026-01-05', time: '10:00:00', ts: new Date('2026-01-05T10:00:00').getTime(),
        reviewedAt: extra.status === 'pending' ? '' : '2026-01-06 09:30:00',
        reviewer: extra.status === 'pending' ? '' : (extra.reviewer || '财务小周'),
        reviewNote: extra.reviewNote || '', frozenAt: '', closedAt: '',
        adjustments: [], version: 1, parentId: ''
      })
      this.budgets = [
        mkBg('bg-star-pt', 't-star', 'tenant', 't-star', '星河商贸', 'points', 200000),
        mkBg('bg-star-mn', 't-star', 'tenant', 't-star', '星河商贸', 'money', 50000),
        mkBg('bg-star-a1p', 't-star', 'activity', 'act-1', '周年庆幸运转盘', 'points', 5000),
        mkBg('bg-star-a1m', 't-star', 'activity', 'act-1', '周年庆幸运转盘', 'money', 30000),
        mkBg('bg-star-a2p', 't-star', 'activity', 'act-2', '新人刮刮乐', 'points', 3000),
        mkBg('bg-star-a2m', 't-star', 'activity', 'act-2', '新人刮刮乐', 'money', 5000),
        mkBg('bg-star-nd', 't-star', 'tenant', 't-star', '星河商贸', 'money', 20000,
          { status: 'pending', name: '国庆大促追加预算（待审批）', purpose: '国庆档加码投放，申请追加资金预算 2 万元', reviewedAt: '', reviewer: '' }),
        mkBg('bg-star-old', 't-star', 'tenant', 't-star', '星河商贸', 'money', 8000,
          { status: 'closed', name: '上半年节庆营销预算（已关闭）', purpose: '春节/五一营销专项',
            reviewedAt: '2026-01-06 09:30:00', closedAt: '2026-07-01 00:00:00', reviewNote: '预算期结束，财务统一关账' }),
        mkBg('bg-cloud-pt', 't-cloud', 'tenant', 't-cloud', '云雀数科', 'points', 50000,
          { applicant: '运营小冯', applicantId: 'm-cloud-ops', reviewer: '财务小许' }),
        mkBg('bg-cloud-mn', 't-cloud', 'tenant', 't-cloud', '云雀数科', 'money', 10000,
          { applicant: '运营小冯', applicantId: 'm-cloud-ops', reviewer: '财务小许' }),
        mkBg('bg-cloud-a1p', 't-cloud', 'activity', 'cact-1', '云雀上线幸运转盘', 'points', 3000,
          { applicant: '运营小冯', applicantId: 'm-cloud-ops', reviewer: '财务小许' }),
        mkBg('bg-cloud-a1m', 't-cloud', 'activity', 'cact-1', '云雀上线幸运转盘', 'money', 8000,
          { applicant: '运营小冯', applicantId: 'm-cloud-ops', reviewer: '财务小许' })
      ]

      // 历史占用快照：按当前业务/台账推导种子已发生的成本，为每个生效预算落一张 snapshot 台账行
      // （历史成本一次性结转；后续新发生的抽奖/奖励/采购/结算逐笔实时占用，口径连续）。
      const tid = 't-star'
      const snapshot = (budgetId, category, amount, summary, ts) => ({
        id: genId('bls'), budgetId,
        bNo: this.budgets.find((b) => b.id === budgetId)?.bNo || '',
        tenantId: this.budgets.find((b) => b.id === budgetId)?.tenantId || tid,
        scopeType: this.budgets.find((b) => b.id === budgetId)?.scopeType || 'tenant',
        scopeId: this.budgets.find((b) => b.id === budgetId)?.scopeId || tid,
        unit: this.budgets.find((b) => b.id === budgetId)?.unit || 'points',
        category, kind: 'history-snapshot',
        direction: 'settle', converts: false, reserveOf: '',
        amount: Math.round(amount * 100) / 100,
        refType: 'history', refId: `snapshot:${budgetId}:${category}`, bizNo: '',
        summary, userId: CUSTOMER.id, operator: '系统', traceId: '',
        date: this.todayDate, time: '00:00:01', ts: ts || 1,
        effectId: `bg-snapshot:${budgetId}:${category}`, snapshot: true
      })
      const inT = (x) => (x.tenantId || 't-star') === tid
      // 积分成本：按业务记录与流水推导（normal/released 落账成本 + frozen 预占；revoked 不计）
      const drawCostOf = (r) => {
        const a = this.activities.find((x) => x.id === r.activityId)
        return a && a.costType === 'points' ? (a.cost || 0) : 0
      }
      const pointPrizeOf = (r) => {
        const n = parseInt(r.prizeName, 10)
        return r.prizeName?.includes('积分') && n ? n : 0
      }
      const ledger = []
      // —— 租户积分预算 ——
      let ptReserve = 0
      let ptCommitted = 0
      this.records.filter(inT).forEach((r) => {
        if (r.status === 'revoked') return
        if (r.type === 'draw') {
          const c = drawCostOf(r)
          const rp = pointPrizeOf(r)
          if (r.status === 'frozen') ptReserve += c + rp
          else ptCommitted += c + rp
        } else {
          const g = this.goods.find((x) => x.id === r.goodsId)
          if (r.status === 'frozen') ptReserve += g?.cost || 0
          else ptCommitted += g?.cost || 0
        }
      })
      // 任务奖励台账（全部按租户预算）
      const taskReward = this.taskClaims.filter((c) => (c.tenantId || 't-star') === tid).reduce((n, c) => n + (c.reward || 0), 0)
      ptCommitted += taskReward
      if (ptReserve > 0) {
        const row = snapshot('bg-star-pt', 'draw', ptReserve,
          `历史风控冻结成本预占（种子在审单 ${this.records.filter(inT).filter((r) => r.status === 'frozen').length} 笔）`, 2)
        row.direction = 'reserve'; row.kind = 'history-frozen'; row.refId = 'snapshot:bg-star-pt:reserve'; row.effectId = 'bg-snapshot:bg-star-pt:reserve'
        ledger.push(row)
      }
      if (ptCommitted > 0) {
        ledger.push(snapshot('bg-star-pt', 'points', ptCommitted,
          `历史抽奖/兑换/任务积分成本（含任务奖励 ${taskReward}，见 P1 积分发生额）`, 3))
      }
      // —— 活动积分预算：act-1（免费，仅有冻结预占的为 0）；act-2（成本 10） ——
      const actPoints = (actId) => {
        let committed = 0
        let reserve = 0
        this.records.filter((r) => inT(r) && r.type === 'draw' && r.activityId === actId && r.status !== 'revoked').forEach((r) => {
          const v = drawCostOf(r) + pointPrizeOf(r)
          if (r.status === 'frozen') reserve += v; else committed += v
        })
        return { committed, reserve }
      }
      const a2p = actPoints('act-2')
      if (a2p.committed > 0) ledger.push(snapshot('bg-star-a2p', 'draw', a2p.committed, '历史抽奖成本/积分奖励：新人刮刮乐（10 积分/次）', 4))
      if (a2p.reserve > 0) {
        const row = snapshot('bg-star-a2p', 'draw', a2p.reserve, '历史风控冻结预占：新人刮刮乐', 5)
        row.direction = 'reserve'; row.kind = 'history-frozen'; row.refId = 'snapshot:bg-star-a2p:reserve'; row.effectId = 'bg-snapshot:bg-star-a2p:reserve'
        ledger.push(row)
      }
      // —— 资金预算：已结算/待结算账单=实际成本；无有效账单的在途采购单=预占；缺货挂起补发=预占 ——
      const settledOrBillPoIds = new Set(this.supplierBills
        .filter((b) => inT(b) && b.status !== 'rejected')
        .map((b) => b.poId))
      let mnCommitted = 0
      this.supplierBills.filter((b) => inT(b) && ['approved', 'settled'].includes(b.status))
        .forEach((b) => { mnCommitted += b.payableAmount || 0 })
      let mnReserve = 0
      this.purchaseOrders.filter(inT).forEach((po) => {
        if (['pending', 'approved', 'receiving'].includes(po.status) && !settledOrBillPoIds.has(po.id)) {
          mnReserve += Math.round((po.qty || 0) * (po.unitPrice || 0) * 100) / 100
        }
      })
      const pendingPoCount = this.purchaseOrders.filter((o) => inT(o) && ['pending', 'approved', 'receiving'].includes(o.status) && !settledOrBillPoIds.has(o.id)).length
      this.afterSales.filter(inT).forEach((as) => {
        if (as.type === 'reship' && as.status === 'waiting_stock') {
          // 关联采购单已在途（seed-po2 已按数量×单价预占），补发件不重复预占；
          // 仅当没有关联采购（非采购补货来源）时才按估价预占
          const linkedPo = this.purchaseOrders.find((po) => inT(po) && po.afterSaleId === as.id)
          if (linkedPo) return
          const target = as.targetType === 'prize'
            ? this.activities.find((a) => a.id === as.activityId)?.prizes.find((p) => p.id === as.targetId)
            : this.goods.find((g) => g.id === as.targetId)
          mnReserve += Math.round((Number(target?.unitPrice) || 0) * 100) / 100
        }
      })
      if (mnCommitted > 0) ledger.push(snapshot('bg-star-mn', 'supplier', mnCommitted, '历史供应商付款/待结算应付（保温杯 625 元已付 + 福袋 79.2 元待付）', 6))
      if (mnReserve > 0) {
        const row = snapshot('bg-star-mn', 'purchase', mnReserve,
          `历史在途采购预占 + 缺货补发预占（${pendingPoCount} 张在途采购单及待补货售后）`, 7)
        row.direction = 'reserve'; row.kind = 'history-po'; row.refId = 'snapshot:bg-star-mn:reserve'; row.effectId = 'bg-snapshot:bg-star-mn:reserve'
        ledger.push(row)
      }
      // 活动资金预算 act-1：保温杯采购已结算 625
      ledger.push(snapshot('bg-star-a1m', 'supplier', 625, '历史采购付款：定制保温杯 50 件 × 12.5 元（SBSEED0001 已结算）', 8))
      // 活动资金预算 act-2：暂无资金成本（视频月卡为券类积分奖品）——不产生快照行
      // 关闭预算历史快照（不影响占用计算，但保留台账演示）
      ledger.push(snapshot('bg-star-old', 'supplier', 7680, '上半年营销采购与权益成本（已关账）', 9))
      this.budgetLedger = ledger
    },

    // 第二租户（t-cloud）演示数据：零积分成本活动 + 0 积分券兑换（不参与平台积分余额链）
    seedCloudTenant() {
      const tid = 't-cloud'
      const uid = this.user.id
      const uname = this.user.name
      const cloudAct = this.activities.find((a) => a.id === 'cact-1')
      const pSvip = cloudAct?.prizes.find((p) => p.id === 'cp1')
      const tplWelcome = this.couponTpls['cc-welcome']

      // 1) 今日 0 积分兑换新人立减券 → 待核销（独立券码段 CPC-）
      const cg1 = this.goods.find((g) => g.id === 'cg1')
      if (cg1) cg1.remain -= 1
      const recC1 = {
        id: 'seed-cr1', type: 'redeem', status: 'normal', tenantId: tid,
        userId: uid, userName: uname,
        date: this.todayDate, time: '10:12:30', ts: todayAt(10, 12),
        goodsId: 'cg1', goodsName: '云雀新人立减券', couponId: 'cc-welcome', icon: '🐦'
      }
      this.records.push(recC1)
      const expW = this._couponExpiry(tplWelcome, this.todayDate)
      this.coupons.push({
        id: 'seed-ccp1', code: 'CPC-CL0UD-WELCM', tplId: 'cc-welcome', name: tplWelcome.name,
        type: tplWelcome.type, typeLabel: '新人立减券', emoji: '🐦',
        denomination: 5, threshold: 0, face: '', desc: tplWelcome.desc, validityDays: 20,
        status: 'available', tenantId: tid, userId: uid, userName: uname,
        recordId: recC1.id, bizType: 'redeem', activityId: null, source: '积分兑换',
        issueDate: this.todayDate, time: '10:12:30', ts: todayAt(10, 12) + 1,
        traceId: '', expireDate: expW.date, expireTs: expW.ts,
        redeemedAt: '', redeemOperator: '', redeemChannel: '', redeemNote: '',
        compensateBillId: '', comp: false
      })

      // 2) 今日转盘抽中 SVIP 季卡命中风控：券库存预占、券未发出（待云雀风控专员/管理员处理）
      if (pSvip) { pSvip.remain -= 1; pSvip.frozen += 1 }
      const recC2 = {
        id: 'seed-cr2', type: 'draw', status: 'frozen', tenantId: tid,
        userId: uid, userName: uname,
        date: this.todayDate, time: '11:05:50', ts: todayAt(11, 5),
        activityId: 'cact-1', activityName: '云雀上线幸运转盘',
        prizeId: 'cp1', prizeName: '云雀 SVIP 季卡', rarity: 'legendary',
        couponId: 'cc-svip', icon: '💎', riskOrderId: 'seed-crk1'
      }
      this.records.push(recC2)
      this.riskOrders.push({
        id: 'seed-crk1', bizType: 'draw', status: 'pending', tenantId: tid,
        userId: uid, userName: uname,
        recordId: recC2.id, activityId: 'cact-1', targetId: 'cp1', targetName: '云雀 SVIP 季卡',
        icon: '💎', rarity: 'legendary', frozenPoints: 0, stockHeld: 1,
        rules: [{ code: 'highValue', label: RULE_LABELS.highValue }],
        appealReason: '', appealAt: '', reviewNote: '', reviewer: '',
        createdAt: this.todayDate, time: '11:05:50', ts: todayAt(11, 5), reviewedAt: ''
      })

      // 3) 昨日已签收的马克杯订单（实物闭环演示；不制造积分流水）
      const cg2 = this.goods.find((g) => g.id === 'cg2')
      if (cg2) cg2.remain -= 1
      const d1 = dateStr(-1)
      const recC3 = {
        id: 'seed-cr3', type: 'redeem', status: 'normal', tenantId: tid,
        userId: uid, userName: uname,
        date: d1, time: '15:22:10', ts: todayAt(15, 22) - 86400000,
        goodsId: 'cg2', goodsName: '云雀定制马克杯', icon: '☕'
      }
      this.records.push(recC3)
      this.shipments.push({
        id: 'seed-csp1', recordId: recC3.id, bizType: 'redeem', status: 'received',
        tenantId: tid, traceId: '', userId: uid, userName: uname,
        icon: '☕', targetName: '云雀定制马克杯', activityId: null, source: '积分兑换',
        date: d1, time: '15:22:10', ts: todayAt(15, 22) - 86400000,
        receiver: '运营测试用户', phone: '138****0001', region: '浙江省杭州市西湖区',
        address: '文三路云雀大厦 9 层', addressAt: `${d1} 15:30:00`,
        shipper: '运营小冯', carrier: '圆通速递', trackingNo: 'YT992100046',
        shipNote: '', shippedAt: `${d1} 17:10:00`, receivedAt: this.todayDate + ' 10:20:00',
        traces: [
          { stage: 'collected', text: '圆通速递 已揽收包裹（单号 YT992100046）', date: d1, time: '17:10:00', ts: todayAt(17, 10) - 86400000 },
          { stage: 'signed', text: '包裹已签收，签收人：本人（用户确认收货）', date: this.todayDate, time: '10:20:00', ts: todayAt(10, 20) }
        ],
        afterSaleId: '', returnedAt: '', originId: ''
      })

      // 4) 卡券台账与审计留痕（append-only）
      this.couponLogs.push(
        { id: 'seed-ccl2', action: 'hold', actionLabel: '风控预占', couponId: '', code: '', tplId: 'cc-svip', tplName: '云雀 SVIP 季卡', recordId: recC2.id, bizType: 'draw', orderId: 'seed-crk1', tenantId: tid, traceId: '', operator: uname, note: '风控冻结，券库存预占、待放行交付', date: this.todayDate, time: '11:05:50', ts: todayAt(11, 5) },
        { id: 'seed-ccl1', action: 'issue', actionLabel: '卡券发放', couponId: 'seed-ccp1', code: 'CPC-CL0UD-WELCM', tplId: 'cc-welcome', tplName: tplWelcome.name, recordId: recC1.id, bizType: 'redeem', orderId: '', tenantId: tid, traceId: '', operator: uname, note: '', date: this.todayDate, time: '10:12:30', ts: todayAt(10, 12) + 1 }
      )
      const cloudAudit = (id, action, label, orderId, operator, detail, date, time, result = 'success', module = moduleOfAction(action)) => ({
        id, action, actionLabel: label, module, orderId, operator,
        actorKind: operator.startsWith('运营') ? 'staff' : operator === '系统' ? 'system' : 'customer',
        memberId: operator === '运营小冯' ? 'm-cloud-ops' : '',
        tenantId: tid, traceId: '', channel: operator.startsWith('运营') ? '运营后台' : '移动端 H5',
        ip: operator.startsWith('运营') ? '172.16.2.20' : '112.65.*.*', result,
        detail, date, time,
        logTs: (() => { const hh = parseInt(time.slice(0, 2)); const mm = parseInt(time.slice(3, 5)); return todayAt(hh, mm) - (date === this.todayDate ? 0 : 86400000) })()
      })
      this.auditLogs.push(
        cloudAudit('seed-clog4', 'freeze', '风控冻结', 'seed-crk1', uname, '云雀数科：抽奖【云雀 SVIP 季卡】命中规则：高价值奖品/兑换，预占库存×1；该笔暂缓计入抽奖任务进度', this.todayDate, '11:05:50'),
        cloudAudit('seed-clog3', 'ship-receive', '确认收货', 'seed-csp1', uname, '确认收货【云雀定制马克杯】（圆通速递 YT992100046），订单完成', this.todayDate, '10:20:00'),
        cloudAudit('seed-clog2', 'ship-send', '运营发货', 'seed-csp1', '运营小冯', '云雀数科：接单发货【云雀定制马克杯】：圆通速递 单号 YT992100046', d1, '17:10:00'),
        cloudAudit('seed-clog1', 'coupon-issue', '卡券发放', '', uname, '云雀数科：发放卡券【云雀新人立减券】（券码 CPC-CL0UD-WELCM）：0 积分兑换', this.todayDate, '10:12:30'),
        // 权限中心演示：越权访问与停用账号登录被拒绝（result=denied）
        cloudAudit('seed-clog-deny1', 'cross-tenant-denied', '越权拦截', '', '仓配小李',
          '⛔ 星河商贸员工【仓配小李】尝试切换/访问云雀数科数据被拒绝（数据强隔离：员工仅可访问归属租户）',
          this.todayDate, '08:40:12', 'denied', 'auth'),
        cloudAudit('seed-clog-deny2', 'perm-denied', '权限拦截', '', '客服小吴',
          '⛔ 停用账号【客服小吴】尝试登录被拒绝（离职停用）',
          this.todayDate, '09:02:44', 'denied', 'auth')
      )
    },

    // 按时间正序重放种子流水，修正每行 balance 快照
    rebalanceSeedPoints() {
      const seeds = this.pointRecords.filter((p) => p.id.startsWith('seed-'))
      if (!seeds.length) return
      const sorted = [...seeds].sort((a, b) => a.ts - b.ts)
      let bal = this.points - sorted.reduce((s, p) => s + p.delta, 0)
      sorted.forEach((p) => {
        bal += p.delta
        p.balance = bal
      })
    },

    // ===== 离线快照（本地模式 → 服务端上云迁移）=====
    // 导出与服务端 MigrationService 同构的历史台账快照（JSON 可下载/可粘贴上云）。
    exportOfflineSnapshot() {
      const clone = (x) => JSON.parse(JSON.stringify(x))
      return {
        source: 'legacy-pinia-store@offline',
        migratedAt: 'all',
        exportedAt: this.todayDate,
        tenants: clone(this.tenants),
        members: clone(this.members.filter((m) => m.tenantId)),
        customRoles: clone(this.customRoles),
        tasks: clone(this.tasks),
        riskRulesByTenant: clone(this.riskRulesByTenant),
        activities: clone(this.activities),
        goods: clone(this.goods),
        pointRecords: clone(this.pointRecords),
        records: clone(this.records),
        riskOrders: clone(this.riskOrders),
        taskClaims: clone(this.taskClaims),
        coupons: clone(this.coupons),
        couponLogs: clone(this.couponLogs),
        shipments: clone(this.shipments),
        afterSales: clone(this.afterSales),
        reconBills: clone(this.reconBills),
        stockAdjustments: clone(this.stockAdjustments),
        budgets: clone(this.budgets),
        budgetLedger: clone(this.budgetLedger),
        auditLogs: clone(this.auditLogs),
        legacyPoints: this.points,
        legacyOwner: 'u-1001'
      }
    },

    // 下载离线快照文件（浏览器环境）
    downloadOfflineSnapshot() {
      const snap = this.exportOfflineSnapshot()
      const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `lottery-offline-snapshot-${this.todayDate}.json`
      a.click()
      URL.revokeObjectURL(url)
      this.showToast('离线快照已导出，可在连上服务端后一键迁移上云', 'success')
      return snap
    },

    // 读取本地文件为快照 JSON（返回 Promise）
    readOfflineSnapshotFile(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          try { resolve(JSON.parse(String(reader.result))) } catch (e) { reject(e) }
        }
        reader.onerror = reject
        reader.readAsText(file)
      })
    }
  }
})
