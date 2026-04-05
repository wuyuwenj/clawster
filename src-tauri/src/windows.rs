use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, Wry};

// Window size constants matching Electron
pub const PET_WINDOW_WIDTH: f64 = 164.0;
pub const PET_WINDOW_HEIGHT: f64 = 164.0;
pub const PET_WINDOW_TUTORIAL_WIDTH: f64 = 320.0;
pub const PET_WINDOW_TUTORIAL_HEIGHT: f64 = 350.0;
pub const PET_CHAT_MIN_WIDTH: f64 = 220.0;
pub const PET_CHAT_MAX_WIDTH: f64 = 360.0;
pub const PET_CHAT_MIN_HEIGHT: f64 = 90.0;
pub const PET_CHAT_MAX_HEIGHT: f64 = 420.0;
pub const PET_CHAT_VERTICAL_GAP: f64 = -2.0;
pub const ASSISTANT_VERTICAL_GAP: f64 = -3.0;
pub const WORKSPACE_BROWSER_VERTICAL_GAP: f64 = -6.0;
pub const PET_CONTEXT_MENU_WIDTH: f64 = 220.0;
pub const PET_CONTEXT_MENU_HEIGHT: f64 = 342.0;
pub const WORKSPACE_BROWSER_WIDTH: f64 = 420.0;
pub const WORKSPACE_BROWSER_HEIGHT: f64 = 520.0;
pub const ASSISTANT_WIDTH: f64 = 400.0;
pub const ASSISTANT_HEIGHT: f64 = 500.0;
pub const CHATBAR_WIDTH: f64 = 650.0;
pub const CHATBAR_HEIGHT: f64 = 300.0;
pub const SCREENSHOT_QUESTION_WIDTH: f64 = 520.0;
pub const SCREENSHOT_QUESTION_HEIGHT: f64 = 280.0;
pub const ONBOARDING_WIDTH: f64 = 600.0;
pub const ONBOARDING_HEIGHT: f64 = 700.0;

pub const LABEL_PET: &str = "pet";
pub const LABEL_PET_CHAT: &str = "pet-chat";
pub const LABEL_ASSISTANT: &str = "assistant";
pub const LABEL_CHATBAR: &str = "chatbar";
pub const LABEL_SCREENSHOT_QUESTION: &str = "screenshot-question";
pub const LABEL_ONBOARDING: &str = "onboarding";
pub const LABEL_PET_CONTEXT_MENU: &str = "pet-context-menu";
pub const LABEL_WORKSPACE_BROWSER: &str = "workspace-browser";

/// Get the primary monitor's work area size
fn get_screen_size(app: &AppHandle<Wry>) -> (f64, f64) {
    if let Some(monitor) = app.primary_monitor().ok().flatten() {
        let size = monitor.size();
        let scale = monitor.scale_factor();
        (
            size.width as f64 / scale,
            size.height as f64 / scale,
        )
    } else {
        (1920.0, 1080.0) // fallback
    }
}

/// Get pet window position, returns (x, y)
pub fn get_pet_position(app: &AppHandle<Wry>) -> Option<(f64, f64)> {
    let pet = app.get_webview_window(LABEL_PET)?;
    let pos = pet.outer_position().ok()?;
    let scale = pet.scale_factor().unwrap_or(1.0);
    Some((pos.x as f64 / scale, pos.y as f64 / scale))
}

/// Get pet window size, returns (width, height)
pub fn get_pet_size(app: &AppHandle<Wry>) -> Option<(f64, f64)> {
    let pet = app.get_webview_window(LABEL_PET)?;
    let size = pet.outer_size().ok()?;
    let scale = pet.scale_factor().unwrap_or(1.0);
    Some((size.width as f64 / scale, size.height as f64 / scale))
}

/// Create the pet-chat popup window above the pet
pub fn create_pet_chat_window(app: &AppHandle<Wry>) -> Result<(), String> {
    if app.get_webview_window(LABEL_PET_CHAT).is_some() {
        return Ok(());
    }

    let (pet_x, pet_y) = get_pet_position(app).unwrap_or((0.0, 0.0));
    let (pet_w, _) = get_pet_size(app).unwrap_or((PET_WINDOW_WIDTH, PET_WINDOW_HEIGHT));

    let chat_x = pet_x + (pet_w - PET_CHAT_MIN_WIDTH) / 2.0;
    let chat_y = pet_y - PET_CHAT_MIN_HEIGHT + PET_CHAT_VERTICAL_GAP;

    let window = WebviewWindowBuilder::new(
        app,
        LABEL_PET_CHAT,
        WebviewUrl::App("/pet-chat.html".into()),
    )
    .title("Pet Chat")
    .inner_size(PET_CHAT_MIN_WIDTH, PET_CHAT_MIN_HEIGHT)
    .position(f64::max(0.0, chat_x), f64::max(0.0, chat_y))
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .resizable(false)
    .skip_taskbar(true)
    .shadow(false)
    .visible(false)
    .build()
    .map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    set_transparent_background(&window);

    let _ = window.set_visible_on_all_workspaces(true);

    Ok(())
}

/// Create the assistant panel window
pub fn create_assistant_window(app: &AppHandle<Wry>) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(LABEL_ASSISTANT) {
        let _ = win.show();
        let _ = win.set_focus();
        update_assistant_position(app);
        return Ok(());
    }

    let (screen_w, screen_h) = get_screen_size(app);
    let (mut x, mut y) = (screen_w - ASSISTANT_WIDTH - 20.0, screen_h - ASSISTANT_HEIGHT - 20.0);

    if let (Some((pet_x, pet_y)), Some((pet_w, _))) = (get_pet_position(app), get_pet_size(app)) {
        x = pet_x + (pet_w - ASSISTANT_WIDTH) / 2.0;
        y = pet_y - ASSISTANT_HEIGHT + ASSISTANT_VERTICAL_GAP;
        x = f64::max(0.0, f64::min(x, screen_w - ASSISTANT_WIDTH));
        y = f64::max(0.0, y);
    }

    let _window = WebviewWindowBuilder::new(
        app,
        LABEL_ASSISTANT,
        WebviewUrl::App("/assistant.html".into()),
    )
    .title("Clawster Assistant")
    .inner_size(ASSISTANT_WIDTH, ASSISTANT_HEIGHT)
    .position(x.round(), y.round())
    .decorations(false)
    .always_on_top(true)
    .resizable(true)
    .visible(false)
    .build()
    .map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    let _ = _window.set_visible_on_all_workspaces(true);

    Ok(())
}

/// Create the chatbar (spotlight-style) window
pub fn create_chatbar_window(app: &AppHandle<Wry>) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(LABEL_CHATBAR) {
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }

    let (screen_w, screen_h) = get_screen_size(app);
    let x = (screen_w - CHATBAR_WIDTH) / 2.0;
    let y = screen_h / 3.0;

    let window = WebviewWindowBuilder::new(
        app,
        LABEL_CHATBAR,
        WebviewUrl::App("/chatbar.html".into()),
    )
    .title("Clawster Chat")
    .inner_size(CHATBAR_WIDTH, CHATBAR_HEIGHT)
    .position(x.round(), y.round())
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .resizable(false)
    .skip_taskbar(true)
    .shadow(false)
    .visible(false)
    .build()
    .map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    {
        set_transparent_background(&window);
        let _ = window.set_visible_on_all_workspaces(true);
    }

    // Make transparent areas click-through
    let _ = window.set_ignore_cursor_events(true);

    Ok(())
}

/// Create the screenshot question window near cursor
pub fn create_screenshot_question_window(app: &AppHandle<Wry>) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(LABEL_SCREENSHOT_QUESTION) {
        let _ = win.show();
        let _ = win.set_focus();
        let _ = win.emit("retake-screenshot", ());
        return Ok(());
    }

    let (screen_w, screen_h) = get_screen_size(app);
    // Default to center-ish position (cursor position handled by frontend)
    let x = (screen_w - SCREENSHOT_QUESTION_WIDTH) / 2.0;
    let y = (screen_h - SCREENSHOT_QUESTION_HEIGHT) / 2.0;

    let window = WebviewWindowBuilder::new(
        app,
        LABEL_SCREENSHOT_QUESTION,
        WebviewUrl::App("/screenshot-question.html".into()),
    )
    .title("Screenshot Question")
    .inner_size(SCREENSHOT_QUESTION_WIDTH, SCREENSHOT_QUESTION_HEIGHT)
    .position(x.round(), y.round())
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .resizable(false)
    .skip_taskbar(true)
    .shadow(false)
    .visible(false)
    .build()
    .map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    {
        set_transparent_background(&window);
        let _ = window.set_visible_on_all_workspaces(true);
    }

    Ok(())
}

/// Create the onboarding window (centered on screen)
pub fn create_onboarding_window(app: &AppHandle<Wry>) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(LABEL_ONBOARDING) {
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }

    let (screen_w, screen_h) = get_screen_size(app);
    let x = (screen_w - ONBOARDING_WIDTH) / 2.0;
    let y = (screen_h - ONBOARDING_HEIGHT) / 2.0;

    let _window = WebviewWindowBuilder::new(
        app,
        LABEL_ONBOARDING,
        WebviewUrl::App("/onboarding.html".into()),
    )
    .title("Clawster Setup")
    .inner_size(ONBOARDING_WIDTH, ONBOARDING_HEIGHT)
    .position(x.round(), y.round())
    .decorations(false)
    .resizable(true)
    .min_inner_size(500.0, 550.0)
    .visible(false)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Create the pet context menu window
pub fn create_pet_context_menu_window(app: &AppHandle<Wry>) -> Result<(), String> {
    if app.get_webview_window(LABEL_PET_CONTEXT_MENU).is_some() {
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(
        app,
        LABEL_PET_CONTEXT_MENU,
        WebviewUrl::App("/pet-context-menu.html".into()),
    )
    .title("Context Menu")
    .inner_size(PET_CONTEXT_MENU_WIDTH, PET_CONTEXT_MENU_HEIGHT)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .resizable(false)
    .skip_taskbar(true)
    .shadow(false)
    .visible(false)
    .build()
    .map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    {
        set_transparent_background(&window);
        let _ = window.set_visible_on_all_workspaces(true);
    }

    Ok(())
}

/// Create the workspace browser window
pub fn create_workspace_browser_window(app: &AppHandle<Wry>) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(LABEL_WORKSPACE_BROWSER) {
        let _ = win.show();
        let _ = win.set_focus();
        update_workspace_browser_position(app);
        return Ok(());
    }

    let (screen_w, screen_h) = get_screen_size(app);
    let (mut x, mut y) = (
        screen_w - WORKSPACE_BROWSER_WIDTH - 24.0,
        screen_h - WORKSPACE_BROWSER_HEIGHT - 24.0,
    );

    if let (Some((pet_x, pet_y)), Some((pet_w, _))) = (get_pet_position(app), get_pet_size(app)) {
        x = pet_x + (pet_w - WORKSPACE_BROWSER_WIDTH) / 2.0;
        y = pet_y - WORKSPACE_BROWSER_HEIGHT + WORKSPACE_BROWSER_VERTICAL_GAP;
        x = f64::max(0.0, f64::min(x, screen_w - WORKSPACE_BROWSER_WIDTH));
        y = f64::max(0.0, y);
    }

    let _window = WebviewWindowBuilder::new(
        app,
        LABEL_WORKSPACE_BROWSER,
        WebviewUrl::App("/workspace-browser.html".into()),
    )
    .title("Workspace Browser")
    .inner_size(WORKSPACE_BROWSER_WIDTH, WORKSPACE_BROWSER_HEIGHT)
    .position(x.round(), y.round())
    .decorations(false)
    .always_on_top(true)
    .resizable(true)
    .visible(false)
    .build()
    .map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    let _ = _window.set_visible_on_all_workspaces(true);

    Ok(())
}

// --- Position update helpers ---

/// Update pet-chat window position to stay above pet
pub fn update_pet_chat_position(app: &AppHandle<Wry>) {
    let Some(chat) = app.get_webview_window(LABEL_PET_CHAT) else { return };
    let Some((pet_x, pet_y)) = get_pet_position(app) else { return };
    let Some((pet_w, _)) = get_pet_size(app) else { return };

    let chat_size = chat.outer_size().ok();
    let scale = chat.scale_factor().unwrap_or(1.0);
    let (cw, ch) = chat_size
        .map(|s| (s.width as f64 / scale, s.height as f64 / scale))
        .unwrap_or((PET_CHAT_MIN_WIDTH, PET_CHAT_MIN_HEIGHT));

    let x = pet_x + (pet_w - cw) / 2.0;
    let y = pet_y - ch + PET_CHAT_VERTICAL_GAP;

    let _ = chat.set_position(tauri::LogicalPosition::new(
        f64::max(0.0, x.round()),
        f64::max(0.0, y.round()),
    ));
}

/// Update assistant window position to stay above pet
pub fn update_assistant_position(app: &AppHandle<Wry>) {
    let Some(assistant) = app.get_webview_window(LABEL_ASSISTANT) else { return };
    if !assistant.is_visible().unwrap_or(false) {
        return;
    }

    let Some((pet_x, pet_y)) = get_pet_position(app) else { return };
    let Some((pet_w, _)) = get_pet_size(app) else { return };
    let (screen_w, _) = get_screen_size(app);

    let scale = assistant.scale_factor().unwrap_or(1.0);
    let a_size = assistant.outer_size().ok();
    let (aw, ah) = a_size
        .map(|s| (s.width as f64 / scale, s.height as f64 / scale))
        .unwrap_or((ASSISTANT_WIDTH, ASSISTANT_HEIGHT));

    let mut x = pet_x + (pet_w - aw) / 2.0;
    let y = pet_y - ah + ASSISTANT_VERTICAL_GAP;
    x = f64::max(0.0, f64::min(x, screen_w - aw));

    let _ = assistant.set_position(tauri::LogicalPosition::new(x.round(), f64::max(0.0, y.round())));
}

/// Update workspace browser position to stay above pet
pub fn update_workspace_browser_position(app: &AppHandle<Wry>) {
    let Some(browser) = app.get_webview_window(LABEL_WORKSPACE_BROWSER) else { return };
    if !browser.is_visible().unwrap_or(false) {
        return;
    }

    let Some((pet_x, pet_y)) = get_pet_position(app) else { return };
    let Some((pet_w, _)) = get_pet_size(app) else { return };
    let (screen_w, _) = get_screen_size(app);

    let scale = browser.scale_factor().unwrap_or(1.0);
    let b_size = browser.outer_size().ok();
    let (bw, bh) = b_size
        .map(|s| (s.width as f64 / scale, s.height as f64 / scale))
        .unwrap_or((WORKSPACE_BROWSER_WIDTH, WORKSPACE_BROWSER_HEIGHT));

    let mut x = pet_x + (pet_w - bw) / 2.0;
    let y = pet_y - bh + WORKSPACE_BROWSER_VERTICAL_GAP;
    x = f64::max(0.0, f64::min(x, screen_w - bw));

    let _ = browser.set_position(tauri::LogicalPosition::new(x.round(), f64::max(0.0, y.round())));
}

/// Show the pet context menu at a specific position
pub fn show_pet_context_menu_at(app: &AppHandle, cursor_x: f64, cursor_y: f64) {
    if create_pet_context_menu_window(app).is_err() {
        return;
    }

    let Some(menu_win) = app.get_webview_window(LABEL_PET_CONTEXT_MENU) else { return };

    let (screen_w, screen_h) = get_screen_size(app);
    let x = f64::max(0.0, f64::min(cursor_x.round(), screen_w - PET_CONTEXT_MENU_WIDTH));
    let y = f64::max(0.0, f64::min(cursor_y.round(), screen_h - PET_CONTEXT_MENU_HEIGHT));

    let _ = menu_win.set_position(tauri::LogicalPosition::new(x, y));
    let _ = menu_win.show();
    let _ = menu_win.set_focus();
}

/// Toggle assistant window visibility
pub fn toggle_assistant(app: &AppHandle<Wry>) {
    if let Some(win) = app.get_webview_window(LABEL_ASSISTANT) {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
            return;
        }
    }
    let _ = create_assistant_window(app);
}

/// Toggle chatbar window visibility
pub fn toggle_chatbar(app: &AppHandle<Wry>) {
    if let Some(win) = app.get_webview_window(LABEL_CHATBAR) {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
            return;
        }
    }
    let _ = create_chatbar_window(app);
}

/// Toggle screenshot question window visibility
pub fn toggle_screenshot_question(app: &AppHandle<Wry>) {
    if let Some(win) = app.get_webview_window(LABEL_SCREENSHOT_QUESTION) {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
            return;
        }
    }
    let _ = create_screenshot_question_window(app);
}

// --- macOS transparent background helper ---

#[cfg(target_os = "macos")]
fn set_transparent_background(window: &tauri::WebviewWindow) {
    use cocoa::appkit::{NSColor, NSWindow};
    use cocoa::base::nil;

    if let Ok(ns_window) = window.ns_window() {
        let ns_window = ns_window as cocoa::base::id;
        unsafe {
            let clear = NSColor::clearColor(nil);
            #[allow(deprecated)]
            {
                ns_window.setBackgroundColor_(clear);
                ns_window.setHasShadow_(false);
            }
        }
    }
}
