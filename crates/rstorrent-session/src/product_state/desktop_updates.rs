//! Durable desktop update intent. No platform or installer dependencies.
use super::{ProductStateError, ProductStateOwner, ProductStateStore, validate_version};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, schemars::JsonSchema, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct DesktopUpdateAttempt {
    pub version: String,
    pub succeeded: bool,
    pub message: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopUpdateState {
    pub automatic_install: bool,
    pub attempt: Option<DesktopUpdateAttempt>,
}

impl ProductStateOwner {
    pub fn desktop_update_state(&self) -> Result<DesktopUpdateState, ProductStateError> {
        self.store()?.desktop_update_state()
    }

    pub fn set_desktop_automatic_updates(&self, enabled: bool) -> Result<(), ProductStateError> {
        self.store()?.set_desktop_automatic_updates(enabled)
    }

    pub fn record_desktop_update_attempt(
        &self,
        attempt: &DesktopUpdateAttempt,
    ) -> Result<(), ProductStateError> {
        self.store()?.record_desktop_update_attempt(attempt)
    }
    pub fn cancel_desktop_update_attempt(&self) -> Result<(), ProductStateError> {
        self.store()?.connection.execute(
            "UPDATE desktop_update_state SET attempt = NULL WHERE singleton = 1",
            [],
        )?;
        Ok(())
    }

    /// New OS intake received after update commitment survives the process gap.
    pub fn defer_desktop_update_intake(&self, values: &[String]) -> Result<(), ProductStateError> {
        self.store()?.defer_desktop_update_intake(values)
    }
    pub fn take_desktop_update_intake(&self) -> Result<Vec<String>, ProductStateError> {
        self.store()?.take_desktop_update_intake()
    }
}

impl ProductStateStore {
    pub fn desktop_update_state(&self) -> Result<DesktopUpdateState, ProductStateError> {
        let (automatic_install, attempt): (bool, Option<String>) = self.connection.query_row(
            "SELECT automatic_install, attempt FROM desktop_update_state WHERE singleton = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let attempt = attempt
            .map(|value| {
                serde_json::from_str(&value).map_err(|error| {
                    ProductStateError::InvalidState(format!("desktop update attempt: {error}"))
                })
            })
            .transpose()?;
        Ok(DesktopUpdateState {
            automatic_install,
            attempt,
        })
    }

    pub fn set_desktop_automatic_updates(&self, enabled: bool) -> Result<(), ProductStateError> {
        self.connection.execute(
            "UPDATE desktop_update_state SET automatic_install = ?1 WHERE singleton = 1",
            [enabled],
        )?;
        Ok(())
    }

    pub fn record_desktop_update_attempt(
        &self,
        attempt: &DesktopUpdateAttempt,
    ) -> Result<(), ProductStateError> {
        validate_version(&attempt.version)?;
        if attempt.message.len() > 1024 {
            return Err(ProductStateError::InvalidState(
                "desktop update outcome exceeds its byte limit".into(),
            ));
        }
        let encoded = serde_json::to_string(attempt)
            .map_err(|error| ProductStateError::InvalidState(error.to_string()))?;
        if encoded.len() > 8192 {
            return Err(ProductStateError::InvalidState(
                "desktop update attempt exceeds its byte limit".into(),
            ));
        }
        self.connection.execute(
            "UPDATE desktop_update_state SET attempt = ?1 WHERE singleton = 1",
            [encoded],
        )?;
        Ok(())
    }
    fn defer_desktop_update_intake(&self, values: &[String]) -> Result<(), ProductStateError> {
        let transaction = self.connection.unchecked_transaction()?;
        let encoded: String = transaction.query_row(
            "SELECT deferred_intake FROM desktop_update_state WHERE singleton = 1",
            [],
            |row| row.get(0),
        )?;
        let mut pending: Vec<String> = serde_json::from_str(&encoded)
            .map_err(|error| ProductStateError::InvalidState(error.to_string()))?;
        for value in values {
            if value.len() > 65_536 || pending.len() >= 8 {
                return Err(ProductStateError::InvalidState(
                    "Deferred update intake exceeds its limit".into(),
                ));
            }
            if !pending.contains(value) {
                pending.push(value.clone());
            }
        }
        let encoded = serde_json::to_string(&pending)
            .map_err(|error| ProductStateError::InvalidState(error.to_string()))?;
        if encoded.len() > 524_288 {
            return Err(ProductStateError::InvalidState(
                "Deferred update intake exceeds its byte limit".into(),
            ));
        }
        transaction.execute(
            "UPDATE desktop_update_state SET deferred_intake = ?1 WHERE singleton = 1",
            [encoded],
        )?;
        transaction.commit()?;
        Ok(())
    }
    fn take_desktop_update_intake(&self) -> Result<Vec<String>, ProductStateError> {
        let transaction = self.connection.unchecked_transaction()?;
        let encoded: String = transaction.query_row(
            "SELECT deferred_intake FROM desktop_update_state WHERE singleton = 1",
            [],
            |row| row.get(0),
        )?;
        let pending = serde_json::from_str(&encoded)
            .map_err(|error| ProductStateError::InvalidState(error.to_string()))?;
        transaction.execute(
            "UPDATE desktop_update_state SET deferred_intake = '[]' WHERE singleton = 1",
            [],
        )?;
        transaction.commit()?;
        Ok(pending)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opt_out_and_attempt_survive_reopen_and_unrelated_shell_writes() {
        let root = tempfile::tempdir().unwrap();
        let store = ProductStateOwner::open(root.path(), "0.3.1", None).unwrap();
        assert!(store.desktop_update_state().unwrap().automatic_install);
        store.set_desktop_automatic_updates(false).unwrap();
        let attempt = DesktopUpdateAttempt {
            version: "0.3.2".into(),
            succeeded: false,
            message: "Installation did not complete".into(),
        };
        store.record_desktop_update_attempt(&attempt).unwrap();
        drop(store);
        let store = ProductStateOwner::open(root.path(), "0.3.2", None).unwrap();
        assert_eq!(
            store.desktop_update_state().unwrap(),
            DesktopUpdateState {
                automatic_install: false,
                attempt: Some(attempt)
            }
        );
    }

    #[test]
    fn handoff_intake_is_bounded_and_consumed_once_after_reopen() {
        let root = tempfile::tempdir().unwrap();
        let store = ProductStateOwner::open(root.path(), "0.3.1", None).unwrap();
        store
            .defer_desktop_update_intake(&["magnet:?xt=new".into()])
            .unwrap();
        assert!(
            store
                .defer_desktop_update_intake(&["x".repeat(65_537)])
                .is_err()
        );
        drop(store);
        let store = ProductStateOwner::open(root.path(), "0.3.2", None).unwrap();
        assert_eq!(
            store.take_desktop_update_intake().unwrap(),
            vec!["magnet:?xt=new"]
        );
        assert!(store.take_desktop_update_intake().unwrap().is_empty());
    }

    #[test]
    fn invalid_attempt_does_not_replace_previous_result() {
        let store = ProductStateOwner::open_ephemeral("0.3.1").unwrap();
        assert!(
            store
                .record_desktop_update_attempt(&DesktopUpdateAttempt {
                    version: "x".repeat(129),
                    succeeded: false,
                    message: String::new()
                })
                .is_err()
        );
        assert!(store.desktop_update_state().unwrap().attempt.is_none());
    }
}
