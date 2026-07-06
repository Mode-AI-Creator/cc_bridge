import { defineConfig } from 'vitest/config';

// 仅运行 src 下的单元测试；E2E（e2e/*.spec.ts）由 Playwright 独立运行。
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
