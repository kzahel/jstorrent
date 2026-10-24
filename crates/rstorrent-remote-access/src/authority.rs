use std::collections::HashSet;

use base64::Engine as _;
use p256::ecdsa::signature::Signer as _;
use p256::ecdsa::{Signature, SigningKey};
use rstorrent_remote_crypto::{
    AuthorizationChallenge, AuthorizationGeneration, Binding, ClientId, ClientResumeProof, HostId,
    HostPin, HostResumeKey, OperationSeed, P256PublicKey, P256Signature, PasswordFile, RelayId,
    ResumeClientHello, ResumeContext, ResumeServerChallenge, ResumeServerStart, SecureChannel,
    ServerAuthority, Username, authorization_metadata_digest, authorization_transcript,
    finish_client_registration, finish_server_registration, finish_server_resume,
    start_client_registration, start_server_registration, start_server_resume,
    verify_authorization_signature,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, Zeroizing};

use crate::model::{
    ABSOLUTE_LIFETIME_MILLIS, AuthenticationMethod, AuthorizationMetadata, AuthorizedClientView,
    ClientState, DirectFileAuditView, EventId, EventKind, EventResult, FAILED_BUCKET_MILLIS,
    FAILED_RETENTION_MILLIS, FailedAttemptBucketView, FailedAttemptKind, IDLE_LIFETIME_MILLIS,
    MAX_AUTHORIZED_CLIENTS, MAX_FAILED_BUCKETS, MAX_OBSERVATION_BYTES, MAX_SECURITY_EVENTS,
    MAX_TOMBSTONES, SECURITY_RETENTION_MILLIS, SecurityEventView, SecuritySnapshot,
    TOUCH_INTERVAL_MILLIS, Timestamp, TombstoneView, decode_fixed, encode_id,
    validate_bounded_text,
};
use crate::{RemoteAccessError, Result};

const AUTHORITY_VERSION: u16 = 1;
const MAX_ROUTE_BYTES: usize = 64;
const MAX_REASON_BYTES: usize = 64;

const fn default_true() -> bool {
    true
}

pub struct ProvisioningMaterial {
    host_id: HostId,
    relay_id: RelayId,
    relay_credential: Zeroizing<[u8; 32]>,
    authority_seed: OperationSeed,
    registration_start_seed: OperationSeed,
    registration_finish_seed: OperationSeed,
    resume_key_seed: OperationSeed,
}

impl ProvisioningMaterial {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        host_id: HostId,
        relay_id: RelayId,
        relay_credential: [u8; 32],
        authority_seed: OperationSeed,
        registration_start_seed: OperationSeed,
        registration_finish_seed: OperationSeed,
        resume_key_seed: OperationSeed,
    ) -> Self {
        Self {
            host_id,
            relay_id,
            relay_credential: Zeroizing::new(relay_credential),
            authority_seed,
            registration_start_seed,
            registration_finish_seed,
            resume_key_seed,
        }
    }
}

pub struct AuthorizationRequest {
    client_id: ClientId,
    client_public_key: P256PublicKey,
    challenge: AuthorizationChallenge,
    signature: P256Signature,
    metadata: AuthorizationMetadata,
    timestamp: Timestamp,
    event_id: EventId,
}

impl AuthorizationRequest {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        client_id: ClientId,
        client_public_key: P256PublicKey,
        challenge: AuthorizationChallenge,
        signature: P256Signature,
        metadata: AuthorizationMetadata,
        timestamp: Timestamp,
        event_id: EventId,
    ) -> Self {
        Self {
            client_id,
            client_public_key,
            challenge,
            signature,
            metadata,
            timestamp,
            event_id,
        }
    }
}

pub struct PendingResume {
    client_id: ClientId,
    authorization_generation: AuthorizationGeneration,
    client_generation: AuthorizationGeneration,
    start: ResumeServerStart,
}

impl PendingResume {
    pub fn challenge(&self) -> &ResumeServerChallenge {
        self.start.challenge()
    }
}

struct AuthorizedClient {
    client_id: ClientId,
    client_public_key: P256PublicKey,
    metadata: AuthorizationMetadata,
    created: Timestamp,
    last_full_login: Timestamp,
    last_resume: Option<Timestamp>,
    last_seen: Timestamp,
    idle_expires: Timestamp,
    absolute_expires: Timestamp,
    generation: AuthorizationGeneration,
}

struct Tombstone {
    client_id: ClientId,
    label: String,
    fingerprint: String,
    created: Timestamp,
    last_seen: Timestamp,
    ended: Timestamp,
    state: ClientState,
}

struct SecurityEvent {
    event_id: EventId,
    timestamp: Timestamp,
    kind: EventKind,
    result: EventResult,
    client_id: Option<ClientId>,
    circuit_id: Option<[u8; 16]>,
    authentication_method: Option<AuthenticationMethod>,
    route: Option<String>,
    client_build: Option<String>,
    reason_class: Option<String>,
    direct_file: Option<DirectFileAuditView>,
}

struct FailedAttemptBucket {
    bucket_start: Timestamp,
    kind: FailedAttemptKind,
    route_class: String,
    attempts: u64,
}

/// Complete enabled host authority and its bounded security registry.
///
/// Secret-bearing fields deliberately prevent `Clone` and `Debug`. Use
/// [`crate::AuthorityStore::update`] for prior-or-new durable transitions.
pub struct RemoteAuthority {
    generation: u64,
    authorization_generation: AuthorizationGeneration,
    binding: Binding,
    route: String,
    relay_credential: Zeroizing<[u8; 32]>,
    protocol_floor: u16,
    direct_file_transfers_enabled: bool,
    opaque_authority: ServerAuthority,
    password_file: PasswordFile,
    host_resume_key: HostResumeKey,
    clients: Vec<AuthorizedClient>,
    tombstones: Vec<Tombstone>,
    events: Vec<SecurityEvent>,
    failed_attempts: Vec<FailedAttemptBucket>,
    last_status: Option<String>,
}

impl RemoteAuthority {
    pub fn provision(
        username: Username,
        passphrase: &[u8],
        route: impl Into<String>,
        protocol_floor: u16,
        now: Timestamp,
        event_id: EventId,
        material: ProvisioningMaterial,
    ) -> Result<Self> {
        let route = route.into();
        validate_bounded_text(&route, 3, MAX_ROUTE_BYTES, "relay route")?;
        if protocol_floor == 0 {
            return Err(RemoteAccessError::InvalidInput("protocol floor"));
        }
        validate_relay_credential(&material.relay_credential)?;
        let binding = Binding::new(material.relay_id, username, material.host_id);
        let opaque_authority = ServerAuthority::generate(material.authority_seed);
        let password_file = register_password(
            &opaque_authority,
            &binding,
            passphrase,
            material.registration_start_seed,
            material.registration_finish_seed,
        )?;
        let host_resume_key = HostResumeKey::generate(material.resume_key_seed);
        let mut authority = Self {
            generation: 1,
            authorization_generation: AuthorizationGeneration::new(1),
            binding,
            route,
            relay_credential: material.relay_credential,
            protocol_floor,
            direct_file_transfers_enabled: true,
            opaque_authority,
            password_file,
            host_resume_key,
            clients: Vec::new(),
            tombstones: Vec::new(),
            events: Vec::new(),
            failed_attempts: Vec::new(),
            last_status: None,
        };
        authority.push_event(SecurityEvent {
            event_id,
            timestamp: now,
            kind: EventKind::Enabled,
            result: EventResult::Succeeded,
            client_id: None,
            circuit_id: None,
            authentication_method: None,
            route: Some(authority.route.clone()),
            client_build: None,
            reason_class: None,
            direct_file: None,
        })?;
        Ok(authority)
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn authorization_generation(&self) -> AuthorizationGeneration {
        self.authorization_generation
    }

    pub fn binding(&self) -> &Binding {
        &self.binding
    }

    pub fn route(&self) -> &str {
        &self.route
    }

    pub fn relay_public_key(&self) -> P256PublicKey {
        let key = relay_signing_key(&self.relay_credential);
        P256PublicKey::from_bytes(key.verifying_key().to_sec1_point(false).as_bytes())
            .expect("validated relay signing key has a valid public key")
    }

    pub fn sign_relay_transcript(&self, transcript: &[u8]) -> P256Signature {
        let signature: Signature = relay_signing_key(&self.relay_credential).sign(transcript);
        P256Signature::from_bytes(signature.to_bytes().as_slice())
            .expect("P-256 signer returns a fixed valid signature")
    }

    pub fn protocol_floor(&self) -> u16 {
        self.protocol_floor
    }

    pub fn direct_file_transfers_enabled(&self) -> bool {
        self.direct_file_transfers_enabled
    }

    pub fn opaque_authority(&self) -> &ServerAuthority {
        &self.opaque_authority
    }

    pub fn password_file(&self) -> &PasswordFile {
        &self.password_file
    }

    pub fn host_resume_key(&self) -> &HostResumeKey {
        &self.host_resume_key
    }

    pub fn host_pin(&self) -> HostPin {
        HostPin::new(self.binding.host_id(), self.opaque_authority.public_key())
    }

    pub fn authorize_client(&mut self, request: AuthorizationRequest) -> Result<()> {
        request.metadata.validate()?;
        self.ensure_event_id_available(request.event_id)?;
        if self.clients.len() >= MAX_AUTHORIZED_CLIENTS {
            return Err(RemoteAccessError::Capacity("authorized browser"));
        }
        if self.client_id_seen(request.client_id) {
            return Err(RemoteAccessError::Conflict(
                "client identifier was already used",
            ));
        }
        let metadata_digest = metadata_digest(&request.metadata);
        let transcript = authorization_transcript(
            &self.binding,
            self.host_pin(),
            self.host_resume_key.public_key(),
            self.authorization_generation,
            request.challenge,
            request.client_public_key,
            metadata_digest,
        );
        verify_authorization_signature(request.client_public_key, &transcript, request.signature)
            .map_err(|_| RemoteAccessError::AuthenticationFailed)?;
        let client = AuthorizedClient {
            client_id: request.client_id,
            client_public_key: request.client_public_key,
            metadata: request.metadata,
            created: request.timestamp,
            last_full_login: request.timestamp,
            last_resume: None,
            last_seen: request.timestamp,
            idle_expires: request.timestamp.saturating_add(IDLE_LIFETIME_MILLIS),
            absolute_expires: request.timestamp.saturating_add(ABSOLUTE_LIFETIME_MILLIS),
            generation: AuthorizationGeneration::new(1),
        };
        let event = SecurityEvent {
            event_id: request.event_id,
            timestamp: request.timestamp,
            kind: EventKind::AuthorizationCreated,
            result: EventResult::Succeeded,
            client_id: Some(request.client_id),
            circuit_id: None,
            authentication_method: Some(AuthenticationMethod::Password),
            route: Some(self.route.clone()),
            client_build: client.metadata.client_build().map(ToOwned::to_owned),
            reason_class: None,
            direct_file: None,
        };
        self.push_event(event)?;
        self.clients.push(client);
        Ok(())
    }

    pub fn rename_client(
        &mut self,
        client_id: ClientId,
        label: impl Into<String>,
        now: Timestamp,
        event_id: EventId,
    ) -> Result<()> {
        let label = label.into();
        validate_bounded_text(&label, 1, crate::model::MAX_LABEL_BYTES, "browser label")?;
        self.ensure_event_id_available(event_id)?;
        let client = self
            .clients
            .iter_mut()
            .find(|client| client.client_id == client_id)
            .ok_or(RemoteAccessError::NotFound)?;
        client.metadata.rename(label)?;
        self.push_event(SecurityEvent {
            event_id,
            timestamp: now,
            kind: EventKind::AuthorizationRenamed,
            result: EventResult::Succeeded,
            client_id: Some(client_id),
            circuit_id: None,
            authentication_method: None,
            route: Some(self.route.clone()),
            client_build: None,
            reason_class: None,
            direct_file: None,
        })
    }

    pub fn revoke_client(
        &mut self,
        client_id: ClientId,
        now: Timestamp,
        event_id: EventId,
    ) -> Result<()> {
        self.ensure_event_id_available(event_id)?;
        let index = self
            .clients
            .iter()
            .position(|client| client.client_id == client_id)
            .ok_or(RemoteAccessError::NotFound)?;
        let client = self.clients.remove(index);
        self.add_tombstone(client, ClientState::Revoked, now);
        self.push_event(SecurityEvent {
            event_id,
            timestamp: now,
            kind: EventKind::AuthorizationRevoked,
            result: EventResult::Succeeded,
            client_id: Some(client_id),
            circuit_id: None,
            authentication_method: None,
            route: Some(self.route.clone()),
            client_build: None,
            reason_class: Some("owner_revoked".to_owned()),
            direct_file: None,
        })
    }

    pub fn revoke_all_except<I>(
        &mut self,
        retained_client_id: ClientId,
        now: Timestamp,
        event_ids: I,
    ) -> Result<usize>
    where
        I: IntoIterator<Item = EventId>,
    {
        if !self
            .clients
            .iter()
            .any(|client| client.client_id == retained_client_id)
        {
            return Err(RemoteAccessError::NotFound);
        }
        let revoked = self
            .clients
            .iter()
            .filter(|client| client.client_id != retained_client_id)
            .map(|client| client.client_id)
            .collect::<Vec<_>>();
        let event_ids = self.validate_event_ids(event_ids, revoked.len(), &[])?;
        for (client_id, event_id) in revoked.iter().copied().zip(event_ids) {
            self.revoke_client(client_id, now, event_id)?;
        }
        Ok(revoked.len())
    }

    pub fn expire_clients<I>(&mut self, now: Timestamp, event_ids: I) -> Result<usize>
    where
        I: IntoIterator<Item = EventId>,
    {
        let expired: Vec<ClientId> = self
            .clients
            .iter()
            .filter(|client| is_expired(client, now))
            .map(|client| client.client_id)
            .collect();
        let event_ids = self.validate_event_ids(event_ids, expired.len(), &[])?;
        for (client_id, event_id) in expired.iter().zip(event_ids) {
            let index = self
                .clients
                .iter()
                .position(|client| client.client_id == *client_id)
                .expect("expired client came from current registry");
            let client = self.clients.remove(index);
            self.add_tombstone(client, ClientState::Expired, now);
            self.push_event(SecurityEvent {
                event_id,
                timestamp: now,
                kind: EventKind::AuthorizationExpired,
                result: EventResult::Succeeded,
                client_id: Some(*client_id),
                circuit_id: None,
                authentication_method: None,
                route: Some(self.route.clone()),
                client_build: None,
                reason_class: Some("deadline".to_owned()),
                direct_file: None,
            })?;
        }
        Ok(expired.len())
    }

    pub fn require_password_everywhere<I>(
        &mut self,
        now: Timestamp,
        event_id: EventId,
        tombstone_event_ids: I,
    ) -> Result<usize>
    where
        I: IntoIterator<Item = EventId>,
    {
        let tombstone_event_ids =
            self.validate_event_ids(tombstone_event_ids, self.clients.len(), &[event_id])?;
        self.ensure_event_id_available(event_id)?;
        self.authorization_generation = AuthorizationGeneration::new(
            self.authorization_generation.get().checked_add(1).ok_or(
                RemoteAccessError::Conflict("authorization generation exhausted"),
            )?,
        );
        self.push_event(SecurityEvent {
            event_id,
            timestamp: now,
            kind: EventKind::RequirePasswordEverywhere,
            result: EventResult::Succeeded,
            client_id: None,
            circuit_id: None,
            authentication_method: None,
            route: Some(self.route.clone()),
            client_build: None,
            reason_class: None,
            direct_file: None,
        })?;
        self.revoke_all(now, tombstone_event_ids, "global_generation")
    }

    pub fn change_passphrase<I>(
        &mut self,
        passphrase: &[u8],
        registration_start_seed: OperationSeed,
        registration_finish_seed: OperationSeed,
        now: Timestamp,
        event_id: EventId,
        tombstone_event_ids: I,
    ) -> Result<usize>
    where
        I: IntoIterator<Item = EventId>,
    {
        let tombstone_event_ids =
            self.validate_event_ids(tombstone_event_ids, self.clients.len(), &[event_id])?;
        self.ensure_event_id_available(event_id)?;
        let password_file = register_password(
            &self.opaque_authority,
            &self.binding,
            passphrase,
            registration_start_seed,
            registration_finish_seed,
        )?;
        self.authorization_generation = AuthorizationGeneration::new(
            self.authorization_generation.get().checked_add(1).ok_or(
                RemoteAccessError::Conflict("authorization generation exhausted"),
            )?,
        );
        self.password_file = password_file;
        self.push_event(SecurityEvent {
            event_id,
            timestamp: now,
            kind: EventKind::PasswordChanged,
            result: EventResult::Succeeded,
            client_id: None,
            circuit_id: None,
            authentication_method: Some(AuthenticationMethod::Password),
            route: Some(self.route.clone()),
            client_build: None,
            reason_class: None,
            direct_file: None,
        })?;
        self.revoke_all(now, tombstone_event_ids, "password_changed")
    }

    pub fn rotate_relay_credential(
        &mut self,
        credential: [u8; 32],
        now: Timestamp,
        event_id: EventId,
    ) -> Result<()> {
        self.ensure_event_id_available(event_id)?;
        validate_relay_credential(&credential)?;
        self.relay_credential = Zeroizing::new(credential);
        self.push_event(SecurityEvent {
            event_id,
            timestamp: now,
            kind: EventKind::RelayCredentialRotated,
            result: EventResult::Succeeded,
            client_id: None,
            circuit_id: None,
            authentication_method: None,
            route: Some(self.route.clone()),
            client_build: None,
            reason_class: None,
            direct_file: None,
        })
    }

    pub fn begin_resume(
        &self,
        client_id: ClientId,
        hello: &ResumeClientHello,
        now: Timestamp,
        seed: OperationSeed,
    ) -> Result<PendingResume> {
        let client = self
            .clients
            .iter()
            .find(|client| client.client_id == client_id)
            .ok_or(RemoteAccessError::AuthenticationFailed)?;
        if is_expired(client, now) {
            return Err(RemoteAccessError::Expired);
        }
        let context = self.resume_context(client);
        let start = start_server_resume(&self.host_resume_key, context, hello, seed)
            .map_err(|_| RemoteAccessError::AuthenticationFailed)?;
        Ok(PendingResume {
            client_id,
            authorization_generation: self.authorization_generation,
            client_generation: client.generation,
            start,
        })
    }

    pub fn finish_resume(
        &mut self,
        pending: PendingResume,
        proof: ClientResumeProof,
        now: Timestamp,
        event_id: EventId,
    ) -> Result<SecureChannel> {
        self.ensure_event_id_available(event_id)?;
        if pending.authorization_generation != self.authorization_generation {
            return Err(RemoteAccessError::AuthenticationFailed);
        }
        let index = self
            .clients
            .iter()
            .position(|client| client.client_id == pending.client_id)
            .ok_or(RemoteAccessError::AuthenticationFailed)?;
        let client = &self.clients[index];
        if client.generation != pending.client_generation || is_expired(client, now) {
            return Err(RemoteAccessError::AuthenticationFailed);
        }
        let channel = finish_server_resume(pending.start, proof)
            .map_err(|_| RemoteAccessError::AuthenticationFailed)?;
        let client = &mut self.clients[index];
        client.last_resume = Some(now);
        if now.as_millis().saturating_sub(client.last_seen.as_millis()) >= TOUCH_INTERVAL_MILLIS {
            client.last_seen = now;
            client.idle_expires = now
                .saturating_add(IDLE_LIFETIME_MILLIS)
                .min(client.absolute_expires);
        }
        let client_build = client.metadata.client_build().map(ToOwned::to_owned);
        self.push_event(SecurityEvent {
            event_id,
            timestamp: now,
            kind: EventKind::ResumeSucceeded,
            result: EventResult::Succeeded,
            client_id: Some(pending.client_id),
            circuit_id: None,
            authentication_method: Some(AuthenticationMethod::Resume),
            route: Some(self.route.clone()),
            client_build,
            reason_class: None,
            direct_file: None,
        })?;
        Ok(channel)
    }

    pub fn record_full_login(
        &mut self,
        client_id: Option<ClientId>,
        now: Timestamp,
        event_id: EventId,
        client_build: Option<String>,
    ) -> Result<()> {
        if let Some(client_id) = client_id
            && !self
                .clients
                .iter()
                .any(|client| client.client_id == client_id)
        {
            return Err(RemoteAccessError::NotFound);
        }
        if let Some(client_build) = &client_build {
            validate_bounded_text(client_build, 1, MAX_OBSERVATION_BYTES, "client build")?;
        }
        self.push_event(SecurityEvent {
            event_id,
            timestamp: now,
            kind: EventKind::FullLoginSucceeded,
            result: EventResult::Succeeded,
            client_id,
            circuit_id: None,
            authentication_method: Some(AuthenticationMethod::Password),
            route: Some(self.route.clone()),
            client_build,
            reason_class: None,
            direct_file: None,
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub fn record_circuit_event(
        &mut self,
        opened: bool,
        client_id: Option<ClientId>,
        circuit_id: [u8; 16],
        authentication_method: AuthenticationMethod,
        now: Timestamp,
        event_id: EventId,
        reason_class: Option<String>,
    ) -> Result<()> {
        if let Some(client_id) = client_id {
            let current = self
                .clients
                .iter()
                .any(|client| client.client_id == client_id);
            let historical = !opened
                && self
                    .tombstones
                    .iter()
                    .any(|client| client.client_id == client_id);
            if !current && !historical {
                return Err(RemoteAccessError::NotFound);
            }
        }
        if let Some(reason) = &reason_class {
            validate_bounded_text(reason, 1, MAX_REASON_BYTES, "circuit reason class")?;
        }
        self.push_event(SecurityEvent {
            event_id,
            timestamp: now,
            kind: if opened {
                EventKind::CircuitOpened
            } else {
                EventKind::CircuitClosed
            },
            result: EventResult::Succeeded,
            client_id,
            circuit_id: Some(circuit_id),
            authentication_method: Some(authentication_method),
            route: Some(self.route.clone()),
            client_build: None,
            reason_class,
            direct_file: None,
        })
    }

    pub fn set_direct_file_transfers_enabled(
        &mut self,
        enabled: bool,
        now: Timestamp,
        event_id: EventId,
    ) -> Result<bool> {
        if self.direct_file_transfers_enabled == enabled {
            return Ok(false);
        }
        self.push_event(SecurityEvent {
            event_id,
            timestamp: now,
            kind: EventKind::DirectFileSettingChanged,
            result: EventResult::Succeeded,
            client_id: None,
            circuit_id: None,
            authentication_method: None,
            route: Some(self.route.clone()),
            client_build: None,
            reason_class: Some(if enabled { "enabled" } else { "disabled" }.to_owned()),
            direct_file: None,
        })?;
        self.direct_file_transfers_enabled = enabled;
        Ok(true)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn record_direct_file_event(
        &mut self,
        kind: EventKind,
        result: EventResult,
        client_id: Option<ClientId>,
        circuit_id: [u8; 16],
        now: Timestamp,
        event_id: EventId,
        details: DirectFileAuditView,
        reason_class: Option<String>,
    ) -> Result<()> {
        if !matches!(
            kind,
            EventKind::DirectFileStarted
                | EventKind::DirectFileCompleted
                | EventKind::DirectFileFailed
                | EventKind::DirectFileCancelled
        ) {
            return Err(RemoteAccessError::InvalidInput(
                "direct-file audit event kind",
            ));
        }
        let terminal = kind != EventKind::DirectFileStarted;
        if let Some(client_id) = client_id {
            let current = self
                .clients
                .iter()
                .any(|client| client.client_id == client_id);
            let historical = terminal
                && self
                    .tombstones
                    .iter()
                    .any(|client| client.client_id == client_id);
            if !current && !historical {
                return Err(RemoteAccessError::NotFound);
            }
        }
        validate_direct_file_audit(&details)?;
        if let Some(reason) = &reason_class {
            validate_bounded_text(reason, 1, MAX_REASON_BYTES, "direct-file reason class")?;
        }
        self.push_event(SecurityEvent {
            event_id,
            timestamp: now,
            kind,
            result,
            client_id,
            circuit_id: Some(circuit_id),
            authentication_method: None,
            route: Some(self.route.clone()),
            client_build: None,
            reason_class,
            direct_file: Some(details),
        })
    }

    pub fn record_failed_attempt(
        &mut self,
        kind: FailedAttemptKind,
        route_class: impl Into<String>,
        now: Timestamp,
    ) -> Result<()> {
        let route_class = route_class.into();
        validate_bounded_text(
            &route_class,
            1,
            MAX_OBSERVATION_BYTES,
            "failed attempt route class",
        )?;
        self.prune(now);
        let bucket_start =
            Timestamp::from_millis(now.as_millis() - now.as_millis() % FAILED_BUCKET_MILLIS);
        if let Some(bucket) = self.failed_attempts.iter_mut().find(|bucket| {
            bucket.bucket_start == bucket_start
                && bucket.kind == kind
                && bucket.route_class == route_class
        }) {
            bucket.attempts = bucket.attempts.saturating_add(1);
            return Ok(());
        }
        let mut stored_route = route_class;
        if self.failed_attempts.len() >= MAX_FAILED_BUCKETS {
            stored_route = "other".to_owned();
            if let Some(bucket) = self.failed_attempts.iter_mut().find(|bucket| {
                bucket.bucket_start == bucket_start
                    && bucket.kind == kind
                    && bucket.route_class == stored_route
            }) {
                bucket.attempts = bucket.attempts.saturating_add(1);
                return Ok(());
            }
            let oldest = self
                .failed_attempts
                .iter()
                .enumerate()
                .min_by_key(|(_, bucket)| bucket.bucket_start)
                .map(|(index, _)| index)
                .expect("full failed-attempt registry is nonempty");
            self.failed_attempts.remove(oldest);
        }
        self.failed_attempts.push(FailedAttemptBucket {
            bucket_start,
            kind,
            route_class: stored_route,
            attempts: 1,
        });
        Ok(())
    }

    pub fn set_last_status(&mut self, status: Option<String>) -> Result<()> {
        if let Some(status) = &status {
            validate_bounded_text(status, 1, MAX_OBSERVATION_BYTES, "operational status")?;
        }
        self.last_status = status;
        Ok(())
    }

    pub fn security_snapshot(&self) -> SecuritySnapshot {
        SecuritySnapshot {
            generation: self.generation,
            authorization_generation: self.authorization_generation.get(),
            clients: self.clients.iter().map(client_view).collect(),
            tombstones: self.tombstones.iter().map(tombstone_view).collect(),
            events: self.events.iter().map(event_view).collect(),
            failed_attempts: self.failed_attempts.iter().map(failed_view).collect(),
        }
    }

    pub(crate) fn disabled_snapshot(
        &self,
        now: Timestamp,
        event_id: EventId,
    ) -> Result<SecuritySnapshot> {
        self.ensure_event_id_available(event_id)?;
        let mut snapshot = self.security_snapshot();
        snapshot.generation =
            snapshot
                .generation
                .checked_add(1)
                .ok_or(RemoteAccessError::Conflict(
                    "authority generation exhausted",
                ))?;
        snapshot.authorization_generation = snapshot
            .authorization_generation
            .checked_add(1)
            .ok_or(RemoteAccessError::Conflict(
                "authorization generation exhausted",
            ))?;
        snapshot
            .tombstones
            .extend(snapshot.clients.drain(..).map(|client| TombstoneView {
                client_id: client.client_id,
                label: client.label,
                fingerprint: client.fingerprint,
                created: client.created,
                last_seen: client.last_seen,
                ended: now,
                state: ClientState::Revoked,
            }));
        snapshot.events.push(SecurityEventView {
            event_id: encode_id(event_id.as_bytes()),
            timestamp: now,
            kind: EventKind::Disabled,
            result: EventResult::Succeeded,
            client_id: None,
            circuit_id: None,
            authentication_method: None,
            route: Some(self.route.clone()),
            client_build: None,
            reason_class: None,
            direct_file: None,
        });
        let cutoff = now.saturating_sub(SECURITY_RETENTION_MILLIS);
        snapshot.tombstones.retain(|item| item.ended >= cutoff);
        snapshot.events.retain(|item| item.timestamp >= cutoff);
        if snapshot.tombstones.len() > MAX_TOMBSTONES {
            snapshot.tombstones.sort_by_key(|item| item.ended);
            snapshot
                .tombstones
                .drain(..snapshot.tombstones.len() - MAX_TOMBSTONES);
        }
        if snapshot.events.len() > MAX_SECURITY_EVENTS {
            snapshot.events.sort_by_key(|item| item.timestamp);
            snapshot
                .events
                .drain(..snapshot.events.len() - MAX_SECURITY_EVENTS);
        }
        Ok(snapshot)
    }

    pub(crate) fn advance_generation(&mut self) -> Result<()> {
        self.generation = self
            .generation
            .checked_add(1)
            .ok_or(RemoteAccessError::Conflict(
                "authority generation exhausted",
            ))?;
        Ok(())
    }

    pub(crate) fn encode(&self) -> Result<Zeroizing<Vec<u8>>> {
        let persisted = PersistedAuthority::from_authority(self);
        let mut encoded = Zeroizing::new(
            serde_json::to_vec_pretty(&persisted)
                .map_err(|_| RemoteAccessError::Corrupt("serialization failed"))?,
        );
        encoded.push(b'\n');
        Ok(encoded)
    }

    pub(crate) fn decode(encoded: &[u8]) -> Result<Self> {
        let persisted: PersistedAuthority = serde_json::from_slice(encoded)
            .map_err(|_| RemoteAccessError::Corrupt("malformed JSON"))?;
        persisted.into_authority()
    }

    fn resume_context(&self, client: &AuthorizedClient) -> ResumeContext {
        ResumeContext::new(
            self.binding.clone(),
            self.host_pin(),
            self.host_resume_key.public_key(),
            client.client_id,
            client.client_public_key,
            self.authorization_generation,
            client.generation,
            self.protocol_floor,
        )
    }

    fn client_id_seen(&self, client_id: ClientId) -> bool {
        self.clients
            .iter()
            .any(|client| client.client_id == client_id)
            || self
                .tombstones
                .iter()
                .any(|client| client.client_id == client_id)
    }

    fn revoke_all<I>(&mut self, now: Timestamp, event_ids: I, reason: &str) -> Result<usize>
    where
        I: IntoIterator<Item = EventId>,
    {
        let mut event_ids = event_ids.into_iter();
        let count = self.clients.len();
        let clients = std::mem::take(&mut self.clients);
        for client in clients {
            let client_id = client.client_id;
            let event_id = event_ids.next().ok_or(RemoteAccessError::InvalidInput(
                "one event identifier per revoked authorization",
            ))?;
            self.add_tombstone(client, ClientState::Revoked, now);
            self.push_event(SecurityEvent {
                event_id,
                timestamp: now,
                kind: EventKind::AuthorizationRevoked,
                result: EventResult::Succeeded,
                client_id: Some(client_id),
                circuit_id: None,
                authentication_method: None,
                route: Some(self.route.clone()),
                client_build: None,
                reason_class: Some(reason.to_owned()),
                direct_file: None,
            })?;
        }
        Ok(count)
    }

    fn add_tombstone(&mut self, client: AuthorizedClient, state: ClientState, now: Timestamp) {
        self.tombstones.push(Tombstone {
            client_id: client.client_id,
            label: client.metadata.into_label(),
            fingerprint: fingerprint(client.client_public_key),
            created: client.created,
            last_seen: client.last_seen,
            ended: now,
            state,
        });
        self.prune(now);
        if self.tombstones.len() > MAX_TOMBSTONES {
            self.tombstones.remove(0);
        }
    }

    fn push_event(&mut self, event: SecurityEvent) -> Result<()> {
        self.ensure_event_id_available(event.event_id)?;
        self.prune(event.timestamp);
        self.events.push(event);
        if self.events.len() > MAX_SECURITY_EVENTS {
            self.events.remove(0);
        }
        Ok(())
    }

    fn ensure_event_id_available(&self, event_id: EventId) -> Result<()> {
        if self
            .events
            .iter()
            .any(|existing| existing.event_id == event_id)
        {
            return Err(RemoteAccessError::Conflict(
                "security event identifier was reused",
            ));
        }
        Ok(())
    }

    fn validate_event_ids<I>(
        &self,
        event_ids: I,
        required: usize,
        reserved: &[EventId],
    ) -> Result<Vec<EventId>>
    where
        I: IntoIterator<Item = EventId>,
    {
        let event_ids: Vec<EventId> = event_ids.into_iter().take(required + 1).collect();
        if event_ids.len() != required {
            return Err(RemoteAccessError::InvalidInput(
                "one event identifier per authorization transition",
            ));
        }
        let mut seen: HashSet<EventId> = reserved.iter().copied().collect();
        for event_id in &event_ids {
            self.ensure_event_id_available(*event_id)?;
            if !seen.insert(*event_id) {
                return Err(RemoteAccessError::Conflict(
                    "security event identifier was reused",
                ));
            }
        }
        Ok(event_ids)
    }

    fn prune(&mut self, now: Timestamp) {
        let security_cutoff = now.saturating_sub(SECURITY_RETENTION_MILLIS);
        self.tombstones
            .retain(|record| record.ended >= security_cutoff);
        self.events
            .retain(|record| record.timestamp >= security_cutoff);
        let failed_cutoff = now.saturating_sub(FAILED_RETENTION_MILLIS);
        self.failed_attempts
            .retain(|bucket| bucket.bucket_start >= failed_cutoff);
    }
}

fn register_password(
    authority: &ServerAuthority,
    binding: &Binding,
    passphrase: &[u8],
    start_seed: OperationSeed,
    finish_seed: OperationSeed,
) -> Result<PasswordFile> {
    let client = start_client_registration(passphrase, start_seed)?;
    let response = start_server_registration(authority, binding, client.request())?;
    let finish = finish_client_registration(client, passphrase, binding, &response, finish_seed)?;
    Ok(finish_server_registration(finish.upload())?)
}

fn metadata_digest(metadata: &AuthorizationMetadata) -> [u8; 32] {
    authorization_metadata_digest(
        metadata.label(),
        metadata.client_build(),
        metadata.route_observation(),
        metadata.browser_observation(),
    )
}

fn is_expired(client: &AuthorizedClient, now: Timestamp) -> bool {
    now >= client.idle_expires || now >= client.absolute_expires
}

fn fingerprint(public_key: P256PublicKey) -> String {
    encode_id(&Sha256::digest(public_key.as_bytes()))
}

fn client_view(client: &AuthorizedClient) -> AuthorizedClientView {
    AuthorizedClientView {
        client_id: encode_id(client.client_id.as_bytes()),
        label: client.metadata.label().to_owned(),
        fingerprint: fingerprint(client.client_public_key),
        created: client.created,
        last_full_login: client.last_full_login,
        last_resume: client.last_resume,
        last_seen: client.last_seen,
        idle_expires: client.idle_expires,
        absolute_expires: client.absolute_expires,
        state: ClientState::Current,
        client_build: client.metadata.client_build().map(ToOwned::to_owned),
        route_observation: client.metadata.route_observation().map(ToOwned::to_owned),
        browser_observation: client.metadata.browser_observation().map(ToOwned::to_owned),
    }
}

fn tombstone_view(tombstone: &Tombstone) -> TombstoneView {
    TombstoneView {
        client_id: encode_id(tombstone.client_id.as_bytes()),
        label: tombstone.label.clone(),
        fingerprint: tombstone.fingerprint.clone(),
        created: tombstone.created,
        last_seen: tombstone.last_seen,
        ended: tombstone.ended,
        state: tombstone.state,
    }
}

fn event_view(event: &SecurityEvent) -> SecurityEventView {
    SecurityEventView {
        event_id: encode_id(event.event_id.as_bytes()),
        timestamp: event.timestamp,
        kind: event.kind,
        result: event.result,
        client_id: event.client_id.map(|id| encode_id(id.as_bytes())),
        circuit_id: event.circuit_id.map(|id| encode_id(&id)),
        authentication_method: event.authentication_method,
        route: event.route.clone(),
        client_build: event.client_build.clone(),
        reason_class: event.reason_class.clone(),
        direct_file: event.direct_file.clone(),
    }
}

fn failed_view(bucket: &FailedAttemptBucket) -> FailedAttemptBucketView {
    FailedAttemptBucketView {
        bucket_start: bucket.bucket_start,
        kind: bucket.kind,
        route_class: bucket.route_class.clone(),
        attempts: bucket.attempts,
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PersistedAuthority {
    version: u16,
    generation: u64,
    authorization_generation: u64,
    relay_id: String,
    username: String,
    host_id: String,
    route: String,
    relay_credential: SecretString,
    protocol_floor: u16,
    #[serde(default = "default_true")]
    direct_file_transfers_enabled: bool,
    opaque_authority: SecretString,
    password_file: SecretString,
    host_resume_key: SecretString,
    clients: Vec<PersistedClient>,
    tombstones: Vec<PersistedTombstone>,
    events: Vec<PersistedEvent>,
    failed_attempts: Vec<PersistedFailedBucket>,
    last_status: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PersistedClient {
    client_id: String,
    client_public_key: SecretString,
    label: String,
    client_build: Option<String>,
    route_observation: Option<String>,
    browser_observation: Option<String>,
    created: Timestamp,
    last_full_login: Timestamp,
    last_resume: Option<Timestamp>,
    last_seen: Timestamp,
    idle_expires: Timestamp,
    absolute_expires: Timestamp,
    generation: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PersistedTombstone {
    client_id: String,
    label: String,
    fingerprint: String,
    created: Timestamp,
    last_seen: Timestamp,
    ended: Timestamp,
    state: ClientState,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PersistedEvent {
    event_id: String,
    timestamp: Timestamp,
    kind: EventKind,
    result: EventResult,
    client_id: Option<String>,
    circuit_id: Option<String>,
    authentication_method: Option<AuthenticationMethod>,
    route: Option<String>,
    client_build: Option<String>,
    reason_class: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    direct_file: Option<DirectFileAuditView>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PersistedFailedBucket {
    bucket_start: Timestamp,
    kind: FailedAttemptKind,
    route_class: String,
    attempts: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(transparent)]
struct SecretString(String);

impl Drop for SecretString {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

impl PersistedAuthority {
    fn from_authority(authority: &RemoteAuthority) -> Self {
        let opaque = authority.opaque_authority.export();
        let password = authority.password_file.export();
        let host_resume = authority.host_resume_key.export();
        Self {
            version: AUTHORITY_VERSION,
            generation: authority.generation,
            authorization_generation: authority.authorization_generation.get(),
            relay_id: encode_id(authority.binding.relay_id().as_bytes()),
            username: authority.binding.username().as_str().to_owned(),
            host_id: encode_id(authority.binding.host_id().as_bytes()),
            route: authority.route.clone(),
            relay_credential: SecretString(encode_id(&*authority.relay_credential)),
            protocol_floor: authority.protocol_floor,
            direct_file_transfers_enabled: authority.direct_file_transfers_enabled,
            opaque_authority: SecretString(encode_id(opaque.as_bytes())),
            password_file: SecretString(encode_id(password.as_bytes())),
            host_resume_key: SecretString(encode_id(&*host_resume)),
            clients: authority
                .clients
                .iter()
                .map(|client| PersistedClient {
                    client_id: encode_id(client.client_id.as_bytes()),
                    client_public_key: SecretString(encode_id(client.client_public_key.as_bytes())),
                    label: client.metadata.label().to_owned(),
                    client_build: client.metadata.client_build().map(ToOwned::to_owned),
                    route_observation: client.metadata.route_observation().map(ToOwned::to_owned),
                    browser_observation: client
                        .metadata
                        .browser_observation()
                        .map(ToOwned::to_owned),
                    created: client.created,
                    last_full_login: client.last_full_login,
                    last_resume: client.last_resume,
                    last_seen: client.last_seen,
                    idle_expires: client.idle_expires,
                    absolute_expires: client.absolute_expires,
                    generation: client.generation.get(),
                })
                .collect(),
            tombstones: authority
                .tombstones
                .iter()
                .map(|tombstone| PersistedTombstone {
                    client_id: encode_id(tombstone.client_id.as_bytes()),
                    label: tombstone.label.clone(),
                    fingerprint: tombstone.fingerprint.clone(),
                    created: tombstone.created,
                    last_seen: tombstone.last_seen,
                    ended: tombstone.ended,
                    state: tombstone.state,
                })
                .collect(),
            events: authority
                .events
                .iter()
                .map(|event| PersistedEvent {
                    event_id: encode_id(event.event_id.as_bytes()),
                    timestamp: event.timestamp,
                    kind: event.kind,
                    result: event.result,
                    client_id: event.client_id.map(|id| encode_id(id.as_bytes())),
                    circuit_id: event.circuit_id.map(|id| encode_id(&id)),
                    authentication_method: event.authentication_method,
                    route: event.route.clone(),
                    client_build: event.client_build.clone(),
                    reason_class: event.reason_class.clone(),
                    direct_file: event.direct_file.clone(),
                })
                .collect(),
            failed_attempts: authority
                .failed_attempts
                .iter()
                .map(|bucket| PersistedFailedBucket {
                    bucket_start: bucket.bucket_start,
                    kind: bucket.kind,
                    route_class: bucket.route_class.clone(),
                    attempts: bucket.attempts,
                })
                .collect(),
            last_status: authority.last_status.clone(),
        }
    }

    fn into_authority(self) -> Result<RemoteAuthority> {
        if self.version != AUTHORITY_VERSION
            || self.generation == 0
            || self.authorization_generation == 0
            || self.protocol_floor == 0
            || self.clients.len() > MAX_AUTHORIZED_CLIENTS
            || self.tombstones.len() > MAX_TOMBSTONES
            || self.events.len() > MAX_SECURITY_EVENTS
            || self.failed_attempts.len() > MAX_FAILED_BUCKETS
        {
            return Err(RemoteAccessError::Corrupt("version or bounds"));
        }
        validate_bounded_text(&self.route, 3, MAX_ROUTE_BYTES, "relay route")
            .map_err(|_| RemoteAccessError::Corrupt("relay route"))?;
        if let Some(status) = &self.last_status {
            validate_bounded_text(status, 1, MAX_OBSERVATION_BYTES, "operational status")
                .map_err(|_| RemoteAccessError::Corrupt("operational status"))?;
        }
        let binding = Binding::new(
            RelayId::new(decode_fixed(&self.relay_id)?),
            Username::parse(&self.username).map_err(|_| RemoteAccessError::Corrupt("username"))?,
            HostId::new(decode_fixed(&self.host_id)?),
        );
        let relay_credential = Zeroizing::new(decode_fixed(&self.relay_credential.0)?);
        validate_relay_credential(&relay_credential)
            .map_err(|_| RemoteAccessError::Corrupt("relay credential"))?;
        let opaque_authority =
            ServerAuthority::from_bytes(&decode_secret(&self.opaque_authority.0)?)?;
        let password_file = PasswordFile::from_bytes(&decode_secret(&self.password_file.0)?)?;
        let host_resume_key = HostResumeKey::from_bytes(&decode_secret(&self.host_resume_key.0)?)?;
        let mut clients = Vec::with_capacity(self.clients.len());
        let mut seen_client_ids = HashSet::new();
        for client in self.clients {
            let client_id = ClientId::new(decode_fixed(&client.client_id)?);
            if !seen_client_ids.insert(client_id) {
                return Err(RemoteAccessError::Corrupt("duplicate client identifier"));
            }
            let metadata = AuthorizationMetadata::new(
                client.label,
                client.client_build,
                client.route_observation,
                client.browser_observation,
            )
            .map_err(|_| RemoteAccessError::Corrupt("client metadata"))?;
            if client.generation == 0
                || client.created > client.last_full_login
                || client.last_full_login > client.last_seen
                || client.last_seen > client.idle_expires
                || client.idle_expires > client.absolute_expires
                || client.absolute_expires
                    != client
                        .last_full_login
                        .saturating_add(ABSOLUTE_LIFETIME_MILLIS)
            {
                return Err(RemoteAccessError::Corrupt("client timestamps"));
            }
            clients.push(AuthorizedClient {
                client_id,
                client_public_key: P256PublicKey::from_bytes(&decode_secret(
                    &client.client_public_key.0,
                )?)?,
                metadata,
                created: client.created,
                last_full_login: client.last_full_login,
                last_resume: client.last_resume,
                last_seen: client.last_seen,
                idle_expires: client.idle_expires,
                absolute_expires: client.absolute_expires,
                generation: AuthorizationGeneration::new(client.generation),
            });
        }
        let mut tombstones = Vec::with_capacity(self.tombstones.len());
        for tombstone in self.tombstones {
            let client_id = ClientId::new(decode_fixed(&tombstone.client_id)?);
            if !seen_client_ids.insert(client_id)
                || tombstone.state == ClientState::Current
                || tombstone.created > tombstone.last_seen
                || tombstone.last_seen > tombstone.ended
            {
                return Err(RemoteAccessError::Corrupt("tombstone"));
            }
            validate_bounded_text(
                &tombstone.label,
                1,
                crate::model::MAX_LABEL_BYTES,
                "browser label",
            )
            .map_err(|_| RemoteAccessError::Corrupt("tombstone label"))?;
            decode_fingerprint(&tombstone.fingerprint)?;
            tombstones.push(Tombstone {
                client_id,
                label: tombstone.label,
                fingerprint: tombstone.fingerprint,
                created: tombstone.created,
                last_seen: tombstone.last_seen,
                ended: tombstone.ended,
                state: tombstone.state,
            });
        }
        let mut seen_event_ids = HashSet::new();
        let mut events = Vec::with_capacity(self.events.len());
        for event in self.events {
            let event_id = EventId::new(decode_fixed(&event.event_id)?);
            if !seen_event_ids.insert(event_id) {
                return Err(RemoteAccessError::Corrupt("duplicate event identifier"));
            }
            validate_optional(&event.route, MAX_ROUTE_BYTES, "event route")?;
            validate_optional(
                &event.client_build,
                MAX_OBSERVATION_BYTES,
                "event client build",
            )?;
            validate_optional(&event.reason_class, MAX_REASON_BYTES, "event reason")?;
            if let Some(details) = &event.direct_file {
                validate_direct_file_audit(details)
                    .map_err(|_| RemoteAccessError::Corrupt("direct-file audit"))?;
            }
            events.push(SecurityEvent {
                event_id,
                timestamp: event.timestamp,
                kind: event.kind,
                result: event.result,
                client_id: event
                    .client_id
                    .as_deref()
                    .map(decode_fixed)
                    .transpose()?
                    .map(ClientId::new),
                circuit_id: event.circuit_id.as_deref().map(decode_fixed).transpose()?,
                authentication_method: event.authentication_method,
                route: event.route,
                client_build: event.client_build,
                reason_class: event.reason_class,
                direct_file: event.direct_file,
            });
        }
        let mut failed_attempts = Vec::with_capacity(self.failed_attempts.len());
        for bucket in self.failed_attempts {
            if bucket.attempts == 0 || bucket.bucket_start.as_millis() % FAILED_BUCKET_MILLIS != 0 {
                return Err(RemoteAccessError::Corrupt("failed attempt bucket"));
            }
            validate_bounded_text(
                &bucket.route_class,
                1,
                MAX_OBSERVATION_BYTES,
                "failed route class",
            )
            .map_err(|_| RemoteAccessError::Corrupt("failed route class"))?;
            failed_attempts.push(FailedAttemptBucket {
                bucket_start: bucket.bucket_start,
                kind: bucket.kind,
                route_class: bucket.route_class,
                attempts: bucket.attempts,
            });
        }
        Ok(RemoteAuthority {
            generation: self.generation,
            authorization_generation: AuthorizationGeneration::new(self.authorization_generation),
            binding,
            route: self.route,
            relay_credential,
            protocol_floor: self.protocol_floor,
            direct_file_transfers_enabled: self.direct_file_transfers_enabled,
            opaque_authority,
            password_file,
            host_resume_key,
            clients,
            tombstones,
            events,
            failed_attempts,
            last_status: self.last_status,
        })
    }
}

fn validate_relay_credential(credential: &[u8; 32]) -> Result<()> {
    SigningKey::from_slice(credential)
        .map(|_| ())
        .map_err(|_| RemoteAccessError::InvalidInput("relay credential"))
}

fn relay_signing_key(credential: &[u8; 32]) -> SigningKey {
    SigningKey::from_slice(credential).expect("validated relay credential remains valid")
}

fn decode_secret(value: &str) -> Result<Zeroizing<Vec<u8>>> {
    base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(value)
        .map(Zeroizing::new)
        .map_err(|_| RemoteAccessError::Corrupt("secret encoding"))
}

fn decode_fingerprint(value: &str) -> Result<()> {
    let _: [u8; 32] = decode_fixed(value)?;
    Ok(())
}

fn validate_optional(value: &Option<String>, maximum: usize, name: &'static str) -> Result<()> {
    if let Some(value) = value {
        validate_bounded_text(value, 1, maximum, name)
            .map_err(|_| RemoteAccessError::Corrupt(name))?;
    }
    Ok(())
}

fn validate_direct_file_audit(details: &DirectFileAuditView) -> Result<()> {
    let torrent = details.torrent_id.as_bytes();
    if torrent.len() != 35
        || !details.torrent_id.starts_with("t1-")
        || !torrent[3..].iter().all(u8::is_ascii_hexdigit)
    {
        return Err(RemoteAccessError::InvalidInput(
            "direct-file torrent identifier",
        ));
    }
    if let Some(candidate_class) = &details.candidate_class
        && !matches!(
            candidate_class.as_str(),
            "host" | "server_reflexive" | "peer_reflexive"
        )
    {
        return Err(RemoteAccessError::InvalidInput(
            "direct-file candidate class",
        ));
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod test_support {
    use p256::ecdsa::{Signature, SigningKey, signature::Signer};
    use rand::SeedableRng;
    use rand_chacha::ChaCha20Rng;

    use super::*;

    pub fn seed(byte: u8) -> OperationSeed {
        OperationSeed::new([byte; 32])
    }

    pub fn provision(now: Timestamp) -> RemoteAuthority {
        RemoteAuthority::provision(
            Username::parse("alice-local").unwrap(),
            b"correct horse battery staple",
            "alice-local",
            1,
            now,
            EventId::new([1; 16]),
            ProvisioningMaterial::new(
                HostId::new([2; 32]),
                RelayId::new([3; 32]),
                [4; 32],
                seed(5),
                seed(6),
                seed(7),
                seed(8),
            ),
        )
        .unwrap()
    }

    pub fn signing_key(byte: u8) -> SigningKey {
        use p256::elliptic_curve::Generate;
        let mut rng = rstorrent_remote_crypto::RngCompat::new(ChaCha20Rng::from_seed([byte; 32]));
        SigningKey::generate_from_rng(&mut rng)
    }

    pub fn public_key(key: &SigningKey) -> P256PublicKey {
        P256PublicKey::from_bytes(key.verifying_key().to_sec1_point(false).as_bytes()).unwrap()
    }

    pub fn authorize(
        authority: &mut RemoteAuthority,
        key: &SigningKey,
        id: u8,
        now: Timestamp,
        event: u8,
    ) -> ClientId {
        let client_id = ClientId::new([id; 16]);
        let client_public_key = public_key(key);
        let metadata = AuthorizationMetadata::new(
            format!("Browser {id}"),
            Some("test-build".to_owned()),
            Some("loopback".to_owned()),
            Some("test browser".to_owned()),
        )
        .unwrap();
        let challenge = AuthorizationChallenge::new([id; 32]);
        let transcript = authorization_transcript(
            authority.binding(),
            authority.host_pin(),
            authority.host_resume_key().public_key(),
            authority.authorization_generation(),
            challenge,
            client_public_key,
            metadata_digest(&metadata),
        );
        let signature: Signature = key.sign(&transcript);
        authority
            .authorize_client(AuthorizationRequest::new(
                client_id,
                client_public_key,
                challenge,
                P256Signature::from_bytes(&signature.to_bytes()).unwrap(),
                metadata,
                now,
                EventId::new([event; 16]),
            ))
            .unwrap();
        client_id
    }
}

#[cfg(test)]
mod tests {
    use p256::ecdsa::{Signature, VerifyingKey, signature::Signer, signature::Verifier};
    use rstorrent_remote_crypto::{
        ClientResumeProof, P256Signature, finish_client_resume, start_client_resume,
    };

    use super::test_support::*;
    use super::*;

    #[test]
    fn relay_credential_is_a_valid_signing_identity() {
        let mut authority = provision(Timestamp::from_millis(1));
        let transcript = b"challenge-bound relay claim";
        let signature =
            Signature::from_slice(authority.sign_relay_transcript(transcript).as_bytes()).unwrap();
        let key = VerifyingKey::from_sec1_bytes(authority.relay_public_key().as_bytes()).unwrap();
        key.verify(transcript, &signature).unwrap();

        let before = authority.security_snapshot();
        assert!(
            authority
                .rotate_relay_credential(
                    [0; 32],
                    Timestamp::from_millis(2),
                    EventId::new([91; 16]),
                )
                .is_err()
        );
        assert_eq!(authority.security_snapshot(), before);
    }

    #[test]
    fn full_login_and_revoked_circuit_close_remain_auditable() {
        let now = Timestamp::from_millis(1_000);
        let mut authority = provision(now);
        let client_id = authorize(&mut authority, &signing_key(92), 93, now, 94);
        authority
            .record_full_login(
                Some(client_id),
                now,
                EventId::new([95; 16]),
                Some("test-build".to_owned()),
            )
            .unwrap();
        authority
            .revoke_client(client_id, now, EventId::new([96; 16]))
            .unwrap();
        authority
            .record_circuit_event(
                false,
                Some(client_id),
                [97; 16],
                AuthenticationMethod::Password,
                now,
                EventId::new([98; 16]),
                Some("owner_revoked".to_owned()),
            )
            .unwrap();
        assert!(
            authority
                .record_circuit_event(
                    true,
                    Some(client_id),
                    [99; 16],
                    AuthenticationMethod::Password,
                    now,
                    EventId::new([100; 16]),
                    None,
                )
                .is_err()
        );
        let snapshot = authority.security_snapshot();
        assert!(
            snapshot
                .events
                .iter()
                .any(|event| event.kind == EventKind::FullLoginSucceeded)
        );
        assert!(
            snapshot
                .events
                .iter()
                .any(|event| event.kind == EventKind::CircuitClosed)
        );
    }

    #[test]
    fn authorization_resume_expiry_and_revocation_are_fenced() {
        let start = Timestamp::from_millis(1_000_000);
        let mut authority = provision(start);
        let key = signing_key(20);
        let client_id = authorize(&mut authority, &key, 21, start, 22);
        assert_eq!(authority.security_snapshot().clients.len(), 1);

        let client_record = &authority.clients[0];
        let context = authority.resume_context(client_record);
        let client_start = start_client_resume(context, seed(23));
        let pending = authority
            .begin_resume(client_id, client_start.hello(), start, seed(24))
            .unwrap();
        let client_finish = finish_client_resume(client_start, pending.challenge()).unwrap();
        let signature: Signature = key.sign(client_finish.client_signature_input());
        let proof =
            ClientResumeProof::new(P256Signature::from_bytes(&signature.to_bytes()).unwrap());
        let mut host_channel = authority
            .finish_resume(pending, proof, start, EventId::new([25; 16]))
            .unwrap();
        let mut client_channel = client_finish.into_channel();
        let record = client_channel.seal(b"command").unwrap();
        assert_eq!(host_channel.open(&record).unwrap().plaintext, b"command");

        authority
            .revoke_client(client_id, start, EventId::new([26; 16]))
            .unwrap();
        let rejected = authority.begin_resume(
            client_id,
            start_client_resume(
                ResumeContext::new(
                    authority.binding().clone(),
                    authority.host_pin(),
                    authority.host_resume_key().public_key(),
                    client_id,
                    public_key(&key),
                    authority.authorization_generation(),
                    AuthorizationGeneration::new(1),
                    1,
                ),
                seed(27),
            )
            .hello(),
            start,
            seed(28),
        );
        assert!(matches!(
            rejected,
            Err(RemoteAccessError::AuthenticationFailed)
        ));
        assert_eq!(authority.security_snapshot().tombstones.len(), 1);
    }

    #[test]
    fn global_generation_and_expiry_drop_proof_material() {
        let start = Timestamp::from_millis(10_000);
        let mut authority = provision(start);
        authorize(&mut authority, &signing_key(30), 31, start, 32);
        authorize(&mut authority, &signing_key(33), 34, start, 35);
        let old_generation = authority.authorization_generation();
        assert_eq!(
            authority
                .require_password_everywhere(
                    start,
                    EventId::new([36; 16]),
                    [EventId::new([37; 16]), EventId::new([38; 16])],
                )
                .unwrap(),
            2
        );
        assert!(authority.authorization_generation().get() > old_generation.get());
        assert!(authority.security_snapshot().clients.is_empty());
        assert_eq!(authority.security_snapshot().tombstones.len(), 2);

        let key = signing_key(39);
        authorize(&mut authority, &key, 40, start, 41);
        let expired_at = start.saturating_add(IDLE_LIFETIME_MILLIS);
        assert_eq!(
            authority
                .expire_clients(expired_at, [EventId::new([42; 16])])
                .unwrap(),
            1
        );
        assert!(authority.security_snapshot().clients.is_empty());
    }

    #[test]
    fn revoke_all_except_keeps_only_the_selected_current_browser() {
        let now = Timestamp::from_millis(10_000);
        let mut authority = provision(now);
        let retained = authorize(&mut authority, &signing_key(43), 44, now, 45);
        authorize(&mut authority, &signing_key(46), 47, now, 48);
        authorize(&mut authority, &signing_key(49), 50, now, 51);

        assert_eq!(
            authority
                .revoke_all_except(
                    retained,
                    now,
                    [EventId::new([52; 16]), EventId::new([53; 16])],
                )
                .unwrap(),
            2
        );
        let snapshot = authority.security_snapshot();
        assert_eq!(snapshot.clients.len(), 1);
        assert_eq!(
            snapshot.clients[0].client_id,
            encode_id(retained.as_bytes())
        );
        assert_eq!(snapshot.tombstones.len(), 2);
    }

    #[test]
    fn failed_attempts_aggregate_without_consuming_security_ledger() {
        let now = Timestamp::from_millis(3 * FAILED_BUCKET_MILLIS);
        let mut authority = provision(now);
        for _ in 0..10_000 {
            authority
                .record_failed_attempt(FailedAttemptKind::Password, "unknown", now)
                .unwrap();
        }
        let snapshot = authority.security_snapshot();
        assert_eq!(snapshot.events.len(), 1);
        assert_eq!(snapshot.failed_attempts.len(), 1);
        assert_eq!(snapshot.failed_attempts[0].attempts, 10_000);
    }

    #[test]
    fn persisted_decoder_rejects_duplicate_authority_records() {
        let authority = provision(Timestamp::from_millis(1));
        let encoded = authority.encode().unwrap();
        let source = String::from_utf8(encoded.to_vec()).unwrap();
        let duplicate = source.replacen("\"version\": 1,", "\"version\": 1,\n  \"version\": 1,", 1);
        assert!(RemoteAuthority::decode(duplicate.as_bytes()).is_err());
    }

    #[test]
    fn transition_validation_is_atomic_without_a_store_wrapper() {
        let now = Timestamp::from_millis(10_000);
        let mut authority = provision(now);
        let first = authorize(&mut authority, &signing_key(50), 51, now, 52);
        authorize(&mut authority, &signing_key(53), 54, now, 55);
        let before = authority.security_snapshot();
        assert!(
            authority
                .require_password_everywhere(now, EventId::new([56; 16]), [EventId::new([57; 16])],)
                .is_err()
        );
        assert_eq!(authority.security_snapshot(), before);

        assert!(
            authority
                .rename_client(first, "Changed", now, EventId::new([1; 16]))
                .is_err()
        );
        assert_eq!(authority.security_snapshot(), before);
        assert!(
            authority
                .revoke_client(first, now, EventId::new([1; 16]))
                .is_err()
        );
        assert_eq!(authority.security_snapshot(), before);
    }

    #[test]
    fn direct_file_setting_and_redacted_audit_survive_round_trip() {
        let now = Timestamp::from_millis(10_000);
        let mut authority = provision(now);
        assert!(authority.direct_file_transfers_enabled());
        assert!(
            authority
                .set_direct_file_transfers_enabled(false, now, EventId::new([20; 16]))
                .unwrap()
        );
        let details = DirectFileAuditView {
            torrent_id: "t1-0123456789abcdef0123456789abcdef".to_owned(),
            file_index: 3,
            byte_count: 0,
            candidate_class: None,
        };
        authority
            .record_direct_file_event(
                EventKind::DirectFileStarted,
                EventResult::Succeeded,
                None,
                [21; 16],
                now,
                EventId::new([22; 16]),
                details,
                None,
            )
            .unwrap();
        authority
            .record_direct_file_event(
                EventKind::DirectFileCompleted,
                EventResult::Succeeded,
                None,
                [21; 16],
                now,
                EventId::new([23; 16]),
                DirectFileAuditView {
                    torrent_id: "t1-0123456789abcdef0123456789abcdef".to_owned(),
                    file_index: 3,
                    byte_count: 65_536,
                    candidate_class: Some("server_reflexive".to_owned()),
                },
                Some("complete".to_owned()),
            )
            .unwrap();

        let decoded = RemoteAuthority::decode(&authority.encode().unwrap()).unwrap();
        assert!(!decoded.direct_file_transfers_enabled());
        let snapshot = decoded.security_snapshot();
        let completed = snapshot
            .events
            .iter()
            .find(|event| event.kind == EventKind::DirectFileCompleted)
            .unwrap();
        assert_eq!(completed.reason_class.as_deref(), Some("complete"));
        assert_eq!(
            completed.direct_file.as_ref().unwrap(),
            &DirectFileAuditView {
                torrent_id: "t1-0123456789abcdef0123456789abcdef".to_owned(),
                file_index: 3,
                byte_count: 65_536,
                candidate_class: Some("server_reflexive".to_owned()),
            }
        );
    }

    #[test]
    fn every_registry_enforces_its_high_water_and_retention() {
        let now = Timestamp::from_millis(FAILED_BUCKET_MILLIS);
        let mut authority = provision(now);
        for index in 0..(MAX_SECURITY_EVENTS + 10) {
            authority
                .push_event(SecurityEvent {
                    event_id: EventId::new((u128::try_from(index).unwrap() + 100).to_be_bytes()),
                    timestamp: Timestamp::from_millis(
                        now.as_millis() + u64::try_from(index).unwrap(),
                    ),
                    kind: EventKind::CircuitOpened,
                    result: EventResult::Succeeded,
                    client_id: None,
                    circuit_id: None,
                    authentication_method: Some(AuthenticationMethod::Password),
                    route: Some("alice-local".to_owned()),
                    client_build: None,
                    reason_class: None,
                    direct_file: None,
                })
                .unwrap();
        }
        assert_eq!(authority.events.len(), MAX_SECURITY_EVENTS);

        let key = signing_key(60);
        let public_key = public_key(&key);
        for index in 0..(MAX_TOMBSTONES + 10) {
            let value = u8::try_from(index + 1).unwrap();
            authority.add_tombstone(
                AuthorizedClient {
                    client_id: ClientId::new([value; 16]),
                    client_public_key: public_key,
                    metadata: AuthorizationMetadata::new(
                        format!("Browser {index}"),
                        None,
                        None,
                        None,
                    )
                    .unwrap(),
                    created: now,
                    last_full_login: now,
                    last_resume: None,
                    last_seen: now,
                    idle_expires: now.saturating_add(IDLE_LIFETIME_MILLIS),
                    absolute_expires: now.saturating_add(ABSOLUTE_LIFETIME_MILLIS),
                    generation: AuthorizationGeneration::new(1),
                },
                ClientState::Revoked,
                Timestamp::from_millis(now.as_millis() + u64::try_from(index).unwrap()),
            );
        }
        assert_eq!(authority.tombstones.len(), MAX_TOMBSTONES);

        for index in 0..(MAX_FAILED_BUCKETS + 10) {
            authority
                .record_failed_attempt(
                    FailedAttemptKind::Resume,
                    format!("route-{index}"),
                    Timestamp::from_millis(
                        now.as_millis() + u64::try_from(index).unwrap() * FAILED_BUCKET_MILLIS,
                    ),
                )
                .unwrap();
        }
        assert_eq!(authority.failed_attempts.len(), MAX_FAILED_BUCKETS);
        assert!(authority.encode().unwrap().len() < 1024 * 1024);

        let after_retention = now.saturating_add(
            SECURITY_RETENTION_MILLIS + u64::try_from(MAX_SECURITY_EVENTS).unwrap() + 11,
        );
        authority
            .push_event(SecurityEvent {
                event_id: EventId::new([99; 16]),
                timestamp: after_retention,
                kind: EventKind::CircuitClosed,
                result: EventResult::Succeeded,
                client_id: None,
                circuit_id: None,
                authentication_method: None,
                route: None,
                client_build: None,
                reason_class: None,
                direct_file: None,
            })
            .unwrap();
        assert!(authority.tombstones.is_empty());
        assert_eq!(authority.events.len(), 1);
        assert!(authority.failed_attempts.is_empty());
    }
}
