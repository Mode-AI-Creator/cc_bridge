import { describe, it, expect } from 'vitest';
import { bucketOf, matchesQuery, type Bucket } from './classify';
import type { SessionSummary } from '../types';

const NOW = 1_000_000_000; // 固定 now（秒）

function session(over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 's1',
    project_path: '/tmp/proj',
    project_name: 'proj',
    title: 'my session',
    model: null,
    status: 'idle',
    started_at: null,
    last_active_at: null,
    last_active_epoch: NOW,
    had_error: false,
    message_count: 1,
    tool_count: 0,
    usage: { input: 0, output: 0, cache_creation: 0, cache_read: 0, cost_usd: 0 },
    git_branch: null,
    file: '/tmp/s1.jsonl',
    ...over,
  };
}

describe('bucketOf', () => {
  it('working/waiting → active', () => {
    expect(bucketOf(session({ status: 'working' }), {}, NOW)).toBe('active');
    expect(bucketOf(session({ status: 'waiting' }), {}, NOW)).toBe('active');
  });

  it('idle within 24h → inactive, older → history', () => {
    const recent = session({ status: 'idle', last_active_epoch: NOW - 3600 });
    expect(bucketOf(recent, {}, NOW)).toBe('inactive');
    const old = session({ status: 'idle', last_active_epoch: NOW - 3 * 86400 });
    expect(bucketOf(old, {}, NOW)).toBe('history');
  });

  it('manual override wins over derived bucket', () => {
    const s = session({ status: 'working' }); // 本应 active
    const overrides: Record<string, Bucket> = { s1: 'history' };
    expect(bucketOf(s, overrides, NOW)).toBe('history');
  });
});

describe('matchesQuery', () => {
  const s = session({ project_name: 'ccbridge', title: 'fix bug', id: 'abc123' });

  it('empty query matches all', () => {
    expect(matchesQuery(s, '', {})).toBe(true);
    expect(matchesQuery(s, '   ', {})).toBe(true);
  });

  it('matches project / title / id, case-insensitive', () => {
    expect(matchesQuery(s, 'CCBRIDGE', {})).toBe(true);
    expect(matchesQuery(s, 'bug', {})).toBe(true);
    expect(matchesQuery(s, 'abc', {})).toBe(true);
    expect(matchesQuery(s, 'nomatch', {})).toBe(false);
  });

  it('matches rename over title', () => {
    expect(matchesQuery(s, 'renamed', { abc123: 'renamed thing' })).toBe(true);
  });
});
