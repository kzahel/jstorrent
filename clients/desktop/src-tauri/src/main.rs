#![cfg_attr(
    any(not(debug_assertions), feature = "update-qualification"),
    windows_subsystem = "windows"
)]

fn main() {
    rstorrent_desktop::run();
}
