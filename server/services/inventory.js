// 库存服务：奖品（按活动维度）/商品（按 goodsId）两类 SKU；
// remain 可用 + frozen 预占两栏；扣减/预占/核销/回补均为 append 事件，库存不足整笔失败（不超卖）。
// 每笔变动统一带：
//   effectId 续办/重放幂等键；
//   bizDate  归属业务日（风控放行核销预占→冻结业务日；撤销回补→实际审核日；其余通常=处理日）；
//   date     实际处理日；
// 并同步登记 append-only 库存台账 stockLedger（P5 按业务日/处理日双口径勾稽底账）。

// 统一构造 inv.mut 事件（调用方只需给出语义化参数）
function mutEvent(key, { dRemain = 0, dFrozen = 0, dStock = 0, effectId = '', kind = 'mut',
  bizDate = '', date = '', refType = '', refId = '', tenantId = '', traceId = '' } = {}, k) {
  return {
    type: 'inv.mut', key, dRemain, dFrozen, dStock,
    effectId: effectId || undefined, kind,
    bizDate: bizDate || k.todayDate(), date: date || k.todayDate(),
    refType, refId, tenantId, traceId
  }
}

export class InventoryService {
  constructor(k) {
    this.k = k
  }

  targetOf(targetType, refId, targetId) {
    const key = this.k.stockKeyOf(targetType, refId, targetId)
    const hit = this.k.findStock(key)
    if (!hit) throw new BizError('STOCK_MISSING', '库存目标不存在', 404, { key })
    return { ...hit, key }
  }

  // 校验可用库存（调用方持锁）
  requireAvailable(target, qty = 1) {
    if (target.row.remain < qty) {
      throw new BizError('OUT_OF_STOCK', `【${target.row.name}】库存不足（剩余 ${target.row.remain}）`, 409, {
        remain: target.row.remain, need: qty
      })
    }
  }

  // 预占：remain -qty、frozen +qty（风控冻结，不超卖）
  async hold(target, qty = 1, refs = {}) {
    this.requireAvailable(target, qty)
    await this.k.commit([mutEvent(target.key, {
      dRemain: -qty, dFrozen: qty, kind: 'hold', ...refs
    }, this.k)])
  }
  // 核销预占：frozen -qty（remain 已在预占时扣过；风控放行）
  async consumeHeld(target, qty = 1, refs = {}) {
    if ((target.row.frozen || 0) < qty) {
      throw new BizError('STOCK_FROZEN_MISMATCH', `【${target.row.name}】预占库存不足（${target.row.frozen || 0}）`, 409)
    }
    await this.k.commit([mutEvent(target.key, {
      dFrozen: -qty, kind: 'consume-held', ...refs
    }, this.k)])
  }
  // 直接扣减：remain -qty（正常落账）
  async deduct(target, qty = 1, refs = {}) {
    this.requireAvailable(target, qty)
    await this.k.commit([mutEvent(target.key, {
      dRemain: -qty, kind: refs.kind || 'deduct', ...refs
    }, this.k)])
  }
  // 释放预占并回补：remain +qty、frozen -qty（风控撤销）
  async releaseHeld(target, qty = 1, refs = {}) {
    await this.k.commit([mutEvent(target.key, {
      dRemain: qty, dFrozen: -qty, kind: 'revoke-restock', ...refs
    }, this.k)])
  }
  // 仅回补（售后拒收/退货）
  async replenish(target, qty = 1, refs = {}) {
    await this.k.commit([mutEvent(target.key, {
      dRemain: qty, kind: refs.kind || 'aftersale-return', ...refs
    }, this.k)])
  }
  // 采购验收入库：可用余量 +qty、账面总量 +qty（按验收批次实收，库存目标行需带 stock）
  async receive(target, qty = 1, effectId = '', refs = {}) {
    await this.k.commit([mutEvent(target.key, {
      dRemain: qty, dStock: qty, effectId: effectId || undefined,
      kind: 'purchase-inbound', ...refs
    }, this.k)])
  }
  // 对账库存校正：仅登记 append-only 调整凭证（recon 服务负责），不凭空改动实物账
  async adjust(target, delta) {
    await this.k.commit([mutEvent(target.key, { dRemain: delta, kind: 'mut' }, this.k)])
  }
}
