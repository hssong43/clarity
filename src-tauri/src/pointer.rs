//! The cursor-following orb and the pointer gestures that drive it.
//!
//! One poll thread reads the cursor position, the chosen modifier key and the left
//! mouse button. Polling needs no input-hook permission on macOS (Accessibility /
//! Input Monitoring) and never swallows a click, so the app underneath still sees
//! it. Modifier + click opens Clarity; modifier + drag attaches the dragged region
//! of the screen. Geometry is in physical pixels, and the selection travels as
//! fractions of the monitor so display scaling never enters the crop.

use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Mutex;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

use crate::capture::CapturedImage;
use crate::region::{self, RegionSelection, Screenshot};

pub const SELECTION_WINDOW_LABEL: &str = "selection";
/// Logical size of the orb window: a small dot.
pub const ORB_SIZE: f64 = 12.0;
const POINTER_EVENT: &str = "clarity-pointer-capture";
const POLL_INTERVAL: Duration = Duration::from_millis(16);
/// Movement (physical px) that turns a press into a drag.
const DRAG_THRESHOLD_PX: f64 = 12.0;
/// Gaps (logical px) between the cursor and the orb or the panel.
const ORB_GAP: f64 = 10.0;
const PANEL_GAP: f64 = 9.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Modifier {
    /// Option on macOS, Alt on Windows.
    Alt,
    /// Command on macOS, Ctrl on Windows.
    Primary,
}

impl Modifier {
    fn code(self) -> u8 {
        match self {
            Modifier::Alt => 0,
            Modifier::Primary => 1,
        }
    }

    fn from_code(code: u8) -> Self {
        if code == 1 {
            Modifier::Primary
        } else {
            Modifier::Alt
        }
    }
}

pub struct PointerState {
    modifier: AtomicU8,
    /// Whether the orb follows the cursor. Held while the window is moved or
    /// resized so the poll thread and `set_overlay_mode` never interleave.
    following: Mutex<bool>,
}

impl Default for PointerState {
    fn default() -> Self {
        Self {
            modifier: AtomicU8::new(Modifier::Alt.code()),
            following: Mutex::new(false),
        }
    }
}

impl PointerState {
    fn modifier(&self) -> Modifier {
        Modifier::from_code(self.modifier.load(Ordering::Relaxed))
    }

    pub fn lock_following(&self) -> std::sync::MutexGuard<'_, bool> {
        self.following.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[tauri::command]
pub fn set_pointer_modifier(app: AppHandle, modifier: Modifier) {
    app.state::<PointerState>()
        .modifier
        .store(modifier.code(), Ordering::Relaxed);
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    fn of_monitor(monitor: &tauri::Monitor) -> Self {
        let position = monitor.position();
        let size = monitor.size();
        Self {
            x: position.x as f64,
            y: position.y as f64,
            width: size.width as f64,
            height: size.height as f64,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Sample {
    pub cursor: Point,
    pub modifier_held: bool,
    pub button_down: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Gesture {
    /// Modifier + click, reported on release.
    Click,
    DragStart(Point),
    DragMove {
        start: Point,
        current: Point,
    },
    DragEnd {
        start: Point,
        end: Point,
    },
}

#[derive(Clone, Copy, Debug, Default)]
enum Phase {
    #[default]
    Idle,
    Pressed(Point),
    Dragging(Point),
}

/// Turns polled samples into gestures. A gesture starts only on a fresh button
/// press while the modifier is held; releasing the modifier mid-drag does not
/// cancel it.
#[derive(Debug, Default)]
pub struct GestureTracker {
    phase: Phase,
    was_down: bool,
}

impl GestureTracker {
    pub fn update(&mut self, sample: Sample) -> Option<Gesture> {
        let pressed_now = sample.button_down && !self.was_down;
        self.was_down = sample.button_down;

        match self.phase {
            Phase::Idle => {
                if pressed_now && sample.modifier_held {
                    self.phase = Phase::Pressed(sample.cursor);
                }
                None
            }
            Phase::Pressed(start) => {
                if !sample.button_down {
                    self.phase = Phase::Idle;
                    Some(Gesture::Click)
                } else if distance(start, sample.cursor) >= DRAG_THRESHOLD_PX {
                    self.phase = Phase::Dragging(start);
                    Some(Gesture::DragStart(start))
                } else {
                    None
                }
            }
            Phase::Dragging(start) => {
                if sample.button_down {
                    Some(Gesture::DragMove {
                        start,
                        current: sample.cursor,
                    })
                } else {
                    self.phase = Phase::Idle;
                    Some(Gesture::DragEnd {
                        start,
                        end: sample.cursor,
                    })
                }
            }
        }
    }
}

fn distance(a: Point, b: Point) -> f64 {
    (a.x - b.x).hypot(a.y - b.y)
}

/// The rectangle spanned by two corners.
pub fn drag_rect(a: Point, b: Point) -> Rect {
    Rect {
        x: a.x.min(b.x),
        y: a.y.min(b.y),
        width: (a.x - b.x).abs(),
        height: (a.y - b.y).abs(),
    }
}

/// The drag rectangle as fractions of the monitor it happened on.
pub fn selection_fractions(rect: Rect, monitor: Rect) -> RegionSelection {
    RegionSelection {
        x: (rect.x - monitor.x) / monitor.width,
        y: (rect.y - monitor.y) / monitor.height,
        width: rect.width / monitor.width,
        height: rect.height / monitor.height,
    }
}

/// Top-left corner for a window of `size` next to the cursor: below and to the
/// right by `gap`, flipped to the other side near an edge, and always inside
/// `bounds`.
pub fn place_near(cursor: Point, size: (f64, f64), gap: f64, bounds: Rect) -> Point {
    let mut x = cursor.x + gap;
    if x + size.0 > bounds.x + bounds.width {
        x = cursor.x - gap - size.0;
    }
    let mut y = cursor.y + gap;
    if y + size.1 > bounds.y + bounds.height {
        y = cursor.y - gap - size.1;
    }
    Point {
        x: x.clamp(bounds.x, (bounds.x + bounds.width - size.0).max(bounds.x)),
        y: y.clamp(bounds.y, (bounds.y + bounds.height - size.1).max(bounds.y)),
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum PointerEvent {
    Click,
    Region {
        image: Option<CapturedImage>,
        error: Option<String>,
    },
}

/// Creates the click-through frame window that outlines a drag selection.
pub fn create_selection_window(app: &tauri::App) {
    let window = WebviewWindowBuilder::new(
        app,
        SELECTION_WINDOW_LABEL,
        WebviewUrl::App("index.html#selection".into()),
    )
    .title("Selection")
    .inner_size(16.0, 16.0)
    .visible(false)
    .decorations(false)
    .transparent(true)
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .shadow(false)
    .focusable(false)
    .content_protected(true)
    .build();
    if let Ok(window) = window {
        let _ = window.set_ignore_cursor_events(true);
        crate::desktop_pin::keep_on_screen(&window);
    }
}

/// Asks the frontend to open the panel, as a modifier + click does.
pub fn request_open(app: &AppHandle) {
    let _ = app.emit(POINTER_EVENT, PointerEvent::Click);
}

pub fn start(app: AppHandle) {
    thread::spawn(move || run(app));
}

struct DragSession {
    monitor: tauri::Monitor,
    screenshot: JoinHandle<Result<Screenshot, String>>,
}

fn run(app: AppHandle) {
    let mut tracker = GestureTracker::default();
    let mut drag: Option<DragSession> = None;
    let mut last_orb: Option<(i32, i32)> = None;
    let mut last_frame: Option<(i32, i32, u32, u32)> = None;

    loop {
        thread::sleep(POLL_INTERVAL);
        let Ok(cursor) = app.cursor_position() else {
            continue;
        };
        let cursor = Point {
            x: cursor.x,
            y: cursor.y,
        };
        let state = app.state::<PointerState>();

        {
            let following = state.lock_following();
            if *following {
                follow_cursor(&app, cursor, &mut last_orb);
            } else {
                last_orb = None;
            }
        }

        let sample = Sample {
            cursor,
            modifier_held: platform::modifier_held(state.modifier()),
            button_down: platform::left_button_down(),
        };
        match tracker.update(sample) {
            None => {}
            Some(Gesture::Click) => {
                request_open(&app);
            }
            Some(Gesture::DragStart(start)) => {
                drag = begin_drag(&app, start);
                if drag.is_some() {
                    show_frame(&app, drag_rect(start, cursor), &mut last_frame);
                }
            }
            Some(Gesture::DragMove { start, current }) => {
                if drag.is_some() {
                    show_frame(&app, drag_rect(start, current), &mut last_frame);
                }
            }
            Some(Gesture::DragEnd { start, end }) => {
                hide_frame(&app, &mut last_frame);
                if let Some(session) = drag.take() {
                    finish_drag(&app, session, drag_rect(start, end));
                }
            }
        }
    }
}

fn monitor_at(app: &AppHandle, point: Point) -> Option<tauri::Monitor> {
    app.monitor_from_point(point.x, point.y)
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten())
}

fn follow_cursor(app: &AppHandle, cursor: Point, last: &mut Option<(i32, i32)>) {
    let (Some(window), Some(monitor)) = (app.get_webview_window("main"), monitor_at(app, cursor))
    else {
        return;
    };
    let scale = monitor.scale_factor();
    let side = ORB_SIZE * scale;
    let at = place_near(
        cursor,
        (side, side),
        ORB_GAP * scale,
        Rect::of_monitor(&monitor),
    );
    let next = (at.x.round() as i32, at.y.round() as i32);
    if *last != Some(next) {
        *last = Some(next);
        let _ = window.set_position(PhysicalPosition::new(next.0, next.1));
    }
}

/// Positions the panel next to the cursor. Call with the `following` lock held.
pub fn place_panel(app: &AppHandle, window: &WebviewWindow, logical_size: (f64, f64)) {
    let Ok(cursor) = app.cursor_position() else {
        return;
    };
    let cursor = Point {
        x: cursor.x,
        y: cursor.y,
    };
    let Some(monitor) = monitor_at(app, cursor) else {
        return;
    };
    let scale = monitor.scale_factor();
    let at = place_near(
        cursor,
        (logical_size.0 * scale, logical_size.1 * scale),
        PANEL_GAP * scale,
        Rect::of_monitor(&monitor),
    );
    let _ = window.set_position(PhysicalPosition::new(
        at.x.round() as i32,
        at.y.round() as i32,
    ));
}

/// Grabs the screen as it looks when the drag starts, off the poll thread.
fn begin_drag(app: &AppHandle, start: Point) -> Option<DragSession> {
    let monitor = monitor_at(app, start)?;
    let target = monitor.clone();
    let screenshot = thread::spawn(move || region::capture_default_screenshot(&target));
    Some(DragSession {
        monitor,
        screenshot,
    })
}

fn finish_drag(app: &AppHandle, session: DragSession, rect: Rect) {
    let app = app.clone();
    thread::spawn(move || {
        let selection = selection_fractions(rect, Rect::of_monitor(&session.monitor));
        let result = session
            .screenshot
            .join()
            .map_err(|_| "The screenshot could not be captured.".to_string())
            .and_then(|screenshot| screenshot)
            .and_then(|screenshot| region::crop_screenshot(&screenshot, selection));
        let payload = match result {
            Ok(image) => PointerEvent::Region {
                image: Some(image),
                error: None,
            },
            Err(error) => PointerEvent::Region {
                image: None,
                error: Some(error),
            },
        };
        let _ = app.emit(POINTER_EVENT, payload);
    });
}

fn show_frame(app: &AppHandle, rect: Rect, last: &mut Option<(i32, i32, u32, u32)>) {
    let Some(window) = app.get_webview_window(SELECTION_WINDOW_LABEL) else {
        return;
    };
    let next = (
        rect.x.round() as i32,
        rect.y.round() as i32,
        rect.width.round().max(1.0) as u32,
        rect.height.round().max(1.0) as u32,
    );
    if *last == Some(next) {
        return;
    }
    let first = last.is_none();
    *last = Some(next);
    let _ = window.set_size(PhysicalSize::new(next.2, next.3));
    let _ = window.set_position(PhysicalPosition::new(next.0, next.1));
    if first {
        let _ = window.show();
    }
}

fn hide_frame(app: &AppHandle, last: &mut Option<(i32, i32, u32, u32)>) {
    *last = None;
    if let Some(window) = app.get_webview_window(SELECTION_WINDOW_LABEL) {
        let _ = window.hide();
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::Modifier;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceFlagsState(state: i32) -> u64;
        fn CGEventSourceButtonState(state: i32, button: u32) -> bool;
    }

    // kCGEventSourceStateCombinedSessionState and kCGMouseButtonLeft.
    const COMBINED_SESSION_STATE: i32 = 0;
    const LEFT_BUTTON: u32 = 0;
    const FLAG_ALTERNATE: u64 = 0x0008_0000;
    const FLAG_COMMAND: u64 = 0x0010_0000;

    pub fn modifier_held(modifier: Modifier) -> bool {
        let flags = unsafe { CGEventSourceFlagsState(COMBINED_SESSION_STATE) };
        match modifier {
            Modifier::Alt => flags & FLAG_ALTERNATE != 0,
            Modifier::Primary => flags & FLAG_COMMAND != 0,
        }
    }

    pub fn left_button_down() -> bool {
        unsafe { CGEventSourceButtonState(COMBINED_SESSION_STATE, LEFT_BUTTON) }
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::Modifier;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VK_CONTROL, VK_LBUTTON, VK_MENU,
    };

    fn is_down(virtual_key: u16) -> bool {
        // The high bit is set while the key is down.
        unsafe { GetAsyncKeyState(virtual_key as i32) < 0 }
    }

    pub fn modifier_held(modifier: Modifier) -> bool {
        match modifier {
            Modifier::Alt => is_down(VK_MENU),
            Modifier::Primary => is_down(VK_CONTROL),
        }
    }

    pub fn left_button_down() -> bool {
        is_down(VK_LBUTTON)
    }
}

// Other platforms have no gesture support; the orb still follows the cursor.
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    use super::Modifier;

    pub fn modifier_held(_modifier: Modifier) -> bool {
        false
    }

    pub fn left_button_down() -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(x: f64, y: f64) -> Point {
        Point { x, y }
    }

    fn sample(x: f64, y: f64, modifier_held: bool, button_down: bool) -> Sample {
        Sample {
            cursor: at(x, y),
            modifier_held,
            button_down,
        }
    }

    #[test]
    fn modifier_click_reports_on_release() {
        let mut tracker = GestureTracker::default();
        assert_eq!(tracker.update(sample(10.0, 10.0, true, true)), None);
        assert_eq!(tracker.update(sample(12.0, 11.0, true, true)), None);
        assert_eq!(
            tracker.update(sample(12.0, 11.0, true, false)),
            Some(Gesture::Click)
        );
        assert_eq!(tracker.update(sample(12.0, 11.0, true, false)), None);
    }

    #[test]
    fn click_without_the_modifier_is_ignored() {
        let mut tracker = GestureTracker::default();
        assert_eq!(tracker.update(sample(10.0, 10.0, false, true)), None);
        assert_eq!(tracker.update(sample(10.0, 10.0, false, false)), None);
    }

    #[test]
    fn modifier_pressed_after_the_button_does_not_start_a_gesture() {
        let mut tracker = GestureTracker::default();
        assert_eq!(tracker.update(sample(10.0, 10.0, false, true)), None);
        assert_eq!(tracker.update(sample(10.0, 10.0, true, true)), None);
        assert_eq!(tracker.update(sample(10.0, 10.0, true, false)), None);
    }

    #[test]
    fn dragging_past_the_threshold_selects_a_region() {
        let mut tracker = GestureTracker::default();
        assert_eq!(tracker.update(sample(100.0, 100.0, true, true)), None);
        assert_eq!(
            tracker.update(sample(140.0, 130.0, true, true)),
            Some(Gesture::DragStart(at(100.0, 100.0)))
        );
        assert_eq!(
            tracker.update(sample(180.0, 160.0, true, true)),
            Some(Gesture::DragMove {
                start: at(100.0, 100.0),
                current: at(180.0, 160.0)
            })
        );
        // Letting go of the modifier mid-drag keeps the selection going.
        assert_eq!(
            tracker.update(sample(200.0, 170.0, false, false)),
            Some(Gesture::DragEnd {
                start: at(100.0, 100.0),
                end: at(200.0, 170.0)
            })
        );
    }

    #[test]
    fn small_jitter_stays_a_click() {
        let mut tracker = GestureTracker::default();
        tracker.update(sample(100.0, 100.0, true, true));
        assert_eq!(tracker.update(sample(104.0, 103.0, true, true)), None);
        assert_eq!(
            tracker.update(sample(104.0, 103.0, true, false)),
            Some(Gesture::Click)
        );
    }

    #[test]
    fn drag_rect_normalizes_any_direction() {
        let rect = drag_rect(at(300.0, 400.0), at(100.0, 150.0));
        assert_eq!(
            rect,
            Rect {
                x: 100.0,
                y: 150.0,
                width: 200.0,
                height: 250.0
            }
        );
    }

    #[test]
    fn selection_is_relative_to_the_monitor() {
        let monitor = Rect {
            x: 1920.0,
            y: 0.0,
            width: 2000.0,
            height: 1000.0,
        };
        let rect = Rect {
            x: 2420.0,
            y: 500.0,
            width: 1000.0,
            height: 250.0,
        };
        let selection = selection_fractions(rect, monitor);
        assert_eq!(selection.x, 0.25);
        assert_eq!(selection.y, 0.5);
        assert_eq!(selection.width, 0.5);
        assert_eq!(selection.height, 0.25);
    }

    #[test]
    fn places_the_window_below_right_and_flips_at_edges() {
        let bounds = Rect {
            x: 0.0,
            y: 0.0,
            width: 1000.0,
            height: 800.0,
        };
        let size = (100.0, 100.0);
        assert_eq!(
            place_near(at(200.0, 200.0), size, 20.0, bounds),
            at(220.0, 220.0)
        );
        assert_eq!(
            place_near(at(950.0, 200.0), size, 20.0, bounds),
            at(830.0, 220.0)
        );
        assert_eq!(
            place_near(at(200.0, 790.0), size, 20.0, bounds),
            at(220.0, 670.0)
        );
    }

    #[test]
    fn keeps_oversized_windows_inside_the_bounds_origin() {
        let bounds = Rect {
            x: 100.0,
            y: 50.0,
            width: 300.0,
            height: 200.0,
        };
        let placed = place_near(at(150.0, 100.0), (500.0, 400.0), 10.0, bounds);
        assert_eq!(placed, at(100.0, 50.0));
    }

    #[test]
    fn serializes_events_for_the_frontend() {
        assert_eq!(
            serde_json::to_string(&PointerEvent::Click).unwrap(),
            r#"{"kind":"click"}"#
        );
        assert_eq!(
            serde_json::to_string(&PointerEvent::Region {
                image: None,
                error: Some("x".to_string())
            })
            .unwrap(),
            r#"{"kind":"region","image":null,"error":"x"}"#
        );
    }

    #[test]
    fn modifier_codes_round_trip() {
        for modifier in [Modifier::Alt, Modifier::Primary] {
            assert_eq!(Modifier::from_code(modifier.code()), modifier);
        }
        let parsed: Modifier = serde_json::from_str("\"primary\"").unwrap();
        assert_eq!(parsed, Modifier::Primary);
    }
}
