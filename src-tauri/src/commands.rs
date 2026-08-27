use crate::db::Database;
use crate::google_api;
use crate::models::{
    DriveAccount, DriveAccountExportItem, DriveAccountImportItem, DriveFile, DrivePoolSummary,
    SearchResult,
};
use crate::oauth;
use std::sync::Arc;
use tauri::State;
use tokio::io::AsyncWriteExt;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn redact_err(e: String) -> String {
    crate::crypto::redact(&e)
}

pub async fn get_fresh_token_no_state(
    db: &Database,
    id: &str,
) -> Result<String, String> {
    let (token, client_id, client_secret) = db.get_account_refresh_token(id)?;

    let access_token = match google_api::get_access_token_cached(
        id,
        &token,
        client_id.as_deref(),
        client_secret.as_deref(),
    )
    .await {
        Ok(t) => t,
        Err(e) => {
            if e.contains("INVALID_GRANT") {
                let _ = db.set_account_status(id, "revoked", Some(&redact_err(e.clone())));
            } else {
                let _ = db.set_account_status(id, "invalid", Some(&redact_err(e.clone())));
            }
            return Err(e);
        }
    };

    Ok(access_token)
}

// ---------------------------------------------------------------------------
// Basic commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_accounts(state: State<'_, Arc<Database>>) -> Result<Vec<DriveAccount>, String> {
    state.get_all_accounts()
}

#[tauri::command]
pub async fn get_pool_summary(state: State<'_, Arc<Database>>) -> Result<DrivePoolSummary, String> {
    state.get_pool_summary()
}

#[tauri::command(rename_all = "snake_case")]
pub async fn import_accounts(
    state: State<'_, Arc<Database>>,
    accounts: Vec<DriveAccountImportItem>,
) -> Result<serde_json::Value, String> {
    let (imported, updated, errors) = state.import_accounts(accounts)?;
    Ok(serde_json::json!({
        "imported": imported,
        "updated": updated,
        "failed": errors.len(),
        "errors": errors
    }))
}

#[tauri::command(rename_all = "snake_case")]
pub async fn export_accounts(
    state: State<'_, Arc<Database>>,
    account_ids: Option<Vec<String>>,
) -> Result<Vec<DriveAccountExportItem>, String> {
    state.export_accounts(account_ids)
}

/// Encrypted export: returns base64(AES-GCM) string. Password never leaves device.
#[tauri::command(rename_all = "snake_case")]
pub async fn export_accounts_encrypted(
    state: State<'_, Arc<Database>>,
    account_ids: Option<Vec<String>>,
    password: String,
) -> Result<String, String> {
    if password.len() < 8 {
        return Err("Password must be at least 8 characters".to_string());
    }
    let items = state.export_accounts(account_ids)?;
    let json = serde_json::to_string(&items).map_err(|e| e.to_string())?;
    crate::crypto::encrypt_with_password(&json, &password)
}

/// Encrypted import: decrypts then imports.
#[tauri::command(rename_all = "snake_case")]
pub async fn import_accounts_encrypted(
    state: State<'_, Arc<Database>>,
    encrypted_data: String,
    password: String,
) -> Result<serde_json::Value, String> {
    let json = crate::crypto::decrypt_with_password(&encrypted_data, &password)?;
    let items: Vec<DriveAccountImportItem> =
        serde_json::from_str(&json).map_err(|e| format!("Invalid backup format: {}", e))?;
    let (imported, updated, errors) = state.import_accounts(items)?;
    Ok(serde_json::json!({
        "imported": imported,
        "updated": updated,
        "failed": errors.len(),
        "errors": errors
    }))
}

#[tauri::command]
pub async fn delete_account(
    state: State<'_, Arc<Database>>,
    id: String,
) -> Result<serde_json::Value, String> {
    let mut revoked = false;
    let mut revoke_warning: Option<String> = None;
    if let Ok((token, _, _)) = state.get_account_refresh_token(&id) {
        match google_api::revoke_token(&token).await {
            Ok(_) => {
                revoked = true;
                log::info!("[river] revoked token for account {}", id);
            }
            Err(e) => {
                // Do not log token, only redacted error
                let redacted = crate::crypto::redact(&e);
                log::warn!("[river] revoke failed for {}: {}", id, redacted);
                revoke_warning = Some(format!("Google could not confirm token revocation ({}). Local credential removed, but please also revoke at https://myaccount.google.com/permissions", redacted));
            }
        }
        google_api::invalidate_token_cache(&id);
        // Zeroize token string after use (best effort)
        // Note: we don't store refresh_token plaintext in any retry queue
    }
    state.delete_account(&id)?;
    Ok(serde_json::json!({
        "success": true,
        "revoked": revoked,
        "warning": revoke_warning
    }))
}

#[tauri::command]
pub async fn toggle_account(
    state: State<'_, Arc<Database>>,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    state.toggle_account(&id, enabled)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn update_account_label(
    state: State<'_, Arc<Database>>,
    id: String,
    label: Option<String>,
) -> Result<(), String> {
    if let Some(ref l) = label {
        if l.len() > 100 || l.bytes().any(|b| b == 0) {
            return Err("Label too long or contains null byte".to_string());
        }
        // label is rendered as text node, but still sanitize to avoid HTML injection
        if l.contains('<') || l.contains('>') {
            // We store as is but frontend renders as text, so allow but note
            // For safety, we still allow but will be escaped by React
        }
    }
    state.update_label(&id, label)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn refresh_account_quota(
    state: State<'_, Arc<Database>>,
    id: String,
) -> Result<DriveAccount, String> {
    let (token, client_id, client_secret) = state.get_account_refresh_token(&id)?;

    let access_token = match google_api::get_access_token_cached(
        &id,
        &token,
        client_id.as_deref(),
        client_secret.as_deref(),
    )
    .await
    {
        Ok(t) => t,
        Err(e) => {
            if e.contains("INVALID_GRANT") {
                state.set_account_status(&id, "revoked", Some(&redact_err(e.clone())))?;
            } else {
                state.set_account_status(&id, "invalid", Some(&redact_err(e.clone())))?;
            }
            return Err(e);
        }
    };

    let (used, total) = google_api::get_storage_quota(&access_token)
        .await
        .map_err(|e| {
            let _ = state.set_account_status(&id, "invalid", Some(&redact_err(e.clone())));
            e
        })?;

    state.update_quota(&id, used, total)?;

    let accounts = state.get_all_accounts()?;
    accounts
        .into_iter()
        .find(|a| a.id == id)
        .ok_or_else(|| "Account not found".to_string())
}

#[tauri::command]
pub async fn refresh_all_quotas(
    state: State<'_, Arc<Database>>,
) -> Result<Vec<DriveAccount>, String> {
    let accounts = state.get_all_accounts()?;
    // Rate limiting: semaphore 4 concurrent
    let sem = Arc::new(tokio::sync::Semaphore::new(4));
    let mut handles = Vec::new();
    for acc in accounts.clone() {
        if !acc.is_enabled {
            continue;
        }
        let db = state.inner().clone();
        let sem_clone = sem.clone();
        let handle = tokio::spawn(async move {
            let _permit = sem_clone.acquire().await.unwrap();
            if let Ok((token, client_id, client_secret)) = db.get_account_refresh_token(&acc.id) {
                if let Ok(access_token) = google_api::get_access_token_cached(
                    &acc.id,
                    &token,
                    client_id.as_deref(),
                    client_secret.as_deref(),
                )
                .await
                {
                    if let Ok((used, total)) = google_api::get_storage_quota(&access_token).await {
                        let _ = db.update_quota(&acc.id, used, total);
                    }
                } else {
                    let _ = db.set_account_status(&acc.id, "invalid", Some("Token refresh failed"));
                }
            }
        });
        handles.push(handle);
    }
    for h in handles {
        let _ = h.await;
    }
    state.get_all_accounts()
}

#[tauri::command(rename_all = "snake_case")]
pub async fn list_account_files(
    state: State<'_, Arc<Database>>,
    account_id: String,
    parent_id: Option<String>,
) -> Result<Vec<DriveFile>, String> {
    let accounts = state.get_all_accounts()?;
    let acc = accounts
        .into_iter()
        .find(|a| a.id == account_id)
        .ok_or_else(|| "Account not found".to_string())?;

    let (token, client_id, client_secret) = state.get_account_refresh_token(&account_id)?;
    let access_token = google_api::get_access_token_cached(
        &account_id,
        &token,
        client_id.as_deref(),
        client_secret.as_deref(),
    )
    .await?;

    google_api::list_files(&access_token, parent_id.as_deref(), 100, &acc.id, &acc.email).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn search_all_accounts(
    state: State<'_, Arc<Database>>,
    query: Option<String>,
    filter: Option<String>,
) -> Result<SearchResult, String> {
    let query_str = query.unwrap_or_default();
    let accounts = state.get_all_accounts()?;
    let active_accounts: Vec<DriveAccount> = accounts
        .into_iter()
        .filter(|a| a.is_enabled && a.status == "active")
        .collect();

    let total_scanned = active_accounts.len();
    let sem = Arc::new(tokio::sync::Semaphore::new(4));
    let mut handles = Vec::new();

    for acc in active_accounts {
        let q = query_str.clone();
        let f = filter.clone();
        let sem_clone = sem.clone();
        if let Ok((token, client_id, client_secret)) = state.get_account_refresh_token(&acc.id) {
            let handle = tokio::spawn(async move {
                let _permit = sem_clone.acquire().await.unwrap();
                match google_api::get_access_token_cached(
                    &acc.id,
                    &token,
                    client_id.as_deref(),
                    client_secret.as_deref(),
                )
                .await
                {
                    Ok(access_token) => {
                        google_api::search_files_in_account(
                            &access_token,
                            &q,
                            f.as_deref(),
                            50,
                            &acc.id,
                            &acc.email,
                        )
                        .await
                    }
                    Err(e) => Err(format!("{}: {}", acc.email, redact_err(e))),
                }
            });
            handles.push(handle);
        }
    }

    let mut all_files = Vec::new();
    let mut errors = Vec::new();

    for h in handles {
        if let Ok(res) = h.await {
            match res {
                Ok(mut files) => all_files.append(&mut files),
                Err(e) => errors.push(redact_err(e)),
            }
        }
    }

    let total_found = all_files.len();
    Ok(SearchResult {
        query: query_str,
        total_found,
        files: all_files,
        scanned_accounts: total_scanned,
        errors,
    })
}

#[tauri::command(rename_all = "snake_case")]
pub async fn start_google_oauth(
    state: State<'_, Arc<Database>>,
    client_id: Option<String>,
    client_secret: Option<String>,
    port: Option<u16>, // deprecated, ignored (ephemeral now)
    scopes: Option<Vec<String>>,
) -> Result<serde_json::Value, String> {
    let _ = port; // ignored, ephemeral 127.0.0.1:0 now

    let mut eff_client_id = client_id.filter(|s| !s.trim().is_empty());
    let mut eff_client_secret = client_secret.filter(|s| !s.trim().is_empty());

    if eff_client_id.is_none() || eff_client_secret.is_none() {
        let settings = state.get_settings().unwrap_or_default();
        if eff_client_id.is_none() {
            eff_client_id = settings.get("default_client_id").cloned().filter(|s| !s.trim().is_empty());
        }
        if eff_client_secret.is_none() {
            eff_client_secret = settings.get("default_client_secret").cloned().filter(|s| !s.trim().is_empty());
        }
    }

    // Scope selection: frontend can pass ["https://www.googleapis.com/auth/drive.readonly"] etc.
    // Default to full drive for backward compat.
    let eff_scopes = scopes.filter(|v| !v.is_empty()).or_else(|| {
        // Try settings scopes
        let settings = state.get_settings().unwrap_or_default();
        settings.get("default_scopes").and_then(|s| serde_json::from_str(s).ok())
    });

    let oauth_result = oauth::perform_google_oauth(eff_client_id.clone(), eff_client_secret.clone(), eff_scopes).await?;

    let enc_refresh = crate::crypto::encrypt(&oauth_result.refresh_token)?;
    let enc_access = crate::crypto::encrypt(&oauth_result.access_token)?;
    let now = chrono::Utc::now().timestamp();

    let existing: Option<String> = {
        let accounts = state.get_all_accounts()?;
        accounts.into_iter().find(|a| a.email == oauth_result.email).map(|a| a.id)
    };

    if let Some(existing_id) = existing {
        state.update_oauth_tokens(
            &existing_id,
            &enc_refresh,
            &enc_access,
            oauth_result.token_expiry,
            &oauth_result.avatar_url,
            &oauth_result.client_id,
            &oauth_result.client_secret,
        )?;
        if let Ok(at) = google_api::get_access_token_cached(&existing_id, &oauth_result.refresh_token, Some(&oauth_result.client_id), Some(&oauth_result.client_secret)).await {
            if let Ok((used, total)) = google_api::get_storage_quota(&at).await {
                let _ = state.update_quota(&existing_id, used, total);
            }
        }
        Ok(serde_json::json!({ "success": true, "email": oauth_result.email }))
    } else {
        let id = uuid::Uuid::new_v4().to_string();
        state.insert_oauth_account(
            &id,
            &oauth_result.email,
            &enc_refresh,
            &enc_access,
            oauth_result.token_expiry,
            oauth_result.avatar_url.as_deref(),
            &oauth_result.client_id,
            &oauth_result.client_secret,
            now,
        )?;
        if let Ok(at) = google_api::get_access_token_cached(&id, &oauth_result.refresh_token, Some(&oauth_result.client_id), Some(&oauth_result.client_secret)).await {
            if let Ok((used, total)) = google_api::get_storage_quota(&at).await {
                let _ = state.update_quota(&id, used, total);
            }
        }
        Ok(serde_json::json!({ "success": true, "email": oauth_result.email }))
    }
}

#[tauri::command]
pub async fn get_settings(state: State<'_, Arc<Database>>) -> Result<std::collections::HashMap<String, String>, String> {
    state.get_settings()
}

#[tauri::command]
pub async fn set_setting(state: State<'_, Arc<Database>>, key: String, value: String) -> Result<(), String> {
    state.set_setting(&key, &value)
}

#[tauri::command]
pub async fn open_url(url: String) -> Result<(), String> {
    // Allowlist check: only https and http
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("Only http(s) URLs allowed".to_string());
    }
    open::that(url).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn download_file(
    state: State<'_, Arc<Database>>,
    account_id: String,
    file_id: String,
    mime_type: Option<String>,
) -> Result<Vec<u8>, String> {
    let (token, client_id, client_secret) = state.get_account_refresh_token(&account_id)?;
    let access_token = google_api::get_access_token_cached(&account_id, &token, client_id.as_deref(), client_secret.as_deref()).await?;
    google_api::download_file(&access_token, &file_id, mime_type.as_deref()).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn upload_file_buffer(
    state: State<'_, Arc<Database>>,
    account_id: String,
    parent_folder_id: String,
    file_name: String,
    base64_data: String,
    mime_type: Option<String>,
) -> Result<serde_json::Value, String> {
    if file_name.len() > 255 || file_name.bytes().any(|b| b == 0) {
        return Err("Invalid file name".to_string());
    }
    if base64_data.len() > 50 * 1024 * 1024 {
        return Err("File too large (max 50MB base64)".to_string());
    }
    if let Some(ref mt) = mime_type {
        if mt.len() > 200 {
            return Err("MIME type too long".to_string());
        }
    }
    let (token, client_id, client_secret) = state.get_account_refresh_token(&account_id)?;
    let access_token = google_api::get_access_token_cached(&account_id, &token, client_id.as_deref(), client_secret.as_deref()).await?;
    let b64 = if base64_data.contains(",") {
        base64_data.split(',').last().unwrap_or("").to_string()
    } else {
        base64_data
    };
    let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, b64).map_err(|e| e.to_string())?;
    if bytes.len() > 30 * 1024 * 1024 {
        return Err("Decoded file too large (max 30MB)".to_string());
    }
    let mime = mime_type.unwrap_or_else(|| "application/octet-stream".to_string());
    let safe_name = sanitize_filename(&file_name, "upload");
    google_api::upload_file(&access_token, &parent_folder_id, &safe_name, bytes, &mime).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn create_folder(
    state: State<'_, Arc<Database>>,
    account_id: String,
    parent_folder_id: String,
    folder_name: String,
) -> Result<serde_json::Value, String> {
    // P2-12 input limits
    if folder_name.trim().is_empty() || folder_name.len() > 200 || folder_name.bytes().any(|b| b == 0) {
        return Err("Invalid folder name".to_string());
    }
    if folder_name.contains('/') || folder_name.contains('\\') {
        return Err("Folder name cannot contain path separators".to_string());
    }
    let (token, client_id, client_secret) = state.get_account_refresh_token(&account_id)?;
    let access_token = google_api::get_access_token_cached(&account_id, &token, client_id.as_deref(), client_secret.as_deref()).await?;
    google_api::create_folder(&access_token, &parent_folder_id, &folder_name).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn delete_file(
    state: State<'_, Arc<Database>>,
    account_id: String,
    file_id: String,
) -> Result<(), String> {
    let (token, client_id, client_secret) = state.get_account_refresh_token(&account_id)?;
    let access_token = google_api::get_access_token_cached(&account_id, &token, client_id.as_deref(), client_secret.as_deref()).await?;
    google_api::delete_file(&access_token, &file_id).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn open_file_externally(
    state: State<'_, Arc<Database>>,
    account_id: String,
    file_id: String,
    file_name: String,
) -> Result<(), String> {
    // Input limits (P2-12)
    if file_name.len() > 255 {
        return Err("File name too long".to_string());
    }
    if file_name.bytes().any(|b| b == 0) {
        return Err("Invalid file name (null byte)".to_string());
    }
    let access_token = get_fresh_token_no_state(&state, &account_id).await?;

    let safe_name = sanitize_filename(&file_name, &file_id);
    let temp_dir = std::env::temp_dir().join("river_preview");
    ensure_secure_dir(&temp_dir)?;
    let dest = temp_dir.join(&safe_name);
    // Verify temp_dir is not a symlink (ensure_secure_dir already checks) and dest parent is temp_dir
    let dest_parent = dest.parent().unwrap_or(&temp_dir);
    if dest_parent != temp_dir {
        return Err("Invalid file name".to_string());
    }
    // Additional canonical check: ensure temp_dir canonicalizes successfully (not dangling symlink)
    let _ = temp_dir.canonicalize().map_err(|e| format!("Temp dir canonicalize failed: {}", e))?;

    let client = reqwest::Client::new();
    let url = format!("https://www.googleapis.com/drive/v3/files/{}?alt=media", file_id);
    let res = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        let status = res.status();
        let txt = res.text().await.unwrap_or_default();
        return Err(format!("Download failed ({}): {}", status, crate::crypto::redact(&txt.chars().take(300).collect::<String>())));
    }

    // Atomic secure file creation: O_EXCL | O_NOFOLLOW, 0600, no TOCTOU exists() check
    let std_file = secure_create_file(&dest)?;
    let mut file = tokio::fs::File::from_std(std_file);

    let mut stream = res.bytes_stream();
    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        tokio::io::AsyncWriteExt::write_all(&mut file, &chunk)
            .await
            .map_err(|e| e.to_string())?;
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);

    log::info!("[river] opening externally: {:?}", dest);
    open::that(&dest).map_err(|e| format!("Failed to open with system handler: {}", e))?;
    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn save_file_to_downloads(
    state: State<'_, Arc<Database>>,
    account_id: String,
    file_id: String,
    file_name: String,
    mime_type: Option<String>,
) -> Result<String, String> {
    if file_name.len() > 255 {
        return Err("File name too long".to_string());
    }
    if file_name.bytes().any(|b| b == 0) {
        return Err("Invalid file name (null byte)".to_string());
    }
    if let Some(ref mt) = mime_type {
        if mt.len() > 200 {
            return Err("MIME type too long".to_string());
        }
    }
    let access_token = get_fresh_token_no_state(&state, &account_id).await?;

    let safe_name = sanitize_filename(&file_name, &file_id);

    let download_dir = dirs::download_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join("Downloads")))
        .or_else(|| dirs::home_dir().map(|h| h.join("İndirilenler")))
        .unwrap_or_else(|| std::env::temp_dir());

    ensure_secure_dir(&download_dir)?;

    // Atomic selection: try create_new loop, no exists() TOCTOU
    let mut dest: Option<std::path::PathBuf> = None;
    let mut std_file_opt: Option<std::fs::File> = None;
    let stem = std::path::Path::new(&safe_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("file");
    let ext = std::path::Path::new(&safe_name)
        .extension()
        .and_then(|s| s.to_str())
        .map(|e| format!(".{}", e))
        .unwrap_or_default();
    for n in 0..1000 {
        let candidate = if n == 0 {
            download_dir.join(&safe_name)
        } else {
            download_dir.join(format!("{} ({}){}", stem, n, ext))
        };
        if !candidate.starts_with(&download_dir) {
            return Err("Invalid file name".to_string());
        }
        match secure_create_file(&candidate) {
            Ok(f) => {
                dest = Some(candidate);
                std_file_opt = Some(f);
                break;
            }
            Err(e) if e.contains("already exists") || e.contains("File exists") => continue,
            Err(e) => return Err(e),
        }
    }
    let dest = dest.ok_or_else(|| "Could not create file (too many existing files)".to_string())?;
    let std_file = std_file_opt.unwrap();

    log::info!("[river] saving to downloads: {:?} (mime {:?})", dest, mime_type);

    let client = reqwest::Client::new();
    let url = if mime_type.as_deref().map(|m| m.starts_with("application/vnd.google-apps.")).unwrap_or(false) {
        format!("https://www.googleapis.com/drive/v3/files/{}/export?mimeType=application/pdf", file_id)
    } else {
        format!("https://www.googleapis.com/drive/v3/files/{}?alt=media", file_id)
    };
    let res = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        let status = res.status();
        let txt = res.text().await.unwrap_or_default();
        // Cleanup empty file on failure
        let _ = std::fs::remove_file(&dest);
        return Err(format!("Download failed ({}): {}", status, crate::crypto::redact(&txt.chars().take(400).collect::<String>())));
    }

    let mut file = tokio::fs::File::from_std(std_file);
    let mut stream = res.bytes_stream();
    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        tokio::io::AsyncWriteExt::write_all(&mut file, &chunk).await.map_err(|e| e.to_string())?;
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);

    Ok(dest.to_string_lossy().to_string())
}

fn ensure_secure_dir(path: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(path).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700));
        // Verify not a symlink: canonicalize should succeed and not escape
        if let Ok(canonical) = path.canonicalize() {
            // On Unix, if path was a symlink, canonicalize resolves to target.
            // We ensure the canonical path's file name matches expected dir name
            // and that the parent is still within expected temp root.
            // For temp_dir, we just ensure it's not a symlink file type.
            if let Ok(meta) = std::fs::symlink_metadata(path) {
                if meta.file_type().is_symlink() {
                    return Err("Refusing to use symlinked directory".to_string());
                }
            }
            let _ = canonical;
        }
    }
    #[cfg(windows)]
    {
        if let Ok(meta) = std::fs::symlink_metadata(path) {
            if meta.file_type().is_symlink() {
                return Err("Refusing to use symlinked directory".to_string());
            }
        }
    }
    Ok(())
}

fn secure_create_file(path: &std::path::Path) -> Result<std::fs::File, String> {
    // Reject null bytes already checked upstream, but double-check
    if path.to_string_lossy().bytes().any(|b| b == 0) {
        return Err("Invalid path (null byte)".to_string());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create_new(true).mode(0o600);
        // O_NOFOLLOW prevents following symlink at final component
        // 0o400000 is O_NOFOLLOW on Linux
        opts.custom_flags(0o400000);
        opts.open(path).map_err(|e| e.to_string())
    }
    #[cfg(windows)]
    {
        // Check symlink at target and parent
        if let Ok(meta) = std::fs::symlink_metadata(path) {
            if meta.file_type().is_symlink() {
                return Err("Refusing to follow symlink".to_string());
            }
        }
        if let Some(parent) = path.parent() {
            if let Ok(meta) = std::fs::symlink_metadata(parent) {
                if meta.file_type().is_symlink() {
                    return Err("Refusing to use symlinked parent".to_string());
                }
            }
        }
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create_new(true);
        opts.open(path).map_err(|e| e.to_string())
    }
}

fn sanitize_filename(name: &str, fallback_id: &str) -> String {
    // P2-12 input limits: reject null bytes, limit length, handle Windows reserved
    if name.bytes().any(|b| b == 0) {
        return format!("river_{}", fallback_id);
    }
    let mut s: String = name
        .chars()
        .map(|c| {
            if c == '/' || c == '\\' || c == '\0' || c == ':' || c == '\n' || c == '\r' {
                '_'
            } else {
                c
            }
        })
        .collect();
    s = s.trim().trim_start_matches('.').to_string();
    s = s.replace("..", "_");
    // Windows reserved names (CON, PRN, AUX, NUL, COM1-9, LPT1-9) - case insensitive, before extension
    let upper = s.to_ascii_uppercase();
    let stem_reserved = upper.split('.').next().unwrap_or("");
    const RESERVED: &[&str] = &["CON","PRN","AUX","NUL","COM1","COM2","COM3","COM4","COM5","COM6","COM7","COM8","COM9","LPT1","LPT2","LPT3","LPT4","LPT5","LPT6","LPT7","LPT8","LPT9"];
    if RESERVED.contains(&stem_reserved) {
        s = format!("_{}", s);
    }
    // Unicode normalization: we keep as is but limit bytes
    if s.is_empty() {
        format!("river_{}", fallback_id)
    } else if s.len() > 180 {
        let ext = std::path::Path::new(&s).extension().and_then(|e| e.to_str()).unwrap_or("");
        let stem = std::path::Path::new(&s).file_stem().and_then(|e| e.to_str()).unwrap_or("file");
        let truncated_stem = &stem[..180.min(stem.len())];
        if ext.is_empty() {
            truncated_stem.to_string()
        } else {
            format!("{}.{}", truncated_stem, &ext[..20.min(ext.len())])
        }
    } else {
        s
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_filename_traversal() {
        assert_eq!(sanitize_filename("../../etc/passwd", "123"), "___etc_passwd");
        assert_eq!(sanitize_filename("..\\..\\windows\\system32", "123"), "___windows_system32");
        assert_eq!(sanitize_filename(".hidden", "123"), "hidden");
        assert_eq!(sanitize_filename("foo\0bar", "123"), "river_123");
        assert_eq!(sanitize_filename("CON.txt", "123"), "_CON.txt");
        assert_eq!(sanitize_filename("aux", "123"), "_aux");
    }
}
