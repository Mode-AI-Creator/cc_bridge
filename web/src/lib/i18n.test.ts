import { describe, it, expect } from 'vitest';
import { translate } from './i18n';

describe('translate', () => {
  it('returns the requested language string', () => {
    expect(translate('zh', 'top.newSession')).toBe('＋ 新会话');
    expect(translate('en', 'top.newSession')).toBe('+ New session');
  });
  it('bucket keys resolve per language', () => {
    expect(translate('zh', 'bucket.active')).toBe('激活中');
    expect(translate('en', 'bucket.active')).toBe('Active');
  });
  it('falls back to the key when missing', () => {
    expect(translate('en', 'no.such.key')).toBe('no.such.key');
  });
});
