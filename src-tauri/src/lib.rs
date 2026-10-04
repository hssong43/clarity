mod capture;

use capture::CapturedImage;
use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, Size};

const PILL_WIDTH: f64 = 184.0;
const PILL_HEIGHT: f64 = 56.0;
const PANEL_WIDTH: f64 = 430.0;
const PANEL_HEIGHT: f64 = 620.0;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
enum OverlayMode {
    Pill,
    Panel,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScreenCapturePermission {
    supported: bool,
    granted: bool,
    can_request: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeHttpRequest {
    request_id: String,
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    body: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeHttpStreamEvent<'a> {
    request_id: &'a str,
    kind: &'a str,
    bytes: Option<Vec<u8>>,
    message: Option<String>,
}

#[tauri::command]
fn capture_screens(app: AppHandle) -> Result<Vec<CapturedImage>, String> {
    capture::capture_screens(app)
}

#[tauri::command]
fn set_overlay_mode(app: AppHandle, mode: OverlayMode) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main overlay window was not found".to_string())?;

    let (width, height) = match mode {
        OverlayMode::Pill => (PILL_WIDTH, PILL_HEIGHT),
        OverlayMode::Panel => (PANEL_WIDTH, PANEL_HEIGHT),
    };

    window
        .set_size(Size::Logical(LogicalSize::new(width, height)))
        .map_err(|error| error.to_string())?;
    window
        .set_always_on_top(true)
        .map_err(|error| error.to_string())?;
    window
        .set_skip_taskbar(true)
        .map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn screen_capture_permission_status() -> ScreenCapturePermission {
    ScreenCapturePermission {
        supported: cfg!(target_os = "macos"),
        granted: platform_screen_capture_granted(),
        can_request: cfg!(target_os = "macos"),
    }
}

#[tauri::command]
fn request_screen_capture_permission() -> ScreenCapturePermission {
    request_platform_screen_capture_permission();
    screen_capture_permission_status()
}

#[tauri::command]
fn open_screen_capture_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
            .spawn()
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn stream_http_request(app: AppHandle, request: NativeHttpRequest) -> Result<(), String> {
    if !request.method.eq_ignore_ascii_case("POST") {
        return Err("Only POST provider requests are supported".to_string());
    }

    if !is_allowed_provider_url(&request.url) {
        return Err("Provider URL is not allowed".to_string());
    }

    let client = reqwest::Client::new();
    let response = client
        .post(&request.url)
        .headers(build_headers(&request.headers)?)
        .body(request.body)
        .send()
        .await
        .map_err(|error| error.to_string())?;

    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("HTTP {status}: {text}"));
    }

    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|error| error.to_string())?;
        emit_http_stream_event(
            &app,
            NativeHttpStreamEvent {
                request_id: &request.request_id,
                kind: "chunk",
                bytes: Some(bytes.to_vec()),
                message: None,
            },
        )?;
    }

    emit_http_stream_event(
        &app,
        NativeHttpStreamEvent {
            request_id: &request.request_id,
            kind: "done",
            bytes: None,
            message: None,
        },
    )?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_always_on_top(true);
                let _ = window.set_skip_taskbar(true);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            capture_screens,
            set_overlay_mode,
            screen_capture_permission_status,
            request_screen_capture_permission,
            open_screen_capture_settings,
            stream_http_request
        ])
        .run(tauri::generate_context!())
        .expect("error while running Clarity");
}

fn build_headers(headers: &[(String, String)]) -> Result<HeaderMap, String> {
    let mut map = HeaderMap::new();

    for (name, value) in headers {
        let name = HeaderName::from_bytes(name.as_bytes()).map_err(|error| error.to_string())?;
        let value = HeaderValue::from_str(value).map_err(|error| error.to_string())?;
        map.insert(name, value);
    }

    Ok(map)
}

fn is_allowed_provider_url(url: &str) -> bool {
    url.starts_with("https://api.openai.com/")
        || url.starts_with("https://api.anthropic.com/")
        || url.starts_with("https://generativelanguage.googleapis.com/")
        || url.starts_with("https://openrouter.ai/")
}

fn emit_http_stream_event(app: &AppHandle, event: NativeHttpStreamEvent<'_>) -> Result<(), String> {
    app.emit("clarity-native-http-stream", event)
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn platform_screen_capture_granted() -> bool {
    macos_screen_capture::preflight()
}

#[cfg(not(target_os = "macos"))]
fn platform_screen_capture_granted() -> bool {
    true
}

#[cfg(target_os = "macos")]
fn request_platform_screen_capture_permission() -> bool {
    macos_screen_capture::request()
}

#[cfg(not(target_os = "macos"))]
fn request_platform_screen_capture_permission() -> bool {
    true
}

#[cfg(target_os = "macos")]
mod macos_screen_capture {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGPreflightScreenCaptureAccess() -> bool;
        fn CGRequestScreenCaptureAccess() -> bool;
    }

    pub fn preflight() -> bool {
        unsafe { CGPreflightScreenCaptureAccess() }
    }

    pub fn request() -> bool {
        unsafe { CGRequestScreenCaptureAccess() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_known_provider_urls() {
        assert!(is_allowed_provider_url(
            "https://api.openai.com/v1/responses"
        ));
        assert!(is_allowed_provider_url(
            "https://api.anthropic.com/v1/messages"
        ));
        assert!(is_allowed_provider_url(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent"
        ));
        assert!(is_allowed_provider_url(
            "https://openrouter.ai/api/v1/chat/completions"
        ));
    }

    #[test]
    fn rejects_lookalike_and_insecure_urls() {
        assert!(!is_allowed_provider_url(
            "https://api.openai.com.evil.example/v1"
        ));
        assert!(!is_allowed_provider_url(
            "https://api.openai.com@evil.example/"
        ));
        assert!(!is_allowed_provider_url(
            "http://api.openai.com/v1/responses"
        ));
        assert!(!is_allowed_provider_url("https://api.openai.com"));
        assert!(!is_allowed_provider_url("https://example.com/"));
        assert!(!is_allowed_provider_url(""));
    }

    #[test]
    fn builds_headers_from_pairs() {
        let headers = build_headers(&[
            ("Content-Type".to_string(), "application/json".to_string()),
            ("x-api-key".to_string(), "secret".to_string()),
        ])
        .expect("valid headers");

        assert_eq!(headers.get("content-type").unwrap(), "application/json");
        assert_eq!(headers.get("x-api-key").unwrap(), "secret");
    }

    #[test]
    fn rejects_invalid_header_names_and_values() {
        assert!(build_headers(&[("bad header".to_string(), "v".to_string())]).is_err());
        assert!(build_headers(&[("x-ok".to_string(), "line\nbreak".to_string())]).is_err());
    }
}
