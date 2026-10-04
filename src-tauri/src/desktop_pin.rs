//! Keeps the overlay windows on screen when the OS clears the desktop.
//!
//! macOS hides ordinary windows when the wallpaper is clicked ("Click wallpaper to
//! reveal desktop"). A stationary window that joins all Spaces is left alone, so the
//! orb stays visible and the panel does not vanish.

use tauri::WebviewWindow;

pub fn keep_on_screen(window: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    macos::apply(window);
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}

#[cfg(target_os = "macos")]
mod macos {
    use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};
    use tauri::WebviewWindow;

    pub fn apply(window: &WebviewWindow) {
        let Ok(pointer) = window.ns_window() else {
            return;
        };
        // SAFETY: Tauri hands out the live NSWindow behind this window, and this
        // runs on the main thread during setup.
        let ns_window = unsafe { &*(pointer as *const NSWindow) };
        ns_window.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::Stationary
                | NSWindowCollectionBehavior::FullScreenAuxiliary
                | NSWindowCollectionBehavior::IgnoresCycle,
        );
    }
}
