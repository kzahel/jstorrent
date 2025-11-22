use anyhow::{anyhow, Result};
use std::path::{Path, PathBuf};

/// Validates that the given path is safe to access within the configured root.
///
/// 1. Canonicalizes the root.
/// 2. Joins the path to the root (if relative) or uses it directly (if absolute).
/// 3. Canonicalizes the resulting path.
/// 4. Checks if the canonical path starts with the canonical root.
///
/// Returns the canonicalized absolute path if safe.
pub fn validate_path<P: AsRef<Path>, R: AsRef<Path>>(path: P, root: R) -> Result<PathBuf> {
    let root = root.as_ref();
    let path = path.as_ref();

    // Canonicalize root to resolve symlinks and get absolute path
    let canonical_root = root
        .canonicalize()
        .map_err(|e| anyhow!("Invalid root path: {}", e))?;

    // If path is absolute, check if it's under root.
    // If relative, join with root.
    // Note: The design doc says "All paths must be absolute", but we should handle both or enforce absolute.
    // The design doc says: "Host must validate paths against a configured download root".
    // It also says "All paths must be absolute".
    // Let's assume the input path is absolute as per spec, but if it's not, we treat it as relative to root?
    // "All paths must be absolute" implies the caller sends absolute paths.
    // However, `join` handles absolute paths by replacing the base.
    // So `root.join(path)` where `path` is absolute returns `path`.
    // But we want to support the case where `path` might be a symlink or contain `..`.

    // We construct the target path.
    // If `path` is absolute, `root.join(path)` returns `path`.
    // If `path` is relative, it joins.
    // But wait, if `path` is absolute, we just want to check it.
    let target_path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        // If we strictly require absolute paths, we should error here.
        // But for robustness, let's allow relative paths if they stay in root.
        root.join(path)
    };

    // Canonicalize the target path.
    // This will fail if the path does not exist.
    // For "ensureDir" or "writeFile" (new file), the path might not exist yet.
    // If the path doesn't exist, we can't canonicalize it fully.
    // We should canonicalize the parent directory.

    // Strategy:
    // 1. Try to canonicalize the full path.
    // 2. If it fails (doesn't exist), pop components until we find an existing directory.
    // 3. Canonicalize that existing directory.
    // 4. Check if it's within root.
    // 5. Append the remaining components and check for `..` (lexical check).

    // However, `canonicalize` resolves symlinks.
    // If the file doesn't exist, we can't resolve symlinks in the non-existent part.
    // But we can ensure the parent exists and is safe.

    // For existing files:
    if target_path.exists() {
        let canonical_target = target_path
            .canonicalize()
            .map_err(|e| anyhow!("Failed to resolve path: {}", e))?;
        
        if canonical_target.starts_with(&canonical_root) {
            Ok(canonical_target)
        } else {
            Err(anyhow!("Path escape detected: {:?}", path))
        }
    } else {
        // For non-existing files (e.g. creating a new file):
        // We must ensure the parent directory is safe.
        let parent = target_path
            .parent()
            .ok_or_else(|| anyhow!("Path has no parent"))?;
        
        // If parent doesn't exist, we can't verify safety fully (unless we recursively check).
        // But `ensureDir` might create parents.
        // If we are writing a file, the parent MUST exist (usually).
        // If `ensureDir`, we might be creating deep structure.
        
        // Let's rely on `canonicalize` for the longest existing prefix.
        // Or simpler: require that the parent exists for file operations?
        // The design doesn't specify.
        
        // Let's try to canonicalize the parent.
        if parent.exists() {
             let canonical_parent = parent
                .canonicalize()
                .map_err(|e| anyhow!("Failed to resolve parent path: {}", e))?;
            
            if !canonical_parent.starts_with(&canonical_root) {
                 return Err(anyhow!("Path escape detected in parent: {:?}", parent));
            }
            
            // Now we have a safe parent. The filename itself shouldn't be `..`.
            // `PathBuf` normalization handles `..` if we use `components()`.
            // But since we are constructing `target_path` from `path` (which is absolute),
            // and we checked the parent...
            
            // One edge case: `path` is `/safe/root/symlink_to_unsafe/file`.
            // If `symlink_to_unsafe` exists and points outside, `canonicalize(parent)` would catch it.
            // So checking the parent is sufficient for the directory part.
            
            // We just need to return the absolute path with the canonical parent.
            // But wait, if we return a path, we want it to be the one we use.
            // `canonical_parent.join(filename)`
            
            let file_name = target_path.file_name().ok_or_else(|| anyhow!("Invalid filename"))?;
            Ok(canonical_parent.join(file_name))
        } else {
            // Parent doesn't exist.
            // If we are doing `ensureDir`, we might be creating it.
            // We need to check if the path *would* be safe.
            // This is hard without full canonicalization.
            // For now, let's error if parent doesn't exist, unless it's `ensureDir`?
            // But `validate_path` is generic.
            
            // Let's do a lexical check for the non-existing part?
            // Or just fail.
            // Most operations (writeFile) require parent to exist or we fail anyway.
            // `ensureDir` is the exception.
            
            // For `ensureDir`, we might iterate up until we find an existing dir.
            // Then check if that existing dir is safe.
            // And ensure the remaining path doesn't contain `..` or symlinks (which we can't check if they don't exist, but if they don't exist they aren't symlinks yet).
            
            // Let's implement a loop to find the first existing ancestor.
            let mut current = target_path.clone();
            let mut components_to_append = Vec::new();
            
            while !current.exists() {
                if let Some(name) = current.file_name() {
                    components_to_append.push(name.to_os_string());
                    if let Some(p) = current.parent() {
                        current = p.to_path_buf();
                    } else {
                        break; // Hit root and it doesn't exist? Unlikely.
                    }
                } else {
                    break;
                }
            }
            
            // Now `current` exists (or should).
            let canonical_base = current.canonicalize().map_err(|e| anyhow!("Failed to resolve base path: {}", e))?;
            
            if !canonical_base.starts_with(&canonical_root) {
                return Err(anyhow!("Path escape detected in base: {:?}", current));
            }
            
            // Reconstruct path
            let mut safe_path = canonical_base;
            for component in components_to_append.into_iter().rev() {
                safe_path.push(component);
            }
            
            // Final check: ensure no `..` in the reconstructed path (lexical).
            // Since we built it from `canonical_base` + components, it should be fine unless components contain `..`.
            // `file_name()` shouldn't return `..`.
            
            Ok(safe_path)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_validate_path_safe() {
        let temp = TempDir::new().unwrap();
        let root = temp.path().canonicalize().unwrap();
        let file_path = root.join("safe.txt");
        
        // Create file so it exists for canonicalization
        fs::write(&file_path, "test").unwrap();

        let result = validate_path(&file_path, &root);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), file_path);
    }

    #[test]
    fn test_validate_path_escape() {
        let temp = TempDir::new().unwrap();
        let root = temp.path().canonicalize().unwrap();
        
        // We can't easily create a file outside temp without messing up system, 
        // but we can try to access root parent.
        let parent = root.parent().unwrap();
        
        let result = validate_path(parent, &root);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_path_traversal() {
        let temp = TempDir::new().unwrap();
        let root = temp.path().canonicalize().unwrap();
        let file_path = root.join("safe.txt");
        fs::write(&file_path, "test").unwrap();
        
        // Construct path with ..
        let subdir = root.join("subdir");
        fs::create_dir(&subdir).unwrap();
        let traversal = subdir.join("..").join("safe.txt");
        // subdir doesn't exist, so validate_path logic for non-existing might trigger if we didn't create file.
        // But here file exists.
        
        let result = validate_path(&traversal, &root);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), file_path);
    }
}
