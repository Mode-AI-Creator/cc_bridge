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

## 6.6 修订版路线图与进度（2026-07 现状对齐）

> 本节是当前权威路线图。「注入机制」待决策项已定为 **PTY 托管** 并落地；据此 session↔pane 映射对 ccbridge 自己拉起的会话不再需要。

### 进度基线

| 阶段 | 状态 |
|---|---|
| Phase 0–2 MVP 可观测性（发现/解析/成本/dashboard） | ✅ |
| PTY 托管（前端直接交互，原 Phase 6 待决策项） | ✅ |
| 多会话切换不打断 · 终端自动重连+心跳 · 复制粘贴 | ✅ |
| Phase 4 部分（active-only 看板 + 拖入/拖出显示） | ✅ |
| 新建会话目录选择器（浏览 + 新建文件夹，跨平台） | ✅ |
| Phase 3 / 4剩余 / 5 / 6剩余 / 7 / 8 | ⬜ |

每个阶段落地时在关键节点补 **冒烟测试 + 用例测试** 保证鲁棒性。

### Phase 3 — Hook 集成（实时事实层）

**为什么**：现状 `SessionStatus::infer()` 全靠「距上次活动多久」猜，区分不了「等输入(waiting)」和「闲着(idle)」，长工具运行也可能被误判。CC 官方 hook 是唯一能拿到「此刻确切在干什么」的信号。

**做什么**
1. **hook 脚本**（`hooks/ccbridge-hook.mjs`，Node，跨平台）：`SessionStart/UserPromptSubmit/PreToolUse/PostToolUse/Notification/Stop` 时从 stdin 取 `session_id/tool`，`POST /api/hook`。daemon 未启动则静默失败，绝不阻塞 CC。
2. **daemon 接收端** `/api/hook`：每会话维护 hook 事实（状态 + 时间 + 当前工具）。状态判定改为「hook 优先、时间兜底」：`Pre/PostToolUse/UserPromptSubmit→working`、`Notification/Stop/SessionStart→waiting`；Working 事实 120s 内粘滞、Waiting 30min 后回落 idle。
3. **自动配置器** CLI：`ccbridge install-hooks` / `uninstall-hooks`——备份 `settings.json` → 幂等注入带标记的 hook 块 → 一键完整还原（程序化增删，可逆）。绝不动用户已有 hook。
4. **实时动作流事件**：hook 事件经现有 WS 广播（`type:"hook"`），为 Phase 5 供数据源。

**目标**：状态从「猜」变「准」；拿到实时工具流；装/卸零心智负担。

**验收标准**
- 真实会话执行任务时，工具执行瞬间 working、停下 waiting/idle，延迟 <2s，不再误判。
- `install-hooks` 后 settings.json 有备份，`uninstall-hooks` 后与原始 diff 为空；用户原有 hook 不受影响。
- 前端能实时看到「某会话正在调用 X 工具」。
- daemon 未启动时 hook 静默失败，CC 正常可用。
- **测试**：core 单测（HookKind 解析 / 状态 resolve 粘滞与回落）；配置器单测（install→uninstall 还原、二次 install 幂等）；daemon HTTP 冒烟（health/hook/stats）。

### Phase 4（剩余）— 信息架构：inactive / history 分类

**为什么**：现在只有「active + 手动拖入」两态，非激活会话只能去任务栏翻，缺清晰可持久化的三态归类。

**做什么**
1. **三态**：active（自动）、inactive（idle 近期/手动拉入）、history（长期未活动/手动归档），前端可切换 tab。
2. **拖拽归类** 结果持久化（localStorage，后续可升级 daemon 端）。
3. **搜索增强**：扩展到全部会话（当前被限制在 active∪已显示）。

**目标**：会话再多也有序，分类稳定不丢。

**验收标准**
- 三态 tab 各显示对应会话；拖到 history 后刷新仍在 history。
- 搜索能跨全部会话命中。
- 20+ 会话下清晰无卡顿。
- **测试**：归类/持久化 reducer 单测；搜索过滤单测；关键交互 E2E 冒烟。

### Phase 5 — 像素风实时动作流视图

**为什么**：Phase 3 产出实时工具流，但目前只有进终端才看得到；给 active 卡片一个「一眼看懂在干嘛」的聚合视图。

**做什么**
1. **消费** Phase 3 WS 事件，为每个 active 会话渲染动作流：当前工具（名+参数摘要）、输出滚动、耗时。
2. **视觉**：等宽、扫描线/像素质感、打字机滚动，呼应 CC 终端。
3. **性能**：节流 + 虚拟滚动，只渲染可见 active 卡片。

**目标**：不进终端就能实时感知每个 active agent 在做什么。

**验收标准**
- 会话运行时卡片实时滚动「调用 X → 输出 → 下一步」，延迟 <1s。
- 多会话活跃时帧率稳定无明显掉帧。
- 视觉与暖色系一致、有像素风质感。
- **测试**：事件归约/节流单测；渲染冒烟（挂载不崩、事件驱动更新）。

### Phase 6（剩余）异步信箱 + MCP · Phase 7 TUI(ratatui) · Phase 8 打包+文档+测试

（详见 §6.5 修订执行顺序；直接交互已由 PTY 托管解决，Phase 6 聚焦跨会话通信。）

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
