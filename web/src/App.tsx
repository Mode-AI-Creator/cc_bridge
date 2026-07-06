import React, { useEffect, useMemo, useState } from 'react';
import type { SessionSummary, Stats } from './types';
import { getSessions, getStats, connectWs } from './api';
import { StatsBar } from './components/StatsBar';
import { TaskBar } from './components/TaskBar';
import { SessionList } from './components/SessionList';
import { DetailPane } from './components/DetailPane';
import { ChatPane, type ChatEntry } from './components/ChatPane';
import { NewSessionModal } from './components/NewSessionModal';
import { loadRenames, saveRenames } from './lib/renames';

// 记住上次新建会话的目录（跨平台，空则从驱动器/根开始浏览）
const loadLastCwd = () => localStorage.getItem('ccbridge.lastCwd') || '';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function VResizer({ onResize }: { onResize: (dx: number) => void }) {
  const start = (e: React.MouseEvent) => {
    e.preventDefault();
    let last = e.clientX;
    const move = (ev: MouseEvent) => {
      onResize(ev.clientX - last);
      last = ev.clientX;
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };
  return (
    <div className="v-resizer" onMouseDown={start}>
      <div className="grip" />
    </div>
  );
}

function HResizer({ onResize }: { onResize: (dy: number) => void }) {
  const start = (e: React.MouseEvent) => {
    e.preventDefault();
    let last = e.clientY;
    const move = (ev: MouseEvent) => {
      onResize(ev.clientY - last);
      last = ev.clientY;
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  };
  return (
    <div className="h-resizer" onMouseDown={start}>
      <div className="grip" />
    </div>
  );
}

export function App() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chats, setChats] = useState<ChatEntry[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [renames, setRenames] = useState<Record<string, string>>(loadRenames);
  const [shownIds, setShownIds] = useState<Set<string>>(new Set());
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [lastCwd, setLastCwd] = useState(loadLastCwd);

  // 可调节面板尺寸
  const [taskbarW, setTaskbarW] = useState(184);
  const [sidebarW, setSidebarW] = useState(380);
  const [listH, setListH] = useState(380);
  const [taskbarCollapsed, setTaskbarCollapsed] = useState(false);
  const [skipPerms, setSkipPerms] = useState(
    () => localStorage.getItem('ccbridge.skipPerms') === '1',
  );
  const toggleSkip = () =>
    setSkipPerms((v) => {
      const n = !v;
      localStorage.setItem('ccbridge.skipPerms', n ? '1' : '0');
      return n;
    });

  const load = () => {
    getSessions().then(setSessions).catch(() => {});
    getStats().then(setStats).catch(() => {});
  };

  useEffect(() => {
    load();
    const stop = connectWs(load);
    const iv = setInterval(load, 5000);
    return () => {
      stop();
      clearInterval(iv);
    };
  }, []);

  const isActive = (s: SessionSummary) =>
    s.status === 'working' || s.status === 'waiting';

  const addShown = (id: string) => setShownIds((prev) => new Set(prev).add(id));
  const removeShown = (id: string) =>
    setShownIds((prev) => {
      const n = new Set(prev);
      n.delete(id);
      return n;
    });

  // 中间列表：默认只显示激活中的会话 + 用户从任务栏拖入的会话
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sessions.filter((s) => {
      if (!(isActive(s) || shownIds.has(s.id))) return false;
      if (activeProject && s.project_path !== activeProject) return false;
      if (!q) return true;
      const name = (renames[s.id] || s.title || '').toLowerCase();
      return (
        s.project_name.toLowerCase().includes(q) ||
        name.includes(q) ||
        s.id.toLowerCase().includes(q)
      );
    });
  }, [sessions, query, activeProject, renames, shownIds]);

  const selectedSession = sessions.find((s) => s.id === selectedId) || null;
  const activeProjectName = activeProject
    ? sessions.find((s) => s.project_path === activeProject)?.project_name || null
    : null;

  const onRename = (id: string, newName: string) => {
    setRenames((prev) => {
      const next = { ...prev };
      if (newName.trim()) next[id] = newName.trim();
      else delete next[id];
      saveRenames(next);
      return next;
    });
  };

  const spawn = async (
    body: { cwd: string; resume?: string },
    title: string,
    sessionId?: string,
  ) => {
    try {
      const r = await fetch('/api/spawn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, skip_permissions: skipPerms }),
      });
      if (!r.ok) {
        window.alert('启动失败: ' + (await r.text()));
        return;
      }
      const { id } = await r.json();
      setChats((prev) => [...prev, { id, title, sessionId }]);
      setActiveChatId(id);
    } catch (e) {
      window.alert('启动失败: ' + e);
    }
  };

  const basename = (p: string) =>
    p.replace(/\\/g, '/').split('/').filter(Boolean).pop() || p;

  const newSessionAt = (cwd: string) => spawn({ cwd }, basename(cwd));

  const newSession = () => setNewModalOpen(true);

  const resume = (s: SessionSummary) => {
    // 若该会话已有进行中的对话，直接切到它，不重复启动
    const existing = chats.find((c) => c.sessionId === s.id);
    if (existing) {
      setActiveChatId(existing.id);
      setSelectedId(s.id);
      return;
    }
    setSelectedId(s.id);
    spawn(
      { cwd: s.project_path, resume: s.id },
      renames[s.id] || s.title || s.project_name,
      s.id,
    );
  };

  // 点击列表会话：切换详情 + 若该会话有进行中的对话则切到其终端，否则显示历史/继续
  const selectSession = (id: string) => {
    setSelectedId(id);
    const c = chats.find((x) => x.sessionId === id);
    setActiveChatId(c ? c.id : null);
  };

  // 点击对话 tab：切换显示的终端（不打断其它正在进行的会话）
  const selectChat = (termId: string) => {
    setActiveChatId(termId);
    const c = chats.find((x) => x.id === termId);
    if (c?.sessionId) setSelectedId(c.sessionId);
  };

  const closeChat = async (termId: string) => {
    await fetch('/api/managed/' + termId + '/kill', { method: 'POST' }).catch(
      () => {},
    );
    setChats((prev) => prev.filter((c) => c.id !== termId));
    setActiveChatId((prev) => (prev === termId ? null : prev));
  };

  const workspaceVars = {
    '--taskbar-w': taskbarW + 'px',
    '--sidebar-w': sidebarW + 'px',
    '--list-h': listH + 'px',
  } as React.CSSProperties;

  return (
    <div className="app">
      <StatsBar
        stats={stats}
        onNewSession={newSession}
        taskbarCollapsed={taskbarCollapsed}
        onToggleTaskbar={() => setTaskbarCollapsed((c) => !c)}
        skipPerms={skipPerms}
        onToggleSkip={toggleSkip}
      />
      <div className="workspace" style={workspaceVars}>
        {!taskbarCollapsed && (
          <>
            <TaskBar
              sessions={sessions}
              selectedId={selectedId}
              onSelectSession={selectSession}
              onNewAt={newSessionAt}
              renames={renames}
            />
            <VResizer
              onResize={(dx) => setTaskbarW((w) => clamp(w + dx, 120, 360))}
            />
          </>
        )}
        <div className="sidebar">
          <SessionList
            sessions={filtered}
            selectedId={selectedId}
            onSelect={selectSession}
            renames={renames}
            onRename={onRename}
            query={query}
            setQuery={setQuery}
            onDropProjectCwd={newSessionAt}
            onAddSession={addShown}
            onRemove={removeShown}
            activeProjectName={activeProjectName}
          />
          <HResizer
            onResize={(dy) =>
              setListH((h) => clamp(h + dy, 160, window.innerHeight - 260))
            }
          />
          <DetailPane id={selectedId} />
        </div>
        <VResizer onResize={(dx) => setSidebarW((w) => clamp(w + dx, 280, 760))} />
        <ChatPane
          chats={chats}
          activeChatId={activeChatId}
          selected={selectedSession}
          onSelectChat={selectChat}
          onCloseChat={closeChat}
          onResume={resume}
        />
      </div>
      <NewSessionModal
        open={newModalOpen}
        initialPath={activeProject || lastCwd}
        onCancel={() => setNewModalOpen(false)}
        onConfirm={(cwd) => {
          setNewModalOpen(false);
          setLastCwd(cwd);
          localStorage.setItem('ccbridge.lastCwd', cwd);
          newSessionAt(cwd);
        }}
      />
    </div>
  );
}
