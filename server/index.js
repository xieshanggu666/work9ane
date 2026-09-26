// 服务端入口：node server/index.js [--port 8080] [--db data/server-wal.jsonl]
import { createApp } from './app.js'
import { createHttpServer } from './http.js'

const args = process.argv.slice(2)
const arg = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : def
}

const port = Number(arg('--port', process.env.PORT || 8080))
const dbFile = arg('--db', process.env.DB_FILE || 'data/server-wal.jsonl')
// --no-seed：空库启动（面向「离线快照迁移上云」的全新部署；库中已有数据时该开关无副作用）
const seedFresh = process.argv.includes('--no-seed') ? false : undefined

const app = await createApp({ dbFile, seed: seedFresh })
const server = createHttpServer(app)

server.listen(port, () => {
  console.log(`🎲 抽奖履约服务端已启动：http://localhost:${port}`)
  console.log(`   WAL 事件库：${dbFile}（崩溃自动续办；租户/积分/库存/风控/对账/审计全链路）`)
  console.log('   演示登录：POST /api/auth/customer-login {"userId":"u-1001"} / member-login {"memberId":"m-star-risk"}')
})

const shutdown = async () => {
  server.close()
  await app.k.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
