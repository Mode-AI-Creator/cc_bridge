//! 模型价格表（USD / 百万 token）与成本计算。
//!
//! 内置价格按 Claude 各档位近似值；可在启动时经 [`set_table`] 用配置覆盖（1.0 可维护性）。
//! 未知模型可用 [`is_known`] 检测并告警（回退 sonnet 计价）。

use std::sync::OnceLock;

/// 内置价格表版本标注（便于识别是否过期）。
pub const PRICE_TABLE_VERSION: &str = "2026-01";

#[derive(Debug, Clone, Copy)]
pub struct Price {
    pub input: f64,
    pub output: f64,
    pub cache_write: f64,
    pub cache_read: f64,
}

/// 三档价格表。
#[derive(Debug, Clone, Copy)]
pub struct PriceTable {
    pub opus: Price,
    pub sonnet: Price,
    pub haiku: Price,
}

impl PriceTable {
    pub const fn builtin() -> Self {
        Self {
            opus: Price {
                input: 15.0,
                output: 75.0,
                cache_write: 18.75,
                cache_read: 1.5,
            },
            sonnet: Price {
                input: 3.0,
                output: 15.0,
                cache_write: 3.75,
                cache_read: 0.3,
            },
            haiku: Price {
                input: 1.0,
                output: 5.0,
                cache_write: 1.25,
                cache_read: 0.1,
            },
        }
    }
}

impl Default for PriceTable {
    fn default() -> Self {
        Self::builtin()
    }
}

static TABLE: OnceLock<PriceTable> = OnceLock::new();

fn table() -> &'static PriceTable {
    TABLE.get_or_init(PriceTable::builtin)
}

/// 用配置覆盖价格表（仅首次生效，应在启动早期调用）。
pub fn set_table(t: PriceTable) {
    let _ = TABLE.set(t);
}

/// 识别模型档位；未知返回 None。
pub fn model_family(model: &str) -> Option<&'static str> {
    let m = model.to_lowercase();
    if m.contains("opus") {
        Some("opus")
    } else if m.contains("haiku") {
        Some("haiku")
    } else if m.contains("sonnet") {
        Some("sonnet")
    } else {
        None
    }
}

/// 模型是否在已知档位内（否则计价回退 sonnet）。
pub fn is_known(model: &str) -> bool {
    model_family(model).is_some()
}

/// 纯函数：给定价格表与模型取单价（未知回退 sonnet）。
pub fn price_from(t: &PriceTable, model: &str) -> Price {
    match model_family(model) {
        Some("opus") => t.opus,
        Some("haiku") => t.haiku,
        _ => t.sonnet,
    }
}

/// 按当前价格表取单价。
pub fn price_for(model: &str) -> Price {
    price_from(table(), model)
}

/// 计算一次用量的成本（USD）。
pub fn cost(model: &str, input: u64, output: u64, cache_write: u64, cache_read: u64) -> f64 {
    let p = price_for(model);
    (input as f64 * p.input
        + output as f64 * p.output
        + cache_write as f64 * p.cache_write
        + cache_read as f64 * p.cache_read)
        / 1_000_000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_family_detects_tiers() {
        assert_eq!(model_family("claude-opus-4-8"), Some("opus"));
        assert_eq!(model_family("claude-sonnet-5"), Some("sonnet"));
        assert_eq!(model_family("claude-haiku-4-5"), Some("haiku"));
        assert_eq!(model_family("gpt-4"), None);
        assert!(!is_known("some-future-model"));
    }

    #[test]
    fn price_from_falls_back_to_sonnet_for_unknown() {
        let t = PriceTable::builtin();
        let unknown = price_from(&t, "mystery");
        assert_eq!(unknown.input, t.sonnet.input);
        assert_eq!(price_from(&t, "claude-opus-4-8").output, 75.0);
    }

    #[test]
    fn cost_computes_per_mtok() {
        // 1M input @ opus = $15
        let c = cost("claude-opus-4-8", 1_000_000, 0, 0, 0);
        assert!((c - 15.0).abs() < 1e-9);
    }
}
