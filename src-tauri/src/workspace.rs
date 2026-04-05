use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};

use crate::store::AppStore;

/// Check if a path is safely within the workspace root, resolving symlinks
fn is_within_workspace(absolute: &Path, workspace_root: &str) -> bool {
    // First check the raw path
    if !absolute.starts_with(workspace_root) {
        return false;
    }
    // If the path exists, canonicalize to resolve symlinks
    if absolute.exists() {
        if let (Ok(canon_abs), Ok(canon_root)) = (
            absolute.canonicalize(),
            Path::new(workspace_root).canonicalize(),
        ) {
            return canon_abs.starts_with(&canon_root);
        }
    }
    true // Path doesn't exist yet, raw check passed
}

const MAX_MARKDOWN_PREVIEW_BYTES: u64 = 2 * 1024 * 1024;
const MAX_IMAGE_PREVIEW_BYTES: u64 = 12 * 1024 * 1024;
const MAX_JSON_PREVIEW_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentWorkspaceInfo {
    pub workspace_type: Option<String>,
    pub workspace_path: Option<String>,
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEntry {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub created_at: f64,
    pub modified_at: f64,
    pub accessed_at: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDirectoryResult {
    pub success: bool,
    pub current_path: String,
    pub entries: Vec<WorkspaceEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceOpenResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePreviewResult {
    pub success: bool,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

fn get_default_openclaw_workspace() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/"))
        .join(".openclaw")
        .join("workspace")
}

pub fn get_current_workspace_info(store: &AppStore) -> CurrentWorkspaceInfo {
    let workspace_type = store
        .get_value("onboarding.workspaceType")
        .and_then(|v| v.as_str().map(String::from));

    let (wtype, wpath) = resolve_workspace_root(store, workspace_type.as_deref());
    let exists = Path::new(&wpath).exists();

    CurrentWorkspaceInfo {
        workspace_type: Some(wtype),
        workspace_path: Some(wpath),
        exists,
    }
}

fn resolve_workspace_root(store: &AppStore, workspace_type: Option<&str>) -> (String, String) {
    let openclaw_workspace = get_default_openclaw_workspace();

    if workspace_type == Some("clawster") {
        let clawster_workspace = store
            .get_value("onboarding.clawsterWorkspacePath")
            .and_then(|v| v.as_str().map(String::from))
            .unwrap_or_else(|| {
                dirs::home_dir()
                    .unwrap_or_default()
                    .join(".openclaw")
                    .join("workspace-clawster")
                    .to_string_lossy()
                    .to_string()
            });

        if Path::new(&clawster_workspace).exists() || !openclaw_workspace.exists() {
            return ("clawster".to_string(), clawster_workspace);
        }
    }

    (
        "openclaw".to_string(),
        openclaw_workspace.to_string_lossy().to_string(),
    )
}

pub fn list_workspace_directory(
    store: &AppStore,
    relative_path: &str,
) -> WorkspaceDirectoryResult {
    let info = get_current_workspace_info(store);
    let workspace_path = match &info.workspace_path {
        Some(p) if info.exists => p.clone(),
        _ => {
            return WorkspaceDirectoryResult {
                success: false,
                current_path: String::new(),
                entries: vec![],
                error: Some("missing_workspace".to_string()),
            }
        }
    };

    let normalized = if relative_path.is_empty() || relative_path == "." {
        String::new()
    } else {
        relative_path.to_string()
    };

    let absolute = if normalized.is_empty() {
        PathBuf::from(&workspace_path)
    } else {
        PathBuf::from(&workspace_path).join(&normalized)
    };

    // Prevent path traversal (including symlinks)
    if !is_within_workspace(&absolute, &workspace_path) {
        return WorkspaceDirectoryResult {
            success: false,
            current_path: normalized,
            entries: vec![],
            error: Some("outside_workspace".to_string()),
        };
    }

    if !absolute.exists() {
        return WorkspaceDirectoryResult {
            success: false,
            current_path: normalized,
            entries: vec![],
            error: Some("path_not_found".to_string()),
        };
    }

    if !absolute.is_dir() {
        return WorkspaceDirectoryResult {
            success: false,
            current_path: normalized,
            entries: vec![],
            error: Some("not_directory".to_string()),
        };
    }

    let mut entries = Vec::new();
    if let Ok(read_dir) = std::fs::read_dir(&absolute) {
        for entry in read_dir.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let metadata = entry.metadata().ok();
            let kind = if entry.file_type().ok().map_or(false, |t| t.is_dir()) {
                "directory"
            } else {
                "file"
            };

            let rel = if normalized.is_empty() {
                name.clone()
            } else {
                format!("{}/{}", normalized, name)
            };

            let (created, modified, accessed) = metadata
                .map(|m| {
                    (
                        m.created().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as f64).unwrap_or(0.0),
                        m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as f64).unwrap_or(0.0),
                        m.accessed().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as f64).unwrap_or(0.0),
                    )
                })
                .unwrap_or((0.0, 0.0, 0.0));

            entries.push(WorkspaceEntry {
                name,
                path: rel,
                kind: kind.to_string(),
                created_at: created,
                modified_at: modified,
                accessed_at: accessed,
            });
        }
    }

    WorkspaceDirectoryResult {
        success: true,
        current_path: normalized,
        entries,
        error: None,
    }
}

fn get_preview_kind(filename: &str) -> Option<&str> {
    let ext = Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase());

    match ext.as_deref() {
        Some("md" | "mdx") => Some("markdown"),
        Some("json" | "jsonc" | "geojson") => Some("json"),
        Some("png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "tiff") => Some("image"),
        _ => None,
    }
}

fn get_image_mime(filename: &str) -> &str {
    let ext = Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase());

    match ext.as_deref() {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("bmp") => "image/bmp",
        Some("tiff") => "image/tiff",
        _ => "application/octet-stream",
    }
}

pub fn preview_workspace_file(
    store: &AppStore,
    relative_path: &str,
) -> WorkspacePreviewResult {
    let info = get_current_workspace_info(store);
    let workspace_path = match &info.workspace_path {
        Some(p) if info.exists => p.clone(),
        _ => {
            return WorkspacePreviewResult {
                success: false,
                path: relative_path.to_string(),
                preview_kind: None,
                content: None,
                error: Some("missing_workspace".to_string()),
                message: None,
            }
        }
    };

    let absolute = PathBuf::from(&workspace_path).join(relative_path);
    if !is_within_workspace(&absolute, &workspace_path) {
        return WorkspacePreviewResult {
            success: false,
            path: relative_path.to_string(),
            preview_kind: None,
            content: None,
            error: Some("outside_workspace".to_string()),
            message: None,
        };
    }

    if !absolute.exists() {
        return WorkspacePreviewResult {
            success: false,
            path: relative_path.to_string(),
            preview_kind: None,
            content: None,
            error: Some("path_not_found".to_string()),
            message: None,
        };
    }

    if !absolute.is_file() {
        return WorkspacePreviewResult {
            success: false,
            path: relative_path.to_string(),
            preview_kind: None,
            content: None,
            error: Some("not_file".to_string()),
            message: None,
        };
    }

    let filename = absolute.to_string_lossy().to_string();
    let preview_kind = match get_preview_kind(&filename) {
        Some(k) => k,
        None => {
            return WorkspacePreviewResult {
                success: false,
                path: relative_path.to_string(),
                preview_kind: None,
                content: None,
                error: Some("unsupported_preview".to_string()),
                message: None,
            }
        }
    };

    let meta = std::fs::metadata(&absolute).ok();
    let file_size = meta.map(|m| m.len()).unwrap_or(0);

    let max_bytes = match preview_kind {
        "markdown" => MAX_MARKDOWN_PREVIEW_BYTES,
        "json" => MAX_JSON_PREVIEW_BYTES,
        _ => MAX_IMAGE_PREVIEW_BYTES,
    };

    if file_size > max_bytes {
        return WorkspacePreviewResult {
            success: false,
            path: relative_path.to_string(),
            preview_kind: Some(preview_kind.to_string()),
            content: None,
            error: Some("file_too_large".to_string()),
            message: Some("File is too large to preview.".to_string()),
        };
    }

    match preview_kind {
        "markdown" | "json" => {
            let content = match std::fs::read_to_string(&absolute) {
                Ok(c) => c,
                Err(_) => {
                    return WorkspacePreviewResult {
                        success: false,
                        path: relative_path.to_string(),
                        preview_kind: Some(preview_kind.to_string()),
                        content: None,
                        error: Some("read_failed".to_string()),
                        message: None,
                    }
                }
            };

            let display_content = if preview_kind == "json" {
                serde_json::from_str::<Value>(&content)
                    .ok()
                    .and_then(|v| serde_json::to_string_pretty(&v).ok())
                    .unwrap_or(content)
            } else {
                content
            };

            WorkspacePreviewResult {
                success: true,
                path: relative_path.to_string(),
                preview_kind: Some(preview_kind.to_string()),
                content: Some(display_content),
                error: None,
                message: None,
            }
        }
        _ => {
            // Image preview
            let buffer = match std::fs::read(&absolute) {
                Ok(b) => b,
                Err(_) => {
                    return WorkspacePreviewResult {
                        success: false,
                        path: relative_path.to_string(),
                        preview_kind: Some(preview_kind.to_string()),
                        content: None,
                        error: Some("read_failed".to_string()),
                        message: None,
                    }
                }
            };

            let mime = get_image_mime(&filename);
            let b64 = base64::engine::general_purpose::STANDARD.encode(&buffer);

            WorkspacePreviewResult {
                success: true,
                path: relative_path.to_string(),
                preview_kind: Some(preview_kind.to_string()),
                content: Some(format!("data:{};base64,{}", mime, b64)),
                error: None,
                message: None,
            }
        }
    }
}

pub fn open_workspace_path_in_system(
    store: &AppStore,
    relative_path: &str,
) -> WorkspaceOpenResult {
    let info = get_current_workspace_info(store);
    let workspace_path = match &info.workspace_path {
        Some(p) if info.exists => p.clone(),
        _ => {
            return WorkspaceOpenResult {
                success: false,
                error: Some("missing_workspace".to_string()),
                message: None,
            }
        }
    };

    let absolute = if relative_path.is_empty() {
        PathBuf::from(&workspace_path)
    } else {
        PathBuf::from(&workspace_path).join(relative_path)
    };

    if !is_within_workspace(&absolute, &workspace_path) {
        return WorkspaceOpenResult {
            success: false,
            error: Some("outside_workspace".to_string()),
            message: None,
        };
    }

    if !absolute.exists() {
        return WorkspaceOpenResult {
            success: false,
            error: Some("path_not_found".to_string()),
            message: None,
        };
    }

    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg(absolute.to_string_lossy().as_ref())
            .spawn();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer")
            .arg(absolute.to_string_lossy().as_ref())
            .spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open")
            .arg(absolute.to_string_lossy().as_ref())
            .spawn();
    }

    WorkspaceOpenResult {
        success: true,
        error: None,
        message: None,
    }
}

pub fn reveal_workspace_path_in_finder(
    store: &AppStore,
    relative_path: &str,
) -> WorkspaceOpenResult {
    let info = get_current_workspace_info(store);
    let workspace_path = match &info.workspace_path {
        Some(p) if info.exists => p.clone(),
        _ => {
            return WorkspaceOpenResult {
                success: false,
                error: Some("missing_workspace".to_string()),
                message: None,
            }
        }
    };

    let absolute = if relative_path.is_empty() {
        PathBuf::from(&workspace_path)
    } else {
        PathBuf::from(&workspace_path).join(relative_path)
    };

    if !absolute.starts_with(&workspace_path) || !absolute.exists() {
        return WorkspaceOpenResult {
            success: false,
            error: Some("path_not_found".to_string()),
            message: None,
        };
    }

    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .args(["-R", &absolute.to_string_lossy()])
            .spawn();
    }

    WorkspaceOpenResult {
        success: true,
        error: None,
        message: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_preview_kind_markdown() {
        assert_eq!(get_preview_kind("readme.md"), Some("markdown"));
        assert_eq!(get_preview_kind("doc.mdx"), Some("markdown"));
    }

    #[test]
    fn test_get_preview_kind_json() {
        assert_eq!(get_preview_kind("data.json"), Some("json"));
        assert_eq!(get_preview_kind("config.jsonc"), Some("json"));
        assert_eq!(get_preview_kind("map.geojson"), Some("json"));
    }

    #[test]
    fn test_get_preview_kind_image() {
        assert_eq!(get_preview_kind("photo.png"), Some("image"));
        assert_eq!(get_preview_kind("pic.jpg"), Some("image"));
        assert_eq!(get_preview_kind("pic.jpeg"), Some("image"));
        assert_eq!(get_preview_kind("anim.gif"), Some("image"));
        assert_eq!(get_preview_kind("photo.webp"), Some("image"));
        assert_eq!(get_preview_kind("icon.svg"), Some("image"));
    }

    #[test]
    fn test_get_preview_kind_unsupported() {
        assert_eq!(get_preview_kind("script.js"), None);
        assert_eq!(get_preview_kind("binary.exe"), None);
        assert_eq!(get_preview_kind("archive.zip"), None);
    }

    #[test]
    fn test_get_image_mime() {
        assert_eq!(get_image_mime("photo.png"), "image/png");
        assert_eq!(get_image_mime("photo.jpg"), "image/jpeg");
        assert_eq!(get_image_mime("photo.jpeg"), "image/jpeg");
        assert_eq!(get_image_mime("photo.gif"), "image/gif");
        assert_eq!(get_image_mime("photo.webp"), "image/webp");
        assert_eq!(get_image_mime("photo.svg"), "image/svg+xml");
        assert_eq!(get_image_mime("photo.bmp"), "image/bmp");
        assert_eq!(get_image_mime("photo.tiff"), "image/tiff");
        assert_eq!(get_image_mime("photo.xyz"), "application/octet-stream");
    }

    #[test]
    fn test_is_within_workspace_valid() {
        let root = "/tmp/test-workspace";
        let abs = Path::new("/tmp/test-workspace/subdir/file.txt");
        assert!(is_within_workspace(abs, root));
    }

    #[test]
    fn test_is_within_workspace_traversal() {
        let root = "/tmp/test-workspace";
        let abs = Path::new("/tmp/other-place/file.txt");
        assert!(!is_within_workspace(abs, root));
    }

    #[test]
    fn test_is_within_workspace_root_itself() {
        let root = "/tmp/test-workspace";
        let abs = Path::new("/tmp/test-workspace");
        assert!(is_within_workspace(abs, root));
    }
}
