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

/** 连接 daemon WebSocket，收到 update 时回调；断线自动重连。 */
export function connectWs(onUpdate: () => void): () => void {
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
