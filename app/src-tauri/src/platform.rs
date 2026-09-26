//! Small platform helpers: remembering/restoring the focused window around the palette,
//! macOS Accessibility status, and Linux session detection.

/// A window to give focus back to after the palette closes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SavedFocus {
    #[allow(dead_code)]
    handle: u64,
    #[allow(dead_code)]
    ewmh: bool,
}

#[cfg(windows)]
pub fn save_focus() -> Option<SavedFocus> {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    let h = unsafe { GetForegroundWindow() };
    (!h.is_null()).then(|| SavedFocus { handle: h as u64, ewmh: false })
}

#[cfg(windows)]
pub fn restore_focus(s: SavedFocus) {
    use windows_sys::Win32::UI::WindowsAndMessaging::SetForegroundWindow;
    unsafe {
        SetForegroundWindow(s.handle as _);
    }
}

#[cfg(target_os = "linux")]
mod x11 {
    use super::SavedFocus;
    use x11rb::connection::Connection;
    use x11rb::protocol::xproto::{
        AtomEnum, ClientMessageEvent, ConnectionExt, EventMask, InputFocus, CLIENT_MESSAGE_EVENT,
    };
    use x11rb::wrapper::ConnectionExt as _;
    use x11rb::CURRENT_TIME;

    fn active_atom(conn: &impl Connection) -> Option<u32> {
        Some(conn.intern_atom(false, b"_NET_ACTIVE_WINDOW").ok()?.reply().ok()?.atom)
    }

    pub fn save() -> Option<SavedFocus> {
        let (conn, screen) = x11rb::connect(None).ok()?;
        let root = conn.setup().roots[screen].root;
        if let Some(atom) = active_atom(&conn) {
            if let Ok(Ok(prop)) = conn.get_property(false, root, atom, AtomEnum::WINDOW, 0, 1).map(|c| c.reply()) {
                if let Some(w) = prop.value32().and_then(|mut v| v.next()).filter(|w| *w != 0) {
                    return Some(SavedFocus { handle: w as u64, ewmh: true });
                }
            }
        }
        let focus = conn.get_input_focus().ok()?.reply().ok()?.focus;
        (focus > 1).then(|| SavedFocus { handle: focus as u64, ewmh: false })
    }

    /// Give keyboard focus to one of our own windows. GTK focuses with the timestamp of the last
    /// X event *we* received, which the X server ignores when the user typed a text trigger into
    /// another app (we never saw those keys). So ask again with CURRENT_TIME, once it is mapped.
    pub fn force_focus(window: u32) {
        std::thread::spawn(move || {
            let Ok((conn, screen)) = x11rb::connect(None) else { return };
            let root = conn.setup().roots[screen].root;
            for _ in 0..40 {
                let viewable = conn
                    .get_window_attributes(window)
                    .ok()
                    .and_then(|c| c.reply().ok())
                    .map(|a| a.map_state == x11rb::protocol::xproto::MapState::VIEWABLE)
                    .unwrap_or(false);
                if viewable {
                    if let Some(atom) = active_atom(&conn) {
                        let ev = ClientMessageEvent {
                            response_type: CLIENT_MESSAGE_EVENT,
                            format: 32,
                            sequence: 0,
                            window,
                            type_: atom,
                            data: [2u32, CURRENT_TIME, 0, 0, 0].into(),
                        };
                        let _ = conn.send_event(false, root, EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY, ev);
                    }
                    let _ = conn.set_input_focus(InputFocus::PARENT, window, CURRENT_TIME);
                    let _ = conn.sync();
                    let focused = conn.get_input_focus().ok().and_then(|c| c.reply().ok()).map(|r| r.focus);
                    if focused == Some(window) {
                        return;
                    }
                }
                std::thread::sleep(std::time::Duration::from_millis(25));
            }
        });
    }

    pub fn restore(s: SavedFocus) {
        let Ok((conn, screen)) = x11rb::connect(None) else { return };
        let root = conn.setup().roots[screen].root;
        let window = s.handle as u32;
        if s.ewmh {
            if let Some(atom) = active_atom(&conn) {
                let ev = ClientMessageEvent {
                    response_type: CLIENT_MESSAGE_EVENT,
                    format: 32,
                    sequence: 0,
                    window,
                    type_: atom,
                    // source indication 2 = pager/tool: window managers honour it without focus-stealing checks
                    data: [2u32, CURRENT_TIME, 0, 0, 0].into(),
                };
                let _ = conn.send_event(false, root, EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY, ev);
            }
        }
        let _ = conn.set_input_focus(InputFocus::PARENT, window, CURRENT_TIME);
        let _ = conn.flush();
        let _ = conn.sync();
    }
}

#[cfg(target_os = "linux")]
pub fn save_focus() -> Option<SavedFocus> {
    x11::save()
}

#[cfg(target_os = "linux")]
pub fn restore_focus(s: SavedFocus) {
    x11::restore(s)
}

/// Make sure one of our windows really has keyboard focus (see `x11::force_focus`).
#[cfg(target_os = "linux")]
pub fn focus_own_window(win: &tauri::WebviewWindow) {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    let w = win.clone();
    let _ = win.run_on_main_thread(move || {
        if let Ok(handle) = w.window_handle() {
            if let RawWindowHandle::Xlib(x) = handle.as_raw() {
                x11::force_focus(x.window as u32);
            }
        }
    });
}

#[cfg(not(target_os = "linux"))]
pub fn focus_own_window(_win: &tauri::WebviewWindow) {}

/// macOS gives focus back to the previous app when Shortcut hides itself (see `engine`).
#[cfg(target_os = "macos")]
pub fn save_focus() -> Option<SavedFocus> {
    None
}

#[cfg(target_os = "macos")]
pub fn restore_focus(_s: SavedFocus) {}

#[cfg(target_os = "macos")]
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
}

/// `Some(granted)` on macOS, `None` where no permission is needed.
pub fn accessibility_granted() -> Option<bool> {
    #[cfg(target_os = "macos")]
    {
        Some(unsafe { AXIsProcessTrusted() })
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

pub fn open_accessibility_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
    }
}

/// "wayland", "x11" or "" (non-Linux / unknown).
pub fn linux_session() -> String {
    if cfg!(target_os = "linux") {
        let t = std::env::var("XDG_SESSION_TYPE").unwrap_or_default().to_lowercase();
        if t == "wayland" || (t.is_empty() && std::env::var("WAYLAND_DISPLAY").is_ok()) {
            return "wayland".into();
        }
        return "x11".into();
    }
    String::new()
}

pub fn os_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(windows) {
        "windows"
    } else {
        "linux"
    }
}
