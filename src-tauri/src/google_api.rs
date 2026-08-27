//! Google Drive API v3 client. Handles token refresh, quota queries,
//! file listing, search, upload (multipart), folder creation, and deletion.

use crate::models::DriveFile;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, OnceLock};

pub const DEFAULT_CLIENT_ID: &str = concat!(
    "1071006060591-",
    "tmhssin2h21lcre235vtolojh4g403ep",
    ".apps.googleusercontent.com"
);
pub const DEFAULT_CLIENT_SECRET: &str = concat!(
    "GOCSPX-",
    "K58FWR486LdLJ1mLB8sXC4z6qDAf"
);

// ---------------------------------------------------------------------------
// Token cache + singleflight (P1-5)
// ---------------------------------------------------------------------------
static ACCESS_TOKEN_CACHE: OnceLock<parking_lot::Mutex<HashMap<String, (String, i64)>>> = OnceLock::new();
static INFLIGHT_LOCKS: OnceLock<parking_lot::Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>> = OnceLock::new();

fn token_cache() -> &'static parking_lot::Mutex<HashMap<String, (String, i64)>> {
    ACCESS_TOKEN_CACHE.get_or_init(|| parking_lot::Mutex::new(HashMap::new()))
}
fn inflight() -> &'static parking_lot::Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>> {
    INFLIGHT_LOCKS.get_or_init(|| parking_lot::Mutex::new(HashMap::new()))
}

fn remove_expired() {
    let now = chrono::Utc::now().timestamp();
    token_cache().lock().retain(|_, (_, exp)| *exp > now);
}

/// Cached + singleflight wrapper. Keyed by account_id. Returns valid access_token.
/// Refresh token is never cached — only short-lived access_token (3500s).
pub async fn get_access_token_cached(
    account_id: &str,
    refresh_token: &str,
    custom_client_id: Option<&str>,
    custom_client_secret: Option<&str>,
) -> Result<String, String> {
    remove_expired();
    let now = chrono::Utc::now().timestamp();
    // Fast path: cached and not expiring within 60s
    if let Some((tok, exp)) = token_cache().lock().get(account_id).cloned() {
        if exp > now + 60 {
            return Ok(tok);
        }
    }
    // Singleflight: per-account mutex
    let per_account_lock = {
        let mut m = inflight().lock();
        m.entry(account_id.to_string())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone()
    };
    let _guard = per_account_lock.lock().await;
    // Double-check after acquiring lock
    if let Some((tok, exp)) = token_cache().lock().get(account_id).cloned() {
        if exp > now + 60 {
            return Ok(tok);
        }
    }
    // Actually refresh
    let token = refresh_access_token(refresh_token, custom_client_id, custom_client_secret).await?;
    // Google access_token lifetime ~3600s, cache for 3500s
    let expiry = chrono::Utc::now().timestamp() + 3500;
    token_cache().lock().insert(account_id.to_string(), (token.clone(), expiry));
    Ok(token)
}

pub fn invalidate_token_cache(account_id: &str) {
    token_cache().lock().remove(account_id);
}

/// Revokes a refresh or access token at Google. Best-effort.
pub async fn revoke_token(token: &str) -> Result<(), String> {
    let client = reqwest::Client::new();
    let res = client
        .post("https://oauth2.googleapis.com/revoke")
        .form(&[("token", token)])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if res.status().is_success() {
        Ok(())
    } else {
        let txt = res.text().await.unwrap_or_default();
        Err(format!("Revoke failed: {}", txt))
    }
}

/// Uses the refresh token to obtain a new short-lived access token.
/// Returns INVALID_GRANT if the refresh token has been revoked.
pub async fn refresh_access_token(
    refresh_token: &str,
    custom_client_id: Option<&str>,
    custom_client_secret: Option<&str>,
) -> Result<String, String> {
    let client_id = custom_client_id
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(DEFAULT_CLIENT_ID);
    let client_secret = custom_client_secret
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(DEFAULT_CLIENT_SECRET);

    let client = reqwest::Client::new();

    let params = [
        ("client_id", client_id),
        ("client_secret", client_secret),
        ("refresh_token", refresh_token),
        ("grant_type", "refresh_token"),
    ];

    let res = client
        .post("https://oauth2.googleapis.com/token")
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Network request failed: {}", e))?;

    let status = res.status();
    let body = res
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    if !status.is_success() {
        if body.contains("invalid_grant") {
            return Err("INVALID_GRANT: Token is expired or revoked".to_string());
        }
        return Err(format!("OAuth error ({}): {}", status, body));
    }

    let json: Value = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse token response: {}", e))?;

    json.get("access_token")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "access_token not found in response".to_string())
}

/// Returns (used_bytes, total_bytes) from the Drive about endpoint.
pub async fn get_storage_quota(access_token: &str) -> Result<(i64, i64), String> {
    let client = reqwest::Client::new();
    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {}", access_token)).map_err(|e| e.to_string())?,
    );

    let res = client
        .get("https://www.googleapis.com/drive/v3/about?fields=storageQuota,user")
        .headers(headers)
        .send()
        .await
        .map_err(|e| format!("Drive API request failed: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("Drive API error: HTTP {}", res.status()));
    }

    let json: Value = res
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;

    let quota = json.get("storageQuota").ok_or("storageQuota not found")?;
    // Drive API returns these as strings, not numbers.
    let limit_str = quota.get("limit").and_then(|v| v.as_str()).unwrap_or("0");
    let usage_str = quota.get("usage").and_then(|v| v.as_str()).unwrap_or("0");

    let limit: i64 = limit_str.parse().unwrap_or(0);
    let usage: i64 = usage_str.parse().unwrap_or(0);

    Ok((usage, limit))
}

/// Lists files under a given parent folder (default: root). Results are
/// ordered folders-first, then alphabetically by name.
pub async fn list_files(
    access_token: &str,
    parent_id: Option<&str>,
    page_size: usize,
    account_id: &str,
    account_email: &str,
) -> Result<Vec<DriveFile>, String> {
    let client = reqwest::Client::new();
    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {}", access_token)).map_err(|e| e.to_string())?,
    );

    let parent = parent_id.unwrap_or("root");
    // Strip single-quotes to prevent Drive query injection.
    let clean_parent = parent.replace('\'', "");
    let query = format!("'{}' in parents and trashed = false", clean_parent);

    let res = client
        .get("https://www.googleapis.com/drive/v3/files")
        .headers(headers)
        .query(&[
            ("q", query.as_str()),
            ("pageSize", &page_size.to_string()),
            (
                "fields",
                "files(id, name, mimeType, size, modifiedTime, webViewLink, iconLink, thumbnailLink, parents)",
            ),
            ("orderBy", "folder,name"),
        ])
        .send()
        .await
        .map_err(|e| format!("List files error: {}", e))?;

    if !res.status().is_success() {
        let txt = res.text().await.unwrap_or_default();
        return Err(format!("Files list error: {}", txt));
    }

    let json: Value = res
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;
    let files_arr = json.get("files").and_then(|v| v.as_array());

    let mut result = Vec::new();
    if let Some(arr) = files_arr {
        for item in arr {
            let id = item.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let name = item.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let mime_type = item
                .get("mimeType")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let size = item
                .get("size")
                .and_then(|v| v.as_str())
                .and_then(|s| s.parse::<i64>().ok());
            let modified_time = item
                .get("modifiedTime")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let web_view_link = item
                .get("webViewLink")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let icon_link = item
                .get("iconLink")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let thumbnail_link = item
                .get("thumbnailLink")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let is_folder = mime_type == "application/vnd.google-apps.folder";

            result.push(DriveFile {
                id,
                name,
                mime_type,
                size,
                modified_time,
                web_view_link,
                icon_link,
                thumbnail_link,
                parents: None,
                is_folder,
                account_id: account_id.to_string(),
                account_email: account_email.to_string(),
            });
        }
    }

    Ok(result)
}

/// Escapes special characters for use inside a Drive API query string value.
fn escape_drive_query_value(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '\'' => out.push_str("\\'"),
            '\n' => out.push(' '),
            '\r' => out.push(' '),
            '\0' => {},
            _ => out.push(ch),
        }
    }
    out
}

/// Full-text search within a single account's Drive. Supports optional
/// filter_type: "folder" or "file" to narrow results.
pub async fn search_files_in_account(
    access_token: &str,
    query_text: &str,
    filter_type: Option<&str>,
    max_results: usize,
    account_id: &str,
    account_email: &str,
) -> Result<Vec<DriveFile>, String> {
    let client = reqwest::Client::new();
    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {}", access_token)).map_err(|e| e.to_string())?,
    );

    let trimmed = query_text.trim();
    let base_q = if trimmed.is_empty() || trimmed == "*" {
        "trashed = false".to_string()
    } else {
        let escaped = escape_drive_query_value(trimmed);
        format!("name contains '{}' and trashed = false", escaped)
    };

    let q = match filter_type {
        Some("folder") => format!("{} and mimeType = 'application/vnd.google-apps.folder'", base_q),
        Some("file") => format!("{} and mimeType != 'application/vnd.google-apps.folder'", base_q),
        _ => base_q,
    };

    let res = client
        .get("https://www.googleapis.com/drive/v3/files")
        .headers(headers)
        .query(&[
            ("q", q.as_str()),
            ("pageSize", &max_results.to_string()),
            (
                "fields",
                "files(id, name, mimeType, size, modifiedTime, webViewLink, iconLink, thumbnailLink, parents)",
            ),
            ("orderBy", "modifiedTime desc"),
        ])
        .send()
        .await
        .map_err(|e| format!("Search files error: {}", e))?;

    if !res.status().is_success() {
        let txt = res.text().await.unwrap_or_default();
        return Err(format!("Search API error: {}", txt));
    }

    let json: Value = res
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;
    let files_arr = json.get("files").and_then(|v| v.as_array());

    let mut result = Vec::new();
    if let Some(arr) = files_arr {
        for item in arr {
            let id = item.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let name = item.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let mime_type = item
                .get("mimeType")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let size = item
                .get("size")
                .and_then(|v| v.as_str())
                .and_then(|s| s.parse::<i64>().ok());
            let modified_time = item
                .get("modifiedTime")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let web_view_link = item
                .get("webViewLink")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let icon_link = item
                .get("iconLink")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let thumbnail_link = item
                .get("thumbnailLink")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let is_folder = mime_type == "application/vnd.google-apps.folder";

            result.push(DriveFile {
                id,
                name,
                mime_type,
                size,
                modified_time,
                web_view_link,
                icon_link,
                thumbnail_link,
                parents: None,
                is_folder,
                account_id: account_id.to_string(),
                account_email: account_email.to_string(),
            });
        }
    }

    Ok(result)
}

/// Downloads a file's content. Google Workspace types (Docs, Sheets,
/// Slides) are exported to PDF/XLSX since they have no raw bytes.
pub async fn download_file(access_token: &str, file_id: &str, mime_type: Option<&str>) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::new();
    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {}", access_token)).map_err(|e| e.to_string())?,
    );

    let url = if let Some(mt) = mime_type {
        if mt.contains("google-apps.document") {
            format!("https://www.googleapis.com/drive/v3/files/{}/export?mimeType=application/pdf", file_id)
        } else if mt.contains("google-apps.spreadsheet") {
            format!("https://www.googleapis.com/drive/v3/files/{}/export?mimeType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", file_id)
        } else if mt.contains("google-apps.presentation") {
            format!("https://www.googleapis.com/drive/v3/files/{}/export?mimeType=application/pdf", file_id)
        } else {
            format!("https://www.googleapis.com/drive/v3/files/{}?alt=media", file_id)
        }
    } else {
        format!("https://www.googleapis.com/drive/v3/files/{}?alt=media", file_id)
    };

    let res = client.get(url).headers(headers).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        let txt = res.text().await.unwrap_or_default();
        return Err(format!("Download failed: {}", txt));
    }
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    Ok(bytes.to_vec())
}

/// Multipart upload to Drive. Sends metadata + file content in a single
/// request. Suitable for files up to ~5MB; larger files should use
/// resumable uploads (not yet implemented).
pub async fn upload_file(
    access_token: &str,
    parent_folder_id: &str,
    file_name: &str,
    data: Vec<u8>,
    mime_type: &str,
) -> Result<Value, String> {
    let client = reqwest::Client::new();
    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {}", access_token)).map_err(|e| e.to_string())?,
    );

    let metadata = serde_json::json!({
        "name": file_name,
        "parents": if parent_folder_id == "root" { serde_json::Value::Array(vec![]) } else { serde_json::json!([parent_folder_id]) }
    });

    // RFC 2046 multipart/related encoding -- metadata part + binary part.
    let boundary = "-------314159265358979323846";
    let delimiter = format!("\r\n--{}\r\n", boundary);
    let close_delimiter = format!("\r\n--{}--", boundary);

    let mut body: Vec<u8> = Vec::new();
    body.extend_from_slice(delimiter.as_bytes());
    body.extend_from_slice(b"Content-Type: application/json; charset=UTF-8\r\n\r\n");
    body.extend_from_slice(serde_json::to_string(&metadata).unwrap().as_bytes());
    body.extend_from_slice(delimiter.as_bytes());
    body.extend_from_slice(format!("Content-Type: {}\r\n\r\n", mime_type).as_bytes());
    body.extend_from_slice(&data);
    body.extend_from_slice(close_delimiter.as_bytes());

    headers.insert(
        reqwest::header::CONTENT_TYPE,
        HeaderValue::from_str(&format!("multipart/related; boundary={}", boundary)).unwrap(),
    );

    let res = client
        .post("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart")
        .headers(headers)
        .body(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = res.status();
    let txt = res.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("Upload failed ({}): {}", status, txt));
    }
    serde_json::from_str(&txt).map_err(|e| e.to_string())
}

pub async fn create_folder(access_token: &str, parent_folder_id: &str, folder_name: &str) -> Result<Value, String> {
    let client = reqwest::Client::new();
    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {}", access_token)).map_err(|e| e.to_string())?,
    );
    headers.insert(
        reqwest::header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );

    let meta = serde_json::json!({
        "name": folder_name,
        "mimeType": "application/vnd.google-apps.folder",
        "parents": if parent_folder_id == "root" { Vec::<String>::new() } else { vec![parent_folder_id.to_string()] }
    });

    let res = client
        .post("https://www.googleapis.com/drive/v3/files")
        .headers(headers)
        .json(&meta)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = res.status();
    let txt = res.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("Create folder failed ({}): {}", status, txt));
    }
    serde_json::from_str(&txt).map_err(|e| e.to_string())
}

/// Permanently deletes a file. Drive returns 204 No Content on success.
pub async fn delete_file(access_token: &str, file_id: &str) -> Result<(), String> {
    let client = reqwest::Client::new();
    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {}", access_token)).map_err(|e| e.to_string())?,
    );
    let res = client
        .delete(format!("https://www.googleapis.com/drive/v3/files/{}", file_id))
        .headers(headers)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() && res.status().as_u16() != 204 {
        let txt = res.text().await.unwrap_or_default();
        return Err(format!("Delete failed: {}", txt));
    }
    Ok(())
}
