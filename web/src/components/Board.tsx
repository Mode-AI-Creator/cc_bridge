import type { SessionSummary } from '../types';
import { SessionCard } from './SessionCard';
import { fmtCost } from '../lib/format';

interface Group {
  name: string;
  sessions: SessionSummary[];
  cost: number;
  active: number;
}

function groupByProject(sessions: SessionSummary[]): Group[] {
  const map = new Map<string, Group>();
  for (const s of sessions) {
    let g = map.get(s.project_name);
    if (!g) {
      g = { name: s.project_name, sessions: [], cost: 0, active: 0 };
      map.set(s.project_name, g);
    }
    g.sessions.push(s);
    g.cost += s.usage.cost_usd;
    if (s.status === 'working' || s.status === 'waiting') g.active += 1;
  }
  // 组内按最近活动排序，组间按活跃数→成本排序
  const groups = [...map.values()];
  for (const g of groups)
    g.sessions.sort((a, b) => b.last_active_epoch - a.last_active_epoch);
  groups.sort((a, b) => b.active - a.active || b.cost - a.cost);
  return groups;
}

export function Board({
  sessions,
  selectedId,
  onSelect,
  onResume,
  emptyHint,
}: {
  sessions: SessionSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onResume: (s: SessionSummary) => void;
  emptyHint?: string;
}) {
  const groups = groupByProject(sessions);
  if (groups.length === 0) {
    return <div className="empty">{emptyHint || '未发现会话。'}</div>;
  }
  return (
    <div className="board">
      {groups.map((g) => (
        <section className="group" key={g.name}>
          <div className="group-head">
            <h2>{g.name}</h2>
            <span className="meta">
              {g.sessions.length} 会话
              {g.active > 0 ? ` · ${g.active} 活跃` : ''} · {fmtCost(g.cost)}
            </span>
            <div className="rule" />
          </div>
          <div className="cards">
            {g.sessions.map((s) => (
              <SessionCard
                key={s.file}
                s={s}
                active={s.id === selectedId}
                onClick={() => onSelect(s.id)}
                onResume={() => onResume(s)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
