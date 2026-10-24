#![forbid(unsafe_code)]
//! Runtime-independent cryptographic core for the controlled remote-access proof.
//!
//! The relay protocol deliberately exposes byte messages rather than runtime,
//! socket, persistence, or application DTO types. Callers own transport and
//! storage. Secret-bearing states intentionally do not implement `Debug` or
//! `Clone`.

mod binding;
mod error;
mod opaque;
mod record;
mod resume;
mod rng_compat;

pub use binding::{Binding, HostId, HostPin, RelayId, Username};
pub use error::{RemoteCryptoError, Result};
pub use opaque::{
    ClientLoginFinish, ClientLoginStart, ClientRegistrationFinish, ClientRegistrationStart,
    PasswordFile, SecretBytes, ServerAuthority, ServerLoginStart, finish_client_login,
    finish_client_registration, finish_server_login, finish_server_registration,
    start_client_login, start_client_registration, start_server_login, start_server_registration,
};
pub use record::{
    APP_CLIENT_MAX_PLAINTEXT, APP_SERVER_MAX_PLAINTEXT, OpenedRecord, RECORD_OVERHEAD, Role,
    SecureChannel,
};
pub use resume::{
    AuthorizationChallenge, AuthorizationGeneration, ClientId, ClientResumeFinish,
    ClientResumeProof, HostResumeKey, P256PublicKey, P256Signature, ResumeClientHello,
    ResumeClientStart, ResumeContext, ResumeServerChallenge, ResumeServerStart,
    authorization_metadata_digest, authorization_transcript, finish_client_resume,
    finish_server_resume, start_client_resume, start_server_resume, verify_authorization_signature,
};
pub use rng_compat::RngCompat;

#[cfg(feature = "ksf-bench")]
pub use opaque::exercise_argon2id_candidate;

/// A deterministic entropy input for one protocol operation.
///
/// The wrapper is intentionally neither printable nor clonable and wipes its
/// owned source bytes on drop.
pub struct OperationSeed(zeroize::Zeroizing<[u8; 32]>);

impl OperationSeed {
    pub fn new(bytes: [u8; 32]) -> Self {
        Self(zeroize::Zeroizing::new(bytes))
    }

    pub(crate) fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

/// Obtain one operation seed from the operating system.
///
/// Browser callers instead supply 32 bytes obtained from Web Crypto through
/// the Wasm binding. Randomness is injected at this narrow boundary so native
/// and Wasm protocol behavior can be compared deterministically.
#[cfg(feature = "native")]
pub fn random_operation_seed() -> Result<OperationSeed> {
    use rand::RngCore;

    let mut seed = zeroize::Zeroizing::new([0_u8; 32]);
    rand::rngs::OsRng
        .try_fill_bytes(&mut *seed)
        .map_err(|_| RemoteCryptoError::RandomnessUnavailable)?;
    Ok(OperationSeed::new(*seed))
}
