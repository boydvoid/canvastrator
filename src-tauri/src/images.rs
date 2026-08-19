//! Pasted images, on their way to a CLI.
//!
//! None of the three providers takes image bytes: codex and opencode read a
//! file off disk, and claude reads a path it finds in the prompt. So a blob off
//! the clipboard has to become a real file first — under the system temp dir,
//! never inside the user's repo, where a stray PNG would show up in `git
//! status` and in the agent's own file listings.

use std::path::PathBuf;
use std::time::{Duration, SystemTime};

/// One directory for the app, one directory per session inside it — so a
/// deleted node takes exactly its own images with it.
const ROOT: &str = "gridterm";

/// How long an orphaned session directory survives. Long enough that a canvas
/// left open overnight can still `--resume` onto its images.
const MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);

/// The largest paste we will take. A retina screenshot of a 6K display lands
/// around 8 MB; past that it is a photo or a video frame someone dragged in,
/// and the base64 of it has to cross the IPC boundary as one string. Mirrored
/// in `MAX_PASTE_BYTES` in `Composer.tsx`, which rejects it earlier and with a
/// message the user can read — this is the boundary check behind that.
const MAX_BYTES: usize = 10 * 1024 * 1024;

fn root_dir() -> PathBuf {
    std::env::temp_dir().join(ROOT)
}

/// Session ids come from the frontend and end up as a directory name, so they
/// are checked rather than trusted — a `..` here would write anywhere.
fn session_dir(session_id: &str) -> Result<PathBuf, String> {
    if session_id.is_empty()
        || session_id.contains('/')
        || session_id.contains('\\')
        || session_id.contains("..")
    {
        return Err(format!("unusable session id: {session_id}"));
    }
    Ok(root_dir().join(session_id))
}

/// Extension for the file we're about to write. The clipboard reports a MIME
/// type and nothing else, so it's the only thing there is to go on.
fn ext_for(mime: &str) -> &'static str {
    match mime.trim().to_ascii_lowercase().as_str() {
        "image/jpeg" | "image/jpg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/bmp" => "bmp",
        "image/avif" => "avif",
        "image/svg+xml" => "svg",
        "image/tiff" => "tiff",
        // Screenshots and most clipboard images are PNG, and a wrong extension
        // is worse than a defaulted one: the CLIs sniff the bytes anyway.
        _ => "png",
    }
}

/// Write one pasted image and hand back its absolute path.
#[tauri::command]
pub fn write_session_image(
    session_id: String,
    base64: String,
    mime: String,
) -> Result<String, String> {
    let dir = session_dir(&session_id)?;
    // Measured before decoding, so an oversized paste is refused rather than
    // allocated: base64 is 4 bytes per 3, so the limit on the encoding is the
    // limit on the bytes plus a third.
    if base64.len() / 4 * 3 > MAX_BYTES {
        return Err(too_big(base64.len() / 4 * 3));
    }
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let bytes = unb64(&base64)?;
    if bytes.is_empty() {
        return Err("pasted image was empty".into());
    }
    if bytes.len() > MAX_BYTES {
        return Err(too_big(bytes.len()));
    }
    let path = dir.join(format!("{}.{}", uuid::Uuid::new_v4(), ext_for(&mime)));
    std::fs::write(&path, &bytes).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(path.to_string_lossy().into_owned())
}

fn too_big(bytes: usize) -> String {
    format!(
        "image is {} MB — the limit is {} MB",
        bytes / 1_048_576,
        MAX_BYTES / 1_048_576
    )
}

/// Drop one image: the user took the thumbnail off, or navigated away from a
/// paste they never sent. Without this the file sits in the temp dir until the
/// session node is deleted, or until a sweep a day later.
///
/// The path is one we handed out, but it arrives back from the frontend, so it
/// is checked against the session's own directory rather than trusted.
#[tauri::command]
pub fn remove_session_image(session_id: String, path: String) -> Result<(), String> {
    let dir = session_dir(&session_id)?;
    let file = PathBuf::from(&path);
    if file.parent() != Some(dir.as_path()) {
        return Err(format!("{path} is not an image of session {session_id}"));
    }
    match std::fs::remove_file(&file) {
        Ok(()) => Ok(()),
        // Already gone is the outcome asked for.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("{path}: {e}")),
    }
}

/// Drop a session's images. Called when its node is deleted — not when a turn
/// ends, since `--resume` can send the CLI back to read the same path.
#[tauri::command]
pub fn clear_session_images(session_id: String) -> Result<(), String> {
    let dir = session_dir(&session_id)?;
    if !dir.is_dir() {
        return Ok(());
    }
    std::fs::remove_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))
}

/// Delete session directories nothing is coming back for. Sessions whose nodes
/// were deleted while the app wasn't running leave theirs behind, and the temp
/// dir is not somewhere to accumulate screenshots forever.
pub fn sweep_stale_images() {
    let Ok(entries) = std::fs::read_dir(root_dir()) else {
        return;
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let stale = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| now.duration_since(t).ok())
            .is_some_and(|age| age > MAX_AGE);
        if stale {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

/// The counterpart to `b64` in lib.rs. Padding and newlines are skipped rather
/// than validated: what arrives is our own encoder's output or the browser's.
fn unb64(input: &str) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(input.len() / 4 * 3);
    let mut acc: u32 = 0;
    let mut bits: u32 = 0;
    for c in input.bytes() {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' | b'\n' | b'\r' | b' ' | b'\t' => continue,
            _ => return Err(format!("not base64: {:?}", c as char)),
        };
        acc = (acc << 6) | v as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_round_trips_the_encoder_in_lib() {
        for v in ["", "f", "fo", "foo", "foob", "fooba", "foobar"] {
            assert_eq!(unb64(&crate::b64(v.as_bytes())).unwrap(), v.as_bytes());
        }
        let binary: Vec<u8> = (0..=255u8).collect();
        assert_eq!(unb64(&crate::b64(&binary)).unwrap(), binary);
    }

    #[test]
    fn base64_ignores_whitespace_and_rejects_junk() {
        assert_eq!(unb64("Zm9v\nYmFy").unwrap(), b"foobar");
        assert!(unb64("Zm9v*").is_err());
    }

    #[test]
    fn extension_follows_the_mime_type_and_defaults_to_png() {
        assert_eq!(ext_for("image/png"), "png");
        assert_eq!(ext_for("image/JPEG"), "jpg");
        assert_eq!(ext_for("image/svg+xml"), "svg");
        assert_eq!(ext_for("application/octet-stream"), "png");
    }

    #[test]
    fn an_image_can_only_be_removed_from_its_own_session_directory() {
        let dir = session_dir("s_rm").unwrap();
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("shot.png");
        std::fs::write(&path, b"x").unwrap();
        let path = path.to_string_lossy().into_owned();

        // A path under someone else's session, or outside the root entirely,
        // is refused before anything is unlinked.
        assert!(remove_session_image("s_other".into(), path.clone()).is_err());
        assert!(remove_session_image("s_rm".into(), "/etc/passwd".into()).is_err());
        assert!(std::path::Path::new(&path).exists());

        assert!(remove_session_image("s_rm".into(), path.clone()).is_ok());
        assert!(!std::path::Path::new(&path).exists());
        // Removing it twice is not an error: the file is gone either way.
        assert!(remove_session_image("s_rm".into(), path).is_ok());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_paste_past_the_size_limit_is_refused_with_a_readable_message() {
        // Four base64 characters per three bytes, so this is just over.
        let huge = "A".repeat((MAX_BYTES + 1_000) / 3 * 4);
        let err = write_session_image("s_big".into(), huge, "image/png".into()).unwrap_err();
        assert!(err.contains("the limit is 10 MB"), "{err}");
        // Refused before it ever reached the disk.
        assert!(!session_dir("s_big").unwrap().exists());
    }

    #[test]
    fn session_ids_that_would_escape_the_temp_dir_are_refused() {
        assert!(session_dir("../../etc").is_err());
        assert!(session_dir("a/b").is_err());
        assert!(session_dir("").is_err());
        assert!(session_dir("s_1a2b").is_ok());
    }
}
