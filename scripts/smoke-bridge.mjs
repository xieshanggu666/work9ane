// 前端接入服务端 API 的统一链路冒烟：
//  - GET /api/state 全量水合（字段同构、按租户/身份裁剪）
//  - 统一 Idempotency-Key 请求头幂等（非交易接口的网络重试不重复落账）
//  - 任务领奖（手动任务按 任务×用户×业务日 幂等）
//  - 活动运营 API（启停/重置/删除，RBAC）
//  - 组织/成员/角色 API（org:member / org:role，租户归属）
//  - 平台租户管理（tenant:manage）
//  - 离线快照迁移 API（validate → run，幂等批次）
import { tmpdir } from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { once } from 'node:events'

let failed = 0
const assert = (cond, msg) => {
  if (cond) console.log('  ✅', msg)
  else { console.error('  ❌', msg); failed++ }
}

const PORT = 18131
const PORT2 = 18132
const BASE = `http://127.0.0.1:${PORT}`
const BASE2 = `http://127.0.0.1:${PORT2}`
const dbFile = path.join(tmpdir(), `lottery-bridge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jsonl`)
let proc = null

function startServer(args = []) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['server/index.js', '--port', String(PORT), '--db', dbFile, ...args], {
      cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe']
    })
    let out = ''
    p.stdout.on('data', (d) => { out += d; if (out.includes('已启动')) resolve(p) })
    p.stderr.on('data', (d) => process.stderr.write(d))
    p.on('exit', (c) => { if (c !== 0) reject(new Error(`server exited ${c}`)) })
    setTimeout(() => reject(new Error('start timeout')), 8000)
  })
}
function startServerOn(port, file, args = []) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['server/index.js', '--port', String(port), '--db', file, ...args], {
      cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe']
    })
    let out = ''
    p.stdout.on('data', (d) => { out += d; if (out.includes('已启动')) resolve(p) })
    p.stderr.on('data', (d) => process.stderr.write(d))
    p.on('exit', (c) => { if (c !== 0) reject(new Error(`server exited ${c}`)) })
    setTimeout(() => reject(new Error('start timeout')), 8000)
  })
}
async function stop(p) { if (p) { p.kill('SIGTERM'); await once(p, 'exit').catch(() => {}) } }

async function call(method, url, { token, body, idem, base = BASE } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (idem) headers['Idempotency-Key'] = idem
  const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined })
  let json = null
  try { json = await res.json() } catch { json = null }
  return { status: res.status, json }
}

async function main() {
  proc = await startServer()

  console.log('— 全量水合快照 /api/state —')
  const login = await call('POST', '/api/auth/customer-login', { body: { userId: 'u-1001' } })
  const token = login.json.token
  const st1 = await call('GET', '/api/state', { token })
  assert(st1.status === 200, '消费者水合 200')
  const need = ['activities', 'goods', 'records', 'pointRecords', 'shipments', 'afterSales',
    'purchaseOrders', 'supplierBills', 'budgets', 'budgetLedger', 'riskOrders', 'coupons',
    'couponLogs', 'reconBills', 'auditLogs', 'tenants', 'members', 'customRoles',
    'riskRulesByTenant', 'tasks', 'todayDate', 'session', 'version']
  assert(need.every((k) => k in st1.json), `水合快照字段齐全（${need.length} 项）`)
  assert(st1.json.activities.every((a) => a.tenantId === 't-star'), '消费者仅水合当前租户活动')
  assert(st1.json.pointRecords.every((p) => p.userId === 'u-1001'), '消费者仅水合本人积分流水')
  assert(st1.json.pointRecords.some((p) => p.delta === 1000), '含初始余额流水')
  assert(st1.json.session.identityKind === 'customer', '快照带回会话身份')

  console.log('— 统一 Idempotency-Key 头：非交易接口重试不重复落账 —')
  const ops = (await call('POST', '/api/auth/member-login', { body: { memberId: 'm-star-ops' } })).json.token
  const fin = (await call('POST', '/api/auth/member-login', { body: { memberId: 'm-star-fin' } })).json.token
  const beforeN = (await call('GET', '/api/purchases', { token: ops })).json.purchases.length
  const poBody = { targetType: 'goods', targetId: 'g3', qty: 2, reason: '幂等头压测', supplierName: 'SX', unitPrice: 9 }
  const r1 = await call('POST', '/api/purchases/create', { token: ops, body: poBody, idem: 'bridge-po-1' })
  const r2 = await call('POST', '/api/purchases/create', { token: ops, body: poBody, idem: 'bridge-po-1' })
  const r3 = await call('POST', '/api/purchases/create', { token: ops, body: poBody, idem: 'bridge-po-2' })
  assert(r1.json.purchase.id === r2.json.purchase.id, '同 Idempotency-Key 返回同一采购单')
  assert(r3.json.purchase.id !== r1.json.purchase.id, '不同键生成新采购单')
  const afterN = (await call('GET', '/api/purchases', { token: ops })).json.purchases.length
  assert(afterN === beforeN + 2, `重试只落 2 笔（实际新增 ${afterN - beforeN}）`)

  console.log('— 手动任务领奖（签到，按日幂等）—')
  const t1 = await call('POST', '/api/tasks/claim', { token, body: { taskId: 't-checkin' } })
  const t2 = await call('POST', '/api/tasks/claim', { token, body: { taskId: 't-checkin' } })
  assert(t1.status === 200 && t1.json.claim.taskId === 't-checkin', '签到领奖成功')
  assert(t2.json.idempotent === true && t2.json.claim.id === t1.json.claim.id, '同日重复签到幂等返回同一台账')
  const st2 = (await call('GET', '/api/state', { token })).json
  assert(st2.pointRecords.filter((p) => p.refType === 'task-manual').length === 1, '只产生一笔任务奖励流水')
  assert(st2.manualClaimed['t-checkin'] === true, '水合快照标记签到已领')

  console.log('— 活动运营 API：RBAC + 启停/重置/删除（墓碑）—')
  // 客服只读身份无 activity:manage → 403
  const shipTok = (await call('POST', '/api/auth/member-login', { body: { memberId: 'm-star-ship' } })).json.token
  const forbid = await call('POST', '/api/activities/toggle', { token: shipTok, body: { id: 'act-1' } })
  assert(forbid.status === 403, '无 activity:manage 被拦截 403')
  const tog = await call('POST', '/api/activities/toggle', { token: ops, body: { id: 'act-1' }, idem: 'act-tog-1' })
  assert(tog.status === 200 && tog.json.activity.status === 'paused', '运营暂停活动')
  const togDup = await call('POST', '/api/activities/toggle', { token: ops, body: { id: 'act-1' }, idem: 'act-tog-1' })
  assert(togDup.json.activity.status === 'paused', '同键重放不二次切换（仍 paused）')
  await call('POST', '/api/activities/toggle', { token: ops, body: { id: 'act-1' }, idem: 'act-tog-2' })
  const reset = await call('POST', '/api/activities/reset-stock', { token: ops, body: { id: 'act-1' } })
  assert(reset.status === 200, '重置库存 200')
  const newAct = await call('POST', '/api/activities', {
    token: ops,
    body: { name: '桥接测试活动', type: 'wheel', costType: 'free', prizes: [{ name: '积分10', stock: 5, weight: 5 }] }
  })
  const actId = newAct.json.activity.id
  const del = await call('POST', '/api/activities/delete', { token: ops, body: { id: actId } })
  assert(del.status === 200, '删除活动 200（墓碑）')
  const acts = (await call('GET', '/api/activities', { token: ops })).json.activities
  assert(!acts.some((a) => a.id === actId), '已删除活动不再出现在列表')

  console.log('— 组织/成员/角色 API（org:member / org:role）—')
  const admin = (await call('POST', '/api/auth/member-login', { body: { memberId: 'm-star-admin' } })).json.token
  const mem = await call('POST', '/api/org/members/create', {
    token: admin, body: { name: '新成员小赵', roleKey: 'service_readonly', tenantId: 't-star' }
  })
  assert(mem.status === 200 && mem.json.member.status === 'active', '管理员创建成员')
  const memId = mem.json.member.id
  const memForbid = await call('POST', '/api/org/members/role', {
    token: ops, body: { memberId: memId, roleKey: 'risk_analyst' }
  })
  // 活动运营无 org:member
  assert(memForbid.status === 403, '无 org:member 调岗被拦截 403')
  const role = await call('POST', '/api/org/members/role', {
    token: admin, body: { memberId: memId, roleKey: 'risk_analyst' }
  })
  assert(role.json.member.roleKey === 'risk_analyst', '管理员调岗成功')
  const togMem = await call('POST', '/api/org/members/toggle', { token: admin, body: { memberId: memId, reason: '测试停用' } })
  assert(togMem.json.member.status === 'disabled', '停用成员')
  const disabledLogin = await call('POST', '/api/auth/member-login', { body: { memberId: memId } })
  assert(disabledLogin.status === 403 && disabledLogin.json.error.code === 'LOGIN_DENIED', '停用成员登录被拒绝')
  const cr = await call('POST', '/api/org/roles/create', {
    token: admin, body: { name: '桥接自定义角色', permissions: ['coupon:redeem', 'tenant:manage'] }
  })
  assert(cr.status === 200 && !cr.json.role.permissions.includes('tenant:manage'), '创建自定义角色（tenant:manage 被剔除）')
  const crId = cr.json.role.id
  const upd = await call('POST', '/api/org/roles/update', {
    token: admin, body: { roleId: crId, permissions: ['coupon:redeem', 'ship:send'] }
  })
  assert(upd.json.role.permissions.length === 2, '角色权限更新')
  const delRole = await call('POST', '/api/org/roles/delete', { token: admin, body: { roleId: crId } })
  assert(delRole.status === 200, '删除角色（墓碑）')
  const cat = await call('GET', '/api/catalog/org')
  assert(!cat.json.customRoles.some((r) => r.id === crId), '已删角色不出现在目录')

  console.log('— 平台租户管理（tenant:manage）—')
  const plat = (await call('POST', '/api/auth/member-login', { body: { memberId: 'm-platform' } })).json.token
  const nt = await call('POST', '/api/tenants/create', {
    token: plat, body: { name: '桥接测试组织有限公司', shortName: '桥接组织', contact: '桥接联系人', plan: '标准版' }
  })
  assert(nt.status === 200 && nt.json.admin.tenantId === nt.json.tenant.id, '平台开通租户并自动建管理员')
  const tid = nt.json.tenant.id
  const togT = await call('POST', '/api/tenants/toggle', { token: plat, body: { tenantId: tid, reason: '违规' } })
  assert(togT.json.tenant.status === 'suspended', '平台停用租户')
  const memberForbidTenant = await call('POST', '/api/tenants/create', {
    token: admin, body: { name: '员工越权开租户' }
  })
  assert(memberForbidTenant.status === 403, '员工不能开通租户')

  console.log('— 离线快照迁移 API（平台：validate → run，幂等批次）—')
  // 直接复用服务端 legacy-snapshot 提取器构造一份历史快照（与浏览器导出同构）
  const { extractLegacySnapshot } = await import('./legacy-snapshot-helper.mjs')
  const snap = await extractLegacySnapshot()
  const v = await call('POST', '/api/migration/validate', { token: plat, body: { snapshot: snap } })
  assert(v.status === 200 && Array.isArray(v.json.errors), '迁移校验返回错误列表')
  assert(v.json.valid === true, `历史快照校验通过（errors=${v.json.errors.length}）`)
  // 全新空库才能整批迁移；当前库已有种子，校验大概率报租户/活动重复之外的账实问题——
  // 这里仅断言接口契约（非平台 403 + 平台 200）。真正的迁移幂等在独立库验证：
  const vForbid = await call('POST', '/api/migration/validate', { token: admin, body: { snapshot: snap } })
  assert(vForbid.status === 403, '非平台方不能校验/迁移快照')
  const manifests = await call('GET', '/api/migration/manifests', { token: plat })
  assert(manifests.status === 200 && Array.isArray(manifests.json.manifests), '迁移批次清单可查')

  console.log('— 写后水合：操作立即可见于 /api/state —')
  const st3 = (await call('GET', '/api/state', { token: ops })).json
  assert(st3.members.some((m) => m.id === memId && m.status === 'disabled'), '停用成员经水合可见')
  assert(st3.activities.some((a) => a.id === 'act-1'), '活动仍在（暂停不影响水合）')

  await stop(proc)
  proc = null

  console.log('— 独立空库迁移（离线快照 → 服务端 WAL，固定批次幂等）—')
  const dbFile2 = path.join(tmpdir(), `lottery-mig-${Date.now()}.jsonl`)
  const p2 = await startServerOn(PORT2, dbFile2, ['--no-seed'])
  const mcall = (method, url, opts) => call(method, url, { ...(opts || {}), base: BASE2 })
  try {
    const plat2 = (await mcall('POST', '/api/auth/member-login', { body: { memberId: 'm-platform' } })).json.token
    assert(!!plat2, '空库（--no-seed）平台超管仍可登录（仅骨架引导）')
    const v0 = await mcall('POST', '/api/migration/validate', { token: plat2, body: { snapshot: snap } })
    assert(v0.status === 200, '离线快照在空库校验受理')
    const run1 = await mcall('POST', '/api/migration/run', {
      token: plat2, body: { snapshot: snap, batchId: 'mig-bridge-fixed' }
    })
    assert(run1.status === 200 && run1.json.manifest?.id === 'mig-bridge-fixed', '离线快照迁移上云成功')
    const run2 = await mcall('POST', '/api/migration/run', {
      token: plat2, body: { snapshot: snap, batchId: 'mig-bridge-fixed' }
    })
    assert(run2.status === 200 && run2.json.idempotent === true, '迁移批次重放幂等（零增量）')
    const m2 = await mcall('GET', '/api/migration/manifests', { token: plat2 })
    assert(m2.json.manifests.filter((m) => m.id === 'mig-bridge-fixed').length === 1, '迁移 manifest 仅一条')
    // 迁移后业务数据水合可见（租户/活动/流水/审核单全部重建）
    const cust = (await mcall('POST', '/api/auth/customer-login', { body: { userId: 'u-1001' } })).json.token
    const st = (await mcall('GET', '/api/state', { token: cust })).json
    assert(st.activities.length > 0 && st.pointRecords.length > 0 && st.records.length > 0,
      `迁移后水合：活动 ${st.activities.length}、流水 ${st.pointRecords.length}、记录 ${st.records.length}`)
  } finally {
    p2.kill('SIGTERM')
    await once(p2, 'exit').catch(() => {})
    fs.rmSync(dbFile2, { force: true })
  }

  if (failed) { console.error(`\n共 ${failed} 项失败 ❌`); process.exit(1) }
  console.log('\n全部通过 🎉')
  fs.rmSync(dbFile, { force: true })
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
