import { describe, it, expect } from 'vitest';
import { unreadCount, sortByNewest } from './inbox';
import type { InboxMessage } from '../types';

const msg = (over: Partial<InboxMessage>): InboxMessage => ({
  id: 'x',
  from: 'A',
  to: 'B',
  body: 'hi',
  created_at: 0,
  read_at: null,
  urgent: false,
  ...over,
});

describe('unreadCount', () => {
  it('counts only unread (read_at null)', () => {
    const list = [
      msg({ id: '1', read_at: null }),
      msg({ id: '2', read_at: 123 }),
      msg({ id: '3', read_at: null }),
    ];
    expect(unreadCount(list)).toBe(2);
  });
  it('zero for empty', () => {
    expect(unreadCount([])).toBe(0);
  });
});

describe('sortByNewest', () => {
  it('orders by created_at descending, immutably', () => {
    const list = [
      msg({ id: 'a', created_at: 10 }),
      msg({ id: 'b', created_at: 30 }),
      msg({ id: 'c', created_at: 20 }),
    ];
    const sorted = sortByNewest(list);
    expect(sorted.map((m) => m.id)).toEqual(['b', 'c', 'a']);
    expect(list[0].id).toBe('a'); // 原数组不变
  });
});
