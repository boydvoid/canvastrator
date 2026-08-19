//! Resolving the user's real PATH.
//!
//! A GUI app launched from Finder or the Dock inherits a minimal PATH
//! (`/usr/bin:/bin:/usr/sbin:/sbin`) — not the one from the user's shell
//! profile. That breaks Canvastrator twice over: `claude` and friends live in
//! `~/.local/bin` or `~/.bun/bin` and can't be found, and any agent that does
//! get spawned can't run `cargo`, `bun`, or `git` either.
//!
//! So we ask the login shell what PATH it would give us, once, and use that
//! for both provider detection and every child process.

use std::path::PathBuf;
use std::sync::OnceLock;

static RESOLVED: OnceLock<String> = OnceLock::new();

/// Directories worth having even if the shell tells us nothing.
fn fallback_dirs() -> Vec<PathBuf> {
    let mut dirs = vec![];
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        for extra in [".local/bin", ".bun/bin", ".cargo/bin", ".opencode/bin", ".deno/bin", "bin"] {
            dirs.push(home.join(extra));
        }
    }
    dirs.push("/opt/homebrew/bin".into());
    dirs.push("/opt/homebrew/sbin".into());
    dirs.push("/usr/local/bin".into());
    dirs.push("/usr/bin".into());
    dirs.push("/bin".into());
    dirs.push("/usr/sbin".into());
    dirs.push("/sbin".into());
    dirs
}

/// Ask the login shell for its PATH. `-l` picks up profile files, `-i` picks up
/// rc files, which is where version managers usually put things.
#[cfg(unix)]
fn shell_path() -> Option<String> {
    let shell = std::env::var("SHELL").ok()?;
    let out = std::process::Command::new(&shell)
        .args(["-lic", "printf %s \"$PATH\""])
        // A prompt or a profile that reads stdin would otherwise hang startup.
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    // Some profiles print banners; PATH is what we asked to be printed last.
    let text = String::from_utf8_lossy(&out.stdout);
    let candidate = text.lines().last()?.trim().to_string();
    (candidate.contains('/') && !candidate.is_empty()).then_some(candidate)
}

#[cfg(not(unix))]
fn shell_path() -> Option<String> {
    None
}

/// The PATH to use for detection and for every spawned agent. Union of the
/// login shell's PATH, the inherited one, and the usual install locations —
/// deduped, order preserved.
pub fn user_path() -> &'static str {
    RESOLVED.get_or_init(|| {
        let mut ordered: Vec<PathBuf> = vec![];
        let mut seen = std::collections::HashSet::new();

        let push = |dirs: Vec<PathBuf>, ordered: &mut Vec<PathBuf>, seen: &mut std::collections::HashSet<PathBuf>| {
            for d in dirs {
                if seen.insert(d.clone()) {
                    ordered.push(d);
                }
            }
        };

        if let Some(p) = shell_path() {
            push(std::env::split_paths(&p).collect(), &mut ordered, &mut seen);
        }
        if let Some(p) = std::env::var_os("PATH") {
            push(std::env::split_paths(&p).collect(), &mut ordered, &mut seen);
        }
        push(fallback_dirs(), &mut ordered, &mut seen);

        std::env::join_paths(ordered)
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default()
    })
}

/// Absolute path of an executable on the user's PATH, or None.
/// Spawning by bare name would depend on the process PATH, which is exactly
/// what's wrong in a bundled app.
pub fn which(bin: &str) -> Option<String> {
    std::env::split_paths(user_path())
        .map(|d| d.join(bin))
        .find(|c| is_executable(c))
        .map(|c| c.to_string_lossy().into_owned())
}

#[cfg(unix)]
fn is_executable(p: &std::path::Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(p)
        .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable(p: &std::path::Path) -> bool {
    p.is_file()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_path_includes_the_usual_install_dirs() {
        let p = user_path();
        assert!(p.contains("/usr/bin"), "got {p}");
        assert!(p.contains(".local/bin") || p.contains(".bun/bin") || p.contains("homebrew"));
    }

    #[test]
    fn user_path_has_no_duplicates() {
        let dirs: Vec<_> = std::env::split_paths(user_path()).collect();
        let unique: std::collections::HashSet<_> = dirs.iter().collect();
        assert_eq!(dirs.len(), unique.len());
    }

    #[test]
    fn which_finds_a_binary_that_certainly_exists() {
        let sh = which("sh").expect("sh must be on PATH");
        assert!(sh.ends_with("/sh"), "got {sh}");
        assert!(std::path::Path::new(&sh).is_absolute());
    }

    /// The bundled-app case: PATH from Finder is minimal, so resolution has to
    /// come from the login shell or the fallback dirs. Skipped on a machine
    /// with none of the agent CLIs installed.
    #[test]
    fn resolves_agent_clis_that_are_not_on_the_inherited_path() {
        let installed: Vec<_> = ["claude", "codex", "opencode"]
            .into_iter()
            .filter_map(|b| which(b).map(|p| (b, p)))
            .collect();
        if installed.is_empty() {
            eprintln!("no agent CLIs installed; skipping");
            return;
        }
        for (bin, path) in installed {
            eprintln!("resolved {bin} -> {path}");
            assert!(std::path::Path::new(&path).is_absolute());
            assert!(is_executable(std::path::Path::new(&path)));
        }
    }

    #[test]
    fn which_returns_none_for_nonsense() {
        assert!(which("gridterm-definitely-not-a-real-binary").is_none());
    }
}
