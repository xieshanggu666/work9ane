<template>
  <div class="wheel-box">
    <svg class="wheel" width="300" height="300" viewBox="0 0 300 300"
         :style="{ transform: `rotate(${rotation}deg)` }">
      <g v-for="(p, i) in displayPrizes" :key="p.id">
        <path :d="arcPath(i)" fill="url(#grad)" stroke="#fff" stroke-width="2" @pointerenter.stop/>
        <text :transform="textTransform(i)" text-anchor="middle" fill="#fff"
              font-size="12" font-weight="600">
          {{ p.name }}
        </text>
      </g>
      <defs>
        <linearGradient v-for="(p, i) in displayPrizes" :key="'g'+i" :id="'grad'+i" :x1="0" :y1="0" :x2="1" :y2="1">
          <stop offset="0%" :stop-color="colorStart(p)" />
          <stop offset="100%" :stop-color="colorEnd(p)" />
        </linearGradient>
      </defs>
      <circle cx="150" cy="150" r="52" fill="#fff" />
    </svg>
    <div class="hub">🎲</div>
    <div class="pointer"></div>

    <button class="spin-btn" :disabled="spinning" @click="emit('draw')">
      {{ spinning ? '转动中…' : props.btText }}
    </button>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  activity: { type: Object, required: true },
  btText: { type: String, default: '开始抽奖' }
})
const emit = defineEmits(['draw'])

const spinning = ref(false)
const rotation = ref(0)
const size = 300
const cx = size / 2
const cy = size / 2
const r = size / 2 - 4

const displayPrizes = computed(() => props.activity.prizes.slice(0, 8))
const segAngle = computed(() => 360 / Math.max(displayPrizes.value.length, 1))

function polar(c, angle) {
  const rad = ((angle - 90) * Math.PI) / 180
  return { x: c + r * Math.cos(rad), y: c + r * Math.sin(rad) }
}
function arcPath(i) {
  const a0 = i * segAngle.value
  const a1 = (i + 1) * segAngle.value
  const p0 = polar(cx, a0)
  const p1 = polar(cx, a1)
  const large = segAngle.value > 180 ? 1 : 0
  return `M ${cx} ${cy} L ${p0.x} ${p0.y} A ${r} ${r} 0 ${large} 1 ${p1.x} ${p1.y} Z`
}
function textTransform(i) {
  const midAngle = (i + 0.5) * segAngle.value
  const rad = ((midAngle - 90) * Math.PI) / 180
  const tx = cx + r * 0.62 * Math.cos(rad)
  const ty = cy + r * 0.62 * Math.sin(rad)
  return `translate(${tx},${ty}) rotate(${midAngle})`
}

const colors = {
  legendary: ['#ff5252', '#ff8a80'],
  epic: ['#ab47bc', '#ce93d8'],
  rare: ['#42a5f5', '#90caf9'],
  common: ['#78909c', '#b0bec5'],
  none: ['#90a4ae', '#cfd8dc']
}
function colorStart(p) { return colors[p.rarity]?.[0] || colors.common[0] }
function colorEnd(p) { return colors[p.rarity]?.[1] || colors.common[1] }

function spin() {
  if (spinning.value) return
  spinning.value = true
  const spins = 5 + Math.floor(Math.random() * 4)
  rotation.value += spins * 360 + Math.random() * 360
  setTimeout(() => {
    spinning.value = false
  }, 3200)
}
defineExpose({ spin })
</script>

<style scoped>
.wheel-box {
  position: relative;
  width: 300px;
  height: 310px;
  margin: 0 auto;
}
.wheel {
  transition: transform 3.2s cubic-bezier(0.12, 0.8, 0.25, 1);
  filter: drop-shadow(0 12px 24px rgba(0,0,0,0.35));
  border-radius: 50%;
  background: #fff;
}
.hub {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -58%);
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #ffe082, #ffb300);
  display: grid;
  place-items: center;
  font-size: 20px;
  border: 4px solid #fff;
  box-shadow: 0 4px 10px rgba(0,0,0,0.3);
  z-index: 3;
  pointer-events: none;
}
.pointer {
  position: absolute;
  top: 4px;
  left: 50%;
  transform: translateX(-50%);
  width: 0;
  height: 0;
  border-left: 13px solid transparent;
  border-right: 13px solid transparent;
  border-top: 26px solid #e53935;
  z-index: 4;
  filter: drop-shadow(0 3px 4px rgba(0,0,0,0.3));
}
.spin-btn {
  position: absolute;
  bottom: -6px;
  left: 50%;
  transform: translateX(-50%);
  background: linear-gradient(135deg, #ff7043, #e53935);
  color: #fff;
  border: none;
  border-radius: 22px;
  padding: 10px 36px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 6px 16px rgba(229,57,53,0.4);
  transition: all 0.2s;
  white-space: nowrap;
}
.spin-btn:hover:not(:disabled) { filter: brightness(1.1); transform: translateX(-50%) translateY(-2px); }
.spin-btn:disabled { background: #546e7a; cursor: not-allowed; box-shadow: none; }
text { pointer-events: none; }
</style>