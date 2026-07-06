//! 统一 API 错误响应（1.0 工程化）。
//!
//! 所有 handler 用 [`ApiResult`]，错误统一序列化为 `{"error": "..."}` + 恰当状态码，
//! 取代此前散落的纯文本 / 裸 JSON 返回。

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;

#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub message: String,
}

impl ApiError {
    pub fn new(status: StatusCode, msg: impl Into<String>) -> Self {
        Self {
            status,
            message: msg.into(),
        }
    }
    pub fn bad_request(msg: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, msg)
    }
    #[allow(dead_code)] // Phase 6 mailbox handlers 使用
    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, msg)
    }
    pub fn internal(msg: impl Into<String>) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, msg)
    }
}

#[derive(Serialize)]
struct ErrorBody {
    error: String,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(ErrorBody {
                error: self.message,
            }),
        )
            .into_response()
    }
}

impl From<anyhow::Error> for ApiError {
    fn from(e: anyhow::Error) -> Self {
        Self::internal(e.to_string())
    }
}

/// handler 返回类型：`Ok` 走正常响应，`Err(ApiError)` 走统一错误体。
#[allow(dead_code)] // Phase 6 mailbox handlers 使用
pub type ApiResult<T> = Result<T, ApiError>;

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;

    #[tokio::test]
    async fn error_serializes_to_json_body() {
        let resp = ApiError::bad_request("坏请求").into_response();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        let body = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(v["error"], "坏请求");
    }

    #[test]
    fn anyhow_maps_to_500() {
        let e: ApiError = anyhow::anyhow!("boom").into();
        assert_eq!(e.status, StatusCode::INTERNAL_SERVER_ERROR);
    }
}
