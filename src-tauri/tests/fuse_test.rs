use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::time::Duration;

#[test]
fn test_fuse_mount_smoke() {
    let db = river_lib::db::Database::init().expect("db init");
    let db_arc = Arc::new(db);
    
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let mount_dir = temp_dir.path().join("mount_point");
    let mount_str = mount_dir.to_str().unwrap().to_string();
    let shutdown = Arc::new(AtomicBool::new(false));

    let shutdown_clone = shutdown.clone();
    let mount_clone = mount_str.clone();

    let handle = std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().unwrap();
        river_lib::fuse_mount::mount_pool(db_arc, &mount_clone, rt.handle().clone(), shutdown_clone)
    });

    // Give it a moment to initialize and mount
    std::thread::sleep(Duration::from_millis(1500));

    // Verify mount with findmnt or stat
    let output = std::process::Command::new("findmnt")
        .arg(&mount_str)
        .output();

    if let Ok(out) = output {
        let stdout = String::from_utf8_lossy(&out.stdout);
        println!("findmnt output: {}", stdout);
        assert!(stdout.contains(&mount_str), "mountpoint should be in findmnt");
    }

    // Unmount
    let unmount_res = river_lib::fuse_mount::unmount_pool(&mount_str);
    assert!(unmount_res.is_ok(), "unmount should succeed: {:?}", unmount_res);
    let _ = handle.join();
}
