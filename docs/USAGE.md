# ccbridge 使用指南

## 快速开始

```bash
cd web && npm install && npm run build     # 构建前端
cargo run -p ccbridge-daemon               # 启动，打开 http://127.0.0.1:7878
```

单二进制（自包含，内嵌前端）：

```bash
cd web && npm run build
cargo build -p ccbridge-daemon --release --features embed-frontend
# 产物：target/release/ccbridge（可拷到任意位置直接运行）
```

## 配置

`~/.claude/ccbridge/config.toml`（可选，见仓库 `config.example.toml`）：

```toml
[server]
addr = "127.0.0.1:7878"   # env 覆盖：CCBRIDGE_ADDR
[claude]
program = "claude"         # env 覆盖：CCBRIDGE_CLAUDE
```

优先级：**环境变量 > config.toml > 默认**。

## 精确实时状态（hooks）

无 hook 时状态按活动时间启发式推断；装 hook 后由 CC 事件驱动，精确到工具级：

```bash
ccbridge install-hooks      # 备份 settings.json → 注入 hooks + MCP server
ccbridge uninstall-hooks    # 完整还原
```

装完**新开**的 CC 会话生效。装的东西：6 个 hook（上报状态/工具流）+ `mcpServers.ccbridge`（跨会话通信工具）。

## 跨会话通信（MCP）

`install-hooks` 会把 `ccbridge mcp` 注册为 MCP server。CC 会话内的 agent 即可调用：

| 工具 | 作用 |
|---|---|
| `inbox_read(unread_only?)` | 读自己的收件箱 |
| `send_to_session(to, body, urgent?)` | 给另一个会话发消息（urgent 尝试注入其终端） |
| `shared_note_write(key, body)` / `shared_note_read(key)` | 跨会话共享笔记 |
| `search_other_sessions(query)` | 搜索其它会话 |
| `list_sessions()` | 列出可发送目标 |

**身份**：ccbridge 托管（`--resume` 起）的会话会被注入 `CCBRIDGE_SESSION`，MCP server 据此识别自身；非托管会话回退别名（`CCBRIDGE_ALIAS` 或 `operator`）。

前端顶栏的 ✉ 「消息总线」可人工向任意会话发消息、查看 operator 收件箱与未读。

数据落 `~/.claude/ccbridge/ccbridge.db`（SQLite），daemon 重启不丢。

## 吉祥物换肤

详情区 🎨 打开换肤面板。内置 `builtin`（canvas 像素 Coding Pet，眼睛跟随光标）。自定义：

- 目录 `~/.claude/ccbridge/themes/<name>/`，每状态一张：`idle/working/waiting/error/unknown`。
- 格式 PNG/APNG/GIF/WebP/SVG，单文件 ≤512KiB，建议 128×128 像素风。
- 缺失状态自动回退 builtin。第三方美术仅本机个人使用，勿入公开仓库。

## 交互与托管

- 列表选会话 →「▶ 继续对话」在内嵌终端接管（`claude --resume`）。
- 关闭 tab = 收起（进程后台继续）；「运行中 ▾」列出存活托管会话，可重开或结束。
- 复制 `Ctrl/Cmd+C`（有选区）、粘贴 `Ctrl/Cmd+V`；终端断线自动重连。

## 故障排查

- **前端空白 / 「未连接」**：daemon 没起或端口不对。确认 `cargo run` 在跑、地址一致。
- **状态不准**：没装 hook（`install-hooks`）或 CC 会话是装 hook 前开的（重开）。
- **`cargo` 找不到**：把 `~/.cargo/bin` 加入 PATH，或用完整路径。
- **Windows 上 `install-hooks` 需 `node`**：hook 脚本是 `.mjs`，确保 `node` 在 PATH。
