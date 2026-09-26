<template>
  <div class="sp-view">
    <!-- 顶部概览 + 视角切换 -->
    <div class="sp-hero">
      <div class="hero-stats">
        <div class="hs-item">
          <span class="hs-num warn">{{ stats.reviewing + stats.approved }}</span>
          <span class="hs-lab">财务待办（复核/待结算）</span>
        </div>
        <div class="hs-item">
          <span class="hs-num info">{{ billableCount }}</span>
          <span class="hs-lab">待拟账单采购单</span>
        </div>
        <div class="hs-item">
          <span class="hs-num bad">{{ stats.draft + stats.rejected }}</span>
          <span class="hs-lab">草稿/待修订</span>
        </div>
        <div class="hs-item">
          <span class="hs-num ok">{{ stats.settled }}</span>
          <span class="hs-lab">已结算账单</span>
        </div>
        <div class="hs-item">
          <span class="hs-num pay">{{ '¥' + formatMoney(stats.payable) }}</span>
          <span class="hs-lab">待付款金额</span>
        </div>
        <div class="hs-item">
          <span class="hs-num paid">{{ '¥' + formatMoney(stats.paid) }}</span>
          <span class="hs-lab">累计已付</span>
        </div>
      </div>
      <div class="role-box">
        <span class="role-tip">当前视角</span>
        <div class="role-switch">
          <button :class="{ active: store.role === 'user' }" @click="store.setRole('user')">👤 用户（只读）</button>
          <button :class="{ active: store.role === 'operator' }" @click="store.setRole('operator')">🛒 运营/财务</button>
        </div>
      </div>
    </div>

    <!-- 采购批次 × 售后补发 库存对账 -->
    <div class="card">
      <div class="card-title">
        🔗 采购结算对账（按采购批次勾稽验收差异与售后补发）
        <span class="title-sub">{{ recon.settledPo }} 张已闭环 / {{ recon.openPo }} 张有待办 / 共 {{ recon.items.length }} 张可结算采购单</span>
      </div>
      <p class="op-hint">
        口径：审批数量 = 合格入库 + 到货短少；到货数量 = 合格入库 + 验退拒收；售后补发采购在补发履约完成后，结算自动按批次勾稽出补发占用件（不重复计价、不重复入库）。
        对账结果由供应商结算独立闭环，不并入积分库存对账（P1–P6）的未平差异数。
      </p>
      <div v-if="recon.items.length === 0" class="empty">暂无可结算采购单（采购入库完成或验收差异结案后进入对账）</div>
      <div v-for="r in reconItems" :key="r.poId" class="recon-row" :class="{ open: r.issues.length }">
        <span class="rr-icon">{{ r.icon }}</span>
        <div class="rr-main">
          <div class="rr-name">
            {{ r.targetName }}
            <em>{{ r.poNo }}</em>
            <span class="rr-sup">供应商：{{ r.supplierName }}</span>
            <span v-if="r.reshipDone" class="rr-tag ok">📦 售后补发 {{ r.reshipmentId }} 已履约</span>
          </div>
          <div class="rr-qty">
            审批 <b>{{ r.orderQty }}</b> · 合格入库 <b class="ok">{{ r.acceptedQty }}</b>
            <span v-if="r.shortQty"> · 短少 <b class="bad">{{ r.shortQty }}</b></span>
            <span v-if="r.rejectedQty"> · 验退 <b class="warn">{{ r.rejectedQty }}</b></span>
            <template v-if="r.billId">
              · 账单 <b>{{ r.billId }}</b>
              <span class="rr-status" :class="r.billStatus">{{ statusMeta(r.billStatus).label }}</span>
              · 应付 <b class="pay">¥{{ formatMoney(r.payableAmount) }}</b>
            </template>
          </div>
          <div v-if="r.issues.length" class="rr-issues">
            <span v-for="(it, i) in r.issues" :key="i" class="issue-chip">⚠️ {{ it.label }}</span>
          </div>
        </div>
        <div class="rr-actions">
          <button v-if="!r.billId && canBill" class="btn-primary sm" @click="openBillForm(r)">🧾 发起账单</button>
          <button v-if="['reviewing','approved'].includes(r.billStatus) && canSettle" class="btn-settle sm"
                  @click="goBill(r.billId)">💰 去结算复核</button>
          <button v-if="r.billStatus === 'rejected' && canBill" class="btn-ghost sm" @click="goBill(r.billId)">📝 修订重提</button>
        </div>
      </div>
    </div>

    <!-- 发起账单表单（运营 supplier:bill） -->
    <div v-if="billFormTarget" class="card form-card">
      <div class="card-title">🧾 发起供应商账单 · {{ billFormTarget.targetName }}（{{ billFormTarget.poNo }}）</div>
      <div class="bill-preview">
        <div class="bp-line"><label>供应商</label><b>{{ billDraft?.supplierName }}</b></div>
        <div class="bp-line"><label>协议单价</label><b>¥{{ formatMoney(billDraft?.unitPrice) }} / 件</b></div>
        <div class="bp-line"><label>验收批次</label><b>{{ billDraft?.rows.length }} 批</b></div>
        <div class="bp-line"><label>合格入库</label><b>{{ billDraft?.acceptedQty }} 件</b></div>
        <div class="bp-line" v-if="billDraft?.shortQty"><label>到货短少</label><b class="bad">{{ billDraft.shortQty }} 件（未到货不计价）</b></div>
        <div class="bp-line" v-if="billDraft?.rejectedQty"><label>验退拒收</label><b class="warn">{{ billDraft.rejectedQty }} 件（不入库不计价）</b></div>
        <div class="bp-line" v-if="billDraft?.reshipQty"><label>售后补发占用</label><b class="info">{{ billDraft.reshipQty }} 件（−¥{{ formatMoney(billDraft.reshipDeduct) }}，不重复付款）</b></div>
        <div class="bp-line" v-if="billDraft?.reshipPending"><label>补发提示</label><b class="warn">关联售后补发尚未履约，结算前将自动复核（履约后扣减补发件）</b></div>
        <div class="bp-line total"><label>应付金额</label><b class="pay">¥{{ formatMoney(billDraft?.payableAmount) }}</b></div>
      </div>
      <div class="form-row">
        <label>账单备注</label>
        <input v-model="billNote" placeholder="可选：结算说明 / 差异处理意见" />
      </div>
      <div class="form-actions">
        <button class="btn-ghost" @click="billFormTarget = null">取消</button>
        <button class="btn-ghost" @click="saveDraft">💾 存草稿</button>
        <button class="btn-primary" @click="submitBill">📮 提交财务复核</button>
      </div>
    </div>

    <!-- 账单列表 -->
    <div class="card">
      <div class="card-title">
        💰 供应商账单 / 结算单（{{ store.activeTenant.shortName }}）
        <div class="filters">
          <button v-for="f in filters" :key="f.key" :class="{ active: filter === f.key }" @click="filter = f.key">
            {{ f.label }}<em v-if="f.key !== 'all'">（{{ countOf(f.key) }}）</em>
          </button>
        </div>
      </div>
      <p class="op-hint">
        运营按采购批次拟供应商账单 → 财务复核（驳回可修订重提）→ 复核通过后结算付款；结算按采购批次与售后补发回写库存对账快照并留存全链路审计。
      </p>
      <div v-if="visibleBills.length === 0" class="empty">暂无相关供应商账单</div>

      <div v-for="b in visibleBills" :key="b.id" class="bill" :class="b.status">
        <div class="b-head">
          <span class="b-icon">{{ b.icon }}</span>
          <div class="b-main">
            <div class="b-title">
              {{ b.targetName }}
              <span class="b-no">{{ b.billNo }}</span>
              <span class="b-sup">供应商：{{ b.supplierName }}</span>
              <span v-if="b.afterSaleId" class="b-tag">🔗 售后补发采购 {{ b.afterSaleId }}</span>
            </div>
            <div class="b-sub">采购 {{ b.poNo }} · 发起人 {{ b.applicant }} · {{ b.createdAt }} {{ b.time }}</div>
          </div>
          <span class="b-status" :class="b.status">{{ statusMeta(b.status).label }}</span>
        </div>

        <div class="b-amounts">
          <span>合格入库 <b>{{ b.acceptedQty }}</b> / 审批 {{ b.orderQty }}</span>
          <span v-if="b.shortQty">短少 <b class="bad">{{ b.shortQty }}</b></span>
          <span v-if="b.rejectedQty">验退 <b class="warn">{{ b.rejectedQty }}</b></span>
          <span v-if="b.reshipQty">补发占用 <b class="info">{{ b.reshipQty }}</b></span>
          <span>单价 <b>¥{{ formatMoney(b.unitPrice) }}</b></span>
          <span class="amt">货款 <s>¥{{ formatMoney(b.grossAmount) }}</s></span>
          <span v-if="b.reshipDeduct" class="amt deduct">补发扣减 −¥{{ formatMoney(b.reshipDeduct) }}</span>
          <span class="amt payable">应付 <b>¥{{ formatMoney(b.payableAmount) }}</b></span>
        </div>

        <!-- 批次对账明细 -->
        <div class="batch-box">
          <div class="bb-title">🧾 采购批次 × 库存对账回写（{{ b.rows.length }} 批）</div>
          <div v-for="r in b.rows" :key="r.batchId" class="bb-item">
            <span class="bbi-seq">#{{ r.seq }}</span>
            <span class="bbi-main">
              {{ r.date }} {{ r.time }} · 批次 {{ r.batchId }} · {{ r.inspector }} 验收
              <em v-if="r.carrier"> · {{ r.carrier }}</em>
              <em v-if="r.note"> · {{ r.note }}</em>
            </span>
            <span class="bbi-qty">到货 {{ r.deliveredQty }}</span>
            <span class="bbi-qty ok">合格 {{ r.acceptedQty }}</span>
            <span v-if="r.rejectedQty" class="bbi-qty warn">验退 {{ r.rejectedQty }}</span>
            <span v-if="r.shortQty" class="bbi-qty bad">短少 {{ r.shortQty }}</span>
            <span v-if="r.reshipQty" class="bbi-qty info">补发占用 {{ r.reshipQty }}</span>
            <span class="bbi-qty pay">计价 {{ r.billableQty }}</span>
          </div>
        </div>

        <div v-if="b.note" class="b-note">📝 账单备注：{{ b.note }}</div>
        <div v-if="b.reviewedAt" class="b-review">
          🔎 财务复核（{{ b.reviewer }} · {{ b.reviewedAt }}）：{{ b.reviewNote || (b.status === 'rejected' ? '不同意' : '复核无误') }}
        </div>
        <div v-if="b.settledAt" class="b-settled">
          ✅ 已结算：{{ b.settleOperator }} · {{ b.settledAt }}<span v-if="b.settleNote"> · {{ b.settleNote }}</span>
          <em>库存对账快照已按批次回写归档（{{ b.reconWriteback?.bizDate }}）</em>
        </div>

        <!-- 操作区 -->
        <div class="b-actions">
          <template v-if="b.status === 'draft' && canBill">
            <button class="btn-primary sm" @click="resubmit(b)">📮 提交复核</button>
          </template>
          <template v-if="b.status === 'rejected' && canBill">
            <button class="btn-primary sm" @click="resubmit(b)">📝 修订后重新提交</button>
          </template>
          <template v-if="b.status === 'reviewing' && canReview">
            <input v-model="reviewNoteOf(b).note" placeholder="复核意见（可选）" />
            <button class="btn-approve sm" @click="review(b, true)">✅ 复核通过</button>
            <button class="btn-reject sm" @click="review(b, false)">🚫 驳回</button>
          </template>
          <template v-if="b.status === 'approved' && canSettle">
            <input v-model="settleNoteOf(b).note" placeholder="结算备注（可选，如：对公付款凭证号）" />
            <button class="btn-settle sm" @click="settlePay(b)">💰 结算付款 ¥{{ formatMoney(b.payableAmount) }}</button>
          </template>
          <span v-else-if="!store.isOperator" class="waiting">消费者视角仅可查看结算单据</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'
import { usePlatformStore, SETTLE_STATUS } from '@/store/platform'

const store = usePlatformStore()
const statusMeta = (s) => SETTLE_STATUS[s] || { label: s }
const formatMoney = (n) => (Number(n) || 0).toFixed(2)

const stats = computed(() => {
  const x = store.supplierBillStats
  return {
    ...x,
    payable: store.dashboard.supplierPayable,
    paid: store.dashboard.supplierPaid
  }
})
const billableCount = computed(() => store.billablePurchaseCount)
const canBill = computed(() => store.isOperator && store.can('supplier:bill'))
const canReview = computed(() => store.isOperator && store.can('supplier:review'))
const canSettle = computed(() => store.isOperator && store.can('supplier:settle'))

// —— 采购结算对账 ——
const recon = computed(() => store.computeSupplierRecon())
const reconItems = computed(() => [...recon.value.items].sort((a, b) => (b.issues.length - a.issues.length)))

// —— 发起账单 ——
const billFormTarget = ref(null)
const billNote = ref('')
const billDraft = computed(() =>
  billFormTarget.value ? store.supplierBills.find((b) => b.poId === billFormTarget.value.poId && b.status !== 'rejected')
    || draftOfPo(billFormTarget.value.poId) : null)
function draftOfPo(poId) {
  // 实时按采购单推导的拟单快照（不落库）
  const po = store.purchaseOrders.find((o) => o.id === poId)
  if (!po) return null
  const amount = store._supplierBillAmount(po)
  const pack = store._settleRowsOfPo(po)
  return { ...amount, rows: pack.rows, reshipPending: pack.reshipPending, supplierName: po.supplierName, unitPrice: po.unitPrice }
}
function openBillForm(r) {
  billFormTarget.value = { poId: r.poId, targetName: r.targetName, poNo: r.poNo }
  billNote.value = ''
}
function saveDraft() {
  const b = store.createSupplierBill(billFormTarget.value.poId, { note: billNote.value, submit: false })
  if (b) { billFormTarget.value = null; filter.value = 'draft' }
}
function submitBill() {
  const b = store.createSupplierBill(billFormTarget.value.poId, { note: billNote.value, submit: true })
  if (b) { billFormTarget.value = null; filter.value = 'reviewing' }
}

// —— 账单列表 ——
const filters = [
  { key: 'reviewing', label: '复核中' },
  { key: 'approved', label: '待结算' },
  { key: 'draft', label: '草稿' },
  { key: 'rejected', label: '待修订' },
  { key: 'settled', label: '已结算' },
  { key: 'all', label: '全部' }
]
const filter = ref('reviewing')
const matchFilter = (b, key) => key === 'all' ? true : b.status === key
const visibleBills = computed(() =>
  [...store.scopedSupplierBills].sort((a, b) => b.ts - a.ts).filter((b) => matchFilter(b, filter.value)))
const countOf = (key) => store.scopedSupplierBills.filter((b) => matchFilter(b, key)).length
function goBill(id) {
  filter.value = 'all'
}
function resubmit(b) {
  store.submitSupplierBill(b.id, { note: b.note })
  filter.value = 'reviewing'
}
const reviewNotes = reactive({})
const reviewNoteOf = (b) => (reviewNotes[b.id] || (reviewNotes[b.id] = { note: '' }))
function review(b, ok) {
  if (store.reviewSupplierBill(b.id, ok, reviewNoteOf(b).note)) reviewNotes[b.id].note = ''
}
const settleNotes = reactive({})
const settleNoteOf = (b) => (settleNotes[b.id] || (settleNotes[b.id] = { note: '' }))
function settlePay(b) {
  const note = settleNoteOf(b).note
  const r = store.settleSupplierBill(b.id, note)
  if (r) { settleNotes[b.id].note = ''; filter.value = 'settled' }
}
</script>

<style scoped>
.sp-view { display: flex; flex-direction: column; gap: 16px; max-width: 1080px; margin: 0 auto; }
.sp-hero {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  background: linear-gradient(135deg, #12302a, #162b55);
  border: 1px solid rgba(77,182,172,0.3); border-radius: 14px; padding: 18px 22px; flex-wrap: wrap;
}
.hero-stats { display: flex; gap: 26px; flex-wrap: wrap; }
.hs-item { display: flex; flex-direction: column; }
.hs-num { font-size: 24px; font-weight: 800; line-height: 1; }
.hs-num.warn { color: #ffb74d; }
.hs-num.info { color: #82b1ff; }
.hs-num.ok { color: #7ef0c9; }
.hs-num.bad { color: #ef9a9a; }
.hs-num.pay { color: #ffd54f; }
.hs-num.paid { color: #a5d6a7; }
.hs-lab { font-size: 11px; color: #9db0d0; margin-top: 5px; }
.role-box { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.role-tip { font-size: 11px; color: #9db0d0; }
.role-switch { display: flex; background: rgba(0,0,0,0.25); border-radius: 10px; padding: 3px; }
.role-switch button {
  background: transparent; border: none; color: #aebadd; font-size: 12px;
  padding: 7px 14px; border-radius: 8px; cursor: pointer;
}
.role-switch button.active { background: linear-gradient(135deg,#00897b,#2962ff); color: #fff; }

.card { background: #0f1b38; border: 1px solid rgba(120,160,220,0.16); border-radius: 14px; padding: 16px; }
.card-title {
  font-size: 15px; font-weight: 700; color: #fff; margin-bottom: 12px;
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
}
.title-sub { font-size: 11px; font-weight: 400; color: #7e97c2; }
.op-hint { font-size: 11px; color: #6f84ab; margin: 0 0 12px; line-height: 1.6; }
.empty { color: #5b6f94; text-align: center; padding: 22px; font-size: 12px; }
.filters { display: flex; gap: 5px; margin-left: auto; flex-wrap: wrap; }
.filters button {
  background: #13233f; border: 1px solid rgba(120,160,220,0.18); color: #8ba2c8;
  font-size: 11px; padding: 5px 10px; border-radius: 7px; cursor: pointer;
}
.filters button.active { background: #00897b; color: #fff; border-color: transparent; }
.filters em { font-style: normal; opacity: 0.8; }

/* 对账行 */
.recon-row {
  display: flex; align-items: flex-start; gap: 10px; padding: 11px 12px;
  background: rgba(20,34,66,0.5); border: 1px solid rgba(120,160,220,0.12);
  border-left: 3px solid #4db6ac; border-radius: 10px; margin-bottom: 9px;
}
.recon-row.open { border-left-color: #ffb74d; }
.rr-icon { font-size: 22px; }
.rr-main { flex: 1; min-width: 0; }
.rr-name { font-size: 13px; color: #eef3fc; font-weight: 700; display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.rr-name em { font-style: normal; font-size: 10px; color: #8ba2c8; font-weight: 400; }
.rr-sup { font-size: 10px; color: #7e97c2; font-weight: 400; }
.rr-tag { font-size: 10px; padding: 2px 8px; border-radius: 6px; background: rgba(126,240,201,0.15); color: #7ef0c9; font-weight: 400; }
.rr-tag.ok { background: rgba(126,240,201,0.15); }
.rr-qty { font-size: 11px; color: #aebadd; margin-top: 4px; display: flex; gap: 10px; flex-wrap: wrap; }
.rr-qty b { color: #ce93d8; }
.rr-qty b.ok { color: #7ef0c9; }
.rr-qty b.bad { color: #ef9a9a; }
.rr-qty b.warn { color: #ffb74d; }
.rr-qty b.pay { color: #ffd54f; }
.rr-status { font-size: 10px; padding: 1px 7px; border-radius: 5px; background: rgba(130,177,255,0.18); color: #82b1ff; }
.rr-status.settled { background: rgba(126,240,201,0.18); color: #7ef0c9; }
.rr-status.reviewing { background: rgba(255,183,77,0.18); color: #ffb74d; }
.rr-status.approved { background: rgba(130,177,255,0.25); color: #bbdefb; }
.rr-status.rejected { background: rgba(229,115,115,0.18); color: #ef9a9a; }
.rr-issues { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
.issue-chip {
  font-size: 10px; color: #ffcc80; background: rgba(255,183,77,0.1);
  border: 1px solid rgba(255,183,77,0.25); border-radius: 6px; padding: 2px 8px;
}
.rr-actions { display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; }

/* 表单 */
.form-card { border-color: rgba(77,182,172,0.3); }
.bill-preview {
  display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 6px 24px;
  background: rgba(77,182,172,0.06); border: 1px dashed rgba(77,182,172,0.3);
  border-radius: 10px; padding: 12px 14px; margin-bottom: 10px;
}
.bp-line { display: flex; justify-content: space-between; font-size: 12px; color: #aebadd; }
.bp-line label { color: #7e97c2; }
.bp-line b { color: #dbe4f3; }
.bp-line b.bad { color: #ef9a9a; }
.bp-line b.warn { color: #ffb74d; }
.bp-line b.info { color: #82b1ff; }
.bp-line.total { border-top: 1px solid rgba(120,160,220,0.2); padding-top: 6px; margin-top: 2px; }
.bp-line b.pay { color: #ffd54f; font-size: 15px; }
.form-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.form-row label { width: 70px; font-size: 12px; color: #8ba2c8; }
.form-row input {
  flex: 1; background: #0c1730; border: 1px solid rgba(120,160,220,0.2); color: #dbe4f3;
  border-radius: 8px; padding: 8px 11px; font-size: 12px;
}
.form-actions { display: flex; justify-content: flex-end; gap: 8px; }

/* 账单卡片 */
.bill {
  background: rgba(20,34,66,0.5); border: 1px solid rgba(120,160,220,0.14);
  border-left: 3px solid #4db6ac; border-radius: 10px; padding: 13px 14px; margin-bottom: 10px;
}
.bill.reviewing { border-left-color: #ffb74d; }
.bill.approved { border-left-color: #82b1ff; }
.bill.rejected { border-left-color: #ef9a9a; }
.bill.draft { border-left-color: #6f84ab; }
.b-head { display: flex; align-items: flex-start; gap: 10px; }
.b-icon { font-size: 24px; }
.b-main { flex: 1; min-width: 0; }
.b-title { font-size: 13px; color: #eef3fc; font-weight: 700; display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.b-no { font-size: 10px; color: #ce93d8; font-weight: 600; }
.b-sup { font-size: 10px; color: #7e97c2; font-weight: 400; }
.b-tag { font-size: 10px; color: #82b1ff; font-weight: 400; }
.b-sub { font-size: 10px; color: #6f84ab; margin-top: 2px; }
.b-status { font-size: 11px; padding: 3px 10px; border-radius: 6px; font-weight: 600; flex-shrink: 0; }
.b-status.draft { background: rgba(111,132,171,0.2); color: #aebadd; }
.b-status.reviewing { background: rgba(255,183,77,0.18); color: #ffb74d; }
.b-status.approved { background: rgba(130,177,255,0.2); color: #82b1ff; }
.b-status.rejected { background: rgba(229,115,115,0.18); color: #ef9a9a; }
.b-status.settled { background: rgba(126,240,201,0.18); color: #7ef0c9; }

.b-amounts {
  display: flex; gap: 16px; flex-wrap: wrap; margin-top: 10px;
  font-size: 11px; color: #aebadd; padding: 8px 10px;
  background: rgba(120,160,220,0.05); border-radius: 8px;
}
.b-amounts b { color: #ce93d8; }
.b-amounts b.bad { color: #ef9a9a; }
.b-amounts b.warn { color: #ffb74d; }
.b-amounts b.info { color: #82b1ff; }
.b-amounts .amt { color: #7e97c2; }
.b-amounts .amt s { color: #7e97c2; }
.b-amounts .amt.deduct { color: #ef9a9a; }
.b-amounts .payable b { color: #ffd54f; font-size: 14px; }

.batch-box {
  margin-top: 10px; background: rgba(120,160,220,0.05); border: 1px dashed rgba(120,160,220,0.25);
  border-radius: 9px; padding: 9px 12px;
}
.bb-title { font-size: 11px; font-weight: 700; color: #4db6ac; margin-bottom: 6px; }
.bb-item { display: flex; align-items: baseline; gap: 10px; font-size: 11px; color: #aebadd; padding: 2px 0; flex-wrap: wrap; }
.bbi-seq { color: #6f84ab; width: 22px; flex-shrink: 0; }
.bbi-main { flex: 1; min-width: 200px; }
.bbi-main em { font-style: normal; color: #7e97c2; }
.bbi-qty { font-size: 10px; color: #aebadd; white-space: nowrap; }
.bbi-qty.ok { color: #7ef0c9; }
.bbi-qty.warn { color: #ffb74d; }
.bbi-qty.bad { color: #ef9a9a; }
.bbi-qty.info { color: #82b1ff; }
.bbi-qty.pay { color: #ffd54f; font-weight: 700; }

.b-note { font-size: 11px; color: #aebadd; margin-top: 8px; }
.b-review {
  font-size: 11px; color: #ffcc80; background: rgba(255,183,77,0.08);
  border-radius: 8px; padding: 7px 10px; margin-top: 8px;
}
.b-settled {
  font-size: 11px; color: #7ef0c9; background: rgba(126,240,201,0.08);
  border-radius: 8px; padding: 7px 10px; margin-top: 8px;
}
.b-settled em { font-style: normal; color: #7e97c2; display: block; margin-top: 2px; }

.b-actions { margin-top: 10px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.b-actions input {
  flex: 1; min-width: 200px; background: #0c1730; border: 1px solid rgba(120,160,220,0.2); color: #dbe4f3;
  border-radius: 8px; padding: 7px 11px; font-size: 12px;
}
.waiting { font-size: 11px; color: #7e97c2; }
.btn-primary {
  background: linear-gradient(135deg,#00897b,#00695c); color: #fff; border: none;
  border-radius: 8px; padding: 8px 16px; font-size: 12px; font-weight: 600; cursor: pointer;
}
.btn-primary.sm { padding: 6px 13px; }
.btn-ghost {
  background: transparent; border: 1px solid rgba(120,160,220,0.35); color: #aebadd;
  border-radius: 8px; padding: 7px 14px; font-size: 12px; cursor: pointer;
}
.btn-ghost.sm { padding: 6px 12px; }
.btn-approve {
  background: linear-gradient(135deg,#66bb6a,#43a047); color: #fff; border: none;
  border-radius: 8px; padding: 7px 15px; font-size: 12px; font-weight: 600; cursor: pointer;
}
.btn-reject {
  background: transparent; border: 1px solid rgba(229,115,115,0.5); color: #ef9a9a;
  border-radius: 8px; padding: 7px 15px; font-size: 12px; cursor: pointer;
}
.btn-settle {
  background: linear-gradient(135deg,#f9a825,#f57f17); color: #1a1a1a; border: none;
  border-radius: 8px; padding: 8px 18px; font-size: 12px; font-weight: 700; cursor: pointer;
}
.btn-settle.sm { padding: 6px 14px; }
</style>
