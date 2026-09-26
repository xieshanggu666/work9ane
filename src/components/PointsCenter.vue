<template>
  <div class="points-view">
    <!-- 积分横幅 -->
    <div class="balance-banner">
      <div class="bb-left">
        <span class="bb-avatar">{{ store.user.avatar }}</span>
        <div>
          <div class="bb-name">{{ store.user.name }}</div>
          <div class="bb-sub">积分中心 · {{ store.todayDate }}</div>
        </div>
      </div>
      <div class="bb-points">
        <template v-if="store.isCustomer">
          <span class="bp-num">{{ store.points }}</span>
          <span class="bp-lab">可用积分</span>
          <span v-if="store.frozenPoints > 0" class="bp-frozen" @click="store.gotoTab('risk')">
            🧊 冻结 {{ store.frozenPoints }} 积分（点击查看）
          </span>
        </template>
        <template v-else>
          <span class="bp-num staff">{{ store.activeTenant.icon }}</span>
          <span class="bp-lab">{{ store.activeTenant.shortName }} · 积分运营只读视图</span>
        </template>
      </div>
    </div>

    <!-- 风控审核中快捷入口 -->
    <div v-if="store.pendingRiskCount" class="risk-entry" @click="store.gotoTab('risk')">
      <span>🛡️ 你有 <b>{{ store.pendingRiskCount }}</b> 笔抽奖/兑换正在风控审核中，可前往申诉或查看进度</span>
      <span class="re-go">去处理 ›</span>
    </div>

    <!-- 实物收货待办快捷入口 -->
    <div v-if="store.myShipTodoCount" class="ship-entry" @click="store.gotoTab('shipping')">
      <span>📦 你有 <b>{{ store.myShipTodoCount }}</b> 件实物待处理：
        待填地址 {{ store.shipmentStats.pendingAddress }} 件 · 待确认收货 {{ store.shipmentStats.shipped }} 件</span>
      <span class="re-go">去填写 / 查看 ›</span>
    </div>

    <!-- 卡券账户快捷入口 -->
    <div class="coupon-entry" @click="store.gotoTab('coupon')">
      <span>🎟️ 你有 <b>{{ store.myCouponTodoCount }}</b> 张待核销卡券
        <template v-if="store.myHeldCoupons.length"> · 🧊 {{ store.myHeldCoupons.length }} 张风控预占待交付</template>
      </span>
      <span class="re-go">出示券码 / 查看 ›</span>
    </div>

    <div class="points-grid">
      <!-- 任务列表 -->
      <div class="card">
        <div class="card-title">📝 积分任务</div>
        <div v-for="t in store.tasks" :key="t.id" class="task-row">
          <span class="t-icon">{{ t.icon }}</span>
          <div class="t-info">
            <div class="t-label">{{ t.label }}</div>
            <div class="t-type">
              {{ t.type === 'daily' ? '每日' : '一次性' }}
              <template v-if="t.metric === 'draw'"> · 按真实参与自动结算</template>
            </div>
            <!-- 抽奖任务：真实参与进度条 + 风控暂缓提示 -->
            <template v-if="t.metric === 'draw'">
              <div class="t-progress">
                <div class="tp-bar"><i :style="{ width: Math.min(100, (drawState(t.id).progress / t.goal) * 100) + '%' }"></i></div>
                <span class="tp-num">{{ Math.min(drawState(t.id).progress, t.goal) }}/{{ t.goal }}</span>
              </div>
              <div v-if="drawState(t.id).pending" class="t-hold">🧊 {{ drawState(t.id).pending }} 笔风控审核中，暂缓计入</div>
            </template>
          </div>
          <span class="t-reward">+{{ t.reward }}</span>
          <button
            v-if="t.metric === 'draw'"
            class="t-btn"
            :class="{ claimed: drawState(t.id).claimed }"
            disabled
          >{{ drawState(t.id).claimed ? '已结算' : (drawState(t.id).done ? '结算中' : '未达成') }}</button>
          <button
            v-else
            class="t-btn"
            :class="{ claimed: t.claimed, noperm: !store.isCustomer }"
            :disabled="t.claimed || !store.isCustomer"
            :title="!store.isCustomer ? '员工身份不参与任务领奖' : ''"
            @click="store.completeTask(t.id)"
          >{{ !store.isCustomer ? '仅消费者' : (t.claimed ? '已领取' : (t.done ? '去领取' : (t.id==='t-checkin' ? '签到' : '完成'))) }}</button>
        </div>
      </div>

      <!-- 积分商城 -->
      <div class="card">
        <div class="card-title">🛍️ 积分商城</div>
        <div class="goods-list">
          <div v-for="g in scopedGoods" :key="g.id" class="goods">
            <span class="g-icon">{{ g.icon }}</span>
            <div class="g-info">
              <div class="g-name">{{ g.name }}
                <i class="g-kind" :class="g.physical ? 'physical' : (g.couponId ? 'coupon' : 'virtual')">{{ g.physical ? '实物·需收货' : (g.couponId ? '券类·发券核销' : '虚拟·即到账') }}</i>
              </div>
              <div class="g-stock">
                可兑 {{ g.remain }}
                <span v-if="g.frozen" class="g-frozen">· 🧊 预占 {{ g.frozen }}</span>
              </div>
            </div>
            <div class="g-btns">
              <span class="g-cost">🪙{{ g.cost }}</span>
              <button class="g-btn" :disabled="g.remain<=0 || store.points < g.cost || !store.isCustomer"
                      :title="!store.isCustomer ? '员工身份不参与兑换' : ''"
                      @click="store.redeem(g.id)">{{ store.isCustomer ? '兑换' : '仅消费者' }}</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 任务结算记录（按业务日归档：进度与领奖记录跨日不串账） -->
      <div class="card span2">
        <div class="card-title">🗓️ 任务结算记录（按业务日 · {{ store.activeTenant.shortName }}）</div>
        <div v-if="!scopedTaskDayBooks.length" class="empty">暂无任务结算记录</div>
        <div v-for="day in scopedTaskDayBooks" :key="day.date" class="day-block">
          <div class="d-head">
            <span class="d-date">{{ day.date }}</span>
            <span v-if="day.isToday" class="d-today">今天</span>
          </div>
          <div v-for="tt in day.tasks" :key="tt.taskId" class="d-row">
            <span class="d-label">{{ tt.label }}</span>
            <span class="d-prog">进度 {{ Math.min(tt.progress, tt.goal) }}/{{ tt.goal }}</span>
            <span v-if="tt.pending" class="d-tag hold">🧊 {{ tt.pending }} 笔审核中暂缓</span>
            <span v-if="tt.claim" class="d-tag ok">
              ✅ 已结算 +{{ tt.claim.reward }}
              <em v-if="tt.claim.grantDate !== day.date" class="d-cross">（{{ tt.claim.grantDate }} 跨日补计）</em>
            </span>
            <span v-else class="d-tag open">未达成</span>
          </div>
        </div>
      </div>

      <!-- 积分流水 -->
      <div class="card span2">
        <div class="card-title">📜 积分流水
          <span class="flow-scope">{{ store.isOperator ? store.activeTenant.shortName + ' · 本租户全部流水' : store.activeTenant.shortName + ' · 我的流水' }}</span>
        </div>
        <div v-if="scopedFlows.length===0" class="empty">暂无记录</div>
        <div class="flow-row" v-for="p in scopedFlows" :key="p.id">
          <span class="f-note">{{ p.note }}
            <i v-if="p.kind === 'frozen'" class="f-tag frozen">冻结中</i>
            <i v-else-if="p.kind === 'refund'" class="f-tag refund">已返还</i>
            <i v-else-if="p.kind === 'release'" class="f-tag release">审核放行</i>
            <i v-else-if="p.kind === 'task-comp'" class="f-tag comp">对账补记</i>
            <i v-else-if="p.kind === 'recon-comp'" class="f-tag comp">对账补偿</i>
            <em v-if="p.bizDate && p.bizDate !== p.date" class="f-cross">归属 {{ p.bizDate }}</em>
          </span>
          <span class="f-time">{{ p.time }} · {{ p.date }}</span>
          <span class="f-balance">余额 {{ p.balance }}</span>
          <span class="f-delta" :class="p.delta > 0 ? 'plus' : 'minus'">{{ p.delta > 0 ? '+' : '' }}{{ p.delta }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { usePlatformStore } from '@/store/platform'
const store = usePlatformStore()
// 抽奖任务当日状态（进度/达标/已结算/审核中笔数），由真实参与记录推导
const drawState = (taskId) => store.drawTaskState(taskId)

// 当前数据上下文租户的商城商品
const scopedGoods = computed(() => store.goods.filter((g) => (g.tenantId || 't-star') === store.activeTenantId))
// 当前租户的积分流水（员工看本租户全部，消费者看本人——流水均为演示消费者 u-1001 产生）
const scopedFlows = computed(() =>
  [...store.scopedPointRecords].sort((a, b) => b.ts - a.ts)
)
// 任务结算台账（按租户过滤后的业务日账册，结构与 store.taskDayBooks 对齐）
const scopedTaskDayBooks = computed(() => {
  const drawTasks = store.tasks.filter((t) => t.metric === 'draw')
  const dates = new Set()
  store.taskClaims
    .filter((c) => (c.tenantId || 't-star') === store.activeTenantId)
    .forEach((c) => dates.add(c.bizDate))
  store.scopedRecords.filter((r) => r.type === 'draw').forEach((r) => dates.add(r.date))
  return [...dates].sort().reverse().map((date) => ({
    date,
    isToday: date === store.todayDate,
    tasks: drawTasks.map((t) => {
      const claim = store.taskClaims.find((c) =>
        c.taskId === t.id && c.bizDate === date && (c.tenantId || 't-star') === store.activeTenantId)
      return {
        taskId: t.id,
        label: t.label,
        goal: t.goal,
        progress: Math.min(store.validDrawCount(date), t.goal),
        pending: store.pendingDrawCount(date),
        claim
      }
    })
  }))
})
</script>

<style scoped>
.points-view { max-width: 960px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
.balance-banner {
  display: flex; align-items: center; justify-content: space-between;
  background: linear-gradient(135deg, #1c3c8f, #2962ff);
  border-radius: 14px; padding: 18px 22px; box-shadow: 0 8px 20px rgba(41,98,255,0.3);
}
.bb-left { display: flex; align-items: center; gap: 12px; }
.bb-avatar {
  width: 46px; height: 46px; border-radius: 50%; background: rgba(255,255,255,0.2);
  display: grid; place-items: center; font-size: 24px;
}
.bb-name { color: #fff; font-weight: 700; }
.bb-sub { color: rgba(255,255,255,0.7); font-size: 11px; margin-top: 2px; }
.bb-points { display: flex; flex-direction: column; align-items: flex-end; }
.bp-num { font-size: 34px; font-weight: 800; color: #ffd54f; line-height: 1; }
.bp-num.staff { font-size: 26px; }
.flow-scope { font-size: 10px; color: #8ba2c8; font-weight: 400; margin-left: 8px; }
.bp-lab { color: rgba(255,255,255,0.8); font-size: 11px; margin-top: 4px; }
.bp-frozen {
  margin-top: 6px; font-size: 11px; color: #b3e5fc; cursor: pointer;
  background: rgba(255,255,255,0.12); padding: 3px 10px; border-radius: 10px;
}
.bp-frozen:hover { background: rgba(255,255,255,0.22); }

.risk-entry {
  display: flex; align-items: center; justify-content: space-between;
  background: rgba(255,152,0,0.1); border: 1px solid rgba(255,152,0,0.35);
  border-radius: 12px; padding: 12px 16px; font-size: 13px; color: #ffcc80; cursor: pointer;
}
.risk-entry b { color: #ffb74d; font-size: 15px; }
.risk-entry .re-go { color: #ffe0b2; font-weight: 700; }
.risk-entry:hover { background: rgba(255,152,0,0.16); }

.ship-entry {
  display: flex; align-items: center; justify-content: space-between;
  background: rgba(76,175,80,0.1); border: 1px solid rgba(76,175,80,0.35);
  border-radius: 12px; padding: 12px 16px; font-size: 13px; color: #b9e3bd; cursor: pointer;
}
.ship-entry b { color: #8be09a; font-size: 15px; }
.ship-entry .re-go { color: #c8e6c9; font-weight: 700; }
.ship-entry:hover { background: rgba(76,175,80,0.16); }

.coupon-entry {
  display: flex; align-items: center; justify-content: space-between;
  background: rgba(171,71,188,0.1); border: 1px solid rgba(171,71,188,0.35);
  border-radius: 12px; padding: 12px 16px; font-size: 13px; color: #e1bee7; cursor: pointer;
}
.coupon-entry b { color: #ce93d8; font-size: 15px; }
.coupon-entry .re-go { color: #f3e5f5; font-weight: 700; }
.coupon-entry:hover { background: rgba(171,71,188,0.18); }

.points-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 860px) { .points-grid { grid-template-columns: 1fr; } .span2 { grid-column: auto !important; } .card { grid-column: auto !important; } }
.card {
  background: #0f1b38; border: 1px solid rgba(120,160,220,0.16);
  border-radius: 14px; padding: 16px;
}
.span2 { grid-column: 1 / -1; }
.card-title { font-size: 15px; font-weight: 700; color: #fff; margin-bottom: 12px; }

.task-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px dashed rgba(120,160,220,0.12); }
.task-row:last-child { border-bottom: none; }
.t-icon { font-size: 20px; }
.t-info { flex: 1; min-width: 0; }
.t-label { font-size: 13px; color: #dbe4f3; }
.t-type { font-size: 10px; color: #6f84ab; }
.t-reward { font-size: 12px; color: #ffc107; font-weight: 700; }
.t-btn {
  background: linear-gradient(135deg,#ffb300,#ff8f00); color: #fff; border: none;
  border-radius: 12px; padding: 6px 12px; font-size: 12px; cursor: pointer;
}
.t-btn.claimed, .t-btn:disabled { background: #2a3a5e; color: #6f84ab; cursor: default; }
.t-progress { display: flex; align-items: center; gap: 8px; margin-top: 5px; }
.tp-bar { flex: 1; max-width: 140px; height: 5px; background: #0c1730; border-radius: 3px; overflow: hidden; }
.tp-bar i { display: block; height: 100%; background: linear-gradient(90deg,#ffb300,#ff8f00); border-radius: 3px; transition: width 0.3s; }
.tp-num { font-size: 10px; color: #ffc107; font-weight: 700; }
.t-hold { font-size: 10px; color: #81d4fa; margin-top: 3px; }

.day-block { padding: 8px 0; border-bottom: 1px dashed rgba(120,160,220,0.12); }
.day-block:last-child { border-bottom: none; }
.d-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.d-date { font-size: 12px; font-weight: 700; color: #aebadd; }
.d-today {
  font-size: 9px; background: rgba(41,98,255,0.2); color: #82b1ff;
  padding: 1px 7px; border-radius: 4px;
}
.d-row { display: flex; align-items: center; gap: 10px; padding: 4px 0 4px 2px; font-size: 12px; flex-wrap: wrap; }
.d-label { color: #dbe4f3; min-width: 90px; }
.d-prog { color: #8ba2c8; font-size: 11px; }
.d-tag { font-style: normal; font-size: 10px; padding: 2px 8px; border-radius: 5px; }
.d-tag.ok { background: rgba(76,175,80,0.14); color: #7ef0c9; }
.d-tag.hold { background: rgba(129,212,250,0.12); color: #81d4fa; }
.d-tag.open { background: rgba(120,160,220,0.1); color: #8ba2c8; }
.d-cross { font-style: normal; color: #ffd54f; }

.goods-list { display: flex; flex-direction: column; gap: 8px; }
.goods {
  display: flex; align-items: center; gap: 10px;
  background: rgba(20,34,66,0.5); border: 1px solid rgba(120,160,220,0.12);
  border-radius: 9px; padding: 9px;
}
.g-icon { font-size: 22px; }
.g-info { flex: 1; min-width: 0; }
.g-name { font-size: 13px; color: #e8eefb; }
.g-kind { font-style: normal; font-size: 9px; padding: 1px 6px; border-radius: 4px; margin-left: 5px; vertical-align: middle; }
.g-kind.physical { background: rgba(76,175,80,0.16); color: #7ef0c9; }
.g-kind.virtual { background: rgba(120,160,220,0.12); color: #8ba2c8; }
.g-kind.coupon { background: rgba(171,71,188,0.22); color: #ce93d8; }
.g-stock { font-size: 10px; color: #6f84ab; }
.g-frozen { color: #81d4fa; }
.g-btns { display: flex; align-items: center; gap: 8px; }
.g-cost { font-size: 12px; color: #ffc107; font-weight: 700; }
.g-btn {
  background: linear-gradient(135deg,#66bb6a,#43a047); color: #fff; border: none;
  border-radius: 10px; padding: 6px 12px; font-size: 12px; cursor: pointer;
}
.g-btn:disabled { background: #2a3a5e; color: #6f84ab; cursor: default; }

.empty { color: #5b6f94; text-align: center; padding: 20px; font-size: 12px; }
.flow-row {
  display: flex; align-items: center; gap: 10px; padding: 7px 0;
  border-bottom: 1px dashed rgba(120,160,220,0.1); font-size: 12px;
}
.flow-row:last-child { border-bottom: none; }
.f-note { flex: 1; color: #c6d2e6; }
.f-time { color: #6f84ab; font-size: 11px; }
.f-balance { color: #8ba2c8; font-size: 11px; }
.f-delta { font-weight: 700; min-width: 40px; text-align: right; }
.f-delta.plus { color: #7ef0c9; }
.f-delta.minus { color: #ef9a9a; }
.f-tag { font-style: normal; font-size: 9px; padding: 1px 6px; border-radius: 4px; margin-left: 6px; vertical-align: middle; }
.f-tag.frozen { background: rgba(129,212,250,0.15); color: #81d4fa; }
.f-tag.refund { background: rgba(126,240,201,0.13); color: #7ef0c9; }
.f-tag.release { background: rgba(76,175,80,0.16); color: #a5d6a7; }
.f-tag.comp { background: rgba(77,182,172,0.18); color: #4db6ac; }
.f-cross { font-style: normal; font-size: 9px; color: #ffd54f; margin-left: 6px; }
</style>