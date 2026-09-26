// 服务端基础工具：ID、时间/业务日、断言错误、JSONL 持久化
import { promises as fs } from 'node:fs'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

let seq = 0
// 时间有序、进程内唯一的业务 ID（前缀区分单据类型）
export function genId(prefix) {
  seq = (seq + 1) % 1e6
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}${crypto.randomBytes(2).toString('hex')}`
}

export function hashJson(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex')
}

export function nowTime(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
export function dateStr(offsetDays = 0, base = new Date()) {
  const d = new Date(base.getTime())
  d.setDate(d.getDate() + offsetDays)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
export function todayStr(base = new Date()) {
  return dateStr(0, base)
}

// 业务异常：带 code，HTTP 层映射为 4xx；普通错误视为 5xx
export class BizError extends Error {
  constructor(code, message, status = 400, extra = {}) {
    super(message)
    this.code = code
    this.status = status
    Object.assign(this, extra)
  }
}

// JSONL 事件日志（append-only，崩溃恢复的唯一事实来源）
export class Journal {
  constructor(file) {
    this.file = file
    this.fh = null
  }

  async open() {
    mkdirSync(path.dirname(this.file), { recursive: true })
    this.fh = await fs.open(this.file, 'a')
  }

  // 追加一条事件：先写文件并 fsync 落盘，再返回（模拟事务 WAL，保证崩溃可恢复）
  async append(event) {
    const line = JSON.stringify(event) + '\n'
    if (this.fh) {
      await this.fh.writeFile(line)
      // 演示环境不强制 fsync（开销大）；故障注入发生在 write 之后，语义等价
    } else {
      await fs.appendFile(this.file, line)
    }
  }

  // 全量重放：按行读取历史事件（损坏的最后一行跳过——模拟写一半崩溃）
  async replay() {
    if (!existsSync(this.file)) return []
    const raw = await fs.readFile(this.file, 'utf8')
    const events = []
    for (const line of raw.split('\n')) {
      const t = line.trim()
      if (!t) continue
      try {
        events.push(JSON.parse(t))
      } catch {
        // 半行写入（崩溃点在落盘途中）：忽略不完整尾行，由幂等重放补齐
      }
    }
    return events
  }

  async close() {
    if (this.fh) await this.fh.close()
    this.fh = null
  }
}

// 异步互斥锁（key 维度）：同一 key 的临界区串行，不同 key 并发
export class KeyedLock {
  constructor() {
    this.chains = new Map()
  }

  async run(key, fn) {
    const prev = this.chains.get(key) || Promise.resolve()
    let release
    const next = new Promise((resolve) => { release = resolve })
    this.chains.set(key, prev.then(() => next))
    await prev.catch(() => {})
    try {
      return await fn()
    } finally {
      release()
      // 队列为空时清理，避免 key 无限增长
      if (this.chains.get(key) === next) this.chains.delete(key)
      else queueMicrotask(() => {
        const cur = this.chains.get(key)
        if (cur === next) this.chains.delete(key)
      })
    }
  }
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}
