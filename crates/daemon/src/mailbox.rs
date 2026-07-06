//! 异步信箱 + 共享笔记（Phase 6 S1），SQLite 持久化（1.0 P0）。
//!
//! 跨会话通信的真相层：消息与笔记落地 `~/.claude/ccbridge/ccbridge.db`，
//! daemon 重启不丢。MCP server / REST / 前端都经此读写。
//! 纯操作对 `:memory:` 连接可测。

use anyhow::{Context, Result};
use ccbridge_core::discovery;
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

static SEQ: AtomicU64 = AtomicU64::new(0);

fn gen_id() -> String {
    let now = chrono::Utc::now().timestamp_millis();
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    format!("{now:x}-{n:x}")
}

#[derive(Debug, Clone, Serialize)]
pub struct Message {
    pub id: String,
    pub from: String,
    pub to: String,
    pub body: String,
    pub created_at: i64,
    pub read_at: Option<i64>,
    pub urgent: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Note {
    pub key: String,
    pub body: String,
    pub author: String,
    pub updated_at: i64,
}

pub struct Mailbox {
    conn: Mutex<Connection>,
}

impl Mailbox {
    /// 打开默认库 `~/.claude/ccbridge/ccbridge.db`（建目录 + 迁移）。
    pub fn open_default() -> Result<Self> {
        let path = discovery::claude_dir()
            .context("无法定位 ~/.claude")?
            .join("ccbridge")
            .join("ccbridge.db");
        if let Some(p) = path.parent() {
            std::fs::create_dir_all(p).ok();
        }
        let conn = Connection::open(&path)
            .with_context(|| format!("打开数据库失败: {}", path.display()))?;
        Self::migrate(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// 内存库（测试用）。
    pub fn open_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        Self::migrate(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    fn migrate(conn: &Connection) -> Result<()> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                from_session TEXT NOT NULL,
                to_session TEXT NOT NULL,
                body TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                read_at INTEGER,
                urgent INTEGER NOT NULL DEFAULT 0
             );
             CREATE INDEX IF NOT EXISTS idx_msg_to ON messages(to_session);
             CREATE TABLE IF NOT EXISTS notes (
                key TEXT PRIMARY KEY,
                body TEXT NOT NULL,
                author TEXT NOT NULL,
                updated_at INTEGER NOT NULL
             );",
        )?;
        Ok(())
    }

    /// 发送一条消息，返回落地记录。
    pub fn send(&self, from: &str, to: &str, body: &str, urgent: bool) -> Result<Message> {
        let msg = Message {
            id: gen_id(),
            from: from.to_string(),
            to: to.to_string(),
            body: body.to_string(),
            created_at: chrono::Utc::now().timestamp(),
            read_at: None,
            urgent,
        };
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO messages (id, from_session, to_session, body, created_at, read_at, urgent)
             VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6)",
            rusqlite::params![
                msg.id,
                msg.from,
                msg.to,
                msg.body,
                msg.created_at,
                msg.urgent as i64
            ],
        )?;
        Ok(msg)
    }

    /// 读取某会话的收件箱（可仅未读），按时间倒序。
    pub fn inbox(&self, session: &str, unread_only: bool) -> Result<Vec<Message>> {
        let conn = self.conn.lock().unwrap();
        let sql = if unread_only {
            "SELECT id, from_session, to_session, body, created_at, read_at, urgent
             FROM messages WHERE to_session = ?1 AND read_at IS NULL ORDER BY created_at DESC"
        } else {
            "SELECT id, from_session, to_session, body, created_at, read_at, urgent
             FROM messages WHERE to_session = ?1 ORDER BY created_at DESC"
        };
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt.query_map([session], |r| {
            Ok(Message {
                id: r.get(0)?,
                from: r.get(1)?,
                to: r.get(2)?,
                body: r.get(3)?,
                created_at: r.get(4)?,
                read_at: r.get(5)?,
                urgent: r.get::<_, i64>(6)? != 0,
            })
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// 标记一条消息为已读，返回是否命中。
    pub fn mark_read(&self, session: &str, msg_id: &str) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        let n = conn.execute(
            "UPDATE messages SET read_at = ?1 WHERE id = ?2 AND to_session = ?3 AND read_at IS NULL",
            rusqlite::params![chrono::Utc::now().timestamp(), msg_id, session],
        )?;
        Ok(n > 0)
    }

    /// 某会话未读数。
    pub fn unread_count(&self, session: &str) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let n: i64 = conn.query_row(
            "SELECT COUNT(*) FROM messages WHERE to_session = ?1 AND read_at IS NULL",
            [session],
            |r| r.get(0),
        )?;
        Ok(n)
    }

    /// 按原消息回复（收件人=原发件人）。
    pub fn reply(&self, replier: &str, msg_id: &str, body: &str, urgent: bool) -> Result<Message> {
        let orig_from: Option<String> = {
            let conn = self.conn.lock().unwrap();
            conn.query_row(
                "SELECT from_session FROM messages WHERE id = ?1",
                [msg_id],
                |r| r.get(0),
            )
            .optional()?
        };
        let to = orig_from.context("原消息不存在")?;
        self.send(replier, &to, body, urgent)
    }

    /// upsert 共享笔记。
    pub fn note_upsert(&self, key: &str, body: &str, author: &str) -> Result<Note> {
        let now = chrono::Utc::now().timestamp();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO notes (key, body, author, updated_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(key) DO UPDATE SET body=?2, author=?3, updated_at=?4",
            rusqlite::params![key, body, author, now],
        )?;
        Ok(Note {
            key: key.to_string(),
            body: body.to_string(),
            author: author.to_string(),
            updated_at: now,
        })
    }

    pub fn note_get(&self, key: &str) -> Result<Option<Note>> {
        let conn = self.conn.lock().unwrap();
        let n = conn
            .query_row(
                "SELECT key, body, author, updated_at FROM notes WHERE key = ?1",
                [key],
                |r| {
                    Ok(Note {
                        key: r.get(0)?,
                        body: r.get(1)?,
                        author: r.get(2)?,
                        updated_at: r.get(3)?,
                    })
                },
            )
            .optional()?;
        Ok(n)
    }

    pub fn notes_all(&self) -> Result<Vec<Note>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT key, body, author, updated_at FROM notes ORDER BY updated_at DESC")?;
        let rows = stmt.query_map([], |r| {
            Ok(Note {
                key: r.get(0)?,
                body: r.get(1)?,
                author: r.get(2)?,
                updated_at: r.get(3)?,
            })
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn send_and_inbox_roundtrip() {
        let mb = Mailbox::open_memory().unwrap();
        mb.send("A", "B", "hi B", false).unwrap();
        mb.send("C", "B", "urgent!", true).unwrap();
        mb.send("A", "Z", "for Z", false).unwrap();

        let b = mb.inbox("B", false).unwrap();
        assert_eq!(b.len(), 2); // 会话隔离：Z 的消息不在 B
        assert_eq!(mb.unread_count("B").unwrap(), 2);
        assert!(b.iter().any(|m| m.urgent));
    }

    #[test]
    fn mark_read_reduces_unread() {
        let mb = Mailbox::open_memory().unwrap();
        let m = mb.send("A", "B", "x", false).unwrap();
        assert_eq!(mb.unread_count("B").unwrap(), 1);
        assert!(mb.mark_read("B", &m.id).unwrap());
        assert_eq!(mb.unread_count("B").unwrap(), 0);
        // 重复标记不再命中
        assert!(!mb.mark_read("B", &m.id).unwrap());
        // 只剩未读时 inbox(unread) 为空
        assert!(mb.inbox("B", true).unwrap().is_empty());
    }

    #[test]
    fn reply_targets_original_sender() {
        let mb = Mailbox::open_memory().unwrap();
        let m = mb.send("A", "B", "ping", false).unwrap();
        let r = mb.reply("B", &m.id, "pong", false).unwrap();
        assert_eq!(r.to, "A");
        assert_eq!(mb.inbox("A", false).unwrap()[0].body, "pong");
    }

    #[test]
    fn notes_upsert_and_get() {
        let mb = Mailbox::open_memory().unwrap();
        mb.note_upsert("plan", "v1", "A").unwrap();
        mb.note_upsert("plan", "v2", "B").unwrap(); // 覆盖
        let n = mb.note_get("plan").unwrap().unwrap();
        assert_eq!(n.body, "v2");
        assert_eq!(n.author, "B");
        assert_eq!(mb.notes_all().unwrap().len(), 1);
        assert!(mb.note_get("missing").unwrap().is_none());
    }
}
