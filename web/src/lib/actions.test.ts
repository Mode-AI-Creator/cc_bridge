import { describe, it, expect } from 'vitest';
import { pushAction, actionGlyph, type ActionEvent } from './actions';

describe('pushAction', () => {
  it('appends per-session, immutably', () => {
    const a0: Record<string, ActionEvent[]> = {};
    const a1 = pushAction(a0, { session_id: 's1', event: 'PreToolUse', tool: 'Bash' }, 60, 1000);
    expect(a0).toEqual({}); // 原对象不变
    expect(a1.s1).toHaveLength(1);
    expect(a1.s1[0]).toMatchObject({ event: 'PreToolUse', tool: 'Bash', ts: 1000 });

    const a2 = pushAction(a1, { session_id: 's1', event: 'PostToolUse', tool: 'Bash' }, 60, 1001);
    expect(a2.s1).toHaveLength(2);
    // 不同会话互不影响
    const a3 = pushAction(a2, { session_id: 's2', event: 'Stop' }, 60, 1002);
    expect(a3.s1).toHaveLength(2);
    expect(a3.s2).toHaveLength(1);
  });

  it('caps the ring buffer', () => {
    let map: Record<string, ActionEvent[]> = {};
    for (let i = 0; i < 10; i++) {
      map = pushAction(map, { session_id: 's', event: 'PreToolUse', tool: `t${i}` }, 3, i);
    }
    expect(map.s).toHaveLength(3);
    expect(map.s.map((e) => e.tool)).toEqual(['t7', 't8', 't9']);
  });

  it('ignores payload without session_id', () => {
    const map = pushAction({}, { session_id: '', event: 'Stop' });
    expect(map).toEqual({});
  });
});

describe('actionGlyph', () => {
  const ev = (o: Partial<ActionEvent>): ActionEvent => ({
    ts: 0,
    event: 'PreToolUse',
    tool: null,
    status: 'working',
    ...o,
  });
  it('shows tool name when present', () => {
    expect(actionGlyph(ev({ tool: 'Read' }))).toBe('▸ Read');
  });
  it('maps known events without tool', () => {
    expect(actionGlyph(ev({ event: 'Stop', tool: null }))).toContain('停止');
    expect(actionGlyph(ev({ event: 'Notification', tool: null }))).toContain('待确认');
  });
});
