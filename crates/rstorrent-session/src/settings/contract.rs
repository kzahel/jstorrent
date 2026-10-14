use std::error::Error;
use std::fmt;

use rstorrent_engine::{
    DEFAULT_CONNECTION_LIMIT, DEFAULT_UNCHOKE_SLOTS, PeerEncryptionPolicy,
    TorrentTransferRateLimits as EngineTorrentTransferRateLimits,
    TransferRateLimit as EngineTransferRateLimit,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub const MIN_FIXED_LISTENER_PORT: u16 = 1_024;
pub const DEFAULT_PREFERRED_LISTEN_PORT: u16 = 6_881;
pub const MIN_PREFERRED_LISTEN_PORT: u16 = 1_024;
pub const MIN_PEER_CONNECTION_LIMIT: u32 = 1;
pub const MAX_PEER_CONNECTION_LIMIT: u32 = 2_000;
pub const MAX_UPLOAD_SLOTS: u16 = 50;
pub const DEFAULT_ACTIVE_DOWNLOADS: u16 = 3;
pub const MIN_ACTIVE_DOWNLOADS: u16 = 1;
pub const MAX_ACTIVE_DOWNLOADS: u16 = 20;
pub const DEFAULT_ACTIVE_SEEDS: u16 = crate::seed_policy::DEFAULT_ACTIVE_SEEDS;
pub const MAX_ACTIVE_SEEDS: u16 = crate::seed_policy::HARD_ACTIVE_TORRENT_LIMIT as u16;
pub const DEFAULT_SHARE_RATIO_LIMIT_PERCENT: u32 =
    crate::seed_policy::DEFAULT_SHARE_RATIO_LIMIT_PERCENT;
pub const DEFAULT_FINISHED_DOWNLOAD_RATIO_LIMIT_PERCENT: u32 =
    crate::seed_policy::DEFAULT_FINISHED_DOWNLOAD_RATIO_LIMIT_PERCENT;
pub const DEFAULT_FINISHED_TIME_LIMIT_SECONDS: u32 =
    crate::seed_policy::DEFAULT_FINISHED_TIME_LIMIT_SECONDS;
pub const MAX_SEED_GOAL_VALUE: u32 = i32::MAX as u32;
pub const MIN_TRANSFER_RATE_BYTES_PER_SECOND: u32 = 1_024;
pub(crate) const MAX_RUNTIME_DETAIL_BYTES: usize = 512;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum TransferRateLimit {
    #[default]
    Unlimited,
    Limited {
        #[schemars(range(min = 1_024))]
        bytes_per_second: u32,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum ActiveSeedLimit {
    Unlimited,
    Limited {
        #[schemars(range(min = 0, max = 500))]
        torrents: u16,
    },
}

/// A session-wide seeding stop limit. `value` is a share ratio in percent
/// or a seeding time in seconds, depending on the setting that holds it.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum SeedStopLimit {
    #[default]
    Off,
    Limited {
        #[schemars(range(min = 0, max = 2_147_483_647))]
        value: u32,
    },
}

impl SeedStopLimit {
    pub(crate) fn validate(self, field: &'static str) -> Result<(), ClientSettingsError> {
        if let Self::Limited { value } = self
            && value > MAX_SEED_GOAL_VALUE
        {
            return Err(ClientSettingsError::SeedStopLimit { field, value });
        }
        Ok(())
    }

    pub(crate) const fn value(self) -> Option<u32> {
        match self {
            Self::Off => None,
            Self::Limited { value } => Some(value),
        }
    }

    pub(crate) const fn persisted(self) -> Option<i64> {
        match self {
            Self::Off => None,
            Self::Limited { value } => Some(value as i64),
        }
    }

    pub(crate) fn from_persisted(
        field: &'static str,
        value: Option<i64>,
    ) -> Result<Self, ClientSettingsError> {
        let limit = match value {
            None => Self::Off,
            Some(value) => Self::Limited {
                value: u32::try_from(value).map_err(|_| ClientSettingsError::SeedStopLimit {
                    field,
                    value: u32::MAX,
                })?,
            },
        };
        limit.validate(field)?;
        Ok(limit)
    }
}

/// A torrent's own seeding stop limit, overriding the session limit.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum TorrentSeedStopLimit {
    #[default]
    UseGlobal,
    Off,
    Limited {
        #[schemars(range(min = 0, max = 2_147_483_647))]
        value: u32,
    },
}

impl TorrentSeedStopLimit {
    pub(crate) fn validate(self, field: &'static str) -> Result<(), ClientSettingsError> {
        if let Self::Limited { value } = self
            && value > MAX_SEED_GOAL_VALUE
        {
            return Err(ClientSettingsError::SeedStopLimit { field, value });
        }
        Ok(())
    }

    pub(crate) const fn resolve(self, global: SeedStopLimit) -> SeedStopLimit {
        match self {
            Self::UseGlobal => global,
            Self::Off => SeedStopLimit::Off,
            Self::Limited { value } => SeedStopLimit::Limited { value },
        }
    }

    /// Stored as NULL for the session limit, -1 for no limit, or the value.
    pub(crate) const fn persisted(self) -> Option<i64> {
        match self {
            Self::UseGlobal => None,
            Self::Off => Some(-1),
            Self::Limited { value } => Some(value as i64),
        }
    }

    pub(crate) fn from_persisted(
        field: &'static str,
        value: Option<i64>,
    ) -> Result<Self, ClientSettingsError> {
        let limit = match value {
            None => Self::UseGlobal,
            Some(-1) => Self::Off,
            Some(value) => Self::Limited {
                value: u32::try_from(value).map_err(|_| ClientSettingsError::SeedStopLimit {
                    field,
                    value: u32::MAX,
                })?,
            },
        };
        limit.validate(field)?;
        Ok(limit)
    }
}

/// A torrent's own seeding stop limits.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
#[serde(deny_unknown_fields)]
pub struct TorrentSeedStopLimits {
    /// Share ratio in percent.
    pub ratio_percent: TorrentSeedStopLimit,
    /// Seeding time in seconds.
    pub time_seconds: TorrentSeedStopLimit,
}

impl TorrentSeedStopLimits {
    pub(crate) fn validate(self) -> Result<(), ClientSettingsError> {
        self.ratio_percent.validate("seed stop ratio")?;
        self.time_seconds.validate("seed stop time")
    }
}

impl Default for ActiveSeedLimit {
    fn default() -> Self {
        Self::Limited {
            torrents: DEFAULT_ACTIVE_SEEDS,
        }
    }
}

impl ActiveSeedLimit {
    pub(crate) fn validate(self) -> Result<(), ClientSettingsError> {
        if let Self::Limited { torrents } = self
            && torrents > MAX_ACTIVE_SEEDS
        {
            return Err(ClientSettingsError::ActiveSeeds { value: torrents });
        }
        Ok(())
    }

    pub(crate) const fn effective(self) -> u16 {
        match self {
            Self::Unlimited => MAX_ACTIVE_SEEDS,
            Self::Limited { torrents } => torrents,
        }
    }

    pub(crate) const fn persisted(self) -> i64 {
        match self {
            Self::Unlimited => -1,
            Self::Limited { torrents } => torrents as i64,
        }
    }

    pub(crate) fn from_persisted(value: i64) -> Result<Self, ClientSettingsError> {
        let limit = if value == -1 {
            Self::Unlimited
        } else {
            Self::Limited {
                torrents: u16::try_from(value)
                    .map_err(|_| ClientSettingsError::ActiveSeeds { value: u16::MAX })?,
            }
        };
        limit.validate()?;
        Ok(limit)
    }
}

impl TransferRateLimit {
    pub(crate) fn validate(self) -> Result<(), ClientSettingsError> {
        if let Self::Limited { bytes_per_second } = self
            && bytes_per_second < MIN_TRANSFER_RATE_BYTES_PER_SECOND
        {
            return Err(ClientSettingsError::TransferRateLimit {
                value: bytes_per_second,
            });
        }
        Ok(())
    }

    pub(crate) fn into_engine(self) -> EngineTransferRateLimit {
        match self {
            Self::Unlimited => EngineTransferRateLimit::UNLIMITED,
            Self::Limited { bytes_per_second } => {
                EngineTransferRateLimit::limited(bytes_per_second)
                    .expect("validated application transfer rate fits engine policy")
            }
        }
    }

    pub(crate) const fn persisted(self) -> i64 {
        match self {
            Self::Unlimited => 0,
            Self::Limited { bytes_per_second } => bytes_per_second as i64,
        }
    }

    pub(crate) fn from_persisted(value: i64) -> Result<Self, ClientSettingsError> {
        let limit = if value == 0 {
            Self::Unlimited
        } else {
            Self::Limited {
                bytes_per_second: u32::try_from(value)
                    .map_err(|_| ClientSettingsError::TransferRateLimit { value: u32::MAX })?,
            }
        };
        limit.validate()?;
        Ok(limit)
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
#[serde(deny_unknown_fields)]
pub struct TorrentTransferLimits {
    pub upload: TransferRateLimit,
    pub download: TransferRateLimit,
}

impl TorrentTransferLimits {
    pub(crate) fn validate(self) -> Result<(), ClientSettingsError> {
        self.upload.validate()?;
        self.download.validate()
    }

    pub(crate) fn into_engine(self) -> EngineTorrentTransferRateLimits {
        EngineTorrentTransferRateLimits {
            upload: self.upload.into_engine(),
            download: self.download.into_engine(),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
#[serde(deny_unknown_fields)]
#[schemars(extend("minProperties" = 1))]
#[ts(optional_fields)]
pub struct TorrentSettingsPatch {
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_patch_value"
    )]
    #[schemars(with = "TransferRateLimit")]
    pub upload_rate_limit: Option<TransferRateLimit>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_patch_value"
    )]
    #[schemars(with = "TransferRateLimit")]
    pub download_rate_limit: Option<TransferRateLimit>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_patch_value"
    )]
    #[schemars(with = "TorrentSeedStopLimit")]
    pub seed_stop_ratio_percent: Option<TorrentSeedStopLimit>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_patch_value"
    )]
    #[schemars(with = "TorrentSeedStopLimit")]
    pub seed_stop_time_seconds: Option<TorrentSeedStopLimit>,
}

impl TorrentSettingsPatch {
    pub(crate) const fn is_empty(self) -> bool {
        self.upload_rate_limit.is_none()
            && self.download_rate_limit.is_none()
            && self.seed_stop_ratio_percent.is_none()
            && self.seed_stop_time_seconds.is_none()
    }

    pub(crate) fn validate(self) -> Result<(), ClientSettingsError> {
        if let Some(limit) = self.upload_rate_limit {
            limit.validate()?;
        }
        if let Some(limit) = self.download_rate_limit {
            limit.validate()?;
        }
        if let Some(limit) = self.seed_stop_ratio_percent {
            limit.validate("seed stop ratio")?;
        }
        if let Some(limit) = self.seed_stop_time_seconds {
            limit.validate("seed stop time")?;
        }
        Ok(())
    }

    pub(crate) fn apply_to_seed_stop(
        self,
        current: TorrentSeedStopLimits,
    ) -> Result<TorrentSeedStopLimits, ClientSettingsError> {
        let candidate = TorrentSeedStopLimits {
            ratio_percent: self
                .seed_stop_ratio_percent
                .unwrap_or(current.ratio_percent),
            time_seconds: self.seed_stop_time_seconds.unwrap_or(current.time_seconds),
        };
        candidate.validate()?;
        Ok(candidate)
    }

    pub(crate) fn apply_to(
        self,
        current: TorrentTransferLimits,
    ) -> Result<TorrentTransferLimits, ClientSettingsError> {
        let candidate = TorrentTransferLimits {
            upload: self.upload_rate_limit.unwrap_or(current.upload),
            download: self.download_rate_limit.unwrap_or(current.download),
        };
        candidate.validate()?;
        Ok(candidate)
    }
}

impl From<TorrentTransferLimits> for TorrentSettingsPatch {
    fn from(limits: TorrentTransferLimits) -> Self {
        Self {
            upload_rate_limit: Some(limits.upload),
            download_rate_limit: Some(limits.download),
            ..Self::default()
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum ListenerPolicy {
    #[default]
    Disabled,
    AutomaticLoopback,
    FixedLoopback {
        #[schemars(range(min = 1_024))]
        port: u16,
    },
    AutomaticLocalNetwork,
    FixedLocalNetwork {
        #[schemars(range(min = 1_024))]
        port: u16,
    },
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum PortMappingPolicy {
    #[default]
    Disabled,
    Upnp,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum HttpsServerAuthenticationPolicy {
    #[default]
    SystemTrust,
    Disabled,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum EncryptionPolicy {
    Disabled,
    #[default]
    Allow,
    Prefer,
    Required,
}

impl EncryptionPolicy {
    pub(crate) const fn into_engine(self) -> PeerEncryptionPolicy {
        match self {
            Self::Disabled => PeerEncryptionPolicy::Disabled,
            Self::Allow => PeerEncryptionPolicy::Allow,
            Self::Prefer => PeerEncryptionPolicy::Prefer,
            Self::Required => PeerEncryptionPolicy::Required,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
#[serde(deny_unknown_fields)]
pub struct EffectiveListenerSettings {
    pub listener: ListenerPolicy,
    #[schemars(range(min = 1_024))]
    pub preferred_listen_port: u16,
}

impl EffectiveListenerSettings {
    pub(crate) fn from_settings(settings: &ClientSettings) -> Self {
        Self {
            listener: settings.listener,
            preferred_listen_port: settings.preferred_listen_port,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
#[serde(deny_unknown_fields)]
pub struct ClientSettings {
    pub listener: ListenerPolicy,
    #[schemars(range(min = 1_024))]
    pub preferred_listen_port: u16,
    pub port_mapping: PortMappingPolicy,
    #[schemars(range(min = 1, max = 2_000))]
    pub peer_connection_limit: u32,
    #[schemars(range(min = 0, max = 50))]
    pub upload_slots: u16,
    #[serde(default = "default_active_downloads")]
    #[schemars(range(min = 1, max = 20))]
    pub active_downloads: u16,
    #[serde(default)]
    pub active_seeds: ActiveSeedLimit,
    #[serde(default = "default_share_ratio_limit_percent")]
    #[schemars(range(min = 0, max = 2_147_483_647))]
    pub share_ratio_limit_percent: u32,
    #[serde(default = "default_finished_download_ratio_limit_percent")]
    #[schemars(range(min = 0, max = 2_147_483_647))]
    pub finished_download_ratio_limit_percent: u32,
    #[serde(default = "default_finished_time_limit_seconds")]
    #[schemars(range(min = 0, max = 2_147_483_647))]
    pub finished_time_limit_seconds: u32,
    /// Stop a finished torrent once its share ratio reaches this percent.
    #[serde(default)]
    pub seed_stop_ratio_percent: SeedStopLimit,
    /// Stop a finished torrent once it has seeded this many seconds.
    #[serde(default)]
    pub seed_stop_time_seconds: SeedStopLimit,
    #[serde(default)]
    pub upload_rate_limit: TransferRateLimit,
    #[serde(default)]
    pub download_rate_limit: TransferRateLimit,
    pub encryption: EncryptionPolicy,
    pub ipv6_enabled: bool,
    #[serde(default = "default_enabled")]
    pub dht_enabled: bool,
    #[serde(default = "default_enabled")]
    pub peer_exchange_enabled: bool,
    pub tracker_https_server_authentication: HttpsServerAuthenticationPolicy,
}

impl Default for ClientSettings {
    fn default() -> Self {
        Self {
            listener: ListenerPolicy::Disabled,
            preferred_listen_port: DEFAULT_PREFERRED_LISTEN_PORT,
            port_mapping: PortMappingPolicy::Disabled,
            peer_connection_limit: u32::try_from(DEFAULT_CONNECTION_LIMIT)
                .expect("engine connection default fits the settings contract"),
            upload_slots: u16::try_from(DEFAULT_UNCHOKE_SLOTS)
                .expect("engine upload-slot default fits the settings contract"),
            active_downloads: DEFAULT_ACTIVE_DOWNLOADS,
            active_seeds: ActiveSeedLimit::default(),
            share_ratio_limit_percent: DEFAULT_SHARE_RATIO_LIMIT_PERCENT,
            finished_download_ratio_limit_percent: DEFAULT_FINISHED_DOWNLOAD_RATIO_LIMIT_PERCENT,
            finished_time_limit_seconds: DEFAULT_FINISHED_TIME_LIMIT_SECONDS,
            seed_stop_ratio_percent: SeedStopLimit::Off,
            seed_stop_time_seconds: SeedStopLimit::Off,
            upload_rate_limit: TransferRateLimit::Unlimited,
            download_rate_limit: TransferRateLimit::Unlimited,
            encryption: EncryptionPolicy::Allow,
            ipv6_enabled: true,
            dht_enabled: true,
            peer_exchange_enabled: true,
            tracker_https_server_authentication: HttpsServerAuthenticationPolicy::SystemTrust,
        }
    }
}

impl ClientSettings {
    pub(crate) const fn transfer_limits(&self) -> TorrentTransferLimits {
        TorrentTransferLimits {
            upload: self.upload_rate_limit,
            download: self.download_rate_limit,
        }
    }

    pub fn fresh_profile_default() -> Self {
        Self {
            listener: ListenerPolicy::AutomaticLocalNetwork,
            port_mapping: PortMappingPolicy::Upnp,
            ..Self::default()
        }
    }

    pub fn validate(&self) -> Result<(), ClientSettingsError> {
        if self.preferred_listen_port < MIN_PREFERRED_LISTEN_PORT {
            return Err(ClientSettingsError::PreferredListenerPort {
                port: self.preferred_listen_port,
            });
        }
        if let ListenerPolicy::FixedLoopback { port } | ListenerPolicy::FixedLocalNetwork { port } =
            self.listener
            && port < MIN_FIXED_LISTENER_PORT
        {
            return Err(ClientSettingsError::FixedListenerPort { port });
        }
        if !(MIN_PEER_CONNECTION_LIMIT..=MAX_PEER_CONNECTION_LIMIT)
            .contains(&self.peer_connection_limit)
        {
            return Err(ClientSettingsError::PeerConnectionLimit {
                value: self.peer_connection_limit,
            });
        }
        if self.upload_slots > MAX_UPLOAD_SLOTS {
            return Err(ClientSettingsError::UploadSlots {
                value: self.upload_slots,
            });
        }
        if !(MIN_ACTIVE_DOWNLOADS..=MAX_ACTIVE_DOWNLOADS).contains(&self.active_downloads) {
            return Err(ClientSettingsError::ActiveDownloads {
                value: self.active_downloads,
            });
        }
        self.active_seeds.validate()?;
        for (field, value) in [
            ("share ratio", self.share_ratio_limit_percent),
            (
                "finished/download ratio",
                self.finished_download_ratio_limit_percent,
            ),
            ("finished time", self.finished_time_limit_seconds),
        ] {
            if value > MAX_SEED_GOAL_VALUE {
                return Err(ClientSettingsError::SeedGoal { field, value });
            }
        }
        self.seed_stop_ratio_percent.validate("seed stop ratio")?;
        self.seed_stop_time_seconds.validate("seed stop time")?;
        self.upload_rate_limit.validate()?;
        self.download_rate_limit.validate()?;
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
#[serde(deny_unknown_fields)]
#[schemars(extend("minProperties" = 1))]
#[ts(optional_fields)]
pub struct ClientSettingsPatch {
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_patch_value"
    )]
    #[schemars(with = "ListenerPolicy")]
    pub listener: Option<ListenerPolicy>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_patch_value"
    )]
    #[schemars(with = "u16", range(min = 1_024))]
    pub preferred_listen_port: Option<u16>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_patch_value"
    )]
    #[schemars(with = "PortMappingPolicy")]
    pub port_mapping: Option<PortMappingPolicy>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_patch_value"
    )]
    #[schemars(with = "u32", range(min = 1, max = 2_000))]
    pub peer_connection_limit: Option<u32>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_patch_value"
    )]
    #[schemars(with = "u16", range(min = 0, max = 50))]
    pub upload_slots: Option<u16>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_patch_value"
    )]
    #[schemars(with = "u16", range(min = 1, max = 20))]
    pub active_downloads: Option<u16>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_patch_value"
    )]
    #[schemars(with = "ActiveSeedLimit")]
    pub active_seeds: Option<ActiveSeedLimit>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_patch_value"
    )]
    #[schemars(with = "u32", range(min = 0, max = 2_147_483_647))]
    pub share_ratio_limit_percent: Option<u32>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_patch_value"
    )]
    #[schemars(with = "u32", range(min = 0, max = 2_147_483_647))]
    pub finished_download_ratio_limit_percent: Option<u32>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_patch_value"
    )]
    #[schemars(with = "u32", range(min = 0, max = 2_147_483_647))]
    pub finished_time_limit_seconds: Option<u32>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_patch_value"
    )]
    #[schemars(with = "SeedStopLimit")]
    pub seed_stop_ratio_percent: Option<SeedStopLimit>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_patch_value"
    )]
    #[schemars(with = "SeedStopLimit")]
    pub seed_stop_time_seconds: Option<SeedStopLimit>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_patch_value"
    )]
    #[schemars(with = "TransferRateLimit")]
    pub upload_rate_limit: Option<TransferRateLimit>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_patch_value"
    )]
    #[schemars(with = "TransferRateLimit")]
    pub download_rate_limit: Option<TransferRateLimit>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_patch_value"
    )]
    #[schemars(with = "EncryptionPolicy")]
    pub encryption: Option<EncryptionPolicy>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_patch_value"
    )]
    #[schemars(with = "bool")]
    pub ipv6_enabled: Option<bool>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_patch_value"
    )]
    #[schemars(with = "bool")]
    pub dht_enabled: Option<bool>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_patch_value"
    )]
    #[schemars(with = "bool")]
    pub peer_exchange_enabled: Option<bool>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_patch_value"
    )]
    #[schemars(with = "HttpsServerAuthenticationPolicy")]
    pub tracker_https_server_authentication: Option<HttpsServerAuthenticationPolicy>,
}

impl ClientSettingsPatch {
    pub(crate) const fn is_empty(self) -> bool {
        self.listener.is_none()
            && self.preferred_listen_port.is_none()
            && self.port_mapping.is_none()
            && self.peer_connection_limit.is_none()
            && self.upload_slots.is_none()
            && self.active_downloads.is_none()
            && self.active_seeds.is_none()
            && self.share_ratio_limit_percent.is_none()
            && self.finished_download_ratio_limit_percent.is_none()
            && self.finished_time_limit_seconds.is_none()
            && self.seed_stop_ratio_percent.is_none()
            && self.seed_stop_time_seconds.is_none()
            && self.upload_rate_limit.is_none()
            && self.download_rate_limit.is_none()
            && self.encryption.is_none()
            && self.ipv6_enabled.is_none()
            && self.dht_enabled.is_none()
            && self.peer_exchange_enabled.is_none()
            && self.tracker_https_server_authentication.is_none()
    }

    pub(crate) fn validate(self) -> Result<(), ClientSettingsError> {
        self.apply_to(&ClientSettings::default()).map(|_| ())
    }

    pub(crate) fn apply_to(
        self,
        current: &ClientSettings,
    ) -> Result<ClientSettings, ClientSettingsError> {
        let candidate = ClientSettings {
            listener: self.listener.unwrap_or(current.listener),
            preferred_listen_port: self
                .preferred_listen_port
                .unwrap_or(current.preferred_listen_port),
            port_mapping: self.port_mapping.unwrap_or(current.port_mapping),
            peer_connection_limit: self
                .peer_connection_limit
                .unwrap_or(current.peer_connection_limit),
            upload_slots: self.upload_slots.unwrap_or(current.upload_slots),
            active_downloads: self.active_downloads.unwrap_or(current.active_downloads),
            active_seeds: self.active_seeds.unwrap_or(current.active_seeds),
            share_ratio_limit_percent: self
                .share_ratio_limit_percent
                .unwrap_or(current.share_ratio_limit_percent),
            finished_download_ratio_limit_percent: self
                .finished_download_ratio_limit_percent
                .unwrap_or(current.finished_download_ratio_limit_percent),
            finished_time_limit_seconds: self
                .finished_time_limit_seconds
                .unwrap_or(current.finished_time_limit_seconds),
            seed_stop_ratio_percent: self
                .seed_stop_ratio_percent
                .unwrap_or(current.seed_stop_ratio_percent),
            seed_stop_time_seconds: self
                .seed_stop_time_seconds
                .unwrap_or(current.seed_stop_time_seconds),
            upload_rate_limit: self.upload_rate_limit.unwrap_or(current.upload_rate_limit),
            download_rate_limit: self
                .download_rate_limit
                .unwrap_or(current.download_rate_limit),
            encryption: self.encryption.unwrap_or(current.encryption),
            ipv6_enabled: self.ipv6_enabled.unwrap_or(current.ipv6_enabled),
            dht_enabled: self.dht_enabled.unwrap_or(current.dht_enabled),
            peer_exchange_enabled: self
                .peer_exchange_enabled
                .unwrap_or(current.peer_exchange_enabled),
            tracker_https_server_authentication: self
                .tracker_https_server_authentication
                .unwrap_or(current.tracker_https_server_authentication),
        };
        candidate.validate()?;
        Ok(candidate)
    }
}

impl From<ClientSettings> for ClientSettingsPatch {
    fn from(settings: ClientSettings) -> Self {
        Self {
            listener: Some(settings.listener),
            preferred_listen_port: Some(settings.preferred_listen_port),
            port_mapping: Some(settings.port_mapping),
            peer_connection_limit: Some(settings.peer_connection_limit),
            upload_slots: Some(settings.upload_slots),
            active_downloads: Some(settings.active_downloads),
            active_seeds: Some(settings.active_seeds),
            share_ratio_limit_percent: Some(settings.share_ratio_limit_percent),
            finished_download_ratio_limit_percent: Some(
                settings.finished_download_ratio_limit_percent,
            ),
            finished_time_limit_seconds: Some(settings.finished_time_limit_seconds),
            seed_stop_ratio_percent: Some(settings.seed_stop_ratio_percent),
            seed_stop_time_seconds: Some(settings.seed_stop_time_seconds),
            upload_rate_limit: Some(settings.upload_rate_limit),
            download_rate_limit: Some(settings.download_rate_limit),
            encryption: Some(settings.encryption),
            ipv6_enabled: Some(settings.ipv6_enabled),
            dht_enabled: Some(settings.dht_enabled),
            peer_exchange_enabled: Some(settings.peer_exchange_enabled),
            tracker_https_server_authentication: Some(settings.tracker_https_server_authentication),
        }
    }
}

fn deserialize_optional_patch_value<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

const fn default_active_downloads() -> u16 {
    DEFAULT_ACTIVE_DOWNLOADS
}

const fn default_enabled() -> bool {
    true
}

const fn default_share_ratio_limit_percent() -> u32 {
    DEFAULT_SHARE_RATIO_LIMIT_PERCENT
}

const fn default_finished_download_ratio_limit_percent() -> u32 {
    DEFAULT_FINISHED_DOWNLOAD_RATIO_LIMIT_PERCENT
}

const fn default_finished_time_limit_seconds() -> u32 {
    DEFAULT_FINISHED_TIME_LIMIT_SECONDS
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ClientSettingsError {
    PreferredListenerPort { port: u16 },
    FixedListenerPort { port: u16 },
    PeerConnectionLimit { value: u32 },
    UploadSlots { value: u16 },
    ActiveDownloads { value: u16 },
    ActiveSeeds { value: u16 },
    SeedGoal { field: &'static str, value: u32 },
    SeedStopLimit { field: &'static str, value: u32 },
    TransferRateLimit { value: u32 },
}

impl fmt::Display for ClientSettingsError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::PreferredListenerPort { .. } => write!(
                formatter,
                "preferred listener port must be {MIN_PREFERRED_LISTEN_PORT}..=65535"
            ),
            Self::FixedListenerPort { .. } => write!(
                formatter,
                "fixed listener port must be {MIN_FIXED_LISTENER_PORT}..=65535"
            ),
            Self::PeerConnectionLimit { .. } => write!(
                formatter,
                "peer connection limit must be {MIN_PEER_CONNECTION_LIMIT}..={MAX_PEER_CONNECTION_LIMIT}"
            ),
            Self::UploadSlots { .. } => {
                write!(formatter, "upload slots must be 0..={MAX_UPLOAD_SLOTS}")
            }
            Self::ActiveDownloads { .. } => write!(
                formatter,
                "active downloads must be {MIN_ACTIVE_DOWNLOADS}..={MAX_ACTIVE_DOWNLOADS}"
            ),
            Self::ActiveSeeds { .. } => {
                write!(
                    formatter,
                    "active seeds must be Unlimited or 0..={MAX_ACTIVE_SEEDS}"
                )
            }
            Self::SeedGoal { field, .. } => write!(
                formatter,
                "{field} seed goal must be 0..={MAX_SEED_GOAL_VALUE}"
            ),
            Self::SeedStopLimit { field, .. } => write!(
                formatter,
                "{field} limit must be off or 0..={MAX_SEED_GOAL_VALUE}"
            ),
            Self::TransferRateLimit { .. } => write!(
                formatter,
                "finite transfer rate must be {MIN_TRANSFER_RATE_BYTES_PER_SECOND}..={} bytes per second",
                u32::MAX
            ),
        }
    }
}

impl Error for ClientSettingsError {}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum ListenerBindFailureReason {
    AddressInUse,
    PermissionDenied,
    AddressUnavailable,
    Other,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum ListenerStatus {
    #[default]
    Disabled,
    Listening {
        #[schemars(length(max = 64))]
        address: String,
        port: u16,
    },
    BindFailed {
        reason: ListenerBindFailureReason,
        #[schemars(length(max = 512))]
        detail: String,
    },
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum SessionUdpStatus {
    #[default]
    Unavailable,
    Bound {
        #[schemars(length(max = 64))]
        address: String,
        port: u16,
        coordinated_with_tcp: bool,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum PortMappingMechanism {
    UpnpIgdV2,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum PortMappingFailureStage {
    Discovery,
    Description,
    ExternalAddress,
    Add,
    Verify,
    Renewal,
    Delete,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum PortMappingStatus {
    #[default]
    Disabled,
    Ineligible,
    Discovering,
    Mapping,
    Mapped {
        mechanism: PortMappingMechanism,
        #[schemars(length(max = 64))]
        local_address: String,
        local_port: u16,
        #[schemars(length(max = 64))]
        external_address: String,
        external_port: u16,
        lease_seconds: u32,
    },
    Failed {
        stage: PortMappingFailureStage,
        #[schemars(length(max = 512))]
        detail: String,
    },
    RenewalFailed {
        #[schemars(length(max = 64))]
        external_address: String,
        external_port: u16,
        #[schemars(length(max = 512))]
        detail: String,
    },
    CleanupFailed {
        #[schemars(length(max = 64))]
        external_address: String,
        external_port: u16,
        remaining_lease_seconds: u32,
        #[schemars(length(max = 512))]
        detail: String,
    },
    Stopping,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum Ipv6PinholeFailureStage {
    Discovery,
    Description,
    FirewallStatus,
    Add,
    Renewal,
    Delete,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Ipv6PinholeStatus {
    #[default]
    Disabled,
    Ineligible,
    Discovering,
    ServiceUnavailable,
    ActionUnavailable {
        #[schemars(length(max = 512))]
        detail: String,
    },
    InboundPinholeDisallowed,
    Unfiltered {
        #[schemars(length(max = 64))]
        internal_address: String,
        internal_port: u16,
    },
    Creating {
        #[schemars(length(max = 64))]
        internal_address: String,
        internal_port: u16,
    },
    Pinholed {
        #[schemars(length(max = 64))]
        internal_address: String,
        internal_port: u16,
        lease_seconds: u32,
    },
    Failed {
        stage: Ipv6PinholeFailureStage,
        #[schemars(length(max = 512))]
        detail: String,
    },
    RenewalFailed {
        #[schemars(length(max = 64))]
        internal_address: String,
        internal_port: u16,
        #[schemars(length(max = 512))]
        detail: String,
    },
    CleanupFailed {
        #[schemars(length(max = 64))]
        internal_address: String,
        internal_port: u16,
        remaining_lease_seconds: u32,
        #[schemars(length(max = 512))]
        detail: String,
    },
    Stopping,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum AdvertisedPeerEndpointScope {
    Loopback,
    LocalNetwork,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum AdvertisedPeerEndpointUnavailableReason {
    ListenerDisabled,
    ListenerBindFailed,
}

/// Runtime truth about the TCP endpoint available for peer advertisement.
///
/// This is deliberately separate from [`PortMappingStatus`]: a live local
/// listener remains usable after mapping failure, while an active mapping is
/// not evidence that an outside peer has actually connected.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum AdvertisedPeerEndpointStatus {
    #[default]
    Unavailable,
    OutboundOnly {
        generation: String,
        reason: AdvertisedPeerEndpointUnavailableReason,
    },
    Local {
        generation: String,
        #[schemars(length(max = 64))]
        address: String,
        port: u16,
        scope: AdvertisedPeerEndpointScope,
        incoming_observed: bool,
    },
    Mapped {
        generation: String,
        #[schemars(length(max = 64))]
        local_address: String,
        local_port: u16,
        #[schemars(length(max = 64))]
        external_address: String,
        external_port: u16,
        lease_seconds_remaining: u32,
        incoming_observed: bool,
    },
    RenewalUnhealthy {
        generation: String,
        #[schemars(length(max = 64))]
        local_address: String,
        local_port: u16,
        #[schemars(length(max = 64))]
        external_address: String,
        external_port: u16,
        lease_seconds_remaining: u32,
        #[schemars(length(max = 512))]
        detail: String,
        incoming_observed: bool,
    },
    Stopping {
        generation: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        last_port: Option<u16>,
        incoming_observed: bool,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum ClientSettingsDegradedReason {
    TransportBindFailed,
    TransportHandoverFailed,
    PortMappingFailed,
    PortMappingCleanupFailed,
    PeerConnectionConvergenceFailed,
    UploadSlotConvergenceFailed,
    TrackerHttpsAuthenticationFailed,
    RuntimeStopped,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum ClientSettingsApplicationState {
    Applying,
    #[default]
    Applied,
    Degraded {
        reason: ClientSettingsDegradedReason,
        #[schemars(length(max = 512))]
        detail: String,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum TransportAddressFamily {
    Ipv4,
    Ipv6,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
#[serde(deny_unknown_fields)]
pub struct TransportFamilyRuntimeView {
    pub family: TransportAddressFamily,
    pub configured: bool,
    pub tcp_endpoint: Option<String>,
    pub udp_endpoint: Option<String>,
    pub advertised_endpoint: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum ActiveDownloadsClampReason {
    PlatformLimit,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
#[serde(deny_unknown_fields)]
pub struct BandwidthDirectionRuntimeView {
    pub registered_torrents: u32,
    pub active_waiters: u32,
    pub queued_requested_bytes: String,
    pub granted_bytes: String,
    pub returned_bytes: String,
    pub cancelled_requests: String,
    pub throttle_wait_micros: String,
    pub throttle_wait_high_water_micros: String,
    pub current_burst_credit_bytes: String,
}

impl Default for BandwidthDirectionRuntimeView {
    fn default() -> Self {
        Self {
            registered_torrents: 0,
            active_waiters: 0,
            queued_requested_bytes: "0".to_owned(),
            granted_bytes: "0".to_owned(),
            returned_bytes: "0".to_owned(),
            cancelled_requests: "0".to_owned(),
            throttle_wait_micros: "0".to_owned(),
            throttle_wait_high_water_micros: "0".to_owned(),
            current_burst_credit_bytes: "0".to_owned(),
        }
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
#[serde(deny_unknown_fields)]
pub struct BandwidthRuntimeView {
    pub upload: BandwidthDirectionRuntimeView,
    pub download: BandwidthDirectionRuntimeView,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
#[serde(deny_unknown_fields)]
pub struct ClientSettingsRuntimeView {
    pub configured: ClientSettings,
    pub application_network: ApplicationNetworkRuntimeView,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effective_listener: Option<EffectiveListenerSettings>,
    pub effective_port_mapping: PortMappingPolicy,
    pub effective_peer_connection_limit: u32,
    pub effective_upload_slots: u16,
    pub effective_active_downloads: u16,
    pub effective_active_seeds: ActiveSeedLimit,
    pub effective_upload_rate_limit: TransferRateLimit,
    pub effective_download_rate_limit: TransferRateLimit,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_downloads_clamp_reason: Option<ActiveDownloadsClampReason>,
    pub active_download_count: u16,
    pub checking_count: u16,
    pub active_seed_count: u16,
    pub inactive_seed_count: u16,
    pub effective_encryption: EncryptionPolicy,
    pub effective_ipv6_enabled: bool,
    pub effective_dht_enabled: bool,
    pub effective_peer_exchange_enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effective_tracker_https_server_authentication: Option<HttpsServerAuthenticationPolicy>,
    pub transport_application: ClientSettingsApplicationState,
    pub port_mapping_application: ClientSettingsApplicationState,
    pub peer_connections_application: ClientSettingsApplicationState,
    pub upload_slots_application: ClientSettingsApplicationState,
    pub bandwidth_application: ClientSettingsApplicationState,
    pub bandwidth: BandwidthRuntimeView,
    pub encryption_application: ClientSettingsApplicationState,
    pub ipv6_application: ClientSettingsApplicationState,
    pub dht_application: ClientSettingsApplicationState,
    pub peer_exchange_application: ClientSettingsApplicationState,
    pub tracker_https_authentication_application: ClientSettingsApplicationState,
    pub listener_status: ListenerStatus,
    pub session_udp_status: SessionUdpStatus,
    pub port_mapping_status: PortMappingStatus,
    #[serde(default)]
    pub udp_port_mapping_status: PortMappingStatus,
    pub ipv6_pinhole_status: Ipv6PinholeStatus,
    pub advertised_peer_endpoint: AdvertisedPeerEndpointStatus,
    pub transport_families: Vec<TransportFamilyRuntimeView>,
}

impl Default for ClientSettingsRuntimeView {
    fn default() -> Self {
        let settings = ClientSettings::default();
        Self {
            application_network: ApplicationNetworkRuntimeView::default(),
            effective_listener: Some(EffectiveListenerSettings::from_settings(&settings)),
            effective_port_mapping: settings.port_mapping,
            effective_peer_connection_limit: settings.peer_connection_limit,
            effective_upload_slots: settings.upload_slots,
            effective_active_downloads: settings.active_downloads,
            effective_active_seeds: settings.active_seeds,
            effective_upload_rate_limit: settings.upload_rate_limit,
            effective_download_rate_limit: settings.download_rate_limit,
            active_downloads_clamp_reason: None,
            active_download_count: 0,
            checking_count: 0,
            active_seed_count: 0,
            inactive_seed_count: 0,
            effective_encryption: settings.encryption,
            effective_ipv6_enabled: settings.ipv6_enabled,
            effective_dht_enabled: settings.dht_enabled,
            effective_peer_exchange_enabled: settings.peer_exchange_enabled,
            effective_tracker_https_server_authentication: Some(
                settings.tracker_https_server_authentication,
            ),
            configured: settings.clone(),
            transport_application: ClientSettingsApplicationState::Applied,
            port_mapping_application: ClientSettingsApplicationState::Applied,
            peer_connections_application: ClientSettingsApplicationState::Applied,
            upload_slots_application: ClientSettingsApplicationState::Applied,
            bandwidth_application: ClientSettingsApplicationState::Applied,
            bandwidth: BandwidthRuntimeView::default(),
            encryption_application: ClientSettingsApplicationState::Applied,
            ipv6_application: ClientSettingsApplicationState::Applied,
            dht_application: ClientSettingsApplicationState::Applied,
            peer_exchange_application: ClientSettingsApplicationState::Applied,
            tracker_https_authentication_application: ClientSettingsApplicationState::Applied,
            listener_status: ListenerStatus::Disabled,
            session_udp_status: SessionUdpStatus::Unavailable,
            port_mapping_status: PortMappingStatus::Disabled,
            udp_port_mapping_status: PortMappingStatus::Disabled,
            ipv6_pinhole_status: Ipv6PinholeStatus::Disabled,
            advertised_peer_endpoint: AdvertisedPeerEndpointStatus::Unavailable,
            transport_families: Vec::new(),
        }
    }
}

impl ClientSettingsRuntimeView {
    pub fn fresh_profile_default() -> Self {
        let settings = ClientSettings::fresh_profile_default();
        Self {
            application_network: ApplicationNetworkRuntimeView::default(),
            effective_listener: Some(EffectiveListenerSettings {
                listener: ListenerPolicy::Disabled,
                preferred_listen_port: settings.preferred_listen_port,
            }),
            effective_port_mapping: PortMappingPolicy::Disabled,
            effective_peer_connection_limit: settings.peer_connection_limit,
            effective_upload_slots: settings.upload_slots,
            effective_active_downloads: settings.active_downloads,
            effective_active_seeds: settings.active_seeds,
            effective_upload_rate_limit: settings.upload_rate_limit,
            effective_download_rate_limit: settings.download_rate_limit,
            active_downloads_clamp_reason: None,
            active_download_count: 0,
            checking_count: 0,
            active_seed_count: 0,
            inactive_seed_count: 0,
            effective_encryption: settings.encryption,
            effective_ipv6_enabled: false,
            effective_dht_enabled: settings.dht_enabled,
            effective_peer_exchange_enabled: settings.peer_exchange_enabled,
            effective_tracker_https_server_authentication: Some(
                settings.tracker_https_server_authentication,
            ),
            configured: settings,
            transport_application: ClientSettingsApplicationState::Applying,
            port_mapping_application: ClientSettingsApplicationState::Applying,
            peer_connections_application: ClientSettingsApplicationState::Applied,
            upload_slots_application: ClientSettingsApplicationState::Applied,
            bandwidth_application: ClientSettingsApplicationState::Applied,
            bandwidth: BandwidthRuntimeView::default(),
            encryption_application: ClientSettingsApplicationState::Applied,
            ipv6_application: ClientSettingsApplicationState::Applying,
            dht_application: ClientSettingsApplicationState::Applied,
            peer_exchange_application: ClientSettingsApplicationState::Applied,
            tracker_https_authentication_application: ClientSettingsApplicationState::Applied,
            listener_status: ListenerStatus::Disabled,
            session_udp_status: SessionUdpStatus::Unavailable,
            port_mapping_status: PortMappingStatus::Disabled,
            udp_port_mapping_status: PortMappingStatus::Disabled,
            ipv6_pinhole_status: Ipv6PinholeStatus::Disabled,
            advertised_peer_endpoint: AdvertisedPeerEndpointStatus::Unavailable,
            transport_families: Vec::new(),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum ApplicationNetworkPrerequisiteView {
    #[default]
    Allowed,
    WaitingForUnmeteredNetwork,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum ApplicationNetworkRuntimeState {
    #[default]
    Allowed,
    Blocking,
    Blocked,
    Starting,
    Degraded,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct ApplicationNetworkRuntimeView {
    pub requested_generation: String,
    pub requested_prerequisite: ApplicationNetworkPrerequisiteView,
    pub effective_generation: String,
    pub effective_prerequisite: ApplicationNetworkPrerequisiteView,
    pub state: ApplicationNetworkRuntimeState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub degraded_detail: Option<String>,
}

impl Default for ApplicationNetworkRuntimeView {
    fn default() -> Self {
        Self {
            requested_generation: "1".to_owned(),
            requested_prerequisite: ApplicationNetworkPrerequisiteView::Allowed,
            effective_generation: "1".to_owned(),
            effective_prerequisite: ApplicationNetworkPrerequisiteView::Allowed,
            state: ApplicationNetworkRuntimeState::Allowed,
            degraded_detail: None,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct StorageSettingsSnapshot {
    pub roots: Vec<StorageRootSnapshot>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_root: Option<String>,
    pub show_add_options: bool,
    #[serde(default = "default_true")]
    pub show_file_selection: bool,
}

const fn default_true() -> bool {
    true
}

impl Default for StorageSettingsSnapshot {
    fn default() -> Self {
        Self {
            roots: Vec::new(),
            default_root: None,
            show_add_options: true,
            show_file_selection: true,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct StorageRootSnapshot {
    pub root_id: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_path: Option<String>,
    pub availability: StorageRootAvailability,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum StorageRootAvailability {
    Available,
    Unavailable,
}
