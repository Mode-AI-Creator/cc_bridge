import React, { useEffect, useMemo, useState } from 'react';
import type { SessionSummary, Stats } from './types';
import { getSessions, getStats, getManaged, killManaged, connectWs } from './api';
import type { ManagedInfo } from './types';
import { InboxPanel } from './components/InboxPanel';
import { useInbox } from './hooks/useInbox';
import { useThemes } from './hooks/useThemes';
import { StatsBar } from './components/StatsBar';
import { TaskBar } from './components/TaskBar';
import { SessionList } from './components/SessionList';
import { DetailPane } from './components/DetailPane';
import { ChatPane, type ChatEntry } from './components/ChatPane';
import { NewSessionModal } from './components/NewSessionModal';
import { loadRenames, saveRenames } from './lib/renames';
import {
  type Bucket,
  bucketOf,
  matchesQuery,
  loadBuckets,
  saveBuckets,
} from './lib/classify';
import { type ActionEvent, pushAction } from './lib/actions';

// 记住上次新建会话的目录（跨平台，空则从驱动器/根开始浏览）
const loadLastCwd = () => localStorage.getItem('ccbridge.lastCwd') || '';

const cwdBasename = (p: string) =>
  p.replace(/\\/g, '/').split('/').filter(Boolean).pop() || p;

// 把托管(新建)会话合成为一条 active 摘要，让它在写出 JSONL 前就出现在看板
function synthHosted(m: ManagedInfo): SessionSummary {
  return {
    id: m.id,
    project_path: m.cwd,
    project_name: cwdBasename(m.cwd),
    title: m.title || cwdBasename(m.cwd),
    model: null,
    status: 'working',
    started_at: null,
    last_active_at: null,
    last_active_epoch: m.created_at || Math.floor(Date.now() / 1000),
    had_error: false,
    message_count: 0,
    tool_count: 0,
    usage: { input: 0, output: 0, cache_creation: 0, cache_read: 0, cost_usd: 0 },
    git_branch: null,
    file: `hosted:${m.id}`,
  };
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// 拖拽期间禁用选中/改光标；结束（松手或失焦）时**务必**恢复，避免整页卡在不可选中
function beginDrag(
  axis: 'x' | 'y',
  startPos: number,
  onDelta: (d: number) => void,
) {
  let last = startPos;
  const move = (ev: MouseEvent) => {
    const cur = axis === 'x' ? ev.clientX : ev.clientY;
    onDelta(cur - last);
    last = cur;
  };
  const end = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', end);
    window.removeEventListener('blur', end);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  window.addEventListener('blur', end); // Alt+Tab / 移出窗口也恢复
  document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
  document.body.style.userSelect = 'none';
}

function VResizer({ onResize }: { onResize: (dx: number) => void }) {
  const start = (e: React.MouseEvent) => {
    e.preventDefault();
    beginDrag('x', e.clientX, onResize);
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
    beginDrag('y', e.clientY, onResize);
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
  const [overrides, setOverrides] = useState<Record<string, Bucket>>(loadBuckets);
  const [tab, setTab] = useState<Bucket>('active');
  const [actions, setActions] = useState<Record<string, ActionEvent[]>>({});
  const [managed, setManaged] = useState<ManagedInfo[]>([]);
  const [connected, setConnected] = useState(true);
  const ib = useInbox(); // 消息总线（状态 + 收发）
  const theme = useThemes(); // 换肤主题
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [lastCwd, setLastCwd] = useState(loadLastCwd);

  // 可调节面板尺寸
  const [taskbarW, setTaskbarW] = useState(184);
  const [sidebarW, setSidebarW] = useState(340);
  const [listH, setListH] = useState(300);
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
    // getSessions 作为连通性信号：成功→connected，失败→断线横幅
    getSessions()
      .then((s) => {
        setSessions(s);
        setConnected(true);
      })
      .catch(() => setConnected(false));
    getStats().then(setStats).catch(() => {});
    getManaged()
      .then((m) => setManaged(m.filter((x) => x.alive)))
      .catch(() => {});
  };

  useEffect(() => {
    load();
    ib.load();
    theme.reload();
    const stop = connectWs(
      load,
      (p) => setActions((a) => pushAction(a, p as never)),
      ib.load,
    );
    const iv = setInterval(load, 5000);
    return () => {
      stop();
      clearInterval(iv);
    };
  }, []);

  // 会话归类（用户覆盖优先，否则按状态+活动推断）
  const bucketFor = (s: SessionSummary) => bucketOf(s, overrides);

  const reclassify = (id: string, bucket: Bucket) =>
    setOverrides((prev) => {
      const next = { ...prev, [id]: bucket };
      saveBuckets(next);
      return next;
    });

  // 托管(新建)会话合成的 active 行：未 resume（无 sessionId 关联）且同 cwd 尚无 active 的真实会话
  const hostedActive = useMemo(() => {
    const activeCwds = new Set(
      sessions
        .filter((s) => bucketOf(s, overrides) === 'active')
        .map((s) => s.project_path),
    );
    return managed
      .filter((m) => {
        const chat = chats.find((c) => c.id === m.id);
        if (chat?.sessionId) return false; // resume 的用真实 JSONL 行
        if (activeCwds.has(m.cwd)) return false; // 同 cwd 已有 active 真实会话
        return true;
      })
      .map(synthHosted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [managed, chats, sessions, overrides]);

  // 三态计数（active 含托管新建会话）
  const counts = useMemo(() => {
    const c: Record<Bucket, number> = { active: 0, inactive: 0, history: 0 };
    for (const s of sessions) c[bucketOf(s, overrides)]++;
    c.active += hostedActive.length;
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, overrides, hostedActive]);

  // 中间列表：有搜索词 → 跨全部会话；否则 → 当前 tab 的会话（active tab 追加托管新建会话）
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = sessions.filter((s) => {
      if (activeProject && s.project_path !== activeProject) return false;
      if (q) return matchesQuery(s, q, renames);
      return bucketOf(s, overrides) === tab;
    });
    if (!q && tab === 'active') return [...hostedActive, ...base];
    return base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, query, activeProject, renames, overrides, tab, hostedActive]);

  const selectedSession = sessions.find((s) => s.id === selectedId) || null;

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
    // 托管(新建)合成行：直接打开/聚焦其终端
    const m = managed.find((x) => x.id === id);
    if (m) {
      openManaged(m);
      setSelectedId(id);
      return;
    }
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

  // 关闭 tab = 收起（进程仍在后台运行，可从「运行中」重开）
  const detachChat = (termId: string) => {
    setChats((prev) => prev.filter((c) => c.id !== termId));
    setActiveChatId((prev) => (prev === termId ? null : prev));
  };

  // 结束托管进程（真正 kill），并收起其 tab
  const killChat = async (termId: string) => {
    await killManaged(termId).catch(() => {});
    detachChat(termId);
    setManaged((prev) => prev.filter((m) => m.id !== termId));
  };

  // 打开/重开某托管会话的终端（刷新或收起后重连）
  const openManaged = (info: ManagedInfo) => {
    setChats((prev) =>
      prev.some((c) => c.id === info.id)
        ? prev
        : [...prev, { id: info.id, title: info.title }],
    );
    setActiveChatId(info.id);
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
        connected={connected}
        unreadCount={ib.unread}
        onOpenInbox={() => ib.setOpen((v) => !v)}
      />
      {ib.open && (
        <InboxPanel
          messages={ib.messages}
          sessions={sessions}
          renames={renames}
          onSend={ib.send}
          onMarkRead={ib.markRead}
          onClose={() => ib.setOpen(false)}
        />
      )}
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
            tab={tab}
            setTab={setTab}
            counts={counts}
            bucketFor={bucketFor}
            onReclassify={reclassify}
            onDropProjectCwd={newSessionAt}
          />
          <HResizer
            onResize={(dy) =>
              setListH((h) => clamp(h + dy, 160, window.innerHeight - 260))
            }
          />
          <DetailPane
            id={selectedId}
            liveActions={selectedId ? actions[selectedId] || [] : []}
            skin={theme.skin}
            themes={theme.themes}
            themeVersion={theme.version}
            onPickSkin={theme.pick}
            onReloadThemes={theme.reload}
          />
        </div>
        <VResizer onResize={(dx) => setSidebarW((w) => clamp(w + dx, 280, 760))} />
        <ChatPane
          chats={chats}
          activeChatId={activeChatId}
          selected={selectedSession}
          managed={managed}
          onSelectChat={selectChat}
          onCloseChat={detachChat}
          onOpenManaged={openManaged}
          onKillManaged={killChat}
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
