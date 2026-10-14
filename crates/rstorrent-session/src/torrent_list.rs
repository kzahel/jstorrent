//! Portable torrent list bundles (Tactical 348).
//!
//! A bundle is a zip holding `manifest.json` and one `.torrent` per torrent
//! under `torrents/`. The manifest is versioned; readers ignore unknown
//! fields and refuse a newer version. Everything read from a bundle is
//! hostile: entry names, counts and sizes are bounded before allocation.

use std::collections::BTreeMap;
use std::fmt;
use std::io::{Cursor, Read, Write};

use serde::{Deserialize, Serialize};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

pub(crate) const BUNDLE_FORMAT: &str = "jstorrent-torrent-list";
pub(crate) const BUNDLE_VERSION: u32 = 1;
pub(crate) const MANIFEST_NAME: &str = "manifest.json";
const TORRENT_DIRECTORY: &str = "torrents/";

pub(crate) const MAX_BUNDLE_TORRENTS: usize = 4_096;
pub const MAX_BUNDLE_BYTES: usize = 256 * 1024 * 1024;
const MAX_MANIFEST_BYTES: u64 = 16 * 1024 * 1024;
const MAX_TORRENT_FILE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_ENTRY_NAME_BYTES: usize = 200;
const MAX_FILE_STEM_BYTES: usize = 80;

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub(crate) struct Manifest {
    pub(crate) format: String,
    pub(crate) version: u32,
    #[serde(default)]
    pub(crate) torrents: Vec<ManifestTorrent>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub(crate) struct ManifestTorrent {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) info_hash_v1: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) info_hash_v2: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) name: Option<String>,
    pub(crate) source: ManifestSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) storage_root_label: Option<String>,
    #[serde(default)]
    pub(crate) running: bool,
    #[serde(default)]
    pub(crate) archived: bool,
    #[serde(default)]
    pub(crate) selection: ManifestSelection,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) high_priority_files: Vec<u32>,
    #[serde(default)]
    pub(crate) limits: ManifestLimits,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(crate) enum ManifestSource {
    /// A `.torrent` entry. `fidelity` is `verbatim` (the original file),
    /// `canonicalized` (re-encoded on import from another client) or
    /// `synthesized` (built from verified metadata of a magnet add).
    Metainfo {
        file: String,
        fidelity: String,
    },
    Magnet {
        magnet: String,
    },
}

impl Default for ManifestSource {
    fn default() -> Self {
        Self::Magnet {
            magnet: String::new(),
        }
    }
}

/// `default` is `normal` (download all except `exceptions`) or `skip`
/// (download only `exceptions`).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub(crate) struct ManifestSelection {
    #[serde(default = "default_selection")]
    pub(crate) default: String,
    #[serde(default)]
    pub(crate) exceptions: Vec<u32>,
}

impl Default for ManifestSelection {
    fn default() -> Self {
        Self {
            default: default_selection(),
            exceptions: Vec::new(),
        }
    }
}

fn default_selection() -> String {
    "normal".to_owned()
}

/// Rates in bytes per second (absent for unlimited). Stop limits use the
/// catalog encoding: absent for the session limit, -1 for no limit.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub(crate) struct ManifestLimits {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) upload_bytes_per_second: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) download_bytes_per_second: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) seed_stop_ratio_percent: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) seed_stop_time_seconds: Option<i64>,
}

/// One torrent to write: its manifest entry and, for a metainfo source, the
/// `.torrent` bytes. `write_bundle` assigns the entry file name.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ExportedTorrent {
    pub(crate) manifest: ManifestTorrent,
    pub(crate) metainfo: Option<Vec<u8>>,
}

/// One torrent read from a bundle.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ImportedTorrent {
    pub(crate) manifest: ManifestTorrent,
    pub(crate) metainfo: Option<Vec<u8>>,
}

#[derive(Debug, Eq, PartialEq)]
pub(crate) enum BundleError {
    NotAZip(String),
    TooLarge(&'static str),
    UnsafeEntry(String),
    MissingManifest,
    InvalidManifest(String),
    UnsupportedVersion(u32),
    MissingTorrentFile(String),
    Write(String),
}

impl fmt::Display for BundleError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotAZip(detail) => write!(formatter, "not a torrent list bundle: {detail}"),
            Self::TooLarge(what) => write!(formatter, "torrent list bundle {what} is too large"),
            Self::UnsafeEntry(name) => {
                write!(
                    formatter,
                    "torrent list bundle has an unexpected entry: {name}"
                )
            }
            Self::MissingManifest => formatter.write_str("torrent list bundle has no manifest"),
            Self::InvalidManifest(detail) => {
                write!(formatter, "torrent list manifest is invalid: {detail}")
            }
            Self::UnsupportedVersion(version) => write!(
                formatter,
                "torrent list bundle version {version} is newer than this app supports"
            ),
            Self::MissingTorrentFile(name) => {
                write!(formatter, "torrent list bundle is missing {name}")
            }
            Self::Write(detail) => write!(formatter, "torrent list bundle: {detail}"),
        }
    }
}

impl std::error::Error for BundleError {}

pub(crate) fn write_bundle(torrents: Vec<ExportedTorrent>) -> Result<Vec<u8>, BundleError> {
    if torrents.len() > MAX_BUNDLE_TORRENTS {
        return Err(BundleError::TooLarge("torrent count"));
    }
    let write_error = |error: &dyn fmt::Display| BundleError::Write(error.to_string());
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    let mut used_names = BTreeMap::new();
    let mut files = Vec::new();
    let mut manifest = Manifest {
        format: BUNDLE_FORMAT.to_owned(),
        version: BUNDLE_VERSION,
        torrents: Vec::with_capacity(torrents.len()),
    };
    for mut torrent in torrents {
        if let Some(metainfo) = torrent.metainfo {
            let stem = file_stem(
                torrent.manifest.name.as_deref(),
                torrent
                    .manifest
                    .info_hash_v1
                    .as_deref()
                    .or(torrent.manifest.info_hash_v2.as_deref()),
            );
            let count = used_names.entry(stem.clone()).or_insert(0_u32);
            *count += 1;
            let file = if *count == 1 {
                format!("{TORRENT_DIRECTORY}{stem}.torrent")
            } else {
                format!("{TORRENT_DIRECTORY}{stem}-{count}.torrent")
            };
            let fidelity = match &torrent.manifest.source {
                ManifestSource::Metainfo { fidelity, .. } => fidelity.clone(),
                ManifestSource::Magnet { .. } => "verbatim".to_owned(),
            };
            torrent.manifest.source = ManifestSource::Metainfo {
                file: file.clone(),
                fidelity,
            };
            files.push((file, metainfo));
        }
        manifest.torrents.push(torrent.manifest);
    }
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    writer
        .start_file(MANIFEST_NAME, options)
        .map_err(|error| write_error(&error))?;
    let manifest_json =
        serde_json::to_vec_pretty(&manifest).map_err(|error| write_error(&error))?;
    writer
        .write_all(&manifest_json)
        .map_err(|error| write_error(&error))?;
    for (name, bytes) in files {
        writer
            .start_file(name, options)
            .map_err(|error| write_error(&error))?;
        writer
            .write_all(&bytes)
            .map_err(|error| write_error(&error))?;
    }
    let bytes = writer
        .finish()
        .map_err(|error| write_error(&error))?
        .into_inner();
    if bytes.len() > MAX_BUNDLE_BYTES {
        return Err(BundleError::TooLarge("total size"));
    }
    Ok(bytes)
}

/// A readable `.torrent` file name: the content name reduced to safe
/// characters, followed by a short hash so names stay distinct.
fn file_stem(name: Option<&str>, info_hash: Option<&str>) -> String {
    let mut stem = String::new();
    for character in name.unwrap_or("torrent").chars() {
        if stem.len() >= MAX_FILE_STEM_BYTES {
            break;
        }
        if character.is_ascii_alphanumeric() || matches!(character, ' ' | '.' | '-' | '_') {
            stem.push(character);
        } else if !stem.ends_with('_') {
            stem.push('_');
        }
    }
    let stem = stem.trim_matches(|character| character == '.' || character == ' ');
    let stem = if stem.is_empty() { "torrent" } else { stem };
    match info_hash {
        Some(hash) => format!("{stem}-{}", &hash[..hash.len().min(8)]),
        None => stem.to_owned(),
    }
}

pub(crate) fn read_bundle(bytes: &[u8]) -> Result<Vec<ImportedTorrent>, BundleError> {
    if bytes.len() > MAX_BUNDLE_BYTES {
        return Err(BundleError::TooLarge("total size"));
    }
    let mut archive = ZipArchive::new(Cursor::new(bytes))
        .map_err(|error| BundleError::NotAZip(error.to_string()))?;
    if archive.len() > MAX_BUNDLE_TORRENTS + 1 {
        return Err(BundleError::TooLarge("entry count"));
    }
    let mut manifest_bytes = None;
    let mut files = BTreeMap::new();
    let mut total = 0_u64;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| BundleError::NotAZip(error.to_string()))?;
        let name = entry.name().to_owned();
        let is_manifest = name == MANIFEST_NAME;
        if !is_manifest && !is_torrent_entry_name(&name) {
            return Err(BundleError::UnsafeEntry(bounded_name(&name)));
        }
        if !entry.is_file()
            || entry.is_symlink()
            || !matches!(
                entry.compression(),
                CompressionMethod::Stored | CompressionMethod::Deflated
            )
        {
            return Err(BundleError::UnsafeEntry(bounded_name(&name)));
        }
        let limit = if is_manifest {
            MAX_MANIFEST_BYTES
        } else {
            MAX_TORRENT_FILE_BYTES
        };
        if entry.size() > limit {
            return Err(BundleError::TooLarge("entry"));
        }
        // The declared size is untrusted; read at most one byte past it.
        let mut contents = Vec::with_capacity(usize::try_from(entry.size()).unwrap_or(0));
        (&mut entry)
            .take(limit + 1)
            .read_to_end(&mut contents)
            .map_err(|error| BundleError::NotAZip(error.to_string()))?;
        if contents.len() as u64 > limit {
            return Err(BundleError::TooLarge("entry"));
        }
        total += contents.len() as u64;
        if total > MAX_BUNDLE_BYTES as u64 {
            return Err(BundleError::TooLarge("total size"));
        }
        let duplicate = if is_manifest {
            manifest_bytes.replace(contents).is_some()
        } else {
            files.insert(name.clone(), contents).is_some()
        };
        if duplicate {
            return Err(BundleError::UnsafeEntry(bounded_name(&name)));
        }
    }
    let manifest_bytes = manifest_bytes.ok_or(BundleError::MissingManifest)?;
    let manifest = parse_manifest(&manifest_bytes)?;
    manifest
        .torrents
        .into_iter()
        .map(|entry| {
            let metainfo = match &entry.source {
                ManifestSource::Metainfo { file, .. } => Some(
                    files
                        .get(file)
                        .cloned()
                        .ok_or_else(|| BundleError::MissingTorrentFile(bounded_name(file)))?,
                ),
                ManifestSource::Magnet { .. } => None,
            };
            Ok(ImportedTorrent {
                manifest: entry,
                metainfo,
            })
        })
        .collect()
}

fn parse_manifest(bytes: &[u8]) -> Result<Manifest, BundleError> {
    // Check the format and version before the shape, so a newer bundle is
    // reported as newer rather than as malformed.
    #[derive(Deserialize)]
    struct Header {
        format: String,
        version: u32,
    }
    let header: Header = serde_json::from_slice(bytes)
        .map_err(|error| BundleError::InvalidManifest(error.to_string()))?;
    if header.format != BUNDLE_FORMAT {
        return Err(BundleError::InvalidManifest(format!(
            "unknown format {}",
            bounded_name(&header.format)
        )));
    }
    if header.version > BUNDLE_VERSION || header.version == 0 {
        return Err(BundleError::UnsupportedVersion(header.version));
    }
    let manifest: Manifest = serde_json::from_slice(bytes)
        .map_err(|error| BundleError::InvalidManifest(error.to_string()))?;
    if manifest.torrents.len() > MAX_BUNDLE_TORRENTS {
        return Err(BundleError::TooLarge("torrent count"));
    }
    for torrent in &manifest.torrents {
        if let ManifestSource::Metainfo { file, .. } = &torrent.source
            && !is_torrent_entry_name(file)
        {
            return Err(BundleError::UnsafeEntry(bounded_name(file)));
        }
        if !matches!(torrent.selection.default.as_str(), "normal" | "skip") {
            return Err(BundleError::InvalidManifest(
                "file selection default must be normal or skip".to_owned(),
            ));
        }
    }
    Ok(manifest)
}

/// `torrents/<name>.torrent` with one plain path segment.
fn is_torrent_entry_name(name: &str) -> bool {
    let Some(file) = name.strip_prefix(TORRENT_DIRECTORY) else {
        return false;
    };
    name.len() <= MAX_ENTRY_NAME_BYTES
        && file.len() > ".torrent".len()
        && file.ends_with(".torrent")
        && !file.starts_with('.')
        && file
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b' ' | b'.' | b'-' | b'_'))
}

fn bounded_name(name: &str) -> String {
    name.chars().take(MAX_ENTRY_NAME_BYTES).collect()
}

#[cfg(test)]
mod tests {
    use std::io::{Cursor, Write};

    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};

    use super::{
        BUNDLE_VERSION, BundleError, ExportedTorrent, MANIFEST_NAME, ManifestLimits,
        ManifestSelection, ManifestSource, ManifestTorrent, read_bundle, write_bundle,
    };

    fn metainfo_torrent(name: &str, hash: &str, bytes: &[u8]) -> ExportedTorrent {
        ExportedTorrent {
            manifest: ManifestTorrent {
                info_hash_v1: Some(hash.to_owned()),
                name: Some(name.to_owned()),
                source: ManifestSource::Metainfo {
                    file: String::new(),
                    fidelity: "verbatim".to_owned(),
                },
                storage_root_label: Some("Downloads".to_owned()),
                running: true,
                selection: ManifestSelection {
                    default: "normal".to_owned(),
                    exceptions: vec![2],
                },
                high_priority_files: vec![0],
                limits: ManifestLimits {
                    upload_bytes_per_second: Some(65_536),
                    seed_stop_ratio_percent: Some(-1),
                    ..ManifestLimits::default()
                },
                ..ManifestTorrent::default()
            },
            metainfo: Some(bytes.to_vec()),
        }
    }

    fn zip_with(entries: &[(&str, &[u8], CompressionMethod)]) -> Vec<u8> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        for (name, bytes, method) in entries {
            writer
                .start_file(
                    *name,
                    SimpleFileOptions::default().compression_method(*method),
                )
                .unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    fn manifest_json(extra: &str) -> Vec<u8> {
        format!(
            r#"{{"format":"jstorrent-torrent-list","version":1,{extra}"torrents":[
                {{"source":{{"type":"metainfo","file":"torrents/a.torrent","fidelity":"verbatim"}},
                  "future_field":{{"anything":true}}}}]}}"#
        )
        .into_bytes()
    }

    #[test]
    fn bundle_round_trips_metainfo_and_magnets_with_distinct_names() {
        let magnet = ExportedTorrent {
            manifest: ManifestTorrent {
                info_hash_v1: Some("bb".repeat(20)),
                source: ManifestSource::Magnet {
                    magnet: "magnet:?xt=urn:btih:".to_owned() + &"bb".repeat(20),
                },
                ..ManifestTorrent::default()
            },
            metainfo: None,
        };
        let torrents = vec![
            metainfo_torrent("Same/Name: 1", &"aa".repeat(20), b"d4:infod1:xi1eee"),
            metainfo_torrent("Same/Name: 1", &"aa".repeat(20), b"d4:infod1:xi2eee"),
            magnet,
        ];
        let bytes = write_bundle(torrents).expect("write bundle");
        let read = read_bundle(&bytes).expect("read bundle");
        assert_eq!(read.len(), 3);
        let files: Vec<_> = read
            .iter()
            .filter_map(|torrent| match &torrent.manifest.source {
                ManifestSource::Metainfo { file, .. } => Some(file.clone()),
                ManifestSource::Magnet { .. } => None,
            })
            .collect();
        assert_eq!(
            files,
            [
                "torrents/Same_Name_ 1-aaaaaaaa.torrent",
                "torrents/Same_Name_ 1-aaaaaaaa-2.torrent"
            ]
        );
        assert_eq!(read[1].metainfo.as_deref(), Some(&b"d4:infod1:xi2eee"[..]));
        assert_eq!(read[0].manifest.high_priority_files, [0]);
        assert_eq!(read[0].manifest.limits.seed_stop_ratio_percent, Some(-1));
        assert!(read[2].metainfo.is_none());
    }

    #[test]
    fn unknown_fields_are_ignored_and_deflated_entries_are_read() {
        let bytes = zip_with(&[
            (
                MANIFEST_NAME,
                &manifest_json(r#""exported_by":"later app","#),
                CompressionMethod::Deflated,
            ),
            (
                "torrents/a.torrent",
                b"d4:infod1:xi1eee",
                CompressionMethod::Deflated,
            ),
        ]);
        let read = read_bundle(&bytes).expect("read bundle with unknown fields");
        assert_eq!(read[0].metainfo.as_deref(), Some(&b"d4:infod1:xi1eee"[..]));
    }

    #[test]
    fn newer_versions_and_foreign_formats_are_refused() {
        let newer = format!(
            r#"{{"format":"jstorrent-torrent-list","version":{},"torrents":"changed shape"}}"#,
            BUNDLE_VERSION + 1
        );
        let bytes = zip_with(&[(MANIFEST_NAME, newer.as_bytes(), CompressionMethod::Stored)]);
        assert_eq!(
            read_bundle(&bytes),
            Err(BundleError::UnsupportedVersion(BUNDLE_VERSION + 1))
        );
        let foreign = br#"{"format":"something-else","version":1,"torrents":[]}"#;
        let bytes = zip_with(&[(MANIFEST_NAME, foreign, CompressionMethod::Stored)]);
        assert!(matches!(
            read_bundle(&bytes),
            Err(BundleError::InvalidManifest(_))
        ));
    }

    #[test]
    fn unsafe_names_missing_files_and_garbage_are_refused() {
        for name in [
            "../evil.torrent",
            "torrents/../../evil.torrent",
            "torrents/sub/dir.torrent",
            "torrents/.hidden.torrent",
            "torrents/notes.txt",
            "/abs.torrent",
            "readme.txt",
        ] {
            let bytes = zip_with(&[
                (MANIFEST_NAME, &manifest_json(""), CompressionMethod::Stored),
                (name, b"x", CompressionMethod::Stored),
            ]);
            assert!(
                matches!(read_bundle(&bytes), Err(BundleError::UnsafeEntry(_))),
                "{name} must be refused"
            );
        }
        let missing = zip_with(&[(MANIFEST_NAME, &manifest_json(""), CompressionMethod::Stored)]);
        assert!(matches!(
            read_bundle(&missing),
            Err(BundleError::MissingTorrentFile(_))
        ));
        let no_manifest = zip_with(&[("torrents/a.torrent", b"x", CompressionMethod::Stored)]);
        assert_eq!(read_bundle(&no_manifest), Err(BundleError::MissingManifest));
        assert!(matches!(
            read_bundle(b"not a zip at all"),
            Err(BundleError::NotAZip(_))
        ));
    }

    #[test]
    fn a_compressed_bomb_is_bounded_by_the_entry_limit() {
        let bomb = vec![0_u8; 65 * 1024 * 1024];
        let bytes = zip_with(&[
            (MANIFEST_NAME, &manifest_json(""), CompressionMethod::Stored),
            ("torrents/a.torrent", &bomb, CompressionMethod::Deflated),
        ]);
        assert!(bytes.len() < 1024 * 1024, "the bomb compresses well");
        assert_eq!(read_bundle(&bytes), Err(BundleError::TooLarge("entry")));
    }
}
