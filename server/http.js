// HTTP API（纯 node:http，零第三方依赖）：
// 鉴权：/api/auth/* 登录换 token；其余接口需 Authorization: Bearer <token>；
// 写接口在服务层强制 RBAC 权限位 + tenantId 归属校验；所有写操作走交易 Saga，天然幂等/可续办。
import http from 'node:http'
import { URL } from 'node:url'
import { BizError } from './util.js'
import { DEMO_USERS } from './seed.js'
import { PERMISSION_LABELS } from './mock-perms.js'

const PERMS = {
  reviewRisk: 'risk:review', ruleRisk: 'risk:rule',
  shipSend: 'ship:send', shipTrace: 'ship:trace', aftersaleReview: 'aftersale:review',
  purchaseApply: 'purchase:apply', purchaseApprove: 'purchase:approve', purchaseInbound: 'purchase:inbound',
  supplierBill: 'supplier:bill', supplierReview: 'supplier:review', supplierSettle: 'supplier:settle',
  budgetManage: 'budget:manage', budgetApprove: 'budget:approve',
  couponRedeem: 'coupon:redeem',
  reconRun: 'recon:run', reconReview: 'recon:review', reconCompensate: 'recon:compensate',
  activityManage: 'activity:manage',
  orgMember: 'org:member', orgRole: 'org:role', tenantManage: 'tenant:manage'
}

// 统一写接口幂等：优先用 Idempotency-Key 请求头，其次 body.idempotencyKey。
// 同一 (会话, 方法, 路径, 键) 在 24h 内重放直接返回首次响应（不重复落账）。
const IDEM_TTL = 24 * 3600 * 1000
function idemStore() {
  const map = new Map()
  return {
    take(key) {
      const hit = map.get(key)
      if (!hit) return null
      if (Date.now() - hit.at > IDEM_TTL) { map.delete(key); return null }
      return hit
    },
    put(key, payload) { map.set(key, { ...payload, at: Date.now() }) }
  }
}

export function createHttpServer(app) {
  const idem = idemStore()
  const json = (res, status, data) => {
    const body = JSON.stringify(data)
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(body)
  }

  const server = http.createServer(async (req, res) => {
    try {
      await route(app, req, res, json, { idem })
    } catch (err) {
      if (err instanceof BizError) {
        json(res, err.status, { ok: false, error: { code: err.code, message: err.message } })
      } else {
        console.error('[server error]', err)
        json(res, 500, { ok: false, error: { code: 'INTERNAL', message: err.message } })
      }
    }
  })
  return server
}

async function readBody(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      if (!raw) return resolve({})
      try { resolve(JSON.parse(raw)) } catch { resolve({}) }
    })
  })
}

function sessionOf(app, req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')
  if (!m) throw new BizError('UNAUTHORIZED', '缺少 Authorization: Bearer <token>', 401)
  return app.auth.requireSession(m[1].trim())
}

// 员工/平台接口统一 RBAC 门禁
async function requireStaffPerm(app, session, perm) {
  await app.auth.requirePerm(session, perm, 'api', PERMISSION_LABELS[perm] || perm)
}

async function route(app, req, res, json, ctx = {}) {
  const u = new URL(req.url, 'http://localhost')
  const p = u.pathname
  const method = req.method
  const body = method === 'POST' || method === 'PATCH' ? await readBody(req) : {}

  // 统一写幂等：Idempotency-Key 头或 body 字段；命中重放首次响应（状态码/载荷原样返回）
  // 注意：交易类接口（draw/redeem）自身按 idempotencyKey 做业务幂等（返回 idempotent:true），
  // 这里的 HTTP 层缓存只在「业务层未消费该键」时兜底（防止非幂等接口的网络重试重复落账）。
  const idemKey = (req.headers['idempotency-key'] || body.idempotencyKey || '').toString().trim()
  // 作用域用完整令牌（不同会话绝不串响应；匿名请求共享 anon 仅适用于登录前接口）
  const idemScope = (() => {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')
    if (!m) return 'anon'
    let h = 0
    const t = m[1].trim()
    for (let i = 0; i < t.length; i++) { h = ((h << 5) - h + t.charCodeAt(i)) | 0 }
    return `s${(h >>> 0).toString(36)}`
  })()
  // 业务自带幂等键语义的接口（Saga 服务内判重并返回 idempotent 标记），不进 HTTP 缓存
  const BUSINESS_IDEM_PATHS = new Set(['/api/draw', '/api/redeem'])
  const idemCacheKey = (idemKey && !BUSINESS_IDEM_PATHS.has(p))
    ? `${idemScope}:${method}:${p}:${idemKey}` : ''
  if (method === 'POST' && idemCacheKey && ctx.idem) {
    const hit = ctx.idem.take(idemCacheKey)
    if (hit) return json(res, hit.status, hit.data)
  }
  const reply = (resp, status, data) => {
    // 仅缓存成功响应（2xx）：4xx 业务拒绝/校验错误不缓存，允许用户修正后用同键重试；
    // 5xx 不缓存（崩溃/故障注入后应能续办重试）。
    if (method === 'POST' && idemCacheKey && ctx.idem && status >= 200 && status < 300) {
      ctx.idem.put(idemCacheKey, { status, data })
    }
    return json(resp, status, data)
  }

  // —— 健康检查 / 目录 ——
  if (method === 'GET' && p === '/health') return json(res, 200, { ok: true, service: 'lottery-server', ts: Date.now() })
  if (method === 'GET' && p === '/api/catalog/users') return json(res, 200, { users: DEMO_USERS })
  if (method === 'GET' && p === '/api/catalog/org') {
    // 登录页目录：租户 + 成员账号（仅静态目录字段，供前端一键登录）
    return json(res, 200, {
      tenants: app.k.state.tenants,
      members: app.k.state.members.map((m) => ({ ...m })),
      customRoles: app.k.state.customRoles.filter((r) => !r.deleted),
      users: DEMO_USERS
    })
  }

  // —— 鉴权 ——
  if (method === 'POST' && p === '/api/auth/customer-login') {
    const user = DEMO_USERS.find((x) => x.id === body.userId) || DEMO_USERS[0]
    const { token, session } = await app.auth.loginCustomer(user.id, user.name, {
      tenantId: body.tenantId || 't-star', ip: req.socket.remoteAddress
    })
    return json(res, 200, { token, session: publicSession(session) })
  }
  if (method === 'POST' && p === '/api/auth/member-login') {
    const { token, session } = await app.auth.loginMember(body.memberId, { ip: req.socket.remoteAddress })
    return json(res, 200, { token, session: publicSession(session) })
  }
  if (method === 'POST' && p === '/api/auth/switch-tenant') {
    const session = sessionOf(app, req)
    await app.auth.switchTenant(session, body.tenantId)
    return json(res, 200, { session: publicSession(session) })
  }
  if (method === 'POST' && p === '/api/auth/logout') {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')
    if (m) app.auth.logout(m[1].trim())
    return json(res, 200, { ok: true })
  }

  const session = sessionOf(app, req)
  const tid = () => session.tenantId

  // —— 查询类 ——
  if (method === 'GET' && p === '/api/me') return json(res, 200, { session: publicSession(session) })
  // 全量快照水合：一次拉取与前端 Pinia store 同构的全部视图数据（按会话权限/租户/用户裁剪）。
  // 写操作后前端以本端点重放水合，保证「服务端为唯一事实来源」；支持 ETag 风格版本号（version=WAL 条数+末 ts）。
  if (method === 'GET' && p === '/api/state') {
    return json(res, 200, buildStateSnapshot(app, session))
  }
  if (method === 'GET' && p === '/api/tasks') {
    const claimed = session.identityKind === 'customer'
      ? app.tasks.manualStateOf(session.userId)
      : {}
    return json(res, 200, { tasks: app.k.state.tasks, manualClaimed: claimed })
  }
  if (method === 'GET' && p === '/api/coupon-logs') {
    const list = app.k.state.couponLogs
      .filter((l) => (l.tenantId || 't-star') === tid())
      .sort((a, b) => b.ts - a.ts)
    return json(res, 200, { couponLogs: list })
  }
  if (method === 'GET' && p === '/api/stock-adjustments') {
    const list = app.k.state.stockAdjustments
      .filter((x) => (x.tenantId || 't-star') === tid())
      .sort((a, b) => b.ts - a.ts)
    return json(res, 200, { stockAdjustments: list })
  }
  if (method === 'GET' && p === '/api/budget-ledger' || method === 'GET' && p === '/api/budgets/all') {
    // 兼容别名
    return json(res, 200, { ledger: app.budget.ledger(tid()) })
  }
  if (method === 'GET' && p === '/api/dashboard') {
    return json(res, 200, dashboard(app, tid()))
  }
  if (method === 'GET' && p === '/api/activities') {
    const list = app.k.state.activities.filter((a) => a.tenantId === tid() && !a.deleted)
    return json(res, 200, { activities: list })
  }
  if (method === 'GET' && p === '/api/goods') {
    const list = app.k.state.goods.filter((g) => (g.tenantId || 't-star') === tid())
    return json(res, 200, { goods: list })
  }
  if (method === 'GET' && p === '/api/points') {
    return json(res, 200, {
      balance: app.points.balanceOf(session.userId),
      flows: app.points.flowsOf(session.userId).filter((f) => (f.tenantId || 't-star') === tid()).slice(0, 200)
    })
  }
  if (method === 'GET' && p === '/api/records') {
    const mine = body.mine !== false && session.identityKind === 'customer'
    const list = app.k.state.records
      .filter((r) => (r.tenantId || 't-star') === tid())
      .filter((r) => !mine || r.userId === session.userId)
      .sort((a, b) => b.ts - a.ts).slice(0, 200)
    return json(res, 200, { records: list })
  }
  if (method === 'GET' && p === '/api/coupons/my') {
    return json(res, 200, {
      coupons: app.k.state.coupons
        .filter((c) => (c.tenantId || 't-star') === tid() && c.userId === session.userId)
        .sort((a, b) => b.ts - a.ts)
    })
  }
  if (method === 'GET' && p === '/api/shipments') {
    const mine = session.identityKind === 'customer'
    const list = app.k.state.shipments
      .filter((o) => (o.tenantId || 't-star') === tid())
      .filter((o) => !mine || o.userId === session.userId)
      .sort((a, b) => b.ts - a.ts)
    return json(res, 200, { shipments: list })
  }
  if (method === 'GET' && p === '/api/aftersales') {
    const mine = session.identityKind === 'customer'
    const list = app.k.state.afterSales
      .filter((a) => (a.tenantId || 't-star') === tid())
      .filter((a) => !mine || a.userId === session.userId)
      .map(({ processing, processingRunId, stages, ...rest }) => rest)
      .sort((a, b) => b.ts - a.ts)
    return json(res, 200, { afterSales: list })
  }
  if (method === 'GET' && p === '/api/purchases') {
    const list = app.k.state.purchaseOrders
      .filter((o) => (o.tenantId || 't-star') === tid())
      .sort((a, b) => b.ts - a.ts)
    return json(res, 200, {
      purchases: list,
      batches: app.k.state.inboundBatches.filter((b) => (b.tenantId || 't-star') === tid()),
      acceptDiffs: app.k.state.acceptDiffs.filter((b) => (b.tenantId || 't-star') === tid())
    })
  }
  if (method === 'GET' && p === '/api/supplier/bills') {
    return json(res, 200, {
      bills: app.k.state.supplierBills
        .filter((b) => (b.tenantId || 't-star') === tid())
        .sort((a, b) => b.ts - a.ts)
    })
  }
  if (method === 'GET' && p === '/api/supplier/recon') {
    return json(res, 200, { recon: app.supplier.computeRecon(tid()) })
  }
  if (method === 'GET' && p === '/api/budgets') {
    const list = app.budget.list(tid()).map((b) => ({ ...b, summary: app.budget.summary(b.id) }))
    return json(res, 200, { budgets: list })
  }
  if (method === 'GET' && p === '/api/budgets/ledger') {
    return json(res, 200, { ledger: app.budget.ledger(tid()) })
  }
  if (method === 'GET' && p === '/api/budgets/dashboard') {
    return json(res, 200, { dashboard: app.budget.dashboard(tid()) })
  }
  if (method === 'GET' && p === '/api/risk/orders') {
    const list = app.k.state.riskOrders
      .filter((o) => (o.tenantId || 't-star') === tid())
      .filter((o) => session.identityKind === 'customer' ? o.userId === session.userId : true)
      .sort((a, b) => b.ts - a.ts)
    return json(res, 200, { orders: list })
  }
  if (method === 'GET' && p === '/api/risk/rules') {
    return json(res, 200, { rules: app.risk.rulesOf(tid()) })
  }
  if (method === 'GET' && p.startsWith('/api/audit')) {
    await requireStaffPerm(app, session, 'audit:view')
    const q = {
      tenantId: u.searchParams.get('tenantId') || tid(),
      module: u.searchParams.get('module') || '',
      result: u.searchParams.get('result') || '',
      traceId: u.searchParams.get('traceId') || '',
      keyword: u.searchParams.get('keyword') || ''
    }
    if (u.searchParams.get('traceId')) {
      return json(res, 200, { timeline: app.audit.timeline(q.traceId) })
    }
    return json(res, 200, { logs: app.audit.query(q).slice(0, 200) })
  }
  if (method === 'GET' && p === '/api/recon/dates') {
    const dates = new Set()
    app.k.state.records.forEach((r) => { if ((r.tenantId || 't-star') === tid()) dates.add(r.date) })
    app.k.state.taskClaims.forEach((c) => { if ((c.tenantId || 't-star') === tid()) dates.add(c.bizDate) })
    dates.add(app.k.todayDate())
    return json(res, 200, { dates: [...dates].sort().reverse() })
  }
  if (method === 'GET' && p === '/api/recon/bill') {
    const date = u.searchParams.get('date') || app.k.todayDate()
    return json(res, 200, { bill: app.recon.billOf(date, tid()) })
  }

  // —— 写：交易链路（客户）——
  if (method === 'POST' && p === '/api/tasks/claim') {
    const r = await app.tasks.claim(body.taskId, session)
    return reply(res, 200, { ok: true, ...r })
  }
  if (method === 'POST' && p === '/api/draw') {
    const r = await app.trade.draw(body.activityId, session, { idempotencyKey: body.idempotencyKey })
    const { processing, stages, ...trade } = r.trade || {}
    return reply(res, 200, { ok: true, trade, idempotent: !!r.idempotent })
  }
  if (method === 'POST' && p === '/api/redeem') {
    const r = await app.trade.redeem(body.goodsId, session, { idempotencyKey: body.idempotencyKey })
    const { processing, stages, ...trade } = r.trade || {}
    return reply(res, 200, { ok: true, trade, idempotent: !!r.idempotent })
  }
  if (method === 'POST' && p === '/api/risk/appeal') {
    const row = await app.risk.appeal(body.orderId, body.reason, session)
    return reply(res, 200, { ok: true, order: row })
  }
  if (method === 'POST' && p === '/api/shipments/address') {
    const row = await app.ship.submitAddress(body.shipmentId, body, session)
    return reply(res, 200, { ok: true, shipment: row })
  }
  if (method === 'POST' && p === '/api/shipments/receive') {
    const row = await app.ship.receive(body.shipmentId, session)
    return reply(res, 200, { ok: true, shipment: row })
  }
  if (method === 'POST' && p === '/api/shipments/trace') {
    // 客户与有权限员工均可同步本人/本租户订单
    const o = app.ship.requireShipment(body.shipmentId)
    if (session.identityKind === 'customer') {
      if (o.userId !== session.userId || (o.tenantId || 't-star') !== tid()) throw new BizError('FORBIDDEN', '只能查询自己的物流', 403)
    } else {
      await requireStaffPerm(app, session, PERMS.shipTrace)
      await app.auth.requireSameTenant(session, o.tenantId, 'ship')
    }
    const row = await app.ship.syncTrace(body.shipmentId, session)
    return reply(res, 200, { ok: true, shipment: row })
  }
  if (method === 'POST' && p === '/api/aftersales/apply') {
    const row = await app.ship.applyAfterSale(body.shipmentId, body.type, body.reason, session)
    return reply(res, 200, { ok: true, afterSale: row })
  }

  // —— 写：运营 ——
  if (method === 'POST' && p === '/api/risk/review') {
    await requireStaffPerm(app, session, PERMS.reviewRisk)
    const o = app.k.state.riskOrders.find((x) => x.id === body.orderId)
    if (!o) throw new BizError('ORDER_NOT_FOUND', '审核单不存在', 404)
    await app.auth.requireSameTenant(session, o.tenantId, 'risk')
    const row = await app.risk.review(body.orderId, body.action, body.note, session)
    return reply(res, 200, { ok: true, order: row })
  }
  if (method === 'POST' && p === '/api/risk/rules') {
    await requireStaffPerm(app, session, PERMS.ruleRisk)
    const rules = await app.risk.updateRules(tid(), body, session)
    return reply(res, 200, { ok: true, rules })
  }
  if (method === 'POST' && p === '/api/shipments/send') {
    await requireStaffPerm(app, session, PERMS.shipSend)
    const o = app.ship.requireShipment(body.shipmentId)
    await app.auth.requireSameTenant(session, o.tenantId, 'ship')
    const row = await app.ship.ship(body.shipmentId, body, session)
    return reply(res, 200, { ok: true, shipment: row })
  }
  if (method === 'POST' && p === '/api/aftersales/review') {
    await requireStaffPerm(app, session, PERMS.aftersaleReview)
    const as = app.k.state.afterSales.find((x) => x.id === body.afterSaleId)
    if (!as) throw new BizError('AS_NOT_FOUND', '售后单不存在', 404)
    await app.auth.requireSameTenant(session, as.tenantId, 'aftersale')
    const row = await app.ship.reviewAfterSale(body.afterSaleId, !!body.approve, body.note || '', session)
    return reply(res, 200, { ok: true, afterSale: row })
  }
  if (method === 'POST' && p === '/api/purchases/create') {
    await requireStaffPerm(app, session, PERMS.purchaseApply)
    const row = await app.purchase.createOrder(body, session)
    return reply(res, 200, { ok: true, purchase: row })
  }
  if (method === 'POST' && p === '/api/purchases/review') {
    await requireStaffPerm(app, session, PERMS.purchaseApprove)
    const po = app.k.state.purchaseOrders.find((x) => x.id === body.purchaseId)
    if (!po) throw new BizError('PO_NOT_FOUND', '采购单不存在', 404)
    await app.auth.requireSameTenant(session, po.tenantId, 'purchase')
    const row = await app.purchase.reviewOrder(body.purchaseId, !!body.approve, body.note || '', session)
    return reply(res, 200, { ok: true, purchase: row })
  }
  if (method === 'POST' && p === '/api/purchases/cancel') {
    await requireStaffPerm(app, session, PERMS.purchaseApply)
    const po = app.k.state.purchaseOrders.find((x) => x.id === body.purchaseId)
    if (!po) throw new BizError('PO_NOT_FOUND', '采购单不存在', 404)
    await app.auth.requireSameTenant(session, po.tenantId, 'purchase')
    const row = await app.purchase.cancelOrder(body.purchaseId, session)
    return reply(res, 200, { ok: true, purchase: row })
  }
  if (method === 'POST' && p === '/api/purchases/inbound') {
    await requireStaffPerm(app, session, PERMS.purchaseInbound)
    const po = app.k.state.purchaseOrders.find((x) => x.id === body.purchaseId)
    if (!po) throw new BizError('PO_NOT_FOUND', '采购单不存在', 404)
    await app.auth.requireSameTenant(session, po.tenantId, 'purchase')
    const r = await app.purchase.inbound(body.purchaseId, body, session)
    return reply(res, 200, { ok: true, ...r })
  }
  if (method === 'POST' && p === '/api/supplier/bills/create') {
    await requireStaffPerm(app, session, PERMS.supplierBill)
    const po = app.k.state.purchaseOrders.find((x) => x.id === body.purchaseId)
    if (!po) throw new BizError('PO_NOT_FOUND', '采购单不存在', 404)
    await app.auth.requireSameTenant(session, po.tenantId, 'supplier')
    const bill = await app.supplier.createBill(body.purchaseId, body, session)
    return reply(res, 200, { ok: true, bill })
  }
  if (method === 'POST' && p === '/api/supplier/bills/submit') {
    await requireStaffPerm(app, session, PERMS.supplierBill)
    const cur = app.supplier.requireBill(body.billId)
    if (!cur) throw new BizError('BILL_NOT_FOUND', '供应商账单不存在', 404)
    await app.auth.requireSameTenant(session, cur.tenantId, 'supplier')
    const bill = await app.supplier.submitBill(body.billId, body, session)
    return reply(res, 200, { ok: true, bill })
  }
  if (method === 'POST' && p === '/api/supplier/bills/review') {
    await requireStaffPerm(app, session, PERMS.supplierReview)
    const cur = app.supplier.requireBill(body.billId)
    if (!cur) throw new BizError('BILL_NOT_FOUND', '供应商账单不存在', 404)
    await app.auth.requireSameTenant(session, cur.tenantId, 'supplier')
    const bill = await app.supplier.reviewBill(body.billId, !!body.approve, body.note || '', session)
    return reply(res, 200, { ok: true, bill })
  }
  if (method === 'POST' && p === '/api/supplier/bills/settle') {
    await requireStaffPerm(app, session, PERMS.supplierSettle)
    const cur = app.supplier.requireBill(body.billId)
    if (!cur) throw new BizError('BILL_NOT_FOUND', '供应商账单不存在', 404)
    await app.auth.requireSameTenant(session, cur.tenantId, 'supplier')
    const bill = await app.supplier.settleBill(body.billId, body.note || '', session)
    return reply(res, 200, { ok: true, bill })
  }
  if (method === 'POST' && p === '/api/coupons/redeem') {
    await requireStaffPerm(app, session, PERMS.couponRedeem)
    const r = await app.coupons.redeem(body.code, session, body)
    return reply(res, 200, { ok: true, ...r })
  }
  if (method === 'POST' && p === '/api/recon/run') {
    await requireStaffPerm(app, session, PERMS.reconRun)
    const bill = await app.recon.run(body.date || app.k.todayDate(), tid(), session)
    return reply(res, 200, { ok: true, bill })
  }
  if (method === 'POST' && p === '/api/recon/diffs') {
    await requireStaffPerm(app, session, PERMS.reconRun)
    const diffs = app.recon.compute(body.date || app.k.todayDate(), tid())
    return reply(res, 200, { ok: true, diffs })
  }
  if (method === 'POST' && p === '/api/recon/review') {
    await requireStaffPerm(app, session, PERMS.reconReview)
    const bill = await app.recon.review(body.date, tid(), body.note || '', session)
    return reply(res, 200, { ok: true, bill })
  }
  if (method === 'POST' && p === '/api/recon/compensate') {
    await requireStaffPerm(app, session, PERMS.reconCompensate)
    const r = await app.recon.compensate(body.date, tid(), body.note || '', session)
    return reply(res, 200, { ok: true, ...r, bill: undefined })
  }
  if (method === 'POST' && p === '/api/activities') {
    await requireStaffPerm(app, session, PERMS.activityManage)
    const row = await createActivity(app, body, session)
    return reply(res, 200, { ok: true, activity: row })
  }
  if (method === 'POST' && p === '/api/activities/toggle') {
    await requireStaffPerm(app, session, PERMS.activityManage)
    const a = app.k.state.activities.find((x) => x.id === body.id)
    if (!a) throw new BizError('ACTIVITY_NOT_FOUND', '活动不存在', 404)
    await app.auth.requireSameTenant(session, a.tenantId, 'activity')
    const row = await app.org.toggleActivity(body.id, session)
    return reply(res, 200, { ok: true, activity: row })
  }
  if (method === 'POST' && p === '/api/activities/reset-stock') {
    await requireStaffPerm(app, session, PERMS.activityManage)
    const a = app.k.state.activities.find((x) => x.id === body.id)
    if (!a) throw new BizError('ACTIVITY_NOT_FOUND', '活动不存在', 404)
    await app.auth.requireSameTenant(session, a.tenantId, 'activity')
    const row = await app.org.resetActivityStock(body.id, session)
    return reply(res, 200, { ok: true, activity: row })
  }
  if (method === 'POST' && p === '/api/activities/delete') {
    await requireStaffPerm(app, session, PERMS.activityManage)
    const a = app.k.state.activities.find((x) => x.id === body.id)
    if (!a) throw new BizError('ACTIVITY_NOT_FOUND', '活动不存在', 404)
    await app.auth.requireSameTenant(session, a.tenantId, 'activity')
    const r = await app.org.deleteActivity(body.id, session)
    return reply(res, 200, { ok: true, ...r })
  }

  // —— 写：组织 / 成员 / 角色（RBAC：org:member / org:role）——
  if (method === 'POST' && p === '/api/org/members/create') {
    await requireStaffPerm(app, session, PERMS.orgMember)
    const row = await app.org.createMember(body, session)
    return reply(res, 200, { ok: true, member: row })
  }
  if (method === 'POST' && p === '/api/org/members/update') {
    await requireStaffPerm(app, session, PERMS.orgMember)
    const m = app.k.state.members.find((x) => x.id === body.memberId)
    if (!m) throw new BizError('MEMBER_NOT_FOUND', '成员不存在', 404)
    await app.auth.requireSameTenant(session, m.tenantId, 'org')
    const row = await app.org.updateMember(body.memberId, body.patch || {}, session)
    return reply(res, 200, { ok: true, member: row })
  }
  if (method === 'POST' && p === '/api/org/members/role') {
    await requireStaffPerm(app, session, PERMS.orgMember)
    const m = app.k.state.members.find((x) => x.id === body.memberId)
    if (!m) throw new BizError('MEMBER_NOT_FOUND', '成员不存在', 404)
    await app.auth.requireSameTenant(session, m.tenantId, 'org')
    const row = await app.org.assignMemberRole(body.memberId, body.roleKey, session)
    return reply(res, 200, { ok: true, member: row })
  }
  if (method === 'POST' && p === '/api/org/members/toggle') {
    await requireStaffPerm(app, session, PERMS.orgMember)
    const m = app.k.state.members.find((x) => x.id === body.memberId)
    if (!m) throw new BizError('MEMBER_NOT_FOUND', '成员不存在', 404)
    await app.auth.requireSameTenant(session, m.tenantId, 'org')
    const row = await app.org.toggleMember(body.memberId, body.reason || '', session)
    return reply(res, 200, { ok: true, member: row })
  }
  if (method === 'POST' && p === '/api/org/roles/create') {
    await requireStaffPerm(app, session, PERMS.orgRole)
    const row = await app.org.createRole(body, session)
    return reply(res, 200, { ok: true, role: row })
  }
  if (method === 'POST' && p === '/api/org/roles/update') {
    await requireStaffPerm(app, session, PERMS.orgRole)
    const r = app.k.state.customRoles.find((x) => x.id === body.roleId)
    if (!r) throw new BizError('ROLE_NOT_FOUND', '自定义角色不存在', 404)
    await app.auth.requireSameTenant(session, r.tenantId, 'org')
    const row = await app.org.updateRolePermissions(body.roleId, body.permissions || [], session)
    return reply(res, 200, { ok: true, role: row })
  }
  if (method === 'POST' && p === '/api/org/roles/delete') {
    await requireStaffPerm(app, session, PERMS.orgRole)
    const r = app.k.state.customRoles.find((x) => x.id === body.roleId)
    if (!r) throw new BizError('ROLE_NOT_FOUND', '自定义角色不存在', 404)
    await app.auth.requireSameTenant(session, r.tenantId, 'org')
    const out = await app.org.deleteRole(body.roleId, session)
    return reply(res, 200, { ok: true, ...out })
  }

  // —— 写：平台租户管理（tenant:manage，仅平台超管）——
  if (method === 'POST' && p === '/api/tenants/create') {
    if (session.identityKind !== 'platform') throw new BizError('FORBIDDEN', '仅平台方可开通租户', 403)
    const rules = app.risk.rulesOf('t-star')
    const { tenant, admin } = await app.org.createTenant({ ...body, rules: JSON.parse(JSON.stringify(rules)) }, session)
    return reply(res, 200, { ok: true, tenant, admin })
  }
  if (method === 'POST' && p === '/api/tenants/toggle') {
    if (session.identityKind !== 'platform') throw new BizError('FORBIDDEN', '仅平台方可停用/启用租户', 403)
    const row = await app.org.toggleTenant(body.tenantId, body.reason || '', session)
    return reply(res, 200, { ok: true, tenant: row })
  }
  if (method === 'POST' && p === '/api/tenants/update') {
    if (session.identityKind !== 'platform') throw new BizError('FORBIDDEN', '仅平台方可配置租户', 403)
    const row = await app.org.updateTenant(body.tenantId, body.patch || {}, session)
    return reply(res, 200, { ok: true, tenant: row })
  }

  // —— 离线快照迁移：旧前端 Pinia 快照 → 校验 → 迁移上云（幂等批次；走同一套 WAL/对账/补偿链路）——
  if (method === 'POST' && p === '/api/migration/validate') {
    if (session.identityKind !== 'platform') throw new BizError('FORBIDDEN', '仅平台方可执行历史台账校验', 403)
    const errors = app.migration.validate(body.snapshot || body)
    return reply(res, 200, { ok: true, valid: errors.length === 0, errors })
  }
  if (method === 'POST' && p === '/api/migration/run') {
    if (session.identityKind !== 'platform') throw new BizError('FORBIDDEN', '仅平台方可执行历史台账迁移', 403)
    const snap = body.snapshot || body
    const r = await app.migration.run(snap, { batchId: body.batchId, ctx: session })
    return reply(res, 200, { ok: true, ...r })
  }
  if (method === 'GET' && p === '/api/migration/manifests') {
    if (session.identityKind !== 'platform') throw new BizError('FORBIDDEN', '仅平台方可查看迁移批次', 403)
    return json(res, 200, { manifests: app.k.state.migrations })
  }

  // —— 写：营销预算与成本控制 ——
  if (method === 'POST' && p === '/api/budgets/create') {
    await requireStaffPerm(app, session, PERMS.budgetManage)
    const row = await app.budget.create(body, session)
    return reply(res, 200, { ok: true, budget: row })
  }
  if (method === 'POST' && p === '/api/budgets/review') {
    await requireStaffPerm(app, session, PERMS.budgetApprove)
    const cur = app.budget.requireBudget(body.budgetId)
    await app.auth.requireSameTenant(session, cur.tenantId, 'budget')
    const row = await app.budget.review(body.budgetId, !!body.approve, body.note || '', session)
    return reply(res, 200, { ok: true, budget: row })
  }
  if (method === 'POST' && p === '/api/budgets/cancel') {
    await requireStaffPerm(app, session, PERMS.budgetManage)
    const cur = app.budget.requireBudget(body.budgetId)
    await app.auth.requireSameTenant(session, cur.tenantId, 'budget')
    const row = await app.budget.cancel(body.budgetId, session)
    return reply(res, 200, { ok: true, budget: row })
  }
  if (method === 'POST' && p === '/api/budgets/freeze') {
    await requireStaffPerm(app, session, PERMS.budgetApprove)
    const cur = app.budget.requireBudget(body.budgetId)
    await app.auth.requireSameTenant(session, cur.tenantId, 'budget')
    const row = await app.budget.setFrozen(body.budgetId, true, body.note || '', session)
    return reply(res, 200, { ok: true, budget: row })
  }
  if (method === 'POST' && p === '/api/budgets/activate') {
    await requireStaffPerm(app, session, PERMS.budgetApprove)
    const cur = app.budget.requireBudget(body.budgetId)
    await app.auth.requireSameTenant(session, cur.tenantId, 'budget')
    const row = await app.budget.setFrozen(body.budgetId, false, body.note || '', session)
    return reply(res, 200, { ok: true, budget: row })
  }
  if (method === 'POST' && p === '/api/budgets/close') {
    await requireStaffPerm(app, session, PERMS.budgetApprove)
    const cur = app.budget.requireBudget(body.budgetId)
    await app.auth.requireSameTenant(session, cur.tenantId, 'budget')
    const row = await app.budget.close(body.budgetId, body.note || '', session)
    return reply(res, 200, { ok: true, budget: row })
  }
  if (method === 'POST' && p === '/api/budgets/adjust') {
    await requireStaffPerm(app, session, PERMS.budgetManage)
    const cur = app.budget.requireBudget(body.budgetId)
    await app.auth.requireSameTenant(session, cur.tenantId, 'budget')
    const row = await app.budget.requestAdjust(body.budgetId, Number(body.delta) || 0, body.reason || '', session)
    return reply(res, 200, { ok: true, adjustment: row })
  }
  if (method === 'POST' && p === '/api/budgets/adjust-review') {
    await requireStaffPerm(app, session, PERMS.budgetApprove)
    const cur = app.budget.requireBudget(body.budgetId)
    await app.auth.requireSameTenant(session, cur.tenantId, 'budget')
    const row = await app.budget.reviewAdjust(body.budgetId, body.adjustId, !!body.approve, body.note || '', session)
    return reply(res, 200, { ok: true, budget: row })
  }

  // —— 运维：故障注入/续办/跨日（仅平台超管或本地演示令牌）——
  if (method === 'POST' && p === '/api/admin/fault') {
    if (session.identityKind !== 'platform') throw new BizError('FORBIDDEN', '仅平台方可注入故障', 403)
    app.k.injectFault(body.name)
    return reply(res, 200, { ok: true, injected: body.name })
  }
  if (method === 'POST' && p === '/api/admin/resume') {
    if (session.identityKind !== 'platform') throw new BizError('FORBIDDEN', '仅平台方可执行续办', 403)
    const trades = await app.trade.resumeAll(session)
    const orders = await app.risk.resumeProcessing()
    const afterSales = await app.ship.resumeAfterSales(session)
    return reply(res, 200, { ok: true, resumedTrades: trades, resumedOrders: orders, resumedAfterSales: afterSales })
  }
  if (method === 'POST' && p === '/api/admin/day') {
    if (session.identityKind !== 'platform') throw new BizError('FORBIDDEN', '仅平台方可切换业务日', 403)
    if (body.day) app.k.setBusinessDay(body.day)
    else app.k.advanceDay(body.n || 1)
    const r = await app.trade.rollover(session)
    return reply(res, 200, { ok: true, today: app.k.todayDate(), ...r })
  }

  json(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: `${method} ${p} 不存在` } })
}

function publicSession(s) {
  return {
    identityKind: s.identityKind, memberId: s.memberId, userId: s.userId,
    name: s.name, tenantId: s.tenantId
  }
}

// —— 全量水合快照（与前端 Pinia store 字段同构；服务端为唯一事实来源）——
function buildStateSnapshot(app, session) {
  const st = app.k.state
  const platform = session.identityKind === 'platform'
  const customer = session.identityKind === 'customer'
  // 平台方无租户上下文时返回全部；员工/客户强制按当前会话租户裁剪
  const inT = (x) => platform ? true : (x.tenantId || 't-star') === session.tenantId
  const mine = (x) => !customer || x.userId === session.userId
  const activities = st.activities.filter((a) => !a.deleted && (platform || a.tenantId === session.tenantId))
  const goods = st.goods.filter((g) => platform || (g.tenantId || 't-star') === session.tenantId)
  const records = st.records.filter((r) => inT(r) && mine(r))
    .map(({ processing, stages, budgetItems, ...rest }) => rest)
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
  const pointFlows = st.pointFlows
    .filter((f) => platform ? inT(f) : (inT(f) && (!customer || f.userId === session.userId)))
    .sort((a, b) => b.ts - a.ts)
  const riskOrders = st.riskOrders.filter((o) => inT(o) && (!customer || o.userId === session.userId))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
  const coupons = st.coupons.filter((c) => inT(c) && (!customer || c.userId === session.userId))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
  const shipments = st.shipments.filter((o) => inT(o) && (!customer || o.userId === session.userId))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
  const afterSales = st.afterSales.filter((a) => inT(a) && (!customer || a.userId === session.userId))
    .map(({ processing, processingRunId, stages, ...rest }) => rest)
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
  const taskClaims = st.taskClaims.filter((c) => inT(c) && (!customer || c.userId === session.userId))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))

  // 前端 store 以单一 points 字段表示「当前用户」余额；员工视角无个人钱包时给 0
  const points = customer ? (st.balances[session.userId] || 0) : 0

  return {
    version: `${st.pointFlows.length}:${st.records.length}:${st.auditLogs.length}:${st.coupons.length}:${st.budgetLedger.length}`,
    serverTs: Date.now(),
    todayDate: app.k.todayDate(),
    session: publicSession(session),
    // 目录/组织：租户卡片全量返回（消费者"逛店"切换、权限中心展示都需要目录）；
    // 写操作仍在各接口强制 RBAC + 租户归属校验，目录可见不等于数据可操作
    tenants: st.tenants,
    allTenants: st.tenants,
    members: st.members,
    customRoles: st.customRoles.filter((r) => !r.deleted),
    riskRulesByTenant: st.riskRules,
    couponTpls: st.couponTpls,
    // 业务数据
    activities,
    goods,
    tasks: st.tasks,
    manualClaimed: customer ? app.tasks.manualStateOf(session.userId) : {},
    points,
    pointRecords: pointFlows,
    records,
    riskOrders,
    taskClaims,
    coupons,
    couponLogs: st.couponLogs.filter((l) => inT(l)).sort((a, b) => (b.ts || 0) - (a.ts || 0)),
    shipments,
    afterSales,
    purchaseOrders: st.purchaseOrders.filter((o) => inT(o)).sort((a, b) => (b.ts || 0) - (a.ts || 0)),
    inboundBatches: st.inboundBatches.filter((b) => inT(b)).sort((a, b) => (b.ts || 0) - (a.ts || 0)),
    acceptDiffs: st.acceptDiffs.filter((b) => inT(b)).sort((a, b) => (b.ts || 0) - (a.ts || 0)),
    supplierBills: st.supplierBills.filter((b) => inT(b)).sort((a, b) => (b.ts || 0) - (a.ts || 0)),
    budgets: st.budgets.filter((b) => inT(b)).sort((a, b) => (b.ts || 0) - (a.ts || 0)),
    budgetLedger: st.budgetLedger.filter((b) => inT(b)).sort((a, b) => (b.ts || 0) - (a.ts || 0)),
    reconBills: st.reconBills.filter((b) => inT(b)).sort((a, b) => (b.ts || 0) - (a.ts || 0)),
    stockAdjustments: st.stockAdjustments.filter((x) => inT(x)).sort((a, b) => (b.ts || 0) - (a.ts || 0)),
    auditLogs: st.auditLogs
      .filter((l) => platform || (l.tenantId || 't-star') === session.tenantId)
      .sort((a, b) => b.logTs - a.logTs).slice(0, 300),
    migrations: st.migrations
  }
}

async function createActivity(app, body, session) {
  const id = 'act-' + Date.now().toString(36)
  const prizes = (body.prizes || []).map((p, i) => ({
    id: `p${i}-${id}`,
    name: p.name,
    rarity: p.rarity || 'common',
    stock: p.stock || 10, remain: p.stock || 10, frozen: 0,
    weight: p.weight || 10,
    physical: p.physical !== undefined ? !!p.physical : !p.name.includes('积分'),
    emoji: p.emoji || '🎁',
    couponId: p.couponId || ''
  }))
  if (!prizes.some((p) => p.rarity === 'none')) {
    prizes.push({ id: `p-none-${id}`, name: '谢谢参与', rarity: 'none', stock: 99999, remain: 99999, frozen: 0, weight: 100, emoji: '🤝', physical: false })
  }
  const act = {
    id, tenantId: session.tenantId, name: body.name, type: body.type || 'wheel',
    status: 'running', cost: body.cost || 0, costType: body.costType || 'free',
    dailyLimit: body.dailyLimit || 3, totalLimit: body.totalLimit || 50,
    icon: '🎪', desc: body.desc || '新活动', prizes
  }
  await app.k.commit([{ type: 'upsert', table: 'activities', row: act }])
  await app.audit.log('activity-create', act.id, `新建活动【${act.name}】（${prizes.length} 个奖品）`, { tenantId: act.tenantId, ctx: session })
  return act
}

function dashboard(app, tid) {
  const inT = (x) => (x.tenantId || 't-star') === tid
  const records = app.k.state.records.filter(inT)
  const draws = records.filter((r) => r.type === 'draw' && r.status !== 'revoked')
  return {
    tenantId: tid,
    totalDraws: draws.length,
    participants: new Set(draws.map((r) => r.userId)).size,
    goodsSold: records.filter((r) => r.type === 'redeem' && r.status !== 'revoked').length,
    pendingRisk: app.k.state.riskOrders.filter((o) => inT(o) && ['pending', 'appealed'].includes(o.status)).length,
    frozenPoints: app.k.state.riskOrders.filter((o) => inT(o) && ['pending', 'appealed'].includes(o.status)).reduce((s, o) => s + (o.frozenPoints || 0), 0),
    stock: [...app.k.state.activities.filter((a) => a.tenantId === tid).flatMap((a) => a.prizes.map((p) => ({ key: `prize:${a.id}:${p.id}`, name: `${a.name}/${p.name}`, remain: p.remain, frozen: p.frozen || 0 }))),
      ...app.k.state.goods.filter((g) => inT(g)).map((g) => ({ key: `goods:${g.id}`, name: g.name, remain: g.remain, frozen: g.frozen || 0 }))],
    couponIssued: app.k.state.coupons.filter(inT).length,
    couponAvailable: app.k.state.coupons.filter((c) => inT(c) && c.status === 'available').length,
    couponRedeemed: app.k.state.coupons.filter((c) => inT(c) && c.status === 'redeemed').length,
    shipments: {
      pendingAddress: app.k.state.shipments.filter((o) => inT(o) && o.status === 'pending_address').length,
      toShip: app.k.state.shipments.filter((o) => inT(o) && o.status === 'to_ship').length,
      shipped: app.k.state.shipments.filter((o) => inT(o) && o.status === 'shipped').length,
      received: app.k.state.shipments.filter((o) => inT(o) && o.status === 'received').length,
      returned: app.k.state.shipments.filter((o) => inT(o) && o.status === 'returned').length
    },
    afterSalePending: app.k.state.afterSales.filter((a) => inT(a) && a.status === 'pending').length,
    afterSaleWaiting: app.k.state.afterSales.filter((a) => inT(a) && a.status === 'waiting_stock').length,
    purchasePending: app.k.state.purchaseOrders.filter((o) => inT(o) && o.status === 'pending').length,
    purchaseToInbound: app.k.state.purchaseOrders.filter((o) => inT(o) && ['approved', 'receiving'].includes(o.status)).length,
    purchaseReceived: app.k.state.purchaseOrders.filter((o) => inT(o) && o.status === 'received').length,
    purchaseDiffClosed: app.k.state.purchaseOrders.filter((o) => inT(o) && o.status === 'diff_closed').length,
    purchaseInboundQty: app.k.state.inboundBatches.filter((b) => inT(b)).reduce((n, b) => n + (b.qty || 0), 0),
    acceptDiffCount: app.k.state.acceptDiffs.filter((d) => inT(d)).length,
    supplierBills: app.k.state.supplierBills.filter((b) => inT(b)).length,
    supplierReviewing: app.k.state.supplierBills.filter((b) => inT(b) && b.status === 'reviewing').length,
    supplierApproved: app.k.state.supplierBills.filter((b) => inT(b) && b.status === 'approved').length,
    supplierSettled: app.k.state.supplierBills.filter((b) => inT(b) && b.status === 'settled').length,
    supplierPaid: app.k.state.supplierBills.filter((b) => inT(b) && b.status === 'settled').reduce((n, b) => n + (b.payableAmount || 0), 0),
    reconBills: app.k.state.reconBills.filter((b) => inT(b)).length,
    reconOpen: app.k.state.reconBills.filter((b) => inT(b) && ['pending', 'reviewed'].includes(b.status)).length,
    budget: app.budget.dashboard(tid)
  }
}
