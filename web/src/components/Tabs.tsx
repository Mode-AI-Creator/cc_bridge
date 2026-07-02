import { useState } from 'react';
import type { Bucket } from '../lib/bucket';
import { BUCKET_LABEL } from '../lib/bucket';

const ORDER: Bucket[] = ['active', 'inactive', 'history'];

export function Tabs({
  current,
  counts,
  onSelect,
  onDropTo,
}: {
  current: Bucket;
  counts: Record<Bucket, number>;
  onSelect: (b: Bucket) => void;
  onDropTo: (id: string, b: Bucket) => void;
}) {
  const [over, setOver] = useState<Bucket | null>(null);
  return (
    <div className="tabs">
      {ORDER.map((b) => (
        <button
          key={b}
          className={`tab ${current === b ? 'on' : ''} ${over === b ? 'drop' : ''}`}
          onClick={() => onSelect(b)}
          onDragOver={(e) => {
            e.preventDefault();
            if (over !== b) setOver(b);
          }}
          onDragLeave={() => setOver((o) => (o === b ? null : o))}
          onDrop={(e) => {
            e.preventDefault();
            setOver(null);
            const id = e.dataTransfer.getData('text/plain');
            if (id) onDropTo(id, b);
          }}
        >
          {BUCKET_LABEL[b]}
          <span className="count">{counts[b]}</span>
        </button>
      ))}
      <div className="tabs-hint">拖拽卡片到标签页可归类</div>
    </div>
  );
}
