//! File opener utilities for opening files and revealing them in file managers.
//!
//! Uses direct system commands for better error handling.

use std::path::Path;
use std::process::Command;

/// Open a file with the system's default application.
pub fn open_file(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let output = Command::new("xdg-open")
            .arg(path)
            .output()
            .map_err(|e| format!("Failed to run xdg-open: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!(
                "xdg-open failed (exit code {:?}): {}",
                output.status.code(),
                stderr.trim()
            ));
        }
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        let output = Command::new("open")
            .arg(path)
            .output()
            .map_err(|e| format!("Failed to run open: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("open failed: {}", stderr.trim()));
        }
        Ok(())
    }

    #[cfg(target_os = "windows")]
    {
        let output = Command::new("cmd")
            .args(["/C", "start", ""])
            .arg(path)
            .output()
            .map_err(|e| format!("Failed to run start: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("start failed: {}", stderr.trim()));
        }
        Ok(())
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        Err("Open file not supported on this platform".to_string())
    }
}

/// Reveal a file in the system file manager.
///
/// - macOS: Opens Finder with the file selected
/// - Windows: Opens Explorer with the file selected
/// - Linux: Opens the containing folder (cannot select file)
pub fn reveal_in_folder(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("open")
            .arg("-R")
            .arg(path)
            .output()
            .map_err(|e| format!("Failed to run open -R: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("open -R failed: {}", stderr.trim()));
        }
        Ok(())
    }

    #[cfg(target_os = "windows")]
    {
        // Windows explorer /select requires comma-separated path
        let output = Command::new("explorer")
            .arg(format!("/select,{}", path.display()))
            .output()
            .map_err(|e| format!("Failed to run explorer: {}", e))?;

        // Explorer returns non-zero even on success sometimes, so just check if it ran
        if output.status.code() == Some(1) {
            // Exit code 1 usually means success for explorer /select
            return Ok(());
        }
        Ok(())
    }

    #[cfg(target_os = "linux")]
    {
        // Linux file managers don't have a standard way to select a file,
        // so we open the parent directory instead
        let parent = path.parent().unwrap_or(path);

        let output = Command::new("xdg-open")
            .arg(parent)
            .output()
            .map_err(|e| format!("Failed to run xdg-open: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!(
                "xdg-open failed (exit code {:?}): {}",
                output.status.code(),
                stderr.trim()
            ));
        }
        Ok(())
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        Err("Reveal in folder not supported on this platform".to_string())
    }
}
