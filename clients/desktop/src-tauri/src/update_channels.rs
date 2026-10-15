use std::{path::Path, sync::Mutex, time::Duration};

use serde::{Deserialize, Serialize};
use tauri::{Manager, State, ipc::Channel};
use tauri_plugin_updater::{Update, UpdaterExt};

const INCUBATION_ROOT: &str = "https://updates.graehlarts.com/rstorrent";
const INCUBATION_ENDPOINT: &str =
    "https://updates.graehlarts.com/rstorrent/tauri/{{target}}/{{arch}}/{{current_version}}";
const JSTORRENT_ROOT: &str = "https://updates.jstorrent.com";
const JSTORRENT_ENDPOINT: &str =
    "https://updates.jstorrent.com/tauri/{{target}}/{{arch}}/{{current_version}}";

fn update_routes(identifier: &str) -> Result<(&'static str, &'static str), String> {
    match identifier {
        "com.jstorrent.desktop" => Ok((JSTORRENT_ROOT, JSTORRENT_ENDPOINT)),
        "com.jstorrent.rstorrent" => Ok((INCUBATION_ROOT, INCUBATION_ENDPOINT)),
        _ => Err("This application has no qualified update route".into()),
    }
}

const SELECTION_FILE: &str = "update-channel";
const MAX_RESPONSE_BYTES: usize = 64 * 1024;
const CHECK_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ChannelId {
    #[default]
    Stable,
    Latest,
}

impl ChannelId {
    fn as_str(self) -> &'static str {
        match self {
            Self::Stable => "stable",
            Self::Latest => "latest",
        }
    }
}

#[derive(Default)]
pub(crate) struct ChannelUpdates {
    selected: ChannelId,
    generation: u64,
    candidate: Option<Update>,
    installing: bool,
}

impl ChannelUpdates {
    pub(crate) fn open(config_dir: &Path) -> Self {
        let path = config_dir.join(SELECTION_FILE);
        let selected = std::fs::symlink_metadata(&path)
            .ok()
            .filter(|metadata| metadata.file_type().is_file() && metadata.len() <= 64)
            .and_then(|_| std::fs::read_to_string(path).ok())
            .and_then(|value| serde_json::from_str(&value).ok())
            .unwrap_or_default();
        Self {
            selected,
            ..Self::default()
        }
    }
}

fn persist_selection(config_dir: &Path, selected: ChannelId) -> Result<(), String> {
    std::fs::create_dir_all(config_dir).map_err(|error| error.to_string())?;
    let mut file =
        tempfile::NamedTempFile::new_in(config_dir).map_err(|error| error.to_string())?;
    serde_json::to_writer(&mut file, &selected).map_err(|error| error.to_string())?;
    file.as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    file.persist(config_dir.join(SELECTION_FILE))
        .map_err(|error| error.to_string())?;
    #[cfg(unix)]
    std::fs::File::open(config_dir)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn desktop_update_channel(
    state: State<'_, Mutex<ChannelUpdates>>,
) -> Result<ChannelId, String> {
    Ok(state.lock().map_err(|error| error.to_string())?.selected)
}

#[tauri::command]
pub(crate) fn desktop_select_update_channel(
    app: tauri::AppHandle,
    state: State<'_, Mutex<ChannelUpdates>>,
    channel: ChannelId,
) -> Result<(), String> {
    let mut updates = state.lock().map_err(|error| error.to_string())?;
    if updates.installing {
        return Err("Wait for installation to finish before changing channels".into());
    }
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    persist_selection(&config_dir, channel)?;
    updates.selected = channel;
    updates.generation = updates.generation.wrapping_add(1);
    updates.candidate = None;
    Ok(())
}

#[tauri::command]
pub(crate) fn desktop_clear_update_candidate(
    state: State<'_, Mutex<ChannelUpdates>>,
    generation: u64,
) -> Result<(), String> {
    let mut updates = state.lock().map_err(|error| error.to_string())?;
    if updates.installing {
        return Err("Installation is in progress".into());
    }
    if updates.generation == generation {
        updates.generation = updates.generation.wrapping_add(1);
        updates.candidate = None;
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Discovery {
    schema_version: u8,
    channels: Vec<ChannelEntry>,
}

#[derive(Deserialize)]
struct ChannelEntry {
    id: String,
}

#[derive(Deserialize)]
struct VersionInfo {
    version: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChannelCheckResult {
    channel: ChannelId,
    generation: u64,
    version: Option<String>,
    notes: Option<String>,
    waiting_for_stable: bool,
}

async fn bounded_json<T: for<'a> Deserialize<'a>>(
    mut response: reqwest::Response,
) -> Result<T, String> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err("Update service response is too large".into());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
        if body.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err("Update service response is too large".into());
        }
        body.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&body).map_err(|error| error.to_string())
}

fn numeric_version(value: &str) -> Result<(u32, u32, u32), String> {
    let parts = value.split('.').collect::<Vec<_>>();
    if parts.len() != 3
        || parts
            .iter()
            .any(|part| part.is_empty() || !part.bytes().all(|byte| byte.is_ascii_digit()))
    {
        return Err(format!("Invalid desktop update version: {value}"));
    }
    Ok((
        parts[0]
            .parse()
            .map_err(|_| "Invalid major update version")?,
        parts[1]
            .parse()
            .map_err(|_| "Invalid minor update version")?,
        parts[2]
            .parse()
            .map_err(|_| "Invalid patch update version")?,
    ))
}

async fn discover_at(
    root: &str,
    channel: ChannelId,
    current_version: &str,
) -> Result<(bool, bool), String> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::builder()
        .timeout(CHECK_TIMEOUT)
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .get(format!("{root}/channels"))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return if channel == ChannelId::Stable {
            Ok((false, false))
        } else {
            Err("The update service does not offer Latest yet".into())
        };
    }
    let discovery: Discovery = bounded_json(
        response
            .error_for_status()
            .map_err(|error| error.to_string())?,
    )
    .await?;
    if discovery.schema_version != 1
        || !discovery
            .channels
            .iter()
            .any(|entry| entry.id == channel.as_str())
    {
        return Err(format!(
            "The update service does not offer {}",
            channel.as_str()
        ));
    }
    let response = client
        .get(format!("{root}/version?channel={}", channel.as_str()))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if response
        .headers()
        .get("X-Update-Channel")
        .and_then(|value| value.to_str().ok())
        != Some(channel.as_str())
    {
        return Err("The update service did not confirm the selected channel".into());
    }
    let available: VersionInfo = bounded_json(
        response
            .error_for_status()
            .map_err(|error| error.to_string())?,
    )
    .await?;
    let waiting = channel == ChannelId::Stable
        && numeric_version(current_version)? > numeric_version(&available.version)?;
    Ok((true, waiting))
}

#[tauri::command]
pub(crate) async fn desktop_check_update(
    app: tauri::AppHandle,
    state: State<'_, Mutex<ChannelUpdates>>,
    product: State<'_, crate::DesktopProduct>,
    reason: String,
) -> Result<ChannelCheckResult, String> {
    if !matches!(reason.as_str(), "startup" | "periodic" | "manual") {
        return Err("Invalid update check reason".into());
    }
    let installation_id = product
        .0
        .updater_installation_id()
        .map_err(|error| format!("read updater installation policy: {error}"))?;
    // Sent without any identifier, so opted-out installations can be
    // counted and the population estimated from the identified sample.
    let statistics = product
        .0
        .updater_statistics()
        .map_err(|error| format!("read updater statistics choice: {error}"))?;
    let (channel, generation) = {
        let mut updates = state.lock().map_err(|error| error.to_string())?;
        if updates.installing {
            return Err("Installation is in progress".into());
        }
        updates.generation = updates.generation.wrapping_add(1);
        updates.candidate = None;
        (updates.selected, updates.generation)
    };
    let (root, endpoint) = update_routes(&app.config().identifier)?;
    let (supported, waiting_for_stable) =
        discover_at(root, channel, env!("CARGO_PKG_VERSION")).await?;
    let endpoint = if supported {
        format!("{endpoint}?channel={}", channel.as_str())
    } else {
        endpoint.to_owned()
    };
    let mut builder = app
        .updater_builder()
        .endpoints(vec![
            endpoint
                .parse()
                .map_err(|error: url::ParseError| error.to_string())?,
        ])
        .map_err(|error| error.to_string())?
        .header("X-Check-Reason", reason)
        .map_err(|error| error.to_string())?
        .header("X-Statistics", statistics.as_str())
        .map_err(|error| error.to_string())?
        .timeout(CHECK_TIMEOUT);
    if let Some(id) = installation_id {
        builder = builder
            .header("X-CFU-Id", id)
            .map_err(|error| error.to_string())?;
    }
    let mut candidate = builder
        .build()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?;
    if let Some(update) = &mut candidate {
        // The updater reuses check headers for the asset download. Keep the
        // installation identifier, check reason and statistics choice on the
        // product route only.
        update.headers.clear();
    }
    if supported
        && candidate.as_ref().is_some_and(|update| {
            update
                .raw_json
                .get("channel")
                .and_then(serde_json::Value::as_str)
                != Some(channel.as_str())
        })
    {
        return Err("Update candidate did not confirm the selected channel".into());
    }
    let mut updates = state.lock().map_err(|error| error.to_string())?;
    if updates.generation != generation || updates.selected != channel || updates.installing {
        return Err("Update check was superseded by a channel change".into());
    }
    let result = ChannelCheckResult {
        channel,
        generation,
        version: candidate.as_ref().map(|update| update.version.clone()),
        notes: candidate.as_ref().and_then(|update| update.body.clone()),
        waiting_for_stable,
    };
    updates.candidate = candidate;
    Ok(result)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstallProgress {
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    installing: bool,
}

#[tauri::command]
pub(crate) async fn desktop_install_update(
    state: State<'_, Mutex<ChannelUpdates>>,
    generation: u64,
    progress: Channel<InstallProgress>,
) -> Result<(), String> {
    use tauri::utils::{config::BundleType, platform::bundle_type};
    if !matches!(
        bundle_type(),
        Some(BundleType::App | BundleType::Nsis | BundleType::AppImage)
    ) {
        return Err("This package must be updated through its package manager".into());
    }
    let update = {
        let mut updates = state.lock().map_err(|error| error.to_string())?;
        if updates.installing || updates.generation != generation {
            return Err("Update candidate is no longer current".into());
        }
        let update = updates
            .candidate
            .clone()
            .ok_or("Check for an update first")?;
        updates.installing = true;
        update
    };
    let mut downloaded_bytes = 0;
    let result = update
        .download_and_install(
            |bytes, total_bytes| {
                downloaded_bytes += bytes as u64;
                let _ = progress.send(InstallProgress {
                    downloaded_bytes,
                    total_bytes,
                    installing: false,
                });
            },
            || {
                let _ = progress.send(InstallProgress {
                    downloaded_bytes: 0,
                    total_bytes: None,
                    installing: true,
                });
            },
        )
        .await;
    if result.is_err() {
        state.lock().map_err(|error| error.to_string())?.installing = false;
    }
    result.map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    #[test]
    fn update_routes_are_bound_to_product_identity() {
        let (root, endpoint) = super::update_routes("com.jstorrent.desktop").unwrap();
        assert_eq!(root, "https://updates.jstorrent.com");
        assert!(endpoint.starts_with("https://updates.jstorrent.com/tauri/"));
        assert!(!endpoint.contains("rstorrent"));
        let (root, endpoint) = super::update_routes("com.jstorrent.rstorrent").unwrap();
        assert_eq!(root, "https://updates.graehlarts.com/rstorrent");
        assert!(endpoint.starts_with("https://updates.graehlarts.com/rstorrent/tauri/"));
        assert!(super::update_routes("com.jstorrent.desktop.attacker").is_err());
    }

    use super::*;
    use std::io::{Read, Write};

    fn fixture(
        responses: Vec<(&'static str, &'static str, &'static str)>,
    ) -> (String, std::thread::JoinHandle<()>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let root = format!("http://{}", listener.local_addr().unwrap());
        let handle = std::thread::spawn(move || {
            for (status, headers, body) in responses {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = [0_u8; 2048];
                let _ = stream.read(&mut request);
                let response = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n{headers}\r\n{body}",
                    body.len()
                );
                stream.write_all(response.as_bytes()).unwrap();
            }
        });
        (root, handle)
    }

    #[test]
    fn old_and_invalid_preferences_default_to_stable() {
        let directory = tempfile::tempdir().unwrap();
        assert_eq!(
            ChannelUpdates::open(directory.path()).selected,
            ChannelId::Stable
        );
        persist_selection(directory.path(), ChannelId::Latest).unwrap();
        assert_eq!(
            ChannelUpdates::open(directory.path()).selected,
            ChannelId::Latest
        );
        std::fs::write(directory.path().join(SELECTION_FILE), "invalid").unwrap();
        assert_eq!(
            ChannelUpdates::open(directory.path()).selected,
            ChannelId::Stable
        );
        std::fs::write(directory.path().join(SELECTION_FILE), "x".repeat(100)).unwrap();
        assert_eq!(
            ChannelUpdates::open(directory.path()).selected,
            ChannelId::Stable
        );
    }

    #[test]
    fn latest_train_precedes_next_stable_release() {
        assert!(numeric_version("0.1.4").unwrap() < numeric_version("0.2.101").unwrap());
        assert!(numeric_version("0.2.101").unwrap() < numeric_version("0.3.0").unwrap());
        assert!(numeric_version("0.2.101").unwrap() > numeric_version("0.1.4").unwrap());
    }

    #[tokio::test]
    async fn stable_legacy_fallback_and_latest_fail_closed() {
        let (root, server) = fixture(vec![("404 Not Found", "", "{}")]);
        assert_eq!(
            discover_at(&root, ChannelId::Stable, "0.1.4")
                .await
                .unwrap(),
            (false, false)
        );
        server.join().unwrap();

        let (root, server) = fixture(vec![("404 Not Found", "", "{}")]);
        assert!(
            discover_at(&root, ChannelId::Latest, "0.1.4")
                .await
                .is_err()
        );
        server.join().unwrap();
    }

    #[tokio::test]
    async fn explicit_channel_requires_discovery_and_response_confirmation() {
        let discovery = r#"{"schemaVersion":1,"channels":[{"id":"stable"},{"id":"latest"}]}"#;
        let (root, server) = fixture(vec![
            ("200 OK", "", discovery),
            ("200 OK", "", r#"{"version":"0.2.101"}"#),
        ]);
        assert!(
            discover_at(&root, ChannelId::Latest, "0.1.4")
                .await
                .is_err()
        );
        server.join().unwrap();

        let (root, server) = fixture(vec![
            ("200 OK", "", discovery),
            (
                "200 OK",
                "X-Update-Channel: stable\r\n",
                r#"{"version":"0.2.101"}"#,
            ),
        ]);
        assert!(
            discover_at(&root, ChannelId::Latest, "0.1.4")
                .await
                .is_err()
        );
        server.join().unwrap();
    }

    #[tokio::test]
    async fn stable_waits_for_newer_release_after_latest_is_installed() {
        let (root, server) = fixture(vec![
            (
                "200 OK",
                "",
                r#"{"schemaVersion":1,"channels":[{"id":"stable"}]}"#,
            ),
            (
                "200 OK",
                "X-Update-Channel: stable\r\n",
                r#"{"version":"0.1.4"}"#,
            ),
        ]);
        assert_eq!(
            discover_at(&root, ChannelId::Stable, "0.2.101")
                .await
                .unwrap(),
            (true, true)
        );
        server.join().unwrap();
    }
}
