//! The sole durable file-index-set authority after schema 29. Selection keeps
//! its existing default plus a packed exception mask, including pending magnets.
use super::*;
use crate::file_bitmap::FileBitmap;

pub(super) const TABLE_SQL: &str = "CREATE TABLE file_state (
    torrent_id BLOB PRIMARY KEY REFERENCES torrents(torrent_id) ON DELETE CASCADE,
    format_version INTEGER NOT NULL DEFAULT 1 CHECK(format_version = 1),
    exceptions BLOB NOT NULL DEFAULT X'' CHECK(length(exceptions) <= 46875),
    high BLOB NOT NULL DEFAULT X'' CHECK(length(high) <= 46875),
    allowed BLOB NOT NULL DEFAULT X'' CHECK(length(allowed) <= 46875),
    blocked BLOB NOT NULL DEFAULT X'' CHECK(length(blocked) <= 46875),
    file_count INTEGER CHECK(file_count IS NULL OR file_count BETWEEN 1 AND 374998),
    metadata_fingerprint BLOB CHECK(metadata_fingerprint IS NULL OR length(metadata_fingerprint) = 32),
    blocked_count INTEGER NOT NULL DEFAULT 0 CHECK(blocked_count BETWEEN 0 AND 374998),
    blocked_bytes TEXT NOT NULL DEFAULT '0' CHECK(length(blocked_bytes) BETWEEN 1 AND 20)
) WITHOUT ROWID;";

struct StoredMask {
    version: i64,
    bytes: Vec<u8>,
    file_count: Option<u32>,
    fingerprint: Option<Vec<u8>>,
    expected_fingerprint: Option<Vec<u8>>,
}

pub(super) fn read_mask(
    connection: &Connection,
    id: &TorrentId,
    column: &str,
) -> Result<FileBitmap, StoreError> {
    assert!(matches!(
        column,
        "exceptions" | "high" | "allowed" | "blocked"
    ));
    let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version < 29 {
        let (table, filter) = match column {
            "exceptions" => ("file_selection", ""),
            "high" => ("file_priorities", ""),
            _ => return Ok(FileBitmap::default()),
        };
        let indices = connection
            .prepare(&format!(
                "SELECT file_index FROM {table} WHERE torrent_id = ?1 {filter} ORDER BY file_index"
            ))?
            .query_map([id.as_bytes()], |row| row.get::<_, u32>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        return FileBitmap::from_indices(&indices).map_err(|e| StoreError::DurableState(e.into()));
    }
    let row = connection
        .query_row(
            &format!("SELECT f.format_version, f.{column}, f.file_count, f.metadata_fingerprint, t.content_fingerprint FROM file_state f JOIN torrents t ON t.torrent_id = f.torrent_id WHERE f.torrent_id = ?1"),
            [id.as_bytes()],
            |row| Ok(StoredMask {
                version: row.get(0)?, bytes: row.get(1)?, file_count: row.get(2)?,
                fingerprint: row.get(3)?, expected_fingerprint: row.get(4)?,
            }),
        )
        .optional()?;
    let Some(StoredMask {
        version,
        bytes,
        file_count,
        fingerprint: actual,
        expected_fingerprint: expected,
    }) = row
    else {
        return Err(StoreError::DurableState(
            "torrent file bitmap state is missing".into(),
        ));
    };
    if version != 1 {
        return Err(StoreError::DurableState(
            "unsupported file bitmap version".into(),
        ));
    }
    if actual != expected || expected.is_some() && file_count.is_none() {
        return Err(StoreError::DurableState(
            "file bitmap metadata identity is missing or mismatched".into(),
        ));
    }
    let mask =
        FileBitmap::decode(bytes).map_err(|message| StoreError::DurableState(message.into()))?;
    if file_count.is_some_and(|count| mask.last_index().is_some_and(|index| index >= count)) {
        return Err(StoreError::DurableState(
            "file bitmap exceeds its metadata catalog".into(),
        ));
    }
    Ok(mask)
}

pub(super) fn write_mask(
    connection: &Connection,
    id: &TorrentId,
    column: &str,
    indices: &[u32],
) -> Result<(), StoreError> {
    assert!(matches!(
        column,
        "exceptions" | "high" | "allowed" | "blocked"
    ));
    let mask = FileBitmap::from_indices(indices)
        .map_err(|message| StoreError::DurableState(message.into()))?;
    connection.execute(
        &format!(
            "INSERT INTO file_state(torrent_id, {column}) VALUES (?1, ?2)
        ON CONFLICT(torrent_id) DO UPDATE SET {column} = excluded.{column}"
        ),
        params![id.as_bytes(), mask.bytes()],
    )?;
    Ok(())
}

pub(crate) fn migrate(transaction: &Transaction<'_>) -> Result<(), StoreError> {
    transaction.execute_batch(TABLE_SQL)?;
    let inconsistent: bool = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM file_selection f JOIN torrents t ON t.torrent_id = f.torrent_id WHERE f.wanted = CASE WHEN t.selection_default = 'wanted' THEN 1 ELSE 0 END)",
        [], |row| row.get(0))?;
    if inconsistent {
        return Err(StoreError::DurableState(
            "legacy selection exception equals its default".into(),
        ));
    }
    let ids = transaction
        .prepare("SELECT torrent_id FROM torrents")?
        .query_map([], |row| row.get::<_, Vec<u8>>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    for bytes in ids {
        let id = TorrentId::new(bytes.try_into().map_err(|_| {
            StoreError::DurableState("invalid torrent ID in bitmap migration".into())
        })?)
        .map_err(|_| StoreError::DurableState("invalid torrent ID in bitmap migration".into()))?;
        for (table, column) in [
            ("file_selection", "exceptions"),
            ("file_priorities", "high"),
        ] {
            let indices = transaction
                .prepare(&format!(
                    "SELECT file_index FROM {table} WHERE torrent_id = ?1 ORDER BY file_index"
                ))?
                .query_map([id.as_bytes()], |row| row.get::<_, u32>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            write_mask(transaction, &id, column, &indices)?;
        }
    }
    // Frozen baseline tables remain for schema provenance, but never carry a
    // second runtime authority after conversion.
    // Retain inert baseline rows for provenance and read-only recovery. Only
    // file_state is read by a schema-29 runtime; downgrades are refused.
    Ok(())
}
