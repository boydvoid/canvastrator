//! Running the project's own check, and believing it over the agent.
//!
//! "Done" arrives as a sentence. An agent that has just written four files
//! reports success in the same tone whether the suite passes or the module no
//! longer compiles, and the canvas had no way to tell those apart — the only
//! verification available was a human reading a diff.
//!
//! So the harness runs the check itself. Not a check invented here: the one the
//! project already has, in the working directory the agent actually used, which
//! after worktree isolation is that agent's own checkout. What comes back is a
//! verdict the canvas can draw.
//!
//! The command is the user's, run through their login shell — the same bargain
//! the terminal node makes. It is empty until they set it, and nothing runs
//! until it isn't.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use serde::Serialize;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

use crate::env;

/// How much of the output to keep.
///
/// The tail, not the head: a test runner prints its failures last, and the
/// first four thousand characters of a passing-then-failing run are the part
/// nobody needs. Sized to survive a screenful of stack trace without becoming
/// a second transcript inside the canvas file.
const TAIL_BYTES: usize = 4_000;

/// Long enough for a real suite, short enough that a hung check ends.
const TIMEOUT: Duration = Duration::from_secs(600);

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    pub ok: bool,
    /// Exit status, or None when it was killed for running too long.
    pub code: Option<i32>,
    /// Wall clock, so a check that got slower is visible.
    pub ms: u64,
    /// The last of stdout and stderr, interleaved as the shell wrote them.
    pub tail: String,
    /// Set when the check could not be run at all, as opposed to failing.
    pub error: Option<String>,
}

fn tail_of(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    if text.len() <= TAIL_BYTES {
        return text.trim_end().to_string();
    }
    // Cut on a char boundary, then on a line boundary, so the first line shown
    // is a whole one rather than the back half of a stack frame.
    let start = text.len() - TAIL_BYTES;
    let mut cut = text
        .char_indices()
        .map(|(i, _)| i)
        .find(|i| *i >= start)
        .unwrap_or(0);
    if let Some(nl) = text[cut..].find('\n') {
        cut += nl + 1;
    }
    format!("…\n{}", text[cut..].trim_end())
}

/// Run the project's check in a directory, and say what happened.
#[tauri::command]
pub async fn run_check(cwd: String, command: String) -> CheckResult {
    let started = Instant::now();
    let fail = |error: &str| CheckResult {
        ok: false,
        code: None,
        ms: 0,
        tail: String::new(),
        error: Some(error.to_string()),
    };

    if command.trim().is_empty() {
        return fail("no check command set for this canvas");
    }
    if !Path::new(&cwd).is_dir() {
        return fail(&format!("{cwd} is not a directory"));
    }

    // Through a shell, because the command is a command line: `bun run test`,
    // `cargo test --all`, `make check && ./scripts/lint`. Anything else would
    // make the setting a lie about what it accepts.
    let spawned = Command::new("/bin/sh")
        .arg("-c")
        .arg(&command)
        .current_dir(&cwd)
        .env("PATH", env::user_path())
        // Test runners colour their output when they think a human is
        // watching; nothing here renders escape codes.
        .env("NO_COLOR", "1")
        .env("CI", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn();

    let mut child = match spawned {
        Ok(c) => c,
        Err(e) => return fail(&format!("could not run the check: {e}")),
    };

    let mut out = child.stdout.take().expect("stdout piped");
    let mut err = child.stderr.take().expect("stderr piped");
    let collect = async {
        let mut o = Vec::new();
        let mut e = Vec::new();
        // Both streams at once: a runner that fills one pipe while nothing
        // reads the other deadlocks rather than finishing.
        let _ = tokio::join!(out.read_to_end(&mut o), err.read_to_end(&mut e));
        let status = child.wait().await;
        o.extend_from_slice(&e);
        (status, o)
    };

    match tokio::time::timeout(TIMEOUT, collect).await {
        Ok((status, bytes)) => {
            let code = status.as_ref().ok().and_then(|s| s.code());
            CheckResult {
                ok: status.map(|s| s.success()).unwrap_or(false),
                code,
                ms: started.elapsed().as_millis() as u64,
                tail: tail_of(&bytes),
                error: None,
            }
        }
        Err(_) => CheckResult {
            ok: false,
            code: None,
            ms: started.elapsed().as_millis() as u64,
            tail: String::new(),
            error: Some(format!("the check was still running after {}s", TIMEOUT.as_secs())),
        },
    }
}

/// The package manager a JavaScript project is actually using.
fn js_runner(dir: &Path) -> &'static str {
    for (lockfile, runner) in [
        ("bun.lock", "bun"),
        ("bun.lockb", "bun"),
        ("pnpm-lock.yaml", "pnpm"),
        ("yarn.lock", "yarn"),
    ] {
        if dir.join(lockfile).exists() {
            return runner;
        }
    }
    "npm"
}

/// Whether a `package.json` declares a script by name.
fn has_script(dir: &Path, name: &str) -> bool {
    let Ok(text) = std::fs::read_to_string(dir.join("package.json")) else {
        return false;
    };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else {
        return false;
    };
    json.get("scripts")
        .and_then(|s| s.get(name))
        .and_then(|v| v.as_str())
        .is_some_and(|v| !v.trim().is_empty())
}

/// What this project's check probably is.
///
/// A guess, offered rather than applied: the setting stays the user's, and a
/// wrong guess that ran automatically would be worse than no guess at all.
/// Ordered by how much a failure means — a type error is a fact, a test suite
/// is a fact, a lint rule is an opinion.
#[tauri::command]
pub fn detect_check(cwd: String) -> Option<String> {
    let dir = PathBuf::from(&cwd);
    if !dir.is_dir() {
        return None;
    }

    if dir.join("package.json").exists() {
        let runner = js_runner(&dir);
        for name in ["test", "check", "lint"] {
            if has_script(&dir, name) {
                return Some(format!("{runner} run {name}"));
            }
        }
    }
    if dir.join("Cargo.toml").exists() {
        return Some("cargo test".into());
    }
    if dir.join("pyproject.toml").exists() || dir.join("pytest.ini").exists() {
        return Some("pytest -q".into());
    }
    if dir.join("go.mod").exists() {
        return Some("go test ./...".into());
    }
    if dir.join("Makefile").exists() {
        let has_target = std::fs::read_to_string(dir.join("Makefile"))
            .map(|t| t.lines().any(|l| l.starts_with("test:")))
            .unwrap_or(false);
        if has_target {
            return Some("make test".into());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("gt-check-{}-{name}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[tokio::test]
    async fn a_passing_command_passes() {
        let dir = tmp("pass");
        let out = run_check(dir.to_string_lossy().into_owned(), "echo hello".into()).await;
        assert!(out.ok);
        assert_eq!(out.code, Some(0));
        assert_eq!(out.tail, "hello");
        assert!(out.error.is_none());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn a_failing_command_carries_its_output_and_its_code() {
        let dir = tmp("fail");
        let out = run_check(
            dir.to_string_lossy().into_owned(),
            "echo 'FAIL: 2 tests' >&2; exit 3".into(),
        )
        .await;
        assert!(!out.ok);
        assert_eq!(out.code, Some(3));
        // stderr is where runners print failures, so it cannot be dropped.
        assert!(out.tail.contains("FAIL: 2 tests"), "{}", out.tail);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn an_unset_command_is_not_a_failed_check() {
        // Nothing configured must never read as "your tests are broken".
        let out = run_check("/tmp".into(), "   ".into()).await;
        assert!(!out.ok);
        assert!(out.error.is_some());
        assert_eq!(out.code, None);
    }

    #[test]
    fn the_tail_keeps_the_end_and_whole_lines() {
        let long = format!("{}\nlast line here", "noise\n".repeat(2_000));
        let tail = tail_of(long.as_bytes());
        assert!(tail.len() <= TAIL_BYTES + 8, "{}", tail.len());
        // A runner prints its failures last; that is the part worth keeping.
        assert!(tail.ends_with("last line here"));
        assert!(tail.starts_with("…\n"));
        // The first kept line is whole, never the back half of one.
        assert!(tail.lines().nth(1).is_some_and(|l| l == "noise"));
    }

    #[test]
    fn detects_the_javascript_runner_the_project_actually_uses() {
        let dir = tmp("js");
        std::fs::write(dir.join("bun.lock"), "").unwrap();
        std::fs::write(
            dir.join("package.json"),
            r#"{"scripts":{"lint":"oxlint","test":"vitest run"}}"#,
        )
        .unwrap();
        // Test beats lint: a failing test is a fact, a lint rule is an opinion.
        assert_eq!(detect_check(dir.to_string_lossy().into_owned()), Some("bun run test".into()));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn skips_a_script_that_is_declared_but_empty() {
        let dir = tmp("empty-script");
        std::fs::write(dir.join("package.json"), r#"{"scripts":{"test":"  "}}"#).unwrap();
        assert_eq!(detect_check(dir.to_string_lossy().into_owned()), None);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn falls_back_through_the_other_ecosystems() {
        let dir = tmp("rust");
        std::fs::write(dir.join("Cargo.toml"), "[package]\nname = \"x\"").unwrap();
        assert_eq!(detect_check(dir.to_string_lossy().into_owned()), Some("cargo test".into()));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_makefile_without_a_test_target_is_not_a_check() {
        let dir = tmp("make");
        std::fs::write(dir.join("Makefile"), "build:\n\tcc main.c\n").unwrap();
        assert_eq!(detect_check(dir.to_string_lossy().into_owned()), None);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_directory_with_nothing_in_it_gets_no_guess() {
        let dir = tmp("bare");
        assert_eq!(detect_check(dir.to_string_lossy().into_owned()), None);
        assert_eq!(detect_check("/nonexistent".into()), None);
        std::fs::remove_dir_all(&dir).ok();
    }
}
