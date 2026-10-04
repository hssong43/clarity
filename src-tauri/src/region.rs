//! Region capture: grab every display at full resolution, let the user drag a
//! rectangle over a frozen screenshot in a dedicated window, then crop the
//! original. The selection travels as fractions of the screenshot, so display
//! scaling and monitor layout never enter the math.

use std::sync::Mutex;

use base64::{engine::general_purpose, Engine as _};
use image::RgbaImage;
use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder,
    WindowEvent,
};
use xcap::Monitor;

use crate::capture::{
    encode_jpeg, hide_overlay, resize_image, restore_overlay, CapturedImage, JPEG_QUALITY,
    MAX_CAPTURE_DIMENSION,
};

pub const REGION_WINDOW_LABEL: &str = "region";
const REGION_RESULT_EVENT: &str = "clarity-region-captured";
// Previews only need to look sharp on the selector; the crop uses the original.
const PREVIEW_MAX_DIMENSION: u32 = 2560;
const PREVIEW_JPEG_QUALITY: u8 = 80;
const MIN_REGION_PIXELS: u32 = 8;

struct Screenshot {
    display_id: String,
    image: RgbaImage,
    is_default: bool,
}

#[derive(Default)]
pub struct RegionState {
    screenshots: Mutex<Option<Vec<Screenshot>>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionPreview {
    display_id: String,
    data_url: String,
    width: u32,
    height: u32,
    is_default: bool,
}

/// A rectangle in fractions (0..=1) of the screenshot's width and height.
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionSelection {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RegionResult {
    image: Option<CapturedImage>,
    error: Option<String>,
}

#[tauri::command]
pub fn start_region_capture(app: AppHandle) -> Result<(), String> {
    if app.get_webview_window(REGION_WINDOW_LABEL).is_some() {
        return Err("A region capture is already in progress".to_string());
    }

    let target = app
        .get_webview_window("main")
        .and_then(|window| window.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())
        .ok_or_else(|| "No display was available for capture".to_string())?;

    hide_overlay(&app);
    let screenshots = match capture_all(&target) {
        Ok(screenshots) => screenshots,
        Err(error) => {
            restore_overlay(&app, true);
            return Err(error);
        }
    };
    *app.state::<RegionState>()
        .screenshots
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = Some(screenshots);

    let scale = target.scale_factor();
    let position = target.position().to_logical::<f64>(scale);
    let size = target.size().to_logical::<f64>(scale);
    let window = WebviewWindowBuilder::new(
        &app,
        REGION_WINDOW_LABEL,
        WebviewUrl::App("index.html#region".into()),
    )
    .title("Select a region")
    .position(position.x, position.y)
    .inner_size(size.width, size.height)
    .decorations(false)
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .shadow(false)
    .focused(true)
    .build()
    .map_err(|error| {
        finish(&app, None);
        error.to_string()
    })?;
    // Some platforms ignore builder geometry for undecorated windows.
    let _ = window.set_position(LogicalPosition::new(position.x, position.y));
    let _ = window.set_size(LogicalSize::new(size.width, size.height));

    let handle = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            // Closed without a selection (e.g. Alt+F4): treat as cancel.
            finish(&handle, None);
        }
    });
    Ok(())
}

#[tauri::command]
pub fn region_capture_previews(app: AppHandle) -> Result<Vec<RegionPreview>, String> {
    let state = app.state::<RegionState>();
    let screenshots = state.screenshots.lock().unwrap_or_else(|e| e.into_inner());
    let screenshots = screenshots
        .as_ref()
        .ok_or_else(|| "No region capture is in progress".to_string())?;

    screenshots
        .iter()
        .map(|screenshot| {
            let preview = resize_image(&screenshot.image, PREVIEW_MAX_DIMENSION);
            let jpeg = encode_jpeg(&preview, PREVIEW_JPEG_QUALITY)?;
            Ok(RegionPreview {
                display_id: screenshot.display_id.clone(),
                data_url: jpeg_data_url(&jpeg),
                width: preview.width(),
                height: preview.height(),
                is_default: screenshot.is_default,
            })
        })
        .collect()
}

/// Completes the capture; `selection` of `None` cancels.
#[tauri::command]
pub fn finish_region_capture(
    app: AppHandle,
    display_id: Option<String>,
    selection: Option<RegionSelection>,
) -> Result<(), String> {
    let result = match (display_id, selection) {
        (Some(display_id), Some(selection)) => Some(crop_selection(&app, &display_id, selection)),
        _ => None,
    };
    finish(&app, result);
    Ok(())
}

fn crop_selection(
    app: &AppHandle,
    display_id: &str,
    selection: RegionSelection,
) -> Result<CapturedImage, String> {
    let state = app.state::<RegionState>();
    let screenshots = state.screenshots.lock().unwrap_or_else(|e| e.into_inner());
    let screenshot = screenshots
        .as_ref()
        .and_then(|screenshots| {
            screenshots
                .iter()
                .find(|screenshot| screenshot.display_id == display_id)
        })
        .ok_or_else(|| "The selected display is no longer available".to_string())?;

    let (x, y, width, height) = crop_rect(
        screenshot.image.width(),
        screenshot.image.height(),
        selection,
    )
    .ok_or_else(|| "Select a larger region".to_string())?;
    let cropped = image::imageops::crop_imm(&screenshot.image, x, y, width, height).to_image();
    let resized = resize_image(&cropped, MAX_CAPTURE_DIMENSION);
    let jpeg = encode_jpeg(&resized, JPEG_QUALITY)?;

    Ok(CapturedImage {
        mime: "image/jpeg".to_string(),
        data_url: jpeg_data_url(&jpeg),
        width: resized.width(),
        height: resized.height(),
        original_width: width,
        original_height: height,
        display_id: format!("{display_id}-region"),
    })
}

/// Runs at most once per capture: clears state, closes the selector, brings the
/// overlay back, and reports the outcome (`None` = cancelled) to the main window.
fn finish(app: &AppHandle, result: Option<Result<CapturedImage, String>>) {
    let had_capture = app
        .state::<RegionState>()
        .screenshots
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
        .is_some();
    if !had_capture {
        return;
    }

    if let Some(window) = app.get_webview_window(REGION_WINDOW_LABEL) {
        let _ = window.close();
    }
    restore_overlay(app, true);

    let payload = match result {
        Some(Ok(image)) => RegionResult {
            image: Some(image),
            error: None,
        },
        Some(Err(error)) => RegionResult {
            image: None,
            error: Some(error),
        },
        None => RegionResult {
            image: None,
            error: None,
        },
    };
    let _ = app.emit_to("main", REGION_RESULT_EVENT, payload);
}

fn capture_all(target: &tauri::Monitor) -> Result<Vec<Screenshot>, String> {
    let monitors = Monitor::all().map_err(|error| error.to_string())?;
    if monitors.is_empty() {
        return Err("No display was available for capture".to_string());
    }

    let mut screenshots = monitors
        .into_iter()
        .enumerate()
        .map(|(index, monitor)| {
            let display_id = monitor
                .id()
                .map(|id| id.to_string())
                .unwrap_or_else(|_| format!("display-{index}"));
            let image = monitor.capture_image().map_err(|error| error.to_string())?;
            Ok(Screenshot {
                display_id,
                image,
                is_default: false,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;

    // Open on the display the overlay sits on; pixel size identifies it.
    let target_size = target.size();
    let default_index = screenshots
        .iter()
        .position(|screenshot| {
            screenshot.image.width() == target_size.width
                && screenshot.image.height() == target_size.height
        })
        .unwrap_or(0);
    screenshots[default_index].is_default = true;
    Ok(screenshots)
}

fn jpeg_data_url(jpeg: &[u8]) -> String {
    format!(
        "data:image/jpeg;base64,{}",
        general_purpose::STANDARD.encode(jpeg)
    )
}

/// Converts a fractional selection into a pixel rectangle inside the image,
/// or `None` when it is empty, out of range, or too small to be useful.
pub fn crop_rect(
    image_width: u32,
    image_height: u32,
    selection: RegionSelection,
) -> Option<(u32, u32, u32, u32)> {
    let values = [selection.x, selection.y, selection.width, selection.height];
    if values.iter().any(|value| !value.is_finite()) {
        return None;
    }

    let left = selection.x.clamp(0.0, 1.0);
    let top = selection.y.clamp(0.0, 1.0);
    let right = (selection.x + selection.width).clamp(0.0, 1.0);
    let bottom = (selection.y + selection.height).clamp(0.0, 1.0);

    let x = (left * image_width as f64).round() as u32;
    let y = (top * image_height as f64).round() as u32;
    let x_end = ((right * image_width as f64).round() as u32).min(image_width);
    let y_end = ((bottom * image_height as f64).round() as u32).min(image_height);
    let width = x_end.saturating_sub(x);
    let height = y_end.saturating_sub(y);

    if width < MIN_REGION_PIXELS || height < MIN_REGION_PIXELS {
        return None;
    }
    Some((x, y, width, height))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn selection(x: f64, y: f64, width: f64, height: f64) -> RegionSelection {
        RegionSelection {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn maps_fractions_to_pixels() {
        assert_eq!(
            crop_rect(2000, 1000, selection(0.25, 0.5, 0.5, 0.25)),
            Some((500, 500, 1000, 250))
        );
        assert_eq!(
            crop_rect(3840, 2160, selection(0.0, 0.0, 1.0, 1.0)),
            Some((0, 0, 3840, 2160))
        );
    }

    #[test]
    fn clamps_selections_that_spill_outside_the_image() {
        assert_eq!(
            crop_rect(1000, 1000, selection(-0.1, 0.9, 0.3, 0.5)),
            Some((0, 900, 200, 100))
        );
    }

    #[test]
    fn rejects_tiny_empty_and_invalid_selections() {
        assert_eq!(crop_rect(1000, 1000, selection(0.5, 0.5, 0.001, 0.2)), None);
        assert_eq!(crop_rect(1000, 1000, selection(0.5, 0.5, 0.0, 0.0)), None);
        assert_eq!(crop_rect(1000, 1000, selection(1.2, 0.0, 0.5, 0.5)), None);
        assert_eq!(
            crop_rect(1000, 1000, selection(f64::NAN, 0.0, 0.5, 0.5)),
            None
        );
    }

    #[test]
    fn deserializes_selection_from_frontend_shape() {
        let parsed: RegionSelection =
            serde_json::from_str(r#"{"x":0.1,"y":0.2,"width":0.3,"height":0.4}"#).unwrap();
        assert_eq!(crop_rect(100, 100, parsed), Some((10, 20, 30, 40)));
    }
}
