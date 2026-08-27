//! Binary entry point. Hides the console window on Windows release builds.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    river_lib::run();
}
