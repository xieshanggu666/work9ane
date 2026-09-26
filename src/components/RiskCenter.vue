<template>
  <div class="risk-view">
    <!-- 顶部概览 + 角色切换 -->
    <div class="risk-hero">
      <div class="hero-stats">
        <div class="hs-item">
          <span class="hs-num warn">{{ pendingOrders.length }}</span>
          <span class="hs-lab">待处理审核单</span>
        </div>
        <div class="hs-item">
          <span class="hs-num ice">{{ store.frozenPoints }}</span>
          <span class="hs-lab">冻结积分</span>
        </div>
        <div class="hs-item">
          <span class="hs-num">{{ frozenStockCount }}</span>
          <span class="hs-lab">预占库存（件）</span>
        </div>
        <div class="hs-item">
          <span class="hs-num ok">{{ doneOrders.length }}</span>
          <span class="hs-lab">已处理单据</span>
        </div>
      </div>
      <div class="role-box">
        <span class="role-tip">当前视角</span>
        <div class="role-switch">
          <button :class="{ active: store.role === 'user' }" @click="store.setRole('user')">👤 用户（申诉）</button>
          <button :class="{ active: store.role === 'operator' }" @click="store.setRole('operator')">🛡️ 运营（审核）</button>
        </div>
      </div>
    </div>

    <!-- 运营：规则配置（需 risk:rule 权限） -->
    <div v-if="store.isOperator && store.can('risk:rule')" class="card">
      <div class="card-title">
        ⚙️ 风控规则配置 · {{ store.activeTenant.icon }} {{ store.activeTenant.shortName }}
        <label class="rule-switch">
          <input type="checkbox" v-model="rulesForm.enabled" @change="saveRules" />
          启用风控
        </label>
      </div>
      <div class="rule-grid">
        <div class="rule-item">
          <label>高价值奖品</label>
          <div class="rarity-tags">
            <label v-for="r in rarityOptions" :key="r.key" class="rtag" :class="{ on: rulesForm.highValueRarities.includes(r.key) }">
              <input type="checkbox" :value="r.key" v-model="rulesForm.highValueRarities" @change="saveRules" />
              {{ r.label }}
            </label>
          </div>
        </div>
        <div class="rule-item">
          <label>当日抽奖次数达到即冻结</label>
          <input type="number" min="0" v-model.number="rulesForm.dailyDrawThreshold" @change="saveRules" />
        </div>
        <div class="rule-item">
          <label>连抽窗口（秒）</label>
          <input type="number" min="0" v-model.number="rulesForm.rapidDrawSeconds" @change="saveRules" />
        </div>
        <div class="rule-item">
          <label>窗口内连抽次数达到</label>
          <input type="number" min="0" v-model.number="rulesForm.rapidDrawMax" @change="saveRules" />
        </div>
        <div class="rule-item">
          <label>连兑窗口（秒）</label>
          <input type="number" min="0" v-model.number="rulesForm.rapidRedeemSeconds" @change="saveRules" />
        </div>
        <div class="rule-item">
          <label>窗口内连兑次数达到</label>
          <input type="number" min="0" v-model.number="rulesForm.rapidRedeemMax" @change="saveRules" />
        </div>
        <div class="rule-item">
          <label>高价值兑换积分阈值</label>
          <input type="number" min="0" v-model.number="rulesForm.highValueRedeemCost" @change="saveRules" />
        </div>
        <div class="rule-item wide">
          <label>用户黑名单（用户 id，逗号分隔）</label>
          <input :value="rulesForm.blacklist.join(', ')" @input="onBlacklistInput" placeholder="如：u-1002, u-1003" />
        </div>
      </div>
      <p class="rule-hint">改动即时生效且仅作用于当前租户：此后该租户新产生的抽奖/兑换按新规则判定，不影响其他租户；已在审的单据不受影响。</p>
    </div>

    <!-- 审核单列表 -->
    <div class="card">
      <div class="card-title">
        🧾 风险审核单
        <div class="filters">
          <button v-for="f in filters" :key="f.key"
                  :class="{ active: filter === f.key }" @click="filter = f.key">
            {{ f.label }}
            <em v-if="f.key !== 'all' && countOf(f.key)">({{ countOf(f.key) }})</em>
          </button>
        </div>
      </div>

      <div v-if="visibleOrders.length === 0" class="empty">暂无相关审核单</div>

      <div v-for="o in visibleOrders" :key="o.id" class="order" :class="o.status">
        <div class="o-head">
          <span class="o-icon">{{ o.icon }}</span>
          <div class="o-main">
            <div class="o-title">
              {{ o.bizType === 'draw' ? '抽奖' : '兑换' }} · {{ o.targetName }}
              <span v-if="o.rarity" class="o-rarity" :style="{ background: rarityColor(o.rarity) }">{{ rarityLabel(o.rarity) }}</span>
            </div>
            <div class="o-sub">
              {{ o.bizType === 'draw' ? o.activityName : '积分商城' }}
              · 单号 {{ o.id }}
              · {{ o.createdAt }} {{ o.time }}
            </div>
          </div>
          <span class="o-status" :class="o.status">{{ statusMeta(o.status).label }}</span>
        </div>

        <div class="o-tags">
          <span v-for="r in o.rules" :key="r.code" class="risk-tag">⚡ {{ r.label }}</span>
          <span class="hold-tag">🪙 冻结积分 {{ o.frozenPoints }}</span>
          <span v-if="o.stockHeld" class="hold-tag">📦 预占库存 ×{{ o.stockHeld }}</span>
          <span v-if="isCouponOrder(o)" class="hold-tag coupon">🎟️ 券类：{{ o.status === 'released' ? '已放行发券交付' : o.status === 'revoked' ? '已释放（券未发放）' : '预占中，放行后发券' }}</span>
        </div>

        <!-- 抽奖单：任务进度归属说明（跨日审核不串账） -->
        <div v-if="o.bizType === 'draw' && (o.status === 'pending' || o.status === 'appealed')" class="o-hint">
          📅 归属业务日 {{ o.createdAt }}：审核期间暂缓计入抽奖任务；放行后补计该日进度并自动结算，撤销则确认不计入。
        </div>

        <!-- 申诉内容 -->
        <div v-if="o.appealReason" class="appeal-box">
          <b>用户申诉：</b>{{ o.appealReason }}
          <span class="appeal-time">{{ o.appealAt }}</span>
        </div>
        <!-- 审核结论 -->
        <div v-if="o.status === 'released' || o.status === 'revoked'" class="review-box" :class="o.status">
          <b>{{ o.status === 'released' ? '✅ 放行结论' : '❌ 撤销结论' }}：</b>{{ o.reviewNote || '（无备注）' }}
          <span class="review-meta">{{ o.reviewer }} · {{ o.reviewedAt }}</span>
        </div>
        <!-- 运营：放行后实物发货提示 -->
        <div v-if="store.isOperator && o.status === 'released' && shipOf(o.recordId)" class="ship-hint">
          📦 实物发货单：{{ shipMetaText(shipOf(o.recordId).status) }}（运营可前往「物流发货」处理待发货订单）
        </div>

        <!-- 用户操作区 -->
        <div v-if="!store.isOperator && mine(o)" class="o-actions user">
          <template v-if="o.status === 'pending'">
            <input v-model="appealDrafts[o.id]" placeholder="填写申诉理由，如：本人正常操作，未使用外挂…" />
            <button class="btn-appeal" @click="submitAppeal(o)">📨 提交申诉</button>
          </template>
          <span v-else-if="o.status === 'appealed'" class="waiting">⏳ 申诉审核中，请耐心等待运营处理</span>
          <span v-else-if="o.status === 'released'" class="done-txt ok">
            已放行，奖品/积分已到账<span v-if="shipOf(o.recordId)">；实物发货单已生成，可在「物流发货」{{ shipOf(o.recordId).status === 'pending_address' ? '填写收货信息' : shipOf(o.recordId).status === 'shipped' ? '确认收货' : '查看进度' }}</span>
          </span>
          <span v-else class="done-txt bad">已撤销，冻结积分与库存已返还</span>
        </div>
        <div v-else-if="!store.isOperator && !mine(o)" class="o-actions user">
          <span class="waiting">该单据不属于当前账号</span>
        </div>

        <!-- 运营操作区（需 risk:review 权限；无权角色只读） -->
        <div v-if="store.isOperator && (o.status === 'pending' || o.status === 'appealed')" class="o-actions operator">
          <template v-if="store.can('risk:review')">
            <input v-model="reviewDrafts[o.id]" placeholder="审核备注（可选）" />
            <button class="btn-release" @click="doRelease(o)">✅ 放行（发奖/核销）</button>
            <button class="btn-revoke" @click="doRevoke(o)">❌ 撤销（返还积分/库存）</button>
          </template>
          <span v-else class="waiting">🔒 当前角色无「风控审核」权限，仅可查看单据</span>
        </div>
      </div>
    </div>

    <!-- 操作记录（当前租户；完整链路检索见「全链路审计」） -->
    <div class="card">
      <div class="card-title">🛠️ 操作记录
        <span class="log-hint" v-if="!store.can('audit:view')">完整全链路审计需 audit:view 权限</span>
        <button v-else class="btn-audit" @click="store.gotoTab('audit')">前往全链路审计 →</button>
      </div>
      <div v-if="riskAuditLogs.length === 0" class="empty">暂无操作记录</div>
      <div v-for="l in riskAuditLogs" :key="l.id" class="log-row" :class="{ denied: l.result === 'denied' }">
        <span class="l-action" :class="l.action">{{ l.actionLabel }}</span>
        <span class="l-detail">{{ l.detail }}</span>
        <span class="l-who">{{ l.operator }}</span>
        <span class="l-time">{{ l.date }} {{ l.time }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue'
import { usePlatformStore, RISK_STATUS, SHIP_STATUS } from '@/store/platform'
import { PRIZE_RARITY } from '@/mock/data'

const store = usePlatformStore()

// 风控单是否关联券类（券在冻结期仅预占，放行才发券交付、撤销则释放）
const isCouponOrder = (o) => !!store.records.find((r) => r.id === o.recordId)?.couponId

const filters = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待审核' },
  { key: 'appealed', label: '已申诉' },
  { key: 'released', label: '已放行' },
  { key: 'revoked', label: '已撤销' }
]
const filter = ref('all')

const rarityOptions = [
  { key: 'legendary', label: '传说' },
  { key: 'epic', label: '史诗' },
  { key: 'rare', label: '稀有' },
  { key: 'common', label: '普通' }
]

const rulesForm = reactive({
  enabled: true,
  highValueRarities: [],
  dailyDrawThreshold: 0,
  rapidDrawSeconds: 0,
  rapidDrawMax: 0,
  rapidRedeemSeconds: 0,
  rapidRedeemMax: 0,
  highValueRedeemCost: 0,
  blacklist: []
})
// 用当前租户规则初始化表单
const syncForm = () => {
  Object.assign(rulesForm, JSON.parse(JSON.stringify(store.riskRules)))
}
syncForm()
// 切换数据上下文租户后，表单必须同步为新租户自己的规则，避免把 A 租户配置误存到 B 租户
watch(() => store.activeTenantId, syncForm)

function saveRules() {
  store.updateRiskRules(JSON.parse(JSON.stringify(rulesForm)))
}
function onBlacklistInput(e) {
  rulesForm.blacklist = e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
  saveRules()
}

const appealDrafts = reactive({})
const reviewDrafts = reactive({})

// 当前租户内审核单；客户视角仅看本人单据
const riskList = computed(() =>
  store.isOperator
    ? store.scopedRiskOrders
    : store.scopedRiskOrders.filter((o) => o.userId === store.user.id)
)

const pendingOrders = computed(() =>
  riskList.value.filter((o) => o.status === 'pending' || o.status === 'appealed'))
const doneOrders = computed(() =>
  riskList.value.filter((o) => o.status === 'released' || o.status === 'revoked'))

const visibleOrders = computed(() => {
  const list = filter.value === 'all' ? riskList.value : riskList.value.filter((o) => o.status === filter.value)
  return [...list].sort((a, b) => b.ts - a.ts)
})
const countOf = (key) => riskList.value.filter((o) => o.status === key).length

// 预占库存总件数（审核中）
const frozenStockCount = computed(() =>
  pendingOrders.value.reduce((s, o) => s + (o.stockHeld || 0), 0))

const mine = (o) => o.userId === store.user.id
// 风控模块的审计记录（当前租户；客户只看与风控相关的系统事件，不展示他人单据）
const riskAuditLogs = computed(() =>
  store.auditLogs.filter((l) =>
    (l.tenantId || 't-star') === store.activeTenantId &&
    ['risk', 'auth'].includes(l.module)
  ).slice(0, 30)
)
const shipOf = (id) => store.shipmentOfRecord(id)
const shipMetaText = (s) => SHIP_STATUS[s]?.label || s
const statusMeta = (s) => RISK_STATUS[s] || { label: s, tone: '' }
const rarityLabel = (r) => PRIZE_RARITY[r]?.label || r
const rarityColor = (r) => PRIZE_RARITY[r]?.color || '#777'

function submitAppeal(o) {
  if (store.appealRisk(o.id, appealDrafts[o.id] || '')) {
    appealDrafts[o.id] = ''
  }
}
function doRelease(o) {
  store.releaseRisk(o.id, reviewDrafts[o.id] || '')
  reviewDrafts[o.id] = ''
}
function doRevoke(o) {
  store.revokeRisk(o.id, reviewDrafts[o.id] || '')
  reviewDrafts[o.id] = ''
}
</script>

<style scoped>
.risk-view { display: flex; flex-direction: column; gap: 16px; max-width: 1000px; margin: 0 auto; }

.risk-hero {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  background: linear-gradient(135deg, #2a1a4a, #1a2b5a);
  border: 1px solid rgba(124,77,255,0.3); border-radius: 14px; padding: 18px 22px; flex-wrap: wrap;
}
.hero-stats { display: flex; gap: 28px; flex-wrap: wrap; }
.hs-item { display: flex; flex-direction: column; }
.hs-num { font-size: 26px; font-weight: 800; line-height: 1; }
.hs-num.warn { color: #ffb74d; }
.hs-num.ice { color: #81d4fa; }
.hs-num.ok { color: #7ef0c9; }
.hs-lab { font-size: 11px; color: #9db0d0; margin-top: 5px; }

.role-box { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.role-tip { font-size: 11px; color: #9db0d0; }
.role-switch { display: flex; background: rgba(0,0,0,0.25); border-radius: 10px; padding: 3px; }
.role-switch button {
  background: transparent; border: none; color: #aebadd; font-size: 12px;
  padding: 7px 14px; border-radius: 8px; cursor: pointer;
}
.role-switch button.active {
  background: linear-gradient(135deg,#7c4dff,#5e35d0); color: #fff;
  box-shadow: 0 3px 8px rgba(124,77,255,0.4);
}

.card {
  background: #0f1b38; border: 1px solid rgba(120,160,220,0.16);
  border-radius: 14px; padding: 16px;
}
.card-title {
  font-size: 15px; font-weight: 700; color: #fff; margin-bottom: 14px;
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
}

.rule-switch {
  margin-left: auto; font-size: 12px; font-weight: 400; color: #aebadd;
  display: flex; align-items: center; gap: 5px; cursor: pointer;
}
.rule-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
@media (max-width: 900px) { .rule-grid { grid-template-columns: repeat(2, 1fr); } }
.rule-item { display: flex; flex-direction: column; gap: 6px; }
.rule-item.wide { grid-column: 1 / -1; }
.rule-item label { font-size: 11px; color: #8ba2c8; }
.rule-item input[type="number"], .rule-item input[type="text"], .rule-item input:not([type]) {
  background: #0c1730; border: 1px solid rgba(120,160,220,0.2); color: #dbe4f3;
  border-radius: 8px; padding: 8px 10px; font-size: 12px;
}
.rarity-tags { display: flex; flex-wrap: wrap; gap: 5px; }
.rtag {
  font-size: 11px; padding: 5px 9px; border-radius: 7px; cursor: pointer;
  border: 1px solid rgba(120,160,220,0.25); color: #aebadd;
  display: flex; align-items: center; gap: 4px; user-select: none;
}
.rtag.on { background: rgba(124,77,255,0.25); border-color: #7c4dff; color: #ceb8ff; }
.rtag input { display: none; }
.rule-hint { font-size: 11px; color: #6f84ab; margin: 12px 0 0; }

.filters { display: flex; gap: 5px; margin-left: auto; flex-wrap: wrap; }
.filters button {
  background: #13233f; border: 1px solid rgba(120,160,220,0.18); color: #8ba2c8;
  font-size: 11px; padding: 5px 10px; border-radius: 7px; cursor: pointer;
}
.filters button.active { background: #2962ff; color: #fff; border-color: transparent; }
.filters em { font-style: normal; opacity: 0.8; }

.empty { color: #5b6f94; text-align: center; padding: 24px; font-size: 12px; }

.order {
  background: rgba(20,34,66,0.5); border: 1px solid rgba(120,160,220,0.14);
  border-left-width: 3px; border-radius: 10px; padding: 13px 14px; margin-bottom: 10px;
}
.order.pending, .order.appealed { border-left-color: #ff9800; }
.order.released { border-left-color: #4caf50; }
.order.revoked { border-left-color: #78909c; opacity: 0.85; }
.o-head { display: flex; align-items: center; gap: 10px; }
.o-icon { font-size: 24px; }
.o-main { flex: 1; min-width: 0; }
.o-title { font-size: 13px; color: #eef3fc; font-weight: 700; display: flex; align-items: center; gap: 7px; }
.o-rarity { font-size: 9px; color: #fff; padding: 1px 6px; border-radius: 3px; font-weight: 500; }
.o-sub { font-size: 10px; color: #6f84ab; margin-top: 2px; }
.o-status { font-size: 11px; padding: 3px 10px; border-radius: 6px; font-weight: 600; flex-shrink: 0; }
.o-status.pending { background: rgba(255,152,0,0.18); color: #ffb74d; }
.o-status.appealed { background: rgba(41,98,255,0.2); color: #82b1ff; }
.o-status.released { background: rgba(76,175,80,0.18); color: #7ef0c9; }
.o-status.revoked { background: rgba(144,164,174,0.18); color: #b0bec5; }

.o-tags { display: flex; gap: 6px; margin: 10px 0 0; flex-wrap: wrap; }
.risk-tag {
  font-size: 10px; background: rgba(255,82,82,0.14); color: #ef9a9a;
  border: 1px solid rgba(255,82,82,0.3); padding: 2px 8px; border-radius: 5px;
}
.hold-tag {
  font-size: 10px; background: rgba(129,212,250,0.12); color: #81d4fa;
  border: 1px solid rgba(129,212,250,0.25); padding: 2px 8px; border-radius: 5px;
}
.hold-tag.coupon { background: rgba(171,71,188,0.16); color: #ce93d8; border-color: rgba(171,71,188,0.35); }
.o-hint {
  margin-top: 9px; font-size: 11px; color: #9db0d0; line-height: 1.5;
  background: rgba(129,212,250,0.06); border: 1px dashed rgba(129,212,250,0.25);
  border-radius: 8px; padding: 7px 10px;
}

.appeal-box, .review-box {
  margin-top: 10px; font-size: 12px; border-radius: 8px; padding: 9px 11px; line-height: 1.5;
}
.appeal-box { background: rgba(41,98,255,0.1); border: 1px solid rgba(41,98,255,0.25); color: #c5d6f5; }
.appeal-time { display: block; font-size: 10px; color: #7e97c2; margin-top: 3px; }
.review-box.released { background: rgba(76,175,80,0.09); border: 1px solid rgba(76,175,80,0.25); color: #bfe8c8; }
.review-box.revoked { background: rgba(144,164,174,0.1); border: 1px solid rgba(144,164,174,0.25); color: #cdd6dd; }
.review-meta { display: block; font-size: 10px; color: #84a094; margin-top: 3px; }
.review-box.revoked .review-meta { color: #90a4ae; }
.ship-hint {
  margin-top: 9px; font-size: 11px; color: #9db0d0; line-height: 1.5;
  background: rgba(76,175,80,0.07); border: 1px dashed rgba(76,175,80,0.3);
  border-radius: 8px; padding: 7px 10px;
}

.o-actions { display: flex; align-items: center; gap: 8px; margin-top: 11px; flex-wrap: wrap; }
.o-actions input {
  flex: 1; min-width: 200px;
  background: #0c1730; border: 1px solid rgba(120,160,220,0.2); color: #dbe4f3;
  border-radius: 8px; padding: 8px 11px; font-size: 12px;
}
.o-actions button {
  border: none; border-radius: 8px; padding: 8px 14px; font-size: 12px;
  font-weight: 600; cursor: pointer; white-space: nowrap;
}
.btn-appeal { background: linear-gradient(135deg,#4d8dff,#2962ff); color: #fff; }
.btn-release { background: linear-gradient(135deg,#66bb6a,#43a047); color: #fff; }
.btn-revoke { background: linear-gradient(135deg,#ef5350,#c62828); color: #fff; }
.waiting { font-size: 12px; color: #82b1ff; }
.done-txt { font-size: 12px; }
.done-txt.ok { color: #7ef0c9; }
.done-txt.bad { color: #b0bec5; }

.log-row {
  display: flex; align-items: center; gap: 10px; padding: 8px 0;
  border-bottom: 1px dashed rgba(120,160,220,0.1); font-size: 12px;
}
.log-row:last-child { border-bottom: none; }
.l-action {
  font-size: 10px; padding: 2px 8px; border-radius: 5px; flex-shrink: 0; font-weight: 600;
}
.l-action.freeze { background: rgba(255,152,0,0.16); color: #ffb74d; }
.l-action.release { background: rgba(76,175,80,0.16); color: #7ef0c9; }
.l-action.revoke { background: rgba(144,164,174,0.16); color: #b0bec5; }
.l-action.appeal { background: rgba(41,98,255,0.16); color: #82b1ff; }
.l-action.config { background: rgba(171,71,188,0.16); color: #ce93d8; }
.l-action.switch-role { background: rgba(120,160,220,0.12); color: #8ba2c8; }
.l-action.day-rollover { background: rgba(129,212,250,0.14); color: #81d4fa; }
.l-detail { flex: 1; color: #c6d2e6; line-height: 1.4; }
.l-who { font-size: 11px; color: #9db0d0; flex-shrink: 0; }
.l-time { font-size: 11px; color: #6f84ab; flex-shrink: 0; }
.log-row.denied { background: rgba(255,112,67,0.08); border-radius: 7px; }
.log-row.denied .l-action { color: #ef9a9a; }
.log-hint { margin-left: auto; font-size: 10px; color: #6f84ab; font-weight: 400; }
.btn-audit {
  margin-left: auto; background: rgba(126,87,194,0.18); border: 1px solid rgba(126,87,194,0.4);
  color: #ce93d8; border-radius: 7px; font-size: 11px; padding: 4px 10px; cursor: pointer;
}
</style>
