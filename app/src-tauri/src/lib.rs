pub mod commands;
pub mod db;
pub mod engine;
pub mod hotkey;
pub mod io;
pub mod listener;
pub mod models;
pub mod paste;
pub mod platform;
pub mod template;
pub mod triggers;

use engine::{AppState, PaletteMode};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::ShortcutState;

fn build_windows(app: &AppHandle) -> tauri::Result<()> {
    WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Shortcut")
        .inner_size(1120.0, 740.0)
        .min_inner_size(900.0, 600.0)
        .visible(false)
        .center()
        .build()?;
    WebviewWindowBuilder::new(app, "palette", WebviewUrl::App("palette.html".into()))
        .title("Shortcut — Quick palette")
        .inner_size(640.0, 440.0)
        .decorations(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        .visible(false)
        .build()?;
    Ok(())
}

fn build_tray(app: &AppHandle, paused: bool) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Shortcut", true, None::<&str>)?;
    let palette = MenuItem::with_id(app, "palette", "Quick palette", true, None::<&str>)?;
    let pause = CheckMenuItem::with_id(app, "pause", "Pause shortcuts", true, paused, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Shortcut", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&open, &palette, &PredefinedMenuItem::separator(app)?, &pause, &PredefinedMenuItem::separator(app)?, &quit],
    )?;
    *app.state::<AppState>().pause_item.lock().unwrap() = Some(pause);
    let mut builder = TrayIconBuilder::with_id("tray")
        .tooltip("Shortcut")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => engine::show_main(app),
            "palette" => engine::show_palette(app, PaletteMode { mode: "search".into(), prompt_id: None }),
            "pause" => {
                let paused = app.state::<AppState>().settings().paused;
                let _ = engine::set_paused(app, !paused);
                let _ = tauri::Emitter::emit(app, "data-changed", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                engine::show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let start_hidden =
        std::env::args().any(|a| a == "--minimized") || std::env::var_os("SHORTCUT_START_HIDDEN").is_some();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| engine::show_main(app)))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    // Fire on release so the physical modifiers are (mostly) up before we inject.
                    if event.state == ShortcutState::Released {
                        engine::on_hotkey(app, shortcut.id());
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--minimized"])))
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let data_dir = match std::env::var_os("SHORTCUT_DATA_DIR") {
                Some(d) => std::path::PathBuf::from(d),
                None => app.path().app_data_dir()?,
            };
            std::fs::create_dir_all(&data_dir)?;
            let mut store = db::Store::open(&data_dir.join("shortcut.db"))?;
            store.seed_if_first_run()?;
            let settings = store.settings()?;
            app.manage(AppState::new(store, data_dir));

            let handle = app.handle().clone();
            build_windows(&handle)?;
            if let Err(e) = build_tray(&handle, settings.paused) {
                // No tray (e.g. a desktop without an indicator service) — the window still works.
                eprintln!("shortcut: tray unavailable: {e}");
            }
            engine::sync(&handle);
            if !start_hidden || !settings.onboarding_complete {
                engine::show_main(&handle);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Closing hides to the tray; quit from the tray menu.
                api.prevent_close();
                if window.label() == "palette" {
                    engine::hide_palette(window.app_handle(), true);
                } else {
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_prompts,
            commands::save_prompt,
            commands::delete_prompt,
            commands::duplicate_prompt,
            commands::list_folders,
            commands::save_folder,
            commands::delete_folder,
            commands::get_settings,
            commands::save_settings,
            commands::set_paused,
            commands::check_hotkey,
            commands::suggest_hotkey,
            commands::check_trigger,
            commands::get_status,
            commands::parse_variables,
            commands::get_fill_request,
            commands::get_palette_mode,
            commands::palette_paste,
            commands::copy_prompt,
            commands::palette_dismiss,
            commands::open_palette,
            commands::hide_main,
            commands::export_data,
            commands::import_data,
            commands::get_app_info,
            commands::open_accessibility_settings,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Shortcut");

    app.run(|_app, event| {
        // Keep running in the tray when every window is hidden/closed.
        if let RunEvent::ExitRequested { api, code, .. } = event {
            if code.is_none() {
                api.prevent_exit();
            }
        }
    });
}
