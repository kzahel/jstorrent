//! Build-time registration shared with synthetic catalog tests.
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

const MAX_LOCALES: usize = 100;
const MAX_CATALOG_BYTES: u64 = 8 * 1024 * 1024;

pub fn generate(
    manifest: &serde_json::Value,
    root: &Path,
    preview_requested: bool,
) -> Result<(String, Vec<PathBuf>), String> {
    let source = manifest["sourceLocale"]
        .as_str()
        .ok_or("missing source locale")?;
    let fallback = manifest["fallbackLocale"]
        .as_str()
        .ok_or("missing fallback locale")?;
    let shipping = locale_list(&manifest["supportedLocales"]["desktop"])?;
    let preview = if manifest["previewLocales"]["desktop"].is_null() {
        Vec::new()
    } else {
        locale_list(&manifest["previewLocales"]["desktop"])?
    };
    if !shipping.iter().any(|tag| tag == source) || !shipping.iter().any(|tag| tag == fallback) {
        return Err("desktop source and fallback locales must be shipping locales".into());
    }
    let known: Vec<&str> = shipping
        .iter()
        .chain(&preview)
        .map(String::as_str)
        .collect();
    let unique: BTreeSet<String> = known.iter().map(|tag| tag.to_ascii_lowercase()).collect();
    if known.len() > MAX_LOCALES || unique.len() != known.len() {
        return Err("desktop locales must be distinct and contain at most 100 tags".into());
    }
    if manifest["testLocales"].as_array().is_some_and(|tests| {
        tests.iter().any(|test| {
            test["tag"]
                .as_str()
                .is_some_and(|tag| known.iter().any(|known| known.eq_ignore_ascii_case(tag)))
        })
    }) {
        return Err("desktop product locales cannot register a test locale".into());
    }
    let relative = manifest["catalogs"]["desktop"]
        .as_str()
        .ok_or("missing desktop source catalog")?;
    let source_path = root.join(relative);
    if source_path.file_stem().and_then(|stem| stem.to_str()) != Some(source) {
        return Err("desktop source catalog filename must match sourceLocale".into());
    }
    let directory = source_path
        .parent()
        .ok_or("missing desktop catalog directory")?;
    let mut output = format!(
        "// Generated from localization/locales.json; do not edit.\nconst FALLBACK_LOCALE: &str = {fallback:?};\nconst DECLARED_LOCALES: &[&str] = &{known:?};\n#[cfg(test)]\nconst SHIPPING_LOCALES: &[&str] = &{shipping:?};\nstatic DESKTOP_LOCALE_REGISTRY: LocaleRegistry = LocaleRegistry {{\n    declared: DECLARED_LOCALES,\n    fallback: FALLBACK_LOCALE,\n    sources: &[\n"
    );
    let mut paths = Vec::new();
    for (tags, is_preview) in [(&shipping, false), (&preview, true)] {
        for tag in tags {
            let path = directory.join(format!("{tag}.json"));
            paths.push(path.clone());
            // Disabled preview catalogs are not needed to build shipping UI.
            if is_preview && !preview_requested {
                continue;
            }
            validate_catalog(&path)?;
            let absolute = path
                .canonicalize()
                .map_err(|error| format!("inspect catalog {}: {error}", path.display()))?;
            let absolute = absolute
                .to_str()
                .ok_or("desktop catalog path must be UTF-8")?;
            if is_preview {
                output.push_str("        #[cfg(debug_assertions)]\n");
            }
            output.push_str(&format!("        LocaleCatalogSource {{ locale: {tag:?}, json: include_str!({absolute:?}) }},\n"));
        }
    }
    output.push_str("    ],\n    catalogs: OnceLock::new(),\n};\n");
    Ok((output, paths))
}

fn locale_list(value: &serde_json::Value) -> Result<Vec<String>, String> {
    let tags = value
        .as_array()
        .ok_or("desktop locale list must be an array")?;
    if tags.len() > MAX_LOCALES {
        return Err("desktop locale list exceeds 100 tags".into());
    }
    tags.iter()
        .map(|value| {
            let tag = value
                .as_str()
                .ok_or("desktop locale tags must be strings")?;
            let mut parts = tag.split('-');
            let language = parts.next().unwrap_or_default();
            if tag.len() > 64
                || tag.eq_ignore_ascii_case("system")
                || !(2..=8).contains(&language.len())
                || !language.bytes().all(|byte| byte.is_ascii_alphabetic())
                || parts.any(|part| {
                    part.is_empty()
                        || part.len() > 8
                        || !part.bytes().all(|byte| byte.is_ascii_alphanumeric())
                })
            {
                return Err(format!("invalid desktop locale tag: {tag}"));
            }
            Ok(tag.to_owned())
        })
        .collect()
}

fn validate_catalog(path: &Path) -> Result<(), String> {
    let length = path
        .metadata()
        .map_err(|error| format!("inspect catalog {}: {error}", path.display()))?
        .len();
    if length > MAX_CATALOG_BYTES {
        return Err(format!("desktop catalog exceeds 8 MiB: {}", path.display()));
    }
    let value: serde_json::Value = serde_json::from_slice(
        &std::fs::read(path)
            .map_err(|error| format!("read catalog {}: {error}", path.display()))?,
    )
    .map_err(|error| format!("parse catalog {}: {error}", path.display()))?;
    let values = value
        .as_object()
        .ok_or("desktop catalog must be an object")?;
    if values.is_empty()
        || values.len() > 10_000
        || values.values().any(|value| {
            value
                .as_str()
                .is_none_or(|text| text.is_empty() || text.len() > 65536)
        })
    {
        return Err(format!(
            "desktop catalog has invalid messages: {}",
            path.display()
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(directory: &Path) -> serde_json::Value {
        std::fs::create_dir_all(directory.join("catalogs")).unwrap();
        std::fs::write(directory.join("catalogs/en.json"), r#"{"show":"Show"}"#).unwrap();
        std::fs::write(directory.join("catalogs/fr.json"), r#"{"show":"Afficher"}"#).unwrap();
        serde_json::json!({"sourceLocale":"en", "fallbackLocale":"en", "supportedLocales":{"desktop":["en"]}, "previewLocales":{"desktop":["fr"]}, "catalogs":{"desktop":"catalogs/en.json"}})
    }

    #[test]
    fn synthetic_french_registration_needs_no_runtime_language_branch() {
        let directory = tempfile::tempdir().unwrap();
        let manifest = fixture(directory.path());
        let (shipping, paths) = generate(&manifest, directory.path(), false).unwrap();
        assert_eq!(paths.len(), 2);
        assert!(shipping.contains("DECLARED_LOCALES: &[&str] = &[\"en\", \"fr\"]"));
        assert!(!shipping.contains("fr.json"));
        let (preview, _) = generate(&manifest, directory.path(), true).unwrap();
        assert!(
            preview
                .contains("#[cfg(debug_assertions)]\n        LocaleCatalogSource { locale: \"fr\"")
        );
        assert!(preview.contains("fr.json"));
        std::fs::remove_file(directory.path().join("catalogs/fr.json")).unwrap();
        assert!(generate(&manifest, directory.path(), false).is_ok());
        assert!(generate(&manifest, directory.path(), true).is_err());
    }

    #[test]
    fn rejects_ambiguous_unsafe_and_test_locale_registration() {
        let directory = tempfile::tempdir().unwrap();
        let mut manifest = fixture(directory.path());
        for invalid in [
            serde_json::json!(["EN"]),
            serde_json::json!(["../fr"]),
            serde_json::json!(["system"]),
        ] {
            manifest["previewLocales"]["desktop"] = invalid;
            assert!(generate(&manifest, directory.path(), true).is_err());
        }
        manifest["previewLocales"]["desktop"] = serde_json::json!(["fr"]);
        manifest["testLocales"] = serde_json::json!([{"tag":"fr"}]);
        assert!(generate(&manifest, directory.path(), true).is_err());
    }

    #[test]
    fn promoting_french_changes_only_manifest_registration() {
        let directory = tempfile::tempdir().unwrap();
        let mut manifest = fixture(directory.path());
        manifest["supportedLocales"]["desktop"] = serde_json::json!(["en", "fr"]);
        manifest["previewLocales"] = serde_json::json!({});
        let (generated, _) = generate(&manifest, directory.path(), false).unwrap();
        assert!(generated.contains("LocaleCatalogSource { locale: \"fr\""));
        assert!(!generated.contains("#[cfg(debug_assertions)]"));
    }

    #[test]
    fn registration_count_obeys_the_shared_hundred_locale_bound() {
        let directory = tempfile::tempdir().unwrap();
        let mut manifest = fixture(directory.path());
        let tags: Vec<String> = (0..99)
            .map(|index| {
                format!(
                    "q{}{}",
                    char::from(b'a' + index / 26),
                    char::from(b'a' + index % 26)
                )
            })
            .collect();
        manifest["previewLocales"]["desktop"] = serde_json::json!(tags);
        assert!(generate(&manifest, directory.path(), false).is_ok());
        manifest["previewLocales"]["desktop"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!("fr"));
        assert!(generate(&manifest, directory.path(), false).is_err());
    }
}
