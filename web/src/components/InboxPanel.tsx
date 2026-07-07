import { useState } from 'react';
import type { InboxMessage, SessionSummary } from '../types';
import { useI18n } from '../lib/i18n';

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
  const { t } = useI18n();

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
          <span>{t('inbox.title')}</span>
          <button className="modal-x" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="inbox-compose">
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">{t('inbox.to')}</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {nameOf(s.id)} · {s.project_name}
              </option>
            ))}
          </select>
          <textarea
            className="inbox-body"
            placeholder={t('inbox.body')}
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
              {t('inbox.urgent')}
            </label>
            <button className="primary-btn" disabled={!to || !body.trim()} onClick={submit}>
              {t('inbox.send')}
            </button>
          </div>
        </div>

        <div className="inbox-list">
          <div className="inbox-list-title">{t('inbox.mine')}</div>
          {messages.length === 0 && <div className="inbox-empty">{t('inbox.empty')}</div>}
          {messages.map((m) => (
            <div
              key={m.id}
              className={`inbox-msg ${m.read_at == null ? 'unread' : ''}`}
            >
              <div className="im-head">
                <span className="im-from">{nameOf(m.from)}</span>
                {m.urgent && <span className="im-urgent">{t('inbox.urgentTag')}</span>}
                {m.read_at == null && (
                  <button className="im-read" onClick={() => onMarkRead(m.id)}>
                    {t('inbox.markRead')}
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
