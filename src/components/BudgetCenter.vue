<template>
  <div class="bg-view">
    <!-- 顶部概览 + 视角切换 -->
    <div class="bg-hero">
      <div class="hero-stats">
        <div class="hs-item">
          <span class="hs-num warn">{{ cards.filter((c) => c.status === 'pending').length + pendingAdjustCount }}</span>
          <span class="hs-lab">财务待审批（预算/调整）</span>
        </div>
        <div class="hs-item">
          <span class="hs-num ok">{{ cards.filter((c) => c.status === 'active').length }}</span>
          <span class="hs-lab">生效中预算</span>
        </div>
        <div class="hs-item">
          <span class="hs-num bad">{{ cards.filter((c) => c.overrun).length }}</span>
          <span class="hs-lab">超支预算</span>
        </div>
        <div class="hs-item">
          <span class="hs-num near">{{ cards.filter((c) => c.nearWarn).length }}</span>
          <span class="hs-lab">占用≥80% 预警</span>
        </div>
        <div class="hs-item">
          <span class="hs-num pts">{{ formatNum(occupiedPoints) }}</span>
          <span class="hs-lab">积分预算已占用</span>
        </div>
        <div class="hs-item">
          <span class="hs-num pay">{{ '¥' + formatMoney(occupiedMoney) }}</span>
          <span class="hs-lab">资金预算已占用</span>
        </div>
      </div>
      <div class="role-box">
        <span class="role-tip">当前视角</span>
        <div class="role-switch">
          <button :class="{ active: store.role === 'user' }" @click="store.setRole('user')">👤 用户（只读）</button>
          <button :class="{ active: store.role === 'operator' }" @click="store.setRole('operator')">💰 运营/财务</button>
        </div>
      </div>
    </div>

    <p class="op-hint">
      💡 <b>营销预算与成本控制闭环</b>：运营按「租户 / 活动」两级编制<b>积分预算</b>与<b>资金预算</b>，财务审批生效后参与实时占用控制——
      <em>抽奖成本、积分奖励</em>落账即占积分预算；<em>采购申请</em>按数量×协议单价预占资金预算，审批驳回/撤销释放、<em>供应商结算付款</em>核销转实际成本；
      风控冻结中的成本先<em>预占</em>，放行核销、撤销释放；售后退货冲回积分成本，缺货补发随采购结算核销。超预算或预算被冻结/关闭时，业务整笔阻断；全部占用逐笔留痕、可财务审计。
    </p>

    <!-- 编制预算表单 -->
    <div v-if="showForm" class="card form-card">
      <div class="card-title">💰 编制营销预算（提交财务审批）</div>
      <div class="form-grid">
        <div class="form-row">
          <label>预算层级</label>
          <select v-model="form.scopeType" @change="form.scopeId = ''">
            <option value="tenant">租户级预算（{{ store.activeTenant.shortName }}）</option>
            <option value="activity">活动级预算</option>
          </select>
        </div>
        <div v-if="form.scopeType === 'activity'" class="form-row">
          <label>选择活动</label>
          <select v-model="form.scopeId">
            <option value="" disabled>请选择活动</option>
            <option v-for="a in tenantActivities" :key="a.id" :value="a.id">{{ a.icon }} {{ a.name }}</option>
          </select>
        </div>
        <div class="form-row">
          <label>预算币种</label>
          <select v-model="form.unit">
            <option value="points">🪙 积分预算（抽奖成本 / 积分奖励 / 兑换成本）</option>
            <option value="money">💴 资金预算（采购 / 供应商付款 / 售后补发）</option>
          </select>
        </div>
        <div class="form-row">
          <label>预算额度</label>
          <input v-model.number="form.amount" type="number" min="1" :placeholder="form.unit === 'points' ? '如 50000 积分' : '如 50000 元'" />
        </div>
        <div class="form-row">
          <label>生效开始</label>
          <input v-model="form.startDate" type="date" />
        </div>
        <div class="form-row">
          <label>生效结束</label>
          <input v-model="form.endDate" type="date" />
        </div>
        <div class="form-row wide">
          <label>预算名称</label>
          <input v-model="form.name" placeholder="可选，留空按层级自动命名" />
        </div>
        <div class="form-row wide">
          <label>编制事由</label>
          <input v-model="form.purpose" placeholder="如：国庆大促投放加码 / Q4 会员积分补贴" />
        </div>
      </div>
      <div class="form-actions">
        <button class="btn-ghost" @click="showForm = false">取消</button>
        <button class="btn-primary" @click="submitForm">📮 提交财务审批</button>
      </div>
    </div>

    <!-- 预算单列表 -->
    <div class="card">
      <div class="card-title">
        💰 营销预算（{{ store.activeTenant.shortName }}）
        <div class="filters">
          <button v-for="f in filters" :key="f.key" :class="{ active: filter === f.key }" @click="filter = f.key">
            {{ f.label }}<em v-if="f.key !== 'all'">（{{ countOf(f.key) }}）</em>
          </button>
        </div>
        <button v-if="canManage && !showForm" class="btn-primary sm" @click="openForm">＋ 编制预算</button>
      </div>
      <div v-if="visibleCards.length === 0" class="empty">暂无相关预算单</div>

      <div v-for="b in visibleCards" :key="b.id" class="budget" :class="[b.status, { overrun: b.overrun }]">
        <div class="b-head">
          <span class="b-icon">{{ b.unit === 'points' ? '🪙' : '💴' }}</span>
          <div class="b-main">
            <div class="b-title">
              {{ b.name }}
              <span class="b-no">{{ b.bNo }}</span>
              <span class="b-scope">{{ b.scopeType === 'activity' ? '🎡 活动预算' : '🏢 租户预算' }}</span>
              <span v-if="b.scopeType === 'activity'" class="b-scope-name">{{ b.scopeName }}</span>
            </div>
            <div class="b-sub">
              编制 {{ b.applicant }} · {{ b.createdAt }}
              <template v-if="b.reviewer"> · 财务 {{ b.reviewer }} · {{ b.reviewedAt }}</template>
              · 预算期 {{ b.startDate }} ~ {{ b.endDate }}
            </div>
          </div>
          <span class="b-status" :class="b.status">{{ statusMeta(b.status).label }}</span>
        </div>

        <!-- 占用进度 -->
        <div class="usage">
          <div class="usage-bar">
            <span class="bar-fill" :class="{ over: b.overrun, near: b.nearWarn }" :style="{ width: barWidth(b) }"></span>
          </div>
          <div class="usage-text">
            <span>预算总额 <b :class="b.unit === 'points' ? 'pts' : 'pay'">{{ formatNum(b.amount) }}{{ unitLabel(b.unit) }}</b></span>
            <span>实际成本 <b class="ok">{{ formatNum(b.committed) }}{{ unitLabel(b.unit) }}</b></span>
            <span>预占中 <b class="warn">{{ formatNum(b.reserved) }}{{ unitLabel(b.unit) }}</b></span>
            <span :class="b.overrun ? 'over-txt' : ''">
              {{ b.overrun ? '⛔ 超支' : '可用' }}
              <b :class="b.overrun ? 'over-txt' : 'avail'">{{ formatNum(b.available) }}{{ unitLabel(b.unit) }}</b>
            </span>
            <span class="usage-pct" :class="{ over: b.overrun, near: b.nearWarn }">{{ Math.round(b.ratio * 1000) / 10 }}%</span>
          </div>
        </div>

        <!-- 分类成本 -->
        <div v-if="Object.values(b.byCategory).some((v) => v)" class="cats">
          <span v-for="(v, k) in b.byCategory" v-show="v" :key="k" class="cat-chip">
            {{ catLabel(k) }} <b>{{ formatNum(v) }}{{ unitLabel(b.unit) }}</b>
          </span>
        </div>

        <div v-if="b.purpose" class="b-note">📝 编制事由：{{ b.purpose }}</div>
        <div v-if="b.reviewNote && b.status === 'rejected'" class="b-review bad">❌ 驳回意见（{{ b.reviewer }}）：{{ b.reviewNote }}</div>
        <div v-if="b.reviewNote && ['active','frozen','closed'].includes(b.status)" class="b-review">🔎 财务备注：{{ b.reviewNote }}</div>

        <!-- 调整记录 -->
        <div v-for="a in b.adjustments" :key="a.id" class="adj-row" :class="a.status">
          <span class="adj-tag">{{ a.status === 'pending' ? '⏳ 调整待审批' : a.status === 'approved' ? '✅ 调整已生效' : '❌ 调整已驳回' }}</span>
          <span class="adj-delta" :class="a.delta > 0 ? 'up' : 'down'">{{ a.delta > 0 ? '+' : '' }}{{ a.delta }}{{ unitLabel(b.unit) }}</span>
          <span class="adj-reason">{{ a.reason }}（{{ a.applicant }} → {{ a.reviewer || '待审批' }}）</span>
        </div>

        <!-- 操作区 -->
        <div class="b-actions">
          <template v-if="b.status === 'pending'">
            <button v-if="canApprove" class="btn-primary sm" @click="review(b, true)">✅ 审批生效</button>
            <button v-if="canApprove" class="btn-reject sm" @click="review(b, false)">❌ 驳回</button>
            <button v-if="canCancel(b)" class="btn-ghost sm" @click="cancel(b)">↩️ 撤销</button>
          </template>
          <template v-if="b.status === 'active'">
            <button v-if="canManage && !adjustingId[b.id]" class="btn-ghost sm" @click="openAdjust(b)">⚖️ 申请调整</button>
            <button v-if="canApprove" class="btn-ghost sm" @click="freeze(b, true)">❄️ 冻结</button>
            <button v-if="canApprove" class="btn-reject sm" @click="closeBudget(b)">🔒 关闭预算</button>
          </template>
          <template v-if="b.status === 'frozen'">
            <button v-if="canApprove" class="btn-primary sm" @click="freeze(b, false)">🔥 解冻恢复</button>
            <button v-if="canApprove" class="btn-reject sm" @click="closeBudget(b)">🔒 关闭预算</button>
          </template>
          <button class="btn-ghost sm" @click="toggleLedger(b.id)">{{ ledgerOpen[b.id] ? '收起台账' : '查看占用台账' }}（{{ ledgerCount(b.id) }}）</button>
        </div>

        <!-- 调整表单 -->
        <div v-if="adjustingId[b.id]" class="adj-form">
          <div class="adj-line">
            <label>调整额度（{{ unitLabel(b.unit) }}，正数追加 / 负数调减）</label>
            <input v-model.number="adjustForms[b.id].delta" type="number" :placeholder="b.unit === 'points' ? '如 10000' : '如 5000'" />
          </div>
          <div class="adj-line">
            <label>调整事由</label>
            <input v-model="adjustForms[b.id].reason" placeholder="如：活动延期追加投放" />
          </div>
          <div class="form-actions">
            <button class="btn-ghost sm" @click="adjustingId[b.id] = false">取消</button>
            <button class="btn-primary sm" @click="submitAdjust(b)">提交调整申请</button>
          </div>
        </div>
        <!-- 待审批调整的财务操作 -->
        <div v-for="a in pendingAdjusts(b)" :key="a.id" class="adj-review">
          <span>⏳ 调整申请：{{ a.delta > 0 ? '+' : '' }}{{ a.delta }}{{ unitLabel(b.unit) }} — {{ a.reason }}</span>
          <button v-if="canApprove" class="btn-primary xs" @click="reviewAdjust(b, a, true)">通过</button>
          <button v-if="canApprove" class="btn-reject xs" @click="reviewAdjust(b, a, false)">驳回</button>
        </div>

        <!-- 占用台账 -->
        <div v-if="ledgerOpen[b.id]" class="ledger">
          <div v-if="ledgerRows(b.id).length === 0" class="empty">暂无占用台账</div>
          <div v-for="l in ledgerRows(b.id)" :key="l.id" class="lg-row" :class="l.direction">
            <span class="lg-dir" :class="l.direction">{{ dirMeta(l.direction).label }}</span>
            <span class="lg-cat">{{ catLabel(l.category) }}</span>
            <span class="lg-amount">
              {{ l.direction === 'release' || l.direction === 'refund' ? '−' : (l.direction === 'reserve' ? '◌ ' : '')
              }}{{ formatNum(l.amount) }}{{ unitLabel(b.unit) }}
            </span>
            <span class="lg-summary">{{ l.summary }}</span>
            <span class="lg-ref">{{ l.bizNo || l.refType }} · {{ l.operator }} · {{ l.date }} {{ l.time }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'
import { usePlatformStore } from '@/store/platform'
import { BUDGET_STATUS, BUDGET_UNITS, BUDGET_DIRECTIONS, BUDGET_CATEGORIES } from '@/store/platform'

const store = usePlatformStore()

const filters = [
  { key: 'all', label: '全部' },
  { key: 'active', label: '生效中' },
  { key: 'pending', label: '待审批' },
  { key: 'frozen', label: '冻结' },
  { key: 'closed', label: '已关闭/驳回/撤销' }
]
const filter = ref('all')

const cards = computed(() => store.budgetCards)
const occupiedPoints = computed(() =>
  cards.value.filter((c) => c.unit === 'points' && ['active', 'frozen'].includes(c.status)).reduce((n, c) => n + c.occupied, 0))
const occupiedMoney = computed(() =>
  cards.value.filter((c) => c.unit === 'money' && ['active', 'frozen'].includes(c.status)).reduce((n, c) => n + c.occupied, 0))
const pendingAdjustCount = computed(() =>
  cards.value.reduce((n, c) => n + (c.adjustments || []).filter((a) => a.status === 'pending').length, 0))

const tenantActivities = computed(() =>
  store.activities.filter((a) => a.tenantId === store.activeTenantId))

const canManage = computed(() => store.can('budget:manage'))
const canApprove = computed(() => store.can('budget:approve'))
const canCancel = (b) => canManage.value &&
  (store.identityKind === 'platform' || store.currentMember?.roleKey === 'org_admin' ||
    b.applicantId === (store.currentMemberId || store.user.id))

const visibleCards = computed(() => {
  if (filter.value === 'all') return cards.value
  if (filter.value === 'closed') return cards.value.filter((c) => ['closed', 'rejected', 'canceled'].includes(c.status))
  return cards.value.filter((c) => c.status === filter.value)
})
const countOf = (key) => key === 'closed'
  ? cards.value.filter((c) => ['closed', 'rejected', 'canceled'].includes(c.status)).length
  : cards.value.filter((c) => c.status === key).length

const statusMeta = (s) => BUDGET_STATUS[s] || { label: s }
const dirMeta = (d) => BUDGET_DIRECTIONS[d] || { label: d }
const catLabel = (k) => BUDGET_CATEGORIES[k] || k
const unitLabel = (u) => BUDGET_UNITS[u]?.unit || ''
const formatNum = (n) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
const formatMoney = (n) => formatNum(n)
const barWidth = (b) => `${Math.min(100, Math.max(2, b.ratio * 100))}%`

// —— 编制预算 ——
const showForm = ref(false)
const emptyForm = () => ({
  scopeType: 'tenant', scopeId: store.activeTenantId, unit: 'points',
  amount: null, startDate: store.todayDate, endDate: store.todayDate, name: '', purpose: ''
})
const form = reactive(emptyForm())
function openForm() {
  Object.assign(form, emptyForm())
  showForm.value = true
}
function submitForm() {
  const r = store.createBudget({
    scopeType: form.scopeType, scopeId: form.scopeType, unit: form.unit,
    amount: form.amount, startDate: form.startDate, endDate: form.endDate,
    name: form.name, purpose: form.purpose
  })
  if (r) showForm.value = false
}

// —— 审批/撤销/冻结/关闭 ——
function review(b, approve) {
  const note = approve ? '' : (window.prompt('驳回意见（可选）') || '')
  store.reviewBudget(b.id, approve, note)
}
function cancel(b) { store.cancelBudget(b.id) }
function freeze(b, frozen) {
  const note = window.prompt(frozen ? '冻结原因（可选）' : '解冻备注（可选）') || ''
  store.setBudgetFrozen(b.id, frozen, note)
}
function closeBudget(b) {
  if (!window.confirm(`确认关闭预算【${b.name}】？关闭后不再接受新占用，历史台账保留。`)) return
  const note = window.prompt('关闭备注（可选）') || ''
  store.closeBudget(b.id, note)
}

// —— 预算调整 ——
const adjustingId = reactive({})
const adjustForms = reactive({})
function openAdjust(b) {
  adjustingId[b.id] = true
  adjustForms[b.id] = { delta: null, reason: '' }
}
function submitAdjust(b) {
  const f = adjustForms[b.id]
  const r = store.requestBudgetAdjust(b.id, f.delta, f.reason)
  if (r) adjustingId[b.id] = false
}
const pendingAdjusts = (b) => (b.adjustments || []).filter((a) => a.status === 'pending')
function reviewAdjust(b, a, approve) {
  const note = approve ? '' : (window.prompt('驳回意见（可选）') || '')
  store.reviewBudgetAdjust(b.id, a.id, approve, note)
}

// —— 占用台账 ——
const ledgerOpen = reactive({})
const ledgerCount = (budgetId) => store.scopedBudgetLedger.filter((l) => l.budgetId === budgetId).length
const ledgerRows = (budgetId) => store.scopedBudgetLedger.filter((l) => l.budgetId === budgetId)
function toggleLedger(id) { ledgerOpen[id] = !ledgerOpen[id] }
</script>

<style scoped>
.bg-view { display: flex; flex-direction: column; gap: 16px; max-width: 1080px; margin: 0 auto; }
.bg-hero {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  background: linear-gradient(135deg, #2d1b4e, #162b55);
  border: 1px solid rgba(149,117,205,0.35); border-radius: 14px; padding: 18px 22px; flex-wrap: wrap;
}
.hero-stats { display: flex; gap: 26px; flex-wrap: wrap; }
.hs-item { display: flex; flex-direction: column; }
.hs-num { font-size: 24px; font-weight: 800; line-height: 1; }
.hs-num.warn { color: #ffb74d; }
.hs-num.ok { color: #7ef0c9; }
.hs-num.bad { color: #ef9a9a; }
.hs-num.near { color: #ffcc80; }
.hs-num.pts { color: #ffd54f; }
.hs-num.pay { color: #ce93d8; }
.hs-lab { font-size: 11px; color: #9db0d0; margin-top: 5px; }
.role-box { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.role-tip { font-size: 11px; color: #9db0d0; }
.role-switch { display: flex; background: rgba(0,0,0,0.25); border-radius: 10px; padding: 3px; }
.role-switch button {
  background: transparent; border: none; color: #aebadd; font-size: 12px;
  padding: 7px 14px; border-radius: 8px; cursor: pointer;
}
.role-switch button.active { background: linear-gradient(135deg,#8e24aa,#2962ff); color: #fff; }

.op-hint {
  font-size: 11.5px; color: #9db0d0; line-height: 1.7; margin: 0;
  background: rgba(142,36,170,0.08); border: 1px solid rgba(149,117,205,0.22);
  border-radius: 10px; padding: 10px 14px;
}
.op-hint b { color: #ce93d8; }
.op-hint em { color: #ffcc80; font-style: normal; }

.card { background: #0f1b38; border: 1px solid rgba(120,160,220,0.16); border-radius: 14px; padding: 16px; }
.card-title {
  font-size: 15px; font-weight: 700; color: #fff; margin-bottom: 12px;
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
}
.filters { display: flex; gap: 5px; margin-left: auto; flex-wrap: wrap; }
.filters button {
  background: #13233f; border: 1px solid rgba(120,160,220,0.18); color: #8ba2c8;
  font-size: 11px; padding: 5px 10px; border-radius: 7px; cursor: pointer;
}
.filters button.active { background: #8e24aa; color: #fff; border-color: transparent; }
.filters em { font-style: normal; opacity: 0.8; }
.empty { color: #5b6f94; text-align: center; padding: 22px; font-size: 12px; }

/* 表单 */
.form-card { border-color: rgba(149,117,205,0.35); }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 10px 20px; margin-bottom: 12px; }
.form-row { display: flex; flex-direction: column; gap: 5px; }
.form-row.wide { grid-column: 1 / -1; }
.form-row label { font-size: 11px; color: #8ba2c8; }
.form-row input, .form-row select {
  background: #0c1730; border: 1px solid rgba(120,160,220,0.2); color: #dbe4f3;
  border-radius: 8px; padding: 8px 11px; font-size: 12px;
}
.form-row select option { background: #13233f; }
.form-actions { display: flex; justify-content: flex-end; gap: 8px; }

button.btn-primary { background: linear-gradient(135deg,#8e24aa,#2962ff); color: #fff; border: none; border-radius: 8px; padding: 8px 14px; font-size: 12px; cursor: pointer; }
button.btn-ghost { background: #13233f; border: 1px solid rgba(120,160,220,0.25); color: #aebadd; border-radius: 8px; padding: 8px 14px; font-size: 12px; cursor: pointer; }
button.btn-reject { background: rgba(229,82,82,0.15); border: 1px solid rgba(229,82,82,0.4); color: #ef9a9a; border-radius: 8px; padding: 8px 14px; font-size: 12px; cursor: pointer; }
.sm { padding: 5px 11px; font-size: 11px; }
.xs { padding: 3px 9px; font-size: 10px; }

/* 预算卡片 */
.budget {
  background: rgba(20,34,66,0.5); border: 1px solid rgba(120,160,220,0.14);
  border-left: 3px solid #7e97c2; border-radius: 10px; padding: 13px 14px; margin-bottom: 10px;
}
.budget.active { border-left-color: #7ef0c9; }
.budget.pending { border-left-color: #ffb74d; }
.budget.frozen { border-left-color: #81d4fa; }
.budget.rejected { border-left-color: #ef9a9a; }
.budget.overrun { border-left-color: #ff5252; box-shadow: inset 0 0 0 1px rgba(255,82,82,0.25); }
.b-head { display: flex; align-items: flex-start; gap: 10px; }
.b-icon { font-size: 24px; }
.b-main { flex: 1; min-width: 0; }
.b-title { font-size: 13px; color: #eef3fc; font-weight: 700; display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.b-no { font-size: 10px; color: #ce93d8; font-weight: 600; }
.b-scope { font-size: 10px; padding: 1px 7px; border-radius: 5px; background: rgba(206,147,216,0.16); color: #ce93d8; font-weight: 400; }
.b-scope-name { font-size: 10px; color: #8ba2c8; font-weight: 400; }
.b-sub { font-size: 10px; color: #6f84ab; margin-top: 2px; }
.b-status { font-size: 11px; padding: 3px 10px; border-radius: 6px; font-weight: 600; flex-shrink: 0; }
.b-status.pending { background: rgba(255,183,77,0.18); color: #ffb74d; }
.b-status.active { background: rgba(126,240,201,0.18); color: #7ef0c9; }
.b-status.frozen { background: rgba(129,212,250,0.18); color: #81d4fa; }
.b-status.rejected { background: rgba(229,115,115,0.18); color: #ef9a9a; }
.b-status.canceled, .b-status.closed { background: rgba(111,132,171,0.2); color: #aebadd; }

/* 占用进度 */
.usage { margin: 10px 0 8px; }
.usage-bar { height: 8px; border-radius: 5px; background: #0c1730; overflow: hidden; border: 1px solid rgba(120,160,220,0.15); }
.bar-fill { display: block; height: 100%; background: linear-gradient(90deg,#00897b,#4db6ac); border-radius: 5px; transition: width .3s; }
.bar-fill.near { background: linear-gradient(90deg,#f57c00,#ffb74d); }
.bar-fill.over { background: linear-gradient(90deg,#c62828,#ff5252); }
.usage-text { display: flex; gap: 18px; flex-wrap: wrap; font-size: 11px; color: #8ba2c8; margin-top: 6px; }
.usage-text b { font-weight: 700; margin-left: 3px; }
.usage-text b.pts { color: #ffd54f; }
.usage-text b.pay { color: #ce93d8; }
.usage-text b.ok { color: #7ef0c9; }
.usage-text b.warn { color: #ffb74d; }
.usage-text b.avail { color: #dbe4f3; }
.over-txt, .over-txt b { color: #ef5350 !important; }
.usage-pct { margin-left: auto; font-weight: 800; color: #7ef0c9; }
.usage-pct.near { color: #ffb74d; }
.usage-pct.over { color: #ff5252; }

.cats { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
.cat-chip {
  font-size: 10px; padding: 2px 9px; border-radius: 6px;
  background: rgba(120,160,220,0.1); color: #aebadd; border: 1px solid rgba(120,160,220,0.18);
}
.cat-chip b { color: #ce93d8; margin-left: 2px; }
.b-note { font-size: 11px; color: #8ba2c8; margin: 4px 0; }
.b-review { font-size: 11px; color: #82b1ff; margin: 4px 0; }
.b-review.bad { color: #ef9a9a; }

.adj-row {
  display: flex; align-items: center; gap: 10px; font-size: 11px;
  background: rgba(255,183,77,0.07); border: 1px solid rgba(255,183,77,0.2);
  border-radius: 7px; padding: 5px 10px; margin: 5px 0; color: #aebadd; flex-wrap: wrap;
}
.adj-tag { color: #ffb74d; }
.adj-delta { font-weight: 800; }
.adj-delta.up { color: #7ef0c9; }
.adj-delta.down { color: #ef9a9a; }
.adj-reason { color: #8ba2c8; }
.adj-row.approved { background: rgba(126,240,201,0.06); border-color: rgba(126,240,201,0.18); }
.adj-row.rejected { background: rgba(229,115,115,0.06); border-color: rgba(229,115,115,0.18); }
.adj-form { background: rgba(142,36,170,0.08); border: 1px dashed rgba(149,117,205,0.35); border-radius: 9px; padding: 10px; margin: 8px 0; }
.adj-line { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
.adj-line label { font-size: 11px; color: #8ba2c8; }
.adj-line input { background: #0c1730; border: 1px solid rgba(120,160,220,0.2); color: #dbe4f3; border-radius: 8px; padding: 7px 10px; font-size: 12px; }
.adj-review { display: flex; align-items: center; gap: 8px; font-size: 11px; color: #ffb74d; margin: 5px 0; }

.b-actions { display: flex; gap: 7px; flex-wrap: wrap; margin-top: 9px; }

/* 台账 */
.ledger {
  margin-top: 10px; border-top: 1px dashed rgba(120,160,220,0.2); padding-top: 8px;
  display: flex; flex-direction: column; gap: 5px;
}
.lg-row {
  display: grid; grid-template-columns: 74px 84px 130px 1fr; grid-template-rows: auto auto; gap: 3px 8px; align-items: baseline;
  font-size: 11px; padding: 6px 9px; border-radius: 7px;
  background: rgba(12,23,48,0.6); border: 1px solid rgba(120,160,220,0.1);
}
.lg-dir { grid-row: 1; font-weight: 700; font-size: 10px; }
.lg-dir.settle { color: #7ef0c9; }
.lg-dir.reserve { color: #ffb74d; }
.lg-dir.release { color: #82b1ff; }
.lg-dir.refund { color: #81d4fa; }
.lg-cat { grid-row: 1; color: #ce93d8; font-size: 10px; }
.lg-amount { grid-row: 1; font-weight: 700; color: #dbe4f3; }
.lg-row.refund .lg-amount, .lg-row.release .lg-amount { color: #81d4fa; }
.lg-summary { grid-column: 4; grid-row: 1; color: #aebadd; font-size: 10.5px; }
.lg-ref { grid-column: 1 / -1; grid-row: 2; font-size: 9.5px; color: #6f84ab; }
</style>
