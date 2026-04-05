use rand::Rng;
use serde::Serialize;
use serde_json::Value;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Wry};
use tokio::time;

use crate::clawbot::ClawBotClient;
use crate::store::AppStore;
use crate::windows;

// --- Constants matching Electron ---

const SLEEP_AFTER_IDLE_MS: u64 = 60_000;
const IDLE_BEHAVIOR_MIN_MS: u64 = 3_000;
const IDLE_BEHAVIOR_MAX_MS: u64 = 8_000;
const INTERACTION_COOLDOWN_MS: u64 = 5_000;
const IDLE_THRESHOLD_MS: u64 = 5 * 60 * 1000; // 5 minutes
const APP_SWITCH_CHAT_COOLDOWN_MS: u64 = 60 * 1000; // 1 minute

#[derive(Debug, Clone, Serialize)]
struct MoodEvent {
    state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct MovingEvent {
    moving: bool,
}

#[derive(Debug, Clone, Serialize)]
struct IdleBehaviorEvent {
    #[serde(rename = "type")]
    behavior_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    direction: Option<String>,
}

// Idle behavior weights
const IDLE_BEHAVIORS: &[(&str, u32)] = &[
    ("blink", 25),
    ("look_around", 20),
    ("snip_claws", 15),
    ("wiggle", 15),
    ("stretch", 10),
    ("yawn", 10),
    ("wander", 5),
];

fn pick_random_idle_behavior() -> &'static str {
    let total: u32 = IDLE_BEHAVIORS.iter().map(|(_, w)| w).sum();
    let mut rng = rand::rng();
    let mut roll = rng.random_range(0..total);
    for (behavior, weight) in IDLE_BEHAVIORS {
        if roll < *weight {
            return behavior;
        }
        roll -= weight;
    }
    "blink"
}

// --- Pet State ---

pub struct PetState {
    pub is_sleeping: AtomicBool,
    pub last_interaction_ms: AtomicU64,
    pub last_activity_ms: AtomicU64,
    pub last_app_switch_chat_ms: AtomicU64,
    performing_idle: AtomicBool,
}

impl PetState {
    pub fn new() -> Self {
        let now = now_ms();
        Self {
            is_sleeping: AtomicBool::new(false),
            last_interaction_ms: AtomicU64::new(now),
            last_activity_ms: AtomicU64::new(now),
            last_app_switch_chat_ms: AtomicU64::new(0),
            performing_idle: AtomicBool::new(false),
        }
    }

    pub fn reset_interaction(&self) {
        self.last_interaction_ms.store(now_ms(), Ordering::Relaxed);
        self.last_activity_ms.store(now_ms(), Ordering::Relaxed);
    }

    pub fn time_since_interaction(&self) -> u64 {
        now_ms() - self.last_interaction_ms.load(Ordering::Relaxed)
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// --- Smooth animation ---

pub async fn animate_move_to(
    app: &AppHandle<Wry>,
    target_x: f64,
    target_y: f64,
    duration_ms: u64,
) {
    let Some(pet) = app.get_webview_window(windows::LABEL_PET) else { return };

    let start_pos = match pet.outer_position() {
        Ok(pos) => pos,
        Err(_) => return,
    };
    let scale = pet.scale_factor().unwrap_or(1.0);
    let start_x = start_pos.x as f64 / scale;
    let start_y = start_pos.y as f64 / scale;

    let _ = app.emit("pet-moving", MovingEvent { moving: true });

    let start_time = std::time::Instant::now();
    let duration = Duration::from_millis(duration_ms);

    loop {
        let elapsed = start_time.elapsed();
        let progress = (elapsed.as_millis() as f64 / duration.as_millis() as f64).min(1.0);

        // Ease-out cubic
        let eased = 1.0 - (1.0 - progress).powi(3);

        let current_x = (start_x + (target_x - start_x) * eased).round();
        let current_y = (start_y + (target_y - start_y) * eased).round();

        let _ = pet.set_position(tauri::LogicalPosition::new(current_x, current_y));
        windows::update_pet_chat_position(app);
        windows::update_assistant_position(app);
        windows::update_workspace_browser_position(app);

        if progress >= 1.0 {
            break;
        }

        tokio::time::sleep(Duration::from_millis(16)).await; // ~60fps
    }

    // Save position
    if let Some(store) = app.try_state::<AppStore>() {
        let _ = store.set_value(
            "pet.position",
            serde_json::json!({"x": target_x, "y": target_y}),
        );
    }

    let _ = app.emit("pet-moving", MovingEvent { moving: false });
}

// --- Pet action execution ---

pub async fn execute_pet_action(app: &AppHandle<Wry>, action: &Value, pet_state: &PetState) {
    if pet_state.is_sleeping.load(Ordering::Relaxed) {
        return;
    }

    // Support both direct action and wrapped {type, payload} format
    // Support both direct action and wrapped {type, payload} format
    let a = action.get("payload").unwrap_or(action);
    let action_type = a.get("type").and_then(|t| t.as_str()).unwrap_or("");

    let (screen_w, screen_h) = if let Some(monitor) = app.primary_monitor().ok().flatten() {
        let size = monitor.size();
        let scale = monitor.scale_factor();
        (size.width as f64 / scale, size.height as f64 / scale)
    } else {
        (1920.0, 1080.0)
    };

    match action_type {
        "set_mood" => {
            if let Some(value) = a.get("value").and_then(|v| v.as_str()) {
                let _ = app.emit("clawbot-mood", MoodEvent {
                    state: value.to_string(),
                    reason: None,
                });
                if value == "sleeping" || value == "doze" {
                    pet_state.is_sleeping.store(true, Ordering::Relaxed);
                }
            }
        }
        "move_to" => {
            let x = a.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let y = a.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let dur = a.get("duration").and_then(|v| v.as_u64()).unwrap_or(1000);
            let tx = x.max(0.0).min(screen_w - 300.0);
            let ty = y.max(0.0).min(screen_h - 300.0);
            animate_move_to(app, tx, ty, dur).await;
        }
        "move_to_cursor" => {
            if let Some(pet) = app.get_webview_window(windows::LABEL_PET) {
                // Use cursor position from monitor
                let cursor = app.cursor_position().unwrap_or(tauri::PhysicalPosition::new(0.0, 0.0));
                let offset = 100.0;
                let tx = (cursor.x + offset).max(0.0).min(screen_w - 300.0);
                let ty = (cursor.y - 150.0).max(0.0).min(screen_h - 300.0);
                let dur = a.get("duration").and_then(|v| v.as_u64()).unwrap_or(1500);
                animate_move_to(app, tx, ty, dur).await;
            }
        }
        "snip" => {
            let _ = app.emit("clawbot-mood", MoodEvent {
                state: "curious".to_string(),
                reason: None,
            });
            tokio::time::sleep(Duration::from_secs(2)).await;
            let _ = app.emit("clawbot-mood", MoodEvent {
                state: "idle".to_string(),
                reason: None,
            });
        }
        "wave" => {
            let _ = app.emit("clawbot-mood", MoodEvent {
                state: "happy".to_string(),
                reason: None,
            });
            tokio::time::sleep(Duration::from_secs(3)).await;
            let _ = app.emit("clawbot-mood", MoodEvent {
                state: "idle".to_string(),
                reason: None,
            });
        }
        "look_at" => {
            let x = a.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let y = a.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let dur = a.get("duration").and_then(|v| v.as_u64()).unwrap_or(1200);
            let tx = (x - 150.0).max(0.0).min(screen_w - 300.0);
            let ty = (y - 150.0).max(0.0).min(screen_h - 300.0);
            let _ = app.emit("clawbot-mood", MoodEvent {
                state: "curious".to_string(),
                reason: None,
            });
            animate_move_to(app, tx, ty, dur).await;
        }
        _ => {}
    }
}

// --- Attention seeker ---

pub fn start_attention_seeker(app: AppHandle<Wry>, pet_state: Arc<PetState>, is_dev: bool) {
    let min_delay = if is_dev { 5_000u64 } else { 30_000 };
    let max_delay = if is_dev { 15_000u64 } else { 120_000 };

    tauri::async_runtime::spawn(async move {
        loop {
            let delay = {
                let mut rng = rand::rng();
                min_delay + rng.random_range(0..=(max_delay - min_delay))
            };
            time::sleep(Duration::from_millis(delay)).await;

            if pet_state.is_sleeping.load(Ordering::Relaxed) {
                continue;
            }

            // Check if attention seeker is enabled
            let enabled = app
                .try_state::<AppStore>()
                .and_then(|s| s.get_value("pet.attentionSeeker"))
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            if !enabled {
                continue;
            }

            let Some(pet) = app.get_webview_window(windows::LABEL_PET) else { continue };
            let pet_pos = match pet.outer_position() {
                Ok(p) => p,
                Err(_) => continue,
            };
            let scale = pet.scale_factor().unwrap_or(1.0);
            let pet_x = pet_pos.x as f64 / scale;
            let pet_y = pet_pos.y as f64 / scale;

            let cursor = app.cursor_position().unwrap_or(tauri::PhysicalPosition::new(0.0, 0.0));

            let distance = ((cursor.x - pet_x).powi(2) + (cursor.y - pet_y).powi(2)).sqrt();

            if distance > 600.0 {
                let (screen_w, screen_h) = if let Some(m) = app.primary_monitor().ok().flatten() {
                    let s = m.size();
                    let sc = m.scale_factor();
                    (s.width as f64 / sc, s.height as f64 / sc)
                } else {
                    (1920.0, 1080.0)
                };

                let offset = 80.0;
                let tx = (cursor.x + offset).max(0.0).min(screen_w - 300.0);
                let ty = (cursor.y + offset).max(0.0).min(screen_h - 300.0);

                let _ = app.emit("clawbot-mood", MoodEvent {
                    state: "excited".to_string(),
                    reason: Some("wants attention".to_string()),
                });
                animate_move_to(&app, tx, ty, 1500).await;
            }
        }
    });
}

// --- Idle behaviors ---

pub fn start_idle_behaviors(app: AppHandle<Wry>, pet_state: Arc<PetState>) {
    tauri::async_runtime::spawn(async move {
        loop {
            let delay = {
                let mut rng = rand::rng();
                IDLE_BEHAVIOR_MIN_MS + rng.random_range(0..=(IDLE_BEHAVIOR_MAX_MS - IDLE_BEHAVIOR_MIN_MS))
            };
            time::sleep(Duration::from_millis(delay)).await;

            if pet_state.is_sleeping.load(Ordering::Relaxed) {
                continue;
            }
            if pet_state.performing_idle.load(Ordering::Relaxed) {
                continue;
            }
            if pet_state.time_since_interaction() < INTERACTION_COOLDOWN_MS {
                continue;
            }

            let behavior = pick_random_idle_behavior();
            pet_state.performing_idle.store(true, Ordering::Relaxed);

            match behavior {
                "wander" => {
                    let Some(pet) = app.get_webview_window(windows::LABEL_PET) else {
                        pet_state.performing_idle.store(false, Ordering::Relaxed);
                        continue;
                    };
                    let pos = pet.outer_position().unwrap_or_default();
                    let scale = pet.scale_factor().unwrap_or(1.0);
                    let cx = pos.x as f64 / scale;
                    let cy = pos.y as f64 / scale;

                    let (screen_w, screen_h) = if let Some(m) = app.primary_monitor().ok().flatten() {
                        let s = m.size();
                        let sc = m.scale_factor();
                        (s.width as f64 / sc, s.height as f64 / sc)
                    } else {
                        (1920.0, 1080.0)
                    };

                    let (rand_x, rand_y) = {
                        let mut rng = rand::rng();
                        (rng.random::<f64>(), rng.random::<f64>())
                    };
                    let wx = (cx + (rand_x - 0.5) * 400.0)
                        .max(0.0)
                        .min(screen_w - 300.0);
                    let wy = (cy + (rand_y - 0.5) * 200.0)
                        .max(0.0)
                        .min(screen_h - 300.0);

                    let direction = if wx > cx { "right" } else { "left" };
                    let _ = app.emit("idle-behavior", IdleBehaviorEvent {
                        behavior_type: "wander".to_string(),
                        direction: Some(direction.to_string()),
                    });
                    animate_move_to(&app, wx, wy, 2000).await;
                }
                other => {
                    let _ = app.emit("idle-behavior", IdleBehaviorEvent {
                        behavior_type: other.to_string(),
                        direction: None,
                    });
                }
            }

            // Reset after 2 seconds
            let ps = pet_state.clone();
            tauri::async_runtime::spawn(async move {
                time::sleep(Duration::from_secs(2)).await;
                ps.performing_idle.store(false, Ordering::Relaxed);
            });
        }
    });
}

// --- Sleep system ---

pub fn start_sleep_check(app: AppHandle<Wry>, pet_state: Arc<PetState>) {
    tauri::async_runtime::spawn(async move {
        let mut interval = time::interval(Duration::from_secs(10));
        loop {
            interval.tick().await;

            let idle_time = pet_state.time_since_interaction();
            let sleeping = pet_state.is_sleeping.load(Ordering::Relaxed);

            if !sleeping && idle_time >= SLEEP_AFTER_IDLE_MS {
                pet_state.is_sleeping.store(true, Ordering::Relaxed);
                let _ = app.emit("clawbot-mood", MoodEvent {
                    state: "doze".to_string(),
                    reason: None,
                });

                // After 5 seconds, go to full sleep
                let app2 = app.clone();
                let ps2 = pet_state.clone();
                tauri::async_runtime::spawn(async move {
                    time::sleep(Duration::from_secs(5)).await;
                    if ps2.is_sleeping.load(Ordering::Relaxed) {
                        let _ = app2.emit("clawbot-mood", MoodEvent {
                            state: "sleeping".to_string(),
                            reason: None,
                        });
                    }
                });
            }
        }
    });
}

/// Wake up the pet with startle animation
pub fn wake_up(app: &AppHandle<Wry>, pet_state: &PetState) {
    if !pet_state.is_sleeping.load(Ordering::Relaxed) {
        return;
    }
    pet_state.is_sleeping.store(false, Ordering::Relaxed);
    let _ = app.emit("clawbot-mood", MoodEvent {
        state: "startle".to_string(),
        reason: None,
    });

    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        time::sleep(Duration::from_secs(1)).await;
        let _ = app2.emit("clawbot-mood", MoodEvent {
            state: "idle".to_string(),
            reason: None,
        });
    });
}

// --- Idle detection and chat popup system ---

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatPopupEvent {
    id: String,
    text: String,
    trigger: String,
    quick_replies: Vec<String>,
}

/// Send a chat popup suggestion to the pet window
async fn send_chat_popup(
    app: &AppHandle<Wry>,
    clawbot: &ClawBotClient,
    trigger: &str,
    context: Option<&str>,
    window_title: Option<&str>,
) {
    if !clawbot.is_connected() {
        return;
    }

    let prompt = match trigger {
        "app_switch" => {
            let ctx = context.unwrap_or("");
            if ctx.is_empty() {
                return;
            }
            let title = window_title.unwrap_or("[unavailable]");
            format!(
                "User is using app name: \"{}\". Window title: \"{}\". Based on what you know about the user, say something funny that's relevant to the app and/or window title.",
                ctx, title
            )
        }
        "idle" => "The user has been idle for a while. Give a brief, friendly message to check in or suggest a break (1-2 sentences max). Be warm and not pushy.".to_string(),
        "proactive" => context.unwrap_or("Share a brief, helpful tip with the user.").to_string(),
        _ => return,
    };

    let response = clawbot.chat(&prompt, &[]).await;
    if let Some(text) = &response.text {
        if !text.contains("error") && !text.is_empty() {
            let _ = app.emit("chat-popup", ChatPopupEvent {
                id: uuid::Uuid::new_v4().to_string(),
                text: text.clone(),
                trigger: trigger.to_string(),
                quick_replies: vec!["Thanks!".to_string(), "Tell me more".to_string(), "Not now".to_string()],
            });
        }
    }
}

/// Start idle detection that triggers chat popup after 5 minutes of inactivity
pub fn start_idle_detection(
    app: AppHandle<Wry>,
    pet_state: Arc<PetState>,
    clawbot: Arc<ClawBotClient>,
) {
    tauri::async_runtime::spawn(async move {
        let mut interval = time::interval(Duration::from_secs(30));
        loop {
            interval.tick().await;

            let idle_time = now_ms() - pet_state.last_activity_ms.load(Ordering::Relaxed);

            if idle_time > IDLE_THRESHOLD_MS && idle_time < IDLE_THRESHOLD_MS + 30_000 {
                // Only send idle message once per idle period (within 30s window)
                pet_state.reset_interaction();
                send_chat_popup(&app, &clawbot, "idle", None, None).await;
            }
        }
    });
}

/// Reset activity timer (call on any user activity)
pub fn reset_activity(pet_state: &PetState) {
    pet_state.last_activity_ms.store(now_ms(), Ordering::Relaxed);
}

// --- Launch on startup ---

pub fn set_launch_on_startup(enabled: bool) {
    #[cfg(target_os = "macos")]
    {
        // Use osascript to add/remove login item
        let script = if enabled {
            r#"tell application "System Events" to make login item at end with properties {path:"/Applications/Clawster.app", hidden:true}"#
        } else {
            r#"tell application "System Events" to delete login item "Clawster""#
        };
        let _ = std::process::Command::new("osascript")
            .args(["-e", script])
            .output();
    }
    #[cfg(target_os = "windows")]
    {
        // Windows: use registry or shell:startup
        let _ = enabled; // TODO: implement for Windows
    }
}
