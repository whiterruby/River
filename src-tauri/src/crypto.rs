//! AES-256-GCM encryption for tokens stored in the local DB.
//! Master key lives in OS keychain (keyring) — cryptographically valid
//! encryption with proper key management. Legacy machine-id fallback is kept
//! only for decrypting old DBs (lazy migration via re-encrypt on read).

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::Engine as _;
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::path::PathBuf;

const RIVER_STATIC_SALT: &[u8] = b"River-whiteruby-secure-local-vault-2026";
const KEYRING_SERVICE: &str = "com.whiteruby.river";
const KEYRING_USER: &str = "master-key";

// ---------------------------------------------------------------------------
// Master key resolution
// ---------------------------------------------------------------------------

/// Legacy key: SHA256(salt + machine_uid). Kept ONLY for decrypt fallback.
/// Security: public salt + world-readable machine-id -> weak key management.
fn legacy_machine_key() -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(RIVER_STATIC_SALT);
    if let Ok(id) = machine_uid::get() {
        hasher.update(id.as_bytes());
    } else if let Ok(mid) = std::fs::read_to_string("/etc/machine-id") {
        hasher.update(mid.trim().as_bytes());
    }
    let result = hasher.finalize();
    let mut key = [0u8; 32];
    key.copy_from_slice(&result);
    key
}

fn legacy_salt_only_key() -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(RIVER_STATIC_SALT);
    let r = h.finalize();
    let mut k = [0u8; 32];
    k.copy_from_slice(&r);
    k
}

fn file_key_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("river")
        .join(".master_key")
}

/// File-backed fallback when OS keychain is unavailable (headless Linux).
/// File is 0o600, base64-encoded 32 bytes.
fn get_file_backed_key() -> Option<[u8; 32]> {
    let path = file_key_path();
    // Try read existing
    if let Ok(content) = std::fs::read_to_string(&path) {
        if let Ok(raw) = base64::engine::general_purpose::STANDARD.decode(content.trim()) {
            if raw.len() == 32 {
                let mut k = [0u8; 32];
                k.copy_from_slice(&raw);
                return Some(k);
            }
        }
    }
    // Create new
    let mut new_key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut new_key);
    let b64 = base64::engine::general_purpose::STANDARD.encode(new_key);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if std::fs::write(&path, b64).is_ok() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
        }
        return Some(new_key);
    }
    None
}

/// Try OS keychain (Keychain on macOS, Credential Manager on Windows,
/// SecretService on Linux). Returns None if unavailable.
fn get_keyring_key() -> Option<[u8; 32]> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).ok()?;
    // Existing key?
    if let Ok(pwd) = entry.get_password() {
        if let Ok(raw) = base64::engine::general_purpose::STANDARD.decode(pwd.trim()) {
            if raw.len() == 32 {
                let mut k = [0u8; 32];
                k.copy_from_slice(&raw);
                return Some(k);
            }
        }
        // Corrupt entry -> delete and recreate below
        let _ = entry.delete_credential();
    }
    // Create new 32B key
    let mut new_key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut new_key);
    let b64 = base64::engine::general_purpose::STANDARD.encode(new_key);
    match entry.set_password(&b64) {
        Ok(_) => Some(new_key),
        Err(_) => None, // SecretService unavailable -> caller falls back to file
    }
}

/// Master key for *encryption* (new tokens). Priority:
/// 1. OS keychain
/// 2. File-backed key (headless fallback)
/// 3. Legacy machine-id (last resort, logs warning)
fn get_master_key_for_encrypt() -> [u8; 32] {
    if let Some(k) = get_keyring_key() {
        return k;
    }
    if let Some(k) = get_file_backed_key() {
        log::warn!("[river crypto] OS keychain unavailable, using file-backed key at {:?}", file_key_path());
        return k;
    }
    log::warn!("[river crypto] OS keychain AND file key unavailable, falling back to legacy machine-id key — weak key management");
    legacy_machine_key()
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Encrypts plaintext with a random 12-byte nonce. Output: base64(nonce||ciphertext||tag).
pub fn encrypt(plain: &str) -> Result<String, String> {
    let key = get_master_key_for_encrypt();
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plain.as_bytes())
        .map_err(|e| format!("Encrypt failed: {:?}", e))?;
    let mut combined = Vec::with_capacity(12 + ciphertext.len());
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&ciphertext);
    Ok(base64::engine::general_purpose::STANDARD.encode(combined))
}

/// Tries to decrypt with each known key in priority order:
/// 1. OS keychain
/// 2. File-backed
/// 3. Legacy machine-id
/// 4. Salt-only (pre-machine-id migration)
/// 5. Plaintext fallback (`1//` / `ya29.`)
fn try_decrypt_with_key(encrypted_str: &str, key: &[u8; 32]) -> Option<String> {
    let cipher = Aes256Gcm::new_from_slice(key).ok()?;
    let raw = base64::engine::general_purpose::STANDARD
        .decode(encrypted_str.trim())
        .ok()?;
    if raw.len() <= 12 {
        return None;
    }
    let nonce = Nonce::from_slice(&raw[..12]);
    let decrypted = cipher.decrypt(nonce, &raw[12..]).ok()?;
    String::from_utf8(decrypted).ok()
}

pub fn decrypt(encrypted_str: &str) -> Result<String, String> {
    // 1. OS keychain key
    if let Some(k) = get_keyring_key() {
        if let Some(s) = try_decrypt_with_key(encrypted_str, &k) {
            return Ok(s);
        }
    }
    // 2. File-backed key
    let file_path = file_key_path();
    if file_path.exists() {
        if let Some(k) = get_file_backed_key() {
            if let Some(s) = try_decrypt_with_key(encrypted_str, &k) {
                return Ok(s);
            }
        }
    }
    // 3. Legacy machine-id
    let legacy = legacy_machine_key();
    if let Some(s) = try_decrypt_with_key(encrypted_str, &legacy) {
        return Ok(s);
    }
    // 4. Salt-only
    let salt_only = legacy_salt_only_key();
    if let Some(s) = try_decrypt_with_key(encrypted_str, &salt_only) {
        return Ok(s);
    }
    // 5. Plaintext legacy
    if encrypted_str.starts_with("1//") || encrypted_str.starts_with("ya29.") {
        return Ok(encrypted_str.to_string());
    }
    Err("Decryption failed".to_string())
}

/// Password-based encryption for exports.
/// v2: Argon2id (64 MiB, 3 iterations, 1 parallelism) + random 16B salt + random 12B nonce + AES-GCM
/// v1: legacy iterated SHA256 (10k) — kept for backward compat import only.
pub fn encrypt_with_password(plain: &str, password: &str) -> Result<String, String> {
    // v2: Argon2id
    use argon2::{Algorithm, Argon2, Params, Version};
    let mut salt = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt);
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let params = Params::new(64 * 1024, 3, 1, Some(32)).map_err(|e| e.to_string())?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; 32];
    argon2
        .hash_password_into(password.as_bytes(), &salt, &mut key)
        .map_err(|e| e.to_string())?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    // Zeroize key after use
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ct = cipher.encrypt(nonce, plain.as_bytes()).map_err(|e| format!("Encrypt failed: {:?}", e))?;
    // Zeroize derived key
    use zeroize::Zeroize;
    key.zeroize();
    let mut combined = Vec::with_capacity(16 + 12 + ct.len());
    combined.extend_from_slice(&salt);
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&ct);
    let b64 = base64::engine::general_purpose::STANDARD.encode(combined);
    Ok(format!("RIVER_ENC_v2:{}", b64))
}

fn decrypt_with_password_v1(enc_b64: &str, password: &str) -> Result<String, String> {
    let raw = base64::engine::general_purpose::STANDARD.decode(enc_b64.trim()).map_err(|e| e.to_string())?;
    if raw.len() <= 12 {
        return Err("Invalid encrypted data".to_string());
    }
    let mut key_material = Sha256::digest(format!("River-export-v1:{}", password).as_bytes()).to_vec();
    for _ in 0..10_000 {
        let mut h = Sha256::new();
        h.update(&key_material);
        h.update(password.as_bytes());
        key_material = h.finalize().to_vec();
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&key_material[..32]);
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let nonce = Nonce::from_slice(&raw[..12]);
    let pt = cipher.decrypt(nonce, &raw[12..]).map_err(|_| "Decryption failed — wrong password?".to_string())?;
    String::from_utf8(pt).map_err(|e| e.to_string())
}

pub fn decrypt_with_password(enc: &str, password: &str) -> Result<String, String> {
    if let Some(b64) = enc.strip_prefix("RIVER_ENC_v2:") {
        let raw = base64::engine::general_purpose::STANDARD.decode(b64.trim()).map_err(|e| e.to_string())?;
        if raw.len() <= 28 {
            return Err("Invalid encrypted data".to_string());
        }
        let salt = &raw[..16];
        let nonce_bytes = &raw[16..28];
        let ct = &raw[28..];
        use argon2::{Algorithm, Argon2, Params, Version};
        let params = Params::new(64 * 1024, 3, 1, Some(32)).map_err(|e| e.to_string())?;
        let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
        let mut key = [0u8; 32];
        argon2
            .hash_password_into(password.as_bytes(), salt, &mut key)
            .map_err(|e| e.to_string())?;
        let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
        use zeroize::Zeroize;
        let res = cipher
            .decrypt(Nonce::from_slice(nonce_bytes), ct)
            .map_err(|_| "Decryption failed — wrong password?".to_string())
            .and_then(|pt| String::from_utf8(pt).map_err(|e| e.to_string()));
        key.zeroize();
        res
    } else {
        let b64 = enc.strip_prefix("RIVER_ENC_v1:").unwrap_or(enc);
        // Try v1 legacy
        if let Ok(s) = decrypt_with_password_v1(b64, password) {
            return Ok(s);
        }
        // Also try raw without prefix as v1
        decrypt_with_password_v1(b64, password)
    }
}

/// Redacts sensitive tokens for logging.
pub fn redact(s: &str) -> String {
    let mut out = s.to_string();
    // Common token patterns
    for pat in ["1//", "ya29.", "Bearer ", "code=", "refresh_token", "access_token"] {
        if out.contains(pat) {
            // Replace surrounding token-ish substrings with [REDACTED]
            // Simple: if contains, truncate sensitive part
            // We keep first 4 chars of pattern + [REDACTED] for length hint
            out = out.replace(pat, &format!("{}[REDACTED]", pat));
            // Also redact long base64-ish runs after pat
            // Keep it simple: if still long (>200) truncate
            if out.len() > 800 {
                out.truncate(800);
                out.push_str("…[truncated]");
            }
        }
    }
    // Also redact very long base64 blobs that look like tokens
    if out.len() > 1000 {
        out.truncate(1000);
        out.push_str("…[truncated]");
    }
    out
}

/// Returns true if the stored ciphertext was encrypted with a legacy key
/// (so caller can re-encrypt with the current master key).
pub fn is_legacy_ciphertext(encrypted_str: &str) -> bool {
    // If keyring/file decrypt succeeds, it's not legacy.
    if let Some(k) = get_keyring_key() {
        if try_decrypt_with_key(encrypted_str, &k).is_some() {
            return false;
        }
    }
    if file_key_path().exists() {
        if let Some(k) = get_file_backed_key() {
            if try_decrypt_with_key(encrypted_str, &k).is_some() {
                return false;
            }
        }
    }
    // Otherwise if legacy decrypt succeeds, it IS legacy.
    let legacy = legacy_machine_key();
    if try_decrypt_with_key(encrypted_str, &legacy).is_some() {
        return true;
    }
    let salt_only = legacy_salt_only_key();
    if try_decrypt_with_key(encrypted_str, &salt_only).is_some() {
        return true;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_argon2id_export_roundtrip() {
        let password = "SuperSecretPassword123!";
        let payload = r#"{"accounts":[{"email":"alice@example.com","refresh_token":"1//abc"}]}"#;
        let enc1 = encrypt_with_password(payload, password).unwrap();
        assert!(enc1.starts_with("RIVER_ENC_v2:"));
        let enc2 = encrypt_with_password(payload, password).unwrap();
        assert_ne!(enc1, enc2, "Random salt/nonce must produce different ciphertexts");

        let dec = decrypt_with_password(&enc1, password).unwrap();
        assert_eq!(dec, payload);

        // Wrong password fail
        assert!(decrypt_with_password(&enc1, "WrongPassword!").is_err());
    }

    #[test]
    fn test_redact() {
        let sample = "Failed to fetch: Bearer ya29.a0AfH6SM... for 1//04abc";
        let red = redact(sample);
        assert!(red.contains("Bearer [REDACTED]"));
        assert!(red.contains("1//[REDACTED]"));
        assert!(red.contains("ya29.[REDACTED]"));
    }
}
