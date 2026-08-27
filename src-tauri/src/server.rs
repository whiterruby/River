//! Local HTTP server that proxies Google Drive file downloads as a byte stream.
//! Binds to 127.0.0.1 ephemeral — auth required via ephemeral token.

use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode},
    response::IntoResponse,
    routing::get,
    Router,
};
use reqwest::Client;
use serde::Deserialize;
use std::sync::Arc;
use tokio::net::TcpListener;
use tower_http::cors::CorsLayer;

use crate::commands;
use crate::db::Database;

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Database>,
    pub client: Client,
    pub stream_token: String,
}

#[derive(Deserialize)]
pub struct StreamQuery {
    pub ext: Option<String>,
    pub token: Option<String>,
}

/// Binds to 127.0.0.1:0 and returns the actual port + token check.
/// Cors is restricted to tauri local origins.
pub async fn start_stream_server(db: Arc<Database>, stream_token: String) -> u16 {
    let state = AppState {
        db,
        client: Client::new(),
        stream_token,
    };

    // CORS restricted to Tauri origins: production tauri://localhost and dev http://localhost:1420/http://127.0.0.1
    // Token auth is still primary; CORS is defense-in-depth.
    let cors = CorsLayer::new()
        .allow_origin([
            "tauri://localhost".parse::<HeaderValue>().unwrap(),
            "http://localhost:1420".parse::<HeaderValue>().unwrap(),
            "http://127.0.0.1:1420".parse::<HeaderValue>().unwrap(),
        ])
        .allow_headers([header::AUTHORIZATION, header::RANGE, header::CONTENT_TYPE, header::ACCEPT])
        .allow_methods([Method::GET, Method::OPTIONS, Method::HEAD])
        .expose_headers([header::CONTENT_LENGTH, header::CONTENT_RANGE, header::ACCEPT_RANGES, header::CONTENT_TYPE]);

    let app = Router::new()
        .route("/stream/{account_id}/{file_id}", get(stream_handler))
        .layer(cors)
        .with_state(state);

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    log::info!("[river] stream server listening on 127.0.0.1:{} (auth required)", port);
    port
}

fn mime_for_ext(ext: &str) -> Option<&'static str> {
    match ext.to_lowercase().as_str() {
        "mp4" | "m4v" => Some("video/mp4"),
        "webm" => Some("video/webm"),
        "ogg" | "ogv" => Some("video/ogg"),
        "mov" => Some("video/quicktime"),
        "mp3" => Some("audio/mpeg"),
        "wav" => Some("audio/wav"),
        "flac" => Some("audio/flac"),
        "aac" => Some("audio/aac"),
        "m4a" => Some("audio/mp4"),
        "opus" => Some("audio/opus"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "svg" => Some("image/svg+xml"),
        "bmp" => Some("image/bmp"),
        "avif" => Some("image/avif"),
        "pdf" => Some("application/pdf"),
        _ => None,
    }
}

async fn stream_handler(
    State(state): State<AppState>,
    Path((account_id, file_id)): Path<(String, String)>,
    Query(q): Query<StreamQuery>,
    req_headers: HeaderMap,
) -> impl IntoResponse {
    // Auth: query token or Authorization Bearer
    let provided = q.token.clone().or_else(|| {
        req_headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.strip_prefix("Bearer ").map(|s| s.to_string()))
    });
    if provided.as_deref() != Some(state.stream_token.as_str()) {
        log::warn!("[river] stream unauthorized for account {}", account_id);
        return (StatusCode::UNAUTHORIZED, "Unauthorized — invalid stream token".to_string()).into_response();
    }

    let access_token = match commands::get_fresh_token_no_state(&state.db, &account_id).await {
        Ok(t) => t,
        Err(e) => {
            log::warn!("[river] stream auth failed for {}: {}", account_id, crate::crypto::redact(&e));
            return (StatusCode::UNAUTHORIZED, format!("Failed to get token: {}", crate::crypto::redact(&e))).into_response();
        }
    };

    let mut req = state
        .client
        .get(&format!(
            "https://www.googleapis.com/drive/v3/files/{}?alt=media",
            file_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", access_token));

    if let Some(range) = req_headers.get(header::RANGE) {
        req = req.header(header::RANGE, range);
    }

    let res = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            log::warn!("[river] stream request failed: {}", crate::crypto::redact(&e.to_string()));
            return (StatusCode::BAD_GATEWAY, format!("Drive API failed: {}", crate::crypto::redact(&e.to_string()))).into_response();
        }
    };

    if !res.status().is_success() && res.status().as_u16() != 206 {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        log::warn!("[river] Drive returned {} for {}: {}", status, file_id, crate::crypto::redact(&body.chars().take(300).collect::<String>()));
        return (status, body).into_response();
    }

    let status = res.status();
    let mut response_headers = HeaderMap::new();

    let content_type = q
        .ext
        .as_deref()
        .and_then(mime_for_ext)
        .map(|m| HeaderValue::from_static(m))
        .or_else(|| res.headers().get(header::CONTENT_TYPE).cloned());

    if let Some(ct) = content_type {
        let is_octet = ct.as_bytes() == b"application/octet-stream";
        if !is_octet || q.ext.is_none() {
            response_headers.insert(header::CONTENT_TYPE, ct);
        } else if let Some(better) = q.ext.as_deref().and_then(mime_for_ext).map(HeaderValue::from_static) {
            response_headers.insert(header::CONTENT_TYPE, better);
        } else {
            response_headers.insert(header::CONTENT_TYPE, ct);
        }
    }

    for h in &[header::CONTENT_LENGTH, header::CONTENT_RANGE, header::ACCEPT_RANGES] {
        if let Some(val) = res.headers().get(h.clone()) {
            response_headers.insert(h.clone(), val.clone());
        }
    }

    response_headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    response_headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, max-age=0, no-store"),
    );
    response_headers.insert(
        HeaderName::from_static("referrer-policy"),
        HeaderValue::from_static("no-referrer"),
    );
    response_headers.insert(
        HeaderName::from_static("x-content-type-options"),
        HeaderValue::from_static("nosniff"),
    );

    let stream = res.bytes_stream();
    let body = Body::from_stream(stream);

    (status, response_headers, body).into_response()
}
