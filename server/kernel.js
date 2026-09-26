// 服务端内核：事件溯源（WAL）+ 状态投影 + 幂等表 + 按键互斥锁 + 时钟/故障注入
// 所有业务写操作只允许通过 commit() 追加事件；重启时重放 WAL 完整恢复状态。
import { Journal, genId, nowTime, todayStr as _todayStr, BizError } from './util.js'

export class Kernel {
  constructor(dbFile = 'data/server-wal.jsonl') {
    this.dbFile = dbFile
    this.journal = new Journal(dbFile)
    // 可重写时钟（跨日审核/续办测试用）：{ fixedDay: 'YYYY-MM-DD' | null, offsetMs }
    this.clock = { fixedDay: null, offsetDays: 0 }
    this._mono = 0 // 同一毫秒内严格单调
    // 故障注入点（一次性）：name -> { when: 'before'|'after' }（当前均为提交后抛出）
    this.faults = new Map()
    this.crashes = [] // 实际触发记录（观测用）
    this.state = this.emptyState()
  }

  emptyState() {
    return {
      tenants: [], members: [], customRoles: [],
      activities: [], goods: [], tasks: [], couponTpls: [],
      pointFlows: [], balances: {},
      records: [], riskOrders: [], taskClaims: [],
      coupons: [], couponLogs: [],
      shipments: [], afterSales: [],
      purchaseOrders: [], inboundBatches: [],
      acceptDiffs: [], supplierBills: [],
      budgets: [], budgetLedger: [],
      reconBills: [], stockAdjustments: [],
      auditLogs: [],
      migrations: [],      // 历史台账迁移批次（manifest；幂等判重 + 校验和留痕）
      effects: new Set(),  // 已生效的副作用 effectId（库存变动/积分记账等，断点重放/续办据此去重）
      riskRules: {},
      idem: new Map(),     // 幂等键 → 首次执行结果（扣分预占/发奖统一判重）
      sagaStages: new Map() // tradeId → [{ stage, at, runId, traceId }]
    }
  }

  // —— 时钟 ——
  todayDate() {
    if (this.clock.fixedDay) return this.clock.fixedDay
    const d = new Date()
    d.setDate(d.getDate() + this.clock.offsetDays)
    return _todayStr(d)
  }
  nowTs() {
    let base
    if (this.clock.fixedDay) {
      // 固定业务日下用当日真实时分秒，但保证单调推进（跨日审核时事件仍可排序）
      const d = new Date(`${this.clock.fixedDay}T${nowTime()}.000`)
      base = d.getTime()
    } else {
      base = Date.now() + this.clock.offsetDays * 86400000
    }
    this._mono += 1
    const last = this._lastTs || 0
    this._lastTs = Math.max(base, last + 1)
    return this._lastTs
  }
  nowTime() {
    return nowTime(new Date())
  }
  setBusinessDay(day) { this.clock.fixedDay = day; return day }
  advanceDay(n = 1) {
    if (this.clock.fixedDay) {
      const d = new Date(`${this.clock.fixedDay}T00:00:00`)
      d.setDate(d.getDate() + n)
      this.clock.fixedDay = _todayStr(d)
    } else this.clock.offsetDays += n
    return this.todayDate()
  }

  // —— 故障注入（一次性，命中即抛 CrashError 模拟进程在该点宕机）——
  injectFault(name) { this.faults.set(name, true) }
  maybeFault(name) {
    if (this.faults.delete(name)) {
      this.crashes.push({ name, at: this.nowTs(), day: this.todayDate() })
      throw new BizError('CRASH_INJECTED', `💥 故障注入：${name}（进程在该点中断，等待续办）`, 500, { injected: true, fault: name })
    }
  }

  // —— 启动：打开 WAL 并重放恢复 ——
  async boot() {
    await this.journal.open()
    await this.recover()
    return this.state
  }

  async recover() {
    const events = await this.journal.replay()
    this.state = this.emptyState()
    for (const e of events) this.apply(e)
    return { events: events.length }
  }

  // —— 事件提交：先持久化（WAL append），再投影到内存态 ——
  // 一批 events 逻辑上属于同一原子业务动作；崩溃可能发生在批次中间，
  // 重放后由各服务基于幂等表/状态机判定补齐（saga 续办）。
  async commit(events) {
    for (const e of events) {
      if (!e.ts) e.ts = this.nowTs()
      await this.journal.append(e)
      this.apply(e)
    }
  }

  apply(e) {
    const st = this.state
    switch (e.type) {
      case 'upsert': {
        const list = st[e.table]
        const i = list.findIndex((r) => r.id === e.row.id)
        if (i >= 0) list[i] = e.row
        else list.push(e.row)
        break
      }
      case 'insert': {
        if (!st[e.table].some((r) => r.id === e.row.id)) st[e.table].push(e.row)
        break
      }
      case 'points.post': {
        // 幂等：同一 effectId 的积分记账只生效一次（崩溃重放/故障续办不重复扣分发奖）
        if (e.effectId) {
          if (st.effects.has(e.effectId)) {
            break
          }
          st.effects.add(e.effectId)
        }
        st.pointFlows.push(e.flow)
        st.balances[e.flow.userId] = (st.balances[e.flow.userId] || 0) + e.flow.delta
        e.flow.balance = st.balances[e.flow.userId] // 强制余额快照与投影一致
        break
      }
      case 'inv.mut': {
        // 幂等：同一 effectId 的库存变动只生效一次（预占/核销/回补/补偿续办安全重放）
        if (e.effectId) {
          if (st.effects.has(e.effectId)) break
          st.effects.add(e.effectId)
        }
        const target = this.findStock(e.key)
        if (target) {
          target.row.remain += e.dRemain
          target.row.frozen = (target.row.frozen || 0) + e.dFrozen
          if (e.dStock) target.row.stock = (target.row.stock || 0) + e.dStock
        }
        break
      }
      case 'idem.put':
        st.idem.set(e.key, { result: e.result, at: e.at || Date.now() })
        break
      case 'saga.stage': {
        const arr = st.sagaStages.get(e.tradeId) || []
        arr.push({ stage: e.stage, at: e.at, runId: e.runId, traceId: e.traceId })
        st.sagaStages.set(e.tradeId, arr)
        break
      }
      case 'risk-rules.put':
        st.riskRules[e.tenantId] = e.rules
        break
      default:
        throw new Error(`未知事件类型: ${e.type}`)
    }
  }

  // 库存定位：key 形如 prize:<activityId>:<prizeId> / goods:<goodsId>
  stockKeyOf(targetType, refId, targetId) {
    return targetType === 'prize' ? `prize:${refId}:${targetId}` : `goods:${targetId}`
  }
  findStock(key) {
    if (key.startsWith('prize:')) {
      const rest = key.slice('prize:'.length)
      const idx = rest.indexOf(':')
      const activityId = rest.slice(0, idx)
      const prizeId = rest.slice(idx + 1)
      const a = this.state.activities.find((x) => x.id === activityId)
      const row = a?.prizes.find((p) => p.id === prizeId)
      return row ? { row, kind: 'prize', activityId, targetId: prizeId } : null
    }
    const targetId = key.slice('goods:'.length)
    const row = this.state.goods.find((g) => g.id === targetId)
    return row ? { row, kind: 'goods', activityId: null, targetId } : null
  }

  // 幂等
  idemResult(key) { return this.state.idem.has(key) ? this.state.idem.get(key).result : undefined }
  hasIdem(key) { return this.state.idem.has(key) }

  async close() { await this.journal.close() }

  newTraceId() {
    return `tr-${Date.now().toString(36)}-${genId('').slice(-8)}`
  }
}
