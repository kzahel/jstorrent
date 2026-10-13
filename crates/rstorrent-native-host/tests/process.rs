use std::io::Write;
use std::process::{Command, Stdio};

use rstorrent_native_host::decode_frames;

const ORIGIN: &str = "chrome-extension://dbokmlpefliilbjldladbimlcfgbolhk/";

fn framed(json: &str) -> Vec<u8> {
    let mut bytes = (json.len() as u32).to_ne_bytes().to_vec();
    bytes.extend_from_slice(json.as_bytes());
    bytes
}

fn spawn_host() -> std::process::Child {
    Command::new(env!("CARGO_BIN_EXE_rstorrent-native-host"))
        .arg(ORIGIN)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn native host")
}

#[test]
fn process_writes_one_protocol_frame_and_exits_cleanly_on_eof() {
    let mut child = spawn_host();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(&framed(
            r#"{"id":"process-hello","protocolVersion":1,"op":"hello"}"#,
        ))
        .unwrap();

    let output = child.wait_with_output().expect("wait for native host");
    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let frames = decode_frames(&output.stdout).expect("decode native host stdout");
    assert_eq!(frames.len(), 1);
    assert_eq!(frames[0]["id"], "process-hello");
    assert_eq!(frames[0]["result"]["kind"], "hello");
}

#[test]
fn malformed_process_input_never_contaminates_stdout() {
    let mut child = spawn_host();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(&framed("not-json"))
        .unwrap();

    let output = child.wait_with_output().expect("wait for native host");
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    assert!(output.stderr.starts_with(b"RSTorrent native host:"));
    assert!(output.stderr.len() < 1024);
}

#[test]
fn product_origins_can_attach_without_launching_a_stopped_desktop() {
    let owned = tempfile::tempdir().unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(owned.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
    }
    let suffix = if cfg!(windows) { ".exe" } else { "" };
    let executable = owned.path().join(format!("host{suffix}"));
    std::fs::copy(env!("CARGO_BIN_EXE_rstorrent-native-host"), &executable).unwrap();
    for origin in [
        rstorrent_native_host::control::PRODUCTION_ORIGIN,
        rstorrent_native_host::control::BETA_ORIGIN,
    ] {
        let mut child = Command::new(&executable)
            .arg(origin)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(&framed(
                r#"{"id":"passive-attach","protocolVersion":1,"op":"attach_control"}"#,
            ))
            .unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(output.status.success());
        let frames = decode_frames(&output.stdout).unwrap();
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0]["error"]["code"], "control_unavailable");
        assert_eq!(
            frames[0]["error"]["message"],
            "Desktop is stopped. Select Start to open it."
        );
        // Passive attach neither consults a launch config nor creates files.
        assert_eq!(std::fs::read_dir(owned.path()).unwrap().count(), 1);
    }
}

#[test]
fn retired_host_never_reads_launch_configuration_or_returns_authority() {
    let owned = tempfile::tempdir().unwrap();
    let suffix = if cfg!(windows) { ".exe" } else { "" };
    let executable = owned.path().join(format!(
        "{}fixture{suffix}",
        rstorrent_native_host::legacy::REFUSAL_PREFIX
    ));
    std::fs::copy(env!("CARGO_BIN_EXE_rstorrent-native-host"), &executable).unwrap();
    // A missing launch config is deliberate: this process must not consult one.
    let mut child = Command::new(executable)
        .arg(ORIGIN)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    for op in ["handshake", "takeOver", "kvSet", "start_control"] {
        input.write_all(&framed(&format!(r#"{{"id":"{op}","op":"{op}","protocolVersion":1,"extensionId":"legacy","key":"source","value":"do not write"}}"#))).unwrap();
    }
    drop(input);
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let frames = decode_frames(&output.stdout).unwrap();
    assert_eq!(frames.len(), 4);
    for response in frames {
        assert_eq!(response["ok"], false);
        assert_eq!(response["type"], "Empty");
        assert_eq!(
            response["error"],
            rstorrent_native_host::legacy::UPDATE_MESSAGE
        );
        assert_eq!(response.as_object().unwrap().len(), 4);
    }
    assert_eq!(std::fs::read_dir(owned.path()).unwrap().count(), 1);
}
