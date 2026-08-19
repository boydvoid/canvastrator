//! Carrying data across a bundle-identifier change.
//!
//! The app data directory is keyed on the bundle identifier, so renaming the
//! app moves it — and every canvas saved under the old name becomes invisible.
//! Nothing is deleted or overwritten here: files are copied only when the new
//! location doesn't already have one by that name, so running twice is a no-op
//! and a newer file always wins.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

/// Identifiers this app has shipped under, oldest first.
const LEGACY_IDENTIFIERS: &[&str] = &["com.gridterm.app"];

fn copy_missing(from: &Path, to: &Path) -> usize {
    let Ok(entries) = std::fs::read_dir(from) else {
        return 0;
    };
    if std::fs::create_dir_all(to).is_err() {
        return 0;
    }
    let mut moved = 0;
    for e in entries.flatten() {
        let src = e.path();
        if !src.is_file() {
            continue;
        }
        let dest = to.join(e.file_name());
        if dest.exists() {
            continue;
        }
        if std::fs::copy(&src, &dest).is_ok() {
            moved += 1;
        }
    }
    moved
}

/// Copy canvases, the persona library and persona files from any previous
/// identifier into the current one.
pub fn migrate_legacy_data(app: &AppHandle) {
    let Ok(current) = app.path().app_data_dir() else {
        return;
    };
    let Some(parent) = current.parent().map(PathBuf::from) else {
        return;
    };

    for id in LEGACY_IDENTIFIERS {
        let old = parent.join(id);
        if !old.is_dir() || old == current {
            continue;
        }

        let canvases = copy_missing(&old.join("canvases"), &current.join("canvases"));
        let personas = copy_missing(&old.join("personas"), &current.join("personas"));

        let lib_src = old.join("personalities.json");
        let lib_dest = current.join("personalities.json");
        let library = if lib_src.is_file() && !lib_dest.is_file() {
            std::fs::copy(&lib_src, &lib_dest).is_ok()
        } else {
            false
        };

        if canvases > 0 || personas > 0 || library {
            log::info!(
                "migrated from {id}: {canvases} canvases, {personas} personas, library={library}. \
                 Originals left in place at {}",
                old.display()
            );
        }
    }
}
