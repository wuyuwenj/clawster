use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Wry};
use tokio::time;

use crate::clawbot::{ActivityEvent, ClawBotClient};

// --- JXA script for frontmost window title (matches window-title.ts) ---

const JXA_FRONTMOST_WINDOW_SCRIPT: &str = r#"
(() => {
  const out = { appName: "", windowTitle: "" };
  try {
    const systemEvents = Application("System Events");
    let proc = null;

    try {
      const frontWhere = systemEvents.applicationProcesses.where({ frontmost: true })();
      if (frontWhere && frontWhere.length > 0) {
        proc = frontWhere[0];
      }
    } catch {}

    if (!proc) {
      try {
        const frontWhose = systemEvents.applicationProcesses.whose({ frontmost: true })();
        if (frontWhose && frontWhose.length > 0) {
          proc = frontWhose[0];
        }
      } catch {}
    }

    if (!proc) {
      return JSON.stringify(out);
    }

    out.appName = String(proc.name() || "");

    try {
      const windows = proc.windows();
      if (windows && windows.length > 0) {
        out.windowTitle = String(windows[0].name() || "");
      }
    } catch {}
  } catch {}

  return JSON.stringify(out);
})();
"#;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FrontmostWindowPayload {
    app_name: Option<String>,
    window_title: Option<String>,
}

/// Get the frontmost window title via JXA on macOS
fn get_frontmost_window_info() -> Option<(String, Option<String>)> {
    if cfg!(not(target_os = "macos")) {
        return None;
    }

    let output = Command::new("osascript")
        .args(["-l", "JavaScript", "-e", JXA_FRONTMOST_WINDOW_SCRIPT])
        .output()
        .ok()?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let trimmed = stdout.trim();

    // Try to parse JSON from the output
    let parsed: FrontmostWindowPayload = serde_json::from_str(trimmed).ok()?;

    let app_name = parsed.app_name.filter(|s| !s.is_empty())?;
    let title = parsed.window_title.filter(|s| !s.is_empty());

    Some((app_name, title))
}

/// Start the active app watcher that polls every 2 seconds
pub fn start_app_watcher(
    clawbot: Arc<ClawBotClient>,
    app_handle: AppHandle<Wry>,
    watch_active_app: bool,
    send_window_titles: bool,
) {
    if !watch_active_app {
        return;
    }

    tauri::async_runtime::spawn(async move {
        let mut interval = time::interval(Duration::from_secs(2));
        let mut last_active_app: Option<String> = None;

        loop {
            interval.tick().await;

            let info = tokio::task::spawn_blocking(get_frontmost_window_info)
                .await
                .ok()
                .flatten();

            if let Some((app_name, title)) = info {
                let changed = last_active_app.as_ref() != Some(&app_name);
                if changed {
                    let event = ActivityEvent {
                        event_type: "app_focus_changed".to_string(),
                        app: Some(app_name.clone()),
                        title: if send_window_titles { title } else { None },
                        path: None,
                        filename: None,
                        at: std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis() as u64,
                    };

                    let _ = app_handle.emit("activity-event", &event);
                    clawbot.send_event(&event).await;

                    last_active_app = Some(app_name);
                }
            }
        }
    });
}

/// Start the file watcher using the notify crate
pub fn start_file_watcher(
    folders: Vec<String>,
    clawbot: Arc<ClawBotClient>,
    app_handle: AppHandle<Wry>,
) {
    if folders.is_empty() {
        return;
    }

    let (tx, rx) = std::sync::mpsc::channel();

    let mut watcher = match RecommendedWatcher::new(tx, Config::default()) {
        Ok(w) => w,
        Err(e) => {
            eprintln!("[Watchers] Failed to create file watcher: {}", e);
            return;
        }
    };

    for folder in &folders {
        let path = Path::new(folder);
        if path.exists() {
            if let Err(e) = watcher.watch(path, RecursiveMode::Recursive) {
                eprintln!("[Watchers] Failed to watch {}: {}", folder, e);
            }
        }
    }

    // Process events in a background thread, forward via tokio channel
    let (async_tx, mut async_rx) = tokio::sync::mpsc::unbounded_channel::<notify::Event>();

    // Blocking thread to drain the std mpsc receiver
    std::thread::spawn(move || {
        let _watcher = watcher; // Keep alive
        loop {
            match rx.recv() {
                Ok(Ok(event)) => {
                    if async_tx.send(event).is_err() {
                        break;
                    }
                }
                Ok(Err(_)) => continue,
                Err(_) => break,
            }
        }
    });

    // Async task to process file events
    tauri::async_runtime::spawn(async move {
        while let Some(event) = async_rx.recv().await {
            let event_type = match event.kind {
                EventKind::Create(_) => "file_added",
                EventKind::Modify(_) => "file_changed",
                EventKind::Remove(_) => "file_deleted",
                _ => continue,
            };

            for path in event.paths {
                let filename = path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string());

                // Skip dotfiles
                if filename.as_ref().map_or(false, |f| f.starts_with('.')) {
                    continue;
                }

                let activity = ActivityEvent {
                    event_type: event_type.to_string(),
                    app: None,
                    title: None,
                    path: Some(path.to_string_lossy().to_string()),
                    filename,
                    at: std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as u64,
                };

                let _ = app_handle.emit("activity-event", &activity);
                clawbot.send_event(&activity).await;
            }
        }
    });
}
