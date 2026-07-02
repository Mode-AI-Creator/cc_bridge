# ccbridge

> A local command center for all your concurrent Claude Code sessions — discover them, watch them, and talk to them, from one dashboard.

---

## Why cc_bridge

如果你像我一样，同时开着五六个 Claude Code 会话——一个跑重构、一个查 bug、一个写文档——那你大概也受够了在一堆终端窗口之间来回 `Alt+Tab`，猜哪个还在跑、哪个在等你、这个月又烧了多少 token。

CC 会话本身是有账本的：每个会话都是 `~/.claude/projects/**/*.jsonl` 里一份逐行追加的事件流，里面有模型、用量、工具调用、消息、标题，一应俱全。既然数据都在，那就没理由还靠肉眼管理。

ccbridge 干两件事：

1. **看**——把本机所有 CC 会话扫出来，实时算状态 / token / 成本 / 工具流，铺成一个看板。
2. **动**——不是只读的监控台。你可以直接在 dashboard 里把任意会话 `--resume` 拉起来，在内嵌的真实终端里继续对话，多个会话并存、互不打断。

设计上刻意选了「一个常驻进程 + 一个网页」的形态：本地单用户、只绑 `127.0.0.1`、零配置起步，不引数据库、不碰云。

## 设计理念

- **数据源是唯一事实**。会话状态不臆造——直接解析 JSONL。解析器全程容错：未知事件类型跳过、缺字段降级、单行坏 JSON 不中断整份文件。CC 升级改 schema 也不会把整个面板搞崩。
- **观测与交互分离，但同处一屏**。左边是只读的账本（发现 / 统计 / 详情），右边是可写的终端（PTY 托管）。两者共享同一套会话身份。
- **托管而非劫持**。要在运行中的会话里「继续对话」，本机 Windows 原生没有 tmux，于是走 **PTY 托管**：daemon 在伪终端里 spawn `claude --resume <id>`，把输出通过 WebSocket 广播给前端 xterm，把你的按键写回 PTY。切换会话只是切前端可见的终端层，后台进程照跑不停。
- **暖色、克制、有层次**。配色抄 Claude Code 自己的暖珊瑚橙（`#d97757`）+ 暖黑底；语义色区分 working / waiting / idle / error；面板可拖拽调宽、任务栏可收放，避免默认模板那种一眼假的 UI。

## 架构

```
        ~/.claude/projects/**/*.jsonl
                 |  (full history + notify incremental)
                 v
+-----------------------------------------------+        +-------------------------------+
| ccbridge daemon  (Rust / tokio / axum)        |        | Web frontend (React / Vite)   |
|                                               |        |                               |
| discovery   scan session files                |        | SessionList    session board  |
| parser      tolerant JSONL -> usage           |  HTTP  | TaskBar        project tree   |
| store       in-mem aggregate + stats          |   +    | ChatPane       terminal tabs  |
| cost        built-in price table              |  <-->  | TerminalView   xterm + WS     |
| watcher     notify -> WS broadcast            |   WS   | DetailPane     tokens / tools |
| supervisor  PTY hosting (portable-pty)        |        | StatsBar       global stats   |
| api         /api/* + /ws + /api/pty/:id       |        | NewSessionModal  dir picker   |
+-----------------------------------------------+        +-------------------------------+
```

**Rust workspace**

- `crates/core` — 领域模型、JSONL 解析、成本计算、会话发现（纯逻辑，无 IO 框架依赖）
- `crates/daemon` — axum HTTP/WS API、内存 store、`notify` 文件监听、`portable-pty` 会话托管、文件系统浏览

**Web**

- React 18 + Vite + TypeScript，`@xterm/xterm` 渲染真实终端，无重型状态库——服务端状态靠轮询 + WS，客户端状态用 hooks

**语言与关键依赖**

| 层 | 选型 |
|---|---|
| daemon | Rust (2021) · tokio · axum (HTTP/WS) · notify · portable-pty · serde/serde_json · chrono |
| 前端 | React + Vite + TypeScript · @xterm/xterm + addon-fit |
| 成本 | 内置静态价格表（opus / sonnet / haiku，含 cache 单价） |

## 现在能干什么

- **自动发现**本机所有 CC 会话，按项目分组
- **实时监控**：每会话状态、token 明细、成本、工具调用时间线、最近消息
- **全局统计**：近 5h / 近 7d / 累计成本、状态分布、tokens
- **实时更新**：`notify` 文件监听 + WebSocket 推送 + 5s 兜底刷新
- **交互式续聊**：一键 `--resume` 任意会话到内嵌真实终端；多会话并存、切换不打断后台进程
- **可选 `--dangerously-skip-permissions`**：新建 / 续聊时一键开关跳过权限确认
- **工作台交互**：中间看板默认只显示激活会话，其余从左侧项目树拖入 / 拖出；行内重命名；面板拖拽调宽；任务栏可收放
- **新建会话目录选择器**：居中弹窗浏览文件系统、选目录、就地新建文件夹

## 快速开始

### 前置

- Rust（stable，Windows 用 `stable-msvc`）
- Node 18+

### 1 · 构建前端

```bash
cd web
npm install
npm run build      # 产出 web/dist，daemon 会内置托管
```

### 2 · 启动 daemon（在仓库根目录）

```bash
cargo run -p ccbridge-daemon
# → http://127.0.0.1:7878   （API + WS + 前端，一个进程全包）
```

打开浏览器访问 **http://127.0.0.1:7878** 即可。

> 改监听地址：`CCBRIDGE_ADDR=127.0.0.1:9000 cargo run -p ccbridge-daemon`
> 指定 claude 可执行文件：`CCBRIDGE_CLAUDE=/path/to/claude cargo run -p ccbridge-daemon`

### 前端热更新模式（可选，开发用）

```bash
cd web && npm run dev      # http://127.0.0.1:5173，自动把 /api、/ws、/api/pty 代理到 daemon
```

> Windows 提示：若 `cargo` 不在 PATH，用完整路径 `& "$env:USERPROFILE\.cargo\bin\cargo.exe" run -p ccbridge-daemon`，或把 `~/.cargo/bin` 加入 PATH。

## 路线图

MVP（可观测性）+ PTY 托管交互已完成。后续见 [PLAN.md](./PLAN.md)：

- **Phase 3** CC hook 集成：精确实时状态 + session↔pane 映射 + 自动配置器
- **Phase 4** dashboard 信息架构：active/inactive/history 分类 + 持久化
- **Phase 5** 像素风实时动作流视图
- **Phase 6** 异步信箱 + MCP server：让不同窗口的 agent 互相通信
- **Phase 7** 轻量 TUI（ratatui，cldctrl 式终端交互）
- **Phase 8** 打包（单二进制内嵌前端）

## 已知局限

- 无 hook 时，状态（working/waiting/idle）按活动时间启发式推断；精确状态待 Phase 3。
- 数据为内存聚合，daemon 重启后全量重扫；SQLite 持久化为后续项。
- 仅本地会话；tmux / 远程 SSH 能力见 PLAN.md Phase 4。
- 文件系统浏览接口仅供本地单用户使用，daemon 只绑 `127.0.0.1`——不要暴露到公网。

## License

[MIT](./LICENSE) © 2026 Mode-AI-Creator
