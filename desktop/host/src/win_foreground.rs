//! Windows-specific module to bring dialogs to foreground.
//!
//! Uses ALT key simulation to allow our process to show dialogs in the foreground.

use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    keybd_event, KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, VK_ESCAPE, VK_MENU,
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

/// Dismiss the Chrome menu bar that was activated by prepare_for_foreground.
///
/// Sends ESC key to close any menu that might have been opened by the ALT key.
/// Call this after the dialog is closed to restore focus to the webpage.
pub fn dismiss_menu() {
    unsafe {
        keybd_event(VK_ESCAPE as u8, 0, 0, 0);
        keybd_event(VK_ESCAPE as u8, 0, KEYEVENTF_KEYUP, 0);
    }
}
