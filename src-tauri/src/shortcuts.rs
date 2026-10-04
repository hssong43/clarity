//! Global shortcuts: one opens Clarity with the full screen attached, the
//! other starts a region capture. Both are registered from Rust so no JS
//! plugin permission is needed.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

const CAPTURE_SHORTCUT_EVENT: &str = "clarity-capture-shortcut";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CaptureArea {
    Full,
    Region,
}

#[derive(Clone, Debug, Serialize)]
struct ShortcutPayload {
    area: CaptureArea,
}

/// Parses an accelerator; an empty string means "disabled".
#[cfg(desktop)]
fn parse(value: &str) -> Result<Option<tauri_plugin_global_shortcut::Shortcut>, String> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    value
        .parse()
        .map(Some)
        .map_err(|error| format!("Invalid shortcut {value}: {error}"))
}

/// Replaces both global shortcuts. An empty string disables that shortcut.
#[tauri::command]
pub fn set_capture_shortcuts(app: AppHandle, full: String, region: String) -> Result<(), String> {
    #[cfg(desktop)]
    {
        use tauri_plugin_global_shortcut::GlobalShortcutExt;

        let full_shortcut = parse(&full)?;
        let region_shortcut = parse(&region)?;
        if full_shortcut.is_some() && full_shortcut == region_shortcut {
            return Err("Use different keys for full-screen and region capture".to_string());
        }

        let manager = app.global_shortcut();
        manager
            .unregister_all()
            .map_err(|error| error.to_string())?;
        for (shortcut, label) in [
            (full_shortcut, full.trim()),
            (region_shortcut, region.trim()),
        ] {
            if let Some(shortcut) = shortcut {
                manager.register(shortcut).map_err(|_| {
                    format!(
                        "{label} could not be registered. It may already be used by another app."
                    )
                })?;
            }
        }
        *app.state::<RegionShortcut>()
            .0
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = region_shortcut;
    }
    #[cfg(not(desktop))]
    let _ = (app, full, region);
    Ok(())
}

/// The region shortcut currently registered, used to tell the two apart.
#[derive(Default)]
pub struct RegionShortcut(
    #[cfg(desktop)] pub std::sync::Mutex<Option<tauri_plugin_global_shortcut::Shortcut>>,
    #[cfg(not(desktop))] pub std::sync::Mutex<()>,
);

#[cfg(desktop)]
pub fn handle(
    app: &AppHandle,
    shortcut: &tauri_plugin_global_shortcut::Shortcut,
    event: tauri_plugin_global_shortcut::ShortcutEvent,
) {
    if event.state != tauri_plugin_global_shortcut::ShortcutState::Pressed {
        return;
    }
    let is_region = app
        .state::<RegionShortcut>()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        == Some(shortcut);

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    let area = if is_region {
        CaptureArea::Region
    } else {
        CaptureArea::Full
    };
    let _ = app.emit(CAPTURE_SHORTCUT_EVENT, ShortcutPayload { area });
}

#[cfg(all(test, desktop))]
mod tests {
    use super::*;

    #[test]
    fn parses_shortcuts_produced_by_the_settings_ui() {
        for shortcut in [
            "CommandOrControl+Shift+Space",
            "Alt+Shift+Space",
            "Ctrl+Shift+KeyK",
            "Super+Alt+Digit1",
            "Shift+F5",
        ] {
            assert!(parse(shortcut).unwrap().is_some(), "{shortcut}");
        }
        assert!(parse("Ctrl+Shift+NotAKey").is_err());
        assert!(parse("  ").unwrap().is_none());
    }

    #[test]
    fn distinguishes_the_two_default_shortcuts() {
        assert_ne!(
            parse("CommandOrControl+Shift+Space").unwrap(),
            parse("Alt+Shift+Space").unwrap()
        );
    }

    #[test]
    fn serializes_area_for_the_frontend() {
        let json = serde_json::to_string(&ShortcutPayload {
            area: CaptureArea::Region,
        })
        .unwrap();
        assert_eq!(json, r#"{"area":"region"}"#);
    }
}
