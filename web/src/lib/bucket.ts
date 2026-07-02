import type { SessionStatus } from '../types';

export type Bucket = 'active' | 'inactive' | 'history';

export const BUCKET_LABEL: Record<Bucket, string> = {
  active: '活跃',
  inactive: '空闲',
  history: '历史',
};

/** 按状态自动归类：运行/等待/错误 → active；其余 → inactive。history 仅手动。 */
export function autoBucket(status: SessionStatus): Bucket {
  if (status === 'working' || status === 'waiting' || status === 'error') return 'active';
  return 'inactive';
}

const KEY = 'ccbridge.buckets';

export function loadOverrides(): Record<string, Bucket> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

export function saveOverrides(o: Record<string, Bucket>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(o));
  } catch {
    /* ignore */
  }
}
