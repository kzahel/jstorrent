use std::path::Path;
use std::process::ExitCode;

#[cfg(target_os = "linux")]
use std::path::PathBuf;
#[cfg(target_os = "linux")]
use std::process::Command;

fn main() -> ExitCode {
    let mut arguments = std::env::args().skip(1);
    match arguments.next().as_deref() {
        Some("launch") => reject_extra(arguments).map_or_else(fail, |()| launch()),
        Some("serve") => reject_extra(arguments).map_or_else(fail, |()| serve()),
        Some("status") => reject_extra(arguments).map_or_else(fail, |()| status()),
        Some("install") => install(arguments),
        Some("uninstall") => uninstall(arguments),
        Some("--version" | "-V") => {
            println!("rstorrent-crostini {}", env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        Some("--help" | "-h") | None => {
            print_usage();
            ExitCode::SUCCESS
        }
        Some(argument) => fail(format!("unknown command {argument:?}")),
    }
}

fn launch() -> ExitCode {
    #[cfg(target_os = "linux")]
    {
        rstorrent_crostini::run_launcher_window().map_or_else(fail, |()| ExitCode::SUCCESS)
    }
    #[cfg(not(target_os = "linux"))]
    {
        fail("the ChromeOS Linux launcher runs only on Linux")
    }
}

fn serve() -> ExitCode {
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::process::CommandExt as _;

        let executable = match std::env::current_exe() {
            Ok(path) => path,
            Err(error) => return fail(format!("could not locate installed launcher: {error}")),
        };
        let bin = match executable.parent() {
            Some(path) => path,
            None => return fail("installed launcher has no binary directory"),
        };
        let version_root = match bin.parent() {
            Some(path) => path,
            None => return fail("installed launcher has no version directory"),
        };
        let gateway = bin.join("rstorrent-gateway");
        let web = version_root.join("web");
        if !gateway.is_file() || !web.join("index.html").is_file() {
            return fail("the installed Crostini package is incomplete");
        }
        let home = match std::env::var_os("HOME") {
            Some(value) if !value.is_empty() => PathBuf::from(value),
            _ => return fail("HOME is unavailable"),
        };
        let data = std::env::var_os("XDG_DATA_HOME")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".local/share"));
        let profile = data.join("rstorrent-crostini/profile");
        let downloads = home.join("Downloads");
        if let Err(error) = std::fs::create_dir_all(&downloads) {
            return fail(format!("could not prepare Linux Downloads: {error}"));
        }

        let error = Command::new(gateway)
            .arg("serve")
            .arg("--profile-root")
            .arg(profile)
            .arg("--listen")
            .arg("0.0.0.0:3030")
            .arg("--origin")
            .arg("http://jstorrent.localhost:3030")
            .arg("--auth")
            .arg("local-open")
            .arg("--web-root")
            .arg(web)
            .arg("--build-id")
            .arg(env!("CARGO_PKG_VERSION"))
            .arg("--chromeos-crostini")
            .arg("--no-open")
            .env("RSTORRENT_NETWORK_POLICY", "online")
            .env("RSTORRENT_STORAGE_ROOT", downloads)
            .exec();
        fail(format!("could not start the installed gateway: {error}"))
    }
    #[cfg(not(target_os = "linux"))]
    {
        fail("the ChromeOS Linux service runs only on Linux")
    }
}

fn status() -> ExitCode {
    match rstorrent_crostini::probe_system_gateway() {
        Ok(health) => {
            println!(
                "JSTorrent Crostini {} is ready (launch protocol {}).",
                health.build_id, health.launch_protocol
            );
            ExitCode::SUCCESS
        }
        Err(error) => fail(error),
    }
}

fn install(mut arguments: impl Iterator<Item = String>) -> ExitCode {
    let Some(flag) = arguments.next() else {
        return fail("install requires --bundle DIR");
    };
    if flag != "--bundle" {
        return fail(format!("unknown install option {flag:?}"));
    }
    let Some(bundle) = arguments.next() else {
        return fail("--bundle requires a directory");
    };
    if let Err(error) = reject_extra(arguments) {
        return fail(error);
    }
    rstorrent_crostini::install_bundle(Path::new(&bundle)).map_or_else(fail, |()| ExitCode::SUCCESS)
}

fn uninstall(mut arguments: impl Iterator<Item = String>) -> ExitCode {
    let purge = match arguments.next().as_deref() {
        None => false,
        Some("--purge") => true,
        Some(value) => return fail(format!("unknown uninstall option {value:?}")),
    };
    if let Err(error) = reject_extra(arguments) {
        return fail(error);
    }
    rstorrent_crostini::uninstall(purge).map_or_else(fail, |()| ExitCode::SUCCESS)
}

fn reject_extra(mut arguments: impl Iterator<Item = String>) -> Result<(), String> {
    arguments.next().map_or(Ok(()), |value| {
        Err(format!("unexpected argument {value:?}"))
    })
}

fn fail(error: impl std::fmt::Display) -> ExitCode {
    eprintln!("rstorrent-crostini: {error}");
    ExitCode::FAILURE
}

fn print_usage() {
    println!(
        "JSTorrent for ChromeOS Linux\n\n\
         Usage: rstorrent-crostini <command>\n\n\
         Commands:\n\
           launch                 Start the service and open JSTorrent in Chrome\n\
           serve                  Run the installed bundled backend\n\
           status                 Validate the local gateway identity\n\
           install --bundle DIR   Install one unpacked per-user bundle\n\
           uninstall [--purge]    Remove app files; optionally remove the profile\n\
           --version              Print the installed adapter version"
    );
}
