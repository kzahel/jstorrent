use std::io;

use rstorrent_native_host::ConfiguredLauncher;

fn main() {
    // A browser-abandoned or partial stdin frame must not retain a host forever.
    std::thread::spawn(|| {
        std::thread::sleep(std::time::Duration::from_secs(20));
        std::process::exit(1);
    });
    if let Err(error) = run() {
        eprintln!("RSTorrent native host: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    set_binary_stdio()?;
    let caller_origin = std::env::args().nth(1);
    let executable = std::env::current_exe()?;
    if rstorrent_native_host::legacy::is_refusal_executable(&executable) {
        return rstorrent_native_host::legacy::run_refusal(
            &mut io::stdin().lock(),
            &mut io::stdout().lock(),
            caller_origin.as_deref(),
        )
        .map_err(Into::into);
    }
    let mut launcher = ConfiguredLauncher::for_host_executable(&executable);
    let mut stdin = io::stdin().lock();
    let mut stdout = io::stdout().lock();
    rstorrent_native_host::run(
        &mut stdin,
        &mut stdout,
        caller_origin.as_deref(),
        &mut launcher,
    )?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn set_binary_stdio() -> io::Result<()> {
    Ok(())
}

#[cfg(target_os = "windows")]
fn set_binary_stdio() -> io::Result<()> {
    use std::os::raw::c_int;

    const STDIN_FILENO: c_int = 0;
    const STDOUT_FILENO: c_int = 1;
    const O_BINARY: c_int = 0x8000;

    unsafe extern "C" {
        fn _setmode(fd: c_int, mode: c_int) -> c_int;
    }

    for file_descriptor in [STDIN_FILENO, STDOUT_FILENO] {
        if unsafe { _setmode(file_descriptor, O_BINARY) } == -1 {
            return Err(io::Error::last_os_error());
        }
    }
    Ok(())
}
