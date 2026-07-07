import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import type { ProxyOptions } from 'vite';

// daemon 未启动 / WS 重置时 http-proxy 会抛 ECONNRESET/ECONNABORTED——
// 这是 dev 常态噪声（前端会自动重连），静默为一行简讯，不刷堆栈。
const quiet = (proxy: any) => {
  proxy.on('error', (err: NodeJS.ErrnoException) => {
    if (['ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'EPIPE'].includes(err.code || '')) {
      // daemon 暂不可达，忽略
      return;
    }
    console.warn('[proxy]', err.message);
  });
};

const toDaemon = (target: string): ProxyOptions => ({
  target,
  ws: true,
  configure: (proxy) => quiet(proxy),
});

// 开发时把 /api 与 /ws 代理到本地 daemon (7878)。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // /api 含 PTY 的 WebSocket (/api/pty/:id)，需 ws:true
      '/api': toDaemon('http://127.0.0.1:7878'),
      '/ws': toDaemon('ws://127.0.0.1:7878'),
    },
  },
  build: {
    outDir: 'dist',
  },
});
