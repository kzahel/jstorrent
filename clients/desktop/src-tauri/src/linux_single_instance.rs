//! Linux launch admission. Waiting launchers own intent, never an engine.
//! Keep the pinned Tauri wire identity so warm old/new launches interoperate.
use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent, plugin::TauriPlugin};
use zbus::blocking::{Connection, connection::Builder};
use zbus::fdo::RequestNameFlags;

const RETRY_ERROR: &str = "org.SingleInstance.Error.Retry";
const WAIT_LIMIT: Duration = Duration::from_secs(8);
const CALL_LIMIT: Duration = Duration::from_secs(1);
const RETRY_INTERVAL: Duration = Duration::from_millis(25);
const MAX_PENDING_DELIVERIES: usize = 16;
const MAX_ARGUMENTS: usize = 64;
const MAX_ARGUMENT_BYTES: usize = 512 * 1024;
const MAX_CWD_BYTES: usize = 64 * 1024;

#[derive(Debug, zbus::DBusError)]
#[zbus(prefix = "org.SingleInstance.Error")]
pub(crate) enum AdmissionError {
    Retry(String),
    Refused(String),
}

pub(crate) fn check_phase(phase: Option<super::ShutdownPhase>) -> Result<(), AdmissionError> {
    use super::ShutdownPhase;
    match phase {
        Some(ShutdownPhase::Running) => Ok(()),
        None => Err(AdmissionError::Retry("desktop is starting".into())),
        Some(ShutdownPhase::Stopping | ShutdownPhase::FinalExit) => {
            Err(AdmissionError::Retry("desktop is stopping".into()))
        }
        Some(ShutdownPhase::Failed) => {
            Err(AdmissionError::Refused("desktop shutdown failed".into()))
        }
    }
}

type Handler = Box<dyn Fn(Vec<String>) -> Result<(), AdmissionError> + Send + Sync>;

struct Admission {
    handler: Handler,
}

#[zbus::interface(name = "org.SingleInstance.DBus")]
impl Admission {
    fn execute_callback(&self, argv: Vec<String>, cwd: String) -> Result<(), AdmissionError> {
        validate_arguments(&argv, &cwd)?;
        (self.handler)(argv)
    }
}

fn validate_arguments(arguments: &[String], cwd: &str) -> Result<(), AdmissionError> {
    if arguments.len() > MAX_ARGUMENTS
        || arguments.iter().map(String::len).sum::<usize>() > MAX_ARGUMENT_BYTES
        || cwd.len() > MAX_CWD_BYTES
    {
        return Err(AdmissionError::Refused(
            "launch input exceeds limits".into(),
        ));
    }
    Ok(())
}

#[derive(Debug, PartialEq, Eq)]
enum Role {
    Primary,
    Delivered,
}

/// Transport loss after delivery is ambiguous: only retry explicit refusal or
/// a bus response proving no destination existed. Timeouts fail closed.
fn retryable(error: &zbus::Error) -> bool {
    matches!(error, zbus::Error::MethodError(name, _, _) if matches!(name.as_str(),
        RETRY_ERROR | "org.freedesktop.DBus.Error.ServiceUnknown"
        | "org.freedesktop.DBus.Error.NameHasNoOwner"))
}

fn arbitrate(
    connection: &Connection,
    name: &str,
    path: &str,
    arguments: &[String],
    cwd: &str,
    limit: Duration,
) -> Result<Role, &'static str> {
    validate_arguments(arguments, cwd).map_err(|_| "launch input exceeds limits")?;
    let deadline = Instant::now() + limit;
    loop {
        if Instant::now() >= deadline {
            return Err("desktop launch timed out waiting for the existing instance");
        }
        match connection.request_name_with_flags(name, RequestNameFlags::DoNotQueue.into()) {
            Ok(_) => return Ok(Role::Primary),
            Err(zbus::Error::NameTaken) => {}
            Err(_) => return Err("desktop singleton ownership is unavailable"),
        }
        match connection.call_method(
            Some(name),
            path,
            Some("org.SingleInstance.DBus"),
            "ExecuteCallback",
            &(arguments, cwd),
        ) {
            Ok(reply) => {
                reply
                    .body()
                    .deserialize::<()>()
                    .map_err(|_| "desktop returned an invalid launch acknowledgement")?;
                return Ok(Role::Delivered);
            }
            Err(error) if retryable(&error) => {}
            Err(_) => return Err("desktop did not acknowledge the launch request"),
        }
        std::thread::sleep(RETRY_INTERVAL.min(deadline.saturating_duration_since(Instant::now())));
    }
}

struct Owner {
    connection: Connection,
    name: String,
}

pub(crate) fn init() -> TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("single-instance")
        .setup(|app, _| {
            let name = format!("{}.SingleInstance", app.config().identifier);
            let path = format!("/{}", name.replace('.', "/").replace('-', "_"));
            let handle = app.clone();
            let pending = Arc::new(tokio::sync::Semaphore::new(MAX_PENDING_DELIVERIES));
            let connection = Builder::session()
                .map_err(|_| "desktop session bus is unavailable")?
                .method_timeout(CALL_LIMIT)
                .max_queued(16)
                .serve_at(
                    path.as_str(),
                    Admission {
                        handler: Box::new(move |arguments| {
                            let permit = pending.clone().try_acquire_owned().map_err(|_| {
                                AdmissionError::Retry("desktop launch queue is full".into())
                            })?;
                            super::admit_linux_launch(&handle, arguments, permit)
                        }),
                    },
                )
                .map_err(|_| "desktop launch admission could not be registered")?
                .build()
                .map_err(|_| "desktop session bus connection failed")?;
            let arguments = std::env::args().collect::<Vec<_>>();
            let cwd = std::env::current_dir().unwrap_or_default();
            match arbitrate(
                &connection,
                &name,
                &path,
                &arguments,
                &cwd.to_string_lossy(),
                WAIT_LIMIT,
            ) {
                Ok(Role::Primary) => {
                    app.manage(Owner { connection, name });
                }
                Ok(Role::Delivered) => {
                    app.cleanup_before_exit();
                    std::process::exit(0);
                }
                Err(error) => return Err(error.into()),
            }
            Ok(())
        })
        .on_event(|app, event| {
            if matches!(event, RunEvent::Exit)
                && let Some(owner) = app.try_state::<Owner>()
            {
                // Exit is reached only after application owners have joined.
                let _ = owner.connection.release_name(owner.name.as_str());
            }
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::process::{Child, Command, Stdio};
    use std::sync::{
        Arc, Barrier, Mutex,
        atomic::{AtomicU8, AtomicUsize, Ordering},
    };

    const NAME: &str = "com.jstorrent.rstorrent.TestSingleInstance";
    const PATH: &str = "/com/jstorrent/rstorrent/TestSingleInstance";

    struct Bus {
        child: Child,
        address: String,
    }
    impl Bus {
        fn new() -> Self {
            let mut child = Command::new("dbus-daemon")
                .args(["--session", "--nofork", "--print-address=1"])
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .expect("private test bus");
            let mut address = String::new();
            BufReader::new(child.stdout.take().unwrap())
                .read_line(&mut address)
                .unwrap();
            Self {
                child,
                address: address.trim().to_owned(),
            }
        }
        fn connection(&self, handler: Handler) -> Connection {
            connect(&self.address, handler, CALL_LIMIT)
        }
    }
    impl Drop for Bus {
        fn drop(&mut self) {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
    fn connect(address: &str, handler: Handler, timeout: Duration) -> Connection {
        Builder::address(address)
            .unwrap()
            .method_timeout(timeout)
            .serve_at(PATH, Admission { handler })
            .unwrap()
            .build()
            .unwrap()
    }
    fn claim(
        connection: &Connection,
        arguments: &[String],
        limit: Duration,
    ) -> Result<Role, &'static str> {
        arbitrate(connection, NAME, PATH, arguments, "/test", limit)
    }
    fn accept() -> Handler {
        Box::new(|_| Ok(()))
    }

    #[test]
    fn shutdown_phase_controls_admission() {
        use crate::ShutdownPhase;
        assert!(matches!(check_phase(None), Err(AdmissionError::Retry(_))));
        assert!(check_phase(Some(ShutdownPhase::Running)).is_ok());
        for phase in [ShutdownPhase::Stopping, ShutdownPhase::FinalExit] {
            assert!(matches!(
                check_phase(Some(phase)),
                Err(AdmissionError::Retry(_))
            ));
        }
        assert!(matches!(
            check_phase(Some(ShutdownPhase::Failed)),
            Err(AdmissionError::Refused(_))
        ));
    }

    #[test]
    fn warm_launch_preserves_arguments_and_returns_empty_legacy_reply() {
        let bus = Bus::new();
        let received = Arc::new(Mutex::new(Vec::new()));
        let sink = received.clone();
        let primary = bus.connection(Box::new(move |args| {
            sink.lock().unwrap().push(args);
            Ok(())
        }));
        assert_eq!(claim(&primary, &[], WAIT_LIMIT), Ok(Role::Primary));
        let secondary = bus.connection(accept());
        let args = vec![
            "desktop".into(),
            "--extension-background".into(),
            "magnet:?xt=test".into(),
        ];
        assert_eq!(claim(&secondary, &args, WAIT_LIMIT), Ok(Role::Delivered));
        assert_eq!(*received.lock().unwrap(), vec![args]);
    }

    #[test]
    fn startup_retries_then_attaches_and_shutdown_retries_until_owner_leaves() {
        let bus = Bus::new();
        let phase = Arc::new(AtomicU8::new(0));
        let observed = phase.clone();
        let primary = bus.connection(Box::new(move |_| {
            if observed.load(Ordering::Acquire) == 1 {
                Ok(())
            } else {
                Err(AdmissionError::Retry("not ready".into()))
            }
        }));
        assert_eq!(claim(&primary, &[], WAIT_LIMIT), Ok(Role::Primary));
        let secondary = bus.connection(accept());
        let worker = std::thread::spawn(move || claim(&secondary, &[], WAIT_LIMIT));
        std::thread::sleep(Duration::from_millis(60));
        assert!(!worker.is_finished());
        phase.store(1, Ordering::Release);
        assert_eq!(worker.join().unwrap(), Ok(Role::Delivered));

        phase.store(2, Ordering::Release);
        let successor = bus.connection(accept());
        let worker = std::thread::spawn(move || {
            let role = claim(&successor, &[], WAIT_LIMIT);
            (role, successor)
        });
        std::thread::sleep(Duration::from_millis(60));
        assert!(!worker.is_finished());
        primary.release_name(NAME).unwrap();
        let (role, _owner) = worker.join().unwrap();
        assert_eq!(role, Ok(Role::Primary));
    }

    #[test]
    fn concurrent_launchers_elect_one_owner_without_replacing_it() {
        let bus = Bus::new();
        let barrier = Arc::new(Barrier::new(12));
        let workers: Vec<_> = (0..12)
            .map(|_| {
                let connection = bus.connection(accept());
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    let role = claim(&connection, &[], WAIT_LIMIT).unwrap();
                    (role, connection)
                })
            })
            .collect();
        let owners: Vec<_> = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect();
        assert_eq!(
            owners
                .iter()
                .filter(|(role, _)| *role == Role::Primary)
                .count(),
            1
        );
        assert_eq!(
            owners
                .iter()
                .filter(|(role, _)| *role == Role::Delivered)
                .count(),
            11
        );
    }

    #[test]
    fn retry_deadline_and_explicit_refusal_do_not_acquire_ownership() {
        let bus = Bus::new();
        let retry = Arc::new(AtomicU8::new(1));
        let observed = retry.clone();
        let primary = bus.connection(Box::new(move |_| {
            if observed.load(Ordering::Acquire) == 1 {
                Err(AdmissionError::Retry("stopping".into()))
            } else {
                Err(AdmissionError::Refused("failed".into()))
            }
        }));
        assert_eq!(claim(&primary, &[], WAIT_LIMIT), Ok(Role::Primary));
        let secondary = bus.connection(accept());
        assert_eq!(
            claim(&secondary, &[], Duration::from_millis(60)),
            Err("desktop launch timed out waiting for the existing instance")
        );
        retry.store(0, Ordering::Release);
        assert_eq!(
            claim(&secondary, &[], WAIT_LIMIT),
            Err("desktop did not acknowledge the launch request")
        );
        assert_eq!(claim(&primary, &[], WAIT_LIMIT), Ok(Role::Primary));
    }

    #[test]
    fn timed_out_delivery_is_not_replayed() {
        let bus = Bus::new();
        let calls = Arc::new(AtomicUsize::new(0));
        let observed = calls.clone();
        let primary = bus.connection(Box::new(move |_| {
            observed.fetch_add(1, Ordering::AcqRel);
            std::thread::sleep(Duration::from_millis(200));
            Ok(())
        }));
        assert_eq!(claim(&primary, &[], WAIT_LIMIT), Ok(Role::Primary));
        let secondary = connect(&bus.address, accept(), Duration::from_millis(50));
        assert_eq!(
            claim(&secondary, &[], WAIT_LIMIT),
            Err("desktop did not acknowledge the launch request")
        );
        std::thread::sleep(Duration::from_millis(250));
        assert_eq!(calls.load(Ordering::Acquire), 1);
    }

    #[test]
    fn limits_apply_to_both_sender_and_received_calls() {
        assert!(validate_arguments(&vec![String::new(); MAX_ARGUMENTS], "").is_ok());
        assert!(validate_arguments(&vec![String::new(); MAX_ARGUMENTS + 1], "").is_err());
        assert!(validate_arguments(&["x".repeat(MAX_ARGUMENT_BYTES)], "").is_ok());
        assert!(validate_arguments(&["x".repeat(MAX_ARGUMENT_BYTES + 1)], "").is_err());
        assert!(validate_arguments(&[], &"x".repeat(MAX_CWD_BYTES + 1)).is_err());
        let bus = Bus::new();
        let primary = bus.connection(Box::new(|_| panic!("oversized call reached application")));
        assert_eq!(claim(&primary, &[], WAIT_LIMIT), Ok(Role::Primary));
        let secondary = bus.connection(accept());
        let result = secondary.call_method(
            Some(NAME),
            PATH,
            Some("org.SingleInstance.DBus"),
            "ExecuteCallback",
            &(vec!["x"; MAX_ARGUMENTS + 1], "/test"),
        );
        assert!(
            matches!(result, Err(zbus::Error::MethodError(name, _, _)) if name.as_str() == "org.SingleInstance.Error.Refused")
        );
    }

    struct MalformedReply;

    #[zbus::interface(name = "org.SingleInstance.DBus")]
    impl MalformedReply {
        fn execute_callback(&self, _argv: Vec<String>, _cwd: String) -> u32 {
            7
        }
    }

    #[test]
    fn malformed_acknowledgement_does_not_count_as_delivery() {
        let bus = Bus::new();
        let primary = Builder::address(bus.address.as_str())
            .unwrap()
            .serve_at(PATH, MalformedReply)
            .unwrap()
            .build()
            .unwrap();
        assert_eq!(claim(&primary, &[], WAIT_LIMIT), Ok(Role::Primary));
        let secondary = bus.connection(accept());
        assert_eq!(
            claim(&secondary, &[], WAIT_LIMIT),
            Err("desktop returned an invalid launch acknowledgement")
        );
    }

    #[test]
    fn missing_session_bus_does_not_fall_back_to_unprotected_start() {
        let directory = tempfile::tempdir().unwrap();
        let address = format!("unix:path={}/absent", directory.path().display());
        assert!(Builder::address(address.as_str()).unwrap().build().is_err());
    }
}
