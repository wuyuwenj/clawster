use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::pet;
use crate::store::AppStore;
use crate::windows;

// Tutorial step config matching Electron
struct StepConfig {
    step: u8,
    copy: StepCopy,
    fallback_delay_ms: u64,
    auto_advance: bool,
    auto_advance_delay_ms: u64,
    delay_before_ms: u64,
}

enum StepCopy {
    Static(&'static str),
    Dynamic(fn(&str, &str) -> String),
}

fn format_hotkey(hotkey: &str) -> String {
    hotkey
        .replace("CommandOrControl", if cfg!(target_os = "macos") { "Cmd" } else { "Ctrl" })
        .replace("Command", "Cmd")
        .replace("Control", "Ctrl")
}

fn step7_copy(open_chat: &str, _open_assistant: &str) -> String {
    format!("Press {} to chat with me anytime.", format_hotkey(open_chat))
}

fn step9_copy(_open_chat: &str, open_assistant: &str) -> String {
    format!("Press {} to open the panel.", format_hotkey(open_assistant))
}

const TUTORIAL_STEPS: &[StepConfig] = &[
    StepConfig { step: 1, copy: StepCopy::Static("Hi there! I'm Clawster, your desktop companion!"), fallback_delay_ms: 0, auto_advance: true, auto_advance_delay_ms: 2500, delay_before_ms: 0 },
    StepConfig { step: 2, copy: StepCopy::Static("Try clicking on me to see how I react!"), fallback_delay_ms: 3000, auto_advance: false, auto_advance_delay_ms: 0, delay_before_ms: 500 },
    StepConfig { step: 3, copy: StepCopy::Static("Fun right? I have lots of different reactions!"), fallback_delay_ms: 0, auto_advance: true, auto_advance_delay_ms: 2500, delay_before_ms: 500 },
    StepConfig { step: 4, copy: StepCopy::Static("Now move your mouse away from me..."), fallback_delay_ms: 6000, auto_advance: false, auto_advance_delay_ms: 0, delay_before_ms: 500 },
    StepConfig { step: 5, copy: StepCopy::Static("I followed you! Don't worry - I only do this when I feel lonely. You can disable this in Settings."), fallback_delay_ms: 0, auto_advance: false, auto_advance_delay_ms: 0, delay_before_ms: 500 },
    StepConfig { step: 6, copy: StepCopy::Static("Want to chat? I'm always here to help!"), fallback_delay_ms: 0, auto_advance: true, auto_advance_delay_ms: 2000, delay_before_ms: 500 },
    StepConfig { step: 7, copy: StepCopy::Dynamic(step7_copy), fallback_delay_ms: 6000, auto_advance: false, auto_advance_delay_ms: 0, delay_before_ms: 500 },
    StepConfig { step: 8, copy: StepCopy::Static("You can also access Settings and chat history."), fallback_delay_ms: 0, auto_advance: true, auto_advance_delay_ms: 3500, delay_before_ms: 500 },
    StepConfig { step: 9, copy: StepCopy::Dynamic(step9_copy), fallback_delay_ms: 5000, auto_advance: false, auto_advance_delay_ms: 0, delay_before_ms: 500 },
    StepConfig { step: 10, copy: StepCopy::Static("That's it! I'll be right here if you need me."), fallback_delay_ms: 0, auto_advance: true, auto_advance_delay_ms: 3000, delay_before_ms: 500 },
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TutorialStepEvent {
    step: u8,
    copy: String,
    total_steps: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TutorialHintEvent {
    step: u8,
    hint_type: String,
}

#[derive(Debug, Clone, Serialize)]
struct TutorialEndedEvent {
    skipped: bool,
}

pub struct TutorialManager {
    is_active: Arc<AtomicBool>,
    current_step: Arc<AtomicU8>,
}

impl TutorialManager {
    pub fn new() -> Self {
        Self {
            is_active: Arc::new(AtomicBool::new(false)),
            current_step: Arc::new(AtomicU8::new(0)),
        }
    }

    pub fn is_active(&self) -> bool {
        self.is_active.load(Ordering::Relaxed)
    }

    pub fn current_step(&self) -> u8 {
        self.current_step.load(Ordering::Relaxed)
    }

    pub fn should_start_tutorial(app: &AppHandle<Wry>) -> bool {
        let store = app.state::<AppStore>();
        let completed_at = store.get_value("tutorial.completedAt");
        completed_at.map_or(true, |v| v.is_null())
    }

    pub fn should_show_resume_prompt(app: &AppHandle<Wry>) -> bool {
        let store = app.state::<AppStore>();
        let interrupted = store.get_value("tutorial.wasInterrupted")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let completed = store.get_value("tutorial.completedAt")
            .map_or(false, |v| !v.is_null());
        interrupted && !completed
    }

    pub fn start(&self, app: &AppHandle<Wry>, from_step: u8) {
        self.is_active.store(true, Ordering::Relaxed);
        let store = app.state::<AppStore>();
        let _ = store.set_value("tutorial.wasInterrupted", serde_json::json!(true));
        let _ = store.set_value("tutorial.lastStep", serde_json::json!(from_step));

        // Expand pet window for tutorial
        expand_pet_window(app);

        self.go_to_step(app, from_step);
    }

    pub fn skip(&self, app: &AppHandle<Wry>) {
        self.is_active.store(false, Ordering::Relaxed);
        self.current_step.store(0, Ordering::Relaxed);

        let store = app.state::<AppStore>();
        let _ = store.set_value("tutorial.completedAt", serde_json::json!(chrono::Utc::now().to_rfc3339()));
        let _ = store.set_value("tutorial.wasInterrupted", serde_json::json!(false));

        contract_pet_window(app);
        let _ = app.emit("tutorial-ended", TutorialEndedEvent { skipped: true });
    }

    pub fn handle_pet_clicked(&self, app: &AppHandle<Wry>) {
        if !self.is_active() || self.current_step() != 2 {
            return;
        }
        self.advance_step(app);
    }

    pub fn handle_next(&self, app: &AppHandle<Wry>) {
        if !self.is_active() || self.current_step() == 0 {
            return;
        }
        self.advance_step(app);
    }

    pub fn handle_hotkey_pressed(&self, app: &AppHandle<Wry>, hotkey: &str) {
        if !self.is_active() {
            return;
        }
        if self.current_step() == 7 && hotkey == "openChat" {
            self.advance_step(app);
        } else if self.current_step() == 9 && hotkey == "openAssistant" {
            self.advance_step(app);
        }
    }

    pub fn handle_open_panel(&self, app: &AppHandle<Wry>) {
        if !self.is_active() || self.current_step() != 9 {
            return;
        }
        self.advance_step(app);
    }

    pub fn replay(&self, app: &AppHandle<Wry>) {
        let store = app.state::<AppStore>();
        let _ = store.set_value("tutorial.completedAt", serde_json::json!(null));
        let _ = store.set_value("tutorial.lastStep", serde_json::json!(0));
        let _ = store.set_value("tutorial.wasInterrupted", serde_json::json!(false));
        self.start(app, 1);
    }

    pub fn get_status(&self, app: &AppHandle<Wry>) -> serde_json::Value {
        let store = app.state::<AppStore>();
        let completed = store.get_value("tutorial.completedAt")
            .map_or(false, |v| !v.is_null());
        let current = if self.is_active() { Some(self.current_step()) } else { None };
        serde_json::json!({
            "isActive": self.is_active(),
            "currentStep": current,
            "completed": completed
        })
    }

    fn go_to_step(&self, app: &AppHandle<Wry>, step: u8) {
        let config = match TUTORIAL_STEPS.get((step - 1) as usize) {
            Some(c) => c,
            None => return,
        };

        let delay_before = config.delay_before_ms;
        let app2 = app.clone();
        let step_val = step;

        // Get hotkeys for dynamic copy
        let store = app.state::<AppStore>();
        let open_chat = store.get_value("hotkeys.openChat")
            .and_then(|v| v.as_str().map(String::from))
            .unwrap_or_else(|| "CommandOrControl+Shift+Space".to_string());
        let open_assistant = store.get_value("hotkeys.openAssistant")
            .and_then(|v| v.as_str().map(String::from))
            .unwrap_or_else(|| "CommandOrControl+Shift+A".to_string());

        let copy_text = match &config.copy {
            StepCopy::Static(s) => s.to_string(),
            StepCopy::Dynamic(f) => f(&open_chat, &open_assistant),
        };

        let auto_advance = config.auto_advance;
        let auto_delay = config.auto_advance_delay_ms;
        let fallback_delay = config.fallback_delay_ms;

        let is_active = self.is_active.clone();
        let current_step = self.current_step.clone();

        tauri::async_runtime::spawn(async move {
            if delay_before > 0 {
                tokio::time::sleep(Duration::from_millis(delay_before)).await;
            }

            if !is_active.load(Ordering::Relaxed) {
                return;
            }

            current_step.store(step_val, Ordering::Relaxed);
            let _ = app2.state::<AppStore>().set_value("tutorial.lastStep", serde_json::json!(step_val));

            let _ = app2.emit("tutorial-step", TutorialStepEvent {
                step: step_val,
                copy: copy_text,
                total_steps: TUTORIAL_STEPS.len(),
            });

            // Auto-advance timer
            if auto_advance && auto_delay > 0 {
                let app3 = app2.clone();
                let is_active2 = is_active.clone();
                let cs2 = current_step.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(Duration::from_millis(auto_delay)).await;
                    if is_active2.load(Ordering::Relaxed) && cs2.load(Ordering::Relaxed) == step_val {
                        advance_step_async(&app3, &is_active2, &cs2).await;
                    }
                });
            }

            // Fallback hint timer
            if fallback_delay > 0 {
                let app4 = app2.clone();
                let is_active3 = is_active.clone();
                let cs3 = current_step.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(Duration::from_millis(fallback_delay)).await;
                    if is_active3.load(Ordering::Relaxed) && cs3.load(Ordering::Relaxed) == step_val {
                        let hint_type = match step_val {
                            2 => "pulse",
                            4 => "arrow",
                            7 => "skip-button",
                            9 => "open-panel-button",
                            _ => return,
                        };
                        let _ = app4.emit("tutorial-hint", TutorialHintEvent {
                            step: step_val,
                            hint_type: hint_type.to_string(),
                        });
                    }
                });
            }
        });
    }

    fn advance_step(&self, app: &AppHandle<Wry>) {
        let next = self.current_step() + 1;
        if next > 10 {
            self.complete(app);
        } else {
            self.go_to_step(app, next);
        }
    }

    fn complete(&self, app: &AppHandle<Wry>) {
        self.is_active.store(false, Ordering::Relaxed);
        self.current_step.store(0, Ordering::Relaxed);

        let store = app.state::<AppStore>();
        let _ = store.set_value("tutorial.completedAt", serde_json::json!(chrono::Utc::now().to_rfc3339()));
        let _ = store.set_value("tutorial.wasInterrupted", serde_json::json!(false));

        contract_pet_window(app);
        let _ = app.emit("tutorial-ended", TutorialEndedEvent { skipped: false });
    }
}

async fn advance_step_async(
    app: &AppHandle<Wry>,
    is_active: &AtomicBool,
    current_step: &AtomicU8,
) {
    let next = current_step.load(Ordering::Relaxed) + 1;
    if next > 10 {
        // Complete
        is_active.store(false, Ordering::Relaxed);
        current_step.store(0, Ordering::Relaxed);
        let store = app.state::<AppStore>();
        let _ = store.set_value("tutorial.completedAt", serde_json::json!(chrono::Utc::now().to_rfc3339()));
        let _ = store.set_value("tutorial.wasInterrupted", serde_json::json!(false));
        contract_pet_window(app);
        let _ = app.emit("tutorial-ended", TutorialEndedEvent { skipped: false });
    } else {
        // Go to next step (simplified inline version)
        let config = match TUTORIAL_STEPS.get((next - 1) as usize) {
            Some(c) => c,
            None => return,
        };

        if config.delay_before_ms > 0 {
            tokio::time::sleep(Duration::from_millis(config.delay_before_ms)).await;
        }

        current_step.store(next, Ordering::Relaxed);

        let store = app.state::<AppStore>();
        let open_chat = store.get_value("hotkeys.openChat")
            .and_then(|v| v.as_str().map(String::from))
            .unwrap_or_else(|| "CommandOrControl+Shift+Space".to_string());
        let open_assistant = store.get_value("hotkeys.openAssistant")
            .and_then(|v| v.as_str().map(String::from))
            .unwrap_or_else(|| "CommandOrControl+Shift+A".to_string());

        let copy_text = match &config.copy {
            StepCopy::Static(s) => s.to_string(),
            StepCopy::Dynamic(f) => f(&open_chat, &open_assistant),
        };

        let _ = app.emit("tutorial-step", TutorialStepEvent {
            step: next,
            copy: copy_text,
            total_steps: TUTORIAL_STEPS.len(),
        });
    }
}

// Window expand/contract for tutorial UI

fn expand_pet_window(app: &AppHandle<Wry>) {
    let Some(pet) = app.get_webview_window(windows::LABEL_PET) else { return };
    let pos = pet.outer_position().unwrap_or_default();
    let size = pet.outer_size().unwrap_or_default();
    let scale = pet.scale_factor().unwrap_or(1.0);

    let current_w = size.width as f64 / scale;
    let current_h = size.height as f64 / scale;
    let current_x = pos.x as f64 / scale;
    let current_y = pos.y as f64 / scale;

    let new_y = current_y - (windows::PET_WINDOW_TUTORIAL_HEIGHT - current_h);
    let new_x = current_x - (windows::PET_WINDOW_TUTORIAL_WIDTH - current_w) / 2.0;

    let _ = pet.set_size(tauri::LogicalSize::new(
        windows::PET_WINDOW_TUTORIAL_WIDTH,
        windows::PET_WINDOW_TUTORIAL_HEIGHT,
    ));
    let _ = pet.set_position(tauri::LogicalPosition::new(
        f64::max(0.0, new_x.round()),
        f64::max(0.0, new_y.round()),
    ));
    let _ = app.emit("tutorial-window-expanded", true);
}

fn contract_pet_window(app: &AppHandle<Wry>) {
    let Some(pet) = app.get_webview_window(windows::LABEL_PET) else { return };
    let pos = pet.outer_position().unwrap_or_default();
    let scale = pet.scale_factor().unwrap_or(1.0);

    let current_x = pos.x as f64 / scale;
    let current_y = pos.y as f64 / scale;

    let new_y = current_y + (windows::PET_WINDOW_TUTORIAL_HEIGHT - windows::PET_WINDOW_HEIGHT);
    let new_x = current_x + (windows::PET_WINDOW_TUTORIAL_WIDTH - windows::PET_WINDOW_WIDTH) / 2.0;

    let _ = pet.set_size(tauri::LogicalSize::new(
        windows::PET_WINDOW_WIDTH,
        windows::PET_WINDOW_HEIGHT,
    ));
    let _ = pet.set_position(tauri::LogicalPosition::new(new_x.round(), new_y.round()));
    let _ = app.emit("tutorial-window-expanded", false);
}
