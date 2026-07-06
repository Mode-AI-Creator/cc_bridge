import type { SessionSummary } from '../types';

/** 会话在中间看板的三态归类。 */
export type Bucket = 'active' | 'inactive' | 'history';

export const BUCKETS: Bucket[] = ['active', 'inactive', 'history'];
export const BUCKET_LABEL: Record<Bucket, string> = {
  active: '激活中',
  inactive: '非激活',
  history: '历史',
};

const KEY = 'ccbridge.buckets';
/** 24h 内活动过的 idle 会话默认归入 inactive，更久归 history。 */
const RECENT_SECONDS = 24 * 3600;

export function loadBuckets(): Record<string, Bucket> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

export function saveBuckets(m: Record<string, Bucket>): void {
  localStorage.setItem(KEY, JSON.stringify(m));
}

/**
 * 计算会话所属 bucket：用户手动归类优先，否则按状态 + 最近活动推断。
 * - working/waiting → active
 * - idle 且 24h 内活动 → inactive
 * - 其余 → history
 */
export function bucketOf(
  s: SessionSummary,
  overrides: Record<string, Bucket>,
  nowSec: number = Date.now() / 1000,
): Bucket {
  const o = overrides[s.id];
  if (o) return o;
  if (s.status === 'working' || s.status === 'waiting') return 'active';
  const age = nowSec - s.last_active_epoch;
  if (s.last_active_epoch > 0 && age <= RECENT_SECONDS) return 'inactive';
  return 'history';
}

/** 会话是否命中搜索词（匹配项目名 / 标题或重命名 / id）。空词恒真。 */
export function matchesQuery(
  s: SessionSummary,
  query: string,
  renames: Record<string, string>,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const name = (renames[s.id] || s.title || '').toLowerCase();
  return (
    s.project_name.toLowerCase().includes(q) ||
    name.includes(q) ||
    s.id.toLowerCase().includes(q)
  );
}
