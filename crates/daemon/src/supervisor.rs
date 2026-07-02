//! PTY 托管：ccbridge 启动/接管 CC 会话，经伪终端（ConPTY / unix pty）完全掌控 I/O。
//! 每个托管会话：一个读线程把 PTY 输出广播给所有 WS 订阅者，并保留尾部缓冲供新连接回放；
//! 输入与 resize 通过 master 写回。
use anyhow::Result;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::broadcast;

const BUFFER_CAP: usize = 256 * 1024;

pub struct ManagedSession {
    pub id: String,
    pub cwd: String,
    pub title: String,
    pub created_at: i64,
    pub alive: AtomicBool,
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    pub output_tx: broadcast::Sender<Vec<u8>>,
    buffer: Mutex<Vec<u8>>,
}

impl ManagedSession {
    pub fn write_input(&self, data: &[u8]) -> Result<()> {
        let mut w = self.writer.lock().unwrap();
        w.write_all(data)?;
        w.flush()?;
        Ok(())
    }

    pub fn resize(&self, rows: u16, cols: u16) -> Result<()> {
        self.master.lock().unwrap().resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        Ok(())
    }

    /// 当前尾部缓冲快照，供新连接的终端回放历史输出。
    pub fn snapshot(&self) -> Vec<u8> {
        self.buffer.lock().unwrap().clone()
    }

    pub fn kill(&self) {
        let _ = self.child.lock().unwrap().kill();
        self.alive.store(false, Ordering::SeqCst);
    }
}

pub struct Supervisor {
    sessions: RwLock<HashMap<String, Arc<ManagedSession>>>,
}

impl Supervisor {
    pub fn new() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
        }
    }

    /// 在 cwd 下启动 program(args)，返回托管会话 id。
    pub fn spawn(&self, cwd: &str, program: &str, args: &[String], title: &str) -> Result<String> {
        let pty = native_pty_system();
        let pair = pty.openpty(PtySize {
            rows: 40,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })?;

        let mut cmd = CommandBuilder::new(program);
        for a in args {
            cmd.arg(a);
        }
        cmd.cwd(cwd);

        let child = pair.slave.spawn_command(cmd)?;
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;
        let (tx, _) = broadcast::channel::<Vec<u8>>(512);

        let id = gen_id();
        let session = Arc::new(ManagedSession {
            id: id.clone(),
            cwd: cwd.to_string(),
            title: title.to_string(),
            created_at: now(),
            alive: AtomicBool::new(true),
            writer: Mutex::new(writer),
            master: Mutex::new(pair.master),
            child: Mutex::new(child),
            output_tx: tx,
            buffer: Mutex::new(Vec::new()),
        });

        let s2 = session.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let chunk = buf[..n].to_vec();
                        {
                            let mut b = s2.buffer.lock().unwrap();
                            b.extend_from_slice(&chunk);
                            if b.len() > BUFFER_CAP {
                                let cut = b.len() - BUFFER_CAP;
                                b.drain(0..cut);
                            }
                        }
                        let _ = s2.output_tx.send(chunk);
                    }
                    Err(_) => break,
                }
            }
            s2.alive.store(false, Ordering::SeqCst);
            let _ = s2
                .output_tx
                .send(b"\r\n[ccbridge] \xe4\xbc\x9a\xe8\xaf\x9d\xe5\xb7\xb2\xe7\xbb\x93\xe6\x9d\x9f\r\n".to_vec());
        });

        self.sessions.write().unwrap().insert(id.clone(), session);
        tracing::info!("已托管会话 {} @ {}", id, cwd);
        Ok(id)
    }

    pub fn get(&self, id: &str) -> Option<Arc<ManagedSession>> {
        self.sessions.read().unwrap().get(id).cloned()
    }

    pub fn list(&self) -> Vec<ManagedInfo> {
        self.sessions
            .read()
            .unwrap()
            .values()
            .map(|s| ManagedInfo {
                id: s.id.clone(),
                cwd: s.cwd.clone(),
                title: s.title.clone(),
                created_at: s.created_at,
                alive: s.alive.load(Ordering::SeqCst),
            })
            .collect()
    }

    pub fn kill(&self, id: &str) {
        if let Some(s) = self.get(id) {
            s.kill();
        }
        self.sessions.write().unwrap().remove(id);
    }
}

#[derive(serde::Serialize)]
pub struct ManagedInfo {
    pub id: String,
    pub cwd: String,
    pub title: String,
    pub created_at: i64,
    pub alive: bool,
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn gen_id() -> String {
    let n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("m{:x}", n)
}
