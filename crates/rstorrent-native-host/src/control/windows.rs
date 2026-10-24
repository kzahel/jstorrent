//! Windows rendezvous. All raw handles and security buffers stay in this module.
use super::{ControlReady, MAX_READY_BYTES, SOCKET_NAME};
use sha2::{Digest, Sha256};
use std::ffi::c_void;
use std::io;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::path::Path;
use std::ptr::null_mut;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::windows::named_pipe::{ClientOptions, NamedPipeServer, ServerOptions};
use tokio_util::sync::CancellationToken;
use windows_sys::Win32::Foundation::{ERROR_NO_DATA, ERROR_PIPE_BUSY, LocalFree};
use windows_sys::Win32::Security::Authorization::{
    ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW, GetSecurityInfo,
    SE_FILE_OBJECT,
};
use windows_sys::Win32::Security::{
    GetTokenInformation, OWNER_SECURITY_INFORMATION, SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER,
    TokenUser,
};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

const EXCHANGE_TIMEOUT: Duration = Duration::from_secs(1);

struct LocalAllocation(*mut c_void);
impl Drop for LocalAllocation {
    fn drop(&mut self) {
        // SAFETY: these buffers are returned by Win32 with LocalFree ownership.
        unsafe {
            LocalFree(self.0);
        }
    }
}

fn sid_string(sid: *mut c_void) -> io::Result<String> {
    let mut text = null_mut();
    // SAFETY: callers retain the OS-owned token/descriptor buffer containing SID.
    if unsafe { ConvertSidToStringSidW(sid, &mut text) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let _allocation = LocalAllocation(text.cast());
    // SID strings are bounded by Windows (184 characters), including terminator.
    let mut length = 0;
    while length < 184 && unsafe { *text.add(length) } != 0 {
        length += 1;
    }
    if length == 184 {
        return Err(io::Error::other("invalid Windows SID"));
    }
    // SAFETY: length was measured within the returned terminated SID string.
    Ok(String::from_utf16_lossy(unsafe {
        std::slice::from_raw_parts(text, length)
    }))
}

fn current_sid() -> io::Result<String> {
    let mut token = null_mut();
    // SAFETY: valid process pseudo-handle and writable out pointer.
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: OpenProcessToken returned a new owned handle.
    let token = unsafe { OwnedHandle::from_raw_handle(token) };
    // TOKEN_USER plus maximum SID fits comfortably; usize guarantees alignment.
    let mut buffer = [0_usize; 128];
    let mut needed = 0;
    // SAFETY: aligned writable storage; token and all pointers remain live.
    if unsafe {
        GetTokenInformation(
            token.as_raw_handle(),
            TokenUser,
            buffer.as_mut_ptr().cast(),
            std::mem::size_of_val(&buffer) as u32,
            &mut needed,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: successful TokenUser query initialized the TOKEN_USER header.
    sid_string(unsafe { (*buffer.as_ptr().cast::<TOKEN_USER>()).User.Sid })
}

fn pipe_name(path: &Path, sid: &str) -> String {
    use std::os::windows::ffi::OsStrExt;
    let mut hash = Sha256::new();
    hash.update(sid.as_bytes());
    for unit in path.as_os_str().encode_wide() {
        hash.update(unit.to_le_bytes());
    }
    format!(r"\\.\pipe\rstorrent-desktop-v1-{:x}", hash.finalize())
}

fn verify_owner(handle: *mut c_void, expected: &str) -> io::Result<()> {
    let mut owner = null_mut();
    let mut descriptor = null_mut();
    // SAFETY: live pipe handle with GENERIC_READ (includes READ_CONTROL); all
    // output pointers have the documented types. No path-based TOCTOU lookup.
    let error = unsafe {
        GetSecurityInfo(
            handle,
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION,
            &mut owner,
            null_mut(),
            null_mut(),
            null_mut(),
            &mut descriptor,
        )
    };
    if error != 0 {
        return Err(io::Error::from_raw_os_error(error as i32));
    }
    let _allocation = LocalAllocation(descriptor);
    if owner.is_null() || sid_string(owner)? != expected {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "foreign desktop owner",
        ));
    }
    Ok(())
}

pub fn read_ready(path: &Path) -> io::Result<ControlReady> {
    let sid = current_sid()?;
    let name = pipe_name(path, &sid);
    // Native messaging calls this from its synchronous main thread.
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?
        .block_on(async {
            tokio::time::timeout(EXCHANGE_TIMEOUT, async {
                let mut pipe = loop {
                    match ClientOptions::new().open(&name) {
                        Ok(pipe) => break pipe,
                        Err(error) if matches!(error.raw_os_error(), Some(code) if code == ERROR_PIPE_BUSY as i32 || code == ERROR_NO_DATA as i32) => {
                            tokio::time::sleep(Duration::from_millis(10)).await
                        }
                        Err(error) => return Err(error),
                    }
                };
                verify_owner(pipe.as_raw_handle(), &sid)?;
                let length = pipe.read_u32_le().await.map_err(|e| io::Error::new(e.kind(), format!("read ready length: {e}")))? as usize;
                if length > MAX_READY_BYTES {
                    return Err(io::Error::other("oversized ready response"));
                }
                let mut bytes = vec![0; length];
                pipe.read_exact(&mut bytes).await?;
                let ready: ControlReady =
                    serde_json::from_slice(&bytes).map_err(io::Error::other)?;
                ready.validate()?;
                let _ = pipe.write_all(&[1]).await;
                Ok(ready)
            })
            .await
            .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "desktop bootstrap timed out"))?
        })
}

pub struct BootstrapServer {
    pipe: NamedPipeServer,
    ready: ControlReady,
    name: String,
    sid: String,
}

impl BootstrapServer {
    pub fn bind(directory: &Path, ready: ControlReady) -> io::Result<Self> {
        ready.validate()?;
        let sid = current_sid()?;
        let name = pipe_name(&directory.join(SOCKET_NAME), &sid);
        let pipe = Self::create_pipe(&name, &sid, true)?;
        Ok(Self {
            pipe,
            ready,
            name,
            sid,
        })
    }

    fn create_pipe(name: &str, sid: &str, first: bool) -> io::Result<NamedPipeServer> {
        let sddl: Vec<u16> = format!("O:{sid}D:P(A;;GA;;;{sid})\0")
            .encode_utf16()
            .collect();
        let mut descriptor = null_mut();
        // SAFETY: terminated SDDL and writable output. Revision 1 is SDDL_REVISION_1.
        if unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl.as_ptr(),
                1,
                &mut descriptor,
                null_mut(),
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        let _allocation = LocalAllocation(descriptor);
        let mut attributes = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor,
            bInheritHandle: 0,
        };
        // SAFETY: security attributes and descriptor remain live through creation;
        // CreateNamedPipe copies the descriptor, not its pointer.
        let pipe = unsafe {
            ServerOptions::new()
                .first_pipe_instance(first)
                .max_instances(2)
                .reject_remote_clients(true)
                .in_buffer_size(64)
                .out_buffer_size(MAX_READY_BYTES as u32 + 4)
                .create_with_security_attributes_raw(
                    name,
                    (&mut attributes as *mut SECURITY_ATTRIBUTES).cast(),
                )
        }?;
        Ok(pipe)
    }

    pub async fn serve(mut self, cancel: CancellationToken) -> io::Result<()> {
        let bytes = serde_json::to_vec(&self.ready).map_err(io::Error::other)?;
        if bytes.len() > MAX_READY_BYTES {
            return Err(io::Error::other("oversized ready response"));
        }
        loop {
            tokio::select! {
                biased;
                () = cancel.cancelled() => return Ok(()),
                result = self.pipe.connect() => result?,
            }
            // Create the replacement while the current instance still owns the
            // name. Tokio/Mio retains per-handle read state after disconnect;
            // fresh handles avoid reusing a completed/EOF overlapped read.
            let replacement = async {
                loop {
                    match Self::create_pipe(&self.name, &self.sid, false) {
                        Ok(pipe) => return Ok(pipe),
                        Err(error) if error.raw_os_error() == Some(ERROR_PIPE_BUSY as i32) => {
                            tokio::time::sleep(Duration::from_millis(1)).await
                        }
                        Err(error) => return Err(error),
                    }
                }
            };
            let next = tokio::select! {
                biased;
                () = cancel.cancelled() => return Ok(()),
                result = tokio::time::timeout(EXCHANGE_TIMEOUT, replacement) =>
                    result.map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "pipe replacement timed out"))??,
            };
            let exchange = async {
                self.pipe.write_u32_le(bytes.len() as u32).await?;
                self.pipe.write_all(&bytes).await?;
                self.pipe.read_u8().await?;
                let mut end = [0];
                self.pipe.read(&mut end).await.map(|_| ())
            };
            tokio::select! {
                biased;
                () = cancel.cancelled() => return Ok(()),
                _ = tokio::time::timeout(EXCHANGE_TIMEOUT, exchange) => {},
            }
            let _ = self.pipe.disconnect();
            self.pipe = next;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ready() -> ControlReady {
        ControlReady {
            endpoint: "http://127.0.0.1:12345".into(),
            credential: "a".repeat(64),
            instance_id: "b".repeat(32),
            profile_id: "default".into(),
        }
    }

    #[tokio::test]
    async fn protected_pipe_roundtrip_duplicate_bind_races_and_shutdown() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join(SOCKET_NAME);
        let server = BootstrapServer::bind(directory.path(), ready()).unwrap();
        assert!(BootstrapServer::bind(directory.path(), ready()).is_err());
        let cancel = CancellationToken::new();
        let task = tokio::spawn(server.serve(cancel.clone()));
        let mut callers = tokio::task::JoinSet::new();
        for _ in 0..12 {
            let path = path.clone();
            callers.spawn_blocking(move || read_ready(&path).unwrap());
        }
        while let Some(result) = callers.join_next().await {
            assert_eq!(result.unwrap().instance_id, "b".repeat(32));
        }
        cancel.cancel();
        tokio::time::timeout(Duration::from_secs(2), task)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let stopped = tokio::task::spawn_blocking(move || read_ready(&path).err().unwrap())
            .await
            .unwrap();
        assert!(super::super::is_stopped(&stopped));
    }

    #[tokio::test]
    async fn owner_mismatch_refused_and_idle_exchange_cancelled() {
        let directory = tempfile::tempdir().unwrap();
        let server = BootstrapServer::bind(directory.path(), ready()).unwrap();
        let name = pipe_name(&directory.path().join(SOCKET_NAME), &current_sid().unwrap());
        let client = ClientOptions::new().open(name).unwrap();
        assert_eq!(
            verify_owner(client.as_raw_handle(), "S-1-0-0")
                .unwrap_err()
                .kind(),
            io::ErrorKind::PermissionDenied
        );
        let cancel = CancellationToken::new();
        let task = tokio::spawn(server.serve(cancel.clone()));
        tokio::time::sleep(Duration::from_millis(20)).await;
        cancel.cancel();
        tokio::time::timeout(Duration::from_secs(2), task)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
    }

    #[tokio::test]
    async fn oversized_frame_and_stalled_exchange_refused() {
        for oversized in [false, true] {
            let directory = tempfile::tempdir().unwrap();
            let path = directory.path().join(SOCKET_NAME);
            let mut server = BootstrapServer::bind(directory.path(), ready()).unwrap();
            let client = tokio::task::spawn_blocking(move || read_ready(&path));
            server.pipe.connect().await.unwrap();
            if oversized {
                server
                    .pipe
                    .write_u32_le(MAX_READY_BYTES as u32 + 1)
                    .await
                    .unwrap();
            }
            let error = client.await.unwrap().err().unwrap();
            assert_eq!(
                error.kind(),
                if oversized {
                    io::ErrorKind::Other
                } else {
                    io::ErrorKind::TimedOut
                }
            );
        }
    }

    #[tokio::test]
    async fn busy_pipe_is_not_a_stopped_runtime() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join(SOCKET_NAME);
        let _server = BootstrapServer::bind(directory.path(), ready()).unwrap();
        let _occupied = ClientOptions::new()
            .open(pipe_name(&path, &current_sid().unwrap()))
            .unwrap();
        let error = tokio::task::spawn_blocking(move || read_ready(&path).err().unwrap())
            .await
            .unwrap();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        assert!(!super::super::is_stopped(&error));
    }
}
