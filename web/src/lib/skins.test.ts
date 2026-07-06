import { describe, it, expect } from 'vitest';
import { resolveSkin, validateAsset, BUILTIN, type DiskTheme } from './skins';

const themes: DiskTheme[] = [
  { name: 'crabby', assets: { idle: 'idle.gif', working: 'working.png' } },
];

describe('resolveSkin', () => {
  it('builtin → canvas', () => {
    expect(resolveSkin(BUILTIN, themes, 'idle')).toEqual({ kind: 'canvas' });
  });
  it('image when asset exists for state', () => {
    expect(resolveSkin('crabby', themes, 'idle')).toEqual({
      kind: 'image',
      file: 'idle.gif',
    });
  });
  it('falls back to canvas when state asset missing', () => {
    expect(resolveSkin('crabby', themes, 'error')).toEqual({ kind: 'canvas' });
  });
  it('falls back to canvas for unknown theme', () => {
    expect(resolveSkin('ghost', themes, 'idle')).toEqual({ kind: 'canvas' });
  });
});

describe('validateAsset', () => {
  const mk = (name: string, size: number) =>
    ({ name, size }) as unknown as File;

  it('accepts allowed formats within size', () => {
    expect(validateAsset(mk('idle.png', 1000))).toBeNull();
    expect(validateAsset(mk('a.GIF', 1000))).toBeNull();
    expect(validateAsset(mk('a.webp', 1000))).toBeNull();
  });
  it('rejects bad format', () => {
    expect(validateAsset(mk('a.bmp', 1000))).toMatch(/格式/);
  });
  it('rejects empty and oversized', () => {
    expect(validateAsset(mk('a.png', 0))).toMatch(/空/);
    expect(validateAsset(mk('a.png', 512 * 1024 + 1))).toMatch(/过大/);
  });
});
