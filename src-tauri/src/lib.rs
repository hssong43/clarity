mod capture;
mod native_glass;
mod pointer;
mod region;
mod secrets;
mod shortcuts;

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use capture::CapturedImage;
use futures_util::future::{AbortHandle, AbortRegistration, Abortable};
use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use secrets::StoredKeyAuth;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, Size, State};

use pointer::ORB_SIZE;

const PANEL_WIDTH: f64 = 430.0;
const PANEL_HEIGHT: f64 = 620.0;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
// Applies to each read, so long streams stay alive as long as chunks keep arriving.
const READ_TIMEOUT: Duration = Duration::from_secs(90);
const CANCELLED_MESSAGE: &str = "The request was cancelled.";

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum OverlayMode {
    Orb,
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
    /// Attach the API key stored in the OS keychain for this profile.
    #[serde(default)]
    auth: Option<StoredKeyAuth>,
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

// Async so the window calls below never wait on the main thread while the pointer
// poll thread holds the lock and waits on it too.
#[tauri::command]
async fn set_overlay_mode(app: AppHandle, mode: OverlayMode) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main overlay window was not found".to_string())?;

    let (width, height) = match mode {
        OverlayMode::Orb => (ORB_SIZE, ORB_SIZE),
        OverlayMode::Panel => (PANEL_WIDTH, PANEL_HEIGHT),
    };

    let pointer = app.state::<pointer::PointerState>();
    let mut following = pointer.lock_following();
    *following = mode == OverlayMode::Orb;
    // The orb never takes clicks, so the app underneath keeps working.
    window
        .set_ignore_cursor_events(mode == OverlayMode::Orb)
        .map_err(|error| error.to_string())?;
    window
        .set_size(Size::Logical(LogicalSize::new(width, height)))
        .map_err(|error| error.to_string())?;
    if mode == OverlayMode::Panel {
        pointer::place_panel(&app, &window, (width, height));
    }
    window
        .set_always_on_top(true)
        .map_err(|error| error.to_string())?;
    window
        .set_skip_taskbar(true)
        .map_err(|error| error.to_string())?;
    native_glass::refresh_shape(&window);
    window.show().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn native_glass_kind(state: State<'_, native_glass::NativeGlass>) -> native_glass::GlassKind {
    state.0
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

struct HttpState {
    client: reqwest::Client,
    requests: Mutex<HashMap<String, RequestEntry>>,
}

enum RequestEntry {
    Running(AbortHandle),
    // Cancel arrived before the request registered itself.
    Cancelled,
}

impl HttpState {
    fn new() -> Result<Self, reqwest::Error> {
        let client = reqwest::Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .read_timeout(READ_TIMEOUT)
            .build()?;
        Ok(Self {
            client,
            requests: Mutex::new(HashMap::new()),
        })
    }

    /// Returns `None` when the request was cancelled before it started.
    fn register(&self, request_id: &str) -> Option<AbortRegistration> {
        let mut requests = self.requests.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(RequestEntry::Cancelled) = requests.remove(request_id) {
            return None;
        }
        let (handle, registration) = AbortHandle::new_pair();
        requests.insert(request_id.to_string(), RequestEntry::Running(handle));
        Some(registration)
    }

    fn cancel(&self, request_id: &str) {
        let mut requests = self.requests.lock().unwrap_or_else(|e| e.into_inner());
        match requests.remove(request_id) {
            Some(RequestEntry::Running(handle)) => handle.abort(),
            _ => {
                requests.insert(request_id.to_string(), RequestEntry::Cancelled);
            }
        }
    }

    fn finish(&self, request_id: &str) {
        let mut requests = self.requests.lock().unwrap_or_else(|e| e.into_inner());
        requests.remove(request_id);
    }
}

#[tauri::command]
async fn stream_http_request(
    app: AppHandle,
    state: State<'_, HttpState>,
    request: NativeHttpRequest,
) -> Result<(), String> {
    if !request.method.eq_ignore_ascii_case("POST") {
        return Err("Only POST provider requests are supported".to_string());
    }

    if !is_allowed_provider_url(&request.url) {
        return Err("Provider URL is not allowed".to_string());
    }

    let request_id = request.request_id.clone();
    let registration = state
        .register(&request_id)
        .ok_or_else(|| CANCELLED_MESSAGE.to_string())?;
    let result = Abortable::new(run_http_stream(&app, &state.client, request), registration).await;
    state.finish(&request_id);

    result.unwrap_or_else(|_| Err(CANCELLED_MESSAGE.to_string()))
}

#[tauri::command]
fn set_api_key(profile_id: String, api_key: String) -> Result<(), String> {
    secrets::set_api_key(&profile_id, &api_key)
}

#[tauri::command]
fn delete_api_key(profile_id: String) -> Result<(), String> {
    secrets::delete_api_key(&profile_id)
}

#[tauri::command]
fn cancel_http_request(state: State<'_, HttpState>, request_id: String) {
    state.cancel(&request_id);
}

async fn run_http_stream(
    app: &AppHandle,
    client: &reqwest::Client,
    request: NativeHttpRequest,
) -> Result<(), String> {
    let mut headers = build_headers(&request.headers)?;
    if let Some(auth) = &request.auth {
        let api_key = secrets::get_api_key(&auth.profile_id)?;
        let (name, value) = secrets::auth_header(auth.scheme, &api_key)?;
        headers.insert(name, value);
    }

    let method = match request.method.as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        _ => return Err("HTTP method is not allowed".to_string()),
    };
    let mut builder = client
        .request(method.clone(), &request.url)
        .headers(headers);
    if method == reqwest::Method::POST {
        builder = builder.body(request.body);
    }
    let response = builder.send().await.map_err(describe_http_error)?;

    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("HTTP {status}: {text}"));
    }

    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(describe_http_error)?;
        emit_http_stream_event(
            app,
            NativeHttpStreamEvent {
                request_id: &request.request_id,
                kind: "chunk",
                bytes: Some(bytes.to_vec()),
                message: None,
            },
        )?;
    }

    emit_http_stream_event(
        app,
        NativeHttpStreamEvent {
            request_id: &request.request_id,
            kind: "done",
            bytes: None,
            message: None,
        },
    )?;
    Ok(())
}

// Strip the URL so query-string credentials never reach the UI.
fn describe_http_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        return "The provider did not respond in time.".to_string();
    }
    if error.is_connect() {
        return "Could not connect to the provider.".to_string();
    }
    error.without_url().to_string()
}

pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());
    #[cfg(desktop)]
    let builder = builder.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(shortcuts::handle)
            .build(),
    );

    builder
        .setup(|app| {
            app.manage(HttpState::new()?);
            app.manage(region::RegionState::default());
            app.manage(shortcuts::RegionShortcut::default());
            app.manage(pointer::PointerState::default());
            let mut glass = native_glass::GlassKind::None;
            if let Some(window) = app.get_webview_window("main") {
                glass = native_glass::apply(&window);
                let _ = window.set_always_on_top(true);
                let _ = window.set_skip_taskbar(true);
            }
            app.manage(native_glass::NativeGlass(glass));
            pointer::create_selection_window(app);
            pointer::start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            capture_screens,
            set_overlay_mode,
            native_glass_kind,
            screen_capture_permission_status,
            request_screen_capture_permission,
            open_screen_capture_settings,
            stream_http_request,
            cancel_http_request,
            set_api_key,
            delete_api_key,
            shortcuts::set_capture_shortcuts,
            pointer::set_pointer_modifier,
            region::start_region_capture,
            region::region_capture_previews,
            region::finish_region_capture
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
    fn cancel_aborts_running_request() {
        let state = HttpState::new().expect("client");
        let registration = state.register("a").expect("registered");
        state.cancel("a");

        let aborted = tauri::async_runtime::block_on(Abortable::new(
            std::future::pending::<()>(),
            registration,
        ));
        assert!(aborted.is_err());
        assert!(state.requests.lock().unwrap().is_empty());
    }

    #[test]
    fn cancel_before_register_prevents_start() {
        let state = HttpState::new().expect("client");
        state.cancel("b");
        assert!(state.register("b").is_none());
        assert!(state.requests.lock().unwrap().is_empty());
    }

    #[test]
    fn finish_clears_request() {
        let state = HttpState::new().expect("client");
        let _registration = state.register("c").expect("registered");
        state.finish("c");
        assert!(state.requests.lock().unwrap().is_empty());
    }

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
