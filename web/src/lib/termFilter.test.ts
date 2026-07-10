import { describe, it, expect } from 'vitest';
import { stripMouse, newStripState } from './termFilter';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (u: Uint8Array) => new TextDecoder().decode(u);

describe('stripMouse', () => {
  it('removes mouse-tracking enable sequences, keeps other text', () => {
    const s = newStripState();
    const input = enc('a\x1b[?1000hb\x1b[?1002hc\x1b[?1003hd');
    expect(dec(stripMouse(input, s))).toBe('abcd');
  });

  it('keeps disable sequences and non-tracking modes', () => {
    const s = newStripState();
    // 1000l (disable) 与 1006h (SGR 编码) 都应保留
    const input = enc('x\x1b[?1000lx\x1b[?1006hx');
    expect(dec(stripMouse(input, s))).toBe('x\x1b[?1000lx\x1b[?1006hx');
  });

  it('does not eat lookalike sequences', () => {
    const s = newStripState();
    const input = enc('\x1b[2J\x1b[?25h\x1b[?1004h'); // clear / cursor / focus-track
    expect(dec(stripMouse(input, s))).toBe('\x1b[2J\x1b[?25h\x1b[?1004h');
  });

  it('handles a sequence split across two chunks', () => {
    const s = newStripState();
    const first = enc('hello\x1b[?10'); // 序列被切断
    const second = enc('02hworld');
    const out1 = dec(stripMouse(first, s));
    const out2 = dec(stripMouse(second, s));
    expect(out1).toBe('hello'); // 前缀被缓存，未误输出
    expect(out2).toBe('world'); // 拼回后整段被剥离
  });

  it('carries a lone trailing ESC then emits when not a match', () => {
    const s = newStripState();
    expect(dec(stripMouse(enc('ab\x1b'), s))).toBe('ab'); // ESC 缓存
    expect(dec(stripMouse(enc('c'), s))).toBe('\x1bc'); // 非匹配 → ESC 原样吐出
  });
});
