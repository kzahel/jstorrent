//! Windows-specific module to bring dialogs to foreground.
//!
//! Uses ALT key simulation to allow our process to show dialogs in the foreground.

use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    keybd_event, KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, VK_MENU,
};

/// Prepare the current process to show a foreground window.
///
/// Simulates an ALT key press/release which tricks Windows into allowing
/// foreground window changes. This causes a brief flash of the browser's
/// menu bar but reliably brings the dialog to the foreground.
///
/// Call this immediately before showing a dialog.
pub fn prepare_for_foreground() {
    unsafe {
        keybd_event(VK_MENU as u8, 0, KEYEVENTF_EXTENDEDKEY, 0);
        keybd_event(VK_MENU as u8, 0, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, 0);
    }
}
