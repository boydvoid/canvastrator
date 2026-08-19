use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};

use crate::env;
use crate::mcp::McpServer;
use crate::event::{AgentEvent, SessionEvent};
use crate::providers::{Effort, Permission, Provider};

pub const EVENT_CHANNEL: &str = "session://event";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnRequest {
    pub session_id: String,
    pub provider: Provider,
    pub cwd: String,
    pub prompt: String,
    /// Provider-side conversation id from a previous turn, if any.
    pub resume: Option<String>,
    pub model: Option<String>,
    /// Reasoning effort, or None for the CLI's own default.
    #[serde(default)]
    pub effort: Option<Effort>,
    #[serde(default)]
    pub permission: Permission,
    /// MCP servers attached to this session on the canvas. Passed per
    /// invocation, so the user's own config is never touched.
    #[serde(default)]
    pub mcp_servers: Vec<McpServer>,
}

#[derive(Default)]
pub struct SessionRegistry {
    /// Live child processes, keyed by session id. One turn in flight per session.
    running: Mutex<HashMap<String, Arc<Mutex<Option<Child>>>>>,
    seq: AtomicU64,
}

impl SessionRegistry {
    fn next_seq(&self) -> u64 {
        self.seq.fetch_add(1, Ordering::Relaxed)
    }

    pub fn is_busy(&self, session_id: &str) -> bool {
        self.running.lock().unwrap().contains_key(session_id)
    }
}

fn emit(app: &AppHandle, reg: &SessionRegistry, session_id: &str, turn_id: &str, event: AgentEvent) {
    let payload = SessionEvent {
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        seq: reg.next_seq(),
        event,
    };
    let _ = app.emit(EVENT_CHANNEL, payload);
}

/// Run one turn. Spawns the CLI, streams its JSONL to the frontend, and
/// resolves when the process exits.
pub async fn run_turn(
    app: AppHandle,
    reg: Arc<SessionRegistry>,
    req: TurnRequest,
) -> Result<String, String> {
    if reg.is_busy(&req.session_id) {
        return Err("That agent is still working on its last message. Wait for it to finish, or press stop.".into());
    }

    let turn_id = uuid::Uuid::new_v4().to_string();
    let mcp_config = crate::mcp::config_json(&req.mcp_servers);
    let args = req.provider.args(
        &req.prompt,
        req.resume.as_deref(),
        req.model.as_deref(),
        req.permission,
        req.effort,
        mcp_config.as_deref(),
    );

    if !std::path::Path::new(&req.cwd).is_dir() {
        return Err(format!("working directory does not exist: {}", req.cwd));
    }

    // Spawn by absolute path, not bare name: a bundled app's PATH doesn't
    // include ~/.local/bin, so `Command::new("claude")` fails from Finder even
    // though it works in `tauri dev`.
    let exe = env::which(req.provider.binary()).ok_or_else(|| {
        format!(
            "`{}` was not found on your PATH",
            req.provider.binary()
        )
    })?;

    log::info!(
        "turn {turn_id}: {exe} {:?} (cwd {}, {:?})",
        args,
        req.cwd,
        req.permission
    );

    let mut child = Command::new(&exe)
        .args(&args)
        .current_dir(&req.cwd)
        // The agent needs the user's real PATH to run cargo, bun, git, make…
        .env("PATH", env::user_path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("failed to launch `{}`: {e}", req.provider.binary()))?;

    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");

    let slot = Arc::new(Mutex::new(Some(child)));
    reg.running
        .lock()
        .unwrap()
        .insert(req.session_id.clone(), slot.clone());

    // stderr is where these CLIs put crashes and auth failures — worth keeping.
    let err_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        let mut collected = String::new();
        while let Ok(Some(line)) = lines.next_line().await {
            if collected.len() < 4000 {
                collected.push_str(&line);
                collected.push('\n');
            }
        }
        collected
    });

    let mut lines = BufReader::new(stdout).lines();
    let mut saw_terminal = false;
    while let Ok(Some(line)) = lines.next_line().await {
        for ev in req.provider.parse_line(&line) {
            if matches!(ev, AgentEvent::Result { .. } | AgentEvent::Failed { .. }) {
                saw_terminal = true;
            }
            // Logged because a missing file node is otherwise invisible: this
            // says whether the tool reported a path we could turn into one.
            if let AgentEvent::ToolCall { name, paths, .. } = &ev {
                if !paths.is_empty() {
                    log::info!("tool {name} touched {paths:?}");
                }
            }
            emit(&app, &reg, &req.session_id, &turn_id, ev);
        }
    }

    // Distinguish "we killed it" from "it exited on its own": reporting our
    // own interrupt as an exit code made a user-initiated stop and a genuine
    // crash indistinguishable in the UI.
    let interrupted;
    let status = {
        let child = slot.lock().unwrap().take();
        match child {
            Some(mut c) => {
                interrupted = false;
                match c.wait().await {
                    Ok(s) => s.code().unwrap_or_else(|| {
                        #[cfg(unix)]
                        {
                            use std::os::unix::process::ExitStatusExt;
                            s.signal().map(|sig| 128 + sig).unwrap_or(-1)
                        }
                        #[cfg(not(unix))]
                        -1
                    }),
                    Err(_) => -1,
                }
            }
            None => {
                interrupted = true;
                -1
            }
        }
    };
    reg.running.lock().unwrap().remove(&req.session_id);

    let stderr_text = err_task.await.unwrap_or_default();

    log::info!(
        "turn {turn_id} finished: status={status} interrupted={interrupted} \
         terminal_event={saw_terminal} stderr={:?}",
        stderr_text.trim()
    );

    // A non-zero exit with no structured failure means the CLI died before it
    // could tell us why. stderr is the only explanation we'll get.
    if !interrupted && status != 0 && !saw_terminal {
        let msg = if stderr_text.trim().is_empty() {
            format!(
                "`{}` exited with code {status} and said nothing. \
                 Check ~/Library/Logs/com.canvastrator.app/canvastrator.log",
                req.provider.binary()
            )
        } else {
            stderr_text.trim().to_string()
        };
        emit(
            &app,
            &reg,
            &req.session_id,
            &turn_id,
            AgentEvent::Failed { message: msg },
        );
    }

    emit(
        &app,
        &reg,
        &req.session_id,
        &turn_id,
        AgentEvent::Exited { code: status },
    );
    Ok(turn_id)
}

pub fn interrupt(reg: &SessionRegistry, session_id: &str) -> Result<(), String> {
    let slot = reg
        .running
        .lock()
        .unwrap()
        .get(session_id)
        .cloned()
        .ok_or("no turn in flight")?;
    let child = slot.lock().unwrap().take();
    match child {
        Some(mut c) => {
            let _ = c.start_kill();
            Ok(())
        }
        None => Err("no turn in flight".into()),
    }
}
