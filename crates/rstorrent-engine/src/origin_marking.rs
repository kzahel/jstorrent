//! Native internet-origin labels. These neither verify content nor replace
//! file-selection policy. Existing labels are preserved, never weakened.

#[cfg(target_os = "macos")]
pub(crate) fn mark(file: &std::fs::File, _path: &std::path::Path) -> std::io::Result<()> {
    use rustix::fs::{XattrFlags, fsetxattr};
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(std::io::Error::other)?
        .as_secs();
    let value = format!("0081;{seconds:x};JSTorrent;");
    match fsetxattr(
        file,
        c"com.apple.quarantine",
        value.as_bytes(),
        XattrFlags::CREATE,
    ) {
        Ok(()) | Err(rustix::io::Errno::EXIST) => Ok(()),
        Err(error) => Err(error.into()),
    }
}

#[cfg(windows)]
pub(crate) fn mark(file: &std::fs::File, path: &std::path::Path) -> std::io::Result<()> {
    mark_windows(file, path)
}

#[cfg(any(windows, test))]
fn mark_windows(file: &std::fs::File, path: &std::path::Path) -> std::io::Result<()> {
    use std::io::{Read, Seek, Write};
    if !file.metadata()?.is_file() || !std::fs::symlink_metadata(path)?.is_file() {
        return Err(std::io::Error::other(
            "download label requires an existing regular file",
        ));
    }
    let mut stream = path.as_os_str().to_os_string();
    stream.push(":Zone.Identifier");
    let mut stream = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(stream)?;
    let mut previous = String::new();
    (&mut stream).take(8193).read_to_string(&mut previous)?;
    if previous.len() > 8192 {
        return Err(std::io::Error::other(
            "existing download label exceeds the supported bound",
        ));
    }
    // Preserve Internet/Restricted labels and their provenance. Repair a
    // partial earlier write, and upgrade a local zone when receiving new data.
    if previous
        .lines()
        .any(|line| matches!(line.trim(), "ZoneId=3" | "ZoneId=4"))
    {
        return Ok(());
    }
    let mut label = String::from("[ZoneTransfer]\r\nZoneId=3\r\n");
    for line in previous.lines() {
        if line.trim() != "[ZoneTransfer]" && !line.trim().starts_with("ZoneId=") {
            label.push_str(line);
            label.push_str("\r\n");
        }
    }
    stream.rewind()?;
    stream.write_all(label.as_bytes())?;
    stream.set_len(label.len() as u64)?;
    stream.sync_data()
}

#[cfg(test)]
mod windows_stream_tests {
    use super::*;
    #[test]
    fn internet_zone_preserves_payload_and_existing_stronger_provenance() {
        let root = std::env::temp_dir().join(format!(
            "jst-origin-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("payload.bin");
        std::fs::write(&path, b"payload").unwrap();
        let file = std::fs::File::open(&path).unwrap();
        mark_windows(&file, &path).unwrap();
        let stream = root.join("payload.bin:Zone.Identifier");
        assert_eq!(
            std::fs::read_to_string(&stream).unwrap(),
            "[ZoneTransfer]\r\nZoneId=3\r\n"
        );
        let stronger = "[ZoneTransfer]\r\nZoneId=4\r\nHostUrl=https://example.invalid/download\r\n";
        std::fs::write(&stream, stronger).unwrap();
        mark_windows(&file, &path).unwrap();
        assert_eq!(std::fs::read_to_string(&stream).unwrap(), stronger);
        std::fs::write(&stream, "[ZoneTransfer]\r\nZo").unwrap();
        mark_windows(&file, &path).unwrap();
        assert!(
            std::fs::read_to_string(&stream)
                .unwrap()
                .contains("ZoneId=3")
        );
        assert_eq!(std::fs::read(&path).unwrap(), b"payload");
        drop(file);
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
pub(crate) fn mark(_file: &std::fs::File, _path: &std::path::Path) -> std::io::Result<()> {
    Ok(())
}

/// Quarantine application bundles as well as their files. The storage owner
/// supplies the content boundary so a user's enclosing download directory is
/// never relabeled, even when that directory happens to end in .app.
#[cfg(target_os = "macos")]
pub(crate) fn mark_containers(
    path: &std::path::Path,
    boundary: Option<usize>,
) -> std::io::Result<()> {
    use rustix::fs::{Mode, OFlags, open};
    let Some(boundary) = boundary else {
        return Ok(());
    };
    let depth = path.components().count();
    for (offset, parent) in path.ancestors().skip(1).enumerate() {
        if depth.saturating_sub(offset + 1) < boundary {
            break;
        }
        if parent
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("app"))
        {
            let descriptor = open(
                parent,
                OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW,
                Mode::empty(),
            )?;
            mark(&std::fs::File::from(descriptor), parent)?;
        }
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn mark_containers(
    _path: &std::path::Path,
    _boundary: Option<usize>,
) -> std::io::Result<()> {
    Ok(())
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    fn label(file: &std::fs::File) -> Vec<u8> {
        let mut bytes = vec![0; 256];
        let length =
            rustix::fs::fgetxattr(file, c"com.apple.quarantine", bytes.as_mut_slice()).unwrap();
        bytes.truncate(length);
        bytes
    }

    #[test]
    fn bundle_marking_stays_within_downloaded_content() {
        let root = std::env::temp_dir().join(format!("jst-bundle-{}.app", std::process::id()));
        let bundle = root.join("Player.app");
        let path = bundle.join("Contents/MacOS/player");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, b"payload").unwrap();
        mark_containers(&path, Some(bundle.components().count())).unwrap();
        assert!(label(&std::fs::File::open(&bundle).unwrap()).starts_with(b"0081;"));
        let mut bytes = [0; 256];
        assert!(
            rustix::fs::fgetxattr(
                std::fs::File::open(&root).unwrap(),
                c"com.apple.quarantine",
                &mut bytes[..]
            )
            .is_err()
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn descriptor_label_is_idempotent_and_does_not_change_payload() {
        let root = std::env::temp_dir().join(format!("jst-origin-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("payload.bin");
        std::fs::write(&path, b"payload").unwrap();
        let file = std::fs::File::open(&path).unwrap();
        mark(&file, &path).unwrap();
        let label = label(&file);
        assert!(label.starts_with(b"0081;"));
        mark(&file, &path).unwrap();
        assert_eq!(self::label(&file), label);
        assert_eq!(std::fs::read(&path).unwrap(), b"payload");
        std::fs::remove_dir_all(root).unwrap();
    }
}
