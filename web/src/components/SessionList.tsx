import { useState } from 'react';
import type { SessionSummary } from '../types';
import { fmtCost, relTime } from '../lib/format';
import { type Bucket, BUCKETS } from '../lib/classify';
import { useI18n } from '../lib/i18n';

const PROJECT_MIME = 'application/x-ccbridge-project';
const SESSION_MIME = 'application/x-ccbridge-session';

export function SessionList({
  sessions,
  selectedId,
  onSelect,
  renames,
  onRename,
  query,
  setQuery,
  tab,
  setTab,
  counts,
  bucketFor,
  onReclassify,
  onDropProjectCwd,
}: {
  sessions: SessionSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  renames: Record<string, string>;
  onRename: (id: string, newName: string) => void;
  query: string;
  setQuery: (q: string) => void;
  tab: Bucket;
  setTab: (b: Bucket) => void;
  counts: Record<Bucket, number>;
  bucketFor: (s: SessionSummary) => Bucket;
  onReclassify: (id: string, bucket: Bucket) => void;
  onDropProjectCwd: (cwd: string) => void;
}) {
  const { t } = useI18n();
  const bucketLabel = (b: Bucket) => t(`bucket.${b}`);
  const [dragOver, setDragOver] = useState(false);
  const [overTab, setOverTab] = useState<Bucket | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const searching = query.trim().length > 0;
  const list = [...sessions].sort((a, b) => b.last_active_epoch - a.last_active_epoch);

  const startEdit = (id: string, cur: string) => {
    setEditing(id);
    setDraft(cur);
  };
  const commit = () => {
    if (editing) onRename(editing, draft);
    setEditing(null);
  };

  const acceptsDrag = (types: readonly string[]) =>
    types.includes(PROJECT_MIME) || types.includes(SESSION_MIME);

  return (
    <div
      className={`session-list ${dragOver ? 'drop' : ''}`}
      onDragOver={(e) => {
        if (acceptsDrag(e.dataTransfer.types)) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const sid = e.dataTransfer.getData(SESSION_MIME);
        if (sid) {
          onReclassify(sid, tab); // 拖到列表 → 归入当前 tab
          return;
        }
        const cwd = e.dataTransfer.getData(PROJECT_MIME);
        if (cwd) onDropProjectCwd(cwd);
      }}
    >
      <div className="list-head">
        <span className="list-title">{t('list.title')}</span>
        <input
          className="search-sm"
          placeholder={t('list.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="bucket-tabs">
        {BUCKETS.map((b) => (
          <button
            key={b}
            className={`bucket-tab ${tab === b ? 'sel' : ''} ${overTab === b ? 'over' : ''}`}
            onClick={() => setTab(b)}
            title={bucketLabel(b)}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(SESSION_MIME)) {
                e.preventDefault();
                setOverTab(b);
              }
            }}
            onDragLeave={() => setOverTab((cur) => (cur === b ? null : cur))}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOverTab(null);
              setDragOver(false);
              const sid = e.dataTransfer.getData(SESSION_MIME);
              if (sid) onReclassify(sid, b);
            }}
          >
            {bucketLabel(b)}
            <span className="bucket-count">{counts[b]}</span>
          </button>
        ))}
      </div>

      <div className="list-body">
        {list.length === 0 && (
          <div className="list-empty">
            {searching
              ? t('list.noMatch')
              : tab === 'active'
                ? t('list.emptyActive')
                : t('list.emptyOther')}
          </div>
        )}
        {list.map((s) => {
          const name = renames[s.id] || s.title || s.id.slice(0, 8);
          const isEditing = editing === s.id;
          return (
            <div
              className={`sess-row s-${s.status} ${s.id === selectedId ? 'sel' : ''}`}
              key={s.file}
              draggable={!isEditing}
              onDragStart={(e) => {
                e.dataTransfer.setData(SESSION_MIME, s.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onClick={() => !isEditing && onSelect(s.id)}
            >
              <span className="status-dot" />
              <div className="sess-main">
                {isEditing ? (
                  <input
                    className="rename-input"
                    autoFocus
                    value={draft}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commit();
                      } else if (e.key === 'Escape') {
                        setEditing(null);
                      }
                    }}
                    onBlur={commit}
                  />
                ) : (
                  <span
                    className="sess-name"
                    title={name}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      startEdit(s.id, name);
                    }}
                  >
                    {name}
                  </span>
                )}
                <span className="sess-proj">
                  {s.project_name}
                  {searching && (
                    <span className="sess-bucket-tag">{bucketLabel(bucketFor(s))}</span>
                  )}
                </span>
              </div>
              {!isEditing && (
                <>
                  <div className="sess-meta">
                    <span className="sess-cost">{fmtCost(s.usage.cost_usd)}</span>
                    <span className="sess-when">{relTime(s.last_active_epoch)}</span>
                  </div>
                  <button
                    className="rename-btn"
                    title="重命名（或双击名称）"
                    onClick={(e) => {
                      e.stopPropagation();
                      startEdit(s.id, name);
                    }}
                  >
                    ✎
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
      <div className={`drop-hint ${dragOver ? 'show' : ''}`}>
        放会话到标签归类 · 放项目则新建会话
      </div>
    </div>
  );
}
