import { test, expect } from '@playwright/test';

// 无后端时前端应正常渲染外壳并显示断线降级提示（用选择器，避免语言相关文案）。
test('dashboard shell renders and degrades without daemon', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.brand')).toBeVisible();
  await expect(page.locator('.conn-pill')).toBeVisible({ timeout: 10000 });
});
