import { useEffect, useRef } from 'react';

// Clawd —— Claude Code 的像素吉祥物：一个方块身体 + 两只黑眼睛 +
// 四条腿 + 两只手的「像素螃蟹/机器人」，主色 terracotta #DD775B。
// 依据公开资料（Codrops 逆向、Anthropic 文档、社区）还原其结构，
// 并按会话状态驱动动作：working 走动/挥手、waiting 张望、idle 打盹、error 抖动。
// 参考：tympanus.net/codrops 的 SVG 逆向、anthropics/claude-code#8536。

const GRID = 16;
const CELL = 10;
const SIZE = GRID * CELL;

const COL = {
  body: '#dd775b',
  edge: '#c15a3f',
  limb: '#c96442',
  eye: '#1a1512',
  hi: '#f4ede4',
  z: '#b3ada3',
  err: '#cc5c5c',
  bang: '#e6bf6a',
};

type Status = 'working' | 'waiting' | 'idle' | 'error' | 'unknown';

// 方块身体：cols 4..11 × rows 3..9，去掉四角 → 圆润方块
function bodyCells(): boolean[][] {
  const g = Array.from({ length: GRID }, () => Array(GRID).fill(false));
  for (let y = 3; y <= 9; y++)
    for (let x = 4; x <= 11; x++) g[y][x] = true;
  for (const [cx, cy] of [
    [4, 3],
    [11, 3],
    [4, 9],
    [11, 9],
  ])
    g[cy][cx] = false;
  return g;
}
const BODY = bodyCells();
const isBody = (x: number, y: number) =>
  x >= 0 && y >= 0 && x < GRID && y < GRID && BODY[y][x];

function px(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  alpha = 1,
) {
  if (x < 0 || y < 0 || x >= GRID || y >= GRID) return;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
  ctx.globalAlpha = 1;
}

function glyph(
  ctx: CanvasRenderingContext2D,
  pattern: string[],
  ox: number,
  oy: number,
  color: string,
  alpha = 1,
) {
  pattern.forEach((row, y) =>
    [...row].forEach((c, x) => c === '#' && px(ctx, ox + x, oy + y, color, alpha)),
  );
}
const Z = ['###', '.##', '##.', '###'];
const BANG = ['#', '#', '.', '#'];

function render(ctx: CanvasRenderingContext2D, status: Status, t: number) {
  ctx.clearRect(0, 0, SIZE, SIZE);

  // 整体位移
  let dx = 0;
  let dy = 0;
  if (status === 'working') dy = Math.sin(t / 130) * 1.3;
  else if (status === 'waiting') dx = Math.sin(t / 560) * 0.9;
  else if (status === 'idle') dy = Math.sin(t / 950) * 0.5;
  else if (status === 'error') dx = Math.sin(t / 45) * 1.3;
  else dy = Math.sin(t / 760) * 0.4;
  const ox = Math.round(dx);
  const oy = Math.round(dy);

  // 四条腿（walking 时交替伸缩）
  const legXs = [5, 7, 9, 10];
  legXs.forEach((lx, i) => {
    let len = 2;
    if (status === 'working')
      len = 2 + Math.round(Math.sin(t / 120 + (i % 2) * Math.PI));
    else if (status === 'error') len = 1 + (Math.floor(t / 60 + i) % 2);
    for (let k = 0; k < len; k++) px(ctx, lx + ox, 10 + k + oy, COL.limb);
  });

  // 身体（描边）
  for (let y = 0; y < GRID; y++)
    for (let x = 0; x < GRID; x++) {
      if (!isBody(x, y)) continue;
      const edge =
        !isBody(x - 1, y) || !isBody(x + 1, y) || !isBody(x, y - 1) || !isBody(x, y + 1);
      px(ctx, x + ox, y + oy, edge ? COL.edge : COL.body);
    }

  // 两只手（working/error 上举挥动，其余垂放）
  let handY = 7;
  if (status === 'working') handY = 6 + (Math.floor(t / 140) % 2);
  else if (status === 'error') handY = 5;
  px(ctx, 2 + ox, handY + oy, COL.limb);
  px(ctx, 3 + ox, handY + oy, COL.limb);
  px(ctx, 12 + ox, handY + oy, COL.limb);
  px(ctx, 13 + ox, handY + oy, COL.limb);

  // 眼睛
  const sleeping = status === 'idle';
  const blinking = t % 2600 < 130;
  const closed = sleeping || (status !== 'error' && blinking);
  const look = status === 'waiting' ? Math.round(Math.sin(t / 700)) : 0;
  const eyeXs = [6 + look, 9 + look];

  if (status === 'error') {
    for (const ex of [6, 9]) {
      px(ctx, ex + ox, 5 + oy, COL.err);
      px(ctx, ex + 1 + ox, 6 + oy, COL.err);
      px(ctx, ex + 1 + ox, 5 + oy, COL.err);
      px(ctx, ex + ox, 6 + oy, COL.err);
    }
  } else if (closed) {
    for (const ex of [6, 9]) {
      px(ctx, ex + ox, 6 + oy, COL.eye);
      px(ctx, ex + 1 + ox, 6 + oy, COL.eye);
    }
  } else {
    for (const ex of eyeXs) {
      px(ctx, ex + ox, 5 + oy, COL.eye);
      px(ctx, ex + ox, 6 + oy, COL.eye);
      px(ctx, ex + ox, 5 + oy, COL.hi, 0.85);
      px(ctx, ex + ox, 6 + oy, COL.eye);
    }
  }

  // 状态特效
  if (status === 'idle') {
    const phase = (t / 900) % 1;
    glyph(ctx, Z, 12, Math.round(2 - phase * 3), COL.z, 1 - phase);
  } else if (status === 'error') {
    glyph(ctx, BANG, 12, 1, COL.bang);
  }
}

/** 像素吉祥物 Clawd：按会话状态播放动画。 */
export function ClawdSprite({ status }: { status: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    let raf = 0;
    const start = performance.now();
    const loop = (now: number) => {
      render(ctx, statusRef.current as Status, now - start);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} width={SIZE} height={SIZE} className="clawd-cv" />;
}
