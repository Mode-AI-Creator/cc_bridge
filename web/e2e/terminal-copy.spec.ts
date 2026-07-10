import { test, expect, type Page } from '@playwright/test';

const REPO = 'D:\\Project_2026\\claude_code_session_management';

// 打开一个托管终端会话（走新建会话弹窗），返回后等 window.__ccterm 就绪
async function openTerminal(page: Page) {
  await page.goto('/');
  await expect(page.locator('.brand')).toBeVisible();
  // ＋ 新会话（顶栏 primary-btn）
  await page.locator('header.topbar .primary-btn').click();
  await expect(page.locator('.modal')).toBeVisible();
  const pathInput = page.locator('.modal .path-input').first();
  await pathInput.fill(REPO);
  await page.locator('.modal-foot .primary-btn').click(); // 在此新建会话
  // 终端挂载 + WS 连上
  await page.waitForFunction(() => !!(window as any).__ccterm, null, { timeout: 20000 });
  await expect(page.locator('.term-host')).toBeVisible();
}

// 让 PTY(node REPL) 输出：启用鼠标追踪序列（node 会一直保持，真实复现 CC）
// + 唯一标记行 + 铺满数字文本（供拖选）
async function emitMouseModeAndText(page: Page, marker: string) {
  await page.locator('.term').click(); // 聚焦终端
  // 用 char code 拼 ESC，避免依赖反斜杠转义；insertText 整段原子插入，杜绝逐字符丢字
  const cmd =
    `process.stdout.write(String.fromCharCode(27)+'[?1002h'+String.fromCharCode(27)+'[?1006h'+` +
    `'${marker}\\r\\n'+('0123456789'.repeat(8)+'\\r\\n').repeat(20))`;
  await page.keyboard.insertText(cmd);
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    (m) => {
      const t: any = (window as any).__ccterm;
      if (!t) return false;
      const buf = t.buffer.active;
      for (let i = 0; i < buf.length; i++) {
        const line = buf.getLine(i)?.translateToString() || '';
        if (line.trimStart().startsWith(m)) return true;
      }
      return false;
    },
    marker,
    { timeout: 15000 },
  );
}

// 在终端中部拖拽，返回 xterm 当前选区文本
async function dragSelect(page: Page): Promise<string> {
  const box = await page.locator('.xterm-screen').boundingBox();
  if (!box) throw new Error('no xterm-screen box');
  await page.evaluate(() => (window as any).__ccterm.clearSelection());
  const y1 = box.y + box.height * 0.3;
  const y2 = box.y + box.height * 0.55;
  await page.mouse.move(box.x + 30, y1);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, y1, { steps: 8 });
  await page.mouse.move(box.x + box.width * 0.6, y2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  return page.evaluate(() => (window as any).__ccterm.getSelection());
}

const mouseMode = (page: Page) =>
  page.evaluate(() => {
    const t: any = (window as any).__ccterm;
    return t?.modes?.mouseTrackingMode ?? 'unknown';
  });

test('selectable-mode strips TUI mouse tracking → drag selects & copies; toggle off returns mouse to CC', async ({
  page,
}) => {
  await openTerminal(page);

  // ---- 默认「可选择」模式：PTY 的鼠标追踪启用序列被剥离 → xterm 不进入鼠标模式 ----
  await emitMouseModeAndText(page, 'MARKER_ON_1');
  expect(await mouseMode(page), '可选择模式：鼠标追踪应被剥离为 none').toBe('none');

  // 普通拖拽应能选中，且选中即复制到剪贴板
  const selOn = await dragSelect(page);
  expect(selOn.replace(/\s/g, '').length, '拖拽应产生非空选区').toBeGreaterThan(0);
  expect(selOn).toContain('0123456789');
  await page.waitForTimeout(120);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip, '选中即复制：剪贴板应含数字').toContain('0123456789');

  // ---- 关闭可选择模式：开关应翻转（此后不再剥离，鼠标交还 CC）----
  // 注：不用 mouseTrackingMode 做反向断言——PowerShell 的 PSReadLine 每次提示符会
  // 复位终端鼠标模式，会混淆该断言（与本功能无关）。此处验证开关状态翻转即可。
  await page.locator('.term-tool.on').click();
  await page.waitForFunction(() => (window as any).__ccSelMode === false, null, {
    timeout: 5000,
  });
  expect(await mouseMode(page), '开关关闭后状态可读').toBeDefined();
});

test('wheel in alt-screen forwards SGR to app instead of arrow-key history nav', async ({
  page,
}) => {
  await openTerminal(page);
  // 进入备用屏（全屏 TUI，如 CC），并挂上输出监听
  await page.evaluate(() => {
    const t: any = (window as any).__ccterm;
    t.write('\x1b[?1049h'); // 进入 alt-screen
    t.write('alt screen content line\r\n');
    (window as any).__ccSent = [];
    (window as any).__ccData = [];
    t.onData((d: string) => (window as any).__ccData.push(d));
  });
  await page.waitForFunction(
    () => (window as any).__ccterm?.buffer?.active?.type === 'alternate',
    null,
    { timeout: 5000 },
  );

  const box = await page.locator('.xterm-screen').boundingBox();
  if (!box) throw new Error('no box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 120); // 向下滚
  await page.waitForTimeout(150);

  const sent: string[] = await page.evaluate(() => (window as any).__ccSent || []);
  const data: string[] = await page.evaluate(() => (window as any).__ccData || []);

  // 应把滚轮以 SGR 序列转发给应用（滚 CC 的对话），而不是翻译成方向键
  expect(sent.join(''), '滚轮应转发 SGR 鼠标序列给应用').toContain('\x1b[<65;');
  expect(data.join(''), '不应把滚轮翻译成方向键（否则跳历史）').not.toContain('\x1b[A');
  expect(data.join(''), '不应把滚轮翻译成方向键（否则跳历史）').not.toContain('\x1b[B');
});
