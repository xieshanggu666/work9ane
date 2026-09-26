// 采购入库服务：运营按活动奖品/商城商品发起采购 → 审批 → 仓配分批验收入库 → 全部入完完结。
// 入库口径：验收批次 append-only，按实收抬升 remain/stock（P5 以 stock 账面勾稽，无需调整凭证）；
// 缺货补发联动：采购可关联 waiting_stock 售后单，入完提示从待处理售后继续履约。
import { genId, BizError } from '../util.js'

export class PurchaseService {
  constructor(k, audit, inventory, locks, budget) {
    this.k = k
    this.audit = audit
    this.inventory = inventory
    this.locks = locks
    this.budget = budget
  }

  // 采购预算占用条目：按「数量 × 协议单价」预占资金预算（活动奖品同时落活动预算与租户预算）
  _poBudgetItem(po) {
    return {
      unit: 'money', amount: Math.round(po.qty * po.unitPrice * 100) / 100,
      scopeType: po.targetType === 'prize' ? 'activity' : 'tenant',
      scopeId: po.targetType === 'prize' ? po.activityId : po.tenantId
    }
  }
  async _poBudgetReserve(po, ctx) {
    if (!this.budget) return
    await this.budget.occupy('reserve', this._poBudgetItem(po), {
      category: 'purchase', kind: 'purchase-commit',
      refType: 'po', refId: po.id, bizNo: po.poNo,
      summary: `采购预占：${po.targetName} ×${po.qty}（${po.supplierName}，协议单价 ${po.unitPrice} 元）`,
      tenantId: po.tenantId, userId: po.applicantId, traceId: po.traceId
    }, ctx)
  }
  async _poBudgetRelease(po, refs, ctx) {
    if (!this.budget) return
    await this.budget.releaseReserved('po', po.id, {
      category: 'purchase', kind: 'purchase-commit',
      summary: refs, tenantId: po.tenantId, traceId: po.traceId
    }, ctx)
  }

  requireOrder(poId) {
    const po = this.k.state.purchaseOrders.find((x) => x.id === poId)
    if (!po) throw new BizError('PO_NOT_FOUND', '采购单不存在', 404)
    return po
  }

  // 采购目标定位（奖品按活动维度 / 商品按 goodsId）
  targetOf(targetType, activityId, targetId) {
    if (targetType === 'prize') {
      const a = this.k.state.activities.find((x) => x.id === activityId)
      const p = a?.prizes.find((x) => x.id === targetId)
      if (!a || !p) throw new BizError('TARGET_MISSING', '采购目标（活动奖品）不存在', 404)
      return { row: p, activityName: a.name, targetName: `${a.name} / ${p.name}`, icon: p.emoji || '🎁', tenantId: a.tenantId }
    }
    const g = this.k.state.goods.find((x) => x.id === targetId)
    if (!g) throw new BizError('TARGET_MISSING', '采购目标（商城商品）不存在', 404)
    return { row: g, activityName: '', targetName: g.name, icon: g.icon || '🛍️', tenantId: g.tenantId || 't-star' }
  }

  // 发起采购申请（RBAC 在 http 层校验 purchase:apply；租户归属与目标校验在此）
  async createOrder(form, ctx) {
    const targetType = form.targetType === 'prize' ? 'prize' : 'goods'
    const t = this.targetOf(targetType, form.activityId || null, form.targetId)
    if (t.tenantId !== ctx.tenantId) throw new BizError('FORBIDDEN', '采购目标不属于当前租户', 403)
    const qty = Math.floor(Number(form.qty) || 0)
    if (qty <= 0) throw new BizError('BAD_FORM', '采购数量需为正整数')
    if (qty > 9999) throw new BizError('BAD_FORM', '单笔采购数量不超过 9999')
    const reason = (form.reason || '').trim()
    if (!reason) throw new BizError('BAD_FORM', '请填写采购事由')
    // 供应商与协议单价（供应商结算口径：按实收合格量 × 单价）
    const supplierName = (form.supplierName || '').trim()
    if (!supplierName) throw new BizError('BAD_FORM', '请填写供应商名称（供应商结算依据）')
    const unitPrice = Math.round(Number(form.unitPrice) * 100) / 100
    if (!(unitPrice > 0)) throw new BizError('BAD_FORM', '请填写正确的协议单价（>0）')
    if (unitPrice > 1000000) throw new BizError('BAD_FORM', '单价异常，请核对后再提交')

    // 营销预算预检：采购承诺金额（数量 × 协议单价）超出预算（或预算被冻结/关闭）时整单拦截
    const scopeType = targetType === 'prize' ? 'activity' : 'tenant'
    const scopeId = targetType === 'prize' ? form.activityId : ctx.tenantId
    this.budget?.guard(
      [{ unit: 'money', amount: Math.round(qty * unitPrice * 100) / 100, scopeType, scopeId, category: 'purchase', kind: 'purchase-commit' }],
      ctx.tenantId)

    // 关联待补货售后单（缺货补发履约链路）
    let linked = null
    if (form.afterSaleId) {
      linked = this.k.state.afterSales.find((a) => a.id === form.afterSaleId)
      if (!linked || (linked.tenantId || 't-star') !== ctx.tenantId ||
          linked.status !== 'waiting_stock' || linked.type !== 'reship' ||
          linked.targetType !== targetType || linked.targetId !== form.targetId ||
          (targetType === 'prize' && linked.activityId !== form.activityId)) {
        throw new BizError('BAD_LINK', '关联售后单状态与采购目标不匹配', 409)
      }
    }

    const traceId = this.k.newTraceId()
    const po = {
      id: genId('po'),
      poNo: 'PO' + Date.now().toString(36).toUpperCase() + String(Math.floor(Math.random() * 90) + 10),
      tenantId: ctx.tenantId,
      traceId,
      targetType,
      activityId: targetType === 'prize' ? form.activityId : null,
      activityName: t.activityName,
      targetId: form.targetId,
      targetName: t.targetName,
      icon: t.icon,
      qty, inboundQty: 0, status: 'pending',
      supplierName, unitPrice,
      shortQty: 0, rejectedQty: 0, settledBillId: '',
      purpose: linked ? 'aftersale' : 'normal',
      purposeLabel: linked ? '售后缺货补发履约' : '日常补货',
      afterSaleId: linked ? linked.id : '',
      reason,
      applicant: ctx.name, applicantId: ctx.memberId || ctx.userId,
      createdAt: this.k.todayDate(), time: this.k.nowTime(), ts: this.k.nowTs(),
      approvedAt: '', approver: '', approveNote: '', receivedAt: '',
      batches: []
    }
    await this.k.commit([{ type: 'insert', table: 'purchaseOrders', row: po }])
    // 营销预算：采购承诺金额实时预占（审批驳回/申请人撤销时释放，供应商结算时核销转实际付款）
    await this._poBudgetReserve(po, ctx)
    await this.audit.log('purchase-apply', po.id,
      `发起采购【${t.targetName}】×${qty}（${targetType === 'prize' ? '活动奖品' : '商城商品'}，供应商：${supplierName}，协议单价 ${unitPrice} 元，事由：${reason}）` +
      (linked ? `；关联待补货售后单 ${linked.id}，入库后继续补发履约` : ''),
      { tenantId: ctx.tenantId, ctx, traceId })
    return po
  }

  // 审批前撤销（仅发起人本人或组织管理员/平台方；仅 pending）
  async cancelOrder(poId, ctx) {
    const po = this.requireOrder(poId)
    if (po.status !== 'pending') throw new BizError('STATE_DENIED', '仅待审批采购单可撤销', 409)
    const isAdmin = ctx.identityKind === 'platform' || ctx.roleKey === 'org_admin'
    if (!isAdmin && po.applicantId !== (ctx.memberId || ctx.userId)) {
      throw new BizError('FORBIDDEN', '只能撤销本人发起的采购申请', 403)
    }
    const row = { ...po, status: 'canceled', approveNote: '申请人撤销' }
    await this.k.commit([{ type: 'upsert', table: 'purchaseOrders', row }])
    // 营销预算：撤销即释放采购预占
    await this._poBudgetRelease(po, `采购撤销释放预占：${po.targetName} ×${po.qty}`, ctx)
    await this.audit.log('purchase-cancel', po.id,
      `撤销采购申请【${po.targetName}】×${po.qty}（审批前撤回，库存未变动）`,
      { tenantId: po.tenantId, ctx })
    return row
  }

  // 审批（通过/驳回；仅 pending；通过不动库存，入库以验收批次为准）
  async reviewOrder(poId, approve, note, ctx) {
    const po = this.requireOrder(poId)
    if (po.status !== 'pending') throw new BizError('IDEMPOTENT', '该采购单已审批，请勿重复操作', 409)
    const remark = (note || '').trim()
    const row = {
      ...po,
      status: approve ? 'approved' : 'rejected',
      approvedAt: `${this.k.todayDate()} ${this.k.nowTime()}`,
      approver: ctx.name, approveNote: remark
    }
    await this.k.commit([{ type: 'upsert', table: 'purchaseOrders', row }])
    // 营销预算：审批驳回即释放采购预占（通过则保留预占，待供应商结算时核销转实际付款）
    if (!approve) await this._poBudgetRelease(po, `采购驳回释放预占：${po.targetName} ×${po.qty}`, ctx)
    await this.audit.log(approve ? 'purchase-approve' : 'purchase-reject', po.id,
      approve
        ? `审批通过采购【${po.targetName}】×${po.qty}（申请人 ${po.applicant}），等待仓配分批验收入库${remark ? '；备注：' + remark : ''}`
        : `驳回采购【${po.targetName}】×${po.qty}（申请人 ${po.applicant}）${remark ? '；备注：' + remark : ''}；库存未变动`,
      { tenantId: po.tenantId, ctx })
    return row
  }

  // 分批验收入库（approved/receiving；实收 >0 且累计不超审批数量；幂等 effectId 防重复入账）
  // 「读 inboundQty → 校验待收 → 抬库存 → 回写累计」跨多个 await，并发验收会基于同一
  // 快照双双通过校验（累计入库超审批数量、PO 累计与库存账不一致），故按 po 键串行临界区。
  async inbound(poId, form, ctx) {
    return this.locks.run(`po:${poId}`, () => this._inbound(poId, form, ctx))
  }

  async _inbound(poId, form, ctx) {
    const po0 = this.requireOrder(poId)
    if (!['approved', 'receiving'].includes(po0.status)) {
      throw new BizError('STATE_DENIED', '仅已审批 / 验收中的采购单可验收入库', 409)
    }
    const qty = Math.floor(Number(form.qty) || 0)
    if (qty <= 0) throw new BizError('BAD_FORM', '本批合格入库数量需为正整数')
    const toReceive = po0.qty - po0.inboundQty
    if (qty > toReceive) {
      throw new BizError('OVER_INBOUND', `本次合格入库 ${qty} 超过待收数量 ${toReceive}（审批 ${po0.qty}，已收 ${po0.inboundQty}）`, 409)
    }
    // 到货量默认=合格量；到货−合格=验退拒收（不入库）；closeShortage 剩余待收按短少结案
    const deliveredRaw = form.deliveredQty === undefined || form.deliveredQty === null || form.deliveredQty === ''
      ? qty : Math.floor(Number(form.deliveredQty) || 0)
    if (deliveredRaw < qty) {
      throw new BizError('BAD_FORM', `本批到货量 ${deliveredRaw} 不能少于合格入库量 ${qty}（不合格部分请计入验退拒收）`)
    }
    const rejectedQty = deliveredRaw - qty
    const closeShortage = !!form.closeShortage && qty < toReceive
    const shortQty = closeShortage ? toReceive - qty : 0
    const t = this.targetOf(po0.targetType, po0.activityId, po0.targetId)
    const target = this.inventory.targetOf(po0.targetType, po0.activityId, po0.targetId)
    const traceId = this.k.newTraceId()
    const batchId = genId('pb')
    const before = t.row.remain
    // 幂等：同一批次 id 的库存抬升只生效一次（崩溃重放/重复提交安全）
    await this.inventory.receive(target, qty, `po-inbound:${batchId}`)
    const after = this.k.state.purchaseOrders.find((x) => x.id === po0.id)
    const filled = after.inboundQty + qty >= po0.qty
    const status = filled ? 'received' : (closeShortage ? 'diff_closed' : 'receiving')
    const batch = {
      id: batchId, poId: po0.id, poNo: po0.poNo,
      tenantId: po0.tenantId, traceId,
      targetType: po0.targetType, activityId: po0.activityId, targetId: po0.targetId,
      targetName: po0.targetName, icon: po0.icon,
      qty, deliveredQty: deliveredRaw, rejectedQty, shortQty,
      remainBefore: before, remainAfter: before + qty,
      stockBefore: t.row.stock - qty, stockAfter: t.row.stock,
      carrier: (form.carrier || '').trim() || po0.supplierName,
      inspector: ctx.name, acceptedInbound: true,
      date: this.k.todayDate(), time: this.k.nowTime(), ts: this.k.nowTs(),
      note: (form.note || '').trim()
    }
    const row = {
      ...after,
      inboundQty: after.inboundQty + qty,
      shortQty: (after.shortQty || 0) + shortQty,
      rejectedQty: (after.rejectedQty || 0) + rejectedQty,
      status,
      receivedAt: filled ? `${this.k.todayDate()} ${this.k.nowTime()}` : after.receivedAt,
      batches: [...(after.batches || []), batchId]
    }
    const events = [
      { type: 'insert', table: 'inboundBatches', row: batch },
      { type: 'upsert', table: 'purchaseOrders', row }
    ]
    const diffs = []
    const makeDiff = (type, dq, reason) => ({
      id: genId('ad'), type, poId: po0.id, poNo: po0.poNo, batchId,
      tenantId: po0.tenantId, traceId,
      targetType: po0.targetType, activityId: po0.activityId, targetId: po0.targetId,
      targetName: po0.targetName, icon: po0.icon,
      qty: dq, orderQty: po0.qty, inboundQtyAfter: row.inboundQty, supplierName: po0.supplierName,
      reason, inspector: ctx.name,
      date: this.k.todayDate(), time: this.k.nowTime(), ts: this.k.nowTs()
    })
    if (rejectedQty > 0) {
      const d = makeDiff('rejected', rejectedQty,
        (form.rejectReason || form.note || '').trim() || '到货破损/不合格，验退拒收（不入库）')
      diffs.push(d)
      events.push({ type: 'insert', table: 'acceptDiffs', row: d })
    }
    if (shortQty > 0) {
      const d = makeDiff('short', shortQty,
        (form.shortReason || '').trim() || '供应商到货短少且确认不再补发，按验收差异结案')
      diffs.push(d)
      events.push({ type: 'insert', table: 'acceptDiffs', row: d })
    }
    await this.k.commit(events)
    const diffText = rejectedQty
      ? `；本批到货 ${deliveredRaw}，验退拒收 ${rejectedQty}（不入库，已登记验收差异）` : ''
    await this.audit.log('purchase-inbound', po0.id,
      `采购验收入库【${po0.targetName}】本批合格 +${qty}（待收余 ${Math.max(po0.qty - row.inboundQty, 0)}），库存 ${before}→${before + qty}` +
      (filled ? '；采购单已全部入库完成' : closeShortage ? `；供应商确认短少 ${shortQty} 件不再补发，采购单按验收差异结案` : '，剩余批次待验收') +
      (batch.carrier ? `；供应商/承运：${batch.carrier}` : '') + diffText,
      { tenantId: po0.tenantId, ctx, traceId })
    if (shortQty > 0) {
      await this.audit.log('accept-diff-short', po0.id,
        `验收差异【到货短少】${po0.targetName} ×${shortQty}（采购 ${po0.poNo} 审批 ${po0.qty}、实收合格 ${row.inboundQty}）：供应商 ${po0.supplierName} 确认不再补发，差异转供应商结算扣款`,
        { tenantId: po0.tenantId, ctx, traceId })
    }
    if (rejectedQty > 0) {
      await this.audit.log('accept-diff-reject', po0.id,
        `验收差异【验退拒收】${po0.targetName} ×${rejectedQty}（采购 ${po0.poNo} 批次 ${batchId}，到货 ${deliveredRaw} / 合格 ${qty}）：不合格部分不入库，差异转供应商结算`,
        { tenantId: po0.tenantId, ctx, traceId })
    }

    // 缺货补发联动：全部入完且关联待补货售后时，提示从待处理售后继续履约
    let resumeReady = null
    if (filled && po0.afterSaleId) {
      resumeReady = this.k.state.afterSales.find((a) => a.id === po0.afterSaleId && a.status === 'waiting_stock') || null
      if (resumeReady) {
        await this.audit.log('aftersale-resume-ready', resumeReady.id,
          `采购 ${po0.poNo} 验收入库完成，待补货售后单【${resumeReady.targetName}】库存已就绪，可从待处理售后继续补发履约`,
          { tenantId: po0.tenantId, ctx, traceId })
      }
    }
    return { batch, order: row, diffs, resumeReady }
  }
}
