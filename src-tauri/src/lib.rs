mod canvas;
mod diff;
mod env;
mod event;
mod images;
mod library;
mod mcp;
mod migrate;
mod providers;
mod session;
mod skills;

use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use providers::Provider;
use session::{SessionRegistry, TurnRequest};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderStatus {
    provider: Provider,
    binary: String,
    available: bool,
    path: Option<String>,
}

/// Which agent CLIs actually exist on this machine. The canvas greys out the
/// ones that don't rather than failing at spawn time.
#[tauri::command]
fn detect_providers() -> Vec<ProviderStatus> {
    // Logged because a bundled app inherits a minimal PATH; when a provider
    // shows as "not installed" this line is what tells you whether resolution
    // or the install is at fault.
    log::info!("PATH in use: {}", env::user_path());
    [Provider::Claude, Provider::Codex, Provider::Opencode]
        .into_iter()
        .map(|p| {
            let path = env::which(p.binary());
            log::info!(
                "provider {} -> {}",
                p.binary(),
                path.as_deref().unwrap_or("NOT FOUND")
            );
            ProviderStatus {
                provider: p,
                binary: p.binary().to_string(),
                available: path.is_some(),
                path,
            }
        })
        .collect()
}

#[tauri::command]
async fn send_turn(
    app: AppHandle,
    reg: State<'_, Arc<SessionRegistry>>,
    req: TurnRequest,
) -> Result<String, String> {
    let reg = reg.inner().clone();
    session::run_turn(app, reg, req).await
}

#[tauri::command]
fn interrupt_session(reg: State<'_, Arc<SessionRegistry>>, session_id: String) -> Result<(), String> {
    session::interrupt(reg.inner(), &session_id)
}

#[tauri::command]
fn default_cwd() -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/".into())
}

/// Native picker. Returns None when the user cancels.
#[tauri::command]
async fn pick_path(app: AppHandle, directory: bool) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    let dialog = app.dialog().clone().file();
    if directory {
        dialog.pick_folder(move |p| { let _ = tx.send(p); });
    } else {
        dialog.pick_file(move |p| { let _ = tx.send(p); });
    }
    let picked = tokio::task::spawn_blocking(move || rx.recv().ok().flatten())
        .await
        .ok()
        .flatten()?;
    Some(picked.to_string())
}

/// Read a file for a file node: its preview and its injected context.
/// Bounded, because a node on a canvas must never pull a 200MB blob into a prompt.
#[tauri::command]
fn read_file_head(path: String, max_bytes: usize) -> Result<FilePeek, String> {
    let meta = std::fs::metadata(&path).map_err(|e| format!("{path}: {e}"))?;
    if meta.is_dir() {
        return Err(format!("{path} is a directory"));
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("{path}: {e}"))?;
    let truncated = bytes.len() > max_bytes;
    let slice = &bytes[..bytes.len().min(max_bytes)];
    match std::str::from_utf8(slice) {
        Ok(text) => Ok(FilePeek {
            text: text.to_string(),
            bytes: meta.len(),
            truncated,
            binary: false,
        }),
        // Not UTF-8: still a legitimate node, just not injectable as text.
        Err(_) => Ok(FilePeek {
            text: String::new(),
            bytes: meta.len(),
            truncated,
            binary: true,
        }),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FilePeek {
    text: String,
    bytes: u64,
    truncated: bool,
    binary: bool,
}

/// Full text of a file, for the editor. Distinct from `read_file_head`, which
/// only ever fetches a preview.
#[tauri::command]
fn read_text_file(path: String, max_bytes: usize) -> Result<TextFile, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("{path}: {e}"))?;
    let truncated = bytes.len() > max_bytes;
    let slice = &bytes[..bytes.len().min(max_bytes)];
    let text = std::str::from_utf8(slice)
        .map_err(|_| format!("{path} is not valid UTF-8"))?
        .to_string();
    Ok(TextFile {
        text,
        bytes: bytes.len() as u64,
        truncated,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TextFile {
    text: String,
    bytes: u64,
    truncated: bool,
}

/// Overwrite a file from the editor. Refuses to create new files — the editor
/// only ever edits something a node already points at.
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    if !std::path::Path::new(&path).is_file() {
        return Err(format!("{path} is not an existing file"));
    }
    std::fs::write(&path, contents).map_err(|e| format!("{path}: {e}"))
}

/// Images and other binaries, as a data-URI payload.
#[tauri::command]
fn read_binary_base64(path: String, max_bytes: usize) -> Result<BinaryFile, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("{path}: {e}"))?;
    if bytes.len() > max_bytes {
        return Err(format!(
            "{path} is {} MB — too large to preview",
            bytes.len() / 1_048_576
        ));
    }
    Ok(BinaryFile {
        base64: b64(&bytes),
        bytes: bytes.len() as u64,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BinaryFile {
    base64: String,
    bytes: u64,
}

/// Small standalone base64 encoder — not worth a dependency for one call site.
pub(crate) fn b64(input: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(T[(n >> 18 & 63) as usize] as char);
        out.push(T[(n >> 12 & 63) as usize] as char);
        out.push(if chunk.len() > 1 { T[(n >> 6 & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[(n & 63) as usize] as char } else { '=' });
    }
    out
}

/// Whether a path is an existing regular file. Used to confirm a path guessed
/// out of a shell command before it becomes a node on the canvas.
#[tauri::command]
fn file_exists(path: String) -> bool {
    std::fs::metadata(&path).map(|m| m.is_file()).unwrap_or(false)
}

/// Size and modification time of a file, or nothing when it isn't there.
///
/// For change detection on a file whose contents never pass through the app —
/// an image goes to the provider by path, so there is no text to digest, but a
/// screenshot re-saved over the same path still has to count as new.
#[tauri::command]
fn file_stamp(path: String) -> Option<FileStamp> {
    let meta = std::fs::metadata(&path).ok()?;
    if !meta.is_file() {
        return None;
    }
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Some(FileStamp {
        bytes: meta.len(),
        mtime_ms,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileStamp {
    bytes: u64,
    mtime_ms: u64,
}

/// Guard against a folder node pointing somewhere that no longer exists.
#[tauri::command]
fn dir_exists(path: String) -> bool {
    std::fs::metadata(&path).map(|m| m.is_dir()).unwrap_or(false)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            app.manage(Arc::new(SessionRegistry::default()));
            // Before anything reads the data dir: a rename must not strand the
            // user's canvases under the old bundle identifier.
            migrate::migrate_legacy_data(app.handle());
            // Session image dirs whose nodes were deleted while the app was
            // closed have nothing left to clean them up but this.
            images::sweep_stale_images();
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            detect_providers,
            send_turn,
            interrupt_session,
            default_cwd,
            pick_path,
            read_file_head,
            read_text_file,
            write_text_file,
            read_binary_base64,
            images::write_session_image,
            images::remove_session_image,
            images::clear_session_images,
            dir_exists,
            file_exists,
            file_stamp,
            canvas::list_canvases,
            canvas::load_canvas,
            canvas::save_canvas,
            canvas::delete_canvas,
            library::load_library,
            library::save_library,
            library::library_location,
            library::personas_location,
            skills::discover_skills,
            skills::list_project_files,
            diff::file_diff_base,
            mcp::discover_mcp_servers
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    #[test]
    fn base64_matches_known_vectors() {
        assert_eq!(super::b64(b""), "");
        assert_eq!(super::b64(b"f"), "Zg==");
        assert_eq!(super::b64(b"fo"), "Zm8=");
        assert_eq!(super::b64(b"foo"), "Zm9v");
        assert_eq!(super::b64(b"foob"), "Zm9vYg==");
        assert_eq!(super::b64(b"fooba"), "Zm9vYmE=");
        assert_eq!(super::b64(b"foobar"), "Zm9vYmFy");
        // Bytes above 0x7f must not be mangled.
        assert_eq!(super::b64(&[0xff, 0xfe, 0xfd]), "//79");
    }
}
