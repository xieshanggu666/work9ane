// esbuild 打包入口：导出旧 Pinia store 台账快照（供 HTTP 迁移冒烟构造载荷）
import { extractLegacySnapshot as extract } from '../server/legacy-snapshot.js'

export function extractLegacySnapshot() {
  return extract()
}
