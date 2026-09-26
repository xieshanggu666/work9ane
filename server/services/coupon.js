// 卡券服务：一业务记录至多一券、券码租户内唯一；
// issue 正常发券 / hold 仅预占库存不发券 / deliver 放行交付 / revoke 释放 / redeem 核销 / expire 到期。
import crypto from 'node:crypto'
import { genId, BizError } from '../util.js'

const ACTION_LABELS = {
  issue: '卡券发放', hold: '风控预占', deliver: '放行交付', release: '预占释放', revoke: '撤销释放',
  redeem: '卡券核销', expire: '到期失效', comp: '对账补券'
}

export class CouponService {
  constructor(k, audit) {
    this.k = k
    this.audit = audit
  }

  tpl(id) { return this.k.state.couponTpls.find((t) => t.id === id) || null }

  normCode(code) {
    return String(code || '').replace(/[\s-]/g, '').toUpperCase()
  }

  byCode(code, tenantId) {
    const key = this.normCode(code)
    return this.k.state.coupons.find((c) => this.normCode(c.code) === key &&
      (!tenantId || (c.tenantId || 't-star') === tenantId)) || null
  }

  ofRecord(recordId) {
    return this.k.state.coupons.find((c) => c.recordId === recordId) || null
  }

  genCode(tenantId) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    for (let i = 0; i < 12; i++) {
      const body = Array.from({ length: 10 }, () => chars[crypto.randomInt(chars.length)]).join('')
      const code = `CP-${body.slice(0, 5)}-${body.slice(5)}`
      if (!this.k.state.coupons.some((c) => c.code === code && (c.tenantId || 't-star') === tenantId)) return code
    }
    return `CP-${genId('x').slice(-10).toUpperCase()}`
  }

  expiry(tpl, fromDay) {
    const d = new Date(`${fromDay}T00:00:00`)
    d.setDate(d.getDate() + Math.max(0, (tpl.validityDays || 30) - 1))
    const p = (n) => String(n).padStart(2, '0')
    d.setHours(23, 59, 59, 999)
    return { ts: d.getTime(), date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` }
  }

  async addLog(action, couponId, rec, extra = {}) {
    const tpl = rec?.couponId ? this.tpl(rec.couponId) : null
    const row = {
      id: genId('cl'),
      action, actionLabel: ACTION_LABELS[action] || action,
      couponId: couponId || '',
      code: extra.code || '',
      tplId: rec?.couponId || extra.tplId || '',
      tplName: tpl?.name || extra.tplName || rec?.prizeName || rec?.goodsName || '',
      recordId: rec?.id || extra.recordId || '',
      bizType: rec?.type || extra.bizType || '',
      orderId: extra.orderId || '',
      tenantId: extra.tenantId || rec?.tenantId || 't-star',
      traceId: extra.traceId || rec?.traceId || '',
      operator: extra.operator || '系统',
      note: extra.note || '',
      date: this.k.todayDate(),
      time: this.k.nowTime(),
      ts: this.k.nowTs()
    }
    await this.k.commit([{ type: 'insert', table: 'couponLogs', row }])
    return row
  }

  // 发券（幂等：recordId 唯一；状态须 normal/released）。source 决定 issue/deliver 台账语义。
  async issueForRecord(rec, opts = {}) {
    if (!rec || !['normal', 'released'].includes(rec.status)) return null
    if (!rec.couponId) return null
    const existed = this.ofRecord(rec.id)
    if (existed) return { coupon: existed, duplicated: true }
    const tpl = this.tpl(rec.couponId)
    if (!tpl) return null
    const tid = rec.tenantId || 't-star'
    const exp = this.expiry(tpl, this.k.todayDate())
    const isDraw = rec.type === 'draw'
    const source = opts.source || (rec.status === 'released' ? '风控放行' : isDraw ? '中奖' : '积分兑换')
    const coupon = {
      id: genId('cp'),
      code: opts.code || this.genCode(tid),
      tplId: tpl.id, name: tpl.name, type: tpl.type,
      typeLabel: tpl.typeLabel || '',
      emoji: tpl.emoji || '🎟️',
      denomination: tpl.denomination || 0, threshold: tpl.threshold || 0,
      face: tpl.face || '', desc: tpl.desc || '', validityDays: tpl.validityDays || 30,
      status: 'available',
      tenantId: tid,
      userId: rec.userId, userName: rec.userName || '',
      recordId: rec.id, bizType: rec.type,
      activityId: isDraw ? rec.activityId : null,
      source,
      issueDate: this.k.todayDate(),
      time: this.k.nowTime(),
      ts: this.k.nowTs(),
      traceId: rec.traceId || opts.traceId || '',
      expireDate: exp.date, expireTs: exp.ts,
      redeemedAt: '', redeemOperator: '', redeemChannel: '', redeemNote: '',
      compensateBillId: opts.compensateBillId || '',
      comp: !!opts.compensateBillId
    }
    await this.k.commit([{ type: 'insert', table: 'coupons', row: coupon }])
    const action = source === '风控放行' ? 'deliver' : 'issue'
    await this.addLog(action, coupon.id, rec, { code: coupon.code, orderId: opts.orderId || rec.riskOrderId || '', tenantId: tid, traceId: coupon.traceId })
    await this.audit.log(action === 'deliver' ? 'coupon-deliver' : 'coupon-issue', rec.riskOrderId || '',
      `发放卡券【${tpl.name}】（券码 ${coupon.code}，有效期至 ${exp.date}）：${isDraw ? `抽奖中奖【${rec.prizeName}】` : `积分兑换【${rec.goodsName}】`}${action === 'deliver' ? '，风控放行后交付（有效期自放行日起算）' : ''}`,
      { tenantId: tid, traceId: coupon.traceId })
    return { coupon, duplicated: false }
  }

  // 到期扫描：跨全部租户，已过到期时刻的 available 券流转 expired（幂等）
  async sweepExpiry(silent = true) {
    const now = this.k.nowTs()
    const due = this.k.state.coupons.filter((c) => c.status === 'available' && c.expireTs < now)
    for (const c of due) {
      const rec = this.k.state.records.find((r) => r.id === c.recordId) || null
      const row = { ...c, status: 'expired' }
      await this.k.commit([{ type: 'upsert', table: 'coupons', row }])
      await this.addLog('expire', c.id, rec, { code: c.code, tplId: c.tplId, tplName: c.name, tenantId: c.tenantId })
    }
    if (due.length) {
      const byTenant = new Map()
      due.forEach((c) => {
        const k = c.tenantId || 't-star'
        if (!byTenant.has(k)) byTenant.set(k, [])
        byTenant.get(k).push(c)
      })
      for (const [tid, list] of byTenant) {
        await this.audit.log('coupon-expire', '',
          `卡券到期扫描：${list.length} 张券已过期失效（${list.map((c) => `${c.name} ${c.code}`).join('；')}）`,
          { tenantId: tid })
      }
    }
    return due.length
  }

  // 运营核销（RBAC/租户校验由调用方完成）：重复/过期/跨租户均拦截，状态机幂等
  async redeem(code, ctx, form = {}) {
    await this.sweepExpiry(true)
    const tid = ctx.tenantId
    const c = this.byCode(code, tid)
    if (!c) {
      const foreign = this.byCode(code)
      if (foreign) {
        await this.audit.log('cross-tenant-denied', '',
          `⛔ 券码 ${foreign.code} 属于其他租户，当前账号无权核销（数据强隔离）`,
          { tenantId: tid, ctx, result: 'denied', module: 'coupon' })
        throw new BizError('CROSS_TENANT', '券码属于其他租户，无权核销', 403)
      }
      throw new BizError('COUPON_NOT_FOUND', '券码不存在，请核对后重试', 404)
    }
    if (c.status === 'redeemed') {
      return { duplicated: true, coupon: c }
    }
    if (c.status === 'expired' || c.expireTs < this.k.nowTs()) {
      if (c.status !== 'expired') {
        await this.k.commit([{ type: 'upsert', table: 'coupons', row: { ...c, status: 'expired' } }])
        const rec = this.k.state.records.find((r) => r.id === c.recordId) || null
        await this.addLog('expire', c.id, rec, { code: c.code, tplId: c.tplId, tplName: c.name, tenantId: c.tenantId })
      }
      throw new BizError('COUPON_EXPIRED', `该券已于 ${c.expireDate} 到期，无法核销`, 409)
    }
    const channel = (form.channel || '到店扫码').trim() || '到店扫码'
    const note = (form.note || '').trim()
    const row = {
      ...c, status: 'redeemed',
      redeemedAt: `${this.k.todayDate()} ${this.k.nowTime()}`,
      redeemOperator: ctx.name, redeemChannel: channel, redeemNote: note
    }
    await this.k.commit([{ type: 'upsert', table: 'coupons', row }])
    const rec = this.k.state.records.find((r) => r.id === c.recordId) || null
    const traceId = this.k.newTraceId()
    await this.addLog('redeem', c.id, rec, {
      code: c.code, note: note ? `${channel}：${note}` : channel, tenantId: c.tenantId,
      traceId, operator: `运营(${ctx.name})`
    })
    await this.audit.log('coupon-redeem', '',
      `核销卡券【${c.name}】券码 ${c.code}（用户 ${c.userName}，渠道 ${channel}，有效期至 ${c.expireDate}）${note ? '；备注：' + note : ''}`,
      { tenantId: c.tenantId, ctx, traceId })
    return { coupon: row }
  }
}
