//! Host capabilities beyond the v1 baseline contract.
//!
//! A host advertises each one in the API hello. A client gates the controls,
//! commands and patch keys a capability owns, because a host released before
//! the capability rejects them. Entries are append-only: an ID is never
//! reused and an entry is never deleted, even after clients stop gating it.
//! See `docs/topics/mixed-version-compatibility.md`.

use serde::Serialize;
use ts_rs::TS;

pub const SEED_STOP_LIMITS: &str = "seed_stop_limits";

/// One registered capability and the contract surface it owns.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct HostCapability {
    pub name: &'static str,
    pub id: u16,
    /// Date the first host advertising it was built from `main`.
    pub introduced: &'static str,
    /// `transitional` while clients keep a fallback; `required` once the
    /// fallback is removed through the removal review.
    pub lifecycle: HostCapabilityLifecycle,
    pub commands: &'static [&'static str],
    pub client_settings_patch_keys: &'static [&'static str],
    pub torrent_settings_patch_keys: &'static [&'static str],
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum HostCapabilityLifecycle {
    Transitional,
    Required,
}

pub const HOST_CAPABILITIES: &[HostCapability] = &[HostCapability {
    name: SEED_STOP_LIMITS,
    id: 1,
    introduced: "2026-10-14",
    lifecycle: HostCapabilityLifecycle::Transitional,
    commands: &[],
    client_settings_patch_keys: &["seed_stop_ratio_percent", "seed_stop_time_seconds"],
    torrent_settings_patch_keys: &["seed_stop_ratio_percent", "seed_stop_time_seconds"],
}];

/// The registry as exported into the generated client contracts.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, TS)]
pub struct HostCapabilityDefinition {
    pub name: String,
    pub id: u16,
    pub introduced: String,
    pub lifecycle: HostCapabilityLifecycle,
    pub commands: Vec<String>,
    pub client_settings_patch_keys: Vec<String>,
    pub torrent_settings_patch_keys: Vec<String>,
}

pub fn host_capability_definitions() -> Vec<HostCapabilityDefinition> {
    let strings = |values: &[&str]| values.iter().map(|value| (*value).to_owned()).collect();
    HOST_CAPABILITIES
        .iter()
        .map(|capability| HostCapabilityDefinition {
            name: capability.name.to_owned(),
            id: capability.id,
            introduced: capability.introduced.to_owned(),
            lifecycle: capability.lifecycle,
            commands: strings(capability.commands),
            client_settings_patch_keys: strings(capability.client_settings_patch_keys),
            torrent_settings_patch_keys: strings(capability.torrent_settings_patch_keys),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::*;

    #[test]
    fn registry_names_and_ids_are_unique() {
        let names: BTreeSet<_> = HOST_CAPABILITIES.iter().map(|entry| entry.name).collect();
        let ids: BTreeSet<_> = HOST_CAPABILITIES.iter().map(|entry| entry.id).collect();
        assert_eq!(names.len(), HOST_CAPABILITIES.len());
        assert_eq!(ids.len(), HOST_CAPABILITIES.len());
        assert!(HOST_CAPABILITIES.iter().all(|entry| entry.id != 0));
    }

    #[test]
    fn owned_patch_keys_exist_in_the_patches() {
        let properties = |schema: schemars::Schema| -> BTreeSet<String> {
            schema
                .get("properties")
                .and_then(|value| value.as_object())
                .map(|object| object.keys().cloned().collect())
                .unwrap_or_default()
        };
        let client = properties(schemars::schema_for!(crate::ClientSettingsPatch));
        let torrent = properties(schemars::schema_for!(crate::TorrentSettingsPatch));
        for entry in HOST_CAPABILITIES {
            for key in entry.client_settings_patch_keys {
                assert!(
                    client.contains(*key),
                    "{}: no client settings key {key}",
                    entry.name
                );
            }
            for key in entry.torrent_settings_patch_keys {
                assert!(
                    torrent.contains(*key),
                    "{}: no torrent settings key {key}",
                    entry.name
                );
            }
        }
    }

    #[test]
    fn hello_advertises_every_registered_capability() {
        let hello = crate::ApiHello::default();
        for entry in HOST_CAPABILITIES {
            assert!(
                hello.capabilities.iter().any(|name| name == entry.name),
                "{} is not advertised",
                entry.name
            );
        }
    }
}
