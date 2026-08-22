//! Actions the canvas refuses to let an agent take unasked.
//!
//! The provider CLIs have their own permission modes, and they are the wrong
//! instrument for this. They decide whether an agent may run commands at all —
//! a single dial from read-only to no-holds-barred — and the thing worth
//! stopping is narrower than that: a handful of operations that cannot be
//! undone. `git push` puts work on a remote where someone else can pull it.
//! `reset --hard` and `clean -fd` throw away the last hour without asking git
//! for permission first. An agent set to `auto` so it can run the tests can do
//! all three, and the tests are why you set it to `auto`.
//!
//! So the guard is not a mode, it is a wrapper. A directory of shim scripts
//! goes first on every agent's PATH, and the shim for `git` refuses the
//! guarded subcommands and tells the agent, in words, to ask the user. The
//! refusal is real: the process never runs. Everything else — every other git
//! command, every other program — passes straight through to the binary that
//! would have run anyway.
//!
//! Approval is a file. When the user allows something, the app writes a line
//! into that session's allow file and the agent's next attempt succeeds. No
//! socket, no daemon, nothing to keep alive: a shell script and a file either
//! containing a word or not.

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// The operations a canvas can hold back, and what each one covers.
///
/// Deliberately short. A guard list long enough to cover everything an agent
/// could regret is a list nobody reads and every agent trips over, and the
/// cost of a false stop is a turn wasted asking about `git status`.
pub const RULES: &[(&str, &str)] = &[
    ("push", "publishing commits to a remote"),
    ("discard", "throwing away uncommitted work"),
    ("rewrite", "rewriting history that already exists"),
];

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GuardRule {
    pub id: String,
    pub what: String,
}

/// Every rule the app knows how to enforce, for the settings list.
#[tauri::command]
pub fn guard_rules() -> Vec<GuardRule> {
    RULES
        .iter()
        .map(|(id, what)| GuardRule {
            id: (*id).to_string(),
            what: (*what).to_string(),
        })
        .collect()
}

fn guard_root(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?
        .join("guard");
    std::fs::create_dir_all(&base).map_err(|e| format!("{}: {e}", base.display()))?;
    Ok(base)
}

/// Where one session's approvals are recorded.
///
/// Per session, not per canvas: allowing this agent to push is not a statement
/// about the other five, and an approval that leaked sideways would be the
/// worst kind of surprise.
pub fn allow_file(app: &AppHandle, session_id: &str) -> Result<PathBuf, String> {
    let clean: String = session_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
        .collect();
    if clean.is_empty() {
        return Err("invalid session id".into());
    }
    let dir = guard_root(app)?.join("allow");
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    Ok(dir.join(clean))
}

/// The shim `git`, written fresh each launch so an upgrade cannot leave an old
/// one shadowing the real binary with stale rules.
const GIT_SHIM: &str = r#"#!/bin/sh
# Written by Canvastrator. First on an agent's PATH, ahead of the real git.
#
# Refuses the operations this canvas is guarding unless the user has allowed
# them for this session, and hands everything else to the real git untouched.

rules="${GT_GUARD_RULES:-}"
allow_file="${GT_GUARD_ALLOW:-}"

guarding() {
  case ",$rules," in *",$1,"*) return 0 ;; esac
  return 1
}

allowed() {
  [ -n "$allow_file" ] && [ -f "$allow_file" ] && grep -qx "$1" "$allow_file"
}

refuse() {
  # To the agent, not to a log: this is the only place it finds out, and the
  # message has to say what to do next rather than just "denied".
  echo "canvastrator: refused \`git $2\` — $3." >&2
  echo "The person running this canvas has to approve it. Stop and ask them, in your reply, whether to $3; they can allow it and you can try again. Do not work around this." >&2
  exit 77
}

# The subcommand is the first argument that is not a global flag.
sub=""
for arg in "$@"; do
  case "$arg" in
    -*) ;;
    *) sub="$arg"; break ;;
  esac
done

case "$sub" in
  push)
    if guarding push && ! allowed push; then
      refuse push "push" "publish commits to a remote"
    fi
    ;;
  reset)
    case " $* " in
      *" --hard "*)
        if guarding discard && ! allowed discard; then
          refuse discard "reset --hard" "throw away uncommitted work"
        fi
        ;;
    esac
    ;;
  clean)
    case " $* " in
      *" -fd"*|*" -df"*|*" -f "*|*" --force "*)
        if guarding discard && ! allowed discard; then
          refuse discard "clean" "delete untracked files"
        fi
        ;;
    esac
    ;;
  checkout|restore|switch)
    case " $* " in
      *" --force "*|*" -f "*|*" --discard-changes "*)
        if guarding discard && ! allowed discard; then
          refuse discard "$sub" "discard local changes"
        fi
        ;;
    esac
    ;;
  rebase|filter-branch)
    if guarding rewrite && ! allowed rewrite; then
      refuse rewrite "$sub" "rewrite history"
    fi
    ;;
  commit)
    case " $* " in
      *" --amend "*)
        if guarding rewrite && ! allowed rewrite; then
          refuse rewrite "commit --amend" "rewrite the last commit"
        fi
        ;;
    esac
    ;;
esac

# Everything else: the real git, found by walking PATH past this shim.
me=$(cd "$(dirname "$0")" && pwd)
IFS=:
for dir in $PATH; do
  [ "$dir" = "$me" ] && continue
  if [ -x "$dir/git" ]; then
    exec "$dir/git" "$@"
  fi
done
echo "canvastrator: git not found on PATH" >&2
exit 127
"#;

/// Lay down the shim directory, and return it for prepending to PATH.
pub fn shim_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = guard_root(app)?.join("bin");
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let git = dir.join("git");
    std::fs::write(&git, GIT_SHIM).map_err(|e| format!("{}: {e}", git.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&git, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("{}: {e}", git.display()))?;
    }
    Ok(dir)
}

/// Allow one guarded operation for one session, from now on.
#[tauri::command]
pub fn guard_allow(app: AppHandle, session_id: String, rule: String) -> Result<(), String> {
    if !RULES.iter().any(|(id, _)| *id == rule) {
        return Err(format!("unknown guard: {rule}"));
    }
    let path = allow_file(&app, &session_id)?;
    let mut text = std::fs::read_to_string(&path).unwrap_or_default();
    if text.lines().any(|l| l == rule) {
        return Ok(());
    }
    if !text.is_empty() && !text.ends_with('\n') {
        text.push('\n');
    }
    text.push_str(&rule);
    text.push('\n');
    std::fs::write(&path, text).map_err(|e| format!("{}: {e}", path.display()))
}

/// Take an approval back. The next attempt is refused again.
#[tauri::command]
pub fn guard_revoke(app: AppHandle, session_id: String, rule: String) -> Result<(), String> {
    let path = allow_file(&app, &session_id)?;
    let Ok(text) = std::fs::read_to_string(&path) else {
        return Ok(());
    };
    let kept: Vec<&str> = text.lines().filter(|l| *l != rule && !l.is_empty()).collect();
    std::fs::write(&path, kept.join("\n")).map_err(|e| format!("{}: {e}", path.display()))
}

/// What one session has been allowed so far.
#[tauri::command]
pub fn guard_allowed(app: AppHandle, session_id: String) -> Vec<String> {
    let Ok(path) = allow_file(&app, &session_id) else {
        return vec![];
    };
    std::fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .filter(|l| !l.is_empty())
        .map(str::to_string)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    /// Run the shim directly, with a fake `git` behind it on PATH, and see
    /// what actually happens to the process.
    fn run(rules: &str, allow: &str, args: &[&str]) -> (i32, String) {
        let dir = std::env::temp_dir().join(format!(
            "gt-guard-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let bin = dir.join("bin");
        let real = dir.join("real");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::create_dir_all(&real).unwrap();

        let shim = bin.join("git");
        std::fs::write(&shim, GIT_SHIM).unwrap();
        // The git that should run when the shim lets it through.
        let passthrough = real.join("git");
        std::fs::write(&passthrough, "#!/bin/sh\necho REAL \"$@\"\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            for f in [&shim, &passthrough] {
                std::fs::set_permissions(f, std::fs::Permissions::from_mode(0o755)).unwrap();
            }
        }

        let allow_path = dir.join("allow");
        std::fs::write(&allow_path, allow).unwrap();

        let out = Command::new(&shim)
            .args(args)
            .env("PATH", format!("{}:{}", bin.display(), real.display()))
            .env("GT_GUARD_RULES", rules)
            .env("GT_GUARD_ALLOW", &allow_path)
            .output()
            .expect("shim runs");

        let mut text = String::from_utf8_lossy(&out.stdout).to_string();
        text.push_str(&String::from_utf8_lossy(&out.stderr));
        std::fs::remove_dir_all(&dir).ok();
        (out.status.code().unwrap_or(-1), text)
    }

    #[test]
    fn a_guarded_push_never_reaches_git() {
        let (code, text) = run("push", "", &["push", "origin", "main"]);
        assert_eq!(code, 77);
        assert!(!text.contains("REAL"), "the real git ran: {text}");
        // The message has to say what to do next, not just "denied".
        assert!(text.contains("ask them"), "{text}");
    }

    #[test]
    fn an_allowed_push_goes_through() {
        let (code, text) = run("push", "push\n", &["push"]);
        assert_eq!(code, 0);
        assert!(text.contains("REAL push"), "{text}");
    }

    #[test]
    fn an_unguarded_canvas_pushes_freely() {
        // Nothing configured means nothing refused: the guard is opt-in.
        let (code, text) = run("", "", &["push"]);
        assert_eq!(code, 0);
        assert!(text.contains("REAL push"), "{text}");
    }

    #[test]
    fn everything_else_passes_straight_through() {
        // The cost of a false stop is a turn wasted asking about `git status`.
        for args in [
            vec!["status"],
            vec!["commit", "-m", "wip"],
            vec!["reset", "HEAD~1"],
            vec!["clean", "-n"],
            vec!["checkout", "-b", "feature"],
        ] {
            let (code, text) = run("push,discard,rewrite", "", &args);
            assert_eq!(code, 0, "{args:?} was refused: {text}");
            assert!(text.contains("REAL"), "{args:?} did not reach git: {text}");
        }
    }

    #[test]
    fn discarding_work_is_held_back_in_its_several_spellings() {
        for args in [
            vec!["reset", "--hard"],
            vec!["clean", "-fd"],
            vec!["checkout", "--force", "main"],
        ] {
            let (code, text) = run("discard", "", &args);
            assert_eq!(code, 77, "{args:?} was allowed: {text}");
            assert!(!text.contains("REAL"), "{args:?} reached git: {text}");
        }
    }

    #[test]
    fn rewriting_history_is_held_back() {
        for args in [vec!["rebase", "-i", "HEAD~3"], vec!["commit", "--amend", "-m", "x"]] {
            let (code, _) = run("rewrite", "", &args);
            assert_eq!(code, 77, "{args:?} was allowed");
        }
    }

    #[test]
    fn a_global_flag_does_not_hide_the_subcommand() {
        // `git -C /elsewhere push` is still a push.
        let (code, text) = run("push", "", &["-C", "/tmp", "push"]);
        assert_eq!(code, 77);
        assert!(!text.contains("REAL"), "{text}");
    }

    #[test]
    fn one_session_being_allowed_says_nothing_about_another() {
        // Different allow files, so the second is still refused.
        let (allowed, _) = run("push", "push\n", &["push"]);
        let (refused, _) = run("push", "", &["push"]);
        assert_eq!((allowed, refused), (0, 77));
    }
}
