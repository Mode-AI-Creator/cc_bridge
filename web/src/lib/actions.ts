/** 一条实时动作事件（由 daemon 的 hook 广播派生）。 */
export interface ActionEvent {
  ts: number; // 客户端接收时刻（epoch ms）
  event: string; // PreToolUse / PostToolUse / Stop / ...
  tool: string | null;
  status: string; // working / waiting
}

/** daemon 经 /ws 广播的 hook 负载。 */
export interface HookPayload {
  type?: string;
  session_id: string;
  event: string;
  tool?: string | null;
  status?: string;
}

export const ACTION_CAP = 60;

/**
 * 将一条 hook 事件推入对应会话的动作流环形缓冲（不可变返回新 map）。
 * 超过 `cap` 时丢弃最旧的。
 */
export function pushAction(
  map: Record<string, ActionEvent[]>,
  p: HookPayload,
  cap: number = ACTION_CAP,
  now: number = Date.now(),
): Record<string, ActionEvent[]> {
  if (!p.session_id) return map;
  const ev: ActionEvent = {
    ts: now,
    event: p.event,
    tool: p.tool ?? null,
    status: p.status ?? '',
  };
  const prev = map[p.session_id] || [];
  const next = [...prev, ev].slice(-cap);
  return { ...map, [p.session_id]: next };
}

/** 事件的像素风字形/标签。 */
export function actionGlyph(e: ActionEvent): string {
  if (e.tool) return `▸ ${e.tool}`;
  switch (e.event) {
    case 'Stop':
      return '■ 停止';
    case 'Notification':
      return '‼ 待确认';
    case 'UserPromptSubmit':
      return '⌁ 提交';
    case 'SessionStart':
      return '⏻ 启动';
    case 'PostToolUse':
      return '✓ 完成';
    default:
      return e.event;
  }
}
