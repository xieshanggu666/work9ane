<template>
  <div class="card server-card">
    <div class="card-title">
      🔌 服务端履约链路
      <span class="mode-pill" :class="store.serverMode ? 'on' : 'off'">
        {{ store.serverMode ? (store.serverConnected ? '已接入服务端' : '连接中…') : '本地快照模式' }}
      </span>
    </div>

    <!-- 未接入：连接 + 离线快照上云 -->
    <template v-if="!store.serverMode">
      <p class="svc-hint">
        本地模式下业务在浏览器内完成（零后端演示）。接入服务端后，抽奖/积分/库存/风控/物流/采购/供应商/预算/对账等
        全部写操作统一走 REST API：<b>服务端 RBAC + 租户归属强校验、Idempotency-Key 幂等、按键锁并发、WAL 崩溃续办</b>。
      </p>
      <div class="svc-row">
        <input v-model="baseUrl" class="svc-input" placeholder="留空走 Vite 代理 /api-proxy（即 http://localhost:8080）" />
        <button class="btn-primary" :disabled="connecting" @click="connect">
          {{ connecting ? '连接中…' : '连接服务端并以消费者登录' }}
        </button>
      </div>
      <div class="svc-actions">
        <button class="btn-ghost" @click="store.downloadOfflineSnapshot()">⬇️ 导出离线快照</button>
        <label class="btn-ghost file-btn">
          📤 上云迁移（校验 → 迁移）
          <input type="file" accept="application/json" @change="onMigrateFile" hidden />
        </label>
        <span v-if="migrateMsg" class="mig-msg" :class="migrateOk ? 'ok' : 'bad'">{{ migrateMsg }}</span>
      </div>
      <p class="svc-note">
        上云迁移仅平台超管可执行：先经余额链/库存账实/冻结单/券码唯一校验，不通过整批拒绝；
        通过后以固定行 id + effectId 重建 WAL（中断重跑零增量），历史漏记由统一对账补偿链路检出修正。
      </p>
    </template>

    <!-- 已接入：状态 + 身份快捷登录 + 断开 -->
    <template v-else>
      <div class="svc-connected">
        <div class="svc-stat">
          <span>状态</span>
          <b :class="store.serverConnected ? 'ok' : 'bad'">
            {{ store.serverConnected ? '🟢 在线' : '🟡 重连中' }}
          </b>
          <em v-if="store.serverSyncing">同步中…</em>
        </div>
        <div class="svc-stat"><span>数据版本</span><code>{{ store.serverVersion || '—' }}</code></div>
        <div class="svc-stat"><span>身份</span>
          <b>{{ store.identityKind === 'customer' ? '👤 消费者' :
               store.identityKind === 'platform' ? '⚙️ 平台超管' : '🛡️ 员工' }}
            {{ store.user.name }}</b>
        </div>
      </div>
      <div class="svc-actions">
        <button class="btn-ghost" @click="store.loginAsCustomer()">👤 消费者</button>
        <button class="btn-ghost" @click="store.loginAsMember('m-star-admin')">👑 星河管理员</button>
        <button class="btn-ghost" @click="store.loginAsMember('m-star-risk')">🛡️ 星河风控</button>
        <button class="btn-ghost" @click="store.loginAsMember('m-star-fin')">🧮 星河财务</button>
        <button class="btn-ghost" @click="store.loginAsMember('m-star-ship')">📦 星河仓配</button>
        <button class="btn-ghost" @click="store.loginAsMember('m-star-ops')">🧑‍💼 星河运营</button>
        <button class="btn-ghost platform" @click="store.loginAsMember('m-platform')">⚙️ 平台超管（迁移/跨日/续办）</button>
        <button class="btn-warn" @click="disconnect">断开（回本地模式）</button>
      </div>
      <p class="svc-note">
        所有写请求自动携带 <code>Idempotency-Key</code>；重复点击/网络重试/服务端崩溃重启均不重复扣分扣库存，
        刷新页面后从 <code>/api/state</code> 全量水合，服务端为唯一事实来源。
      </p>
    </template>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { usePlatformStore } from '@/store/platform'
import { configureBase, api, ApiError } from '@/api/client'

const store = usePlatformStore()
const baseUrl = ref('')
const connecting = ref(false)
const migrateMsg = ref('')
const migrateOk = ref(false)

async function connect() {
  connecting.value = true
  try {
    if (baseUrl.value.trim()) configureBase(baseUrl.value.trim())
    await store.connectServer(baseUrl.value.trim() || undefined)
    store.showToast('已接入服务端，数据已从服务端水合', 'success')
  } catch (e) {
    store.showToast(e?.message || '连接服务端失败（请先 npm run server）', 'warn')
  } finally {
    connecting.value = false
  }
}

async function disconnect() {
  await store.logoutRemote()
  store.showToast('已断开服务端，回到本地快照模式（本地演示数据不受影响）', 'info')
  // 重新初始化本地演示数据，保证离线模式可继续浏览
  store.init()
}

// 离线快照上云：先校验，通过则用平台超管身份执行迁移（固定批次 id 幂等）
async function onMigrateFile(ev) {
  const file = ev.target.files?.[0]
  ev.target.value = ''
  if (!file) return
  migrateMsg.value = '读取快照中…'
  try {
    const snapshot = await store.readOfflineSnapshotFile(file)
    migrateMsg.value = '需要平台超管身份，正在登录平台方…'
    if (baseUrl.value.trim()) configureBase(baseUrl.value.trim())
    await store.connectServer(baseUrl.value.trim() || undefined)
    await store.loginRemoteMember('m-platform')

    migrateMsg.value = '校验历史台账中…'
    const v = await api.migrationValidate(snapshot)
    if (!v.data.valid) {
      migrateOk.value = false
      migrateMsg.value = `校验未通过（${v.data.errors.length} 项）：${v.data.errors.slice(0, 2).join('；')}`
      return
    }
    migrateMsg.value = '校验通过，正在迁移重建 WAL…'
    const batchId = `mig-offline-${snapshot.migratedAt || 'all'}`
    const r = await api.migrationRun(snapshot, batchId)
    migrateOk.value = true
    const c = r.data.manifest?.counts || {}
    migrateMsg.value = `迁移完成：流水 ${c.pointFlows || 0}、记录 ${c.records || 0}、审核单 ${c.riskOrders || 0}、卡券 ${c.coupons || 0}（幂等批次 ${batchId}）`
    await store.hydrateFromServer({})
    store.showToast('离线快照已上云，可跑对账验证历史差异', 'success')
  } catch (e) {
    migrateOk.value = false
    if (e instanceof ApiError) migrateMsg.value = `迁移失败：${e.message}`
    else migrateMsg.value = `迁移失败：${e?.message || e}`
  }
}
</script>

<style scoped>
.server-card { border-color: rgba(129, 212, 250, 0.35); }
.mode-pill {
  margin-left: 8px; font-size: 11px; padding: 2px 10px; border-radius: 10px; font-weight: 700;
}
.mode-pill.on { background: rgba(67, 160, 71, 0.2); color: #a5d6a7; }
.mode-pill.off { background: rgba(255, 152, 0, 0.15); color: #ffcc80; }
.svc-hint, .svc-note { color: #8ba2c8; font-size: 12px; line-height: 1.7; margin: 8px 0; }
.svc-row { display: flex; gap: 8px; margin: 10px 0; }
.svc-input {
  flex: 1; background: #0c1730; border: 1px solid rgba(120, 160, 220, 0.25);
  border-radius: 8px; padding: 8px 12px; color: #dbe4f3; font-size: 12px;
}
.svc-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 10px 0; }
.file-btn { cursor: pointer; }
.mig-msg { font-size: 12px; }
.mig-msg.ok { color: #a5d6a7; }
.mig-msg.bad { color: #ef9a9a; }
.svc-connected { display: flex; gap: 24px; flex-wrap: wrap; margin: 10px 0; }
.svc-stat { display: flex; flex-direction: column; gap: 3px; font-size: 11px; color: #8ba2c8; }
.svc-stat b { font-size: 13px; color: #dbe4f3; }
.svc-stat b.ok { color: #a5d6a7; }
.svc-stat b.bad { color: #ffcc80; }
.svc-stat code { font-size: 11px; color: #81d4fa; }
.svc-stat em { font-size: 10px; color: #ffcc80; font-style: normal; }
</style>
