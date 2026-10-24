use std::env;
use std::path::Path;
use std::path::PathBuf;
use std::process::ExitCode;

use rstorrent_headless::runtime::{ErrorClass, InstalledLayout, run_installed_service};
use rstorrent_headless::updater::UpdateClient;
use rstorrent_headless::{SERVICE_NAME, installer};
use rstorrent_headless::{config, remote_admin};
use tokio_util::sync::CancellationToken;

const CONFIGURATION_EXIT: u8 = 78;
const RUNTIME_EXIT: u8 = 1;

#[tokio::main]
async fn main() -> ExitCode {
    match execute().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("rstorrent-headless: {error}");
            ExitCode::from(match error.class() {
                ErrorClass::Configuration => CONFIGURATION_EXIT,
                ErrorClass::Runtime => RUNTIME_EXIT,
            })
        }
    }
}

async fn execute() -> Result<(), rstorrent_headless::runtime::HeadlessError> {
    let arguments = env::args().skip(1).collect::<Vec<_>>();
    if arguments
        .first()
        .is_some_and(|argument| argument == "remote")
    {
        return execute_remote(&arguments[1..]).await;
    }
    match arguments.as_slice() {
        [argument] if argument == "--version" => {
            println!("rstorrent-headless {}", env!("CARGO_PKG_VERSION"));
            return Ok(());
        }
        [command, flag, bundle] if command == "install" && flag == "--bundle" => {
            return install(Path::new(bundle));
        }
        [command, flag, bundle] if command == "validate-package" && flag == "--bundle" => {
            let bundle = installer::BundleLayout::validate(Path::new(bundle))?;
            println!(
                "validated headless package version={} architecture={}",
                bundle.version, bundle.architecture
            );
            return Ok(());
        }
        [command] if command == "status" => return print_status(),
        [command, flag] if command == "update" && flag == "--check" => {
            return update(false).await;
        }
        [command, flag] if command == "update" && flag == "--apply" => {
            return update(true).await;
        }
        [command] if command == "uninstall" => return uninstall(),
        [command, rest @ ..] if command == "export-torrent-list" => {
            return export_torrent_list(rest);
        }
        _ => {}
    }
    let config_path = parse_config_path(arguments.into_iter())?;
    let layout = InstalledLayout::discover()?;
    let shutdown = CancellationToken::new();
    let signal_shutdown = shutdown.clone();
    tokio::spawn(async move {
        wait_for_shutdown_signal().await;
        signal_shutdown.cancel();
    });
    let report = match run_installed_service(&config_path, &layout, shutdown).await {
        Ok(report) => report,
        Err(error) => {
            explain_catalog_failure(&config_path, &error.to_string());
            return Err(error);
        }
    };
    eprintln!(
        "headless stopped version={} listeners={} shutdown_millis={}",
        report.version,
        report
            .listeners
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join(","),
        report.shutdown_elapsed.as_millis()
    );
    Ok(())
}

/// Tactical 369: when the torrent catalog will not open, say why and how to
/// save the torrent list. Never changes the profile.
fn explain_catalog_failure(config_path: &Path, failure: &str) {
    let Ok(config) = config::load(config_path) else {
        return;
    };
    if !config.profile_root.join("session.db").is_file() {
        return;
    }
    let status = rstorrent_session::diagnose_catalog(&config.profile_root, failure);
    let reason = match status.reason {
        rstorrent_session::CatalogRecoveryReason::MigrationFailed => {
            "the torrent list could not be updated to this version; it is unchanged and an update will fix this"
        }
        rstorrent_session::CatalogRecoveryReason::NewerVersion => {
            "the torrent list is from a newer version; install the latest version"
        }
        rstorrent_session::CatalogRecoveryReason::RetiredVersion => {
            "the torrent list is from an early test version this version cannot read"
        }
        rstorrent_session::CatalogRecoveryReason::Locked => {
            "another running copy is using the torrent list; stop it and try again"
        }
        rstorrent_session::CatalogRecoveryReason::Unreadable => return,
    };
    eprintln!("rstorrent-headless: {reason}");
    if status.export_available {
        eprintln!(
            "rstorrent-headless: to save the torrent list, run: rstorrent-headless export-torrent-list --output /absolute/path/torrents.zip"
        );
    }
}

/// `export-torrent-list --output <file> [--config <file>]`: writes the torrent
/// list bundle without opening the catalog for writing (Tactical 369).
fn export_torrent_list(
    arguments: &[String],
) -> Result<(), rstorrent_headless::runtime::HeadlessError> {
    let mut output = None;
    let mut config_path = None;
    let mut arguments = arguments.iter();
    while let Some(flag) = arguments.next() {
        let value = arguments
            .next()
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .ok_or_else(|| configuration_error(format!("{flag} requires an absolute path")))?;
        match flag.as_str() {
            "--output" if output.is_none() => output = Some(value),
            "--config" if config_path.is_none() => config_path = Some(value),
            _ => {
                return Err(configuration_error(
                    "usage: export-torrent-list --output <file> [--config <file>]",
                ));
            }
        }
    }
    let output = output.ok_or_else(|| {
        configuration_error("usage: export-torrent-list --output <file> [--config <file>]")
    })?;
    if output.exists() {
        return Err(configuration_error(format!(
            "{} already exists; choose a new file",
            output.display()
        )));
    }
    let config = config::load(&match config_path {
        Some(path) => path,
        None => default_config_path()?,
    })?;
    let bundle = rstorrent_session::export_torrent_list_read_only(&config.profile_root)
        .map_err(|error| configuration_error(error.to_string()))?;
    std::fs::write(&output, bundle)
        .map_err(|error| configuration_error(format!("write {}: {error}", output.display())))?;
    println!("saved the torrent list to {}", output.display());
    Ok(())
}

async fn execute_remote(
    arguments: &[String],
) -> Result<(), rstorrent_headless::runtime::HeadlessError> {
    let (config_path, command) = if let [flag, path, command @ ..] = arguments
        && flag == "--config"
    {
        let path = PathBuf::from(path);
        if !path.is_absolute() {
            return Err(configuration_error(
                "remote --config requires an absolute path",
            ));
        }
        (path, command)
    } else {
        (default_config_path()?, arguments)
    };
    let config = config::load(&config_path)?;
    if config.remote_access.is_none() {
        return Err(configuration_error(
            "remote administration requires configured remote access",
        ));
    }
    let request = parse_remote_request(command)?;
    let result = remote_admin::request(&config.profile_root, request).await?;
    println!(
        "{}",
        serde_json::to_string_pretty(&result)
            .map_err(|_| configuration_error("serialize remote administration result"))?
    );
    Ok(())
}

fn parse_remote_request(
    command: &[String],
) -> Result<remote_admin::RemoteAdminRequest, rstorrent_headless::runtime::HeadlessError> {
    use remote_admin::RemoteAdminRequest;

    let request = match command {
        [operation] if operation == "status" => RemoteAdminRequest::Status,
        [operation, username, flag, path]
            if operation == "enable" && flag == "--passphrase-file" =>
        {
            RemoteAdminRequest::Enable {
                username: username.clone(),
                passphrase: read_remote_passphrase(path)?,
            }
        }
        [operation, client_id, label] if operation == "rename" => RemoteAdminRequest::Rename {
            client_id: client_id.clone(),
            label: label.clone(),
        },
        [operation, client_id] if operation == "revoke" => RemoteAdminRequest::Revoke {
            client_id: client_id.clone(),
        },
        [operation, client_id] if operation == "revoke-all-other" => {
            RemoteAdminRequest::RevokeAllOther {
                retained_client_id: client_id.clone(),
            }
        }
        [operation, circuit_id] if operation == "close-circuit" => {
            RemoteAdminRequest::CloseCircuit {
                circuit_id: circuit_id.clone(),
            }
        }
        [operation] if operation == "require-password" => RemoteAdminRequest::RequirePassword,
        [operation, flag, path]
            if operation == "change-passphrase" && flag == "--passphrase-file" =>
        {
            RemoteAdminRequest::ChangePassphrase {
                passphrase: read_remote_passphrase(path)?,
            }
        }
        [operation] if operation == "disable" => RemoteAdminRequest::Disable,
        [operation, username, flag, path]
            if operation == "recover" && flag == "--passphrase-file" =>
        {
            RemoteAdminRequest::Recover {
                username: username.clone(),
                passphrase: read_remote_passphrase(path)?,
            }
        }
        [operation] if operation == "clear-history" => RemoteAdminRequest::ClearHistory,
        _ => {
            return Err(configuration_error(
                "usage: rstorrent-headless remote [--config ABSOLUTE_PATH] status|enable USERNAME --passphrase-file ABSOLUTE_PATH|rename CLIENT_ID LABEL|revoke CLIENT_ID|revoke-all-other CLIENT_ID|close-circuit CIRCUIT_ID|require-password|change-passphrase --passphrase-file ABSOLUTE_PATH|disable|recover USERNAME --passphrase-file ABSOLUTE_PATH|clear-history",
            ));
        }
    };
    Ok(request)
}

fn read_remote_passphrase(
    source: &str,
) -> Result<String, rstorrent_headless::runtime::HeadlessError> {
    let path = PathBuf::from(source);
    if !path.is_absolute() {
        return Err(configuration_error(
            "--passphrase-file requires an absolute path",
        ));
    }
    let mut passphrase = config::load_remote_passphrase(&path)?;
    Ok(std::mem::take(&mut *passphrase))
}

async fn update(apply: bool) -> Result<(), rstorrent_headless::runtime::HeadlessError> {
    let layout = InstalledLayout::discover()?;
    let client = UpdateClient::production()?;
    let Some(candidate) = client.check(&layout.version).await? else {
        println!("JSTorrent Headless {} is up to date.", layout.version);
        return Ok(());
    };
    if !apply {
        println!(
            "JSTorrent Headless {} is available (current {}).",
            candidate.version(),
            layout.version
        );
        println!("Release: {}", candidate.release_url());
        println!("Apply: $HOME/.local/bin/rstorrent-headless update --apply");
        return Ok(());
    }
    println!(
        "Downloading and verifying JSTorrent Headless {}...",
        candidate.version()
    );
    let outcome = client.apply(&candidate).await?;
    println!(
        "Installed JSTorrent Headless {} with health-checked service recovery.",
        outcome.version
    );
    Ok(())
}

fn install(bundle: &Path) -> Result<(), rstorrent_headless::runtime::HeadlessError> {
    if !bundle.is_absolute() {
        return Err(configuration_error(
            "install --bundle requires an absolute path",
        ));
    }
    let outcome = installer::install_bundle(bundle)?;
    let paths = installer::InstallPaths::system()?;
    println!("Installed JSTorrent Headless {}.", outcome.version);
    if outcome.config_example_created {
        println!(
            "Created protected configuration example: {}",
            paths.config_example.display()
        );
    }
    if outcome.restored_running {
        println!("The previously running user service passed its configured health check.");
    } else {
        println!("Installation did not start or enable the user service.");
        println!("1. Copy and edit the protected example:");
        println!(
            "   cp {} {}",
            paths.config_example.display(),
            paths.config.display()
        );
        println!("   chmod 600 {}", paths.config.display());
        println!("2. Enable and start explicitly:");
        println!("   systemctl --user enable --now {SERVICE_NAME}");
    }
    println!("Status: {} status", paths.command.display());
    println!("Logs: journalctl --user -u {SERVICE_NAME}");
    Ok(())
}

fn print_status() -> Result<(), rstorrent_headless::runtime::HeadlessError> {
    let report = installer::status()?;
    println!(
        "product=rstorrent-headless version={} access_mode={} enabled={} active={} healthy={}",
        report.version, report.access_mode, report.enabled, report.active, report.healthy
    );
    Ok(())
}

fn uninstall() -> Result<(), rstorrent_headless::runtime::HeadlessError> {
    let paths = installer::InstallPaths::system()?;
    installer::uninstall()?;
    println!("Removed JSTorrent Headless application files and user service.");
    println!("Preserved configuration: {}", paths.config.display());
    println!(
        "Preserved configuration example: {}",
        paths.config_example.display()
    );
    println!("Profiles and every configured payload root were preserved.");
    Ok(())
}

fn parse_config_path(
    mut arguments: impl Iterator<Item = String>,
) -> Result<PathBuf, rstorrent_headless::runtime::HeadlessError> {
    let default = default_config_path()?;
    let Some(argument) = arguments.next() else {
        return Ok(default);
    };
    if argument != "--config" {
        return Err(configuration_error(
            "usage: rstorrent-headless [--config ABSOLUTE_PATH] | status | update --check | update --apply | uninstall",
        ));
    }
    let path = arguments
        .next()
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| configuration_error("--config requires an absolute path"))?;
    if arguments.next().is_some() || !path.is_absolute() {
        return Err(configuration_error(
            "--config accepts exactly one absolute path",
        ));
    }
    Ok(path)
}

fn default_config_path() -> Result<PathBuf, rstorrent_headless::runtime::HeadlessError> {
    let base = match env::var_os("XDG_CONFIG_HOME") {
        Some(value) => PathBuf::from(value),
        None => PathBuf::from(
            env::var_os("HOME")
                .ok_or_else(|| configuration_error("HOME is required for the default config"))?,
        )
        .join(".config"),
    };
    if !base.is_absolute() {
        return Err(configuration_error(
            "XDG_CONFIG_HOME or HOME must resolve to an absolute path",
        ));
    }
    Ok(base.join("rstorrent/headless.toml"))
}

fn configuration_error(message: impl Into<String>) -> rstorrent_headless::runtime::HeadlessError {
    rstorrent_headless::runtime::HeadlessError::from(
        rstorrent_headless::config::ConfigError::Invalid(message.into()),
    )
}

async fn wait_for_shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};

        if let Ok(mut terminate) = signal(SignalKind::terminate()) {
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {}
                _ = terminate.recv() => {}
            }
            return;
        }
    }
    let _ = tokio::signal::ctrl_c().await;
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::{parse_config_path, parse_remote_request};

    #[test]
    fn explicit_config_path_is_absolute_and_singular() {
        assert_eq!(
            parse_config_path(["--config".to_owned(), "/tmp/headless.toml".to_owned()].into_iter())
                .expect("explicit config"),
            PathBuf::from("/tmp/headless.toml")
        );
        assert!(
            parse_config_path(["--config".to_owned(), "relative".to_owned()].into_iter()).is_err()
        );
        assert!(parse_config_path(["--unknown".to_owned()].into_iter()).is_err());
    }

    #[test]
    fn remote_cli_never_accepts_a_literal_passphrase_argument() {
        assert!(
            parse_remote_request(&[
                "enable".to_owned(),
                "owner".to_owned(),
                "literal-secret".to_owned(),
            ])
            .is_err()
        );
        assert!(
            parse_remote_request(&["change-passphrase".to_owned(), "literal-secret".to_owned(),])
                .is_err()
        );
    }
}
