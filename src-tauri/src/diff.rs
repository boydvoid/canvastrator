//! The committed version of a file, for diffing against what's on disk.
//!
//! Agents change files in place, and GridTerm sees the tool call only after
//! the fact — there is no "before" to keep. Git already has one, which is also
//! the baseline the user reasons about: what changed since my last commit.

use std::path::Path;
use std::process::Command;

use serde::Serialize;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiffBase {
    /// Contents at HEAD, or None when git has no version of this file.
    pub original: Option<String>,
    /// Why there's no baseline, for the UI to explain rather than sit blank.
    pub reason: Option<String>,
    /// Path relative to the repo root, as git knows it.
    pub rel: Option<String>,
}

fn git(dir: &Path, args: &[&str]) -> Option<String> {
    let out = Command::new("git").current_dir(dir).args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8(out.stdout).ok()
}

/// The committed contents of a file, if git has any.
#[tauri::command]
pub fn file_diff_base(path: String) -> DiffBase {
    let file = Path::new(&path);
    let none = |reason: &str| DiffBase {
        original: None,
        reason: Some(reason.to_string()),
        rel: None,
    };

    let Some(dir) = file.parent() else {
        return none("not a file path");
    };
    if !file.is_file() {
        return none("file does not exist");
    }

    let Some(root) = git(dir, &["rev-parse", "--show-toplevel"]) else {
        return none("not inside a git repository");
    };
    let root = root.trim();

    let Ok(rel) = file.strip_prefix(root) else {
        return none("outside the repository");
    };
    let rel = rel.to_string_lossy().to_string();

    let Some(name) = file.file_name().map(|n| n.to_string_lossy().into_owned()) else {
        return none("not a file path");
    };
    // `HEAD:./name` resolves relative to cwd, which avoids quoting games with
    // paths that contain spaces.
    match git(dir, &["show", &format!("HEAD:./{name}")]) {
        Some(original) => DiffBase {
            original: Some(original),
            reason: None,
            rel: Some(rel),
        },
        // Untracked, or added since HEAD: everything in it is new, which is a
        // perfectly good diff against nothing.
        None => DiffBase {
            original: Some(String::new()),
            reason: Some("new file — not in the last commit".into()),
            rel: Some(rel),
        },
    }
}

/// Where the work would land: the current branch of the repo a path sits in.
///
/// Named the same way the panel reads it — the branch is the "to" of a change,
/// and the Changes panel says it beside the file list so a run that edited the
/// wrong worktree is visible before the diff is read rather than after.
///
/// `None` for a detached HEAD or a directory git knows nothing about: a
/// missing branch is a fact to draw, not an error to raise.
#[tauri::command]
pub fn git_branch(path: String) -> Option<String> {
    let dir = Path::new(&path);
    let dir = if dir.is_file() { dir.parent()? } else { dir };
    let name = git(dir, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    let name = name.trim();
    if name.is_empty() || name == "HEAD" {
        return None;
    }
    Some(name.to_string())
}
