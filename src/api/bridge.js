// 远程履约桥（Pinia 插件）：server 模式下拦截 store 的写操作，改走服务端 REST API。
//
// 统一保障：
//  1) 租户权限：所有写接口由服务端 RBAC + tenantId 归属强校验；前端只做即时提示，服务端为准；
//  2) 幂等：每笔写操作自动带 Idempotency-Key（交易类用业务幂等键），重试/双击/崩溃重连不重复落账；
//  3) 并发：库存/积分/预算的并发安全由服务端 KeyedLock + Saga 保证，前端不本地预扣，以水合快照为准；
//  4) WAL 恢复：服务端崩溃重启自动续办 processing Saga，前端只需重新水合；
//  5) 离线快照迁移：本地模式可导出快照，上线时经 /api/migration/validate → run 幂等上云。
//
// 行为约定：被拦截 action 仍同步返回（保持组件签名不变）：
//  - 交易类（draw/redeem）本地不预演，返回一个「pending 占位记录」驱动 UI，响应回来后以服务端记录修正 + 全量水合；
//  - 大多数管理类动作本地不预演，响应后水合；错误统一 toast（服务端文案）。
import {
  api, ApiError, getToken, setToken, getSession, genIdemKey,
  rememberIdemKey, rememberedIdemKey, isServerConfigured, onServerEvent, configureBase
} from '@/api/client'

// 已桥接的写操作 → 服务端调用（返回 Promise<响应 data>）
const HANDLERS = {
  draw: (s, [activityId]) => {
    // 业务幂等键：同一点击意图（组件重试/网络抖动）复用；按 活动+用户+本地会话 生成并记忆
    const scope = `draw:${activityId}:${s.user.id}:${Date.now().toString(36).slice(0, 6)}`
    const key = rememberedIdemKey(scope) || genIdemKey('draw')
    rememberIdemKey(scope, key)
    return api.draw(activityId, key).then((r) => r.data)
  },
  redeem: (s, [goodsId]) => {
    const scope = `redeem:${goodsId}:${s.user.id}:${Date.now().toString(36).slice(0, 6)}`
    const key = rememberedIdemKey(scope) || genIdemKey('redeem')
    rememberIdemKey(scope, key)
    return api.redeem(goodsId, key).then((r) => r.data)
  },
  completeTask: (s, [taskId]) => api.claimTask(taskId).then((r) => r.data),
  checkInTask: () => api.claimTask('t-checkin').then((r) => r.data),

  appealRisk: (s, [orderId, reason]) => api.riskAppeal(orderId, reason).then((r) => r.data),
  releaseRisk: (s, [orderId, note]) => api.riskReview(orderId, 'release', note || '').then((r) => r.data),
  revokeRisk: (s, [orderId, note]) => api.riskReview(orderId, 'revoke', note || '').then((r) => r.data),
  updateRiskRules: (s, [patch]) => api.riskRules(patch).then((r) => r.data),

  submitShipAddress: (s, [shipmentId, form]) => api.shipAddress(shipmentId, form).then((r) => r.data),
  shipShipment: (s, [shipmentId, form]) => api.shipSend(shipmentId, form).then((r) => r.data),
  receiveShipment: (s, [shipmentId]) => api.shipReceive(shipmentId).then((r) => r.data),
  syncShipmentTrace: (s, [shipmentId]) => api.shipTrace(shipmentId).then((r) => r.data),
  applyAfterSale: (s, [shipmentId, type, reason]) => api.aftersaleApply(shipmentId, type, reason).then((r) => r.data),
  reviewAfterSale: (s, [afterSaleId, approve, note]) =>
    api.aftersaleReview(afterSaleId, approve, note || '').then((r) => r.data),

  createPurchaseOrder: (s, [form]) => api.purchaseCreate(form).then((r) => r.data),
  cancelPurchaseOrder: (s, [poId]) => api.purchaseCancel(poId).then((r) => r.data),
  reviewPurchaseOrder: (s, [poId, approve, note]) =>
    api.purchaseReview(poId, approve, note || '').then((r) => r.data),
  inboundPurchase: (s, [poId, form]) => api.purchaseInbound(poId, form || {}).then((r) => r.data),

  createSupplierBill: (s, [poId, form]) => api.supplierBillCreate(poId, form || {}).then((r) => r.data),
  submitSupplierBill: (s, [billId, form]) => api.supplierBillSubmit(billId, form || {}).then((r) => r.data),
  reviewSupplierBill: (s, [billId, approve, note]) =>
    api.supplierBillReview(billId, approve, note || '').then((r) => r.data),
  settleSupplierBill: (s, [billId, note]) => api.supplierBillSettle(billId, note || '').then((r) => r.data),

  createBudget: (s, [form]) => api.budgetCreate(form).then((r) => r.data),
  reviewBudget: (s, [budgetId, approve, note]) => api.budgetReview(budgetId, approve, note || '').then((r) => r.data),
  cancelBudget: (s, [budgetId]) => api.budgetCancel(budgetId).then((r) => r.data),
  setBudgetFrozen: (s, [budgetId, frozen, note]) =>
    (frozen ? api.budgetFreeze(budgetId, note || '') : api.budgetActivate(budgetId, note || '')).then((r) => r.data),
  closeBudget: (s, [budgetId, note]) => api.budgetClose(budgetId, note || '').then((r) => r.data),
  requestBudgetAdjust: (s, [budgetId, delta, reason]) =>
    api.budgetAdjust(budgetId, delta, reason).then((r) => r.data),
  reviewBudgetAdjust: (s, [budgetId, adjustId, approve, note]) =>
    api.budgetAdjustReview(budgetId, adjustId, approve, note || '').then((r) => r.data),

  redeemCoupon: (s, [code, form]) => api.couponRedeem(code, form || {}).then((r) => r.data),
  runRecon: (s, [date]) => api.reconRun(date).then((r) => r.data),
  reviewRecon: (s, [date, note]) => api.reconReview(date, note || '').then((r) => r.data),
  compensateRecon: (s, [date, note]) => api.reconCompensate(date, note || '').then((r) => r.data),

  createActivity: (s, [payload]) => api.activityCreate(payload).then((r) => r.data),
  toggleActivityStatus: (s, [id]) => api.activityToggle(id).then((r) => r.data),
  resetActivityStock: (s, [id]) => api.activityResetStock(id).then((r) => r.data),
  deleteActivity: (s, [id]) => api.activityDelete(id).then((r) => r.data),

  createMember: (s, [form]) => api.memberCreate(form).then((r) => r.data),
  updateMember: (s, [memberId, patch]) => api.memberUpdate(memberId, patch).then((r) => r.data),
  assignMemberRole: (s, [memberId, roleKey]) => api.memberRole(memberId, roleKey).then((r) => r.data),
  toggleMember: (s, [memberId, reason]) => api.memberToggle(memberId, reason || '').then((r) => r.data),
  createRole: (s, [form]) => api.roleCreate(form).then((r) => r.data),
  updateRolePermissions: (s, [roleId, perms]) => api.roleUpdate(roleId, perms).then((r) => r.data),
  deleteRole: (s, [roleId]) => api.roleDelete(roleId).then((r) => r.data),
  createTenant: (s, [form]) => api.tenantCreate(form).then((r) => r.data),
  toggleTenant: (s, [tenantId, reason]) => api.tenantToggle(tenantId, reason || '').then((r) => r.data),
  updateTenant: (s, [tenantId, patch]) => api.tenantUpdate(tenantId, patch).then((r) => r.data)
}

// 成功响应后提取「主要实体」用于同步返回（保持组件依赖的返回值约定）
function resultOf(action, data) {
  if (!data) return null
  const map = {
    draw: data.trade, redeem: data.trade,
    appealRisk: data.order, releaseRisk: data.order, revokeRisk: data.order,
    submitShipAddress: data.shipment, shipShipment: data.shipment,
    receiveShipment: data.shipment, syncShipmentTrace: data.shipment,
    applyAfterSale: data.afterSale, reviewAfterSale: data.afterSale,
    createPurchaseOrder: data.purchase, cancelPurchaseOrder: data.purchase,
    reviewPurchaseOrder: data.purchase, inboundPurchase: data.order,
    createSupplierBill: data.bill, submitSupplierBill: data.bill,
    reviewSupplierBill: data.bill, settleSupplierBill: data.bill,
    createBudget: data.budget, reviewBudget: data.budget, cancelBudget: data.budget,
    setBudgetFrozen: data.budget, closeBudget: data.budget, reviewBudgetAdjust: data.budget,
    requestBudgetAdjust: data.adjustment,
    redeemCoupon: data.coupon || data,
    runRecon: data.bill, reviewRecon: data.bill,
    createActivity: data.activity, toggleActivityStatus: data.activity,
    resetActivityStock: data.activity,
    createMember: data.member, updateMember: data.member, assignMemberRole: data.member,
    toggleMember: data.member,
    createRole: data.role, updateRolePermissions: data.role,
    createTenant: data.tenant, toggleTenant: data.tenant, updateTenant: data.tenant
  }
  return map[action] !== undefined ? (map[action] === null ? null : map[action]) : true
}

// 服务端错误码 → toast 类型
function toastFor(err) {
  if (err instanceof ApiError) {
    if (err.status === 403) return { msg: `⛔ ${err.message}`, type: 'warn' }
    if (err.status === 409) return { msg: err.message, type: 'warn' }
    if (err.status === 404) return { msg: err.message, type: 'warn' }
    if (err.status === 0) return { msg: `📡 ${err.message}`, type: 'warn' }
    return { msg: err.message, type: 'warn' }
  }
  return { msg: '操作失败，请稍后重试', type: 'warn' }
}

let hydrating = false

export function createRemoteBridge() {
  return function remoteBridge({ store }) {
    if (store.$id !== 'platform') return

    // —— 水合：以服务端 /api/state 全量快照为唯一事实来源，重建前端 store 视图 ——
    async function hydrate({ silent = false } = {}) {
      if (hydrating || !getToken()) return
      hydrating = true
      try {
        const { data } = await api.state()
        applySnapshot(store, data)
        store.serverConnected = true
        store.serverVersion = data.version
        if (!silent) store.serverSyncing = false
      } catch (e) {
        store.serverConnected = false
        if (e instanceof ApiError && e.status === 401) {
          // 会话失效：清理本地令牌，回到未登录态（保留离线快照）
          setToken('', null)
          store.serverMode = false
          store.showToast('服务端会话已失效，请重新登录', 'warn')
        }
      } finally {
        hydrating = false
        store.serverSyncing = false
      }
    }
    store.hydrateFromServer = hydrate
    let hydrateTimer = null
    function scheduleHydrate(delay = 250) {
      store.serverSyncing = true
      clearTimeout(hydrateTimer)
      hydrateTimer = setTimeout(() => hydrate({}), delay)
    }
    store.scheduleHydrate = scheduleHydrate

    // —— 模式切换 / 登录 / 登出 ——
    store.connectServer = async function (baseUrl) {
      return connectFlow(store, baseUrl)
    }
    store.loginRemoteCustomer = async function (userId, tenantId) {
      const { data } = await api.loginCustomer(userId, tenantId)
      setToken(data.token, data.session)
      applySession(store, data.session)
      await hydrate({})
      return data.session
    }
    store.loginRemoteMember = async function (memberId) {
      const { data } = await api.loginMember(memberId)
      setToken(data.token, data.session)
      applySession(store, data.session)
      await hydrate({})
      return data.session
    }
    store.logoutRemote = async function () {
      try { await api.logout() } catch { /* 忽略 */ }
      setToken('', null)
      store.serverMode = false
    }
    store.remoteSwitchTenant = async function (tenantId) {
      const { data } = await api.switchTenant(tenantId)
      setToken(getToken(), data.session)
      applySession(store, data.session)
      await hydrate({})
    }

    // 拦截全部已桥接 action
    Object.keys(HANDLERS).forEach((action) => {
      const original = store[action]
      if (typeof original !== 'function') return
      store[action] = function (...args) {
        if (!store.serverMode || !getToken()) {
          return original.apply(store, args)
        }
        // 乐观占位：抽奖/兑换返回 pending 记录让动画/风控提示可继续（响应回来后由水合修正）
        const pending = pendingPlaceholder(action, args, store)
        store.serverSyncing = true
        const job = Promise.resolve()
          .then(() => HANDLERS[action](store, args))
          .then((data) => {
            const out = resultOf(action, data)
            scheduleHydrate(180)
            if (action === 'draw' || action === 'redeem') {
              store._lastRemoteTrade = { at: Date.now(), trade: out }
            }
            return out
          })
          .catch((err) => {
            const t = toastFor(err)
            store.showToast(t.msg, t.type)
            store.serverSyncing = false
            if (err instanceof ApiError && err.status === 401) hydrate({ silent: true })
            throw err
          })
        // 组件可在 server 模式下 await pending.$remote 拿真实交易记录（驱动动画/风控提示）
        if (pending && typeof pending === 'object') pending.$remote = job
        return pending
      }
    })

    // 身份切换动作（登录/切租户）也需走服务端
    wrapIdentity(store, hydrate)

    // 启动：若本地有令牌则进入 server 模式并尝试水合
    if (getToken()) {
      const sess = getSession()
      store.serverMode = true
      if (sess) applySession(store, sess)
      hydrate({ silent: true })
    }

    // 网络/错误事件：连接状态
    onServerEvent((type) => {
      if (type === 'network-error') store.serverConnected = false
      if (type === 'api-ok') store.serverConnected = true
    })

    // 页面重新可见时自动水合（兜底对账/他人变更/WAL 续办后的状态一致）
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && store.serverMode && getToken()) {
          hydrate({ silent: true })
        }
      })
    }
  }
}

// 抽奖/兑换乐观占位记录（仅驱动本轮 UI，非真实落账；服务端响应后以水合覆盖）
function pendingPlaceholder(action, args, store) {
  if (action !== 'draw' && action !== 'redeem') {
    // 管理类动作：组件多以布尔/实体判断，pending 期间返回 truthy 占位，水合后 UI 自然刷新
    return action === 'deleteActivity' ? true : { __pending: true }
  }
  const id = `pending-${action}-${Date.now()}`
  if (action === 'draw') {
    const act = store.activities.find((a) => a.id === args[0])
    return {
      id, __pending: true, type: 'draw', status: 'normal',
      tenantId: store.activeTenantId, userId: store.user.id,
      date: store.todayDate, activityId: args[0],
      activityName: act?.name || '', prizeName: '…', rarity: 'common', icon: '🎁'
    }
  }
  const g = store.goods.find((x) => x.id === args[0])
  return {
    id, __pending: true, type: 'redeem', status: 'normal',
    tenantId: store.activeTenantId, userId: store.user.id,
    date: store.todayDate, goodsId: args[0], goodsName: g?.name || '', icon: g?.icon || '🛍️'
  }
}

// 把服务端会话应用到本地身份视图（不动业务数据，业务数据由水合负责）
function applySession(store, sess) {
  store.identityKind = sess.identityKind
  store.currentMemberId = sess.memberId || ''
  store.activeTenantId = sess.tenantId || 't-star'
  if (sess.identityKind === 'customer') {
    store.role = 'user'
    store.user = { id: sess.userId, name: sess.name, avatar: store.user.avatar || '🦊' }
  } else {
    store.role = 'operator'
    const m = store.members.find((x) => x.id === sess.memberId)
    store.user = { id: sess.memberId || sess.userId, name: sess.name, avatar: m?.avatar || '⚙️' }
  }
}

// 全量快照 → store 状态（字段与 Pinia store state 对齐；函数/派生 getter 不受影响）
function applySnapshot(store, snap) {
  const fields = [
    'tenants', 'members', 'customRoles', 'riskRulesByTenant',
    'activities', 'goods', 'tasks', 'points', 'pointRecords', 'records', 'riskOrders',
    'taskClaims', 'coupons', 'couponLogs', 'shipments', 'afterSales',
    'purchaseOrders', 'inboundBatches', 'acceptDiffs', 'supplierBills',
    'budgets', 'budgetLedger', 'reconBills', 'stockAdjustments', 'auditLogs'
  ]
  // 注意：couponTpls 在前端是 getter（静态券模板），不作为 state 水合
  fields.forEach((f) => { if (snap[f] !== undefined) store[f] = snap[f] })
  if (snap.todayDate) store.todayDate = snap.todayDate
  if (snap.session) applySession(store, snap.session)
  // 手动任务领取状态并入 tasks（前端组件读 t.claimed / t.done）
  const claimed = snap.manualClaimed || {}
  store.tasks = (store.tasks || []).map((t) =>
    claimed[t.id] ? { ...t, done: true, claimed: true } : { ...t, done: false, claimed: false })
  store._lastHydratedAt = Date.now()
}

// 身份动作桥接（组件 TenantCenter / App 顶栏调用）
function wrapIdentity(store, hydrate) {
  const loginMember = store.loginAsMember
  store.loginAsMember = function (memberId, opts = {}) {
    if (!store.serverMode || !getToken()) return loginMember.call(store, memberId, opts)
    return store.loginRemoteMember(memberId).then(
      () => { if (!opts.silent) store.showToast(`已登录：${store.user.name}`, 'success') },
      (e) => store.showToast(e?.message || '登录失败', 'warn')
    )
  }
  const loginCustomer = store.loginAsCustomer
  store.loginAsCustomer = function (opts = {}) {
    if (!store.serverMode || !getToken()) return loginCustomer.call(store, opts)
    return store.loginRemoteCustomer('u-1001', store.activeTenantId).then(
      () => { if (!opts.silent) store.showToast('已切换为消费者身份', 'info') },
      () => {}
    )
  }
  const switchTenant = store.switchTenant
  store.switchTenant = function (tenantId) {
    if (!store.serverMode || !getToken()) return switchTenant.call(store, tenantId)
    return store.remoteSwitchTenant(tenantId).catch((e) => store.showToast(e?.message || '切换失败', 'warn'))
  }
  void hydrate
}

// 连接引导：探测健康 → 默认消费者登录 → 水合
async function connectFlow(store, baseUrl) {
  if (baseUrl) configureBase(baseUrl)
  store.serverMode = true
  const { data } = await api.loginCustomer('u-1001', store.activeTenantId || 't-star')
  setToken(data.token, data.session)
  applySession(store, data.session)
  await store.hydrateFromServer({})
  return data.session
}

export { isServerConfigured }
