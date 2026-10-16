//! Finite stateless downloader composition for the native command line.

use std::ffi::{OsStr, OsString};
use std::fs::{self, File, OpenOptions, TryLockError};
use std::io::{self, IsTerminal, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use rstorrent_protocol::metainfo::MAX_EXPLICIT_METAINFO_LENGTH;
use sha2::{Digest, Sha256};
use tokio::sync::mpsc;

use crate::{
    AddTorrentBytesRequest, ApplicationConfig, ApplicationService, CONTROL_VERSION, Command,
    CommandResult, ConfiguredStorageRoot, DeliveryPolicy, ErrorCode, FilePriority,
    FileSelectionIntent, NetworkConfig, NetworkPolicy, ProgressDisposition, ProgressReason,
    RequestEnvelope, ResponseEnvelope, ResponseOutcome, ServiceSnapshot, SubscriptionSpec,
    TorrentState, TorrentView, TorrentViewChange, ViewPatch, ViewProjection, ViewSelector,
    ViewSnapshot, ViewUpdate, ViewUpdatePayload,
};

const OUTPUT_ROOT_ID: &str = "output";
const PROFILE_ID: &str = "foreground-download";
const CONTROL_DIRECTORY: &str = "rstorrent-download-v1";
const LOCK_FILE: &str = "lock";
const RUN_PREFIX: &str = "run-";
const MARKER_FILE: &str = ".rstorrent-download-workspace-v1";
const ACCESS_PROBE_PREFIX: &str = ".rstorrent-download-access-";
const LOCK_DOMAIN: &[u8] = b"rstorrent-download-output-root-v1\0";
const POLL_INTERVAL: Duration = Duration::from_millis(250);
const NON_TTY_INTERVAL: Duration = Duration::from_secs(10);
const PEER_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const PEER_IO_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_DISPLAY_CHARS: usize = 512;

const EXIT_SUCCESS: i32 = 0;
const EXIT_USAGE: i32 = 2;
const EXIT_LOCKED: i32 = 3;
const EXIT_REJECTED: i32 = 4;
const EXIT_RUNTIME: i32 = 5;
const EXIT_INTERRUPTED: i32 = 130;
#[cfg(unix)]
const EXIT_TERMINATED: i32 = 143;

const HELP: &str = "\
Usage: rstorrent-download [--output DIRECTORY] SOURCE

Download one magnet URI or local .torrent into DIRECTORY.

Options:
  --output DIRECTORY  output directory (default: current directory)
  --help              show this help
  --version           show the version
";

/// Run the foreground downloader and return its documented process exit code.
pub async fn run(arguments: impl Iterator<Item = OsString>) -> i32 {
    let invocation = match parse_arguments(arguments) {
        Ok(invocation) => invocation,
        Err(error) => {
            write_error(&error.message);
            write_stderr("Try 'rstorrent-download --help' for usage.\n");
            return error.exit;
        }
    };
    match invocation {
        Invocation::Help => write_stdout(HELP).map_or(EXIT_RUNTIME, |()| EXIT_SUCCESS),
        Invocation::Version => {
            let line = format!("rstorrent-download {}\n", env!("CARGO_PKG_VERSION"));
            write_stdout(&line).map_or(EXIT_RUNTIME, |()| EXIT_SUCCESS)
        }
        Invocation::Download(arguments) => match execute(arguments).await {
            Ok(summary) => {
                let message = if summary.zero_selection {
                    format!(
                        "Download complete: 0 files selected -> {}\n",
                        display_path(&summary.output_root)
                    )
                } else {
                    format!(
                        "Download complete: {} -> {}\n",
                        summary.name.as_deref().unwrap_or("torrent"),
                        display_path(&summary.output_root)
                    )
                };
                write_stdout(&message).map_or(EXIT_RUNTIME, |()| EXIT_SUCCESS)
            }
            Err(error) => {
                write_error(&error.message);
                error.exit
            }
        },
    }
}

#[derive(Debug)]
enum Invocation {
    Help,
    Version,
    Download(DownloadArguments),
}

#[derive(Debug)]
struct DownloadArguments {
    output: PathBuf,
    source: OsString,
}

fn parse_arguments(arguments: impl Iterator<Item = OsString>) -> Result<Invocation, CliError> {
    let arguments = arguments.collect::<Vec<_>>();
    if arguments.len() == 1 && arguments[0] == "--help" {
        return Ok(Invocation::Help);
    }
    if arguments.len() == 1 && arguments[0] == "--version" {
        return Ok(Invocation::Version);
    }
    let mut output = None;
    let mut source = None;
    let mut positional = false;
    let mut index = 0;
    while index < arguments.len() {
        let argument = &arguments[index];
        if !positional && argument == "--" {
            positional = true;
            index += 1;
            continue;
        }
        if !positional && argument == "--output" {
            if output.is_some() {
                return Err(CliError::usage("--output may appear only once"));
            }
            let value = arguments
                .get(index + 1)
                .ok_or_else(|| CliError::usage("--output requires a directory"))?;
            if value.is_empty() {
                return Err(CliError::usage("--output directory must not be empty"));
            }
            output = Some(PathBuf::from(value));
            index += 2;
            continue;
        }
        if !positional && argument.to_string_lossy().starts_with('-') {
            return Err(CliError::usage(format!(
                "unknown option {}",
                display_os(argument)
            )));
        }
        if source.replace(argument.clone()).is_some() {
            return Err(CliError::usage("exactly one source is required"));
        }
        index += 1;
    }
    let source = source.ok_or_else(|| CliError::usage("exactly one source is required"))?;
    if source.is_empty() {
        return Err(CliError::usage("source must not be empty"));
    }
    let output = match output {
        Some(output) => output,
        None => std::env::current_dir()
            .map_err(|error| CliError::usage(format!("resolve current directory: {error}")))?,
    };
    Ok(Invocation::Download(DownloadArguments { output, source }))
}

async fn execute(arguments: DownloadArguments) -> Result<CompletionSummary, CliError> {
    let output_root = prepare_output_root(&arguments.output)?;
    let lease = OutputRootLease::acquire(&output_root)?;
    validate_output_root_access(&output_root)?;
    let mut workspace = Workspace::prepare(&lease.control_root, &lease.key)?;
    let mut signals = match SignalOwner::start().await {
        Ok(signals) => signals,
        Err(error) => {
            let cleanup = workspace.cleanup();
            drop(lease);
            return cleanup.and(Err(error));
        }
    };
    tokio::task::yield_now().await;

    let source_result = prepare_source(arguments.source).await;
    let mut service = None;
    let mut renderer = ProgressRenderer::new();
    let outcome = match source_result {
        Ok(source) => {
            if let Some(signal) = signals.pending() {
                Err(CliError::signal(signal))
            } else {
                let network = NetworkConfig::new(
                    NetworkPolicy::Online,
                    PEER_CONNECT_TIMEOUT,
                    PEER_IO_TIMEOUT,
                );
                let config = ApplicationConfig::ephemeral(
                    PROFILE_ID.to_owned(),
                    vec![ConfiguredStorageRoot::path(
                        OUTPUT_ROOT_ID,
                        output_root.clone(),
                    )],
                    network,
                )
                .with_fresh_profile_defaults()
                .with_path_part_directory(workspace.path.clone());
                match ApplicationService::open(config).await {
                    Ok(opened) => {
                        let opened = Arc::new(tokio::sync::Mutex::new(opened));
                        ApplicationService::ensure_maintenance_owner(&opened).await;
                        service = Some(opened);
                        if let Some(signal) = signals.pending() {
                            Err(CliError::signal(signal))
                        } else {
                            download(
                                service.as_ref().expect("service was installed"),
                                source,
                                &output_root,
                                &mut signals,
                                &mut renderer,
                            )
                            .await
                        }
                    }
                    Err(error) => Err(CliError::runtime(format!(
                        "start downloader service: {error}"
                    ))),
                }
            }
        }
        Err(error) => Err(error),
    };

    renderer.finish();
    let mut cleanup_error = None;
    if let Some(service) = service.as_ref()
        && let Err(error) = service.lock().await.shutdown().await
    {
        cleanup_error = Some(format!("join downloader service: {error}"));
    }
    drop(service);
    if let Err(error) = workspace.cleanup() {
        cleanup_error.get_or_insert(error.message);
    }
    signals.shutdown().await;
    drop(lease);

    if let Some(error) = cleanup_error {
        return Err(CliError::runtime(error));
    }
    outcome
}

async fn download(
    service: &Arc<tokio::sync::Mutex<ApplicationService>>,
    source: PreparedSource,
    output_root: &Path,
    signals: &mut SignalOwner,
    renderer: &mut ProgressRenderer,
) -> Result<CompletionSummary, CliError> {
    let response = match source {
        PreparedSource::Magnet(magnet) => {
            service
                .lock()
                .await
                .dispatch(RequestEnvelope {
                    version: CONTROL_VERSION,
                    request_id: "foreground-add-magnet".to_owned(),
                    expected_revision: None,
                    command: Command::AddMagnet {
                        magnet,
                        storage_root: OUTPUT_ROOT_ID.to_owned(),
                        start_content: true,
                        await_file_selection: false,
                        skip_files: Vec::new(),
                    },
                })
                .await
        }
        PreparedSource::TorrentBytes(bytes) => {
            let source_length = u32::try_from(bytes.len())
                .map_err(|_| CliError::rejected("torrent source length exceeds u32"))?;
            service
                .lock()
                .await
                .add_torrent_bytes(
                    AddTorrentBytesRequest {
                        version: CONTROL_VERSION,
                        request_id: "foreground-add-torrent".to_owned(),
                        expected_revision: None,
                        storage_root: OUTPUT_ROOT_ID.to_owned(),
                        start_content: true,
                        await_file_selection: false,
                        selection: FileSelectionIntent::All,
                        source_length,
                    },
                    bytes,
                )
                .await
        }
    }
    .map_err(|error| CliError::runtime(format!("add torrent: {error}")))?;
    let (torrent_id, _) = accepted_add(response)?;
    let subscription = service
        .lock()
        .await
        .subscribe(SubscriptionSpec {
            selector: ViewSelector::Torrent {
                torrent_id: torrent_id.clone(),
            },
            projection: ViewProjection::Summary,
            delivery: DeliveryPolicy {
                min_interval_millis: 100,
                max_queue_bytes: 64 * 1024,
            },
            diagnostics: None,
            catalog_page: None,
        })
        .map_err(|error| CliError::runtime(format!("open progress view: {error}")))?;
    let mut view = None;
    let initial = subscription
        .next_update()
        .await
        .ok_or_else(|| CliError::runtime("progress view closed during startup"))?;
    apply_view_update(&mut view, initial)?;
    if let Some(current) = view.as_ref() {
        renderer.render(current)?;
    }

    loop {
        if view.as_ref().is_some_and(view_requires_terminal_snapshot) {
            let response = service
                .lock()
                .await
                .dispatch(RequestEnvelope {
                    version: CONTROL_VERSION,
                    request_id: "foreground-final-snapshot".to_owned(),
                    expected_revision: None,
                    command: Command::Snapshot,
                })
                .await
                .map_err(|error| {
                    CliError::runtime(format!("observe download completion: {error}"))
                })?;
            let snapshot = successful_snapshot(response)?;
            if let Some(terminal) =
                terminal_outcome(&torrent_id, &snapshot, view.as_ref(), output_root)?
            {
                subscription.close();
                return terminal;
            }
        }
        tokio::select! {
            signal = signals.receive() => {
                subscription.close();
                return Err(CliError::signal(signal));
            }
            update = subscription.next_update() => {
                let update = update.ok_or_else(|| {
                    CliError::runtime("progress view closed before completion")
                })?;
                if matches!(update.payload, ViewUpdatePayload::ResetRequired { .. }) {
                    subscription.resync().map_err(|error| {
                        CliError::runtime(format!("resynchronize progress view: {error}"))
                    })?;
                } else {
                    apply_view_update(&mut view, update)?;
                    if let Some(current) = view.as_ref() {
                        renderer.render(current)?;
                    }
                }
            }
            () = tokio::time::sleep(POLL_INTERVAL) => {
                if let Some(current) = view.as_ref() {
                    renderer.render(current)?;
                }
            }
        }
    }
}

fn view_requires_terminal_snapshot(view: &TorrentView) -> bool {
    matches!(
        view.state,
        TorrentState::Complete
            | TorrentState::NeedsRepair
            | TorrentState::Error
            | TorrentState::Paused
    ) || view.progress.disposition == ProgressDisposition::Blocked
}

fn accepted_add(response: ResponseEnvelope) -> Result<(String, ServiceSnapshot), CliError> {
    let snapshot = match response.outcome {
        ResponseOutcome::Success { snapshot } => snapshot,
        ResponseOutcome::Error { error } => {
            return Err(response_error(
                "source was rejected",
                error.code,
                &error.message,
            ));
        }
    };
    let torrent_id = match response.result {
        Some(CommandResult::AddTorrent { result }) => result.torrent_id,
        Some(CommandResult::ExportMagnet { .. }) | None => {
            return Err(CliError::runtime("add response omitted the torrent owner"));
        }
    };
    Ok((torrent_id, snapshot))
}

fn successful_snapshot(response: ResponseEnvelope) -> Result<ServiceSnapshot, CliError> {
    match response.outcome {
        ResponseOutcome::Success { snapshot } => Ok(snapshot),
        ResponseOutcome::Error { error } => Err(response_error(
            "snapshot was rejected",
            error.code,
            &error.message,
        )),
    }
}

fn response_error(context: &str, code: ErrorCode, message: &str) -> CliError {
    let message = format!("{context}: {}", sanitize(message, MAX_DISPLAY_CHARS));
    match code {
        ErrorCode::InvalidVersion
        | ErrorCode::InvalidRequest
        | ErrorCode::RequestConflict
        | ErrorCode::StaleRevision
        | ErrorCode::UnknownStorageRoot
        | ErrorCode::UnknownTorrent
        | ErrorCode::InvalidTorrentState
        | ErrorCode::InvalidDurableState
        | ErrorCode::ResourceLimit => CliError::rejected(message),
        ErrorCode::StorageRootInUse
        | ErrorCode::StorageNeedsRepair
        | ErrorCode::Busy
        | ErrorCode::Internal => CliError::runtime(message),
    }
}

fn terminal_outcome(
    torrent_id: &str,
    snapshot: &ServiceSnapshot,
    view: Option<&TorrentView>,
    output_root: &Path,
) -> Result<Option<Result<CompletionSummary, CliError>>, CliError> {
    let torrent = snapshot
        .torrents
        .iter()
        .find(|torrent| torrent.torrent_id == torrent_id)
        .ok_or_else(|| CliError::runtime("torrent disappeared before completion"))?;
    let zero_selection = torrent.metadata_available
        && (torrent.selection_default == FilePriority::Skip
            && torrent.selection_exceptions.is_empty()
            || torrent.desired_running && torrent.state == TorrentState::Paused);
    let completion = || CompletionSummary {
        output_root: output_root.to_path_buf(),
        name: view
            .and_then(|view| view.display_name.as_deref())
            .map(|name| sanitize(name, 160)),
        zero_selection,
    };
    match torrent.state {
        TorrentState::Complete => Ok(Some(Ok(completion()))),
        TorrentState::Paused if zero_selection => Ok(Some(Ok(completion()))),
        TorrentState::NeedsRepair | TorrentState::Error => {
            let detail = torrent
                .error
                .as_deref()
                .or_else(|| view.and_then(|view| view.error.as_deref()))
                .unwrap_or("download entered a terminal failure state");
            Ok(Some(Err(CliError::runtime(format!(
                "download failed: {}",
                sanitize(detail, MAX_DISPLAY_CHARS)
            )))))
        }
        TorrentState::Paused => Ok(Some(Err(CliError::runtime(
            "download stopped before verified completion",
        )))),
        TorrentState::AwaitingMetadata
        | TorrentState::AwaitingStorage
        | TorrentState::Checking
        | TorrentState::Downloading => {
            if view.is_some_and(|view| view.progress.disposition == ProgressDisposition::Blocked) {
                let reason = view
                    .map(|view| progress_reason(view.progress.reason))
                    .unwrap_or("blocked");
                Ok(Some(Err(CliError::runtime(format!(
                    "download cannot continue: {reason}"
                )))))
            } else {
                Ok(None)
            }
        }
    }
}

fn apply_view_update(view: &mut Option<TorrentView>, update: ViewUpdate) -> Result<(), CliError> {
    match update.payload {
        ViewUpdatePayload::Snapshot {
            snapshot: ViewSnapshot::Torrent { torrent },
        } => *view = torrent,
        ViewUpdatePayload::Patch {
            patch: ViewPatch::Torrent { change },
        } => match change {
            TorrentViewChange::Replace { torrent } => *view = torrent,
            TorrentViewChange::Update { update } => {
                let row = view.as_mut().ok_or_else(|| {
                    CliError::runtime("progress patch arrived before its snapshot")
                })?;
                update.apply(row).map_err(|error| {
                    CliError::runtime(format!("apply progress update: {error:?}"))
                })?;
            }
        },
        ViewUpdatePayload::ResetRequired { .. } => {
            return Err(CliError::runtime(
                "progress reset was not resynchronized by the caller",
            ));
        }
        ViewUpdatePayload::Snapshot { .. } | ViewUpdatePayload::Patch { .. } => {
            return Err(CliError::runtime(
                "progress view returned an unexpected projection",
            ));
        }
    }
    Ok(())
}

#[derive(Debug)]
enum SourceKind {
    Magnet(String),
    File(PathBuf),
}

#[derive(Debug)]
enum PreparedSource {
    Magnet(String),
    TorrentBytes(Vec<u8>),
}

async fn prepare_source(source: OsString) -> Result<PreparedSource, CliError> {
    let source = classify_source(source)?;
    match source {
        SourceKind::Magnet(magnet) => Ok(PreparedSource::Magnet(magnet)),
        SourceKind::File(path) => tokio::task::spawn_blocking(move || read_torrent_source(&path))
            .await
            .map_err(|error| CliError::runtime(format!("read torrent source task: {error}")))?,
    }
}

fn classify_source(source: OsString) -> Result<SourceKind, CliError> {
    if source
        .to_str()
        .is_some_and(|source| starts_with_ignore_ascii_case(source, "magnet:?"))
    {
        return Ok(SourceKind::Magnet(
            source
                .into_string()
                .expect("magnet classification required UTF-8"),
        ));
    }
    Ok(SourceKind::File(PathBuf::from(source)))
}

fn starts_with_ignore_ascii_case(value: &str, prefix: &str) -> bool {
    value
        .get(..prefix.len())
        .is_some_and(|value| value.eq_ignore_ascii_case(prefix))
}

fn read_torrent_source(path: &Path) -> Result<PreparedSource, CliError> {
    let mut file = File::open(path).map_err(|error| {
        CliError::usage(format!(
            "open torrent source {}: {error}",
            display_path(path)
        ))
    })?;
    let before = file.metadata().map_err(|error| {
        CliError::usage(format!(
            "inspect torrent source {}: {error}",
            display_path(path)
        ))
    })?;
    if !before.is_file() {
        return Err(CliError::usage(format!(
            "torrent source is not a regular file: {}",
            display_path(path)
        )));
    }
    if before.len() > MAX_EXPLICIT_METAINFO_LENGTH as u64 {
        return Err(CliError::usage(format!(
            "torrent source exceeds {MAX_EXPLICIT_METAINFO_LENGTH} bytes"
        )));
    }
    let capacity = usize::try_from(before.len())
        .map_err(|_| CliError::usage("torrent source length exceeds this platform"))?;
    let mut bytes = Vec::with_capacity(capacity);
    Read::by_ref(&mut file)
        .take(MAX_EXPLICIT_METAINFO_LENGTH as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            CliError::usage(format!(
                "read torrent source {}: {error}",
                display_path(path)
            ))
        })?;
    if bytes.len() > MAX_EXPLICIT_METAINFO_LENGTH {
        return Err(CliError::usage(format!(
            "torrent source exceeds {MAX_EXPLICIT_METAINFO_LENGTH} bytes"
        )));
    }
    let after = file.metadata().map_err(|error| {
        CliError::usage(format!(
            "reinspect torrent source {}: {error}",
            display_path(path)
        ))
    })?;
    if bytes.len() as u64 != before.len()
        || after.len() != before.len()
        || modified_changed(&before, &after)
    {
        return Err(CliError::usage(
            "torrent source changed while it was being read",
        ));
    }
    Ok(PreparedSource::TorrentBytes(bytes))
}

fn modified_changed(before: &fs::Metadata, after: &fs::Metadata) -> bool {
    match (before.modified(), after.modified()) {
        (Ok(before), Ok(after)) => before != after,
        _ => false,
    }
}

fn prepare_output_root(path: &Path) -> Result<PathBuf, CliError> {
    fs::create_dir_all(path).map_err(|error| {
        CliError::usage(format!(
            "create output directory {}: {error}",
            display_path(path)
        ))
    })?;
    let canonical = fs::canonicalize(path).map_err(|error| {
        CliError::usage(format!(
            "resolve output directory {}: {error}",
            display_path(path)
        ))
    })?;
    let metadata = fs::metadata(&canonical).map_err(|error| {
        CliError::usage(format!(
            "inspect output directory {}: {error}",
            display_path(&canonical)
        ))
    })?;
    if !metadata.is_dir() {
        return Err(CliError::usage(format!(
            "output path is not a directory: {}",
            display_path(&canonical)
        )));
    }
    if !canonical.is_absolute() {
        return Err(CliError::usage(
            "canonical output directory is not absolute",
        ));
    }
    Ok(canonical)
}

fn validate_output_root_access(output_root: &Path) -> Result<(), CliError> {
    for _ in 0..8 {
        let mut random = [0_u8; 16];
        getrandom::fill(&mut random)
            .map_err(|error| CliError::runtime(format!("create output access probe: {error}")))?;
        let path = output_root.join(format!("{ACCESS_PROBE_PREFIX}{}", hex(&random)));
        let file = OpenOptions::new().write(true).create_new(true).open(&path);
        let mut file = match file {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(CliError::runtime(format!(
                    "output directory is not writable: {error}"
                )));
            }
        };
        let operation = file
            .write_all(b"rstorrent-download-access-v1\n")
            .and_then(|()| file.sync_all());
        drop(file);
        let cleanup = fs::remove_file(path);
        return match (operation, cleanup) {
            (Ok(()), Ok(())) => Ok(()),
            (Err(error), Ok(())) => Err(CliError::runtime(format!(
                "output directory is not writable: {error}"
            ))),
            (Ok(()), Err(error)) => Err(CliError::runtime(format!(
                "remove output access probe: {error}"
            ))),
            (Err(operation), Err(cleanup)) => Err(CliError::runtime(format!(
                "output directory is not writable: {operation}; remove access probe: {cleanup}"
            ))),
        };
    }
    Err(CliError::runtime(
        "could not allocate a unique output access probe",
    ))
}

#[derive(Debug)]
struct OutputRootLease {
    _lock: File,
    control_root: PathBuf,
    key: String,
}

impl OutputRootLease {
    fn acquire(output_root: &Path) -> Result<Self, CliError> {
        let base = std::env::temp_dir().join(CONTROL_DIRECTORY);
        ensure_private_directory(&base, "temporary control directory")?;
        let key = output_root_key(output_root);
        let control_root = base.join(&key);
        ensure_private_directory(&control_root, "output control directory")?;
        let lock_path = control_root.join(LOCK_FILE);
        if let Ok(metadata) = fs::symlink_metadata(&lock_path)
            && (metadata.file_type().is_symlink() || !metadata.is_file())
        {
            return Err(CliError::runtime(
                "output lock rendezvous is not a regular file",
            ));
        }
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&lock_path)
            .map_err(|error| CliError::runtime(format!("open output lock: {error}")))?;
        set_private_file_permissions(&lock_path)?;
        let metadata = lock
            .metadata()
            .map_err(|error| CliError::runtime(format!("inspect output lock: {error}")))?;
        if !metadata.is_file() {
            return Err(CliError::runtime(
                "output lock rendezvous is not a regular file",
            ));
        }
        match lock.try_lock() {
            Ok(()) => Ok(Self {
                _lock: lock,
                control_root,
                key,
            }),
            Err(TryLockError::WouldBlock) => Err(CliError::locked(format!(
                "output directory is already in use: {}",
                display_path(output_root)
            ))),
            Err(TryLockError::Error(error)) => Err(CliError::runtime(format!(
                "acquire output directory lock: {error}"
            ))),
        }
    }
}

fn ensure_private_directory(path: &Path, label: &str) -> Result<(), CliError> {
    match fs::create_dir(path) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
        Err(error) => {
            return Err(CliError::runtime(format!("create {label}: {error}")));
        }
    }
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| CliError::runtime(format!("inspect {label}: {error}")))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(CliError::runtime(format!(
            "{label} is not a safe directory"
        )));
    }
    set_private_directory_permissions(path)
}

#[cfg(unix)]
fn set_private_directory_permissions(path: &Path) -> Result<(), CliError> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|error| CliError::runtime(format!("set temporary directory permissions: {error}")))
}

#[cfg(not(unix))]
fn set_private_directory_permissions(_path: &Path) -> Result<(), CliError> {
    Ok(())
}

#[cfg(unix)]
fn set_private_file_permissions(path: &Path) -> Result<(), CliError> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|error| CliError::runtime(format!("set output lock permissions: {error}")))
}

#[cfg(not(unix))]
fn set_private_file_permissions(_path: &Path) -> Result<(), CliError> {
    Ok(())
}

fn output_root_key(output_root: &Path) -> String {
    let bytes = native_path_bytes(output_root.as_os_str());
    let mut digest = Sha256::new();
    digest.update(LOCK_DOMAIN);
    digest.update((bytes.len() as u64).to_le_bytes());
    digest.update(bytes);
    hex(&digest.finalize())
}

#[cfg(unix)]
fn native_path_bytes(path: &OsStr) -> Vec<u8> {
    use std::os::unix::ffi::OsStrExt;
    path.as_bytes().to_vec()
}

#[cfg(windows)]
fn native_path_bytes(path: &OsStr) -> Vec<u8> {
    use std::os::windows::ffi::OsStrExt;
    path.encode_wide()
        .flat_map(|unit| unit.to_le_bytes())
        .collect()
}

#[cfg(not(any(unix, windows)))]
fn native_path_bytes(path: &OsStr) -> Vec<u8> {
    path.to_string_lossy().into_owned().into_bytes()
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(char::from(DIGITS[usize::from(byte >> 4)]));
        output.push(char::from(DIGITS[usize::from(byte & 0x0f)]));
    }
    output
}

struct Workspace {
    path: PathBuf,
    marker: Vec<u8>,
    cleaned: bool,
}

impl Workspace {
    fn prepare(control_root: &Path, key: &str) -> Result<Self, CliError> {
        cleanup_stale_runs(control_root, key)?;
        let marker = workspace_marker(key);
        for _ in 0..8 {
            let mut random = [0_u8; 16];
            getrandom::fill(&mut random).map_err(|error| {
                CliError::runtime(format!("create workspace identity: {error}"))
            })?;
            let path = control_root.join(format!("{RUN_PREFIX}{}", hex(&random)));
            match fs::create_dir(&path) {
                Ok(()) => {
                    if let Err(error) = set_private_directory_permissions(&path) {
                        let _ = fs::remove_dir_all(&path);
                        return Err(error);
                    }
                    let marker_path = path.join(MARKER_FILE);
                    let file = OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .open(&marker_path);
                    let marker_result = file.and_then(|mut file| {
                        file.write_all(&marker)?;
                        file.sync_all()
                    });
                    if let Err(error) = marker_result {
                        let _ = fs::remove_dir_all(&path);
                        return Err(CliError::runtime(format!(
                            "create auxiliary workspace marker: {error}"
                        )));
                    }
                    return Ok(Self {
                        path,
                        marker,
                        cleaned: false,
                    });
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => {
                    return Err(CliError::runtime(format!(
                        "create auxiliary workspace: {error}"
                    )));
                }
            }
        }
        Err(CliError::runtime(
            "could not allocate a unique auxiliary workspace",
        ))
    }

    fn cleanup(&mut self) -> Result<(), CliError> {
        if self.cleaned {
            return Ok(());
        }
        validate_workspace(&self.path, &self.marker)?;
        fs::remove_dir_all(&self.path)
            .map_err(|error| CliError::runtime(format!("remove auxiliary workspace: {error}")))?;
        self.cleaned = true;
        Ok(())
    }
}

fn cleanup_stale_runs(control_root: &Path, key: &str) -> Result<(), CliError> {
    let marker = workspace_marker(key);
    let entries = fs::read_dir(control_root)
        .map_err(|error| CliError::runtime(format!("inspect output control directory: {error}")))?;
    for entry in entries {
        let entry = entry
            .map_err(|error| CliError::runtime(format!("inspect output control entry: {error}")))?;
        let name = entry.file_name();
        if name == LOCK_FILE {
            continue;
        }
        let Some(name) = name.to_str() else {
            return Err(CliError::runtime(
                "output control directory contains an unknown entry",
            ));
        };
        if !valid_run_name(name) {
            return Err(CliError::runtime(format!(
                "output control directory contains unknown entry {}",
                sanitize(name, 96)
            )));
        }
        validate_workspace(&entry.path(), &marker)?;
        fs::remove_dir_all(entry.path()).map_err(|error| {
            CliError::runtime(format!("remove abandoned auxiliary workspace: {error}"))
        })?;
    }
    Ok(())
}

fn validate_workspace(path: &Path, marker: &[u8]) -> Result<(), CliError> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| CliError::runtime(format!("inspect auxiliary workspace: {error}")))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(CliError::runtime(
            "auxiliary workspace was replaced by an unsafe object",
        ));
    }
    let mut marker_found = false;
    let mut part_found = false;
    for entry in fs::read_dir(path)
        .map_err(|error| CliError::runtime(format!("inspect auxiliary workspace: {error}")))?
    {
        let entry = entry.map_err(|error| {
            CliError::runtime(format!("inspect auxiliary workspace entry: {error}"))
        })?;
        let file_type = entry.file_type().map_err(|error| {
            CliError::runtime(format!("inspect auxiliary workspace entry type: {error}"))
        })?;
        if file_type.is_symlink() || !file_type.is_file() {
            return Err(CliError::runtime(
                "auxiliary workspace contains an unsafe object",
            ));
        }
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            return Err(CliError::runtime(
                "auxiliary workspace contains an unknown entry",
            ));
        };
        if name == MARKER_FILE {
            if marker_found {
                return Err(CliError::runtime(
                    "auxiliary workspace contains duplicate markers",
                ));
            }
            marker_found = true;
            let metadata = entry.metadata().map_err(|error| {
                CliError::runtime(format!("inspect auxiliary workspace marker: {error}"))
            })?;
            if metadata.len() != marker.len() as u64 {
                return Err(CliError::runtime("auxiliary workspace marker is invalid"));
            }
            let bytes = fs::read(entry.path()).map_err(|error| {
                CliError::runtime(format!("read auxiliary workspace marker: {error}"))
            })?;
            if bytes != marker {
                return Err(CliError::runtime("auxiliary workspace marker is invalid"));
            }
        } else if valid_part_name(name) && !part_found {
            part_found = true;
        } else {
            return Err(CliError::runtime(format!(
                "auxiliary workspace contains unknown entry {}",
                sanitize(name, 96)
            )));
        }
    }
    if !marker_found {
        return Err(CliError::runtime("auxiliary workspace marker is missing"));
    }
    Ok(())
}

fn workspace_marker(key: &str) -> Vec<u8> {
    format!("rstorrent-download-workspace-v1\n{key}\n").into_bytes()
}

fn valid_run_name(name: &str) -> bool {
    name.strip_prefix(RUN_PREFIX)
        .is_some_and(|suffix| suffix.len() == 32 && suffix.bytes().all(is_lower_hex))
}

fn valid_part_name(name: &str) -> bool {
    name.strip_prefix(".t1-")
        .and_then(|name| name.strip_suffix(".rstorrent-parts"))
        .is_some_and(|identity| identity.len() == 32 && identity.bytes().all(is_lower_hex))
}

fn is_lower_hex(byte: u8) -> bool {
    byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ReceivedSignal {
    Interrupt,
    #[cfg(unix)]
    Terminate,
    SetupFailure,
}

struct SignalOwner {
    receiver: mpsc::Receiver<ReceivedSignal>,
    task: tokio::task::JoinHandle<()>,
}

impl SignalOwner {
    async fn start() -> Result<Self, CliError> {
        let (sender, receiver) = mpsc::channel(1);
        #[cfg(unix)]
        let mut interrupt =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::interrupt())
                .map_err(|error| CliError::runtime(format!("install SIGINT handler: {error}")))?;
        #[cfg(unix)]
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .map_err(|error| CliError::runtime(format!("install SIGTERM handler: {error}")))?;
        #[cfg(not(unix))]
        let (ready_sender, ready_receiver) = tokio::sync::oneshot::channel();
        let task = tokio::spawn(async move {
            #[cfg(unix)]
            let signal = tokio::select! {
                signal = interrupt.recv() => {
                    if signal.is_some() { ReceivedSignal::Interrupt } else { ReceivedSignal::SetupFailure }
                }
                signal = terminate.recv() => {
                    if signal.is_some() { ReceivedSignal::Terminate } else { ReceivedSignal::SetupFailure }
                }
            };
            #[cfg(not(unix))]
            let signal = {
                let mut interrupt = std::pin::pin!(tokio::signal::ctrl_c());
                let initial = std::future::poll_fn(|context| {
                    std::task::Poll::Ready(std::future::Future::poll(interrupt.as_mut(), context))
                })
                .await;
                let _ = ready_sender.send(());
                let result = match initial {
                    std::task::Poll::Ready(result) => result,
                    std::task::Poll::Pending => interrupt.await,
                };
                if result.is_ok() {
                    ReceivedSignal::Interrupt
                } else {
                    ReceivedSignal::SetupFailure
                }
            };
            let _ = sender.send(signal).await;
        });
        #[cfg(not(unix))]
        ready_receiver
            .await
            .map_err(|_| CliError::runtime("Ctrl-C handler task stopped during initialization"))?;
        Ok(Self { receiver, task })
    }

    fn pending(&mut self) -> Option<ReceivedSignal> {
        self.receiver.try_recv().ok()
    }

    async fn receive(&mut self) -> ReceivedSignal {
        self.receiver
            .recv()
            .await
            .unwrap_or(ReceivedSignal::SetupFailure)
    }

    async fn shutdown(self) {
        self.task.abort();
        let _ = self.task.await;
    }
}

struct ProgressRenderer {
    tty: bool,
    line_visible: bool,
    last_state: Option<(TorrentState, ProgressDisposition, ProgressReason)>,
    last_emit: Option<Instant>,
}

impl ProgressRenderer {
    fn new() -> Self {
        Self {
            tty: io::stderr().is_terminal(),
            line_visible: false,
            last_state: None,
            last_emit: None,
        }
    }

    fn render(&mut self, view: &TorrentView) -> Result<(), CliError> {
        let now = Instant::now();
        let state = (view.state, view.progress.disposition, view.progress.reason);
        let due = if self.tty {
            self.last_emit
                .is_none_or(|last| now.saturating_duration_since(last) >= POLL_INTERVAL)
        } else {
            self.last_state != Some(state)
                || self
                    .last_emit
                    .is_none_or(|last| now.saturating_duration_since(last) >= NON_TTY_INTERVAL)
        };
        if !due {
            return Ok(());
        }
        let name = view
            .display_name
            .as_deref()
            .map(|name| sanitize(name, 120))
            .unwrap_or_else(|| "torrent".to_owned());
        let status = format_progress(view);
        let line = format!("{name}: {status}");
        let mut stderr = io::stderr().lock();
        if self.tty {
            write!(stderr, "\r\x1b[2K{line}")
                .and_then(|()| stderr.flush())
                .map_err(|error| CliError::runtime(format!("write progress: {error}")))?;
            self.line_visible = true;
        } else {
            writeln!(stderr, "{line}")
                .map_err(|error| CliError::runtime(format!("write progress: {error}")))?;
        }
        self.last_state = Some(state);
        self.last_emit = Some(now);
        Ok(())
    }

    fn finish(&mut self) {
        if self.tty && self.line_visible {
            let mut stderr = io::stderr().lock();
            let _ = write!(stderr, "\r\x1b[2K").and_then(|()| stderr.flush());
            self.line_visible = false;
        }
    }
}

fn format_progress(view: &TorrentView) -> String {
    match view.progress.reason {
        ProgressReason::PreparingIntegrity | ProgressReason::VerifyingPieces => view
            .checking
            .as_ref()
            .map(|checking| {
                format!(
                    "checking {} {}/{} pieces",
                    checking_phase(checking.phase),
                    checking.pieces_processed,
                    checking.pieces_total
                )
            })
            .unwrap_or_else(|| {
                format!(
                    "checking {}/{} pieces",
                    view.verified_piece_count, view.piece_count
                )
            }),
        ProgressReason::TransferringPieces => {
            let remaining = view
                .remaining_payload_bytes
                .as_deref()
                .map(format_bytes_text)
                .unwrap_or_else(|| "unknown".to_owned());
            let rate = format_bytes_text(&view.payload_download_rate_bytes);
            let stalled = matches!(view.eta, crate::TorrentEtaView::Stalled);
            if stalled {
                format!("stalled, {remaining} remaining")
            } else {
                format!("downloading, {remaining} remaining at {rate}/s")
            }
        }
        reason => progress_reason(reason).to_owned(),
    }
}

fn checking_phase(phase: crate::CheckingPhaseView) -> &'static str {
    match phase {
        crate::CheckingPhaseView::Queued => "queued",
        crate::CheckingPhaseView::Preparing => "preparing",
        crate::CheckingPhaseView::Hashing => "hashing",
        crate::CheckingPhaseView::ReconcilingStorage => "reconciling",
        crate::CheckingPhaseView::Paused => "paused",
        crate::CheckingPhaseView::Finalizing => "finalizing",
    }
}

fn progress_reason(reason: ProgressReason) -> &'static str {
    match reason {
        ProgressReason::NetworkDisabled => "network disabled",
        ProgressReason::WaitingForUnmeteredNetwork => "waiting for unmetered network",
        ProgressReason::DiscoveringPeers => "discovering peers",
        ProgressReason::WaitingForDiscovery => "waiting for peers",
        ProgressReason::NoEnabledDiscoverySource => "no enabled discovery source",
        ProgressReason::AcquiringMetadata => "acquiring metadata",
        ProgressReason::PreparingStorage => "preparing storage",
        ProgressReason::WaitingForStorage => "waiting for storage",
        ProgressReason::PreparingIntegrity => "preparing verification",
        ProgressReason::TransferringPieces => "downloading",
        ProgressReason::VerifyingPieces => "verifying pieces",
        ProgressReason::Paused => "paused",
        ProgressReason::Complete => "verified complete",
        ProgressReason::NeedsRepair => "storage needs repair",
        ProgressReason::Failed => "failed",
    }
}

fn format_bytes_text(value: &str) -> String {
    let Ok(bytes) = value.parse::<u64>() else {
        return "unknown".to_owned();
    };
    const UNITS: &[(&str, u64)] = &[
        ("GiB", 1024 * 1024 * 1024),
        ("MiB", 1024 * 1024),
        ("KiB", 1024),
    ];
    for (unit, divisor) in UNITS {
        if bytes >= *divisor {
            return format!("{:.1} {unit}", bytes as f64 / *divisor as f64);
        }
    }
    format!("{bytes} B")
}

#[derive(Debug)]
struct CompletionSummary {
    output_root: PathBuf,
    name: Option<String>,
    zero_selection: bool,
}

#[derive(Debug)]
struct CliError {
    exit: i32,
    message: String,
}

impl CliError {
    fn usage(message: impl Into<String>) -> Self {
        Self {
            exit: EXIT_USAGE,
            message: sanitize(&message.into(), MAX_DISPLAY_CHARS),
        }
    }

    fn locked(message: impl Into<String>) -> Self {
        Self {
            exit: EXIT_LOCKED,
            message: sanitize(&message.into(), MAX_DISPLAY_CHARS),
        }
    }

    fn rejected(message: impl Into<String>) -> Self {
        Self {
            exit: EXIT_REJECTED,
            message: sanitize(&message.into(), MAX_DISPLAY_CHARS),
        }
    }

    fn runtime(message: impl Into<String>) -> Self {
        Self {
            exit: EXIT_RUNTIME,
            message: sanitize(&message.into(), MAX_DISPLAY_CHARS),
        }
    }

    fn signal(signal: ReceivedSignal) -> Self {
        match signal {
            ReceivedSignal::Interrupt => Self {
                exit: EXIT_INTERRUPTED,
                message: "download interrupted".to_owned(),
            },
            #[cfg(unix)]
            ReceivedSignal::Terminate => Self {
                exit: EXIT_TERMINATED,
                message: "download terminated".to_owned(),
            },
            ReceivedSignal::SetupFailure => {
                Self::runtime("signal observer stopped before completion")
            }
        }
    }
}

fn sanitize(value: &str, maximum: usize) -> String {
    let mut output = String::with_capacity(value.len().min(maximum));
    for character in value.chars().take(maximum) {
        if character.is_control() {
            output.push('?');
        } else {
            output.push(character);
        }
    }
    if value.chars().count() > maximum {
        output.push('…');
    }
    output
}

fn display_os(value: &OsStr) -> String {
    sanitize(&value.to_string_lossy(), 160)
}

fn display_path(path: &Path) -> String {
    sanitize(&path.to_string_lossy(), MAX_DISPLAY_CHARS)
}

fn write_error(message: &str) {
    write_stderr(&format!(
        "error: {}\n",
        sanitize(message, MAX_DISPLAY_CHARS)
    ));
}

fn write_stderr(message: &str) {
    let mut stderr = io::stderr().lock();
    let _ = stderr.write_all(message.as_bytes());
    let _ = stderr.flush();
}

fn write_stdout(message: &str) -> io::Result<()> {
    let mut stdout = io::stdout().lock();
    stdout.write_all(message.as_bytes())?;
    stdout.flush()
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU64, Ordering};

    use super::*;

    static NEXT_TEST_ROOT: AtomicU64 = AtomicU64::new(1);

    fn test_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "rstorrent-foreground-download-{name}-{}-{}",
            std::process::id(),
            NEXT_TEST_ROOT.fetch_add(1, Ordering::Relaxed)
        ))
    }

    #[test]
    fn arguments_are_strict_and_allow_option_termination() {
        let Invocation::Download(parsed) = parse_arguments(
            ["--output", "downloads", "--", "-source.torrent"]
                .into_iter()
                .map(OsString::from),
        )
        .expect("arguments") else {
            panic!("expected download invocation");
        };
        assert_eq!(parsed.output, PathBuf::from("downloads"));
        assert_eq!(parsed.source, OsString::from("-source.torrent"));
        assert!(parse_arguments([OsString::from("--unknown")].into_iter()).is_err());
        assert!(
            parse_arguments(
                ["one.torrent", "two.torrent"]
                    .into_iter()
                    .map(OsString::from)
            )
            .is_err()
        );
        assert!(parse_arguments(std::iter::empty()).is_err());
    }

    #[test]
    fn source_classification_retains_the_original_magnet() {
        let source =
            OsString::from("MAGNET:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&so=1-2");
        let SourceKind::Magnet(magnet) = classify_source(source.clone()).expect("magnet") else {
            panic!("expected magnet");
        };
        assert_eq!(magnet, source.to_string_lossy());
        let SourceKind::File(path) =
            classify_source(OsString::from("magnet-file.torrent")).expect("file")
        else {
            panic!("expected file");
        };
        assert_eq!(path, PathBuf::from("magnet-file.torrent"));
    }

    #[test]
    fn canonical_output_aliases_share_one_key() {
        let root = test_root("canonical-key");
        fs::create_dir_all(&root).expect("create root");
        let direct = prepare_output_root(&root).expect("direct");
        let alias = prepare_output_root(&root.join(".")).expect("alias");
        assert_eq!(direct, alias);
        assert_eq!(output_root_key(&direct), output_root_key(&alias));
        fs::remove_dir_all(root).expect("remove root");
    }

    #[cfg(unix)]
    #[test]
    fn canonical_output_symlink_aliases_share_one_key() {
        use std::os::unix::fs::symlink;

        let parent = test_root("canonical-symlink-key");
        let root = parent.join("root");
        let alias = parent.join("alias");
        fs::create_dir_all(&root).expect("create root");
        symlink(&root, &alias).expect("create symlink alias");
        let direct = prepare_output_root(&root).expect("direct");
        let aliased = prepare_output_root(&alias).expect("alias");
        assert_eq!(direct, aliased);
        assert_eq!(output_root_key(&direct), output_root_key(&aliased));
        fs::remove_dir_all(parent).expect("remove parent");
    }

    #[cfg(windows)]
    #[test]
    fn canonical_output_case_aliases_share_one_key() {
        let root = test_root("canonical-case-key");
        fs::create_dir_all(&root).expect("create root");
        let case_alias = PathBuf::from(root.to_string_lossy().to_ascii_uppercase());
        let direct = prepare_output_root(&root).expect("direct");
        let aliased = prepare_output_root(&case_alias).expect("case alias");
        assert_eq!(direct, aliased);
        assert_eq!(output_root_key(&direct), output_root_key(&aliased));
        fs::remove_dir_all(root).expect("remove root");
    }

    #[test]
    fn output_root_lock_is_nonblocking_and_reusable() {
        let root = test_root("lock");
        fs::create_dir_all(&root).expect("create root");
        let canonical = fs::canonicalize(&root).expect("canonical root");
        let first = OutputRootLease::acquire(&canonical).expect("first lease");
        let second = OutputRootLease::acquire(&canonical).expect_err("second lease must fail");
        assert_eq!(second.exit, EXIT_LOCKED);
        drop(first);
        let third = OutputRootLease::acquire(&canonical).expect("reused lease");
        let control_root = third.control_root.clone();
        drop(third);
        fs::remove_dir_all(root).expect("remove root");
        fs::remove_dir_all(control_root).expect("remove control root");
    }

    #[test]
    fn output_root_access_probe_is_removed() {
        let root = test_root("access-probe");
        fs::create_dir_all(&root).expect("create root");
        let canonical = fs::canonicalize(&root).expect("canonical root");
        validate_output_root_access(&canonical).expect("validate access");
        assert_eq!(fs::read_dir(&canonical).expect("read root").count(), 0);
        fs::remove_dir_all(root).expect("remove root");
    }

    #[test]
    fn stale_workspaces_are_validated_and_removed() {
        let root = test_root("workspace");
        fs::create_dir_all(&root).expect("create root");
        let canonical = fs::canonicalize(&root).expect("canonical root");
        let lease = OutputRootLease::acquire(&canonical).expect("lease");
        let first = Workspace::prepare(&lease.control_root, &lease.key).expect("first workspace");
        let stale = first.path.clone();
        drop(first);
        assert!(stale.exists());
        let mut second =
            Workspace::prepare(&lease.control_root, &lease.key).expect("second workspace");
        assert!(!stale.exists());
        second.cleanup().expect("cleanup second");
        let control_root = lease.control_root.clone();
        drop(lease);
        fs::remove_dir_all(root).expect("remove root");
        fs::remove_dir_all(control_root).expect("remove control root");
    }

    #[test]
    fn unknown_workspace_entries_fail_closed() {
        let root = test_root("workspace-unknown");
        fs::create_dir_all(&root).expect("create root");
        let canonical = fs::canonicalize(&root).expect("canonical root");
        let lease = OutputRootLease::acquire(&canonical).expect("lease");
        let workspace = Workspace::prepare(&lease.control_root, &lease.key).expect("workspace");
        fs::write(workspace.path.join("unknown"), b"do not delete").expect("unknown entry");
        let error = validate_workspace(&workspace.path, &workspace.marker)
            .expect_err("unknown entry must fail");
        assert_eq!(error.exit, EXIT_RUNTIME);
        let control_root = lease.control_root.clone();
        drop(workspace);
        drop(lease);
        fs::remove_dir_all(root).expect("remove root");
        fs::remove_dir_all(control_root).expect("remove control root");
    }

    #[test]
    fn progress_and_errors_escape_control_characters() {
        assert_eq!(sanitize("safe\u{1b}[31m\nname", 100), "safe?[31m?name");
        assert_eq!(sanitize("abcdef", 3), "abc…");
        assert_eq!(format_bytes_text("1048576"), "1.0 MiB");
        assert_eq!(format_bytes_text("untrusted"), "unknown");
    }

    #[test]
    fn source_reader_rejects_nonfiles_and_accepts_bounded_bytes() {
        let root = test_root("source");
        fs::create_dir_all(&root).expect("create root");
        assert!(read_torrent_source(&root).is_err());
        let source = root.join("input.torrent");
        fs::write(&source, b"d4:infode").expect("write source");
        let PreparedSource::TorrentBytes(bytes) =
            read_torrent_source(&source).expect("read source")
        else {
            panic!("expected bytes");
        };
        assert_eq!(bytes, b"d4:infode");
        fs::remove_dir_all(root).expect("remove root");
    }
}
