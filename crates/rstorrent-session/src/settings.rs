//! Typed client settings and storage-settings transfer values.
//!
//! The application service and session store retain runtime and persistence
//! ownership. This subsystem keeps portable invariants and deterministic
//! conversion independent from those owners.

mod contract;
mod convergence;
mod persistence;
mod runtime;

pub(crate) use contract::MAX_RUNTIME_DETAIL_BYTES;
pub use contract::{
    ActiveDownloadsClampReason, ActiveSeedLimit, AdvertisedPeerEndpointScope,
    AdvertisedPeerEndpointStatus, AdvertisedPeerEndpointUnavailableReason,
    ApplicationNetworkPrerequisiteView, ApplicationNetworkRuntimeState,
    ApplicationNetworkRuntimeView, BandwidthDirectionRuntimeView, BandwidthRuntimeView,
    ClientSettings, ClientSettingsApplicationState, ClientSettingsDegradedReason,
    ClientSettingsError, ClientSettingsPatch, ClientSettingsRuntimeView, DEFAULT_ACTIVE_DOWNLOADS,
    DEFAULT_ACTIVE_SEEDS, DEFAULT_FINISHED_DOWNLOAD_RATIO_LIMIT_PERCENT,
    DEFAULT_FINISHED_TIME_LIMIT_SECONDS, DEFAULT_SHARE_RATIO_LIMIT_PERCENT,
    EffectiveListenerSettings, EncryptionPolicy, HttpsServerAuthenticationPolicy,
    Ipv6PinholeFailureStage, Ipv6PinholeStatus, ListenerBindFailureReason, ListenerPolicy,
    ListenerStatus, MAX_ACTIVE_DOWNLOADS, MAX_ACTIVE_SEEDS, MAX_SEED_GOAL_VALUE,
    MIN_ACTIVE_DOWNLOADS, PortMappingFailureStage, PortMappingMechanism, PortMappingPolicy,
    PortMappingStatus, SeedStopLimit, SessionUdpStatus, StorageRootAvailability,
    StorageRootSnapshot, StorageSettingsSnapshot, TorrentSeedStopLimit, TorrentSeedStopLimits,
    TorrentSettingsPatch, TorrentTransferLimits, TransferRateLimit, TransportAddressFamily,
    TransportFamilyRuntimeView,
};
pub(crate) use convergence::{
    SettingsAttempt, SettingsConvergenceModel, SettingsDomain, SettingsDomainGeneration,
};
pub(crate) use persistence::{
    SettingsPersistenceError, create_client_settings, read_client_settings, replace_client_settings,
};
pub(crate) use runtime::{bounded_utf8, classify_listener_bind_failure};

#[cfg(test)]
mod tests;
