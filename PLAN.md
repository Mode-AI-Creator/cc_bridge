# ccbridge — 本地化 Claude Code 会话指挥中心

> 统一发现、监控、编排本机（及远程）并发的 Claude Code 会话。
> 功能对标 **cldctrl**（会话发现 / token·成本 / resume / 工具监控），
> 展现对标 **paperclip**（web dashboard，"指挥中心 / 任务管理器"隐喻，agent 卡片化编组）。

## 1. 需求

- 自动发现本地所有 CC 会话，统一监控：实时状态、token 用量、成本、工具调用。
- 跨会话互通：异步信箱，让不同窗口的 agent 互发消息。
- 展现：本地 web dashboard（paperclip 式）+ 可选轻量 TUI。
- 环境：tmux，多来源（本地 + 远程 SSH）。
- **MVP = 可观测性**（发现 + 解析 + 监控 + dashboard）。

## 2. 架构（混合：Rust 核心 + Web 前端）

```
   数据源 3 路                      ccbridge daemon (Rust / tokio)
 ┌──────────────┐        ┌───────────────────────────────────────────┐
 │ JSONL 解析    │──────▶ │  discovery   (本地 + SSH 多来源扫描)         │
 │ (历史+增量)   │        │  parser      (JSONL→事件/usage, 容错)        │
 ├──────────────┤        │  store       (SQLite: sessions/events/msgs) │
 │ CC hooks      │──POST▶ │  cost        (内置价格表, 5h/7d 滚动窗口)   │
 │ (实时状态)    │        │  status      (working/waiting/idle/error)   │
 ├──────────────┤        │  mailbox     (信箱/消息总线)                 │
 │ MCP server    │◀─────▶ │  mcp (rmcp)  (agent 调用: 收发信/查询)       │
 │ (agent 交互)  │        │  tmux ctrl   (select-window / send-keys)     │
 └──────────────┘        │  api (axum)  (HTTP + WS 实时推送)            │
                         └────────────────┬──────────────────────────┘
                              ┌───────────┴────────────┐
                        Web 前端 (React/Vite)     轻量 TUI (ratatui, 可选)
```

数据来源三路：① JSONL 解析（主数据，历史 + 增量监听）② CC hooks（实时状态/工具/pane 映射）③ MCP server（agent 主动交互）。

## 3. 技术栈

| 层 | 选型 |
|---|---|
| daemon | Rust + tokio + axum(HTTP/WS) + rusqlite(bundled) + notify + serde_json |
| MCP server | `rmcp`（官方 Rust SDK），stdio（Phase 5） |
| 远程 | 系统 `ssh` / `tmux -L`（Phase 4+） |
| 前端 | React + Vite + TS + TanStack Query + WS + 设计 tokens（Claude Code 配色） |
| TUI（可选） | ratatui + crossterm |
| 价格表 | 内置静态（可配置覆盖） |

## 4. 仓库结构

```
ccbridge/
  PLAN.md
  Cargo.toml              # workspace
  crates/
    core/                 # 领域模型 + JSONL 解析 + 成本 + DB
    daemon/               # axum API + discovery + watcher (+ mcp/tmux 后续)
  web/                    # React + Vite 前端 (paperclip 式 dashboard)
  hooks/                  # CC hook 脚本 (Phase 3)
```

## 5. JSONL Schema（实测 v2026-06，65MB/11410 行样本）

会话文件：`~/.claude/projects/<cwd转义>/<session-uuid>.jsonl`，每行一个 JSON 事件。
行 `type` 共 10 种：`user / assistant / system / attachment / file-history-snapshot /
last-prompt / mode / permission-mode / ai-title / queue-operation`。

公共字段：`sessionId, cwd, gitBranch, version, timestamp(ISO), uuid, parentUuid, userType, entrypoint`。

关键：
- `assistant` 行 → `message.model`（如 `claude-opus-4-8`）、`message.usage`：
  `input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens,
   service_tier, cache_creation.{ephemeral_1h,ephemeral_5m}_input_tokens,
   server_tool_use.{web_search,web_fetch}_requests`。
  `message.content[]` 含 `tool_use` 块：`{type,id,name,input,caller}`。
- `user` 行 → `message.content`（string 或 array）、`promptId`、`permissionMode`。
- `ai-title` 行 → `aiTitle`（会话标题，取最后一个）。
- `system` 行 → `subtype, hookCount, hookInfos, hookErrors, stopReason, toolUseID`。
- 解析必须容错：未知 type 跳过、缺字段降级、单行 JSON 失败不中断。

成本：按 `model` 查价格表，分别计 input / output / cache_creation / cache_read 单价。
状态推断（无 hook 时）：看末尾事件 type + 距 `timestamp` 时长
（assistant 收尾且新近=working 刚结束→idle；user 在等→waiting；`system` 含 error→error）。

## 6. 分阶段实现（MVP = Phase 0–2）

- **Phase 0** 骨架：Cargo workspace（core/daemon）、SQLite 建表、价格表、schema 验证 ✅。
- **Phase 1** 后端核心：发现 + 容错解析 + 增量监听 + usage 聚合 + 成本（5h/7d 滚动窗口）+ 状态推断 + axum HTTP/WS（会话列表/详情/usage/工具流）。
- **Phase 2** Web dashboard：项目分组的 agent 卡片看板、详情面板（token 明细 + 工具时间线 + 最近消息）、成本概览 + 日历热力图、移动端响应式。
- **Phase 3** hook 集成：hook 脚本 POST daemon + 自动配置器（备份 settings.json → 注入 hooks/MCP → 一键卸载）→ 精确实时状态 + session↔pane 映射。
- **Phase 4** 会话控制：`claude --resume` 起新 tmux window/pane + `tmux select-window/pane` 跳转 + 标签/分组/过滤。
- **Phase 5** 异步信箱 + MCP：`inbox_read/send_to_session/reply/shared_note_*/search_other_sessions`；投递组合（默认拉取 + urgent 经 hook/send-keys）；前端消息总线。
- **Phase 6** 轻量 TUI（ratatui，复用 API）。
- **Phase 7** 打包（daemon 单二进制 + 内嵌前端）+ 文档 + 测试。

## 6.5 产品方向升级（2026-06 用户补充）

目标从「观测台」升级为 **单一可交互控制台 / 平台，管理所有 CC 会话**：

1. **信息架构改造**：主看板只展示 *active* 会话（working/waiting）；*inactive*（idle）与 *history*（归档 / 久未活动）收入可切换 tab。卡片支持**拖拽**在 active / inactive / history 间归类，分类持久化。
2. **实时动作流（CC 风格 / 像素风）**：active 卡片实时显示 agent 当前动作 —— 工具调用流 + 输出流，采用 CC 终端 / 像素风视觉（等宽、扫描线 / 像素质感、打字机滚动）。
3. **前端直接交互**：在 dashboard 内直接向会话发送输入 / 消息（注入机制见「待决策」）。
4. **TUI 一等交付**：cldctrl 式可在终端直接交互的版本（ratatui），与 web 并列，不再是「可选」。

修订执行顺序：
- **Phase 3**（底座，不变）hook 集成：实时状态 + 实时动作流事件 + session↔tmux pane 映射 + 自动配置器。
- **Phase 4** dashboard 信息架构改造：active-only 主看板 + inactive/history tab + 拖拽归类 + 持久化。
- **Phase 5** 像素风实时动作流视图（消费 Phase 3 的实时事件）。
- **Phase 6** 前端直接交互 + 异步信箱 + MCP（注入机制按决策）。
- **Phase 7** TUI（ratatui，cldctrl 式终端交互）。
- **Phase 8** 打包 + 文档 + 测试。

**待决策**：前端「直接交互」的注入机制（见下）。这是硬约束 —— 本机 Windows 原生无 tmux，向运行中的 CC 会话注入输入只能靠 tmux send-keys（WSL/远程）、PTY 托管、或异步信箱注入三选一。

## 7. 设计风格（参考 Claude Code 配色）

- **隐喻**：指挥中心 / 任务管理器。agent = 状态卡，按项目编组。
- **配色（Claude Code / Anthropic 暖色系）**：暖珊瑚橙强调色（`~#d97757`）；
  暖灰 / 米白中性（浅）与暖黑（深）底；语义色：working=珊瑚橙+脉冲、
  waiting=蓝、idle=暖灰绿、error=红。
- **布局**：bento 网格，非均匀节奏，活跃卡片放大、idle 收缩。
- **排版**：sans 标题 + mono 数据（token/成本）；`clamp()` 流式字号。
- **动效**：仅 `transform/opacity`；working 卡片缓慢脉冲、新消息滑入、数字滚动。

## 8. 环境实况与影响

- 本机：Windows 11，node v25 / npm / git 齐全；**Rust 由本仓初始化时经 winget 安装**（MSVC 链已具备：VS 18 Community）。
- **tmux**：Windows 原生未安装 → tmux 相关能力（跳转 / send-keys）在 WSL2 或远程 Linux 生效；
  Windows 原生侧降级为 dashboard 内标注 + resume 命令复制。Phase 4 处理。

## 9. 风险

| 级别 | 风险 | 缓解 |
|---|---|---|
| HIGH | JSONL schema 随版本变 | 容错解析 + 版本探测 |
| HIGH | SSH 多环境发现/控制复杂 | source 适配器；MVP 仅 local |
| HIGH | send-keys 误注入/打断 | 仅 urgent + pane 校验 + 可关闭 |
| MED | session↔pane 依赖 hook | 无 hook 则降级 |
| MED | 自动改 settings.json 安全 | 备份/幂等/一键卸载 |
| MED | Rust+Web 双语言 / 价格表维护 | monorepo + 价格表可配置 |
