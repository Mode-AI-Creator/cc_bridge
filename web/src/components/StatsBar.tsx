import type { Stats } from '../types';
import { fmtCost, fmtTokens } from '../lib/format';
import { useI18n } from '../lib/i18n';

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
  const { t, lang, toggle } = useI18n();
  const sc = stats?.status_counts;
  return (
    <header className="topbar">
      <button
        className="icon-btn"
        onClick={onToggleTaskbar}
        aria-label={t(taskbarCollapsed ? 'top.toggleTaskbarShow' : 'top.toggleTaskbarHide')}
        title={t(taskbarCollapsed ? 'top.toggleTaskbarShow' : 'top.toggleTaskbarHide')}
      >
        ☰
      </button>
      <div className="brand">
        <b>
          cc<span className="dot">·</span>bridge
        </b>
        <span>{t('brand.subtitle')}</span>
      </div>

      <div className="stat">
        <span className="v">{stats?.total_sessions ?? '—'}</span>
        <span className="k">{t('stat.sessions')}</span>
      </div>
      <div className="stat">
        <span className="v accent">{stats?.active_sessions ?? '—'}</span>
        <span className="k">{t('stat.active')}</span>
      </div>
      <div className="stat">
        <span className="v">{stats ? fmtCost(stats.cost_5h) : '—'}</span>
        <span className="k">{t('stat.5h')}</span>
      </div>
      <div className="stat">
        <span className="v">{stats ? fmtCost(stats.cost_7d) : '—'}</span>
        <span className="k">{t('stat.7d')}</span>
      </div>
      <div className="stat">
        <span className="v">{stats ? fmtCost(stats.total_cost_usd) : '—'}</span>
        <span className="k">{t('stat.total')}</span>
      </div>
      <div className="stat">
        <span className="v">{stats ? fmtTokens(stats.tokens_7d) : '—'}</span>
        <span className="k">{t('stat.tok7d')}</span>
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
        <span className="conn-pill" title="daemon 127.0.0.1:7878">
          {t('top.disconnected')}
        </span>
      )}
      <button
        className="icon-btn"
        onClick={toggle}
        aria-label="language"
        title={lang === 'zh' ? 'Switch to English' : '切换到中文'}
      >
        {t('top.lang')}
      </button>
      <button
        className="icon-btn inbox-btn"
        onClick={onOpenInbox}
        aria-label={t('top.inbox')}
        title={t('top.inbox')}
      >
        ✉
        {unreadCount > 0 && <span className="inbox-badge">{unreadCount}</span>}
      </button>
      <label className={`skip-toggle ${skipPerms ? 'on' : ''}`} title="--dangerously-skip-permissions">
        <input type="checkbox" checked={skipPerms} onChange={onToggleSkip} />
        {t('top.skipPerms')}
      </label>
      <button className="primary-btn" onClick={onNewSession}>
        {t('top.newSession')}
      </button>
    </header>
  );
}
