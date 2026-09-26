<template>
  <div class="activity-view">
    <!-- 奖品池 / 概率说明 -->
    <div class="prize-board">
      <div class="board-title">🎁 {{ activity.name }}</div>
      <p class="board-desc">{{ activity.desc }}</p>
      <div class="prize-list">
        <div v-for="p in activity.prizes" :key="p.id" class="prize" :class="p.rarity">
          <span class="p-icon">{{ p.emoji }}</span>
          <div class="p-info">
            <div class="p-name">{{ p.name }}
              <span class="p-rarity" :style="{ background: rarityColor(p.rarity) }">{{ rarityLabel(p.rarity) }}</span>
              <span v-if="p.couponId" class="p-kind coupon">券·核销</span>
              <span v-else class="p-kind" :class="isPhysical(p) ? 'physical' : 'virtual'">{{ isPhysical(p) ? '实物' : '虚拟' }}</span>
            </div>
            <div class="p-stock">库存{{ p.remain }}/<s>{{ p.stock }}</s></div>
          </div>
        </div>
      </div>
    </div>

    <!-- 玩法区 -->
    <div class="play-board" :class="activity.type">
      <div class="board-title">
        {{ activity.type === 'wheel' ? '🎡 幸运转盘' : '🎰 刮刮乐' }}
        <span class="limit-tag" v-if="limitText">{{ limitText }}</span>
        <span class="cost-tag" :style="costSty">{{ activity.costType==='points' ? '🪙'+activity.cost : '🆓 免费' }}</span>
      </div>

      <!-- 冻结结果提示（替代开奖动画，奖品暂不揭晓） -->
      <div v-if="frozenResult" class="frozen-box">
        <div class="fz-icon">🛡️</div>
        <div class="fz-title">该次抽奖已转入风控审核</div>
        <div class="fz-desc">命中风控规则，奖品库存与积分已冻结，该笔暂缓计入抽奖任务进度。审核通过后发奖并补计进度；撤销将返还积分与次数。</div>
        <button class="fz-btn" @click="goAppeal">前往申诉 / 查看进度</button>
        <button class="fz-btn ghost" @click="frozenResult = null">知道了</button>
      </div>

      <!-- 转盘 -->
      <LuckWheel
        v-else-if="activity.type === 'wheel'"
        ref="wheelRef"
        :activity="activity"
        :bt-text="wheelText"
        @draw="onDraw"
      />

      <!-- 刮刮乐 -->
      <div v-else>
        <ScratchCard :activity="activity" :result="scratchResult" />
        <button class="scratch-action" :disabled="!canDraw" @click="onDraw">
          {{ scratchResult ? (canDraw ? '再刮一张' : '已达上限') : (canDraw ? '刮一张' : '已达上限') }}
        </button>
      </div>

      <p class="play-hint">{{ activity.hint }}</p>
      <p class="play-sub">今日已抽 {{ store.dailyDrawCount(activity.id) }}/{{ activity.dailyLimit }} 次
        <span v-if="activity.totalLimit"> · 累计 {{ store.totalDrawCount(activity.id) }}/{{ activity.totalLimit }} 次</span>
        <span v-if="frozenCount" class="frozen-sub"> · 🧊 {{ frozenCount }} 笔审核中</span>
      </p>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { usePlatformStore } from '@/store/platform'
import { PRIZE_RARITY } from '@/mock/data'
import LuckWheel from '@/components/LuckWheel.vue'
import ScratchCard from '@/components/ScratchCard.vue'

const props = defineProps({ activity: { type: Object, required: true } })
const store = usePlatformStore()

const wheelRef = ref(null)
const scratchResult = ref(null)
const frozenResult = ref(null)

// 用副本活动（其 prizes 指针共享 store 库存）
// props.activity 直接来自 store，库存实时
const rarityLabel = (r) => PRIZE_RARITY[r]?.label || r
const rarityColor = (r) => PRIZE_RARITY[r]?.color || '#777'
// 实物/虚拟：显式 physical 标记优先，兜底按奖品名（积分奖品为虚拟）
const isPhysical = (p) => (p.physical !== undefined ? !!p.physical : !p.name.includes('积分'))

const canDraw = computed(() => {
  const act = props.activity
  if (act.status !== 'running') return false
  if (store.dailyDrawCount(act.id) >= act.dailyLimit) return false
  if (act.totalLimit && store.totalDrawCount(act.id) >= act.totalLimit) return false
  if (act.costType === 'points' && act.cost > 0 && store.points < act.cost) return false
  return true
})

const limitText = computed(() => {
  const act = props.activity
  if (act.status !== 'running') return '已结束'
  if (!canDraw.value) return '今日次数已用完'
  return `每日${act.dailyLimit}次`
})

const wheelText = computed(() => {
  if (props.activity.status !== 'running') return '活动已结束'
  if (!canDraw.value) return '次数已用完'
  return props.activity.costType === 'points' ? `消耗${props.activity.cost}积分抽` : '免费抽'
})
const costSty = computed(() => ({
  background: props.activity.costType === 'points' ? 'rgba(255,193,7,0.15)' : 'rgba(76,175,80,0.15)',
  color: props.activity.costType === 'points' ? '#ffc107' : '#7ef0c9'
}))

// 当前活动处于审核中的抽奖笔数（当前租户、当前消费者）
const frozenCount = computed(() =>
  store.records.filter((r) =>
    r.type === 'draw' && r.activityId === props.activity.id &&
    (r.tenantId || 't-star') === store.activeTenantId &&
    r.userId === store.user.id &&
    r.status === 'frozen').length
)

function onDraw() {
  frozenResult.value = null
  // 提前校验（可抽则执行）
  const rec = store.draw(props.activity.id)
  if (!rec) return  // 已被校验拦截并 toast
  // 服务端模式：占位记录带 $remote Promise，等待服务端真实结果后再揭晓/播放（失败不揭晓）
  if (rec?.__pending && rec.$remote) {
    rec.$remote.then((real) => {
      if (!real) return
      if (real.status === 'frozen') { frozenResult.value = real; return }
      if (props.activity.type === 'wheel') wheelRef.value?.spin()
      else scratchResult.value = real
    }).catch(() => { /* 错误已统一 toast */ })
    return
  }
  // 命中风控：不揭晓奖品，展示审核提示
  if (rec.status === 'frozen') {
    frozenResult.value = rec
    return
  }
  // 正常抽奖：播放动画
  if (props.activity.type === 'wheel') {
    wheelRef.value?.spin()
  } else {
    scratchResult.value = rec
  }
}

function goAppeal() {
  store.gotoTab('risk')
}

// 活动切换时清空刮卡结果
watch(() => props.activity.id, () => {
  scratchResult.value = null
  frozenResult.value = null
})
</script>

<style scoped>
.activity-view {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  max-width: 900px;
  margin: 0 auto;
}
@media (max-width: 900px) {
  .activity-view { grid-template-columns: 1fr; }
}
.board-title {
  font-size: 16px; font-weight: 700; color: #fff;
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}
.board-desc { color: #8ba2c8; font-size: 12px; margin: 6px 0 12px; }

.prize-board, .play-board {
  background: #0f1b38; border: 1px solid rgba(120,160,220,0.16);
  border-radius: 14px; padding: 16px;
}
.prize-list { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.prize {
  display: flex; align-items: center; gap: 8px;
  background: rgba(20,34,66,0.6); border: 1px solid rgba(120,160,220,0.12);
  border-radius: 9px; padding: 8px;
}
.prize.legendary { border-color: rgba(255,82,82,0.6); }
.prize.epic { border-color: rgba(171,71,188,0.6); }
.p-icon { font-size: 22px; flex-shrink: 0; }
.p-info { min-width: 0; }
.p-name { font-size: 12px; color: #dbe4f3; display: flex; align-items: center; gap: 5px; }
.p-rarity { font-size: 9px; color: #fff; padding: 1px 5px; border-radius: 3px; }
.p-kind { font-size: 9px; padding: 1px 5px; border-radius: 3px; }
.p-kind.physical { background: rgba(76,175,80,0.2); color: #a5d6a7; }
.p-kind.virtual { background: rgba(120,160,220,0.14); color: #8ba2c8; }
.p-kind.coupon { background: rgba(171,71,188,0.25); color: #ce93d8; }
.p-stock { font-size: 10px; color: #6f84ab; margin-top: 2px; }

.sub-none { color: #8a9baf; }

.limit-tag {
  font-size: 10px; background: rgba(255,152,0,0.15); color: #ff9800;
  padding: 2px 7px; border-radius: 4px;
}
.cost-tag { font-size: 10px; padding: 2px 8px; border-radius: 4px; margin-left: auto; }

.play-board { display: flex; flex-direction: column; }
/* play content holders */
.play-board > div:not(.board-title),
.play-board > * { align-self: stretch; }
.play-hint {
  color: #8ba2c8; font-size: 11px; text-align: center; margin: 18px 0 4px;
}
.play-sub { color: #6f84ab; font-size: 10px; text-align: center; margin: 0; }

.scratch-action {
  margin-top: 12px; background: linear-gradient(135deg, #7c4dff, #651fff);
  color: #fff; border: none; border-radius: 22px; padding: 10px 34px;
  font-size: 14px; font-weight: 700; cursor: pointer; box-shadow: 0 6px 16px rgba(124,77,255,0.4);
  transition: all 0.2s;
}
.scratch-action:hover:not(:disabled) { filter: brightness(1.1); }
.scratch-action:disabled { background: #546e7a; cursor: not-allowed; box-shadow: none; }

.frozen-box {
  margin: 12px auto 0; max-width: 320px; text-align: center;
  background: rgba(255,152,0,0.08); border: 1px dashed rgba(255,152,0,0.45);
  border-radius: 14px; padding: 22px 18px;
}
.fz-icon { font-size: 40px; }
.fz-title { font-size: 15px; font-weight: 700; color: #ffcc80; margin-top: 8px; }
.fz-desc { font-size: 11px; color: #b0bcd4; line-height: 1.6; margin: 8px 0 14px; }
.fz-btn {
  background: linear-gradient(135deg,#4d8dff,#2962ff); color: #fff; border: none;
  border-radius: 18px; padding: 8px 20px; font-size: 12px; font-weight: 700;
  cursor: pointer; margin: 0 4px;
}
.fz-btn.ghost { background: transparent; border: 1px solid rgba(120,160,220,0.4); color: #aebadd; }
.frozen-sub { color: #81d4fa; }
</style>