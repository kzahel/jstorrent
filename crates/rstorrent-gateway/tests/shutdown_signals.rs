//! Process-level shutdown: repeated signals escalate from graceful to hurry
//! to immediate exit, and no exit path corrupts the session database.
#![cfg(unix)]

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rstorrent_session::{CONTROL_VERSION, RequestEnvelope};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;

const ORIGIN: &str = "http://127.0.0.1:5173";
static NEXT_ROOT: AtomicU64 = AtomicU64::new(0);

/// An HTTP tracker that answers every announce except `stopped`, which it
/// holds open without answering.
struct StalledStopTracker {
    url: String,
    events: mpsc::UnboundedReceiver<String>,
    task: tokio::task::JoinHandle<()>,
}

impl StalledStopTracker {
    async fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind tracker");
        let url = format!(
            "http://{}/announce",
            listener.local_addr().expect("tracker address")
        );
        let (sender, events) = mpsc::unbounded_channel();
        let task = tokio::spawn(async move {
            let mut held = Vec::new();
            loop {
                let Ok((mut stream, _)) = listener.accept().await else {
                    return;
                };
                let request = read_request_head(&mut stream).await;
                let event = if request.contains("&event=stopped ") {
                    "stopped"
                } else if request.contains("&event=started ") {
                    "started"
                } else {
                    "update"
                };
                if event == "stopped" {
                    held.push(stream);
                } else {
                    let _ = stream
                        .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 26\r\nConnection: close\r\n\r\nd8:intervali900e5:peers0:e")
                        .await;
                    let _ = stream.shutdown().await;
                }
                let _ = sender.send(event.to_owned());
            }
        });
        Self { url, events, task }
    }

    async fn wait_for(&mut self, wanted: &str) {
        tokio::time::timeout(Duration::from_secs(10), async {
            while let Some(event) = self.events.recv().await {
                if event == wanted {
                    return;
                }
            }
            panic!("tracker stopped before {wanted}");
        })
        .await
        .unwrap_or_else(|_| panic!("tracker never saw {wanted}"));
    }
}

impl Drop for StalledStopTracker {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn read_request_head(stream: &mut TcpStream) -> String {
    let mut bytes = Vec::new();
    let mut buffer = [0_u8; 1024];
    while !bytes.windows(4).any(|window| window == b"\r\n\r\n") && bytes.len() < 16 * 1024 {
        match stream.read(&mut buffer).await {
            Ok(0) | Err(_) => break,
            Ok(length) => bytes.extend_from_slice(&buffer[..length]),
        }
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

struct Gateway {
    root: PathBuf,
    child: Child,
    address: String,
    stderr: Arc<Mutex<Vec<String>>>,
}

impl Gateway {
    fn start() -> Self {
        let root = std::env::temp_dir().join(format!(
            "rstorrent-gateway-shutdown-{}-{}",
            std::process::id(),
            NEXT_ROOT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("profile")).expect("create profile root");
        std::fs::create_dir_all(root.join("downloads")).expect("create storage root");
        let mut child = Command::new(env!("CARGO_BIN_EXE_rstorrent-gateway"))
            .env("RSTORRENT_PROFILE_ROOT", root.join("profile"))
            .env("RSTORRENT_STORAGE_ROOT", root.join("downloads"))
            .env(
                "RSTORRENT_GATEWAY_AUTH",
                "unauthenticated_loopback_development",
            )
            .env("RSTORRENT_GATEWAY_BIND", "127.0.0.1:0")
            .env("RSTORRENT_GATEWAY_ORIGIN", ORIGIN)
            .env("RSTORRENT_NETWORK_POLICY", "loopback_only")
            .env_remove("RSTORRENT_GATEWAY_TOKEN")
            .env_remove("RSTORRENT_WEB_ROOT")
            .env_remove("RSTORRENT_BUILD_ID")
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn gateway");
        let stderr = Arc::new(Mutex::new(Vec::new()));
        let reader_lines = stderr.clone();
        let pipe = child.stderr.take().expect("gateway stderr");
        std::thread::spawn(move || {
            for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                reader_lines.lock().unwrap().push(line);
            }
        });
        let mut gateway = Self {
            root,
            child,
            address: String::new(),
            stderr,
        };
        let line = gateway.wait_for_line("gateway listening on ");
        gateway.address = line["gateway listening on ".len()..].to_owned();
        gateway
    }

    fn wait_for_line(&self, prefix: &str) -> String {
        let deadline = Instant::now() + Duration::from_secs(15);
        loop {
            if let Some(line) = self
                .stderr
                .lock()
                .unwrap()
                .iter()
                .find(|line| line.starts_with(prefix))
            {
                return line.clone();
            }
            assert!(
                Instant::now() < deadline,
                "gateway never printed {prefix:?}; stderr: {:#?}",
                self.stderr.lock().unwrap()
            );
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    fn stderr_text(&self) -> String {
        self.stderr.lock().unwrap().join("\n")
    }

    async fn add_magnet(&self, tracker_url: &str) {
        let request = RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: "shutdown-signal-add".to_owned(),
            expected_revision: None,
            command: rstorrent_session::Command::AddMagnet {
                magnet: format!(
                    "magnet:?xt=urn:btih:{}&tr={}",
                    "5d".repeat(20),
                    percent_encode(tracker_url)
                ),
                storage_root: "downloads".to_owned(),
                start_content: true,
                await_file_selection: false,
                skip_files: Vec::new(),
            },
        };
        let body = serde_json::to_vec(&request).expect("encode command");
        let mut stream = TcpStream::connect(&self.address)
            .await
            .expect("connect gateway");
        let head = format!(
            "POST /api/v1/commands HTTP/1.1\r\nHost: {}\r\nOrigin: {ORIGIN}\r\nX-RStorrent-Owner: {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            self.address,
            "0".repeat(32),
            body.len()
        );
        stream.write_all(head.as_bytes()).await.expect("send head");
        stream.write_all(&body).await.expect("send body");
        let mut response = String::new();
        stream
            .read_to_string(&mut response)
            .await
            .expect("read response");
        assert!(response.starts_with("HTTP/1.1 200"), "{response}");
        assert!(response.contains("\"success\""), "{response}");
    }

    fn signal(&self, name: &str) {
        let status = Command::new("kill")
            .args(["-s", name, &self.child.id().to_string()])
            .status()
            .expect("run kill");
        assert!(status.success(), "kill -s {name}");
    }

    fn wait_for_exit(&mut self, within: Duration) -> ExitStatus {
        let deadline = Instant::now() + within;
        loop {
            if let Some(status) = self.child.try_wait().expect("poll gateway") {
                return status;
            }
            if Instant::now() >= deadline {
                let _ = self.child.kill();
                panic!(
                    "gateway did not exit within {within:?}; stderr:\n{}",
                    self.stderr_text()
                );
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    /// Opens the session database the way a later launch would and checks it.
    fn assert_session_database_intact(&self) {
        let connection = rusqlite::Connection::open(self.root.join("profile").join("session.db"))
            .expect("open session database");
        let integrity: String = connection
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))
            .expect("integrity check");
        assert_eq!(integrity, "ok");
        let torrents: i64 = connection
            .query_row("SELECT count(*) FROM torrents", [], |row| row.get(0))
            .expect("count torrents");
        assert_eq!(torrents, 1, "the added torrent survives the exit");
    }
}

impl Drop for Gateway {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn percent_encode(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                (byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

/// Starts a gateway with one torrent whose tracker has confirmed `started`
/// and will stall on `stopped`.
async fn gateway_with_stalled_stop_tracker() -> (Gateway, StalledStopTracker) {
    let mut tracker = StalledStopTracker::start().await;
    let gateway = Gateway::start();
    gateway.add_magnet(&tracker.url).await;
    tracker.wait_for("started").await;
    // Let the session record the started response; it sends `stopped` only
    // after a started announce it has seen succeed.
    tokio::time::sleep(Duration::from_millis(500)).await;
    (gateway, tracker)
}

#[tokio::test(flavor = "multi_thread")]
async fn one_signal_stops_within_the_network_cleanup_budget() {
    let (mut gateway, mut tracker) = gateway_with_stalled_stop_tracker().await;
    let signalled = Instant::now();
    gateway.signal("INT");
    tracker.wait_for("stopped").await;
    let status = gateway.wait_for_exit(Duration::from_secs(10));
    let elapsed = signalled.elapsed();

    assert!(
        status.success(),
        "{status}; stderr:\n{}",
        gateway.stderr_text()
    );
    assert!(elapsed < Duration::from_secs(4), "{elapsed:?}");
    let stderr = gateway.stderr_text();
    assert!(stderr.contains("shutdown: stopping 1 torrent"), "{stderr}");
    assert!(
        stderr.contains("tracker stop announces for 1 torrent(s) did not finish"),
        "{stderr}"
    );
    assert!(stderr.contains("shutdown: stopped"), "{stderr}");
    gateway.assert_session_database_intact();
}

#[tokio::test(flavor = "multi_thread")]
async fn second_signal_skips_the_remaining_network_cleanup() {
    let (mut gateway, mut tracker) = gateway_with_stalled_stop_tracker().await;
    gateway.signal("INT");
    tracker.wait_for("stopped").await;
    gateway.wait_for_line("shutdown: announcing stop to trackers");
    let hurried = Instant::now();
    gateway.signal("INT");
    let status = gateway.wait_for_exit(Duration::from_secs(10));
    let elapsed = hurried.elapsed();

    assert!(
        status.success(),
        "{status}; stderr:\n{}",
        gateway.stderr_text()
    );
    assert!(elapsed < Duration::from_secs(1), "{elapsed:?}");
    let stderr = gateway.stderr_text();
    assert!(
        stderr.contains("shutdown: skipping remaining network cleanup"),
        "{stderr}"
    );
    assert!(stderr.contains("shutdown: stopped"), "{stderr}");
    gateway.assert_session_database_intact();
}

#[tokio::test(flavor = "multi_thread")]
async fn third_signal_exits_immediately_without_corrupting_the_database() {
    let (mut gateway, mut tracker) = gateway_with_stalled_stop_tracker().await;
    gateway.signal("INT");
    tracker.wait_for("stopped").await;
    gateway.wait_for_line("shutdown: announcing stop to trackers");
    // Repeated SIGINTs can coalesce into one wakeup. Queue two different
    // signals while the process is stopped so both arrive together.
    gateway.signal("STOP");
    gateway.signal("INT");
    gateway.signal("TERM");
    gateway.signal("CONT");
    let status = gateway.wait_for_exit(Duration::from_secs(10));

    assert_eq!(
        status.code(),
        Some(130),
        "{status}; stderr:\n{}",
        gateway.stderr_text()
    );
    let stderr = gateway.stderr_text();
    assert!(stderr.contains("shutdown: exiting immediately"), "{stderr}");
    assert!(!stderr.contains("shutdown: stopped"), "{stderr}");
    gateway.assert_session_database_intact();
}

#[tokio::test(flavor = "multi_thread")]
async fn kill_during_network_cleanup_does_not_corrupt_the_database() {
    let (mut gateway, mut tracker) = gateway_with_stalled_stop_tracker().await;
    gateway.signal("INT");
    tracker.wait_for("stopped").await;
    gateway.wait_for_line("shutdown: announcing stop to trackers");
    gateway.signal("KILL");
    let status = gateway.wait_for_exit(Duration::from_secs(5));

    assert!(!status.success());
    gateway.assert_session_database_intact();
}
