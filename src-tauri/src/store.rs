use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClawbotConfig {
    pub url: String,
    pub token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchConfig {
    pub active_app: bool,
    pub send_window_titles: bool,
    pub folders: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetConfig {
    pub position: Option<Position>,
    pub mood: String,
    pub attention_seeker: bool,
    pub transparent_when_sleeping: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenCaptureConfig {
    pub enabled: bool,
    pub auto_analyze: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyConfig {
    pub open_chat: String,
    pub capture_screen: String,
    pub open_assistant: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingState {
    pub completed: bool,
    pub skipped: bool,
    pub workspace_type: Option<String>,
    pub clawster_workspace_path: Option<String>,
    pub memory_migrated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TutorialState {
    pub version: u32,
    pub completed_at: Option<String>,
    pub was_interrupted: bool,
    pub last_step: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevConfig {
    pub window_borders: bool,
    pub show_pet_mode_overlay: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreSchema {
    pub clawbot: ClawbotConfig,
    pub watch: WatchConfig,
    pub pet: PetConfig,
    pub screen_capture: ScreenCaptureConfig,
    pub hotkeys: HotkeyConfig,
    pub chat_history: Value,
    pub onboarding: OnboardingState,
    pub tutorial: TutorialState,
    pub dev: DevConfig,
}

impl Default for StoreSchema {
    fn default() -> Self {
        Self {
            clawbot: ClawbotConfig {
                url: "http://127.0.0.1:18789".to_string(),
                token: String::new(),
            },
            watch: WatchConfig {
                active_app: true,
                send_window_titles: true,
                folders: Vec::new(),
            },
            pet: PetConfig {
                position: None,
                mood: "idle".to_string(),
                attention_seeker: true,
                transparent_when_sleeping: false,
            },
            screen_capture: ScreenCaptureConfig {
                enabled: false,
                auto_analyze: false,
            },
            hotkeys: HotkeyConfig {
                open_chat: "CommandOrControl+Shift+Space".to_string(),
                capture_screen: "CommandOrControl+Shift+/".to_string(),
                open_assistant: "CommandOrControl+Shift+A".to_string(),
            },
            chat_history: Value::Array(Vec::new()),
            onboarding: OnboardingState {
                completed: false,
                skipped: false,
                workspace_type: None,
                clawster_workspace_path: None,
                memory_migrated: false,
            },
            tutorial: TutorialState {
                version: 1,
                completed_at: None,
                was_interrupted: false,
                last_step: 0,
            },
            dev: DevConfig {
                window_borders: false,
                show_pet_mode_overlay: false,
            },
        }
    }
}

/// Application state holding the config store
pub struct AppStore {
    data: Mutex<StoreSchema>,
    path: Mutex<PathBuf>,
}

impl AppStore {
    pub fn new(app_data_dir: PathBuf) -> Self {
        let config_path = app_data_dir.join("clawster-config.json");

        let data = if config_path.exists() {
            match std::fs::read_to_string(&config_path) {
                Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
                Err(_) => StoreSchema::default(),
            }
        } else {
            StoreSchema::default()
        };

        Self {
            data: Mutex::new(data),
            path: Mutex::new(config_path),
        }
    }

    pub fn get_all(&self) -> StoreSchema {
        self.data.lock().unwrap().clone()
    }

    pub fn get_value(&self, key: &str) -> Option<Value> {
        let data = self.data.lock().unwrap();
        let full = serde_json::to_value(&*data).ok()?;
        get_nested_value(&full, key)
    }

    pub fn set_value(&self, key: &str, value: Value) -> Result<(), String> {
        let mut data = self.data.lock().unwrap();
        let mut full = serde_json::to_value(&*data).map_err(|e| e.to_string())?;
        set_nested_value(&mut full, key, value)?;
        *data = serde_json::from_value(full).map_err(|e| format!("Invalid store data: {}", e))?;
        self.save_to_disk(&data)?;
        Ok(())
    }

    fn save_to_disk(&self, data: &StoreSchema) -> Result<(), String> {
        let path = self.path.lock().unwrap();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
        std::fs::write(&*path, json).map_err(|e| e.to_string())?;
        Ok(())
    }
}

fn get_nested_value(value: &Value, key: &str) -> Option<Value> {
    let parts: Vec<&str> = key.split('.').collect();
    let mut current = value;
    for part in parts {
        current = current.get(part)?;
    }
    Some(current.clone())
}

fn set_nested_value(value: &mut Value, key: &str, new_value: Value) -> Result<(), String> {
    let parts: Vec<&str> = key.split('.').collect();
    let mut current = value;
    for (i, part) in parts.iter().enumerate() {
        if i == parts.len() - 1 {
            if let Some(obj) = current.as_object_mut() {
                obj.insert(part.to_string(), new_value);
                return Ok(());
            }
            return Err(format!("Cannot set key '{}': parent is not an object", key));
        }
        current = current
            .get_mut(*part)
            .ok_or_else(|| format!("Key '{}' not found at '{}'", key, part))?;
    }
    Err(format!("Empty key"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_nested_value_top_level() {
        let data = serde_json::json!({"name": "test", "count": 42});
        assert_eq!(get_nested_value(&data, "name").unwrap(), "test");
        assert_eq!(get_nested_value(&data, "count").unwrap(), 42);
    }

    #[test]
    fn test_get_nested_value_dotted() {
        let data = serde_json::json!({"pet": {"mood": "idle", "position": {"x": 10}}});
        assert_eq!(get_nested_value(&data, "pet.mood").unwrap(), "idle");
        assert_eq!(get_nested_value(&data, "pet.position.x").unwrap(), 10);
    }

    #[test]
    fn test_get_nested_value_missing() {
        let data = serde_json::json!({"a": 1});
        assert!(get_nested_value(&data, "b").is_none());
        assert!(get_nested_value(&data, "a.b").is_none());
    }

    #[test]
    fn test_set_nested_value_top_level() {
        let mut data = serde_json::json!({"name": "old"});
        set_nested_value(&mut data, "name", serde_json::json!("new")).unwrap();
        assert_eq!(data.get("name").unwrap(), "new");
    }

    #[test]
    fn test_set_nested_value_dotted() {
        let mut data = serde_json::json!({"pet": {"mood": "idle"}});
        set_nested_value(&mut data, "pet.mood", serde_json::json!("happy")).unwrap();
        assert_eq!(data["pet"]["mood"], "happy");
    }

    #[test]
    fn test_set_nested_value_error_on_missing_parent() {
        let mut data = serde_json::json!({"a": 1});
        let result = set_nested_value(&mut data, "b.c", serde_json::json!(1));
        assert!(result.is_err());
    }

    #[test]
    fn test_store_schema_defaults() {
        let schema = StoreSchema::default();
        assert_eq!(schema.clawbot.url, "http://127.0.0.1:18789");
        assert_eq!(schema.clawbot.token, "");
        assert!(schema.watch.active_app);
        assert!(schema.watch.send_window_titles);
        assert!(schema.watch.folders.is_empty());
        assert_eq!(schema.pet.mood, "idle");
        assert!(schema.pet.attention_seeker);
        assert!(!schema.pet.transparent_when_sleeping);
        assert!(schema.pet.position.is_none());
        assert_eq!(schema.hotkeys.open_chat, "CommandOrControl+Shift+Space");
        assert_eq!(schema.hotkeys.capture_screen, "CommandOrControl+Shift+/");
        assert_eq!(schema.hotkeys.open_assistant, "CommandOrControl+Shift+A");
        assert!(!schema.onboarding.completed);
        assert!(!schema.onboarding.skipped);
        assert!(schema.onboarding.workspace_type.is_none());
        assert_eq!(schema.tutorial.version, 1);
        assert!(schema.tutorial.completed_at.is_none());
        assert!(!schema.dev.window_borders);
    }

    #[test]
    fn test_store_schema_camel_case_serialization() {
        let schema = StoreSchema::default();
        let json = serde_json::to_value(&schema).unwrap();
        // Verify camelCase field names
        assert!(json.get("clawbot").is_some());
        assert!(json.get("chatHistory").is_some());
        assert!(json.get("screenCapture").is_some());
        assert!(json["watch"].get("activeApp").is_some());
        assert!(json["watch"].get("sendWindowTitles").is_some());
        assert!(json["pet"].get("attentionSeeker").is_some());
        assert!(json["pet"].get("transparentWhenSleeping").is_some());
        assert!(json["hotkeys"].get("openChat").is_some());
        assert!(json["onboarding"].get("workspaceType").is_some());
        assert!(json["tutorial"].get("completedAt").is_some());
        assert!(json["tutorial"].get("wasInterrupted").is_some());
        assert!(json["dev"].get("windowBorders").is_some());
        assert!(json["dev"].get("showPetModeOverlay").is_some());
    }
}
