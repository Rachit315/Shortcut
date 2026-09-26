//! OS keyboard listeners that feed `triggers::KeyInput` for text expansion.
//!
//! * Windows / Linux (X11): `rdev` (low-level hook / XRecord). `event.name` is layout-aware.
//! * macOS: a listen-only CGEventTap. rdev's macOS key-name translation calls Text Input
//!   Source APIs off the main thread, which crashes on macOS 14+, so we read the typed
//!   characters with `CGEventKeyboardGetUnicodeString` instead (thread-safe, layout-aware).
//!
//! Only the in-memory rolling buffer in `triggers::Matcher` ever sees characters; nothing is
//! logged or stored.

use crate::triggers::KeyInput;

pub type Sink = Box<dyn Fn(KeyInput) + Send + 'static>;

/// Start the listener on a background thread. Errors (e.g. missing permission) are reported
/// through `on_error` because some platforms only fail after the thread starts.
pub fn start(sink: Sink, on_error: Box<dyn Fn(String) + Send + 'static>) {
    std::thread::Builder::new()
        .name("shortcut-keys".into())
        .spawn(move || {
            if let Err(e) = imp::run(sink) {
                on_error(e);
            }
        })
        .expect("failed to spawn keyboard listener");
}

#[cfg(any(windows, target_os = "linux"))]
mod imp {
    use super::Sink;
    use crate::paste::is_suppressed;
    use crate::triggers::KeyInput;
    use rdev::{listen, EventType, Key};

    pub fn run(sink: Sink) -> Result<(), String> {
        let mut ctrl = false;
        let mut alt = false;
        let mut meta = false;
        listen(move |ev| {
            if is_suppressed() {
                return;
            }
            match ev.event_type {
                EventType::KeyPress(k) => match k {
                    Key::ControlLeft | Key::ControlRight => ctrl = true,
                    Key::Alt => alt = true,
                    Key::MetaLeft | Key::MetaRight => meta = true,
                    Key::ShiftLeft | Key::ShiftRight | Key::CapsLock | Key::AltGr | Key::NumLock => {}
                    Key::Backspace => sink(KeyInput::Backspace),
                    Key::Return
                    | Key::KpReturn
                    | Key::Tab
                    | Key::Escape
                    | Key::UpArrow
                    | Key::DownArrow
                    | Key::LeftArrow
                    | Key::RightArrow
                    | Key::Home
                    | Key::End
                    | Key::PageUp
                    | Key::PageDown
                    | Key::Delete => sink(KeyInput::Reset),
                    _ => {
                        // Ctrl+Alt is AltGr on Windows and produces characters; any other
                        // Ctrl/Alt/Meta chord is a shortcut, not typing.
                        let altgr = ctrl && alt;
                        if (ctrl || alt || meta) && !altgr {
                            sink(KeyInput::Reset);
                            return;
                        }
                        match ev.name.as_deref() {
                            Some(s) if !s.is_empty() => {
                                for c in s.chars() {
                                    sink(if c.is_control() { KeyInput::Reset } else { KeyInput::Char(c) });
                                }
                            }
                            _ => {}
                        }
                    }
                },
                EventType::KeyRelease(k) => match k {
                    Key::ControlLeft | Key::ControlRight => ctrl = false,
                    Key::Alt => alt = false,
                    Key::MetaLeft | Key::MetaRight => meta = false,
                    _ => {}
                },
                EventType::ButtonPress(_) => sink(KeyInput::Reset),
                _ => {}
            }
        })
        .map_err(|e| format!("Text triggers are unavailable: keyboard listener failed ({e:?}). On Linux this needs an X11 session."))
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use super::Sink;
    use crate::paste::is_suppressed;
    use crate::triggers::KeyInput;
    use core_foundation::runloop::{kCFRunLoopCommonModes, CFRunLoop};
    use core_graphics::event::{
        CGEvent, CGEventFlags, CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement, CGEventType,
        EventField,
    };
    use foreign_types_shared::ForeignType;

    type UniChar = u16;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn CGEventKeyboardGetUnicodeString(
            event: *mut std::ffi::c_void,
            max_len: std::os::raw::c_ulong,
            actual_len: *mut std::os::raw::c_ulong,
            buf: *mut UniChar,
        );
    }

    fn typed_chars(event: &CGEvent) -> String {
        let mut buf = [0u16; 8];
        let mut len: std::os::raw::c_ulong = 0;
        unsafe {
            CGEventKeyboardGetUnicodeString(event.as_ptr() as *mut _, buf.len() as _, &mut len, buf.as_mut_ptr());
        }
        String::from_utf16_lossy(&buf[..(len as usize).min(buf.len())])
    }

    const BACKSPACE: i64 = 51;
    const RESET_KEYS: &[i64] = &[36, 76, 48, 53, 123, 124, 125, 126, 115, 119, 116, 121, 117];

    pub fn run(sink: Sink) -> Result<(), String> {
        let tap = CGEventTap::new(
            CGEventTapLocation::Session,
            CGEventTapPlacement::HeadInsertEventTap,
            CGEventTapOptions::ListenOnly,
            vec![CGEventType::KeyDown, CGEventType::LeftMouseDown, CGEventType::RightMouseDown],
            move |_proxy, etype, event| {
                if is_suppressed() {
                    return None;
                }
                match etype {
                    CGEventType::KeyDown => {
                        let code = event.get_integer_value_field(EventField::KEYBOARD_EVENT_KEYCODE);
                        let flags = event.get_flags();
                        if code == BACKSPACE {
                            sink(KeyInput::Backspace);
                        } else if RESET_KEYS.contains(&code)
                            || flags.contains(CGEventFlags::CGEventFlagCommand)
                            || flags.contains(CGEventFlags::CGEventFlagControl)
                        {
                            sink(KeyInput::Reset);
                        } else {
                            for c in typed_chars(event).chars() {
                                sink(if c.is_control() { KeyInput::Reset } else { KeyInput::Char(c) });
                            }
                        }
                    }
                    CGEventType::LeftMouseDown | CGEventType::RightMouseDown => sink(KeyInput::Reset),
                    _ => {}
                }
                None
            },
        )
        .map_err(|_| {
            "Text triggers need permission: allow Shortcut under System Settings → Privacy & Security → Accessibility (and Input Monitoring), then restart Shortcut.".to_string()
        })?;
        let source = tap
            .mach_port
            .create_runloop_source(0)
            .map_err(|_| "Couldn't attach the keyboard listener to a run loop.".to_string())?;
        let run_loop = CFRunLoop::get_current();
        unsafe { run_loop.add_source(&source, kCFRunLoopCommonModes) };
        tap.enable();
        CFRunLoop::run_current();
        Ok(())
    }
}
