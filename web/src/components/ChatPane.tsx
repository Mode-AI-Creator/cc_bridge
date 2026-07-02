import { useEffect, useState } from 'react';
import type { SessionSummary, SessionDetail } from '../types';
import { getDetail } from '../api';
import { TerminalView } from './TerminalView';

export interface ChatEntry {
  id: string; // termId
  title: string;
  sessionId?: string; // resume 来源会话（新会话为空）
}

export function ChatPane({
  chats,
  activeChatId,
  selected,
  onSelectChat,
  onCloseChat,
  onResume,
}: {
  chats: ChatEntry[];
  activeChatId: string | null;
  selected: SessionSummary | null;
  onSelectChat: (id: string) => void;
  onCloseChat: (id: string) => void;
  onResume: (s: SessionSummary) => void;
}) {
  const showIntro = activeChatId == null;
  return (
    <div className="chat-pane">
      <div className="chat-tabs">
        {chats.length === 0 && (
          <span className="chat-tabs-empty">
            无进行中的对话 · 选会话「▶ 继续对话」或「＋ 新会话」
          </span>
        )}
        {chats.map((c) => (
          <div
            key={c.id}
            className={`chat-tab ${c.id === activeChatId ? 'on' : ''}`}
            onClick={() => onSelectChat(c.id)}
            title={c.title}
          >
            <span className="status-dot live" />
            <span className="chat-tab-name">{c.title}</span>
            <button
              className="chat-tab-x"
              title="结束对话"
              onClick={(e) => {
                e.stopPropagation();
                onCloseChat(c.id);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="chat-body">
        {/* 所有进行中的终端常驻挂载，仅显示当前激活的，切换不打断其它会话 */}
        {chats.map((c) => (
          <div
            key={c.id}
            className={`term-layer ${c.id === activeChatId ? 'active' : ''}`}
          >
            <TerminalView id={c.id} />
          </div>
        ))}
        {showIntro && (
          <div className="term-layer active">
            {selected ? (
              <ChatIntro session={selected} onResume={() => onResume(selected)} />
            ) : (
              <div className="chat-empty">
                <div className="chat-empty-art">▍</div>
                选择会话「▶ 继续对话」，或「＋ 新会话」开始
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ChatIntro({
  session,
  onResume,
}: {
  session: SessionSummary;
  onResume: () => void;
}) {
  const [d, setD] = useState<SessionDetail | null>(null);
  useEffect(() => {
    let on = true;
    getDetail(session.id)
      .then((x) => on && setD(x))
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [session.id]);

  return (
    <div className="chat-intro">
      <div className="chat-head">
        <span className={`status-dot s-${session.status}`} />
        <h3>{session.title || session.id.slice(0, 8)}</h3>
        <div className="spacer" />
        <button className="primary-btn" onClick={onResume}>
          ▶ 继续对话
        </button>
      </div>
      <div className="chat-history">
        {d && d.recent_messages.length > 0 ? (
          [...d.recent_messages].reverse().map((m, i) => (
            <div className={`msg ${m.role}`} key={i}>
              <div className="who">{m.role === 'user' ? '用户' : 'Claude'}</div>
              {m.text}
            </div>
          ))
        ) : (
          <div className="chat-empty">
            点「▶ 继续对话」在平台内接管此会话，直接与 agent 对话推进项目
          </div>
        )}
      </div>
    </div>
  );
}
