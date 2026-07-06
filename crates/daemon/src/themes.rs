//! 吉祥物换肤主题（Phase 5+）。
//!
//! 每个主题是 `~/.claude/ccbridge/themes/<name>/` 下的一组按状态命名的资产：
//! `idle.<ext>` / `working.<ext>` / `waiting.<ext>` / `error.<ext>` / `unknown.<ext>`。
//! 内置 `builtin` 皮肤为前端程序化 canvas Clawd，不落盘；`official` 为官方资产占位。
//!
//! 上传约束（见 [`validate_upload`]）：格式白名单 + 单文件 ≤512KiB，主题名防路径穿越。
//! 纯校验函数与 IO 分离，便于单测。

use anyhow::{bail, Context, Result};
use ccbridge_core::discovery;
use serde::Serialize;
use std::path::PathBuf;

/// 单个资产上限（512 KiB）。
pub const MAX_ASSET_BYTES: usize = 512 * 1024;
/// 支持的状态（与前端一致）。
pub const STATES: [&str; 5] = ["idle", "working", "waiting", "error", "unknown"];
/// 允许的像素美术扩展名（apng 用 .png；gif/webp 支持逐帧动画；svg 矢量）。
pub const ALLOWED_EXT: [&str; 5] = ["png", "gif", "webp", "svg", "apng"];

#[derive(Debug, Serialize)]
pub struct ThemeInfo {
    pub name: String,
    /// 状态 → 资产文件名（如 `idle.png`）。缺失的状态回退 builtin。
    pub assets: std::collections::BTreeMap<String, String>,
}

/// 校验上传参数，返回规范化扩展名（小写，apng→png）。
pub fn validate_upload(state: &str, filename: &str, byte_len: usize) -> Result<String> {
    if !STATES.contains(&state) {
        bail!("未知状态: {state}（应为 {STATES:?}）");
    }
    if byte_len == 0 {
        bail!("空文件");
    }
    if byte_len > MAX_ASSET_BYTES {
        bail!("文件过大: {byte_len} 字节 > 上限 {MAX_ASSET_BYTES}");
    }
    let ext = filename
        .rsplit('.')
        .next()
        .map(|e| e.to_ascii_lowercase())
        .filter(|e| e != filename) // 必须有扩展名
        .context("缺少扩展名")?;
    if !ALLOWED_EXT.contains(&ext.as_str()) {
        bail!("不支持的格式: .{ext}（允许 {ALLOWED_EXT:?}）");
    }
    Ok(if ext == "apng" {
        "png".to_string()
    } else {
        ext
    })
}

/// 校验主题名：仅允许 `[a-zA-Z0-9_-]`，非空、≤48 字符，防路径穿越。
pub fn validate_theme_name(name: &str) -> Result<()> {
    if name.is_empty() || name.len() > 48 {
        bail!("主题名长度需在 1..=48");
    }
    if name == "builtin" {
        bail!("builtin 为内置皮肤，不能覆盖");
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        bail!("主题名仅允许字母/数字/下划线/连字符");
    }
    Ok(())
}

/// content-type（用于 GET 资产响应）。
pub fn content_type(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

fn themes_root() -> Result<PathBuf> {
    Ok(discovery::claude_dir()
        .context("无法定位 ~/.claude")?
        .join("ccbridge")
        .join("themes"))
}

/// 列出所有磁盘主题（不含 builtin，前端自行加）。
pub fn list_themes() -> Vec<ThemeInfo> {
    let Ok(root) = themes_root() else {
        return vec![];
    };
    let Ok(rd) = std::fs::read_dir(&root) else {
        return vec![];
    };
    let mut out = Vec::new();
    for e in rd.flatten() {
        if !e.path().is_dir() {
            continue;
        }
        let name = e.file_name().to_string_lossy().to_string();
        let mut assets = std::collections::BTreeMap::new();
        if let Ok(files) = std::fs::read_dir(e.path()) {
            for f in files.flatten() {
                let fname = f.file_name().to_string_lossy().to_string();
                if let Some((stem, ext)) = fname.rsplit_once('.') {
                    if STATES.contains(&stem) && ALLOWED_EXT.contains(&ext) {
                        assets.insert(stem.to_string(), fname.clone());
                    }
                }
            }
        }
        out.push(ThemeInfo { name, assets });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// 读取某主题某状态的资产字节 + content-type。
pub fn read_asset(name: &str, state: &str) -> Option<(Vec<u8>, &'static str)> {
    validate_theme_name(name)
        .ok()
        .or(if name == "official" { Some(()) } else { None })?;
    if !STATES.contains(&state) {
        return None;
    }
    let dir = themes_root().ok()?.join(name);
    for ext in ALLOWED_EXT {
        let real = if ext == "apng" { "png" } else { ext };
        let p = dir.join(format!("{state}.{real}"));
        if p.exists() {
            let bytes = std::fs::read(&p).ok()?;
            return Some((bytes, content_type(real)));
        }
    }
    None
}

/// 写入（覆盖）某主题某状态资产，返回落地文件名。
pub fn write_asset(name: &str, state: &str, filename: &str, data: &[u8]) -> Result<String> {
    validate_theme_name(name)?;
    let ext = validate_upload(state, filename, data.len())?;
    let dir = themes_root()?.join(name);
    std::fs::create_dir_all(&dir).with_context(|| format!("建目录失败: {}", dir.display()))?;
    // 先删除同状态的其它扩展名资产，避免歧义
    for e in ALLOWED_EXT {
        let real = if e == "apng" { "png" } else { e };
        let _ = std::fs::remove_file(dir.join(format!("{state}.{real}")));
    }
    let fname = format!("{state}.{ext}");
    std::fs::write(dir.join(&fname), data).with_context(|| format!("写入失败: {fname}"))?;
    Ok(fname)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_upload_accepts_allowed() {
        assert_eq!(validate_upload("idle", "x.png", 1000).unwrap(), "png");
        assert_eq!(validate_upload("working", "a.GIF", 1000).unwrap(), "gif");
        assert_eq!(validate_upload("error", "a.apng", 1000).unwrap(), "png");
        assert_eq!(validate_upload("waiting", "a.svg", 10).unwrap(), "svg");
    }

    #[test]
    fn validate_upload_rejects_bad() {
        assert!(validate_upload("nope", "x.png", 10).is_err()); // 状态非法
        assert!(validate_upload("idle", "x.bmp", 10).is_err()); // 格式非法
        assert!(validate_upload("idle", "noext", 10).is_err()); // 无扩展名
        assert!(validate_upload("idle", "x.png", 0).is_err()); // 空
        assert!(validate_upload("idle", "x.png", MAX_ASSET_BYTES + 1).is_err());
        // 超大
    }

    #[test]
    fn theme_name_guards_traversal() {
        assert!(validate_theme_name("my-skin_1").is_ok());
        assert!(validate_theme_name("").is_err());
        assert!(validate_theme_name("builtin").is_err());
        assert!(validate_theme_name("../etc").is_err());
        assert!(validate_theme_name("a/b").is_err());
        assert!(validate_theme_name("空格 ").is_err());
    }
}
