//! Same-user legacy process inspection. Every snapshot/process/token handle is owned.
use super::*;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::ptr::null_mut;

use windows_sys::Win32::Foundation::{
    ERROR_INSUFFICIENT_BUFFER, ERROR_INVALID_PARAMETER, ERROR_NO_MORE_FILES, INVALID_HANDLE_VALUE,
};
use windows_sys::Win32::Security::{
    EqualSid, GetTokenInformation, TOKEN_QUERY, TOKEN_USER, TokenUser,
};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::Threading::{
    GetCurrentProcess, OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION,
};

const MAX_PROCESSES: usize = 32768;
const MAX_TOKEN_BYTES: usize = 64 * 1024;

fn token_user(process: windows_sys::Win32::Foundation::HANDLE) -> io::Result<Vec<usize>> {
    let mut token = null_mut();
    // SAFETY: process is retained by caller; token receives a fresh owned handle.
    if unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut token) } == 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: successful OpenProcessToken transfers this handle to us.
    let token = unsafe { OwnedHandle::from_raw_handle(token.cast()) };
    let mut required = 0;
    // SAFETY: the documented sizing call has a null buffer and writes required.
    unsafe {
        GetTokenInformation(
            token.as_raw_handle().cast(),
            TokenUser,
            null_mut(),
            0,
            &mut required,
        )
    };
    if io::Error::last_os_error().raw_os_error() != Some(ERROR_INSUFFICIENT_BUFFER as i32)
        || required as usize > MAX_TOKEN_BYTES
        || (required as usize) < std::mem::size_of::<TOKEN_USER>()
    {
        return Err(io::Error::other("invalid process token size"));
    }
    // usize storage provides the alignment TOKEN_USER and its embedded SID require.
    let mut buffer = vec![0usize; (required as usize).div_ceil(std::mem::size_of::<usize>())];
    // SAFETY: aligned buffer has at least the requested number of bytes.
    if unsafe {
        GetTokenInformation(
            token.as_raw_handle().cast(),
            TokenUser,
            buffer.as_mut_ptr().cast(),
            required,
            &mut required,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    Ok(buffer)
}

pub(super) fn old_process_is_running() -> io::Result<bool> {
    // SAFETY: a documented pseudo handle valid for this call; it is not closed.
    let own = token_user(unsafe { GetCurrentProcess() })?;
    // SAFETY: OS snapshot creation has no pointer inputs.
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: successful snapshot creation transfers an owned handle.
    let snapshot = unsafe { OwnedHandle::from_raw_handle(snapshot.cast()) };
    // SAFETY: zero initialization is valid before filling the required size field.
    let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
    // SAFETY: entry size and writable storage follow ToolHelp's contract.
    let mut available = unsafe { Process32FirstW(snapshot.as_raw_handle().cast(), &mut entry) };
    let mut count = 0;
    while available != 0 {
        count += 1;
        if count > MAX_PROCESSES {
            return Err(io::Error::other("legacy process inventory exceeds bound"));
        }
        let length = entry
            .szExeFile
            .iter()
            .position(|c| *c == 0)
            .unwrap_or(entry.szExeFile.len());
        let name = String::from_utf16_lossy(&entry.szExeFile[..length]);
        if entry.th32ProcessID != std::process::id() && legacy_process_name(&name) {
            // SAFETY: snapshot PID, minimal read-only query rights, no inheritance.
            let process =
                unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, entry.th32ProcessID) };
            if process.is_null() {
                let error = io::Error::last_os_error();
                if error.raw_os_error() != Some(ERROR_INVALID_PARAMETER as i32) {
                    return Err(error);
                }
            } else {
                // SAFETY: successful OpenProcess transfers this handle to us.
                let process = unsafe { OwnedHandle::from_raw_handle(process.cast()) };
                let other = token_user(process.as_raw_handle().cast())?;
                // SAFETY: both aligned buffers retain valid TOKEN_USER structures/SIDs.
                let same = unsafe {
                    let own = &*own.as_ptr().cast::<TOKEN_USER>();
                    let other = &*other.as_ptr().cast::<TOKEN_USER>();
                    EqualSid(own.User.Sid, other.User.Sid)
                };
                if same != 0 {
                    return Ok(true);
                }
            }
        }
        // SAFETY: same retained snapshot and correctly sized writable entry.
        available = unsafe { Process32NextW(snapshot.as_raw_handle().cast(), &mut entry) };
    }
    if io::Error::last_os_error().raw_os_error() != Some(ERROR_NO_MORE_FILES as i32) {
        return Err(io::Error::last_os_error());
    }
    Ok(false)
}
