//! One desktop-owned update lifecycle, independent of webview lifetime.
use crate::update_channels::{self, ChannelId, ChannelUpdates};
use crate::update_policy::{Eligibility, UpdatePolicy};
use base64::Engine as _;
use rstorrent_session::{
    DesktopUpdateAttempt, HostUpdateControl, HostUpdateRequest, HostUpdateSnapshot,
    ProductStateOwner,
};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;

pub(crate) const MAX_ARTIFACT_BYTES: usize = 512 * 1024 * 1024;
const UPDATE_EVENT: &str = "jstorrent://update-state";

pub(crate) struct AutomaticUpdates {
    app: tauri::AppHandle,
    product: ProductStateOwner,
    cache: PathBuf,
    started: Instant,
    state: Mutex<OwnerState>,
    wake: Notify,
    cancel: CancellationToken,
    task: tokio::sync::Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

enum Preparation {
    Committed,
    Deferred,
    RetryCheck(String),
}

struct OwnerState {
    policy: UpdatePolicy,
    snapshot: HostUpdateSnapshot,
    check_requested: bool,
    install_requested: bool,
    install_intent: u64,
    committed: bool,
    failed_version: Option<String>,
}

impl std::fmt::Debug for AutomaticUpdates {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AutomaticUpdates").finish_non_exhaustive()
    }
}

impl AutomaticUpdates {
    pub(crate) fn open(
        app: tauri::AppHandle,
        product: ProductStateOwner,
        config: &Path,
    ) -> Result<Arc<Self>, String> {
        let stored = product
            .desktop_update_state()
            .map_err(|error| error.to_string())?;
        let can_install = matches!(
            tauri::utils::platform::bundle_type(),
            Some(
                tauri::utils::config::BundleType::App
                    | tauri::utils::config::BundleType::Nsis
                    | tauri::utils::config::BundleType::AppImage
            )
        );
        let channel = app
            .state::<Mutex<ChannelUpdates>>()
            .lock()
            .map_err(|error| error.to_string())?
            .selected;
        let failed_version = stored
            .attempt
            .as_ref()
            .filter(|attempt| !attempt.succeeded)
            .map(|attempt| attempt.version.clone());
        let owner = Arc::new(Self {
            app: app.clone(),
            product,
            cache: config.join("update-cache"),
            started: Instant::now(),
            state: Mutex::new(OwnerState {
                policy: update_policy(
                    stored.automatic_install && qualification_available(&app),
                    &app,
                ),
                snapshot: HostUpdateSnapshot {
                    phase: if can_install {
                        "idle"
                    } else {
                        "manual-install"
                    }
                    .into(),
                    version: None,
                    notes: None,
                    message: None,
                    last_outcome: stored.attempt,
                    downloaded_bytes: 0,
                    total_bytes: None,
                    restart_in_seconds: None,
                    automatic_install: stored.automatic_install,
                    automatic_available: qualification_available(&app),
                    channel: channel.as_str().into(),
                    can_install,
                    package: match tauri::utils::platform::bundle_type() {
                        Some(tauri::utils::config::BundleType::App) => "app",
                        Some(tauri::utils::config::BundleType::Nsis) => "nsis",
                        Some(tauri::utils::config::BundleType::AppImage) => "appimage",
                        Some(tauri::utils::config::BundleType::Msi) => "msi",
                        Some(tauri::utils::config::BundleType::Deb) => "deb",
                        Some(tauri::utils::config::BundleType::Rpm) => "rpm",
                        _ => "unknown",
                    }
                    .into(),
                },
                check_requested: false,
                install_requested: false,
                install_intent: 0,
                committed: false,
                failed_version,
            }),
            wake: Notify::new(),
            cancel: CancellationToken::new(),
            task: tokio::sync::Mutex::new(None),
        });
        Ok(owner)
    }

    fn now(&self) -> u64 {
        self.started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64
    }
    fn observe_clock(&self) {
        let wall = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            .min(u128::from(u64::MAX)) as u64;
        self.state
            .lock()
            .unwrap()
            .policy
            .observe_wall_clock(self.now(), wall);
    }
    fn change(&self, f: impl FnOnce(&mut OwnerState)) {
        let snapshot = {
            let mut state = self.state.lock().expect("update state");
            f(&mut state);
            state.snapshot.clone()
        };
        let _ = self.app.emit(UPDATE_EVENT, snapshot);
    }
    pub(crate) fn start(self: &Arc<Self>) {
        if let Ok(stored) = self.product.desktop_update_state()
            && let Some(attempt) = stored.attempt
            && attempt.version == env!("CARGO_PKG_VERSION")
            && !attempt.succeeded
        {
            let result = DesktopUpdateAttempt {
                version: attempt.version,
                succeeded: true,
                message: format!("Updated to {}", env!("CARGO_PKG_VERSION")),
            };
            if self.product.record_desktop_update_attempt(&result).is_ok() {
                self.change(|state| {
                    state.failed_version = None;
                    state.snapshot.last_outcome = Some(result.clone());
                    state.snapshot.message = Some(result.message);
                });
            }
        }
        let owner = self.clone();
        *self.task.blocking_lock() = Some(tauri::async_runtime::spawn(async move {
            owner.run().await;
        }));
    }
    pub(crate) fn installation_failed(&self, message: &str) {
        let outcome = self
            .product
            .desktop_update_state()
            .ok()
            .and_then(|stored| stored.attempt);
        self.change(|state| {
            state.snapshot.phase = "error".into();
            state.snapshot.restart_in_seconds = None;
            state.snapshot.message = Some(message.to_owned());
            state.snapshot.last_outcome = outcome;
        });
    }

    pub(crate) async fn stop(&self) {
        self.cancel.cancel();
        if let Some(task) = self.task.lock().await.take() {
            let _ = task.await;
        }
    }
    async fn run(self: Arc<Self>) {
        let mut next_check = Instant::now() + Duration::from_secs(5);
        let mut tick = tokio::time::interval(Duration::from_secs(1));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut check_failures = 0usize;
        loop {
            tokio::select! { biased;
                () = self.cancel.cancelled() => break,
                () = self.wake.notified() => {},
                _ = tick.tick() => {},
            }
            self.observe_clock();
            let (check, manual_install, install_intent) = {
                let mut state = self.state.lock().unwrap();
                (
                    std::mem::take(&mut state.check_requested),
                    std::mem::take(&mut state.install_requested),
                    state.install_intent,
                )
            };
            if !self.state.lock().unwrap().snapshot.can_install {
                continue;
            }
            if check || Instant::now() >= next_check {
                let channel = self
                    .app
                    .state::<Mutex<ChannelUpdates>>()
                    .lock()
                    .unwrap()
                    .selected;
                let cadence = if channel == ChannelId::Latest {
                    1800
                } else {
                    86400
                };
                next_check = Instant::now() + jittered_delay(cadence);
                self.change(|state| {
                    state.snapshot.phase = "checking".into();
                    state.snapshot.restart_in_seconds = None;
                    state.snapshot.channel = channel.as_str().into();
                });
                let result = tokio::select! { biased;
                    () = self.cancel.cancelled() => break,
                    result = self.while_active(self.check_and_stage(check)) => result,
                };
                if let Err(error) = result {
                    self.change(|state| {
                        state.snapshot.phase = "error".into();
                        state.snapshot.message = Some(error);
                    });
                    let delay = [300, 1800, 7200]
                        .get(check_failures)
                        .copied()
                        .unwrap_or(cadence)
                        .min(cadence);
                    check_failures = check_failures.saturating_add(1);
                    next_check = Instant::now() + jittered_delay(delay);
                } else {
                    check_failures = 0;
                }
            }
            if self.state.lock().unwrap().snapshot.version.is_none() {
                continue;
            }
            if manual_install {
                let result = tokio::select! { biased; () = self.cancel.cancelled() => break, result = self.while_active(self.stage_current(true)) => result };
                if let Err(error) = result {
                    self.change(|state| {
                        state.snapshot.phase = "error".into();
                        state.snapshot.message = Some(error);
                    });
                    continue;
                }
            }
            if !self.cache.join("payload").is_file() {
                continue;
            }
            if !manual_install {
                let state = self.state.lock().unwrap();
                if state.failed_version == state.snapshot.version {
                    continue;
                }
            }
            let native_inactive = matches!(
                crate::update_install::Presentation::capture(&self.app),
                crate::update_install::Presentation::Hidden
                    | crate::update_install::Presentation::Minimized
            );
            let blocked = self.blocked().await;
            let decision = {
                let mut state = self.state.lock().unwrap();
                if native_inactive {
                    state
                        .policy
                        .native_inactive(crate::MAIN_WINDOW_LABEL, self.now());
                }
                let blocked = blocked || state.failed_version == state.snapshot.version;
                state.policy.evaluate(self.now(), blocked)
            };
            if manual_install || decision == Eligibility::Install {
                match self
                    .while_active(self.prepare_install(manual_install, install_intent))
                    .await
                {
                    Err(error) => {
                        self.change(|state| {
                            state.snapshot.phase = "error".into();
                            state.snapshot.message = Some(error);
                            state.failed_version = state.snapshot.version.clone();
                        });
                    }
                    Ok(Preparation::Committed) => break,
                    Ok(Preparation::Deferred) => {}
                    Ok(Preparation::RetryCheck(error)) => {
                        self.change(|state| {
                            state.snapshot.phase = "error".into();
                            state.snapshot.version = None;
                            state.snapshot.restart_in_seconds = None;
                            state.snapshot.message = Some(error);
                        });
                        next_check = Instant::now() + jittered_delay(300);
                    }
                }
            } else {
                self.change(|state| {
                    state.snapshot.phase = "available".into();
                    state.snapshot.restart_in_seconds = match decision {
                        Eligibility::Notice(seconds) => Some(seconds),
                        _ => None,
                    };
                    state.snapshot.message = Some(match decision {
                        Eligibility::Blocked => {
                            "Downloaded; waiting for playback, unfinished work or connected clients"
                                .into()
                        }
                        Eligibility::Disabled if !state.snapshot.automatic_available => {
                            "Downloaded; choose Install & restart to finish the update".into()
                        }
                        Eligibility::Disabled => "Downloaded; automatic installation is off".into(),
                        Eligibility::Notice(_) => "Restarting shortly to install the update".into(),
                        _ => "Downloaded; waiting until you're away".into(),
                    });
                });
            }
        }
    }
    async fn while_active<T>(
        &self,
        future: impl std::future::Future<Output = Result<T, String>>,
    ) -> Result<T, String> {
        tokio::pin!(future);
        let mut clock = tokio::time::interval(Duration::from_secs(1));
        clock.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tokio::select! { biased;
                () = self.cancel.cancelled() => return Err("Update work canceled during shutdown".into()),
                _ = clock.tick() => self.observe_clock(),
                result = &mut future => return result,
            }
        }
    }

    async fn check_and_stage(&self, manual: bool) -> Result<(), String> {
        let result = update_channels::check_update(
            self.app.clone(),
            self.app.state(),
            if manual { "manual" } else { "periodic" }.into(),
        )
        .await?;
        self.change(|state| {
            state.snapshot.automatic_available = automatic_available(&self.app)
                && (result.automatic_allowed || qualification_available(&self.app));
            state.policy.enabled =
                state.snapshot.automatic_install && state.snapshot.automatic_available;
            state.snapshot.phase = if result.waiting_for_stable {
                "waiting-for-stable"
            } else if result.blocked_reason.is_some() {
                "incompatible"
            } else if result.version.is_some() {
                "available"
            } else {
                "up-to-date"
            }
            .into();
            state.snapshot.version = result.version;
            state.snapshot.notes = result.notes;
            state.snapshot.message = result.blocked_reason;
            state.policy.candidate_changed();
        });
        let should_stage = {
            let state = self.state.lock().unwrap();
            state.policy.enabled
                && state.snapshot.version.is_some()
                && state.snapshot.version != state.failed_version
                && state.snapshot.can_install
        };
        if should_stage {
            self.stage_current(false).await?;
        }
        Ok(())
    }
    fn candidate(&self) -> Result<update_channels::CheckedUpdate, String> {
        self.app
            .state::<Mutex<ChannelUpdates>>()
            .lock()
            .map_err(|error| error.to_string())?
            .candidate
            .clone()
            .ok_or_else(|| "Check for an update first".into())
    }
    async fn stage_current(&self, manual: bool) -> Result<(), String> {
        let update = self.candidate()?;
        crate::update_compatibility::admit(&self.app, &update)?;
        std::fs::create_dir_all(&self.cache).map_err(|error| error.to_string())?;
        let metadata = serde_json::to_vec(&(
            update.version.clone(),
            update.signature.clone(),
            update.download_url.as_str(),
        ))
        .map_err(|error| error.to_string())?;
        if read_bounded_limit(&self.cache.join("candidate.json"), 128 * 1024)
            .ok()
            .as_deref()
            == Some(&metadata)
            && self.cache.join("payload").is_file()
        {
            if read_bounded(&self.cache.join("payload"))
                .is_ok_and(|bytes| verify(&self.app, &bytes, &update.signature).is_ok())
            {
                return Ok(());
            }
            // A corrupt cache is disposable. A fresh authenticated download can
            // repair it; never repeatedly retry the same damaged local bytes.
            let _ = std::fs::remove_file(self.cache.join("candidate.json"));
        }
        let _ = std::fs::remove_file(self.cache.join("payload"));
        self.change(|state| {
            state.snapshot.phase = "downloading".into();
            state.snapshot.downloaded_bytes = 0;
            state.snapshot.total_bytes = None;
        });
        let client = update_channels::update_http_client(update.download_url.as_str())
            .timeout(Duration::from_secs(30 * 60))
            .build()
            .map_err(|error| error.to_string())?;
        let mut response = client
            .get(update.download_url.clone())
            .send()
            .await
            .map_err(|error| error.to_string())?
            .error_for_status()
            .map_err(|error| error.to_string())?;
        let total = response.content_length();
        if total.is_some_and(|total| total > MAX_ARTIFACT_BYTES as u64) {
            return Err("Update exceeds its byte limit".into());
        }
        let mut bytes = Vec::new();
        let mut last_progress = Instant::now() - Duration::from_secs(1);
        loop {
            self.check_download_intent(&update, manual)?;
            let chunk = tokio::select! {
                biased;
                () = self.cancel.cancelled() => return Err("Update download canceled during shutdown".into()),
                () = self.wake.notified() => continue,
                chunk = response.chunk() => chunk.map_err(|error| error.to_string())?,
            };
            let Some(chunk) = chunk else {
                break;
            };
            if bytes.len().saturating_add(chunk.len()) > MAX_ARTIFACT_BYTES {
                return Err("Update exceeds its byte limit".into());
            }
            bytes.extend_from_slice(&chunk);
            if last_progress.elapsed() >= Duration::from_millis(100) {
                self.change(|state| {
                    state.snapshot.downloaded_bytes = bytes.len() as u32;
                    state.snapshot.total_bytes = total.map(|total| total as u32);
                });
                last_progress = Instant::now();
            }
        }
        self.check_download_intent(&update, manual)?;
        verify(&self.app, &bytes, &update.signature)?;
        crate::update_install::validate_payload(&bytes)?;
        atomic_write(&self.cache.join("payload"), &bytes)?;
        atomic_write(&self.cache.join("candidate.json"), &metadata)?;
        self.change(|state| {
            state.snapshot.phase = "available".into();
        });
        Ok(())
    }
    fn check_download_intent(
        &self,
        update: &update_channels::CheckedUpdate,
        manual: bool,
    ) -> Result<(), String> {
        if !manual && !self.state.lock().unwrap().policy.enabled {
            return Err("Automatic download canceled because updates were turned off".into());
        }
        let current = self.candidate()?;
        if current.version != update.version
            || current.signature != update.signature
            || current.download_url != update.download_url
            || current.compatibility != update.compatibility
        {
            return Err("Update download superseded by a channel or candidate change".into());
        }
        Ok(())
    }

    async fn blocked(&self) -> bool {
        let Some(state) = self.app.try_state::<crate::DesktopState>() else {
            return true;
        };
        if state.shutdown.phase() != crate::desktop_lifecycle::ShutdownPhase::Running
            || state.download_picker.is_busy()
            || state.external_activations.lock().unwrap().has_pending()
        {
            return true;
        }
        state.service.lock().await.automatic_update_blocked()
    }
    async fn prepare_install(
        &self,
        manual: bool,
        install_intent: u64,
    ) -> Result<Preparation, String> {
        if self.blocked().await {
            return Ok(Preparation::Deferred);
        }
        let update = self.candidate()?;
        let bytes = read_bounded(&self.cache.join("payload"))?;
        verify(&self.app, &bytes, &update.signature)?;
        crate::update_compatibility::admit(&self.app, &update)?;
        crate::update_install::preflight(&self.app, &bytes)?;
        {
            let current = match update_channels::check_update(
                self.app.clone(),
                self.app.state(),
                if manual { "manual" } else { "periodic" }.into(),
            )
            .await
            {
                Ok(current) => current,
                Err(error) => return Ok(Preparation::RetryCheck(error)),
            };
            if !manual && !current.automatic_allowed && !qualification_available(&self.app) {
                self.change(|state| {
                    state.snapshot.automatic_available = false;
                    state.snapshot.restart_in_seconds = None;
                    state.snapshot.message =
                        Some("Automatic installation is paused for this channel".into());
                    state.policy.enabled = false;
                    state.policy.candidate_changed();
                });
                return Ok(Preparation::Deferred);
            }
            if current.version.as_deref() != Some(&update.version)
                || self.candidate()?.signature != update.signature
            {
                return Ok(Preparation::RetryCheck(
                    "Update offer changed; check again".into(),
                ));
            }
        }
        let focus_cutoff = crate::update_install::last_input_millis();
        let presentation = crate::update_install::Presentation::capture(&self.app);
        // Serialize admission with application mutations. Dispatch observes
        // committed before it can accept another command after this guard drops.
        let desktop = self.app.state::<crate::DesktopState>();
        let service = desktop.service.lock().await;
        if !manual && (desktop.download_picker.is_busy() || service.automatic_update_blocked()) {
            return Ok(Preparation::Deferred);
        }
        let mut state = self.state.lock().unwrap();
        if state.install_intent != install_intent
            || state.policy.has_known_flow()
            || state.snapshot.version.as_deref() != Some(update.version.as_str())
            || !self.candidate().is_ok_and(|current| {
                current.version == update.version
                    && current.signature == update.signature
                    && current.download_url == update.download_url
                    && current.compatibility == update.compatibility
            })
        {
            return Ok(Preparation::Deferred);
        }
        if !manual
            && (state.failed_version.as_ref() == Some(&update.version)
                || state.policy.evaluate(self.now(), false) != Eligibility::Install)
        {
            return Ok(Preparation::Deferred);
        }
        self.product
            .record_desktop_update_attempt(&DesktopUpdateAttempt {
                version: update.version.clone(),
                succeeded: false,
                message: "Update installation did not finish".into(),
            })
            .map_err(|error| error.to_string())?;
        let prepared = crate::update_install::PreparedInstall {
            relaunch_token: uuid::Uuid::new_v4().simple().to_string(),
            version: update.version.clone(),
            bytes,
            presentation,
            focus_cutoff,
            cache: self.cache.clone(),
        };
        state.committed = true;
        state.snapshot.phase = "installing".into();
        if !crate::request_update_shutdown(&self.app, prepared) {
            state.committed = false;
            self.product
                .cancel_desktop_update_attempt()
                .map_err(|error| error.to_string())?;
            return Ok(Preparation::Deferred);
        }
        drop(state);
        Ok(Preparation::Committed)
    }
}

impl HostUpdateControl for AutomaticUpdates {
    fn request(
        &self,
        owner: &str,
        request: HostUpdateRequest,
    ) -> Result<HostUpdateSnapshot, String> {
        if owner.len() > 256 {
            return Err("Invalid update client".into());
        }
        let mut state = self.state.lock().map_err(|error| error.to_string())?;
        if state.committed && !matches!(request, HostUpdateRequest::Status) {
            return Err("JSTorrent is restarting".into());
        }
        match request {
            HostUpdateRequest::Status => return Ok(state.snapshot.clone()),
            HostUpdateRequest::Check => {
                state.policy.activity(self.now());
                state.check_requested = true;
            }
            HostUpdateRequest::Install => {
                state.install_intent = state.install_intent.wrapping_add(1);
                state.failed_version = None;
                state.install_requested = true;
            }
            HostUpdateRequest::SetAutomatic { enabled } => {
                state.install_intent = state.install_intent.wrapping_add(1);
                state.install_requested = false;
                self.product
                    .set_desktop_automatic_updates(enabled)
                    .map_err(|error| error.to_string())?;
                state.policy.enabled = enabled && state.snapshot.automatic_available;
                state.policy.activity(self.now());
                state.snapshot.automatic_install = enabled;
                if enabled {
                    state.check_requested = true;
                }
            }
            HostUpdateRequest::Activity {
                interacted,
                blocked,
            } => {
                if !state.policy.report(owner, self.now(), interacted, blocked) {
                    return Err("Too many update clients".into());
                }
            }
            HostUpdateRequest::Snooze => {
                state.install_intent = state.install_intent.wrapping_add(1);
                state.install_requested = false;
                state.policy.snooze(self.now());
            }
            HostUpdateRequest::SelectChannel { channel } => {
                state.install_intent = state.install_intent.wrapping_add(1);
                state.install_requested = false;
                let channel = match channel.as_str() {
                    "stable" => ChannelId::Stable,
                    "latest" => ChannelId::Latest,
                    _ => return Err("Invalid update channel".into()),
                };
                update_channels::select_update_channel(
                    self.app.clone(),
                    self.app.state(),
                    channel,
                )?;
                state.policy.activity(self.now());
                state.snapshot.version = None;
                state.snapshot.channel = channel.as_str().into();
                state.snapshot.automatic_available = qualification_available(&self.app);
                state.policy.enabled =
                    state.snapshot.automatic_install && state.snapshot.automatic_available;
                state.snapshot.phase = "checking".into();
                state.snapshot.message = None;
                state.check_requested = true;
                let _ = std::fs::remove_file(self.cache.join("payload"));
            }
        }
        let snapshot = state.snapshot.clone();
        drop(state);
        self.wake.notify_one();
        Ok(snapshot)
    }
    fn connected(&self, owner: &str) {
        self.state.lock().unwrap().policy.connected(owner);
    }
    fn disconnected(&self, owner: &str) {
        self.state.lock().unwrap().policy.disconnected(owner);
        self.wake.notify_one();
    }
    fn interacted(&self) {
        self.state.lock().unwrap().policy.activity(self.now());
    }
    fn committed(&self) -> bool {
        self.state.lock().unwrap().committed
    }
}

fn read_bounded(path: &Path) -> Result<Vec<u8>, String> {
    read_bounded_limit(path, MAX_ARTIFACT_BYTES)
}
fn read_bounded_limit(path: &Path, limit: usize) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path)
        .map_err(|error| error.to_string())?
        .take(limit as u64 + 1);
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() > limit {
        return Err("Update cache exceeds its byte limit".into());
    }
    Ok(bytes)
}
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let mut file = tempfile::NamedTempFile::new_in(path.parent().ok_or("Missing cache parent")?)
        .map_err(|error| error.to_string())?;
    file.write_all(bytes)
        .and_then(|()| file.as_file().sync_all())
        .map_err(|error| error.to_string())?;
    file.persist(path).map_err(|error| error.to_string())?;
    Ok(())
}
pub(crate) fn verify(app: &tauri::AppHandle, bytes: &[u8], signature: &str) -> Result<(), String> {
    let key = app
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|config| config.get("pubkey"))
        .and_then(|key| key.as_str())
        .ok_or("Missing updater signing key")?;
    verify_signature(key, bytes, signature)
}
pub(crate) fn verify_signature(key: &str, bytes: &[u8], signature: &str) -> Result<(), String> {
    let decode = |value: &str| -> Result<String, String> {
        String::from_utf8(
            base64::engine::general_purpose::STANDARD
                .decode(value)
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())
    };
    let key =
        minisign_verify::PublicKey::decode(&decode(key)?).map_err(|error| error.to_string())?;
    let signature = minisign_verify::Signature::decode(&decode(signature)?)
        .map_err(|error| error.to_string())?;
    key.verify(bytes, &signature, true)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn desktop_update_request(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    request: HostUpdateRequest,
) -> Result<HostUpdateSnapshot, String> {
    app.state::<Arc<AutomaticUpdates>>()
        .request(window.label(), request)
}

fn update_policy(enabled: bool, app: &tauri::AppHandle) -> UpdatePolicy {
    #[cfg(feature = "update-qualification")]
    if app
        .config()
        .identifier
        .starts_with("com.jstorrent.qualification.")
    {
        if let Some(quiet) = option_env!("JSTORRENT_QUALIFICATION_QUIET_SECONDS")
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|value| *value > 0 && *value <= 900)
        {
            return UpdatePolicy::with_timing(enabled, 0, quiet * 1000, 5000);
        }
    }
    let _ = app;
    UpdatePolicy::new(enabled, 0)
}

fn jittered_delay(seconds: u64) -> Duration {
    let mut entropy = [0u8; 8];
    let _ = getrandom::fill(&mut entropy);
    let spread = seconds / 10;
    let jitter = u64::from_le_bytes(entropy) % (2 * spread + 1);
    Duration::from_secs(seconds.saturating_sub(spread).saturating_add(jitter))
}

/// Latest is the opted-in production qualification lane. Stable activation
/// follows the installed acceptance record in Tactical 377.
fn automatic_available(app: &tauri::AppHandle) -> bool {
    if qualification_available(app) {
        return true;
    }
    app.config().identifier == "com.jstorrent.desktop"
        && app
            .state::<Mutex<ChannelUpdates>>()
            .lock()
            .unwrap()
            .selected
            == ChannelId::Latest
}

fn qualification_available(app: &tauri::AppHandle) -> bool {
    cfg!(feature = "update-qualification")
        && app
            .config()
            .identifier
            .starts_with("com.jstorrent.qualification.")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn signed_bytes_are_required_and_cache_corruption_is_rejected() {
        // Independently generated using the pinned Tauri CLI signer. The
        // disposable private key was deleted; only public test data is retained.
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../tests/interop/desktop_updates/signature-fixture.json"
        ))
        .unwrap();
        let key = fixture["publicKey"].as_str().unwrap();
        let signature = fixture["signature"].as_str().unwrap();
        let payload = fixture["payload"].as_str().unwrap().as_bytes();
        verify_signature(key, payload, signature).unwrap();
        assert!(verify_signature(key, b"corrupt payload", signature).is_err());
        assert!(verify_signature(key, payload, "invalid").is_err());
        let directory = tempfile::tempdir().unwrap();
        let cache = directory.path().join("payload");
        atomic_write(&cache, payload).unwrap();
        assert!(read_bounded_limit(&cache, payload.len() - 1).is_err());
        let cached = read_bounded_limit(&cache, payload.len()).unwrap();
        verify_signature(key, &cached, signature).unwrap();
        atomic_write(&cache, b"corrupt").unwrap();
        assert!(verify_signature(key, &read_bounded(&cache).unwrap(), signature).is_err());
    }
}
