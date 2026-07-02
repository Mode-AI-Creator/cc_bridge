import { useState } from 'react';
import type { SessionSummary } from '../types';

const PROJECT_MIME = 'application/x-ccbridge-project';
const SESSION_MIME = 'application/x-ccbridge-session';

interface Proj {
  path: string;
  name: string;
  sessions: SessionSummary[];
  active: number;
}

export function TaskBar({
  sessions,
  selectedId,
  onSelectSession,
  onNewAt,
  renames,
}: {
  sessions: SessionSummary[];
  selectedId: string | null;
  onSelectSession: (id: string) => void;
  onNewAt: (cwd: string) => void;
  renames: Record<string, string>;
}) {
  const map = new Map<string, Proj>();
  for (const s of sessions) {
    let p = map.get(s.project_path);
    if (!p) {
      p = { path: s.project_path, name: s.project_name, sessions: [], active: 0 };
      map.set(s.project_path, p);
    }
    p.sessions.push(s);
    if (s.status === 'working' || s.status === 'waiting') p.active++;
  }
  const projects = [...map.values()].sort(
    (a, b) => b.active - a.active || a.name.localeCompare(b.name),
  );
  for (const p of projects)
    p.sessions.sort((a, b) => b.last_active_epoch - a.last_active_epoch);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (path: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(path) ? n.delete(path) : n.add(path);
      return n;
    });

  return (
    <div className="taskbar">
      <div className="taskbar-head">任务栏 · 项目</div>
      <div className="taskbar-body">
        {projects.map((p) => {
          const open = expanded.has(p.path);
          return (
            <div className="tb-proj" key={p.path}>
              <div
                className="tb-proj-head"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(PROJECT_MIME, p.path);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => toggle(p.path)}
                onDoubleClick={() => onNewAt(p.path)}
                title={`${p.path}\n点击展开/折叠 · 双击或拖拽新建会话`}
              >
                <span className="tb-caret">{open ? '▾' : '▸'}</span>
                <span className="tb-proj-name">{p.name}</span>
                {p.active > 0 && <span className="proj-active" />}
                <span className="proj-count">{p.sessions.length}</span>
              </div>
              {open && (
                <div className="tb-sessions">
                  {p.sessions.map((s) => {
                    const name = renames[s.id] || s.title || s.id.slice(0, 8);
                    return (
                      <div
                        className={`tb-sess s-${s.status} ${s.id === selectedId ? 'sel' : ''}`}
                        key={s.file}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData(SESSION_MIME, s.id);
                          e.dataTransfer.effectAllowed = 'copy';
                        }}
                        onClick={() => onSelectSession(s.id)}
                        title={`${name}\n拖到会话区以显示`}
                      >
                        <span className="status-dot" />
                        <span className="tb-sess-name">{name}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="taskbar-hint">拖项目/会话到会话区 ↗ 新建</div>
    </div>
  );
}
