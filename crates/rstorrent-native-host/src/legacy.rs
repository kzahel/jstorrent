//! Released desktop launch-route retirement. This mode has no desktop launcher.
use std::io::{self, Read, Write};
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::{HostError, MAX_REQUEST_ID_BYTES, read_frame, write_json_frame};

pub const HOST_NAME: &str = "com.jstorrent.native";
pub const REFUSAL_PREFIX: &str = "jstorrent-legacy-refusal-v";
pub const PACKAGED_EXTENSION_ORIGIN: &str = "chrome-extension://opkmhecbhgngcbglpcdfmnomkffenapc/";
pub const PRODUCTION_IDENTIFIER: &str = "com.jstorrent.desktop";
pub const PRODUCTION_ORIGIN: &str = "chrome-extension://dbokmlpefliilbjldladbimlcfgbolhk/";
pub const UPDATE_MESSAGE: &str =
    "JSTorrent desktop has been updated. Update the JSTorrent extension to continue.";

pub fn is_refusal_executable(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| {
            name.starts_with(REFUSAL_PREFIX)
                || matches!(name, "jstorrent-host" | "jstorrent-host.exe")
        })
}

#[derive(Deserialize)]
struct LegacyRequest {
    id: String,
}

#[derive(Serialize)]
struct LegacyFailure<'a> {
    id: &'a str,
    ok: bool,
    error: &'static str,
    #[serde(rename = "type")]
    kind: &'static str,
}

/// Accept the released envelope only to return its ordinary failure shape.
/// No operation fields, launch configuration, or capabilities are interpreted.
pub fn run_refusal<R: Read, W: Write>(
    reader: &mut R,
    writer: &mut W,
    caller_origin: Option<&str>,
) -> Result<(), HostError> {
    let authorized = matches!(
        caller_origin,
        Some(PRODUCTION_ORIGIN | PACKAGED_EXTENSION_ORIGIN)
    );
    while let Some(frame) = read_frame(reader)? {
        let request: LegacyRequest =
            serde_json::from_slice(&frame).map_err(HostError::MalformedRequest)?;
        if request.id.is_empty() || request.id.len() > MAX_REQUEST_ID_BYTES {
            return Err(HostError::Io(io::Error::new(
                io::ErrorKind::InvalidInput,
                "invalid legacy request ID",
            )));
        }
        write_json_frame(
            writer,
            &LegacyFailure {
                id: &request.id,
                ok: false,
                kind: "Empty",
                error: if authorized {
                    UPDATE_MESSAGE
                } else {
                    "JSTorrent extension access was refused."
                },
            },
        )?;
        writer.flush().map_err(HostError::Io)?;
    }
    Ok(())
}

/// Detect already-open old hosts, including ones that have not written discovery.
/// Called after managed launch routes have been replaced; never terminates them.
pub fn old_process_is_running() -> io::Result<bool> {
    process_inventory::old_process_is_running()
}

fn legacy_process_name(name: &str) -> bool {
    let filename = Path::new(name)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(name);
    let filename = filename.strip_suffix(".exe").unwrap_or(filename);
    matches!(
        filename,
        "jstorrent-host" | "jstorrent-io-daemon" | "jstorrent" | "JSTorrent" | "jstorrent-desktop"
        // Linux's kernel comm field truncates names at 15 bytes.
        | "jstorrent-io-da" | "jstorrent-deskt"
    )
}

#[cfg(unix)]
mod process_inventory {
    use super::*;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    const MAX_BYTES: u64 = 1024 * 1024;
    const DEADLINE: Duration = Duration::from_secs(5);

    pub(super) fn old_process_is_running() -> io::Result<bool> {
        let uid = rustix::process::geteuid().as_raw().to_string();
        let mut child = Command::new("/bin/ps")
            .args(["-U", &uid, "-o", "pid=,comm="])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()?;
        let stdout = child.stdout.take().expect("piped process inventory");
        let reader = std::thread::spawn(move || {
            let mut bytes = Vec::new();
            stdout
                .take(MAX_BYTES + 1)
                .read_to_end(&mut bytes)
                .map(|_| bytes)
        });
        let end = Instant::now() + DEADLINE;
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break Ok(status),
                Ok(None) if Instant::now() < end => std::thread::sleep(Duration::from_millis(10)),
                result => {
                    let error = result.err().unwrap_or_else(|| {
                        io::Error::new(
                            io::ErrorKind::TimedOut,
                            "legacy process inventory timed out",
                        )
                    });
                    let _ = child.kill();
                    let _ = child.wait();
                    break Err(error);
                }
            }
        };
        let bytes = reader
            .join()
            .map_err(|_| io::Error::other("legacy process reader failed"))??;
        if !status?.success() || bytes.len() as u64 > MAX_BYTES {
            return Err(io::Error::other(
                "legacy process inventory unavailable or exceeds bound",
            ));
        }
        let text = String::from_utf8_lossy(&bytes);
        for line in text.lines().filter(|line| !line.trim().is_empty()) {
            let line = line.trim();
            let split = line
                .find(char::is_whitespace)
                .ok_or_else(|| io::Error::other("invalid process inventory"))?;
            let pid: u32 = line[..split]
                .parse()
                .map_err(|_| io::Error::other("invalid process PID"))?;
            if pid != std::process::id() && legacy_process_name(line[split..].trim()) {
                return Ok(true);
            }
        }
        Ok(false)
    }
}

#[cfg(windows)]
#[path = "legacy/windows.rs"]
mod process_inventory;

#[cfg(not(any(unix, windows)))]
mod process_inventory {
    use super::*;
    pub(super) fn old_process_is_running() -> io::Result<bool> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "legacy process inventory is unavailable",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_retired_executable_names_select_refusal() {
        assert!(is_refusal_executable(Path::new(
            "/private/jstorrent-legacy-refusal-v1-digest"
        )));
        assert!(is_refusal_executable(Path::new("/private/jstorrent-host")));
        assert!(!is_refusal_executable(Path::new(
            "/private/rstorrent-native-host-v1-digest"
        )));
    }

    #[test]
    fn refusal_returns_released_failures_for_every_operation() {
        let mut input = Vec::new();
        for (id, op) in ["handshake", "takeOver", "kvSet", "start_control"]
            .iter()
            .enumerate()
        {
            let body = serde_json::to_vec(&serde_json::json!({"id": id.to_string(), "op": op, "protocolVersion": 1, "value": "do not write"})).unwrap();
            input.extend_from_slice(&(body.len() as u32).to_ne_bytes());
            input.extend_from_slice(&body);
        }
        let mut output = Vec::new();
        run_refusal(&mut input.as_slice(), &mut output, Some(PRODUCTION_ORIGIN)).unwrap();
        let frames = crate::decode_frames(&output).unwrap();
        assert_eq!(frames.len(), 4);
        for (id, response) in frames.iter().enumerate() {
            assert_eq!(
                response,
                &serde_json::json!({"id": id.to_string(), "ok": false, "error": UPDATE_MESSAGE, "type": "Empty"})
            );
        }
    }

    #[test]
    fn process_names_cover_full_paths_and_linux_truncation() {
        assert!(legacy_process_name(
            "/Applications/JSTorrent.app/Contents/MacOS/jstorrent-host"
        ));
        assert!(legacy_process_name("jstorrent-io-da"));
        assert!(legacy_process_name("jstorrent-host.exe"));
        assert!(!legacy_process_name("rstorrent-desktop"));
        assert!(!legacy_process_name("jstorrent-client"));
        assert!(!legacy_process_name("jstorrent-clien"));
        assert!(!legacy_process_name("jstorrent-client.exe"));
        assert!(legacy_process_name("jstorrent-desktop"));
        assert!(legacy_process_name("jstorrent-deskt"));
        assert!(!legacy_process_name("jstorrent-legacy-refusal-v1"));
    }

    #[test]
    fn refusal_bounds_input_and_never_grants_an_unlisted_origin() {
        let framed = |body: &[u8]| {
            let mut bytes = (body.len() as u32).to_ne_bytes().to_vec();
            bytes.extend_from_slice(body);
            bytes
        };
        for origin in [None, Some("chrome-extension://unlisted/")] {
            let mut output = Vec::new();
            run_refusal(
                &mut framed(br#"{"id":"unauthorized","op":"handshake"}"#).as_slice(),
                &mut output,
                origin,
            )
            .unwrap();
            let response = crate::decode_frames(&output).unwrap().remove(0);
            assert_eq!(response["ok"], false);
            assert_eq!(response["error"], "JSTorrent extension access was refused.");
        }
        let oversized_id = serde_json::to_vec(&serde_json::json!({
            "id": "x".repeat(MAX_REQUEST_ID_BYTES + 1),
        }))
        .unwrap();
        let oversized_frame = (crate::MAX_FRAME_BYTES as u32 + 1).to_ne_bytes();
        for input in [
            framed(b"{"),
            framed(br#"{"id":""}"#),
            framed(br#"{"op":"handshake"}"#),
            framed(&oversized_id),
            oversized_frame.to_vec(),
        ] {
            let mut output = Vec::new();
            assert!(
                run_refusal(&mut input.as_slice(), &mut output, Some(PRODUCTION_ORIGIN)).is_err()
            );
            assert!(output.is_empty());
        }
    }
}
