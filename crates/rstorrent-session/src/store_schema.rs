//! SQLite schema facts for the session catalog.
//!
//! Schema 26 is the supported baseline: every public release ships it, and
//! its definitions are frozen. A later schema adds a step in
//! `store_migration` and a released-catalog fixture; it never edits the
//! baseline definitions or discards a stored catalog.

/// The oldest catalog the application opens. Every public release since
/// `android-v0.1.0` and `desktop-v0.1.4` writes it.
pub(crate) const BASELINE_SCHEMA_VERSION: i64 = 26;

/// The catalog version this build writes: the baseline plus one per step in
/// `store_migration::MIGRATION_STEPS`.
pub(crate) const SCHEMA_VERSION: i64 = 29;

pub(crate) const FILE_PRIORITIES_TABLE_SQL: &str = "CREATE TABLE file_priorities (
        torrent_id BLOB NOT NULL CHECK (
            length(torrent_id) = 16 AND torrent_id <> zeroblob(16)
        ) REFERENCES torrents(torrent_id) ON DELETE CASCADE,
        file_index INTEGER NOT NULL
            CHECK (file_index >= 0 AND file_index < 374998),
        priority TEXT NOT NULL CHECK (priority = 'high'),
        PRIMARY KEY (torrent_id, file_index)
     ) WITHOUT ROWID;";

pub(crate) const DHT_TABLES_SQL: &str = "CREATE TABLE dht_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        format_version INTEGER NOT NULL CHECK (format_version > 0)
     );
     CREATE TABLE dht_nodes (
        family INTEGER NOT NULL CHECK (family IN (4, 6)),
        sample_order INTEGER NOT NULL CHECK (
            sample_order >= 0 AND sample_order < 64
        ),
        node_id BLOB NOT NULL CHECK (length(node_id) = 20),
        address BLOB NOT NULL CHECK (
            (family = 4 AND length(address) = 4) OR
            (family = 6 AND length(address) = 16)
        ),
        port INTEGER NOT NULL CHECK (port > 0 AND port <= 65535),
        PRIMARY KEY (family, sample_order),
        UNIQUE (family, node_id),
        UNIQUE (family, address, port)
     ) WITHOUT ROWID;
     CREATE TABLE dht_identities (
        family INTEGER NOT NULL CHECK (family IN (4, 6)),
        identity_order INTEGER NOT NULL CHECK (
            identity_order >= 0 AND identity_order < 8
        ),
        address BLOB NOT NULL CHECK (
            (family = 4 AND length(address) = 4) OR
            (family = 6 AND length(address) = 16)
        ),
        node_id BLOB NOT NULL CHECK (length(node_id) = 20),
        PRIMARY KEY (family, identity_order),
        UNIQUE (family, address)
     ) WITHOUT ROWID;";

pub(crate) const REMOVAL_TABLE_SQL: &str = "CREATE TABLE removal_jobs (
        torrent_id BLOB PRIMARY KEY CHECK (
            length(torrent_id) = 16 AND torrent_id <> zeroblob(16)
        ) REFERENCES torrents(torrent_id) ON DELETE CASCADE,
        operation_id TEXT NOT NULL UNIQUE
            CHECK (length(operation_id) BETWEEN 1 AND 128),
        data_policy TEXT NOT NULL
            CHECK (data_policy IN ('keep', 'delete_data')),
        state TEXT NOT NULL
            CHECK (state IN ('pending', 'awaiting_platform', 'failed')),
        error TEXT CHECK (error IS NULL OR length(error) <= 1024),
        created_revision INTEGER NOT NULL CHECK (created_revision >= 0),
        updated_revision INTEGER NOT NULL CHECK (updated_revision >= 0)
     ) WITHOUT ROWID;";

pub(crate) const SOURCE_TABLES_SQL: &str = "CREATE TABLE torrent_source (
        torrent_id BLOB PRIMARY KEY CHECK (
            length(torrent_id) = 16 AND torrent_id <> zeroblob(16)
        ) REFERENCES torrents(torrent_id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('magnet', 'metainfo')),
        fidelity TEXT NOT NULL CHECK (fidelity IN ('verbatim', 'canonicalized')),
        magnet TEXT CHECK (magnet IS NULL OR length(magnet) <= 16384),
        metainfo BLOB CHECK (metainfo IS NULL OR length(metainfo) <= 67108864),
        byte_length INTEGER NOT NULL CHECK (byte_length BETWEEN 1 AND 67108864),
        sha256 BLOB NOT NULL CHECK (length(sha256) = 32),
        CHECK (
            (kind = 'magnet' AND magnet IS NOT NULL AND metainfo IS NULL) OR
            (kind = 'metainfo' AND magnet IS NULL AND metainfo IS NOT NULL)
        )
     ) WITHOUT ROWID;
     CREATE TABLE torrent_trackers (
        torrent_id BLOB NOT NULL CHECK (
            length(torrent_id) = 16 AND torrent_id <> zeroblob(16)
        ) REFERENCES torrents(torrent_id) ON DELETE CASCADE,
        tier INTEGER NOT NULL CHECK (tier BETWEEN 0 AND 999993),
        position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 999993),
        url TEXT NOT NULL CHECK (length(url) BETWEEN 1 AND 67108864),
        transport TEXT NOT NULL CHECK (transport IN ('udp', 'http', 'https')),
        source TEXT NOT NULL CHECK (source IN ('magnet', 'metainfo')),
        PRIMARY KEY (torrent_id, tier, position),
        UNIQUE (torrent_id, url)
     ) WITHOUT ROWID;
     CREATE TABLE torrent_peer_hints (
        torrent_id BLOB NOT NULL CHECK (
            length(torrent_id) = 16 AND torrent_id <> zeroblob(16)
        ) REFERENCES torrents(torrent_id) ON DELETE CASCADE,
        position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 31),
        host TEXT NOT NULL CHECK (length(host) BETWEEN 1 AND 253),
        port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
        source TEXT NOT NULL CHECK (source = 'magnet'),
        PRIMARY KEY (torrent_id, position),
        UNIQUE (torrent_id, host, port)
     ) WITHOUT ROWID;";

pub(crate) const DOWNLOAD_QUEUE_INDEX_SQL: &str =
    "CREATE UNIQUE INDEX IF NOT EXISTS download_queue_order
     ON torrents(download_queue_position)
     WHERE download_queue_position IS NOT NULL;";
