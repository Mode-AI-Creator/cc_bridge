import { defineConfig } from '@playwright/test';

// E2E：启动 vite preview 服务已构建的 dist，验证前端外壳渲染与无后端时的降级。
export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  use: { baseURL: 'http://localhost:4173' },
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
