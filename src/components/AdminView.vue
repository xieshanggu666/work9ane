<template>
  <div class="admin">
    <!-- 无活动管理权限 -->
    <div v-if="!store.can('activity:manage')" class="deny-banner">
      ⛔ 当前身份「{{ store.isCustomer ? '消费者' : store.roleLabelOf(store.currentMember?.roleKey) }}」无「活动管理」权限。
      活动的新建/暂停/重置/删除需 <code>activity:manage</code> 权限（活动运营 / 组织管理员）。
      <button class="goto" @click="store.gotoTab('tenant')">前往组织权限中心 →</button>
    </div>

    <div class="admin-head">
      <div class="card-title">🎛️ 活动管理 · {{ store.activeTenant.icon }} {{ store.activeTenant.shortName }}</div>
      <button class="new-btn" @click="showForm = true">＋ 新建活动</button>
    </div>

    <!-- 新建表单 -->
    <div v-if="showForm && store.can('activity:manage')" class="form-card">
      <div class="card-title">新建营销活动</div>
      <div class="form">
        <div class="f-row">
          <label>活动名称</label>
          <input v-model="form.name" placeholder="如：双11整点抽奖" />
        </div>
        <div class="f-row split">
          <div>
            <label>玩法</label>
            <select v-model="form.type">
              <option value="wheel">幸运转盘</option>
              <option value="scratch">刮刮乐</option>
            </select>
          </div>
          <div>
            <label>消耗方式</label>
            <select v-model="form.costType">
              <option value="free">免费</option>
              <option value="points">积分</option>
            </select>
          </div>
        </div>
        <div class="f-row split" v-if="form.costType==='points'">
          <div>
            <label>单次积分</label>
            <input type="number" v-model.number="form.cost" min="0" />
          </div>
          <div>
            <label>每日限抽</label>
            <input type="number" v-model.number="form.dailyLimit" min="1" />
          </div>
        </div>
        <div class="f-row">
          <label>活动描述</label>
          <input v-model="form.desc" placeholder="简要说明" />
        </div>
        <div class="f-row">
          <label>奖品格（名称 | 稀有度 legendary/epic/rare/common | 库存 | 权重，每行一个）</label>
          <textarea v-model="form.prizeText" rows="5" placeholder="蓝牙耳机|legendary|5|2&#10;视频月卡|epic|50|6&#10;20积分|rare|400|25&#10;谢谢参与|none|99999|100"></textarea>
        </div>
        <div class="form-actions">
          <button class="btn-cancel" @click="showForm=false">取消</button>
          <button class="btn-ok" @click="submit">保存</button>
        </div>
      </div>
    </div>

    <!-- 活动卡片 -->
    <div class="act-list">
      <div v-for="a in scopedActivities" :key="a.id" class="act-card">
        <div class="ac-head">
          <span class="ac-icon">{{ a.icon }}</span>
          <div>
            <div class="ac-name">{{ a.name }}</div>
            <div class="ac-type">{{ a.type==='wheel'?'幸运转盘':'刮刮乐' }} · {{ a.costType==='points' ? a.cost+'积分/次' : '免费' }} · 每日{{a.dailyLimit}}次</div>
          </div>
          <span class="a-status" :class="a.status">{{ statusLabel(a.status) }}</span>
        </div>
        <div class="ac-desc">{{ a.desc }}</div>
        <div class="ac-prizes">
          <div v-for="p in a.prizes" :key="p.id" class="prize-chip" :style="{ borderColor: rarityColor(p.rarity) }">
            <span>{{ p.emoji }}</span>
            <span class="pc-name">{{ p.name }}</span>
            <i class="rarity-dot" :style="{ background: rarityColor(p.rarity) }"></i>
            <span v-if="p.rarity !== 'none'" class="pc-kind" :class="isPhysical(p) ? 'physical' : 'virtual'">{{ isPhysical(p) ? '实物' : '虚拟' }}</span>
            <span class="pc-stock">{{ p.remain }}/{{ p.stock }}</span>
            <span v-if="p.frozen" class="pc-frozen" title="风控审核中预占">🧊{{ p.frozen }}</span>
          </div>
        </div>
        <div class="ac-actions">
          <span class="ac-period">{{ a.startAt }} ~ {{ a.endAt }}</span>
          <div class="ac-btns">
            <button @click="store.toggleActivityStatus(a.id)">{{ a.status==='running' ? '⏸ 暂停' : '▶ 启动' }}</button>
            <button @click="store.resetActivityStock(a.id)">↺ 重置库存</button>
            <button class="danger" @click="removeAct(a.id)">✕ 删除</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { usePlatformStore } from '@/store/platform'
import { PRIZE_RARITY } from '@/mock/data'
const store = usePlatformStore()

// 仅管理当前数据上下文租户的活动
const scopedActivities = computed(() => store.activities.filter((a) => a.tenantId === store.activeTenantId))

const showForm = ref(false)
const form = ref({
  name: '',
  type: 'wheel',
  costType: 'free',
  cost: 10,
  dailyLimit: 3,
  desc: '',
  prizeText: ''
})

const statusLabel = (s) => ({ running: '进行中', paused: '已暂停', ended: '已结束' }[s] || s)
const rarityColor = (r) => PRIZE_RARITY[r]?.color || '#777'
// 实物/虚拟：显式 physical 标记优先，兜底按奖品名
const isPhysical = (p) => (p.physical !== undefined ? !!p.physical : !p.name.includes('积分'))

function submit() {
  const prizes = form.value.prizeText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [name, rarity = 'common', stock = 10, weight = 10] = l.split('|').map((x) => x.trim())
      return { name, rarity, stock: Number(stock) || 10, weight: Number(weight) || 10, emoji: PRIZE_RARITY[rarity]?.icon || '🎁' }
    })
  const act = store.createActivity({
    name: form.value.name || '未命名活动',
    type: form.value.type,
    costType: form.value.costType,
    cost: form.value.cost,
    dailyLimit: form.value.dailyLimit,
    desc: form.value.desc,
    prizes
  })
  showForm.value = false
  form.value = { name: '', type: 'wheel', costType: 'free', cost: 10, dailyLimit: 3, desc: '', prizeText: '' }
}

function removeAct(id) {
  store.deleteActivity(id)
}
</script>

<style scoped>
.admin { display: flex; flex-direction: column; gap: 14px; }
.deny-banner {
  background: rgba(255,112,67,0.1); border: 1px solid rgba(255,112,67,0.4);
  color: #ffcc80; border-radius: 12px; padding: 14px 18px; font-size: 13px;
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
}
.deny-banner code { background: #0c1730; padding: 2px 8px; border-radius: 6px; color: #ffb74d; }
.deny-banner .goto {
  margin-left: auto; background: rgba(126,87,194,0.2); border: 1px solid rgba(126,87,194,0.5);
  color: #ce93d8; border-radius: 8px; padding: 6px 12px; font-size: 12px; cursor: pointer;
}
.admin-head { display: flex; align-items: center; justify-content: space-between; }
.card-title { font-size: 16px; font-weight: 700; color: #fff; }
.new-btn {
  background: linear-gradient(135deg,#4d8dff,#2962ff); color: #fff; border: none;
  border-radius: 10px; padding: 9px 16px; font-size: 13px; font-weight: 600; cursor: pointer;
  box-shadow: 0 4px 12px rgba(41,98,255,0.35);
}

.form-card {
  background: #0f1b38; border: 1px solid rgba(120,160,220,0.2);
  border-radius: 14px; padding: 18px;
}
.form { display: flex; flex-direction: column; gap: 12px; }
.f-row { display: flex; flex-direction: column; gap: 5px; }
.f-row.split { flex-direction: row; gap: 12px; }
.f-row.split > div { flex: 1; display: flex; flex-direction: column; gap: 5px; }
.f-row label { font-size: 12px; color: #8ba2c8; }
.f-row input, .f-row select, .f-row textarea {
  background: #0c1730; border: 1px solid rgba(120,160,220,0.2); color: #dbe4f3;
  border-radius: 8px; padding: 9px 10px; font-size: 12px; box-sizing: border-box;
  font-family: inherit;
}
.f-row textarea { resize: vertical; }
.form-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px; }
.btn-cancel { background: transparent; border: 1px solid rgba(120,160,220,0.3); color: #8ba2c8; border-radius: 8px; padding: 8px 18px; cursor: pointer; }
.btn-ok { background: linear-gradient(135deg,#66bb6a,#43a047); color: #fff; border: none; border-radius: 8px; padding: 8px 22px; cursor: pointer; font-weight: 600; }

.act-list { display: flex; flex-direction: column; gap: 12px; }
.act-card {
  background: #0f1b38; border: 1px solid rgba(120,160,220,0.16);
  border-radius: 14px; padding: 16px;
}
.ac-head { display: flex; align-items: center; gap: 12px; }
.ac-icon { font-size: 28px; }
.ac-name { font-size: 15px; color: #fff; font-weight: 700; }
.ac-type { font-size: 11px; color: #6f84ab; margin-top: 2px; }
.a-status { font-size: 11px; padding: 3px 10px; border-radius: 5px; margin-left: auto; }
.a-status.running { background: rgba(76,175,80,0.15); color: #7ef0c9; }
.a-status.paused { background: rgba(255,152,0,0.15); color: #ff9800; }
.a-status.ended { background: rgba(158,158,158,0.15); color: #90a4ae; }

.ac-desc { color: #8ba2c8; font-size: 12px; margin: 8px 0; }
.ac-prizes { display: flex; flex-wrap: wrap; gap: 6px; }
.prize-chip {
  display: flex; align-items: center; gap: 5px;
  background: rgba(20,34,66,0.6); border: 1px solid; border-radius: 7px; padding: 4px 8px; font-size: 11px;
}
.pc-name { color: #dbe4f3; }
.pc-kind { font-size: 9px; padding: 1px 5px; border-radius: 3px; font-style: normal; }
.pc-kind.physical { background: rgba(76,175,80,0.18); color: #7ef0c9; }
.pc-kind.virtual { background: rgba(120,160,220,0.14); color: #8ba2c8; }
.rarity-dot { width: 7px; height: 7px; border-radius: 50%; }
.pc-stock { color: #ffc107; font-size: 10px; }
.pc-frozen { color: #81d4fa; font-size: 10px; }

.ac-actions { display: flex; align-items: center; justify-content: space-between; margin-top: 12px; border-top: 1px dashed rgba(120,160,220,0.15); padding-top: 10px; }
.ac-period { color: #6f84ab; font-size: 11px; }
.ac-btns { display: flex; gap: 6px; }
.ac-btns button {
  background: #16263f; border: 1px solid rgba(120,160,220,0.25); color: #aebadd;
  border-radius: 7px; padding: 5px 10px; font-size: 11px; cursor: pointer;
}
.ac-btns button:hover { border-color: #4d8dff; color: #fff; }
.ac-btns .danger { border-color: rgba(239,83,80,0.4); color: #ef5350; }
.ac-btns .danger:hover { background: rgba(239,83,80,0.15); }
</style>