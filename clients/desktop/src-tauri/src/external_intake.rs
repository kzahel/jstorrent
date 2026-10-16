use std::collections::{HashSet, VecDeque};
use std::fmt;
use std::fs::File;
use std::hash::{Hash, Hasher};
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Serialize;
use url::Url;
use uuid::Uuid;

pub(crate) const MAX_PENDING_ACTIVATIONS: usize = 8;
pub(crate) const MAX_ACTIVATION_REPRESENTATION_BYTES: usize = 64 * 1024;
pub(crate) const MAX_MAGNET_BYTES: usize = 16 * 1024;
pub(crate) const MAX_TORRENT_SOURCE_BYTES: usize = 64 * 1024 * 1024;

#[derive(Clone, Eq, PartialEq)]
pub(crate) enum ExternalActivationSource {
    Magnet(String),
    TorrentFile(PathBuf),
}

impl fmt::Debug for ExternalActivationSource {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Magnet(_) => "Magnet(<redacted>)",
            Self::TorrentFile(_) => "TorrentFile(<redacted>)",
        })
    }
}

impl Hash for ExternalActivationSource {
    fn hash<H: Hasher>(&self, state: &mut H) {
        std::mem::discriminant(self).hash(state);
        match self {
            Self::Magnet(magnet) => magnet.hash(state),
            Self::TorrentFile(path) => path.hash(state),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ExternalActivationKind {
    Magnet,
    TorrentFile,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExternalActivationDescriptor {
    pub(crate) id: String,
    pub(crate) kind: ExternalActivationKind,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExternalActivationSnapshot {
    pub(crate) generation: String,
    pub(crate) pending: Vec<ExternalActivationDescriptor>,
    pub(crate) rejected_count: u32,
    pub(crate) overflow_count: u32,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) struct ActivationAdmission {
    pub(crate) recognized: bool,
    pub(crate) changed: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct PendingActivation {
    id: String,
    source: ExternalActivationSource,
    in_flight: bool,
}

#[derive(Debug, Default)]
pub(crate) struct DesktopActivationState {
    pending: VecDeque<PendingActivation>,
    generation: u64,
    rejected_count: u32,
    overflow_count: u32,
}

impl DesktopActivationState {
    pub(crate) fn has_pending(&self) -> bool {
        !self.pending.is_empty()
    }
    pub(crate) fn admit_strings<I, S>(&mut self, values: I) -> ActivationAdmission
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let mut admission = ActivationAdmission::default();
        let mut event_sources = HashSet::new();
        for value in values {
            match classify_external_activation(value.as_ref()) {
                ClassifiedActivation::Ignored => {}
                ClassifiedActivation::Rejected => {
                    admission.recognized = true;
                    admission.changed = true;
                    self.rejected_count = self.rejected_count.saturating_add(1);
                }
                ClassifiedActivation::Accepted(source) => {
                    admission.recognized = true;
                    if !event_sources.insert(source.clone()) {
                        continue;
                    }
                    admission.changed = true;
                    if self.pending.len() >= MAX_PENDING_ACTIVATIONS {
                        self.overflow_count = self.overflow_count.saturating_add(1);
                        continue;
                    }
                    self.pending.push_back(PendingActivation {
                        id: Uuid::new_v4().to_string(),
                        source,
                        in_flight: false,
                    });
                }
            }
        }
        if admission.changed {
            self.advance_generation();
        }
        admission
    }

    pub(crate) fn pull_snapshot(&mut self) -> ExternalActivationSnapshot {
        let snapshot = ExternalActivationSnapshot {
            generation: self.generation.to_string(),
            pending: self
                .pending
                .iter()
                .map(|item| ExternalActivationDescriptor {
                    id: item.id.clone(),
                    kind: match item.source {
                        ExternalActivationSource::Magnet(_) => ExternalActivationKind::Magnet,
                        ExternalActivationSource::TorrentFile(_) => {
                            ExternalActivationKind::TorrentFile
                        }
                    },
                })
                .collect(),
            rejected_count: self.rejected_count,
            overflow_count: self.overflow_count,
        };
        self.rejected_count = 0;
        self.overflow_count = 0;
        snapshot
    }

    pub(crate) fn begin(&mut self, id: &str) -> Result<ExternalActivationSource, String> {
        let item = self
            .pending
            .front_mut()
            .filter(|item| item.id == id)
            .ok_or_else(|| "external torrent activation is no longer pending".to_owned())?;
        if item.in_flight {
            return Err("external torrent activation is already being handled".to_owned());
        }
        item.in_flight = true;
        Ok(item.source.clone())
    }

    pub(crate) fn finish(&mut self, id: &str, terminal: bool) -> Result<bool, String> {
        let item = self
            .pending
            .front_mut()
            .filter(|item| item.id == id)
            .ok_or_else(|| "external torrent activation is no longer pending".to_owned())?;
        if !item.in_flight {
            return Err("external torrent activation is not being handled".to_owned());
        }
        if terminal {
            self.pending.pop_front();
            self.advance_generation();
            Ok(true)
        } else {
            item.in_flight = false;
            Ok(false)
        }
    }

    pub(crate) fn cancel(&mut self, id: &str) -> Result<(), String> {
        let item = self
            .pending
            .front()
            .filter(|item| item.id == id)
            .ok_or_else(|| "external torrent activation is no longer pending".to_owned())?;
        if item.in_flight {
            return Err("external torrent activation is already being handled".to_owned());
        }
        self.pending.pop_front();
        self.advance_generation();
        Ok(())
    }

    pub(crate) fn generation(&self) -> u64 {
        self.generation
    }

    fn advance_generation(&mut self) {
        self.generation = self.generation.wrapping_add(1);
    }
}

pub(crate) fn recognized_external_activation(value: &str) -> bool {
    matches!(
        classify_external_activation(value),
        ClassifiedActivation::Accepted(_)
    )
}

enum ClassifiedActivation {
    Ignored,
    Rejected,
    Accepted(ExternalActivationSource),
}

fn classify_external_activation(value: &str) -> ClassifiedActivation {
    if value.len() > MAX_ACTIVATION_REPRESENTATION_BYTES {
        return if starts_with_ascii_case_insensitive(value, "magnet:")
            || ends_with_torrent_extension(value)
        {
            ClassifiedActivation::Rejected
        } else {
            ClassifiedActivation::Ignored
        };
    }
    if starts_with_ascii_case_insensitive(value, "magnet:") {
        return if value.len() <= MAX_MAGNET_BYTES {
            ClassifiedActivation::Accepted(ExternalActivationSource::Magnet(value.to_owned()))
        } else {
            ClassifiedActivation::Rejected
        };
    }
    if value.starts_with('-') {
        return ClassifiedActivation::Ignored;
    }
    if let Ok(url) = Url::parse(value) {
        if url.scheme().eq_ignore_ascii_case("file") {
            if url.host().is_some() {
                return ClassifiedActivation::Ignored;
            }
            return match url.to_file_path() {
                Ok(path) if has_torrent_extension(&path) => {
                    ClassifiedActivation::Accepted(ExternalActivationSource::TorrentFile(path))
                }
                _ => ClassifiedActivation::Ignored,
            };
        }
        // A Windows drive path parses as a one-letter URL scheme on Unix. It
        // still has native path syntax and is handled by the raw-path lane.
        if !looks_like_windows_drive_path(value) {
            return ClassifiedActivation::Ignored;
        }
    }
    let path = PathBuf::from(value);
    if has_torrent_extension(&path) {
        ClassifiedActivation::Accepted(ExternalActivationSource::TorrentFile(path))
    } else {
        ClassifiedActivation::Ignored
    }
}

fn starts_with_ascii_case_insensitive(value: &str, prefix: &str) -> bool {
    value
        .get(..prefix.len())
        .is_some_and(|candidate| candidate.eq_ignore_ascii_case(prefix))
}

fn ends_with_torrent_extension(value: &str) -> bool {
    value
        .get(value.len().saturating_sub(".torrent".len())..)
        .is_some_and(|suffix| suffix.eq_ignore_ascii_case(".torrent"))
}

fn has_torrent_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("torrent"))
}

fn looks_like_windows_drive_path(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'\\' | b'/')
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum TorrentSourceReadFailure {
    Unreadable,
    NotRegular,
    Empty,
    Oversized,
}

impl TorrentSourceReadFailure {
    pub(crate) fn message(self) -> &'static str {
        match self {
            Self::Unreadable => "External torrent file is no longer readable",
            Self::NotRegular => "External torrent source is not a regular file",
            Self::Empty => "External torrent file is empty",
            Self::Oversized => "External torrent file exceeds the 64 MiB limit",
        }
    }
}

pub(crate) fn read_torrent_source(path: &Path) -> Result<Vec<u8>, TorrentSourceReadFailure> {
    let initial_metadata =
        std::fs::metadata(path).map_err(|_| TorrentSourceReadFailure::Unreadable)?;
    if !initial_metadata.is_file() {
        return Err(TorrentSourceReadFailure::NotRegular);
    }
    let file = File::open(path).map_err(|_| TorrentSourceReadFailure::Unreadable)?;
    let metadata = file
        .metadata()
        .map_err(|_| TorrentSourceReadFailure::Unreadable)?;
    if !metadata.is_file() {
        return Err(TorrentSourceReadFailure::NotRegular);
    }
    let mut source = Vec::with_capacity(
        usize::try_from(metadata.len())
            .unwrap_or(MAX_TORRENT_SOURCE_BYTES)
            .min(MAX_TORRENT_SOURCE_BYTES),
    );
    file.take((MAX_TORRENT_SOURCE_BYTES + 1) as u64)
        .read_to_end(&mut source)
        .map_err(|_| TorrentSourceReadFailure::Unreadable)?;
    if source.is_empty() {
        return Err(TorrentSourceReadFailure::Empty);
    }
    if source.len() > MAX_TORRENT_SOURCE_BYTES {
        return Err(TorrentSourceReadFailure::Oversized);
    }
    Ok(source)
}

#[cfg(test)]
mod tests {
    use std::io::{Seek, SeekFrom, Write};

    use super::{
        DesktopActivationState, ExternalActivationKind, ExternalActivationSource,
        MAX_ACTIVATION_REPRESENTATION_BYTES, MAX_MAGNET_BYTES, MAX_PENDING_ACTIVATIONS,
        MAX_TORRENT_SOURCE_BYTES, TorrentSourceReadFailure, classify_external_activation,
        read_torrent_source,
    };

    #[test]
    fn classification_accepts_only_magnets_and_local_torrent_files() {
        for value in [
            "magnet:?xt=urn:btih:000102030405060708090a0b0c0d0e0f10111213",
            "MAGNET:?xt=urn:btih:000102030405060708090a0b0c0d0e0f10111213",
        ] {
            assert!(matches!(
                classify_external_activation(value),
                super::ClassifiedActivation::Accepted(ExternalActivationSource::Magnet(_))
            ));
        }
        let local_file_url =
            url::Url::from_file_path(std::env::temp_dir().join("space and ☃.torrent"))
                .expect("absolute platform-local torrent URL")
                .to_string();
        for value in [
            "/tmp/example.torrent",
            "/tmp/example.TORRENT",
            "relative name.torrent",
            r"C:\Users\Test User\example.torrent",
            &local_file_url,
        ] {
            assert!(matches!(
                classify_external_activation(value),
                super::ClassifiedActivation::Accepted(ExternalActivationSource::TorrentFile(_))
            ));
        }
        for value in [
            "https://example.invalid/file.torrent",
            "file://server/share/file.torrent",
            "jstorrent:?magnet=x",
            "example.torrent.exe",
            "--open=example.torrent",
            "-example.torrent",
            "/tmp/not-a-torrent",
        ] {
            assert!(matches!(
                classify_external_activation(value),
                super::ClassifiedActivation::Ignored
            ));
        }
    }

    #[test]
    fn classification_enforces_exact_representation_bounds() {
        let exact_magnet = format!("magnet:{}", "x".repeat(MAX_MAGNET_BYTES - "magnet:".len()));
        assert!(matches!(
            classify_external_activation(&exact_magnet),
            super::ClassifiedActivation::Accepted(_)
        ));
        assert!(matches!(
            classify_external_activation(&(exact_magnet + "x")),
            super::ClassifiedActivation::Rejected
        ));
        let exact_path = format!(
            "/{}{}.torrent",
            "x".repeat(MAX_ACTIVATION_REPRESENTATION_BYTES - "/".len() - ".torrent".len()),
            ""
        );
        assert_eq!(exact_path.len(), MAX_ACTIVATION_REPRESENTATION_BYTES);
        assert!(matches!(
            classify_external_activation(&exact_path),
            super::ClassifiedActivation::Accepted(_)
        ));
        assert!(matches!(
            classify_external_activation(&(format!("/{exact_path}"))),
            super::ClassifiedActivation::Rejected
        ));
    }

    #[test]
    fn queue_is_fifo_bounded_deduplicated_per_event_and_notice_draining() {
        let mut state = DesktopActivationState::default();
        let repeated = "magnet:?xt=urn:btih:000102030405060708090a0b0c0d0e0f10111213";
        let admission = state.admit_strings([repeated, repeated]);
        assert!(admission.recognized);
        assert!(admission.changed);
        let first = state.pull_snapshot();
        assert_eq!(first.pending.len(), 1);
        assert_eq!(first.pending[0].kind, ExternalActivationKind::Magnet);
        assert_eq!(first.rejected_count, 0);
        assert_eq!(first.overflow_count, 0);

        let later_repeat = state.admit_strings([repeated]);
        assert!(later_repeat.changed);
        for index in 0..MAX_PENDING_ACTIVATIONS {
            state.admit_strings([format!("/tmp/{index}.torrent")]);
        }
        state.admit_strings(["/tmp/overflow.torrent"]);
        let full = state.pull_snapshot();
        assert_eq!(full.pending.len(), MAX_PENDING_ACTIVATIONS);
        assert_eq!(full.overflow_count, 3);
        assert_eq!(state.pull_snapshot().overflow_count, 0);

        let first_id = full.pending[0].id.clone();
        assert!(matches!(
            state.begin(&first_id),
            Ok(ExternalActivationSource::Magnet(_))
        ));
        assert!(state.cancel(&first_id).is_err());
        assert!(!state.finish(&first_id, false).expect("retry first"));
        assert!(state.begin(&first_id).is_ok());
        assert!(state.finish(&first_id, true).expect("consume first"));
        assert_ne!(state.generation().to_string(), full.generation);

        let next = state.pull_snapshot();
        let next_id = next.pending[0].id.clone();
        state.cancel(&next_id).expect("cancel next");
        assert_ne!(state.pull_snapshot().pending[0].id, next_id);
    }

    #[test]
    fn rejected_inputs_are_counted_without_retaining_contents() {
        let mut state = DesktopActivationState::default();
        let secret = format!("magnet:{}", "s".repeat(MAX_MAGNET_BYTES));
        state.admit_strings([secret.as_str()]);
        let debug = format!("{state:?}");
        assert!(!debug.contains(&secret));
        let snapshot = state.pull_snapshot();
        assert!(snapshot.pending.is_empty());
        assert_eq!(snapshot.rejected_count, 1);
        assert_eq!(state.pull_snapshot().rejected_count, 0);

        state.admit_strings(["/private/location/example.torrent"]);
        assert!(!format!("{state:?}").contains("private/location"));
    }

    #[test]
    fn bounded_file_read_handles_regular_empty_directory_missing_and_oversized() {
        let temporary = tempfile::tempdir().expect("temporary torrent sources");
        let valid = temporary.path().join("valid.torrent");
        std::fs::write(&valid, [1, 2, 3]).expect("write valid source");
        assert_eq!(read_torrent_source(&valid), Ok(vec![1, 2, 3]));

        let empty = temporary.path().join("empty.torrent");
        std::fs::write(&empty, []).expect("write empty source");
        assert_eq!(
            read_torrent_source(&empty),
            Err(TorrentSourceReadFailure::Empty)
        );
        assert_eq!(
            read_torrent_source(temporary.path()),
            Err(TorrentSourceReadFailure::NotRegular)
        );
        assert_eq!(
            read_torrent_source(&temporary.path().join("missing.torrent")),
            Err(TorrentSourceReadFailure::Unreadable)
        );

        let oversized = temporary.path().join("oversized.torrent");
        let mut file = std::fs::File::create(&oversized).expect("create oversized source");
        file.seek(SeekFrom::Start(MAX_TORRENT_SOURCE_BYTES as u64))
            .expect("seek oversized source");
        file.write_all(&[1]).expect("extend oversized source");
        assert_eq!(
            read_torrent_source(&oversized),
            Err(TorrentSourceReadFailure::Oversized)
        );
        std::fs::OpenOptions::new()
            .write(true)
            .open(&oversized)
            .expect("reopen source")
            .set_len(MAX_TORRENT_SOURCE_BYTES as u64)
            .expect("truncate source to exact limit");
        assert_eq!(
            read_torrent_source(&oversized)
                .expect("read exact-limit source")
                .len(),
            MAX_TORRENT_SOURCE_BYTES
        );
    }
}
