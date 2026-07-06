import { useEffect, useRef } from 'react';
import { type ActionEvent, actionGlyph } from '../lib/actions';

function clock(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 像素/CC 终端风格的实时动作流（消费 hook 事件）。 */
export function ActionStream({ events }: { events: ActionEvent[] }) {
  const ref = useRef<HTMLDivElement>(null);

  // 新事件到达时自动滚到底部
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  if (events.length === 0) return null;

  const last = events.length - 1;
  return (
    <div className="action-stream">
      <div className="as-head">
        <span className="as-rec" /> 实时动作流
      </div>
      <div className="as-body" ref={ref}>
        {events.map((e, i) => (
          <div className={`as-line s-${e.status} ${i === last ? 'live' : ''}`} key={i}>
            <span className="as-t">{clock(e.ts)}</span>
            <span className="as-g">{actionGlyph(e)}</span>
          </div>
        ))}
        <span className="as-cursor">█</span>
      </div>
    </div>
  );
}
