<template>
  <div class="recon-view">
    <!-- 顶部概览 -->
    <div class="recon-hero">
      <div class="hero-stats">
        <div class="hs-item">
          <span class="hs-num">{{ scopedBills.length }}</span>
          <span class="hs-lab">已对账业务日</span>
        </div>
        <div class="hs-item">
          <span class="hs-num warn">{{ store.reconOpenCount }}</span>
          <span class="hs-lab">待处理差异单</span>
        </div>
        <div class="hs-item">
          <span class="hs-num ok">{{ store.dashboard.reconCompensated }}</span>
          <span class="hs-lab">累计补偿积分</span>
        </div>
        <div class="hs-item">
          <span class="hs-num ice">{{ store.dashboard.stockAdjCount }}</span>
          <span class="hs-lab">库存校正（次）</span>
        </div>
      </div>
      <div class="role-box">
        <span class="role-tip">{{ store.activeTenant.icon }} {{ store.activeTenant.shortName }} · 当前视角</span>
        <div class="role-switch">
          <button :class="{ active: store.role === 'user' }" @click="store.setRole('user')">👤 用户（只读）</button>
          <button :class="{ active: store.role === 'operator' }" @click="store.setRole('operator')">🛡️ 运营（复核/补偿）</button>
        </div>
      </div>
    </div>

    <!-- 对账工作台 -->
    <div class="card">
      <div class="card-title">
        🧮 积分库存对账（按业务日）
        <span class="title-sub">核对抽奖 / 兑换 / 任务奖励与积分、冻结库存，生成可追溯差异单</span>
      </div>
      <div class="workbar">
        <label>租户：</label>
        <select :value="reconTenantId" :disabled="!store.isPlatform" @change="onTenantChange">
          <option v-for="t in store.tenants" :key="t.id" :value="t.id">{{ t.icon }} {{ t.shortName }}</option>
        </select>
        <label>业务日：</label>
        <select v-model="selectedDate">
          <option v-for="d in reconDates" :key="d" :value="d">
            {{ d }}{{ d === store.todayDate ? '（今天）' : '' }}
          </option>
        </select>
        <button class="btn-run" @click="runSelected">🧮 执行/重新对账</button>
        <span v-if="existing && store.isOperator && store.can('recon:compensate')" class="quick-inject">
          演示注入：
          <button class="btn-inj" @click="injectGap">📝 任务奖励漏记 +30</button>
          <button class="btn-inj" @click="injectLoss">📦 商品盘亏 1 件</button>
          <button class="btn-inj" @click="injectCouponGap">🎟️ 卡券漏发 1 张</button>
        </span>
      </div>
      <p class="rule-hint">
        口径：P1 积分发生额（抽奖成本/中奖、兑换/返还、任务奖励）· P2 任务奖励逐笔台账 · P3 流水余额链 · P4 风控冻结单据与预占 · P5 库存账实 · P6 卡券账户（发券/核销勾稽、券码唯一、到期状态）· P7 供应商采购结算闭环（独立于 P1–P6，在「供应商结算」页处理）。
        重复执行按差异签名幂等（账无变化不重建单、不重复补偿）；跨日补偿带业务日归属，原始记录一律保留。
      </p>
    </div>

    <!-- 差异单 -->
    <div v-if="!bill" class="card">
      <div class="empty">📂 业务日 {{ selectedDate }} 尚未对账，点击「执行对账」生成差异单</div>
    </div>

    <template v-else>
      <div class="card bill-card" :class="bill.status">
        <div class="bill-head">
          <span class="b-icon">{{ statusMeta(bill.status).icon }}</span>
          <div class="b-main">
            <div class="b-title">
              对账差异单 · {{ bill.date }}
              <span v-if="bill.date === store.todayDate" class="b-today">今天</span>
              <span class="b-status" :class="bill.status">{{ statusMeta(bill.status).label }}</span>
              <span v-if="bill.date !== bill.createdAt" class="b-cross">跨日处理（实际处理日 {{ bill.createdAt }}）</span>
            </div>
            <div class="b-sub">单号 {{ bill.id }} · 首次对账 {{ bill.firstAt }} · 执行 {{ bill.runs.length }} 次</div>
          </div>
          <div class="b-summary">
            <b>{{ bill.diffs.openCount }}</b>
            <span>未平差异</span>
          </div>
        </div>

        <!-- 复核信息 -->
        <div v-if="bill.reviewedAt" class="review-box">
          <b>🔎 运营复核：</b>{{ bill.reviewNote || '确认差异属实，按差异单补偿修正' }}
          <span class="review-meta">{{ bill.reviewer }} · {{ bill.reviewedAt }}</span>
        </div>

        <!-- P1 积分发生额 -->
        <div class="diff-section">
          <div class="ds-title">
            P1 · 积分发生额
            <span class="ds-ok" v-if="bill.diffs.points.residual === 0">✅ 净额相符</span>
            <span class="ds-bad" v-else :class="{ plus: bill.diffs.points.residual > 0 }">
              ⚠️ 残差 {{ bill.diffs.points.residual > 0 ? '+' : '' }}{{ bill.diffs.points.residual }}
              （{{ bill.diffs.points.residual > 0 ? '业务真实、流水少记' : '流水多记/长款，需人工核查，不自动扣减' }}）
            </span>
          </div>
          <div class="p1-grid">
            <div><label>业务应有净额</label><b>{{ bill.diffs.points.expectedNet }}</b></div>
            <div><label>流水实际净额</label><b>{{ bill.diffs.points.ledgerNet }}</b></div>
            <div><label>已补偿净额</label><b class="ok">{{ bill.diffs.points.compNet }}</b></div>
          </div>
          <div class="expect-list">
            <span v-for="(e, i) in bill.diffs.points.detail" :key="i" class="exp-chip" :class="e.delta > 0 ? 'plus' : 'minus'">
              {{ e.label }} <b>{{ e.delta > 0 ? '+' : '' }}{{ e.delta }}</b>
            </span>
          </div>
          <p v-if="bill.diffs.tasks.length" class="p1-hint">
            其中 {{ bill.diffs.tasks.length }} 笔/共 +{{ bill.diffs.tasks.reduce((s, t) => s + t.reward, 0) }} 积分为 P2 任务奖励缺笔，
            补偿时按台账逐笔补记（不与净额残差重复补偿）
          </p>
        </div>

        <!-- P2 任务奖励台账 -->
        <div class="diff-section">
          <div class="ds-title">
            P2 · 任务奖励逐笔台账
            <span class="ds-ok" v-if="bill.diffs.tasks.length === 0">✅ 每笔领奖均有流水勾稽</span>
            <span class="ds-bad" v-else>⚠️ {{ bill.diffs.tasks.length }} 笔领奖缺流水</span>
          </div>
          <div v-for="t in bill.diffs.tasks" :key="t.key" class="diff-row">
            <span class="dr-ic">📝</span>
            <span class="dr-label">
              任务奖励【{{ t.label }}】台账已落、积分流水漏记
              <em v-if="t.grantDate !== t.bizDate" class="cross-tag">归属 {{ t.bizDate }} · {{ t.grantDate }} 跨日补计</em>
            </span>
            <span class="dr-fix ok-tag">可自动补记</span>
            <span class="dr-delta plus">+{{ t.reward }}</span>
          </div>
        </div>

        <!-- P3 余额链 -->
        <div class="diff-section">
          <div class="ds-title">
            P3 · 流水余额链（当前态）
            <span class="ds-ok" v-if="!bill.diffs.chain">✅ 余额快照逐笔连续，最新余额与可用积分一致</span>
            <span class="ds-bad" v-else>⚠️ {{ bill.diffs.chain.brokenRows }} 行余额快照不连续</span>
          </div>
          <div v-if="bill.diffs.chain" class="diff-row">
            <span class="dr-ic">🔗</span>
            <span class="dr-label">
              余额链断裂：{{ bill.diffs.chain.firstBad?.note }}（应为 {{ bill.diffs.chain.firstBad?.expect }}，快照 {{ bill.diffs.chain.firstBad?.actual }}）
            </span>
            <span class="dr-fix warn-tag">补偿入账后自动愈合，不直接改写快照</span>
          </div>
        </div>

        <!-- P4 冻结单据 -->
        <div class="diff-section">
          <div class="ds-title">
            P4 · 风控冻结单据与预占（当前态）
            <span class="ds-ok" v-if="bill.diffs.frozen.length === 0">✅ 在审单据状态、冻结积分与预占库存全部一致</span>
            <span class="ds-bad" v-else>⚠️ {{ bill.diffs.frozen.length }} 项不一致</span>
          </div>
          <div v-for="f in bill.diffs.frozen" :key="f.key" class="diff-row">
            <span class="dr-ic">🧊</span>
            <span class="dr-label">
              【{{ f.target }}】{{ f.kind === 'order-status' ? '审核单与业务记录状态不一致'
                : f.kind === 'order-points' ? '冻结积分与业务成本不符' : '预占库存与账面 frozen 不符' }}
              （应有 {{ f.expect }} / 账面 {{ f.actual }}）
            </span>
            <span class="dr-fix warn-tag">请在「风控申诉」处理，不自动核销</span>
          </div>
        </div>

        <!-- P5 库存账实 -->
        <div class="diff-section">
          <div class="ds-title">
            P5 · 奖品/商品库存账实（当前态）
            <span class="ds-ok" v-if="!bill.diffs.stock.some(x => x.diff !== 0)">✅ 各 SKU 账实相符</span>
            <span class="ds-bad" v-else>⚠️ {{ bill.diffs.stock.filter(x => x.diff !== 0).length }} 个 SKU 盘盈/盘亏</span>
          </div>
          <div v-for="st in bill.diffs.stock" :key="st.key" class="diff-row" :class="{ ok: st.diff === 0 }">
            <span class="dr-ic">{{ st.icon || '📦' }}</span>
            <span class="dr-label">
              {{ st.name }}
              <em class="muted">（初始 {{ st.initialStock }} + 采购入库 {{ st.purchased || 0 }} − 有效消耗 {{ st.consumed }} + 已校正 {{ st.adjusted }}）</em>
              <em v-if="st.dayInbound" class="muted"> · 当日采购入库 +{{ st.dayInbound }}</em>
              <em v-if="st.asReturned" class="muted"> · 售后退回已回补 {{ st.asReturned }}</em>
              <em v-if="st.asReshipped" class="muted"> · 售后补发已消耗 {{ st.asReshipped }}</em>
              <em v-if="st.dayConsumed" class="muted"> · 当日净变动 {{ st.dayConsumed > 0 ? '-' : '+' }}{{ Math.abs(st.dayConsumed) }}</em>
              <i v-if="st.frozenHeld" class="frozen-tag">🧊 预占 {{ st.frozenHeld }}</i>
            </span>
            <template v-if="st.diff !== 0">
              <span class="dr-fix ok-tag">{{ st.diff > 0 ? `盘亏核销 ${st.diff}（登记调整凭证，不回补实物）` : `盘盈补登 ${-st.diff}` }}</span>
              <span class="dr-delta" :class="st.diff > 0 ? 'minus' : 'plus'">
                账 {{ st.actual }} / 应 {{ st.expected }}
              </span>
            </template>
            <span v-else class="dr-fix">账实相符（{{ st.actual }}）</span>
          </div>
        </div>

        <!-- P6 卡券账户 -->
        <div class="diff-section">
          <div class="ds-title">
            P6 · 卡券账户勾稽（发券 / 核销 / 到期）
            <span class="ds-ok" v-if="bill.diffs.coupons.length === 0">✅ 有效券记录均已发券，券码唯一、核销与到期状态一致</span>
            <span class="ds-bad" v-else>⚠️ {{ bill.diffs.coupons.length }} 项卡券差异</span>
          </div>
          <div v-for="cp in bill.diffs.coupons" :key="cp.key" class="diff-row">
            <span class="dr-ic">🎟️</span>
            <span class="dr-label">
              【{{ cp.target }}】{{ couponDiffText(cp) }}
              <em v-if="cp.code" class="muted">券码 {{ cp.code }}</em>
            </span>
            <span v-if="cp.autoFixable" class="dr-fix ok-tag">{{ cp.kind === 'missing' ? '可自动补发新券' : '可自动补做到期' }}</span>
            <span v-else class="dr-fix warn-tag">需人工核查，不自动作废/改码</span>
          </div>
        </div>

        <!-- P7 采购结算闭环（独立口径，不计入上方 openCount） -->
        <div v-if="bill.diffs.purchase" class="diff-section p7">
          <div class="ds-title">
            P7 · 供应商结算与采购对账（批次验收 / 差异 / 售后补发回写）
            <span class="ds-ok" v-if="bill.diffs.purchase.openCount === 0">
              ✅ {{ bill.diffs.purchase.settledPo }} 张可结算采购单全部闭环
            </span>
            <span class="ds-bad" v-else>
              🔗 {{ bill.diffs.purchase.openPo }} 张采购单有 {{ bill.diffs.purchase.openCount }} 项结算待办（在「供应商结算」处理，不计入 P1–P6 差异）
            </span>
          </div>
          <div v-for="pr in bill.diffs.purchase.items" :key="pr.poId" class="p7-row" :class="{ open: pr.issues.length }">
            <span class="p7-name">{{ pr.icon }} {{ pr.targetName }} <em>{{ pr.poNo }} · {{ pr.supplierName }}</em></span>
            <span class="p7-qty">合格 {{ pr.acceptedQty }}/{{ pr.orderQty }}<template v-if="pr.shortQty"> · 短少 {{ pr.shortQty }}</template><template v-if="pr.rejectedQty"> · 验退 {{ pr.rejectedQty }}</template></span>
            <span v-if="pr.billId" class="p7-bill" :class="pr.billStatus">账单 {{ pr.billStatus === 'settled' ? '已结算' : pr.billStatus === 'approved' ? '待结算' : pr.billStatus === 'reviewing' ? '复核中' : pr.billStatus === 'rejected' ? '待修订' : '草稿' }}<template v-if="pr.payableAmount !== null"> ¥{{ Number(pr.payableAmount).toFixed(2) }}</template></span>
            <span v-else class="p7-bill none">未拟账单</span>
          </div>
        </div>

        <!-- 运营操作区（复核需 recon:review，补偿需 recon:compensate） -->
        <div v-if="store.isOperator" class="bill-actions">
          <template v-if="bill.status === 'pending'">
            <template v-if="store.can('recon:review')">
              <input v-model="reviewDraft" placeholder="复核备注（可选）：已核对业务凭证，差异属实…" />
              <button class="btn-review" @click="doReview">🔎 运营复核确认</button>
            </template>
            <span v-else class="act-hint">🔒 当前角色无「对账复核」权限，仅可查看差异单</span>
          </template>
          <template v-else-if="bill.status === 'reviewed'">
            <template v-if="store.can('recon:compensate')">
              <input v-model="compDraft" placeholder="补偿备注（可选）" />
              <button class="btn-comp" @click="doCompensate">🧾 补偿修正（追加补偿流水/库存校正）</button>
              <span class="act-hint">已复核：补偿将同步余额与库存，原始记录保留，重复项自动跳过</span>
            </template>
            <span v-else class="act-hint">🔒 当前角色无「对账补偿」权限，差异已复核，等待财务对账/管理员处理</span>
          </template>
          <template v-else-if="bill.status === 'compensated'">
            <span class="done-txt ok">✅ 已补偿平账，可重新对账验证；再次执行不会重复补偿</span>
            <button class="btn-run small" @click="runSelected">重新对账验证</button>
          </template>
          <template v-else>
            <span class="done-txt">✅ 该业务日账实相符</span>
            <button class="btn-run small" @click="runSelected">重新对账</button>
          </template>
        </div>
        <div v-else-if="bill.status === 'pending' || bill.status === 'reviewed'" class="bill-actions user">
          <span class="act-hint">只读视角：差异复核与补偿仅运营可操作</span>
        </div>
      </div>

      <!-- 补偿流水与执行痕迹 -->
      <div class="trace-grid">
        <div class="card inner">
          <div class="card-title">🧾 补偿凭证（append-only）</div>
          <div v-if="!bill.compensations.length" class="empty">暂无补偿记录</div>
          <div v-for="c in bill.compensations" :key="c.id" class="comp-row">
            <div class="cr-top">
              <span>{{ c.at }} · {{ c.reviewer }}</span>
              <span class="cr-delta" v-if="c.pointDelta">补记 +{{ c.pointDelta }} 积分</span>
              <span class="cr-delta stock" v-if="c.stockCount">校正 {{ c.stockCount }} 项库存</span>
              <span class="cr-delta coupon" v-if="c.couponCount">补发 {{ c.couponCount }} 张卡券</span>
            </div>
            <div class="cr-items">
              <span v-for="(a, i) in c.items" :key="i" class="exp-chip" :class="a.type === 'stock' || a.type === 'coupon' || a.type === 'coupon-expire' ? 'minus' : 'plus'">
                {{ a.type === 'stock' ? '库存校正' : a.type === 'coupon' ? '补券' : a.type === 'coupon-expire' ? '券到期' : '补记' }} · {{ a.label }}
                <b v-if="a.code">（{{ a.code }}）</b>
              </span>
            </div>
            <div v-if="c.note" class="cr-note">备注：{{ c.note }}</div>
          </div>
        </div>

        <div class="card inner">
          <div class="card-title">🕘 执行痕迹（重复执行/跨日审核留痕）</div>
          <div class="trace-row" v-for="r in bill.runs" :key="r.ts">
            <span class="tr-time">{{ r.at }}</span>
            <span class="tr-who">{{ r.operator }}</span>
            <span class="tr-res" :class="r.balanced ? 'ok' : 'bad'">
              {{ r.balanced ? '✅ 账实相符' : `⚠️ ${r.openCount} 项未平差异` }}
            </span>
          </div>
        </div>
      </div>
    </template>

    <!-- 库存校正台账（当前租户，append-only） -->
    <div class="card">
      <div class="card-title">📦 库存校正台账 · {{ tenantShort }}（append-only）</div>
      <div v-if="scopedAdjustments.length === 0" class="empty">暂无库存校正</div>
      <div class="adj-row" v-for="a in scopedAdjustments" :key="a.id">
        <span class="ar-icon">{{ a.targetType === 'prize' ? '🎁' : '🛍️' }}</span>
        <span class="ar-name">{{ a.targetName }}</span>
        <span class="ar-delta" :class="a.delta > 0 ? 'plus' : 'minus'">{{ a.delta > 0 ? '盘盈补登 +' : '盘亏核销 ' }}{{ a.delta }}</span>
        <span class="ar-book">实物账 {{ a.before }} → {{ a.after }}（不变）</span>
        <span class="ar-reason">{{ a.reason }}</span>
        <span class="ar-time">{{ a.date }} {{ a.time }} · {{ a.operator }}</span>
      </div>
    </div>

    <!-- 审计日志（对账相关） -->
    <div class="card">
      <div class="card-title">🛠️ 对账操作记录</div>
      <div v-if="reconLogs.length === 0" class="empty">暂无对账操作记录</div>
      <div v-for="l in reconLogs" :key="l.id" class="log-row">
        <span class="l-action" :class="l.action">{{ l.actionLabel }}</span>
        <span class="l-detail">{{ l.detail }}</span>
        <span class="l-who">{{ l.operator }}</span>
        <span class="l-time">{{ l.date }} {{ l.time }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { usePlatformStore } from '@/store/platform'

const store = usePlatformStore()
const selectedDate = ref(store.todayDate)
const reviewDraft = ref('')
const compDraft = ref('')
// 对账租户：员工锁定本租户；平台方可切换；客户默认当前"逛店"租户
const reconTenantId = ref(store.activeTenantId)
watch(() => store.activeTenantId, (v) => {
  // 员工/客户跟随数据上下文；平台方保持自主选择
  if (!store.isPlatform) reconTenantId.value = v
})
function onTenantChange(e) { reconTenantId.value = e.target.value }

const RECON_STATUS = {
  pending: { label: '待复核', icon: '⚠️' },
  reviewed: { label: '已复核待补偿', icon: '🔎' },
  compensated: { label: '已补偿平账', icon: '🧾' },
  balanced: { label: '账实相符', icon: '✅' }
}
const statusMeta = (s) => RECON_STATUS[s] || { label: s, icon: '•' }

const reconDates = computed(() => store.reconDates.forTenant(reconTenantId.value))
const bill = computed(() => store.reconBillOf(selectedDate.value, reconTenantId.value))
const existing = computed(() => !!bill.value)
const scopedBills = computed(() =>
  store.reconBills.filter((b) => (b.tenantId || 't-star') === reconTenantId.value)
)
const scopedAdjustments = computed(() =>
  [...store.scopedStockAdjustments].sort((a, b) => (b.ts || 0) - (a.ts || 0))
)
const tenantShort = computed(() =>
  store.tenants.find((t) => t.id === reconTenantId.value)?.shortName || reconTenantId.value
)
const reconLogs = computed(() =>
  store.auditLogs.filter((l) =>
    (l.tenantId || 't-star') === reconTenantId.value && l.action.startsWith('recon-'))
)

function runSelected() {
  store.runRecon(selectedDate.value, false, reconTenantId.value)
  reviewDraft.value = ''
  compDraft.value = ''
}
function doReview() {
  if (store.reviewRecon(selectedDate.value, reviewDraft.value, reconTenantId.value)) reviewDraft.value = ''
}
function doCompensate() {
  store.compensateRecon(selectedDate.value, compDraft.value, reconTenantId.value)
  compDraft.value = ''
}
function injectGap() {
  if (selectedDate.value !== store.todayDate || reconTenantId.value !== store.activeTenantId) {
    store.showToast('演示差异注入仅支持当前租户的今日业务日', 'warn')
    return
  }
  store.injectTaskFlowGap()
}
function injectLoss() {
  if (selectedDate.value !== store.todayDate || reconTenantId.value !== store.activeTenantId) {
    store.showToast('演示差异注入仅支持当前租户的今日业务日', 'warn')
    return
  }
  store.injectStockLoss()
}
function injectCouponGap() {
  if (selectedDate.value !== store.todayDate || reconTenantId.value !== store.activeTenantId) {
    store.showToast('演示差异注入仅支持当前租户的今日业务日', 'warn')
    return
  }
  store.injectCouponGap()
}
// P6 卡券差异文案
function couponDiffText(cp) {
  return {
    missing: '业务记录有效但券账户漏发（应有券实例 / 实际无）',
    orphan: '券实例回指业务记录异常（孤立券）',
    duplicate: '存在重复券码（全局唯一性被破坏）',
    'redeem-info': '已核销券缺少核销人/核销时间',
    'expired-pending': '已过有效期但账户仍标记待核销（到期未流转）'
  }[cp.kind] || cp.kind
}
</script>

<style scoped>
.recon-view { display: flex; flex-direction: column; gap: 16px; max-width: 1040px; margin: 0 auto; }

.recon-hero {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  background: linear-gradient(135deg, #12352f, #143a52);
  border: 1px solid rgba(77,182,172,0.3); border-radius: 14px; padding: 18px 22px; flex-wrap: wrap;
}
.hero-stats { display: flex; gap: 28px; flex-wrap: wrap; }
.hs-item { display: flex; flex-direction: column; }
.hs-num { font-size: 26px; font-weight: 800; line-height: 1; color: #4db6ac; }
.hs-num.warn { color: #ffb74d; }
.hs-num.ok { color: #7ef0c9; }
.hs-num.ice { color: #81d4fa; }
.hs-lab { font-size: 11px; color: #9db0d0; margin-top: 5px; }

.role-box { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.role-tip { font-size: 11px; color: #9db0d0; }
.role-switch { display: flex; background: rgba(0,0,0,0.25); border-radius: 10px; padding: 3px; }
.role-switch button {
  background: transparent; border: none; color: #aebadd; font-size: 12px;
  padding: 7px 14px; border-radius: 8px; cursor: pointer;
}
.role-switch button.active {
  background: linear-gradient(135deg,#00897b,#00695c); color: #fff;
  box-shadow: 0 3px 8px rgba(0,137,123,0.4);
}

.card {
  background: #0f1b38; border: 1px solid rgba(120,160,220,0.16);
  border-radius: 14px; padding: 16px;
}
.card-title { font-size: 15px; font-weight: 700; color: #fff; margin-bottom: 12px; }
.title-sub { font-size: 11px; font-weight: 400; color: #8ba2c8; margin-left: 8px; }

.workbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 13px; color: #aebadd; }
.workbar select {
  background: #0c1730; border: 1px solid rgba(120,160,220,0.25); color: #dbe4f3;
  border-radius: 8px; padding: 8px 10px; font-size: 13px;
}
.btn-run {
  background: linear-gradient(135deg,#4db6ac,#00897b); color: #04241f; border: none;
  border-radius: 9px; padding: 8px 16px; font-size: 13px; font-weight: 700; cursor: pointer;
}
.btn-run.small { padding: 6px 12px; font-size: 12px; }
.quick-inject { display: flex; align-items: center; gap: 6px; margin-left: auto; font-size: 11px; color: #8ba2c8; }
.btn-inj {
  background: rgba(255,152,0,0.12); border: 1px dashed rgba(255,152,0,0.5); color: #ffb74d;
  border-radius: 7px; padding: 5px 10px; font-size: 11px; cursor: pointer;
}
.btn-inj:hover { background: rgba(255,152,0,0.22); }
.rule-hint { font-size: 11px; color: #6f84ab; margin: 10px 0 0; line-height: 1.6; }

.empty { color: #5b6f94; text-align: center; padding: 22px; font-size: 12px; }

.bill-card { border-left-width: 3px; border-left-style: solid; }
.bill-card.pending { border-left-color: #ff9800; }
.bill-card.reviewed { border-left-color: #42a5f5; }
.bill-card.compensated { border-left-color: #4caf50; }
.bill-card.balanced { border-left-color: #00897b; }

.bill-head { display: flex; align-items: center; gap: 12px; }
.b-icon { font-size: 26px; }
.b-main { flex: 1; min-width: 0; }
.b-title { font-size: 14px; color: #eef3fc; font-weight: 700; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.b-today { font-size: 9px; background: rgba(41,98,255,0.2); color: #82b1ff; padding: 1px 7px; border-radius: 4px; }
.b-cross { font-size: 10px; color: #ffd54f; font-weight: 400; }
.b-status { font-size: 11px; padding: 3px 10px; border-radius: 6px; font-weight: 600; }
.b-status.pending { background: rgba(255,152,0,0.18); color: #ffb74d; }
.b-status.reviewed { background: rgba(41,98,255,0.2); color: #82b1ff; }
.b-status.compensated { background: rgba(76,175,80,0.18); color: #7ef0c9; }
.b-status.balanced { background: rgba(0,137,123,0.18); color: #4db6ac; }
.b-sub { font-size: 10px; color: #6f84ab; margin-top: 3px; }
.b-summary { text-align: center; background: rgba(20,34,66,0.6); border-radius: 10px; padding: 8px 14px; }
.b-summary b { display: block; font-size: 22px; color: #ffb74d; line-height: 1; }
.b-summary span { font-size: 10px; color: #8ba2c8; }

.review-box {
  margin: 12px 0 0; font-size: 12px; border-radius: 8px; padding: 9px 11px; line-height: 1.5;
  background: rgba(41,98,255,0.09); border: 1px solid rgba(41,98,255,0.25); color: #c5d6f5;
}
.review-meta { display: block; font-size: 10px; color: #7e97c2; margin-top: 3px; }

.diff-section {
  margin-top: 14px; padding-top: 12px;
  border-top: 1px dashed rgba(120,160,220,0.14);
}
.ds-title { font-size: 13px; font-weight: 700; color: #dbe4f3; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ds-ok { font-size: 11px; font-weight: 400; background: rgba(76,175,80,0.13); color: #7ef0c9; padding: 2px 9px; border-radius: 5px; }
.ds-bad { font-size: 11px; font-weight: 600; background: rgba(255,152,0,0.14); color: #ffb74d; padding: 2px 9px; border-radius: 5px; }
.ds-bad.plus { background: rgba(239,83,80,0.14); color: #ef9a9a; }

.p7 { border-color: rgba(77,182,172,0.25); }
.p7-row {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  font-size: 11px; color: #aebadd; padding: 5px 0;
}
.p7-row.open .p7-name { color: #ffcc80; }
.p7-name em { font-style: normal; color: #7e97c2; margin-left: 4px; }
.p7-qty { color: #8ba2c8; }
.p7-bill {
  padding: 2px 9px; border-radius: 6px; font-size: 10px;
  background: rgba(130,177,255,0.16); color: #82b1ff;
}
.p7-bill.settled { background: rgba(126,240,201,0.15); color: #7ef0c9; }
.p7-bill.reviewing { background: rgba(255,183,77,0.16); color: #ffb74d; }
.p7-bill.approved { background: rgba(130,177,255,0.25); color: #bbdefb; }
.p7-bill.rejected { background: rgba(229,115,115,0.16); color: #ef9a9a; }
.p7-bill.draft { background: rgba(111,132,171,0.2); color: #aebadd; }
.p7-bill.none { background: rgba(229,115,115,0.12); color: #ef9a9a; }

.p1-grid { display: flex; gap: 22px; margin: 10px 0 8px; }
.p1-grid div { display: flex; flex-direction: column; }
.p1-grid label { font-size: 10px; color: #6f84ab; }
.p1-grid b { font-size: 17px; color: #e8eefb; }
.p1-grid b.ok { color: #7ef0c9; }
.expect-list { display: flex; flex-wrap: wrap; gap: 6px; }
.p1-hint { font-size: 11px; color: #ffd54f; margin: 8px 0 0; }
.exp-chip {
  font-style: normal; font-size: 10px; padding: 3px 9px; border-radius: 6px;
  background: rgba(20,34,66,0.7); border: 1px solid rgba(120,160,220,0.16); color: #aebadd;
}
.exp-chip.plus { color: #7ef0c9; border-color: rgba(126,240,201,0.25); }
.exp-chip.minus { color: #ef9a9a; border-color: rgba(239,154,154,0.25); }

.diff-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; font-size: 12px; flex-wrap: wrap; }
.diff-row.ok .dr-label { color: #9db0d0; }
.dr-ic { font-size: 16px; }
.dr-label { flex: 1; min-width: 220px; color: #e8eefb; }
.dr-label .muted { font-style: normal; color: #6f84ab; margin-left: 2px; }
.cross-tag { font-style: normal; color: #ffd54f; margin-left: 6px; }
.frozen-tag { font-style: normal; color: #81d4fa; margin-left: 6px; }
.dr-fix { font-size: 10px; padding: 2px 8px; border-radius: 5px; color: #8ba2c8; background: rgba(120,160,220,0.1); }
.ok-tag { background: rgba(76,175,80,0.14); color: #7ef0c9; }
.warn-tag { background: rgba(255,152,0,0.14); color: #ffb74d; }
.dr-delta { font-weight: 700; font-size: 12px; min-width: 90px; text-align: right; }
.dr-delta.plus { color: #7ef0c9; }
.dr-delta.minus { color: #ef9a9a; }

.bill-actions { display: flex; align-items: center; gap: 9px; margin-top: 14px; flex-wrap: wrap; }
.bill-actions.user { border-top: 1px dashed rgba(120,160,220,0.14); padding-top: 12px; }
.bill-actions input {
  flex: 1; min-width: 220px;
  background: #0c1730; border: 1px solid rgba(120,160,220,0.2); color: #dbe4f3;
  border-radius: 8px; padding: 8px 11px; font-size: 12px;
}
.bill-actions button { border: none; border-radius: 8px; padding: 9px 15px; font-size: 12px; font-weight: 700; cursor: pointer; white-space: nowrap; }
.btn-review { background: linear-gradient(135deg,#42a5f5,#1e88e5); color: #fff; }
.btn-comp { background: linear-gradient(135deg,#66bb6a,#43a047); color: #fff; }
.act-hint { font-size: 11px; color: #8ba2c8; }
.done-txt { font-size: 12px; color: #aebadd; }
.done-txt.ok { color: #7ef0c9; }

.trace-grid { display: grid; grid-template-columns: 1.2fr 1fr; gap: 16px; }
@media (max-width: 900px) { .trace-grid { grid-template-columns: 1fr; } }
.card.inner { padding: 14px; }
.card.inner .card-title { font-size: 13px; margin-bottom: 10px; }
.comp-row { background: rgba(20,34,66,0.5); border: 1px solid rgba(120,160,220,0.12); border-radius: 9px; padding: 9px 11px; margin-bottom: 8px; }
.cr-top { display: flex; align-items: center; gap: 10px; font-size: 11px; color: #8ba2c8; }
.cr-delta { font-weight: 700; color: #7ef0c9; }
.cr-delta.stock { color: #ffb74d; }
.cr-delta.coupon { color: #ce93d8; }
.cr-items { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 7px; }
.cr-note { font-size: 11px; color: #9db0d0; margin-top: 6px; }
.trace-row { display: flex; align-items: center; gap: 10px; font-size: 11px; padding: 5px 0; }
.tr-time { color: #6f84ab; min-width: 130px; }
.tr-who { color: #9db0d0; flex: 1; }
.tr-res { font-size: 10px; }
.tr-res.ok { color: #7ef0c9; }
.tr-res.bad { color: #ffb74d; }

.log-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px dashed rgba(120,160,220,0.1); font-size: 12px; }
.log-row:last-child { border-bottom: none; }
.l-action { font-size: 10px; padding: 2px 8px; border-radius: 5px; flex-shrink: 0; font-weight: 600; }
.l-action.recon-run { background: rgba(77,182,172,0.16); color: #4db6ac; }
.l-action.recon-review { background: rgba(41,98,255,0.16); color: #82b1ff; }
.l-action.recon-comp { background: rgba(76,175,80,0.16); color: #7ef0c9; }
.l-action.recon-inject { background: rgba(255,152,0,0.16); color: #ffb74d; }

.adj-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px dashed rgba(120,160,220,0.1); font-size: 12px; flex-wrap: wrap; }
.adj-row:last-child { border-bottom: none; }
.ar-icon { font-size: 15px; }
.ar-name { color: #e8eefb; min-width: 180px; }
.ar-delta { font-weight: 700; min-width: 110px; }
.ar-delta.plus { color: #7ef0c9; }
.ar-delta.minus { color: #ef9a9a; }
.ar-book { color: #8ba2c8; font-size: 11px; min-width: 150px; }
.ar-reason { flex: 1; color: #9db0d0; font-size: 11px; min-width: 200px; }
.ar-time { color: #6f84ab; font-size: 11px; }
.l-detail { flex: 1; color: #c6d2e6; line-height: 1.4; }
.l-who { font-size: 11px; color: #9db0d0; flex-shrink: 0; }
.l-time { font-size: 11px; color: #6f84ab; flex-shrink: 0; }
</style>
