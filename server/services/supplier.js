// 供应商结算与采购对账闭环（服务端）：
// 供应商账单 append-only：运营按采购单拟单（draft/reviewing）→ 财务复核（approved/rejected，驳回可修订重提）
// → 财务结算（settled）；结算按采购批次与售后补发回写库存对账快照（reconWriteback）并回写采购单。
// 金额口径：实收合格量 × 协议单价；关联售后补发履约占用件不重复付款（库存已在售后审核时扣减）；
//          到货短少未到货、验退拒收不入库，均不计价。P7 采购结算对账实时推导，独立于 P1–P6。
import { genId, BizError } from '../util.js'

const SETTLEABLE = (s) => s === 'received' || s === 'diff_closed'

export class SupplierService {
  constructor(deps) {
    this.k = deps.k
    this.audit = deps.audit
    this.locks = deps.locks
    this.budget = deps.budget
  }

  requirePo(poId) {
    const po = this.k.state.purchaseOrders.find((x) => x.id === poId)
    if (!po) throw new BizError('PO_NOT_FOUND', '采购单不存在', 404)
    return po
  }

  requireBill(billId) {
    const list = this.k.state.supplierBills.filter((b) => b.id === billId)
    return list.find((b) => b.status !== 'rejected') || list[0] || null
  }

  billOfPo(poId) {
    return this.k.state.supplierBills.find((b) => b.poId === poId && b.status !== 'rejected') ||
      this.k.state.supplierBills.find((b) => b.poId === poId) || null
  }

  // 采购批次 → 验收/补发对账行（append-only 推导）
  settleRowsOfPo(po) {
    const batches = this.k.state.inboundBatches
      .filter((b) => b.poId === po.id)
      .sort((a, b) => a.ts - b.ts)
    const reshipDone = this.k.state.afterSales.some(
      (a) => a.id === po.afterSaleId && a.status === 'done' && a.type === 'reship' && a.reshipmentId)
    let reshipLeft = po.purpose === 'aftersale' && reshipDone ? 1 : 0
    const rows = batches.map((b, idx) => {
      const reshipQty = Math.min(reshipLeft, b.qty)
      reshipLeft -= reshipQty
      const ds = this.k.state.acceptDiffs.filter((d) => d.batchId === b.id && d.poId === po.id)
      return {
        seq: idx + 1, batchId: b.id, date: b.date, time: b.time,
        deliveredQty: b.deliveredQty ?? b.qty, acceptedQty: b.qty,
        rejectedQty: ds.filter((d) => d.type === 'rejected').reduce((n, d) => n + d.qty, 0),
        shortQty: ds.filter((d) => d.type === 'short').reduce((n, d) => n + d.qty, 0),
        reshipQty, billableQty: b.qty - reshipQty,
        inspector: b.inspector, carrier: b.carrier, note: b.note
      }
    })
    return {
      rows,
      reshipAllocated: rows.reduce((n, r) => n + r.reshipQty, 0),
      reshipPending: (po.purpose === 'aftersale' && !reshipDone) ? 1 : Math.max(0, reshipLeft)
    }
  }

  amountOfPo(po) {
    const price = po.unitPrice || 0
    const accepted = po.inboundQty || 0
    const { rows, reshipAllocated } = this.settleRowsOfPo(po)
    const billableQty = rows.reduce((n, r) => n + r.billableQty, 0)
    const grossAmount = Math.round(accepted * price * 100) / 100
    const reshipDeduct = Math.round(reshipAllocated * price * 100) / 100
    return {
      unitPrice: price, acceptedQty: accepted, billableQty,
      shortQty: po.shortQty || 0, rejectedQty: po.rejectedQty || 0,
      reshipQty: reshipAllocated, grossAmount, reshipDeduct,
      payableAmount: Math.round((grossAmount - reshipDeduct) * 100) / 100
    }
  }

  // 运营拟账单（supplier:bill；submit=false 草稿 / true 提交复核）
  async createBill(poId, form, ctx) {
    return this.locks.run(`po-bill:${poId}`, () => this._createBill(poId, form, ctx))
  }

  async _createBill(poId, form, ctx) {
    const po = this.requirePo(poId)
    if (po.tenantId !== ctx.tenantId) throw new BizError('FORBIDDEN', '采购单不属于当前租户', 403)
    if (!SETTLEABLE(po.status)) {
      throw new BizError('STATE_DENIED', '采购单入库完成（或验收差异结案）后才可发起供应商账单', 409)
    }
    const all = this.k.state.supplierBills.filter((b) => b.poId === poId)
    const existed = all.find((b) => b.status === 'rejected' || b.status === 'draft') || null
    const blocking = all.find((b) => !['rejected', 'draft'].includes(b.status))
    if (blocking) throw new BizError('IDEMPOTENT', '该采购单已有供应商账单（一张采购单仅结算一次）', 409)

    const amount = this.amountOfPo(po)
    const pack = this.settleRowsOfPo(po)
    const submit = !!form.submit
    const traceId = existed?.traceId || this.k.newTraceId()
    const bill = {
      id: existed?.id || genId('sb'),
      billNo: existed?.billNo || ('SB' + Date.now().toString(36).toUpperCase() + String(Math.floor(Math.random() * 90) + 10)),
      poId: po.id, poNo: po.poNo, tenantId: po.tenantId, traceId,
      targetType: po.targetType, activityId: po.activityId, targetId: po.targetId,
      targetName: po.targetName, icon: po.icon,
      supplierName: po.supplierName, unitPrice: po.unitPrice,
      purpose: po.purpose, purposeLabel: po.purposeLabel, afterSaleId: po.afterSaleId || '',
      orderQty: po.qty, ...amount,
      rows: pack.rows, reshipPending: pack.reshipPending,
      status: submit ? 'reviewing' : 'draft',
      note: (form.note || '').trim(),
      applicant: ctx.name, applicantId: ctx.memberId || ctx.userId,
      createdAt: this.k.todayDate(), time: this.k.nowTime(), ts: this.k.nowTs(),
      submittedAt: submit ? `${this.k.todayDate()} ${this.k.nowTime()}` : (existed?.submittedAt || ''),
      reviewedAt: '', reviewer: '', reviewNote: '',
      settledAt: '', settleOperator: '', settleNote: '', reconWriteback: null
    }
    await this.k.commit([{ type: existed ? 'upsert' : 'insert', table: 'supplierBills', row: bill }])
    await this.audit.log('supplier-bill-create', bill.id,
      `发起供应商账单【${bill.targetName}】${bill.billNo}：供应商 ${bill.supplierName}，实收合格 ${bill.acceptedQty} 件 × ${bill.unitPrice} 元` +
      (bill.reshipQty ? `，售后补发履约占用 ${bill.reshipQty} 件不重复付款（-${bill.reshipDeduct} 元）` : '') +
      (bill.shortQty || bill.rejectedQty ? `，验收差异短少 ${bill.shortQty}/验退 ${bill.rejectedQty}（未到货/不入库不计价）` : '') +
      `，应付 ${bill.payableAmount} 元` + (submit ? '；已提交财务复核' : '；草稿待提交'),
      { tenantId: po.tenantId, ctx, traceId })
    if (pack.reshipPending > 0) {
      await this.audit.log('supplier-bill-pending-reship', bill.id,
        `供应商账单【${bill.targetName}】提示：关联售后补发尚未履约完成（${po.afterSaleId} 仍待补发），本次按实收合格量全额计价，补发完成后结算将自动扣减对应件数`,
        { tenantId: po.tenantId, ctx, traceId })
    }
    return this.requireBill(bill.id)
  }

  // 草稿/驳回账单提交复核
  async submitBill(billId, form, ctx) {
    const b = this.requireBill(billId)
    if (!b) throw new BizError('BILL_NOT_FOUND', '供应商账单不存在', 404)
    if (!['draft', 'rejected'].includes(b.status)) {
      throw new BizError('STATE_DENIED', '仅草稿/被驳回的账单可提交复核', 409)
    }
    return this.createBill(b.poId, { ...form, submit: true }, ctx)
  }

  // 财务复核（supplier:review；RBAC 由 HTTP 层强制，服务层保证租户归属与状态机）
  async reviewBill(billId, approve, note, ctx) {
    const bill = this.requireBill(billId)
    if (!bill) throw new BizError('BILL_NOT_FOUND', '供应商账单不存在', 404)
    if (bill.tenantId !== ctx.tenantId) throw new BizError('FORBIDDEN', '账单不属于当前租户', 403)
    if (bill.status !== 'reviewing') throw new BizError('STATE_DENIED', '该账单当前状态不可复核（需运营先提交）', 409)
    const po = this.requirePo(bill.poId)
    // 复核时以最新台账重算（拟单后批次/售后补发可能变化）
    Object.assign(bill, this.amountOfPo(po), this.settleRowsOfPo(po))
    const remark = (note || '').trim()
    const row = approve
      ? { ...bill, status: 'approved', reviewedAt: `${this.k.todayDate()} ${this.k.nowTime()}`, reviewer: ctx.name, reviewNote: remark }
      : { ...bill, status: 'rejected', reviewedAt: `${this.k.todayDate()} ${this.k.nowTime()}`, reviewer: ctx.name, reviewNote: remark }
    await this.k.commit([{ type: 'upsert', table: 'supplierBills', row }])
    await this.audit.log(approve ? 'supplier-bill-approve' : 'supplier-bill-reject', bill.id,
      approve
        ? `复核通过供应商账单 ${bill.billNo}【${bill.targetName}】：实收合格 ${row.acceptedQty} 件、应付 ${row.payableAmount} 元` +
          (row.reshipQty ? `（含售后补发占用 ${row.reshipQty} 件不付款）` : '') + `${remark ? '；备注：' + remark : ''}，待财务结算付款`
        : `复核驳回供应商账单 ${bill.billNo}【${bill.targetName}】${remark ? '；意见：' + remark : ''}（退回运营修订后重新提交，账单保留不删除）`,
      { tenantId: bill.tenantId, ctx, traceId: bill.traceId })
    return this.requireBill(bill.id)
  }

  // 财务结算（supplier:settle）：approved → settled，回写库存对账快照与采购单
  async settleBill(billId, note, ctx) {
    return this.locks.run(`supplier-bill:${billId}`, () => this._settleBill(billId, note, ctx))
  }

  async _settleBill(billId, note, ctx) {
    const bill0 = this.requireBill(billId)
    if (!bill0) throw new BizError('BILL_NOT_FOUND', '供应商账单不存在', 404)
    if (bill0.tenantId !== ctx.tenantId) throw new BizError('FORBIDDEN', '账单不属于当前租户', 403)
    if (bill0.status !== 'approved') throw new BizError('STATE_DENIED', '仅复核通过的账单可执行结算付款', 409)
    const po = this.requirePo(bill0.poId)
    const amount = this.amountOfPo(po)
    const pack = this.settleRowsOfPo(po)
    Object.assign(bill0, amount, { rows: pack.rows, reshipPending: pack.reshipPending })
    const at = `${this.k.todayDate()} ${this.k.nowTime()}`
    const targetKey = po.targetType === 'prize' ? `prize:${po.activityId}:${po.targetId}` : `goods:${po.targetId}`
    const writeback = {
      at, bizDate: this.k.todayDate(),
      targetType: po.targetType, activityId: po.activityId, targetId: po.targetId, targetKey,
      targetName: po.targetName,
      orderQty: po.qty, acceptedQty: amount.acceptedQty, shortQty: amount.shortQty, rejectedQty: amount.rejectedQty,
      reshipQty: pack.reshipAllocated, billableQty: amount.billableQty,
      unitPrice: amount.unitPrice, grossAmount: amount.grossAmount,
      reshipDeduct: amount.reshipDeduct, payableAmount: amount.payableAmount,
      rows: pack.rows.map((r) => ({ ...r }))
    }
    const row = { ...bill0, status: 'settled', settledAt: at, settleOperator: ctx.name, settleNote: (note || '').trim(), reconWriteback: writeback }
    const poRow = { ...po, settledBillId: bill0.id }
    await this.k.commit([
      { type: 'upsert', table: 'supplierBills', row },
      { type: 'upsert', table: 'purchaseOrders', row: poRow }
    ])
    // 营销预算闭环（结算付款时落账）：
    //  1) 核销采购单在途预占（按审批数量×协议单价预占的部分）；
    //  2) 按账单应付金额记实际资金成本（实收合格量×单价，含补发占用扣减）；
    //  3) 关联缺货补发已履约的，补发件在此结算（不重复计价/入库）。
    if (this.budget) {
      const poScopeType = po.targetType === 'prize' ? 'activity' : 'tenant'
      const poScopeId = po.targetType === 'prize' ? po.activityId : po.tenantId
      await this.budget.releaseReserved('po', po.id, {
        category: 'purchase', kind: 'purchase-commit',
        summary: `供应商结算核销采购预占：${po.targetName}（账单 ${bill0.billNo}）`,
        tenantId: po.tenantId, traceId: bill0.traceId
      }, ctx)
      if (amount.payableAmount > 0) {
        await this.budget.occupy('settle',
          { unit: 'money', amount: amount.payableAmount, scopeType: poScopeType, scopeId: poScopeId },
          {
            category: 'supplier', kind: 'supplier-payment',
            refType: 'supplier-bill', refId: bill0.id, bizNo: bill0.billNo,
            summary: `供应商付款：${po.supplierName}【${po.targetName}】应付 ${amount.payableAmount} 元（实收合格 ${amount.acceptedQty} 件）`,
            tenantId: po.tenantId, userId: po.applicantId, traceId: bill0.traceId
          }, ctx)
      }
      if (pack.reshipAllocated > 0) {
        await this.budget.settleReserved('aftersale', po.afterSaleId, {
          category: 'reship', kind: 'reship-cost',
          summary: `缺货补发成本随采购结算：${po.targetName} ${pack.reshipAllocated} 件`,
          traceId: bill0.traceId
        }, ctx)
      }
    }
    await this.audit.log('supplier-settle', bill0.id,
      `结算付款供应商账单 ${bill0.billNo}【${bill0.targetName}】：供应商 ${bill0.supplierName} 应付 ${row.payableAmount} 元（实收合格 ${row.acceptedQty} × ${row.unitPrice}` +
      (row.reshipQty ? ` − 售后补发占用 ${row.reshipQty} 件 ${row.reshipDeduct} 元` : '') + '）；已按采购批次回写库存对账（到货/合格/验退/短少/补发占用逐批勾稽）' +
      ((note || '').trim() ? '；备注：' + (note || '').trim() : ''),
      { tenantId: bill0.tenantId, ctx, traceId: bill0.traceId })
    if (row.reshipQty > 0) {
      await this.audit.log('supplier-recon-reship', bill0.afterSaleId || bill0.id,
        `库存对账回写：采购 ${bill0.poNo} 关联售后补发 ${bill0.afterSaleId} 已履约，结算时按批次勾稽出 ${row.reshipQty} 件为补发占用（库存已在售后审核时扣减，不重复计价、不重复入库）`,
        { tenantId: bill0.tenantId, ctx, traceId: bill0.traceId })
    }
    return this.requireBill(bill0.id)
  }

  // P7 采购结算对账（纯推导，不计入 P1–P6 openCount）
  computeRecon(tenantId) {
    const inT = (x) => (x.tenantId || 't-star') === tenantId
    const items = []
    for (const po of this.k.state.purchaseOrders.filter(inT)) {
      if (!SETTLEABLE(po.status)) continue
      const bill = this.billOfPo(po.id)
      const batches = this.k.state.inboundBatches.filter((b) => b.poId === po.id)
      const accepted = batches.reduce((n, b) => n + (b.qty || 0), 0)
      const diffs = this.k.state.acceptDiffs.filter((d) => d.poId === po.id)
      const short = diffs.filter((d) => d.type === 'short').reduce((n, d) => n + d.qty, 0)
      const rejected = diffs.filter((d) => d.type === 'rejected').reduce((n, d) => n + d.qty, 0)
      const delivered = batches.reduce((n, b) => n + (b.deliveredQty ?? b.qty), 0)
      const reshipAs = this.k.state.afterSales.find((a) => a.id === po.afterSaleId)
      const reshipDone = !!reshipAs && reshipAs.status === 'done' && reshipAs.type === 'reship' && !!reshipAs.reshipmentId
      const issues = []
      if (po.inboundQty !== accepted) issues.push({ kind: 'inbound-mismatch', label: `采购单累计实收 ${po.inboundQty} ≠ 验收批次合计 ${accepted}`, autoFixable: false })
      if (delivered !== accepted + rejected) issues.push({ kind: 'delivered-mismatch', label: `到货 ${delivered} ≠ 合格 ${accepted} + 验退 ${rejected}`, autoFixable: false })
      if (accepted + short !== po.qty) issues.push({ kind: 'qty-open', label: `合格 ${accepted} + 短少 ${short} ≠ 审批 ${po.qty}（采购单未闭环）`, autoFixable: false })
      if (po.purpose === 'aftersale' && !reshipDone) issues.push({ kind: 'reship-pending', label: '关联售后补发尚未履约完成，结算缺补发回写（应付款含补发件，需待履约后复核）', autoFixable: false })
      if (!bill) {
        issues.push({ kind: 'bill-missing', label: '已入库完成但尚未发起供应商账单', autoFixable: true })
      } else {
        const amount = this.amountOfPo(po)
        if (bill.status !== 'settled' && (bill.payableAmount !== amount.payableAmount || bill.acceptedQty !== amount.acceptedQty)) {
          issues.push({ kind: 'amount-stale', label: `账单金额/数量与最新台账不一致（账单 ${bill.payableAmount}/${bill.acceptedQty}，最新 ${amount.payableAmount}/${amount.acceptedQty}），需重新推导`, autoFixable: true })
        }
        if (bill.status === 'settled' && !bill.reconWriteback) issues.push({ kind: 'writeback-missing', label: '已结算但缺少库存对账回写快照', autoFixable: false })
        if (bill.status === 'reviewing') issues.push({ kind: 'settle-open', label: '账单待财务复核', autoFixable: true })
        if (bill.status === 'approved') issues.push({ kind: 'settle-open', label: '账单复核通过，待结算付款', autoFixable: true })
        if (bill.status === 'rejected') issues.push({ kind: 'bill-rejected', label: '账单被财务驳回，待运营修订重提', autoFixable: true })
      }
      items.push({
        poId: po.id, poNo: po.poNo, targetName: po.targetName, icon: po.icon,
        supplierName: po.supplierName, status: po.status,
        orderQty: po.qty, acceptedQty: accepted, shortQty: short, rejectedQty: rejected,
        reshipDone, reshipmentId: reshipAs?.reshipmentId || '',
        billId: bill?.id || '', billStatus: bill?.status || '',
        payableAmount: bill?.payableAmount ?? null, issues
      })
    }
    return {
      tenantId, generatedAt: this.k.nowTs(),
      items,
      openCount: items.reduce((n, x) => n + x.issues.length, 0),
      openPo: items.filter((x) => x.issues.length).length,
      settledPo: items.filter((x) => x.billStatus === 'settled' && !x.issues.length).length
    }
  }
}
