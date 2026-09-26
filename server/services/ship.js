// 物流与售后服务：
// 发货单状态机 pending_address → to_ship → shipped → received（/returned）；
// 售后 pending → done/dismissed；拒收/退货回补库存+积分退款，补发再扣库存+补发单；异常整体回退。
import { genId, BizError } from '../util.js'

const TRACE_FLOW = (o) => [
  { stage: 'collected', text: `${o.carrier} 已揽收包裹（单号 ${o.trackingNo}）` },
  { stage: 'transit', text: `包裹离开揽收网点，干线运输中，发往【${o.region}】` },
  { stage: 'delivering', text: `包裹到达【${o.region}】派送点，派送员王师傅 138****6666 正在派送` },
  { stage: 'signed', text: '包裹已签收，签收人：本人' }
]

export class ShipService {
  constructor(k, audit, points, inventory, budget, locks = null) {
    this.k = k
    this.audit = audit
    this.points = points
    this.inventory = inventory
    this.budget = budget
    this.locks = locks
  }

  // 售后审核按售后单串行（与采购入库同款临界区），杜绝并发审核导致的重复扣库存/重复补发
  withAfterSaleLock(afterSaleId, fn) {
    if (!this.locks) return fn()
    return this.locks.run(`as:${afterSaleId}`, fn)
  }

  isPhysical(rec) {
    if (rec.couponId) return false
    if (rec.type === 'draw') {
      if (rec.rarity === 'none') return false
      const prize = this.k.state.activities.find((a) => a.id === rec.activityId)
        ?.prizes.find((p) => p.id === rec.prizeId)
      if (prize && prize.physical !== undefined) return !!prize.physical
      return !rec.prizeName.includes('积分')
    }
    const g = this.k.state.goods.find((x) => x.id === rec.goodsId)
    if (g && g.physical !== undefined) return !!g.physical
    return true
  }

  // 有效实物记录 → 发货单（幂等：一条记录至多一张）
  async createForRecord(rec) {
    if (!rec || !['normal', 'released'].includes(rec.status)) return null
    if (!this.isPhysical(rec)) return null
    const existed = this.k.state.shipments.find((o) => o.recordId === rec.id)
    if (existed) return { shipment: existed, duplicated: true }
    const isDraw = rec.type === 'draw'
    const order = {
      id: genId('sp'),
      recordId: rec.id,
      bizType: rec.type,
      status: 'pending_address',
      tenantId: rec.tenantId || 't-star',
      userId: rec.userId, userName: rec.userName || '',
      traceId: rec.traceId || '',
      icon: rec.icon,
      targetName: isDraw ? rec.prizeName : rec.goodsName,
      activityId: isDraw ? rec.activityId : null,
      source: rec.status === 'released' ? '风控放行' : (isDraw ? '中奖' : '积分兑换'),
      date: this.k.todayDate(), time: this.k.nowTime(), ts: this.k.nowTs(),
      receiver: '', phone: '', region: '', address: '', addressAt: '',
      shipper: '', carrier: '', trackingNo: '', shipNote: '', shippedAt: '',
      receivedAt: '', traces: [],
      afterSaleId: '', returnedAt: '', originId: ''
    }
    await this.k.commit([{ type: 'insert', table: 'shipments', row: order }])
    await this.audit.log('ship-create', order.id,
      `${isDraw ? '中奖' : '兑换'}实物【${order.targetName}】生成发货单，待用户填写收货信息`,
      { tenantId: order.tenantId, traceId: order.traceId })
    return { shipment: order, duplicated: false }
  }

  requireShipment(id) {
    const o = this.k.state.shipments.find((x) => x.id === id)
    if (!o) throw new BizError('SHIP_NOT_FOUND', '发货单不存在', 404)
    return o
  }

  async submitAddress(id, form, ctx) {
    const o = this.requireShipment(id)
    if (ctx.identityKind !== 'customer') throw new BizError('ROLE_DENIED', '请切换到用户视角填写收货信息', 403)
    if (o.userId !== ctx.userId || (o.tenantId || 't-star') !== ctx.tenantId) {
      await this.audit.log('cross-tenant-denied', o.id, '⛔ 只能填写自己在当前租户的收货信息',
        { tenantId: o.tenantId, ctx, result: 'denied', module: 'ship' })
      throw new BizError('FORBIDDEN', '只能填写自己的收货信息', 403)
    }
    if (['shipped', 'received', 'returned'].includes(o.status)) throw new BizError('STATE_DENIED', '已发货，收货信息不可修改', 409)
    const receiver = (form.receiver || '').trim()
    const phone = String(form.phone || '').replace(/[\s-]/g, '')
    const region = (form.region || '').trim()
    const address = (form.address || '').trim()
    if (!receiver) throw new BizError('BAD_FORM', '请填写收货人姓名')
    if (!/^1\d{10}$/.test(phone)) throw new BizError('BAD_FORM', '请填写正确的 11 位手机号')
    if (!region) throw new BizError('BAD_FORM', '请填写所在地区（省/市/区）')
    if (!address) throw new BizError('BAD_FORM', '请填写详细收货地址')
    const first = o.status === 'pending_address'
    const row = { ...o, receiver, phone, region, address, status: 'to_ship', addressAt: `${this.k.todayDate()} ${this.k.nowTime()}` }
    await this.k.commit([{ type: 'upsert', table: 'shipments', row }])
    const traceId = this.k.newTraceId()
    await this.audit.log('ship-address', o.id,
      `${first ? '填写' : '更新'}收货信息：${receiver} ${phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2')} ${region} ${address}`,
      { tenantId: o.tenantId, ctx, traceId })
    return row
  }

  async appendTrace(o, stage, text) {
    const node = { stage, text, date: this.k.todayDate(), time: this.k.nowTime(), ts: this.k.nowTs() }
    await this.k.commit([{ type: 'upsert', table: 'shipments', row: { ...o, traces: [...o.traces, node] } }])
  }

  async ship(id, form, ctx) {
    const o = this.requireShipment(id)
    if (o.status !== 'to_ship') throw new BizError('STATE_DENIED', '该发货单当前状态不可发货（需用户先填写收货信息）', 409)
    const carrier = (form.carrier || '').trim()
    const trackingNo = (form.trackingNo || '').trim()
    if (!carrier) throw new BizError('BAD_FORM', '请填写快递公司')
    if (!trackingNo) throw new BizError('BAD_FORM', '请填写快递单号')
    const traceId = this.k.newTraceId()
    const row = {
      ...o, carrier, trackingNo, shipNote: (form.note || '').trim(),
      shipper: ctx.name, status: 'shipped', shippedAt: `${this.k.todayDate()} ${this.k.nowTime()}`
    }
    await this.k.commit([{ type: 'upsert', table: 'shipments', row }])
    await this.appendTrace(row, 'collected', `${carrier} 已揽收包裹（单号 ${trackingNo}）`)
    await this.audit.log('ship-send', o.id,
      `接单发货【${o.targetName}】：${carrier} 单号 ${trackingNo}，收件人 ${o.receiver}（${o.region} ${o.address}）${row.shipNote ? '；备注：' + row.shipNote : ''}`,
      { tenantId: o.tenantId, ctx, traceId })
    return this.requireShipment(id)
  }

  async syncTrace(id, ctx) {
    const o = this.requireShipment(id)
    if (o.status !== 'shipped') throw new BizError('STATE_DENIED', o.status === 'returned' ? '该单已退回，物流已终止' : '当前状态无需同步物流', 409)
    const next = TRACE_FLOW(o).find((f) => !o.traces.some((t) => t.stage === f.stage))
    if (!next) throw new BizError('TRACE_LATEST', '物流已更新至最新（已签收）', 409)
    const traceId = this.k.newTraceId()
    await this.appendTrace(o, next.stage, next.text)
    await this.audit.log('ship-trace', o.id, `同步物流轨迹【${o.targetName}】（${o.carrier} ${o.trackingNo}）：${next.text}`,
      { tenantId: o.tenantId, ctx, traceId })
    return this.requireShipment(id)
  }

  async receive(id, ctx) {
    const o = this.requireShipment(id)
    if (ctx.identityKind !== 'customer') throw new BizError('ROLE_DENIED', '由用户本人确认收货，请切换到用户视角', 403)
    if (o.userId !== ctx.userId || (o.tenantId || 't-star') !== ctx.tenantId) throw new BizError('FORBIDDEN', '只能确认自己的发货单', 403)
    if (o.status !== 'shipped') throw new BizError('STATE_DENIED', '仅已发货的订单可确认收货', 409)
    const traceId = this.k.newTraceId()
    let row = { ...o, status: 'received', receivedAt: `${this.k.todayDate()} ${this.k.nowTime()}` }
    await this.k.commit([{ type: 'upsert', table: 'shipments', row }])
    if (!row.traces.some((t) => t.stage === 'signed')) {
      await this.appendTrace(row, 'signed', '包裹已签收，签收人：本人（用户确认收货）')
      row = this.requireShipment(id)
    }
    await this.audit.log('ship-receive', o.id, `确认收货【${o.targetName}】（${o.carrier} ${o.trackingNo}），订单完成`,
      { tenantId: o.tenantId, ctx, traceId })
    return row
  }

  stockSnapOfRecord(rec) {
    return rec.type === 'draw'
      ? { targetType: 'prize', activityId: rec.activityId, targetId: rec.prizeId }
      : { targetType: 'goods', activityId: null, targetId: rec.goodsId }
  }

  refundOfRecord(rec) {
    if (!rec) return 0
    if (rec.type === 'draw') {
      const act = this.k.state.activities.find((a) => a.id === rec.activityId)
      return act && act.costType === 'points' ? (act.cost || 0) : 0
    }
    return this.k.state.goods.find((g) => g.id === rec.goodsId)?.cost || 0
  }

  async applyAfterSale(shipmentId, type, reason, ctx) {
    const o = this.requireShipment(shipmentId)
    if (ctx.identityKind !== 'customer') throw new BizError('ROLE_DENIED', '请切换到用户视角申请售后', 403)
    if (o.userId !== ctx.userId || (o.tenantId || 't-star') !== ctx.tenantId) throw new BizError('FORBIDDEN', '只能对自己的发货单申请售后', 403)
    const labels = { reject: '拒收退回', return: '退货退款', reship: '补发' }
    if (!labels[type]) throw new BizError('BAD_TYPE', '不支持的售后类型')
    const allow = { reject: ['shipped'], return: ['received'], reship: ['shipped', 'received'] }[type]
    if (!allow.includes(o.status)) throw new BizError('STATE_DENIED', `当前状态不可申请${labels[type]}`, 409)
    if (this.k.state.afterSales.some((a) => a.shipmentId === shipmentId && (a.status === 'pending' || a.status === 'waiting_stock'))) {
      throw new BizError('IDEMPOTENT', '该发货单已有待处理（待审核/待补货）的售后申请，请勿重复提交', 409)
    }
    if (this.k.state.afterSales.some((a) => a.shipmentId === shipmentId && a.status === 'done' && a.type === type)) {
      throw new BizError('IDEMPOTENT', `该发货单已完成过${labels[type]}售后，不可重复申请`, 409)
    }
    const text = (reason || '').trim()
    if (!text) throw new BizError('BAD_FORM', '请填写售后原因')
    const rec = this.k.state.records.find((r) => r.id === o.recordId) || null
    const as = {
      id: genId('as'),
      shipmentId: o.id, recordId: o.recordId,
      tenantId: o.tenantId || 't-star', traceId: this.k.newTraceId(),
      userId: o.userId, userName: o.userName,
      type, typeLabel: labels[type], reason: text, status: 'pending',
      icon: o.icon, targetName: o.targetName,
      ...this.stockSnapOfRecord(rec),
      refundPoints: type === 'reship' ? 0 : this.refundOfRecord(rec),
      reshipmentId: '',
      createdAt: this.k.todayDate(), time: this.k.nowTime(), ts: this.k.nowTs(),
      reviewedAt: '', reviewer: '', reviewNote: '',
      // 续办：审核执行中标记（与交易/风控单同款 Saga；崩溃后 boot 扫描 processing 单继续完成）
      processing: false, stages: {}
    }
    await this.k.commit([{ type: 'insert', table: 'afterSales', row: as }])
    await this.audit.log('aftersale-apply', as.id,
      `用户申请${labels[type]}【${o.targetName}】（发货单 ${o.id}，${o.carrier} ${o.trackingNo}）：${text}${as.refundPoints ? `；待审核返还 ${as.refundPoints} 积分` : ''}`,
      { tenantId: as.tenantId, ctx, traceId: as.traceId })
    return as
  }

  async _setStage(as, name) {
    if (as.stages?.[name]) return
    await this.k.commit([{ type: 'upsert', table: 'afterSales', row: { ...as, stages: { ...(as.stages || {}), [name]: true } } }])
  }

  // 售后审核统一入口（与风控放行/撤销同款 Saga）：
  // 先登记 processing 锚点，再按 stages 幂等执行；崩溃重启由 resumeProcessing() 续办到终态。
  // 跨日落账：退款/回补/补发/预算均按「实际处理日（审核日）」归属业务日（申请日仅留痕），
  // 库存台账与积分流水同时带 bizDate（=处理日）与 date，审计共享售后 traceId。
  async reviewAfterSale(afterSaleId, approve, note, ctx) {
    return this.withAfterSaleLock(afterSaleId, () => this._reviewLocked(afterSaleId, approve, note, ctx))
  }

  async _reviewLocked(afterSaleId, approve, note, ctx) {
    const as0 = this.k.state.afterSales.find((x) => x.id === afterSaleId)
    if (!as0) throw new BizError('AS_NOT_FOUND', '售后单不存在', 404)
    // waiting_stock：采购入库后的「继续履约」入口，仅补发单、仅同意继续可执行
    const continuing = as0.status === 'waiting_stock'
    if (as0.status !== 'pending' && !continuing && !as0.processing) {
      throw new BizError('IDEMPOTENT', '该售后单已处理，请勿重复操作', 409)
    }
    const remark = (note || '').trim()

    // 驳回：单步留痕动作，不进入 Saga（不动账）
    if (!approve) {
      if (continuing) throw new BizError('STATE_DENIED', '待补货售后单仅可在采购入库后继续履约，不能驳回', 409)
      const row = { ...as0, status: 'dismissed', reviewedAt: `${this.k.todayDate()} ${this.k.nowTime()}`, reviewer: ctx.name, reviewNote: remark }
      await this.k.commit([{ type: 'upsert', table: 'afterSales', row }])
      const o0 = this.requireShipment(as0.shipmentId)
      await this.audit.log('aftersale-dismiss', as0.id,
        `驳回${as0.typeLabel}申请【${as0.targetName}】（发货单 ${o0.id}）${remark ? '；备注：' + remark : ''}；账目与库存未变动`,
        { tenantId: as0.tenantId, ctx, traceId: as0.traceId })
      return row
    }

    // 通过：登记续办锚点（approve/重入直接按 stages 幂等续办）
    if (!as0.processing) {
      await this.k.commit([{
        type: 'upsert', table: 'afterSales',
        row: { ...as0, processing: true, reviewer: ctx.name, stages: as0.stages || {} }
      }])
    }
    await this._completeAfterSale(afterSaleId, remark, ctx)
    return this.k.state.afterSales.find((x) => x.id === afterSaleId)
  }

  // 审核通过（或待补货继续履约）的幂等执行体
  async _completeAfterSale(afterSaleId, remark, ctx) {
    const as0 = this.k.state.afterSales.find((x) => x.id === afterSaleId)
    const o = this.requireShipment(as0.shipmentId)
    const traceId = as0.traceId || this.k.newTraceId()
    const procDay = this.k.todayDate() // 实际处理日（跨日审核按审核日入账，不串申请日）
    const stamp = `${procDay} ${this.k.nowTime()}`
    const target = this.inventory.targetOf(as0.targetType, as0.activityId, as0.targetId)
    const cur = () => this.k.state.afterSales.find((x) => x.id === afterSaleId)

    // —— 补发：库存不足则挂起 waiting_stock（不落账），采购入库后续办 ——
    if (as0.type === 'reship' && target.row.remain <= 0 && !as0.stages?.reshipment) {
      const linkedPo = this.k.state.purchaseOrders.find((po) =>
        (po.tenantId || 't-star') === as0.tenantId && po.afterSaleId === as0.id &&
        ['pending', 'approved', 'receiving'].includes(po.status))
      const reshipPrice = Math.round(Number(target.row.unitPrice) * 100) / 100 || 0
      if (this.budget && reshipPrice > 0 && !linkedPo && !as0.stages?.shortageReserve) {
        await this.budget.occupy('reserve',
          { unit: 'money', amount: reshipPrice, scopeType: as0.targetType === 'prize' ? 'activity' : 'tenant',
            scopeId: as0.targetType === 'prize' ? as0.activityId : as0.tenantId },
          {
            category: 'reship', kind: 'reship-cost',
            refType: 'aftersale', refId: as0.id, bizNo: o.id,
            summary: `缺货补发预占：【${as0.targetName}】×1，估价 ${reshipPrice} 元（挂起待采购，结算时核销不重复付款）`,
            tenantId: as0.tenantId, userId: as0.userId, traceId
          }, ctx)
        await this._setStage(cur(), 'shortageReserve')
      }
      const row = {
        ...cur(),
        status: 'waiting_stock', processing: false,
        // 挂起审核时刻（申请→挂起）留痕；最终处理日在继续履约完成时由 reviewedAt 改写
        suspendedAt: cur().suspendedAt || stamp,
        reviewedAt: stamp, reviewer: ctx.name, reviewNote: remark,
        shortageNote: `审核通过但【${as0.targetName}】库存不足（remain=0），挂起待采购补货后继续履约`
      }
      await this.k.commit([{ type: 'upsert', table: 'afterSales', row }])
      const o2 = this.requireShipment(as0.shipmentId)
      await this.audit.log('aftersale-shortage', as0.id,
        `补发【${as0.targetName}】库存不足，售后单转待补货（发货单 ${o2.id}，账目与库存未变动）；请发起采购，验收入库后从待处理售后继续履约`,
        { tenantId: as0.tenantId, ctx, traceId, bizDate: procDay })
      return
    }

    if (as0.type === 'reject' || as0.type === 'return') {
      // 1) 库存回补（effectId 幂等；跨日审核按审核日归属）
      if (!cur().stages?.restock) {
        await this.inventory.replenish(target, 1, {
          effectId: `as-restock:${as0.id}`, bizDate: procDay, date: procDay,
          refType: 'aftersale', refId: as0.id, tenantId: as0.tenantId, traceId
        })
        await this._setStage(cur(), 'restock')
        this.k.maybeFault('aftersale.afterRestock')
      }
      // 2) 积分退款（(kind,refId) 幂等；bizDate/date 双日落账，跨日审核归审核日不串申请日）
      if (as0.refundPoints > 0 && !cur().stages?.refund) {
        await this.points.post({
          userId: as0.userId, delta: as0.refundPoints,
          note: `售后退款：${as0.typeLabel}【${as0.targetName}】（发货单 ${o.id}）`,
          kind: 'refund', tenantId: as0.tenantId,
          bizDate: procDay, date: procDay,
          refId: as0.id, refType: 'after-sale', traceId
        })
        await this._setStage(cur(), 'refund')
        this.k.maybeFault('aftersale.afterRefund')
      }
      // 3) 预算冲回（按 effectId 幂等）
      if (as0.refundPoints > 0 && this.budget && !cur().stages?.budget) {
        await this.budget.refund(
          { unit: 'points', amount: as0.refundPoints, scopeType: 'tenant', scopeId: as0.tenantId },
          {
            category: o.bizType === 'draw' ? 'draw' : 'redeem',
            kind: o.bizType === 'draw' ? 'draw-refund' : 'redeem-refund',
            refType: 'aftersale', refId: as0.id, bizNo: o.id,
            summary: `售后退款冲回预算：${as0.typeLabel}【${as0.targetName}】+${as0.refundPoints} 积分`,
            tenantId: as0.tenantId, userId: as0.userId, traceId
          }, ctx)
        await this._setStage(cur(), 'budget')
      }
      // 4) 发货单退回 + 轨迹（终态/轨迹节点均幂等）
      if (!cur().stages?.shipReturn) {
        const shipRow = { ...o, status: 'returned', returnedAt: o.returnedAt || stamp, afterSaleId: as0.id }
        await this.k.commit([{ type: 'upsert', table: 'shipments', row: shipRow }])
        if (!this.requireShipment(o.id).traces.some((t) => t.stage === 'returned')) {
          await this.appendTrace(this.requireShipment(o.id), 'returned',
            as0.type === 'reject' ? '收件人拒收，包裹退回发货仓' : '退货包裹已退回发货仓，售后完成')
        }
        await this._setStage(cur(), 'shipReturn')
      }
    } else {
      // —— 补发履约 ——
      const linkedPo = this.k.state.purchaseOrders.find((po) =>
        (po.tenantId || 't-star') === as0.tenantId && po.afterSaleId === as0.id)
      const reshipPrice = Math.round(Number(target.row.unitPrice) * 100) / 100 || 0
      if (this.budget && reshipPrice > 0 && linkedPo) {
        // 缺货挂起时曾 reserve 的补发预占，入库继续履约时核销为实际成本（幂等）
        if (!cur().stages?.budgetConvert) {
          await this.budget.settleReserved('aftersale', as0.id, {
            category: 'reship', kind: 'reship-cost', traceId,
            summary: `缺货补发入库继续履约，核销补发预占：【${as0.targetName}】×1`
          }, ctx)
          await this._setStage(cur(), 'budgetConvert')
        }
      } else if (this.budget && reshipPrice > 0 && !cur().stages?.budget) {
        // 即时补发（无在途采购）：补发资金成本直接 settle
        await this.budget.occupy('settle',
          { unit: 'money', amount: reshipPrice, scopeType: as0.targetType === 'prize' ? 'activity' : 'tenant',
            scopeId: as0.targetType === 'prize' ? as0.activityId : as0.tenantId },
          {
            category: 'reship', kind: 'reship-cost',
            refType: 'aftersale', refId: as0.id, bizNo: o.id,
            summary: `售后补发成本：【${as0.targetName}】×1，估价 ${reshipPrice} 元`,
            tenantId: as0.tenantId, userId: as0.userId, traceId
          }, ctx)
        await this._setStage(cur(), 'budget')
      }
      // 扣减库存（effectId 幂等；按实际处理日归属）
      if (!cur().stages?.deduct) {
        await this.inventory.deduct(target, 1, {
          effectId: `as-reship:${as0.id}`, bizDate: procDay, date: procDay,
          kind: 'aftersale-reship', refType: 'aftersale', refId: as0.id,
          tenantId: as0.tenantId, traceId
        })
        await this._setStage(cur(), 'deduct')
        this.k.maybeFault('aftersale.afterDeduct')
      }
      // 生成补发发货单（按售后单幂等，断点续办不重复生成）
      if (!cur().stages?.reshipment) {
        const reship = {
          id: genId('sp'), recordId: o.recordId, bizType: o.bizType, status: 'to_ship',
          tenantId: as0.tenantId, traceId, userId: o.userId, userName: o.userName,
          icon: o.icon, targetName: o.targetName, activityId: o.activityId,
          source: '售后补发',
          date: procDay, time: this.k.nowTime(), ts: this.k.nowTs(),
          receiver: o.receiver, phone: o.phone, region: o.region, address: o.address, addressAt: o.addressAt,
          shipper: '', carrier: '', trackingNo: '', shipNote: '', shippedAt: '', receivedAt: '',
          traces: [], afterSaleId: as0.id, returnedAt: '', originId: o.id
        }
        await this.k.commit([{ type: 'insert', table: 'shipments', row: reship }])
        await this.k.commit([{ type: 'upsert', table: 'afterSales', row: { ...cur(), reshipmentId: reship.id } }])
        if (!this.requireShipment(o.id).traces.some((t) => t.stage === 'reship')) {
          await this.appendTrace(this.requireShipment(o.id), 'reship', `售后补发已受理，生成补发单 ${reship.id}，等待重新发货`)
        }
        await this.audit.log('ship-create', reship.id,
          `售后补发【${as0.targetName}】生成补发发货单（原单 ${o.id}，售后单 ${as0.id}），沿用原收货信息，待运营重新发货`,
          { tenantId: as0.tenantId, ctx, traceId, bizDate: procDay })
        await this._setStage(cur(), 'reshipment')
      }
    }

    // —— 售后单终态（各 stage 全部落完才置 done + 清锚点）——
    // reviewedAt 一律改写为本次完成时刻：缺货挂起时记录的是挂起时刻，继续履约（可能跨日）
    // 完成后必须以实际处理日为准，保证库存/退款/审计按处理日分账。
    const final0 = cur()
    if (final0.status !== 'done' || final0.processing || final0.reviewedAt !== stamp) {
      await this.k.commit([{
        type: 'upsert', table: 'afterSales',
        row: {
          ...final0, status: 'done', processing: false,
          reviewedAt: stamp, reviewer: final0.reviewer || ctx.name, reviewNote: remark
        }
      }])
    }
    const done = cur()
    if (!done.stages?.audit) {
      const crossDay = as0.createdAt !== procDay
      await this.audit.log('aftersale-approve', as0.id,
        as0.type === 'reship'
          ? `${crossDay ? '跨日续办：' : ''}同意补发【${as0.targetName}】：库存扣减 1，生成补发单 ${done.reshipmentId}（归属业务日 ${procDay}）${remark ? '；备注：' + remark : ''}`
          : `同意${as0.typeLabel}【${as0.targetName}】：库存回补 1${as0.refundPoints ? `、返还 ${as0.refundPoints} 积分` : ''}，发货单 ${o.id} 已退回（归属业务日 ${procDay}）${remark ? '；备注：' + remark : ''}`,
        { tenantId: as0.tenantId, ctx, traceId, bizDate: procDay })
      await this._setStage(cur(), 'audit')
    }
  }

  // 启动/手工续办：把 processing 中的售后单执行到终态（与交易/风控续办同一套机制）
  async resumeProcessing() {
    const resumed = []
    for (const as of [...this.k.state.afterSales]) {
      if (!as.processing) continue
      await this.withAfterSaleLock(as.id, async () => {
        await this._completeAfterSale(as.id, as.reviewNote || '故障续办', { name: as.reviewer || '系统' })
      })
      resumed.push(as.id)
    }
    return resumed
  }
}
