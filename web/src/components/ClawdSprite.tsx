import { useEffect, useRef } from 'react';

// Clawd —— Claude Code 的像素吉祥物：方块身体 + 两只黑眼睛 + 四条腿 + 两只手，
// 主色 terracotta #DD775B，一个「像素螃蟹/机器人」。
// 依据公开资料还原结构与行为（非搬运官方美术资产，Clawd 版权归 Anthropic）：
//   · Codrops 对官方 SVG 的逆向（rect 拼装、腿/手可动、眼睛位移）
//   · clawd-on-desk 项目 theme.json 的状态模型与「眼睛跟随光标」行为
// 按会话状态驱动：working 打字/迈步、waiting 张望+眼睛跟随光标、idle 打盹+Zzz、
// error 抖动+叉眼、unknown 呼吸+跟随。

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
  shadow: 'rgba(0,0,0,0.22)',
};

type Status = 'working' | 'waiting' | 'idle' | 'error' | 'unknown';
interface Track {
  dx: number; // -1..1 cell
  dy: number; // -1..1 cell
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// 方块身体：cols 4..11 × rows 3..9，去掉四角 → 圆润方块
function bodyCells(): boolean[][] {
  const g = Array.from({ length: GRID }, () => Array(GRID).fill(false));
  for (let y = 3; y <= 9; y++) for (let x = 4; x <= 11; x++) g[y][x] = true;
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

function render(ctx: CanvasRenderingContext2D, status: Status, t: number, track: Track) {
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

  // 地面阴影（随弹跳伸缩，Clawd 招牌）
  const lift = oy; // 越往上阴影越小
  const half = clamp(3 - Math.max(0, -lift), 1, 4);
  for (let x = 8 - half; x <= 7 + half; x++) px(ctx, x, 14, COL.shadow);

  // 四条腿（walking 时交替伸缩）
  const legXs = [5, 7, 9, 10];
  legXs.forEach((lx, i) => {
    let len = 2;
    if (status === 'working') len = 2 + Math.round(Math.sin(t / 120 + (i % 2) * Math.PI));
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

  // 两只手
  let handY = 7;
  if (status === 'working') handY = 6 + (Math.floor(t / 140) % 2);
  else if (status === 'error') handY = 5;
  px(ctx, 2 + ox, handY + oy, COL.limb);
  px(ctx, 3 + ox, handY + oy, COL.limb);
  px(ctx, 12 + ox, handY + oy, COL.limb);
  px(ctx, 13 + ox, handY + oy, COL.limb);

  // 眼睛：waiting/unknown 跟随光标；idle 闭眼打盹；error 红叉；working 专注前视
  const tracking = status === 'waiting' || status === 'unknown';
  const tx = tracking ? track.dx : 0;
  const ty = tracking ? track.dy : 0;
  const sleeping = status === 'idle';
  const blinking = t % 2600 < 130;
  const closed = sleeping || (status !== 'error' && !tracking && blinking);

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
    for (const ex of [6, 9]) {
      px(ctx, ex + ox + tx, 5 + oy + ty, COL.eye);
      px(ctx, ex + ox + tx, 6 + oy + ty, COL.eye);
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

/** 像素吉祥物 Clawd：按会话状态播放动画，眼睛在等待时跟随鼠标。 */
export function ClawdSprite({ status }: { status: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const statusRef = useRef(status);
  statusRef.current = status;
  const mouse = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      mouse.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    let raf = 0;
    const start = performance.now();
    const loop = (now: number) => {
      // 眼睛跟随光标：相对画布中心的方向，最多偏移 1 格（maxOffset≈3px）
      const r = cv.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const nx = (mouse.current.x - cx) / (r.width / 2 || 1);
      const ny = (mouse.current.y - cy) / (r.height / 2 || 1);
      const track: Track = {
        dx: clamp(Math.round(nx * 1.5), -1, 1),
        dy: clamp(Math.round(ny * 1.5), -1, 1),
      };
      render(ctx, statusRef.current as Status, now - start, track);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} width={SIZE} height={SIZE} className="clawd-cv" />;
}
