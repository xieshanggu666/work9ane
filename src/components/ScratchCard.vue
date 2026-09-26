<template>
  <div class="scratch-box">
    <!-- 未抽奖：展示奖品池 -->
    <div class="prize-hint" v-if="!result">
      <div class="prize-hint-title">{{ activity.name }}</div>
      <div class="pool">
        <div v-for="p in activity.prizes.slice(0,6)" :key="p.id" class="pool-item" :class="p.rarity">
          <span class="pool-icon">{{ p.emoji }}</span>
          <span class="pool-name">{{ p.name }}</span>
        </div>
      </div>
      <p class="pool-tip">消耗 {{ activity.costType==='points' ? activity.cost+' 积分' : '0 积分' }} · 价值越高概率越低</p>
      <p class="pool-tip">点击下方按钮后，用鼠标在卡片上刮开涂层揭晓结果</p>
    </div>

    <!-- 抽奖后：刮卡揭晓 -->
    <div class="card-wrap" v-else>
      <div class="result-bg" :class="result.rarity">
        <div class="r-icon">{{ result.icon }}</div>
        <div class="r-name">{{ result.prizeName }}</div>
        <div class="r-rarity">{{ rarityLabel(result.rarity) }}</div>
      </div>
      <canvas ref="canvasRef" class="scratch-canvas" width="260" height="150"
              @pointerdown="startScratch" @pointermove="scratchMove" @pointerup="endScratch"
              @mousedown="startScratch" @mousemove="scratchMove" @mouseup="endScratch"
              @click="clickErase"></canvas>
      <button v-if="result && !revealedFull" class="reveal-btn" @click="revealNow">✨ 直接揭晓</button>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { PRIZE_RARITY } from '@/mock/data'

const props = defineProps({
  activity: { type: Object, required: true },
  result: { type: Object, default: null }
})

const canvasRef = ref(null)
const revealedFull = ref(false)
let ctx = null
let isDrawing = false

const rarityLabel = (r) => PRIZE_RARITY[r]?.label || r

function paintCoating() {
  if (!ctx || !canvasRef.value) return
  const w = canvasRef.value.width
  const h = canvasRef.value.height
  const colors = ['#37474f', '#455a64', '#263238']
  ctx.clearRect(0, 0, w, h)
  ctx.shadowColor = 'rgba(0,0,0,0.4)'
  ctx.shadowBlur = 6
  const grid = 18
  for (let x = 0; x < w; x += grid) {
    for (let y = 0; y < h; y += grid) {
      ctx.fillStyle = colors[(x / grid + y / grid) % 3]
      ctx.beginPath()
      ctx.arc(x + grid / 2, y + grid / 2, grid / 2 - 2, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.shadowBlur = 0
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  ctx.font = 'bold 16px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('刮开此处', w / 2, h / 2)
}

watch(() => props.result, (val) => {
  isDrawing = false
  revealedFull.value = false
  if (val) {
    requestAnimationFrame(() => paintCoating())
  }
})

function startScratch(e) {
  if (!props.result) return
  isDrawing = true
  scratchMove(e)
}
function scratchMove(e) {
  if (!isDrawing || !ctx) return
  const rect = canvasRef.value.getBoundingClientRect()
  const x = ((e.clientX - rect.left) / rect.width) * canvasRef.value.width
  const y = ((e.clientY - rect.top) / rect.height) * canvasRef.value.height
  ctx.globalCompositeOperation = 'destination-out'
  ctx.beginPath()
  ctx.arc(x, y, 24, 0, Math.PI * 2)
  ctx.fill()
}
function endScratch() {
  isDrawing = false
  checkRatio()
}
function clickErase(e) {
  if (!props.result || !ctx) return
  const rect = canvasRef.value.getBoundingClientRect()
  const x = ((e.clientX - rect.left) / rect.width) * canvasRef.value.width
  const y = ((e.clientY - rect.top) / rect.height) * canvasRef.value.height
  ctx.globalCompositeOperation = 'destination-out'
  ctx.beginPath()
  ctx.arc(x, y, 30, 0, Math.PI * 2)
  ctx.fill()
  checkRatio()
}
function checkRatio() {
  if (!canvasRef.value || !ctx || revealedFull.value) return
  const { data } = ctx.getImageData(0, 0, canvasRef.value.width, canvasRef.value.height)
  const total = data.length / 4
  let clear = 0
  for (let i = 3; i < data.length; i += 4) if (data[i] === 0) clear++
  if (clear / total > 0.15) revealNow()
}
function revealNow() {
  if (!canvasRef.value) return
  revealedFull.value = true
  canvasRef.value.style.display = 'none'
}

onMounted(() => { ctx = canvasRef.value?.getContext('2d') })
onBeforeUnmount(() => { ctx = null })
</script>

<style scoped>
.scratch-box {
  display: flex; flex-direction: column; align-items: center;
  min-height: 240px; justify-content: center;
}
.prize-hint { width: 100%; text-align: center; }
.prize-hint-title { font-size: 16px; font-weight: 700; color: #fff; margin-bottom: 12px; }
.pool { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px; }
.pool-item {
  background: rgba(20,34,66,0.7); border: 1px solid rgba(120,160,220,0.2);
  border-radius: 8px; padding: 8px 4px; text-align: center;
}
.pool-item.legendary { border-color: #ff5252; box-shadow: 0 0 8px rgba(255,82,82,0.3); }
.pool-item.epic { border-color: #ab47bc; }
.pool-icon { font-size: 20px; display: block; }
.pool-name { font-size: 10px; color: #aebadd; margin-top: 4px; line-height: 1.2; display: block; }
.pool-tip { font-size: 11px; color: #6f84ab; margin: 4px 0 0; }

.card-wrap { position: relative; width: 260px; height: 150px; }
.result-bg {
  position: absolute; inset: 0; border-radius: 12px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  color: #fff;
}
.result-bg.legendary { background: linear-gradient(135deg,#ff5252,#d32f2f); }
.result-bg.epic { background: linear-gradient(135deg,#ab47bc,#7b1fa2); }
.result-bg.rare { background: linear-gradient(135deg,#42a5f5,#1976d2); }
.result-bg.common { background: linear-gradient(135deg,#78909c,#546e7a); }
.result-bg.none { background: linear-gradient(135deg,#9e9e9e,#616161); }
.r-icon { font-size: 38px; }
.r-name { font-size: 15px; font-weight: 700; margin-top: 4px; }
.r-rarity { font-size: 11px; margin-top: 2px; opacity: 0.85; }
.scratch-canvas {
  position: absolute; inset: 0; width: 100%; height: 100%;
  border-radius: 12px; cursor: pointer; z-index: 2;
  touch-action: none;
}
.reveal-btn {
  position: absolute; bottom: -4px; left: 50%; transform: translateX(-50%);
  z-index: 3; background: linear-gradient(135deg,#ffb300,#ff8f00); color: #fff;
  border: none; border-radius: 12px; padding: 6px 14px; font-size: 12px;
  font-weight: 600; cursor: pointer; box-shadow: 0 4px 10px rgba(255,152,0,0.4); white-space: nowrap;
}
.reveal-btn:hover { filter: brightness(1.1); }
</style>