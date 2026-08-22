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
    /// When the canvas was first written. Fixed for the life of the file, so
    /// the list can be ordered by something that saving does not move.
    ///
    /// Optional because canvases written before this field existed do not
    /// carry it; those fall back to `updated_at` until their next save, which
    /// stamps the timestamp they had at that point rather than the clock —
    /// otherwise opening an old canvas would send it to the end of the list.
    #[serde(default)]
    pub created_at: Option<i64>,
    pub version: u32,
    pub data: serde_json::Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasMeta {
    pub id: String,
    pub name: String,
    pub updated_at: i64,
    /// Never null here: a file without one is reported as its own timestamp.
    pub created_at: i64,
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
            created_at: doc.created_at.unwrap_or(doc.updated_at),
            id: doc.id,
            name: doc.name,
            updated_at: doc.updated_at,
            version: doc.version,
        })
        .collect();

    // Creation order, oldest first. The list used to be sorted by the save
    // timestamp, which meant that opening a canvas — and so autosaving it —
    // pulled its row to the top under the pointer that had just clicked it.
    // A switcher whose rows move when you use them is one you cannot learn,
    // so the order is fixed at creation; the id breaks ties between canvases
    // saved in the same millisecond so it is total either way.
    out.sort_by(|a, b| {
        a.created_at
            .cmp(&b.created_at)
            .then_with(|| a.id.cmp(&b.id))
    });
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
pub fn save_canvas(app: AppHandle, mut doc: CanvasDoc) -> Result<(), String> {
    let path = path_for(&app, &doc.id)?;
    // The creation stamp belongs to the file, not to whoever is writing it:
    // resolving it here means no caller can drop it and reorder the list by
    // accident.
    doc.created_at = Some(resolve_created_at(&doc, read_doc(&path).as_ref()));
    let body = serde_json::to_string(&doc).map_err(|e| e.to_string())?;
    // Write-then-rename: a crash mid-save leaves the previous canvas intact
    // rather than a truncated file that no longer parses.
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, body).map_err(|e| format!("{}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("{}: {e}", path.display()))
}

fn read_doc(path: &std::path::Path) -> Option<CanvasDoc> {
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

/// The creation stamp a save should carry.
///
/// Whatever the incoming doc already claims wins, then whatever is on disk —
/// including an older file's save timestamp, which is the closest thing to a
/// creation time it has. Only a canvas nobody has written before is stamped
/// with the clock it arrived with.
fn resolve_created_at(doc: &CanvasDoc, existing: Option<&CanvasDoc>) -> i64 {
    doc.created_at
        .or_else(|| existing.and_then(|e| e.created_at))
        .or_else(|| existing.map(|e| e.updated_at))
        .unwrap_or(doc.updated_at)
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
    use super::{resolve_created_at, valid_id, CanvasDoc};

    fn doc(created_at: Option<i64>, updated_at: i64) -> CanvasDoc {
        CanvasDoc {
            id: "c1".into(),
            name: "c".into(),
            updated_at,
            created_at,
            version: 1,
            data: serde_json::Value::Null,
        }
    }

    #[test]
    fn saving_does_not_move_a_canvas_creation_stamp() {
        // A canvas that has been saved before keeps the stamp on disk, however
        // many times it is written afterwards.
        let on_disk = doc(Some(100), 100);
        assert_eq!(resolve_created_at(&doc(None, 900), Some(&on_disk)), 100);
        // One written before the field existed adopts its last save time, not
        // the clock — opening an old canvas must not send it to the end.
        let legacy = doc(None, 250);
        assert_eq!(resolve_created_at(&doc(None, 900), Some(&legacy)), 250);
        // Only a genuinely new file takes the incoming timestamp.
        assert_eq!(resolve_created_at(&doc(None, 900), None), 900);
    }

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

/// Where handover notes are kept.
///
/// Beside the canvases in the app's own data directory, deliberately not in the
/// user's repository: a note is written whenever a window fills, which on a
/// long run is several times an hour, and a tool that quietly starts committing
/// files to somebody's project has overstepped. The note carries its working
/// directory in its header, so it can always be read back to where it belongs.
fn notes_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?
        .join("notes");
    std::fs::create_dir_all(&base).map_err(|e| format!("{}: {e}", base.display()))?;
    Ok(base)
}

/// Write a handover note and return the path it landed at.
#[tauri::command]
pub fn write_note(app: AppHandle, name: String, text: String) -> Result<String, String> {
    // The name is generated, but it ends up as a path: a `..` or a slash that
    // slipped through would write outside the notes directory.
    let clean = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        .collect::<String>();
    if clean.is_empty() || clean.starts_with('.') {
        return Err(format!("unusable note name: {name}"));
    }
    let path = notes_dir(&app)?.join(&clean);
    std::fs::write(&path, text).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(path.to_string_lossy().into_owned())
}
