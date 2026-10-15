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
pub const MAGNET_EXPORT_OPTIONS: &str = "magnet_export_options";
/// The host reads the client identity in `Connect` (Tactical 370). It owns
/// no gated surface: clients send the identity before the hello, and hosts
/// without this capability ignore it.
pub const CLIENT_IDENTITY: &str = "client_identity";

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
    /// Fields of existing commands, as `command.field`. A released host's
    /// command parser ignores unknown fields, which would silently drop them.
    pub command_fields: &'static [&'static str],
    pub client_settings_patch_keys: &'static [&'static str],
    pub torrent_settings_patch_keys: &'static [&'static str],
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum HostCapabilityLifecycle {
    Transitional,
    Required,
}

pub const HOST_CAPABILITIES: &[HostCapability] = &[
    HostCapability {
        name: SEED_STOP_LIMITS,
        id: 1,
        introduced: "2026-10-14",
        lifecycle: HostCapabilityLifecycle::Transitional,
        commands: &[],
        command_fields: &[],
        client_settings_patch_keys: &["seed_stop_ratio_percent", "seed_stop_time_seconds"],
        torrent_settings_patch_keys: &["seed_stop_ratio_percent", "seed_stop_time_seconds"],
    },
    HostCapability {
        name: MAGNET_EXPORT_OPTIONS,
        id: 2,
        introduced: "2026-10-15",
        lifecycle: HostCapabilityLifecycle::Transitional,
        commands: &[],
        command_fields: &["export_magnet.options"],
        client_settings_patch_keys: &[],
        torrent_settings_patch_keys: &[],
    },
    HostCapability {
        name: CLIENT_IDENTITY,
        id: 3,
        introduced: "2026-10-15",
        lifecycle: HostCapabilityLifecycle::Transitional,
        commands: &[],
        command_fields: &[],
        client_settings_patch_keys: &[],
        torrent_settings_patch_keys: &[],
    },
];

/// The registry as exported into the generated client contracts.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, TS)]
pub struct HostCapabilityDefinition {
    pub name: String,
    pub id: u16,
    pub introduced: String,
    pub lifecycle: HostCapabilityLifecycle,
    pub commands: Vec<String>,
    pub command_fields: Vec<String>,
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
            command_fields: strings(capability.command_fields),
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
    fn owned_command_fields_exist_in_their_commands() {
        let command = serde_json::to_value(schemars::schema_for!(crate::Command)).unwrap();
        let definitions = command.get("$defs").cloned().unwrap_or_default();
        let resolve = |schema: &serde_json::Value| -> serde_json::Value {
            match schema.get("$ref").and_then(|value| value.as_str()) {
                Some(reference) => definitions
                    .get(reference.rsplit('/').next().unwrap())
                    .cloned()
                    .unwrap_or_default(),
                None => schema.clone(),
            }
        };
        let variants = resolve(&command)
            .get("oneOf")
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default();
        for entry in HOST_CAPABILITIES {
            for owned in entry.command_fields {
                let (name, field) = owned.split_once('.').expect("command.field");
                let found = variants.iter().any(|variant| {
                    variant
                        .pointer("/properties/type/const")
                        .and_then(|value| value.as_str())
                        == Some(name)
                        && variant.pointer(&format!("/properties/{field}")).is_some()
                });
                assert!(found, "{}: no command field {owned}", entry.name);
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
