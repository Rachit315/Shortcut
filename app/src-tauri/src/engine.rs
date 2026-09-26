//! Runtime glue: shared state, hotkey + trigger registration, firing prompts, the palette.

use crate::db::Store;
use crate::listener;
use crate::models::Settings;
use crate::paste::{PasteRequest, PasteService};
use crate::platform::{self, SavedFocus};
use crate::template;
use crate::triggers::{KeyInput, Matcher};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use tauri::menu::CheckMenuItem;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, Wry};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

#[derive(Debug, Clone)]
pub enum HotkeyAction {
    Palette,
    Prompt(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    Hotkey,
    Trigger { erase: usize },
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
pub struct PaletteMode {
    /// "search" or "fill"
    pub mode: String,
    pub prompt_id: Option<String>,
}

enum FocusReturn {
    Nothing,
    Main,
    Other(Option<SavedFocus>),
}

pub struct AppState {
    pub store: Mutex<Store>,
    pub paste: PasteService,
    pub data_dir: PathBuf,
    hotkey_actions: Mutex<HashMap<u32, HotkeyAction>>,
    /// prompt id (or "palette") → why its hotkey is not active
    pub hotkey_errors: Mutex<HashMap<String, String>>,
    /// (trigger, prompt id)
    triggers: Arc<RwLock<Vec<(String, String)>>>,
    triggers_active: Arc<AtomicBool>,
    listener_started: AtomicBool,
    pub listener_error: Arc<Mutex<Option<String>>>,
    focus: Mutex<FocusReturn>,
    pub palette_mode: Mutex<PaletteMode>,
    pub pause_item: Mutex<Option<CheckMenuItem<Wry>>>,
}

impl AppState {
    pub fn new(store: Store, data_dir: PathBuf) -> Self {
        Self {
            store: Mutex::new(store),
            paste: PasteService::start(),
            data_dir,
            hotkey_actions: Mutex::new(HashMap::new()),
            hotkey_errors: Mutex::new(HashMap::new()),
            triggers: Arc::new(RwLock::new(Vec::new())),
            triggers_active: Arc::new(AtomicBool::new(false)),
            listener_started: AtomicBool::new(false),
            listener_error: Arc::new(Mutex::new(None)),
            focus: Mutex::new(FocusReturn::Nothing),
            palette_mode: Mutex::new(PaletteMode { mode: "search".into(), prompt_id: None }),
            pause_item: Mutex::new(None),
        }
    }

    pub fn settings(&self) -> Settings {
        self.store.lock().unwrap().settings().unwrap_or_default()
    }
}

fn friendly_register_error(e: &str) -> String {
    let lower = e.to_lowercase();
    if lower.contains("already") || lower.contains("registered") || lower.contains("in use") || lower.contains("grab") {
        "Another app is already using this hotkey. Pick a different one.".into()
    } else {
        format!("The OS refused this hotkey ({e}).")
    }
}

/// Re-register every global hotkey and refresh the trigger table from the database.
pub fn sync(app: &AppHandle) {
    let state = app.state::<AppState>();
    let (settings, prompts) = {
        let store = state.store.lock().unwrap();
        (store.settings().unwrap_or_default(), store.list_prompts().unwrap_or_default())
    };

    // --- hotkeys (store lock released: registration may wait on the main thread) ---
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let mut actions: HashMap<u32, HotkeyAction> = HashMap::new();
    let mut errors: HashMap<String, String> = HashMap::new();
    if !settings.paused {
        let mut wanted: Vec<(String, String, HotkeyAction)> =
            vec![("palette".into(), settings.palette_hotkey.clone(), HotkeyAction::Palette)];
        for p in &prompts {
            if let Some(h) = &p.hotkey {
                wanted.push((p.id.clone(), h.clone(), HotkeyAction::Prompt(p.id.clone())));
            }
        }
        for (key, accel, action) in wanted {
            match Shortcut::from_str(&accel) {
                Err(e) => {
                    errors.insert(key, format!("Invalid hotkey: {e}"));
                }
                Ok(sc) => match gs.register(sc) {
                    Ok(()) => {
                        actions.insert(sc.id(), action);
                    }
                    Err(e) => {
                        errors.insert(key, friendly_register_error(&e.to_string()));
                    }
                },
            }
        }
    }
    *state.hotkey_actions.lock().unwrap() = actions;
    *state.hotkey_errors.lock().unwrap() = errors;

    // --- triggers ---
    *state.triggers.write().unwrap() =
        prompts.iter().filter_map(|p| p.trigger.clone().map(|t| (t, p.id.clone()))).collect();
    let active = settings.triggers_enabled && !settings.paused;
    state.triggers_active.store(active, Ordering::SeqCst);
    if active && !state.listener_started.swap(true, Ordering::SeqCst) {
        start_listener(app);
    }

    if let Some(item) = state.pause_item.lock().unwrap().as_ref() {
        let _ = item.set_checked(settings.paused);
    }
    let _ = app.emit("status-changed", ());
}

fn start_listener(app: &AppHandle) {
    let state = app.state::<AppState>();
    let triggers = state.triggers.clone();
    let active = state.triggers_active.clone();
    let err_slot = state.listener_error.clone();
    let matcher = Arc::new(Mutex::new(Matcher::default()));
    let app_for_sink = app.clone();
    let app_for_err = app.clone();
    listener::start(
        Box::new(move |input: KeyInput| {
            let mut m = matcher.lock().unwrap();
            if !active.load(Ordering::SeqCst) {
                m.feed(KeyInput::Reset, &[]);
                return;
            }
            let table = triggers.read().unwrap();
            let names: Vec<String> = table.iter().map(|(t, _)| t.clone()).collect();
            if let Some(i) = m.feed(input, &names) {
                let (trigger, prompt_id) = table[i].clone();
                drop(table);
                let erase = trigger.chars().count();
                let app = app_for_sink.clone();
                // Leave the OS hook callback quickly; do the work elsewhere.
                std::thread::spawn(move || fire(&app, &prompt_id, Source::Trigger { erase }));
            }
        }),
        Box::new(move |e: String| {
            *err_slot.lock().unwrap() = Some(e);
            let _ = app_for_err.emit("status-changed", ());
        }),
    );
}

pub fn on_hotkey(app: &AppHandle, id: u32) {
    let action = app.state::<AppState>().hotkey_actions.lock().unwrap().get(&id).cloned();
    match action {
        Some(HotkeyAction::Palette) => toggle_palette(app),
        Some(HotkeyAction::Prompt(pid)) => fire(app, &pid, Source::Hotkey),
        None => {}
    }
}

/// A hotkey or trigger fired: paste directly, or ask for fill-in values first.
pub fn fire(app: &AppHandle, prompt_id: &str, source: Source) {
    let state = app.state::<AppState>();
    if state.paste.is_busy() {
        return;
    }
    let (prompt, settings) = {
        let store = state.store.lock().unwrap();
        match store.get_prompt(prompt_id) {
            Ok(p) => (p, store.settings().unwrap_or_default()),
            Err(_) => return,
        }
    };
    if settings.paused {
        return;
    }
    let parsed = template::parse(&prompt.body);
    let erase = match source {
        Source::Trigger { erase } => erase,
        Source::Hotkey => 0,
    };
    if !parsed.vars.is_empty() {
        state.paste.erase(erase);
        show_palette(app, PaletteMode { mode: "fill".into(), prompt_id: Some(prompt.id.clone()) });
        return;
    }
    let req = PasteRequest {
        parsed,
        values: HashMap::new(),
        erase,
        release_modifiers: source == Source::Hotkey,
        delay_before_ms: 0,
        copy_only: false,
        settings,
    };
    submit(app, &prompt.id, req);
}

pub fn submit(app: &AppHandle, prompt_id: &str, req: PasteRequest) -> bool {
    let copy_only = req.copy_only;
    let app2 = app.clone();
    let pid = prompt_id.to_string();
    app.state::<AppState>().paste.submit(req, move |result| match result {
        Ok(()) => {
            let state = app2.state::<AppState>();
            let _ = state.store.lock().unwrap().record_use(&pid);
            let _ = app2.emit("prompt-used", serde_json::json!({ "id": pid, "copied": copy_only }));
        }
        Err(e) => {
            let _ = app2.emit("paste-error", e);
        }
    })
}

// ---------------- palette ----------------

fn position_palette(app: &AppHandle, win: &tauri::WebviewWindow) {
    let placed = (|| -> Option<()> {
        let cursor = app.cursor_position().ok()?;
        let monitor = app.monitor_from_point(cursor.x, cursor.y).ok().flatten().or_else(|| app.primary_monitor().ok().flatten())?;
        let outer = win.outer_size().ok()?;
        let (mp, ms) = (monitor.position(), monitor.size());
        let x = mp.x + (ms.width as i32 - outer.width as i32) / 2;
        let y = mp.y + (ms.height as i32 - outer.height as i32) / 4;
        win.set_position(PhysicalPosition::new(x, y)).ok()
    })();
    if placed.is_none() {
        let _ = win.center();
    }
}

pub fn show_palette(app: &AppHandle, mode: PaletteMode) {
    let Some(win) = app.get_webview_window("palette") else { return };
    let state = app.state::<AppState>();
    let already_open = win.is_visible().unwrap_or(false);
    if !already_open {
        let main_focused = app.get_webview_window("main").and_then(|m| m.is_focused().ok()).unwrap_or(false);
        *state.focus.lock().unwrap() =
            if main_focused { FocusReturn::Main } else { FocusReturn::Other(platform::save_focus()) };
        position_palette(app, &win);
    }
    *state.palette_mode.lock().unwrap() = mode.clone();
    let _ = win.show();
    let _ = win.unminimize();
    let _ = win.set_focus();
    platform::focus_own_window(&win);
    let _ = win.emit("palette-open", mode);
}

pub fn toggle_palette(app: &AppHandle) {
    let visible = app.get_webview_window("palette").and_then(|w| w.is_visible().ok()).unwrap_or(false);
    if visible {
        hide_palette(app, true);
    } else {
        show_palette(app, PaletteMode { mode: "search".into(), prompt_id: None });
    }
}

/// Hide the palette and (optionally) hand focus back to where the user was.
pub fn hide_palette(app: &AppHandle, restore: bool) {
    if let Some(win) = app.get_webview_window("palette") {
        let _ = win.hide();
    }
    let focus = std::mem::replace(&mut *app.state::<AppState>().focus.lock().unwrap(), FocusReturn::Nothing);
    if !restore {
        return;
    }
    match focus {
        FocusReturn::Main => {
            if let Some(m) = app.get_webview_window("main") {
                let _ = m.set_focus();
            }
        }
        FocusReturn::Other(saved) => {
            #[cfg(target_os = "macos")]
            {
                let _ = saved;
                // Hiding the app returns focus to the previously active application.
                let main_visible = app.get_webview_window("main").and_then(|m| m.is_visible().ok()).unwrap_or(false);
                if !main_visible {
                    let _ = app.hide();
                }
            }
            #[cfg(not(target_os = "macos"))]
            if let Some(s) = saved {
                platform::restore_focus(s);
            }
        }
        FocusReturn::Nothing => {}
    }
}

pub fn show_main(app: &AppHandle) {
    if let Some(m) = app.get_webview_window("main") {
        let _ = m.show();
        let _ = m.unminimize();
        let _ = m.set_focus();
    }
}

pub fn set_paused(app: &AppHandle, paused: bool) -> Result<Settings, String> {
    let saved = {
        let state = app.state::<AppState>();
        let store = state.store.lock().unwrap();
        let s = store.settings()?;
        store.save_settings(Settings { paused, ..s })?
    };
    sync(app);
    Ok(saved)
}
