//! IPC commands exposed to the UI. All errors are user-presentable strings.

use crate::engine::{self, AppState, PaletteMode};
use crate::hotkey::{self, HotkeyCheck, Os};
use crate::io;
use crate::models::*;
use crate::paste::PasteRequest;
use crate::platform;
use crate::template::{self, VarSpec};
use crate::triggers::{self, TriggerCheck};
use serde::Serialize;
use std::collections::HashMap;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_autostart::ManagerExt;

type R<T> = Result<T, String>;

fn changed(app: &AppHandle) {
    engine::sync(app);
    let _ = app.emit("data-changed", ());
}

#[tauri::command]
pub fn list_prompts(state: State<AppState>) -> R<Vec<Prompt>> {
    state.store.lock().unwrap().list_prompts()
}

#[tauri::command]
pub fn save_prompt(app: AppHandle, state: State<AppState>, input: PromptInput) -> R<Prompt> {
    let p = state.store.lock().unwrap().save_prompt(&input)?;
    changed(&app);
    Ok(p)
}

#[tauri::command]
pub fn delete_prompt(app: AppHandle, state: State<AppState>, id: String) -> R<()> {
    state.store.lock().unwrap().delete_prompt(&id)?;
    changed(&app);
    Ok(())
}

#[tauri::command]
pub fn duplicate_prompt(app: AppHandle, state: State<AppState>, id: String) -> R<Prompt> {
    let p = state.store.lock().unwrap().duplicate_prompt(&id)?;
    changed(&app);
    Ok(p)
}

#[tauri::command]
pub fn list_folders(state: State<AppState>) -> R<Vec<Folder>> {
    state.store.lock().unwrap().list_folders()
}

#[tauri::command]
pub fn save_folder(app: AppHandle, state: State<AppState>, id: Option<String>, name: String) -> R<Folder> {
    let f = state.store.lock().unwrap().save_folder(id.as_deref(), &name)?;
    let _ = app.emit("data-changed", ());
    Ok(f)
}

#[tauri::command]
pub fn delete_folder(app: AppHandle, state: State<AppState>, id: String) -> R<()> {
    state.store.lock().unwrap().delete_folder(&id)?;
    let _ = app.emit("data-changed", ());
    Ok(())
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> R<Settings> {
    state.store.lock().unwrap().settings()
}

#[tauri::command]
pub fn save_settings(app: AppHandle, state: State<AppState>, settings: Settings) -> R<Settings> {
    let (before, saved) = {
        let store = state.store.lock().unwrap();
        let before = store.settings()?;
        (before, store.save_settings(settings)?)
    };
    let mut autostart_error = None;
    if before.launch_at_login != saved.launch_at_login {
        let al = app.autolaunch();
        let r = if saved.launch_at_login { al.enable() } else { al.disable() };
        if let Err(e) = r {
            autostart_error = Some(format!("Settings saved, but launch at login couldn't be changed: {e}"));
        }
    }
    changed(&app);
    match autostart_error {
        Some(e) => Err(e),
        None => Ok(saved),
    }
}

#[tauri::command]
pub fn set_paused(app: AppHandle, paused: bool) -> R<Settings> {
    let s = engine::set_paused(&app, paused)?;
    let _ = app.emit("data-changed", ());
    Ok(s)
}

#[tauri::command]
pub fn check_hotkey(state: State<AppState>, accelerator: String, prompt_id: Option<String>, for_palette: Option<bool>) -> HotkeyCheck {
    let store = state.store.lock().unwrap();
    let for_palette = for_palette.unwrap_or(false);
    hotkey::check(&accelerator, Os::current(), |a| {
        store.hotkey_owner_ext(a, prompt_id.as_deref(), !for_palette).ok().flatten()
    })
}

#[tauri::command]
pub fn suggest_hotkey(state: State<AppState>) -> Option<String> {
    let store = state.store.lock().unwrap();
    hotkey::suggest(|a| store.hotkey_owner(a, None).ok().flatten().is_some())
}

#[tauri::command]
pub fn check_trigger(state: State<AppState>, trigger: String, prompt_id: Option<String>) -> R<TriggerCheck> {
    let others = state.store.lock().unwrap().other_triggers(prompt_id.as_deref())?;
    Ok(triggers::check(&trigger, &others))
}

#[derive(Serialize)]
pub struct Status {
    pub paused: bool,
    pub triggers_enabled: bool,
    pub hotkey_errors: HashMap<String, String>,
    pub listener_error: Option<String>,
    pub accessibility: Option<bool>,
}

#[tauri::command]
pub fn get_status(state: State<AppState>) -> Status {
    let s = state.settings();
    Status {
        paused: s.paused,
        triggers_enabled: s.triggers_enabled,
        hotkey_errors: state.hotkey_errors.lock().unwrap().clone(),
        listener_error: state.listener_error.lock().unwrap().clone(),
        accessibility: platform::accessibility_granted(),
    }
}

#[tauri::command]
pub fn parse_variables(body: String) -> Vec<VarSpec> {
    template::parse(&body).vars
}

#[derive(Serialize)]
pub struct FillRequest {
    pub prompt: Prompt,
    pub vars: Vec<VarSpec>,
    pub last_values: HashMap<String, String>,
}

#[tauri::command]
pub fn get_fill_request(state: State<AppState>, prompt_id: String) -> R<FillRequest> {
    let store = state.store.lock().unwrap();
    let prompt = store.get_prompt(&prompt_id)?;
    let vars = template::parse(&prompt.body).vars;
    let last_values = store.variable_values(&prompt_id)?;
    Ok(FillRequest { prompt, vars, last_values })
}

#[tauri::command]
pub fn get_palette_mode(state: State<AppState>) -> PaletteMode {
    state.palette_mode.lock().unwrap().clone()
}

fn build_request(state: &AppState, prompt_id: &str, values: HashMap<String, String>, copy_only: bool) -> R<PasteRequest> {
    let store = state.store.lock().unwrap();
    let prompt = store.get_prompt(prompt_id)?;
    let settings = store.settings()?;
    let parsed = template::parse(&prompt.body);
    // Keep only declared variables and bound their size.
    let values: HashMap<String, String> = values
        .into_iter()
        .filter(|(k, _)| parsed.vars.iter().any(|v| &v.name == k))
        .map(|(k, v)| (k, v.chars().take(20_000).collect()))
        .collect();
    if !values.is_empty() {
        store.save_variable_values(prompt_id, &values)?;
    }
    Ok(PasteRequest { parsed, values, erase: 0, release_modifiers: false, delay_before_ms: 0, copy_only, settings })
}

/// Paste (or copy) from the palette: hide it, give focus back, then inject.
#[tauri::command]
pub fn palette_paste(app: AppHandle, state: State<AppState>, prompt_id: String, values: Option<HashMap<String, String>>, copy_only: Option<bool>) -> R<()> {
    let copy_only = copy_only.unwrap_or(false);
    let mut req = build_request(&state, &prompt_id, values.unwrap_or_default(), copy_only)?;
    req.delay_before_ms = if copy_only { 0 } else { 180 };
    engine::hide_palette(&app, true);
    if !engine::submit(&app, &prompt_id, req) {
        return Err("A paste is already in progress.".into());
    }
    Ok(())
}

/// Copy the rendered prompt to the clipboard (editor "Copy" button).
#[tauri::command]
pub fn copy_prompt(app: AppHandle, state: State<AppState>, prompt_id: String, values: Option<HashMap<String, String>>) -> R<()> {
    let req = build_request(&state, &prompt_id, values.unwrap_or_default(), true)?;
    if !engine::submit(&app, &prompt_id, req) {
        return Err("A paste is already in progress.".into());
    }
    Ok(())
}

#[tauri::command]
pub fn palette_dismiss(app: AppHandle, restore: bool) {
    engine::hide_palette(&app, restore);
}

#[tauri::command]
pub fn open_palette(app: AppHandle) {
    engine::show_palette(&app, PaletteMode { mode: "search".into(), prompt_id: None });
}

#[tauri::command]
pub fn hide_main(app: AppHandle) {
    if let Some(m) = app.get_webview_window("main") {
        let _ = m.hide();
    }
}

#[tauri::command]
pub fn export_data(state: State<AppState>, path: String, format: String) -> R<usize> {
    let data = state.store.lock().unwrap().export()?;
    let text = match format.as_str() {
        "markdown" | "md" => io::to_markdown(&data),
        _ => io::to_json(&data),
    };
    std::fs::write(&path, text).map_err(|e| format!("Couldn't write {path}: {e}"))?;
    Ok(data.prompts.len())
}

#[tauri::command]
pub fn import_data(app: AppHandle, state: State<AppState>, path: String) -> R<ImportReport> {
    let meta = std::fs::metadata(&path).map_err(|e| format!("Couldn't open {path}: {e}"))?;
    if meta.len() as usize > io::MAX_IMPORT_BYTES {
        return Err("That file is larger than 10 MB.".into());
    }
    let text = std::fs::read_to_string(&path).map_err(|e| format!("Couldn't read {path}: {e}"))?;
    let lower = path.to_lowercase();
    let data = if lower.ends_with(".md") || lower.ends_with(".markdown") || !text.trim_start().starts_with('{') {
        io::from_markdown(&text)?
    } else {
        io::from_json(&text)?
    };
    let report = state.store.lock().unwrap().import(&data)?;
    changed(&app);
    Ok(report)
}

#[derive(Serialize)]
pub struct AppInfo {
    pub version: String,
    pub os: String,
    pub data_dir: String,
    pub session: String,
}

#[tauri::command]
pub fn get_app_info(app: AppHandle, state: State<AppState>) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        os: platform::os_name().into(),
        data_dir: state.data_dir.display().to_string(),
        session: platform::linux_session(),
    }
}

#[tauri::command]
pub fn open_accessibility_settings() -> R<()> {
    platform::open_accessibility_settings()
}
