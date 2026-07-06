//! 自动配置器（Phase 3）：把 ccbridge 的 hook 注入 `~/.claude/settings.json`。
//!
//! 设计要点：
//! - **幂等**：重复 install 不会重复注入（先剥离旧的 ccbridge 条目再写入）。
//! - **可逆**：uninstall 精确移除带标记的条目，空数组/空对象一并清理，还原到原始形态。
//! - **安全**：写入前对 settings.json 做时间戳备份；绝不触碰用户自有 hook。
//! - 纯逻辑（`apply_install` / `apply_uninstall`）与 IO 分离，便于单测。

use anyhow::{Context, Result};
use ccbridge_core::{discovery, HookKind};
use serde_json::{json, Value};
use std::path::PathBuf;

/// 注入命令的识别标记（出现在 command 字符串中即视为 ccbridge 条目）。
const MARKER: &str = "ccbridge-hook.mjs";

/// hook 脚本内容（编译期内嵌，install 时落地到 ~/.claude/ccbridge/）。
const HOOK_SCRIPT: &str = include_str!("../../../hooks/ccbridge-hook.mjs");

/// 构造某事件的注入命令：`node "<script>" <Event>`。
fn command_for(script_path: &str, kind: HookKind) -> String {
    format!("node \"{}\" {}", script_path, kind.event_name())
}

/// 判断一个 hook group 是否为 ccbridge 注入的。
fn is_ccbridge_group(group: &Value) -> bool {
    group
        .get("hooks")
        .and_then(|h| h.as_array())
        .map(|arr| {
            arr.iter().any(|cmd| {
                cmd.get("command")
                    .and_then(|c| c.as_str())
                    .map(|s| s.contains(MARKER))
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

/// 纯函数：在 settings 中注入 ccbridge hook（先移除旧的，保证幂等）。
pub fn apply_install(mut settings: Value, script_path: &str) -> Value {
    // 先卸载已有 ccbridge 条目
    settings = apply_uninstall(settings);

    if !settings.is_object() {
        settings = json!({});
    }
    let obj = settings.as_object_mut().unwrap();
    let hooks = obj
        .entry("hooks")
        .or_insert_with(|| json!({}));
    if !hooks.is_object() {
        *hooks = json!({});
    }
    let hooks = hooks.as_object_mut().unwrap();

    for kind in HookKind::ALL {
        let group = json!({
            "hooks": [ { "type": "command", "command": command_for(script_path, kind) } ]
        });
        let arr = hooks
            .entry(kind.event_name().to_string())
            .or_insert_with(|| json!([]));
        if let Some(a) = arr.as_array_mut() {
            a.push(group);
        } else {
            *arr = json!([group]);
        }
    }
    settings
}

/// 纯函数：移除所有 ccbridge 注入的 hook group；清理空数组/空 hooks 对象。
pub fn apply_uninstall(mut settings: Value) -> Value {
    let Some(obj) = settings.as_object_mut() else {
        return settings;
    };
    let Some(hooks) = obj.get_mut("hooks").and_then(|h| h.as_object_mut()) else {
        return settings;
    };

    let mut empty_keys = Vec::new();
    for (event, groups) in hooks.iter_mut() {
        if let Some(arr) = groups.as_array_mut() {
            arr.retain(|g| !is_ccbridge_group(g));
            if arr.is_empty() {
                empty_keys.push(event.clone());
            }
        }
    }
    for k in empty_keys {
        hooks.remove(&k);
    }
    let hooks_empty = hooks.is_empty();
    if hooks_empty {
        obj.remove("hooks");
    }
    settings
}

fn settings_path() -> Result<PathBuf> {
    Ok(discovery::claude_dir()
        .context("无法定位 ~/.claude 目录")?
        .join("settings.json"))
}

fn script_dest() -> Result<PathBuf> {
    Ok(discovery::claude_dir()
        .context("无法定位 ~/.claude 目录")?
        .join("ccbridge")
        .join("ccbridge-hook.mjs"))
}

fn read_settings(path: &PathBuf) -> Result<Value> {
    if !path.exists() {
        return Ok(json!({}));
    }
    let text = std::fs::read_to_string(path)
        .with_context(|| format!("读取失败: {}", path.display()))?;
    if text.trim().is_empty() {
        return Ok(json!({}));
    }
    serde_json::from_str(&text).with_context(|| format!("settings.json 非法 JSON: {}", path.display()))
}

fn backup(path: &PathBuf) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }
    let ts = chrono::Utc::now().timestamp();
    let bak = path.with_extension(format!("json.bak.{ts}"));
    std::fs::copy(path, &bak).with_context(|| format!("备份失败: {}", bak.display()))?;
    println!("已备份 → {}", bak.display());
    Ok(())
}

fn write_settings(path: &PathBuf, v: &Value) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let text = serde_json::to_string_pretty(v)?;
    std::fs::write(path, text).with_context(|| format!("写入失败: {}", path.display()))?;
    Ok(())
}

/// 落地 hook 脚本到 ~/.claude/ccbridge/，返回绝对路径。
fn materialize_script() -> Result<String> {
    let dest = script_dest()?;
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    std::fs::write(&dest, HOOK_SCRIPT)
        .with_context(|| format!("写入 hook 脚本失败: {}", dest.display()))?;
    Ok(dest.display().to_string())
}

/// 执行 install：落地脚本 → 备份 → 注入 → 写回。
pub fn install() -> Result<()> {
    let path = settings_path()?;
    let script = materialize_script()?;
    let settings = read_settings(&path)?;
    backup(&path)?;
    let next = apply_install(settings, &script);
    write_settings(&path, &next)?;
    println!("已注入 ccbridge hooks → {}", path.display());
    println!("脚本位置: {script}");
    println!("重启（或新开）Claude Code 会话后生效。");
    Ok(())
}

/// 执行 uninstall：备份 → 移除 → 写回。
pub fn uninstall() -> Result<()> {
    let path = settings_path()?;
    if !path.exists() {
        println!("settings.json 不存在，无需卸载。");
        return Ok(());
    }
    let settings = read_settings(&path)?;
    backup(&path)?;
    let next = apply_uninstall(settings);
    write_settings(&path, &next)?;
    println!("已移除 ccbridge hooks → {}", path.display());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCRIPT: &str = "/home/u/.claude/ccbridge/ccbridge-hook.mjs";

    #[test]
    fn install_then_uninstall_restores_empty() {
        let orig = json!({});
        let installed = apply_install(orig.clone(), SCRIPT);
        // 注入了 6 个事件
        assert_eq!(installed["hooks"].as_object().unwrap().len(), 6);
        let restored = apply_uninstall(installed);
        assert_eq!(restored, orig, "卸载后应完全还原为原始（无 hooks 键）");
    }

    #[test]
    fn install_is_idempotent() {
        let once = apply_install(json!({}), SCRIPT);
        let twice = apply_install(once.clone(), SCRIPT);
        assert_eq!(once, twice, "重复 install 不应叠加条目");
        // 每个事件仅一个 group
        for (_e, groups) in twice["hooks"].as_object().unwrap() {
            assert_eq!(groups.as_array().unwrap().len(), 1);
        }
    }

    #[test]
    fn preserves_user_hooks() {
        let user = json!({
            "hooks": {
                "PreToolUse": [
                    { "hooks": [ { "type": "command", "command": "echo user-hook" } ] }
                ]
            },
            "model": "claude-opus-4-8"
        });
        let installed = apply_install(user.clone(), SCRIPT);
        // 用户的 PreToolUse hook 仍在
        let pre = installed["hooks"]["PreToolUse"].as_array().unwrap();
        assert!(pre
            .iter()
            .any(|g| g["hooks"][0]["command"] == "echo user-hook"));
        // 且注入了 ccbridge 的
        assert!(pre.iter().any(is_ccbridge_group));

        let restored = apply_uninstall(installed);
        assert_eq!(restored, user, "卸载后应保留用户 hook 与其它字段");
    }

    #[test]
    fn uninstall_noop_when_no_ccbridge() {
        let user = json!({ "hooks": { "Stop": [ { "hooks": [ { "type": "command", "command": "x" } ] } ] } });
        assert_eq!(apply_uninstall(user.clone()), user);
    }
}
