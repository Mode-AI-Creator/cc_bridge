# 贡献指南 / Contributing

感谢参与 ccbridge！

## 开发环境

- **Rust**（stable，Windows 用 `stable-msvc`）
- **Node** 18+

## 本地开发

```bash
# 前端（热更新，代理 /api、/ws、/api/pty 到 daemon）
cd web && npm install && npm run dev      # http://127.0.0.1:5173

# daemon（另开一个终端，仓库根目录）
cargo run -p ccbridge-daemon              # http://127.0.0.1:7878
```

dev 模式下 daemon 从磁盘 `web/dist` 提供前端（或走 vite dev 代理）。

## 提交前自检（与 CI 一致）

```bash
cargo fmt --all -- --check      # 格式
cargo clippy --workspace        # 静态检查
cargo test --workspace          # Rust 测试

cd web
npm run build                   # 类型检查 + 打包
npm test                        # 前端单测（vitest）
npm run e2e                     # E2E（首次需 npx playwright install）
```

## 约定

- **提交信息**：`<type>: <desc>`（feat/fix/refactor/docs/test/chore/ci）。
- **测试**：新逻辑配单测；跨层改动加冒烟/集成测试。纯逻辑与 IO 分离便于测试。
- **格式**：Rust 走 `cargo fmt`；TS 走项目现有风格。
- **不可变优先**、小文件高内聚、错误显式处理。

## 架构速览

- `crates/core` — 领域模型、JSONL 解析、成本、发现（纯逻辑）。
- `crates/daemon` — axum HTTP/WS、内存 store、SQLite 信箱、PTY 托管、hook/MCP 配置、换肤。
- `web` — React + Vite 前端。

详见 [PLAN.md](./PLAN.md) 与 [docs/USAGE.md](./docs/USAGE.md)。
