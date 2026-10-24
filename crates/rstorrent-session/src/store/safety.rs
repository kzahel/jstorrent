use super::*;
use crate::file_safety::FileSafetyPolicy;

pub(crate) const SETTINGS_SQL: &str = "ALTER TABLE client_settings ADD COLUMN file_safety_json TEXT NOT NULL
    DEFAULT '{\"enabled\":true,\"preset\":\"recommended\",\"custom_extensions\":[],\"mark_internet_origin\":true}'
    CHECK(length(file_safety_json) <= 8192);";

pub(crate) fn migrate(transaction: &Transaction<'_>) -> Result<(), StoreError> {
    transaction.execute_batch(SETTINGS_SQL)?;
    transaction.execute_batch(
        "CREATE TABLE torrent_file_safety (
        torrent_id BLOB PRIMARY KEY REFERENCES torrents(torrent_id) ON DELETE CASCADE,
        policy_json TEXT NOT NULL CHECK(length(policy_json) <= 8192)
    ) WITHOUT ROWID;",
    )?;
    let ids = transaction
        .prepare("SELECT torrent_id FROM torrents WHERE raw_info IS NOT NULL")?
        .query_map([], |row| row.get::<_, Vec<u8>>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    for bytes in ids {
        let id = TorrentId::new(
            bytes
                .try_into()
                .map_err(|_| StoreError::DurableState("invalid torrent identity".into()))?,
        )
        .map_err(|_| StoreError::DurableState("invalid torrent identity".into()))?;
        initialize_matches(transaction, &id)?;
    }
    Ok(())
}

pub(super) fn capture(connection: &Connection, id: &TorrentId) -> Result<(), StoreError> {
    let settings = read_client_settings(connection)?;
    let policy = serde_json::to_string(&settings.file_safety.policy())
        .map_err(|e| StoreError::DurableState(e.to_string()))?;
    connection.execute(
        "INSERT INTO torrent_file_safety(torrent_id, policy_json) VALUES (?1, ?2)",
        params![id.as_bytes(), policy],
    )?;
    Ok(())
}

pub(super) fn read_policy(
    connection: &Connection,
    id: &TorrentId,
) -> Result<FileSafetyPolicy, StoreError> {
    let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version < 29 {
        return Ok(FileSafetyPolicy::default());
    }
    let json: Option<String> = connection
        .query_row(
            "SELECT policy_json FROM torrent_file_safety WHERE torrent_id = ?1",
            [id.as_bytes()],
            |row| row.get(0),
        )
        .optional()?;
    let Some(json) = json else {
        return Ok(FileSafetyPolicy::default());
    };
    let policy: FileSafetyPolicy =
        serde_json::from_str(&json).map_err(|e| StoreError::DurableState(e.to_string()))?;
    if policy.version != 1 {
        return Err(StoreError::DurableState(
            "unsupported file safety policy".into(),
        ));
    }
    crate::FileSafetySettings {
        enabled: true,
        preset: crate::FileSafetyPreset::Custom,
        custom_extensions: policy.extensions.clone(),
        mark_internet_origin: true,
    }
    .validate()
    .map_err(|message| StoreError::DurableState(message.into()))?;
    Ok(policy)
}

pub(super) fn update_settings(
    transaction: &Transaction<'_>,
    settings: &crate::FileSafetySettings,
    current_revision: u64,
) -> Result<u64, (ErrorCode, String)> {
    settings
        .validate()
        .map_err(|message| (ErrorCode::InvalidRequest, message.into()))?;
    let mut current =
        read_client_settings(transaction).map_err(|e| internal_message(&e.to_string()))?;
    if current.file_safety == *settings {
        return Ok(current_revision);
    }
    current.file_safety = settings.clone();
    replace_client_settings(transaction, &current).map_err(|e| internal_message(&e.to_string()))?;
    next_revision(transaction, current_revision)
}

pub(super) fn set_override(
    transaction: &Transaction<'_>,
    torrent_id: &str,
    indices: &[u32],
    allowed: bool,
    current_revision: u64,
) -> Result<u64, (ErrorCode, String)> {
    let id = decode_torrent_id(torrent_id)
        .ok_or_else(|| (ErrorCode::InvalidRequest, "invalid torrent identity".into()))?;
    validate_override_target(transaction, &id, indices)?;
    // Reuse selection's ownership, metadata, padding, removal and repair fences.
    // Selecting never grants allowance; only this explicit command can do so.
    let retained_high = file_state::read_mask(transaction, &id, "high")
        .map_err(|e| internal_message(&e.to_string()))?;
    let revision = if allowed {
        set_file_priority(
            transaction,
            torrent_id,
            indices,
            FilePriority::Normal,
            current_revision,
        )?
    } else {
        // Validate the same fences without changing ordinary selection/priority.
        validate_override_target(transaction, &id, indices)?;
        current_revision
    };
    file_state::write_mask(transaction, &id, "high", &retained_high.indices())
        .map_err(|e| internal_message(&e.to_string()))?;
    let policy = read_policy(transaction, &id).map_err(|e| internal_message(&e.to_string()))?;
    let raw_info: Vec<u8> = transaction
        .query_row(
            "SELECT raw_info FROM torrents WHERE torrent_id = ?1",
            [id.as_bytes()],
            |row| row.get(0),
        )
        .map_err(internal_error)?;
    let source = read_verbatim_metainfo_source(transaction, &id)
        .map_err(|e| internal_message(&e.to_string()))?;
    let content = parse_durable_content_descriptor(&raw_info, source.as_deref())
        .map_err(|e| internal_message(&e.to_string()))?;
    let mut mask = file_state::read_mask(transaction, &id, "allowed")
        .map_err(|e| internal_message(&e.to_string()))?;
    let before = mask.clone();
    for &index in indices {
        let file = content.layout.files().get(index as usize).ok_or_else(|| {
            (
                ErrorCode::InvalidRequest,
                "file index exceeds metadata".into(),
            )
        })?;
        if file.padding
            || policy
                .match_file(Some(content.name.as_str()), &file.path)
                .is_none()
        {
            return Err((
                ErrorCode::InvalidRequest,
                "file does not match a safety rule".into(),
            ));
        }
        mask.set(index, allowed).map_err(internal_message)?;
    }
    if before == mask {
        return Ok(revision);
    }
    file_state::write_mask(transaction, &id, "allowed", &mask.indices())
        .map_err(|e| internal_message(&e.to_string()))?;
    initialize_matches(transaction, &id).map_err(|e| internal_message(&e.to_string()))?;
    if allowed {
        // The ordinary wanted bit may already be set while safety excluded the
        // file. Even if every required piece is verified, a content generation
        // must promote its bytes from the part file. Keep paused intent intact;
        // this queue position becomes executable only after an explicit resume.
        download_queue::append(transaction, &id).map_err(|e| internal_message(&e.to_string()))?;
    }
    let revision = if revision == current_revision {
        next_revision(transaction, current_revision)?
    } else {
        revision
    };
    transaction
        .execute(
            "UPDATE torrents SET updated_revision = ?2 WHERE torrent_id = ?1",
            params![id.as_bytes(), revision as i64],
        )
        .map_err(internal_error)?;
    Ok(revision)
}

fn validate_override_target(
    transaction: &Transaction<'_>,
    id: &TorrentId,
    indices: &[u32],
) -> Result<(), (ErrorCode, String)> {
    let (raw_info, blocked): (Option<Vec<u8>>, bool) = transaction.query_row("SELECT raw_info, quarantine_reason IS NOT NULL OR awaiting_file_selection = 1 OR EXISTS(SELECT 1 FROM removal_jobs r WHERE r.torrent_id = torrents.torrent_id) FROM torrents WHERE torrent_id = ?1", [id.as_bytes()], |row| Ok((row.get(0)?, row.get(1)?))).map_err(internal_error)?;
    if blocked || raw_info.is_none() || indices.is_empty() {
        return Err((
            ErrorCode::InvalidTorrentState,
            "file safety override is unavailable".into(),
        ));
    }
    Ok(())
}

/// Called only inside metadata/import or explicit override transactions. No
/// filename parsing/matching belongs on the piece checkpoint/read hot path.
pub(super) fn initialize_matches(
    connection: &Connection,
    id: &TorrentId,
) -> Result<(), StoreError> {
    let raw_info: Option<Vec<u8>> = connection.query_row(
        "SELECT raw_info FROM torrents WHERE torrent_id = ?1",
        [id.as_bytes()],
        |row| row.get(0),
    )?;
    let Some(raw_info) = raw_info else {
        return Ok(());
    };
    let source = read_verbatim_metainfo_source(connection, id)?;
    let content = parse_durable_content_descriptor(&raw_info, source.as_deref())?;
    let policy = read_policy(connection, id)?;
    connection.execute("UPDATE file_state SET metadata_fingerprint = (SELECT content_fingerprint FROM torrents WHERE torrent_id = ?1), file_count = ?2 WHERE torrent_id = ?1", params![id.as_bytes(), content.layout.files().len() as u32])?;
    let allowed = file_state::read_mask(connection, id, "allowed")?;
    let mut matched = Vec::new();
    let mut count = 0u32;
    let mut bytes = 0u64;
    for (index, file) in content.layout.files().iter().enumerate() {
        if !file.padding
            && policy
                .match_file(Some(content.name.as_str()), &file.path)
                .is_some()
        {
            let index = index as u32;
            matched.push(index);
            if !allowed.contains(index) {
                count += 1;
                bytes = bytes
                    .checked_add(file.length)
                    .ok_or_else(|| StoreError::DurableState("safety byte total overflow".into()))?;
            }
        }
    }
    file_state::write_mask(connection, id, "blocked", &matched)?;
    connection.execute("UPDATE file_state SET metadata_fingerprint = (SELECT content_fingerprint FROM torrents WHERE torrent_id = ?1), blocked_count = ?2, blocked_bytes = ?3 WHERE torrent_id = ?1", params![id.as_bytes(), count, bytes.to_string()])?;
    Ok(())
}

pub(super) fn summary(
    connection: &Connection,
    id: &TorrentId,
) -> Result<crate::FileSafetySummary, StoreError> {
    let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version < 29 {
        return Ok(crate::FileSafetySummary {
            blocked_file_count: 0,
            blocked_file_bytes: "0".into(),
        });
    }
    let summary = connection
        .query_row(
            "SELECT blocked_count, blocked_bytes FROM file_state WHERE torrent_id = ?1",
            [id.as_bytes()],
            |row| {
                Ok(crate::FileSafetySummary {
                    blocked_file_count: row.get(0)?,
                    blocked_file_bytes: row.get(1)?,
                })
            },
        )
        .optional()?
        .unwrap_or(crate::FileSafetySummary {
            blocked_file_count: 0,
            blocked_file_bytes: "0".into(),
        });
    summary
        .blocked_file_bytes
        .parse::<u64>()
        .map_err(|_| StoreError::DurableState("invalid safety byte count".into()))?;
    Ok(summary)
}

pub(super) fn matched_mask(
    connection: &Connection,
    id: &TorrentId,
) -> Result<crate::file_bitmap::FileBitmap, StoreError> {
    let policy = read_policy(connection, id)?;
    if policy.extensions.is_empty() {
        return Ok(Default::default());
    }
    let (expected, actual): (Option<Vec<u8>>, Option<Vec<u8>>) = connection.query_row("SELECT t.content_fingerprint, f.metadata_fingerprint FROM torrents t LEFT JOIN file_state f ON f.torrent_id = t.torrent_id WHERE t.torrent_id = ?1", [id.as_bytes()], |row| Ok((row.get(0)?, row.get(1)?)))?;
    if expected != actual {
        return Err(StoreError::DurableState(
            "safety bitmap metadata identity mismatch".into(),
        ));
    }
    file_state::read_mask(connection, id, "blocked")
}
