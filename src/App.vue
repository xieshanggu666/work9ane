<template>
  <div class="layout">
    <header class="topbar">
      <div class="brand">
        <span class="logo">🎲</span>
        <div>
          <h1>多租户营销运营平台</h1>
          <p>Multi-Tenant Marketing Ops Platform</p>
        </div>
      </div>
      <nav class="tabs">
        <button v-for="t in tabs" :key="t.key" :class="{ active: tab === t.key }" @click="tab = t.key">
          {{ t.label }}
          <i v-if="t.key === 'risk' && store.pendingRiskCount" class="tab-badge">{{ store.pendingRiskCount }}</i>
          <i v-else-if="t.key === 'recon' && store.reconOpenCount" class="tab-badge recon">{{ store.reconOpenCount }}</i>
          <i v-else-if="t.key === 'shipping' && shipBadge" class="tab-badge ship">{{ shipBadge }}</i>
          <i v-else-if="t.key === 'purchase' && purchaseBadge" class="tab-badge purchase">{{ purchaseBadge }}</i>
          <i v-else-if="t.key === 'supplier' && supplierBadge" class="tab-badge supplier">{{ supplierBadge }}</i>
          <i v-else-if="t.key === 'budget' && budgetBadge" class="tab-badge budget">{{ budgetBadge }}</i>
          <i v-else-if="t.key === 'coupon' && couponBadge" class="tab-badge coupon">{{ couponBadge }}</i>
          <i v-else-if="t.key === 'audit' && deniedBadge" class="tab-badge audit" title="近期权限/越权拦截">{{ deniedBadge }}</i>
        </button>
      </nav>
      <div class="user">
        <!-- 服务端履约模式指示：在线/同步中/离线；点击进入组织权限页可切换或迁移 -->
        <span class="svc-badge" :class="store.serverMode ? (store.serverConnected ? 'on' : 'wait') : 'off'"
              :title="store.serverMode
                ? (store.serverConnected ? '服务端履约模式：写操作走 REST（RBAC/幂等/并发/WAL）' : '正在连接/同步服务端…')
                : '本地快照模式：点击进入「组织权限」可接入服务端或迁移离线快照'"
              @click="tab = 'tenant'">
          {{ store.serverMode ? (store.serverSyncing ? '☁️ 同步中' : '☁️ 服务端') : '💾 本地' }}
        </span>
        <!-- 数据上下文租户切换（消费者"逛店"；平台超管跨租户巡检；员工锁定本租户） -->
        <div class="tenant-switch" :title="switchTitle">
          <span class="ts-label">租户</span>
          <select v-model="tenantModel" :disabled="store.identityKind === 'staff'">
            <option v-for="t in store.tenants" :key="t.id" :value="t.id"
                    :disabled="t.status !== 'active'">{{ t.icon }} {{ t.shortName }}{{ t.status !== 'active' ? '（已停用）' : '' }}</option>
          </select>
        </div>
        <span class="u-avatar">{{ store.user.avatar }}</span>
        <div class="u-id">
          <span class="u-name">{{ store.user.name }}</span>
          <span class="u-kind" :class="store.identityKind">
            {{ store.isPlatform ? '⚙️ 平台超管' : store.identityKind === 'staff'
              ? '🛡️ ' + store.roleLabelOf(store.currentMember?.roleKey)
              : '👤 消费者' }}
          </span>
        </div>
        <button class="identity-btn" :class="{ on: store.identityKind !== 'customer' }" @click="store.loginAsCustomer()" title="切回消费者身份">👤</button>
        <span v-if="store.isCustomer" class="u-points">🪙 {{ store.points }}</span>
        <span v-if="store.isCustomer && store.frozenPoints > 0" class="u-frozen" title="风控冻结中的积分">🧊 {{ store.frozenPoints }}</span>
      </div>
    </header>

    <main class="content">
      <!-- 抽奖首页 -->
      <div v-if="tab === 'home'">
        <div class="activity-switch">
          <span class="switch-label">选择活动（{{ store.activeTenant.shortName }}）：</span>
          <button
            v-for="a in tenantActivities"
            :key="a.id"
            class="act-tab"
            :class="{ active: currentActivityId === a.id }"
            @click="currentActivityId = a.id"
          >{{ a.icon }} {{ a.name }}</button>
        </div>
        <ActivityView v-if="currentActivity" :key="currentActivity.id" :activity="currentActivity" />
      </div>

      <PointsCenter v-else-if="tab === 'points'" />
      <ShipCenter v-else-if="tab === 'shipping'" />
      <PurchaseCenter v-else-if="tab === 'purchase'" />
      <SupplierCenter v-else-if="tab === 'supplier'" />
      <BudgetCenter v-else-if="tab === 'budget'" />
      <CouponCenter v-else-if="tab === 'coupon'" />
      <RiskCenter v-else-if="tab === 'risk'" />
      <ReconcileView v-else-if="tab === 'recon'" />
      <DashboardView v-else-if="tab === 'dashboard'" />
      <TenantCenter v-else-if="tab === 'tenant'" />
      <AuditCenter v-else-if="tab === 'audit'" />
      <AdminView v-else-if="tab === 'admin'" />

      <p v-if="currentActivity && !activeExists" class="none-tip">该租户暂无进行中的活动，可由具备活动管理权限的成员在「活动管理」中创建。</p>
    </main>

    <!-- Toast -->
    <Transition name="toast">
      <div v-if="store.toast" class="toast" :class="store.toast.type" @click="store.clearToast()">
        {{ store.toast.msg }}
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { usePlatformStore } from '@/store/platform'
import ActivityView from '@/components/ActivityView.vue'
import PointsCenter from '@/components/PointsCenter.vue'
import ShipCenter from '@/components/ShipCenter.vue'
import PurchaseCenter from '@/components/PurchaseCenter.vue'
import SupplierCenter from '@/components/SupplierCenter.vue'
import BudgetCenter from '@/components/BudgetCenter.vue'
import CouponCenter from '@/components/CouponCenter.vue'
import RiskCenter from '@/components/RiskCenter.vue'
import ReconcileView from '@/components/ReconcileView.vue'
import DashboardView from '@/components/DashboardView.vue'
import TenantCenter from '@/components/TenantCenter.vue'
import AuditCenter from '@/components/AuditCenter.vue'
import AdminView from '@/components/AdminView.vue'

const store = usePlatformStore()
const tab = computed({
  get: () => store.activeTab,
  set: (v) => { store.activeTab = v }
})
const currentActivityId = ref('act-1')

const tabs = [
  { key: 'home', label: '🎡 抽奖活动' },
  { key: 'points', label: '🪙 积分中心' },
  { key: 'shipping', label: '📦 物流发货' },
  { key: 'purchase', label: '🛒 采购入库' },
  { key: 'supplier', label: '💰 供应商结算' },
  { key: 'budget', label: '💹 预算成本' },
  { key: 'coupon', label: '🎟️ 卡券核销' },
  { key: 'risk', label: '🛡️ 风控申诉' },
  { key: 'recon', label: '🧮 积分库存对账' },
  { key: 'dashboard', label: '📊 运营看板' },
  { key: 'admin', label: '🎛️ 活动管理' },
  { key: 'tenant', label: '🏢 组织权限' },
  { key: 'audit', label: '📜 全链路审计' }
]

// 数据上下文租户（select 双向绑定；切换走 store 的隔离校验）
const tenantModel = computed({
  get: () => store.activeTenantId,
  set: (v) => store.switchTenant(v)
})
const switchTitle = computed(() =>
  store.identityKind === 'staff'
    ? `员工账号仅可访问归属租户（${store.activeTenant.shortName}），切换需平台超管或消费者身份`
    : store.isPlatform ? '平台超管可跨租户巡检' : '消费者可切换浏览不同入驻组织的活动与商城'
)
// 审计 Tab 角标：今日被拦截事件数
const deniedBadge = computed(() =>
  store.auditLogs.filter((l) =>
    l.result === 'denied' && (store.isPlatform || (l.tenantId || 't-star') === store.activeTenantId)).length
)

const currentActivity = computed(() => store.activities.find((a) => a.id === currentActivityId.value))
// 当前数据上下文租户的活动
const tenantActivities = computed(() =>
  store.activities.filter((a) => a.tenantId === store.activeTenantId)
)
// 切换租户后默认选中该租户第一个活动
watch(tenantActivities, (list) => {
  if (list.length && !list.some((a) => a.id === currentActivityId.value)) {
    currentActivityId.value = list[0].id
  }
}, { immediate: false })
const activeExists = computed(() =>
  tenantActivities.value.some((a) => a.status === 'running')
)

// 物流 Tab 角标：用户看待办（待填地址/待收货），运营看待接单发货 + 待审核售后 + 待补货售后
const shipBadge = computed(() =>
  store.role === 'operator'
    ? store.pendingShipCount + store.pendingOrWaitingAfterSaleCount
    : store.myShipTodoCount)
// 采购 Tab 角标：运营看待审批 + 待入库；用户视角不提示
const purchaseBadge = computed(() =>
  store.role === 'operator' ? store.pendingPurchaseCount + store.pendingInboundCount : 0)
// 供应商结算 Tab 角标：运营看待拟单/草稿/待修订，财务看待复核/待结算
const supplierBadge = computed(() => (store.role === 'operator' ? store.supplierTodoCount : 0))
// 预算成本 Tab 角标：财务看待审批/超支，运营看预警
const budgetBadge = computed(() => (store.role === 'operator' ? store.budgetTodoCount : 0))
// 卡券 Tab 角标：用户看待核销券数，运营看待核销队列（含风控预占待交付提示由卡券页展示）
const couponBadge = computed(() =>
  store.role === 'operator' ? store.pendingRedeemCount : store.myCouponTodoCount)

// 统一业务日切换：页面常开时定时器轮询；页面从后台重新可见时立即检查
let dayTimer = null
const syncDay = () => { if (!store.serverMode) store.syncBusinessDay(true) }
const onVisibility = () => {
  if (document.visibilityState === 'visible') {
    if (store.serverMode) store.hydrateFromServer?.({ silent: true })
    else syncDay()
  }
}

onMounted(() => {
  // 服务端履约模式由远程桥自动水合（本地有令牌时），跳过本地演示种子，避免闪现本地数据
  if (!store.serverMode) {
    store.init()
    if (store.activities.length) currentActivityId.value = store.activities[0].id
  } else {
    // 水合完成后选中当前租户第一个活动
    watch(() => store.activities.length, (n) => {
      if (n && !store.activities.some((a) => a.id === currentActivityId.value)) {
        currentActivityId.value = store.activities[0].id
      }
    }, { immediate: true })
  }
  dayTimer = setInterval(syncDay, 30 * 1000)
  document.addEventListener('visibilitychange', onVisibility)
})

onBeforeUnmount(() => {
  if (dayTimer) clearInterval(dayTimer)
  document.removeEventListener('visibilitychange', onVisibility)
})
</script>

<style scoped>
.layout {
  min-height: 100vh;
  background: linear-gradient(180deg, #0a1224, #0d1730);
  color: #dbe4f3;
}
.topbar {
  display: flex; align-items: center; gap: 24px;
  padding: 14px 24px;
  background: #0c1730;
  border-bottom: 1px solid rgba(120,160,220,0.18);
  position: sticky; top: 0; z-index: 20;
  flex-wrap: wrap;
}
.brand { display: flex; align-items: center; gap: 10px; }
.logo {
  width: 40px; height: 40px; border-radius: 10px;
  display: grid; place-items: center; font-size: 22px;
  background: linear-gradient(135deg, #ff7043, #e53935);
  box-shadow: 0 4px 12px rgba(229,57,53,0.5);
}
.brand h1 { font-size: 16px; margin: 0; color: #fff; }
.brand p { font-size: 10px; margin: 0; color: #6f84ab; letter-spacing: 1px; }

.tabs { display: flex; gap: 6px; }
.tabs button {
  background: transparent; border: 1px solid transparent; color: #8ba2c8;
  padding: 8px 14px; border-radius: 8px; cursor: pointer; font-size: 13px; transition: all 0.2s;
}
.tabs button:hover { color: #fff; background: #13233f; }
.tabs button.active {
  background: linear-gradient(135deg,#1d3f8f,#2962ff); color: #fff;
  box-shadow: 0 3px 10px rgba(41,98,255,0.35);
}
.user { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.svc-badge {
  font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 12px;
  cursor: pointer; white-space: nowrap; border: 1px solid transparent;
}
.svc-badge.on { background: rgba(67, 160, 71, 0.18); color: #a5d6a7; border-color: rgba(67, 160, 71, 0.4); }
.svc-badge.wait { background: rgba(255, 152, 0, 0.15); color: #ffcc80; border-color: rgba(255, 152, 0, 0.4); }
.svc-badge.off { background: rgba(139, 162, 200, 0.12); color: #8ba2c8; border-color: rgba(120, 160, 220, 0.25); }
.u-avatar {
  width: 32px; height: 32px; border-radius: 50%; background: #13233f;
  display: grid; place-items: center; font-size: 18px;
}
.u-name { font-size: 13px; color: #dbe4f3; }
.u-points {
  background: rgba(255,193,7,0.15); color: #ffd54f; border-radius: 12px;
  padding: 4px 12px; font-size: 13px; font-weight: 700;
}
.u-frozen {
  background: rgba(129,212,250,0.15); color: #81d4fa; border-radius: 12px;
  padding: 4px 12px; font-size: 13px; font-weight: 700;
}
.tabs button { position: relative; }
.tab-badge {
  position: absolute; top: -6px; right: -2px;
  background: #ff5252; color: #fff; font-style: normal;
  font-size: 10px; line-height: 1; padding: 3px 5px; border-radius: 8px;
  box-shadow: 0 2px 6px rgba(255,82,82,0.5);
}
.tab-badge.recon { background: #00897b; box-shadow: 0 2px 6px rgba(0,137,123,0.5); }
.tab-badge.ship { background: #43a047; box-shadow: 0 2px 6px rgba(67,160,71,0.5); }
.tab-badge.purchase { background: #8e24aa; box-shadow: 0 2px 6px rgba(142,36,170,0.5); }
.tab-badge.supplier { background: #00897b; box-shadow: 0 2px 6px rgba(0,137,123,0.5); }
.tab-badge.budget { background: #8e24aa; box-shadow: 0 2px 6px rgba(142,36,170,0.5); }
.tab-badge.coupon { background: #8e24aa; box-shadow: 0 2px 6px rgba(142,36,170,0.5); }
.tab-badge.audit { background: #d84315; box-shadow: 0 2px 6px rgba(216,67,21,0.5); }

.tenant-switch { display: flex; align-items: center; gap: 5px; background: #13233f; border: 1px solid rgba(120,160,220,0.2); border-radius: 9px; padding: 3px 8px; }
.ts-label { font-size: 10px; color: #6f84ab; }
.tenant-switch select {
  background: transparent; border: none; color: #ce93d8; font-size: 12px; font-weight: 600;
  outline: none; cursor: pointer; max-width: 120px;
}
.tenant-switch select:disabled { color: #6f84ab; cursor: not-allowed; }
.tenant-switch option { background: #13233f; color: #dbe4f3; }
.u-id { display: flex; flex-direction: column; line-height: 1.2; }
.u-kind { font-size: 9.5px; color: #6f84ab; }
.u-kind.staff { color: #82b1ff; }
.u-kind.platform { color: #ffb74d; }
.identity-btn {
  background: #13233f; border: 1px solid rgba(120,160,220,0.2); color: #8ba2c8;
  width: 30px; height: 30px; border-radius: 50%; cursor: pointer; font-size: 14px;
}
.identity-btn.on { background: rgba(255,152,0,0.18); border-color: rgba(255,152,0,0.5); }

.content { max-width: 1200px; margin: 0 auto; padding: 24px; }
.activity-switch { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 20px; }
.switch-label { font-size: 13px; color: #8ba2c8; }
.act-tab {
  background: #13233f; border: 1px solid rgba(120,160,220,0.2); color: #aebadd;
  padding: 8px 14px; border-radius: 9px; cursor: pointer; font-size: 13px;
}
.act-tab.active { background: linear-gradient(135deg,#1d3f8f,#2962ff); color: #fff; border-color: transparent; }
.none-tip { text-align: center; color: #5b6f94; padding: 30px; }

.toast {
  position: fixed; right: 24px; top: 80px; z-index: 50;
  padding: 12px 20px; border-radius: 10px; font-size: 13px; font-weight: 600;
  box-shadow: 0 8px 24px rgba(0,0,0,0.4); cursor: pointer;
  max-width: 320px;
}
.toast.success { background: #1b5e20; color: #c8e6c9; border: 1px solid #388e3c; }
.toast.warn { background: #e65100; color: #ffe0b2; border: 1px solid #f57c00; }
.toast.info { background: #0d47a1; color: #bbdefb; border: 1px solid #1976d2; }
.toast-enter-active, .toast-leave-active { transition: all 0.3s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(-10px); }
</style>