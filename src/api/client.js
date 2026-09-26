// 服务端 API 客户端（零第三方依赖）：
// - token 会话持久化（localStorage），刷新页面不掉线；
// - 统一 Idempotency-Key（写操作自动生成 + 可显式传入，键持久化保证重试/崩溃后续办同一笔）；
// - 错误标准化为 { code, message, status }，与前端 toast/deny 语义对齐；
// - 在线状态探测（health），供前端在「本地快照模式 / 服务端履约模式」间切换。
const TOKEN_KEY = 'lp.server.token'
const SESSION_KEY = 'lp.server.session'
const BASE_KEY = 'lp.server.base'
const DEFAULT_BASE = '/api-proxy' // vite dev 代理；生产可改为 http://host:8080

let listeners = []
export function onServerEvent(fn) { listeners.push(fn); return () => { listeners = listeners.filter((x) => x !== fn) } }
function emit(type, payload) { listeners.slice().forEach((fn) => { try { fn(type, payload) } catch { /* 忽略监听器异常 */ } }) }

function base() {
  return localStorage.getItem(BASE_KEY) || (location.hostname ? DEFAULT_BASE : DEFAULT_BASE)
}
export function serverBase() { return base() }
export function configureBase(url) {
  if (url) localStorage.setItem(BASE_KEY, url.replace(/\/$/, ''))
  else localStorage.removeItem(BASE_KEY)
}

export function getToken() { return localStorage.getItem(TOKEN_KEY) || '' }
export function setToken(token, session) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  else localStorage.removeItem(SESSION_KEY)
}
export function getSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null') } catch { return null }
}
export function isServerConfigured() { return !!getToken() }

// 服务端是否可达（健康检查，3s 超时）
export async function ping(timeoutMs = 3000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const r = await fetch(`${base().replace(/\/api-proxy$/, '')}/health`, { signal: ctrl.signal })
    clearTimeout(t)
    return r.ok
  } catch {
    clearTimeout(t)
    return false
  }
}

export class ApiError extends Error {
  constructor(code, message, status) {
    super(message)
    this.code = code
    this.status = status
  }
}

// 幂等键生成：前缀 + 时间基址 + 随机段（同一逻辑动作重试时复用同一键）
export function genIdemKey(prefix = 'op') {
  const rnd = Math.random().toString(36).slice(2, 10)
  return `${prefix}-${Date.now().toString(36)}-${rnd}`
}

async function request(method, path, payload, opts = {}) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  // 写操作统一带幂等键：调用方可显式传入（跨重试），否则自动生成（HTTP 层 24h 去重）
  let idemKey = opts.idempotencyKey
  if (!idemKey && method === 'POST' && opts.idempotent !== false) {
    idemKey = genIdemKey(opts.idemPrefix || path.replace(/[^a-z0-9]+/gi, '').slice(-12) || 'op')
  }
  if (idemKey) headers['Idempotency-Key'] = idemKey

  let res
  try {
    res = await fetch(base() + path, {
      method,
      headers,
      body: method === 'GET' ? undefined : JSON.stringify(payload || {})
    })
  } catch (e) {
    emit('network-error', { path, message: e.message })
    throw new ApiError('NETWORK_ERROR', `无法连接服务端（${e.message}）`, 0)
  }

  let data = null
  try { data = await res.json() } catch { /* 空响应 */ }
  if (!res.ok || (data && data.ok === false)) {
    const err = data?.error || {}
    const apiErr = new ApiError(err.code || 'HTTP_ERROR', err.message || `请求失败（${res.status}）`, res.status)
    apiErr.data = data
    emit('api-error', { path, status: res.status, error: apiErr })
    throw apiErr
  }
  emit('api-ok', { path, data })
  return { data, idemKey }
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body, opts) => request('POST', path, body, opts),

  // —— 鉴权 ——
  loginCustomer: (userId, tenantId) => request('POST', '/auth/customer-login', { userId, tenantId }, { idempotent: false }),
  loginMember: (memberId) => request('POST', '/auth/member-login', { memberId }, { idempotent: false }),
  switchTenant: (tenantId) => request('POST', '/auth/switch-tenant', { tenantId }, { idempotent: false }),
  logout: () => request('POST', '/auth/logout', {}, { idempotent: false }),
  catalogOrg: () => request('GET', '/catalog/org'),

  // —— 水合 ——
  state: () => request('GET', '/state'),

  // —— 交易（业务幂等键必带，服务端 Saga 判重）——
  draw: (activityId, idempotencyKey) =>
    request('POST', '/draw', { activityId, idempotencyKey }, { idempotencyKey, idemPrefix: 'draw' }),
  redeem: (goodsId, idempotencyKey) =>
    request('POST', '/redeem', { goodsId, idempotencyKey }, { idempotencyKey, idemPrefix: 'redeem' }),
  claimTask: (taskId) => request('POST', '/tasks/claim', { taskId }, { idemPrefix: 'task' }),

  // —— 风控 ——
  riskAppeal: (orderId, reason) => request('POST', '/risk/appeal', { orderId, reason }, { idemPrefix: 'appeal' }),
  riskReview: (orderId, action, note) => request('POST', '/risk/review', { orderId, action, note }, { idemPrefix: 'riskrv' }),
  riskRules: (patch) => request('POST', '/risk/rules', patch, { idemPrefix: 'rules' }),

  // —— 物流 / 售后 ——
  shipAddress: (shipmentId, form) => request('POST', '/shipments/address', { shipmentId, ...form }, { idemPrefix: 'addr' }),
  shipSend: (shipmentId, form) => request('POST', '/shipments/send', { shipmentId, ...form }, { idemPrefix: 'send' }),
  shipReceive: (shipmentId) => request('POST', '/shipments/receive', { shipmentId }, { idemPrefix: 'recv' }),
  shipTrace: (shipmentId) => request('POST', '/shipments/trace', { shipmentId }, { idemPrefix: 'trace' }),
  aftersaleApply: (shipmentId, type, reason) =>
    request('POST', '/aftersales/apply', { shipmentId, type, reason }, { idemPrefix: 'asapply' }),
  aftersaleReview: (afterSaleId, approve, note) =>
    request('POST', '/aftersales/review', { afterSaleId, approve, note }, { idemPrefix: 'asreview' }),

  // —— 采购 ——
  purchaseCreate: (body) => request('POST', '/purchases/create', body, { idemPrefix: 'pocreate' }),
  purchaseReview: (purchaseId, approve, note) =>
    request('POST', '/purchases/review', { purchaseId, approve, note }, { idemPrefix: 'poreview' }),
  purchaseCancel: (purchaseId) => request('POST', '/purchases/cancel', { purchaseId }, { idemPrefix: 'pocancel' }),
  purchaseInbound: (purchaseId, body) =>
    request('POST', '/purchases/inbound', { purchaseId, ...body }, { idemPrefix: 'inbound' }),

  // —— 供应商结算 ——
  supplierBillCreate: (purchaseId, body) =>
    request('POST', '/supplier/bills/create', { purchaseId, ...body }, { idemPrefix: 'billc' }),
  supplierBillSubmit: (billId, body) =>
    request('POST', '/supplier/bills/submit', { billId, ...body }, { idemPrefix: 'billsub' }),
  supplierBillReview: (billId, approve, note) =>
    request('POST', '/supplier/bills/review', { billId, approve, note }, { idemPrefix: 'billrv' }),
  supplierBillSettle: (billId, note) =>
    request('POST', '/supplier/bills/settle', { billId, note }, { idemPrefix: 'settle' }),

  // —— 预算 ——
  budgetCreate: (body) => request('POST', '/budgets/create', body, { idemPrefix: 'bgc' }),
  budgetReview: (budgetId, approve, note) =>
    request('POST', '/budgets/review', { budgetId, approve, note }, { idemPrefix: 'bgrv' }),
  budgetCancel: (budgetId) => request('POST', '/budgets/cancel', { budgetId }, { idemPrefix: 'bgcancel' }),
  budgetFreeze: (budgetId, note) => request('POST', '/budgets/freeze', { budgetId, note }, { idemPrefix: 'bgfrz' }),
  budgetActivate: (budgetId, note) => request('POST', '/budgets/activate', { budgetId, note }, { idemPrefix: 'bgact' }),
  budgetClose: (budgetId, note) => request('POST', '/budgets/close', { budgetId, note }, { idemPrefix: 'bgclose' }),
  budgetAdjust: (budgetId, delta, reason) =>
    request('POST', '/budgets/adjust', { budgetId, delta, reason }, { idemPrefix: 'bgadj' }),
  budgetAdjustReview: (budgetId, adjustId, approve, note) =>
    request('POST', '/budgets/adjust-review', { budgetId, adjustId, approve, note }, { idemPrefix: 'bgadjrv' }),

  // —— 卡券 / 对账 / 活动 ——
  couponRedeem: (code, form) => request('POST', '/coupons/redeem', { code, ...form }, { idemPrefix: 'cpredeem' }),
  reconRun: (date) => request('POST', '/recon/run', { date }, { idemPrefix: 'reconrun' }),
  reconReview: (date, note) => request('POST', '/recon/review', { date, note }, { idemPrefix: 'reconrv' }),
  reconCompensate: (date, note) => request('POST', '/recon/compensate', { date, note }, { idemPrefix: 'reconcp' }),
  activityCreate: (body) => request('POST', '/activities', body, { idemPrefix: 'actc' }),
  activityToggle: (id) => request('POST', '/activities/toggle', { id }, { idemPrefix: 'acttog' }),
  activityResetStock: (id) => request('POST', '/activities/reset-stock', { id }, { idemPrefix: 'actreset' }),
  activityDelete: (id) => request('POST', '/activities/delete', { id }, { idemPrefix: 'actdel' }),

  // —— 组织 / 租户 ——
  memberCreate: (body) => request('POST', '/org/members/create', body, { idemPrefix: 'memc' }),
  memberUpdate: (memberId, patch) => request('POST', '/org/members/update', { memberId, patch }, { idemPrefix: 'memu' }),
  memberRole: (memberId, roleKey) => request('POST', '/org/members/role', { memberId, roleKey }, { idemPrefix: 'memrole' }),
  memberToggle: (memberId, reason) => request('POST', '/org/members/toggle', { memberId, reason }, { idemPrefix: 'memtog' }),
  roleCreate: (body) => request('POST', '/org/roles/create', body, { idemPrefix: 'rolec' }),
  roleUpdate: (roleId, permissions) => request('POST', '/org/roles/update', { roleId, permissions }, { idemPrefix: 'roleu' }),
  roleDelete: (roleId) => request('POST', '/org/roles/delete', { roleId }, { idemPrefix: 'roled' }),
  tenantCreate: (body) => request('POST', '/tenants/create', body, { idemPrefix: 'tc' }),
  tenantToggle: (tenantId, reason) => request('POST', '/tenants/toggle', { tenantId, reason }, { idemPrefix: 'ttog' }),
  tenantUpdate: (tenantId, patch) => request('POST', '/tenants/update', { tenantId, patch }, { idemPrefix: 'tupd' }),

  // —— 离线快照迁移 ——
  migrationValidate: (snapshot) => request('POST', '/migration/validate', { snapshot }, { idemPrefix: 'migv' }),
  migrationRun: (snapshot, batchId) =>
    request('POST', '/migration/run', { snapshot, batchId }, { idemPrefix: 'migr' })
}

// 幂等键本地持久化（同一业务动作的崩溃重试复用）：key 前缀 → 最近键
const KEY_LOG = 'lp.server.idem-keys'
export function rememberIdemKey(scope, key) {
  try {
    const map = JSON.parse(localStorage.getItem(KEY_LOG) || '{}')
    map[scope] = key
    // 只保留最近 200 个，避免无限增长
    const keys = Object.keys(map)
    if (keys.length > 200) keys.slice(0, keys.length - 200).forEach((k) => delete map[k])
    localStorage.setItem(KEY_LOG, JSON.stringify(map))
  } catch { /* localStorage 不可用时退化为内存键 */ }
}
export function rememberedIdemKey(scope) {
  try { return JSON.parse(localStorage.getItem(KEY_LOG) || '{}')[scope] || '' } catch { return '' }
}
