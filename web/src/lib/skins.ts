import type { SessionStatus } from '../types';

/** 换肤：磁盘主题（图片资产）或内置程序化 canvas Clawd。 */
export interface DiskTheme {
  name: string;
  assets: Partial<Record<SessionStatus, string>>; // state → 文件名
}

export const BUILTIN = 'builtin';
export const SKIN_STATES: SessionStatus[] = [
  'idle',
  'working',
  'waiting',
  'error',
  'unknown',
];

/** 上传规范（与 daemon 侧一致，用于前端提示与预校验）。 */
export const UPLOAD_SPEC = {
  maxBytes: 512 * 1024,
  exts: ['png', 'apng', 'gif', 'webp', 'svg'],
  recommend: '128×128 正方形像素风',
};

export const STATE_LABEL: Record<SessionStatus, string> = {
  idle: '空闲',
  working: '工作中',
  waiting: '等待输入',
  error: '出错',
  unknown: '未知',
};

const KEY = 'ccbridge.skin';
export const loadSkin = () => localStorage.getItem(KEY) || BUILTIN;
export const saveSkin = (name: string) => localStorage.setItem(KEY, name);

/** 资产 URL（含 cache-buster，用于上传后即时刷新）。 */
export function assetUrl(theme: string, state: SessionStatus, v = 0): string {
  return `/api/themes/${encodeURIComponent(theme)}/asset/${state}${v ? `?v=${v}` : ''}`;
}

/**
 * 解析选中皮肤在某状态下应如何渲染。
 * - builtin 或该状态无资产 → canvas 程序化 Clawd
 * - 否则 → 图片资产 URL
 */
export function resolveSkin(
  skin: string,
  themes: DiskTheme[],
  status: SessionStatus,
): { kind: 'canvas' } | { kind: 'image'; file: string } {
  if (skin === BUILTIN) return { kind: 'canvas' };
  const t = themes.find((x) => x.name === skin);
  const file = t?.assets[status];
  if (!file) return { kind: 'canvas' }; // 缺失状态回退内置
  return { kind: 'image', file };
}

/** 前端预校验上传文件；返回错误信息或 null。 */
export function validateAsset(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (!UPLOAD_SPEC.exts.includes(ext)) {
    return `不支持的格式 .${ext}（允许 ${UPLOAD_SPEC.exts.join('/')}）`;
  }
  if (file.size === 0) return '空文件';
  if (file.size > UPLOAD_SPEC.maxBytes) {
    return `文件过大 ${(file.size / 1024).toFixed(0)}KB > 512KB`;
  }
  return null;
}
