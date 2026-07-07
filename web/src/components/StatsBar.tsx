import type { Stats } from '../types';
import { fmtCost, fmtTokens } from '../lib/format';

const SWATCH: Record<string, string> = {
  working: 'var(--working)',
  waiting: 'var(--waiting)',
  idle: 'var(--idle)',
  error: 'var(--error)',
};

export function StatsBar({
  stats,
  onNewSession,
  taskbarCollapsed,
  onToggleTaskbar,
  skipPerms,
  onToggleSkip,
  connected,
  unreadCount,
  onOpenInbox,
}: {
  stats: Stats | null;
  onNewSession: () => void;
  taskbarCollapsed: boolean;
  onToggleTaskbar: () => void;
  skipPerms: boolean;
  onToggleSkip: () => void;
  connected: boolean;
  unreadCount: number;
  onOpenInbox: () => void;
}) {
  const sc = stats?.status_counts;
  return (
    <header className="topbar">
      <button
        className="icon-btn"
        onClick={onToggleTaskbar}
        aria-label={taskbarCollapsed ? '展开任务栏' : '收起任务栏'}
        title={taskbarCollapsed ? '展开任务栏' : '收起任务栏'}
      >
        ☰
      </button>
      <div className="brand">
        <b>
          cc<span className="dot">·</span>bridge
        </b>
        <span>指挥中心</span>
      </div>

      <div className="stat">
        <span className="v">{stats?.total_sessions ?? '—'}</span>
        <span className="k">会话</span>
      </div>
      <div className="stat">
        <span className="v accent">{stats?.active_sessions ?? '—'}</span>
        <span className="k">活跃</span>
      </div>
      <div className="stat">
        <span className="v">{stats ? fmtCost(stats.cost_5h) : '—'}</span>
        <span className="k">近 5h</span>
      </div>
      <div className="stat">
        <span className="v">{stats ? fmtCost(stats.cost_7d) : '—'}</span>
        <span className="k">近 7d</span>
      </div>
      <div className="stat">
        <span className="v">{stats ? fmtCost(stats.total_cost_usd) : '—'}</span>
        <span className="k">累计</span>
      </div>
      <div className="stat">
        <span className="v">{stats ? fmtTokens(stats.tokens_7d) : '—'}</span>
        <span className="k">tok 7d</span>
      </div>

      {sc && (
        <div style={{ display: 'flex', gap: 7 }}>
          {(['working', 'waiting', 'idle', 'error'] as const).map((k) =>
            sc[k] > 0 ? (
              <span className="pill" key={k}>
                <span className="swatch" style={{ background: SWATCH[k] }} />
                {sc[k]}
              </span>
            ) : null,
          )}
        </div>
      )}

      <div className="spacer" />
      {!connected && (
        <span className="conn-pill" title="无法连接 daemon (127.0.0.1:7878)">
          ● 未连接
        </span>
      )}
      <button
        className="icon-btn inbox-btn"
        onClick={onOpenInbox}
        aria-label={`消息总线${unreadCount > 0 ? `，${unreadCount} 条未读` : ''}`}
        title="消息总线"
      >
        ✉
        {unreadCount > 0 && <span className="inbox-badge">{unreadCount}</span>}
      </button>
      <label
        className={`skip-toggle ${skipPerms ? 'on' : ''}`}
        title="新建/继续对话时加 --dangerously-skip-permissions（跳过所有权限确认，谨慎使用）"
      >
        <input type="checkbox" checked={skipPerms} onChange={onToggleSkip} />
        ⚡ 跳过权限
      </label>
      <button className="primary-btn" onClick={onNewSession}>
        ＋ 新会话
      </button>
    </header>
  );
}
