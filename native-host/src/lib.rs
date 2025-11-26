use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct UnifiedRpcInfo {
    pub version: u32,
    pub profiles: Vec<ProfileEntry>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ProfileEntry {
    // Removed profile_dir as requested
    pub extension_id: Option<String>,
    pub install_id: Option<String>,
    pub salt: String,
    pub pid: u32,
    pub port: u16,
    pub token: String,
    pub started: u64,
    pub last_used: u64,
    pub browser: BrowserInfo,
    pub download_roots: Vec<DownloadRoot>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DownloadRoot {
    pub token: String,
    pub path: String,
    pub display_name: String,
    pub removable: bool,
    pub last_stat_ok: bool,
    pub last_checked: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BrowserInfo {
    pub name: String,
    pub binary: String,
    // Removed profile_id and profile_path as requested
    pub extension_id: Option<String>,
}

pub fn get_config_dir() -> Option<PathBuf> {
    // Check environment variable first for testing
    if let Ok(env_dir) = std::env::var("JSTORRENT_CONFIG_DIR") {
        return Some(PathBuf::from(env_dir));
    }
    
    // Fallback to standard config dir
    dirs::config_dir()
}
