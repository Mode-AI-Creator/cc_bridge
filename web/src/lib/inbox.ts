import type { InboxMessage } from '../types';

/** 未读消息数。 */
export const unreadCount = (msgs: InboxMessage[]): number =>
  msgs.filter((m) => m.read_at == null).length;

/** 按时间倒序（最新在前）。 */
export const sortByNewest = (msgs: InboxMessage[]): InboxMessage[] =>
  [...msgs].sort((a, b) => b.created_at - a.created_at);
