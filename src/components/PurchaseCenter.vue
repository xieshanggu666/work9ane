<template>
  <div class="po-view">
    <!-- 顶部概览 + 角色切换 -->
    <div class="po-hero">
      <div class="hero-stats">
        <div class="hs-item">
          <span class="hs-num warn">{{ stats.pending }}</span>
          <span class="hs-lab">采购待审批</span>
        </div>
        <div class="hs-item">
          <span class="hs-num info">{{ stats.toInbound }}</span>
          <span class="hs-lab">待验收入库</span>
        </div>
        <div class="hs-item">
          <span class="hs-num ok">{{ stats.received }}</span>
          <span class="hs-lab">入库完成单</span>
        </div>
        <div class="hs-item">
          <span class="hs-num inbound">{{ stats.inboundQty }}</span>
          <span class="hs-lab">累计验收件数</span>
        </div>
        <div class="hs-item">
          <span class="hs-num bad">{{ store.waitingStockAfterSaleCount }}</span>
          <span class="hs-lab">售后待补货</span>
        </div>
      </div>
      <div class="role-box">
        <span class="role-tip">当前视角</span>
        <div class="role-switch">
          <button :class="{ active: store.role === 'user' }" @click="store.setRole('user')">👤 用户（只读）</button>
          <button :class="{ active: store.role === 'operator' }" @click="store.setRole('operator')">🛒 运营（采购）</button>
        </div>
      </div>
    </div>

    <!-- 缺货补发待处理入口：采购入库后从待处理售后继续履约 -->
    <div v-if="waitingAfterSales.length" class="shortage-card">
      <div class="sc-title">
        ⚠️ 缺货补发 · 待处理售后（{{ waitingAfterSales.length }}）
        <span class="sc-hint">审核已通过但库存不足挂起；采购验收入库有余量后，可点「继续补发履约」</span>
      </div>
      <div v-for="a in waitingAfterSales" :key="a.id" class="sc-item">
        <span class="sc-icon">{{ a.icon }}</span>
        <div class="sc-main">
          <div class="sc-name">{{ a.targetName }} · {{ a.typeLabel }}</div>
          <div class="sc-sub">售后单 {{ a.id }} · 用户 {{ a.userName }} · 发货单 {{ a.shipmentId }} · {{ a.reviewedAt }} 挂起</div>
        </div>
        <button class="btn-link" @click="newPoForAfterSale(a)">🛒 发起补货采购</button>
        <button class="btn-resume" :disabled="remainOf(a) <= 0"
                :title="remainOf(a) <= 0 ? '当前库存仍为 0，请先采购验收入库' : ''"
                @click="resumeAfterSale(a)">
          {{ remainOf(a) > 0 ? '📦 库存已足，继续补发履约' : '⏳ 库存为 0，等待采购入库' }}
        </button>
      </div>
    </div>

    <!-- 发起采购（RBAC：purchase:apply） -->
    <div v-if="store.isOperator && store.can('purchase:apply')" class="card">
      <div class="card-title">
        🛒 发起奖品 / 商品采购
        <button class="btn-toggle" @click="showCreate = !showCreate">{{ showCreate ? '收起表单' : '＋ 新建采购申请' }}</button>
      </div>
      <div v-if="showCreate" class="create-form">
        <div class="cf-row">
          <label>采购类型</label>
          <div class="seg">
            <button :class="{ on: form.targetType === 'prize' }" @click="pickType('prize')">🎡 活动奖品</button>
            <button :class="{ on: form.targetType === 'goods' }" @click="pickType('goods')">🛍️ 商城商品</button>
          </div>
        </div>
        <div class="cf-row">
          <label>采购目标</label>
          <select v-if="form.targetType === 'prize'" v-model="form.prizeKey">
            <option value="">选择活动奖品（当前租户）</option>
            <template v-for="a in scopedActivities" :key="a.id">
              <option v-for="p in a.prizes.filter((x) => x.rarity !== 'none')" :key="a.id + p.id"
                      :value="`${a.id}::${p.id}`">
                {{ a.name }} / {{ p.emoji }} {{ p.name }}（库存 {{ p.remain }}/{{ p.stock }}）
              </option>
            </template>
          </select>
          <select v-else v-model="form.targetId">
            <option value="">选择商城商品（当前租户）</option>
            <option v-for="g in scopedGoods" :key="g.id" :value="g.id">
              {{ g.icon }} {{ g.name }}（库存 {{ g.remain }}/{{ g.stock }}，{{ g.cost }} 积分）
            </option>
          </select>
        </div>
        <div class="cf-row">
          <label>采购数量</label>
          <input v-model.number="form.qty" type="number" min="1" max="9999" placeholder="审批数量（可分批验收入库）" />
        </div>
        <div class="cf-row">
          <label>供应商</label>
          <input v-model="form.supplierName" placeholder="必填：供应商名称（供应商结算依据）" />
        </div>
        <div class="cf-row">
          <label>协议单价</label>
          <input v-model.number="form.unitPrice" type="number" min="0.01" step="0.01" placeholder="必填：元/件（按实收合格量结算）" />
        </div>
        <div class="cf-row">
          <label>采购事由</label>
          <input v-model="form.reason" placeholder="必填，如：周年庆加码补货 / 售后缺货补发履约" />
        </div>
        <div v-if="linkedAfterSale" class="cf-linked">
          🔗 关联待补货售后单 {{ linkedAfterSale.id }}（{{ linkedAfterSale.targetName }}）：审批后分批验收入库，入完可继续补发履约
        </div>
        <div class="cf-actions">
          <button class="btn-ghost" @click="resetForm">清空</button>
          <button class="btn-primary" @click="submitPo">📮 提交采购申请</button>
        </div>
      </div>
    </div>
    <div v-else-if="!store.isOperator" class="readonly-tip">🔒 消费者视角仅可查看采购单据，发起采购需「活动运营 / 组织管理员」权限</div>

    <!-- 采购单列表 -->
    <div class="card">
      <div class="card-title">
        📋 采购入库单（{{ store.activeTenant.shortName }}）
        <div class="filters">
          <button v-for="f in filters" :key="f.key"
                  :class="{ active: filter === f.key }" @click="filter = f.key">
            {{ f.label }}<em v-if="f.key !== 'all'">（{{ countOf(f.key) }}）</em>
          </button>
        </div>
      </div>
      <p class="op-hint">
        运营按活动奖品/商城商品发起采购 → 具备「采购审批」权限的角色审批 → 仓配按批次验收入库（累计实收不超审批数量）→ 全部入完自动完结；
        入库即按实收抬升 SKU 的 remain/stock，并追加 append-only 验收批次台账（P5 库存勾稽）。
      </p>

      <div v-if="visibleOrders.length === 0" class="empty">暂无相关采购单</div>

      <div v-for="o in visibleOrders" :key="o.id" class="po-order" :class="o.status">
        <div class="o-head">
          <span class="o-icon">{{ o.icon }}</span>
          <div class="o-main">
            <div class="o-title">
              {{ o.targetName }}
              <span class="o-src">
                {{ o.targetType === 'prize' ? '🎡 活动奖品' : '🛍️ 商城商品' }} · {{ o.purposeLabel }} · 申请人 {{ o.applicant }}
              </span>
              <span v-if="o.afterSaleId" class="o-src shortage">🔗 售后补发 {{ o.afterSaleId }}</span>
            </div>
            <div class="o-sub">采购单 {{ o.poNo }}（{{ o.id }}）· {{ o.createdAt }} {{ o.time }}</div>
            <div class="o-sub supplier">🏭 {{ o.supplierName || '—' }} · 协议单价 ¥{{ Number(o.unitPrice || 0).toFixed(2) }}/件</div>
          </div>
          <span class="o-status" :class="o.status">{{ statusMeta(o.status).label }}</span>
        </div>

        <div class="po-body">
          <div class="po-reason">事由：{{ o.reason }}</div>
          <div class="po-progress">
            <div class="pp-bar">
              <i :style="{ width: Math.min(100, (o.inboundQty / o.qty) * 100) + '%' }"></i>
            </div>
            <span class="pp-num">已验收 <b>{{ o.inboundQty }}</b> / 采购 {{ o.qty }}</span>
            <span class="pp-stock">当前库存 {{ remainOf(o) }}/{{ stockOf(o) }}</span>
          </div>
          <div v-if="o.approveNote || o.approver" class="po-approve">
            {{ o.approver ? `审批人 ${o.approver} · ${o.approvedAt}` : '' }}<span v-if="o.approveNote">：{{ o.approveNote }}</span>
          </div>
        </div>

        <!-- 待审批：审批操作（purchase:approve） -->
        <div v-if="o.status === 'pending'" class="po-actions">
          <template v-if="store.isOperator && store.can('purchase:approve') && store.identityKind !== 'platform'">
            <input v-model="noteOf(o).note" placeholder="审批备注（可选）" />
            <button class="btn-approve" @click="approve(o, true)">✅ 审批通过</button>
            <button class="btn-reject" @click="approve(o, false)">🚫 驳回</button>
          </template>
          <span v-else-if="store.isOperator" class="waiting">🔒 平台超管不直接处理租户采购；当前角色无「采购审批」权限时仅可查看</span>
          <span v-else class="waiting">等待运营审批…</span>
          <button v-if="store.isOperator && store.can('purchase:apply') && canCancel(o)" class="btn-ghost sm" @click="cancel(o)">撤销申请</button>
        </div>

        <!-- 已审批 / 分批验收中：验收入库（purchase:inbound） -->
        <div v-if="['approved', 'receiving'].includes(o.status)" class="inbound-box">
          <template v-if="store.isOperator && store.can('purchase:inbound')">
            <div class="ib-row">
              <input v-model.number="batchOf(o).qty" type="number" min="1" :max="o.qty - o.inboundQty"
                      :placeholder="`本批合格入库（待收 ${o.qty - o.inboundQty}）`" />
              <input v-model.number="batchOf(o).deliveredQty" type="number" min="1"
                      :placeholder="`本批到货量（默认=合格量）`" />
              <input v-model="batchOf(o).carrier" placeholder="供应商 / 承运方（可选）" />
              <input v-model="batchOf(o).note" placeholder="验收备注（如：2 件破损验退）" />
              <label class="ib-close"><input type="checkbox" v-model="batchOf(o).closeShortage" /> 剩余短少不再补发，差异结案</label>
              <button class="btn-inbound" @click="doInbound(o)">📥 验收入库</button>
            </div>
            <span class="ib-tip">
              支持分批验收：合格量 ≤ 待收 {{ o.qty - o.inboundQty }}；到货量 ≥ 合格量（多出部分登记「验退拒收」不入库）；
              勾选「差异结案」则剩余待收按「到货短少」登记并提前结案
            </span>
          </template>
          <span v-else class="waiting">🔒 当前角色无「分批验收入库」权限（物流客服/组织管理员），仅可查看待入库采购单</span>
        </div>

        <!-- 验收批次时间线（append-only） -->
        <div v-if="batchesOf(o).length" class="batch-box">
          <div class="bb-title">🧾 验收批次（{{ batchesOf(o).length }} 批，append-only）</div>
          <div v-for="b in batchesOf(o)" :key="b.id" class="bb-item">
            <span class="bbi-qty">+{{ b.qty }}</span>
            <span class="bbi-main">
              {{ b.date }} {{ b.time }} · {{ b.inspector }} 验收
              <em v-if="b.carrier"> · 供应商/承运 {{ b.carrier }}</em>
              <em v-if="b.note"> · {{ b.note }}</em>
              <em v-if="b.deliveredQty && b.deliveredQty !== b.qty" class="rej"> · 到货 {{ b.deliveredQty }} / 验退 {{ b.deliveredQty - b.qty }}</em>
              <em v-if="b.shortQty" class="short"> · 短少 {{ b.shortQty }} 件结案</em>
            </span>
            <span class="bbi-stock">库存 {{ b.remainBefore }}→{{ b.remainAfter }}</span>
          </div>
        </div>

        <!-- 验收差异与供应商结算状态 -->
        <div v-if="diffsOf(o).length || billOf(o)" class="settle-box">
          <div v-if="diffsOf(o).length" class="sb-diffs">
            <span class="sb-label">⚠️ 验收差异：</span>
            <span v-for="d in diffsOf(o)" :key="d.id" class="diff-chip" :class="d.type">
              {{ d.type === 'short' ? '📉 到货短少' : '📤 验退拒收' }} ×{{ d.qty }}
            </span>
          </div>
          <div v-if="billOf(o)" class="sb-bill">
            💰 供应商账单 {{ billOf(o).billNo }}
            <span class="bill-status" :class="billOf(o).status">{{ settleMeta(billOf(o).status).label }}</span>
            <em>应付 ¥{{ Number(billOf(o).payableAmount).toFixed(2) }}（{{ billOf(o).supplierName }}）</em>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'
import { usePlatformStore, PURCHASE_STATUS, SETTLE_STATUS } from '@/store/platform'

const store = usePlatformStore()

const statusMeta = (s) => PURCHASE_STATUS[s] || { label: s }
const settleMeta = (s) => SETTLE_STATUS[s] || { label: s }

const stats = computed(() => ({
  pending: store.dashboard.purchasePending,
  toInbound: store.dashboard.purchaseToInbound,
  received: store.dashboard.purchaseReceived,
  inboundQty: store.dashboard.purchaseInboundQty
}))

const scopedActivities = computed(() => store.activities.filter((a) => a.tenantId === store.activeTenantId))
const scopedGoods = computed(() => store.goods.filter((g) => (g.tenantId || 't-star') === store.activeTenantId))

// —— 采购单列表（当前租户，最新在前） ——
const filters = [
  { key: 'pending', label: '待审批' },
  { key: 'toInbound', label: '待入库/验收中' },
  { key: 'received', label: '入库完成' },
  { key: 'diff_closed', label: '差异结案' },
  { key: 'closed', label: '驳回/撤销' },
  { key: 'all', label: '全部' }
]
const filter = ref('toInbound')
const matchFilter = (o, key) => {
  if (key === 'all') return true
  if (key === 'toInbound') return ['approved', 'receiving'].includes(o.status)
  if (key === 'closed') return ['rejected', 'canceled'].includes(o.status)
  return o.status === key
}
const visibleOrders = computed(() =>
  [...store.scopedPurchaseOrders].sort((a, b) => b.ts - a.ts).filter((o) => matchFilter(o, filter.value)))
const countOf = (key) => store.scopedPurchaseOrders.filter((o) => matchFilter(o, key)).length

// 采购单关联的库存目标 / 当前账面
const targetOfPo = (o) =>
  o.targetType === 'prize'
    ? store.activities.find((a) => a.id === o.activityId)?.prizes.find((p) => p.id === o.targetId)
    : store.goods.find((g) => g.id === o.targetId)
const remainOfPo = (o) => targetOfPo(o)?.remain ?? 0
const stockOfPo = (o) => targetOfPo(o)?.stock ?? 0
// 售后单的库存定位（缺货卡片复用）
const targetOfAfterSale = (a) =>
  a.targetType === 'prize'
    ? store.activities.find((x) => x.id === a.activityId)?.prizes.find((p) => p.id === a.targetId)
    : store.goods.find((g) => g.id === a.targetId)
const remainOf = (x) => (x?.shipmentId ? targetOfAfterSale(x) : targetOfPo(x))?.remain ?? 0
const stockOf = (o) => stockOfPo(o)

// —— 待补货售后单（waiting_stock，当前租户） ——
const waitingAfterSales = computed(() =>
  [...store.scopedAfterSales]
    .filter((a) => a.status === 'waiting_stock')
    .sort((a, b) => b.ts - a.ts))

// —— 发起采购表单 ——
const showCreate = ref(false)
const form = reactive({
  targetType: 'goods', prizeKey: '', targetId: '', qty: 1,
  supplierName: '', unitPrice: 10, reason: '', afterSaleId: ''
})
const linkedAfterSale = computed(() =>
  form.afterSaleId ? store.afterSales.find((a) => a.id === form.afterSaleId) : null)
function pickType(t) {
  form.targetType = t
  form.prizeKey = ''
  form.targetId = ''
}
function resetForm() {
  form.targetType = 'goods'; form.prizeKey = ''; form.targetId = ''
  form.qty = 1; form.supplierName = ''; form.unitPrice = 10; form.reason = ''; form.afterSaleId = ''
}
// 从待补货售后单预填采购表单（一键发起补货采购）
function newPoForAfterSale(a) {
  showCreate.value = true
  filter.value = 'all'
  form.targetType = a.targetType
  form.prizeKey = a.targetType === 'prize' ? `${a.activityId}::${a.targetId}` : ''
  form.targetId = a.targetType === 'goods' ? a.targetId : ''
  form.qty = 10
  form.supplierName = ''
  form.unitPrice = 10
  form.reason = `售后缺货补发履约（售后单 ${a.id}）：补货用于继续补发并恢复库存`
  form.afterSaleId = a.id
}
function submitPo() {
  const payload = {
    targetType: form.targetType,
    activityId: form.targetType === 'prize' ? (form.prizeKey || '').split('::')[0] : null,
    targetId: form.targetType === 'prize' ? (form.prizeKey || '').split('::')[1] : form.targetId,
    qty: form.qty,
    supplierName: form.supplierName,
    unitPrice: form.unitPrice,
    reason: form.reason,
    afterSaleId: form.afterSaleId || undefined
  }
  const po = store.createPurchaseOrder(payload)
  if (po) {
    resetForm()
    showCreate.value = false
    filter.value = 'pending'
  }
}

// —— 审批 / 撤销 / 验收 ——
const notes = reactive({})
const noteOf = (o) => (notes[o.id] || (notes[o.id] = { note: '' }))
function approve(o, ok) {
  if (store.reviewPurchaseOrder(o.id, ok, noteOf(o).note)) notes[o.id].note = ''
}
function canCancel(o) {
  const me = store.currentMemberId || store.user.id
  return o.status === 'pending' &&
    (store.identityKind === 'platform' || store.currentMember?.roleKey === 'org_admin' || o.applicantId === me)
}
function cancel(o) {
  store.cancelPurchaseOrder(o.id)
}

const batches = reactive({})
const batchOf = (o) => (batches[o.id] || (batches[o.id] = {
  qty: o.qty - o.inboundQty, deliveredQty: undefined, carrier: '', note: '', closeShortage: false
}))
function doInbound(o) {
  const f = batchOf(o)
  if (store.inboundPurchase(o.id, {
    qty: f.qty, deliveredQty: f.deliveredQty, carrier: f.carrier, note: f.note,
    closeShortage: f.closeShortage
  })) {
    f.qty = o.qty - o.inboundQty
    f.deliveredQty = undefined
    f.carrier = ''
    f.note = ''
    f.closeShortage = false
  }
}

const batchesOf = (o) =>
  store.scopedInboundBatches.filter((b) => b.poId === o.id).sort((a, b) => b.ts - a.ts)
// 采购单的验收差异 / 供应商账单
const diffsOf = (o) => store.scopedAcceptDiffs.filter((d) => d.poId === o.id).sort((a, b) => b.ts - a.ts)
const billOf = (o) => store.supplierBillOfPo(o.id)

// 缺货补发：采购入库有库存后，从待处理售后继续履约
function resumeAfterSale(a) {
  store.reviewAfterSale(a.id, true, '采购验收入库，库存就绪，继续补发履约')
}
</script>

<style scoped>
.po-view { display: flex; flex-direction: column; gap: 16px; max-width: 1040px; margin: 0 auto; }

.po-hero {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  background: linear-gradient(135deg, #2a1a4a, #162b55);
  border: 1px solid rgba(171,71,188,0.3); border-radius: 14px; padding: 18px 22px; flex-wrap: wrap;
}
.hero-stats { display: flex; gap: 28px; flex-wrap: wrap; }
.hs-item { display: flex; flex-direction: column; }
.hs-num { font-size: 26px; font-weight: 800; line-height: 1; }
.hs-num.warn { color: #ffb74d; }
.hs-num.info { color: #82b1ff; }
.hs-num.ok { color: #7ef0c9; }
.hs-num.inbound { color: #ce93d8; }
.hs-num.bad { color: #ef9a9a; }
.hs-lab { font-size: 11px; color: #9db0d0; margin-top: 5px; }
.role-box { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.role-tip { font-size: 11px; color: #9db0d0; }
.role-switch { display: flex; background: rgba(0,0,0,0.25); border-radius: 10px; padding: 3px; }
.role-switch button {
  background: transparent; border: none; color: #aebadd; font-size: 12px;
  padding: 7px 14px; border-radius: 8px; cursor: pointer;
}
.role-switch button.active {
  background: linear-gradient(135deg,#6a1b9a,#2962ff); color: #fff;
  box-shadow: 0 3px 8px rgba(106,27,154,0.4);
}

.card {
  background: #0f1b38; border: 1px solid rgba(120,160,220,0.16);
  border-radius: 14px; padding: 16px;
}
.card-title {
  font-size: 15px; font-weight: 700; color: #fff; margin-bottom: 14px;
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
}
.filters { display: flex; gap: 5px; margin-left: auto; flex-wrap: wrap; }
.filters button {
  background: #13233f; border: 1px solid rgba(120,160,220,0.18); color: #8ba2c8;
  font-size: 11px; padding: 5px 10px; border-radius: 7px; cursor: pointer;
}
.filters button.active { background: #6a1b9a; color: #fff; border-color: transparent; }
.filters em { font-style: normal; opacity: 0.8; }
.op-hint { font-size: 11px; color: #6f84ab; margin: 0 0 12px; }
.empty { color: #5b6f94; text-align: center; padding: 24px; font-size: 12px; }
.readonly-tip {
  background: rgba(120,160,220,0.08); border: 1px solid rgba(120,160,220,0.2);
  border-radius: 10px; padding: 10px 14px; font-size: 12px; color: #8ba2c8;
}

/* 缺货待补货 */
.shortage-card {
  background: rgba(229,115,115,0.08); border: 1px solid rgba(229,115,115,0.35);
  border-radius: 14px; padding: 14px 16px;
}
.sc-title { font-size: 13px; font-weight: 700; color: #ef9a9a; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.sc-hint { font-size: 11px; font-weight: 400; color: #b0bec5; }
.sc-item {
  display: flex; align-items: center; gap: 10px; margin-top: 10px;
  background: rgba(20,34,66,0.5); border: 1px solid rgba(229,115,115,0.2);
  border-radius: 10px; padding: 10px 12px; flex-wrap: wrap;
}
.sc-icon { font-size: 22px; }
.sc-main { flex: 1; min-width: 200px; }
.sc-name { font-size: 13px; color: #eef3fc; font-weight: 600; }
.sc-sub { font-size: 10px; color: #7e97c2; margin-top: 2px; }
.btn-link {
  background: transparent; border: 1px solid rgba(206,147,216,0.5); color: #ce93d8;
  border-radius: 8px; padding: 7px 13px; font-size: 12px; cursor: pointer;
}
.btn-link:hover { background: rgba(171,71,188,0.15); }
.btn-resume {
  background: linear-gradient(135deg,#ef6c00,#f57c00); color: #fff; border: none;
  border-radius: 8px; padding: 7px 14px; font-size: 12px; font-weight: 600; cursor: pointer;
}
.btn-resume:disabled {
  background: #26344f; color: #6f84ab; cursor: not-allowed;
}

/* 新建表单 */
.btn-toggle {
  margin-left: auto; background: linear-gradient(135deg,#6a1b9a,#8e24aa); color: #fff;
  border: none; border-radius: 8px; padding: 7px 14px; font-size: 12px; cursor: pointer;
}
.create-form {
  display: flex; flex-direction: column; gap: 10px;
  background: rgba(171,71,188,0.05); border: 1px dashed rgba(171,71,188,0.3);
  border-radius: 10px; padding: 13px;
}
.cf-row { display: flex; align-items: center; gap: 10px; }
.cf-row label { width: 70px; font-size: 12px; color: #8ba2c8; flex-shrink: 0; }
.cf-row input, .cf-row select {
  flex: 1; background: #0c1730; border: 1px solid rgba(120,160,220,0.2); color: #dbe4f3;
  border-radius: 8px; padding: 8px 11px; font-size: 12px; font-family: inherit;
}
.seg { display: flex; gap: 6px; }
.seg button {
  background: #13233f; border: 1px solid rgba(120,160,220,0.2); color: #aebadd;
  border-radius: 8px; padding: 7px 14px; font-size: 12px; cursor: pointer;
}
.seg button.on { background: #6a1b9a; color: #fff; border-color: transparent; }
.cf-linked {
  font-size: 11px; color: #ce93d8; background: rgba(171,71,188,0.1);
  border-radius: 8px; padding: 7px 10px;
}
.cf-actions { display: flex; justify-content: flex-end; gap: 8px; }
.btn-primary {
  background: linear-gradient(135deg,#8e24aa,#6a1b9a); color: #fff; border: none;
  border-radius: 8px; padding: 8px 18px; font-size: 12px; font-weight: 600; cursor: pointer;
}
.btn-ghost {
  background: transparent; border: 1px solid rgba(120,160,220,0.35); color: #aebadd;
  border-radius: 8px; padding: 7px 14px; font-size: 12px; cursor: pointer;
}
.btn-ghost.sm { padding: 5px 11px; font-size: 11px; }

/* 采购单 */
.po-order {
  background: rgba(20,34,66,0.5); border: 1px solid rgba(120,160,220,0.14);
  border-left-width: 3px; border-radius: 10px; padding: 13px 14px; margin-bottom: 10px;
}
.po-order.pending { border-left-color: #ffb74d; }
.po-order.approved, .po-order.receiving { border-left-color: #82b1ff; }
.po-order.received { border-left-color: #7ef0c9; }
.po-order.diff_closed { border-left-color: #ef5350; }
.po-order.rejected, .po-order.canceled { border-left-color: #e57373; }
.o-head { display: flex; align-items: center; gap: 10px; }
.o-icon { font-size: 24px; }
.o-main { flex: 1; min-width: 0; }
.o-title { font-size: 13px; color: #eef3fc; font-weight: 700; display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.o-src { font-size: 10px; color: #8ba2c8; font-weight: 400; }
.o-src.shortage { color: #ef9a9a; }
.o-sub { font-size: 10px; color: #6f84ab; margin-top: 2px; }
.o-sub.supplier { color: #80cbc4; }
.o-status { font-size: 11px; padding: 3px 10px; border-radius: 6px; font-weight: 600; flex-shrink: 0; }
.o-status.pending { background: rgba(255,183,77,0.18); color: #ffb74d; }
.o-status.approved { background: rgba(130,177,255,0.18); color: #82b1ff; }
.o-status.receiving { background: rgba(130,177,255,0.28); color: #bbdefb; }
.o-status.received { background: rgba(126,240,201,0.18); color: #7ef0c9; }
.o-status.diff_closed { background: rgba(229,115,115,0.18); color: #ef9a9a; }
.o-status.rejected, .po-order.canceled .o-status { background: rgba(229,115,115,0.18); color: #ef9a9a; }

.po-body { margin-top: 10px; display: flex; flex-direction: column; gap: 7px; }
.po-reason { font-size: 12px; color: #aebadd; }
.po-progress { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.pp-bar { flex: 1; min-width: 160px; height: 7px; background: #0c1730; border-radius: 4px; overflow: hidden; }
.pp-bar i { display: block; height: 100%; background: linear-gradient(90deg,#8e24aa,#ce93d8); border-radius: 4px; }
.pp-num { font-size: 11px; color: #aebadd; white-space: nowrap; }
.pp-num b { color: #ce93d8; }
.pp-stock { font-size: 11px; color: #7e97c2; white-space: nowrap; }
.po-approve { font-size: 11px; color: #7e97c2; }

.po-actions { margin-top: 10px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.po-actions input {
  flex: 1; min-width: 180px; background: #0c1730; border: 1px solid rgba(120,160,220,0.2); color: #dbe4f3;
  border-radius: 8px; padding: 7px 11px; font-size: 12px;
}
.btn-approve {
  background: linear-gradient(135deg,#66bb6a,#43a047); color: #fff; border: none;
  border-radius: 8px; padding: 7px 15px; font-size: 12px; font-weight: 600; cursor: pointer;
}
.btn-reject {
  background: transparent; border: 1px solid rgba(229,115,115,0.5); color: #ef9a9a;
  border-radius: 8px; padding: 7px 15px; font-size: 12px; cursor: pointer;
}
.waiting { font-size: 11px; color: #7e97c2; }

.inbound-box {
  margin-top: 10px; background: rgba(130,177,255,0.06); border: 1px solid rgba(130,177,255,0.22);
  border-radius: 9px; padding: 10px 12px; display: flex; flex-direction: column; gap: 7px;
}
.ib-row { display: flex; gap: 8px; flex-wrap: wrap; }
.ib-row input {
  flex: 1; min-width: 150px; background: #0c1730; border: 1px solid rgba(120,160,220,0.2); color: #dbe4f3;
  border-radius: 8px; padding: 8px 11px; font-size: 12px;
}
.btn-inbound {
  background: linear-gradient(135deg,#1e88e5,#00897b); color: #fff; border: none;
  border-radius: 8px; padding: 8px 16px; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap;
}
.ib-tip { font-size: 10px; color: #7e97c2; }

.batch-box {
  margin-top: 10px; background: rgba(120,160,220,0.05); border: 1px dashed rgba(120,160,220,0.25);
  border-radius: 9px; padding: 10px 12px;
}
.bb-title { font-size: 11px; font-weight: 700; color: #82b1ff; margin-bottom: 7px; }
.bb-item { display: flex; align-items: baseline; gap: 10px; font-size: 11px; color: #aebadd; padding: 3px 0; }
.bbi-qty { color: #7ef0c9; font-weight: 800; width: 34px; flex-shrink: 0; }
.bbi-main { flex: 1; }
.bbi-main em { font-style: normal; color: #7e97c2; }
.bbi-main em.rej { color: #ffb74d; }
.bbi-main em.short { color: #ef9a9a; }
.bbi-stock { font-size: 10px; color: #7e97c2; white-space: nowrap; }

.ib-close { display: flex; align-items: center; gap: 4px; font-size: 11px; color: #ffcc80; white-space: nowrap; }
.ib-close input { flex: none; min-width: 0; }

.settle-box {
  margin-top: 10px; display: flex; flex-direction: column; gap: 6px;
  background: rgba(0,137,123,0.06); border: 1px solid rgba(77,182,172,0.22);
  border-radius: 9px; padding: 8px 11px;
}
.sb-diffs { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; font-size: 11px; }
.sb-label { color: #7e97c2; }
.diff-chip {
  font-size: 10px; padding: 2px 9px; border-radius: 6px;
}
.diff-chip.short { background: rgba(229,115,115,0.16); color: #ef9a9a; }
.diff-chip.rejected { background: rgba(255,183,77,0.16); color: #ffb74d; }
.sb-bill { font-size: 11px; color: #aebadd; display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.sb-bill em { font-style: normal; color: #ffd54f; }
.bill-status { font-size: 10px; padding: 1px 8px; border-radius: 5px; background: rgba(130,177,255,0.18); color: #82b1ff; }
.bill-status.settled { background: rgba(126,240,201,0.18); color: #7ef0c9; }
.bill-status.reviewing { background: rgba(255,183,77,0.18); color: #ffb74d; }
.bill-status.approved { background: rgba(130,177,255,0.25); color: #bbdefb; }
.bill-status.rejected { background: rgba(229,115,115,0.18); color: #ef9a9a; }
.bill-status.draft { background: rgba(111,132,171,0.2); color: #aebadd; }
</style>
