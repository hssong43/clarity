//! Native window material behind the transparent WebView.
//!
//! `backdrop-filter` in a WebView cannot see anything outside the page, so the real
//! glass comes from the OS: Liquid Glass (`NSGlassEffectView`, macOS 26+), a vibrancy
//! view on older macOS, and acrylic on Windows. The page only tints on top of it.

use serde::Serialize;
use tauri::WebviewWindow;

/// Corner radius shared by the native material and the CSS (`--lg-radius`).
#[cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(dead_code))]
pub const CORNER_RADIUS: f64 = 28.0;

// Which variants are constructed depends on the target OS.
#[cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(dead_code))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum GlassKind {
    None,
    Liquid,
    Vibrancy,
    Acrylic,
}

pub struct NativeGlass(pub GlassKind);

/// Applies the best material this OS offers. Must run on the main thread.
pub fn apply(window: &WebviewWindow) -> GlassKind {
    let kind = apply_platform(window);
    refresh_shape(window);
    kind
}

#[cfg(target_os = "macos")]
fn apply_platform(window: &WebviewWindow) -> GlassKind {
    use window_vibrancy::{
        apply_liquid_glass, apply_vibrancy, LiquidGlassOptions, NSGlassEffectViewStyle,
        NSVisualEffectMaterial, NSVisualEffectState,
    };

    let options = LiquidGlassOptions::new(NSGlassEffectViewStyle::Regular).radius(CORNER_RADIUS);
    if apply_liquid_glass(window, options).is_ok() {
        return GlassKind::Liquid;
    }

    // macOS < 26 has no glass view; fall back to a blurred vibrancy material.
    if apply_vibrancy(
        window,
        NSVisualEffectMaterial::HudWindow,
        Some(NSVisualEffectState::Active),
        Some(CORNER_RADIUS),
    )
    .is_ok()
    {
        return GlassKind::Vibrancy;
    }
    GlassKind::None
}

#[cfg(target_os = "windows")]
fn apply_platform(window: &WebviewWindow) -> GlassKind {
    // A light tint; the page paints the rest of the glass.
    if window_vibrancy::apply_acrylic(window, Some((14, 18, 34, 60))).is_ok() {
        GlassKind::Acrylic
    } else {
        GlassKind::None
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn apply_platform(_window: &WebviewWindow) -> GlassKind {
    GlassKind::None
}

/// Acrylic fills the whole window rectangle, so clip the window to the rounded shape.
/// Call again whenever the window size changes.
#[cfg(target_os = "windows")]
pub fn refresh_shape(window: &WebviewWindow) {
    use windows_sys::Win32::Graphics::Gdi::{CreateRoundRectRgn, SetWindowRgn};

    let (Ok(size), Ok(scale), Ok(hwnd)) =
        (window.inner_size(), window.scale_factor(), window.hwnd())
    else {
        return;
    };
    let diameter = (CORNER_RADIUS * 2.0 * scale).round() as i32;
    // SAFETY: the region is handed to the window, which owns it afterwards.
    unsafe {
        let region = CreateRoundRectRgn(
            0,
            0,
            size.width as i32 + 1,
            size.height as i32 + 1,
            diameter,
            diameter,
        );
        SetWindowRgn(hwnd.0 as _, region, 1);
    }
}

#[cfg(not(target_os = "windows"))]
pub fn refresh_shape(_window: &WebviewWindow) {}
