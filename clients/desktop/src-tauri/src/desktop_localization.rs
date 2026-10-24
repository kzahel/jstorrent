use std::collections::HashMap;
use std::sync::OnceLock;

const ENGLISH_CATALOG: &str = include_str!("../locales/en.json");
const MISSING_MESSAGE: &str = "Localized message unavailable";
static CATALOG: OnceLock<HashMap<String, String>> = OnceLock::new();

pub(crate) fn text(key: &str) -> &'static str {
    let catalog = CATALOG.get_or_init(|| {
        serde_json::from_str(ENGLISH_CATALOG)
            .expect("packaged desktop English localization catalog must be valid")
    });
    match catalog.get(key) {
        Some(value) => value,
        None => {
            eprintln!("missing desktop localized message: {key}");
            MISSING_MESSAGE
        }
    }
}

pub(crate) fn format(key: &str, values: &[(&str, &str)]) -> String {
    let mut rendered = text(key).to_owned();
    for (name, value) in values {
        rendered = rendered.replace(&format!("{{{name}}}"), value);
    }
    rendered
}

#[cfg(test)]
mod tests {
    use super::{format, text};

    #[test]
    fn resolves_packaged_english_and_named_placeholders() {
        assert_eq!(text("tray.show"), "Show JSTorrent");
        assert_eq!(
            format("notification.download-complete.body", &[("name", "Sintel")]),
            "Sintel finished downloading."
        );
    }
}
