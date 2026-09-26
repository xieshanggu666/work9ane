<template>
  <div class="dash">
    <!-- 数据上下文提示 -->
    <div class="scope-banner">
      <span class="sb-icon">{{ store.activeTenant.icon }}</span>
      <div class="sb-text">
        <b>{{ store.activeTenant.name }}</b>
        <em>{{ store.isPlatform ? '平台跨租户巡检视图（当前选中租户）' : store.isCustomer ? '消费者视角：当前浏览租户的运营数据汇总' : '员工视图：仅本租户数据，其他租户强隔离' }}</em>
      </div>
      <span v-if="store.isPlatform" class="sb-tag platform">⚙️ 平台方</span>
      <span v-else-if="store.isOperator" class="sb-tag staff">🛡️ {{ store.roleLabelOf(store.currentMember?.roleKey) }}</span>
    </div>
    <div class="dash-grid">
      <!-- 统计卡片 -->
      <div class="stat-card">
        <span class="s-icon">🎯</span>
        <div class="s-num">{{ store.dashboard.totalDraws }}</div>
        <div class="s-lab">累计抽奖</div>
      </div>
      <div class="stat-card">
        <span class="s-icon">👥</span>
        <div class="s-num">{{ store.dashboard.participants }}</div>
        <div class="s-lab">参与人数</div>
      </div>
      <div class="stat-card">
        <span class="s-icon">🟢</span>
        <div class="s-num">{{ store.dashboard.running }}</div>
        <div class="s-lab">运行中活动</div>
      </div>
      <div class="stat-card">
        <span class="s-icon">💎</span>
        <div class="s-num">{{ store.dashboard.legendaryWins }}</div>
        <div class="s-lab">传说中奖</div>
      </div>
      <div class="stat-card">
        <span class="s-icon">🏆</span>
        <div class="s-num">{{ store.dashboard.epicWins }}</div>
        <div class="s-lab">史诗中奖</div>
      </div>
      <div class="stat-card">
        <span class="s-icon">🪙</span>
        <div class="s-num">{{ store.dashboard.pointsIssued }}</div>
        <div class="s-lab">已发放积分</div>
      </div>
      <div class="stat-card">
        <span class="s-icon">🛍️</span>
        <div class="s-num">{{ store.dashboard.goodsSold }}</div>
        <div class="s-lab">兑换商品</div>
      </div>
      <div class="stat-card">
        <span class="s-icon">🎯</span>
        <div class="s-num">{{ store.dashboard.taskSettlements }}</div>
        <div class="s-lab">任务自动结算</div>
      </div>
      <div class="stat-card risk">
        <span class="s-icon">🛡️</span>
        <div class="s-num warn">{{ store.dashboard.pendingRisk }}</div>
        <div class="s-lab">待风控处理</div>
      </div>
      <div class="stat-card risk">
        <span class="s-icon">🧊</span>
        <div class="s-num ice">{{ store.dashboard.frozenPoints }}</div>
        <div class="s-lab">冻结积分</div>
      </div>
      <div class="stat-card recon">
        <span class="s-icon">🧮</span>
        <div class="s-num recon-n">{{ store.dashboard.reconDays }}</div>
        <div class="s-lab">对账业务日</div>
      </div>
      <div class="stat-card recon">
        <span class="s-icon">📑</span>
        <div class="s-num warn">{{ store.dashboard.reconOpen }}</div>
        <div class="s-lab">待复核差异单</div>
      </div>
      <div class="stat-card recon">
        <span class="s-icon">🧾</span>
        <div class="s-num ok">{{ store.dashboard.reconCompensated }}</div>
        <div class="s-lab">对账补偿积分</div>
      </div>
      <div class="stat-card recon">
        <span class="s-icon">📦</span>
        <div class="s-num ice">{{ store.dashboard.stockAdjCount }}</div>
        <div class="s-lab">库存校正次数</div>
      </div>
      <div class="stat-card ship">
        <span class="s-icon">📮</span>
        <div class="s-num warn">{{ store.dashboard.shipPendingAddress }}</div>
        <div class="s-lab">待填收货地址</div>
      </div>
      <div class="stat-card ship">
        <span class="s-icon">📋</span>
        <div class="s-num" style="color:#82b1ff">{{ store.dashboard.shipToShip }}</div>
        <div class="s-lab">待运营发货</div>
      </div>
      <div class="stat-card ship">
        <span class="s-icon">🚚</span>
        <div class="s-num ok">{{ store.dashboard.shipShipped }}</div>
        <div class="s-lab">已发货待收货</div>
      </div>
      <div class="stat-card ship">
        <span class="s-icon">✅</span>
        <div class="s-num muted">{{ store.dashboard.shipReceived }}</div>
        <div class="s-lab">已完成收货</div>
      </div>
      <div class="stat-card ship">
        <span class="s-icon">🚫</span>
        <div class="s-num" style="color:#ef9a9a">{{ store.dashboard.shipReturned }}</div>
        <div class="s-lab">已退回发货单</div>
      </div>
      <div class="stat-card aftersale">
        <span class="s-icon">🛠️</span>
        <div class="s-num warn">{{ store.dashboard.afterSalePending }}</div>
        <div class="s-lab">售后待审核</div>
      </div>
      <div class="stat-card aftersale">
        <span class="s-icon">📋</span>
        <div class="s-num ok">{{ store.dashboard.afterSaleDone }}</div>
        <div class="s-lab">售后已完成</div>
      </div>
      <div class="stat-card aftersale">
        <span class="s-icon">📦</span>
        <div class="s-num" style="color:#82b1ff">{{ store.dashboard.shipReshipped }}</div>
        <div class="s-lab">补发发货单</div>
      </div>
      <div class="stat-card aftersale">
        <span class="s-icon">⏳</span>
        <div class="s-num" style="color:#ef9a9a">{{ store.dashboard.afterSaleWaiting }}</div>
        <div class="s-lab">售后待补货</div>
      </div>
      <div class="stat-card purchase">
        <span class="s-icon">🛒</span>
        <div class="s-num warn">{{ store.dashboard.purchasePending }}</div>
        <div class="s-lab">采购待审批</div>
      </div>
      <div class="stat-card purchase">
        <span class="s-icon">📥</span>
        <div class="s-num" style="color:#82b1ff">{{ store.dashboard.purchaseToInbound }}</div>
        <div class="s-lab">采购待入库</div>
      </div>
      <div class="stat-card purchase">
        <span class="s-icon">✅</span>
        <div class="s-num ok">{{ store.dashboard.purchaseReceived }}</div>
        <div class="s-lab">采购入库完成</div>
      </div>
      <div class="stat-card purchase">
        <span class="s-icon">📈</span>
        <div class="s-num purchase-n">{{ store.dashboard.purchaseInboundQty }}</div>
        <div class="s-lab">累计验收入库</div>
      </div>
      <div class="stat-card purchase">
        <span class="s-icon">⚠️</span>
        <div class="s-num" style="color:#ef9a9a">{{ store.dashboard.purchaseDiffClosed }}</div>
        <div class="s-lab">验收差异结案</div>
      </div>
      <div class="stat-card purchase">
        <span class="s-icon">🧾</span>
        <div class="s-num" style="color:#ffb74d">{{ store.dashboard.supplierReviewing + store.dashboard.supplierApproved }}</div>
        <div class="s-lab">账单待复核/待结算</div>
      </div>
      <div class="stat-card purchase">
        <span class="s-icon">💰</span>
        <div class="s-num ok">{{ store.dashboard.supplierSettled }}</div>
        <div class="s-lab">已结算供应商账单</div>
      </div>
      <div class="stat-card purchase">
        <span class="s-icon">💴</span>
        <div class="s-num" style="color:#ffd54f">¥{{ Number(store.dashboard.supplierPaid || 0).toFixed(0) }}</div>
        <div class="s-lab">累计已付供应商</div>
      </div>
      <div class="stat-card budget">
        <span class="s-icon">💹</span>
        <div class="s-num warn">{{ store.dashboard.budgetPending }}</div>
        <div class="s-lab">预算待财务审批</div>
      </div>
      <div class="stat-card budget">
        <span class="s-icon">✅</span>
        <div class="s-num ok">{{ store.dashboard.budgetActive }}</div>
        <div class="s-lab">生效中预算</div>
      </div>
      <div class="stat-card budget">
        <span class="s-icon">⛔</span>
        <div class="s-num" style="color:#ef9a9a">{{ store.dashboard.budgetOverrun }}</div>
        <div class="s-lab">超支预算</div>
      </div>
      <div class="stat-card budget">
        <span class="s-icon">🪙</span>
        <div class="s-num" style="color:#ffd54f">{{ Number(store.dashboard.budgetOccupiedPoints || 0).toLocaleString() }}</div>
        <div class="s-lab">积分预算已占用</div>
      </div>
      <div class="stat-card budget">
        <span class="s-icon">💰</span>
        <div class="s-num" style="color:#ce93d8">¥{{ Number(store.dashboard.budgetOccupiedMoney || 0).toFixed(0) }}</div>
        <div class="s-lab">资金预算已占用</div>
      </div>
      <div class="stat-card coupon">
        <span class="s-icon">🎟️</span>
        <div class="s-num coupon-n">{{ store.dashboard.couponIssued }}</div>
        <div class="s-lab">累计发券</div>
      </div>
      <div class="stat-card coupon">
        <span class="s-icon">✅</span>
        <div class="s-num" style="color:#ce93d8">{{ store.dashboard.couponAvailable }}</div>
        <div class="s-lab">待核销卡券</div>
      </div>
      <div class="stat-card coupon">
        <span class="s-icon">🎬</span>
        <div class="s-num muted">{{ store.dashboard.couponRedeemed }}</div>
        <div class="s-lab">已核销卡券</div>
      </div>
      <div class="stat-card coupon">
        <span class="s-icon">⏰</span>
        <div class="s-num" style="color:#ef9a9a">{{ store.dashboard.couponExpired }}</div>
        <div class="s-lab">已过期卡券</div>
      </div>
      <div class="stat-card coupon">
        <span class="s-icon">🧊</span>
        <div class="s-num ice">{{ store.dashboard.couponHeld }}</div>
        <div class="s-lab">券预占待交付</div>
      </div>
    </div>

    <!-- 活动概览 + 库存 -->
    <div class="dash-cards">
      <div class="card">
        <div class="card-title">🛡️ 活动库 · {{ store.activeTenant.shortName }}</div>
        <div v-for="a in scopedActivities" :key="a.id" class="act-row">
          <span class="a-icon">{{ a.icon }}</span>
          <div class="a-info">
            <div class="a-name">{{ a.name }}</div>
            <div class="a-meta">{{ statusLabel(a.status) }} · {{ a.type==='wheel'?'幸运转盘':'刮刮乐' }} · {{ a.startAt }} ~ {{ a.endAt }}</div>
          </div>
          <span class="a-status" :class="a.status">{{ statusLabel(a.status) }}</span>
        </div>
      </div>

      <div class="card">
        <div class="card-title">📦 奖品库存</div>
        <div v-for="a in scopedActivities" :key="'st'+a.id" class="stock-block">
          <div class="sb-name">{{ a.name }}</div>
          <div class="sb-list">
            <div v-for="p in a.prizes.filter(x=>x.rarity!=='none')" :key="p.id" class="sb-item">
              <div class="sb-bar">
                <i :style="{ width: p.stock ? (p.remain/p.stock*100)+'%' : '0%' }"></i>
              </div>
              <span class="sb-txt">{{ p.name }} <b>{{ p.remain }}</b>/{{ p.stock
                }}<i v-if="p.frozen" class="sb-frozen">🧊{{ p.frozen }}</i></span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 中奖记录（当前租户） -->
    <div class="card full">
      <div class="card-title">🏅 中奖与兑换记录 · {{ store.activeTenant.shortName }}</div>
      <div v-if="scopedRecords.length===0" class="empty">暂无记录</div>
      <div class="rec-row" v-for="r in scopedRecords" :key="r.id" :class="{ revoked: r.status==='revoked' }">
        <span class="r-icon">{{ r.icon }}</span>
        <span class="r-note">{{ r.type==='draw' ? r.prizeName : r.goodsName }}</span>
        <span class="r-src">{{ r.type==='draw' ? r.activityName : '积分商城' }}</span>
        <span class="r-rarity" v-if="r.rarity" :style="{background: rarityColor(r.rarity)}">{{ rarityLabel(r.rarity) }}</span>
        <span v-if="r.status==='frozen'" class="r-badge frozen">🧊 风控审核中</span>
        <span v-else-if="r.status==='released'" class="r-badge released">✅ 审核放行</span>
        <span v-else-if="r.status==='revoked'" class="r-badge revoked">❌ 已撤销</span>
        <span v-if="couponOf(r.id)" class="r-badge coupon-b" :class="couponOf(r.id).status">🎟️ {{ couponMeta(couponOf(r.id).status).label }}</span>
        <span v-if="shipOf(r.id)" class="r-badge ship-b" :class="shipOf(r.id).status">📦 {{ shipMeta(shipOf(r.id).status).label }}</span>
        <span class="r-time">{{ r.date }} {{ r.time }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { usePlatformStore, SHIP_STATUS, COUPON_STATUS } from '@/store/platform'
import { PRIZE_RARITY } from '@/mock/data'
const store = usePlatformStore()
const statusLabel = (s) => ({ running: '进行中', paused: '已暂停', ended: '已结束' }[s] || s)
const rarityLabel = (r) => PRIZE_RARITY[r]?.label || r
const rarityColor = (r) => PRIZE_RARITY[r]?.color || '#777'
const shipOf = (id) => store.shipmentOfRecord(id)
const shipMeta = (s) => SHIP_STATUS[s] || { label: s }
const couponOf = (id) => store.couponOfRecord(id)
const couponMeta = (s) => COUPON_STATUS[s] || { label: s }
// 当前数据上下文租户的活动与业务记录
const scopedActivities = computed(() => store.activities.filter((a) => a.tenantId === store.activeTenantId))
const scopedRecords = computed(() =>
  [...store.scopedRecords].sort((a, b) => (b.ts || 0) - (a.ts || 0))
)
</script>

<style scoped>
.dash { display: flex; flex-direction: column; gap: 16px; }
.scope-banner {
  display: flex; align-items: center; gap: 12px;
  background: linear-gradient(135deg,#13264f,#1a2c5e); border: 1px solid rgba(120,160,220,0.25);
  border-radius: 12px; padding: 12px 16px;
}
.sb-icon { font-size: 26px; }
.sb-text { display: flex; flex-direction: column; }
.sb-text b { color: #fff; font-size: 14px; }
.sb-text em { font-style: normal; font-size: 10.5px; color: #8ba2c8; margin-top: 2px; }
.sb-tag { margin-left: auto; font-size: 11px; padding: 4px 11px; border-radius: 10px; }
.sb-tag.platform { background: rgba(255,152,0,0.18); color: #ffb74d; }
.sb-tag.staff { background: rgba(66,165,245,0.18); color: #82b1ff; }
.dash-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
@media (max-width: 900px) { .dash-grid { grid-template-columns: repeat(2, 1fr); } }
.stat-card {
  background: linear-gradient(160deg, #13264f, #0f1b38);
  border: 1px solid rgba(120,160,220,0.16); border-radius: 12px;
  padding: 14px; text-align: center;
}
.s-icon { font-size: 22px; }
.s-num { font-size: 26px; font-weight: 800; color: #4d8dff; margin: 6px 0 0; }
.stat-card.risk { border-color: rgba(255,152,0,0.35); }
.stat-card.recon { border-color: rgba(77,182,172,0.35); }
.stat-card.ship { border-color: rgba(76,175,80,0.35); }
.stat-card.purchase { border-color: rgba(142,36,170,0.4); }
.stat-card.budget { border-color: rgba(255,179,0,0.5); }
.stat-card.coupon { border-color: rgba(171,71,188,0.4); }
.stat-card.aftersale { border-color: rgba(255,204,128,0.4); }
.s-num.recon-n { color: #4db6ac; }
.s-num.coupon-n { color: #ce93d8; }
.s-num.purchase-n { color: #ce93d8; }
.s-num.warn { color: #ffb74d; }
.s-num.ice { color: #81d4fa; }
.s-num.ok { color: #7ef0c9; }
.s-num.muted { color: #b0bec5; }
.s-lab { font-size: 11px; color: #8ba2c8; margin-top: 2px; }

.dash-cards { display: grid; grid-template-columns: 1.2fr 1fr; gap: 16px; }
@media (max-width: 900px) { .dash-cards { grid-template-columns: 1fr; } }
.card {
  background: #0f1b38; border: 1px solid rgba(120,160,220,0.16);
  border-radius: 14px; padding: 16px;
}
.card.full { grid-column: 1 / -1; }
.card-title { font-size: 15px; font-weight: 700; color: #fff; margin-bottom: 12px; }

.act-row { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px dashed rgba(120,160,220,0.12); }
.act-row:last-child { border-bottom: none; }
.a-icon { font-size: 22px; }
.a-info { flex: 1; min-width: 0; }
.a-name { font-size: 13px; color: #e8eefb; }
.a-meta { font-size: 10px; color: #6f84ab; margin-top: 2px; }
.a-status { font-size: 10px; padding: 2px 8px; border-radius: 4px; }
.a-status.running { background: rgba(76,175,80,0.15); color: #7ef0c9; }
.a-status.paused { background: rgba(255,152,0,0.15); color: #ff9800; }
.a-status.ended { background: rgba(158,158,158,0.15); color: #90a4ae; }

.stock-block { margin-bottom: 12px; }
.sb-name { font-size: 12px; color: #8ba2c8; margin-bottom: 6px; font-weight: 600; }
.sb-item { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; font-size: 11px; }
.sb-bar { flex: 1; height: 6px; background: #0c1730; border-radius: 3px; overflow: hidden; }
.sb-bar i { display: block; height: 100%; background: linear-gradient(90deg,#4d8dff,#7e9ff5); border-radius: 3px; }
.sb-txt { color: #aebadd; width: 150px; text-align: right; flex-shrink: 0; }
.sb-txt b { color: #ffc107; }
.sb-frozen { color: #81d4fa; font-style: normal; font-size: 10px; margin-left: 5px; }

.empty { color: #5b6f94; text-align: center; padding: 20px; font-size: 12px; }
.rec-row.revoked .r-note { text-decoration: line-through; color: #7e8fa8; }
.r-badge { font-size: 10px; padding: 1px 7px; border-radius: 4px; white-space: nowrap; }
.r-badge.frozen { background: rgba(129,212,250,0.15); color: #81d4fa; }
.r-badge.released { background: rgba(76,175,80,0.15); color: #7ef0c9; }
.r-badge.revoked { background: rgba(144,164,174,0.15); color: #b0bec5; }
.r-badge.ship-b { margin-left: 2px; }
.r-badge.ship-b.pending_address { background: rgba(255,152,0,0.15); color: #ffb74d; }
.r-badge.ship-b.to_ship { background: rgba(66,165,245,0.15); color: #82b1ff; }
.r-badge.ship-b.shipped { background: rgba(76,175,80,0.15); color: #7ef0c9; }
.r-badge.ship-b.received { background: rgba(144,164,174,0.15); color: #b0bec5; }
.r-badge.coupon-b.available { background: rgba(171,71,188,0.2); color: #ce93d8; }
.r-badge.coupon-b.redeemed { background: rgba(144,164,174,0.15); color: #b0bec5; }
.r-badge.coupon-b.expired { background: rgba(84,110,123,0.25); color: #90a4ae; }
.rec-row {
  display: flex; align-items: center; gap: 10px; padding: 7px 0;
  border-bottom: 1px dashed rgba(120,160,220,0.1); font-size: 12px;
}
.rec-row:last-child { border-bottom: none; }
.r-note { flex: 1; color: #e8eefb; }
.r-src { color: #6f84ab; font-size: 11px; }
.r-rarity { font-size: 9px; color: #fff; padding: 1px 6px; border-radius: 3px; }
.r-time { color: #8ba2c8; font-size: 11px; }
</style>