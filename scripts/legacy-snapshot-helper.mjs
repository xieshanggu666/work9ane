// 离线快照提取 helper：经 esbuild 把依赖 @ 别名的 legacy-snapshot 打包为可直接 import 的 ESM。
// 与浏览器端 store.exportOfflineSnapshot() 产出的快照同构，供 HTTP 冒烟测试构造迁移载荷。
import { build } from 'esbuild'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'

const OUT = path.resolve('node_modules/.cache/legacy-snapshot-helper.mjs')

export async function extractLegacySnapshot() {
  await build({
    entryPoints: ['scripts/legacy-snapshot-entry.mjs'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    alias: { '@': path.resolve('src') },
    outfile: OUT,
    logLevel: 'warning'
  })
  const mod = await import(pathToFileURL(OUT).href + `?t=${Date.now()}`)
  const snap = mod.extractLegacySnapshot()
  // JSON 往返纯化：剥离 Pinia 响应式 proxy/不可枚举字段，保证经 fetch 传输字段不丢失
  return JSON.parse(JSON.stringify(snap))
}

// 兼容测试脚本中可能的直接读取
export function snapshotPath() {
  return fs.existsSync(OUT) ? OUT : ''
}
