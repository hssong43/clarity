//! The tray (menu bar) icon: Clarity lives there instead of the Dock or taskbar.

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::App;

use crate::pointer;

pub fn create(app: &App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Clarity", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Clarity", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("Clarity")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => pointer::request_open(app),
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}
