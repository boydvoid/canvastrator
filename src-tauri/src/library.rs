//! The persona library: agent archetypes that outlive any one canvas.
//!
//! Personalities defined on a canvas die with it, which makes a good
//! "reviewer" un-reusable. The library is a single JSON file in the app data
//! dir — small, hand-editable, and easy to back up or check into a dotfiles
//! repo. The frontend owns the shape of each entry; this side only stores it.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Library {
    pub version: u32,
    pub personalities: Vec<serde_json::Value>,
}

fn path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    Ok(dir.join("personalities.json"))
}

/// Returns an empty library rather than an error when nothing is saved yet —
/// a first run is not a failure.
#[tauri::command]
pub fn load_library(app: AppHandle) -> Result<Library, String> {
    let p = path(&app)?;
    match std::fs::read_to_string(&p) {
        Ok(raw) => serde_json::from_str(&raw).map_err(|e| format!("{}: {e}", p.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Library {
            version: 1,
            personalities: vec![],
        }),
        Err(e) => Err(format!("{}: {e}", p.display())),
    }
}

/// Whole-library write. It's a handful of small records, so replacing the file
/// is simpler than merging, and write-then-rename keeps it atomic.
#[tauri::command]
pub fn save_library(app: AppHandle, library: Library) -> Result<(), String> {
    let p = path(&app)?;
    let body = serde_json::to_string_pretty(&library).map_err(|e| e.to_string())?;
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, body).map_err(|e| format!("{}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, &p).map_err(|e| format!("{}: {e}", p.display()))?;

    write_markdown(&app, &library.personalities);
    Ok(())
}

/// Personas as markdown files, one per persona.
///
/// The JSON blob is fine for the app but opaque to everything else. A folder of
/// `.md` files is greppable, diffable, editable in any editor, and can live in
/// a dotfiles repo — the same reasoning the CLIs apply to their own skills.
fn personas_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?
        .join("personas");
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    Ok(dir)
}

fn slug(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
        .collect();
    let s = s.trim_matches('-').to_string();
    if s.is_empty() { "persona".into() } else { s.chars().take(64).collect() }
}

fn to_markdown(p: &serde_json::Value) -> String {
    let get = |k: &str| p.get(k).and_then(|v| v.as_str()).unwrap_or("");
    let mut out = String::from("---\n");
    out.push_str(&format!("name: {}\n", get("name")));
    out.push_str(&format!("description: {}\n", get("description")));
    out.push_str(&format!("provider: {}\n", get("provider")));
    if !get("model").is_empty() {
        out.push_str(&format!("model: {}\n", get("model")));
    }
    if !get("effort").is_empty() {
        out.push_str(&format!("effort: {}\n", get("effort")));
    }
    out.push_str(&format!("permission: {}\n", get("permission")));
    out.push_str("---\n\n");
    out.push_str(get("instructions"));
    out.push('\n');
    out
}

/// Mirror the library to `personas/*.md`. Best effort: a failure here must not
/// fail the save, since the JSON remains the source the app reads.
fn write_markdown(app: &AppHandle, personalities: &[serde_json::Value]) {
    let Ok(dir) = personas_dir(app) else { return };

    let mut keep = std::collections::HashSet::new();
    for p in personalities {
        let Some(name) = p.get("name").and_then(|v| v.as_str()) else { continue };
        let file = format!("{}.md", slug(name));
        keep.insert(file.clone());
        let _ = std::fs::write(dir.join(file), to_markdown(p));
    }

    // A persona deleted in the app shouldn't linger on disk.
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name.ends_with(".md") && !keep.contains(&name) {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
}

/// Where the personas live on disk, for the UI to show.
#[tauri::command]
pub fn personas_location(app: AppHandle) -> Result<String, String> {
    Ok(personas_dir(&app)?.to_string_lossy().into_owned())
}

/// Where the library lives, for the UI to show and for support questions.
#[tauri::command]
pub fn library_location(app: AppHandle) -> Result<String, String> {
    Ok(path(&app)?.to_string_lossy().into_owned())
}
