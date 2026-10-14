use std::error::Error;
use std::fmt;

use rusqlite::{Connection, Transaction, params};

use super::contract::{
    ActiveSeedLimit, ClientSettings, EncryptionPolicy, HttpsServerAuthenticationPolicy,
    ListenerPolicy, PortMappingPolicy, SeedStopLimit, TransferRateLimit,
};

/// Frozen schema-26 baseline table. Later columns are added by migration
/// steps; `create_client_settings` writes only these columns.
const CLIENT_SETTINGS_TABLE_SQL: &str = "CREATE TABLE client_settings (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        listener_mode TEXT NOT NULL CHECK (
            listener_mode IN (
                'disabled', 'automatic_loopback', 'fixed_loopback',
                'automatic_local_network', 'fixed_local_network'
            )
        ),
        listener_port INTEGER,
        preferred_listen_port INTEGER NOT NULL CHECK (
            preferred_listen_port BETWEEN 1024 AND 65535
        ),
        port_mapping_mode TEXT NOT NULL CHECK (
            port_mapping_mode IN ('disabled', 'upnp')
        ),
        peer_connection_limit INTEGER NOT NULL CHECK (
            peer_connection_limit BETWEEN 1 AND 2000
        ),
        upload_slots INTEGER NOT NULL CHECK (upload_slots BETWEEN 0 AND 50),
        active_downloads INTEGER NOT NULL DEFAULT 3 CHECK (
            active_downloads BETWEEN 1 AND 20
        ),
        active_seeds INTEGER NOT NULL DEFAULT 5 CHECK (
            active_seeds BETWEEN -1 AND 500
        ),
        share_ratio_limit_percent INTEGER NOT NULL DEFAULT 200 CHECK (
            share_ratio_limit_percent BETWEEN 0 AND 2147483647
        ),
        finished_download_ratio_limit_percent INTEGER NOT NULL DEFAULT 700 CHECK (
            finished_download_ratio_limit_percent BETWEEN 0 AND 2147483647
        ),
        finished_time_limit_seconds INTEGER NOT NULL DEFAULT 86400 CHECK (
            finished_time_limit_seconds BETWEEN 0 AND 2147483647
        ),
        upload_rate_limit INTEGER NOT NULL DEFAULT 0 CHECK (
            upload_rate_limit = 0 OR
            upload_rate_limit BETWEEN 1024 AND 4294967295
        ),
        download_rate_limit INTEGER NOT NULL DEFAULT 0 CHECK (
            download_rate_limit = 0 OR
            download_rate_limit BETWEEN 1024 AND 4294967295
        ),
        encryption TEXT NOT NULL DEFAULT 'allow' CHECK (
            encryption IN ('disabled', 'allow', 'prefer', 'required')
        ),
        ipv6_enabled INTEGER NOT NULL DEFAULT 1 CHECK (ipv6_enabled IN (0, 1)),
        dht_enabled INTEGER NOT NULL DEFAULT 1 CHECK (dht_enabled IN (0, 1)),
        peer_exchange_enabled INTEGER NOT NULL DEFAULT 1 CHECK (
            peer_exchange_enabled IN (0, 1)
        ),
        tracker_https_server_authentication TEXT NOT NULL CHECK (
            tracker_https_server_authentication IN ('system_trust', 'disabled')
        ),
        CHECK (
            (listener_mode IN ('fixed_loopback', 'fixed_local_network') AND
             listener_port BETWEEN 1024 AND 65535) OR
            (listener_mode IN (
                'disabled', 'automatic_loopback', 'automatic_local_network'
             ) AND
             listener_port IS NULL)
        )
     );";

#[derive(Debug)]
pub(crate) enum SettingsPersistenceError {
    Sqlite(rusqlite::Error),
    Corrupt(String),
}

impl fmt::Display for SettingsPersistenceError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Sqlite(error) => write!(formatter, "client settings database: {error}"),
            Self::Corrupt(message) => {
                write!(formatter, "invalid durable client settings: {message}")
            }
        }
    }
}

impl Error for SettingsPersistenceError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Sqlite(error) => Some(error),
            Self::Corrupt(_) => None,
        }
    }
}

impl From<rusqlite::Error> for SettingsPersistenceError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sqlite(error)
    }
}

/// Creates the schema-26 baseline settings row. Part of the frozen baseline:
/// fields added later are written by `replace_client_settings` after the
/// migration steps run.
pub(crate) fn create_client_settings(
    transaction: &Transaction<'_>,
    settings: &ClientSettings,
) -> Result<(), SettingsPersistenceError> {
    transaction.execute_batch(CLIENT_SETTINGS_TABLE_SQL)?;
    let (mode, port) = listener_columns(settings.listener);
    let mapping_mode = mapping_column(settings.port_mapping);
    let tracker_https_authentication =
        tracker_https_authentication_column(settings.tracker_https_server_authentication);
    let encryption = encryption_column(settings.encryption);
    transaction.execute(
        "INSERT INTO client_settings(
            singleton, listener_mode, listener_port, preferred_listen_port,
            port_mapping_mode, peer_connection_limit, upload_slots,
            active_downloads, active_seeds, share_ratio_limit_percent,
            finished_download_ratio_limit_percent, finished_time_limit_seconds,
            upload_rate_limit, download_rate_limit, encryption, ipv6_enabled,
            dht_enabled, peer_exchange_enabled,
            tracker_https_server_authentication
         ) VALUES (
            1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
            ?13, ?14, ?15, ?16, ?17, ?18
         )",
        params![
            mode,
            port.map(i64::from),
            i64::from(settings.preferred_listen_port),
            mapping_mode,
            i64::from(settings.peer_connection_limit),
            i64::from(settings.upload_slots),
            i64::from(settings.active_downloads),
            settings.active_seeds.persisted(),
            i64::from(settings.share_ratio_limit_percent),
            i64::from(settings.finished_download_ratio_limit_percent),
            i64::from(settings.finished_time_limit_seconds),
            settings.upload_rate_limit.persisted(),
            settings.download_rate_limit.persisted(),
            encryption,
            settings.ipv6_enabled,
            settings.dht_enabled,
            settings.peer_exchange_enabled,
            tracker_https_authentication,
        ],
    )?;
    Ok(())
}

pub(crate) fn read_client_settings(
    connection: &Connection,
) -> Result<ClientSettings, SettingsPersistenceError> {
    let count: i64 =
        connection.query_row("SELECT COUNT(*) FROM client_settings", [], |row| row.get(0))?;
    if count != 1 {
        return Err(SettingsPersistenceError::Corrupt(format!(
            "expected one singleton row, found {count}"
        )));
    }
    let (
        mode,
        port,
        preferred_listen_port,
        mapping_mode,
        peer_connection_limit,
        upload_slots,
        active_downloads,
        active_seeds,
        share_ratio_limit_percent,
        finished_download_ratio_limit_percent,
        finished_time_limit_seconds,
        upload_rate_limit,
        download_rate_limit,
        encryption,
        ipv6_enabled,
        dht_enabled,
        peer_exchange_enabled,
        tracker_https_authentication,
        seed_stop_ratio_percent,
        seed_stop_time_seconds,
    ) = connection.query_row(
        "SELECT listener_mode, listener_port, preferred_listen_port, port_mapping_mode,
                peer_connection_limit, upload_slots, active_downloads,
                active_seeds, share_ratio_limit_percent,
                finished_download_ratio_limit_percent, finished_time_limit_seconds,
                upload_rate_limit, download_rate_limit, encryption, ipv6_enabled,
                dht_enabled, peer_exchange_enabled,
                tracker_https_server_authentication,
                seed_stop_ratio_percent, seed_stop_time_seconds
         FROM client_settings WHERE singleton = 1",
        [],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<i64>>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, i64>(7)?,
                row.get::<_, i64>(8)?,
                row.get::<_, i64>(9)?,
                row.get::<_, i64>(10)?,
                row.get::<_, i64>(11)?,
                row.get::<_, i64>(12)?,
                row.get::<_, String>(13)?,
                row.get::<_, bool>(14)?,
                row.get::<_, bool>(15)?,
                row.get::<_, bool>(16)?,
                row.get::<_, String>(17)?,
                row.get::<_, Option<i64>>(18)?,
                row.get::<_, Option<i64>>(19)?,
            ))
        },
    )?;
    let listener = match (mode.as_str(), port) {
        ("disabled", None) => ListenerPolicy::Disabled,
        ("automatic_loopback", None) => ListenerPolicy::AutomaticLoopback,
        ("fixed_loopback", Some(port)) => ListenerPolicy::FixedLoopback {
            port: u16::try_from(port).map_err(|_| {
                SettingsPersistenceError::Corrupt("fixed listener port is out of range".to_owned())
            })?,
        },
        ("automatic_local_network", None) => ListenerPolicy::AutomaticLocalNetwork,
        ("fixed_local_network", Some(port)) => ListenerPolicy::FixedLocalNetwork {
            port: u16::try_from(port).map_err(|_| {
                SettingsPersistenceError::Corrupt("fixed listener port is out of range".to_owned())
            })?,
        },
        _ => {
            return Err(SettingsPersistenceError::Corrupt(
                "listener mode and port are inconsistent".to_owned(),
            ));
        }
    };
    let port_mapping = match mapping_mode.as_str() {
        "disabled" => PortMappingPolicy::Disabled,
        "upnp" => PortMappingPolicy::Upnp,
        _ => {
            return Err(SettingsPersistenceError::Corrupt(
                "port mapping mode is invalid".to_owned(),
            ));
        }
    };
    let settings = ClientSettings {
        listener,
        preferred_listen_port: u16::try_from(preferred_listen_port).map_err(|_| {
            SettingsPersistenceError::Corrupt(
                "preferred listener port cannot be represented".to_owned(),
            )
        })?,
        port_mapping,
        peer_connection_limit: u32::try_from(peer_connection_limit).map_err(|_| {
            SettingsPersistenceError::Corrupt(
                "peer connection limit cannot be represented".to_owned(),
            )
        })?,
        upload_slots: u16::try_from(upload_slots).map_err(|_| {
            SettingsPersistenceError::Corrupt("upload slots cannot be represented".to_owned())
        })?,
        active_downloads: u16::try_from(active_downloads).map_err(|_| {
            SettingsPersistenceError::Corrupt(
                "active download limit cannot be represented".to_owned(),
            )
        })?,
        active_seeds: ActiveSeedLimit::from_persisted(active_seeds)
            .map_err(|error| SettingsPersistenceError::Corrupt(error.to_string()))?,
        share_ratio_limit_percent: u32::try_from(share_ratio_limit_percent).map_err(|_| {
            SettingsPersistenceError::Corrupt("share ratio limit cannot be represented".to_owned())
        })?,
        finished_download_ratio_limit_percent: u32::try_from(finished_download_ratio_limit_percent)
            .map_err(|_| {
                SettingsPersistenceError::Corrupt(
                    "finished/download ratio limit cannot be represented".to_owned(),
                )
            })?,
        finished_time_limit_seconds: u32::try_from(finished_time_limit_seconds).map_err(|_| {
            SettingsPersistenceError::Corrupt(
                "finished time limit cannot be represented".to_owned(),
            )
        })?,
        seed_stop_ratio_percent: SeedStopLimit::from_persisted(
            "seed stop ratio",
            seed_stop_ratio_percent,
        )
        .map_err(|error| SettingsPersistenceError::Corrupt(error.to_string()))?,
        seed_stop_time_seconds: SeedStopLimit::from_persisted(
            "seed stop time",
            seed_stop_time_seconds,
        )
        .map_err(|error| SettingsPersistenceError::Corrupt(error.to_string()))?,
        upload_rate_limit: TransferRateLimit::from_persisted(upload_rate_limit)
            .map_err(|error| SettingsPersistenceError::Corrupt(error.to_string()))?,
        download_rate_limit: TransferRateLimit::from_persisted(download_rate_limit)
            .map_err(|error| SettingsPersistenceError::Corrupt(error.to_string()))?,
        encryption: match encryption.as_str() {
            "disabled" => EncryptionPolicy::Disabled,
            "allow" => EncryptionPolicy::Allow,
            "prefer" => EncryptionPolicy::Prefer,
            "required" => EncryptionPolicy::Required,
            _ => {
                return Err(SettingsPersistenceError::Corrupt(
                    "encryption policy is invalid".to_owned(),
                ));
            }
        },
        ipv6_enabled,
        dht_enabled,
        peer_exchange_enabled,
        tracker_https_server_authentication: match tracker_https_authentication.as_str() {
            "system_trust" => HttpsServerAuthenticationPolicy::SystemTrust,
            "disabled" => HttpsServerAuthenticationPolicy::Disabled,
            _ => {
                return Err(SettingsPersistenceError::Corrupt(
                    "tracker HTTPS server authentication policy is invalid".to_owned(),
                ));
            }
        },
    };
    settings
        .validate()
        .map_err(|error| SettingsPersistenceError::Corrupt(error.to_string()))?;
    Ok(settings)
}

pub(crate) fn replace_client_settings(
    transaction: &Transaction<'_>,
    settings: &ClientSettings,
) -> Result<bool, SettingsPersistenceError> {
    settings
        .validate()
        .map_err(|error| SettingsPersistenceError::Corrupt(error.to_string()))?;
    if read_client_settings(transaction)? == *settings {
        return Ok(false);
    }
    let (mode, port) = listener_columns(settings.listener);
    let mapping_mode = mapping_column(settings.port_mapping);
    let tracker_https_authentication =
        tracker_https_authentication_column(settings.tracker_https_server_authentication);
    let encryption = encryption_column(settings.encryption);
    let changed = transaction.execute(
        "UPDATE client_settings
         SET listener_mode = ?1, listener_port = ?2,
             preferred_listen_port = ?3, port_mapping_mode = ?4,
             peer_connection_limit = ?5, upload_slots = ?6,
             active_downloads = ?7, active_seeds = ?8,
             share_ratio_limit_percent = ?9,
             finished_download_ratio_limit_percent = ?10,
             finished_time_limit_seconds = ?11, upload_rate_limit = ?12,
             download_rate_limit = ?13, encryption = ?14, ipv6_enabled = ?15,
             dht_enabled = ?16, peer_exchange_enabled = ?17,
             tracker_https_server_authentication = ?18,
             seed_stop_ratio_percent = ?19, seed_stop_time_seconds = ?20
         WHERE singleton = 1",
        params![
            mode,
            port.map(i64::from),
            i64::from(settings.preferred_listen_port),
            mapping_mode,
            i64::from(settings.peer_connection_limit),
            i64::from(settings.upload_slots),
            i64::from(settings.active_downloads),
            settings.active_seeds.persisted(),
            i64::from(settings.share_ratio_limit_percent),
            i64::from(settings.finished_download_ratio_limit_percent),
            i64::from(settings.finished_time_limit_seconds),
            settings.upload_rate_limit.persisted(),
            settings.download_rate_limit.persisted(),
            encryption,
            settings.ipv6_enabled,
            settings.dht_enabled,
            settings.peer_exchange_enabled,
            tracker_https_authentication,
            settings.seed_stop_ratio_percent.persisted(),
            settings.seed_stop_time_seconds.persisted(),
        ],
    )?;
    if changed != 1 {
        return Err(SettingsPersistenceError::Corrupt(format!(
            "settings replacement changed {changed} rows"
        )));
    }
    Ok(true)
}

fn listener_columns(listener: ListenerPolicy) -> (&'static str, Option<u16>) {
    match listener {
        ListenerPolicy::Disabled => ("disabled", None),
        ListenerPolicy::AutomaticLoopback => ("automatic_loopback", None),
        ListenerPolicy::FixedLoopback { port } => ("fixed_loopback", Some(port)),
        ListenerPolicy::AutomaticLocalNetwork => ("automatic_local_network", None),
        ListenerPolicy::FixedLocalNetwork { port } => ("fixed_local_network", Some(port)),
    }
}

fn mapping_column(policy: PortMappingPolicy) -> &'static str {
    match policy {
        PortMappingPolicy::Disabled => "disabled",
        PortMappingPolicy::Upnp => "upnp",
    }
}

fn tracker_https_authentication_column(policy: HttpsServerAuthenticationPolicy) -> &'static str {
    match policy {
        HttpsServerAuthenticationPolicy::SystemTrust => "system_trust",
        HttpsServerAuthenticationPolicy::Disabled => "disabled",
    }
}

fn encryption_column(policy: EncryptionPolicy) -> &'static str {
    match policy {
        EncryptionPolicy::Disabled => "disabled",
        EncryptionPolicy::Allow => "allow",
        EncryptionPolicy::Prefer => "prefer",
        EncryptionPolicy::Required => "required",
    }
}
