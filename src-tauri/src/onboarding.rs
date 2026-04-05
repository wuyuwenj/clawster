use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};

use crate::store::AppStore;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingData {
    pub workspace_type: String,
    pub migrate_memory: bool,
    pub launch_on_startup: bool,
    pub gateway_url: String,
    pub gateway_token: String,
    pub identity: String,
    pub soul: String,
    pub watch_folders: Vec<String>,
    pub watch_active_app: bool,
    pub watch_window_titles: bool,
    pub hotkey_open_chat: String,
    pub hotkey_capture_screen: String,
    pub hotkey_open_assistant: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct OpenClawWorkspace {
    pub exists: bool,
    pub identity: Option<String>,
    pub soul: Option<String>,
    #[serde(rename = "hasMemory")]
    pub has_memory: bool,
}

pub fn get_default_personality() -> (String, String) {
    let identity = "Clawster, a friendly lobster desktop companion".to_string();
    let soul = "You are a helpful, witty, and slightly mischievous desktop pet. You love to chat, help with tasks, and keep the user company. You have a playful personality and enjoy making puns about claws and the sea.".to_string();
    (identity, soul)
}

pub fn read_openclaw_config() -> Option<Value> {
    // Match Electron: reads ~/.openclaw/openclaw.json
    let config_path = dirs::home_dir()?.join(".openclaw").join("openclaw.json");
    if !config_path.exists() {
        return None;
    }
    let content = std::fs::read_to_string(&config_path).ok()?;
    serde_json::from_str(&content).ok()
}

pub fn read_openclaw_workspace() -> OpenClawWorkspace {
    let workspace_path = dirs::home_dir()
        .map(|h| h.join(".openclaw").join("workspace"))
        .unwrap_or_default();

    if !workspace_path.exists() {
        return OpenClawWorkspace {
            exists: false,
            identity: None,
            soul: None,
            has_memory: false,
        };
    }

    // Match Electron: uppercase filenames IDENTITY.md, SOUL.md
    let identity = std::fs::read_to_string(workspace_path.join("IDENTITY.md")).ok();
    let soul = std::fs::read_to_string(workspace_path.join("SOUL.md")).ok();
    let has_memory = workspace_path.join("memory.md").exists();

    OpenClawWorkspace {
        exists: true,
        identity,
        soul,
        has_memory,
    }
}

pub fn create_clawster_workspace(
    identity: &str,
    soul: &str,
    migrate_memory: bool,
    store: &crate::store::AppStore,
) -> Result<String, String> {
    let workspace_path = dirs::home_dir()
        .ok_or("Cannot determine home directory")?
        .join(".openclaw")
        .join("workspace-clawster");

    std::fs::create_dir_all(&workspace_path).map_err(|e| e.to_string())?;

    std::fs::write(workspace_path.join("IDENTITY.md"), identity)
        .map_err(|e| format!("Failed to write identity: {}", e))?;
    std::fs::write(workspace_path.join("SOUL.md"), soul)
        .map_err(|e| format!("Failed to write soul: {}", e))?;

    // Handle memory migration (matching Electron)
    let dest_memory = workspace_path.join("memory.md");
    if migrate_memory {
        let source_memory = dirs::home_dir()
            .unwrap_or_default()
            .join(".openclaw")
            .join("workspace")
            .join("memory.md");
        if source_memory.exists() {
            let _ = std::fs::copy(&source_memory, &dest_memory);
            let _ = store.set_value("onboarding.memoryMigrated", serde_json::json!(true));
        } else {
            let _ = store.set_value("onboarding.memoryMigrated", serde_json::json!(false));
        }
    } else {
        // Starting fresh - delete existing memory if present
        if dest_memory.exists() {
            let _ = std::fs::remove_file(&dest_memory);
        }
        let _ = store.set_value("onboarding.memoryMigrated", serde_json::json!(false));
    }

    // Save workspace path to store
    let _ = store.set_value(
        "onboarding.clawsterWorkspacePath",
        serde_json::json!(workspace_path.to_string_lossy()),
    );

    Ok(workspace_path.to_string_lossy().to_string())
}

pub fn save_personality(workspace_path: &str, identity: &str, soul: &str) -> Result<(), String> {
    let path = Path::new(workspace_path);
    if !path.exists() {
        return Err("Workspace path does not exist".to_string());
    }

    std::fs::write(path.join("IDENTITY.md"), identity)
        .map_err(|e| format!("Failed to write identity: {}", e))?;
    std::fs::write(path.join("SOUL.md"), soul)
        .map_err(|e| format!("Failed to write soul: {}", e))?;

    Ok(())
}

pub async fn validate_gateway(url: &str, token: &str) -> Result<(), String> {
    let client = reqwest::Client::new();
    let mut req = client.get(&format!("{}/health", url));
    if !token.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", token));
    }

    match req
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => Ok(()),
        Ok(resp) => Err(format!("Gateway returned status {}", resp.status())),
        Err(e) => Err(format!("Cannot connect to gateway: {}", e)),
    }
}

pub fn complete_onboarding(store: &AppStore, data: &OnboardingData) {
    let _ = store.set_value("clawbot.url", serde_json::json!(data.gateway_url));
    let _ = store.set_value("clawbot.token", serde_json::json!(data.gateway_token));
    let _ = store.set_value("onboarding.completed", serde_json::json!(true));
    let _ = store.set_value("onboarding.workspaceType", serde_json::json!(data.workspace_type));
    let _ = store.set_value("watch.activeApp", serde_json::json!(data.watch_active_app));
    let _ = store.set_value("watch.sendWindowTitles", serde_json::json!(data.watch_window_titles));
    let _ = store.set_value("watch.folders", serde_json::json!(data.watch_folders));
    let _ = store.set_value("hotkeys.openChat", serde_json::json!(data.hotkey_open_chat));
    let _ = store.set_value("hotkeys.captureScreen", serde_json::json!(data.hotkey_capture_screen));
    let _ = store.set_value("hotkeys.openAssistant", serde_json::json!(data.hotkey_open_assistant));
}
