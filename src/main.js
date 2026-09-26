import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { createRemoteBridge } from './api/bridge'
import './style.css'

const pinia = createPinia()
// 服务端履约桥：本地有令牌时自动进入 server 模式；写操作统一走 REST（RBAC/幂等/并发/WAL），
// 视图状态由 /api/state 快照水合。无令牌时保持纯本地模式（零后端可浏览）。
pinia.use(createRemoteBridge())

createApp(App).use(pinia).mount('#app')
