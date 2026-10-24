//! Reads the catalog into torrent list bundle entries (Tactical 348).

use std::collections::BTreeMap;

use super::*;
use crate::torrent_list::{
    ExportedTorrent, ManifestLimits, ManifestSelection, ManifestSource, ManifestTorrent,
};

impl SessionStore {
    /// Every torrent not being removed, in catalog order, ready for
    /// `torrent_list::write_bundle`. Reads only; never changes the catalog.
    pub(crate) fn torrent_list_export(&self) -> Result<Vec<ExportedTorrent>, StoreError> {
        torrent_list_export_from(&self.connection)
    }
}

/// The exporter over any catalog of schema 26 or later, including one newer
/// than this build or one that failed to migrate (Tactical 369). It reads
/// baseline tables and uses later columns only when they exist.
pub(crate) fn torrent_list_export_from(
    connection: &Connection,
) -> Result<Vec<ExportedTorrent>, StoreError> {
    let has_stop_limits = connection.query_row(
        "SELECT count(*) FROM pragma_table_info('torrents')
             WHERE name IN ('seed_stop_ratio_percent', 'seed_stop_time_seconds')",
        [],
        |row| row.get::<_, i64>(0),
    )? == 2;
    let stop_columns = if has_stop_limits {
        "t.seed_stop_ratio_percent, t.seed_stop_time_seconds"
    } else {
        "NULL, NULL"
    };
    {
        let mut statement = connection.prepare(&format!(
            "SELECT t.torrent_id, s.label, t.desired_state, t.archived, t.raw_info,
                    t.upload_rate_limit, t.download_rate_limit, {stop_columns}
             FROM torrents t
             JOIN storage_roots s ON s.root_id = t.storage_root
             LEFT JOIN removal_jobs r ON r.torrent_id = t.torrent_id
             WHERE r.torrent_id IS NULL
             ORDER BY t.torrent_id"
        ))?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, Vec<u8>>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, bool>(3)?,
                    row.get::<_, Option<Vec<u8>>>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, Option<i64>>(7)?,
                    row.get::<_, Option<i64>>(8)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let mut torrents = Vec::with_capacity(rows.len());
        for (id, label, desired_state, archived, raw_info, upload, download, ratio, time) in rows {
            let torrent_id = decode_stored_torrent_id(id)?;
            let info_hashes = read_info_hashes(connection, &torrent_id)?;
            let name = raw_info.as_deref().map(durable_content_name).transpose()?;
            let (source, metainfo) = export_source(connection, &torrent_id, raw_info.as_deref())?;
            let (default, exceptions) = read_selection_state(connection, &torrent_id)?;
            let positive_rate = |value: i64| u32::try_from(value).ok().filter(|rate| *rate != 0);
            torrents.push(ExportedTorrent {
                manifest: ManifestTorrent {
                    info_hash_v1: info_hashes
                        .v1_hash()
                        .map(|hash| encode_hex(hash.as_bytes())),
                    info_hash_v2: info_hashes
                        .v2_hash()
                        .map(|hash| encode_hex(hash.as_bytes())),
                    name,
                    source,
                    storage_root_label: Some(label),
                    running: desired_state == "running",
                    archived,
                    selection: ManifestSelection {
                        default: match default {
                            FilePriority::Skip => "skip",
                            FilePriority::Normal | FilePriority::High => "normal",
                        }
                        .to_owned(),
                        exceptions,
                    },
                    high_priority_files: read_high_priority_files(connection, &torrent_id)?,
                    limits: ManifestLimits {
                        upload_bytes_per_second: positive_rate(upload),
                        download_bytes_per_second: positive_rate(download),
                        seed_stop_ratio_percent: ratio,
                        seed_stop_time_seconds: time,
                    },
                },
                metainfo,
            });
        }
        Ok(torrents)
    }
}

/// The retained `.torrent` when there is one, a `.torrent` built from
/// verified metadata for a magnet add, or the magnet itself.
fn export_source(
    connection: &Connection,
    torrent_id: &TorrentId,
    raw_info: Option<&[u8]>,
) -> Result<(ManifestSource, Option<Vec<u8>>), StoreError> {
    {
        let retained = connection
            .query_row(
                "SELECT fidelity, metainfo FROM torrent_source
                 WHERE torrent_id = ?1 AND kind = 'metainfo'",
                [torrent_id.as_bytes().as_slice()],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?)),
            )
            .optional()?;
        if let Some((fidelity, bytes)) = retained {
            return Ok((
                ManifestSource::Metainfo {
                    file: String::new(),
                    fidelity,
                },
                Some(bytes),
            ));
        }
        if let Some(raw_info) = raw_info {
            let trackers = read_trackers(connection, torrent_id)?;
            return Ok((
                ManifestSource::Metainfo {
                    file: String::new(),
                    fidelity: "synthesized".to_owned(),
                },
                Some(synthesized_metainfo(raw_info, &trackers)),
            ));
        }
        let (magnet, _) = export_base_magnet_from(connection, &torrent_id.to_string())?;
        Ok((
            ManifestSource::Magnet {
                magnet: magnet.magnet,
            },
            None,
        ))
    }
}

/// `{announce, announce-list, info}` around the verified info dictionary, so
/// the file has the same info hash and keeps the torrent's trackers.
fn synthesized_metainfo(raw_info: &[u8], trackers: &[StoredTracker]) -> Vec<u8> {
    fn string(output: &mut Vec<u8>, value: &[u8]) {
        output.extend_from_slice(value.len().to_string().as_bytes());
        output.push(b':');
        output.extend_from_slice(value);
    }
    let mut output = vec![b'd'];
    if let Some(first) = trackers.first() {
        string(&mut output, b"announce");
        string(&mut output, first.url.as_bytes());
        string(&mut output, b"announce-list");
        output.push(b'l');
        let mut tiers = BTreeMap::<u32, Vec<(u32, &str)>>::new();
        for tracker in trackers {
            tiers
                .entry(tracker.tier)
                .or_default()
                .push((tracker.position, &tracker.url));
        }
        for urls in tiers.values_mut() {
            urls.sort_unstable();
            output.push(b'l');
            for (_, url) in urls.iter() {
                string(&mut output, url.as_bytes());
            }
            output.push(b'e');
        }
        output.push(b'e');
    }
    string(&mut output, b"info");
    output.extend_from_slice(raw_info);
    output.push(b'e');
    output
}

#[cfg(test)]
mod tests {
    use rstorrent_protocol::metainfo::{EXPLICIT_IMPORT_METAINFO_LIMITS, Metainfo};
    use sha1::Digest;

    use crate::SessionStore;
    use crate::torrent_list::{ManifestSource, read_bundle, write_bundle};

    #[test]
    fn released_catalog_exports_every_shape_and_synthesized_files_keep_their_identity() {
        let root = tempfile::tempdir().expect("profile");
        std::fs::write(
            root.path().join("session.db"),
            include_bytes!("../../tests/fixtures/catalog/v26.sqlite"),
        )
        .expect("install released catalog");
        let mut store = SessionStore::open(root.path(), "default", &[]).expect("open v26");
        let snapshot = store.snapshot().expect("snapshot");
        assert!(
            snapshot
                .torrents
                .iter()
                .any(|torrent| !torrent.metadata_available),
            "the fixture holds a magnet without metadata"
        );

        let exported = store.torrent_list_export().expect("export");
        // Seven torrents, one being removed.
        assert_eq!(exported.len(), 6);
        let read = read_bundle(&write_bundle(exported).expect("write")).expect("read");
        let magnets = read
            .iter()
            .filter(|torrent| matches!(torrent.manifest.source, ManifestSource::Magnet { .. }))
            .count();
        assert_eq!(magnets, 1);
        for torrent in read.iter().filter(|torrent| torrent.metainfo.is_some()) {
            let ManifestSource::Metainfo { fidelity, .. } = &torrent.manifest.source else {
                panic!("metainfo entry without a metainfo source");
            };
            assert_eq!(fidelity, "verbatim");
            let projection = Metainfo::project_bytes_with_limits(
                torrent.metainfo.as_deref().unwrap(),
                EXPLICIT_IMPORT_METAINFO_LIMITS,
            )
            .expect("exported .torrent parses");
            assert_eq!(
                torrent.manifest.info_hash_v1.as_deref(),
                Some(super::encode_hex(&projection.metainfo.info_hash).as_str())
            );
        }
        assert!(read.iter().any(|torrent| torrent.manifest.archived));
        assert!(read.iter().any(|torrent| !torrent.manifest.running));
        assert!(
            read.iter()
                .any(|torrent| !torrent.manifest.high_priority_files.is_empty())
        );

        // Metadata arriving for the magnet makes its export a synthesized
        // .torrent with the same info hash and its tracker.
        let info = b"d6:lengthi4e4:name4:test12:piece lengthi4e6:pieces20:aaaaaaaaaaaaaaaaaaaae";
        let info_hash = super::encode_hex(&sha1::Sha1::digest(info));
        let added = store
            .handle_durable(&crate::RequestEnvelope {
                version: crate::CONTROL_VERSION,
                request_id: "synthesized-source".to_owned(),
                expected_revision: None,
                command: crate::Command::AddMagnet {
                    magnet: format!(
                        "magnet:?xt=urn:btih:{info_hash}&tr=udp%3A%2F%2Ftracker.example%3A6969"
                    ),
                    storage_root: snapshot.storage.roots[0].root_id.clone(),
                    start_content: false,
                    await_file_selection: false,
                    skip_files: Vec::new(),
                },
            })
            .expect("add magnet");
        let Some(crate::CommandResult::AddTorrent { result }) = added.result else {
            panic!("magnet add failed: {added:?}");
        };
        store
            .record_metadata(&result.torrent_id, info)
            .expect("record metadata");
        let synthesized = store
            .torrent_list_export()
            .expect("export")
            .into_iter()
            .find(|torrent| torrent.manifest.info_hash_v1.as_deref() == Some(&info_hash))
            .expect("synthesized entry");
        assert!(matches!(
            &synthesized.manifest.source,
            ManifestSource::Metainfo { fidelity, .. } if fidelity == "synthesized"
        ));
        let bytes = synthesized.metainfo.expect("synthesized bytes");
        let projection =
            Metainfo::project_bytes_with_limits(&bytes, EXPLICIT_IMPORT_METAINFO_LIMITS)
                .expect("synthesized .torrent parses");
        assert_eq!(super::encode_hex(&projection.metainfo.info_hash), info_hash);
        assert!(
            bytes
                .windows(b"tracker.example".len())
                .any(|window| window == b"tracker.example")
        );
    }
}
