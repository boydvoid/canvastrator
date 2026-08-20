//! Real terminals on the canvas.
//!
//! Agents deliberately need no PTY — the CLIs stream JSONL and resume by id,
//! which is why this app has no ANSI parsing anywhere in it. A terminal the
//! *user* types into is the opposite case: a login shell with no pty is a shell
//! that will not run `top`, will not draw a progress bar, and will tell every
//! program it hosts that it is a pipe. So this module owns the one PTY in the
//! app, and the terminal emulator lives on the frontend where the bytes are
//! already going.
//!
//! One shell per terminal node, keyed by the node's own id and outliving the
//! view that shows it: switching to another panel must not kill a build that is
//! halfway through. The shell dies with the app, which is why nothing about a
//! live terminal is written into a saved canvas.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::env;

pub const DATA_CHANNEL: &str = "terminal://data";
pub const EXIT_CHANNEL: &str = "terminal://exit";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalChunk {
    pub terminal_id: String,
    /// Raw shell output, escape codes and all — the emulator's business.
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExit {
    pub terminal_id: String,
    pub code: Option<i32>,
}

struct Terminal {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct TerminalRegistry {
    live: Mutex<HashMap<String, Terminal>>,
}

/// The shell to run, in the order a terminal should prefer them.
///
/// `$SHELL` is the user's own choice and the only answer that is ever right on
/// their machine; the fallback exists for a launchd environment that carries
/// no SHELL at all, which is the same reason `env::user_path` exists.
fn login_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
}

/// Start a shell for this terminal node, or do nothing if one is already up.
///
/// Idempotent on purpose: the view mounts and unmounts as panels are switched,
/// and every mount asks for its terminal. A second shell per switch would be a
/// process leak with a scrollback nobody sees.
#[tauri::command]
pub fn terminal_open(
    app: AppHandle,
    reg: State<'_, Arc<TerminalRegistry>>,
    terminal_id: String,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<bool, String> {
    {
        let live = reg.live.lock().map_err(|e| e.to_string())?;
        if live.contains_key(&terminal_id) {
            return Ok(false);
        }
    }

    if !std::path::Path::new(&cwd).is_dir() {
        return Err(format!("no such directory: {cwd}"));
    }

    let pty = native_pty_system();
    let pair = pty
        .openpty(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let shell = login_shell();
    let mut cmd = CommandBuilder::new(&shell);
    // Login shell: the user's profile is where their prompt, aliases and PATH
    // come from, and a terminal without them is not the terminal they know.
    cmd.arg("-l");
    cmd.cwd(&cwd);
    // The same PATH every spawned agent gets, so what works in a terminal
    // works in an agent and the other way round.
    cmd.env("PATH", env::user_path());
    // Programs ask this before they draw anything. Left unset, a shell assumes
    // the dumbest possible terminal and colour disappears.
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    // The slave is the child's end. Holding it open here would keep the pty
    // alive after the shell exits, so the reader below would never see EOF.
    drop(pair.slave);

    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    {
        let mut live = reg.live.lock().map_err(|e| e.to_string())?;
        live.insert(
            terminal_id.clone(),
            Terminal {
                master: pair.master,
                writer,
                child,
            },
        );
    }

    let pump_app = app.clone();
    let pump_id = terminal_id.clone();
    let pump_reg = Arc::clone(&reg);
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        // A read can land mid-character, and a lossy decode of half a glyph
        // puts a replacement character in the user's output permanently. The
        // tail is carried into the next read instead.
        let mut carry: Vec<u8> = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    carry.extend_from_slice(&buf[..n]);
                    let text = match std::str::from_utf8(&carry) {
                        Ok(s) => {
                            let owned = s.to_string();
                            carry.clear();
                            owned
                        }
                        Err(e) => {
                            let good = e.valid_up_to();
                            let owned = String::from_utf8_lossy(&carry[..good]).into_owned();
                            carry.drain(..good);
                            // A genuinely invalid sequence would otherwise sit
                            // in the carry for ever and stall the stream.
                            if carry.len() > 4 {
                                carry.clear();
                            }
                            owned
                        }
                    };
                    if text.is_empty() {
                        continue;
                    }
                    let _ = pump_app.emit(
                        DATA_CHANNEL,
                        TerminalChunk {
                            terminal_id: pump_id.clone(),
                            data: text,
                        },
                    );
                }
            }
        }

        // The shell is gone: drop it from the registry before announcing, so
        // that reopening the node from the exit handler starts a fresh one
        // rather than being told one is already live.
        let code = pump_reg
            .live
            .lock()
            .ok()
            .and_then(|mut live| live.remove(&pump_id))
            .and_then(|mut t| t.child.wait().ok())
            .map(|status| status.exit_code() as i32);

        let _ = pump_app.emit(
            EXIT_CHANNEL,
            TerminalExit {
                terminal_id: pump_id,
                code,
            },
        );
    });

    Ok(true)
}

/// Keystrokes, straight through. Control characters included — ⌃C is a byte.
#[tauri::command]
pub fn terminal_write(
    reg: State<'_, Arc<TerminalRegistry>>,
    terminal_id: String,
    data: String,
) -> Result<(), String> {
    let mut live = reg.live.lock().map_err(|e| e.to_string())?;
    let term = live
        .get_mut(&terminal_id)
        .ok_or_else(|| "terminal is not running".to_string())?;
    term.writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    term.writer.flush().map_err(|e| e.to_string())
}

/// Tell the shell how big its window is, so full-screen programs fit it.
#[tauri::command]
pub fn terminal_resize(
    reg: State<'_, Arc<TerminalRegistry>>,
    terminal_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let live = reg.live.lock().map_err(|e| e.to_string())?;
    let Some(term) = live.get(&terminal_id) else {
        // Resizing a terminal that has exited is not an error worth showing:
        // the view resizes on every layout pass, including the one after the
        // shell died.
        return Ok(());
    };
    term.master
        .resize(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

/// End a terminal — the node was deleted, or the user asked for a fresh shell.
#[tauri::command]
pub fn terminal_close(
    reg: State<'_, Arc<TerminalRegistry>>,
    terminal_id: String,
) -> Result<(), String> {
    let mut live = reg.live.lock().map_err(|e| e.to_string())?;
    if let Some(mut term) = live.remove(&terminal_id) {
        let _ = term.child.kill();
    }
    Ok(())
}

/// Which terminals are actually running.
///
/// A canvas restored from disk carries terminal nodes whose shells died with
/// the last run of the app. The node has no way to know that on its own, and a
/// node claiming a live shell it does not have is worse than one that says it
/// is closed.
#[tauri::command]
pub fn terminal_live(reg: State<'_, Arc<TerminalRegistry>>) -> Result<Vec<String>, String> {
    let live = reg.live.lock().map_err(|e| e.to_string())?;
    Ok(live.keys().cloned().collect())
}
