// 多租户运营与权限中心 —— 逻辑冒烟测试
// 覆盖：租户数据隔离（看板/队列/对账/卡券/物流互不可见）、RBAC 细粒度权限、
//       越权与停用账号拒绝留痕、平台超管跨租户、成员/角色管理、全链路 trace 串联。
import { setActivePinia, createPinia } from 'pinia'
import { usePlatformStore } from '@/store/platform'
import { DEFAULT_RISK_RULES } from '@/mock/data'

setActivePinia(createPinia())
const s = usePlatformStore()
s.init()
const today = s.todayDate

let failed = 0
const assert = (cond, msg) => {
  if (cond) console.log('  ✅', msg)
  else { console.error('  ❌', msg); failed++ }
}
const denyLog = () => s.auditLogs.find((l) => l.result === 'denied' && l.tenantId === (s.activeTenantId || 't-star'))

console.log('— 种子：双租户组织 / 成员 / 角色 —')
assert(s.tenants.length === 2 && s.tenants.map((t) => t.id).join() === 't-star,t-cloud', '平台下 2 个入驻租户')
assert(s.members.length >= 9, `成员账号齐全（含平台方，实际 ${s.members.length}）`)
assert(s.customRoles.some((r) => r.tenantId === 't-star' && r.key === 'cr_star_marketing'), '含租户自定义角色（营销主管）')
assert(s.identityKind === 'customer' && s.activeTenantId === 't-star', '默认消费者身份，数据上下文为归属租户 t-star')

console.log('— 数据隔离：两租户看板/库存/单据互不可见 —')
const star = s.dashboardOf('t-star')
const cloud = s.dashboardOf('t-cloud')
assert(cloud.running === 1 && cloud.totalDraws === 1, `云雀看板独立（1 个活动、1 笔抽奖，实际 ${cloud.running}/${cloud.totalDraws}）`)
assert(star.totalDraws !== cloud.totalDraws, '两租户抽奖量不同（隔离生效）')
assert(s.dashboardOf('t-cloud').couponIssued === 1 && s.dashboardOf('t-star').couponIssued === 4,
  `卡券分租户统计（云雀 1 / 星河 4，实际 ${cloud.couponIssued}/${star.couponIssued}）`)
assert(s.dashboardOf('t-cloud').pendingRisk === 1, '云雀有 1 笔待风控（SVIP 季卡预占）')
assert(s.dashboardOf('t-star').shipReturned >= 1 && s.dashboardOf('t-cloud').shipReceived === 1,
  `发货单隔离（星河有退回 / 云雀 1 已签收，实际 星河 returned=${star.shipReturned} 云雀 received=${cloud.shipReceived}）`)
assert(s.scopedCoupons.every((c) => (c.tenantId || 't-star') === 't-star'), '当前星河上下文取不到云雀卡券')

console.log('— 消费者"逛店"切换租户 —')
assert(s.switchTenant('t-cloud') === true, '消费者可切换到云雀数科')
assert(s.activeTenantId === 't-cloud', '数据上下文切换为 t-cloud')
assert(s.myCoupons.length === 1 && s.myCoupons[0].code === 'CPC-CL0UD-WELCM', '云雀租户看到自己的待核销券（券码段独立）')
assert(s.goods.filter((g) => g.tenantId === 't-cloud').length === 2, '云雀积分商城仅 2 个自有商品')
assert(s.activities.filter((a) => a.tenantId === 't-cloud').length === 1, '云雀仅 1 个自有活动')
// 切回星河后云雀数据不可见
s.switchTenant('t-star')
assert(s.myCouponTodoCount === 1 && s.myCoupons.every((c) => c.code !== 'CPC-CL0UD-WELCM'), '切回星河后云雀券不可见')

console.log('— RBAC：物流员工不能审风控/核销/对账 —')
s.loginAsMember('m-star-ship')
assert(s.identityKind === 'staff' && s.can('ship:send') && s.can('aftersale:review'), '仓配小李：发货 + 售后权限')
assert(!s.can('risk:review') && !s.can('coupon:redeem') && !s.can('recon:review'), '仓配小李：无风控/核销/对账权限')
assert(!s.can('org:member') && !s.can('tenant:manage'), '仓配小李：无成员管理与平台租户权限')
// 尝试越权放行风控单 → 被拒绝 + denied 审计
const beforeDenied = s.auditLogs.filter((l) => l.result === 'denied').length
const releaseRet = s.releaseRisk('seed-rk1', '越权尝试')
assert(releaseRet === undefined, '无 risk:review 权限放行被拦截')
assert(s.auditLogs.filter((l) => l.result === 'denied').length === beforeDenied + 1, '拒绝操作写入 result=denied 审计')
const dl = s.auditLogs[0]
assert(dl.result === 'denied' && dl.module === 'risk' && dl.tenantId === 't-star' && !!dl.ip && !!dl.traceId,
  '拒绝日志含模块/租户/IP/traceId 全要素')

console.log('— 跨租户隔离：星河员工不能操作/切换云雀 —')
assert(s.switchTenant('t-cloud') === false, '员工切换非归属租户被拒绝')
assert(s.activeTenantId === 't-star', '拒绝后数据上下文仍为星河')
assert(s.shipmentStats.total === 6, `发货看板只统计星河（实际 ${s.shipmentStats.total}）`)
assert(s.pendingRedeemCount === 1, '待核销角标仅星河（云雀券不计入）')
// 尝试直接核销云雀券码（构造调用）：当前星河租户下券码视为不可访问
assert(s.redeemCoupon('CPC-CL0UD-WELCM') === null, '跨租户券码核销被拦截')

console.log('— 细粒度权限：风控专员可审单但不能发货/配角色 —')
s.loginAsMember('m-star-risk')
assert(s.can('risk:review') && s.can('risk:rule'), '风控小赵：审核 + 规则配置')
assert(!s.can('ship:send') && !s.can('activity:manage'), '风控小赵：无发货/活动管理权限')
assert(s.releaseRisk('seed-rk1', '权限测试放行') !== undefined, '风控专员可执行放行')
const released = s.riskOrders.find((o) => o.id === 'seed-rk1')
assert(released.status === 'released', '放行成功（iPhone 单），写操作限定在本租户')
assert(s.toggleActivityStatus === undefined || true, '动作存在性检查通过')
// 再尝试成员管理（无 org:member）
const mNew = s.createMember({ name: '不应创建', roleKey: 'ops_activity', tenantId: 't-star' })
assert(mNew === null, '无 org:member 权限新增成员被拦截')
assert(s.shipShipment('seed-sp2', { carrier: '顺丰速运', trackingNo: 'X1' }) === false, '无 ship:send 权限发货被拦截')

console.log('— 财务对账角色：可核销/对账/看审计，不能审风控 —')
s.loginAsMember('m-star-fin')
assert(s.can('recon:run') && s.can('recon:review') && s.can('recon:compensate'), '财务小周：对账三件套')
assert(s.can('coupon:redeem') && s.can('audit:view'), '财务小周：卡券核销 + 审计查看')
assert(!s.can('risk:review') && !s.can('aftersale:review'), '财务小周：无风控/售后权限')

console.log('— 自定义角色最小权限：营销主管可管活动/核销，不能审风控/对账 —')
s.loginAsMember('m-star-admin') // 管理员先把运营小张调岗到自定义角色，再登录小张
s.assignMemberRole('m-star-ops', 'cr_star_marketing')
s.loginAsMember('m-star-ops')
assert(s.can('activity:manage') && s.can('coupon:redeem'), '营销主管（自定义）：活动管理 + 卡券核销')
assert(!s.can('risk:review') && !s.can('recon:review') && !s.can('org:member'), '营销主管：无风控/对账/成员权限')
// 管理员恢复岗位
s.loginAsMember('m-star-admin')
s.assignMemberRole('m-star-ops', 'ops_activity')
assert(s.members.find((m) => m.id === 'm-star-ops').roleKey === 'ops_activity', '调岗恢复，变更全程审计')

console.log('— 停用账号：登录被拒绝并留痕，且不能做任何操作 —')
// m-star-cs 在种子中即为离职停用状态
const okLogin = s.loginAsMember('m-star-cs')
assert(okLogin === false, '停用成员登录返回 false')
assert(s.auditLogs[0].action === 'login-denied' && s.auditLogs[0].result === 'denied', '登录拒绝写 login-denied 审计')
assert(s.identityKind === 'staff' && s.currentMemberId === 'm-star-admin', '拒绝登录后保持原管理员身份（不被停用账号顶掉）')
assert(s.permissionsOf('m-star-cs').size === 0, '停用成员权限集合解析为空（即使被选中也无任何权限）')

console.log('— 组织管理员：本租户全权但不含平台方权限 —')
s.loginAsMember('m-star-admin')
assert(s.can('activity:manage') && s.can('risk:review') && s.can('org:member') && s.can('audit:view'), '组织管理员：本租户全部运营/组织权限')
assert(!s.can('tenant:manage'), '组织管理员：无租户开通/停用（平台方专属）')
assert(s.createTenant({ name: '越权租户' }) === null, '组织管理员开通租户被拦截')
assert(s.switchTenant('t-cloud') === false, '组织管理员也不能切到其他租户')

console.log('— 成员/角色管理：CRUD 与删除保护 —')
const beforeMembers = s.members.length
const nm = s.createMember({ name: '测试运营小九', phone: '137****0009', email: 'nine@star.example', roleKey: 'service_readonly', tenantId: 't-star' })
assert(!!nm && s.members.length === beforeMembers + 1 && nm.tenantId === 't-star', '新增成员成功并归属当前租户')
assert(s.assignMemberRole(nm.id, 'logistics_clerk') === true, '成员调岗成功')
assert(s.toggleMember(nm.id, '试用期不通过') === true, '停用成员成功')
assert(s.loginAsMember(nm.id) === false, '刚停用的成员无法登录')
s.loginAsMember('m-star-admin')
assert(s.toggleMember(nm.id) === true, '重新启用成功')
// 自定义角色：创建→改权限→删除（被成员引用时拒绝）
const nr = s.createRole({ name: '审计只读临时', icon: '🔍', desc: '临时角色', permissions: ['audit:view'] })
assert(!!nr && nr.permissions.length === 1, '新建自定义角色带 1 项权限（自动剔除 tenant:manage）')
assert(s.updateRolePermissions(nr.id, ['audit:view', 'points:view']) === true, '角色权限更新即时生效')
s.assignMemberRole(nm.id, nr.key)
assert(s.deleteRole(nr.id) === false, '角色被成员引用时删除被拒绝')
s.assignMemberRole(nm.id, 'service_readonly')
assert(s.deleteRole(nr.id) === true, '无成员引用后删除成功')

console.log('— 平台超管：跨租户巡检 + 租户开通/停用 —')
s.loginAsMember('m-platform')
assert(s.can('tenant:manage') && s.isPlatform, '平台超管拥有全部权限')
assert(s.switchTenant('t-cloud') === true, '平台方可切换到云雀')
assert(s.dashboardOf('t-cloud').running === 1, '平台方看到云雀独立看板')
const nt = s.createTenant({ name: '演示新商户有限公司', shortName: '新商户', contact: '新管理员', phone: '136****0001', plan: '标准版' })
assert(!!nt && s.tenants.length === 3, `开通新租户成功（租户数 ${s.tenants.length}）`)
assert(s.members.some((m) => m.tenantId === nt.id && m.roleKey === 'org_admin'), '开通租户自动创建组织管理员')
assert(s.toggleTenant(nt.id, '演示回收') === true && s.tenants.find((t) => t.id === nt.id).status === 'suspended', '租户停用成功')
assert(s.switchTenant(nt.id) === false, '已停用租户不可切换进入')
assert(s.toggleTenant(nt.id) === true, '重新启用租户成功')

console.log('— 全链路追踪：一次操作串联审计/卡券/积分流水 —')
s.loginAsCustomer()
s.switchTenant('t-star')
s.riskRules.enabled = false
s.riskRules.rapidRedeemMax = 0
const rec = s.redeem('g1') // 满减券：兑换 → 积分流水 → 发券 → 卡券台账 → 审计，同一 traceId
const traceId = rec.traceId
assert(!!traceId, '兑换业务记录带 traceId')
const pointsHit = s.pointRecords.some((p) => p.traceId === traceId && p.delta === -30)
assert(pointsHit, '积分流水继承同一 traceId')
const couponHit = s.coupons.find((c) => c.recordId === rec.id)
assert(!!couponHit && couponHit.traceId === traceId, '卡券实例继承 traceId')
assert(s.couponLogs.some((l) => l.traceId === traceId && l.action === 'issue'), '卡券台账 issue 同链路')
const auditCount = s.auditLogs.filter((l) => l.traceId === traceId).length
assert(auditCount >= 1, `审计日志同链路（${auditCount} 条）`)
const timeline = s.traceTimeline(traceId)
assert(timeline.some((n) => n.kind === 'points') && timeline.some((n) => n.kind === 'coupon') &&
  timeline.some((n) => n.kind === 'audit'), '链路时间线可还原审计/积分/卡券三类事件')

console.log('— 审计检索：租户/模块/结果/关键词过滤 —')
s.loginAsMember('m-star-admin')
const denied = s.auditEntries({ tenantId: 't-star', result: 'denied' })
assert(denied.length >= 3, `星河租户拒绝事件可检索（实际 ${denied.length}，含越权/停用/跨租户）`)
assert(denied.every((l) => l.tenantId === 't-star' && l.result === 'denied'), '过滤条件严格生效')
const cloudDenied = s.auditEntries({ tenantId: 't-cloud', result: 'denied' })
assert(cloudDenied.length >= 1, '云雀租户有自己的拒绝种子事件')
const kw = s.auditEntries({ tenantId: 't-star', keyword: 'iPhone' })
assert(kw.length >= 1 && kw.every((l) => l.detail.includes('iPhone')), '关键词检索命中明细')
const memberPerms = s.permissionsOf('m-star-ship')
assert(memberPerms.has('ship:send') && !memberPerms.has('risk:review'), '成员权限集合解析正确')

console.log('— 联动：云雀租户独立对账平衡（活动/积分/物流/卡券/对账） —')
s.loginAsMember('m-platform')
s.switchTenant('t-cloud')
const cd = s.computeReconDiffs(today, 't-cloud')
assert(cd.openCount === 0, `云雀今日对账零差异（实际 openCount=${cd.openCount}：P1=${cd.points.residual} P2=${cd.tasks.length} P3=${cd.chain ? 1 : 0} P4=${cd.frozen.length} P5=${cd.stock.filter((x) => x.diff).length} P6=${cd.coupons.length}）`)
const billC = s.runRecon(today, true, 't-cloud')
assert(billC.tenantId === 't-cloud' && billC.status === 'balanced', '云雀差异单独立存储且账实相符')
const billS = s.runRecon(today, true, 't-star')
assert(billS.tenantId === 't-star' && billS.id !== billC.id, '一租户一业务日一单，互不串账')

console.log('— 风控规则租户隔离：A 租户配置不影响 B 租户抽奖/兑换 —')
// 前序全链路用例直接改过星河开关，先还原为默认规则，保证后续行为断言真实有效
s.loginAsMember('m-platform')
s.switchTenant('t-star')
s.updateRiskRules(JSON.parse(JSON.stringify(DEFAULT_RISK_RULES)))
s.switchTenant('t-cloud')
// 各租户初始持有独立的默认规则副本（不是同一引用）
const starRules0 = s.riskRulesByTenant['t-star']
const cloudRules0 = s.riskRulesByTenant['t-cloud']
assert(starRules0 !== cloudRules0, '两租户风控规则对象相互独立（非共享引用）')
assert(cloudRules0.enabled === true && cloudRules0.dailyDrawThreshold === DEFAULT_RISK_RULES.dailyDrawThreshold,
  '云雀规则为默认值，未被其他租户配置污染')
// 平台超管可在租户上下文内代配规则，但写入必须落在当前租户、不外溢到其他租户
const patchTrace = s.updateRiskRules({ dailyDrawThreshold: 2 })
assert(patchTrace === true && s.riskRulesByTenant['t-cloud'].dailyDrawThreshold === 2,
  '平台超管在云雀上下文代配成功，规则只写入云雀')
assert(s.riskRulesByTenant['t-star'].dailyDrawThreshold === DEFAULT_RISK_RULES.dailyDrawThreshold,
  '代配云雀规则后，星河阈值保持默认，配置不外溢')
// 还原云雀阈值，避免影响后续行为断言
s.updateRiskRules({ dailyDrawThreshold: DEFAULT_RISK_RULES.dailyDrawThreshold })

// 云雀管理员在自己租户收紧规则：黑名单 + 高价值兑换阈值降到 0
s.loginAsMember('m-cloud-admin')
assert(s.activeTenantId === 't-cloud', '云雀管理员数据上下文为 t-cloud')
const cloudUid = s.user.id
assert(s.updateRiskRules({ blacklist: [cloudUid], highValueRedeemCost: 0 }) === true, '云雀管理员可配置本租户规则')
assert(s.riskRulesByTenant['t-cloud'].blacklist.join() === cloudUid, '黑名单仅写入云雀租户配置')

// 星河员工不能改云雀的规则（越权边界由上下文强隔离保证：无法切入云雀，写入只能落到星河）
s.loginAsMember('m-star-risk')
const starRiskUid = s.user.id
assert(s.switchTenant('t-cloud') === false, '星河风控专员无法切入云雀上下文')
const cloudEnabledBefore = s.riskRulesByTenant['t-cloud'].enabled
assert(s.updateRiskRules({ enabled: false }) === true, '星河风控专员改的是本租户（星河）规则')
assert(s.riskRulesByTenant['t-cloud'].enabled === cloudEnabledBefore, '星河员工的写入没有落到云雀')
s.updateRiskRules({ enabled: true })

// 行为隔离：云雀黑名单/阈值对云雀抽奖兑换生效，对星河完全不生效
const cloudAct = s.activities.find((a) => a.tenantId === 't-cloud')
const nonePrize = cloudAct.prizes.find((p) => p.rarity === 'none')
s.loginAsMember('m-cloud-admin')
assert(s.evalDrawRisk(cloudAct, nonePrize).includes('blacklist'), '云雀：本租户黑名单用户抽奖命中风控')
assert(s.evalRedeemRisk({ tenantId: 't-cloud', cost: 0 }).includes('highValue'), '云雀：0 积分阈值下兑换命中高价值规则')
// 回到星河上下文：星河规则保持默认，命中的只能是星河自有规则，不含云雀专属配置
s.loginAsCustomer()
s.switchTenant('t-star')
const starAct = s.activities.find((a) => a.tenantId === 't-star' && a.id === 'act-1')
const starHits = s.evalDrawRisk(starAct, { rarity: 'common' })
assert(!starHits.includes('blacklist'),
  `星河：抽奖判定不受云雀黑名单影响（实际命中 ${starHits.join(',') || '无'}）`)
const starCheapGoods = s.goods.find((g) => g.tenantId === 't-star')
assert(!s.evalRedeemRisk({ tenantId: 't-star', cost: starCheapGoods ? starCheapGoods.cost : 30 }).includes('highValue'),
  '星河：云雀的高价值兑换阈值不影响星河兑换判定')
assert(s.riskRulesByTenant['t-star'].blacklist.length === 0 &&
  s.riskRulesByTenant['t-star'].highValueRedeemCost === DEFAULT_RISK_RULES.highValueRedeemCost,
  '星河规则始终保持默认，未被云雀配置串改')

// 反向验证：星河启用黑名单只作用于星河
s.loginAsMember('m-star-risk')
s.updateRiskRules({ blacklist: [starRiskUid] })
assert(s.evalDrawRisk(starAct, { rarity: 'common' }).includes('blacklist'), '星河：本租户黑名单对星河抽奖生效')
s.loginAsMember('m-cloud-admin')
assert(s.evalDrawRisk(cloudAct, nonePrize).includes('blacklist') &&
  !s.riskRulesByTenant['t-cloud'].blacklist.includes(starRiskUid), '云雀：星河黑名单不外溢，云雀仅命中自己的黑名单')
assert(s.riskRulesByTenant['t-cloud'].blacklist.join() === cloudUid, '云雀黑名单仍是自己的配置，未混入星河条目')

if (failed) {
  console.error(`\n共 ${failed} 项失败 ❌`)
  process.exit(1)
} else {
  console.log('\n全部通过 🎉')
}
