<template>
  <div class="audit-view">
    <!-- 无权限拦截 -->
    <div v-if="!store.can('audit:view')" class="denied-card">
      <div class="deny-icon">⛔</div>
      <h3>无权访问全链路审计</h3>
      <p>当前身份「{{ store.identityKind === 'customer' ? '消费者' : store.roleLabelOf(store.currentMember?.roleKey) }}」缺少
        <code>audit:view</code> 权限。</p>
      <p class="muted">财务对账、组织管理员可查看本租户审计；平台超管可查看全平台审计。每次越权尝试都会被记录。</p>
      <div class="deny-actions">
        <button class="btn-primary" @click="store.setRole('operator')">切换为组织管理员（演示）</button>
        <button class="btn-ghost" @click="store.loginAsMember('m-star-cs')">🔒 用停用客服账号尝试（触发拒绝留痕）</button>
      </div>
    </div>

    <template v-else>
      <!-- 概览 -->
      <div class="au-hero">
        <div class="hero-stats">
          <div class="hs-item"><span class="hs-num">{{ totalCount }}</span><span class="hs-lab">审计事件（当前范围）</span></div>
          <div class="hs-item"><span class="hs-num denied">{{ deniedCount }}</span><span class="hs-lab">权限/越权拦截</span></div>
          <div class="hs-item"><span class="hs-num">{{ todayCount }}</span><span class="hs-lab">今日事件</span></div>
          <div class="hs-item"><span class="hs-num">{{ actorCount }}</span><span class="hs-lab">操作主体数</span></div>
          <div class="hs-item"><span class="hs-num">{{ traceCount }}</span><span class="hs-lab">业务链路数（trace）</span></div>
        </div>
        <div class="hero-actions">
          <button class="btn-ghost" @click="exportLogs">⬇️ 导出当前筛选 JSON</button>
        </div>
      </div>

      <!-- 检索栏 -->
      <div class="card">
        <div class="filters-bar">
          <select v-model="f.tenantId" :disabled="!store.isPlatform">
            <option value="">全部租户</option>
            <option v-for="t in store.tenants" :key="t.id" :value="t.id">{{ t.icon }} {{ t.shortName }}</option>
          </select>
          <select v-model="f.module">
            <option value="">全部模块</option>
            <option v-for="(label, key) in modules" :key="key" :value="key">{{ label }}</option>
          </select>
          <select v-model="f.result">
            <option value="">全部结果</option>
            <option value="success">成功</option>
            <option value="denied">已拦截</option>
          </select>
          <input v-model="f.keyword" placeholder="搜索：动作 / 单号 / 操作人 / IP / traceId / 明细关键词" />
          <button class="btn-ghost" @click="resetFilter">重置</button>
        </div>
        <p class="scope-hint">
          数据范围：<b>{{ scopeLabel }}</b>
          <em v-if="store.isPlatform">（平台方可跨租户检索；员工仅本租户）</em>
        </p>
      </div>

      <div class="au-grid">
        <!-- 审计流水 -->
        <div class="card">
          <div class="card-title">📜 全链路操作审计（{{ entries.length }}）</div>
          <div v-if="entries.length === 0" class="empty">无匹配审计事件</div>
          <div v-for="l in pagedEntries" :key="l.id" class="log-row" :class="l.result">
            <span class="lr-time">{{ l.date }} {{ l.time }}</span>
            <span class="lr-module">{{ moduleLabel(l.module) }}</span>
            <span class="lr-action">{{ l.actionLabel }}</span>
            <span class="lr-detail">{{ l.detail }}</span>
            <span class="lr-meta">
              <span class="lr-actor">{{ l.operator }}</span>
              <span v-if="l.orderId" class="lr-order">单号 {{ l.orderId }}</span>
              <span class="lr-ip">{{ l.channel }} · {{ l.ip }}</span>
              <button v-if="l.traceId" class="trace-link" @click="viewTrace(l.traceId)">🔗 链路 {{ l.traceId.slice(-6) }}</button>
            </span>
            <span v-if="l.result === 'denied'" class="lr-denied">⛔ 已拦截</span>
            <span v-else class="lr-ok">✓</span>
          </div>
          <div class="pager">
            <button class="btn-ghost small" :disabled="page === 1" @click="page--">上一页</button>
            <span>第 {{ page }} / {{ totalPages }} 页</span>
            <button class="btn-ghost small" :disabled="page >= totalPages" @click="page++">下一页</button>
          </div>
        </div>

        <!-- 链路详情 -->
        <div class="card trace-card" v-if="selectedTrace">
          <div class="card-title">🔗 链路追踪 <span class="trace-id">{{ selectedTrace }}</span>
            <button class="btn-ghost small" @click="selectedTrace = ''">关闭</button>
          </div>
          <div class="trace-sub">同一次用户操作级联产生的审计 / 卡券台账 / 积分流水，按时间正序还原：</div>
          <div v-for="(n, i) in traceNodes" :key="i" class="tn-row" :class="n.kind">
            <span class="tn-dot">{{ { audit: '📝', coupon: '🎟️', points: '🪙' }[n.kind] }}</span>
            <div class="tn-body">
              <div class="tn-label">{{ n.label }} <span class="tn-kind">{{ { audit: '审计', coupon: '卡券台账', points: '积分流水' }[n.kind] }}</span></div>
              <div class="tn-detail">{{ n.detail }}</div>
              <div class="tn-meta">{{ n.operator }} · {{ n.date }} {{ n.time }} · {{ tenantShort(n.tenantId) }}</div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue'
import { usePlatformStore, AUDIT_MODULES } from '@/store/platform'

const store = usePlatformStore()
const modules = AUDIT_MODULES

const f = reactive({ tenantId: '', module: '', result: '', keyword: '' })
const page = ref(1)
const pageSize = 30
const selectedTrace = ref('')

watch(f, () => { page.value = 1 })

// 员工强制只看本租户；平台方可选
const effectiveTenant = computed(() =>
  store.isPlatform ? f.tenantId : store.activeTenantId
)
const scopeLabel = computed(() =>
  store.isPlatform
    ? (f.tenantId ? store.tenants.find((t) => t.id === f.tenantId)?.shortName + ' 单租户' : '全平台（全部租户）')
    : store.activeTenant.shortName + '（本租户）'
)

const entries = computed(() =>
  store.auditEntries({
    tenantId: effectiveTenant.value || undefined,
    module: f.module || undefined,
    result: f.result || undefined,
    keyword: f.keyword || undefined
  })
)
const pagedEntries = computed(() =>
  entries.value.slice((page.value - 1) * pageSize, page.value * pageSize)
)
const totalPages = computed(() => Math.max(1, Math.ceil(entries.value.length / pageSize)))

const totalCount = computed(() => entries.value.length)
const deniedCount = computed(() =>
  store.auditEntries({ tenantId: effectiveTenant.value || undefined, result: 'denied' }).length
)
const todayCount = computed(() =>
  entries.value.filter((l) => l.date === store.todayDate).length
)
const actorCount = computed(() => new Set(entries.value.map((l) => l.operator)).size)
const traceCount = computed(() =>
  new Set(entries.value.map((l) => l.traceId).filter(Boolean)).size
)

const traceNodes = computed(() => store.traceTimeline(selectedTrace.value))
const moduleLabel = (k) => AUDIT_MODULES[k] || k
const tenantShort = (id) => store.tenants.find((t) => t.id === id)?.shortName || id

function resetFilter() {
  f.tenantId = ''; f.module = ''; f.result = ''; f.keyword = ''
}
function viewTrace(id) { selectedTrace.value = id }

function exportLogs() {
  const data = JSON.stringify(entries.value, null, 2)
  const blob = new Blob([data], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `audit-${effectiveTenant.value || 'all'}-${store.todayDate}.json`
  a.click()
  URL.revokeObjectURL(url)
  store.addAuditLog('audit-export', null, `导出审计日志 ${entries.value.length} 条（${scopeLabel.value}）`, { module: 'org' })
  store.showToast('审计日志已导出', 'success')
}
</script>

<style scoped>
.audit-view { display: flex; flex-direction: column; gap: 16px; max-width: 1180px; margin: 0 auto; }
.denied-card {
  background: #0f1b38; border: 1px solid rgba(255,112,67,0.35); border-radius: 14px;
  padding: 40px; text-align: center;
}
.deny-icon { font-size: 44px; }
.denied-card h3 { color: #ffab91; margin: 10px 0 8px; }
.denied-card p { color: #b9c6e3; font-size: 13px; }
.denied-card code { background: #0c1730; padding: 2px 8px; border-radius: 6px; color: #ffb74d; }
.denied-card .muted { color: #7e92bd; font-size: 11px; }
.deny-actions { display: flex; gap: 10px; justify-content: center; margin-top: 16px; flex-wrap: wrap; }

.au-hero {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  background: linear-gradient(135deg,#3a1a5e,#1a2a6e); border: 1px solid rgba(206,147,216,0.35);
  border-radius: 14px; padding: 18px 22px; flex-wrap: wrap;
}
.hero-stats { display: flex; gap: 26px; flex-wrap: wrap; }
.hs-item { display: flex; flex-direction: column; }
.hs-num { font-size: 25px; font-weight: 800; color: #ce93d8; line-height: 1; }
.hs-num.denied { color: #ef9a9a; }
.hs-lab { font-size: 11px; color: #b9a7d9; margin-top: 5px; }

.card {
  background: #0f1b38; border: 1px solid rgba(120,160,220,0.16);
  border-radius: 14px; padding: 16px 18px;
}
.card-title { font-size: 15px; font-weight: 700; color: #fff; margin-bottom: 12px; display: flex; align-items: center; gap: 10px; }
.filters-bar { display: flex; gap: 8px; flex-wrap: wrap; }
.filters-bar select, .filters-bar input {
  background: #0c1730; border: 1px solid rgba(120,160,220,0.25); color: #dbe4f3;
  border-radius: 8px; padding: 8px 10px; font-size: 12px;
}
.filters-bar input { flex: 1; min-width: 260px; }
.scope-hint { font-size: 11px; color: #8ba2c8; margin: 9px 0 0; }
.scope-hint b { color: #ce93d8; }
.scope-hint em { color: #6f84ab; font-style: normal; margin-left: 6px; }

.au-grid { display: grid; grid-template-columns: 1fr 340px; gap: 16px; align-items: start; }
@media (max-width: 960px) { .au-grid { grid-template-columns: 1fr; } }

.log-row {
  display: grid; grid-template-columns: 118px 74px 84px 1fr auto 36px; gap: 8px; align-items: center;
  padding: 9px 6px; border-bottom: 1px dashed rgba(120,160,220,0.1); font-size: 11.5px;
}
.log-row.denied { background: rgba(255,112,67,0.07); border-radius: 8px; }
.lr-time { color: #7e92bd; font-size: 10.5px; }
.lr-module {
  font-size: 9.5px; color: #b39ddb; background: rgba(126,87,194,0.14);
  padding: 2px 6px; border-radius: 6px; text-align: center; white-space: nowrap;
}
.lr-action { color: #dbe4f3; font-weight: 600; white-space: nowrap; }
.lr-detail { color: #aebadd; line-height: 1.5; }
.lr-meta { display: flex; flex-direction: column; gap: 2px; align-items: flex-end; font-size: 10px; color: #7e92bd; white-space: nowrap; }
.lr-actor { color: #82b1ff; }
.lr-order { font-family: monospace; }
.lr-ip { color: #5b6f94; }
.trace-link {
  background: rgba(77,182,172,0.15); border: 1px solid rgba(77,182,172,0.35); color: #4db6ac;
  border-radius: 7px; font-size: 10px; padding: 2px 7px; cursor: pointer;
}
.lr-denied { color: #ef9a9a; font-size: 11px; text-align: center; }
.lr-ok { color: #4db6ac; text-align: center; }
.empty { color: #5b6f94; text-align: center; padding: 24px; font-size: 12px; }
.pager { display: flex; align-items: center; gap: 12px; justify-content: center; margin-top: 12px; font-size: 11px; color: #8ba2c8; }

.trace-card { position: sticky; top: 90px; }
.trace-id { font-family: monospace; font-size: 11px; color: #4db6ac; font-weight: 400; }
.trace-card .small { margin-left: auto; }
.trace-sub { font-size: 11px; color: #8ba2c8; margin-bottom: 12px; }
.tn-row { display: flex; gap: 9px; padding: 8px 0; border-bottom: 1px dashed rgba(120,160,220,0.1); }
.tn-dot { font-size: 15px; }
.tn-body { min-width: 0; }
.tn-label { font-size: 12px; color: #e8eefb; font-weight: 600; }
.tn-kind { font-size: 9px; background: rgba(120,160,220,0.14); color: #8ba2c8; padding: 1px 6px; border-radius: 6px; margin-left: 6px; font-weight: 400; }
.tn-detail { font-size: 11px; color: #aebadd; margin-top: 2px; line-height: 1.5; }
.tn-meta { font-size: 10px; color: #6f84ab; margin-top: 3px; }
.tn-row.coupon .tn-label { color: #ce93d8; }
.tn-row.points .tn-label { color: #ffd54f; }

.btn-primary {
  background: linear-gradient(135deg,#5e35b1,#7e57c2); color: #fff; border: none;
  border-radius: 8px; padding: 8px 14px; font-size: 12px; cursor: pointer;
}
.btn-ghost {
  background: transparent; border: 1px solid rgba(120,160,220,0.3); color: #aebadd;
  border-radius: 7px; padding: 7px 11px; font-size: 11px; cursor: pointer;
}
.btn-ghost:disabled { opacity: 0.4; cursor: default; }
.small { padding: 4px 9px; font-size: 10.5px; }
</style>
