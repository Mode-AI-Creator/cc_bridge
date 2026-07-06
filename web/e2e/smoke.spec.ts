import { test, expect } from '@playwright/test';

// 无后端时前端应正常渲染外壳并显示「未连接」降级提示。
test('dashboard shell renders and degrades without daemon', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.brand')).toBeVisible();
  await expect(page.getByText('未连接')).toBeVisible({ timeout: 10000 });
});
