//! 会话文件发现：扫描 `~/.claude/projects/**/*.jsonl`。
use std::path::{Path, PathBuf};

/// 返回 `~/.claude` 目录（若可定位 home）。
pub fn claude_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude"))
}

/// 返回 `~/.claude/projects` 目录（若可定位 home）。
pub fn claude_projects_dir() -> Option<PathBuf> {
    claude_dir().map(|c| c.join("projects"))
}

/// 递归查找根目录下所有 `.jsonl` 文件。容错：忽略无法读取的目录。
pub fn find_session_files(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    walk(root, &mut out);
    out
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk(&path, out);
        } else if path.extension().map(|e| e == "jsonl").unwrap_or(false) {
            out.push(path);
        }
    }
}
