import { defineConfig } from '@playwright/test';

// 真机验证：连到独立运行的 daemon（127.0.0.1:7999，程序=powershell），
// 不自启 webServer。锁定中文界面、授予剪贴板权限。
export default defineConfig({
  testDir: './e2e',
  testMatch: 'terminal-copy.spec.ts',
  timeout: 60000,
  use: {
    baseURL: 'http://127.0.0.1:7999',
    locale: 'zh-CN',
    permissions: ['clipboard-read', 'clipboard-write'],
  },
});
