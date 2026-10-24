use std::collections::HashMap;
use std::sync::{Arc, Condvar, Mutex};
use std::thread::{self, JoinHandle};

use rstorrent_session::{
    TorrentFieldUpdate, TorrentOperationalState, TorrentRowUpdate, TorrentView,
};

#[cfg(any(target_os = "macos", target_os = "windows"))]
use crate::desktop_localization;

#[derive(Default)]
pub(crate) struct DesktopPowerPolicy {
    established: bool,
    torrents: HashMap<String, TorrentOperationalState>,
}

impl DesktopPowerPolicy {
    pub(crate) fn establish<'a>(
        &mut self,
        torrents: impl IntoIterator<Item = &'a TorrentView>,
    ) -> bool {
        self.replace(
            torrents
                .into_iter()
                .map(|torrent| (torrent.torrent_id.clone(), torrent.operational_state)),
        )
    }

    pub(crate) fn apply_patch<'a>(
        &mut self,
        upsert: impl IntoIterator<Item = &'a TorrentView>,
        updates: impl IntoIterator<Item = &'a TorrentRowUpdate>,
        removed: impl IntoIterator<Item = &'a String>,
    ) -> Result<bool, ()> {
        if !self.established {
            return Err(());
        }
        for torrent_id in removed {
            self.torrents.remove(torrent_id);
        }
        for torrent in upsert {
            self.torrents
                .insert(torrent.torrent_id.clone(), torrent.operational_state);
        }
        for update in updates {
            let Some(state) = self.torrents.get_mut(&update.torrent_id) else {
                self.reset();
                return Err(());
            };
            if update.validate().is_err() {
                self.reset();
                return Err(());
            }
            for field in &update.fields {
                if let TorrentFieldUpdate::OperationalState { value } = field {
                    *state = *value;
                }
            }
        }
        Ok(self.required())
    }

    pub(crate) fn reset(&mut self) -> bool {
        self.established = false;
        self.torrents.clear();
        false
    }

    fn replace(
        &mut self,
        torrents: impl IntoIterator<Item = (String, TorrentOperationalState)>,
    ) -> bool {
        self.torrents = torrents.into_iter().collect();
        self.established = true;
        self.required()
    }

    fn required(&self) -> bool {
        self.established && self.torrents.values().copied().any(active_work)
    }
}

pub(crate) fn active_work(state: TorrentOperationalState) -> bool {
    matches!(
        state,
        TorrentOperationalState::Starting
            | TorrentOperationalState::Downloading
            | TorrentOperationalState::Checking
    )
}

#[derive(Default)]
struct WorkerState {
    desired: bool,
    generation: u64,
    stopping: bool,
}

struct WorkerShared {
    state: Mutex<WorkerState>,
    changed: Condvar,
}

pub(crate) struct DesktopPowerWorker {
    shared: Arc<WorkerShared>,
    thread: Option<JoinHandle<()>>,
}

impl DesktopPowerWorker {
    pub(crate) fn spawn() -> Result<Self, String> {
        Self::spawn_with(acquire_platform_inhibitor)
    }

    fn spawn_with<G, F>(acquire: F) -> Result<Self, String>
    where
        G: Send + 'static,
        F: FnMut() -> Result<G, String> + Send + 'static,
    {
        let shared = Arc::new(WorkerShared {
            state: Mutex::new(WorkerState::default()),
            changed: Condvar::new(),
        });
        let thread_shared = shared.clone();
        let thread = thread::Builder::new()
            .name("rstorrent-power-inhibitor".to_owned())
            .spawn(move || run_worker(thread_shared, acquire))
            .map_err(|error| format!("start inhibitor thread: {error}"))?;
        Ok(Self {
            shared,
            thread: Some(thread),
        })
    }

    pub(crate) fn set_required(&self, desired: bool) {
        let mut state = self
            .shared
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if state.stopping || state.desired == desired {
            return;
        }
        state.desired = desired;
        state.generation = state.generation.wrapping_add(1);
        self.shared.changed.notify_one();
    }

    pub(crate) fn shutdown(mut self) {
        {
            let mut state = self
                .shared
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            state.stopping = true;
            state.desired = false;
            state.generation = state.generation.wrapping_add(1);
            self.shared.changed.notify_one();
        }
        if let Some(thread) = self.thread.take()
            && thread.join().is_err()
        {
            eprintln!("desktop power inhibitor thread panicked during shutdown");
        }
    }
}

fn run_worker<G, F>(shared: Arc<WorkerShared>, mut acquire: F)
where
    F: FnMut() -> Result<G, String>,
{
    let mut guard: Option<G> = None;
    let mut applied_generation = 0;
    loop {
        let (desired, generation, stopping) = {
            let mut state = shared
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            while !state.stopping && state.generation == applied_generation {
                state = shared
                    .changed
                    .wait(state)
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
            }
            (state.desired, state.generation, state.stopping)
        };

        if desired && guard.is_none() {
            match acquire() {
                Ok(inhibitor) => {
                    guard = Some(inhibitor);
                    eprintln!("desktop automatic-sleep inhibitor acquired");
                }
                Err(error) => eprintln!(
                    "desktop automatic-sleep inhibitor acquisition failed: {}",
                    bounded_error(error)
                ),
            }
        } else if !desired && guard.take().is_some() {
            eprintln!("desktop automatic-sleep inhibitor released");
        }
        applied_generation = generation;
        if stopping {
            drop(guard.take());
            return;
        }
    }
}

fn bounded_error(mut error: String) -> String {
    const MAX_CHARS: usize = 512;
    if error.chars().count() > MAX_CHARS {
        error = error.chars().take(MAX_CHARS).collect();
        error.push('…');
    }
    error
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn acquire_platform_inhibitor() -> Result<keepawake::KeepAwake, String> {
    keepawake::Builder::default()
        .idle(true)
        .display(false)
        .sleep(false)
        .reason(desktop_localization::text("power.active-transfer-reason"))
        .app_name("JSTorrent")
        .app_reverse_domain("com.jstorrent.rstorrent")
        .create()
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "linux")]
enum LinuxInhibitor {
    Gnome {
        connection: zbus::blocking::Connection,
        cookie: u32,
    },
    Portal {
        connection: zbus::blocking::Connection,
        handle: zbus::zvariant::OwnedObjectPath,
    },
}

#[cfg(target_os = "linux")]
fn acquire_platform_inhibitor() -> Result<LinuxInhibitor, String> {
    use std::time::Duration;

    use zbus::blocking::connection;

    const PORTAL_TIMEOUT: Duration = Duration::from_secs(5);

    let connection = connection::Builder::session()
        .map_err(|error| error.to_string())?
        .method_timeout(PORTAL_TIMEOUT)
        .build()
        .map_err(|error| error.to_string())?;
    if gnome_session_manager_available(&connection)? {
        acquire_gnome_inhibitor(connection)
    } else {
        acquire_linux_portal_inhibitor(connection, PORTAL_TIMEOUT)
    }
}

#[cfg(target_os = "linux")]
fn gnome_session_manager_available(
    connection: &zbus::blocking::Connection,
) -> Result<bool, String> {
    const SERVICE: &str = "org.freedesktop.DBus";
    const PATH: &str = "/org/freedesktop/DBus";
    const INTERFACE: &str = "org.freedesktop.DBus";
    const GNOME_SESSION: &str = "org.gnome.SessionManager";

    let proxy = zbus::blocking::Proxy::new(connection, SERVICE, PATH, INTERFACE)
        .map_err(|error| error.to_string())?;
    proxy
        .call("NameHasOwner", &(GNOME_SESSION,))
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "linux")]
fn acquire_gnome_inhibitor(
    connection: zbus::blocking::Connection,
) -> Result<LinuxInhibitor, String> {
    const SERVICE: &str = "org.gnome.SessionManager";
    const PATH: &str = "/org/gnome/SessionManager";
    const INTERFACE: &str = "org.gnome.SessionManager";
    const SUSPEND: u32 = 4;

    let proxy = zbus::blocking::Proxy::new(&connection, SERVICE, PATH, INTERFACE)
        .map_err(|error| error.to_string())?;
    let cookie = proxy
        .call(
            "Inhibit",
            &(
                "com.jstorrent.rstorrent",
                0_u32,
                "JSTorrent is downloading or checking content",
                SUSPEND,
            ),
        )
        .map_err(|error| error.to_string())?;
    Ok(LinuxInhibitor::Gnome { connection, cookie })
}

#[cfg(target_os = "linux")]
fn acquire_linux_portal_inhibitor(
    connection: zbus::blocking::Connection,
    portal_timeout: std::time::Duration,
) -> Result<LinuxInhibitor, String> {
    use std::collections::HashMap;
    use std::time::{Duration, Instant};

    use futures_util::{FutureExt, StreamExt};
    use zbus::MatchRule;
    use zbus::blocking::{MessageIterator, Proxy};
    use zbus::message::Type;
    use zbus::zvariant::{OwnedObjectPath, OwnedValue, Value};

    const SERVICE: &str = "org.freedesktop.portal.Desktop";
    const PATH: &str = "/org/freedesktop/portal/desktop";
    const INTERFACE: &str = "org.freedesktop.portal.Inhibit";
    const REQUEST_INTERFACE: &str = "org.freedesktop.portal.Request";
    const SUSPEND: u32 = 4;

    let sender = connection
        .unique_name()
        .ok_or_else(|| "session bus did not assign a unique name".to_owned())?
        .as_str()
        .trim_start_matches(':')
        .replace('.', "_");
    let token = format!("rstorrent_{}", uuid::Uuid::new_v4().simple());
    let expected_handle = OwnedObjectPath::try_from(format!(
        "/org/freedesktop/portal/desktop/request/{sender}/{token}"
    ))
    .map_err(|error| error.to_string())?;
    let response_rule = MatchRule::builder()
        .msg_type(Type::Signal)
        .interface(REQUEST_INTERFACE)
        .map_err(|error| error.to_string())?
        .member("Response")
        .map_err(|error| error.to_string())?
        .path(expected_handle.as_str())
        .map_err(|error| error.to_string())?
        .build();
    let responses = MessageIterator::for_match_rule(response_rule, &connection, Some(1))
        .map_err(|error| error.to_string())?;
    let proxy =
        Proxy::new(&connection, SERVICE, PATH, INTERFACE).map_err(|error| error.to_string())?;
    let mut options = HashMap::new();
    options.insert("handle_token", Value::from(token.as_str()));
    options.insert(
        "reason",
        Value::from("JSTorrent is downloading or checking content"),
    );
    let handle: OwnedObjectPath = proxy
        .call("Inhibit", &("", SUSPEND, options))
        .map_err(|error| error.to_string())?;
    if handle != expected_handle {
        let _ = close_linux_portal_request(&connection, &handle);
        return Err(format!(
            "portal returned unexpected request handle {handle}"
        ));
    }

    let response_result = (|| -> Result<(), String> {
        let mut responses = responses.into_inner();
        let deadline = Instant::now() + portal_timeout;
        let response = loop {
            if let Some(message) = responses.next().now_or_never() {
                break message
                    .ok_or_else(|| "portal response stream closed".to_owned())?
                    .map_err(|error| error.to_string())?;
            }
            if Instant::now() >= deadline {
                return Err("portal inhibition response timed out".to_owned());
            }
            std::thread::sleep(Duration::from_millis(10));
        };
        let (response, _results): (u32, HashMap<String, OwnedValue>) = response
            .body()
            .deserialize()
            .map_err(|error| error.to_string())?;
        if response != 0 {
            return Err(format!(
                "portal inhibition request was rejected with response {response}"
            ));
        }
        Ok(())
    })();
    if let Err(error) = response_result {
        let _ = close_linux_portal_request(&connection, &handle);
        return Err(error);
    }
    Ok(LinuxInhibitor::Portal { connection, handle })
}

#[cfg(target_os = "linux")]
fn close_linux_portal_request(
    connection: &zbus::blocking::Connection,
    handle: &zbus::zvariant::OwnedObjectPath,
) -> zbus::Result<()> {
    const SERVICE: &str = "org.freedesktop.portal.Desktop";
    const INTERFACE: &str = "org.freedesktop.portal.Request";
    zbus::blocking::Proxy::new(connection, SERVICE, handle.as_str(), INTERFACE)?
        .call::<_, _, ()>("Close", &())
}

#[cfg(target_os = "linux")]
impl Drop for LinuxInhibitor {
    fn drop(&mut self) {
        let result = match self {
            LinuxInhibitor::Gnome { connection, cookie } => {
                const SERVICE: &str = "org.gnome.SessionManager";
                const PATH: &str = "/org/gnome/SessionManager";
                const INTERFACE: &str = "org.gnome.SessionManager";
                zbus::blocking::Proxy::new(connection, SERVICE, PATH, INTERFACE)
                    .and_then(|proxy| proxy.call::<_, _, ()>("Uninhibit", &(*cookie,)))
            }
            LinuxInhibitor::Portal { connection, handle } => {
                close_linux_portal_request(connection, handle)
            }
        };
        if let Err(error) = result {
            eprintln!(
                "desktop automatic-sleep inhibitor release failed: {}",
                bounded_error(error.to_string())
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc;
    use std::thread::ThreadId;
    use std::time::Duration;

    use rstorrent_session::TorrentOperationalState;

    use super::{DesktopPowerPolicy, DesktopPowerWorker, active_work};

    #[test]
    fn only_start_download_and_check_require_inhibition() {
        for (state, expected) in [
            (TorrentOperationalState::Queued, false),
            (TorrentOperationalState::Starting, true),
            (TorrentOperationalState::Downloading, true),
            (TorrentOperationalState::Checking, true),
            (TorrentOperationalState::Stopping, false),
            (TorrentOperationalState::Seeding, false),
            (TorrentOperationalState::Paused, false),
            (TorrentOperationalState::Error, false),
        ] {
            assert_eq!(active_work(state), expected, "state {state:?}");
        }
    }

    #[test]
    fn snapshots_patches_removals_and_resets_are_level_triggered() {
        let mut policy = DesktopPowerPolicy::default();
        assert!(!policy.replace([]));
        assert!(policy.replace([
            ("active".to_owned(), TorrentOperationalState::Downloading),
            ("queued".to_owned(), TorrentOperationalState::Queued),
        ]));
        policy
            .torrents
            .insert("active".to_owned(), TorrentOperationalState::Seeding);
        assert!(!policy.required());
        policy
            .torrents
            .insert("queued".to_owned(), TorrentOperationalState::Checking);
        assert!(policy.required());
        policy.torrents.remove("queued");
        assert!(!policy.required());
        assert!(!policy.reset());
        assert!(!policy.required());
    }

    struct TestGuard {
        acquired_on: ThreadId,
        events: mpsc::Sender<(bool, ThreadId)>,
    }

    impl Drop for TestGuard {
        fn drop(&mut self) {
            self.events
                .send((false, std::thread::current().id()))
                .expect("record release");
            assert_eq!(self.acquired_on, std::thread::current().id());
        }
    }

    #[test]
    fn worker_acquires_releases_and_shuts_down_on_one_thread() {
        let (events, received) = mpsc::channel();
        let worker = DesktopPowerWorker::spawn_with(move || {
            let thread = std::thread::current().id();
            events.send((true, thread)).expect("record acquire");
            Ok(TestGuard {
                acquired_on: thread,
                events: events.clone(),
            })
        })
        .expect("spawn test worker");

        worker.set_required(true);
        let acquired = received
            .recv_timeout(Duration::from_secs(2))
            .expect("acquisition event");
        assert!(acquired.0);
        worker.set_required(false);
        let released = received
            .recv_timeout(Duration::from_secs(2))
            .expect("release event");
        assert!(!released.0);
        assert_eq!(acquired.1, released.1);

        worker.set_required(true);
        let acquired_again = received
            .recv_timeout(Duration::from_secs(2))
            .expect("second acquisition event");
        worker.shutdown();
        let final_release = received
            .recv_timeout(Duration::from_secs(2))
            .expect("shutdown release event");
        assert_eq!(acquired_again.1, final_release.1);
    }
}
