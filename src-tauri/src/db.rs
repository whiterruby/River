//! SQLite persistence layer. All tokens are stored encrypted at rest.
//! The DB file lives under the platform config dir (e.g. ~/.config/river/).
//! On first run, legacy DB paths from older versions are auto-migrated.

use crate::crypto;
use crate::models::{DriveAccount, DriveAccountExportItem, DriveAccountImportItem, DrivePoolSummary};
use rusqlite::{params, Connection};
use std::path::PathBuf;
use std::sync::Mutex;
use uuid::Uuid;

pub struct Database {
    conn: Mutex<Connection>,
}

fn river_config_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("river")
}

fn encrypt_client_secret(plain: &Option<String>) -> Option<String> {
    plain.as_ref().and_then(|s| {
        let t = s.trim();
        if t.is_empty() {
            None
        } else {
            // Encrypt via OS keychain-backed AES-GCM; fallback to plaintext if encrypt fails
            crypto::encrypt(t).ok().or_else(|| Some(t.to_string()))
        }
    })
}

fn decrypt_client_secret(enc: Option<String>) -> Option<String> {
    enc.and_then(|s| {
        if s.trim().is_empty() {
            None
        } else if s.starts_with("GOCSPX-") || s.contains("apps.googleusercontent.com") {
            // Plaintext legacy
            Some(s)
        } else {
            match crypto::decrypt(&s) {
                Ok(pt) => Some(pt),
                Err(_) => {
                    // If decrypt fails but looks like plaintext, keep
                    if s.len() < 200 && (s.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == '.')) {
                        Some(s)
                    } else {
                        // Still return original as fallback (old plaintext)
                        Some(s)
                    }
                }
            }
        }
    })
}

/// Legacy DB locations from previous app names. Order matters --
/// first match wins the migration.
fn legacy_candidates() -> Vec<PathBuf> {
    let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    vec![
        base.join("river").join("drivegravity.db"),
        base.join("river").join("river.db"),
        base.join("drivegravity").join("drivegravity.db"),
        base.join("DriveGravity").join("drivegravity.sqlite"),
        base.join("drivegravity").join("drivegravity.sqlite"),
    ]
}

impl Database {
    /// Opens (or creates) the DB, migrating from legacy paths if needed.
    /// Sets WAL mode for better concurrent read performance.
    pub fn init() -> Result<Self, String> {
        let app_dir = river_config_dir();
        std::fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;

        let db_path = app_dir.join("river.db");

        // Migrate: copy the first matching legacy DB if our canonical path
        // doesn't exist yet. WAL and SHM files are copied alongside.
        if !db_path.exists() {
            for cand in legacy_candidates() {
                if cand.exists() && cand != db_path {
                    let _ = std::fs::copy(&cand, &db_path);
                    let wal = cand.with_extension("db-wal");
                    if wal.exists() {
                        let _ = std::fs::copy(wal, db_path.with_extension("db-wal"));
                    }
                    let shm = cand.with_extension("db-shm");
                    if shm.exists() {
                        let _ = std::fs::copy(shm, db_path.with_extension("db-shm"));
                    }
                    break;
                }
            }
        }

        let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

        let _ = conn.execute("PRAGMA journal_mode=WAL;", []);
        let _ = conn.execute("PRAGMA synchronous=NORMAL;", []);
        let _ = conn.execute("PRAGMA secure_delete=ON;", []);
        let _ = conn.execute("PRAGMA auto_vacuum=INCREMENTAL;", []);

        conn.execute(
            "CREATE TABLE IF NOT EXISTS drive_accounts (
                id TEXT PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                encrypted_refresh_token TEXT NOT NULL,
                encrypted_access_token TEXT,
                token_expiry INTEGER,
                label TEXT,
                client_id TEXT,
                client_secret TEXT,
                scopes TEXT,
                quota_used INTEGER DEFAULT 0,
                quota_total INTEGER DEFAULT 0,
                quota_updated_at INTEGER,
                status TEXT DEFAULT 'active',
                last_error TEXT,
                avatar_url TEXT,
                is_enabled INTEGER DEFAULT 1,
                created_at INTEGER NOT NULL,
                last_used INTEGER
            )",
            [],
        )
        .map_err(|e| e.to_string())?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )",
            [],
        )
        .map_err(|e| e.to_string())?;

        // SECURITY: restrict DB file permissions to owner-only on unix.
        // The file contains encrypted tokens.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&db_path, std::fs::Permissions::from_mode(0o600));
        }

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Returns all accounts. Sensitive fields (tokens, client_secret) are NOT included
    /// in the frontend response — they are fetched separately on demand via get_account_refresh_token.
    pub fn get_all_accounts(&self) -> Result<Vec<DriveAccount>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, email, label, client_id, scopes, quota_used, quota_total,
                        quota_updated_at, status, last_error, avatar_url, is_enabled, created_at, last_used
                 FROM drive_accounts ORDER BY created_at DESC",
            )
            .map_err(|e| e.to_string())?;

        let accounts = stmt
            .query_map([], |row| {
                let scopes_str: Option<String> = row.get(4)?;
                let scopes = scopes_str
                    .and_then(|s| serde_json::from_str(&s).ok())
                    .unwrap_or_else(|| vec!["https://www.googleapis.com/auth/drive".to_string()]);

                Ok(DriveAccount {
                    id: row.get(0)?,
                    email: row.get(1)?,
                    label: row.get(2)?,
                    client_id: row.get(3)?,
                    client_secret: None, // never expose to frontend
                    scopes,
                    quota_used: row.get(5)?,
                    quota_total: row.get(6)?,
                    quota_updated_at: row.get(7)?,
                    status: row.get(8)?,
                    last_error: row.get(9)?,
                    avatar_url: row.get(10)?,
                    is_enabled: row.get::<_, i32>(11)? == 1,
                    created_at: row.get(12)?,
                    last_used: row.get(13)?,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();

        Ok(accounts)
    }

    /// Decrypts and returns the cached access token for an account.
    pub fn get_account_access_token(&self, id: &str) -> Result<String, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT encrypted_access_token FROM drive_accounts WHERE id = ?1")
            .map_err(|e| e.to_string())?;

        let enc_token: String = stmt
            .query_row(params![id], |row| row.get(0))
            .map_err(|e| format!("Account not found: {}", e))?;

        crypto::decrypt(&enc_token)
    }

    /// Returns (decrypted_refresh_token, client_id, client_secret) for token refresh.
    pub fn get_account_refresh_token(&self, id: &str) -> Result<(String, Option<String>, Option<String>), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT encrypted_refresh_token, client_id, client_secret FROM drive_accounts WHERE id = ?1")
            .map_err(|e| e.to_string())?;

        let (enc_token, client_id, enc_secret): (String, Option<String>, Option<String>) = stmt
            .query_row(params![id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .map_err(|e| format!("Account not found: {}", e))?;

        let token = crypto::decrypt(&enc_token)?;
        let client_secret = decrypt_client_secret(enc_secret);
        Ok((token, client_id, client_secret))
    }

    /// Re-encrypts a refresh token if the ciphertext changed (e.g. after a
    /// machine-id rotation or crypto key upgrade). Called opportunistically
    /// during export.
    fn maybe_reencrypt_token(&self, id: &str, enc_old: &str, plain: &str) {
        if let Ok(enc_new) = crypto::encrypt(plain) {
            if enc_new != enc_old {
                if let Ok(conn) = self.conn.lock() {
                    let _ = conn.execute(
                        "UPDATE drive_accounts SET encrypted_refresh_token = ?1 WHERE id = ?2",
                        params![enc_new, id],
                    );
                }
            }
        }
    }

    /// Bulk import. Returns (inserted_count, updated_count, per-item_errors).
    /// Existing accounts (matched by email) get their tokens updated.
    pub fn import_accounts(&self, items: Vec<DriveAccountImportItem>) -> Result<(usize, usize, Vec<String>), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut imported = 0;
        let mut updated = 0;
        let mut errors = Vec::new();
        let now = chrono::Utc::now().timestamp();

        for item in items {
            let email = item.email.trim().to_lowercase();
            // P2-12 input limits + validation
            if email.len() > 254 || !email.contains('@') || email.contains('\0') || email.contains('\n') {
                errors.push(format!("{}: Invalid email", email.chars().take(50).collect::<String>()));
                continue;
            }
            if let Some(ref l) = item.label {
                if l.len() > 100 || l.bytes().any(|b| b == 0) {
                    errors.push(format!("{}: Label too long or contains null byte", email));
                    continue;
                }
            }
            if let Some(ref cid) = item.client_id {
                if cid.len() > 300 || cid.bytes().any(|b| b == 0) {
                    errors.push(format!("{}: client_id too long", email));
                    continue;
                }
                if !cid.contains("apps.googleusercontent.com") && !cid.is_empty() {
                    // Allow empty, but if present should look like Google client_id
                    // We don't strictly reject to keep backward compat, just warn via error if obviously invalid
                    if cid.len() < 10 || cid.contains('\0') {
                        errors.push(format!("{}: Invalid client_id format", email));
                        continue;
                    }
                }
            }
            if let Some(ref cs) = item.client_secret {
                if cs.len() > 500 || cs.bytes().any(|b| b == 0) {
                    errors.push(format!("{}: client_secret too long", email));
                    continue;
                }
            }
            let token = item.refresh_token.trim().to_string();
            if token.len() > 4096 || token.bytes().any(|b| b == 0) {
                errors.push(format!("{}: Refresh token too long", email));
                continue;
            }
            // Basic sanity check -- Google refresh tokens always start with "1//"
            if !token.starts_with("1//") {
                errors.push(format!("{}: Refresh token must start with '1//'", email));
                continue;
            }

            let enc_token = match crypto::encrypt(&token) {
                Ok(t) => t,
                Err(e) => {
                    errors.push(format!("{}: Encryption error {}", email, e));
                    continue;
                }
            };

            let enc_client_secret = encrypt_client_secret(&item.client_secret);
            let scopes_json = serde_json::to_string(&item.scopes.unwrap_or_else(|| vec!["https://www.googleapis.com/auth/drive".to_string()])).unwrap();

            let mut check_stmt = conn.prepare("SELECT id FROM drive_accounts WHERE email = ?1").map_err(|e| e.to_string())?;
            let exists = check_stmt.exists(params![&email]).map_err(|e| e.to_string())?;

            if exists {
                conn.execute(
                    "UPDATE drive_accounts SET encrypted_refresh_token = ?1, label = COALESCE(?2, label),
                            client_id = COALESCE(?3, client_id), client_secret = COALESCE(?4, client_secret),
                            scopes = ?5, status = 'active', last_error = NULL
                     WHERE email = ?6",
                    params![&enc_token, &item.label, &item.client_id, &enc_client_secret, &scopes_json, &email],
                ).map_err(|e| e.to_string())?;
                updated += 1;
            } else {
                let id = Uuid::new_v4().to_string();
                conn.execute(
                    "INSERT INTO drive_accounts (id, email, encrypted_refresh_token, label, client_id, client_secret, scopes, created_at, status)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'active')",
                    params![&id, &email, &enc_token, &item.label, &item.client_id, &enc_client_secret, &scopes_json, now],
                ).map_err(|e| e.to_string())?;
                imported += 1;
            }
        }

        Ok((imported, updated, errors))
    }

    /// Exports accounts as plaintext JSON. Tokens are decrypted on the fly.
    /// Optionally filtered by a list of account IDs; None means export all.
    pub fn export_accounts(&self, account_ids: Option<Vec<String>>) -> Result<Vec<DriveAccountExportItem>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut query = "SELECT id, email, encrypted_refresh_token, label, client_id, client_secret, scopes, created_at, last_used FROM drive_accounts".to_string();

        if let Some(ref ids) = account_ids {
            if !ids.is_empty() {
                let placeholders: Vec<String> = ids.iter().map(|_| "?".to_string()).collect();
                query.push_str(&format!(" WHERE id IN ({})", placeholders.join(",")));
            }
        }

        let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
        let rows = if let Some(ids) = account_ids {
            if !ids.is_empty() {
                let params_vec: Vec<&dyn rusqlite::ToSql> = ids.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
                stmt.query_map(rusqlite::params_from_iter(params_vec), |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, Option<String>>(4)?,
                        row.get::<_, Option<String>>(5)?,
                        row.get::<_, Option<String>>(6)?,
                        row.get::<_, i64>(7)?,
                        row.get::<_, Option<i64>>(8)?,
                    ))
                }).map_err(|e| e.to_string())?.filter_map(Result::ok).collect::<Vec<_>>()
            } else {
                Vec::new()
            }
        } else {
            stmt.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, i64>(7)?,
                    row.get::<_, Option<i64>>(8)?,
                ))
            }).map_err(|e| e.to_string())?.filter_map(Result::ok).collect::<Vec<_>>()
        };

        let mut export_items = Vec::new();
        for (id, email, enc_token, label, client_id, enc_secret, scopes_str, created_at, last_used) in rows {
            if let Ok(token) = crypto::decrypt(&enc_token) {
                // Opportunistically re-encrypt if the key material changed.
                self.maybe_reencrypt_token(&id, &enc_token, &token);
                let client_secret = decrypt_client_secret(enc_secret);
                let scopes = scopes_str
                    .and_then(|s| serde_json::from_str(&s).ok())
                    .unwrap_or_else(|| vec!["https://www.googleapis.com/auth/drive".to_string()]);

                let created_at_iso = chrono::DateTime::from_timestamp(created_at, 0)
                    .map(|dt| dt.to_rfc3339());
                let last_used_iso = last_used
                    .and_then(|ts| chrono::DateTime::from_timestamp(ts, 0))
                    .map(|dt| dt.to_rfc3339());

                export_items.push(DriveAccountExportItem {
                    email,
                    refresh_token: token,
                    label,
                    client_id,
                    client_secret,
                    scopes,
                    created_at: created_at_iso,
                    last_used: last_used_iso,
                });
            }
        }

        Ok(export_items)
    }

    pub fn update_quota(&self, id: &str, used: i64, total: i64) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = chrono::Utc::now().timestamp();
        conn.execute(
            "UPDATE drive_accounts SET quota_used = ?1, quota_total = ?2, quota_updated_at = ?3, status = 'active', last_error = NULL WHERE id = ?4",
            params![used, total, now, id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Stores a freshly refreshed access token. The token is already encrypted
    /// by the caller.
    pub fn update_access_token(&self, id: &str, enc_access: &str, expiry: i64) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = chrono::Utc::now().timestamp();
        conn.execute(
            "UPDATE drive_accounts SET encrypted_access_token = ?1, token_expiry = ?2, last_used = ?3 WHERE id = ?4",
            params![enc_access, expiry, now, id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn set_account_status(&self, id: &str, status: &str, error: Option<&str>) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE drive_accounts SET status = ?1, last_error = ?2 WHERE id = ?3",
            params![status, error, id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_account(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        // Overwrite sensitive fields before delete to reduce forensic residue (WAL)
        let _ = conn.execute(
            "UPDATE drive_accounts SET encrypted_refresh_token = randomblob(32), encrypted_access_token = randomblob(32), client_secret = randomblob(16), label = NULL WHERE id = ?1",
            params![id],
        );
        conn.execute("DELETE FROM drive_accounts WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        // Checkpoint WAL to truncate, but not full VACUUM (avoid perf hit)
        let _ = conn.execute("PRAGMA wal_checkpoint(TRUNCATE);", []);
        Ok(())
    }

    pub fn toggle_account(&self, id: &str, enabled: bool) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let val = if enabled { 1 } else { 0 };
        conn.execute(
            "UPDATE drive_accounts SET is_enabled = ?1 WHERE id = ?2",
            params![val, id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn update_label(&self, id: &str, label: Option<String>) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE drive_accounts SET label = ?1 WHERE id = ?2",
            params![label, id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_settings(&self) -> Result<std::collections::HashMap<String, String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare("SELECT key, value FROM settings").map_err(|e| e.to_string())?;
        let mut map = std::collections::HashMap::new();
        let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))).map_err(|e| e.to_string())?;
        for r in rows.flatten() {
            map.insert(r.0, r.1);
        }
        Ok(map)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            params![key, value],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Persists a newly OAuth-authenticated account.
    pub fn insert_oauth_account(
        &self,
        id: &str,
        email: &str,
        enc_refresh: &str,
        enc_access: &str,
        token_expiry: i64,
        avatar_url: Option<&str>,
        client_id: &str,
        client_secret: &str,
        created_at: i64,
    ) -> Result<(), String> {
        let enc_secret = encrypt_client_secret(&Some(client_secret.to_string())).unwrap_or_else(|| client_secret.to_string());
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO drive_accounts (id, email, encrypted_refresh_token, encrypted_access_token, token_expiry, label, client_id, client_secret, scopes, quota_used, quota_total, quota_updated_at, status, last_error, avatar_url, is_enabled, created_at, last_used)
             VALUES (?1, ?2, ?3, ?4, ?5, '', ?6, ?7, ?8, 0, 0, 0, 'active', NULL, ?9, 1, ?10, ?10)",
            params![
                id,
                email,
                enc_refresh,
                enc_access,
                token_expiry,
                client_id,
                enc_secret,
                serde_json::to_string(&vec!["https://www.googleapis.com/auth/drive".to_string()]).unwrap(),
                avatar_url,
                created_at
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Updates avatar and OAuth client credentials for an existing account.
    pub fn set_oauth_account_meta(
        &self,
        id: &str,
        avatar_url: &Option<String>,
        client_id: &str,
        client_secret: &str,
    ) -> Result<(), String> {
        let enc_secret = encrypt_client_secret(&Some(client_secret.to_string())).unwrap_or_else(|| client_secret.to_string());
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE drive_accounts SET avatar_url = COALESCE(?1, avatar_url), client_id = ?2, client_secret = ?3 WHERE id = ?4",
            params![avatar_url, client_id, enc_secret, id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Full token rotation -- called after a successful OAuth re-auth to
    /// replace both refresh and access tokens atomically.
    pub fn update_oauth_tokens(
        &self,
        id: &str,
        enc_refresh: &str,
        enc_access: &str,
        expiry: i64,
        avatar_url: &Option<String>,
        client_id: &str,
        client_secret: &str,
    ) -> Result<(), String> {
        let enc_secret = encrypt_client_secret(&Some(client_secret.to_string())).unwrap_or_else(|| client_secret.to_string());
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = chrono::Utc::now().timestamp();
        conn.execute(
            "UPDATE drive_accounts SET encrypted_refresh_token = ?1, encrypted_access_token = ?2, token_expiry = ?3, avatar_url = COALESCE(?4, avatar_url), client_id = ?5, client_secret = ?6, status = 'active', last_error = NULL, last_used = ?7 WHERE id = ?8",
            params![enc_refresh, enc_access, expiry, avatar_url, client_id, enc_secret, now, id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Aggregates quota info across all enabled accounts for the dashboard.
    pub fn get_pool_summary(&self) -> Result<DrivePoolSummary, String> {
        let accounts = self.get_all_accounts()?;
        let total_accounts = accounts.len();
        let active_accounts = accounts.iter().filter(|a| a.is_enabled && a.status == "active").count();
        let invalid_accounts = accounts.iter().filter(|a| a.status == "invalid" || a.status == "revoked").count();

        let mut total_quota: i64 = 0;
        let mut used_quota: i64 = 0;

        for acc in &accounts {
            if acc.is_enabled {
                total_quota += acc.quota_total;
                used_quota += acc.quota_used;
            }
        }

        let free_quota = (total_quota - used_quota).max(0);
        let used_percentage = if total_quota > 0 {
            (used_quota as f64 / total_quota as f64) * 100.0
        } else {
            0.0
        };

        Ok(DrivePoolSummary {
            total_accounts,
            active_accounts,
            invalid_accounts,
            total_quota,
            used_quota,
            free_quota,
            used_percentage,
        })
    }
}
