pub mod control;
pub mod legacy;

use std::fmt;
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const HOST_NAME: &str = "com.jstorrent.rstorrent.native";
pub const PROTOCOL_VERSION: u32 = 1;
pub const MINIMUM_PROTOCOL_VERSION: u32 = 1;
pub const MAX_FRAME_BYTES: usize = 64 * 1024;
pub const MAX_REQUEST_ID_BYTES: usize = 64;
pub const LAUNCH_CONFIG_FILENAME: &str = "rstorrent-native-host-launch.json";
const MAX_LAUNCH_CONFIG_BYTES: u64 = 8 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LaunchConfig {
    pub kind: LaunchKind,
    pub path: PathBuf,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LaunchKind {
    Executable,
    MacApp,
}

impl LaunchConfig {
    pub fn executable(path: PathBuf) -> Self {
        Self {
            kind: LaunchKind::Executable,
            path,
        }
    }

    pub fn mac_app(path: PathBuf) -> Self {
        Self {
            kind: LaunchKind::MacApp,
            path,
        }
    }

    pub fn write_to(&self, path: &Path) -> Result<(), HostError> {
        if !self.path.is_absolute() {
            return Err(HostError::InvalidLaunchConfig(
                "desktop launch path must be absolute".to_owned(),
            ));
        }
        let bytes = serde_json::to_vec_pretty(self).map_err(HostError::Serialize)?;
        if bytes.len() as u64 > MAX_LAUNCH_CONFIG_BYTES {
            return Err(HostError::InvalidLaunchConfig(
                "desktop launch configuration exceeds 8 KiB".to_owned(),
            ));
        }
        fs::write(path, bytes).map_err(HostError::Io)
    }

    fn read_from(path: &Path) -> Result<Self, HostError> {
        let metadata = fs::metadata(path).map_err(HostError::Io)?;
        if metadata.len() > MAX_LAUNCH_CONFIG_BYTES {
            return Err(HostError::InvalidLaunchConfig(
                "desktop launch configuration exceeds 8 KiB".to_owned(),
            ));
        }
        let bytes = fs::read(path).map_err(HostError::Io)?;
        let config: Self = serde_json::from_slice(&bytes).map_err(HostError::ParseConfig)?;
        if !config.path.is_absolute() {
            return Err(HostError::InvalidLaunchConfig(
                "desktop launch path must be absolute".to_owned(),
            ));
        }
        Ok(config)
    }
}

pub trait DesktopLauncher {
    fn launch(&mut self) -> Result<(), String>;

    fn control(&mut self, _start: bool) -> Result<control::ControlReady, String> {
        Err("Desktop control is unavailable on this platform".to_owned())
    }
}

#[derive(Debug)]
pub struct ConfiguredLauncher {
    config_path: PathBuf,
}

impl ConfiguredLauncher {
    pub fn for_host_executable(host_executable: &Path) -> Self {
        let config_path = host_executable
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join(LAUNCH_CONFIG_FILENAME);
        Self { config_path }
    }
}

impl ConfiguredLauncher {
    fn launch_with_intent(&mut self, background: bool) -> Result<(), String> {
        let config = LaunchConfig::read_from(&self.config_path)
            .map_err(|_| "JSTorrent launch configuration is unavailable".to_owned())?;
        if !config.path.exists() {
            return Err("installed JSTorrent application was not found".to_owned());
        }
        let mut command = match config.kind {
            LaunchKind::Executable => Command::new(&config.path),
            LaunchKind::MacApp => {
                let mut command = Command::new("/usr/bin/open");
                if background {
                    command.arg("-g");
                }
                command.arg("--").arg(&config.path);
                if background {
                    command.args(["--args", control::BACKGROUND_ARGUMENT]);
                }
                command
            }
        };
        if background && config.kind == LaunchKind::Executable {
            command.arg(control::BACKGROUND_ARGUMENT);
        }
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // Native UI is created by Tauri; a debug executable must not add
            // a console window to an extension's background launch.
            command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map(|_| ())
            .map_err(|_| "JSTorrent launch request could not be started".to_owned())
    }
}

impl DesktopLauncher for ConfiguredLauncher {
    fn launch(&mut self) -> Result<(), String> {
        self.launch_with_intent(false)
    }

    fn control(&mut self, start: bool) -> Result<control::ControlReady, String> {
        let directory = self
            .config_path
            .parent()
            .ok_or("Desktop setup is unavailable")?;
        let path = directory.join(control::SOCKET_NAME);
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        #[cfg(target_os = "macos")]
        let _start_lock = if start {
            Some(
                control::lock_start(directory, deadline)
                    .map_err(|_| "Desktop startup is busy or unavailable".to_owned())?,
            )
        } else {
            None
        };
        match control::read_ready(&path) {
            Ok(ready) => return Ok(ready),
            Err(error) if !control::is_stopped(&error) => {
                eprintln!(
                    "RSTorrent bootstrap attach refused: kind={:?} os={:?}",
                    error.kind(),
                    error.raw_os_error()
                );
                return Err("Desktop bootstrap was refused".to_owned());
            }
            Err(_) if !start => {
                return Err("Desktop is stopped. Select Start to open it.".to_owned());
            }
            Err(_) => {}
        }
        if std::time::Instant::now() >= deadline {
            return Err("Desktop startup did not become available in time".to_owned());
        }
        self.launch_with_intent(true)?;
        while std::time::Instant::now() < deadline {
            match control::read_ready(&path) {
                Ok(ready) => return Ok(ready),
                Err(error) if control::is_stopped(&error) => {}
                Err(error) => {
                    eprintln!(
                        "RSTorrent bootstrap startup refused: kind={:?} os={:?}",
                        error.kind(),
                        error.raw_os_error()
                    );
                    return Err("Desktop bootstrap was refused".to_owned());
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        Err("Desktop did not become ready in time".to_owned())
    }
}

#[derive(Debug)]
pub enum HostError {
    Io(io::Error),
    Serialize(serde_json::Error),
    ParseConfig(serde_json::Error),
    InvalidLaunchConfig(String),
    FrameTooLarge(u32),
    ResponseTooLarge,
    MalformedRequest(serde_json::Error),
}

impl fmt::Display for HostError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "native host I/O failed: {error}"),
            Self::Serialize(error) => write!(formatter, "encode native host response: {error}"),
            Self::ParseConfig(error) => write!(formatter, "parse desktop launch config: {error}"),
            Self::InvalidLaunchConfig(message) => {
                write!(formatter, "invalid desktop launch config: {message}")
            }
            Self::FrameTooLarge(length) => {
                write!(
                    formatter,
                    "native host frame length {length} exceeds 64 KiB"
                )
            }
            Self::ResponseTooLarge => write!(formatter, "native host response exceeds 64 KiB"),
            Self::MalformedRequest(error) => {
                write!(formatter, "parse native host request: {error}")
            }
        }
    }
}

impl std::error::Error for HostError {}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    id: String,
    protocol_version: u32,
    op: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Response {
    id: String,
    ok: bool,
    protocol_version: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<ResultBody>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<ErrorBody>,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum ResultBody {
    Hello {
        product: &'static str,
        #[serde(rename = "hostVersion")]
        host_version: &'static str,
        #[serde(rename = "minimumProtocolVersion")]
        minimum_protocol_version: u32,
        #[serde(rename = "currentProtocolVersion")]
        current_protocol_version: u32,
        #[serde(rename = "callerOrigin")]
        caller_origin: String,
        capabilities: Vec<&'static str>,
    },
    Ready {
        #[serde(flatten)]
        ready: control::ControlReady,
    },
    Launch {
        status: &'static str,
    },
}

#[derive(Debug, Serialize)]
struct ErrorBody {
    code: &'static str,
    message: String,
}

pub fn run<R, W, L>(
    reader: &mut R,
    writer: &mut W,
    caller_origin: Option<&str>,
    launcher: &mut L,
) -> Result<(), HostError>
where
    R: Read,
    W: Write,
    L: DesktopLauncher,
{
    while let Some(frame) = read_frame(reader)? {
        let request: Request =
            serde_json::from_slice(&frame).map_err(HostError::MalformedRequest)?;
        let response = dispatch(&request, caller_origin, launcher);
        write_json_frame(writer, &response)?;
        writer.flush().map_err(HostError::Io)?;
    }
    Ok(())
}

fn dispatch<L: DesktopLauncher>(
    request: &Request,
    caller_origin: Option<&str>,
    launcher: &mut L,
) -> Response {
    if request.id.is_empty() || request.id.len() > MAX_REQUEST_ID_BYTES {
        return Response::error(
            &request.id,
            "invalid_request_id",
            "request id must contain 1 to 64 UTF-8 bytes",
        );
    }
    if request.protocol_version != PROTOCOL_VERSION {
        return Response::error(
            &request.id,
            "unsupported_protocol",
            "native bootstrap protocol version is not supported",
        );
    }
    let Some(caller_origin) = caller_origin.filter(|origin| is_extension_origin(origin)) else {
        return Response::error(
            &request.id,
            "invalid_caller_origin",
            "caller origin is not a Chrome extension origin",
        );
    };

    match request.op.as_str() {
        "hello" => Response::success(
            &request.id,
            ResultBody::Hello {
                product: "RSTorrent",
                host_version: env!("CARGO_PKG_VERSION"),
                minimum_protocol_version: MINIMUM_PROTOCOL_VERSION,
                current_protocol_version: PROTOCOL_VERSION,
                caller_origin: caller_origin.to_owned(),
                capabilities: if cfg!(any(unix, windows)) {
                    vec!["launch_desktop", "desktop_control_v1"]
                } else {
                    vec!["launch_desktop"]
                },
            },
        ),
        "start_control" | "attach_control" if control::origin_allowed(caller_origin) => {
            match launcher.control(request.op == "start_control") {
                Ok(ready) => Response::success(&request.id, ResultBody::Ready { ready }),
                Err(message) => Response::error(&request.id, "control_unavailable", message),
            }
        }
        "launch" => match launcher.launch() {
            Ok(()) => Response::success(
                &request.id,
                ResultBody::Launch {
                    status: "requested",
                },
            ),
            Err(message) => Response::error(&request.id, "launch_failed", message),
        },
        _ => Response::error(
            &request.id,
            "unsupported_operation",
            "native bootstrap operation is not supported",
        ),
    }
}

impl Response {
    fn success(id: &str, result: ResultBody) -> Self {
        Self {
            id: id.to_owned(),
            ok: true,
            protocol_version: PROTOCOL_VERSION,
            result: Some(result),
            error: None,
        }
    }

    fn error(id: &str, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            id: id.to_owned(),
            ok: false,
            protocol_version: PROTOCOL_VERSION,
            result: None,
            error: Some(ErrorBody {
                code,
                message: message.into(),
            }),
        }
    }
}

fn is_extension_origin(origin: &str) -> bool {
    let Some(identifier) = origin
        .strip_prefix("chrome-extension://")
        .and_then(|value| value.strip_suffix('/'))
    else {
        return false;
    };
    identifier.len() == 32 && identifier.bytes().all(|byte| (b'a'..=b'p').contains(&byte))
}

fn read_frame<R: Read>(reader: &mut R) -> Result<Option<Vec<u8>>, HostError> {
    let mut length_bytes = [0_u8; 4];
    let mut first = [0_u8; 1];
    match reader.read(&mut first) {
        Ok(0) => return Ok(None),
        Ok(1) => length_bytes[0] = first[0],
        Ok(_) => unreachable!("one-byte buffer cannot return more than one byte"),
        Err(error) => return Err(HostError::Io(error)),
    }
    reader
        .read_exact(&mut length_bytes[1..])
        .map_err(HostError::Io)?;
    let length = u32::from_ne_bytes(length_bytes);
    if length as usize > MAX_FRAME_BYTES {
        return Err(HostError::FrameTooLarge(length));
    }
    let mut bytes = vec![0_u8; length as usize];
    reader.read_exact(&mut bytes).map_err(HostError::Io)?;
    Ok(Some(bytes))
}

fn write_json_frame<W: Write, T: Serialize>(writer: &mut W, value: &T) -> Result<(), HostError> {
    let bytes = serde_json::to_vec(value).map_err(HostError::Serialize)?;
    if bytes.len() > MAX_FRAME_BYTES {
        return Err(HostError::ResponseTooLarge);
    }
    writer
        .write_all(&(bytes.len() as u32).to_ne_bytes())
        .map_err(HostError::Io)?;
    writer.write_all(&bytes).map_err(HostError::Io)
}

pub fn decode_frames(bytes: &[u8]) -> Result<Vec<Value>, HostError> {
    let mut reader = bytes;
    let mut values = Vec::new();
    while let Some(frame) = read_frame(&mut reader)? {
        values.push(serde_json::from_slice(&frame).map_err(HostError::MalformedRequest)?);
    }
    Ok(values)
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "macos")]
    #[test]
    fn attach_does_not_wait_for_or_launch_a_pending_start() {
        use super::*;
        use std::os::unix::fs::PermissionsExt;
        let directory = tempfile::tempdir().unwrap();
        std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        let _lock = control::lock_start(directory.path(), std::time::Instant::now()).unwrap();
        let mut launcher = ConfiguredLauncher::for_host_executable(&directory.path().join("host"));
        // No launch config exists: attempting any launch would return a setup
        // error instead of the expected attach-only stopped result.
        assert!(
            launcher
                .control(false)
                .err()
                .unwrap()
                .contains("Desktop is stopped")
        );
    }

    use super::*;

    const ORIGIN: &str = "chrome-extension://dbokmlpefliilbjldladbimlcfgbolhk/";

    #[derive(Default)]
    struct FakeLauncher {
        calls: usize,
        failure: Option<String>,
    }

    impl DesktopLauncher for FakeLauncher {
        fn launch(&mut self) -> Result<(), String> {
            self.calls += 1;
            match &self.failure {
                Some(message) => Err(message.clone()),
                None => Ok(()),
            }
        }
    }

    fn framed(json: &str) -> Vec<u8> {
        let mut bytes = (json.len() as u32).to_ne_bytes().to_vec();
        bytes.extend_from_slice(json.as_bytes());
        bytes
    }

    fn exchange(input: &[u8], origin: Option<&str>, launcher: &mut impl DesktopLauncher) -> Value {
        let mut output = Vec::new();
        run(&mut &input[..], &mut output, origin, launcher).expect("host exchange");
        let frames = decode_frames(&output).expect("decode output");
        assert_eq!(frames.len(), 1);
        frames.into_iter().next().unwrap()
    }

    #[test]
    fn control_requires_exact_product_origins_and_preserves_launch_intent() {
        #[derive(Default)]
        struct ControlLauncher(Vec<bool>);
        impl DesktopLauncher for ControlLauncher {
            fn launch(&mut self) -> Result<(), String> {
                panic!("control must not use ordinary window launch");
            }
            fn control(&mut self, start: bool) -> Result<control::ControlReady, String> {
                self.0.push(start);
                Ok(control::ControlReady {
                    endpoint: "http://127.0.0.1:1234".to_owned(),
                    credential: "ab".repeat(32),
                    instance_id: "cd".repeat(16),
                    profile_id: "default".to_owned(),
                })
            }
        }
        let mut launcher = ControlLauncher::default();
        for (operation, starts) in [("start_control", true), ("attach_control", false)] {
            let request = framed(&format!(
                r#"{{"id":"control","protocolVersion":1,"op":"{operation}"}}"#
            ));
            for origin in [
                "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/",
                "chrome-extension://dbokmlpefliilbjldladbimlcfgbolhk.attacker/",
                "chrome-extension://dbokmlpefliilbjldladbimlcfgbolhk",
                "chrome-extension://gcgoepclopkgijmclmlheafaglmbjlcc/extra",
            ] {
                let denied = exchange(&request, Some(origin), &mut launcher);
                assert_eq!(denied["ok"], false, "{origin}");
                assert!(launcher.0.is_empty());
            }
            for origin in [control::PRODUCTION_ORIGIN, control::BETA_ORIGIN] {
                let ready = exchange(&request, Some(origin), &mut launcher);
                assert_eq!(ready["ok"], true, "{origin}");
                assert_eq!(ready["result"]["kind"], "ready");
                assert_eq!(ready["result"]["profileId"], "default");
                assert_eq!(launcher.0, [starts]);
                launcher.0.clear();
            }
        }
    }

    #[test]
    fn hello_reports_exact_compatibility_without_launching() {
        let mut launcher = FakeLauncher::default();
        let response = exchange(
            &framed(r#"{"id":"hello-1","protocolVersion":1,"op":"hello"}"#),
            Some(ORIGIN),
            &mut launcher,
        );

        assert_eq!(response["id"], "hello-1");
        assert_eq!(response["ok"], true);
        assert_eq!(response["protocolVersion"], 1);
        assert_eq!(response["result"]["kind"], "hello");
        assert_eq!(response["result"]["product"], "RSTorrent");
        assert_eq!(response["result"]["callerOrigin"], ORIGIN);
        assert_eq!(response["result"]["capabilities"][0], "launch_desktop");
        assert_eq!(launcher.calls, 0);
    }

    #[test]
    fn launch_reports_only_requested_after_process_creation() {
        let mut launcher = FakeLauncher::default();
        let response = exchange(
            &framed(r#"{"id":"launch-1","protocolVersion":1,"op":"launch"}"#),
            Some(ORIGIN),
            &mut launcher,
        );

        assert_eq!(response["ok"], true);
        assert_eq!(response["result"]["kind"], "launch");
        assert_eq!(response["result"]["status"], "requested");
        assert_eq!(launcher.calls, 1);
    }

    #[test]
    fn launch_failure_is_typed_and_bounded() {
        let mut launcher = FakeLauncher {
            failure: Some("not installed".to_owned()),
            ..FakeLauncher::default()
        };
        let response = exchange(
            &framed(r#"{"id":"launch-2","protocolVersion":1,"op":"launch"}"#),
            Some(ORIGIN),
            &mut launcher,
        );

        assert_eq!(response["ok"], false);
        assert_eq!(response["error"]["code"], "launch_failed");
        assert_eq!(response["error"]["message"], "not installed");
    }

    #[test]
    fn rejects_version_origin_id_and_unknown_fields_without_launching() {
        let cases = [
            (
                r#"{"id":"version","protocolVersion":2,"op":"launch"}"#,
                Some(ORIGIN),
                "unsupported_protocol",
            ),
            (
                r#"{"id":"origin","protocolVersion":1,"op":"launch"}"#,
                Some("https://example.com/"),
                "invalid_caller_origin",
            ),
            (
                r#"{"id":"","protocolVersion":1,"op":"launch"}"#,
                Some(ORIGIN),
                "invalid_request_id",
            ),
        ];
        let mut launcher = FakeLauncher::default();
        for (request, origin, expected_code) in cases {
            let response = exchange(&framed(request), origin, &mut launcher);
            assert_eq!(response["error"]["code"], expected_code);
        }
        assert_eq!(launcher.calls, 0);

        let response = exchange(
            &framed(r#"{"id":"operation","protocolVersion":1,"op":"download"}"#),
            Some(ORIGIN),
            &mut launcher,
        );
        assert_eq!(response["error"]["code"], "unsupported_operation");
        assert_eq!(launcher.calls, 0);

        let mut output = Vec::new();
        let error = run(
            &mut &framed(r#"{"id":"extra","protocolVersion":1,"op":"hello","extra":true}"#)[..],
            &mut output,
            Some(ORIGIN),
            &mut launcher,
        )
        .expect_err("unknown request fields must fail");
        assert!(matches!(error, HostError::MalformedRequest(_)));
        assert!(output.is_empty());
    }

    #[test]
    fn eof_is_normal_and_oversized_or_truncated_frames_are_rejected() {
        let mut launcher = FakeLauncher::default();
        let mut output = Vec::new();
        run(&mut &[][..], &mut output, Some(ORIGIN), &mut launcher)
            .expect("empty stdin is normal EOF");
        assert!(output.is_empty());

        let oversized = ((MAX_FRAME_BYTES + 1) as u32).to_ne_bytes();
        let error = run(
            &mut &oversized[..],
            &mut output,
            Some(ORIGIN),
            &mut launcher,
        )
        .expect_err("oversized input must fail before allocation");
        assert!(matches!(error, HostError::FrameTooLarge(_)));

        let truncated = [4_u32.to_ne_bytes().as_slice(), b"{}"].concat();
        let error = run(
            &mut &truncated[..],
            &mut output,
            Some(ORIGIN),
            &mut launcher,
        )
        .expect_err("truncated input must fail");
        assert!(matches!(error, HostError::Io(_)));
    }

    #[test]
    fn launch_config_is_bounded_absolute_and_round_trips() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("RSTorrent");
        let path = directory.path().join(LAUNCH_CONFIG_FILENAME);
        let config = LaunchConfig::executable(target.clone());
        config.write_to(&path).unwrap();
        assert_eq!(LaunchConfig::read_from(&path).unwrap(), config);

        let relative = LaunchConfig::executable(PathBuf::from("RSTorrent"));
        assert!(matches!(
            relative.write_to(&path),
            Err(HostError::InvalidLaunchConfig(_))
        ));
    }

    #[test]
    fn validates_exact_chrome_extension_origin_shape() {
        assert!(is_extension_origin(ORIGIN));
        assert!(!is_extension_origin(
            "chrome-extension://dbokmlpefliilbjldladbimlcfgbolhk"
        ));
        assert!(!is_extension_origin(
            "chrome-extension://zbokmlpefliilbjldladbimlcfgbolhk/"
        ));
        assert!(!is_extension_origin(
            "chrome-extension://dbokmlpefliilbjldladbimlcfgbolh/"
        ));
    }
}
