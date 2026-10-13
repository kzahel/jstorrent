//! Bounded same-user bootstrap. This owns no application or torrent state.
use serde::{Deserialize, Serialize};
use std::io;
#[cfg(not(windows))]
use std::path::Path;

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::{BootstrapServer, read_ready};

pub const BACKGROUND_ARGUMENT: &str = "--extension-background";
pub const SOCKET_NAME: &str = "desktop-control-v1.sock";
pub const BETA_ORIGIN: &str = "chrome-extension://gcgoepclopkgijmclmlheafaglmbjlcc/";
pub const PRODUCTION_ORIGIN: &str = "chrome-extension://dbokmlpefliilbjldladbimlcfgbolhk/";

pub fn origin_allowed(origin: &str) -> bool {
    matches!(origin, BETA_ORIGIN | PRODUCTION_ORIGIN)
}
pub const MAX_READY_BYTES: usize = 4096;

// Deliberately no Debug: credential material must never enter logs.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ControlReady {
    pub endpoint: String,
    pub credential: String,
    pub instance_id: String,
    pub profile_id: String,
}

impl ControlReady {
    pub fn validate(&self) -> io::Result<()> {
        let port = self
            .endpoint
            .strip_prefix("http://127.0.0.1:")
            .and_then(|port| port.parse::<u16>().ok())
            .filter(|port| *port != 0);
        if port.is_none()
            || self.credential.len() != 64
            || !self.credential.bytes().all(|b| b.is_ascii_hexdigit())
            || self.instance_id.len() != 32
            || !self.instance_id.bytes().all(|b| b.is_ascii_hexdigit())
            || self.profile_id != "default"
        {
            return Err(io::Error::other("invalid desktop ready response"));
        }
        Ok(())
    }
}

pub fn is_stopped(error: &io::Error) -> bool {
    matches!(
        error.kind(),
        io::ErrorKind::NotFound | io::ErrorKind::ConnectionRefused
    )
}

#[cfg(target_os = "macos")]
fn check_peer_uid(stream: &impl std::os::fd::AsRawFd) -> io::Result<()> {
    let mut uid = 0;
    let mut gid = 0;
    // SAFETY: the live stream owns this descriptor and both output pointers
    // refer to initialized uid_t/gid_t values for the duration of the call.
    if unsafe { libc::getpeereid(stream.as_raw_fd(), &mut uid, &mut gid) } != 0 {
        return Err(io::Error::last_os_error());
    }
    if uid != rustix::process::getuid().as_raw() {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "foreign desktop owner",
        ));
    }
    Ok(())
}

#[cfg(unix)]
fn check_private(path: &Path, directory: bool) -> io::Result<()> {
    use std::os::unix::fs::{FileTypeExt, MetadataExt};
    let metadata = std::fs::symlink_metadata(path)?;
    if metadata.uid() != rustix::process::getuid().as_raw()
        || metadata.mode() & 0o077 != 0
        || if directory {
            !metadata.is_dir()
        } else {
            !metadata.file_type().is_socket()
        }
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "unsafe desktop rendezvous",
        ));
    }
    Ok(())
}

/// Serialize macOS LaunchServices starts, which otherwise send Reopen to a
/// concurrently starting app. Keep this inode: unlinking it splits the lock.
#[cfg(target_os = "macos")]
pub(crate) fn lock_start(
    directory: &Path,
    deadline: std::time::Instant,
) -> io::Result<std::fs::File> {
    use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
    check_private(directory, true)?;
    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(directory.join("desktop-start-v1.lock"))?;
    let metadata = file.metadata()?;
    if !metadata.is_file()
        || metadata.uid() != rustix::process::getuid().as_raw()
        || metadata.mode() & 0o077 != 0
        || metadata.nlink() != 1
        || metadata.len() != 0
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "unsafe desktop launch lock",
        ));
    }
    loop {
        match file.try_lock() {
            Ok(()) => return Ok(file),
            Err(std::fs::TryLockError::Error(error)) => return Err(error),
            Err(std::fs::TryLockError::WouldBlock) => {
                if std::time::Instant::now() >= deadline {
                    return Err(io::Error::new(
                        io::ErrorKind::TimedOut,
                        "desktop start busy",
                    ));
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
        }
    }
}

#[cfg(unix)]
fn with_socket_address<T>(
    path: &Path,
    operation: impl FnOnce(&Path) -> io::Result<T>,
) -> io::Result<T> {
    // Linux sun_path is only 108 bytes. Address the same protected filesystem
    // entry through an owned directory descriptor, without changing cwd or
    // moving authentication into the unprotected abstract socket namespace.
    #[cfg(target_os = "linux")]
    {
        use std::os::fd::AsRawFd;
        let directory = std::fs::File::open(
            path.parent()
                .ok_or_else(|| io::Error::other("missing parent"))?,
        )?;
        let name = path
            .file_name()
            .ok_or_else(|| io::Error::other("missing socket name"))?;
        let address =
            std::path::PathBuf::from(format!("/proc/self/fd/{}", directory.as_raw_fd())).join(name);
        operation(&address)
    }
    #[cfg(not(target_os = "linux"))]
    operation(path)
}

#[cfg(unix)]
pub fn read_ready(path: &Path) -> io::Result<ControlReady> {
    use std::io::Read;
    check_private(
        path.parent()
            .ok_or_else(|| io::Error::other("missing parent"))?,
        true,
    )?;
    check_private(path, false)?;
    let mut stream = with_socket_address(path, |address| {
        std::os::unix::net::UnixStream::connect(address)
    })?;
    stream.set_read_timeout(Some(std::time::Duration::from_secs(1)))?;
    #[cfg(target_os = "macos")]
    check_peer_uid(&stream)?;
    #[cfg(target_os = "linux")]
    if rustix::net::sockopt::socket_peercred(&stream)?.uid != rustix::process::getuid() {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "foreign desktop owner",
        ));
    }
    let mut length = [0; 4];
    stream.read_exact(&mut length)?;
    let length = u32::from_le_bytes(length) as usize;
    if length > MAX_READY_BYTES {
        return Err(io::Error::other("oversized ready response"));
    }
    let mut bytes = vec![0; length];
    stream.read_exact(&mut bytes)?;
    let ready: ControlReady = serde_json::from_slice(&bytes).map_err(io::Error::other)?;
    ready.validate()?;
    Ok(ready)
}

#[cfg(not(any(unix, windows)))]
pub fn read_ready(_path: &Path) -> io::Result<ControlReady> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "desktop bootstrap is not implemented on this platform",
    ))
}

#[cfg(unix)]
pub struct BootstrapServer {
    listener: tokio::net::UnixListener,
    path: std::path::PathBuf,
    ready: ControlReady,
}

#[cfg(unix)]
impl BootstrapServer {
    pub fn bind(directory: &Path, ready: ControlReady) -> io::Result<Self> {
        use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
        ready.validate()?;
        if !directory.exists() {
            std::fs::DirBuilder::new().mode(0o700).create(directory)?;
        }
        check_private(directory, true)?;
        let path = directory.join(SOCKET_NAME);
        match std::fs::symlink_metadata(&path) {
            Ok(_) => {
                check_private(&path, false)?;
                match with_socket_address(&path, |address| {
                    std::os::unix::net::UnixStream::connect(address)
                }) {
                    Err(error) if error.kind() == io::ErrorKind::ConnectionRefused => {
                        std::fs::remove_file(&path)?
                    }
                    _ => {
                        return Err(io::Error::new(
                            io::ErrorKind::AddrInUse,
                            "bootstrap owner already exists",
                        ));
                    }
                }
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        let listener =
            with_socket_address(&path, |address| tokio::net::UnixListener::bind(address))?;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
        Ok(Self {
            listener,
            path,
            ready,
        })
    }

    pub async fn serve(self, cancel: tokio_util::sync::CancellationToken) -> io::Result<()> {
        #[cfg(target_os = "macos")]
        use tokio::io::AsyncReadExt;
        use tokio::io::AsyncWriteExt;
        let bytes = serde_json::to_vec(&self.ready).map_err(io::Error::other)?;
        if bytes.len() > MAX_READY_BYTES {
            return Err(io::Error::other("oversized ready response"));
        }
        loop {
            let (mut stream, _) = tokio::select! {
                biased;
                () = cancel.cancelled() => return Ok(()),
                accepted = self.listener.accept() => accepted?,
            };
            // A vanished/invalid peer must not terminate bootstrap admission.
            // macOS only needs getpeereid, not Tokio's additional PID query.
            #[cfg(target_os = "macos")]
            let admitted = check_peer_uid(&stream).is_ok();
            #[cfg(not(target_os = "macos"))]
            let admitted = stream
                .peer_cred()
                .is_ok_and(|cred| cred.uid() == rustix::process::getuid().as_raw());
            if !admitted {
                continue;
            }
            tokio::select! {
                () = cancel.cancelled() => return Ok(()),
                _ = tokio::time::timeout(std::time::Duration::from_secs(1), async {
                    stream.write_all(&(bytes.len() as u32).to_le_bytes()).await?;
                    stream.write_all(&bytes).await?;
                    #[cfg(target_os = "macos")]
                    {
                        // Darwin rejects SO_RCVTIMEO with EINVAL after peer
                        // closure. Let the client configure/authenticate/read
                        // before closing; its EOF needs no new protocol frame.
                        // A stalled client still has the same one-second cap.
                        let _ = stream.read(&mut [0_u8; 1]).await?;
                    }
                    Ok::<(), io::Error>(())
                }) => {},
            }
        }
    }
}

#[cfg(unix)]
impl Drop for BootstrapServer {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use tokio_util::sync::CancellationToken;

    fn ready() -> ControlReady {
        ControlReady {
            endpoint: "http://127.0.0.1:12345".to_owned(),
            credential: "ab".repeat(32),
            instance_id: "cd".repeat(16),
            profile_id: "default".to_owned(),
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn mac_start_lock_serializes_waiters_and_releases_on_drop() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::time::{Duration, Instant};
        let directory = tempfile::tempdir().unwrap();
        std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        let active = AtomicUsize::new(0);
        std::thread::scope(|scope| {
            for _ in 0..12 {
                scope.spawn(|| {
                    let _lock =
                        lock_start(directory.path(), Instant::now() + Duration::from_secs(3))
                            .unwrap();
                    assert_eq!(active.fetch_add(1, Ordering::SeqCst), 0);
                    std::thread::sleep(Duration::from_millis(2));
                    assert_eq!(active.fetch_sub(1, Ordering::SeqCst), 1);
                });
            }
        });
        let first = lock_start(directory.path(), Instant::now()).unwrap();
        assert_eq!(
            lock_start(directory.path(), Instant::now())
                .unwrap_err()
                .kind(),
            io::ErrorKind::TimedOut
        );
        drop(first);
        assert!(lock_start(directory.path(), Instant::now()).is_ok());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn mac_start_lock_refuses_unsafe_files_and_directories() {
        use std::os::unix::fs::symlink;
        let directory = tempfile::tempdir().unwrap();
        std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        let lock_path = directory.path().join("desktop-start-v1.lock");
        let target = directory.path().join("target");
        std::fs::write(&target, b"").unwrap();
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o600)).unwrap();
        symlink(&target, &lock_path).unwrap();
        assert!(lock_start(directory.path(), std::time::Instant::now()).is_err());
        std::fs::remove_file(&lock_path).unwrap();
        std::fs::hard_link(&target, &lock_path).unwrap();
        assert!(lock_start(directory.path(), std::time::Instant::now()).is_err());
        std::fs::remove_file(&lock_path).unwrap();
        drop(lock_start(directory.path(), std::time::Instant::now()).unwrap());
        std::fs::set_permissions(&lock_path, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(lock_start(directory.path(), std::time::Instant::now()).is_err());
        std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(lock_start(directory.path(), std::time::Instant::now()).is_err());
    }

    #[tokio::test]
    async fn disconnected_probes_do_not_stop_bootstrap_admission() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("host");
        let server = BootstrapServer::bind(&directory, ready()).unwrap();
        let path = directory.join(SOCKET_NAME);
        for _ in 0..12 {
            drop(std::os::unix::net::UnixStream::connect(&path).unwrap());
        }
        let cancel = CancellationToken::new();
        let task = tokio::spawn(server.serve(cancel.clone()));
        let actual = tokio::task::spawn_blocking(move || read_ready(&path))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(actual.instance_id, ready().instance_id);
        cancel.cancel();
        task.await.unwrap().unwrap();
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn mac_ready_peer_stays_connected_until_client_configures_timeout() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("host");
        let server = BootstrapServer::bind(&directory, ready()).unwrap();
        let path = directory.join(SOCKET_NAME);
        let cancel = CancellationToken::new();
        let task = tokio::spawn(server.serve(cancel.clone()));
        tokio::task::spawn_blocking(move || {
            use std::io::Read;
            let mut stream = std::os::unix::net::UnixStream::connect(path).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(50));
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(1)))
                .unwrap();
            check_peer_uid(&stream).unwrap();
            let mut length = [0; 4];
            stream.read_exact(&mut length).unwrap();
            let mut bytes = vec![0; u32::from_le_bytes(length) as usize];
            stream.read_exact(&mut bytes).unwrap();
            assert_eq!(
                serde_json::from_slice::<ControlReady>(&bytes)
                    .unwrap()
                    .instance_id,
                ready().instance_id
            );
        })
        .await
        .unwrap();
        cancel.cancel();
        task.await.unwrap().unwrap();
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn long_profile_path_keeps_private_socket_and_live_owner() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("profile-".repeat(20));
        let server = BootstrapServer::bind(&directory, ready()).unwrap();
        let path = directory.join(SOCKET_NAME);
        check_private(&path, false).unwrap();
        assert!(BootstrapServer::bind(&directory, ready()).is_err());
        let cancel = CancellationToken::new();
        let task = tokio::spawn(server.serve(cancel.clone()));
        let read_path = path.clone();
        let actual = tokio::task::spawn_blocking(move || read_ready(&read_path))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(actual.instance_id, ready().instance_id);
        cancel.cancel();
        task.await.unwrap().unwrap();
        assert!(!path.exists());
    }

    #[tokio::test]
    async fn protected_bootstrap_joins_and_removes_only_owned_socket() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("host");
        let server = BootstrapServer::bind(&directory, ready()).unwrap();
        assert!(BootstrapServer::bind(&directory, ready()).is_err());
        let cancel = CancellationToken::new();
        let task = tokio::spawn(server.serve(cancel.clone()));
        let path = directory.join(SOCKET_NAME);
        let read_path = path.clone();
        let actual = tokio::task::spawn_blocking(move || read_ready(&read_path))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(actual.credential, ready().credential);
        cancel.cancel();
        task.await.unwrap().unwrap();
        assert!(!path.exists());
        assert!(is_stopped(&read_ready(&path).err().unwrap()));
    }

    #[tokio::test]
    async fn rejects_insecure_directory_symlink_and_non_socket() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("host");
        std::fs::create_dir(&directory).unwrap();
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(BootstrapServer::bind(&directory, ready()).is_err());
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700)).unwrap();
        let path = directory.join(SOCKET_NAME);
        std::fs::write(&path, b"preserve").unwrap();
        assert!(BootstrapServer::bind(&directory, ready()).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"preserve");
        let link = root.path().join("link");
        std::os::unix::fs::symlink(&directory, &link).unwrap();
        assert!(BootstrapServer::bind(&link, ready()).is_err());
    }

    #[tokio::test]
    async fn reclaims_refused_socket_but_never_a_live_owner() {
        let root = tempfile::tempdir().unwrap();
        std::fs::set_permissions(root.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        let path = root.path().join(SOCKET_NAME);
        let listener = std::os::unix::net::UnixListener::bind(&path).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert!(BootstrapServer::bind(root.path(), ready()).is_err());
        drop(listener);
        let server = BootstrapServer::bind(root.path(), ready()).unwrap();
        drop(server);
        assert!(!path.exists());
    }

    #[test]
    fn refuses_foreign_endpoint_and_invalid_runtime_identity() {
        for endpoint in [
            "http://localhost:1234",
            "http://127.0.0.1:0",
            "http://127.0.0.1:65536",
            "http://127.0.0.1:1234/",
            "http://192.0.2.1:1234",
        ] {
            let mut value = ready();
            value.endpoint = endpoint.to_owned();
            assert!(value.validate().is_err());
        }
    }
}
