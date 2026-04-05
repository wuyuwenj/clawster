use serde_json::Value;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::clawbot::ClawBotClient;
use crate::onboarding::{self, OnboardingData};
use crate::pet::{self, PetState};
use crate::screen;
use crate::store::AppStore;
use crate::tutorial::TutorialManager;
use crate::windows;
use crate::workspace;

// --- Store commands ---

#[tauri::command]
pub async fn get_settings(store: State<'_, AppStore>) -> Result<Value, String> {
    serde_json::to_value(store.get_all()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_settings(
    key: String,
    value: Value,
    store: State<'_, AppStore>,
    app: AppHandle,
) -> Result<bool, String> {
    store.set_value(&key, value.clone())?;

    // Trigger side effects based on which key changed
    if key.starts_with("hotkeys.") {
        crate::hotkeys::register_hotkeys(&app);
    } else if key.starts_with("clawbot.") {
        if let Some(clawbot) = app.try_state::<Arc<ClawBotClient>>() {
            let url = store.get_value("clawbot.url")
                .and_then(|v| v.as_str().map(String::from))
                .unwrap_or_default();
            let token = store.get_value("clawbot.token")
                .and_then(|v| v.as_str().map(String::from))
                .unwrap_or_default();
            let wtype = store.get_value("onboarding.workspaceType")
                .and_then(|v| v.as_str().map(String::from));
            let agent_id = if wtype.as_deref() == Some("clawster") { Some("clawster".to_string()) } else { None };
            clawbot.update_config(url, token, agent_id);
        }
    } else if key == "pet.transparentWhenSleeping" {
        let _ = app.emit("pet-transparent-sleep-changed", &value);
    } else if key == "dev.showPetModeOverlay" {
        let _ = app.emit("dev-show-pet-mode-overlay-changed", &value);
    }

    Ok(true)
}

// --- Start main app (called after onboarding) ---

#[tauri::command]
pub async fn start_main_app(
    app: AppHandle,
    clawbot: State<'_, Arc<ClawBotClient>>,
    pet_state: State<'_, Arc<PetState>>,
    store: State<'_, AppStore>,
) -> Result<(), String> {
    // Close onboarding window
    if let Some(win) = app.get_webview_window(windows::LABEL_ONBOARDING) {
        let _ = win.close();
    }

    // Show pet window with saved position
    if let Some(pet) = app.get_webview_window(windows::LABEL_PET) {
        let saved_pos = store.get_value("pet.position");
        if let Some(pos) = saved_pos {
            if let (Some(x), Some(y)) = (
                pos.get("x").and_then(|v| v.as_f64()),
                pos.get("y").and_then(|v| v.as_f64()),
            ) {
                let _ = pet.set_position(tauri::LogicalPosition::new(x, y));
            }
        }
        let _ = pet.show();
    }

    // Start services
    crate::start_main_app_services(
        app.clone(),
        clawbot.inner().clone(),
        pet_state.inner().clone(),
    );

    Ok(())
}

// --- Window commands ---

#[tauri::command]
pub async fn toggle_assistant(app: AppHandle) -> Result<(), String> {
    windows::toggle_assistant(&app);
    Ok(())
}

#[tauri::command]
pub async fn open_assistant(app: AppHandle) -> Result<(), String> {
    windows::create_assistant_window(&app)
}

#[tauri::command]
pub async fn close_assistant(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(windows::LABEL_ASSISTANT) {
        let _ = win.hide();
    }
    Ok(())
}

#[tauri::command]
pub async fn toggle_chatbar(app: AppHandle) -> Result<(), String> {
    windows::toggle_chatbar(&app);
    Ok(())
}

#[tauri::command]
pub async fn close_chatbar(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(windows::LABEL_CHATBAR) {
        let _ = win.hide();
    }
    Ok(())
}

#[tauri::command]
pub async fn toggle_screenshot_question(app: AppHandle) -> Result<(), String> {
    windows::toggle_screenshot_question(&app);
    Ok(())
}

#[tauri::command]
pub async fn close_screenshot_question(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(windows::LABEL_SCREENSHOT_QUESTION) {
        let _ = win.hide();
    }
    Ok(())
}

#[tauri::command]
pub async fn open_workspace_browser(app: AppHandle) -> Result<(), String> {
    windows::create_workspace_browser_window(&app)
}

#[tauri::command]
pub async fn close_workspace_browser(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(windows::LABEL_WORKSPACE_BROWSER) {
        let _ = win.hide();
    }
    Ok(())
}

#[tauri::command]
pub async fn show_pet_context_menu(app: AppHandle, x: f64, y: f64) -> Result<(), String> {
    windows::show_pet_context_menu_at(&app, x, y);
    Ok(())
}

#[tauri::command]
pub async fn hide_pet_context_menu(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(windows::LABEL_PET_CONTEXT_MENU) {
        let _ = win.hide();
    }
    Ok(())
}

#[tauri::command]
pub async fn show_pet_chat(
    app: AppHandle,
    message: Value,
) -> Result<(), String> {
    windows::create_pet_chat_window(&app)?;
    if let Some(win) = app.get_webview_window(windows::LABEL_PET_CHAT) {
        let _ = win.emit("chat-message", &message);
        let _ = win.show();
    }
    Ok(())
}

#[tauri::command]
pub async fn hide_pet_chat(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(windows::LABEL_PET_CHAT) {
        let _ = win.hide();
    }
    Ok(())
}

#[tauri::command]
pub async fn resize_pet_chat(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(windows::LABEL_PET_CHAT) {
        let w = f64::max(windows::PET_CHAT_MIN_WIDTH, f64::min(width.round(), windows::PET_CHAT_MAX_WIDTH));
        let h = f64::max(windows::PET_CHAT_MIN_HEIGHT, f64::min(height.round(), windows::PET_CHAT_MAX_HEIGHT));
        let _ = win.set_size(tauri::LogicalSize::new(w, h));
        windows::update_pet_chat_position(&app);
    }
    Ok(())
}

// --- Pet drag command ---

#[tauri::command]
pub async fn drag_pet(
    app: AppHandle,
    delta_x: f64,
    delta_y: f64,
    store: State<'_, AppStore>,
    pet_state: State<'_, Arc<PetState>>,
) -> Result<(), String> {
    if let Some(pet) = app.get_webview_window(windows::LABEL_PET) {
        let pos = pet.outer_position().map_err(|e| e.to_string())?;
        let scale = pet.scale_factor().unwrap_or(1.0);
        let new_x = (pos.x as f64 / scale + delta_x).round();
        let new_y = (pos.y as f64 / scale + delta_y).round();
        let _ = pet.set_position(tauri::LogicalPosition::new(new_x, new_y));

        // Save position to store
        let _ = store.set_value("pet.position", serde_json::json!({"x": new_x, "y": new_y}));

        // Hide context menu
        if let Some(menu) = app.get_webview_window(windows::LABEL_PET_CONTEXT_MENU) {
            let _ = menu.hide();
        }

        // Reset interaction timer
        pet_state.reset_interaction();

        // Update anchored windows
        windows::update_pet_chat_position(&app);
        windows::update_assistant_position(&app);
        windows::update_workspace_browser_position(&app);
    }
    Ok(())
}

// --- ClawBot commands ---

#[tauri::command]
pub async fn send_to_clawbot(
    message: String,
    include_screen: Option<bool>,
    app: AppHandle,
    clawbot: State<'_, Arc<ClawBotClient>>,
    store: State<'_, AppStore>,
    pet_state: State<'_, Arc<PetState>>,
) -> Result<Value, String> {
    // Get chat history from store
    let history = store.get_value("chatHistory")
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default();

    // Auto-detect screen-related keywords (matching Electron regex)
    let mentions_screen = regex_lite::Regex::new(r"(?i)screen|cursor|mouse|look|where|point|here|there|this")
        .map(|re| re.is_match(&message))
        .unwrap_or(false);

    // Build message with screen context if requested or keywords detected
    let mut full_message = message.clone();
    if include_screen.unwrap_or(false) || mentions_screen {
        if let Some(ctx) = screen::capture_screen_with_context(&app).await {
            full_message = format!(
                "[Screen Context: Cursor at ({}, {}), Screen size: {}x{}, Pet at ({}, {})]\n\n{}",
                ctx.cursor.x, ctx.cursor.y,
                ctx.screen_size.width, ctx.screen_size.height,
                ctx.pet_position.x, ctx.pet_position.y,
                message
            );
        }
    }

    let response = clawbot.chat(&full_message, &history).await;

    // Execute pet actions from response
    if let Some(action) = &response.action {
        pet::execute_pet_action(&app, action, &pet_state).await;
    }

    // Show response as pet bubble when assistant/chatbar not visible
    if let Some(text) = &response.text {
        let assistant_active = app.get_webview_window(windows::LABEL_ASSISTANT)
            .map(|w| w.is_visible().unwrap_or(false)).unwrap_or(false);
        let chatbar_active = app.get_webview_window(windows::LABEL_CHATBAR)
            .map(|w| w.is_visible().unwrap_or(false)).unwrap_or(false);
        if !text.is_empty() && !text.contains("error") && !assistant_active && !chatbar_active {
            let _ = app.emit("chat-popup", serde_json::json!({
                "id": uuid::Uuid::new_v4().to_string(),
                "text": text,
                "trigger": "proactive",
                "quickReplies": ["Thanks!", "Not now"]
            }));
        }
    }

    // Reset interaction timer
    pet_state.reset_interaction();

    serde_json::to_value(response).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn start_clawbot_stream(
    message: String,
    include_screen: Option<bool>,
    app: AppHandle,
    clawbot: State<'_, Arc<ClawBotClient>>,
    store: State<'_, AppStore>,
) -> Result<Value, String> {
    // Get chat history from store
    let history: Vec<Value> = store.get_value("chatHistory")
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default();

    let request_id = uuid::Uuid::new_v4().to_string();
    let clawbot = clawbot.inner().clone();
    let rid = request_id.clone();

    // Build message with screen context if requested
    let full_message = if include_screen.unwrap_or(false) {
        if let Some(ctx) = screen::capture_screen_with_context(&app).await {
            format!(
                "{}\n\n[Screen Context: cursor=({},{}), screenSize={}x{}]",
                message, ctx.cursor.x, ctx.cursor.y,
                ctx.screen_size.width, ctx.screen_size.height
            )
        } else {
            message
        }
    } else {
        message
    };

    tauri::async_runtime::spawn(async move {
        let response = clawbot.chat_stream(&full_message, &history, &app, &rid).await;

        // Execute pet actions from response
        if let Some(action) = &response.action {
            let pet_state = app.state::<Arc<PetState>>();
            pet::execute_pet_action(&app, action, &pet_state).await;
        }
    });

    Ok(serde_json::json!({ "requestId": request_id }))
}

#[tauri::command]
pub async fn clawbot_status(
    clawbot: State<'_, Arc<ClawBotClient>>,
) -> Result<Value, String> {
    serde_json::to_value(clawbot.get_connection_status()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_chat_history(store: State<'_, AppStore>) -> Result<Value, String> {
    store.get_value("chatHistory")
        .ok_or_else(|| "No chat history".to_string())
}

#[tauri::command]
pub async fn save_chat_history(
    messages: Value,
    store: State<'_, AppStore>,
) -> Result<bool, String> {
    // Keep only last 100 messages to prevent storage bloat
    let trimmed = if let Some(arr) = messages.as_array() {
        let start = if arr.len() > 100 { arr.len() - 100 } else { 0 };
        Value::Array(arr[start..].to_vec())
    } else {
        messages
    };
    store.set_value("chatHistory", trimmed)?;
    Ok(true)
}

#[tauri::command]
pub async fn clear_chat_history(store: State<'_, AppStore>) -> Result<bool, String> {
    store.set_value("chatHistory", serde_json::json!([]))?;
    Ok(true)
}

// --- Pet commands ---

#[tauri::command]
pub async fn execute_pet_action(
    action: Value,
    app: AppHandle,
    pet_state: State<'_, Arc<PetState>>,
) -> Result<(), String> {
    pet::execute_pet_action(&app, &action, &pet_state).await;
    Ok(())
}

#[tauri::command]
pub async fn move_pet_to(
    x: f64,
    y: f64,
    duration: Option<u64>,
    app: AppHandle,
) -> Result<(), String> {
    pet::animate_move_to(&app, x, y, duration.unwrap_or(1000)).await;
    Ok(())
}

#[tauri::command]
pub async fn move_pet_to_cursor(app: AppHandle) -> Result<(), String> {
    let action = serde_json::json!({"type": "move_to_cursor"});
    let pet_state = app.state::<Arc<PetState>>();
    pet::execute_pet_action(&app, &action, &pet_state).await;
    Ok(())
}

#[tauri::command]
pub async fn get_pet_position(app: AppHandle) -> Result<(f64, f64), String> {
    windows::get_pet_position(&app).ok_or_else(|| "Pet window not found".to_string())
}

#[tauri::command]
pub async fn pet_clicked(
    app: AppHandle,
    pet_state: State<'_, Arc<PetState>>,
) -> Result<(), String> {
    // Wake up BEFORE reset_interaction (which clears is_sleeping)
    if pet_state.is_sleeping.load(std::sync::atomic::Ordering::Relaxed) {
        pet::wake_up(&app, &pet_state);
    }
    pet_state.reset_interaction();
    Ok(())
}

#[tauri::command]
pub async fn pet_chat_interacted(
    pet_state: State<'_, Arc<PetState>>,
) -> Result<(), String> {
    pet_state.reset_interaction();
    Ok(())
}

#[tauri::command]
pub async fn force_pet_sleep(
    app: AppHandle,
    pet_state: State<'_, Arc<PetState>>,
) -> Result<(), String> {
    pet_state.is_sleeping.store(true, std::sync::atomic::Ordering::Relaxed);
    let _ = app.emit("clawbot-mood", serde_json::json!({"state": "sleeping"}));
    Ok(())
}

// --- Screen capture commands ---

#[tauri::command]
pub async fn capture_screen(app: AppHandle) -> Result<Option<String>, String> {
    Ok(screen::capture_screen_with_snap(&app).await)
}

#[tauri::command]
pub async fn capture_screen_with_context(app: AppHandle) -> Result<Option<Value>, String> {
    match screen::capture_screen_with_context(&app).await {
        Some(ctx) => Ok(Some(serde_json::to_value(ctx).map_err(|e| e.to_string())?)),
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn get_screen_context(app: AppHandle) -> Result<Value, String> {
    let ctx = screen::get_screen_context(&app);
    serde_json::to_value(ctx).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_screen_capture_permission() -> Result<String, String> {
    Ok(screen::get_screen_capture_permission())
}

#[tauri::command]
pub async fn check_accessibility_permission(prompt: Option<bool>) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let _ = prompt;
        // Check accessibility using tccutil-style probe: try to list frontmost app
        let result = tokio::task::spawn_blocking(|| {
            std::process::Command::new("osascript")
                .args([
                    "-l", "JavaScript", "-e",
                    "Application('System Events').applicationProcesses.where({frontmost: true}).length"
                ])
                .output()
                .map(|o| o.status.success() && !String::from_utf8_lossy(&o.stdout).trim().is_empty())
                .unwrap_or(false)
        })
        .await
        .map_err(|e| e.to_string())?;
        Ok(result)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = prompt;
        Ok(true)
    }
}

#[tauri::command]
pub async fn get_cursor_position(app: AppHandle) -> Result<Value, String> {
    let pos = app.cursor_position().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({"x": pos.x, "y": pos.y}))
}

#[tauri::command]
pub async fn ask_about_screen(
    question: String,
    image_data_url: String,
    clawbot: State<'_, Arc<ClawBotClient>>,
) -> Result<Value, String> {
    let response = clawbot.analyze_screen(&image_data_url, &question).await;
    serde_json::to_value(response).map_err(|e| e.to_string())
}

// --- Workspace commands ---

#[tauri::command]
pub async fn get_current_workspace_info(store: State<'_, AppStore>) -> Result<Value, String> {
    let info = workspace::get_current_workspace_info(&store);
    serde_json::to_value(info).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_workspace_directory(
    relative_path: Option<String>,
    store: State<'_, AppStore>,
) -> Result<Value, String> {
    let result = workspace::list_workspace_directory(&store, &relative_path.unwrap_or_default());
    serde_json::to_value(result).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_workspace_path(
    relative_path: Option<String>,
    store: State<'_, AppStore>,
) -> Result<Value, String> {
    let result = workspace::open_workspace_path_in_system(&store, &relative_path.unwrap_or_default());
    serde_json::to_value(result).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn reveal_workspace_path(
    relative_path: Option<String>,
    store: State<'_, AppStore>,
) -> Result<Value, String> {
    let result = workspace::reveal_workspace_path_in_finder(&store, &relative_path.unwrap_or_default());
    serde_json::to_value(result).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn preview_workspace_file(
    relative_path: Option<String>,
    store: State<'_, AppStore>,
) -> Result<Value, String> {
    let result = workspace::preview_workspace_file(&store, &relative_path.unwrap_or_default());
    serde_json::to_value(result).map_err(|e| e.to_string())
}

// --- Onboarding commands ---

#[tauri::command]
pub async fn onboarding_skip(
    app: AppHandle,
    store: State<'_, AppStore>,
    clawbot: State<'_, Arc<ClawBotClient>>,
    pet_state: State<'_, Arc<PetState>>,
) -> Result<bool, String> {
    store.set_value("onboarding.skipped", serde_json::json!(true))?;
    store.set_value("onboarding.completed", serde_json::json!(true))?;

    // Close onboarding and start main app
    if let Some(win) = app.get_webview_window(windows::LABEL_ONBOARDING) {
        let _ = win.close();
    }
    if let Some(pet) = app.get_webview_window(windows::LABEL_PET) {
        let _ = pet.show();
    }
    crate::start_main_app_services(app, clawbot.inner().clone(), pet_state.inner().clone());
    Ok(true)
}

#[tauri::command]
pub async fn onboarding_complete(
    data: OnboardingData,
    app: AppHandle,
    store: State<'_, AppStore>,
    clawbot: State<'_, Arc<ClawBotClient>>,
    pet_state: State<'_, Arc<PetState>>,
) -> Result<bool, String> {
    onboarding::complete_onboarding(&store, &data);

    // Set launch on startup
    pet::set_launch_on_startup(data.launch_on_startup);

    // Update ClawBot client config
    let agent_id = if data.workspace_type == "clawster" { Some("clawster".to_string()) } else { None };
    clawbot.update_config(data.gateway_url.clone(), data.gateway_token.clone(), agent_id);

    // Close onboarding and start main app
    if let Some(win) = app.get_webview_window(windows::LABEL_ONBOARDING) {
        let _ = win.close();
    }
    if let Some(pet) = app.get_webview_window(windows::LABEL_PET) {
        let _ = pet.show();
    }
    crate::start_main_app_services(app, clawbot.inner().clone(), pet_state.inner().clone());
    Ok(true)
}

#[tauri::command]
pub async fn read_openclaw_config() -> Result<Value, String> {
    Ok(onboarding::read_openclaw_config().unwrap_or(Value::Null))
}

#[tauri::command]
pub async fn read_openclaw_workspace() -> Result<Value, String> {
    serde_json::to_value(onboarding::read_openclaw_workspace()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_clawster_workspace(
    options: Value,
    store: State<'_, AppStore>,
) -> Result<Value, String> {
    let identity = options.get("identity").and_then(|v| v.as_str()).unwrap_or("");
    let soul = options.get("soul").and_then(|v| v.as_str()).unwrap_or("");
    let migrate = options.get("migrateMemory").and_then(|v| v.as_bool()).unwrap_or(false);

    match onboarding::create_clawster_workspace(identity, soul, migrate, &store) {
        Ok(path) => Ok(serde_json::json!({"success": true, "path": path})),
        Err(e) => Ok(serde_json::json!({"success": false, "error": e})),
    }
}

#[tauri::command]
pub async fn validate_gateway(url: String, token: String) -> Result<Value, String> {
    match onboarding::validate_gateway(&url, &token).await {
        Ok(()) => Ok(serde_json::json!({"success": true})),
        Err(e) => Ok(serde_json::json!({"success": false, "error": e})),
    }
}

#[tauri::command]
pub async fn get_default_personality(app: AppHandle) -> Result<Value, String> {
    // Try reading from openclaw/ resources (matching Electron behavior)
    let base_path = if cfg!(debug_assertions) {
        // Dev: read from project root openclaw/
        std::env::current_dir()
            .unwrap_or_default()
            .join("openclaw")
    } else {
        // Production: read from app resources
        app.path().resource_dir()
            .unwrap_or_default()
            .join("openclaw")
    };

    let identity = std::fs::read_to_string(base_path.join("IDENTITY.md"))
        .unwrap_or_default();
    let soul = std::fs::read_to_string(base_path.join("SOUL.md"))
        .unwrap_or_default();

    // Fallback to defaults if files not found
    if identity.is_empty() || soul.is_empty() {
        let (def_id, def_soul) = onboarding::get_default_personality();
        Ok(serde_json::json!({
            "identity": if identity.is_empty() { def_id } else { identity },
            "soul": if soul.is_empty() { def_soul } else { soul }
        }))
    } else {
        Ok(serde_json::json!({"identity": identity, "soul": soul}))
    }
}

#[tauri::command]
pub async fn save_personality(
    workspace_path: String,
    identity: String,
    soul: String,
) -> Result<Value, String> {
    match onboarding::save_personality(&workspace_path, &identity, &soul) {
        Ok(()) => Ok(serde_json::json!({"success": true})),
        Err(e) => Ok(serde_json::json!({"success": false, "error": e})),
    }
}

#[tauri::command]
pub async fn get_onboarding_status(store: State<'_, AppStore>) -> Result<Value, String> {
    let completed = store.get_value("onboarding.completed").and_then(|v| v.as_bool()).unwrap_or(false);
    let skipped = store.get_value("onboarding.skipped").and_then(|v| v.as_bool()).unwrap_or(false);
    Ok(serde_json::json!({"completed": completed, "skipped": skipped}))
}

#[tauri::command]
pub async fn reset_onboarding(
    store: State<'_, AppStore>,
    app: AppHandle,
) -> Result<bool, String> {
    store.set_value("onboarding.completed", serde_json::json!(false))?;
    store.set_value("onboarding.skipped", serde_json::json!(false))?;
    store.set_value("onboarding.workspaceType", Value::Null)?;
    store.set_value("onboarding.clawsterWorkspacePath", Value::Null)?;
    store.set_value("onboarding.memoryMigrated", serde_json::json!(false))?;
    // Reset tutorial so it starts fresh after onboarding
    store.set_value("tutorial.completedAt", Value::Null)?;
    store.set_value("tutorial.lastStep", serde_json::json!(0))?;
    store.set_value("tutorial.wasInterrupted", serde_json::json!(false))?;
    // Relaunch app
    let _ = app.restart();
    Ok(true)
}

// --- Misc commands ---

#[tauri::command]
pub async fn open_external(url: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(&url).spawn();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("cmd").args(["/C", "start", &url]).spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open").arg(&url).spawn();
    }
    Ok(())
}

#[tauri::command]
pub async fn open_path(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(&path).spawn();
    }
    Ok(())
}

#[tauri::command]
pub async fn copy_to_clipboard(text: String, app: AppHandle) -> Result<bool, String> {
    // Use pbcopy on macOS
    #[cfg(target_os = "macos")]
    {
        use std::io::Write;
        let mut child = std::process::Command::new("pbcopy")
            .stdin(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?;
        if let Some(stdin) = child.stdin.as_mut() {
            stdin.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
        }
        child.wait().map_err(|e| e.to_string())?;
    }
    Ok(true)
}

#[tauri::command]
pub async fn set_chatbar_ignore_mouse(ignore: bool, app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(windows::LABEL_CHATBAR) {
        let _ = win.set_ignore_cursor_events(ignore);
    }
    Ok(())
}

#[tauri::command]
pub async fn pet_context_menu_action(action: String, app: AppHandle) -> Result<(), String> {
    match action.as_str() {
        "chat" => {
            // Open assistant on chat tab (matching Electron: openAssistantOnTab('chat'))
            windows::create_assistant_window(&app)?;
            let _ = app.emit("switch-to-chat", ());
        }
        "settings" => {
            windows::create_assistant_window(&app)?;
            let _ = app.emit("switch-to-settings", ());
        }
        "workspace" => { windows::create_workspace_browser_window(&app)?; }
        "quit" => { app.exit(0); }
        _ => {}
    }
    // Hide context menu after action
    if let Some(win) = app.get_webview_window(windows::LABEL_PET_CONTEXT_MENU) {
        let _ = win.hide();
    }
    Ok(())
}

// --- Tutorial commands ---

#[tauri::command]
pub async fn tutorial_pet_clicked(
    app: AppHandle,
    tutorial: State<'_, Arc<TutorialManager>>,
) -> Result<(), String> {
    tutorial.handle_pet_clicked(&app);
    Ok(())
}

#[tauri::command]
pub async fn tutorial_next(
    app: AppHandle,
    tutorial: State<'_, Arc<TutorialManager>>,
) -> Result<(), String> {
    tutorial.handle_next(&app);
    Ok(())
}

#[tauri::command]
pub async fn tutorial_skip(
    app: AppHandle,
    tutorial: State<'_, Arc<TutorialManager>>,
) -> Result<(), String> {
    tutorial.skip(&app);
    Ok(())
}

#[tauri::command]
pub async fn tutorial_resume(
    app: AppHandle,
    tutorial: State<'_, Arc<TutorialManager>>,
) -> Result<(), String> {
    tutorial.start(&app, 1);
    Ok(())
}

#[tauri::command]
pub async fn tutorial_start_over(
    app: AppHandle,
    tutorial: State<'_, Arc<TutorialManager>>,
) -> Result<(), String> {
    tutorial.start(&app, 1);
    Ok(())
}

#[tauri::command]
pub async fn tutorial_open_panel(
    app: AppHandle,
    tutorial: State<'_, Arc<TutorialManager>>,
) -> Result<(), String> {
    tutorial.handle_open_panel(&app);
    Ok(())
}

#[tauri::command]
pub async fn replay_tutorial(
    app: AppHandle,
    tutorial: State<'_, Arc<TutorialManager>>,
) -> Result<bool, String> {
    tutorial.replay(&app);
    Ok(true)
}

#[tauri::command]
pub async fn get_tutorial_status(
    app: AppHandle,
    tutorial: State<'_, Arc<TutorialManager>>,
) -> Result<Value, String> {
    Ok(tutorial.get_status(&app))
}

#[tauri::command]
pub async fn force_active_app_comment() -> Result<bool, String> { Ok(true) }

#[tauri::command]
pub async fn set_launch_on_startup(enabled: bool) -> Result<(), String> {
    pet::set_launch_on_startup(enabled);
    Ok(())
}
