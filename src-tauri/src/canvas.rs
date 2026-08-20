//! Saved canvases: the whole graph, on disk, under the app's data dir.
//!
//! The frontend owns the shape of `data` — this side only cares about the
//! envelope (id, name, timestamp) so it can list canvases without the UI
//! having to open every file.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CanvasDoc {
    pub id: String,
    pub name: String,
    pub updated_at: i64,
    pub version: u32,
    pub data: serde_json::Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasMeta {
    pub id: String,
    pub name: String,
    pub updated_at: i64,
    pub version: u32,
    /// Cheap "is this the canvas I meant" signal in the open list.
    pub nodes: usize,
}

/// Ids become filenames, so anything that could escape the directory is out.
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?
        .join("canvases");
    std::fs::create_dir_all(&base).map_err(|e| format!("{}: {e}", base.display()))?;
    Ok(base)
}

fn path_for(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err(format!("invalid canvas id: {id}"));
    }
    Ok(dir(app)?.join(format!("{id}.json")))
}

#[tauri::command]
pub fn list_canvases(app: AppHandle) -> Result<Vec<CanvasMeta>, String> {
    let base = dir(&app)?;
    let entries = std::fs::read_dir(&base).map_err(|e| format!("{}: {e}", base.display()))?;

    let mut out: Vec<CanvasMeta> = entries
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        // A single unreadable or half-written file must not hide the rest.
        .filter_map(|e| std::fs::read_to_string(e.path()).ok())
        .filter_map(|raw| serde_json::from_str::<CanvasDoc>(&raw).ok())
        .map(|doc| CanvasMeta {
            nodes: doc
                .data
                .get("nodes")
                .and_then(|n| n.as_array())
                .map_or(0, |a| a.len()),
            id: doc.id,
            name: doc.name,
            updated_at: doc.updated_at,
            version: doc.version,
        })
        .collect();

    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(out)
}

/// Returned when the canvas file simply is not there any more.
///
/// The frontend has to tell this apart from every other failure. A canvas the
/// user deleted is nothing to complain about — reopening it is a convenience —
/// while one that is present but unreadable is a canvas of theirs that failed
/// to open, and treating the two the same is how the pointer to it gets thrown
/// away and the work starts again in a new file.
pub const MISSING: &str = "canvas-missing";

#[tauri::command]
pub fn load_canvas(app: AppHandle, id: String) -> Result<CanvasDoc, String> {
    let path = path_for(&app, &id)?;
    if !path.exists() {
        return Err(MISSING.to_string());
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| format!("{id}: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("{id} is not a canvas file: {e}"))
}

#[tauri::command]
pub fn save_canvas(app: AppHandle, doc: CanvasDoc) -> Result<(), String> {
    let path = path_for(&app, &doc.id)?;
    let body = serde_json::to_string(&doc).map_err(|e| e.to_string())?;
    // Write-then-rename: a crash mid-save leaves the previous canvas intact
    // rather than a truncated file that no longer parses.
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, body).map_err(|e| format!("{}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("{}: {e}", path.display()))
}

#[tauri::command]
pub fn delete_canvas(app: AppHandle, id: String) -> Result<(), String> {
    let path = path_for(&app, &id)?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        // Already gone is the outcome the caller wanted.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("{id}: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::valid_id;

    #[test]
    fn ids_that_could_escape_the_directory_are_rejected() {
        assert!(valid_id("canvas_ab12"));
        assert!(valid_id("a-b_C9"));
        assert!(!valid_id(""));
        assert!(!valid_id("../etc/passwd"));
        assert!(!valid_id("a/b"));
        assert!(!valid_id("a.json"));
        assert!(!valid_id(&"x".repeat(65)));
    }
}
