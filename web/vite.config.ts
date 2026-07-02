import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 开发时把 /api 与 /ws 代理到本地 daemon (7878)。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // /api 含 PTY 的 WebSocket (/api/pty/:id)，需 ws:true
      '/api': { target: 'http://127.0.0.1:7878', ws: true },
      '/ws': { target: 'ws://127.0.0.1:7878', ws: true },
    },
  },
  build: {
    outDir: 'dist',
  },
});
