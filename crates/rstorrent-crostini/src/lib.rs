#![forbid(unsafe_code)]

mod installer;

#[cfg(target_os = "linux")]
mod x11_launcher;

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::process::{Command, Output};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};

pub use installer::{install_bundle, uninstall};

#[cfg(target_os = "linux")]
pub use x11_launcher::run_launcher_window;

pub const APPLICATION_ID: &str = "com.jstorrent.rstorrent.crostini";
pub const PRODUCT_NAME: &str = "JSTorrent for ChromeOS Linux";
pub const SERVICE_NAME: &str = "com.jstorrent.rstorrent.crostini.service";
// A dedicated loopback name bypasses ChromeOS Linux DNS registration without
// sharing host-only browser cookies with applications on bare localhost.
pub const CROSTINI_HOST: &str = "jstorrent.localhost";
pub const CROSTINI_PORT: u16 = 3030;
pub const CROSTINI_PRODUCT: &str = "rstorrent-crostini";
pub const LAUNCH_PROTOCOL_VERSION: u16 = 1;

const HEALTH_ATTEMPTS: usize = 60;
const HEALTH_RETRY_DELAY: Duration = Duration::from_millis(250);
const HEALTH_IO_TIMEOUT: Duration = Duration::from_millis(500);
const MAX_HEALTH_RESPONSE_BYTES: u64 = 16 * 1024;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct GatewayHealth {
    pub status: String,
    pub build_id: String,
    pub product: String,
    pub launch_protocol: u16,
}

pub trait LaunchBackend: Sync {
    fn start_service(&self) -> Result<(), String>;
    fn gateway_health(&self) -> Result<GatewayHealth, String>;
    fn open_handoff(&self) -> Result<(), String>;
}

pub struct SystemBackend;

impl LaunchBackend for SystemBackend {
    fn start_service(&self) -> Result<(), String> {
        checked_command(
            Command::new("systemctl")
                .args(["--user", "start", "--no-block", SERVICE_NAME])
                .output(),
            "start JSTorrent for ChromeOS Linux",
        )
    }

    fn gateway_health(&self) -> Result<GatewayHealth, String> {
        probe_gateway(SocketAddr::from(([127, 0, 0, 1], CROSTINI_PORT)))
    }

    fn open_handoff(&self) -> Result<(), String> {
        checked_command(
            Command::new("xdg-open").arg(handoff_url()).output(),
            "open JSTorrent in Chrome",
        )
    }
}

pub fn execute_launch(
    backend: &impl LaunchBackend,
    mut report: impl FnMut(LaunchProgress),
) -> Result<GatewayHealth, String> {
    execute_launch_with_retry(
        backend,
        HEALTH_ATTEMPTS,
        HEALTH_RETRY_DELAY,
        thread::sleep,
        &mut report,
    )
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LaunchProgress {
    StartingService,
    WaitingForGateway,
    OpeningChrome,
}

fn execute_launch_with_retry(
    backend: &impl LaunchBackend,
    health_attempts: usize,
    retry_delay: Duration,
    mut sleep: impl FnMut(Duration),
    report: &mut impl FnMut(LaunchProgress),
) -> Result<GatewayHealth, String> {
    report(LaunchProgress::StartingService);
    backend.start_service()?;
    report(LaunchProgress::WaitingForGateway);

    let mut last_error = "gateway health was not checked".to_owned();
    for attempt in 0..health_attempts {
        match backend.gateway_health().and_then(validate_health) {
            Ok(health) => {
                report(LaunchProgress::OpeningChrome);
                backend.open_handoff()?;
                return Ok(health);
            }
            Err(error) => last_error = error,
        }
        if attempt + 1 < health_attempts {
            sleep(retry_delay);
        }
    }
    Err(format!("JSTorrent did not become ready: {last_error}"))
}

pub fn handoff_url() -> String {
    format!("http://{CROSTINI_HOST}:{CROSTINI_PORT}/launch-chromeos")
}

pub fn probe_system_gateway() -> Result<GatewayHealth, String> {
    probe_gateway(SocketAddr::from(([127, 0, 0, 1], CROSTINI_PORT))).and_then(validate_health)
}

pub fn parse_health_response(response: &[u8]) -> Result<GatewayHealth, String> {
    let header_end = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or_else(|| "gateway returned an incomplete HTTP response".to_owned())?;
    let headers = std::str::from_utf8(&response[..header_end])
        .map_err(|_| "gateway returned invalid HTTP headers".to_owned())?;
    let status = headers
        .lines()
        .next()
        .and_then(|line| line.split_ascii_whitespace().nth(1))
        .ok_or_else(|| "gateway returned an invalid HTTP status".to_owned())?;
    if status != "200" {
        return Err(format!("gateway health returned HTTP {status}"));
    }
    serde_json::from_slice(&response[header_end + 4..])
        .map_err(|error| format!("gateway returned invalid health data: {error}"))
}

fn validate_health(health: GatewayHealth) -> Result<GatewayHealth, String> {
    if health.status != "ok" {
        return Err("gateway health is not ready".to_owned());
    }
    if health.product != CROSTINI_PRODUCT {
        return Err("the listener is not the JSTorrent Crostini gateway".to_owned());
    }
    if health.launch_protocol != LAUNCH_PROTOCOL_VERSION {
        return Err(format!(
            "unsupported Crostini launch protocol {}",
            health.launch_protocol
        ));
    }
    if health.build_id.is_empty()
        || health.build_id.len() > 128
        || !health.build_id.bytes().all(|byte| byte.is_ascii_graphic())
    {
        return Err("gateway returned an invalid build identity".to_owned());
    }
    Ok(health)
}

fn probe_gateway(address: SocketAddr) -> Result<GatewayHealth, String> {
    let mut stream = TcpStream::connect_timeout(&address, HEALTH_IO_TIMEOUT)
        .map_err(|error| format!("gateway is not ready: {error}"))?;
    stream
        .set_read_timeout(Some(HEALTH_IO_TIMEOUT))
        .map_err(|error| format!("could not configure gateway health check: {error}"))?;
    stream
        .set_write_timeout(Some(HEALTH_IO_TIMEOUT))
        .map_err(|error| format!("could not configure gateway health check: {error}"))?;
    let request = format!(
        "GET /healthz HTTP/1.1\r\nHost: {CROSTINI_HOST}:{CROSTINI_PORT}\r\nConnection: close\r\n\r\n"
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|error| format!("could not request gateway health: {error}"))?;
    let mut response = Vec::new();
    stream
        .take(MAX_HEALTH_RESPONSE_BYTES)
        .read_to_end(&mut response)
        .map_err(|error| format!("could not read gateway health: {error}"))?;
    parse_health_response(&response)
}

fn checked_command(result: std::io::Result<Output>, action: &str) -> Result<(), String> {
    let output = result.map_err(|error| format!("could not {action}: {error}"))?;
    if output.status.success() {
        return Ok(());
    }
    let detail = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    if detail.is_empty() {
        Err(format!("could not {action} (exit {})", output.status))
    } else {
        Err(format!("could not {action}: {detail}"))
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    struct FakeBackend {
        health: Mutex<Vec<Result<GatewayHealth, String>>>,
        opens: AtomicUsize,
        start_error: Option<String>,
    }

    impl LaunchBackend for FakeBackend {
        fn start_service(&self) -> Result<(), String> {
            self.start_error.clone().map_or(Ok(()), Err)
        }

        fn gateway_health(&self) -> Result<GatewayHealth, String> {
            self.health.lock().expect("health lock").pop().unwrap()
        }

        fn open_handoff(&self) -> Result<(), String> {
            self.opens.fetch_add(1, Ordering::Relaxed);
            Ok(())
        }
    }

    fn valid_health() -> GatewayHealth {
        GatewayHealth {
            status: "ok".to_owned(),
            build_id: "0.1.0".to_owned(),
            product: CROSTINI_PRODUCT.to_owned(),
            launch_protocol: LAUNCH_PROTOCOL_VERSION,
        }
    }

    #[test]
    fn parses_and_validates_the_exact_gateway_health() {
        let response = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\n\r\n{}",
            serde_json::to_string(&valid_health()).expect("serialize fixture")
        );
        let parsed = parse_health_response(response.as_bytes()).expect("parse");
        assert_eq!(validate_health(parsed).expect("validate"), valid_health());
        assert!(parse_health_response(b"HTTP/1.1 503 Nope\r\n\r\n{}").is_err());
    }

    #[test]
    fn retries_health_then_opens_once() {
        let backend = FakeBackend {
            health: Mutex::new(vec![Ok(valid_health()), Err("not ready".to_owned())]),
            opens: AtomicUsize::new(0),
            start_error: None,
        };
        let mut progress = Vec::new();
        let health = execute_launch_with_retry(&backend, 2, Duration::ZERO, |_| {}, &mut |value| {
            progress.push(value)
        })
        .expect("launch");
        assert_eq!(health, valid_health());
        assert_eq!(backend.opens.load(Ordering::Relaxed), 1);
        assert_eq!(
            progress,
            vec![
                LaunchProgress::StartingService,
                LaunchProgress::WaitingForGateway,
                LaunchProgress::OpeningChrome,
            ]
        );
    }

    #[test]
    fn wrong_identity_never_opens() {
        let backend = FakeBackend {
            health: Mutex::new(vec![Ok(GatewayHealth {
                product: "other".to_owned(),
                ..valid_health()
            })]),
            opens: AtomicUsize::new(0),
            start_error: None,
        };
        let error = execute_launch_with_retry(&backend, 1, Duration::ZERO, |_| {}, &mut |_| {})
            .expect_err("wrong identity");
        assert!(error.contains("not the JSTorrent"));
        assert_eq!(backend.opens.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn service_failure_stops_before_health() {
        let backend = FakeBackend {
            health: Mutex::new(Vec::new()),
            opens: AtomicUsize::new(0),
            start_error: Some("systemd unavailable".to_owned()),
        };
        assert!(
            execute_launch_with_retry(&backend, 1, Duration::ZERO, |_| {}, &mut |_| {},).is_err()
        );
        assert_eq!(backend.opens.load(Ordering::Relaxed), 0);
    }
}
