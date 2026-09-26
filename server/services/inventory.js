// 库存服务：奖品（按活动维度）/商品（按 goodsId）两类 SKU；
// remain 可用 + frozen 预占两栏；扣减/预占/核销/回补均为 append 事件，库存不足整笔失败（不超卖）。
import { BizError } from '../util.js'

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
  async hold(target, qty = 1) {
    this.requireAvailable(target, qty)
    await this.k.commit([{ type: 'inv.mut', key: target.key, dRemain: -qty, dFrozen: qty }])
  }
  // 核销预占：frozen -qty（remain 已在预占时扣过；风控放行）
  async consumeHeld(target, qty = 1) {
    if ((target.row.frozen || 0) < qty) {
      throw new BizError('STOCK_FROZEN_MISMATCH', `【${target.row.name}】预占库存不足（${target.row.frozen || 0}）`, 409)
    }
    await this.k.commit([{ type: 'inv.mut', key: target.key, dRemain: 0, dFrozen: -qty }])
  }
  // 直接扣减：remain -qty（正常落账）
  async deduct(target, qty = 1) {
    this.requireAvailable(target, qty)
    await this.k.commit([{ type: 'inv.mut', key: target.key, dRemain: -qty, dFrozen: 0 }])
  }
  // 释放预占并回补：remain +qty、frozen -qty（风控撤销）
  async releaseHeld(target, qty = 1) {
    await this.k.commit([{ type: 'inv.mut', key: target.key, dRemain: qty, dFrozen: -qty }])
  }
  // 仅回补（售后拒收/退货）
  async replenish(target, qty = 1) {
    await this.k.commit([{ type: 'inv.mut', key: target.key, dRemain: qty, dFrozen: 0 }])
  }
  // 采购验收入库：可用余量 +qty、账面总量 +qty（按验收批次实收，库存目标行需带 stock）
  async receive(target, qty = 1, effectId = '') {
    await this.k.commit([{ type: 'inv.mut', key: target.key, dRemain: qty, dFrozen: 0, dStock: qty, effectId: effectId || undefined }])
  }
  // 对账库存校正（append 调整凭证由对账服务负责写，这里只动账面）
  async adjust(target, delta) {
    await this.k.commit([{ type: 'inv.mut', key: target.key, dRemain: delta, dFrozen: 0 }])
  }
}
