//! Root library crate. Wires up the Tauri app, the local streaming server,
//! and all IPC command handlers.

pub mod commands;
pub mod crypto;
pub mod db;
#[cfg(target_os = "linux")]
pub mod fuse_mount;

#[cfg(not(target_os = "linux"))]
pub mod fuse_mount {
    use crate::db::Database;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;

    pub fn mount_pool(
        _db: Arc<Database>,
        _mountpoint: &str,
        _rt: tokio::runtime::Handle,
        _shutdown: Arc<AtomicBool>,
    ) -> Result<(), String> {
        Err("Virtual disk mounting is currently supported on Linux via FUSE3".into())
    }

    pub fn unmount_pool(_mountpoint: &str) -> Result<(), String> {
        Ok(())
    }
}
pub mod google_api;
pub mod models;
pub mod oauth;
pub mod server;

use commands::*;
use db::Database;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// Holds the ephemeral port the stream server ended up binding to.
pub struct StreamPort(pub u16);
/// Ephemeral bearer token required for /stream/* requests.
pub struct StreamToken(pub String);
/// Pool mount state — tracks whether the FUSE mount is active.
pub struct MountState {
    pub active: Arc<AtomicBool>,
    pub mountpoint: std::sync::Mutex<String>,
    pub shutdown: Arc<AtomicBool>,
}

#[tauri::command]
fn get_stream_port(port: tauri::State<'_, StreamPort>) -> u16 {
    port.0
}

#[tauri::command]
fn get_stream_token(token: tauri::State<'_, StreamToken>) -> String {
    token.0.clone()
}

#[tauri::command]
fn get_stream_creds(
    port: tauri::State<'_, StreamPort>,
    token: tauri::State<'_, StreamToken>,
) -> serde_json::Value {
    serde_json::json!({ "port": port.0, "token": token.0.clone() })
}

#[tauri::command]
fn mount_pool_drive(
    db: tauri::State<'_, Arc<Database>>,
    mount_state: tauri::State<'_, Arc<MountState>>,
    mountpoint: Option<String>,
) -> Result<String, String> {
    if mount_state.active.load(Ordering::SeqCst) {
        return Err("Pool is already mounted".into());
    }

    let mp = mountpoint.unwrap_or_else(|| {
        let home = dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("/tmp"));
        home.join("RiverPool").to_string_lossy().to_string()
    });

    let db_clone = db.inner().clone();
    let mp_clone = mp.clone();
    let shutdown = mount_state.shutdown.clone();
    let active_flag = mount_state.active.clone();

    // Store mountpoint
    *mount_state.mountpoint.lock().unwrap() = mp.clone();

    shutdown.store(false, Ordering::SeqCst);
    active_flag.store(true, Ordering::SeqCst);

    let (tx, rx) = std::sync::mpsc::channel();

    std::thread::Builder::new()
        .name("river-fuse".into())
        .spawn(move || {
            let rt = tokio::runtime::Runtime::new().expect("FUSE tokio runtime");
            let handle = rt.handle().clone();
            
            // Try to mount - fuser::mount2 blocks until unmounted or errors immediately
            let res = fuse_mount::mount_pool(db_clone, &mp_clone, handle, shutdown);
            if let Err(ref e) = res {
                log::error!("[RiverFS] Mount error: {}", e);
                let _ = tx.send(Err(e.clone()));
            } else {
                let _ = tx.send(Ok(()));
            }
            active_flag.store(false, Ordering::SeqCst);
        })
        .map_err(|e| format!("Failed to spawn FUSE thread: {}", e))?;

    // Wait up to 1500ms to see if mount fails immediately
    match rx.recv_timeout(std::time::Duration::from_millis(1500)) {
        Ok(Err(e)) => {
            mount_state.active.store(false, Ordering::SeqCst);
            return Err(e);
        }
        _ => {}
    }

    // Verify mountpoint exists in mount table or is actively mounted
    let is_mounted = std::process::Command::new("findmnt")
        .arg(&mp)
        .output()
        .map(|o| o.status.success() && !o.stdout.is_empty())
        .unwrap_or(true);

    if !is_mounted && !mount_state.active.load(Ordering::SeqCst) {
        mount_state.active.store(false, Ordering::SeqCst);
        return Err("Mount process failed to bind directory".into());
    }

    Ok(mp)
}

#[tauri::command]
fn unmount_pool_drive(
    mount_state: tauri::State<'_, Arc<MountState>>,
) -> Result<(), String> {
    mount_state.shutdown.store(true, Ordering::SeqCst);
    let mp = mount_state.mountpoint.lock().unwrap().clone();
    let res = if !mp.is_empty() {
        fuse_mount::unmount_pool(&mp)
    } else {
        let home = dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("/tmp"));
        let default_mp = home.join("RiverPool").to_string_lossy().to_string();
        fuse_mount::unmount_pool(&default_mp)
    };
    mount_state.active.store(false, Ordering::SeqCst);
    res
}

#[tauri::command]
fn get_mount_status(
    mount_state: tauri::State<'_, Arc<MountState>>,
) -> serde_json::Value {
    let active = mount_state.active.load(Ordering::SeqCst);
    let mp = mount_state.mountpoint.lock().unwrap().clone();
    serde_json::json!({
        "mounted": active,
        "mountpoint": if active { mp } else { String::new() }
    })
}

/// Bootstrap sequence:
/// 1. Init SQLite (or migrate from legacy DB path)
/// 2. Spin up a background tokio runtime for the axum stream server (127.0.0.1:0, auth token)
/// 3. Pass the resolved port+token into Tauri managed state
/// 4. Launch the Tauri webview
pub fn run() {
    // Init logger — respects RUST_LOG, defaults to info
    let _ = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("river=info")).try_init();

    let db = Arc::new(Database::init().expect("Failed to initialize database"));

    let (tx, rx) = std::sync::mpsc::channel::<(u16, String)>();
    let db_for_server = db.clone();

    // Ephemeral stream token (32B random, base64url)
    let stream_token = {
        use base64::Engine as _;
        use rand::RngCore;
        let mut bytes = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut bytes);
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
    };
    let stream_token_clone = stream_token.clone();

    // The stream server needs its own tokio runtime because Tauri's main
    // thread is synchronous. We keep the runtime alive with a sleep loop.
    std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");
        rt.block_on(async move {
            let port = server::start_stream_server(db_for_server, stream_token_clone.clone()).await;
            let _ = tx.send((port, stream_token_clone));
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(3600)).await;
            }
        });
    });

    let (port, token) = rx.recv().expect("Failed to get stream server creds");

    let mount_state = Arc::new(MountState {
        active: Arc::new(AtomicBool::new(false)),
        mountpoint: std::sync::Mutex::new(String::new()),
        shutdown: Arc::new(AtomicBool::new(false)),
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(db)
        .manage(StreamPort(port))
        .manage(StreamToken(token))
        .manage(mount_state)
        .invoke_handler(tauri::generate_handler![
            get_accounts,
            get_pool_summary,
            import_accounts,
            export_accounts,
            export_accounts_encrypted,
            import_accounts_encrypted,
            delete_account,
            toggle_account,
            update_account_label,
            refresh_account_quota,
            refresh_all_quotas,
            list_account_files,
            search_all_accounts,
            start_google_oauth,
            get_settings,
            set_setting,
            open_url,
            download_file,
            upload_file_buffer,
            create_folder,
            delete_file,
            open_file_externally,
            save_file_to_downloads,
            get_stream_port,
            get_stream_token,
            get_stream_creds,
            mount_pool_drive,
            unmount_pool_drive,
            get_mount_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
