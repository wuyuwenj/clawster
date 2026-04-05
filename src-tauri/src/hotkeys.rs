use std::sync::Arc;
use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use crate::pet::PetState;
use crate::screen;
use crate::store::AppStore;
use crate::tutorial::TutorialManager;
use crate::windows;

/// Convert Electron-style hotkey string to Tauri shortcut string
/// e.g. "CommandOrControl+Shift+Space" -> "CmdOrCtrl+Shift+Space"
fn normalize_hotkey(hotkey: &str) -> String {
    hotkey.replace("CommandOrControl", "CmdOrCtrl")
}

/// Register all global shortcuts from store settings
pub fn register_hotkeys(app: &AppHandle<Wry>) {
    // Unregister all first
    if let Err(e) = app.global_shortcut().unregister_all() {
        eprintln!("[Hotkeys] Failed to unregister shortcuts: {}", e);
    }

    let store = app.state::<AppStore>();

    let hotkey_assistant = store.get_value("hotkeys.openAssistant")
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_else(|| "CommandOrControl+Shift+A".to_string());
    let hotkey_chat = store.get_value("hotkeys.openChat")
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_else(|| "CommandOrControl+Shift+Space".to_string());
    let hotkey_capture = store.get_value("hotkeys.captureScreen")
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_else(|| "CommandOrControl+Shift+/".to_string());

    // Register open assistant
    let normalized = normalize_hotkey(&hotkey_assistant);
    if let Ok(shortcut) = normalized.parse::<Shortcut>() {
        let app_handle = app.clone();
        if let Err(e) = app.global_shortcut().on_shortcut(shortcut, move |_app, _shortcut, _event| {
            // Notify tutorial
            if let Some(tutorial) = _app.try_state::<Arc<TutorialManager>>() {
                tutorial.handle_hotkey_pressed(_app, "openAssistant");
            }
            windows::toggle_assistant(&app_handle);
        }) {
            eprintln!("[Hotkeys] Failed to register assistant shortcut: {}", e);
        } else {
            println!("[Hotkeys] Registered open assistant: {}", hotkey_assistant);
        }
    }

    // Register open chat
    let normalized = normalize_hotkey(&hotkey_chat);
    if let Ok(shortcut) = normalized.parse::<Shortcut>() {
        let app_handle = app.clone();
        if let Err(e) = app.global_shortcut().on_shortcut(shortcut, move |_app, _shortcut, _event| {
            // Notify tutorial
            if let Some(tutorial) = _app.try_state::<Arc<TutorialManager>>() {
                tutorial.handle_hotkey_pressed(_app, "openChat");
            }
            // Reset interaction timer
            if let Some(pet_state) = _app.try_state::<Arc<PetState>>() {
                pet_state.reset_interaction();
            }
            windows::toggle_chatbar(&app_handle);
        }) {
            eprintln!("[Hotkeys] Failed to register chat shortcut: {}", e);
        } else {
            println!("[Hotkeys] Registered open chat: {}", hotkey_chat);
        }
    }

    // Register capture screen
    let normalized = normalize_hotkey(&hotkey_capture);
    if let Ok(shortcut) = normalized.parse::<Shortcut>() {
        let app_handle = app.clone();
        if let Err(e) = app.global_shortcut().on_shortcut(shortcut, move |_app, _shortcut, _event| {
            windows::toggle_screenshot_question(&app_handle);
        }) {
            eprintln!("[Hotkeys] Failed to register capture shortcut: {}", e);
        } else {
            println!("[Hotkeys] Registered capture screen: {}", hotkey_capture);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_hotkey_command_or_control() {
        assert_eq!(
            normalize_hotkey("CommandOrControl+Shift+Space"),
            "CmdOrCtrl+Shift+Space"
        );
    }

    #[test]
    fn test_normalize_hotkey_with_slash() {
        assert_eq!(
            normalize_hotkey("CommandOrControl+Shift+/"),
            "CmdOrCtrl+Shift+/"
        );
    }

    #[test]
    fn test_normalize_hotkey_plain() {
        assert_eq!(normalize_hotkey("Shift+A"), "Shift+A");
    }

    #[test]
    fn test_normalize_hotkey_already_correct() {
        assert_eq!(
            normalize_hotkey("CmdOrCtrl+Shift+A"),
            "CmdOrCtrl+Shift+A"
        );
    }
}
