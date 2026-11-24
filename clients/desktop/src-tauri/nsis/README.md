# Windows EXE installer

The production installer uses the Tauri CLI 2.11.4 [NSIS template][source]
under the accompanying [MIT license](LICENSE-MIT-tauri). The upstream
template SHA-256 is
`20f4ecc730defb71f1342eaeaec4021df13be3d843abba0effe88ea5835fa079`.
The 2.11.5 template has the same digest.

The override presents a dedicated page when the stock publisher and product
checks detect an MSI. It explains the required removal before the stock
installer asks for confirmation. The stock EXE maintenance options and the
stock MSI uninstall, cancellation, and error-handling code still apply.

When updating the Tauri CLI pin in `clients/web/package.json`, compare the
new upstream template against the old pin. Carry the small page change
forward and rerun the clean, EXE upgrade, and MSI replacement checks in
[Tactical 402](../../../../docs/tactical/402-desktop-extension-setup-recovery.md).

[source]: https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi
