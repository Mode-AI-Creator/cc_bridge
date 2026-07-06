# official — 官方 Clawd 资产占位

此目录预留给 **Anthropic 官方 Clawd 吉祥物** 的像素美术资产。

> ⚠️ Clawd 版权归 Anthropic 所有，本仓库**不分发**官方美术资产。
> 若你在本机 Claude Code 安装中拥有官方 Clawd 资源，可按下述规范放入
> `~/.claude/ccbridge/themes/official/` 供个人使用；ccbridge 会自动识别。

## 资产命名（每状态一张）

| 文件名 | 会话状态 | 建议动作 |
|---|---|---|
| `idle.<ext>`    | 空闲   | 打盹 / 眼睛跟随光标 |
| `working.<ext>` | 工作中 | 打字 / 走动 |
| `waiting.<ext>` | 等待输入 | 张望 / 眨眼 |
| `error.<ext>`   | 出错   | 抖动 / 惊讶 |
| `unknown.<ext>` | 未知   | 呼吸 / 待机 |

## 上传规范

- **格式**：PNG、APNG、GIF、WebP、SVG（推荐 APNG/GIF 做逐帧动画）
- **尺寸**：建议 128×128 正方形，像素风（前端以 `image-rendering: pixelated` 渲染）
- **单文件**：≤ 512 KiB
- 缺失的状态会自动回退到内置程序化 `builtin` 皮肤

## 放置方式

1. 在 dashboard 的 Clawd 展示位点「换肤 → 新建主题」，或
2. 直接把文件拷进 `~/.claude/ccbridge/themes/<主题名>/`，刷新即可。

内置 `builtin` 皮肤为 canvas 绘制的像素 Clawd，永远可用、无需任何资产。
