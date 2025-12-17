fn main() {
    #[cfg(windows)]
    {
        let mut res = winres::WindowsResource::new();
        res.set_icon("installers/windows/assets/icon.ico");
        res.compile().unwrap();
    }
}
