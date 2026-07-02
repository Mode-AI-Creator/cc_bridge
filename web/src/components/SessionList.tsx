import { useState } from 'react';
import type { SessionSummary } from '../types';
import { fmtCost, relTime } from '../lib/format';

const PROJECT_MIME = 'application/x-ccbridge-project';
const SESSION_MIME = 'application/x-ccbridge-session';

export function SessionList({
  sessions,
  selectedId,
  onSelect,
  renames,
  onRename,
  query,
  setQuery,
  onDropProjectCwd,
  onAddSession,
  onRemove,
  activeProjectName,
}: {
  sessions: SessionSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  renames: Record<string, string>;
  onRename: (id: string, newName: string) => void;
  query: string;
  setQuery: (q: string) => void;
  onDropProjectCwd: (cwd: string) => void;
  onAddSession: (id: string) => void;
  onRemove: (id: string) => void;
  activeProjectName: string | null;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const list = [...sessions].sort((a, b) => b.last_active_epoch - a.last_active_epoch);

  const startEdit = (id: string, cur: string) => {
    setEditing(id);
    setDraft(cur);
  };
  const commit = () => {
    if (editing) onRename(editing, draft);
    setEditing(null);
  };

  return (
    <div
      className={`session-list ${dragOver ? 'drop' : ''}`}
      onDragOver={(e) => {
        const t = e.dataTransfer.types;
        if (t.includes(PROJECT_MIME) || t.includes(SESSION_MIME)) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const sid = e.dataTransfer.getData(SESSION_MIME);
        if (sid) {
          onAddSession(sid);
          return;
        }
        const cwd = e.dataTransfer.getData(PROJECT_MIME);
        if (cwd) onDropProjectCwd(cwd);
      }}
    >
      <div className="list-head">
        <span className="list-title">
          CC Sessions
          {activeProjectName && <span className="list-filter">· {activeProjectName}</span>}
        </span>
        <input
          className="search-sm"
          placeholder="过滤…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="list-body">
        {list.length === 0 && (
          <div className="list-empty">
            暂无激活会话 · 从左侧任务栏拖会话到此处显示
          </div>
        )}
        {list.map((s) => {
          const name = renames[s.id] || s.title || s.id.slice(0, 8);
          const isEditing = editing === s.id;
          return (
            <div
              className={`sess-row s-${s.status} ${s.id === selectedId ? 'sel' : ''}`}
              key={s.file}
              draggable={!isEditing}
              onDragStart={(e) => {
                e.dataTransfer.setData(SESSION_MIME, s.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={(e) => {
                // 拖出容器（未落在有效放置区）→ 移出
                if (e.dataTransfer.dropEffect === 'none') onRemove(s.id);
              }}
              onClick={() => !isEditing && onSelect(s.id)}
            >
              <span className="status-dot" />
              <div className="sess-main">
                {isEditing ? (
                  <input
                    className="rename-input"
                    autoFocus
                    value={draft}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commit();
                      } else if (e.key === 'Escape') {
                        setEditing(null);
                      }
                    }}
                    onBlur={commit}
                  />
                ) : (
                  <span
                    className="sess-name"
                    title={name}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      startEdit(s.id, name);
                    }}
                  >
                    {name}
                  </span>
                )}
                <span className="sess-proj">{s.project_name}</span>
              </div>
              {!isEditing && (
                <>
                  <div className="sess-meta">
                    <span className="sess-cost">{fmtCost(s.usage.cost_usd)}</span>
                    <span className="sess-when">{relTime(s.last_active_epoch)}</span>
                  </div>
                  <button
                    className="rename-btn"
                    title="重命名（或双击名称）"
                    onClick={(e) => {
                      e.stopPropagation();
                      startEdit(s.id, name);
                    }}
                  >
                    ✎
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
      <div className={`drop-hint ${dragOver ? 'show' : ''}`}>
        放下会话以显示 · 项目则新建会话
      </div>
    </div>
  );
}
