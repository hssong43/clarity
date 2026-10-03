use std::{thread, time::Duration};

use base64::{engine::general_purpose, Engine as _};
use image::{codecs::jpeg::JpegEncoder, imageops::FilterType, ColorType, RgbaImage};
use serde::Serialize;
use tauri::{AppHandle, Manager};
use xcap::Monitor;

pub const MAX_CAPTURE_DIMENSION: u32 = 1600;
pub const JPEG_QUALITY: u8 = 72;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturedImage {
    pub mime: String,
    pub data_url: String,
    pub width: u32,
    pub height: u32,
    pub original_width: u32,
    pub original_height: u32,
    pub display_id: String,
}

pub fn capture_screens(app: AppHandle) -> Result<Vec<CapturedImage>, String> {
    let was_visible = hide_overlay(&app);
    let result = capture_all_monitors();
    restore_overlay(&app, was_visible);
    result
}

fn capture_all_monitors() -> Result<Vec<CapturedImage>, String> {
    let monitors = Monitor::all().map_err(|error| error.to_string())?;
    if monitors.is_empty() {
        return Err("No display was available for capture".to_string());
    }

    monitors
        .into_iter()
        .enumerate()
        .map(|(index, monitor)| capture_monitor(index, monitor))
        .collect()
}

fn capture_monitor(index: usize, monitor: Monitor) -> Result<CapturedImage, String> {
    let display_id = monitor
        .id()
        .map(|id| id.to_string())
        .or_else(|_| monitor.friendly_name())
        .unwrap_or_else(|_| format!("display-{index}"));

    let original = monitor.capture_image().map_err(|error| error.to_string())?;
    let original_width = original.width();
    let original_height = original.height();
    let resized = resize_image(&original, MAX_CAPTURE_DIMENSION);
    let jpeg = encode_jpeg(&resized, JPEG_QUALITY)?;
    let data_url = format!(
        "data:image/jpeg;base64,{}",
        general_purpose::STANDARD.encode(jpeg)
    );

    Ok(CapturedImage {
        mime: "image/jpeg".to_string(),
        data_url,
        width: resized.width(),
        height: resized.height(),
        original_width,
        original_height,
        display_id,
    })
}

pub fn hide_overlay(app: &AppHandle) -> bool {
    let Some(window) = app.get_webview_window("main") else {
        return false;
    };

    let was_visible = window.is_visible().unwrap_or(false);
    let _ = window.hide();
    thread::sleep(Duration::from_millis(120));
    was_visible
}

pub fn restore_overlay(app: &AppHandle, was_visible: bool) {
    if !was_visible {
        return;
    }

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn resize_dimensions(width: u32, height: u32, max_dimension: u32) -> (u32, u32) {
    if width == 0 || height == 0 || max_dimension == 0 {
        return (1, 1);
    }

    let largest = width.max(height);
    if largest <= max_dimension {
        return (width, height);
    }

    let scale = max_dimension as f64 / largest as f64;
    let next_width = ((width as f64 * scale).round() as u32).max(1);
    let next_height = ((height as f64 * scale).round() as u32).max(1);
    (next_width, next_height)
}

pub fn resize_image(image: &RgbaImage, max_dimension: u32) -> RgbaImage {
    let (width, height) = resize_dimensions(image.width(), image.height(), max_dimension);
    if width == image.width() && height == image.height() {
        return image.clone();
    }

    image::imageops::resize(image, width, height, FilterType::Triangle)
}

pub fn encode_jpeg(image: &RgbaImage, quality: u8) -> Result<Vec<u8>, String> {
    let rgb = image::DynamicImage::ImageRgba8(image.clone()).to_rgb8();
    let mut bytes = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut bytes, quality);
    encoder
        .encode(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            ColorType::Rgb8.into(),
        )
        .map_err(|error| error.to_string())?;
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use image::{Rgba, RgbaImage};

    use super::{encode_jpeg, resize_dimensions, JPEG_QUALITY, MAX_CAPTURE_DIMENSION};

    #[test]
    fn resize_dimensions_preserves_aspect_ratio() {
        assert_eq!(resize_dimensions(3840, 2160, 1600), (1600, 900));
        assert_eq!(resize_dimensions(1080, 1920, 1600), (900, 1600));
        assert_eq!(resize_dimensions(800, 600, 1600), (800, 600));
    }

    #[test]
    fn jpeg_encoding_keeps_data_in_memory() {
        let image = RgbaImage::from_pixel(320, 180, Rgba([40, 80, 120, 255]));
        let bytes = encode_jpeg(&image, JPEG_QUALITY).expect("jpeg should encode");

        assert!(bytes.len() > 100);
        assert!(bytes.len() < 120_000);
    }

    #[test]
    fn configured_dimension_cap_is_small_enough_for_vision_requests() {
        let (width, height) = resize_dimensions(5120, 2880, MAX_CAPTURE_DIMENSION);
        assert!(width <= MAX_CAPTURE_DIMENSION);
        assert!(height <= MAX_CAPTURE_DIMENSION);
    }
}
