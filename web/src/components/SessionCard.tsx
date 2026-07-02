import type { SessionSummary } from '../types';
import { fmtTokens, fmtCost, relTime, shortModel } from '../lib/format';

export function SessionCard({
  s,
  active,
  onClick,
  onResume,
}: {
  s: SessionSummary;
  active: boolean;
  onClick: () => void;
  onResume: () => void;
}) {
  const title = s.title || s.id.slice(0, 8);
  const tot =
    s.usage.input + s.usage.output + s.usage.cache_creation + s.usage.cache_read;
  return (
    <div
      className={`card s-${s.status} ${active ? 'active' : ''}`}
      onClick={onClick}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', s.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
    >
      <div className="card-top">
        <span className="status-dot" />
        <span className="card-title">{title}</span>
        <span className="card-model">{shortModel(s.model)}</span>
      </div>
      <div className="card-sub">
        {s.git_branch ? `⎇ ${s.git_branch} · ` : ''}
        {s.message_count} msg · {s.tool_count} tools
      </div>
      <div className="card-metrics">
        <div className="metric">
          <div className="mv">{fmtTokens(tot)}</div>
          <div className="mk">tokens</div>
        </div>
        <div className="metric">
          <div className="mv cost">{fmtCost(s.usage.cost_usd)}</div>
          <div className="mk">cost</div>
        </div>
      </div>
      <div className="card-when">{relTime(s.last_active_epoch)}</div>
      <button
        className="card-go"
        title="在平台内继续对话 (claude --resume)"
        onClick={(e) => {
          e.stopPropagation();
          onResume();
        }}
      >
        ▶ 继续
      </button>
    </div>
  );
}
