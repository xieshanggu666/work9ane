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
  constructor(k, audit, points, inventory, budget) {
    this.k = k
    this.audit = audit
    this.points = points
    this.inventory = inventory
    this.budget = budget
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
      reviewedAt: '', reviewer: '', reviewNote: ''
    }
    await this.k.commit([{ type: 'insert', table: 'afterSales', row: as }])
    await this.audit.log('aftersale-apply', as.id,
      `用户申请${labels[type]}【${o.targetName}】（发货单 ${o.id}，${o.carrier} ${o.trackingNo}）：${text}${as.refundPoints ? `；待审核返还 ${as.refundPoints} 积分` : ''}`,
      { tenantId: as.tenantId, ctx, traceId: as.traceId })
    return as
  }

  async reviewAfterSale(afterSaleId, approve, note, ctx) {
    const as = this.k.state.afterSales.find((x) => x.id === afterSaleId)
    if (!as) throw new BizError('AS_NOT_FOUND', '售后单不存在', 404)
    // waiting_stock：采购入库后的「继续履约」入口，仅补发单、仅同意继续可执行
    const continuing = as.status === 'waiting_stock'
    if (as.status !== 'pending' && !continuing) throw new BizError('IDEMPOTENT', '该售后单已处理，请勿重复操作', 409)
    const o = this.requireShipment(as.shipmentId)
    const remark = (note || '').trim()
    const traceId = as.traceId || this.k.newTraceId()

    if (!approve) {
      if (continuing) throw new BizError('STATE_DENIED', '待补货售后单仅可在采购入库后继续履约，不能驳回', 409)
      const row = { ...as, status: 'dismissed', reviewedAt: `${this.k.todayDate()} ${this.k.nowTime()}`, reviewer: ctx.name, reviewNote: remark }
      await this.k.commit([{ type: 'upsert', table: 'afterSales', row }])
      await this.audit.log('aftersale-dismiss', as.id,
        `驳回${as.typeLabel}申请【${as.targetName}】（发货单 ${o.id}）${remark ? '；备注：' + remark : ''}；账目与库存未变动`,
        { tenantId: as.tenantId, ctx, traceId })
      return row
    }

    // 通过：统一预校验（库存目标存在；补发需有余量），任一不满足整体不落账
    const target = this.inventory.targetOf(as.targetType, as.activityId, as.targetId)
    if (as.type === 'reship' && target.row.remain <= 0) {
      // 缺货：售后单挂起「待补货」（不动账），采购验收入库后可从待处理售后继续履约
      // 补发资金成本实时预占（待采购结算时核销，不重复付款）；
      // 已有关联采购单在途的（采购预占已覆盖补发件）不重复预占
      const linkedPo = this.k.state.purchaseOrders.find((po) =>
        (po.tenantId || 't-star') === as.tenantId && po.afterSaleId === as.id &&
        ['pending', 'approved', 'receiving'].includes(po.status))
      const reshipPrice = Math.round(Number(target.row.unitPrice) * 100) / 100 || 0
      if (this.budget && reshipPrice > 0 && !linkedPo) {
        await this.budget.occupy('reserve',
          { unit: 'money', amount: reshipPrice, scopeType: as.targetType === 'prize' ? 'activity' : 'tenant',
            scopeId: as.targetType === 'prize' ? as.activityId : as.tenantId },
          {
            category: 'reship', kind: 'reship-cost',
            refType: 'aftersale', refId: as.id, bizNo: o.id,
            summary: `缺货补发预占：【${as.targetName}】×1，估价 ${reshipPrice} 元（挂起待采购，结算时核销不重复付款）`,
            tenantId: as.tenantId, userId: as.userId, traceId
          }, ctx)
      }
      const row = {
        ...as,
        status: 'waiting_stock',
        reviewedAt: `${this.k.todayDate()} ${this.k.nowTime()}`,
        reviewer: ctx.name, reviewNote: remark,
        shortageNote: `审核通过但【${as.targetName}】库存不足（remain=0），挂起待采购补货后继续履约`
      }
      await this.k.commit([{ type: 'upsert', table: 'afterSales', row }])
      await this.audit.log('aftersale-shortage', as.id,
        `补发【${as.targetName}】库存不足，售后单转待补货（发货单 ${o.id}，账目与库存未变动）；请发起采购，验收入库后从待处理售后继续履约`,
        { tenantId: as.tenantId, ctx, traceId })
      return row
    }

    if (as.type === 'reject' || as.type === 'return') {
      await this.inventory.replenish(target, 1)
      if (as.refundPoints > 0) {
        await this.points.post({
          userId: as.userId, delta: as.refundPoints,
          note: `售后退款：${as.typeLabel}【${as.targetName}】（发货单 ${o.id}）`,
          kind: 'refund', tenantId: as.tenantId, refId: as.id, refType: 'after-sale', traceId
        })
        // 营销预算：退货/拒收按申请时快照冲回已占用的积分成本（append-only，预算余额恢复）
        if (this.budget) {
          await this.budget.refund(
            { unit: 'points', amount: as.refundPoints, scopeType: 'tenant', scopeId: as.tenantId },
            {
              category: o.bizType === 'draw' ? 'draw' : 'redeem',
              kind: o.bizType === 'draw' ? 'draw-refund' : 'redeem-refund',
              refType: 'aftersale', refId: as.id, bizNo: o.id,
              summary: `售后退款冲回预算：${as.typeLabel}【${as.targetName}】+${as.refundPoints} 积分`,
              tenantId: as.tenantId, userId: as.userId, traceId
            }, ctx)
        }
      }
      const shipRow = { ...o, status: 'returned', returnedAt: `${this.k.todayDate()} ${this.k.nowTime()}`, afterSaleId: as.id }
      await this.k.commit([{ type: 'upsert', table: 'shipments', row: shipRow }])
      await this.appendTrace(this.requireShipment(o.id), 'returned',
        as.type === 'reject' ? '收件人拒收，包裹退回发货仓' : '退货包裹已退回发货仓，售后完成')
    } else {
      // 补发资金成本（按 SKU 采购成本口径 unitPrice 估算，0 表示未维护成本不占用）；
      // 关联采购单已在途的（缺货挂起→采购入库）补发成本已在采购付款中结算，不重复占用
      const linkedPo = this.k.state.purchaseOrders.find((po) =>
        (po.tenantId || 't-star') === as.tenantId && po.afterSaleId === as.id)
      const reshipPrice = Math.round(Number(target.row.unitPrice) * 100) / 100 || 0
      if (this.budget && reshipPrice > 0 && !(continuing && linkedPo)) {
        await this.budget.occupy('settle',
          { unit: 'money', amount: reshipPrice, scopeType: as.targetType === 'prize' ? 'activity' : 'tenant',
            scopeId: as.targetType === 'prize' ? as.activityId : as.tenantId },
          {
            category: 'reship', kind: 'reship-cost',
            refType: 'aftersale', refId: as.id, bizNo: o.id,
            summary: `售后补发成本：【${as.targetName}】×1，估价 ${reshipPrice} 元`,
            tenantId: as.tenantId, userId: as.userId, traceId
          }, ctx)
      }
      await this.inventory.deduct(target, 1)
      const reship = {
        id: genId('sp'), recordId: o.recordId, bizType: o.bizType, status: 'to_ship',
        tenantId: as.tenantId, traceId, userId: o.userId, userName: o.userName,
        icon: o.icon, targetName: o.targetName, activityId: o.activityId,
        source: '售后补发',
        date: this.k.todayDate(), time: this.k.nowTime(), ts: this.k.nowTs(),
        receiver: o.receiver, phone: o.phone, region: o.region, address: o.address, addressAt: o.addressAt,
        shipper: '', carrier: '', trackingNo: '', shipNote: '', shippedAt: '', receivedAt: '',
        traces: [], afterSaleId: as.id, returnedAt: '', originId: o.id
      }
      await this.k.commit([{ type: 'insert', table: 'shipments', row: reship }])
      const asRow = { ...as, reshipmentId: reship.id }
      await this.k.commit([{ type: 'upsert', table: 'afterSales', row: asRow }])
      await this.appendTrace(this.requireShipment(o.id), 'reship', `售后补发已受理，生成补发单 ${reship.id}，等待重新发货`)
      await this.audit.log('ship-create', reship.id,
        `售后补发【${o.targetName}】生成补发发货单（原单 ${o.id}，售后单 ${as.id}），沿用原收货信息，待运营重新发货`,
        { tenantId: as.tenantId, ctx, traceId })
    }

    const doneRow = {
      ...this.k.state.afterSales.find((x) => x.id === as.id),
      status: 'done', reviewedAt: `${this.k.todayDate()} ${this.k.nowTime()}`, reviewer: ctx.name, reviewNote: remark
    }
    await this.k.commit([{ type: 'upsert', table: 'afterSales', row: doneRow }])
    await this.audit.log('aftersale-approve', as.id,
      as.type === 'reship'
        ? `${continuing ? '采购入库后继续履约：' : ''}同意补发【${as.targetName}】：库存扣减 1，生成补发单 ${doneRow.reshipmentId}${remark ? '；备注：' + remark : ''}`
        : `同意${as.typeLabel}【${as.targetName}】：库存回补 1${as.refundPoints ? `、返还 ${as.refundPoints} 积分` : ''}，发货单 ${o.id} 已退回${remark ? '；备注：' + remark : ''}`,
      { tenantId: as.tenantId, ctx, traceId })
    return doneRow
  }
}
