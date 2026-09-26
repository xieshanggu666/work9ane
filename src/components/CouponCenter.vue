<template>
  <div class="coupon-view">
    <!-- 顶部概览 + 角色切换 -->
    <div class="cp-hero">
      <div class="hero-stats">
        <div class="hs-item">
          <span class="hs-num ok">{{ stats.available }}</span>
          <span class="hs-lab">待核销</span>
        </div>
        <div class="hs-item">
          <span class="hs-num muted">{{ stats.redeemed }}</span>
          <span class="hs-lab">已核销</span>
        </div>
        <div class="hs-item">
          <span class="hs-num bad">{{ stats.expired }}</span>
          <span class="hs-lab">已过期</span>
        </div>
        <div class="hs-item">
          <span class="hs-num ice">{{ stats.held }}</span>
          <span class="hs-lab">风控预占待交付</span>
        </div>
        <div class="hs-item">
          <span class="hs-num">{{ stats.issued }}</span>
          <span class="hs-lab">累计发券</span>
        </div>
      </div>
      <div class="role-box">
        <span class="role-tip">当前视角</span>
        <div class="role-switch">
          <button :class="{ active: store.role === 'user' }" @click="store.setRole('user')">👤 用户（出示券码）</button>
          <button :class="{ active: store.role === 'operator' }" @click="store.setRole('operator')">🎟️ 运营（扫码核销）</button>
        </div>
      </div>
    </div>

    <!-- 用户视角：我的卡券账户 -->
    <div v-if="!store.isOperator">
      <!-- 风控预占待交付提示 -->
      <div v-if="heldCoupons.length" class="held-entry">
        <div class="he-tip">
          🧊 你有 <b>{{ heldCoupons.length }}</b> 张券因风控审核被预占（库存已锁定、券码尚未发放）：
          <span v-for="(r, i) in heldCoupons" :key="r.id" class="he-name">{{ i ? '、' : '' }}{{ r.prizeName || r.goodsName }}</span>
        </div>
        <button class="he-btn" @click="store.gotoTab('risk')">去申诉 / 查看进度 ›</button>
      </div>

      <div class="card">
        <div class="card-title">
          🎟️ 我的卡券
          <div class="filters">
            <button v-for="f in userFilters" :key="f.key"
                    :class="{ active: userFilter === f.key }" @click="userFilter = f.key">
              {{ f.label }}
              <em v-if="f.key !== 'all' && userCountOf(f.key)">({{ userCountOf(f.key) }})</em>
            </button>
          </div>
        </div>

        <div v-if="visibleCoupons.length === 0" class="empty">
          暂无卡券——中奖或兑换券类奖品/商品后，券码会自动发放到这里，到店出示即可核销
        </div>

        <div v-for="c in visibleCoupons" :key="c.id" class="coupon" :class="c.status">
          <div class="cp-left">
            <span class="cp-emoji">{{ c.emoji }}</span>
            <div class="cp-value">
              <template v-if="c.type === 'discount'">
                <b>¥{{ c.denomination }}</b><i>满{{ c.threshold }}可用</i>
              </template>
              <template v-else-if="c.type === 'cash'">
                <b>¥{{ c.denomination }}</b><i>代金券</i>
              </template>
              <template v-else>
                <b class="voucher">{{ c.face || '兑换券' }}</b>
              </template>
            </div>
          </div>
          <div class="cp-main">
            <div class="cp-name">
              {{ c.name }}
              <span class="cp-type">{{ c.typeLabel }}</span>
              <span v-if="c.comp" class="cp-comp">对账补券</span>
            </div>
            <div class="cp-desc">{{ c.desc }}</div>
            <div class="cp-meta">
              {{ c.bizType === 'draw' ? '抽奖中奖' : '积分兑换' }} · {{ c.source }} · 发券 {{ c.issueDate }}
            </div>

            <!-- 待核销：券码出示区 -->
            <div v-if="c.status === 'available'" class="code-box">
              <div class="code-main">
                <span class="code-lab">券码（到店出示 / 交店员输入）</span>
                <span class="code-num">{{ c.code }}</span>
              </div>
              <button class="copy-btn" @click="copyCode(c.code)">📋 复制</button>
            </div>
            <div v-if="c.status === 'available'" class="cp-expire" :class="{ soon: isExpiringSoon(c) }">
              ⏰ 有效期至 {{ c.expireDate }} 23:59<span v-if="isExpiringSoon(c)"> · 今日到期，请尽快使用</span>
            </div>

            <!-- 已核销 -->
            <div v-else-if="c.status === 'redeemed'" class="done-info redeem">
              ✅ 已于 {{ c.redeemedAt }} 由 {{ c.redeemOperator }} 核销（{{ c.redeemChannel }}）
              <span v-if="c.redeemNote" class="di-note">备注：{{ c.redeemNote }}</span>
            </div>

            <!-- 已过期 -->
            <div v-else class="done-info expired">
              ⏰ 已于 {{ c.expireDate }} 到期失效，无法再核销
            </div>
          </div>
          <span class="cp-status" :class="c.status">{{ statusMeta(c.status).label }}</span>
        </div>
      </div>
    </div>

    <!-- 运营视角：核销工作台（需 coupon:redeem 权限，否则只读浏览本租户卡券） -->
    <div v-else>
      <div v-if="!store.can('coupon:redeem')" class="perm-note">
        🔒 当前角色「{{ store.roleLabelOf(store.currentMember?.roleKey) }}」无「卡券核销」权限，核销工作台不可用，以下为本租户卡券只读视图。
      </div>
      <div class="card scan-card" v-if="store.can('coupon:redeem')">
        <div class="card-title">
          📷 扫码 / 输码核销
          <span class="title-sub">{{ store.activeTenant.shortName }} · 用户出示券码，运营校验状态与有效期后一键核销（跨租户券码拒绝核销）</span>
        </div>
        <div class="scan-row">
          <input
            v-model="codeInput"
            placeholder="请输入或扫描用户券码，如 CP-A1B2C-3D4E5（自动忽略空格/连字符/大小写）"
            @keyup.enter="doRedeem"
          />
          <button class="btn-redeem" @click="doRedeem">✅ 核销</button>
        </div>
        <p class="scan-hint">
          已核销券再次核销会被拦截（显示原核销人与时间）；已过期券无法核销；每张券券码全局唯一、状态机保证幂等。
        </p>
      </div>

      <div class="card">
        <div class="card-title">
          🗂️ 全部卡券账户
          <div class="filters">
            <button v-for="f in opFilters" :key="f.key"
                    :class="{ active: opFilter === f.key }" @click="opFilter = f.key">
              {{ f.label }}
              <em v-if="f.key !== 'all' && opCountOf(f.key)">({{ opCountOf(f.key) }})</em>
            </button>
          </div>
        </div>

        <div v-if="visibleOpCoupons.length === 0" class="empty">暂无相关卡券</div>

        <div v-for="c in visibleOpCoupons" :key="c.id" class="coupon op" :class="c.status">
          <div class="cp-left">
            <span class="cp-emoji">{{ c.emoji }}</span>
            <div class="cp-value">
              <template v-if="c.type === 'discount'">
                <b>¥{{ c.denomination }}</b><i>满{{ c.threshold }}可用</i>
              </template>
              <template v-else-if="c.type === 'cash'">
                <b>¥{{ c.denomination }}</b><i>代金券</i>
              </template>
              <template v-else>
                <b class="voucher">{{ c.face || '兑换券' }}</b>
              </template>
            </div>
          </div>
          <div class="cp-main">
            <div class="cp-name">
              {{ c.name }}
              <span class="cp-type">{{ c.typeLabel }}</span>
              <span class="cp-user">👤 {{ c.userName }}</span>
              <span v-if="c.comp" class="cp-comp">对账补券</span>
            </div>
            <div class="cp-meta">
              券码 <b class="cp-code-inline">{{ c.code }}</b> · {{ c.bizType === 'draw' ? '抽奖中奖' : '积分兑换' }} · 发券 {{ c.issueDate }} · 有效期至 {{ c.expireDate }}
            </div>
            <div v-if="c.status === 'redeemed'" class="done-info redeem">
              ✅ {{ c.redeemedAt }} 由 {{ c.redeemOperator }} 核销（{{ c.redeemChannel }}）<span v-if="c.redeemNote"> · {{ c.redeemNote }}</span>
            </div>
            <div v-else-if="c.status === 'expired'" class="done-info expired">⏰ 已过期失效</div>
          </div>
          <div class="cp-op">
            <span class="cp-status" :class="c.status">{{ statusMeta(c.status).label }}</span>
            <button v-if="c.status === 'available'" class="btn-mini" @click="quickFill(c.code)">填入核销</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 卡券业务台账（append-only，双视角只读） -->
    <div class="card">
      <div class="card-title">📜 卡券业务台账（发放 / 预占 / 交付 / 核销 / 到期 / 补券）</div>
      <div v-if="visibleLogs.length === 0" class="empty">暂无卡券台账</div>
      <div v-for="l in visibleLogs" :key="l.id" class="log-row">
        <span class="l-tag" :class="l.action">{{ l.actionLabel }}</span>
        <span class="l-name">{{ l.tplName }}</span>
        <span v-if="l.code" class="l-code">{{ l.code }}</span>
        <span class="l-note">{{ l.note }}</span>
        <span class="l-who">{{ l.operator }}</span>
        <span class="l-time">{{ l.date }} {{ l.time }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { usePlatformStore, COUPON_STATUS } from '@/store/platform'

const store = usePlatformStore()
const stats = computed(() => store.couponStats)
const heldCoupons = computed(() => store.myHeldCoupons)
const statusMeta = (s) => COUPON_STATUS[s] || { label: s, tone: '' }

const isExpiringSoon = (c) => {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  return c.status === 'available' && c.expireTs <= d.getTime()
}

// —— 用户视角 ——
const userFilters = [
  { key: 'all', label: '全部' },
  { key: 'available', label: '待核销' },
  { key: 'redeemed', label: '已核销' },
  { key: 'expired', label: '已过期' }
]
const userFilter = ref('available')
const myCoupons = computed(() => store.myCoupons)
const visibleCoupons = computed(() =>
  userFilter.value === 'all' ? myCoupons.value : myCoupons.value.filter((c) => c.status === userFilter.value))
const userCountOf = (key) => myCoupons.value.filter((c) => c.status === key).length

function copyCode(code) {
  const done = () => store.showToast(`券码 ${code} 已复制`, 'success')
  if (navigator?.clipboard?.writeText) {
    navigator.clipboard.writeText(code).then(done).catch(() => fallbackCopy(code, done))
  } else {
    fallbackCopy(code, done)
  }
}
function fallbackCopy(text, done) {
  const ta = document.createElement('textarea')
  ta.value = text
  document.body.appendChild(ta)
  ta.select()
  try { document.execCommand('copy'); done() } catch (e) { store.showToast(`请手动复制券码：${text}`, 'info') }
  document.body.removeChild(ta)
}

// —— 运营视角 ——
const opFilters = [
  { key: 'all', label: '全部' },
  { key: 'available', label: '待核销' },
  { key: 'redeemed', label: '已核销' },
  { key: 'expired', label: '已过期' }
]
const opFilter = ref('available')
const allCoupons = computed(() => [...store.scopedCoupons].sort((a, b) => b.ts - a.ts))
const visibleOpCoupons = computed(() =>
  opFilter.value === 'all' ? allCoupons.value : allCoupons.value.filter((c) => c.status === opFilter.value))
const opCountOf = (key) => allCoupons.value.filter((c) => c.status === key).length

const codeInput = ref('')
function quickFill(code) {
  codeInput.value = code
}
function doRedeem() {
  const code = codeInput.value.trim()
  if (!code) { store.showToast('请输入券码', 'warn'); return }
  const r = store.redeemCoupon(code, { channel: '到店扫码', note: '' })
  if (r?.coupon && !r.duplicated && !r.expired) codeInput.value = ''
}

// —— 台账（运营看当前租户全量，用户只看本人券与本人预占记录） ——
const visibleLogs = computed(() => {
  if (store.isOperator) return store.scopedCouponLogs.slice(0, 60)
  const myCodes = new Set(store.myCoupons.map((c) => c.code))
  const myRecordIds = new Set(
    store.scopedRecords.filter((r) => (r.userId || store.user.id) === store.user.id).map((r) => r.id)
  )
  return store.scopedCouponLogs
    .filter((l) => myCodes.has(l.code) || (l.recordId && myRecordIds.has(l.recordId)))
    .slice(0, 60)
})
</script>

<style scoped>
.coupon-view { display: flex; flex-direction: column; gap: 16px; max-width: 1020px; margin: 0 auto; }
.perm-note {
  background: rgba(255,152,0,0.1); border: 1px solid rgba(255,152,0,0.35);
  color: #ffcc80; border-radius: 12px; padding: 11px 16px; font-size: 12px;
}

.cp-hero {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  background: linear-gradient(135deg, #3a2150, #162b55);
  border: 1px solid rgba(171,71,188,0.3); border-radius: 14px; padding: 18px 22px; flex-wrap: wrap;
}
.hero-stats { display: flex; gap: 26px; flex-wrap: wrap; }
.hs-item { display: flex; flex-direction: column; }
.hs-num { font-size: 26px; font-weight: 800; line-height: 1; }
.hs-num.ok { color: #ce93d8; }
.hs-num.muted { color: #b0bec5; }
.hs-num.bad { color: #ef9a9a; }
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
  background: linear-gradient(135deg,#8e24aa,#2962ff); color: #fff;
  box-shadow: 0 3px 8px rgba(142,36,170,0.4);
}

.card {
  background: #0f1b38; border: 1px solid rgba(120,160,220,0.16);
  border-radius: 14px; padding: 16px;
}
.card-title {
  font-size: 15px; font-weight: 700; color: #fff; margin-bottom: 14px;
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
}
.title-sub { font-size: 11px; font-weight: 400; color: #8ba2c8; }
.filters { display: flex; gap: 5px; margin-left: auto; flex-wrap: wrap; }
.filters button {
  background: #13233f; border: 1px solid rgba(120,160,220,0.18); color: #8ba2c8;
  font-size: 11px; padding: 5px 10px; border-radius: 7px; cursor: pointer;
}
.filters button.active { background: #8e24aa; color: #fff; border-color: transparent; }
.filters em { font-style: normal; opacity: 0.8; }

.empty { color: #5b6f94; text-align: center; padding: 24px; font-size: 12px; }

/* 风控预占提示 */
.held-entry {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  background: rgba(129,212,250,0.08); border: 1px solid rgba(129,212,250,0.3);
  border-radius: 12px; padding: 12px 16px; font-size: 12px; color: #b3e5fc; flex-wrap: wrap;
}
.held-entry b { color: #81d4fa; }
.he-name { color: #e1f5fe; }
.he-btn {
  background: rgba(41,98,255,0.25); border: 1px solid rgba(129,212,250,0.5); color: #e1f5fe;
  border-radius: 8px; padding: 6px 12px; font-size: 12px; cursor: pointer; white-space: nowrap;
}

/* 券卡片 */
.coupon {
  display: flex; align-items: stretch; gap: 14px;
  background: linear-gradient(135deg, rgba(142,36,170,0.12), rgba(20,34,66,0.55));
  border: 1px solid rgba(171,71,188,0.28); border-left-width: 3px;
  border-radius: 11px; padding: 13px 14px; margin-bottom: 10px;
}
.coupon.available { border-left-color: #ab47bc; }
.coupon.redeemed { border-left-color: #78909c; opacity: 0.85; }
.coupon.expired { border-left-color: #546e7a; background: rgba(20,30,50,0.5); opacity: 0.75; }

.cp-left {
  display: flex; align-items: center; gap: 10px; padding-right: 14px;
  border-right: 1px dashed rgba(206,147,216,0.4); min-width: 118px;
}
.cp-emoji { font-size: 30px; }
.cp-value { display: flex; flex-direction: column; }
.cp-value b { font-size: 22px; font-weight: 800; color: #ce93d8; line-height: 1; }
.cp-value b.voucher { font-size: 14px; color: #ce93d8; max-width: 72px; }
.cp-value i { font-style: normal; font-size: 10px; color: #b39ddb; margin-top: 4px; }
.coupon.redeemed .cp-value b, .coupon.expired .cp-value b { color: #90a4ae; }
.coupon.redeemed .cp-value i, .coupon.expired .cp-value i { color: #78909c; }

.cp-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.cp-name { font-size: 14px; font-weight: 700; color: #f3e5f5; display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.cp-type {
  font-size: 9px; font-weight: 400; background: rgba(206,147,216,0.18); color: #ce93d8;
  padding: 1px 7px; border-radius: 4px;
}
.cp-user { font-size: 10px; font-weight: 400; color: #b39ddb; }
.cp-comp { font-size: 9px; font-weight: 400; background: rgba(77,182,172,0.2); color: #4db6ac; padding: 1px 7px; border-radius: 4px; }
.cp-desc { font-size: 11px; color: #9db0d0; }
.cp-meta { font-size: 10px; color: #6f84ab; }
.cp-code-inline { color: #e1bee7; font-weight: 700; letter-spacing: 0.5px; }

.code-box {
  margin-top: 6px; display: flex; align-items: center; justify-content: space-between; gap: 10px;
  background: rgba(0,0,0,0.28); border: 1px dashed rgba(206,147,216,0.55);
  border-radius: 9px; padding: 8px 12px;
}
.code-main { display: flex; flex-direction: column; gap: 2px; }
.code-lab { font-size: 10px; color: #b39ddb; }
.code-num {
  font-size: 19px; font-weight: 800; letter-spacing: 2px; color: #fff;
  font-family: 'SFMono-Regular', Consolas, monospace;
}
.copy-btn {
  background: rgba(171,71,188,0.3); border: 1px solid rgba(206,147,216,0.5); color: #f3e5f5;
  border-radius: 8px; padding: 7px 14px; font-size: 12px; cursor: pointer; white-space: nowrap;
}
.copy-btn:hover { background: rgba(171,71,188,0.5); }

.cp-expire { font-size: 10px; color: #9db0d0; }
.cp-expire.soon { color: #ffb74d; font-weight: 700; }

.done-info { font-size: 11px; display: flex; flex-direction: column; gap: 2px; }
.done-info.redeem { color: #a5d6a7; }
.done-info.expired { color: #90a4ae; }
.di-note { color: #8ba2c8; }

.cp-status {
  align-self: flex-start; font-size: 11px; padding: 3px 10px; border-radius: 6px; font-weight: 600; flex-shrink: 0;
}
.cp-status.available { background: rgba(171,71,188,0.2); color: #ce93d8; }
.cp-status.redeemed { background: rgba(144,164,174,0.18); color: #b0bec5; }
.cp-status.expired { background: rgba(84,110,123,0.25); color: #90a4ae; }
.cp-op { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
.btn-mini {
  background: linear-gradient(135deg,#ab47bc,#8e24aa); color: #fff; border: none;
  border-radius: 7px; padding: 5px 10px; font-size: 11px; cursor: pointer; white-space: nowrap;
}

/* 核销工作台 */
.scan-card { border-color: rgba(171,71,188,0.4); }
.scan-row { display: flex; gap: 10px; }
.scan-row input {
  flex: 1; background: #0c1730; border: 1px solid rgba(171,71,188,0.35); color: #fff;
  border-radius: 9px; padding: 11px 14px; font-size: 15px; letter-spacing: 1px;
  font-family: 'SFMono-Regular', Consolas, monospace;
}
.scan-row input:focus { outline: none; border-color: #ce93d8; }
.btn-redeem {
  background: linear-gradient(135deg,#ab47bc,#7b1fa2); color: #fff; border: none;
  border-radius: 9px; padding: 0 26px; font-size: 14px; font-weight: 700; cursor: pointer; white-space: nowrap;
}
.btn-redeem:hover { filter: brightness(1.1); }
.scan-hint { font-size: 11px; color: #6f84ab; margin: 9px 0 0; }

/* 台账 */
.log-row {
  display: flex; align-items: center; gap: 10px; padding: 7px 0;
  border-bottom: 1px dashed rgba(120,160,220,0.1); font-size: 12px; flex-wrap: wrap;
}
.log-row:last-child { border-bottom: none; }
.l-tag { font-size: 10px; padding: 2px 8px; border-radius: 5px; font-weight: 600; flex-shrink: 0; }
.l-tag.issue, .l-tag.deliver { background: rgba(206,147,216,0.18); color: #ce93d8; }
.l-tag.hold { background: rgba(129,212,250,0.15); color: #81d4fa; }
.l-tag.revoke { background: rgba(144,164,174,0.18); color: #b0bec5; }
.l-tag.redeem { background: rgba(126,240,201,0.15); color: #7ef0c9; }
.l-tag.expire { background: rgba(239,154,154,0.15); color: #ef9a9a; }
.l-tag.comp { background: rgba(77,182,172,0.18); color: #4db6ac; }
.l-name { color: #e8eefb; min-width: 120px; }
.l-code { font-family: 'SFMono-Regular', Consolas, monospace; font-size: 11px; color: #e1bee7; }
.l-note { flex: 1; color: #9db0d0; font-size: 11px; min-width: 160px; }
.l-who { color: #8ba2c8; font-size: 11px; }
.l-time { color: #6f84ab; font-size: 11px; }
</style>
