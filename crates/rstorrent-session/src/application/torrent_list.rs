//! Torrent list export and bundle import (Tactical 348).
//!
//! Import adds each torrent through the ordinary command path, paused, then
//! applies its file selection, priorities and limits before archiving or
//! starting it, so a bundle torrent behaves exactly like one added by hand.

use super::*;
use crate::torrent_list::{ManifestSource, ManifestTorrent, read_bundle, write_bundle};
use crate::{
    CONTROL_VERSION, FileSelectionIntent, TorrentListImportFailure, TorrentListImportReport,
    TorrentListImportTarget,
};

impl ApplicationService {
    /// A bundle of every torrent not being removed. Changes nothing.
    pub async fn export_torrent_list(&mut self) -> Result<Vec<u8>, ApplicationError> {
        let torrents = self.store_mut()?.torrent_list_export()?;
        tokio::task::spawn_blocking(move || write_bundle(torrents))
            .await
            .map_err(|error| ApplicationError::Join(error.to_string()))?
            .map_err(|error| ApplicationError::Configuration(error.to_string()))
    }

    /// Adds every torrent in `bundle` that is not already present. A bundle
    /// that cannot be read fails before anything is added; each torrent then
    /// succeeds or fails on its own.
    pub async fn import_torrent_bundle(
        &mut self,
        bundle: Vec<u8>,
        target: TorrentListImportTarget,
    ) -> Result<TorrentListImportReport, ApplicationError> {
        let torrents = tokio::task::spawn_blocking(move || read_bundle(&bundle))
            .await
            .map_err(|error| ApplicationError::Join(error.to_string()))?
            .map_err(|error| ApplicationError::Configuration(error.to_string()))?;
        let roots = self.store_mut()?.snapshot()?.storage.roots;
        if !roots.iter().any(|root| root.root_id == target.storage_root) {
            return Err(ApplicationError::Configuration(format!(
                "unknown storage root {}",
                target.storage_root
            )));
        }
        let mut report = TorrentListImportReport::default();
        for (index, torrent) in torrents.into_iter().enumerate() {
            let name = torrent
                .manifest
                .name
                .clone()
                .or_else(|| torrent.manifest.info_hash_v1.clone())
                .or_else(|| torrent.manifest.info_hash_v2.clone())
                .unwrap_or_else(|| format!("torrent {}", index + 1));
            let storage_root = torrent
                .manifest
                .storage_root_label
                .as_deref()
                .filter(|_| target.keep_matching_locations)
                .and_then(|label| roots.iter().find(|root| root.label == label))
                .map_or_else(|| target.storage_root.clone(), |root| root.root_id.clone());
            match self
                .import_one(&torrent.manifest, torrent.metainfo, &storage_root)
                .await
            {
                Ok(true) => report.added += 1,
                Ok(false) => report.already_present += 1,
                Err(reason) => report
                    .failed
                    .push(TorrentListImportFailure { name, reason }),
            }
        }
        Ok(report)
    }

    /// `Ok(true)` when added, `Ok(false)` when already present, otherwise the
    /// reason it failed.
    async fn import_one(
        &mut self,
        manifest: &ManifestTorrent,
        metainfo: Option<Vec<u8>>,
        storage_root: &str,
    ) -> Result<bool, String> {
        let skip_default = manifest.selection.default == "skip";
        let response = match (&manifest.source, metainfo) {
            (ManifestSource::Metainfo { .. }, Some(bytes)) => {
                let selection = if skip_default {
                    wanted_ranges(&manifest.selection.exceptions)
                } else {
                    FileSelectionIntent::All
                };
                let request = AddTorrentBytesRequest {
                    version: CONTROL_VERSION,
                    request_id: import_request_id(),
                    expected_revision: None,
                    storage_root: storage_root.to_owned(),
                    start_content: false,
                    await_file_selection: false,
                    selection,
                    source_length: u32::try_from(bytes.len())
                        .map_err(|_| "torrent file is too large".to_owned())?,
                };
                self.add_torrent_bytes(request, bytes)
                    .await
                    .map_err(|error| error.to_string())?
            }
            (ManifestSource::Magnet { magnet }, _) => self
                .dispatch(RequestEnvelope {
                    version: CONTROL_VERSION,
                    request_id: import_request_id(),
                    expected_revision: None,
                    command: Command::AddMagnet {
                        magnet: magnet.clone(),
                        storage_root: storage_root.to_owned(),
                        start_content: false,
                        await_file_selection: false,
                        skip_files: if skip_default {
                            Vec::new()
                        } else {
                            manifest.selection.exceptions.clone()
                        },
                    },
                })
                .await
                .map_err(|error| error.to_string())?,
            (ManifestSource::Metainfo { .. }, None) => {
                return Err("torrent file is missing".to_owned());
            }
        };
        let torrent_id = match (&response.outcome, &response.result) {
            (ResponseOutcome::Error { error }, _) => return Err(error.message.clone()),
            (_, Some(CommandResult::AddTorrent { result })) => match result.disposition {
                AddTorrentDisposition::Added => result.torrent_id.clone(),
                AddTorrentDisposition::AlreadyPresent
                | AddTorrentDisposition::SelectionExpanded { .. } => return Ok(false),
            },
            _ => return Err("the add did not report a torrent".to_owned()),
        };

        let mut commands = Vec::new();
        if !skip_default && !manifest.selection.exceptions.is_empty() {
            commands.push(Command::SetFilePriority {
                torrent_id: torrent_id.clone(),
                file_indices: manifest.selection.exceptions.clone(),
                priority: FilePriority::Skip,
            });
        }
        if !manifest.high_priority_files.is_empty() {
            commands.push(Command::SetFilePriority {
                torrent_id: torrent_id.clone(),
                file_indices: manifest.high_priority_files.clone(),
                priority: FilePriority::High,
            });
        }
        let patch = torrent_settings_patch(manifest)?;
        if !patch.is_empty() {
            commands.push(Command::UpdateTorrentSettings {
                torrent_id: torrent_id.clone(),
                patch,
            });
        }
        if manifest.archived {
            commands.push(Command::Archive {
                torrent_id: torrent_id.clone(),
            });
        } else if manifest.running {
            commands.push(Command::Resume {
                torrent_id: torrent_id.clone(),
            });
        }
        for command in commands {
            let response = self
                .dispatch(RequestEnvelope {
                    version: CONTROL_VERSION,
                    request_id: import_request_id(),
                    expected_revision: None,
                    command,
                })
                .await
                .map_err(|error| error.to_string())?;
            if let ResponseOutcome::Error { error } = response.outcome {
                return Err(format!("added, but {}", error.message));
            }
        }
        Ok(true)
    }
}

fn import_request_id() -> String {
    format!("import-{}", uuid::Uuid::new_v4())
}

/// Sorted, merged ranges for the wanted file indices of a `skip` default.
fn wanted_ranges(indices: &[u32]) -> FileSelectionIntent {
    let mut sorted = indices.to_vec();
    sorted.sort_unstable();
    sorted.dedup();
    let mut ranges: Vec<crate::FileIndexRange> = Vec::new();
    for index in sorted {
        match ranges.last_mut() {
            Some(range) if range.end_exclusive == index => range.end_exclusive += 1,
            _ => ranges.push(crate::FileIndexRange {
                start: index,
                end_exclusive: index.saturating_add(1),
            }),
        }
    }
    if ranges.is_empty() {
        FileSelectionIntent::None
    } else {
        FileSelectionIntent::WantedRanges { ranges }
    }
}

fn torrent_settings_patch(
    manifest: &ManifestTorrent,
) -> Result<crate::TorrentSettingsPatch, String> {
    let rate = |value: Option<u32>| match value {
        None => crate::TransferRateLimit::Unlimited,
        Some(bytes_per_second) => crate::TransferRateLimit::Limited { bytes_per_second },
    };
    let stop = |field, value| {
        crate::TorrentSeedStopLimit::from_persisted(field, value).map_err(|error| error.to_string())
    };
    let limits = manifest.limits;
    let patch = crate::TorrentSettingsPatch {
        upload_rate_limit: limits
            .upload_bytes_per_second
            .map(|value| rate(Some(value))),
        download_rate_limit: limits
            .download_bytes_per_second
            .map(|value| rate(Some(value))),
        seed_stop_ratio_percent: limits
            .seed_stop_ratio_percent
            .map(|value| stop("seed stop ratio", Some(value)))
            .transpose()?,
        seed_stop_time_seconds: limits
            .seed_stop_time_seconds
            .map(|value| stop("seed stop time", Some(value)))
            .transpose()?,
    };
    patch.validate().map_err(|error| error.to_string())?;
    Ok(patch)
}
