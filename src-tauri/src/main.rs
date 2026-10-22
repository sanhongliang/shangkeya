// 上课鸭 桌面端（Tauri）主入口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    shangkeya_lib::run();
}
