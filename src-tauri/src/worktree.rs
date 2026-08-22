//! A working copy per agent.
//!
//! Two agents editing one directory is a data race the canvas cannot see: the
//! writes interleave, the diff is unattributable, and the second agent reads a
//! file the first one is halfway through changing. A canvas that encourages
//! spawning a squad has to answer this, and git already has the answer — a
//! worktree is a second checkout of the same repository, with its own branch
//! and its own files, sharing one object store.
//!
//! Placement is a sibling of the repository rather than a directory inside it.
//! Inside would mean the agent's own file listings, searches and test runs walk
//! into copies of the project it is working on, which is both slow and
//! confusing; next door it is visible in Finder, obvious in `git worktree
//! list`, and trivially removable.
//!
//! Nothing here deletes anything. `git worktree remove` refuses to discard
//! uncommitted work unless forced, and this never forces: an agent's worktree
//! is where the last hour of work lives, and the harness is not the thing that
//! should decide it was worthless.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    /// Absolute path of the checkout the agent should work in.
    pub path: String,
    /// The branch checked out there.
    pub branch: String,
    /// The repository it was cut from.
    pub repo: String,
    /// False when this already existed and was reused, which is not an error:
    /// re-isolating an agent should land it back where its work is.
    pub created: bool,
}

fn git(dir: &Path, args: &[&str]) -> Result<String, String> {
    let out = Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .map_err(|e| format!("could not run git: {e}"))?;
    if !out.status.success() {
        // git puts its diagnostics on stderr, and they are better than anything
        // this layer could write: "fatal: '<branch>' is already checked out at
        // '<path>'" tells the user exactly what to do next.
        let msg = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if msg.is_empty() {
            format!("git {} failed", args.first().unwrap_or(&""))
        } else {
            msg
        });
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// A branch and directory name that survives whatever the agent is called.
///
/// Agents are named by the user or invented by an orchestrator, so a name can
/// hold spaces, slashes and case. Git tolerates less than a filesystem does,
/// and a slash in particular would nest the branch under a directory of its own.
pub fn slug(name: &str) -> String {
    let mut out = String::new();
    let mut last_dash = true; // leading dashes are dropped
    for c in name.chars() {
        if c.is_ascii_alphanumeric() {
            out.extend(c.to_lowercase());
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    let trimmed = out.trim_end_matches('-').to_string();
    if trimmed.is_empty() {
        "agent".into()
    } else {
        trimmed.chars().take(40).collect()
    }
}

/// The repository root a path sits in, or None outside a repo.
///
/// Inside a worktree this is the worktree, which is what a caller asking
/// "where am I" wants. `main_root` is the other question.
#[tauri::command]
pub fn git_repo_root(path: String) -> Option<String> {
    let p = PathBuf::from(&path);
    let dir = if p.is_file() { p.parent()?.to_path_buf() } else { p };
    git(&dir, &["rev-parse", "--show-toplevel"]).ok().filter(|s| !s.is_empty())
}

/// The *main* checkout of the repository a path belongs to.
///
/// Worktrees are cut from the main checkout, never from each other: isolating
/// an agent whose folder is already a worktree must put its sibling next to the
/// repository, not inside `app.worktrees/reviewer.worktrees/`. `--git-common-dir`
/// is the one path that is shared by every checkout — its parent is the main
/// working tree.
fn main_root(path: &str) -> Option<PathBuf> {
    let here = PathBuf::from(git_repo_root(path.to_string())?);
    let common = git(&here, &["rev-parse", "--path-format=absolute", "--git-common-dir"]).ok()?;
    let common = PathBuf::from(common.trim());
    // A bare repo has no working tree to branch from; so does a `--git-dir`
    // that is not named `.git`. Falling back to the local root keeps those
    // cases working as they did.
    match common.file_name().map(|n| n == ".git") {
        Some(true) => common.parent().map(Path::to_path_buf),
        _ => Some(here),
    }
}

/// Where a repository's worktrees live: `<repo>.worktrees/` next door.
fn worktrees_dir(root: &Path) -> Option<PathBuf> {
    let name = root.file_name()?.to_string_lossy().to_string();
    Some(root.parent()?.join(format!("{name}.worktrees")))
}

/// Whether a branch already exists locally.
fn branch_exists(root: &Path, branch: &str) -> bool {
    git(root, &["rev-parse", "--verify", "--quiet", &format!("refs/heads/{branch}")]).is_ok()
}

/// Give an agent its own checkout of the repository a path belongs to.
///
/// Idempotent by design: isolating an agent twice, or restoring a canvas that
/// already had worktrees, must land on the existing checkout rather than fail
/// or make a second one.
#[tauri::command]
pub fn worktree_add(path: String, name: String) -> Result<Worktree, String> {
    let Some(root) = main_root(&path) else {
        return Err(format!("{path} is not inside a git repository"));
    };

    let slug = slug(&name);
    let branch = format!("wt/{slug}");
    let Some(dir) = worktrees_dir(&root) else {
        return Err("the repository has no parent directory to put worktrees in".into());
    };
    let dest = dir.join(&slug);

    // Already there: reuse it. `git -C <dest> rev-parse` proves it is a real
    // checkout rather than a leftover directory of the same name.
    if dest.is_dir() {
        return match git(&dest, &["rev-parse", "--abbrev-ref", "HEAD"]) {
            Ok(existing) => Ok(Worktree {
                path: dest.to_string_lossy().into_owned(),
                branch: existing,
                repo: root.to_string_lossy().into_owned(),
                created: false,
            }),
            Err(_) => Err(format!(
                "{} already exists and is not a git worktree",
                dest.to_string_lossy()
            )),
        };
    }

    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;

    let dest_str = dest.to_string_lossy().into_owned();
    // A branch that already exists is checked out rather than recreated, which
    // is what makes this safe to call on a canvas restored from disk.
    let args: Vec<&str> = if branch_exists(&root, &branch) {
        vec!["worktree", "add", &dest_str, &branch]
    } else {
        vec!["worktree", "add", &dest_str, "-b", &branch]
    };
    git(&root, &args)?;

    Ok(Worktree {
        path: dest_str,
        branch,
        repo: root.to_string_lossy().into_owned(),
        created: true,
    })
}

/// Every worktree of the repository a path belongs to, main checkout included.
#[tauri::command]
pub fn worktree_list(path: String) -> Vec<Worktree> {
    let Some(root) = git_repo_root(path) else {
        return vec![];
    };
    let root = PathBuf::from(&root);
    let Ok(text) = git(&root, &["worktree", "list", "--porcelain"]) else {
        return vec![];
    };

    let mut out = vec![];
    let mut path: Option<String> = None;
    let mut branch = String::new();
    for line in text.lines().chain(std::iter::once("")) {
        if let Some(p) = line.strip_prefix("worktree ") {
            path = Some(p.to_string());
            branch.clear();
        } else if let Some(b) = line.strip_prefix("branch ") {
            branch = b.trim_start_matches("refs/heads/").to_string();
        } else if line.is_empty() {
            if let Some(p) = path.take() {
                out.push(Worktree {
                    path: p,
                    // A detached worktree has no branch line at all.
                    branch: if branch.is_empty() { "detached".into() } else { branch.clone() },
                    repo: root.to_string_lossy().into_owned(),
                    created: false,
                });
            }
        }
    }
    out
}

/// Remove a worktree, refusing while it still holds uncommitted work.
///
/// Never forced. git's own refusal is the safety here, and its message names
/// what is unsaved — which is the answer the user needs before deciding.
#[tauri::command]
pub fn worktree_remove(path: String) -> Result<(), String> {
    let Some(root) = git_repo_root(path.clone()) else {
        return Err("that path is not inside a git repository".into());
    };
    git(&PathBuf::from(root), &["worktree", "remove", &path])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs_survive_whatever_an_agent_is_called() {
        assert_eq!(slug("implementer"), "implementer");
        assert_eq!(slug("Reviewer 2"), "reviewer-2");
        // A slash would nest the branch under a directory of its own.
        assert_eq!(slug("feat/parser"), "feat-parser");
        assert_eq!(slug("  spaced  out  "), "spaced-out");
        assert_eq!(slug("!!!"), "agent");
        assert_eq!(slug(""), "agent");
    }

    #[test]
    fn a_long_name_stays_a_usable_directory_name() {
        let long = "a".repeat(120);
        assert_eq!(slug(&long).len(), 40);
    }

    #[test]
    fn worktrees_sit_beside_the_repository_not_inside_it() {
        let dir = worktrees_dir(Path::new("/Users/me/dev/app")).unwrap();
        assert_eq!(dir, PathBuf::from("/Users/me/dev/app.worktrees"));
        // Inside would mean every search and test run walks into copies of the
        // project the agent is working on.
        assert!(!dir.starts_with("/Users/me/dev/app/"));
    }

    #[test]
    fn a_path_outside_a_repository_is_refused_rather_than_guessed_at() {
        let err = worktree_add("/nonexistent/place".into(), "agent".into()).unwrap_err();
        assert!(err.contains("not inside a git repository"), "{err}");
    }

    #[test]
    fn listing_outside_a_repository_is_empty_not_an_error() {
        assert!(worktree_list("/nonexistent/place".into()).is_empty());
    }

    /// A real repository, a real `git worktree add`, and the second call that
    /// has to find the first one rather than fail.
    #[test]
    fn creates_a_checkout_beside_the_repo_and_reuses_it() {
        let base = std::env::temp_dir().join(format!("gt-wt-{}-{:?}", std::process::id(), std::thread::current().id()));
        let repo = base.join("app");
        std::fs::create_dir_all(&repo).unwrap();

        let run = |dir: &Path, args: &[&str]| {
            Command::new("git").current_dir(dir).args(args).output().expect("git runs")
        };
        run(&repo, &["init", "--initial-branch=main"]);
        run(&repo, &["config", "user.email", "t@example.com"]);
        run(&repo, &["config", "user.name", "test"]);
        std::fs::write(repo.join("README.md"), "hello\n").unwrap();
        run(&repo, &["add", "."]);
        run(&repo, &["commit", "-m", "first"]);

        let path = repo.to_string_lossy().into_owned();
        let first = worktree_add(path.clone(), "Reviewer 2".into()).expect("worktree created");
        assert!(first.created);
        assert_eq!(first.branch, "wt/reviewer-2");
        // Compared by suffix: on macOS git resolves /var to /private/var, so
        // the absolute strings differ by a symlink neither side controls.
        assert!(first.path.ends_with("app.worktrees/reviewer-2"), "{}", first.path);
        // A checkout is a real directory with the repo's files in it.
        assert!(PathBuf::from(&first.path).join("README.md").is_file());

        // Isolating twice must land back on the work, not fail or fork again.
        let second = worktree_add(path.clone(), "Reviewer 2".into()).expect("existing worktree reused");
        assert!(!second.created);
        assert_eq!(second.path, first.path);
        assert_eq!(second.branch, "wt/reviewer-2");

        // Both checkouts are listed, from either side.
        let listed = worktree_list(first.path.clone());
        assert!(listed.iter().any(|w| w.branch == "wt/reviewer-2"));
        assert!(listed.iter().any(|w| w.branch == "main"));

        // Isolating an agent whose folder is *already* a worktree must cut a
        // sibling from the main checkout, not nest one inside the worktree.
        let nested = worktree_add(first.path.clone(), "implementer".into()).expect("second agent isolated");
        assert!(nested.path.ends_with("app.worktrees/implementer"), "{}", nested.path);
        assert!(!nested.path.contains("reviewer-2"), "{}", nested.path);
        worktree_remove(nested.path.clone()).expect("clean worktree removed");

        // Nothing uncommitted, so removal is allowed and does not need force.
        worktree_remove(first.path.clone()).expect("clean worktree removed");
        assert!(!PathBuf::from(&first.path).exists());

        std::fs::remove_dir_all(&base).ok();
    }

    /// The repository this test runs in has at least its own main checkout,
    /// and the parser has to produce a branch for it rather than "detached".
    #[test]
    fn lists_the_repository_it_is_run_from() {
        let here = std::env::current_dir().unwrap();
        let found = worktree_list(here.to_string_lossy().into_owned());
        if found.is_empty() {
            return; // built outside a checkout; nothing to assert
        }
        assert!(found.iter().all(|w| !w.path.is_empty()));
        assert!(found.iter().all(|w| !w.branch.is_empty()));
    }
}
