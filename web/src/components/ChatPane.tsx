import { useEffect, useState, lazy, Suspense } from 'react';
import type { SessionSummary, SessionDetail, ManagedInfo } from '../types';
import { getDetail } from '../api';

// 懒加载终端：xterm 较重，仅在首次打开终端时才拉取其 chunk
const TerminalView = lazy(() =>
  import('./TerminalView').then((m) => ({ default: m.TerminalView })),
);

export interface ChatEntry {
  id: string; // termId
  title: string;
  sessionId?: string; // resume 来源会话（新会话为空）
}

export function ChatPane({
  chats,
  activeChatId,
  selected,
  managed,
  onSelectChat,
  onCloseChat,
  onOpenManaged,
  onKillManaged,
  onResume,
}: {
  chats: ChatEntry[];
  activeChatId: string | null;
  selected: SessionSummary | null;
  managed: ManagedInfo[];
  onSelectChat: (id: string) => void;
  onCloseChat: (id: string) => void;
  onOpenManaged: (info: ManagedInfo) => void;
  onKillManaged: (id: string) => void;
  onResume: (s: SessionSummary) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const showIntro = activeChatId == null;
  const openIds = new Set(chats.map((c) => c.id));
  // 后台存活但当前未开 tab 的托管会话（刷新/收起后可从这里重开）
  const detached = managed.filter((m) => !openIds.has(m.id));

  return (
    <div className="chat-pane">
      <div className="chat-tabs">
        <div className="chat-tabs-scroll">
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
                title="收起（进程继续后台运行，可从「运行中」重开）"
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

        <div className="running-menu">
          <button
            className={`running-btn ${detached.length ? 'has' : ''}`}
            onClick={() => setMenuOpen((v) => !v)}
            title="所有后台托管会话（刷新/收起后从这里重开）"
          >
            运行中{managed.length > 0 ? ` ${managed.length}` : ''} ▾
          </button>
          {menuOpen && (
            <>
              <div className="running-scrim" onClick={() => setMenuOpen(false)} />
              <div className="running-pop">
                {managed.length === 0 && (
                  <div className="running-empty">无托管会话</div>
                )}
                {managed.map((m) => {
                  const open = openIds.has(m.id);
                  return (
                    <div className="running-row" key={m.id}>
                      <button
                        className="running-open"
                        title={m.cwd}
                        onClick={() => {
                          onOpenManaged(m);
                          setMenuOpen(false);
                        }}
                      >
                        <span className={`run-dot ${open ? 'on' : ''}`} />
                        <span className="run-title">
                          {m.title || m.id.slice(0, 8)}
                        </span>
                        <span className="run-state">{open ? '已打开' : '重开'}</span>
                      </button>
                      <button
                        className="running-kill"
                        title="结束该会话进程"
                        onClick={() => onKillManaged(m.id)}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="chat-body">
        {/* 所有进行中的终端常驻挂载，仅显示当前激活的，切换不打断其它会话 */}
        {chats.map((c) => (
          <div
            key={c.id}
            className={`term-layer ${c.id === activeChatId ? 'active' : ''}`}
          >
            <Suspense fallback={<div className="chat-empty">加载终端…</div>}>
              <TerminalView id={c.id} />
            </Suspense>
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
                {detached.length > 0 && (
                  <div className="chat-empty-hint">
                    有 {detached.length} 个后台会话可从上方「运行中」重开
                  </div>
                )}
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
