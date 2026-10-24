//! Authenticate release compatibility before downloading or stopping the host.
use base64::Engine as _;
use rstorrent_session::update_compatibility::{DatabaseCompatibility, inspect_update_database};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use tauri::Manager;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(crate) struct SignedCompatibility {
    pub(crate) data: String,
    pub(crate) signature: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReleaseCompatibility {
    schema_version: u32,
    version: String,
    identifier: String,
    databases: DatabaseCompatibility,
    platforms: BTreeMap<String, Payload>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Payload {
    url: String,
    signature: String,
}

pub(crate) fn admit(
    app: &tauri::AppHandle,
    update: &crate::update_channels::CheckedUpdate,
) -> Result<(), String> {
    let Some(envelope) = &update.compatibility else {
        if cfg!(feature = "update-qualification")
            && app
                .config()
                .identifier
                .starts_with("com.jstorrent.qualification.")
        {
            return Ok(());
        }
        return Err(
            "Waiting for a compatible release: missing authenticated database metadata".into(),
        );
    };
    let key = app
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|value| value.get("pubkey"))
        .and_then(|value| value.as_str())
        .ok_or("Missing updater signing key")?;
    let platform = format!(
        "{}-{}",
        std::env::consts::OS.replace("macos", "darwin"),
        std::env::consts::ARCH
    );
    let release = authenticate(key, envelope, update, &app.config().identifier, &platform)?;
    let data = match crate::debug_data_root_override() {
        Some(root) => root.join("data"),
        None => app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?,
    };
    let product = app
        .state::<crate::DesktopProduct>()
        .0
        .database_path()
        .map_err(|error| error.to_string())?;
    let mut versions = BTreeMap::new();
    for (name, path) in [
        ("session", Some(data.join("profile/session.db"))),
        ("metrics", Some(data.join("profile/metrics.db"))),
        ("product", product),
    ] {
        if let Some(path) = path
            && let Some(version) = inspect_update_database(&path, name == "metrics")?
        {
            versions.insert(name.to_owned(), version);
        }
    }
    release
        .databases
        .admits(&DatabaseCompatibility::current(), &versions)
}

fn authenticate(
    key: &str,
    envelope: &SignedCompatibility,
    update: &crate::update_channels::CheckedUpdate,
    identifier: &str,
    platform: &str,
) -> Result<ReleaseCompatibility, String> {
    if envelope.data.len() > 48 * 1024 || envelope.signature.len() > 4096 {
        return Err("Release compatibility exceeds its size limit".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&envelope.data)
        .map_err(|_| "Invalid compatibility encoding")?;
    crate::automatic_updates::verify_signature(key, &bytes, &envelope.signature)?;
    let release: ReleaseCompatibility =
        serde_json::from_slice(&bytes).map_err(|_| "Invalid release compatibility metadata")?;
    if release.schema_version != 1
        || release.version != update.version
        || release.identifier != identifier
        || release.platforms.len() > 32
        || !release.platforms.get(platform).is_some_and(|payload| {
            payload.url == update.download_url.as_str() && payload.signature == update.signature
        })
    {
        return Err("Authenticated release compatibility does not match this update".into());
    }
    release.databases.validate()?;
    Ok(release)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (
        String,
        SignedCompatibility,
        crate::update_channels::CheckedUpdate,
    ) {
        let value: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../tests/interop/desktop_updates/compatibility-fixture.json"
        ))
        .unwrap();
        let envelope: SignedCompatibility =
            serde_json::from_value(value["envelope"].clone()).unwrap();
        let update = crate::update_channels::CheckedUpdate {
            version: "0.4.121".into(),
            body: None,
            signature: "payload-signature".into(),
            download_url: "https://example.test/update".parse().unwrap(),
            compatibility: Some(envelope.clone()),
        };
        (
            value["publicKey"].as_str().unwrap().into(),
            envelope,
            update,
        )
    }
    #[test]
    fn signed_facts_bind_product_version_platform_url_and_payload_signature() {
        let (key, envelope, update) = fixture();
        let check = |update: &crate::update_channels::CheckedUpdate, id, platform| {
            authenticate(&key, &envelope, update, id, platform)
        };
        assert!(check(&update, "com.example.update-test", "darwin-aarch64").is_ok());
        assert!(check(&update, "com.jstorrent.desktop", "darwin-aarch64").is_err());
        assert!(check(&update, "com.example.update-test", "windows-x86_64").is_err());
        let mut other = update.clone();
        other.version = "0.4.122".into();
        assert!(check(&other, "com.example.update-test", "darwin-aarch64").is_err());
        other = update.clone();
        other.signature = "different".into();
        assert!(check(&other, "com.example.update-test", "darwin-aarch64").is_err());
        other = update;
        other.download_url = "https://example.test/other".parse().unwrap();
        assert!(check(&other, "com.example.update-test", "darwin-aarch64").is_err());
    }
    #[test]
    fn refuses_forged_or_oversized_metadata_before_admission() {
        let (key, mut envelope, update) = fixture();
        let mut bytes = base64::engine::general_purpose::STANDARD
            .decode(&envelope.data)
            .unwrap();
        bytes[20] ^= 1;
        envelope.data = base64::engine::general_purpose::STANDARD.encode(bytes);
        assert!(
            authenticate(
                &key,
                &envelope,
                &update,
                "com.example.update-test",
                "darwin-aarch64"
            )
            .is_err()
        );
        envelope.data = "a".repeat(48 * 1024 + 1);
        assert!(
            authenticate(
                &key,
                &envelope,
                &update,
                "com.example.update-test",
                "darwin-aarch64"
            )
            .is_err()
        );
    }
}
