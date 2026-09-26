<template>
  <div class="tenant-view">
    <!-- 身份与租户上下文横幅 -->
    <div class="tc-hero">
      <div class="hero-left">
        <span class="h-avatar">{{ store.currentMember?.avatar || store.user.avatar }}</span>
        <div>
          <div class="h-title">
            {{ identityTitle }}
            <span class="h-role">{{ identityRoleLabel }}</span>
            <span v-if="tenant" class="h-tenant" :class="tenant.status">{{ tenant.icon }} {{ tenant.shortName }} · {{ tenant.plan }}</span>
          </div>
          <div class="h-sub">
            {{ identityDesc }}
          </div>
        </div>
      </div>
      <div class="hero-actions">
        <!-- 快速身份切换 -->
        <button class="qa-btn" @click="store.loginAsCustomer()">👤 切回消费者</button>
        <button class="qa-btn" @click="quickLogin('m-star-admin')">👑 星河管理员</button>
        <button class="qa-btn" @click="quickLogin('m-cloud-admin')">👑 云雀管理员</button>
        <button class="qa-btn platform" @click="quickLogin('m-platform')">⚙️ 平台超管</button>
      </div>
    </div>

    <!-- 服务端履约连接 / 离线快照上云 -->
    <ServerPanel />

    <!-- 数据隔离说明 -->
    <div class="card iso-card">
      <div class="card-title">🔒 多租户数据隔离模型</div>
      <div class="iso-grid">
        <div class="iso-item"><b>隔离键</b><code>tenantId</code> 标记活动/库存/业务记录/审核单/发货单/售后单/卡券实例与台账/积分流水/对账差异单/库存校正凭证/审计日志</div>
        <div class="iso-item"><b>查询隔离</b>看板、队列、对账、卡券、物流全部按当前数据上下文租户过滤，员工不能看到其他租户数据</div>
        <div class="iso-item"><b>操作隔离</b>写操作强制 RBAC 权限校验 + 租户归属校验，越权访问被拒绝并写入 <code>result=denied</code> 审计</div>
        <div class="iso-item"><b>平台方</b>仅平台超管可跨租户切换视图、开通/停用租户；不直接参与单租户业务操作</div>
      </div>
    </div>

    <!-- 平台超管：租户（组织）管理 -->
    <div class="card" v-if="store.isPlatform">
      <div class="card-title">🏢 入驻组织（租户）管理
        <button class="btn-primary small" @click="showCreateTenant = !showCreateTenant">＋ 开通新租户</button>
      </div>
      <div v-if="showCreateTenant" class="inline-form">
        <input v-model="tenantForm.name" placeholder="组织全称，如：XX商贸有限公司" />
        <input v-model="tenantForm.shortName" placeholder="简称" />
        <input v-model="tenantForm.contact" placeholder="管理员姓名" />
        <input v-model="tenantForm.phone" placeholder="联系手机" />
        <select v-model="tenantForm.plan">
          <option>标准版</option><option>旗舰版</option>
        </select>
        <button class="btn-primary" @click="doCreateTenant">开通并创建管理员</button>
      </div>
      <div v-for="t in store.tenants" :key="t.id" class="tenant-row" :class="t.status">
        <span class="t-icon">{{ t.icon }}</span>
        <div class="t-main">
          <div class="t-name">{{ t.name }}
            <span class="t-plan">{{ t.plan }}</span>
            <span class="t-status" :class="t.status">{{ t.status === 'active' ? '运行中' : '已停用' }}</span>
          </div>
          <div class="t-meta">{{ t.region }} · 联系人 {{ t.contact }} {{ t.phone }} · 入驻 {{ t.createdAt }}</div>
          <div class="t-iso">{{ t.dataIsolation }}</div>
        </div>
        <div class="t-stats">
          <span><b>{{ summaryOf(t.id).members }}</b> 成员</span>
          <span><b>{{ summaryOf(t.id).activities }}</b> 活动</span>
          <span><b>{{ summaryOf(t.id).riskPending }}</b> 待风控</span>
          <span><b>{{ summaryOf(t.id).shipments }}</b> 发货单</span>
          <span><b>{{ summaryOf(t.id).coupons }}</b> 卡券</span>
          <span><b>{{ summaryOf(t.id).reconOpen }}</b> 待复核</span>
        </div>
        <div class="t-ops">
          <button class="btn-ghost" @click="store.switchTenant(t.id)">进入视图</button>
          <button class="btn-warn" @click="store.toggleTenant(t.id, t.status === 'active' ? '平台运营策略调整' : '')">{{ t.status === 'active' ? '停用' : '启用' }}</button>
        </div>
      </div>
    </div>

    <!-- 非平台：当前租户概览卡 -->
    <div class="card" v-else>
      <div class="card-title">{{ tenant?.icon }} 当前组织：{{ tenant?.name }}</div>
      <div class="t-meta">{{ tenant?.region }} · 联系人 {{ tenant?.contact }} · {{ tenant?.plan }} · 入驻 {{ tenant?.createdAt }}</div>
      <div class="t-stats big">
        <span><b>{{ summary.activities }}</b> 活动</span>
        <span><b>{{ summary.members }}</b> 成员（{{ summary.activeMembers }} 在职）</span>
        <span><b>{{ summary.riskPending }}</b> 待风控</span>
        <span><b>{{ summary.afterSalePending }}</b> 售后待审</span>
        <span><b>{{ summary.coupons }}</b> 卡券</span>
        <span><b>{{ summary.reconOpen }}</b> 对账待复核</span>
        <span><b>{{ summary.auditToday }}</b> 今日审计事件</span>
      </div>
    </div>

    <!-- 成员管理 -->
    <div class="card" v-if="canMember">
      <div class="card-title">👥 成员账号（{{ members.length }}）
        <button class="btn-primary small" @click="openCreateMember">＋ 新增成员</button>
      </div>
      <div v-if="creatingMember" class="inline-form">
        <input v-model="memberForm.name" placeholder="姓名" />
        <input v-model="memberForm.phone" placeholder="手机" />
        <input v-model="memberForm.email" placeholder="邮箱" />
        <select v-model="memberForm.roleKey">
          <option v-for="r in store.tenantRoles(viewingTenantId)" :key="r.key" :value="r.key">{{ r.icon }} {{ r.name }}</option>
        </select>
        <button class="btn-primary" @click="doCreateMember">创建</button>
      </div>
      <table class="grid-table">
        <thead><tr><th>成员</th><th>角色</th><th>联系方式</th><th>状态</th><th>最近登录</th><th>权限数</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="m in members" :key="m.id" :class="{ disabled: m.status === 'disabled', self: m.id === store.currentMemberId }">
            <td><span class="m-avatar">{{ m.avatar }}</span> {{ m.name }} <em v-if="m.id === store.currentMemberId" class="self-tag">当前登录</em></td>
            <td>
              <select :value="m.roleKey" :disabled="!canRole || m.status !== 'active'"
                      @change="(e) => store.assignMemberRole(m.id, e.target.value)">
                <option v-for="r in store.tenantRoles(viewingTenantId)" :key="r.key" :value="r.key">{{ r.name }}</option>
              </select>
            </td>
            <td class="muted">{{ m.phone }}<br>{{ m.email }}</td>
            <td><span class="m-status" :class="m.status">{{ m.status === 'active' ? '在职' : '已停用' }}</span>
              <div v-if="m.disabledReason" class="m-reason">{{ m.disabledReason }}</div></td>
            <td class="muted">{{ m.lastLoginAt || '—' }}</td>
            <td>{{ permCount(m) }}</td>
            <td class="ops">
              <button class="btn-ghost small" @click="store.loginAsMember(m.id)" :title="m.status === 'disabled' ? '停用账号登录将被拒绝并留痕' : '模拟登录该账号'">
                {{ m.status === 'disabled' ? '🔒 尝试登录' : '🔑 登录' }}
              </button>
              <button class="btn-warn small" @click="store.toggleMember(m.id)">{{ m.status === 'active' ? '停用' : '启用' }}</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 无成员管理权限：只读成员名单 -->
    <div class="card" v-else-if="store.identityKind === 'staff'">
      <div class="card-title">👥 组织成员（只读，无成员管理权限）</div>
      <div v-for="m in members" :key="m.id" class="member-readonly">
        <span class="m-avatar">{{ m.avatar }}</span>
        <span class="mr-name">{{ m.name }}</span>
        <span class="mr-role">{{ store.roleLabelOf(m.roleKey) }}</span>
        <span class="m-status" :class="m.status">{{ m.status === 'active' ? '在职' : '已停用' }}</span>
      </div>
    </div>

    <!-- 角色与权限目录 -->
    <div class="card" v-if="store.identityKind !== 'customer'">
      <div class="card-title">🛡️ 角色与权限（RBAC）
        <button v-if="canRole" class="btn-primary small" @click="openCreateRole">＋ 新建角色</button>
      </div>
      <div v-if="creatingRole" class="inline-form role-form">
        <input v-model="roleForm.name" placeholder="角色名称，如：华东区域运营" />
        <input v-model="roleForm.icon" placeholder="图标 emoji" style="max-width:90px" />
        <input v-model="roleForm.desc" placeholder="职责描述" />
        <div class="perm-pick">
          <label v-for="g in permGroups" :key="g.group" class="pg">
            <div class="pg-title">{{ g.icon }} {{ g.group }}</div>
            <label v-for="p in g.perms" :key="p.key" class="pp" :class="{ off: p.key === 'tenant:manage' && !store.isPlatform }">
              <input type="checkbox" :value="p.key" v-model="roleForm.permissions"
                     :disabled="p.key === 'tenant:manage' && !store.isPlatform" />
              {{ p.name }}
            </label>
          </label>
        </div>
        <button class="btn-primary" @click="doCreateRole">保存角色</button>
      </div>

      <div v-for="r in roles" :key="r.key" class="role-card" :class="{ builtin: r.builtin, custom: !r.builtin }">
        <div class="rc-head">
          <span class="rc-icon">{{ r.icon }}</span>
          <div class="rc-main">
            <div class="rc-name">{{ r.name }}
              <span v-if="r.builtin" class="rc-tag builtin">内置</span>
              <span v-else class="rc-tag custom">自定义</span>
              <span class="rc-count">{{ r.permissions === '*' ? '全部权限' : (r.permissions.length + ' 项权限') }}</span>
            </div>
            <div class="rc-desc">{{ r.desc }}</div>
          </div>
          <div v-if="!r.builtin && canRole" class="rc-ops">
            <button class="btn-warn small" @click="store.deleteRole(r.id)">删除</button>
          </div>
        </div>
        <div class="rc-perms">
          <template v-if="r.permissions === '*'">
            <span v-for="g in permGroupsFiltered" :key="g.group" class="perm-chip star">
              {{ g.icon }} {{ r.key === 'platform_admin' ? g.group : (g.group === '平台方' ? '' : g.group) }}
            </span>
            <span v-if="r.key === 'org_admin'" class="perm-hint">隐式包含除「租户开通/停用」外的全部本租户权限</span>
            <span v-else class="perm-hint">平台超管：全租户只读巡检 + 租户管理，不参与单租户业务操作</span>
          </template>
          <template v-else>
            <span v-for="p in expandedPerms(r)" :key="p" class="perm-chip">{{ permLabel(p) }}</span>
            <span v-if="!r.permissions.length" class="perm-hint">空权限角色：登录后仅可见组织概况</span>
            <div v-if="!r.builtin && canRole" class="rc-edit">
              <label v-for="g in permGroups" :key="g.group" class="pg-inline">
                <span>{{ g.icon }}{{ g.group }}：</span>
                <label v-for="p in g.perms" :key="p.key" class="pp mini">
                  <input type="checkbox" :checked="r.permissions.includes(p.key)"
                         :disabled="p.key === 'tenant:manage'"
                         @change="toggleRolePerm(r, p.key)" />
                  {{ p.name }}
                </label>
              </label>
            </div>
          </template>
        </div>
        <div class="rc-members">成员：
          <span v-for="m in membersOfRole(r.key)" :key="m.id" class="rm-chip">{{ m.avatar }} {{ m.name }}</span>
          <em v-if="!membersOfRole(r.key).length" class="muted">暂无成员</em>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'
import { usePlatformStore } from '@/store/platform'
import { PERMISSION_GROUPS, PERMISSION_LABELS } from '@/mock/tenant'
import ServerPanel from './ServerPanel.vue'

const store = usePlatformStore()
const permGroups = PERMISSION_GROUPS

const tenant = computed(() => store.activeTenant)
const viewingTenantId = computed(() => store.activeTenantId)

const identityTitle = computed(() => {
  if (store.isPlatform) return '平台运营控制台'
  if (store.identityKind === 'staff') return store.currentMember?.name || '员工'
  return store.user.name
})
const identityRoleLabel = computed(() => {
  if (store.isPlatform) return '平台超级管理员'
  if (store.identityKind === 'staff') return store.roleLabelOf(store.currentMember?.roleKey)
  return '消费者'
})
const identityDesc = computed(() => {
  if (store.isPlatform) return '跨租户巡检：可进入任一租户数据视图、开通/停用组织；操作均按平台方身份留痕'
  if (store.identityKind === 'staff')
    return `${store.activeTenant.shortName} 员工 · IP ${store.currentMember?.ip} · 仅可访问本租户数据，越权操作将被拦截并审计`
  return `消费者身份 · 当前浏览 ${store.activeTenant.shortName} 的活动/商城（切换组织即切换"逛店"上下文）`
})

const canMember = computed(() => store.can('org:member'))
const canRole = computed(() => store.can('org:role'))

// 成员列表：平台超管看全部租户；员工看本租户
const members = computed(() =>
  store.isPlatform
    ? store.members
    : store.members.filter((m) => m.tenantId === store.activeTenantId)
)
const roles = computed(() =>
  store.isPlatform
    ? store.allRoles
    : store.tenantRoles(viewingTenantId.value)
)
const permGroupsFiltered = computed(() =>
  store.isPlatform ? permGroups : permGroups.filter((g) => g.group !== '平台方')
)
const summary = computed(() => store.tenantSummary(viewingTenantId.value))
const summaryOf = (id) => store.tenantSummary(id)
const membersOfRole = (key) => members.value.filter((m) => m.roleKey === key)
const permLabel = (k) => PERMISSION_LABELS[k] || k
function expandedPerms(r) {
  // 自定义角色去重展示
  return [...new Set(r.permissions || [])]
}
function permCount(m) {
  const perms = store.permissionsOf(m.id)
  if (perms.has('*')) return m.tenantId ? '全部' : '平台全部'
  return perms.size
}
function quickLogin(id) {
  store.loginAsMember(id)
  if (store.currentMember?.tenantId) store.switchTenant(store.currentMember.tenantId)
}

// 新增成员
const creatingMember = ref(false)
const memberForm = reactive({ name: '', phone: '', email: '', roleKey: 'ops_activity' })
function openCreateMember() {
  creatingMember.value = true
  Object.assign(memberForm, { name: '', phone: '', email: '', roleKey: 'ops_activity' })
}
function doCreateMember() {
  const m = store.createMember({ ...memberForm, tenantId: viewingTenantId.value })
  if (m) { creatingMember.value = false; Object.assign(memberForm, { name: '', phone: '', email: '' }) }
}

// 新建租户
const showCreateTenant = ref(false)
const tenantForm = reactive({ name: '', shortName: '', contact: '', phone: '', plan: '标准版' })
function doCreateTenant() {
  const t = store.createTenant({ ...tenantForm })
  if (t) {
    showCreateTenant.value = false
    Object.assign(tenantForm, { name: '', shortName: '', contact: '', phone: '' })
  }
}

// 新建角色
const creatingRole = ref(false)
const roleForm = reactive({ name: '', icon: '🛠️', desc: '', permissions: [] })
function openCreateRole() {
  creatingRole.value = true
  Object.assign(roleForm, { name: '', icon: '🛠️', desc: '', permissions: [] })
}
function doCreateRole() {
  const r = store.createRole({ ...roleForm })
  if (r) creatingRole.value = false
}
function toggleRolePerm(role, key) {
  const set = new Set(role.permissions || [])
  if (set.has(key)) set.delete(key); else set.add(key)
  store.updateRolePermissions(role.id, [...set])
}
</script>

<style scoped>
.tenant-view { display: flex; flex-direction: column; gap: 16px; max-width: 1120px; margin: 0 auto; }
.tc-hero {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  background: linear-gradient(135deg, #2a1a5e, #1a3a8f); border: 1px solid rgba(149,117,255,0.35);
  border-radius: 14px; padding: 18px 22px; flex-wrap: wrap;
}
.hero-left { display: flex; align-items: center; gap: 14px; }
.h-avatar {
  width: 48px; height: 48px; border-radius: 12px; background: rgba(255,255,255,0.14);
  display: grid; place-items: center; font-size: 26px;
}
.h-title { font-size: 17px; font-weight: 800; color: #fff; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.h-role { font-size: 11px; background: rgba(255,255,255,0.18); padding: 2px 9px; border-radius: 10px; font-weight: 600; }
.h-tenant { font-size: 11px; background: rgba(126,240,201,0.18); color: #7ef0c9; padding: 2px 9px; border-radius: 10px; }
.h-sub { font-size: 11px; color: #b9c6ef; margin-top: 3px; max-width: 640px; }
.hero-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.qa-btn {
  background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: #e8eefb;
  font-size: 11px; padding: 7px 11px; border-radius: 8px; cursor: pointer;
}
.qa-btn:hover { background: rgba(255,255,255,0.22); }
.qa-btn.platform { background: rgba(255,152,0,0.2); border-color: rgba(255,152,0,0.5); }

.card {
  background: #0f1b38; border: 1px solid rgba(120,160,220,0.16);
  border-radius: 14px; padding: 16px 18px;
}
.card-title {
  font-size: 15px; font-weight: 700; color: #fff; margin-bottom: 12px;
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
}
.iso-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
@media (max-width: 800px) { .iso-grid { grid-template-columns: 1fr; } }
.iso-item {
  background: rgba(20,34,66,0.6); border: 1px solid rgba(120,160,220,0.12);
  border-radius: 9px; padding: 10px 12px; font-size: 12px; color: #b9c6e3; line-height: 1.7;
}
.iso-item b { color: #ce93d8; display: block; font-size: 11px; }
.iso-item code { background: #0c1730; padding: 1px 6px; border-radius: 5px; color: #82b1ff; font-size: 11px; }

.inline-form {
  display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px;
  background: rgba(20,34,66,0.5); padding: 12px; border-radius: 10px;
}
.inline-form input, .inline-form select {
  background: #0c1730; border: 1px solid rgba(120,160,220,0.25); color: #dbe4f3;
  border-radius: 8px; padding: 8px 10px; font-size: 12px;
}
.role-form { flex-direction: column; }
.perm-pick { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; width: 100%; }
@media (max-width: 900px) { .perm-pick { grid-template-columns: 1fr; } }
.pg { background: rgba(12,23,48,0.6); border-radius: 8px; padding: 8px 10px; }
.pg-title { font-size: 11px; color: #ce93d8; font-weight: 700; margin-bottom: 5px; }
.pp { display: flex; gap: 6px; align-items: flex-start; font-size: 11px; color: #c6d2e6; padding: 2px 0; cursor: pointer; }
.pp.off { opacity: 0.45; }

.tenant-row {
  display: flex; align-items: center; gap: 14px; padding: 13px 0;
  border-bottom: 1px dashed rgba(120,160,220,0.12);
}
.tenant-row:last-child { border-bottom: none; }
.tenant-row.suspended { opacity: 0.75; }
.t-icon { font-size: 28px; }
.t-main { flex: 1; min-width: 0; }
.t-name { font-size: 14px; color: #fff; font-weight: 700; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.t-plan { font-size: 10px; background: rgba(126,240,201,0.15); color: #7ef0c9; padding: 1px 8px; border-radius: 9px; }
.t-status { font-size: 10px; padding: 1px 8px; border-radius: 9px; }
.t-status.active { background: rgba(76,175,80,0.18); color: #7ef0c9; }
.t-status.suspended { background: rgba(239,154,154,0.18); color: #ef9a9a; }
.t-meta { font-size: 11px; color: #7e92bd; margin-top: 2px; }
.t-iso { font-size: 10px; color: #8fa4cc; margin-top: 3px; }
.t-stats { display: flex; gap: 12px; flex-wrap: wrap; font-size: 10px; color: #8ba2c8; }
.t-stats b { color: #82b1ff; font-size: 13px; display: block; }
.t-stats.big { margin-top: 10px; gap: 18px; }
.t-stats.big b { font-size: 18px; }
.t-ops { display: flex; gap: 6px; }

.grid-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.grid-table th { text-align: left; color: #8ba2c8; font-weight: 600; font-size: 11px; padding: 7px 9px; border-bottom: 1px solid rgba(120,160,220,0.2); }
.grid-table td { padding: 9px; border-bottom: 1px dashed rgba(120,160,220,0.1); vertical-align: middle; }
.grid-table tr.disabled { opacity: 0.55; }
.grid-table tr.self td { background: rgba(41,98,255,0.08); }
.m-avatar { font-size: 17px; }
.muted { color: #7e92bd; font-size: 11px; }
.self-tag { font-style: normal; font-size: 9px; background: rgba(41,98,255,0.25); color: #82b1ff; padding: 1px 7px; border-radius: 9px; }
.m-status { font-size: 10px; padding: 2px 8px; border-radius: 9px; }
.m-status.active { background: rgba(76,175,80,0.16); color: #7ef0c9; }
.m-status.disabled { background: rgba(239,154,154,0.16); color: #ef9a9a; }
.m-reason { font-size: 10px; color: #ef9a9a; margin-top: 3px; max-width: 170px; }
.ops { display: flex; gap: 5px; }
select {
  background: #0c1730; border: 1px solid rgba(120,160,220,0.25); color: #dbe4f3;
  border-radius: 7px; padding: 5px 7px; font-size: 11px;
}
.member-readonly { display: flex; align-items: center; gap: 10px; padding: 7px 0; font-size: 12px; border-bottom: 1px dashed rgba(120,160,220,0.08); }
.mr-name { color: #e8eefb; }
.mr-role { color: #b39ddb; font-size: 11px; margin-left: auto; }

.role-card {
  background: rgba(20,34,66,0.5); border: 1px solid rgba(120,160,220,0.14);
  border-left: 3px solid #7e57c2; border-radius: 10px; padding: 13px 14px; margin-bottom: 10px;
}
.role-card.builtin { border-left-color: #42a5f5; }
.rc-head { display: flex; gap: 10px; align-items: flex-start; }
.rc-icon { font-size: 22px; }
.rc-main { flex: 1; }
.rc-name { font-size: 13px; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.rc-tag { font-size: 9px; padding: 1px 7px; border-radius: 9px; }
.rc-tag.builtin { background: rgba(66,165,245,0.2); color: #82b1ff; }
.rc-tag.custom { background: rgba(126,87,194,0.25); color: #ce93d8; }
.rc-count { font-size: 10px; color: #8ba2c8; font-weight: 400; }
.rc-desc { font-size: 11px; color: #93a6ce; margin-top: 2px; }
.rc-perms { display: flex; flex-wrap: wrap; gap: 5px; margin: 9px 0 7px; }
.perm-chip {
  font-size: 10px; background: rgba(126,87,194,0.14); color: #d1b3f0;
  border: 1px solid rgba(126,87,194,0.3); padding: 2px 8px; border-radius: 9px;
}
.perm-chip.star { background: rgba(255,193,7,0.12); border-color: rgba(255,193,7,0.35); color: #ffd54f; }
.perm-hint { font-size: 10px; color: #8ba2c8; align-self: center; }
.rc-edit { width: 100%; display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 8px; border-top: 1px dashed rgba(120,160,220,0.14); padding-top: 8px; }
.pg-inline { font-size: 10px; color: #8ba2c8; }
.pg-inline > span { color: #b39ddb; font-weight: 700; display: block; margin-bottom: 3px; }
.pp.mini { display: inline-flex; margin-right: 9px; font-size: 10px; color: #aebadd; }
.rc-members { font-size: 11px; color: #8ba2c8; }
.rm-chip {
  font-style: normal; font-size: 10px; background: rgba(41,98,255,0.12);
  color: #a8c4ff; padding: 1px 8px; border-radius: 9px; margin-left: 5px;
}

.btn-primary {
  background: linear-gradient(135deg,#5e35b1,#7e57c2); color: #fff; border: none;
  border-radius: 8px; padding: 8px 14px; font-size: 12px; cursor: pointer;
}
.btn-ghost {
  background: transparent; border: 1px solid rgba(120,160,220,0.3); color: #aebadd;
  border-radius: 7px; padding: 6px 10px; font-size: 11px; cursor: pointer;
}
.btn-warn {
  background: rgba(255,112,67,0.15); border: 1px solid rgba(255,112,67,0.4); color: #ffab91;
  border-radius: 7px; padding: 6px 10px; font-size: 11px; cursor: pointer;
}
.small { padding: 5px 10px; font-size: 11px; }
.card-title .small { margin-left: auto; }
</style>
