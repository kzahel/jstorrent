fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    // The NDK's own build systems always link a GNU build ID; Cargo does not.
    // Crash symbolication (Play, ndk-stack) uses it to pair a stripped library
    // with its symbol file exactly, instead of by file name alone.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        println!("cargo:rustc-cdylib-link-arg=-Wl,--build-id=sha1");
    }
}
