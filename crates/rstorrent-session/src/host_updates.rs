//! Application-level update control. Platform adapters own downloads/installers.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum HostUpdateRequest {
    Status,
    Check,
    Install,
    SelectChannel { channel: String },
    SetAutomatic { enabled: bool },
    Activity { interacted: bool, blocked: bool },
    Snooze,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
pub struct HostUpdateSnapshot {
    pub phase: String,
    pub version: Option<String>,
    pub notes: Option<String>,
    pub message: Option<String>,
    #[serde(default)]
    pub last_outcome: Option<crate::DesktopUpdateAttempt>,
    pub downloaded_bytes: u32,
    pub total_bytes: Option<u32>,
    pub restart_in_seconds: Option<u32>,
    pub automatic_install: bool,
    #[serde(default)]
    pub automatic_available: bool,
    pub channel: String,
    pub can_install: bool,
    pub package: String,
}

/// Calls are bounded and synchronous; work is queued to the platform owner.
/// This lets a transport dispatch control while holding the application lock,
/// without waiting for an updater that needs that same lock during shutdown.
pub trait HostUpdateControl: Send + Sync + std::fmt::Debug {
    fn request(
        &self,
        owner: &str,
        request: HostUpdateRequest,
    ) -> Result<HostUpdateSnapshot, String>;
    fn connected(&self, owner: &str);
    fn disconnected(&self, owner: &str);
    fn interacted(&self);
    fn committed(&self) -> bool;
}
