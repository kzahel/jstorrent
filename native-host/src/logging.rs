use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use lazy_static::lazy_static;

lazy_static! {
    static ref LOG_FILE: Mutex<Option<std::fs::File>> = Mutex::new(None);
}

pub fn init(filename: &str) {
    // 1. Check ~/.config/jstorrent-native/jstorrent-native.env
    if let Some(config_dir) = dirs::config_dir() {
        let env_path = config_dir.join("jstorrent-native").join("jstorrent-native.env");
        if check_and_init_log(&env_path, filename) {
            return;
        }
    }

    // 2. Fallback to executable directory
    if let Some(exe_path) = std::env::current_exe().ok() {
        if let Some(dir) = exe_path.parent() {
            let env_path = dir.join("jstorrent-native.env");
            check_and_init_log(&env_path, filename);
        }
    }
}

fn check_and_init_log(env_path: &PathBuf, filename: &str) -> bool {
    if env_path.exists() {
        if let Ok(content) = std::fs::read_to_string(env_path) {
            for line in content.lines() {
                if line.trim() == "LOGFILE=true" {
                    // Log file goes next to the env file or executable?
                    // User said: "logs should be written to ... in the same directory as the executable"
                    // But if we use config dir, maybe we should log there?
                    // The requirement was "same directory as the executable".
                    // Let's stick to that for now, OR log next to the env file if found there?
                    // If I put launcher.env in .config, I probably want logs there too or in .local/state?
                    // The user said: "If that whole folder gets removed upon uninstall, does that mean we should move it to the .config folder instead"
                    // implying they want persistence.
                    // However, the original requirement was "same directory as the executable".
                    // Let's keep the log file in the executable directory for now to satisfy the original requirement,
                    // UNLESS the user explicitly asked to move logs. They only asked to move launcher.env lookup.
                    // Wait, if I use config dir for env, I might not have write access to exe dir if installed in /usr/lib (though here it is ~/.local/lib).
                    // Let's assume logs should go to the same dir as the executable for now, as originally requested.
                    
                    let log_dir = if let Some(exe_path) = std::env::current_exe().ok() {
                        exe_path.parent().map(|p| p.to_path_buf())
                    } else {
                        None
                    };

                    if let Some(dir) = log_dir {
                        let log_path = dir.join(filename);
                        if let Ok(file) = OpenOptions::new()
                            .create(true)
                            .append(true)
                            .open(&log_path) 
                        {
                            *LOG_FILE.lock().unwrap() = Some(file);
                            log("Logger initialized");
                            return true;
                        }
                    }
                }
            }
        }
    }
    false
}

pub fn log(msg: &str) {
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let formatted_msg = format!("[{}] {}\n", timestamp, msg);

    // Always print to stderr (for terminal visibility)
    eprint!("{}", formatted_msg);

    // Write to log file if enabled
    if let Ok(mut file_guard) = LOG_FILE.lock() {
        if let Some(file) = file_guard.as_mut() {
            let _ = file.write_all(formatted_msg.as_bytes());
        }
    }
}

#[macro_export]
macro_rules! log {
    ($($arg:tt)*) => {
        $crate::logging::log(&format!($($arg)*));
    }
}
