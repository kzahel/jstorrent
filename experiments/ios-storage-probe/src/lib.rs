//! Minimal C bridge for the physical iOS storage and networking probe.
//!
//! Payload bytes remain in Rust. Swift lends a coordinated directory path for
//! the duration of one synchronous call and receives only bounded JSON facts.

use std::ffi::{CStr, CString, c_char};
use std::fs;
use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::os::fd::BorrowedFd;
use std::os::unix::fs::{FileExt, MetadataExt};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::Path;
use std::time::{Duration, UNIX_EPOCH};

use rstorrent_engine::{
    StorageFileAccess, StorageFileKey, StorageFileLocator, StorageFilePool, StorageFileReference,
    StorageFileRole,
};
use rustix::fs::{CWD, RenameFlags, renameat_with};
use serde::Serialize;
use sha1::{Digest, Sha1};

const PROBE_DIRECTORY: &str = ".rstorrent-ios-storage-probe";
const FILE_LENGTH: u64 = 64 * 1024;
const TRUNCATED_LENGTH: u64 = 40 * 1024;
const NETWORK_PAYLOAD: &[u8] = b"rstorrent-ios-network-probe-v1";

#[derive(Debug, Serialize)]
struct StorageReport {
    ok: bool,
    sha1: String,
    initial_length: u64,
    truncated_length: u64,
    regular_file: bool,
    modified_unix_nanos: Option<u128>,
    allocated_bytes: u64,
    rename_collision_rejected: bool,
    pool_limit: usize,
    handle_high_water: usize,
    cached_after_shutdown: usize,
    owned_after_shutdown: usize,
    probe_file_high_water: usize,
    process_descriptor_baseline: Option<usize>,
    process_descriptor_sampled_high_water: Option<usize>,
    process_descriptor_final: Option<usize>,
    cleanup_complete: bool,
}

#[derive(Debug, Serialize)]
struct InterruptedStorageReport {
    ok: bool,
    prepared_length: u64,
    sync_complete: bool,
    pool_limit: usize,
    handle_high_water: usize,
    cached_after_shutdown: usize,
    owned_after_shutdown: usize,
    probe_file_high_water: usize,
    process_descriptor_baseline: Option<usize>,
    process_descriptor_sampled_high_water: Option<usize>,
    process_descriptor_final: Option<usize>,
    cleanup_required: bool,
}

#[derive(Debug, Serialize)]
struct NetworkReport {
    ok: bool,
    endpoint_scope: &'static str,
    tcp_echo_bytes: usize,
    udp_echo_bytes: usize,
}

#[derive(Debug, Serialize)]
struct FailureReport<'a> {
    ok: bool,
    error: &'a str,
}

#[unsafe(no_mangle)]
pub extern "C" fn rstorrent_ios_probe_run_storage(root: *const c_char) -> *mut c_char {
    ffi_json(|| {
        let root = c_string(root)?;
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|error| format!("build storage runtime: {error}"))?;
        runtime.block_on(run_storage(Path::new(&root)))
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn rstorrent_ios_probe_prepare_interrupted_storage(
    root: *const c_char,
) -> *mut c_char {
    ffi_json(|| {
        let root = c_string(root)?;
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|error| format!("build interrupted-storage runtime: {error}"))?;
        runtime.block_on(prepare_interrupted_storage(Path::new(&root)))
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn rstorrent_ios_probe_run_network(
    host: *const c_char,
    tcp_port: u16,
    udp_port: u16,
) -> *mut c_char {
    ffi_json(|| {
        let host = c_string(host)?;
        run_network(&host, tcp_port, udp_port)
    })
}

#[unsafe(no_mangle)]
/// Releases one JSON string returned by this library.
///
/// # Safety
///
/// `value` must be null or a live pointer returned by one of this library's
/// `rstorrent_ios_probe_run_*` functions, and it must be released exactly once.
pub unsafe extern "C" fn rstorrent_ios_probe_free_json(value: *mut c_char) {
    if !value.is_null() {
        // SAFETY: `value` must be a pointer returned by `CString::into_raw`
        // from this library. The Swift bridge releases every result once.
        drop(unsafe { CString::from_raw(value) });
    }
}

fn ffi_json<T, F>(operation: F) -> *mut c_char
where
    T: Serialize,
    F: FnOnce() -> Result<T, String>,
{
    let result = catch_unwind(AssertUnwindSafe(operation));
    let encoded = match result {
        Ok(Ok(report)) => serde_json::to_string(&report)
            .unwrap_or_else(|error| failure_json(&format!("encode probe report: {error}"))),
        Ok(Err(error)) => failure_json(&error),
        Err(_) => failure_json("Rust probe panicked"),
    };
    CString::new(encoded)
        .expect("serialized JSON contains no NUL")
        .into_raw()
}

fn failure_json(error: &str) -> String {
    serde_json::to_string(&FailureReport { ok: false, error }).expect("failure report serializes")
}

fn c_string(value: *const c_char) -> Result<String, String> {
    if value.is_null() {
        return Err("missing C string".to_owned());
    }
    // SAFETY: the Swift caller passes a live NUL-terminated UTF-8 string for
    // the duration of this synchronous call.
    let value = unsafe { CStr::from_ptr(value) };
    value
        .to_str()
        .map(str::to_owned)
        .map_err(|error| format!("invalid UTF-8 bridge string: {error}"))
}

async fn run_storage(root: &Path) -> Result<StorageReport, String> {
    let process_descriptor_baseline = process_descriptor_count();
    let mut process_descriptor_sampled_high_water = process_descriptor_baseline;
    let workspace = root.join(PROBE_DIRECTORY);
    remove_owned_workspace(&workspace)?;
    let nested = workspace.join("nested").join("deeper");
    fs::create_dir_all(&nested).map_err(|error| format!("create nested directory: {error}"))?;

    let source = nested.join("payload.bin");
    let published = nested.join("published.bin");
    let collision = nested.join("collision.bin");
    let pool = StorageFilePool::new(8, None).map_err(str::to_owned)?;
    let source_reference = path_reference(&pool, &source, 0, 0);
    let handle = source_reference
        .open(StorageFileAccess::ReadWriteCreate)
        .await
        .map_err(|error| format!("open source through engine pool: {error}"))?;
    sample_descriptor_high_water(&mut process_descriptor_sampled_high_water);
    handle
        .file()
        .set_len(FILE_LENGTH)
        .map_err(|error| format!("size source: {error}"))?;

    let first = pattern(4096, 17);
    let second = pattern(8192, 91);
    handle
        .file()
        .write_all_at(&first, 3072)
        .map_err(|error| format!("positioned first write: {error}"))?;
    handle
        .file()
        .write_all_at(&second, 37 * 1024)
        .map_err(|error| format!("positioned second write: {error}"))?;
    handle
        .file()
        .sync_all()
        .map_err(|error| format!("sync source: {error}"))?;

    let mut first_read = vec![0; first.len()];
    let mut second_read = vec![0; second.len()];
    handle
        .file()
        .read_exact_at(&mut first_read, 3072)
        .map_err(|error| format!("positioned first read: {error}"))?;
    handle
        .file()
        .read_exact_at(&mut second_read, 37 * 1024)
        .map_err(|error| format!("positioned second read: {error}"))?;
    if first_read != first || second_read != second {
        return Err("positioned read did not reproduce Rust-owned payload".to_owned());
    }
    drop(handle);
    pool.invalidate_storage("ios-probe");

    let sha1 = sha1_file(&source)?;
    let metadata = fs::symlink_metadata(&source)
        .map_err(|error| format!("observe source metadata: {error}"))?;
    let modified_unix_nanos = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_nanos());

    fs::write(&collision, b"foreign")
        .map_err(|error| format!("create collision sentinel: {error}"))?;
    sample_descriptor_high_water(&mut process_descriptor_sampled_high_water);
    let rename_collision_rejected =
        renameat_with(CWD, &source, CWD, &collision, RenameFlags::NOREPLACE).is_err();
    if !rename_collision_rejected {
        return Err("no-replace rename overwrote a collision sentinel".to_owned());
    }
    fs::remove_file(&collision).map_err(|error| format!("remove collision sentinel: {error}"))?;
    renameat_with(CWD, &source, CWD, &published, RenameFlags::NOREPLACE)
        .map_err(|error| format!("publish with no-replace rename: {error}"))?;

    let published_reference = path_reference(&pool, &published, 0, 1);
    let published_handle = published_reference
        .open(StorageFileAccess::ReadWriteExisting)
        .await
        .map_err(|error| format!("reopen published file: {error}"))?;
    sample_descriptor_high_water(&mut process_descriptor_sampled_high_water);
    let mut reopened = vec![0; second.len()];
    published_handle
        .file()
        .read_exact_at(&mut reopened, 37 * 1024)
        .map_err(|error| format!("read reopened publication: {error}"))?;
    if reopened != second {
        return Err("reopened publication changed payload".to_owned());
    }
    published_handle
        .file()
        .set_len(TRUNCATED_LENGTH)
        .map_err(|error| format!("truncate publication: {error}"))?;
    published_handle
        .file()
        .sync_all()
        .map_err(|error| format!("sync truncated publication: {error}"))?;
    drop(published_handle);
    pool.invalidate_storage("ios-probe");
    published_reference
        .delete()
        .await
        .map_err(|error| format!("delete through engine reference: {error}"))?;

    let before_shutdown = pool.snapshot();
    pool.shutdown()
        .await
        .map_err(|error| format!("shutdown engine file pool: {error}"))?;
    let after_shutdown = pool.snapshot();
    remove_owned_workspace(&workspace)?;
    let process_descriptor_final = process_descriptor_count();
    let cleanup_complete = !workspace.exists();
    if !cleanup_complete {
        return Err("probe workspace remained after cleanup".to_owned());
    }

    Ok(StorageReport {
        ok: true,
        sha1,
        initial_length: metadata.len(),
        truncated_length: TRUNCATED_LENGTH,
        regular_file: metadata.is_file() && !metadata.file_type().is_symlink(),
        modified_unix_nanos,
        allocated_bytes: metadata.blocks().saturating_mul(512),
        rename_collision_rejected,
        pool_limit: before_shutdown.limit,
        handle_high_water: before_shutdown.owned_high_water,
        cached_after_shutdown: after_shutdown.cached_entries,
        owned_after_shutdown: after_shutdown.current_owned,
        probe_file_high_water: 2,
        process_descriptor_baseline,
        process_descriptor_sampled_high_water,
        process_descriptor_final,
        cleanup_complete,
    })
}

async fn prepare_interrupted_storage(root: &Path) -> Result<InterruptedStorageReport, String> {
    let process_descriptor_baseline = process_descriptor_count();
    let mut process_descriptor_sampled_high_water = process_descriptor_baseline;
    let workspace = root.join(PROBE_DIRECTORY);
    remove_owned_workspace(&workspace)?;
    let nested = workspace.join("nested").join("deeper");
    fs::create_dir_all(&nested).map_err(|error| format!("create interrupted tree: {error}"))?;

    let interrupted = nested.join("interrupted.bin");
    let pool = StorageFilePool::new(8, None).map_err(str::to_owned)?;
    let reference = path_reference(&pool, &interrupted, 0, 0);
    let handle = reference
        .open(StorageFileAccess::ReadWriteCreate)
        .await
        .map_err(|error| format!("open interrupted file through engine pool: {error}"))?;
    sample_descriptor_high_water(&mut process_descriptor_sampled_high_water);
    let payload = pattern(4096, 137);
    handle
        .file()
        .set_len(TRUNCATED_LENGTH)
        .map_err(|error| format!("size interrupted file: {error}"))?;
    handle
        .file()
        .write_all_at(&payload, 8192)
        .map_err(|error| format!("write interrupted file: {error}"))?;
    handle
        .file()
        .sync_all()
        .map_err(|error| format!("sync interrupted file: {error}"))?;
    drop(handle);
    pool.invalidate_storage("ios-probe");
    let before_shutdown = pool.snapshot();
    pool.shutdown()
        .await
        .map_err(|error| format!("shutdown interrupted file pool: {error}"))?;
    let after_shutdown = pool.snapshot();
    fs::File::open(&nested)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| format!("sync interrupted namespace: {error}"))?;
    let process_descriptor_final = process_descriptor_count();

    Ok(InterruptedStorageReport {
        ok: true,
        prepared_length: TRUNCATED_LENGTH,
        sync_complete: true,
        pool_limit: before_shutdown.limit,
        handle_high_water: before_shutdown.owned_high_water,
        cached_after_shutdown: after_shutdown.cached_entries,
        owned_after_shutdown: after_shutdown.current_owned,
        probe_file_high_water: 1,
        process_descriptor_baseline,
        process_descriptor_sampled_high_water,
        process_descriptor_final,
        cleanup_required: workspace.exists(),
    })
}

fn path_reference(
    pool: &StorageFilePool,
    path: &Path,
    file_index: usize,
    storage_generation: u64,
) -> StorageFileReference {
    StorageFileReference::new(
        pool.clone(),
        StorageFileKey {
            storage_id: "ios-probe".to_owned(),
            storage_generation,
            role: StorageFileRole::Payload(file_index),
        },
        StorageFileLocator::Path(path.to_owned()),
    )
}

fn sha1_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|error| format!("open for SHA-1: {error}"))?;
    let mut digest = Sha1::new();
    let mut buffer = [0_u8; 16 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("read for SHA-1: {error}"))?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn pattern(length: usize, seed: u8) -> Vec<u8> {
    (0..length)
        .map(|index| seed.wrapping_add((index as u8).wrapping_mul(31)))
        .collect()
}

fn remove_owned_workspace(path: &Path) -> Result<(), String> {
    match fs::remove_dir_all(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("remove owned probe workspace: {error}")),
    }
}

fn process_descriptor_count() -> Option<usize> {
    if let Ok(entries) = fs::read_dir("/dev/fd") {
        return Some(entries.count());
    }

    const MAXIMUM_DESCRIPTOR_SCAN: usize = 65_536;
    let limit = rustix::process::getrlimit(rustix::process::Resource::Nofile)
        .current
        .and_then(|value| usize::try_from(value).ok())?;
    if limit > MAXIMUM_DESCRIPTOR_SCAN {
        return None;
    }
    Some(
        (0..limit)
            .filter(|descriptor| {
                // SAFETY: the borrowed value is used only by this immediate
                // F_GETFD call, which reports EBADF if the number is not open.
                let borrowed = unsafe { BorrowedFd::borrow_raw(*descriptor as i32) };
                rustix::io::fcntl_getfd(borrowed).is_ok()
            })
            .count(),
    )
}

fn sample_descriptor_high_water(high_water: &mut Option<usize>) {
    if let Some(sample) = process_descriptor_count() {
        *high_water = Some(high_water.map_or(sample, |current| current.max(sample)));
    }
}

fn run_network(host: &str, tcp_port: u16, udp_port: u16) -> Result<NetworkReport, String> {
    if host == "loopback" {
        return run_loopback_network();
    }
    let ip: IpAddr = host
        .parse()
        .map_err(|error| format!("parse controlled endpoint address: {error}"))?;
    let timeout = Duration::from_secs(5);

    let tcp_endpoint = SocketAddr::new(ip, tcp_port);
    let mut tcp = TcpStream::connect_timeout(&tcp_endpoint, timeout)
        .map_err(|error| format!("connect direct Rust TCP: {error}"))?;
    tcp.set_read_timeout(Some(timeout))
        .map_err(|error| format!("set TCP read timeout: {error}"))?;
    tcp.set_write_timeout(Some(timeout))
        .map_err(|error| format!("set TCP write timeout: {error}"))?;
    tcp.write_all(NETWORK_PAYLOAD)
        .map_err(|error| format!("write direct Rust TCP: {error}"))?;
    let mut tcp_echo = vec![0; NETWORK_PAYLOAD.len()];
    tcp.read_exact(&mut tcp_echo)
        .map_err(|error| format!("read direct Rust TCP: {error}"))?;
    if tcp_echo != NETWORK_PAYLOAD {
        return Err("controlled TCP echo changed bytes".to_owned());
    }

    let udp = UdpSocket::bind(SocketAddr::new(ip_unspecified_for(ip), 0))
        .map_err(|error| format!("bind direct Rust UDP: {error}"))?;
    udp.set_read_timeout(Some(timeout))
        .map_err(|error| format!("set UDP read timeout: {error}"))?;
    udp.set_write_timeout(Some(timeout))
        .map_err(|error| format!("set UDP write timeout: {error}"))?;
    let udp_endpoint = SocketAddr::new(ip, udp_port);
    let sent = udp
        .send_to(NETWORK_PAYLOAD, udp_endpoint)
        .map_err(|error| format!("send direct Rust UDP: {error}"))?;
    if sent != NETWORK_PAYLOAD.len() {
        return Err(format!("short UDP send: {sent}"));
    }
    let mut udp_echo = [0_u8; 128];
    let (received, source) = udp
        .recv_from(&mut udp_echo)
        .map_err(|error| format!("receive direct Rust UDP: {error}"))?;
    if source != udp_endpoint || udp_echo[..received] != *NETWORK_PAYLOAD {
        return Err("controlled UDP echo changed endpoint or bytes".to_owned());
    }

    Ok(NetworkReport {
        ok: true,
        endpoint_scope: "controlled-lan",
        tcp_echo_bytes: tcp_echo.len(),
        udp_echo_bytes: received,
    })
}

fn run_loopback_network() -> Result<NetworkReport, String> {
    let loopback = IpAddr::V4(Ipv4Addr::LOCALHOST);
    let timeout = Duration::from_secs(5);
    let listener = TcpListener::bind(SocketAddr::new(loopback, 0))
        .map_err(|error| format!("bind controlled Rust TCP loopback: {error}"))?;
    let tcp_endpoint = listener
        .local_addr()
        .map_err(|error| format!("inspect controlled TCP loopback: {error}"))?;
    let tcp_server = std::thread::spawn(move || -> Result<(), String> {
        let (mut stream, _) = listener
            .accept()
            .map_err(|error| format!("accept controlled TCP loopback: {error}"))?;
        let mut payload = vec![0; NETWORK_PAYLOAD.len()];
        stream
            .read_exact(&mut payload)
            .map_err(|error| format!("read controlled TCP loopback: {error}"))?;
        stream
            .write_all(&payload)
            .map_err(|error| format!("echo controlled TCP loopback: {error}"))
    });
    let mut tcp = TcpStream::connect_timeout(&tcp_endpoint, timeout)
        .map_err(|error| format!("connect direct Rust TCP loopback: {error}"))?;
    tcp.set_read_timeout(Some(timeout))
        .map_err(|error| format!("set loopback TCP read timeout: {error}"))?;
    tcp.write_all(NETWORK_PAYLOAD)
        .map_err(|error| format!("write direct Rust TCP loopback: {error}"))?;
    let mut tcp_echo = vec![0; NETWORK_PAYLOAD.len()];
    tcp.read_exact(&mut tcp_echo)
        .map_err(|error| format!("read direct Rust TCP loopback: {error}"))?;
    tcp_server
        .join()
        .map_err(|_| "controlled TCP loopback thread panicked".to_owned())??;
    if tcp_echo != NETWORK_PAYLOAD {
        return Err("controlled TCP loopback changed bytes".to_owned());
    }

    let udp_server = UdpSocket::bind(SocketAddr::new(loopback, 0))
        .map_err(|error| format!("bind controlled Rust UDP loopback: {error}"))?;
    let udp_endpoint = udp_server
        .local_addr()
        .map_err(|error| format!("inspect controlled UDP loopback: {error}"))?;
    let udp_thread = std::thread::spawn(move || -> Result<(), String> {
        let mut payload = [0_u8; 128];
        let (received, source) = udp_server
            .recv_from(&mut payload)
            .map_err(|error| format!("receive controlled UDP loopback: {error}"))?;
        udp_server
            .send_to(&payload[..received], source)
            .map_err(|error| format!("echo controlled UDP loopback: {error}"))?;
        Ok(())
    });
    let udp = UdpSocket::bind(SocketAddr::new(loopback, 0))
        .map_err(|error| format!("bind direct Rust UDP loopback: {error}"))?;
    udp.set_read_timeout(Some(timeout))
        .map_err(|error| format!("set loopback UDP read timeout: {error}"))?;
    udp.send_to(NETWORK_PAYLOAD, udp_endpoint)
        .map_err(|error| format!("send direct Rust UDP loopback: {error}"))?;
    let mut udp_echo = [0_u8; 128];
    let (received, source) = udp
        .recv_from(&mut udp_echo)
        .map_err(|error| format!("receive direct Rust UDP loopback: {error}"))?;
    udp_thread
        .join()
        .map_err(|_| "controlled UDP loopback thread panicked".to_owned())??;
    if source != udp_endpoint || udp_echo[..received] != *NETWORK_PAYLOAD {
        return Err("controlled UDP loopback changed endpoint or bytes".to_owned());
    }

    Ok(NetworkReport {
        ok: true,
        endpoint_scope: "controlled-loopback",
        tcp_echo_bytes: tcp_echo.len(),
        udp_echo_bytes: received,
    })
}

fn ip_unspecified_for(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V4(_) => IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED),
        IpAddr::V6(_) => IpAddr::V6(std::net::Ipv6Addr::UNSPECIFIED),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        FILE_LENGTH, PROBE_DIRECTORY, TRUNCATED_LENGTH, pattern, prepare_interrupted_storage,
        run_loopback_network, run_storage,
    };

    #[test]
    fn payload_patterns_and_geometry_are_deterministic() {
        assert_eq!(FILE_LENGTH, 65_536);
        assert_eq!(TRUNCATED_LENGTH, 40_960);
        assert_eq!(&pattern(4, 17), &[17, 48, 79, 110]);
    }

    #[test]
    fn direct_tcp_and_udp_loopback_echo_exact_bytes() {
        let report = run_loopback_network().expect("controlled loopback");
        assert!(report.ok);
        assert_eq!(report.endpoint_scope, "controlled-loopback");
        assert_eq!(report.tcp_echo_bytes, 30);
        assert_eq!(report.udp_echo_bytes, 30);
    }

    #[test]
    fn storage_probe_uses_engine_pool_and_cleans_exact_workspace() {
        let root = std::env::temp_dir().join(format!(
            "rstorrent-ios-probe-host-test-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).expect("create host test root");
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("host test runtime");
        let report = runtime.block_on(run_storage(&root)).expect("storage probe");
        assert!(report.ok);
        assert_eq!(report.sha1, "48b6fdf2fd3b77c14cc54f54891dc6aed1eeec3a");
        assert_eq!(report.handle_high_water, 1);
        assert_eq!(report.cached_after_shutdown, 0);
        assert_eq!(report.owned_after_shutdown, 0);
        assert_eq!(report.probe_file_high_water, 2);
        assert!(report.process_descriptor_sampled_high_water >= report.process_descriptor_baseline);
        assert!(report.process_descriptor_sampled_high_water >= report.process_descriptor_final);
        assert!(report.cleanup_complete);
        std::fs::remove_dir(root).expect("remove host test root");
    }

    #[test]
    fn interrupted_storage_is_durable_and_next_run_reconciles_it() {
        let root = std::env::temp_dir().join(format!(
            "rstorrent-ios-probe-interrupted-host-test-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).expect("create interrupted host test root");
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("interrupted host test runtime");
        let prepared = runtime
            .block_on(prepare_interrupted_storage(&root))
            .expect("prepare interruption");
        assert!(prepared.ok);
        assert!(prepared.sync_complete);
        assert!(prepared.cleanup_required);
        assert_eq!(prepared.handle_high_water, 1);
        assert_eq!(prepared.cached_after_shutdown, 0);
        assert_eq!(prepared.owned_after_shutdown, 0);
        assert_eq!(prepared.probe_file_high_water, 1);
        assert!(
            prepared.process_descriptor_sampled_high_water >= prepared.process_descriptor_baseline
        );
        assert!(
            prepared.process_descriptor_sampled_high_water >= prepared.process_descriptor_final
        );
        assert!(root.join(PROBE_DIRECTORY).exists());

        let recovered = runtime
            .block_on(run_storage(&root))
            .expect("recover storage");
        assert!(recovered.ok);
        assert!(recovered.cleanup_complete);
        assert!(!root.join(PROBE_DIRECTORY).exists());
        std::fs::remove_dir(root).expect("remove interrupted host test root");
    }
}
