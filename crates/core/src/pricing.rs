//! 内置模型价格表（USD / 百万 token）与成本计算。
//! 价格按 Claude 各档位近似值，可在后续做成可配置覆盖。

#[derive(Debug, Clone, Copy)]
pub struct Price {
    pub input: f64,
    pub output: f64,
    pub cache_write: f64,
    pub cache_read: f64,
}

/// 按模型名（含 opus/sonnet/haiku 关键字）匹配价格，默认按 sonnet 计。
pub fn price_for(model: &str) -> Price {
    let m = model.to_lowercase();
    if m.contains("opus") {
        Price {
            input: 15.0,
            output: 75.0,
            cache_write: 18.75,
            cache_read: 1.5,
        }
    } else if m.contains("haiku") {
        Price {
            input: 1.0,
            output: 5.0,
            cache_write: 1.25,
            cache_read: 0.1,
        }
    } else {
        // sonnet 及未知
        Price {
            input: 3.0,
            output: 15.0,
            cache_write: 3.75,
            cache_read: 0.3,
        }
    }
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
