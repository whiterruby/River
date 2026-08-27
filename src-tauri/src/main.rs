//! Binary entry point. Hides the console window on Windows release builds.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // On Linux systems with discrete GPU or proprietary drivers (NVIDIA/Mesa EGL mismatch),
    // WebKitGTK can abort on EGL initialization. Disable hardware acceleration fallback.
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
        if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        }
    }

    river_lib::run();
}
