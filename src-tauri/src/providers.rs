use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::event::{AgentEvent, McpStatus, PathTouch};

/// How much a session is allowed to do without asking. Non-interactive runs
/// can't answer a permission prompt, so an unset policy means "denied" —
/// which is why an agent that looks broken is usually just unauthorised.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Permission {
    /// Read and explore. No edits, no state-changing commands.
    Plan,
    /// Edit files *and* run commands — builds, tests, installs — checked by
    /// the provider's own safety classifier rather than by a human prompt.
    /// Note this is claude's `auto`, not `acceptEdits`: `acceptEdits` allows
    /// file writes and a handful of filesystem commands only, so anything
    /// like `cargo build` or `git init` is denied outright in a `--print`
    /// run, which reads as "the agent is broken".
    #[default]
    Auto,
    /// Everything, safety checks and sandbox off. Opt-in.
    Full,
}

/// How hard the model is asked to think before answering. Optional: unset
/// means "whatever the CLI defaults to", which follows the user's own config.
/// The levels are claude's, because it has the widest ladder — the other CLIs
/// take the nearest rung they understand.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Effort {
    Low,
    Medium,
    High,
    Xhigh,
    Max,
}

impl Effort {
    fn claude(&self) -> &'static str {
        match self {
            Effort::Low => "low",
            Effort::Medium => "medium",
            Effort::High => "high",
            Effort::Xhigh => "xhigh",
            Effort::Max => "max",
        }
    }

    /// Codex's ladder stops at `high`, so the two rungs above it clamp down
    /// rather than being dropped — asking for more thinking should never
    /// quietly become less than `high`.
    fn codex(&self) -> &'static str {
        match self {
            Effort::Low => "low",
            Effort::Medium => "medium",
            Effort::High | Effort::Xhigh | Effort::Max => "high",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Claude,
    Codex,
    Opencode,
}

/// The directories holding a turn's images, deduplicated and in the order they
/// were first seen. Pasted images share one directory; an image file node from
/// the canvas brings its own, wherever the user keeps it.
fn image_dirs(images: &[String]) -> Vec<String> {
    let mut dirs: Vec<String> = Vec::new();
    for img in images {
        let Some(dir) = std::path::Path::new(img).parent() else { continue };
        let dir = dir.to_string_lossy().into_owned();
        if !dirs.contains(&dir) {
            dirs.push(dir);
        }
    }
    dirs
}

/// claude only looks at an image if the prompt names it, so the paths are
/// appended to the prompt itself. Kept out of the way at the end, after the
/// user's own words, and left alone entirely when there are no images.
fn image_prompt(prompt: &str, images: &[String]) -> String {
    if images.is_empty() {
        return prompt.to_string();
    }
    let list = images.iter().map(|p| format!("- {p}")).collect::<Vec<_>>().join("\n");
    format!("{prompt}\n\n<canvastrator-images>\nImages attached to this message. Read them:\n{list}\n</canvastrator-images>")
}

/// Everything one turn's argv depends on.
///
/// `resume` carries the provider's own session id from a previous turn, which
/// is how continuity is kept — each turn is a fresh process, the conversation
/// lives in the CLI's store.
///
/// `images` are absolute paths, because none of these CLIs takes image bytes.
/// Every flag that takes them is variadic, so each provider needs the trailing
/// prompt fenced off from it — see the comments in `args`; getting that wrong
/// hangs the turn rather than failing it.
#[derive(Debug, Clone, Copy, Default)]
pub struct TurnArgs<'a> {
    pub prompt: &'a str,
    pub resume: Option<&'a str>,
    pub model: Option<&'a str>,
    pub perm: Permission,
    pub effort: Option<Effort>,
    pub mcp_config: Option<&'a str>,
    pub images: &'a [String],
}

impl Provider {
    pub fn binary(&self) -> &'static str {
        match self {
            Provider::Claude => "claude",
            Provider::Codex => "codex",
            Provider::Opencode => "opencode",
        }
    }

    /// Argument vector for one turn.
    pub fn args(&self, turn: &TurnArgs) -> Vec<String> {
        let TurnArgs { prompt, resume, model, perm, effort, mcp_config, images } = *turn;
        let s = |v: &str| v.to_string();
        match self {
            Provider::Claude => {
                let mut a = vec![
                    s("--print"),
                    s("--output-format"),
                    s("stream-json"),
                    s("--include-partial-messages"),
                    s("--verbose"),
                ];
                match resume {
                    Some(id) => {
                        a.push(s("--resume"));
                        a.push(s(id));
                    }
                    None => {
                        a.push(s("--session-id"));
                        a.push(uuid::Uuid::new_v4().to_string());
                    }
                }
                if let Some(m) = model {
                    a.push(s("--model"));
                    a.push(s(m));
                }
                if let Some(e) = effort {
                    a.push(s("--effort"));
                    a.push(s(e.claude()));
                }
                // Additive, not `--strict-mcp-config`: attaching a server on
                // the canvas should add to the user's own, not replace them.
                if let Some(cfg) = mcp_config {
                    a.push(s("--mcp-config"));
                    a.push(s(cfg));
                }
                // claude has no image flag: it opens a path it finds in the
                // prompt with its Read tool. Outside the cwd that read is
                // denied, so every directory the images live in is granted
                // here. `--add-dir` is variadic, which is why
                // `--permission-mode` follows it rather than preceding it —
                // otherwise it would swallow the prompt.
                let dirs = image_dirs(images);
                if !dirs.is_empty() {
                    a.push(s("--add-dir"));
                    a.extend(dirs);
                }
                a.push(s("--permission-mode"));
                a.push(s(match perm {
                    Permission::Plan => "plan",
                    Permission::Auto => "auto",
                    Permission::Full => "bypassPermissions",
                }));
                a.push(image_prompt(prompt, images));
                a
            }
            Provider::Codex => {
                let mut a = vec![s("exec"), s("--json"), s("--skip-git-repo-check")];
                if let Some(id) = resume {
                    a.push(s("resume"));
                    a.push(s(id));
                }
                if let Some(m) = model {
                    a.push(s("--model"));
                    a.push(s(m));
                }
                // Codex has no reasoning-effort flag; it's a config override.
                if let Some(e) = effort {
                    a.push(s("--config"));
                    a.push(format!("model_reasoning_effort=\"{}\"", e.codex()));
                }
                if let Some(cfg) = mcp_config {
                    // codex takes config overrides rather than a config file.
                    a.push(s("-c"));
                    a.push(format!("mcp_servers={cfg}"));
                }
                match perm {
                    Permission::Plan => {
                        a.push(s("--sandbox"));
                        a.push(s("read-only"));
                    }
                    // Alias for `-a on-failure --sandbox workspace-write`;
                    // passing --sandbox as well would conflict with it.
                    Permission::Auto => a.push(s("--full-auto")),
                    Permission::Full => a.push(s("--dangerously-bypass-approvals-and-sandbox")),
                }
                // `codex exec resume` is its own subcommand with its own,
                // much smaller set of arguments, and `-i` is not among them —
                // it is rejected outright, which fails the turn rather than
                // degrading it. So a resumed turn names the paths in the
                // prompt instead, the way claude gets them; codex can read a
                // file it is told about.
                let resumed = resume.is_some();
                // On a fresh turn `-i` takes any number of files and would eat
                // the prompt as one more of them. codex is then left with no
                // prompt, waits on a stdin we closed, and the turn never ends
                // — so the prompt is fenced off behind `--`.
                if !images.is_empty() && !resumed {
                    a.push(s("-i"));
                    a.extend(images.iter().cloned());
                    a.push(s("--"));
                }
                a.push(if resumed {
                    image_prompt(prompt, images)
                } else {
                    s(prompt)
                });
                a
            }
            Provider::Opencode => {
                let mut a = vec![s("run"), s("--format"), s("json")];
                if let Some(id) = resume {
                    a.push(s("--session"));
                    a.push(s(id));
                }
                if let Some(m) = model {
                    a.push(s("--model"));
                    a.push(s(m));
                }
                // opencode calls it a model variant, and passes the string
                // straight through to whichever provider is configured.
                if let Some(e) = effort {
                    a.push(s("--variant"));
                    a.push(s(e.claude()));
                }
                if !matches!(perm, Permission::Plan) {
                    a.push(s("--auto"));
                }
                // Variadic, and fenced off for the same reason as codex's `-i`.
                if !images.is_empty() {
                    a.push(s("-f"));
                    a.extend(images.iter().cloned());
                    a.push(s("--"));
                }
                a.push(s(prompt));
                a
            }
        }
    }

    /// Parse one line of the CLI's JSONL into zero or more neutral events.
    /// Unknown event types are deliberately dropped rather than erroring —
    /// these CLIs add event kinds faster than we can track them.
    pub fn parse_line(&self, line: &str) -> Vec<AgentEvent> {
        let line = line.trim();
        if line.is_empty() {
            return vec![];
        }
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            return vec![];
        };
        match self {
            Provider::Claude => parse_claude(&v),
            Provider::Codex => parse_codex(&v),
            Provider::Opencode => parse_opencode(&v),
        }
    }
}

fn str_at<'a>(v: &'a Value, path: &[&str]) -> Option<&'a str> {
    let mut cur = v;
    for k in path {
        cur = cur.get(k)?;
    }
    cur.as_str()
}

fn parse_claude(v: &Value) -> Vec<AgentEvent> {
    let mut out = vec![];
    match v.get("type").and_then(Value::as_str) {
        Some("system") if v.get("subtype").and_then(Value::as_str) == Some("init") => {
            if let Some(id) = v.get("session_id").and_then(Value::as_str) {
                out.push(AgentEvent::Started {
                    provider_session_id: id.to_string(),
                });
            }
            let list = |key: &str| -> Vec<String> {
                v.get(key)
                    .and_then(Value::as_array)
                    .map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect())
                    .unwrap_or_default()
            };
            let skills = list("skills");
            let commands = list("slash_commands");
            let mcp_servers: Vec<McpStatus> = v
                .get("mcp_servers")
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .filter_map(|s| {
                            Some(McpStatus {
                                name: s.get("name")?.as_str()?.to_string(),
                                status: s
                                    .get("status")
                                    .and_then(Value::as_str)
                                    .unwrap_or("unknown")
                                    .to_string(),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();
            // Tool names are namespaced `mcp__<server>__<tool>`, which is the
            // only way to tell an MCP tool from a built-in one.
            let mcp_tools: Vec<String> = list("tools")
                .into_iter()
                .filter(|t| t.starts_with("mcp__"))
                .collect();

            if !skills.is_empty()
                || !commands.is_empty()
                || !mcp_servers.is_empty()
                || !mcp_tools.is_empty()
            {
                out.push(AgentEvent::Capabilities {
                    skills,
                    commands,
                    mcp_servers,
                    mcp_tools,
                });
            }
        }
        // The API is overloaded and the CLI is backing off. These arrive with
        // delays up to ~40s, so silence here reads as a hung agent.
        Some("system") if v.get("subtype").and_then(Value::as_str) == Some("api_retry") => {
            let attempt = v.get("attempt").and_then(Value::as_u64).unwrap_or(0);
            let max = v.get("max_retries").and_then(Value::as_u64).unwrap_or(0);
            let reason = v
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("api error")
                .to_string();
            let delay = v.get("retry_delay_ms").and_then(Value::as_u64).unwrap_or(0);
            out.push(AgentEvent::Notice {
                label: format!("retry {attempt}/{max}"),
                detail: format!(
                    "{reason} — retrying in {:.1}s (attempt {attempt} of {max})",
                    delay as f64 / 1000.0
                ),
            });
        }
        Some("system") if v.get("subtype").and_then(Value::as_str) == Some("status") => {
            if let Some(status) = v.get("status").and_then(Value::as_str) {
                out.push(AgentEvent::Notice {
                    label: status.to_string(),
                    detail: String::new(),
                });
            }
        }
        // Real token-level streaming. Text comes from here...
        Some("stream_event") => {
            if str_at(v, &["event", "type"]) == Some("content_block_delta") {
                if let Some(t) = str_at(v, &["event", "delta", "text"]) {
                    out.push(AgentEvent::TextDelta {
                        text: t.to_string(),
                    });
                }
            }
        }
        // ...so from the assembled message we only take tool calls, or the
        // text if partial streaming wasn't available.
        Some("assistant") => {
            if let Some(blocks) = v
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(Value::as_array)
            {
                for b in blocks {
                    if b.get("type").and_then(Value::as_str) == Some("tool_use") {
                        let name = b
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or("tool")
                            .to_string();
                        let empty = Value::Null;
                        let input = b.get("input").unwrap_or(&empty);
                        // Shell commands hide their paths in a string; the
                        // structured tools name theirs outright.
                        let command = input.get("command").and_then(Value::as_str);
                        let paths = match command {
                            Some(cmd) => bash_paths(cmd),
                            None => tool_paths(input, is_write_tool(&name)),
                        };
                        out.push(AgentEvent::ToolCall {
                            detail: summarize_tool_input(input),
                            paths,
                            name,
                        });
                    }
                }
            }
        }
        Some("result") => {
            let is_error = v.get("is_error").and_then(Value::as_bool).unwrap_or(false);
            let text = v
                .get("result")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            if is_error {
                out.push(AgentEvent::Failed {
                    message: if text.is_empty() {
                        "turn failed".into()
                    } else {
                        text
                    },
                });
            } else {
                out.push(AgentEvent::Result {
                    text,
                    cost_usd: v.get("total_cost_usd").and_then(Value::as_f64),
                    input_tokens: v
                        .get("usage")
                        .and_then(|u| u.get("input_tokens"))
                        .and_then(Value::as_u64),
                    output_tokens: v
                        .get("usage")
                        .and_then(|u| u.get("output_tokens"))
                        .and_then(Value::as_u64),
                    // The prompt this turn actually carried. Claude reports the
                    // cached part separately and `input_tokens` counts only what
                    // was not cached, so summing the three is the only way to
                    // learn how full the window is.
                    context_tokens: sum_tokens(
                        v.get("usage"),
                        &[
                            "input_tokens",
                            "cache_creation_input_tokens",
                            "cache_read_input_tokens",
                        ],
                    ),
                });
            }
        }
        _ => {}
    }
    out
}

fn parse_codex(v: &Value) -> Vec<AgentEvent> {
    let mut out = vec![];
    match v.get("type").and_then(Value::as_str) {
        Some("thread.started") => {
            if let Some(id) = v.get("thread_id").and_then(Value::as_str) {
                out.push(AgentEvent::Started {
                    provider_session_id: id.to_string(),
                });
            }
        }
        Some("item.completed") | Some("item.started") => {
            let item = v.get("item").unwrap_or(&Value::Null);
            match item.get("type").and_then(Value::as_str) {
                Some("agent_message") if v["type"] == "item.completed" => {
                    if let Some(t) = item.get("text").or_else(|| item.get("message")).and_then(Value::as_str) {
                        out.push(AgentEvent::TextDelta {
                            text: t.to_string(),
                        });
                    }
                }
                Some("command_execution") if v["type"] == "item.started" => {
                    let cmd = item.get("command").and_then(Value::as_str).unwrap_or_default();
                    out.push(AgentEvent::ToolCall {
                        name: "bash".into(),
                        detail: cmd.to_string(),
                        paths: bash_paths(cmd),
                    });
                }
                Some(other) if v["type"] == "item.started" => {
                    out.push(AgentEvent::ToolCall {
                        name: other.to_string(),
                        detail: String::new(),
                        paths: tool_paths(item, false),
                    });
                }
                _ => {}
            }
        }
        Some("turn.completed") => {
            out.push(AgentEvent::Result {
                text: String::new(),
                cost_usd: None,
                input_tokens: v
                    .get("usage")
                    .and_then(|u| u.get("input_tokens"))
                    .and_then(Value::as_u64),
                output_tokens: v
                    .get("usage")
                    .and_then(|u| u.get("output_tokens"))
                    .and_then(Value::as_u64),
                // Codex counts cached tokens inside `input_tokens` and reports
                // `cached_input_tokens` as a subset of it, so adding the two
                // would double-count the cached half.
                context_tokens: v
                    .get("usage")
                    .and_then(|u| u.get("input_tokens"))
                    .and_then(Value::as_u64),
            });
        }
        Some("turn.failed") => out.push(AgentEvent::Failed {
            message: str_at(v, &["error", "message"])
                .unwrap_or("turn failed")
                .to_string(),
        }),
        Some("error") => out.push(AgentEvent::Failed {
            message: v
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("error")
                .to_string(),
        }),
        _ => {}
    }
    out
}

fn parse_opencode(v: &Value) -> Vec<AgentEvent> {
    let mut out = vec![];
    if let Some(id) = v.get("sessionID").and_then(Value::as_str) {
        out.push(AgentEvent::Started {
            provider_session_id: id.to_string(),
        });
    }
    match v.get("type").and_then(Value::as_str) {
        Some("error") => out.push(AgentEvent::Failed {
            message: str_at(v, &["error", "data", "message"])
                .or_else(|| str_at(v, &["error", "message"]))
                .unwrap_or("error")
                .to_string(),
        }),
        Some("text") => {
            if let Some(t) = v.get("text").and_then(Value::as_str) {
                out.push(AgentEvent::TextDelta {
                    text: t.to_string(),
                });
            }
        }
        Some("tool") => {
            let name = v
                .get("tool")
                .and_then(Value::as_str)
                .unwrap_or("tool")
                .to_string();
            out.push(AgentEvent::ToolCall {
                detail: String::new(),
                paths: tool_paths(v, is_write_tool(&name)),
                name,
            })
        }
        Some("step-finish") | Some("finish") => out.push(AgentEvent::Result {
            text: String::new(),
            cost_usd: v.get("cost").and_then(Value::as_f64),
            input_tokens: str_at(v, &["tokens", "input"]).and_then(|s| s.parse().ok()),
            output_tokens: str_at(v, &["tokens", "output"]).and_then(|s| s.parse().ok()),
            // opencode reports cache reads alongside the input count rather
            // than inside it, so the window holds both.
            context_tokens: match (
                str_at(v, &["tokens", "input"]).and_then(|s| s.parse::<u64>().ok()),
                str_at(v, &["tokens", "cache", "read"]).and_then(|s| s.parse::<u64>().ok()),
            ) {
                (None, None) => None,
                (a, b) => Some(a.unwrap_or(0) + b.unwrap_or(0)),
            },
        }),
        _ => {}
    }
    out
}

/// Add up the token fields that make up one prompt.
///
/// `None` when the object is missing or carries none of them — a turn that
/// reported no usage at all must not read as a turn that used no context, or a
/// meter built on this would show an empty window for a full conversation.
fn sum_tokens(usage: Option<&Value>, fields: &[&str]) -> Option<u64> {
    let usage = usage?;
    let mut total = None;
    for f in fields {
        if let Some(n) = usage.get(f).and_then(Value::as_u64) {
            total = Some(total.unwrap_or(0) + n);
        }
    }
    total
}

/// Tools whose paths the agent is changing rather than just reading.
fn is_write_tool(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "write" | "edit" | "multiedit" | "notebookedit" | "patch" | "apply_patch"
    )
}

/// Commands whose file arguments are all being modified.
const WRITE_VERBS: &[&str] = &["sed", "tee", "mv", "cp", "touch", "rm", "install", "patch"];

/// Path-looking arguments in a shell command, each marked read or write.
///
/// Agents do most of their file work through `Bash` — `cat x.ts`,
/// `sed -i '' … y.rs`, `printf … > z.txt` — so ignoring these meant a session
/// could rewrite a repo without a single file node appearing. Write-ness is
/// tracked per argument: in `cat a.md > b.md` only `b.md` is written, and
/// claiming otherwise would paint a read as a modification.
fn bash_paths(cmd: &str) -> Vec<PathTouch> {
    const KNOWN_EXT: &[&str] = &[
        "rs", "ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "toml", "yaml", "yml", "md", "mdx",
        "txt", "css", "scss", "html", "py", "rb", "go", "java", "kt", "swift", "c", "h", "cc",
        "cpp", "hpp", "cs", "php", "sh", "sql", "lock", "log", "csv", "svg", "png", "jpg", "jpeg",
        "gif", "webp", "pdf", "env", "ini", "conf", "graphql", "proto", "lua", "vue",
    ];

    let first = cmd.split_whitespace().next().unwrap_or("");
    let verb = first.rsplit('/').next().unwrap_or(first);
    let verb_writes = WRITE_VERBS.contains(&verb);

    let mut out: Vec<PathTouch> = vec![];
    // Set when the previous token was a redirect, so this one is its target.
    let mut next_is_redirect_target = false;

    for raw in cmd.split_whitespace() {
        // `>file`, `>>file`, `2>file` — the operator can be glued to the target.
        let redirect_here = raw.starts_with('>')
            || raw.starts_with(">>")
            || (raw.len() > 1 && raw.starts_with(|c: char| c.is_ascii_digit()) && raw[1..].starts_with('>'))
            || raw == "&>";
        let is_bare_redirect = raw.chars().all(|c| matches!(c, '>' | '&') || c.is_ascii_digit());

        if is_bare_redirect {
            next_is_redirect_target = true;
            continue;
        }

        let write_target = next_is_redirect_target || redirect_here;
        next_is_redirect_target = false;

        let tok = raw
            .trim_start_matches(|c: char| matches!(c, '>' | '&') || c.is_ascii_digit())
            .trim_matches(|c: char| matches!(c, '\'' | '"' | '`' | '(' | ')' | ';' | ',' | '|' | '&'));

        if tok.is_empty() || tok.starts_with('-') {
            continue;
        }
        // Not paths: URLs, variables, globs, assignments, and the bit bucket.
        if tok.contains("://")
            || tok.starts_with('$')
            || tok.contains('*')
            || tok.contains('=')
            || tok == "/dev/null"
            || tok.starts_with("/dev/")
        {
            continue;
        }
        let looks_like_path = tok.contains('/')
            || tok
                .rsplit_once('.')
                .is_some_and(|(stem, ext)| !stem.is_empty() && KNOWN_EXT.contains(&ext));
        if !looks_like_path || tok.ends_with('/') {
            continue;
        }

        let path = tok.to_string();
        if out.iter().any(|t| t.path == path) {
            continue;
        }
        out.push(PathTouch {
            write: write_target || verb_writes,
            path,
        });
        // A single command touching a dozen files would bury the canvas.
        if out.len() >= 4 {
            break;
        }
    }
    out
}

/// File paths mentioned in a tool's input. These become file nodes on the
/// canvas, so only take keys that really are paths — never a bare `command`.
fn tool_paths(input: &Value, write: bool) -> Vec<PathTouch> {
    let mut out: Vec<String> = vec![];
    for key in ["file_path", "path", "notebook_path", "filePath"] {
        if let Some(s) = input.get(key).and_then(Value::as_str) {
            if !s.is_empty() {
                out.push(s.to_string());
            }
        }
    }
    if let Some(arr) = input.get("file_paths").and_then(Value::as_array) {
        out.extend(arr.iter().filter_map(Value::as_str).map(str::to_string));
    }
    out.dedup();
    out.into_iter().map(|path| PathTouch { path, write }).collect()
}

fn summarize_tool_input(input: &Value) -> String {
    for key in ["file_path", "command", "pattern", "path", "url", "prompt"] {
        if let Some(s) = input.get(key).and_then(Value::as_str) {
            return s.chars().take(120).collect();
        }
    }
    String::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Real lines captured from `claude -p --output-format stream-json`.
    #[test]
    fn claude_init_yields_session_id() {
        let line = r#"{"type":"system","subtype":"init","session_id":"e04fae1b-41cc-45fb-a87f-3be09606c463","model":"claude-opus-5"}"#;
        match Provider::Claude.parse_line(line).as_slice() {
            [AgentEvent::Started { provider_session_id }] => {
                assert_eq!(provider_session_id, "e04fae1b-41cc-45fb-a87f-3be09606c463")
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    /// The user's own skills — including plugin ones — arrive in the startup
    /// event, so Canvastrator never has to guess what a session can do.
    #[test]
    fn claude_init_reports_the_sessions_skills() {
        let line = r#"{"type":"system","subtype":"init","session_id":"s1","skills":["dataviz","stripe:stripe-docs"],"slash_commands":["init","review"]}"#;
        let events = Provider::Claude.parse_line(line);
        assert!(matches!(events[0], AgentEvent::Started { .. }));
        match &events[1] {
            AgentEvent::Capabilities { skills, commands, .. } => {
                assert_eq!(skills, &["dataviz".to_string(), "stripe:stripe-docs".to_string()]);
                assert_eq!(commands, &["init".to_string(), "review".to_string()]);
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    /// MCP tools are namespaced; built-ins are not. That prefix is the only
    /// signal distinguishing them in the tool list.
    #[test]
    fn claude_init_reports_mcp_servers_and_their_tools() {
        let line = r#"{"type":"system","subtype":"init","session_id":"s1","mcp_servers":[{"name":"flowiki","status":"connected"},{"name":"paper","status":"failed"}],"tools":["Bash","Read","mcp__flowiki__search","mcp__pencil__get_screenshot"]}"#;
        match Provider::Claude.parse_line(line).as_slice() {
            [AgentEvent::Started { .. }, AgentEvent::Capabilities { mcp_servers, mcp_tools, .. }] => {
                assert_eq!(mcp_servers.len(), 2);
                assert_eq!(mcp_servers[1].status, "failed");
                assert_eq!(mcp_tools, &["mcp__flowiki__search".to_string(), "mcp__pencil__get_screenshot".to_string()]);
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn an_init_without_skills_reports_no_capabilities() {
        let line = r#"{"type":"system","subtype":"init","session_id":"s1"}"#;
        let events = Provider::Claude.parse_line(line);
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], AgentEvent::Started { .. }));
    }

    #[test]
    fn claude_text_comes_from_stream_events_only() {
        let delta = r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"hello"}}}"#;
        match Provider::Claude.parse_line(delta).as_slice() {
            [AgentEvent::TextDelta { text }] => assert_eq!(text, "hello"),
            other => panic!("unexpected: {other:?}"),
        }

        // The assembled message must NOT re-emit that text, or it doubles.
        let assembled = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"hello"}]}}"#;
        assert!(Provider::Claude.parse_line(assembled).is_empty());
    }

    #[test]
    fn claude_assistant_yields_tool_calls_with_paths() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"/a/b.rs"}}]}}"#;
        match Provider::Claude.parse_line(line).as_slice() {
            [AgentEvent::ToolCall { name, detail, paths }] => {
                assert_eq!(name, "Read");
                assert_eq!(detail, "/a/b.rs");
                assert_eq!(paths.len(), 1);
                assert_eq!(paths[0].path, "/a/b.rs");
                assert!(!paths[0].write, "Read must not be marked as a write");
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn write_tools_are_flagged_as_writes() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/a/b.rs"}}]}}"#;
        match Provider::Claude.parse_line(line).as_slice() {
            [AgentEvent::ToolCall { paths, .. }] => {
                assert_eq!(paths.len(), 1);
                assert!(paths[0].write);
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    /// A shell command is not a path — spawning a file node for it would
    /// litter the canvas with garbage like "npm test".
    /// A command with no file arguments must stay off the canvas.
    fn reads(cmd: &str) -> Vec<String> {
        bash_paths(cmd).into_iter().filter(|t| !t.write).map(|t| t.path).collect()
    }
    fn writes(cmd: &str) -> Vec<String> {
        bash_paths(cmd).into_iter().filter(|t| t.write).map(|t| t.path).collect()
    }

    #[test]
    fn commands_without_paths_produce_no_file_nodes() {
        for cmd in ["npm test", "cargo build --release", "git status", "ls -la", "bun run lint"] {
            assert!(bash_paths(cmd).is_empty(), "{cmd} -> {:?}", bash_paths(cmd));
        }
    }

    /// The bug this pins: an agent doing its file work through `Bash` rewrote
    /// files without a single file node appearing.
    #[test]
    fn bash_file_arguments_become_file_nodes() {
        assert_eq!(reads("cat notes.md"), vec!["notes.md"]);
        assert_eq!(reads("cat src/lib/store.ts"), vec!["src/lib/store.ts"]);
        assert_eq!(writes("sed -i '' '1s/.*/# Edited/' notes.md"), vec!["notes.md"]);
        assert_eq!(writes("printf 'new' > fresh.txt"), vec!["fresh.txt"]);
    }

    /// The bug this pins: `write` was per-command, so a command that read one
    /// file and wrote another marked both as modified — painting a file the
    /// agent only looked at with the green "changed" edge.
    #[test]
    fn write_intent_is_tracked_per_path_not_per_command() {
        assert_eq!(reads("cat a.md > b.md"), vec!["a.md"]);
        assert_eq!(writes("cat a.md > b.md"), vec!["b.md"]);
        assert_eq!(writes("cat src/x.ts >> dist/out.ts"), vec!["dist/out.ts"]);
    }

    /// `2>/dev/null` is not a file the user cares about, and its presence must
    /// not mark the real arguments as written.
    #[test]
    fn redirects_to_dev_null_are_not_files() {
        let touched = bash_paths("ls README.md package.json 2>/dev/null");
        let names: Vec<_> = touched.iter().map(|t| t.path.as_str()).collect();
        assert!(!names.contains(&"/dev/null"), "got {names:?}");
        assert!(!names.iter().any(|n| n.contains("dev/null")), "got {names:?}");
        assert!(
            touched.iter().all(|t| !t.write),
            "listing files is not writing them: {touched:?}"
        );
    }

    #[test]
    fn bash_paths_skip_flags_urls_and_globs() {
        assert!(bash_paths("curl https://example.com/a.json").is_empty());
        assert!(bash_paths("rg --files-with-matches -g '*.ts'").is_empty());
        assert!(bash_paths("FOO=bar.ts make").is_empty());
    }

    #[test]
    fn write_verbs_mark_all_their_arguments() {
        assert_eq!(writes("mv a.ts b.ts"), vec!["a.ts", "b.ts"]);
        assert_eq!(writes("touch new.ts"), vec!["new.ts"]);
        assert!(writes("rg foo src/lib/store.ts").is_empty());
    }

    #[test]
    fn bash_tool_call_carries_paths_and_write_intent() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"sed -i '' 's/a/b/' src/lib/store.ts"}}]}}"#;
        match Provider::Claude.parse_line(line).as_slice() {
            [AgentEvent::ToolCall { paths, .. }] => {
                assert_eq!(paths.len(), 1);
                assert_eq!(paths[0].path, "src/lib/store.ts");
                assert!(paths[0].write);
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn a_single_command_cannot_flood_the_canvas() {
        let many = "cat a.ts b.ts c.ts d.ts e.ts f.ts g.ts";
        assert_eq!(bash_paths(many).len(), 4);
    }

    #[test]
    fn claude_result_carries_cost_and_usage() {
        let line = r#"{"type":"result","subtype":"success","is_error":false,"result":"pong","total_cost_usd":0.1,"usage":{"input_tokens":2,"output_tokens":6}}"#;
        match Provider::Claude.parse_line(line).as_slice() {
            [AgentEvent::Result { text, cost_usd, input_tokens, output_tokens, .. }] => {
                assert_eq!(text, "pong");
                assert_eq!(*cost_usd, Some(0.1));
                assert_eq!(*input_tokens, Some(2));
                assert_eq!(*output_tokens, Some(6));
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    /// What a context meter needs, and why it is not `input_tokens`.
    ///
    /// On a cached conversation Claude bills a few hundred fresh tokens while
    /// the prompt it actually read is the whole history. A meter built on the
    /// billed figure would show an almost-empty window on a conversation about
    /// to overflow — the one moment it exists to warn about.
    #[test]
    fn claude_context_tokens_count_the_cached_prompt_too() {
        let line = r#"{"type":"result","subtype":"success","is_error":false,"result":"ok","usage":{"input_tokens":120,"cache_creation_input_tokens":4000,"cache_read_input_tokens":90000,"output_tokens":50}}"#;
        match Provider::Claude.parse_line(line).as_slice() {
            [AgentEvent::Result { input_tokens, context_tokens, .. }] => {
                assert_eq!(*input_tokens, Some(120));
                assert_eq!(*context_tokens, Some(94_120));
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    /// A turn that reported no usage at all must not read as a turn that used
    /// no context — an empty window and an unknown one are different states,
    /// and only one of them is safe to draw as empty.
    #[test]
    fn claude_context_tokens_absent_when_usage_is() {
        let line = r#"{"type":"result","subtype":"success","is_error":false,"result":"ok","total_cost_usd":0.1}"#;
        match Provider::Claude.parse_line(line).as_slice() {
            [AgentEvent::Result { context_tokens, .. }] => assert_eq!(*context_tokens, None),
            other => panic!("unexpected: {other:?}"),
        }
    }

    /// Codex reports its cached tokens as a subset of `input_tokens`, so the
    /// window is the input count alone. Adding the cached figure would show a
    /// window twice as full as it is.
    #[test]
    fn codex_context_tokens_do_not_double_count_the_cache() {
        let line = r#"{"type":"turn.completed","usage":{"input_tokens":8000,"cached_input_tokens":6000,"output_tokens":200}}"#;
        match Provider::Codex.parse_line(line).as_slice() {
            [AgentEvent::Result { context_tokens, .. }] => assert_eq!(*context_tokens, Some(8000)),
            other => panic!("unexpected: {other:?}"),
        }
    }

    /// The bug this pins: these events were dropped, so a turn stuck behind
    /// ~40s API backoff looked identical to a hung agent, and users killed it.
    #[test]
    fn claude_api_retry_surfaces_as_a_notice() {
        let line = r#"{"type":"system","subtype":"api_retry","attempt":7,"max_retries":10,"retry_delay_ms":37688,"error_status":529,"error":"overloaded"}"#;
        match Provider::Claude.parse_line(line).as_slice() {
            [AgentEvent::Notice { label, detail }] => {
                assert_eq!(label, "retry 7/10");
                assert!(detail.contains("overloaded"), "got {detail}");
                assert!(detail.contains("37.7s"), "got {detail}");
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn claude_status_surfaces_as_a_notice() {
        let line = r#"{"type":"system","subtype":"status","status":"requesting"}"#;
        match Provider::Claude.parse_line(line).as_slice() {
            [AgentEvent::Notice { label, .. }] => assert_eq!(label, "requesting"),
            other => panic!("unexpected: {other:?}"),
        }
    }

    /// init must still be the only thing that yields a session id.
    #[test]
    fn other_system_subtypes_do_not_claim_to_start_a_session() {
        for line in [
            r#"{"type":"system","subtype":"api_retry","attempt":1,"max_retries":10}"#,
            r#"{"type":"system","subtype":"status","status":"requesting"}"#,
        ] {
            let events = Provider::Claude.parse_line(line);
            assert!(!events.iter().any(|e| matches!(e, AgentEvent::Started { .. })));
        }
    }

    #[test]
    fn claude_error_result_becomes_failure() {
        let line = r#"{"type":"result","is_error":true,"result":"credit balance too low"}"#;
        assert!(matches!(
            Provider::Claude.parse_line(line).as_slice(),
            [AgentEvent::Failed { .. }]
        ));
    }

    /// Real line captured from `codex exec --json`.
    #[test]
    fn codex_thread_started_yields_session_id() {
        let line = r#"{"type":"thread.started","thread_id":"01a013a7-480a-74a2-8685-66dcbb011fc8"}"#;
        match Provider::Codex.parse_line(line).as_slice() {
            [AgentEvent::Started { provider_session_id }] => {
                assert_eq!(provider_session_id, "01a013a7-480a-74a2-8685-66dcbb011fc8")
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn codex_turn_failed_surfaces_the_reason() {
        let line = r#"{"type":"turn.failed","error":{"message":"Failed to refresh token: 401 Unauthorized"}}"#;
        match Provider::Codex.parse_line(line).as_slice() {
            [AgentEvent::Failed { message }] => assert!(message.contains("401")),
            other => panic!("unexpected: {other:?}"),
        }
    }

    /// Real line captured from `opencode run --format json`.
    #[test]
    fn opencode_error_surfaces_provider_message() {
        let line = r#"{"type":"error","sessionID":"ses_fec58805","error":{"name":"APIError","data":{"message":"Insufficient balance."}}}"#;
        let events = Provider::Opencode.parse_line(line);
        assert!(matches!(events[0], AgentEvent::Started { .. }));
        match &events[1] {
            AgentEvent::Failed { message } => assert!(message.contains("Insufficient balance")),
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn unknown_and_malformed_lines_are_ignored() {
        for p in [Provider::Claude, Provider::Codex, Provider::Opencode] {
            assert!(p.parse_line("").is_empty());
            assert!(p.parse_line("not json at all").is_empty());
            assert!(p.parse_line(r#"{"type":"some_future_event"}"#).is_empty());
        }
    }

    /// The bug this guards: without a permission mode, a `--print` session
    /// cannot answer a prompt, so every edit is silently refused.
    #[test]
    fn auto_mode_authorises_edits_and_commands_on_every_provider() {
        let c = Provider::Claude.args(&TurnArgs { prompt: "hi", perm: Permission::Auto, ..Default::default() });
        // Not `acceptEdits` — that denies `cargo build` and friends outright.
        assert!(c.windows(2).any(|w| w == ["--permission-mode", "auto"]));
        assert!(!c.iter().any(|a| a == "acceptEdits"));

        let x = Provider::Codex.args(&TurnArgs { prompt: "hi", perm: Permission::Auto, ..Default::default() });
        assert!(x.iter().any(|a| a == "--full-auto"));
        assert!(!x.iter().any(|a| a == "--sandbox"), "--full-auto already sets the sandbox");

        let o = Provider::Opencode.args(&TurnArgs { prompt: "hi", perm: Permission::Auto, ..Default::default() });
        assert!(o.iter().any(|a| a == "--auto"));
    }

    #[test]
    fn plan_mode_withholds_write_access() {
        let c = Provider::Claude.args(&TurnArgs { prompt: "hi", perm: Permission::Plan, ..Default::default() });
        assert!(c.windows(2).any(|w| w == ["--permission-mode", "plan"]));

        let x = Provider::Codex.args(&TurnArgs { prompt: "hi", perm: Permission::Plan, ..Default::default() });
        assert!(x.windows(2).any(|w| w == ["--sandbox", "read-only"]));

        let o = Provider::Opencode.args(&TurnArgs { prompt: "hi", perm: Permission::Plan, ..Default::default() });
        assert!(!o.iter().any(|a| a == "--auto"));
    }

    #[test]
    fn full_mode_is_distinct_from_edit() {
        let c = Provider::Claude.args(&TurnArgs { prompt: "hi", perm: Permission::Full, ..Default::default() });
        assert!(c.windows(2).any(|w| w == ["--permission-mode", "bypassPermissions"]));

        let x = Provider::Codex.args(&TurnArgs { prompt: "hi", perm: Permission::Full, ..Default::default() });
        assert!(x.iter().any(|a| a == "--dangerously-bypass-approvals-and-sandbox"));
    }

    #[test]
    fn attached_mcp_servers_are_passed_per_invocation() {
        let cfg = r#"{"mcpServers":{"flowiki":{"type":"http"}}}"#;
        let a = Provider::Claude.args(&TurnArgs { prompt: "hi", perm: Permission::Auto, mcp_config: Some(cfg), ..Default::default() });
        assert!(a.windows(2).any(|w| w == ["--mcp-config", cfg]));
        // Additive: the user's own servers must survive.
        assert!(!a.iter().any(|x| x == "--strict-mcp-config"));
    }

    #[test]
    fn no_attached_servers_means_no_mcp_flag() {
        let a = Provider::Claude.args(&TurnArgs { prompt: "hi", perm: Permission::Auto, ..Default::default() });
        assert!(!a.iter().any(|x| x == "--mcp-config"));
    }

    #[test]
    fn resume_flag_is_provider_specific() {
        let a = Provider::Claude.args(&TurnArgs { prompt: "hi", resume: Some("sid"), perm: Permission::Auto, ..Default::default() });
        assert!(a.windows(2).any(|w| w == ["--resume", "sid"]));
        // A fresh claude turn must pin its own session id so we can resume it.
        let fresh = Provider::Claude.args(&TurnArgs { prompt: "hi", perm: Permission::Auto, ..Default::default() });
        assert!(fresh.iter().any(|x| x == "--session-id"));

        let c = Provider::Codex.args(&TurnArgs { prompt: "hi", resume: Some("thread"), perm: Permission::Auto, ..Default::default() });
        assert!(c.windows(2).any(|w| w == ["resume", "thread"]));

        let o = Provider::Opencode.args(&TurnArgs { prompt: "hi", resume: Some("ses"), perm: Permission::Auto, ..Default::default() });
        assert!(o.windows(2).any(|w| w == ["--session", "ses"]));
    }

    #[test]
    fn effort_is_passed_through_per_provider_and_omitted_when_unset() {
        let c = Provider::Claude.args(&TurnArgs { prompt: "hi", perm: Permission::Auto, effort: Some(Effort::Xhigh), ..Default::default() });
        assert!(c.windows(2).any(|w| w == ["--effort", "xhigh"]));

        // Codex has no rung above `high`, so the top two clamp onto it.
        let x = Provider::Codex.args(&TurnArgs { prompt: "hi", perm: Permission::Auto, effort: Some(Effort::Max), ..Default::default() });
        assert!(x
            .windows(2)
            .any(|w| w == ["--config", "model_reasoning_effort=\"high\""]));

        let o = Provider::Opencode.args(&TurnArgs { prompt: "hi", perm: Permission::Auto, effort: Some(Effort::Low), ..Default::default() });
        assert!(o.windows(2).any(|w| w == ["--variant", "low"]));

        // Unset must mean "the CLI's own default", not a level we chose.
        for p in [Provider::Claude, Provider::Codex, Provider::Opencode] {
            let a = p.args(&TurnArgs { prompt: "hi", perm: Permission::Auto, ..Default::default() });
            assert!(!a.iter().any(|x| x == "--effort" || x == "--variant"));
            assert!(!a.iter().any(|x| x.contains("model_reasoning_effort")));
        }
    }
    fn imgs() -> Vec<String> {
        vec!["/tmp/gridterm/s1/a.png".into(), "/tmp/gridterm/s1/b.png".into()]
    }

    #[test]
    fn codex_and_opencode_fence_the_prompt_off_from_the_variadic_image_flag() {
        // Without the `--`, the image flag eats the prompt, codex blocks on the
        // stdin we closed, and the turn hangs forever.
        let x = Provider::Codex.args(&TurnArgs { prompt: "hi", perm: Permission::Auto, images: &imgs(), ..Default::default() });
        let i = x.iter().position(|a| a == "-i").expect("-i");
        assert_eq!(&x[i..], &["-i", "/tmp/gridterm/s1/a.png", "/tmp/gridterm/s1/b.png", "--", "hi"]);

        let o = Provider::Opencode.args(&TurnArgs { prompt: "hi", perm: Permission::Auto, images: &imgs(), ..Default::default() });
        let f = o.iter().position(|a| a == "-f").expect("-f");
        assert_eq!(&o[f..], &["-f", "/tmp/gridterm/s1/a.png", "/tmp/gridterm/s1/b.png", "--", "hi"]);
    }

    /// `codex exec resume` takes neither `-i` nor a `--`; passing either is an
    /// unexpected-argument error and the turn fails outright. The paths go in
    /// the prompt on that branch instead.
    #[test]
    fn a_resumed_codex_turn_names_the_images_in_the_prompt_rather_than_passing_minus_i() {
        let x = Provider::Codex.args(&TurnArgs { prompt: "hi", resume: Some("thread"), perm: Permission::Auto, images: &imgs(), ..Default::default() });
        assert!(!x.iter().any(|a| a == "-i"), "{x:?}");
        assert!(!x.iter().any(|a| a == "--"), "{x:?}");
        let prompt = x.last().unwrap();
        assert!(prompt.starts_with("hi"));
        for p in imgs() {
            assert!(prompt.contains(&p), "{prompt} is missing {p}");
        }
        // A fresh turn still uses the flag, which is the better route.
        let fresh = Provider::Codex.args(&TurnArgs { prompt: "hi", perm: Permission::Auto, images: &imgs(), ..Default::default() });
        assert!(fresh.iter().any(|a| a == "-i"));
        assert_eq!(fresh.last().unwrap(), "hi");
    }

    #[test]
    fn claude_grants_the_image_directory_once_and_names_the_paths_in_the_prompt() {
        let mut with_node = imgs();
        with_node.push("/Users/x/proj/shot.png".into());
        let c = Provider::Claude.args(&TurnArgs { prompt: "hi", perm: Permission::Auto, images: &with_node, ..Default::default() });

        // One `--add-dir`, each distinct directory once.
        assert_eq!(c.iter().filter(|a| *a == "--add-dir").count(), 1);
        let d = c.iter().position(|a| a == "--add-dir").unwrap();
        assert_eq!(&c[d..d + 3], &["--add-dir", "/tmp/gridterm/s1", "/Users/x/proj"]);
        // `--add-dir` is variadic too, so it must not be the last flag.
        assert_eq!(c[d + 3], "--permission-mode");

        // The prompt is the trailing positional, and carries the paths, since
        // claude only reads an image the prompt mentions.
        let prompt = c.last().unwrap();
        assert!(prompt.starts_with("hi"));
        for p in &with_node {
            assert!(prompt.contains(p.as_str()), "{prompt} is missing {p}");
        }
    }

    #[test]
    fn no_images_leaves_every_provider_exactly_as_it_was() {
        for p in [Provider::Claude, Provider::Codex, Provider::Opencode] {
            let a = p.args(&TurnArgs { prompt: "hi", perm: Permission::Auto, ..Default::default() });
            assert_eq!(a.last().unwrap(), "hi");
            assert!(!a.iter().any(|x| x == "--" || x == "-i" || x == "-f" || x == "--add-dir"));
        }
    }
}
