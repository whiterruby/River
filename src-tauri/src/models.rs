//! Shared data models used across the IPC boundary (Rust <-> frontend)
//! and for JSON import/export.

use serde::{Deserialize, Serialize};

/// Core account record as exposed to the frontend.
/// Tokens are intentionally excluded -- they stay in the DB layer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DriveAccount {
    pub id: String,
    pub email: String,
    pub label: Option<String>,
    pub client_id: Option<String>,
    pub client_secret: Option<String>,
    pub scopes: Vec<String>,
    pub quota_used: i64,
    pub quota_total: i64,
    pub quota_updated_at: Option<i64>,
    /// One of: "active", "invalid", "revoked"
    pub status: String,
    pub last_error: Option<String>,
    pub avatar_url: Option<String>,
    pub is_enabled: bool,
    pub created_at: i64,
    pub last_used: Option<i64>,
}

/// Format for bulk-importing accounts from JSON.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DriveAccountImportItem {
    pub email: String,
    #[serde(alias = "token", alias = "refresh_token")]
    pub refresh_token: String,
    pub label: Option<String>,
    pub client_id: Option<String>,
    pub client_secret: Option<String>,
    pub scopes: Option<Vec<String>>,
    pub created_at: Option<String>,
    pub last_used: Option<String>,
}

/// Format for bulk-exporting accounts to JSON. Tokens are plaintext here
/// since the export file is meant to be portable.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DriveAccountExportItem {
    pub email: String,
    pub refresh_token: String,
    pub label: Option<String>,
    pub client_id: Option<String>,
    pub client_secret: Option<String>,
    pub scopes: Vec<String>,
    pub created_at: Option<String>,
    pub last_used: Option<String>,
}

/// Dashboard summary for the storage pool view.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrivePoolSummary {
    pub total_accounts: usize,
    pub active_accounts: usize,
    pub invalid_accounts: usize,
    #[serde(alias = "total_quota_bytes")]
    pub total_quota: i64,
    #[serde(alias = "used_quota_bytes")]
    pub used_quota: i64,
    #[serde(alias = "free_quota_bytes")]
    pub free_quota: i64,
    pub used_percentage: f64,
}

/// Single file/folder entry from Google Drive API v3.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DriveFile {
    pub id: String,
    pub name: String,
    pub mime_type: String,
    pub size: Option<i64>,
    pub modified_time: Option<String>,
    pub web_view_link: Option<String>,
    pub icon_link: Option<String>,
    pub thumbnail_link: Option<String>,
    pub parents: Option<Vec<String>>,
    pub is_folder: bool,
    /// Which account owns this file -- needed for multi-account views.
    pub account_id: String,
    pub account_email: String,
}

/// Cross-account search result payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub query: String,
    pub total_found: usize,
    pub files: Vec<DriveFile>,
    pub scanned_accounts: usize,
    pub errors: Vec<String>,
}
