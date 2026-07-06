//! 发布构建时把 `web/dist` 内嵌进二进制（feature `embed-frontend`），
//! 产出自包含单文件；SPA fallback 到 index.html。

use axum::{
    http::{header, StatusCode, Uri},
    response::{IntoResponse, Response},
};
use rust_embed::RustEmbed;

#[derive(RustEmbed)]
#[folder = "../../web/dist"]
struct Assets;

fn asset_response(path: &str) -> Option<Response> {
    let file = Assets::get(path)?;
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    Some(
        (
            [(header::CONTENT_TYPE, mime.as_ref())],
            file.data.into_owned(),
        )
            .into_response(),
    )
}

/// 内嵌前端 fallback handler：命中静态资源则返回，否则回落 index.html（SPA）。
pub async fn serve(uri: Uri) -> Response {
    let raw = uri.path().trim_start_matches('/');
    let path = if raw.is_empty() { "index.html" } else { raw };
    if let Some(resp) = asset_response(path) {
        return resp;
    }
    match asset_response("index.html") {
        Some(resp) => resp,
        None => (StatusCode::NOT_FOUND, "frontend not embedded").into_response(),
    }
}
