import type { DayStat } from '../types';
import { fmtCost } from '../lib/format';

function color(ratio: number): string {
  if (ratio <= 0) return 'var(--surface-2)';
  const a = 0.18 + Math.min(ratio, 1) * 0.82;
  return `rgba(217, 119, 87, ${a.toFixed(2)})`;
}

export function Heatmap({ days }: { days: DayStat[] }) {
  const max = days.reduce((m, d) => Math.max(m, d.cost_usd), 0) || 1;
  return (
    <div className="heatmap">
      <h3>用量热力图 · 近 12 周</h3>
      <div className="heat-grid">
        {days.map((d) => (
          <div
            key={d.date}
            className="heat-cell"
            style={{ background: color(d.cost_usd / max) }}
            title={`${d.date} · ${fmtCost(d.cost_usd)}`}
          />
        ))}
      </div>
    </div>
  );
}
