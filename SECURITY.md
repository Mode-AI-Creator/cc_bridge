# 安全说明 / Security

## 威胁模型（Threat Model）

ccbridge 是一个**本地单用户**工具。设计前提：

- **仅绑定 `127.0.0.1`**（默认 `127.0.0.1:7878`）。**切勿**把 `CCBRIDGE_ADDR` 或 `config.toml` 的 `server.addr` 改成 `0.0.0.0` 或公网地址——daemon 无鉴权，暴露即等于把本机文件系统浏览、进程启动、终端注入能力开放给网络。
- **零遥测 / 全本地（Zero telemetry / fully local）**：不上报任何数据，不连任何云。所有会话数据来自本机 `~/.claude/projects/**`，所有状态存本机 SQLite（`~/.claude/ccbridge/ccbridge.db`）。

## 强能力接口（本地信任边界内）

以下 API 在本地信任模型下是有意为之的能力，**因此更不能暴露到网络**：

| 接口 | 能力 | 约束 |
|---|---|---|
| `POST /api/spawn` | 启动 `claude` 进程（PTY 托管） | 仅本机；程序路径来自 config |
| `GET /api/fs/list`、`POST /api/fs/mkdir` | 浏览/创建目录 | 仅本机；用于新建会话选目录 |
| `POST /api/pty/:id`（WS） | 向托管终端写输入 | 仅本机 |
| `POST /api/themes/:name/asset/:state` | 上传美术资产 | 格式白名单 + ≤512KiB + 主题名防路径穿越 |
| `POST /api/inbox/send` | 跨会话消息（urgent 可注入终端） | 仅本机 |

## 自动配置器

`ccbridge install-hooks` 会修改 `~/.claude/settings.json`：

- 写入前**时间戳备份**（`settings.json.bak.<ts>`）。
- **幂等**：重复安装不叠加。
- **可逆**：`uninstall-hooks` 精确移除注入的 hooks 与 `mcpServers.ccbridge`，不触碰你自有的配置。

## 第三方美术资产

内置 `builtin` 皮肤为程序化 canvas 绘制。仓库**不分发**任何第三方吉祥物美术（如官方 Clawd、社区表情）——它们版权归各自所有者，仅供你在本机个人使用时自行放入 `~/.claude/ccbridge/themes/`。

## 报告漏洞

请通过 GitHub Issue（不含敏感细节）或私下联系维护者报告。由于是本地工具，最常见的风险是**误将服务暴露到网络**——请务必保持默认的本机绑定。
