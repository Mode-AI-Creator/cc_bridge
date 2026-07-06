#!/usr/bin/env node
// ccbridge CC hook：把 hook 事件上报给本地 daemon，用于精确状态 + 实时动作流。
// 由 `ccbridge install-hooks` 注入 settings.json，命令形如：
//   node <path>/ccbridge-hook.mjs <EventName>
// CC 会把 hook 负载以 JSON 写入 stdin。本脚本必须：静默、不阻塞、失败即忽略。
import http from 'node:http';

const PORT = process.env.CCBRIDGE_PORT || 7878;
const HARD_EXIT_MS = 800;

// 兜底：无论如何最多 800ms 后退出，绝不拖住 CC
const hardTimer = setTimeout(() => process.exit(0), HARD_EXIT_MS);
hardTimer.unref?.();

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let j = {};
  try {
    j = JSON.parse(raw);
  } catch {
    /* 非 JSON 也无妨 */
  }
  const body = JSON.stringify({
    session_id: j.session_id || j.sessionId || '',
    event: j.hook_event_name || process.argv[2] || '',
    tool: j.tool_name || j.tool || null,
  });

  const req = http.request(
    {
      host: '127.0.0.1',
      port: PORT,
      path: '/api/hook',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      },
    },
    (res) => {
      res.on('data', () => {});
      res.on('end', () => process.exit(0));
    },
  );
  req.on('error', () => process.exit(0)); // daemon 未启动 → 静默退出
  req.write(body);
  req.end();
});
process.stdin.on('error', () => process.exit(0));
