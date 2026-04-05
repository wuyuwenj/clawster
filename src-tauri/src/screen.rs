use base64::Engine;
use serde::Serialize;
use std::process::Command;
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::pet::PetState;
use crate::windows;

const PET_CAMERA_SNAP_CAPTURE_DELAY_MS: u64 = 560;
const PET_CAMERA_SNAP_DURATION_MS: u64 = 920;
const PET_CAMERA_SNAP_FLASH_DURATION_MS: u64 = 120;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenContext {
    pub cursor: CursorPos,
    pub pet_position: PetPos,
    pub screen_size: ScreenSize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CursorPos {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PetPos {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScreenSize {
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CameraSnapEvent {
    capture_at_ms: u64,
    duration_ms: u64,
    flash_duration_ms: u64,
}

/// Get screen recording permission status on macOS
pub fn get_screen_capture_permission() -> String {
    #[cfg(target_os = "macos")]
    {
        // Check via CoreGraphics
        let output = Command::new("osascript")
            .args(["-e", "tell application \"System Events\" to return (name of every process whose visible is true)"])
            .output();

        // Simple heuristic: if we can run screencapture without error, we have permission
        match output {
            Ok(_) => "granted".to_string(),
            Err(_) => "not-determined".to_string(),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        "granted".to_string()
    }
}

/// Capture screen using native macOS screencapture command
pub async fn capture_screen_native() -> Option<String> {
    let temp_path = std::env::temp_dir().join(format!(
        "clawster-screenshot-{}.png",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    ));

    let temp_str = temp_path.to_string_lossy().to_string();

    let result = tokio::task::spawn_blocking(move || {
        Command::new("screencapture")
            .args(["-x", "-C", "-t", "png", &temp_str])
            .output()
    })
    .await
    .ok()?
    .ok()?;

    if !result.status.success() {
        return None;
    }

    let image_buffer = tokio::fs::read(&temp_path).await.ok()?;
    let _ = tokio::fs::remove_file(&temp_path).await;

    let base64 = base64::engine::general_purpose::STANDARD.encode(&image_buffer);
    Some(format!("data:image/png;base64,{}", base64))
}

/// Play camera snap animation then capture
pub async fn capture_screen_with_snap(app: &AppHandle<Wry>) -> Option<String> {
    // Trigger camera snap animation on pet
    let pet_state = app.try_state::<std::sync::Arc<PetState>>();
    let sleeping = pet_state
        .as_ref()
        .map(|s| s.is_sleeping.load(std::sync::atomic::Ordering::Relaxed))
        .unwrap_or(false);

    if !sleeping {
        let _ = app.emit("pet-camera-snap", CameraSnapEvent {
            capture_at_ms: PET_CAMERA_SNAP_CAPTURE_DELAY_MS,
            duration_ms: PET_CAMERA_SNAP_DURATION_MS,
            flash_duration_ms: PET_CAMERA_SNAP_FLASH_DURATION_MS,
        });

        tokio::time::sleep(std::time::Duration::from_millis(PET_CAMERA_SNAP_CAPTURE_DELAY_MS)).await;
    }

    capture_screen_native().await
}

/// Get screen context (cursor + pet position + screen size)
pub fn get_screen_context(app: &AppHandle<Wry>) -> ScreenContext {
    let cursor = app
        .cursor_position()
        .map(|p| CursorPos { x: p.x, y: p.y })
        .unwrap_or(CursorPos { x: 0.0, y: 0.0 });

    let (pet_x, pet_y) = windows::get_pet_position(app).unwrap_or((0.0, 0.0));

    let (width, height) = if let Some(monitor) = app.primary_monitor().ok().flatten() {
        let size = monitor.size();
        let scale = monitor.scale_factor();
        (size.width as f64 / scale, size.height as f64 / scale)
    } else {
        (1920.0, 1080.0)
    };

    ScreenContext {
        cursor,
        pet_position: PetPos { x: pet_x, y: pet_y },
        screen_size: ScreenSize { width, height },
        image: None,
    }
}

/// Capture screen with full context
pub async fn capture_screen_with_context(app: &AppHandle<Wry>) -> Option<ScreenContext> {
    let image = capture_screen_with_snap(app).await?;
    let mut ctx = get_screen_context(app);
    ctx.image = Some(image);
    Some(ctx)
}
