import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

// 服务端履约地址（dev 代理目标 / 健康检查）；可用环境变量 LOTTERY_SERVER 覆盖
const SERVER_TARGET = process.env.LOTTERY_SERVER || 'http://localhost:8080'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    port: 5174,
    open: false,
    proxy: {
      // 前端 API 客户端统一走 /api-proxy 前缀；健康检查与 REST 均转发到 Node 服务端
      '/api-proxy': {
        target: SERVER_TARGET,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api-proxy/, '')
      }
    }
  }
})
