//! Durable eligibility and exact registration ownership for incoming seeding.

use std::error::Error;
use std::fmt;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use rstorrent_engine::{
    ByteMetricSink, CompletedStorageEvidence, ContentShape, FastResumeValidation,
    IncomingPeerError, IncomingPeerHandle, PlatformStorageFailureKind, PlatformStorageSpec,
    ResumeAdmissionOutcome, ResumeValidationIntent, ResumeValidationRejectReason, SeedContent,
    SeedContentError, SeedRegistration, SeedRegistrationToken, SelectiveStorageError,
    StorageFilePool, StorageFilePoolError, TorrentArtifactIdentity, TorrentPeerHandle,
    decide_resume_admission, validate_direct_completed_content_with_path,
    validate_direct_completed_content_with_platform,
};
use rstorrent_protocol::content::{TorrentContent, TorrentContentProjection};
use rstorrent_protocol::metainfo::{DURABLE_METAINFO_LIMITS, Metainfo, MetainfoError};

use crate::control::TorrentState;
use crate::store::{ResumeRecord, StorageRootLocation};

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum SeedReconcileOutcome {
    Registered {
        validation: FastResumeValidation,
        elapsed_millis: u64,
    },
    AlreadyRegistered,
    Unregistered,
    Ineligible(&'static str),
    NeedsFullCheck {
        reason: ResumeValidationRejectReason,
        validation: FastResumeValidation,
        elapsed_millis: u64,
    },
    AwaitingStorage(String),
    NeedsRepair(String),
    Unavailable(String),
}

#[derive(Clone, Debug)]
pub(crate) struct SeedReconcileResult {
    pub(crate) outcome: SeedReconcileOutcome,
    pub(crate) tokens: Vec<SeedRegistrationToken>,
}

pub(crate) struct SeedReconcileInput<'a> {
    pub(crate) resume: &'a ResumeRecord,
    pub(crate) catalog_eligible: bool,
    pub(crate) root: Option<&'a StorageRootLocation>,
    pub(crate) active_download: bool,
    pub(crate) current: Vec<SeedRegistrationToken>,
    pub(crate) torrent_peers: TorrentPeerHandle,
    pub(crate) byte_metric_sink: Arc<dyn ByteMetricSink>,
    pub(crate) storage_file_pool: &'a StorageFilePool,
    pub(crate) completed_storage: Option<CompletedStorageEvidence>,
}

#[derive(Clone, Debug)]
pub(crate) struct IncomingSeeding {
    handle: IncomingPeerHandle,
    enabled: Arc<AtomicBool>,
}

impl IncomingSeeding {
    pub(crate) fn new(handle: IncomingPeerHandle) -> Self {
        Self {
            handle,
            enabled: Arc::new(AtomicBool::new(true)),
        }
    }

    pub(crate) async fn reconcile(
        &self,
        input: SeedReconcileInput<'_>,
    ) -> Result<SeedReconcileResult, IncomingSeedingError> {
        let SeedReconcileInput {
            resume,
            catalog_eligible,
            root,
            active_download,
            current,
            torrent_peers,
            byte_metric_sink,
            storage_file_pool,
            completed_storage,
        } = input;
        if !self.enabled.load(Ordering::Acquire) {
            return Ok(SeedReconcileResult {
                outcome: SeedReconcileOutcome::Ineligible("incoming peer service is stopping"),
                tokens: current,
            });
        }
        let ineligible = eligibility_reason(resume, catalog_eligible, root, active_download);
        if let Some(reason) = ineligible {
            let removed = self.unregister_all(current).await? != 0;
            return Ok(SeedReconcileResult {
                outcome: if removed {
                    SeedReconcileOutcome::Unregistered
                } else {
                    SeedReconcileOutcome::Ineligible(reason)
                },
                tokens: Vec::new(),
            });
        }
        if !current.is_empty()
            && current
                .iter()
                .all(|token| self.handle.registration_is_current(*token))
        {
            return Ok(SeedReconcileResult {
                outcome: SeedReconcileOutcome::AlreadyRegistered,
                tokens: current,
            });
        }
        self.unregister_all(current).await?;
        let raw_info = resume
            .raw_info
            .as_ref()
            .expect("eligible seed has verified metadata");
        let content = match parse_resume_content(resume) {
            Ok(content) => Arc::new(content),
            Err(error) => {
                return Ok(SeedReconcileResult {
                    outcome: SeedReconcileOutcome::Unavailable(error.to_string()),
                    tokens: Vec::new(),
                });
            }
        };
        if resume.info_hashes != content.info_hashes() {
            return Ok(SeedReconcileResult {
                outcome: SeedReconcileOutcome::Unavailable(
                    "stored metadata does not match torrent identity".to_owned(),
                ),
                tokens: Vec::new(),
            });
        }
        let have = resume
            .have
            .as_ref()
            .expect("eligible seed has durable have state");
        if have.pieces().len() != content.piece_count() {
            return Ok(SeedReconcileResult {
                outcome: SeedReconcileOutcome::Unavailable(
                    "durable have length does not match verified metadata".to_owned(),
                ),
                tokens: Vec::new(),
            });
        }
        let artifact_identity = TorrentArtifactIdentity {
            torrent_id: resume.torrent_id,
            content_fingerprint: have.content_fingerprint(),
        };
        let skipped = resume
            .skip_files
            .iter()
            .map(|index| {
                usize::try_from(*index).map_err(|_| {
                    IncomingSeedingError::InvalidDurableState(
                        "file selection index overflow".to_owned(),
                    )
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        storage_file_pool.invalidate_storage(&resume.torrent_id.to_string());
        let root = root.expect("eligible seed has a configured root");
        let validation_started = Instant::now();
        let validation = match root {
            StorageRootLocation::Path(root) => {
                validate_direct_completed_content_with_path(
                    root,
                    artifact_identity,
                    content.clone(),
                    have.pieces(),
                    &skipped,
                    storage_file_pool.clone(),
                    completed_storage.as_ref(),
                )
                .await
            }
            StorageRootLocation::PlatformCapability => {
                validate_direct_completed_content_with_platform(
                    platform_spec(resume, &content, storage_file_pool),
                    artifact_identity,
                    content.clone(),
                    have.pieces(),
                    &skipped,
                    completed_storage.as_ref(),
                )
                .await
            }
        };
        let validation = match validation {
            Ok(validation) => validation,
            Err(error) => {
                return Ok(SeedReconcileResult {
                    outcome: classify_validation_error(error),
                    tokens: Vec::new(),
                });
            }
        };
        let elapsed_millis =
            u64::try_from(validation_started.elapsed().as_millis()).unwrap_or(u64::MAX);
        match decide_resume_admission(ResumeValidationIntent::FastEligible, validation.evidence) {
            ResumeAdmissionOutcome::Accepted => {}
            ResumeAdmissionOutcome::NeedsFullCheck(reason) => {
                return Ok(SeedReconcileResult {
                    outcome: SeedReconcileOutcome::NeedsFullCheck {
                        reason,
                        validation,
                        elapsed_millis,
                    },
                    tokens: Vec::new(),
                });
            }
            ResumeAdmissionOutcome::AwaitingStorage => {
                return Ok(SeedReconcileResult {
                    outcome: SeedReconcileOutcome::AwaitingStorage(
                        "direct storage is unavailable".to_owned(),
                    ),
                    tokens: Vec::new(),
                });
            }
            ResumeAdmissionOutcome::NeedsRepair => {
                return Ok(SeedReconcileResult {
                    outcome: SeedReconcileOutcome::NeedsRepair(
                        "direct storage structure needs repair".to_owned(),
                    ),
                    tokens: Vec::new(),
                });
            }
        }
        let opened = match root {
            StorageRootLocation::Path(root) => {
                SeedContent::open_completed_content_with_pool(
                    root,
                    resume.torrent_id,
                    &content,
                    have.pieces(),
                    &skipped,
                    storage_file_pool.clone(),
                    completed_storage.as_ref(),
                )
                .await
            }
            StorageRootLocation::PlatformCapability => {
                SeedContent::open_completed_content_with_platform(
                    &platform_spec(resume, &content, storage_file_pool),
                    &content,
                    have.pieces(),
                    &skipped,
                    completed_storage.as_ref(),
                )
                .await
            }
        };
        let seed_content = match opened {
            Ok(content) => content,
            Err(error) => {
                return Ok(SeedReconcileResult {
                    outcome: classify_seed_open_error(error),
                    tokens: Vec::new(),
                });
            }
        };
        let registrations = content
            .swarm_keys()
            .map(|swarm_key| {
                SeedRegistration::new_with_swarm_key(
                    raw_info.clone(),
                    swarm_key,
                    seed_content.clone(),
                    torrent_peers.clone(),
                )
                .map(|registration| registration.with_byte_metric_sink(byte_metric_sink.clone()))
            })
            .collect::<Result<Vec<_>, _>>();
        let registrations = match registrations {
            Ok(registrations) => registrations,
            Err(error) => {
                return Ok(SeedReconcileResult {
                    outcome: SeedReconcileOutcome::Unavailable(error.to_string()),
                    tokens: Vec::new(),
                });
            }
        };
        let tokens = match self.handle.register_all(registrations).await {
            Ok(tokens) => tokens,
            Err(IncomingPeerError::RegistrationLimit { maximum }) => {
                return Ok(SeedReconcileResult {
                    outcome: SeedReconcileOutcome::Unavailable(format!(
                        "seed registration limit {maximum} reached"
                    )),
                    tokens: Vec::new(),
                });
            }
            Err(error) => return Err(error.into()),
        };
        Ok(SeedReconcileResult {
            outcome: SeedReconcileOutcome::Registered {
                validation,
                elapsed_millis,
            },
            tokens,
        })
    }

    pub(crate) async fn unregister(
        &self,
        token: SeedRegistrationToken,
    ) -> Result<bool, IncomingSeedingError> {
        Ok(self.handle.unregister(token).await?)
    }

    pub(crate) async fn unregister_all(
        &self,
        tokens: Vec<SeedRegistrationToken>,
    ) -> Result<usize, IncomingSeedingError> {
        let mut removed = 0;
        for token in tokens {
            removed += usize::from(self.unregister(token).await?);
        }
        Ok(removed)
    }

    pub(crate) fn registrations_are_current(&self, tokens: &[SeedRegistrationToken]) -> bool {
        !tokens.is_empty()
            && tokens
                .iter()
                .all(|token| self.handle.registration_is_current(*token))
    }

    pub(crate) fn stop(&self) {
        self.enabled.store(false, Ordering::Release);
    }
}

fn parse_resume_content(resume: &ResumeRecord) -> Result<TorrentContent, MetainfoError> {
    match (resume.info_hashes.v1_hash(), resume.info_hashes.v2_hash()) {
        (Some(_), None) => resume
            .raw_info
            .as_deref()
            .ok_or(MetainfoError::Unsupported("missing durable v1 info"))
            .and_then(|raw_info| {
                Metainfo::from_info_bytes_with_limits(raw_info, DURABLE_METAINFO_LIMITS)
            })
            .map(TorrentContent::from_v1_metainfo),
        (None, Some(_)) => {
            if let Some(source) = resume.metainfo_source.as_deref() {
                let projection = TorrentContentProjection::from_bytes_with_limits(
                    source,
                    DURABLE_METAINFO_LIMITS,
                )?;
                if resume.raw_info.as_deref() != Some(&source[projection.info_span.clone()]) {
                    return Err(MetainfoError::Unsupported(
                        "stored v2 info does not match complete source",
                    ));
                }
                Ok(projection.content)
            } else {
                let raw_info = resume
                    .raw_info
                    .as_deref()
                    .ok_or(MetainfoError::Unsupported("missing durable v2 info"))?;
                TorrentContent::from_v2_info_bytes_with_limits(raw_info, DURABLE_METAINFO_LIMITS)
                    .map(|runtime| runtime.content)
            }
        }
        (Some(_), Some(_)) => {
            if let Some(source) = resume.metainfo_source.as_deref() {
                let projection = TorrentContentProjection::from_bytes_with_limits(
                    source,
                    DURABLE_METAINFO_LIMITS,
                )?;
                if resume.raw_info.as_deref() != Some(&source[projection.info_span.clone()]) {
                    return Err(MetainfoError::Unsupported(
                        "stored hybrid info does not match complete source",
                    ));
                }
                Ok(projection.content)
            } else {
                let raw_info = resume
                    .raw_info
                    .as_deref()
                    .ok_or(MetainfoError::Unsupported("missing durable hybrid info"))?;
                TorrentContent::from_hybrid_info_bytes_with_limits(
                    raw_info,
                    DURABLE_METAINFO_LIMITS,
                )
                .map(|runtime| runtime.content)
            }
        }
        (None, None) => Err(MetainfoError::Unsupported("missing torrent identity")),
    }
}

fn platform_spec(
    resume: &ResumeRecord,
    content: &TorrentContent,
    storage_file_pool: &StorageFilePool,
) -> PlatformStorageSpec {
    PlatformStorageSpec {
        pool: storage_file_pool.clone(),
        root_id: resume.storage_root.clone(),
        storage_id: resume.torrent_id.to_string(),
        content_name: content.name().to_owned(),
        content_shape: ContentShape::from_content(content),
        storage_generation: 1,
    }
}

fn storage_failure_is_awaiting(kind: PlatformStorageFailureKind) -> bool {
    matches!(
        kind,
        PlatformStorageFailureKind::GrantUnavailable
            | PlatformStorageFailureKind::PermissionDenied
            | PlatformStorageFailureKind::ProviderRefused
            | PlatformStorageFailureKind::NonSeekable
            | PlatformStorageFailureKind::Cancelled
            | PlatformStorageFailureKind::DeadlineExceeded
    )
}

fn classify_validation_error(error: SelectiveStorageError) -> SeedReconcileOutcome {
    let detail = error.to_string();
    if error
        .platform_failure_kind()
        .is_some_and(storage_failure_is_awaiting)
        || matches!(error, SelectiveStorageError::Io { .. })
    {
        SeedReconcileOutcome::AwaitingStorage(detail)
    } else {
        SeedReconcileOutcome::NeedsRepair(detail)
    }
}

/// An invalidated acquisition means storage changed underneath the open, not
/// that it is malformed; like the validation path, it never quarantines.
fn classify_seed_open_error(error: SeedContentError) -> SeedReconcileOutcome {
    let awaiting = matches!(
        &error,
        SeedContentError::Storage { source, .. }
            if matches!(source, StorageFilePoolError::Invalidated)
                || source
                    .platform_failure_kind()
                    .is_some_and(storage_failure_is_awaiting)
    ) || matches!(error, SeedContentError::Io { .. });
    let detail = error.to_string();
    if awaiting {
        SeedReconcileOutcome::AwaitingStorage(detail)
    } else {
        SeedReconcileOutcome::NeedsRepair(detail)
    }
}

fn eligibility_reason(
    resume: &ResumeRecord,
    catalog_eligible: bool,
    root: Option<&StorageRootLocation>,
    active_download: bool,
) -> Option<&'static str> {
    if !catalog_eligible {
        return Some("torrent is archived or being removed");
    }
    if active_download {
        return Some("torrent has active engine work");
    }
    if !resume.desired_running {
        return Some("torrent is paused");
    }
    if resume.raw_info.is_none() || resume.have.is_none() {
        return Some("torrent lacks verified metadata or have state");
    }
    if matches!(
        resume.state,
        TorrentState::Checking | TorrentState::NeedsRepair | TorrentState::Error
    ) || !resume
        .have
        .as_ref()
        .is_some_and(|have| have.pieces().iter().all(|verified| *verified))
    {
        return Some("torrent does not have every protocol piece verified");
    }
    storage_root_eligibility_reason(root)
}

fn storage_root_eligibility_reason(root: Option<&StorageRootLocation>) -> Option<&'static str> {
    match root {
        Some(StorageRootLocation::Path(_) | StorageRootLocation::PlatformCapability) => None,
        None => Some("torrent storage root is unavailable"),
    }
}

#[derive(Debug)]
pub(crate) enum IncomingSeedingError {
    Engine(IncomingPeerError),
    InvalidDurableState(String),
}

impl fmt::Display for IncomingSeedingError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Engine(error) => write!(formatter, "{error}"),
            Self::InvalidDurableState(error) => write!(formatter, "{error}"),
        }
    }
}

impl Error for IncomingSeedingError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Engine(error) => Some(error),
            Self::InvalidDurableState(_) => None,
        }
    }
}

impl From<IncomingPeerError> for IncomingSeedingError {
    fn from(error: IncomingPeerError) -> Self {
        Self::Engine(error)
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use rstorrent_engine::{SeedContentError, StorageFilePoolError};

    use super::{SeedReconcileOutcome, classify_seed_open_error, storage_root_eligibility_reason};
    use crate::store::StorageRootLocation;

    #[test]
    fn invalidated_seed_open_awaits_storage_instead_of_quarantining() {
        let outcome = classify_seed_open_error(SeedContentError::Storage {
            artifact: "verified content root".to_owned(),
            source: StorageFilePoolError::Invalidated,
        });
        assert!(
            matches!(outcome, SeedReconcileOutcome::AwaitingStorage(_)),
            "{outcome:?}"
        );
        let outcome = classify_seed_open_error(SeedContentError::UnexpectedArtifact(
            "verified content root".to_owned(),
        ));
        assert!(
            matches!(outcome, SeedReconcileOutcome::NeedsRepair(_)),
            "{outcome:?}"
        );
    }

    #[test]
    fn seed_storage_eligibility_accepts_both_configured_backend_kinds() {
        let path = StorageRootLocation::Path(PathBuf::from("payload"));
        let platform = StorageRootLocation::PlatformCapability;

        assert_eq!(storage_root_eligibility_reason(Some(&path)), None);
        assert_eq!(storage_root_eligibility_reason(Some(&platform)), None);
        assert_eq!(
            storage_root_eligibility_reason(None),
            Some("torrent storage root is unavailable")
        );
    }
}
