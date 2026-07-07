//! 统一配置（1.0 工程化）。
//!
//! 优先级：**环境变量 > `~/.claude/ccbridge/config.toml` > 内置默认**。
//! 缺文件或解析失败均降级为默认（并告警），绝不阻断启动。

use ccbridge_core::discovery;
use serde::Deserialize;
use std::path::PathBuf;

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct Config {
    pub server: ServerConfig,
    pub claude: ClaudeConfig,
    pub pricing: PricingConfig,
}

/// 价格覆盖（USD / 百万 token）。缺省档位用内置价。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct PricingConfig {
    pub opus: Option<TierPrice>,
    pub sonnet: Option<TierPrice>,
    pub haiku: Option<TierPrice>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct TierPrice {
    pub input: f64,
    pub output: f64,
    pub cache_write: f64,
    pub cache_read: f64,
}

impl From<TierPrice> for ccbridge_core::pricing::Price {
    fn from(t: TierPrice) -> Self {
        Self {
            input: t.input,
            output: t.output,
            cache_write: t.cache_write,
            cache_read: t.cache_read,
        }
    }
}

impl PricingConfig {
    /// 以内置表为基，应用覆盖，产出最终价格表。
    pub fn to_table(&self) -> ccbridge_core::pricing::PriceTable {
        let mut t = ccbridge_core::pricing::PriceTable::builtin();
        if let Some(p) = self.opus {
            t.opus = p.into();
        }
        if let Some(p) = self.sonnet {
            t.sonnet = p.into();
        }
        if let Some(p) = self.haiku {
            t.haiku = p.into();
        }
        t
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct ServerConfig {
    /// 监听地址（默认仅本机）。
    pub addr: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct ClaudeConfig {
    /// claude 可执行文件名或完整路径。
    pub program: String,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            addr: "127.0.0.1:7878".to_string(),
        }
    }
}

impl Default for ClaudeConfig {
    fn default() -> Self {
        Self {
            program: "claude".to_string(),
        }
    }
}

impl Config {
    /// 配置文件路径 `~/.claude/ccbridge/config.toml`。
    pub fn path() -> Option<PathBuf> {
        discovery::claude_dir().map(|c| c.join("ccbridge").join("config.toml"))
    }

    /// 从磁盘 + 环境变量装配配置（纯函数式装配见 [`Self::assemble`]）。
    pub fn load() -> Self {
        let disk = Self::path()
            .filter(|p| p.exists())
            .and_then(|p| std::fs::read_to_string(&p).ok());
        Self::assemble(disk.as_deref(), |k| std::env::var(k).ok())
    }

    /// 纯装配：给定 toml 文本与 env 取值器，产出最终配置。便于单测。
    pub fn assemble(toml_text: Option<&str>, env: impl Fn(&str) -> Option<String>) -> Self {
        let mut cfg: Config = match toml_text {
            Some(t) => toml::from_str(t).unwrap_or_else(|e| {
                tracing::warn!("config.toml 解析失败，使用默认：{e}");
                Config::default()
            }),
            None => Config::default(),
        };
        if let Some(a) = env("CCBRIDGE_ADDR") {
            cfg.server.addr = a;
        }
        if let Some(c) = env("CCBRIDGE_CLAUDE") {
            cfg.claude.program = c;
        }
        cfg
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_when_no_file_no_env() {
        let c = Config::assemble(None, |_| None);
        assert_eq!(c.server.addr, "127.0.0.1:7878");
        assert_eq!(c.claude.program, "claude");
    }

    #[test]
    fn toml_file_overrides_defaults() {
        let t = r#"
[server]
addr = "0.0.0.0:9000"
[claude]
program = "/opt/claude"
"#;
        let c = Config::assemble(Some(t), |_| None);
        assert_eq!(c.server.addr, "0.0.0.0:9000");
        assert_eq!(c.claude.program, "/opt/claude");
    }

    #[test]
    fn env_overrides_file() {
        let t = r#"[server]
addr = "0.0.0.0:9000""#;
        let c = Config::assemble(Some(t), |k| {
            (k == "CCBRIDGE_ADDR").then(|| "127.0.0.1:5555".to_string())
        });
        assert_eq!(c.server.addr, "127.0.0.1:5555");
    }

    #[test]
    fn bad_toml_falls_back_to_default() {
        let c = Config::assemble(Some("this is : not valid toml ["), |_| None);
        assert_eq!(c.server.addr, "127.0.0.1:7878");
    }
}
