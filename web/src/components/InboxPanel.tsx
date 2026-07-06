import { useState } from 'react';
import type { InboxMessage, SessionSummary } from '../types';

/** 跨会话消息总线：operator 收件箱 + 向任意会话发消息（Phase 6 S4）。 */
export function InboxPanel({
  messages,
  sessions,
  renames,
  onSend,
  onMarkRead,
  onClose,
}: {
  messages: InboxMessage[];
  sessions: SessionSummary[];
  renames: Record<string, string>;
  onSend: (to: string, body: string, urgent: boolean) => void;
  onMarkRead: (id: string) => void;
  onClose: () => void;
}) {
  const [to, setTo] = useState('');
  const [body, setBody] = useState('');
  const [urgent, setUrgent] = useState(false);

  const nameOf = (id: string) =>
    renames[id] || sessions.find((s) => s.id === id)?.title || id.slice(0, 8);

  const submit = () => {
    if (!to || !body.trim()) return;
    onSend(to, body.trim(), urgent);
    setBody('');
  };

  return (
    <>
      <div className="inbox-scrim" onClick={onClose} />
      <div className="inbox-pop">
        <div className="inbox-head">
          <span>消息总线</span>
          <button className="modal-x" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="inbox-compose">
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">发给…</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {nameOf(s.id)} · {s.project_name}
              </option>
            ))}
          </select>
          <textarea
            className="inbox-body"
            placeholder="消息内容…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
            }}
          />
          <div className="inbox-actions">
            <label className="inbox-urgent">
              <input
                type="checkbox"
                checked={urgent}
                onChange={(e) => setUrgent(e.target.checked)}
              />
              紧急（尝试注入对方终端）
            </label>
            <button className="primary-btn" disabled={!to || !body.trim()} onClick={submit}>
              发送
            </button>
          </div>
        </div>

        <div className="inbox-list">
          <div className="inbox-list-title">收件箱（operator）</div>
          {messages.length === 0 && <div className="inbox-empty">暂无消息</div>}
          {messages.map((m) => (
            <div
              key={m.id}
              className={`inbox-msg ${m.read_at == null ? 'unread' : ''}`}
            >
              <div className="im-head">
                <span className="im-from">{nameOf(m.from)}</span>
                {m.urgent && <span className="im-urgent">紧急</span>}
                {m.read_at == null && (
                  <button className="im-read" onClick={() => onMarkRead(m.id)}>
                    标记已读
                  </button>
                )}
              </div>
              <div className="im-body">{m.body}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
