fn main() {
    #[cfg(windows)]
    {
        let mut res = winres::WindowsResource::new();
        res.set_icon("../installers/windows/assets/icon.ico");
        res.set("ProductName", "JSTorrent Native Host");
        res.set("FileDescription", "JSTorrent Native Host");
        res.set("CompanyName", "JSTorrent");
        res.set("LegalCopyright", "JSTorrent");
        res.compile().unwrap();
    }
}
