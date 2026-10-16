fn main() {
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
