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
      // 库存台账：每笔库存变动（预占/核销/回补/采购入库/售后补发退回/对账调整/期初）
      // 一行 append-only 明细，统一带 bizDate（归属业务日）与 date（实际处理日），
      // 是 P5 按业务日分账与跨日续办勾稽的底账。
      stockLedger: [],
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
      // 期初建账固定 ts=0（排在全部业务事件之前）
      if (e.type === 'stock.opening') e.ts = 0
      else if (!e.ts) e.ts = this.nowTs()
      // 提交时刻的实际处理日：随事件落盘，保证重放后按原始处理日重建台账（而非重放日）
      if (!e.day) e.day = this.todayDate()
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
        let already = false
        if (e.effectId) {
          if (st.effects.has(e.effectId)) {
            already = true
          } else {
            st.effects.add(e.effectId)
          }
        }
        const target = this.findStock(e.key)
        if (target && !already) {
          target.row.remain += e.dRemain
          target.row.frozen = (target.row.frozen || 0) + e.dFrozen
          if (e.dStock) target.row.stock = (target.row.stock || 0) + e.dStock
        }
        // 库存台账 append-only：幂等命中的重放不重复登记。
        // bizDate/date 缺省取事件提交时刻（e.day，由 commit() 在落盘前盖戳），
        // 不能在重放时取 todayDate()——否则历史事件会被错归到重放当日，串掉历史业务日库存账。
        if (!already) {
          st.stockLedger.push({
            id: e.ledgerId || `sl-${e.ts}-${(st.stockLedger.length + 1).toString(36)}-${Math.random().toString(16).slice(2, 8)}`,
            key: e.key,
            bizDate: e.bizDate || e.day || this.todayDate(),
            date: e.date || e.day || this.todayDate(),
            ts: e.ts,
            dRemain: e.dRemain, dFrozen: e.dFrozen, dStock: e.dStock || 0,
            kind: e.kind || 'mut',
            refType: e.refType || '', refId: e.refId || '',
            tenantId: e.tenantId || '', traceId: e.traceId || '',
            effectId: e.effectId || ''
          })
        }
        break
      }
      // 期初库存：把 SKU 的 remain/stock 建立为初始量（迁移场景 SKU 行从 0 重建；
      // 原生种子场景行已带初始账面，opening 仅补登记台账，幂等不重复加）。
      case 'stock.opening': {
        const existed = st.stockLedger.some((x) => x.key === e.key && x.kind === 'opening')
        if (!existed) {
          const t0 = this.findStock(e.key)
          // 行上尚无任何期初/业务台账痕迹（remain=0）时按初始量建账；否则沿用既有账面
          if (t0 && (t0.row.remain === undefined || t0.row.remain === 0) &&
              !st.stockLedger.some((x) => x.key === e.key)) {
            t0.row.remain = e.stock
            t0.row.stock = e.stock
          }
          st.stockLedger.push({
            id: `sl-open-${e.key.replace(/[:]/g, '_')}`,
            key: e.key, bizDate: e.bizDate, date: e.bizDate, ts: e.ts,
            dRemain: e.stock, dFrozen: 0, dStock: e.stock,
            kind: 'opening', refType: 'opening', refId: '',
            tenantId: e.tenantId || '', traceId: '', effectId: `opening:${e.key}`
          })
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

  // —— 库存台账（append-only）：积分/库存跨日分账的底账 ——
  // 枚举纳入库存管理的全部 SKU（与 P5 口径一致：谢谢参与 none  prize 不入账）
  stockTargets() {
    const out = []
    this.state.activities.forEach((a) => {
      ;(a.prizes || []).forEach((p) => {
        if (p.rarity !== 'none') out.push({ key: `prize:${a.id}:${p.id}`, row: p, tenantId: a.tenantId })
      })
    })
    this.state.goods.forEach((g) => out.push({ key: `goods:${g.id}`, row: g, tenantId: g.tenantId || 't-star' }))
    return out
  }

  // 期初建账：把每个 SKU 的当前账面总量登记为 opening 行（仅建库/迁移后首次调用，幂等）。
  // 服务端原生库在建库种子后调用（opening=初始库存，后续采购入库走台账追加）；
  // 历史迁移库在快照重放后调用（opening=快照账面总量，历史消耗按记录/售后单独重建）。
  async ensureStockOpening(opts = {}) {
    const day = opts.bizDate || '0000-01-01'
    const events = []
    for (const t of this.stockTargets()) {
      if (this.state.stockLedger.some((x) => x.key === t.key)) continue
      events.push({ type: 'stock.opening', key: t.key, stock: t.row.stock || t.row.remain || 0,
        bizDate: day, ts: 0, tenantId: t.tenantId })
    }
    for (const e of events) await this.commit([e])
    return events.length
  }

  stockOpening(key) {
    return this.state.stockLedger.find((x) => x.key === key && x.kind === 'opening') || null
  }

  // 截至某业务日的账面 remain 重放：
  //  mode='biz'  按归属业务日（bizDate）分账——对账 P5「业务账」视角；
  //  mode='date' 按实际处理日（date）分账——跨日续办「处理日」视角与审计勾稽。
  // 无台账的旧库返回 null，由调用方回退到实时账面。
  stockRemainAsOf(key, day, mode = 'biz') {
    const rows = this.state.stockLedger.filter((x) => x.key === key)
    if (!rows.length) return null
    const field = mode === 'date' ? 'date' : 'bizDate'
    return rows.filter((x) => (x[field] || x.bizDate || x.date) <= day)
      .reduce((s, x) => s + (x.dRemain || 0), 0)
  }

  // 截至某业务日的采购入库合格量（按归属业务日）
  stockInboundAsOf(key, day) {
    return this.state.stockLedger
      .filter((x) => x.key === key && x.kind === 'purchase-inbound' && (x.bizDate || x.date) <= day)
      .reduce((s, x) => s + (x.dStock || x.dRemain || 0), 0)
  }

  async close() { await this.journal.close() }

  newTraceId() {
    return `tr-${Date.now().toString(36)}-${genId('').slice(-8)}`
  }
}
