//! Opt-in isolated native menu/webview IPC locale smoke.
//! Run with `VITE_RSTORRENT_ENABLE_PREVIEW_LOCALES=1 cargo run -p
//! rstorrent-desktop --example desktop_locale_smoke`.
//! No engine, product profile, registration, notifications, or external pages.
use std::borrow::Cow;
use std::sync::Mutex;
use tauri::menu::{CheckMenuItem, Menu, MenuItem};
use tauri::utils::assets::{AssetKey, AssetsIter, CspHash};
use tauri::{Emitter, Manager};

#[allow(dead_code)]
#[path = "../src/desktop_localization.rs"]
mod desktop_localization;
use desktop_localization::{DesktopLocaleOwner, LocalePreference};

const SCRIPT: &str = r#"
addEventListener('DOMContentLoaded', async () => {
  const results = [];
  const invoke = window.__TAURI_INTERNALS__.invoke;
  try {
    const events = [];
    const handler = window.__TAURI_INTERNALS__.transformCallback(event => events.push(event.payload));
    const eventId = await invoke('plugin:event|listen', {event:'desktop://locale-changed', target:{kind:'Any'}, handler});
    const initial = await invoke('smoke_locale', {preference:null, reopen:false});
    results.push(initial.snapshot.preference === 'system');
    const en = await invoke('smoke_locale', {preference:'en', reopen:false});
    results.push(en.snapshot.locale === 'en', en.show === 'Show JSTorrent', en.background === 'Run in Background');
    results.push(en.notification === '{name} finished downloading.', en.dialog === 'Choose a download folder');
    const de = await invoke('smoke_locale', {preference:'de', reopen:false});
    results.push(de.snapshot.locale === 'de', de.show !== en.show, de.background !== en.background);
    results.push(de.notification !== en.notification && de.notification.includes('{name}'), de.dialog !== en.dialog);
    const restarted = await invoke('smoke_locale', {preference:null, reopen:true});
    results.push(restarted.snapshot.preference === 'de', restarted.snapshot.locale === 'de', restarted.show === de.show);
    const system = await invoke('smoke_locale', {preference:'system', reopen:false});
    results.push(system.snapshot.preference === 'system', system.unknownPreserved);
    await new Promise(resolve => setTimeout(resolve, 100));
    await invoke('plugin:event|unlisten', {event:'desktop://locale-changed', eventId});
    results.push(events.some(event => event.preference === 'de' && event.locale === 'de') && events.some(event => event.preference === 'system'));
  } catch (error) { console.error(error); results.push(false); }
  await invoke('smoke_done', {results});
});
"#;

struct SmokeAssets;
impl tauri::Assets<tauri::Wry> for SmokeAssets {
    fn get(&self, _key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        Some(Cow::Borrowed(
            b"<!doctype html><title>Desktop locale smoke</title>",
        ))
    }
    fn iter(&self) -> Box<AssetsIter<'_>> {
        Box::new(std::iter::empty())
    }
    fn csp_hashes(&self, _path: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        Box::new(std::iter::empty())
    }
}

struct SmokeState {
    directory: tempfile::TempDir,
    owner: Mutex<DesktopLocaleOwner>,
    show: MenuItem<tauri::Wry>,
    background: CheckMenuItem<tauri::Wry>,
    _menu: Menu<tauri::Wry>,
}

#[tauri::command]
fn smoke_locale(
    app: tauri::AppHandle,
    state: tauri::State<'_, SmokeState>,
    preference: Option<LocalePreference>,
    reopen: bool,
) -> Result<serde_json::Value, String> {
    let mut owner = state.owner.lock().map_err(|_| "locale owner poisoned")?;
    if reopen {
        *owner = DesktopLocaleOwner::open(state.directory.path());
    }
    let snapshot = match preference {
        Some(preference) => owner.select(preference)?,
        None => owner.snapshot(),
    };
    desktop_localization::activate(snapshot.locale);
    state
        .show
        .set_text(desktop_localization::text("tray.show"))
        .map_err(|error| error.to_string())?;
    state
        .background
        .set_text(desktop_localization::text("tray.run-in-background"))
        .map_err(|error| error.to_string())?;
    app.emit(desktop_localization::LOCALE_CHANGED_EVENT, &snapshot)
        .map_err(|error| error.to_string())?;
    let fields: serde_json::Value =
        std::fs::read(state.directory.path().join("presentation-preferences.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
    Ok(serde_json::json!({
        "snapshot": snapshot,
        "show": state.show.text().map_err(|error| error.to_string())?,
        "background": state.background.text().map_err(|error| error.to_string())?,
        "dialog": desktop_localization::text("dialog.download-folder.title"),
        "notification": desktop_localization::format_for_locale("notification.download-complete.body", snapshot.locale, &[("name", "{name}")]),
        "unknownPreserved": fields["future"]["keep"] == true,
    }))
}

#[tauri::command]
fn smoke_done(app: tauri::AppHandle, results: Vec<bool>) {
    println!(
        "{}",
        serde_json::json!({"cases": results.len(), "passed": results.iter().filter(|passed| **passed).count()})
    );
    app.exit(i32::from(
        results.len() != 17 || results.iter().any(|passed| !passed),
    ));
}

fn main() {
    let probe = tempfile::tempdir().expect("create isolated locale probe");
    if !DesktopLocaleOwner::open(probe.path())
        .snapshot()
        .available_locales
        .contains(&"de")
    {
        eprintln!(
            "German smoke requires a debug build with VITE_RSTORRENT_ENABLE_PREVIEW_LOCALES=1"
        );
        std::process::exit(2);
    }
    drop(probe);
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "org.rstorrent.desktop-locale-smoke".into();
    context.config_mut().app.windows.clear();
    context.set_assets(Box::new(SmokeAssets));
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![smoke_locale, smoke_done])
        .setup(|app| {
            let directory = tempfile::tempdir()?;
            std::fs::write(
                directory.path().join("presentation-preferences.json"),
                br#"{"future":{"keep":true}}"#,
            )?;
            let owner = DesktopLocaleOwner::open(directory.path());
            desktop_localization::activate(owner.snapshot().locale);
            let show = MenuItem::with_id(
                app,
                "show",
                desktop_localization::text("tray.show"),
                true,
                None::<&str>,
            )?;
            let background = CheckMenuItem::with_id(
                app,
                "background",
                desktop_localization::text("tray.run-in-background"),
                true,
                false,
                None::<&str>,
            )?;
            let menu = Menu::with_items(app, &[&show, &background])?;
            app.manage(SmokeState {
                directory,
                owner: Mutex::new(owner),
                show,
                background,
                _menu: menu,
            });
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .visible(false)
            .initialization_script(SCRIPT)
            .build()?;
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(20));
                eprintln!("desktop locale smoke timed out");
                handle.exit(1);
            });
            Ok(())
        })
        .run(context)
        .expect("run desktop locale smoke");
}
