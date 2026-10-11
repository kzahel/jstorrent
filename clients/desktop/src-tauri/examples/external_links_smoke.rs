//! Opt-in native webview/ACL/system-browser smoke. Opens five public pages.
//! Run with `cargo run -p rstorrent-desktop --example external_links_smoke`.
//! No engine, profile, migration, native-host registration, or updater is started.
use std::borrow::Cow;
use tauri::utils::assets::{AssetKey, AssetsIter, CspHash};

const SCRIPT: &str = r#"
addEventListener('DOMContentLoaded', async () => {
  const allowed = [
    'https://github.com/kzahel/jstorrent/issues',
    'https://github.com/kzahel/jstorrent/issues/new',
    'https://github.com/kzahel/jstorrent/blob/main/docs/user-support.md',
    'https://github.com/kzahel/jstorrent/releases/latest',
    'https://github.com/kzahel/jstorrent/releases/tag/v0.3.0',
  ];
  const denied = [
    'file:///tmp/rstorrent-link-smoke', 'javascript:alert(1)',
    'https://example.com/', 'http://github.com/kzahel/jstorrent/issues',
    'https://github.com.evil.example/kzahel/jstorrent/issues',
    'https://github.com/kzahel/jstorrent/issues/123',
    'https://github.com/kzahel/jstorrent/releases/tagged/v0.3.0',
    'https://github.com/kzahel/jstorrent/issues?unexpected=1',
  ];
  const results = [];
  for (const url of denied) {
    try { await window.__TAURI_INTERNALS__.invoke('plugin:opener|open_url', {url}); results.push(false); }
    catch { results.push(true); }
  }
  for (const url of allowed) {
    try { await window.__TAURI_INTERNALS__.invoke('plugin:opener|open_url', {url}); results.push(true); }
    catch { results.push(false); }
  }
  try {
    await window.__TAURI_INTERNALS__.invoke('plugin:opener|open_url', {url: allowed[0], with: 'Safari'});
    results.push(false);
  } catch { results.push(true); }
  await window.__TAURI_INTERNALS__.invoke('smoke_done', {results});
});
"#;

struct SmokeAssets;
impl tauri::Assets<tauri::Wry> for SmokeAssets {
    fn get(&self, _key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        Some(Cow::Borrowed(
            b"<!doctype html><title>External link smoke</title><p>Native opener smoke</p>",
        ))
    }
    fn iter(&self) -> Box<AssetsIter<'_>> {
        Box::new(std::iter::empty())
    }
    fn csp_hashes(&self, _path: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        Box::new(std::iter::empty())
    }
}

#[tauri::command]
fn smoke_done(app: tauri::AppHandle, results: Vec<bool>) {
    println!(
        "{}",
        serde_json::json!({"cases": results.len(), "passed": results.iter().filter(|passed| **passed).count()})
    );
    app.exit(i32::from(
        results.len() != 14 || results.iter().any(|passed| !passed),
    ));
}

fn main() {
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "org.rstorrent.external-link-smoke".into();
    context.config_mut().app.windows.clear();
    context.set_assets(Box::new(SmokeAssets));
    tauri::Builder::default()
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![smoke_done])
        .setup(|app| {
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("External link smoke")
            .visible(false)
            .initialization_script(SCRIPT)
            .build()?;
            Ok(())
        })
        .run(context)
        .expect("run external link smoke");
}
