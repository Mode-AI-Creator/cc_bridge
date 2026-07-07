import { useCallback, useState } from 'react';
import type { InboxMessage } from '../types';
import { getInbox, sendInbox, markInboxRead, OPERATOR } from '../api';
import { unreadCount as countUnread } from '../lib/inbox';

/** 封装消息总线状态与操作，从 App 抽离（1.0 状态管理）。 */
export function useInbox() {
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    getInbox(OPERATOR).then(setMessages).catch(() => {});
  }, []);

  const send = useCallback(
    (to: string, body: string, urgent: boolean) => {
      sendInbox(to, body, urgent)
        .then(load)
        .catch((e) => window.alert('发送失败: ' + e));
    },
    [load],
  );

  const markRead = useCallback(
    (id: string) => {
      markInboxRead(OPERATOR, id).then(load).catch(() => {});
    },
    [load],
  );

  return {
    messages,
    open,
    setOpen,
    load,
    send,
    markRead,
    unread: countUnread(messages),
  };
}
