<template>
  <div class="ship-view">
    <!-- 顶部概览 + 角色切换 -->
    <div class="ship-hero">
      <div class="hero-stats">
        <div class="hs-item">
          <span class="hs-num warn">{{ stats.pendingAddress }}</span>
          <span class="hs-lab">待填地址</span>
        </div>
        <div class="hs-item">
          <span class="hs-num info">{{ stats.toShip }}</span>
          <span class="hs-lab">待运营发货</span>
        </div>
        <div class="hs-item">
          <span class="hs-num ok">{{ stats.shipped }}</span>
          <span class="hs-lab">已发货 / 待收货</span>
        </div>
        <div class="hs-item">
          <span class="hs-num muted">{{ stats.received }}</span>
          <span class="hs-lab">已完成收货</span>
        </div>
        <div class="hs-item">
          <span class="hs-num bad">{{ stats.returned }}</span>
          <span class="hs-lab">已退回</span>
        </div>
        <div class="hs-item">
          <span class="hs-num aftersale">{{ store.pendingAfterSaleCount }}</span>
          <span class="hs-lab">售后待审核</span>
        </div>
        <div class="hs-item">
          <span class="hs-num shortage">{{ store.waitingStockAfterSaleCount }}</span>
          <span class="hs-lab">缺货待补货</span>
        </div>
      </div>
      <div class="role-box">
        <span class="role-tip">当前视角</span>
        <div class="role-switch">
          <button :class="{ active: store.role === 'user' }" @click="store.setRole('user')">👤 用户（收货）</button>
          <button :class="{ active: store.role === 'operator' }" @click="store.setRole('operator')">📦 运营（接单发货）</button>
        </div>
      </div>
    </div>

    <!-- 用户视角：我的实物奖品/订单 -->
    <div v-if="!store.isOperator" class="card">
      <div class="card-title">
        📮 我的中奖 / 兑换实物
        <div class="filters">
          <button v-for="f in userFilters" :key="f.key"
                  :class="{ active: userFilter === f.key }" @click="userFilter = f.key">
            {{ f.label }}
            <em v-if="f.key !== 'all' && userCountOf(f.key)">({{ userCountOf(f.key) }})</em>
          </button>
        </div>
      </div>

      <!-- 待办提示 -->
      <div v-if="store.myShipTodoCount" class="todo-entry">
        <span v-if="addrTodos.length">📝 你有 <b>{{ addrTodos.length }}</b> 件实物待填写收货信息；
          <span v-if="receiveTodos.length"><b>{{ receiveTodos.length }}</b> 件已发货待确认收货</span>
        </span>
        <span v-else-if="receiveTodos.length">📦 你有 <b>{{ receiveTodos.length }}</b> 件实物已送达，记得确认收货</span>
      </div>

      <div v-if="visibleUserOrders.length === 0" class="empty">暂无实物中奖 / 兑换订单（积分奖品与虚拟券卡无需收货）</div>

      <div v-for="o in visibleUserOrders" :key="o.id" class="ship-order" :class="o.status">
        <div class="o-head">
          <span class="o-icon">{{ o.icon }}</span>
          <div class="o-main">
            <div class="o-title">
              {{ o.targetName }}
              <span class="o-src">{{ o.bizType === 'draw' ? '抽奖中奖' : '积分兑换' }} · {{ o.source }}</span>
              <span v-if="o.originId" class="o-src">补发自 {{ o.originId }}</span>
            </div>
            <div class="o-sub">发货单 {{ o.id }} · {{ o.date }} {{ o.time }}</div>
          </div>
          <span class="o-status" :class="o.status">{{ statusMeta(o.status).label }}</span>
        </div>

        <!-- 待填地址 / 修改地址：表单 -->
        <div v-if="o.status === 'pending_address' || editingId === o.id" class="addr-form">
          <div class="af-row">
            <input v-model="addrForm(o).receiver" placeholder="收货人姓名" />
            <input v-model="addrForm(o).phone" placeholder="手机号（11 位）" maxlength="11" />
          </div>
          <div class="af-row">
            <input v-model="addrForm(o).region" placeholder="所在地区，如：上海市浦东新区" />
          </div>
          <div class="af-row">
            <input v-model="addrForm(o).address" placeholder="详细收货地址（街道/楼栋/门牌号）" />
          </div>
          <div class="af-actions">
            <button v-if="editingId === o.id" class="btn-ghost" @click="cancelEdit(o)">取消</button>
            <button class="btn-primary" @click="submitAddr(o)">{{ editingId === o.id ? '💾 保存修改' : '📮 提交收货信息' }}</button>
          </div>
        </div>

        <!-- 待发货：展示已填地址，可修改 -->
        <div v-else-if="o.status === 'to_ship'" class="addr-box">
          <div class="ab-info">
            <b>📍 {{ o.receiver }} {{ maskPhone(o.phone) }}</b>
            <span>{{ o.region }} {{ o.address }}</span>
            <em>提交于 {{ o.addressAt }} · 等待运营接单发货</em>
          </div>
          <button class="btn-ghost" @click="editAddress(o)">✏️ 修改地址</button>
        </div>

        <!-- 已发货：物流信息 + 确认收货 + 同步轨迹 -->
        <div v-else-if="o.status === 'shipped'" class="ship-box">
          <div class="ab-info">
            <b>🚚 {{ o.carrier }} · {{ o.trackingNo }}</b>
            <span>📍 {{ o.receiver }} {{ maskPhone(o.phone) }} · {{ o.region }} {{ o.address }}</span>
            <em>运营 {{ o.shipper }} 于 {{ o.shippedAt }} 接单发货<span v-if="o.shipNote">；{{ o.shipNote }}</span></em>
          </div>
          <div class="btn-col">
            <button class="btn-ghost" @click="syncTrace(o)">🔄 同步物流</button>
            <button class="btn-primary" @click="confirmReceive(o)">✅ 确认收货</button>
          </div>
        </div>

        <!-- 已退回：售后拒收/退货完成 -->
        <div v-else-if="o.status === 'returned'" class="return-box">
          <div class="ab-info">
            <b>🚫 已退回，售后完成</b>
            <span>🚚 {{ o.carrier }} · {{ o.trackingNo }} · 📍 {{ o.region }} {{ o.address }}</span>
            <em>发货 {{ o.shippedAt }} · 退回 {{ o.returnedAt }}<span v-if="refundOf(o)"> · 已返还 {{ refundOf(o) }} 积分</span></em>
          </div>
        </div>

        <!-- 已收货：完成态 -->
        <div v-else class="done-box">
          <div class="ab-info">
            <b>✅ 已收货，订单完成</b>
            <span>🚚 {{ o.carrier }} · {{ o.trackingNo }} · 📍 {{ o.region }} {{ o.address }}</span>
            <em>发货 {{ o.shippedAt }} · 收货 {{ o.receivedAt }}</em>
          </div>
        </div>

        <!-- 物流轨迹时间线（发货后可见） -->
        <div v-if="o.traces && o.traces.length" class="trace-box">
          <div class="trace-title">🚚 物流轨迹
            <button v-if="o.status === 'shipped'" class="trace-sync" @click="syncTrace(o)">同步最新</button>
          </div>
          <div class="trace-line">
            <div v-for="(t, i) in [...o.traces].reverse()" :key="i" class="trace-node" :class="{ head: i === 0 }">
              <i class="tn-dot"></i>
              <span class="tn-text">{{ t.text }}</span>
              <span class="tn-time">{{ t.date }} {{ t.time }}</span>
            </div>
          </div>
        </div>

        <!-- 售后入口（按状态可申请的类型） -->
        <div v-if="afterSaleTypesOf(o).length" class="as-entry">
          <span class="as-tip">售后：</span>
          <button v-for="t in afterSaleTypesOf(o)" :key="t"
                  class="as-btn" :class="t"
                  @click="toggleApply(o, t)">
            {{ typeMeta(t).icon }} 申请{{ typeMeta(t).label }}
          </button>
        </div>
        <!-- 售后申请表单 -->
        <div v-if="applyForm[o.id] && applyForm[o.id].type" class="as-form">
          <div class="asf-title">{{ typeMeta(applyForm[o.id].type).icon }} 申请{{ typeMeta(applyForm[o.id].type).label }}
            <span v-if="applyForm[o.id].type !== 'reship' && refundEstimate(o)" class="asf-refund">审核通过将返还 {{ refundEstimate(o) }} 积分</span>
            <span v-else-if="applyForm[o.id].type === 'reship'" class="asf-refund">审核通过将生成补发发货单（不退款）</span>
          </div>
          <div class="af-row">
            <input v-model="applyForm[o.id].reason" placeholder="请填写售后原因（必填），如：包裹破损 / 未收到货 / 商品不符" />
          </div>
          <div class="af-actions">
            <button class="btn-ghost" @click="toggleApply(o, applyForm[o.id].type)">取消</button>
            <button class="btn-primary" @click="submitAfterSale(o)">📮 提交售后申请</button>
          </div>
        </div>

        <!-- 该发货单的售后单 -->
        <div v-for="as in afterSalesOfShipment(o.id)" :key="as.id" class="as-record" :class="as.status">
          <span class="asr-icon">{{ typeMeta(as.type).icon }}</span>
          <div class="asr-main">
            <div class="asr-title">
              {{ as.typeLabel }}
              <span class="asr-status" :class="as.status">{{ afterSaleStatusMeta(as.status).label }}</span>
            </div>
            <div class="asr-sub">原因：{{ as.reason }} · {{ as.createdAt }} {{ as.time }}</div>
            <div v-if="as.status !== 'pending' && as.status !== 'waiting_stock'" class="asr-sub">
              {{ as.reviewedAt }} 由 {{ as.reviewer }} 处理
              <span v-if="as.reviewNote">；备注：{{ as.reviewNote }}</span>
              <span v-if="as.status === 'done' && as.refundPoints">；已返还 {{ as.refundPoints }} 积分</span>
              <span v-if="as.status === 'done' && as.reshipmentId">；补发单 {{ as.reshipmentId }}</span>
            </div>
            <div v-else-if="as.status === 'waiting_stock'" class="asr-sub shortage-text">
              ⚠️ 审核通过但库存不足，已挂起「待补货」，采购入库后将继续补发
            </div>
            <div v-else class="asr-sub">等待运营审核…</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 运营视角：接单发货队列 -->
    <div v-else class="card">
      <div class="card-title">
        📦 实物发货接单
        <div class="filters">
          <button v-for="f in opFilters" :key="f.key"
                  :class="{ active: opFilter === f.key }" @click="opFilter = f.key">
            {{ f.label }}
            <em v-if="f.key !== 'all' && opCountOf(f.key)">({{ opCountOf(f.key) }})</em>
          </button>
        </div>
      </div>

      <p class="op-hint">用户提交收货信息后进入「待发货」队列；运营填写快递公司与单号即视为接单发货，物流轨迹同步对用户可见。</p>

      <div v-if="visibleOpOrders.length === 0" class="empty">暂无相关发货单</div>

      <div v-for="o in visibleOpOrders" :key="o.id" class="ship-order" :class="o.status">
        <div class="o-head">
          <span class="o-icon">{{ o.icon }}</span>
          <div class="o-main">
            <div class="o-title">
              {{ o.targetName }}
              <span class="o-src">{{ o.bizType === 'draw' ? '抽奖中奖' : '积分兑换' }} · {{ o.source }} · 用户 {{ o.userName }}</span>
              <span v-if="o.originId" class="o-src">补发自 {{ o.originId }}</span>
            </div>
            <div class="o-sub">发货单 {{ o.id }} · {{ o.date }} {{ o.time }}</div>
          </div>
          <span class="o-status" :class="o.status">{{ statusMeta(o.status).label }}</span>
        </div>

        <!-- 待填地址：运营不可操作 -->
        <div v-if="o.status === 'pending_address'" class="op-wait">
          ⏳ 等待用户填写收货信息，暂不能发货
        </div>

        <!-- 待发货：收件信息 + 录快递单 -->
        <div v-else-if="o.status === 'to_ship'" class="op-ship">
          <div class="receiver-info">
            <b>📍 {{ o.receiver }} {{ o.phone }}</b>
            <span>{{ o.region }} {{ o.address }}</span>
            <em>用户提交于 {{ o.addressAt }}<span v-if="o.source === '售后补发'"> · 售后补发单，请优先处理</span></em>
          </div>
          <div class="ship-form">
            <div class="sf-row">
              <select v-model="ensureShipForm(o).carrier">
                <option value="">选择快递公司</option>
                <option v-for="c in carriers" :key="c" :value="c">{{ c }}</option>
              </select>
              <input v-model="ensureShipForm(o).trackingNo" placeholder="快递单号" />
            </div>
            <div class="sf-row">
              <input v-model="ensureShipForm(o).note" placeholder="发货备注（可选，如：请当面验货）" />
              <button class="btn-primary" @click="doShip(o)">📦 接单发货</button>
            </div>
          </div>
        </div>

        <!-- 已发货 -->
        <div v-else-if="o.status === 'shipped'" class="ship-box op">
          <div class="ab-info">
            <b>🚚 {{ o.carrier }} · {{ o.trackingNo }}</b>
            <span>📍 {{ o.receiver }} {{ o.phone }} · {{ o.region }} {{ o.address }}</span>
            <em>{{ o.shipper }} 于 {{ o.shippedAt }} 发货，等待用户确认收货<span v-if="o.shipNote">；{{ o.shipNote }}</span></em>
          </div>
          <button class="btn-ghost" @click="syncTrace(o)">🔄 同步物流</button>
        </div>

        <!-- 已退回 -->
        <div v-else-if="o.status === 'returned'" class="return-box">
          <div class="ab-info">
            <b>🚫 售后已退回</b>
            <span>🚚 {{ o.carrier }} · {{ o.trackingNo }}</span>
            <em>发货 {{ o.shippedAt }} · 退回 {{ o.returnedAt }}（售后单 {{ o.afterSaleId }}）</em>
          </div>
        </div>

        <!-- 已收货 -->
        <div v-else class="done-box">
          <div class="ab-info">
            <b>✅ 用户已确认收货</b>
            <span>🚚 {{ o.carrier }} · {{ o.trackingNo }}</span>
            <em>发货 {{ o.shippedAt }} · 收货 {{ o.receivedAt }}</em>
          </div>
        </div>

        <!-- 物流轨迹（运营只读 + 同步） -->
        <div v-if="o.traces && o.traces.length" class="trace-box">
          <div class="trace-title">🚚 物流轨迹
            <button v-if="o.status === 'shipped'" class="trace-sync" @click="syncTrace(o)">同步最新</button>
          </div>
          <div class="trace-line">
            <div v-for="(t, i) in [...o.traces].reverse()" :key="i" class="trace-node" :class="{ head: i === 0 }">
              <i class="tn-dot"></i>
              <span class="tn-text">{{ t.text }}</span>
              <span class="tn-time">{{ t.date }} {{ t.time }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 运营视角：售后审核 -->
    <div v-if="store.isOperator" class="card">
      <div class="card-title">
        🛠️ 售后审核（拒收 / 退货 / 补发）
        <div class="filters">
          <button v-for="f in asFilters" :key="f.key"
                  :class="{ active: asFilter === f.key }" @click="asFilter = f.key">
            {{ f.label }}
            <em v-if="f.key !== 'all' && asCountOf(f.key)">({{ asCountOf(f.key) }})</em>
          </button>
        </div>
      </div>
      <p class="op-hint">审核通过即回写：拒收/退货 → 库存回补 + 积分返还 + 发货单退回；补发 → 库存扣减并生成补发发货单。补发缺货时不驳回、整单挂起「待补货」，采购验收入库后可从待处理售后继续履约。驳回不动账，全部操作留痕。</p>

      <div v-if="visibleAfterSales.length === 0" class="empty">暂无相关售后单</div>

      <div v-for="a in visibleAfterSales" :key="a.id" class="as-order" :class="[a.type, a.status]">
        <div class="o-head">
          <span class="o-icon">{{ a.icon }}</span>
          <div class="o-main">
            <div class="o-title">
              {{ typeMeta(a.type).icon }} {{ a.typeLabel }} · {{ a.targetName }}
              <span class="o-src">用户 {{ a.userName }} · 发货单 {{ a.shipmentId }}</span>
            </div>
            <div class="o-sub">售后单 {{ a.id }} · {{ a.createdAt }} {{ a.time }}</div>
          </div>
          <span class="o-status" :class="a.status">{{ afterSaleStatusMeta(a.status).label }}</span>
        </div>
        <div class="as-detail">
          <span class="asd-item">原因：{{ a.reason }}</span>
          <span v-if="a.refundPoints" class="asd-item refund">🪙 通过将返还 {{ a.refundPoints }} 积分</span>
          <span v-if="a.type === 'reship' && a.status !== 'waiting_stock'" class="asd-item">📦 通过将扣减库存并生成补发发货单</span>
          <span v-else-if="a.type !== 'reship'" class="asd-item">📥 通过将回补库存 1 件</span>
        </div>
        <!-- 缺货待补货：采购入库后继续履约 -->
        <div v-if="a.status === 'waiting_stock'" class="as-waiting">
          <span class="aw-text">⚠️ {{ a.shortageNote || '库存不足，已挂起待采购补货' }}（{{ a.reviewedAt }} 由 {{ a.reviewer }} 审核）</span>
          <button class="btn-ghost sm" @click="goPurchase(a)">🛒 发起补货采购</button>
          <button class="btn-approve sm" @click="review(a, true)">📦 库存已足，继续补发履约</button>
        </div>
        <!-- 待审核：操作区 -->
        <div v-else-if="a.status === 'pending'" class="as-review">
          <input v-model="reviewNoteOf(a).note" placeholder="审核备注（可选）" />
          <button class="btn-approve" @click="review(a, true)">✅ 同意{{ a.typeLabel }}</button>
          <button class="btn-reject" @click="review(a, false)">🚫 驳回</button>
        </div>
        <!-- 已处理：结论 -->
        <div v-else class="as-done">
          {{ a.reviewedAt }} 由 {{ a.reviewer }} 处理
          <span v-if="a.reviewNote">；备注：{{ a.reviewNote }}</span>
          <template v-if="a.status === 'done'">
            <span v-if="a.refundPoints">；已返还 {{ a.refundPoints }} 积分</span>
            <span v-if="a.reshipmentId">；补发单 {{ a.reshipmentId }}</span>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'
import { usePlatformStore, SHIP_STATUS, AFTERSALE_TYPES, AFTERSALE_STATUS } from '@/store/platform'

const store = usePlatformStore()

const stats = computed(() => store.shipmentStats)
const statusMeta = (s) => SHIP_STATUS[s] || { label: s, tone: '' }
const typeMeta = (t) => AFTERSALE_TYPES[t] || { label: t, icon: '📋' }
const afterSaleStatusMeta = (s) => AFTERSALE_STATUS[s] || { label: s }
const maskPhone = (p) => p.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2')

const carriers = ['顺丰速运', '京东物流', '中通快递', '圆通速递', '韵达快递', 'EMS']

// —— 用户视角 ——
const userFilters = [
  { key: 'all', label: '全部' },
  { key: 'todo', label: '待办' },
  { key: 'pending_address', label: '待填地址' },
  { key: 'to_ship', label: '待发货' },
  { key: 'shipped', label: '待收货' },
  { key: 'received', label: '已完成' },
  { key: 'returned', label: '已退回' }
]
const userFilter = ref('todo')
const myOrders = computed(() => store.myShipments)
const matchFilter = (o, key) => {
  if (key === 'all') return true
  if (key === 'todo') return o.status === 'pending_address' || o.status === 'shipped'
  return o.status === key
}
const visibleUserOrders = computed(() =>
  myOrders.value.filter((o) => matchFilter(o, userFilter.value)))
const userCountOf = (key) => myOrders.value.filter((o) => matchFilter(o, key)).length
const addrTodos = computed(() => myOrders.value.filter((o) => o.status === 'pending_address'))
const receiveTodos = computed(() => myOrders.value.filter((o) => o.status === 'shipped'))

const addrForms = reactive({})
const addrForm = (o) => {
  if (!addrForms[o.id]) {
    addrForms[o.id] = { receiver: o.receiver || '', phone: (o.phone || '').replace(/\*+/g, '') || '', region: o.region || '', address: o.address || '' }
  }
  return addrForms[o.id]
}
// 当前展开内联编辑的订单（仅 to_ship 阶段用户主动修改时使用）
const editingId = ref('')
function submitAddr(o) {
  if (store.submitShipAddress(o.id, addrForm(o))) {
    editingId.value = ''
    userFilter.value = 'to_ship'
  }
}
function editAddress(o) {
  addrForm(o)
  editingId.value = o.id
}
function cancelEdit(o) {
  addrForms[o.id] = { receiver: o.receiver || '', phone: (o.phone || '').replace(/\*+/g, '') || '', region: o.region || '', address: o.address || '' }
  editingId.value = ''
}
function confirmReceive(o) {
  store.receiveShipment(o.id)
}
function syncTrace(o) {
  store.syncShipmentTrace(o.id)
}

// —— 售后申请（用户） ——
const applyForm = reactive({})
// 该发货单当前可申请的售后类型（与 store 状态机口径一致；已有待处理单时隐藏入口）
const afterSaleTypesOf = (o) => {
  if (store.afterSalesOfShipment(o.id).some((a) => a.status === 'pending' || a.status === 'waiting_stock')) return []
  if (o.status === 'shipped') return ['reject', 'reship']
  if (o.status === 'received') return ['return', 'reship']
  return []
}
// 该发货单的售后单（当前租户内）
const afterSalesOfShipment = (shipmentId) =>
  store.afterSales.filter((a) =>
    a.shipmentId === shipmentId && (a.tenantId || 't-star') === store.activeTenantId)
const refundEstimate = (o) => {
  const rec = store.records.find((r) => r.id === o.recordId)
  return rec ? store._refundOfRecord(rec) : 0
}
const refundOf = (o) => {
  const as = store.afterSalesOfShipment(o.id).find((a) => a.status === 'done' && a.refundPoints)
  return as ? as.refundPoints : 0
}
function toggleApply(o, type) {
  if (!applyForm[o.id]) applyForm[o.id] = { type: '', reason: '' }
  applyForm[o.id].type = applyForm[o.id].type === type ? '' : type
  applyForm[o.id].reason = ''
}
function submitAfterSale(o) {
  const f = applyForm[o.id]
  if (!f || !f.type) return
  if (store.applyAfterSale(o.id, f.type, f.reason)) {
    applyForm[o.id] = { type: '', reason: '' }
  }
}

// —— 运营视角 ——
const opFilters = [
  { key: 'all', label: '全部' },
  { key: 'to_ship', label: '待发货' },
  { key: 'pending_address', label: '待用户填地址' },
  { key: 'shipped', label: '已发货' },
  { key: 'received', label: '已收货' },
  { key: 'returned', label: '已退回' }
]
const opFilter = ref('to_ship')
const opOrders = computed(() => [...store.scopedShipments].sort((a, b) => b.ts - a.ts))
const visibleOpOrders = computed(() =>
  opFilter.value === 'all' ? opOrders.value : opOrders.value.filter((o) => o.status === opFilter.value))
const opCountOf = (key) => opOrders.value.filter((o) => o.status === key).length

const shipForms = reactive({})
const ensureShipForm = (o) => {
  if (!shipForms[o.id]) shipForms[o.id] = { carrier: '', trackingNo: '', note: '' }
  return shipForms[o.id]
}
function doShip(o) {
  const form = ensureShipForm(o)
  if (store.shipShipment(o.id, form)) {
    shipForms[o.id] = { carrier: '', trackingNo: '', note: '' }
  }
}

// —— 售后审核（运营） ——
const asFilters = [
  { key: 'pending', label: '待审核' },
  { key: 'waiting_stock', label: '待补货' },
  { key: 'done', label: '已完成' },
  { key: 'dismissed', label: '已驳回' },
  { key: 'all', label: '全部' }
]
const asFilter = ref('pending')
const allAfterSales = computed(() => [...store.scopedAfterSales].sort((a, b) => b.ts - a.ts))
const visibleAfterSales = computed(() =>
  asFilter.value === 'all' ? allAfterSales.value : allAfterSales.value.filter((a) => a.status === asFilter.value))
const asCountOf = (key) =>
  key === 'all' ? allAfterSales.value.length : allAfterSales.value.filter((a) => a.status === key).length

const reviewNotes = reactive({})
const reviewNoteOf = (a) => {
  if (!reviewNotes[a.id]) reviewNotes[a.id] = { note: '' }
  return reviewNotes[a.id]
}
function review(a, approve) {
  if (store.reviewAfterSale(a.id, approve, reviewNoteOf(a).note)) {
    reviewNotes[a.id].note = ''
  }
}
// 缺货待补货：跳转采购入库页（采购单可在该页从待处理售后单一键发起）
function goPurchase(a) {
  store.gotoTab('purchase')
}
</script>

<style scoped>
.ship-view { display: flex; flex-direction: column; gap: 16px; max-width: 1000px; margin: 0 auto; }

.ship-hero {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  background: linear-gradient(135deg, #123a4a, #162b55);
  border: 1px solid rgba(77,182,172,0.3); border-radius: 14px; padding: 18px 22px; flex-wrap: wrap;
}
.hero-stats { display: flex; gap: 28px; flex-wrap: wrap; }
.hs-item { display: flex; flex-direction: column; }
.hs-num { font-size: 26px; font-weight: 800; line-height: 1; }
.hs-num.warn { color: #ffb74d; }
.hs-num.info { color: #82b1ff; }
.hs-num.ok { color: #7ef0c9; }
.hs-num.muted { color: #b0bec5; }
.hs-num.bad { color: #ef9a9a; }
.hs-num.aftersale { color: #ffcc80; }
.hs-num.shortage { color: #ef9a9a; }
.hs-lab { font-size: 11px; color: #9db0d0; margin-top: 5px; }

.role-box { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.role-tip { font-size: 11px; color: #9db0d0; }
.role-switch { display: flex; background: rgba(0,0,0,0.25); border-radius: 10px; padding: 3px; }
.role-switch button {
  background: transparent; border: none; color: #aebadd; font-size: 12px;
  padding: 7px 14px; border-radius: 8px; cursor: pointer;
}
.role-switch button.active {
  background: linear-gradient(135deg,#00897b,#2962ff); color: #fff;
  box-shadow: 0 3px 8px rgba(0,137,123,0.4);
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
.filters button.active { background: #00897b; color: #fff; border-color: transparent; }
.filters em { font-style: normal; opacity: 0.8; }

.todo-entry {
  background: rgba(255,152,0,0.1); border: 1px solid rgba(255,152,0,0.35);
  border-radius: 10px; padding: 10px 14px; font-size: 12px; color: #ffcc80; margin-bottom: 12px;
}
.todo-entry b { color: #ffb74d; }

.empty { color: #5b6f94; text-align: center; padding: 24px; font-size: 12px; }

.ship-order {
  background: rgba(20,34,66,0.5); border: 1px solid rgba(120,160,220,0.14);
  border-left-width: 3px; border-radius: 10px; padding: 13px 14px; margin-bottom: 10px;
}
.ship-order.pending_address { border-left-color: #ff9800; }
.ship-order.to_ship { border-left-color: #42a5f5; }
.ship-order.shipped { border-left-color: #4caf50; }
.ship-order.received { border-left-color: #78909c; }
.ship-order.returned { border-left-color: #e57373; }

.o-head { display: flex; align-items: center; gap: 10px; }
.o-icon { font-size: 24px; }
.o-main { flex: 1; min-width: 0; }
.o-title { font-size: 13px; color: #eef3fc; font-weight: 700; display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.o-src { font-size: 10px; color: #8ba2c8; font-weight: 400; }
.o-sub { font-size: 10px; color: #6f84ab; margin-top: 2px; }
.o-status { font-size: 11px; padding: 3px 10px; border-radius: 6px; font-weight: 600; flex-shrink: 0; }
.o-status.pending_address { background: rgba(255,152,0,0.18); color: #ffb74d; }
.o-status.to_ship { background: rgba(66,165,245,0.18); color: #82b1ff; }
.o-status.shipped { background: rgba(76,175,80,0.18); color: #7ef0c9; }
.o-status.received { background: rgba(144,164,174,0.18); color: #b0bec5; }
.o-status.returned { background: rgba(229,115,115,0.18); color: #ef9a9a; }
.o-status.pending { background: rgba(255,152,0,0.18); color: #ffb74d; }
.o-status.waiting_stock { background: rgba(229,115,115,0.2); color: #ef9a9a; }
.o-status.done { background: rgba(76,175,80,0.18); color: #7ef0c9; }
.o-status.dismissed { background: rgba(144,164,174,0.18); color: #b0bec5; }

/* 地址表单 */
.addr-form {
  margin-top: 11px; display: flex; flex-direction: column; gap: 8px;
  background: rgba(255,152,0,0.05); border: 1px dashed rgba(255,152,0,0.3);
  border-radius: 9px; padding: 11px;
}
.af-row { display: flex; gap: 8px; }
.addr-form input, .as-form input, .as-review input {
  flex: 1; background: #0c1730; border: 1px solid rgba(120,160,220,0.2); color: #dbe4f3;
  border-radius: 8px; padding: 8px 11px; font-size: 12px;
}
.af-actions { display: flex; justify-content: flex-end; gap: 8px; }
.btn-primary {
  align-self: flex-end;
  background: linear-gradient(135deg,#66bb6a,#43a047); color: #fff; border: none;
  border-radius: 8px; padding: 8px 18px; font-size: 12px; font-weight: 600; cursor: pointer;
}
.btn-primary:hover { filter: brightness(1.08); }
.btn-ghost {
  background: transparent; border: 1px solid rgba(120,160,220,0.35); color: #aebadd;
  border-radius: 8px; padding: 7px 14px; font-size: 12px; cursor: pointer; white-space: nowrap;
}
.btn-col { display: flex; flex-direction: column; gap: 6px; }

.addr-box, .ship-box, .done-box, .return-box {
  margin-top: 11px; display: flex; align-items: center; justify-content: space-between; gap: 12px;
  border-radius: 9px; padding: 10px 12px;
}
.addr-box { background: rgba(66,165,245,0.08); border: 1px solid rgba(66,165,245,0.25); }
.ship-box { background: rgba(76,175,80,0.08); border: 1px solid rgba(76,175,80,0.25); }
.done-box { background: rgba(144,164,174,0.08); border: 1px solid rgba(144,164,174,0.22); }
.return-box { background: rgba(229,115,115,0.08); border: 1px solid rgba(229,115,115,0.28); }
.ab-info { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: #dbe4f3; }
.ab-info b { color: #eef3fc; }
.ab-info span { color: #aebadd; }
.ab-info em { font-style: normal; font-size: 10px; color: #7e97c2; }

/* 物流轨迹 */
.trace-box {
  margin-top: 10px; background: rgba(66,165,245,0.05);
  border: 1px dashed rgba(66,165,245,0.25); border-radius: 9px; padding: 10px 12px;
}
.trace-title { font-size: 11px; font-weight: 700; color: #82b1ff; margin-bottom: 8px; display: flex; align-items: center; gap: 10px; }
.trace-sync {
  background: transparent; border: 1px solid rgba(66,165,245,0.4); color: #82b1ff;
  font-size: 10px; padding: 2px 9px; border-radius: 6px; cursor: pointer;
}
.trace-line { display: flex; flex-direction: column; }
.trace-node {
  display: flex; align-items: baseline; gap: 8px; font-size: 11px; color: #aebadd;
  padding: 3px 0 3px 2px; position: relative;
}
.trace-node .tn-dot {
  width: 7px; height: 7px; border-radius: 50%; background: #40547e; flex-shrink: 0;
  transform: translateY(-1px);
}
.trace-node.head .tn-dot { background: #4caf50; box-shadow: 0 0 6px rgba(76,175,80,0.7); }
.trace-node.head .tn-text { color: #eef3fc; font-weight: 600; }
.trace-node:not(:last-child) .tn-dot::after {
  content: ''; position: absolute; left: 5px; top: 14px; bottom: -6px;
  width: 1px; background: rgba(120,160,220,0.25);
}
.tn-text { flex: 1; }
.tn-time { font-size: 10px; color: #6f84ab; white-space: nowrap; }

/* 售后 */
.as-entry { margin-top: 10px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.as-tip { font-size: 11px; color: #6f84ab; }
.as-btn {
  background: #13233f; border: 1px solid rgba(120,160,220,0.25); color: #aebadd;
  font-size: 11px; padding: 5px 12px; border-radius: 7px; cursor: pointer;
}
.as-btn:hover { color: #fff; border-color: rgba(120,160,220,0.5); }
.as-btn.reject:hover { border-color: #e57373; color: #ef9a9a; }
.as-btn.return:hover { border-color: #ffb74d; color: #ffcc80; }
.as-btn.reship:hover { border-color: #82b1ff; color: #82b1ff; }
.as-form {
  margin-top: 10px; display: flex; flex-direction: column; gap: 8px;
  background: rgba(255,152,0,0.05); border: 1px dashed rgba(255,152,0,0.3);
  border-radius: 9px; padding: 11px;
}
.asf-title { font-size: 12px; font-weight: 700; color: #ffcc80; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.asf-refund { font-size: 10px; color: #7e97c2; font-weight: 400; }
.as-record {
  margin-top: 10px; display: flex; gap: 10px; align-items: flex-start;
  background: rgba(120,160,220,0.06); border: 1px solid rgba(120,160,220,0.14);
  border-radius: 9px; padding: 9px 12px;
}
.as-record.pending { border-color: rgba(255,152,0,0.35); }
.as-record.done { border-color: rgba(76,175,80,0.3); }
.asr-icon { font-size: 16px; }
.asr-main { flex: 1; min-width: 0; }
.asr-title { font-size: 12px; color: #eef3fc; font-weight: 600; display: flex; align-items: center; gap: 8px; }
.asr-status { font-size: 10px; padding: 1px 8px; border-radius: 5px; }
.asr-status.pending { background: rgba(255,152,0,0.18); color: #ffb74d; }
.asr-status.waiting_stock { background: rgba(229,115,115,0.2); color: #ef9a9a; }
.asr-status.done { background: rgba(76,175,80,0.18); color: #7ef0c9; }
.asr-status.dismissed { background: rgba(144,164,174,0.18); color: #b0bec5; }
.asr-sub { font-size: 10px; color: #7e97c2; margin-top: 2px; }
.asr-sub.shortage-text { color: #ef9a9a; }

.op-hint { font-size: 11px; color: #6f84ab; margin: 0 0 12px; }
.op-wait {
  margin-top: 10px; font-size: 12px; color: #b0bcd4;
  background: rgba(120,160,220,0.07); border-radius: 8px; padding: 9px 12px;
}
.op-ship {
  margin-top: 11px; display: flex; flex-direction: column; gap: 10px;
  background: rgba(66,165,245,0.06); border: 1px solid rgba(66,165,245,0.22);
  border-radius: 9px; padding: 11px;
}
.receiver-info { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: #dbe4f3; }
.receiver-info b { color: #eef3fc; }
.receiver-info span { color: #aebadd; }
.receiver-info em { font-style: normal; font-size: 10px; color: #7e97c2; }
.ship-form { display: flex; flex-direction: column; gap: 8px; }
.sf-row { display: flex; gap: 8px; }
.ship-form select, .ship-form input {
  flex: 1; background: #0c1730; border: 1px solid rgba(120,160,220,0.2); color: #dbe4f3;
  border-radius: 8px; padding: 8px 11px; font-size: 12px; font-family: inherit;
}
.ship-form .btn-primary { flex: 0 0 auto; }
.ship-box.op { margin-top: 11px; }

/* 售后审核（运营） */
.as-order {
  background: rgba(20,34,66,0.5); border: 1px solid rgba(120,160,220,0.14);
  border-left-width: 3px; border-radius: 10px; padding: 13px 14px; margin-bottom: 10px;
}
.as-order.reject { border-left-color: #e57373; }
.as-order.return { border-left-color: #ffb74d; }
.as-order.reship { border-left-color: #82b1ff; }
.as-detail { margin-top: 9px; display: flex; gap: 14px; flex-wrap: wrap; font-size: 11px; color: #aebadd; }
.asd-item.refund { color: #ffd54f; }
.as-review { margin-top: 10px; display: flex; gap: 8px; }
.as-waiting {
  margin-top: 10px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  background: rgba(229,115,115,0.08); border: 1px solid rgba(229,115,115,0.3);
  border-radius: 8px; padding: 9px 12px;
}
.aw-text { font-size: 11px; color: #ef9a9a; flex: 1; min-width: 200px; }
.btn-ghost.sm, .btn-approve.sm { padding: 6px 12px; font-size: 11px; }
.btn-approve {
  background: linear-gradient(135deg,#66bb6a,#43a047); color: #fff; border: none;
  border-radius: 8px; padding: 8px 16px; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap;
}
.btn-reject {
  background: transparent; border: 1px solid rgba(229,115,115,0.5); color: #ef9a9a;
  border-radius: 8px; padding: 8px 16px; font-size: 12px; cursor: pointer; white-space: nowrap;
}
.btn-reject:hover { background: rgba(229,115,115,0.12); }
.as-done {
  margin-top: 10px; font-size: 11px; color: #7e97c2;
  background: rgba(120,160,220,0.06); border-radius: 8px; padding: 8px 12px;
}
</style>
