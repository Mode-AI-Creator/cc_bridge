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
| PTY 托管（前端直接交互）+ 多会话不打断 + 重连 + 复制粘贴 + 托管重连 | ✅ |
| Phase 3 hook 集成（精确状态 + 动作流 + 自动配置器 install/uninstall） | ✅ |
| Phase 4 三态看板（active/inactive/history + 拖拽归类 + 持久化 + 跨会话搜索） | ✅ |
| Phase 5 像素吉祥物 Coding Pet（眼睛跟随）+ 可换肤主题（用户上传） | ✅ |
| Phase 6 跨会话通信：SQLite 信箱 + 共享笔记 + MCP server + 前端消息总线 | ✅ |
| 1.0 后端 P0：统一 config / 统一 error envelope / SQLite 持久层 | ✅ |
| 1.0 前端 P0：错误边界 / 断线横幅 / 连通性追踪 | ✅ |
| 1.0 质量 P0：CI（Rust 跨平台 matrix + Web + audit + deny + 覆盖率）+ Playwright E2E | ✅ CI 全绿 |
| 1.0 发布 P0：embed-frontend 单二进制 + release workflow + 文档全套 | ✅ |
| 1.0 P1 前端：中英 i18n + 语言切换、a11y（reduced-motion + ARIA）、bundle 拆分（xterm 懒加载）、状态管理抽 hook | ✅ |
| 1.0 P1 后端：价格表可配置 + 版本 + 未知模型告警、优雅关闭、panic hook | ✅ |
| Phase 7 TUI（ratatui）/ 远程 SSH / 更全面 i18n 覆盖 | ⬜（1.0 后） |

每个阶段落地时在关键节点补 **冒烟测试 + 用例测试**：现共 **67** 个测试（43 Rust + 24 前端）全绿；GitHub Actions 跨平台 CI（Linux/macOS/Windows）全绿。

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

### Phase 6 — 异步信箱 + MCP（跨会话通信）· 实施拆解

**一句话**：让不同 CC 会话的 agent 互相发消息、共享笔记。直接交互已由 PTY 解决，本阶段专注 agent 间异步协作。

**接入点（已确认）**：`AppState{store,tx,sup}`；`sup.write_input(&[u8])` 可做 urgent 注入；`tx` WS 广播作消息总线；store 内存，mailbox 同构。

**数据模型（core，纯逻辑可测）**
```
Message    { id, from, to, body, created_at, read_at: Option<i64> }
SharedNote { key, body, author, updated_at }
Mailbox    { inboxes: Map<session_id, Vec<Message>>, notes: Map<key, SharedNote> }
```
纯函数 `send / unread / mark_read / note_upsert / note_get` 全部单测。

**关键前提（决定整套设计）**：MCP server 跑在某 CC 会话内，如何知道"我是哪个会话"？CC 是否经环境变量/初始化上下文传 `session_id`？能拿到→用真实 id；拿不到→**别名机制兜底**（`register(alias)`）。连同 rmcp 最新 stdio API，均在 **Step 0 先确认**。

**分步（每步 build + test + commit）**
- **S0 研究**：context7 核对 rmcp stdio API；确认 CC 传 `session_id` 机制；定形态＝`ccbridge mcp` 子命令(stdio)，内部 HTTP 回连 daemon → MCP 是薄客户端，真相在 daemon。
- **S1 mailbox+REST（最小可测闭环）**：core 模型+纯逻辑+单测；daemon `Mailbox`(Arc<RwLock>) 挂进 AppState；API `POST /api/inbox/send`、`GET /api/inbox/:session?unread=1`、`POST /api/inbox/:session/read/:msgId`、`POST/GET /api/notes`、`GET /api/sessions/search?q=`；WS 广播 `{type:"inbox"}`；测试 mailbox 单测 + HTTP 冒烟。
- **S2 投递**：默认拉取；`urgent:true` 且 to 为活着的托管会话 → `sup.write_input` 注入一行提示（换行包裹、全局开关）；测试 urgent→write_input。
- **S3 MCP server**：`ccbridge mcp`(rmcp stdio) 暴露 `inbox_read/send_to_session/reply/shared_note_write/shared_note_read/search_other_sessions/list_sessions`，每工具＝HTTP 调 daemon；配置器可选写入 settings.json `mcpServers`；测试工具契约 + 端到端。
- **S4 前端消息总线**：Inbox 面板（WS 驱动跨会话消息流 + 未读徽标）；人工发消息（from＝`operator`）；卡片未读数；测试 reducer 单测 + 渲染冒烟。
- **S5 打磨+文档**：别名机制；MCP 配置/工具/投递语义文档。

**验收**：A `send_to_session(B,…)` → B `inbox_read` 读到；urgent 注入活着的托管 B；共享笔记跨会话可见；前端可见消息流 + 人工发；MCP 被 CC 正常加载；每步单测+冒烟全绿。

**风险**：① MCP 拿不到 session_id（HIGH，S0 确认+别名兜底）② rmcp API 变动（MED，context7 核对）③ urgent 注入打断 agent（MED，仅 urgent+开关+换行）④ 内存 mailbox 重启丢失（LOW，后续 SQLite）。

**里程碑**：`S0→S1(先可用)→S2→S3→S4→S5`；最小可用点在 S1 结束。

## 6.7 通往 1.0 的路线图与工程 Gap 分析（可上架开源产品）

> 愿景：Phase 6 为最后一个大**功能**版本；此后专注工程硬化与发布，打造可上架的开源产品 1.0。
> 下面以专业前/后端工程视角盘点距 1.0 的欠缺，按 **P0（1.0 阻塞）/ P1（应做）/ P2（1.0 后）** 排序。当前功能已相当完整，欠的主要是**工程化、质量门槛、发布就绪**三块。

### 后端 Gap
| 优先级 | 项 | 现状 → 目标 |
|---|---|---|
| P0 | **持久化层** | 全内存，重启全量重扫；mailbox/选择散落 localStorage+磁盘 → 引入 SQLite（会话缓存、mailbox、配置统一），带 schema 版本化 |
| P0 | **统一配置** | 端口/claude 路径/绑定地址靠散落 env → `~/.claude/ccbridge/config.toml` 统一，env 覆盖 |
| P0 | **统一错误响应** | 有的返回纯文本、有的 JSON → 统一 error envelope + 状态码规范 |
| P1 | **价格表可维护** | 内置静态会过期 → 可配置覆盖 + 版本标注 + 未知模型告警 |
| P1 | **健壮性** | 缺优雅关闭、panic 恢复、启动自检；大 JSONL 启动同步解析或偏慢 → 并行/增量解析 + 基准 |
| P1 | **安全威胁模型** | fs/list 任意读目录、spawn 命令面、上传——本地单用户可接受，但需 `SECURITY.md` 明确威胁模型 + 路径穿越审计 |
| P2 | 多来源/远程 SSH | 明确 1.0 不做，标 future |

### 前端 Gap
| 优先级 | 项 | 现状 → 目标 |
|---|---|---|
| P0 | **错误/空/加载态** | 大量 `.catch(()=>{})` 静默吞 → React error boundary + 统一失败反馈 + 骨架/空态 |
| P0 | **daemon 未连引导** | 后端没起时前端一片空 → 明确"daemon 未连接"引导 + 重连 |
| P1 | **i18n（中英）** | 全中文硬编码 → 抽 i18n（至少 en/zh），上架面向国际 |
| P1 | **a11y + reduced-motion** | 缺键盘导航/ARIA/焦点；精灵动画未尊重 `prefers-reduced-motion` → 补齐 |
| P1 | **bundle 拆分** | ~500KB 未分割，xterm 重 → code-split + 懒加载终端 |
| P1 | **状态管理** | `App.tsx` 巨型 useState 堆 → useReducer/context 或轻量 store，降耦合 |
| P2 | 响应式/移动端 | 4 列工作台窄屏降级 |
| P2 | CSS 模块化 | 单文件 1600+ 行 → 按组件拆分 |

### 质量门槛 Gap（P0，上架前必须）
- **CI**：GitHub Actions — build / test / lint(clippy+eslint) / `cargo audit` + `cargo deny`。
- **测试补全**：现有 ~38 单测 → 加 daemon 集成测试、前端组件/交互测试、关键流程 **Playwright E2E**、覆盖率门槛。
- **跨平台验证**：mac / Linux 实测 PTY、fs、claude 定位（目前仅 Windows 验证）。

### 发布就绪 Gap（P0，上架前必须）
- **打包分发**（原 Phase 8）：单二进制内嵌前端 + 跨平台 release + 安装脚本 + 包管理器（brew/scoop/`cargo install`）。
- **文档全套**：`docs/`（安装/配置/hook/MCP/故障排查）、截图/GIF 演示、`CONTRIBUTING.md`、`SECURITY.md`、`CODE_OF_CONDUCT.md`、`CHANGELOG.md`。
- **onboarding**：首次启动零配置体验 + 引导。
- **合规**：`cargo deny` 许可审计；第三方美术（Clawd/月薪喵）不入库（已处理）；README 明确"零遥测/全本地"作为卖点。
- **版本化**：语义版本 + CHANGELOG + release notes。

### 建议的 1.0 里程碑编排
- **M-A 功能收尾**：Phase 6（mailbox + MCP）。
- **M-B 工程硬化**：后端 P0（SQLite/config/error envelope）+ 前端 P0（错误边界/未连引导）+ P1 择要（i18n/a11y/bundle）。
- **M-C 质量门槛**：CI + 测试补全 + 跨平台验证（全 P0）。
- **M-D 发布**：打包 + 文档全套 + onboarding + 合规（全 P0）→ **发布 1.0**。
- **M-E 1.0 后**：TUI(ratatui)、远程/SSH、响应式、CSS 模块化等 P2。

> 取舍原则：1.0 = **功能完整 + 工程可信 + 开箱即用**，不追求功能再扩张。TUI 从原"一等交付"调整为 **1.0 后**（M-E），因为对"可上架"而言，稳定性/文档/打包比再加一个前端更关键。

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
