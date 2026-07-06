import type { SessionSummary, SessionDetail, Stats } from './types';

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json() as Promise<T>;
}

export const getSessions = () => json<SessionSummary[]>('/api/sessions');
export const getStats = () => json<Stats>('/api/stats');
export const getDetail = (id: string) =>
  json<SessionDetail>(`/api/sessions/${encodeURIComponent(id)}`);

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
