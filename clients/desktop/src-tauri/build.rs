mod locale_registry_build;

fn main() {
    println!("cargo:rerun-if-changed=../../../localization/locales.json");
    println!("cargo:rerun-if-changed=../../../scripts/localization-registry.mjs");
    println!("cargo:rerun-if-changed=locale_registry_build.rs");
    println!("cargo:rerun-if-env-changed=VITE_RSTORRENT_ENABLE_PREVIEW_LOCALES");
    let status = std::process::Command::new("node")
        .arg("../../../scripts/localization-registry.mjs")
        .status()
        .expect("Node is required to validate the shared locale registry");
    assert!(status.success(), "shared locale registry is invalid");
    let locale_manifest = serde_json::from_slice(
        &std::fs::read("../../../localization/locales.json").expect("read locale manifest"),
    )
    .expect("parse locale manifest");
    let (registry, catalogs) = locale_registry_build::generate(
        &locale_manifest,
        std::path::Path::new("../../.."),
        std::env::var("VITE_RSTORRENT_ENABLE_PREVIEW_LOCALES").is_ok_and(|value| value == "1"),
    )
    .expect("generate desktop locale registry");
    for path in catalogs {
        println!("cargo:rerun-if-changed={}", path.display());
    }
    std::fs::write(
        std::path::PathBuf::from(std::env::var_os("OUT_DIR").expect("build output directory"))
            .join("desktop_locale_registry.rs"),
        registry,
    )
    .expect("write desktop locale registry");
    println!("cargo:rerun-if-changed=../../../distribution/desktop-compatibility.json");
    println!("cargo:rerun-if-changed=../../../crates/rstorrent-session/src");
    println!("cargo:rerun-if-changed=../../../scripts/desktop-compatibility.mjs");
    println!("cargo:rerun-if-changed=../../../crates/rstorrent-session/src/product_state.rs");
    // A package may never carry stale database admission facts.
    let status = std::process::Command::new("node")
        .arg("../../../scripts/desktop-compatibility.mjs")
        .status()
        .expect("Node is required to verify release database compatibility");
    assert!(status.success(), "database compatibility metadata is stale");
    // Tauri deliberately strips NSIS packaging options from runtime Config.
    // Record only the prompt-free installer policy from the same merged input
    // the bundler consumes; never infer it from a stripped runtime default.
    let target = tauri_utils::platform::Target::from_triple(&std::env::var("TARGET").unwrap());
    let (mut config, _) =
        tauri_utils::config::parse::read_from(target, &std::env::current_dir().unwrap())
            .expect("read desktop packaging configuration");
    if let Ok(overrides) = std::env::var("TAURI_CONFIG") {
        json_patch::merge(
            &mut config,
            &serde_json::from_str(&overrides).expect("parse desktop overrides"),
        );
    }
    let config: tauri_utils::config::Config =
        serde_json::from_value(config).expect("validate desktop packaging configuration");
    let current_user = config.bundle.windows.nsis.unwrap_or_default().install_mode
        == tauri_utils::config::NSISInstallerMode::CurrentUser;
    println!("cargo:rustc-env=JSTORRENT_NSIS_CURRENT_USER={current_user}");
    // A copied updater helper is an ordinary user process, not an installer.
    // Explicit privileges prevent Windows' legacy installer heuristics from
    // treating its name/product description as an elevation request.
    println!("cargo:rerun-if-changed=windows-app-manifest.xml");
    tauri_build::try_build(
        tauri_build::Attributes::new().windows_attributes(
            tauri_build::WindowsAttributes::new()
                .app_manifest(include_str!("windows-app-manifest.xml")),
        ),
    )
    .expect("build desktop integration")
}
