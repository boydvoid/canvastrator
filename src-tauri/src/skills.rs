//! Discovering the skills the user already has.
//!
//! Every provider ships its own convention, and a session loads them whether
//! Canvastrator knows about them or not. Two sources, used together:
//!
//! - The **live list** in a provider's startup event — authoritative, includes
//!   plugin skills, but names only.
//! - The **files on disk** — slower to trust, but they carry the description,
//!   which is the part a human (or an orchestrator) needs to choose one.

use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredSkill {
    pub name: String,
    pub description: String,
    /// claude | codex | opencode — whose convention it was found under.
    pub provider: String,
    /// "user", "project", or the plugin it came from.
    pub source: String,
    pub path: String,
}

/// Pull `name` and `description` out of YAML frontmatter.
///
/// Deliberately not a YAML parser: frontmatter here is a handful of scalar
/// keys, and descriptions routinely run to several folded lines, which is the
/// only structure worth handling.
fn parse_frontmatter(text: &str) -> Option<(String, String)> {
    let rest = text.strip_prefix("---")?;
    let end = rest.find("\n---")?;
    let block = &rest[..end];

    let mut name = String::new();
    let mut description = String::new();
    let mut collecting: Option<&str> = None;

    for line in block.lines() {
        let trimmed = line.trim();
        if let Some(v) = trimmed.strip_prefix("name:") {
            name = v.trim().trim_matches('"').to_string();
            collecting = None;
        } else if let Some(v) = trimmed.strip_prefix("description:") {
            let v = v.trim();
            // `>-` and `|` mean the value continues on the following lines.
            if v == ">-" || v == ">" || v == "|" || v == "|-" || v.is_empty() {
                description.clear();
                collecting = Some("description");
            } else {
                description = v.trim_matches('"').to_string();
                collecting = None;
            }
        } else if collecting == Some("description") {
            // A new key ends the folded block.
            if trimmed.is_empty() {
                continue;
            }
            if !line.starts_with(' ') && trimmed.contains(": ") {
                collecting = None;
                continue;
            }
            if !description.is_empty() {
                description.push(' ');
            }
            description.push_str(trimmed);
        }
    }

    if name.is_empty() {
        return None;
    }
    Some((name, description))
}

fn read_skill(dir: &Path, provider: &str, source: &str) -> Option<DiscoveredSkill> {
    let file = dir.join("SKILL.md");
    let text = std::fs::read_to_string(&file).ok()?;
    let (name, description) = parse_frontmatter(&text)?;
    Some(DiscoveredSkill {
        name,
        description,
        provider: provider.to_string(),
        source: source.to_string(),
        path: file.to_string_lossy().into_owned(),
    })
}

/// `<root>/skills/<name>/SKILL.md`
fn scan_skills_dir(root: &Path, provider: &str, source: &str, out: &mut Vec<DiscoveredSkill>) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for e in entries.flatten() {
        if e.path().is_dir() {
            if let Some(s) = read_skill(&e.path(), provider, source) {
                out.push(s);
            }
        }
    }
}

/// `<root>/<name>.md` — opencode and codex keep flat prompt files rather than
/// a directory per skill.
fn scan_flat_dir(root: &Path, provider: &str, source: &str, out: &mut Vec<DiscoveredSkill>) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for e in entries.flatten() {
        let path = e.path();
        if path.extension().is_some_and(|x| x == "md") {
            let stem = path.file_stem().unwrap_or_default().to_string_lossy().to_string();
            let text = std::fs::read_to_string(&path).unwrap_or_default();
            let (name, description) = parse_frontmatter(&text)
                // No frontmatter: the filename is the name, and the first
                // non-empty line is the closest thing to a description.
                .unwrap_or_else(|| {
                    let first = text
                        .lines()
                        .map(str::trim)
                        .find(|l| !l.is_empty() && !l.starts_with("---"))
                        .unwrap_or("")
                        .to_string();
                    (stem.clone(), first)
                });
            out.push(DiscoveredSkill {
                name,
                description: description.chars().take(300).collect(),
                provider: provider.to_string(),
                source: source.to_string(),
                path: path.to_string_lossy().into_owned(),
            });
        }
    }
}

/// Everything installed for any provider, plus anything in the given project.
#[tauri::command]
pub fn discover_skills(cwd: Option<String>) -> Vec<DiscoveredSkill> {
    let mut out = vec![];
    let home = std::env::var_os("HOME").map(PathBuf::from);

    if let Some(home) = &home {
        // claude: user-level
        scan_skills_dir(&home.join(".claude/skills"), "claude", "user", &mut out);

        // claude: plugins, at cache/<marketplace>/<plugin>/<version>/skills/*
        if let Ok(markets) = std::fs::read_dir(home.join(".claude/plugins/cache")) {
            for market in markets.flatten() {
                if let Ok(plugins) = std::fs::read_dir(market.path()) {
                    for plugin in plugins.flatten() {
                        let label = plugin.file_name().to_string_lossy().to_string();
                        if let Ok(versions) = std::fs::read_dir(plugin.path()) {
                            for version in versions.flatten() {
                                scan_skills_dir(
                                    &version.path().join("skills"),
                                    "claude",
                                    &label,
                                    &mut out,
                                );
                            }
                        }
                    }
                }
            }
        }

        // opencode and codex keep flat command/prompt files.
        for (dir, provider) in [
            (home.join(".config/opencode/command"), "opencode"),
            (home.join(".opencode/command"), "opencode"),
            (home.join(".codex/prompts"), "codex"),
        ] {
            scan_flat_dir(&dir, provider, "user", &mut out);
        }
    }

    // Project-level skills only exist once a folder is wired in.
    if let Some(cwd) = cwd {
        let root = PathBuf::from(&cwd);
        scan_skills_dir(&root.join(".claude/skills"), "claude", "project", &mut out);
        scan_flat_dir(&root.join(".opencode/command"), "opencode", "project", &mut out);
    }

    out.sort_by(|a, b| a.name.cmp(&b.name));
    out.dedup_by(|a, b| a.name == b.name && a.provider == b.provider);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_simple_frontmatter_block() {
        let text = "---\nname: my-skill\ndescription: Does a thing\n---\n\nbody";
        assert_eq!(
            parse_frontmatter(text),
            Some(("my-skill".into(), "Does a thing".into()))
        );
    }

    /// The shape Anthropic's own plugin skills actually use.
    #[test]
    fn joins_a_folded_description() {
        let text = "---\nname: stripe-apps\ndescription: >-\n  Use when building a Stripe App\n  or reviewing one.\n---\nbody";
        let (name, desc) = parse_frontmatter(text).unwrap();
        assert_eq!(name, "stripe-apps");
        assert_eq!(desc, "Use when building a Stripe App or reviewing one.");
    }

    #[test]
    fn stops_folding_at_the_next_key() {
        let text = "---\nname: a\ndescription: |\n  line one\nallowed-tools: Bash\n---\nbody";
        let (_, desc) = parse_frontmatter(text).unwrap();
        assert_eq!(desc, "line one");
    }

    #[test]
    fn a_skill_without_a_name_is_not_a_skill() {
        assert!(parse_frontmatter("---\ndescription: orphan\n---\n").is_none());
        assert!(parse_frontmatter("no frontmatter here").is_none());
        assert!(parse_frontmatter("---\nunterminated: true\n").is_none());
    }

    #[test]
    fn tolerates_a_missing_description() {
        let (name, desc) = parse_frontmatter("---\nname: bare\n---\nbody").unwrap();
        assert_eq!(name, "bare");
        assert_eq!(desc, "");
    }

    /// The bug this pins: typing `@` in a session rooted at $HOME crawled
    /// Documents, Desktop and Downloads, and macOS asked for each in turn.
    #[test]
    fn refuses_to_walk_a_root_that_is_not_a_project() {
        let home = std::env::var("HOME").unwrap();
        assert!(is_too_broad(Path::new(&home)));
        assert!(is_too_broad(Path::new("/")));
        assert!(is_too_broad(Path::new("/Users")));
        assert!(is_too_broad(Path::new("/Volumes")));
        assert!(list_project_files(vec![home], String::new(), 10).is_empty());
    }

    /// Nothing is searchable by default: with no folder nodes there are no
    /// roots, so `@` finds nothing rather than falling back to somewhere.
    #[test]
    fn no_roots_means_no_results() {
        assert!(list_project_files(vec![], String::new(), 10).is_empty());
    }

    #[test]
    fn a_real_project_is_still_walked() {
        assert!(!is_too_broad(Path::new("/Users/someone/code/thing")));
    }

    #[test]
    fn discovery_never_panics_on_a_machine_with_nothing_installed() {
        let found = discover_skills(Some("/nonexistent/project".into()));
        assert!(found.iter().all(|s| !s.name.is_empty()));
    }
}

/// Directories never worth walking for an `@` mention.
const SKIP_DIRS: &[&str] = &[
    ".git", "node_modules", "target", "dist", "build", ".next", ".turbo", ".venv",
    "venv", "__pycache__", ".cache", "vendor", "Pods", ".idea", ".DS_Store",
];

/// Locations macOS gates behind a privacy prompt, plus the ones no project
/// legitimately contains. Walking into any of these makes the app ask for
/// access to something the user never pointed it at.
const PRIVATE_DIRS: &[&str] = &[
    "Desktop", "Documents", "Downloads", "Pictures", "Movies", "Music",
    "Library", "Applications", "Public", "Sites", "Creative Cloud Files",
    "Mobile Documents", "iCloud Drive", "Dropbox", "Google Drive", "OneDrive",
];

/// A project root we refuse to walk.
///
/// `$HOME` and `/` are not projects. Crawling them would touch Documents,
/// Desktop, Downloads and every mounted volume, and on macOS each one is a
/// separate privacy prompt — an app asking for the whole computer because
/// someone typed `@`.
fn is_too_broad(root: &Path) -> bool {
    if root.parent().is_none() {
        return true; // filesystem root
    }
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        if root == home {
            return true;
        }
    }
    matches!(
        root.to_string_lossy().as_ref(),
        "/Users" | "/Volumes" | "/System" | "/Library" | "/Applications"
    )
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFile {
    /// Path relative to the root it was found under.
    pub rel: String,
    /// Absolute path, which is what an agent should actually be handed.
    pub path: String,
    /// The folder node this came from, by its directory name.
    pub root: String,
}

/// Files under the given roots, for `@`-mentioning one into a message.
///
/// Roots are folder nodes on the canvas — nothing else is searchable, because
/// nothing else has been granted. Walks breadth-first with a hard cap: a
/// mention picker that stalls on a monorepo is worse than one that shows the
/// first few hundred matches.
#[tauri::command]
pub fn list_project_files(roots: Vec<String>, query: String, limit: usize) -> Vec<ProjectFile> {
    let needle = query.trim().to_lowercase();
    let limit = limit.clamp(1, 500);
    let mut out: Vec<ProjectFile> = vec![];

    for cwd in roots {
        if out.len() >= limit {
            break;
        }
        let root = std::path::PathBuf::from(&cwd);
        if !root.is_dir() || is_too_broad(&root) {
            continue;
        }
        let label = root
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| cwd.clone());
        walk_root(&root, &label, &needle, limit, &mut out);
    }

    // Shallower paths first: the file you want is rarely six levels down.
    out.sort_by_key(|f| (f.rel.matches('/').count(), f.rel.len(), f.rel.clone()));
    out.truncate(limit);
    out
}

fn walk_root(root: &Path, label: &str, needle: &str, limit: usize, out: &mut Vec<ProjectFile>) {
    let mut queue = std::collections::VecDeque::from([root.to_path_buf()]);
    // Bounded independently of `limit`: a filtered search still has to stop.
    let mut budget = 20_000usize;

    while let Some(dir) = queue.pop_front() {
        if out.len() >= limit || budget == 0 {
            break;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for e in entries.flatten() {
            if budget == 0 {
                break;
            }
            budget -= 1;
            let path = e.path();
            let name = e.file_name().to_string_lossy().to_string();

            if path.is_dir() {
                if SKIP_DIRS.contains(&name.as_str())
                    || PRIVATE_DIRS.contains(&name.as_str())
                    || name.starts_with('.')
                {
                    continue;
                }
                queue.push_back(path);
                continue;
            }
            let Ok(rel) = path.strip_prefix(root) else {
                continue;
            };
            let rel = rel.to_string_lossy().to_string();
            if needle.is_empty() || rel.to_lowercase().contains(needle) {
                out.push(ProjectFile {
                    path: path.to_string_lossy().into_owned(),
                    rel,
                    root: label.to_string(),
                });
                if out.len() >= limit {
                    break;
                }
            }
        }
    }
}
