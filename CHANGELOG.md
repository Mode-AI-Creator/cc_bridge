# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/) 与语义化版本。

## [Unreleased]

### Added
- **Phase 6 跨会话通信**：SQLite 持久化的异步信箱 + 共享笔记；MCP stdio server（`ccbridge mcp`）暴露 `inbox_read / send_to_session / shared_note_write / shared_note_read / search_other_sessions / list_sessions`；前端消息总线（收发 + 未读徽标）。
- **Phase 3 hook 集成**：精确实时状态 + 实时动作流；自动配置器 `install-hooks` / `uninstall-hooks`（备份、幂等、可逆，含 MCP 注册）。
- **Phase 4/5 UI**：active/inactive/history 三态看板 + 拖拽归类；Coding Pet 像素吉祥物（眼睛跟随光标）+ 可换肤主题（用户上传 PNG/APNG/GIF/WebP/SVG，≤512KiB）。
- **PTY 托管**：任意会话 `--resume` 进内嵌终端；托管会话重连（刷新/收起后从「运行中」重开）。
- **工程化（1.0 P0）**：统一 config（`config.toml` + env）、统一 error envelope、SQLite 持久层、前端错误边界 + 断线横幅；GitHub Actions CI（Rust 跨平台 matrix / Web / cargo audit）+ Playwright E2E；`embed-frontend` 特性产出自包含单二进制。

### Security
- 仅绑定 `127.0.0.1`；零遥测、全本地。详见 [SECURITY.md](./SECURITY.md)。

## [0.1.0] — MVP
- 会话发现 + 容错 JSONL 解析 + 成本（5h/7d 滚动窗口）+ 时间启发式状态；项目分组看板 + 详情 + 热力图；文件监听 + WebSocket 实时。
