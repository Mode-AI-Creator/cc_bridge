import type {
  SessionSummary,
  SessionDetail,
  Stats,
  SessionStatus,
  ManagedInfo,
} from './types';
import type { DiskTheme } from './lib/skins';

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json() as Promise<T>;
}

export const getSessions = () => json<SessionSummary[]>('/api/sessions');
export const getStats = () => json<Stats>('/api/stats');
export const getDetail = (id: string) =>
  json<SessionDetail>(`/api/sessions/${encodeURIComponent(id)}`);

export const getThemes = () => json<DiskTheme[]>('/api/themes');

export const getManaged = () => json<ManagedInfo[]>('/api/managed');

export const killManaged = (id: string) =>
  fetch('/api/managed/' + encodeURIComponent(id) + '/kill', { method: 'POST' });

/** 上传单个状态资产（读为 base64 后 POST）。 */
export async function uploadThemeAsset(
  theme: string,
  state: SessionStatus,
  file: File,
): Promise<void> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
  const data_base64 = dataUrl.split(',')[1] || '';
  const r = await fetch(
    `/api/themes/${encodeURIComponent(theme)}/asset/${state}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filename: file.name, data_base64 }),
    },
  );
  if (!r.ok) throw new Error(await r.text());
}

/**
 * 连接 daemon WebSocket；断线自动重连。
 * - `onUpdate`：文件变更或 hook 事件时触发（用于刷新会话/状态）。
 * - `onHook`：收到 hook 动作事件时投递原始负载（用于实时动作流）。
 */
export function connectWs(
  onUpdate: () => void,
  onHook?: (payload: Record<string, unknown>) => void,
): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | null = null;

  const open = () => {
    if (closed) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data);
        // 文件变更或 hook 事件都触发刷新（hook → 实时精确状态）
        if (m.type === 'update' || m.type === 'hook') onUpdate();
        if (m.type === 'hook') onHook?.(m);
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      if (!closed) retry = setTimeout(open, 1500);
    };
    ws.onerror = () => ws?.close();
  };
  open();

  return () => {
    closed = true;
    if (retry) clearTimeout(retry);
    ws?.close();
  };
}
