fn main() {
    #[cfg(windows)]
    {
        // Only compile resources when building a binary, not when used as a library dependency
        // This prevents duplicate resources when io-daemon depends on jstorrent_common
        if std::env::var("CARGO_BIN_NAME").is_ok() {
            let mut res = winres::WindowsResource::new();
            res.set_icon("installers/windows/assets/icon.ico");
            res.set("ProductName", "JSTorrent");
            res.set("FileDescription", "JSTorrent");
            res.set("CompanyName", "JSTorrent");
            res.set("LegalCopyright", "JSTorrent");
            res.compile().unwrap();
        }
    }
}
