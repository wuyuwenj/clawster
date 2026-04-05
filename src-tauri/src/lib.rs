mod clawbot;
mod commands;
mod hotkeys;
mod onboarding;
mod pet;
mod screen;
mod store;
mod tutorial;
mod watchers;
pub mod windows;
mod workspace;

use clawbot::ClawBotClient;
use pet::PetState;
use tutorial::TutorialManager;
use store::AppStore;
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tauri::menu::{MenuBuilder, MenuItemBuilder};

/// Start background services after onboarding completes or on normal launch
pub fn start_main_app_services(
    app: AppHandle<Wry>,
    clawbot_client: Arc<ClawBotClient>,
    pet_state: Arc<PetState>,
) {
    std::thread::spawn(move || {
        // Small delay to let the Tauri runtime initialize
        std::thread::sleep(std::time::Duration::from_millis(500));

        // Start background polling
        clawbot::start_polling(clawbot_client.clone(), app.clone());

        // Start watchers
        let watch_active_app = app.state::<AppStore>().get_value("watch.activeApp")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        let send_window_titles = app.state::<AppStore>().get_value("watch.sendWindowTitles")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        let watch_folders: Vec<String> = app.state::<AppStore>().get_value("watch.folders")
            .and_then(|v| v.as_array().map(|arr| {
                arr.iter().filter_map(|s| s.as_str().map(String::from)).collect()
            }))
            .unwrap_or_default();

        watchers::start_app_watcher(
            clawbot_client.clone(),
            app.clone(),
            watch_active_app,
            send_window_titles,
        );
        watchers::start_file_watcher(
            watch_folders,
            clawbot_client.clone(),
            app.clone(),
        );

        // Start pet behavior systems
        let is_dev = cfg!(debug_assertions);
        pet::start_attention_seeker(app.clone(), pet_state.clone(), is_dev);
        pet::start_idle_behaviors(app.clone(), pet_state.clone());
        pet::start_sleep_check(app.clone(), pet_state.clone());

        // Start idle detection for chat popups
        pet::start_idle_detection(app.clone(), pet_state, clawbot_client);

        // Register global hotkeys
        hotkeys::register_hotkeys(&app);
    });
}

use tauri::{AppHandle, Wry};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // Initialize the app store
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data directory");
            let app_store = AppStore::new(app_data_dir);

            // Read config values before moving store into managed state
            let clawbot_url = app_store.get_value("clawbot.url")
                .and_then(|v| v.as_str().map(String::from))
                .unwrap_or_else(|| "http://127.0.0.1:18789".to_string());
            let clawbot_token = app_store.get_value("clawbot.token")
                .and_then(|v| v.as_str().map(String::from))
                .unwrap_or_default();
            let workspace_type = app_store.get_value("onboarding.workspaceType")
                .and_then(|v| v.as_str().map(String::from));

            // Check onboarding state before managing store
            let onboarding_completed = app_store.get_value("onboarding.completed")
                .and_then(|v| v.as_bool()).unwrap_or(false);
            let onboarding_skipped = app_store.get_value("onboarding.skipped")
                .and_then(|v| v.as_bool()).unwrap_or(false);

            app.manage(app_store);

            // Initialize ClawBot client
            let agent_id = if workspace_type.as_deref() == Some("clawster") {
                Some("clawster".to_string())
            } else {
                None
            };
            let clawbot_client = Arc::new(ClawBotClient::new(clawbot_url, clawbot_token, agent_id));
            app.manage(clawbot_client.clone());

            // Initialize pet state and tutorial manager
            let pet_state = Arc::new(PetState::new());
            app.manage(pet_state.clone());
            let tutorial_mgr = Arc::new(TutorialManager::new());
            app.manage(tutorial_mgr);

            // Get the pet window created from tauri.conf.json
            let pet_window = app.get_webview_window("pet").expect("pet window not found");

            // On macOS, set transparent background
            #[cfg(target_os = "macos")]
            {
                use cocoa::appkit::{NSColor, NSWindow};
                use cocoa::base::nil;

                let ns_window = pet_window.ns_window().unwrap() as cocoa::base::id;
                unsafe {
                    let clear = NSColor::clearColor(nil);
                    ns_window.setBackgroundColor_(clear);
                    #[allow(deprecated)]
                    ns_window.setHasShadow_(false);
                }
            }

            // Restore saved pet position
            let saved_pos = app.state::<AppStore>().get_value("pet.position");
            if let Some(pos) = saved_pos {
                if let (Some(x), Some(y)) = (
                    pos.get("x").and_then(|v| v.as_f64()),
                    pos.get("y").and_then(|v| v.as_f64()),
                ) {
                    let _ = pet_window.set_position(tauri::LogicalPosition::new(x, y));
                }
            }

            if onboarding_completed || onboarding_skipped {
                // Show pet window and start services
                pet_window.show().unwrap();
                start_main_app_services(
                    app.handle().clone(),
                    clawbot_client,
                    pet_state,
                );
            } else {
                // Show onboarding window (pet stays hidden until onboarding completes)
                if let Ok(()) = windows::create_onboarding_window(app.handle()) {
                    // Show onboarding after it's created
                    if let Some(onb) = app.get_webview_window(windows::LABEL_ONBOARDING) {
                        let _ = onb.show();
                    }
                }
            }

            // Setup system tray menu
            if let Some(tray) = app.tray_by_id("main") {
                let app_handle = app.handle().clone();
                let open_assistant = MenuItemBuilder::with_id("open_assistant", "Open Assistant").build(app)?;
                let open_chat = MenuItemBuilder::with_id("open_chat", "Open Chat").build(app)?;
                let settings = MenuItemBuilder::with_id("settings", "Settings").build(app)?;
                let quit = MenuItemBuilder::with_id("quit", "Quit Clawster").build(app)?;

                let menu = MenuBuilder::new(app)
                    .item(&open_assistant)
                    .item(&open_chat)
                    .separator()
                    .item(&settings)
                    .separator()
                    .item(&quit)
                    .build()?;

                tray.set_menu(Some(menu))?;

                tray.on_menu_event(move |app, event| {
                    match event.id().as_ref() {
                        "open_assistant" => { let _ = windows::create_assistant_window(app); }
                        "open_chat" => { windows::toggle_chatbar(app); }
                        "settings" => {
                            let _ = windows::create_assistant_window(app);
                            let _ = app.emit("switch-to-settings", ());
                        }
                        "quit" => { app.exit(0); }
                        _ => {}
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::update_settings,
            commands::toggle_assistant,
            commands::open_assistant,
            commands::close_assistant,
            commands::toggle_chatbar,
            commands::close_chatbar,
            commands::toggle_screenshot_question,
            commands::close_screenshot_question,
            commands::open_workspace_browser,
            commands::close_workspace_browser,
            commands::show_pet_context_menu,
            commands::hide_pet_context_menu,
            commands::show_pet_chat,
            commands::hide_pet_chat,
            commands::resize_pet_chat,
            commands::drag_pet,
            commands::send_to_clawbot,
            commands::start_clawbot_stream,
            commands::clawbot_status,
            commands::get_chat_history,
            commands::save_chat_history,
            commands::clear_chat_history,
            commands::execute_pet_action,
            commands::move_pet_to,
            commands::move_pet_to_cursor,
            commands::get_pet_position,
            commands::pet_clicked,
            commands::pet_chat_interacted,
            commands::force_pet_sleep,
            // Screen capture
            commands::capture_screen,
            commands::capture_screen_with_context,
            commands::get_screen_context,
            commands::get_screen_capture_permission,
            commands::check_accessibility_permission,
            commands::get_cursor_position,
            commands::ask_about_screen,
            // Workspace
            commands::get_current_workspace_info,
            commands::list_workspace_directory,
            commands::open_workspace_path,
            commands::reveal_workspace_path,
            commands::preview_workspace_file,
            // Onboarding
            commands::onboarding_skip,
            commands::onboarding_complete,
            commands::read_openclaw_config,
            commands::read_openclaw_workspace,
            commands::create_clawster_workspace,
            commands::validate_gateway,
            commands::get_default_personality,
            commands::save_personality,
            commands::get_onboarding_status,
            commands::reset_onboarding,
            // Misc
            commands::open_external,
            commands::open_path,
            commands::copy_to_clipboard,
            commands::set_chatbar_ignore_mouse,
            commands::pet_context_menu_action,
            // Tutorial
            commands::tutorial_pet_clicked,
            commands::tutorial_next,
            commands::tutorial_skip,
            commands::tutorial_resume,
            commands::tutorial_start_over,
            commands::tutorial_open_panel,
            commands::replay_tutorial,
            commands::get_tutorial_status,
            commands::force_active_app_comment,
            commands::set_launch_on_startup,
            commands::start_main_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
