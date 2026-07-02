import type { SessionStatus } from '../types';

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

export function fmtCost(n: number): string {
  if (n >= 100) return '$' + n.toFixed(0);
  if (n >= 1) return '$' + n.toFixed(2);
  return '$' + n.toFixed(3);
}

export function relTime(epoch: number): string {
  if (!epoch) return '—';
  const s = Math.floor(Date.now() / 1000) - epoch;
  if (s < 0) return 'now';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function shortModel(m: string | null): string {
  if (!m) return '—';
  const lower = m.toLowerCase();
  if (lower.includes('opus')) return 'Opus';
  if (lower.includes('sonnet')) return 'Sonnet';
  if (lower.includes('haiku')) return 'Haiku';
  return m.replace('claude-', '');
}

export const STATUS_LABEL: Record<SessionStatus, string> = {
  working: '运行中',
  waiting: '等待',
  idle: '空闲',
  error: '错误',
  unknown: '未知',
};

export const STATUS_ICON: Record<SessionStatus, string> = {
  working: '⚙',
  waiting: '⏸',
  idle: '○',
  error: '✗',
  unknown: '·',
};
