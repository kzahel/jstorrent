use std::{path::Path, sync::Mutex, time::Duration};

use serde::{Deserialize, Serialize};
use tauri::{Manager, State, ipc::Channel};

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
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Stable => "stable",
            Self::Latest => "latest",
        }
    }
}

#[derive(Clone)]
pub(crate) struct CheckedUpdate {
    pub(crate) version: String,
    pub(crate) body: Option<String>,
    pub(crate) signature: String,
    pub(crate) download_url: url::Url,
    pub(crate) compatibility: Option<crate::update_compatibility::SignedCompatibility>,
}

#[derive(Deserialize)]
struct UpdateManifest {
    version: String,
    #[serde(default)]
    notes: Option<String>,
    url: url::Url,
    signature: String,
    #[serde(default)]
    compatibility: Option<crate::update_compatibility::SignedCompatibility>,
    #[serde(default)]
    channel: Option<String>,
}

fn checked_manifest(
    manifest: UpdateManifest,
    current: &str,
    channel: ChannelId,
    confirm_channel: bool,
) -> Result<Option<CheckedUpdate>, String> {
    if confirm_channel && manifest.channel.as_deref() != Some(channel.as_str()) {
        return Err("Update candidate did not confirm the selected channel".into());
    }
    if numeric_version(&manifest.version)? <= numeric_version(current)? {
        return Ok(None);
    }
    if manifest.url.scheme() != "https"
        || !manifest.url.username().is_empty()
        || manifest.url.password().is_some()
        || manifest.url.fragment().is_some()
        || manifest.signature.len() > 4096
        || manifest
            .notes
            .as_ref()
            .is_some_and(|notes| notes.len() > 16_384)
    {
        return Err("Update candidate contains invalid or oversized fields".into());
    }
    Ok(Some(CheckedUpdate {
        version: manifest.version,
        body: manifest.notes,
        signature: manifest.signature,
        download_url: manifest.url,
        compatibility: manifest.compatibility,
    }))
}

#[derive(Default)]
pub(crate) struct ChannelUpdates {
    pub(crate) selected: ChannelId,
    pub(crate) generation: u64,
    pub(crate) candidate: Option<CheckedUpdate>,
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
    if app
        .try_state::<std::sync::Arc<crate::automatic_updates::AutomaticUpdates>>()
        .is_some()
    {
        return Err("Use the host update controls".into());
    }
    select_update_channel(app, state, channel)
}

pub(crate) fn select_update_channel(
    app: tauri::AppHandle,
    state: State<'_, Mutex<ChannelUpdates>>,
    channel: ChannelId,
) -> Result<(), String> {
    let mut updates = state.lock().map_err(|error| error.to_string())?;
    if updates.installing {
        return Err("Wait for installation to finish before changing channels".into());
    }
    let config_dir = match crate::debug_data_root_override() {
        Some(root) => root.join("config"),
        None => app
            .path()
            .app_config_dir()
            .map_err(|error| error.to_string())?,
    };
    persist_selection(&config_dir, channel)?;
    updates.selected = channel;
    updates.generation = updates.generation.wrapping_add(1);
    updates.candidate = None;
    Ok(())
}

#[tauri::command]
pub(crate) fn desktop_clear_update_candidate(
    app: tauri::AppHandle,
    state: State<'_, Mutex<ChannelUpdates>>,
    generation: u64,
) -> Result<(), String> {
    if app
        .try_state::<std::sync::Arc<crate::automatic_updates::AutomaticUpdates>>()
        .is_some()
    {
        return Err("The desktop host owns update state".into());
    }
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
    pub(crate) channel: ChannelId,
    pub(crate) generation: u64,
    pub(crate) version: Option<String>,
    pub(crate) notes: Option<String>,
    pub(crate) waiting_for_stable: bool,
    pub(crate) blocked_reason: Option<String>,
    pub(crate) automatic_allowed: bool,
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

pub(crate) fn update_http_client(url: &str) -> reqwest::ClientBuilder {
    let builder =
        reqwest::Client::builder().redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.url().scheme() != "https"
                || !attempt.url().username().is_empty()
                || attempt.url().password().is_some()
            {
                attempt.error("Update redirects must use credential-free HTTPS")
            } else if attempt.previous().len() >= 5 {
                attempt.error("Too many update redirects")
            } else {
                attempt.follow()
            }
        }));
    #[cfg(feature = "update-qualification")]
    if option_env!("JSTORRENT_QUALIFICATION_UPDATE_ROOT").is_some_and(|root| url.starts_with(root))
        && let Some(pem) = option_env!("JSTORRENT_QUALIFICATION_CA_PEM")
    {
        if let Ok(certificate) = reqwest::Certificate::from_pem(pem.as_bytes()) {
            return builder.tls_certs_merge([certificate]);
        }
    }
    let _ = url;
    builder
}

async fn discover_at(
    root: &str,
    channel: ChannelId,
    current_version: &str,
) -> Result<(bool, bool), String> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = update_http_client(root)
        .redirect(reqwest::redirect::Policy::none())
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
    // An explicitly confirmed, healthy empty channel still permits the
    // installation-specific platform check (including an owned trial cohort).
    if response.status() == reqwest::StatusCode::NO_CONTENT {
        return Ok((true, false));
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
    reason: String,
) -> Result<ChannelCheckResult, String> {
    if app
        .try_state::<std::sync::Arc<crate::automatic_updates::AutomaticUpdates>>()
        .is_some()
    {
        return Err("Use the host update controls".into());
    }
    check_update(app, state, reason).await
}

pub(crate) async fn check_update(
    app: tauri::AppHandle,
    state: State<'_, Mutex<ChannelUpdates>>,
    reason: String,
) -> Result<ChannelCheckResult, String> {
    if !matches!(reason.as_str(), "startup" | "periodic" | "manual") {
        return Err("Invalid update check reason".into());
    }
    let (installation_id, statistics) =
        if let Some(product) = app.try_state::<crate::DesktopProduct>() {
            (
                product
                    .0
                    .updater_installation_id()
                    .map_err(|error| error.to_string())?,
                product
                    .0
                    .updater_statistics()
                    .map_err(|error| error.to_string())?
                    .as_str(),
            )
        } else {
            (None, "unreviewed")
        };
    let (channel, generation) = {
        let mut updates = state.lock().map_err(|error| error.to_string())?;
        if updates.installing {
            return Err("Installation is in progress".into());
        }
        updates.generation = updates.generation.wrapping_add(1);
        updates.candidate = None;
        (updates.selected, updates.generation)
    };
    let (root, endpoint) =
        qualification_routes(&app).unwrap_or_else(|| update_routes(&app.config().identifier))?;
    let (supported, mut waiting_for_stable) =
        discover_at(root, channel, env!("CARGO_PKG_VERSION")).await?;
    let endpoint = if supported {
        format!("{endpoint}?channel={}", channel.as_str())
    } else {
        endpoint.to_owned()
    };
    let endpoint = endpoint
        .replace(
            "{{target}}",
            std::env::consts::OS.replace("macos", "darwin").as_str(),
        )
        .replace("{{arch}}", std::env::consts::ARCH)
        .replace("{{current_version}}", env!("CARGO_PKG_VERSION"));
    let client = update_http_client(&endpoint)
        // Check headers carry preference-controlled product context. Never
        // forward them to another origin through an HTTP redirect.
        .redirect(reqwest::redirect::Policy::none())
        .timeout(CHECK_TIMEOUT)
        .build()
        .map_err(|error| error.to_string())?;
    let mut request = client
        .get(endpoint)
        .header("X-Check-Reason", reason)
        .header("X-Statistics", statistics);
    if let Some(id) = installation_id {
        request = request.header("X-CFU-Id", id);
    }
    let response = request.send().await.map_err(|error| error.to_string())?;
    let automatic_allowed = response
        .headers()
        .get("X-Automatic-Install")
        .and_then(|value| value.to_str().ok())
        == Some("true");
    let candidate = if response.status() == reqwest::StatusCode::NO_CONTENT {
        None
    } else {
        let manifest: UpdateManifest = bounded_json(
            response
                .error_for_status()
                .map_err(|error| error.to_string())?,
        )
        .await?;
        checked_manifest(manifest, env!("CARGO_PKG_VERSION"), channel, supported)?
    };
    let mut blocked_reason = None;
    let candidate = match candidate {
        Some(update) => match crate::update_compatibility::admit(&app, &update) {
            Ok(()) => Some(update),
            Err(reason) => {
                waiting_for_stable = channel == ChannelId::Stable;
                blocked_reason = Some(reason);
                None
            }
        },
        None => None,
    };
    let mut updates = state.lock().map_err(|error| error.to_string())?;
    if updates.generation != generation || updates.selected != channel || updates.installing {
        return Err("Update check was superseded by a channel change".into());
    }
    let result = ChannelCheckResult {
        channel,
        generation,
        version: candidate.as_ref().map(|update| update.version.clone()),
        notes: candidate.as_ref().and_then(|update| update.body.clone()),
        waiting_for_stable: waiting_for_stable && candidate.is_none(),
        blocked_reason,
        automatic_allowed,
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
    app: tauri::AppHandle,
    state: State<'_, Mutex<ChannelUpdates>>,
    generation: u64,
    progress: Channel<InstallProgress>,
) -> Result<(), String> {
    use tauri::utils::{config::BundleType, platform::bundle_type};
    if app
        .try_state::<std::sync::Arc<crate::automatic_updates::AutomaticUpdates>>()
        .is_some()
    {
        return Err("Use the host update controls to install this update".into());
    }
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
    let result = async {
        let client = update_http_client(update.download_url.as_str())
            .timeout(Duration::from_secs(1800))
            .build()
            .map_err(|error| error.to_string())?;
        // Product check headers are deliberately absent on artifact requests.
        let mut response = client
            .get(update.download_url.clone())
            .send()
            .await
            .map_err(|error| error.to_string())?
            .error_for_status()
            .map_err(|error| error.to_string())?;
        let total_bytes = response.content_length();
        let mut bytes = Vec::new();
        if total_bytes
            .is_some_and(|size| size > crate::automatic_updates::MAX_ARTIFACT_BYTES as u64)
        {
            return Err("Update exceeds its byte limit".to_owned());
        }
        while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
            if bytes.len().saturating_add(chunk.len())
                > crate::automatic_updates::MAX_ARTIFACT_BYTES
            {
                return Err("Update exceeds its byte limit".to_owned());
            }
            bytes.extend_from_slice(&chunk);
            let _ = progress.send(InstallProgress {
                downloaded_bytes: bytes.len() as u64,
                total_bytes,
                installing: false,
            });
        }
        crate::automatic_updates::verify(&app, &bytes, &update.signature)?;
        crate::update_compatibility::admit(&app, &update)?;
        crate::update_install::validate_payload(&bytes)?;
        crate::update_install::preflight(&app, &bytes)?;
        let _ = progress.send(InstallProgress {
            downloaded_bytes: bytes.len() as u64,
            total_bytes,
            installing: true,
        });
        let cache = app
            .path()
            .app_config_dir()
            .map_err(|error| error.to_string())?
            .join("update-cache");
        std::fs::create_dir_all(&cache).map_err(|error| error.to_string())?;
        let focus_cutoff = crate::update_install::last_input_millis();
        let prepared = crate::update_install::PreparedInstall {
            relaunch_token: uuid::Uuid::new_v4().simple().to_string(),
            version: update.version.clone(),
            bytes,
            presentation: crate::update_install::Presentation::capture(&app),
            focus_cutoff,
            cache,
        };
        if app.try_state::<crate::DesktopState>().is_some() {
            if !crate::request_update_shutdown(&app, prepared) {
                return Err("Desktop is already stopping".into());
            }
            crate::wait_for_application_shutdown(&app.state::<crate::DesktopState>()).await
        } else {
            crate::update_install::install(&app, prepared)
        }
    }
    .await;
    if result.is_err() {
        state.lock().map_err(|error| error.to_string())?.installing = false;
    }
    result
}

fn qualification_routes(
    app: &tauri::AppHandle,
) -> Option<Result<(&'static str, &'static str), String>> {
    #[cfg(feature = "update-qualification")]
    if app
        .config()
        .identifier
        .starts_with("com.jstorrent.qualification.")
    {
        return Some(
            match (
                option_env!("JSTORRENT_QUALIFICATION_UPDATE_ROOT"),
                option_env!("JSTORRENT_QUALIFICATION_UPDATE_ENDPOINT"),
            ) {
                (Some(root), Some(endpoint))
                    if root.starts_with("https://") && endpoint.starts_with(root) =>
                {
                    Ok((root, endpoint))
                }
                _ => Err("Qualification update route is not configured".into()),
            },
        );
    }
    let _ = app;
    None
}

#[cfg(test)]
mod tests {
    #[test]
    fn manifests_reject_downgrades_channel_mismatch_and_unsafe_artifacts() {
        let manifest = |url: &str, version: &str| UpdateManifest {
            compatibility: None,
            version: version.into(),
            notes: None,
            url: url.parse().unwrap(),
            signature: "signed".into(),
            channel: Some("stable".into()),
        };
        assert!(
            checked_manifest(
                manifest("https://example.test/update", "0.3.0"),
                "0.3.1",
                ChannelId::Stable,
                true
            )
            .unwrap()
            .is_none()
        );
        assert!(
            checked_manifest(
                manifest("https://example.test/update", "0.3.2"),
                "0.3.1",
                ChannelId::Latest,
                true
            )
            .is_err()
        );
        for url in [
            "http://example.test/update",
            "https://user:secret@example.test/update",
            "https://example.test/update#fragment",
        ] {
            assert!(
                checked_manifest(manifest(url, "0.3.2"), "0.3.1", ChannelId::Stable, true).is_err()
            );
        }
        let mut oversized = manifest("https://example.test/update", "0.3.2");
        oversized.notes = Some("x".repeat(16_385));
        assert!(checked_manifest(oversized, "0.3.1", ChannelId::Stable, true).is_err());
    }

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
    #[tokio::test]
    async fn confirmed_empty_channel_is_healthy_but_unavailable_upstream_is_not() {
        let channels = r#"{"schemaVersion":1,"channels":[{"id":"latest"}]}"#;
        let (root, server) = fixture(vec![
            ("200 OK", "", channels),
            ("204 No Content", "X-Update-Channel: latest\r\n", ""),
        ]);
        assert_eq!(
            discover_at(&root, ChannelId::Latest, "0.3.1")
                .await
                .unwrap(),
            (true, false)
        );
        server.join().unwrap();
        let (root, server) = fixture(vec![
            ("200 OK", "", channels),
            (
                "500 Internal Server Error",
                "X-Update-Channel: latest\r\n",
                "{}",
            ),
        ]);
        assert!(
            discover_at(&root, ChannelId::Latest, "0.3.1")
                .await
                .is_err()
        );
        server.join().unwrap();
    }
}
