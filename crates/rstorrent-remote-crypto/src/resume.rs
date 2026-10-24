use hkdf::Hkdf;
use p256::PublicKey;
use p256::ecdh::EphemeralSecret;
use p256::ecdsa::{
    Signature, SigningKey, VerifyingKey,
    signature::{Signer, Verifier},
};
use p256::elliptic_curve::{Generate, rand_core::Rng, sec1::ToSec1Point};
use rand::SeedableRng;
use rand_chacha::ChaCha20Rng;
use sha2::{Digest, Sha256, Sha512};
use zeroize::Zeroizing;

use crate::{
    Binding, HostPin, OperationSeed, RemoteCryptoError, Result, RngCompat, Role, SecureChannel,
};

const CLIENT_HELLO_MAGIC: &[u8; 4] = b"RSU1";
const SERVER_CHALLENGE_MAGIC: &[u8; 4] = b"RSU2";
const CLIENT_PROOF_MAGIC: &[u8; 4] = b"RSU3";
const AUTHORIZATION_DOMAIN: &[u8] = b"rstorrent.remote.authorize.client.v1";
const AUTHORIZATION_METADATA_DOMAIN: &[u8] = b"rstorrent.remote.authorization.metadata.v1";
const RESUME_TRANSCRIPT_DOMAIN: &[u8] = b"rstorrent.remote.resume.transcript.v1";
const RESUME_HOST_PROOF_DOMAIN: &[u8] = b"rstorrent.remote.resume.host-proof.v1";
const RESUME_CLIENT_PROOF_DOMAIN: &[u8] = b"rstorrent.remote.resume.client-proof.v1";
const RESUME_SESSION_LABEL: &[u8] = b"rstorrent.remote.resume.session.v1";

const CLIENT_ID_BYTES: usize = 16;
const NONCE_BYTES: usize = 32;
const P256_PUBLIC_KEY_BYTES: usize = 65;
const P256_SIGNATURE_BYTES: usize = 64;
const CLIENT_HELLO_BYTES: usize = 4 + NONCE_BYTES + P256_PUBLIC_KEY_BYTES;
const SERVER_CHALLENGE_BYTES: usize =
    4 + NONCE_BYTES + P256_PUBLIC_KEY_BYTES + 8 + 8 + 2 + P256_SIGNATURE_BYTES;
const CLIENT_PROOF_BYTES: usize = 4 + P256_SIGNATURE_BYTES;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct ClientId([u8; CLIENT_ID_BYTES]);

impl ClientId {
    pub const fn new(bytes: [u8; CLIENT_ID_BYTES]) -> Self {
        Self(bytes)
    }

    pub const fn as_bytes(&self) -> &[u8; CLIENT_ID_BYTES] {
        &self.0
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct AuthorizationGeneration(u64);

impl AuthorizationGeneration {
    pub const fn new(value: u64) -> Self {
        Self(value)
    }

    pub const fn get(self) -> u64 {
        self.0
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct AuthorizationChallenge([u8; NONCE_BYTES]);

impl AuthorizationChallenge {
    pub const fn new(bytes: [u8; NONCE_BYTES]) -> Self {
        Self(bytes)
    }

    pub const fn as_bytes(&self) -> &[u8; NONCE_BYTES] {
        &self.0
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct P256PublicKey([u8; P256_PUBLIC_KEY_BYTES]);

impl P256PublicKey {
    pub fn from_bytes(encoded: &[u8]) -> Result<Self> {
        let bytes: [u8; P256_PUBLIC_KEY_BYTES] = encoded
            .try_into()
            .map_err(|_| RemoteCryptoError::InvalidIdentifier)?;
        VerifyingKey::from_sec1_bytes(&bytes).map_err(|_| RemoteCryptoError::InvalidIdentifier)?;
        Ok(Self(bytes))
    }

    pub const fn as_bytes(&self) -> &[u8; P256_PUBLIC_KEY_BYTES] {
        &self.0
    }

    fn verifying_key(self) -> Result<VerifyingKey> {
        VerifyingKey::from_sec1_bytes(&self.0).map_err(|_| RemoteCryptoError::InvalidIdentifier)
    }

    fn ecdh_public(self) -> Result<PublicKey> {
        PublicKey::from_sec1_bytes(&self.0).map_err(|_| RemoteCryptoError::InvalidIdentifier)
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct P256Signature([u8; P256_SIGNATURE_BYTES]);

impl P256Signature {
    pub fn from_bytes(encoded: &[u8]) -> Result<Self> {
        let bytes: [u8; P256_SIGNATURE_BYTES] = encoded
            .try_into()
            .map_err(|_| RemoteCryptoError::InvalidMessage)?;
        Signature::from_slice(&bytes).map_err(|_| RemoteCryptoError::InvalidMessage)?;
        Ok(Self(bytes))
    }

    pub const fn as_bytes(&self) -> &[u8; P256_SIGNATURE_BYTES] {
        &self.0
    }

    fn signature(self) -> Result<Signature> {
        Signature::from_slice(&self.0).map_err(|_| RemoteCryptoError::InvalidMessage)
    }
}

/// Protected host signing authority for challenge-bound browser resume.
///
/// The scalar has no `Debug` or `Clone` implementation and is wiped on drop.
pub struct HostResumeKey {
    secret: Zeroizing<[u8; 32]>,
}

impl HostResumeKey {
    pub fn generate(seed: OperationSeed) -> Self {
        let mut rng = rng_from_seed(&seed);
        let signing_key = SigningKey::generate_from_rng(&mut rng);
        Self {
            secret: Zeroizing::new(signing_key.to_bytes().into()),
        }
    }

    pub fn from_bytes(encoded: &[u8]) -> Result<Self> {
        let secret: [u8; 32] = encoded
            .try_into()
            .map_err(|_| RemoteCryptoError::InvalidIdentifier)?;
        SigningKey::from_slice(&secret).map_err(|_| RemoteCryptoError::InvalidIdentifier)?;
        Ok(Self {
            secret: Zeroizing::new(secret),
        })
    }

    pub fn export(&self) -> Zeroizing<[u8; 32]> {
        Zeroizing::new(*self.secret)
    }

    pub fn public_key(&self) -> P256PublicKey {
        public_key_from_verifying_key(self.signing_key().verifying_key())
    }

    fn signing_key(&self) -> SigningKey {
        SigningKey::from_slice(&*self.secret).expect("validated host resume scalar remains valid")
    }

    fn sign(&self, message: &[u8]) -> P256Signature {
        let signature: Signature = self.signing_key().sign(message);
        P256Signature(signature.to_bytes().into())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResumeContext {
    binding: Binding,
    host_pin: HostPin,
    host_resume_public_key: P256PublicKey,
    client_id: ClientId,
    client_public_key: P256PublicKey,
    authorization_generation: AuthorizationGeneration,
    client_generation: AuthorizationGeneration,
    protocol_floor: u16,
}

impl ResumeContext {
    #[allow(clippy::too_many_arguments)]
    pub const fn new(
        binding: Binding,
        host_pin: HostPin,
        host_resume_public_key: P256PublicKey,
        client_id: ClientId,
        client_public_key: P256PublicKey,
        authorization_generation: AuthorizationGeneration,
        client_generation: AuthorizationGeneration,
        protocol_floor: u16,
    ) -> Self {
        Self {
            binding,
            host_pin,
            host_resume_public_key,
            client_id,
            client_public_key,
            authorization_generation,
            client_generation,
            protocol_floor,
        }
    }

    pub fn binding(&self) -> &Binding {
        &self.binding
    }

    pub const fn host_pin(&self) -> HostPin {
        self.host_pin
    }

    pub const fn host_resume_public_key(&self) -> P256PublicKey {
        self.host_resume_public_key
    }

    pub const fn client_id(&self) -> ClientId {
        self.client_id
    }

    pub const fn client_public_key(&self) -> P256PublicKey {
        self.client_public_key
    }

    pub const fn authorization_generation(&self) -> AuthorizationGeneration {
        self.authorization_generation
    }

    pub const fn client_generation(&self) -> AuthorizationGeneration {
        self.client_generation
    }

    pub const fn protocol_floor(&self) -> u16 {
        self.protocol_floor
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResumeClientHello {
    client_nonce: [u8; NONCE_BYTES],
    client_ephemeral_public_key: P256PublicKey,
}

impl ResumeClientHello {
    pub const fn client_nonce(&self) -> &[u8; NONCE_BYTES] {
        &self.client_nonce
    }

    pub const fn client_ephemeral_public_key(&self) -> P256PublicKey {
        self.client_ephemeral_public_key
    }

    pub fn to_bytes(&self) -> [u8; CLIENT_HELLO_BYTES] {
        let mut encoded = [0_u8; CLIENT_HELLO_BYTES];
        encoded[..4].copy_from_slice(CLIENT_HELLO_MAGIC);
        encoded[4..36].copy_from_slice(&self.client_nonce);
        encoded[36..].copy_from_slice(self.client_ephemeral_public_key.as_bytes());
        encoded
    }

    pub fn from_bytes(encoded: &[u8]) -> Result<Self> {
        if encoded.len() != CLIENT_HELLO_BYTES || &encoded[..4] != CLIENT_HELLO_MAGIC {
            return Err(RemoteCryptoError::InvalidMessage);
        }
        let client_nonce = encoded[4..36]
            .try_into()
            .map_err(|_| RemoteCryptoError::InvalidMessage)?;
        let client_ephemeral_public_key = P256PublicKey::from_bytes(&encoded[36..])?;
        Ok(Self {
            client_nonce,
            client_ephemeral_public_key,
        })
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResumeServerChallenge {
    server_nonce: [u8; NONCE_BYTES],
    server_ephemeral_public_key: P256PublicKey,
    authorization_generation: AuthorizationGeneration,
    client_generation: AuthorizationGeneration,
    protocol_floor: u16,
    host_signature: P256Signature,
}

impl ResumeServerChallenge {
    pub fn to_bytes(&self) -> [u8; SERVER_CHALLENGE_BYTES] {
        let mut encoded = [0_u8; SERVER_CHALLENGE_BYTES];
        encoded[..4].copy_from_slice(SERVER_CHALLENGE_MAGIC);
        encoded[4..36].copy_from_slice(&self.server_nonce);
        encoded[36..101].copy_from_slice(self.server_ephemeral_public_key.as_bytes());
        encoded[101..109].copy_from_slice(&self.authorization_generation.get().to_be_bytes());
        encoded[109..117].copy_from_slice(&self.client_generation.get().to_be_bytes());
        encoded[117..119].copy_from_slice(&self.protocol_floor.to_be_bytes());
        encoded[119..].copy_from_slice(self.host_signature.as_bytes());
        encoded
    }

    pub fn from_bytes(encoded: &[u8]) -> Result<Self> {
        if encoded.len() != SERVER_CHALLENGE_BYTES || &encoded[..4] != SERVER_CHALLENGE_MAGIC {
            return Err(RemoteCryptoError::InvalidMessage);
        }
        Ok(Self {
            server_nonce: encoded[4..36]
                .try_into()
                .map_err(|_| RemoteCryptoError::InvalidMessage)?,
            server_ephemeral_public_key: P256PublicKey::from_bytes(&encoded[36..101])?,
            authorization_generation: AuthorizationGeneration::new(u64::from_be_bytes(
                encoded[101..109]
                    .try_into()
                    .map_err(|_| RemoteCryptoError::InvalidMessage)?,
            )),
            client_generation: AuthorizationGeneration::new(u64::from_be_bytes(
                encoded[109..117]
                    .try_into()
                    .map_err(|_| RemoteCryptoError::InvalidMessage)?,
            )),
            protocol_floor: u16::from_be_bytes(
                encoded[117..119]
                    .try_into()
                    .map_err(|_| RemoteCryptoError::InvalidMessage)?,
            ),
            host_signature: P256Signature::from_bytes(&encoded[119..])?,
        })
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ClientResumeProof {
    signature: P256Signature,
}

impl ClientResumeProof {
    pub const fn new(signature: P256Signature) -> Self {
        Self { signature }
    }

    pub const fn signature(&self) -> P256Signature {
        self.signature
    }

    pub fn to_bytes(self) -> [u8; CLIENT_PROOF_BYTES] {
        let mut encoded = [0_u8; CLIENT_PROOF_BYTES];
        encoded[..4].copy_from_slice(CLIENT_PROOF_MAGIC);
        encoded[4..].copy_from_slice(self.signature.as_bytes());
        encoded
    }

    pub fn from_bytes(encoded: &[u8]) -> Result<Self> {
        if encoded.len() != CLIENT_PROOF_BYTES || &encoded[..4] != CLIENT_PROOF_MAGIC {
            return Err(RemoteCryptoError::InvalidMessage);
        }
        Ok(Self::new(P256Signature::from_bytes(&encoded[4..])?))
    }
}

pub struct ResumeClientStart {
    context: ResumeContext,
    ephemeral_secret: EphemeralSecret,
    hello: ResumeClientHello,
}

impl ResumeClientStart {
    pub fn hello(&self) -> &ResumeClientHello {
        &self.hello
    }
}

pub struct ResumeServerStart {
    context: ResumeContext,
    ephemeral_secret: EphemeralSecret,
    client_ephemeral_public_key: P256PublicKey,
    transcript: Vec<u8>,
    challenge: ResumeServerChallenge,
}

impl ResumeServerStart {
    pub fn challenge(&self) -> &ResumeServerChallenge {
        &self.challenge
    }
}

pub struct ClientResumeFinish {
    client_signature_input: Vec<u8>,
    channel: SecureChannel,
}

impl ClientResumeFinish {
    pub fn client_signature_input(&self) -> &[u8] {
        &self.client_signature_input
    }

    pub const fn proof(signature: P256Signature) -> ClientResumeProof {
        ClientResumeProof::new(signature)
    }

    pub fn into_channel(self) -> SecureChannel {
        self.channel
    }
}

pub fn start_client_resume(context: ResumeContext, seed: OperationSeed) -> ResumeClientStart {
    let mut rng = rng_from_seed(&seed);
    let ephemeral_secret = EphemeralSecret::generate_from_rng(&mut rng);
    let client_ephemeral_public_key = public_key_from_ecdh(&ephemeral_secret);
    let mut client_nonce = [0_u8; NONCE_BYTES];
    rng.fill_bytes(&mut client_nonce);
    ResumeClientStart {
        context,
        ephemeral_secret,
        hello: ResumeClientHello {
            client_nonce,
            client_ephemeral_public_key,
        },
    }
}

pub fn start_server_resume(
    host_key: &HostResumeKey,
    context: ResumeContext,
    hello: &ResumeClientHello,
    seed: OperationSeed,
) -> Result<ResumeServerStart> {
    if host_key.public_key() != context.host_resume_public_key {
        return Err(RemoteCryptoError::AuthenticationFailed);
    }
    hello.client_ephemeral_public_key.ecdh_public()?;
    let mut rng = rng_from_seed(&seed);
    let ephemeral_secret = EphemeralSecret::generate_from_rng(&mut rng);
    let server_ephemeral_public_key = public_key_from_ecdh(&ephemeral_secret);
    let mut server_nonce = [0_u8; NONCE_BYTES];
    rng.fill_bytes(&mut server_nonce);
    let transcript = resume_transcript(&context, hello, &server_nonce, server_ephemeral_public_key);
    let host_signature = host_key.sign(&role_transcript(RESUME_HOST_PROOF_DOMAIN, &transcript));
    let challenge = ResumeServerChallenge {
        server_nonce,
        server_ephemeral_public_key,
        authorization_generation: context.authorization_generation,
        client_generation: context.client_generation,
        protocol_floor: context.protocol_floor,
        host_signature,
    };
    Ok(ResumeServerStart {
        context,
        ephemeral_secret,
        client_ephemeral_public_key: hello.client_ephemeral_public_key,
        transcript,
        challenge,
    })
}

pub fn finish_client_resume(
    start: ResumeClientStart,
    challenge: &ResumeServerChallenge,
) -> Result<ClientResumeFinish> {
    if challenge.authorization_generation != start.context.authorization_generation
        || challenge.client_generation != start.context.client_generation
        || challenge.protocol_floor != start.context.protocol_floor
    {
        return Err(RemoteCryptoError::AuthenticationFailed);
    }
    let transcript = resume_transcript(
        &start.context,
        &start.hello,
        &challenge.server_nonce,
        challenge.server_ephemeral_public_key,
    );
    verify_signature(
        start.context.host_resume_public_key,
        &role_transcript(RESUME_HOST_PROOF_DOMAIN, &transcript),
        challenge.host_signature,
    )?;
    let server_public_key = challenge.server_ephemeral_public_key.ecdh_public()?;
    let shared = start.ephemeral_secret.diffie_hellman(&server_public_key);
    let channel = derive_resume_channel(
        Role::Client,
        shared.raw_secret_bytes(),
        &transcript,
        start.context.binding(),
    )?;
    Ok(ClientResumeFinish {
        client_signature_input: role_transcript(RESUME_CLIENT_PROOF_DOMAIN, &transcript),
        channel,
    })
}

pub fn finish_server_resume(
    start: ResumeServerStart,
    proof: ClientResumeProof,
) -> Result<SecureChannel> {
    verify_signature(
        start.context.client_public_key,
        &role_transcript(RESUME_CLIENT_PROOF_DOMAIN, &start.transcript),
        proof.signature,
    )?;
    let client_public_key = start.client_ephemeral_public_key.ecdh_public()?;
    let shared = start.ephemeral_secret.diffie_hellman(&client_public_key);
    derive_resume_channel(
        Role::Host,
        shared.raw_secret_bytes(),
        &start.transcript,
        start.context.binding(),
    )
}

pub fn authorization_transcript(
    binding: &Binding,
    host_pin: HostPin,
    host_resume_public_key: P256PublicKey,
    authorization_generation: AuthorizationGeneration,
    challenge: AuthorizationChallenge,
    client_public_key: P256PublicKey,
    metadata_digest: [u8; 32],
) -> Vec<u8> {
    let mut output = Vec::with_capacity(512);
    append_field(&mut output, AUTHORIZATION_DOMAIN);
    append_field(&mut output, &binding.canonical_bytes());
    append_field(&mut output, &host_pin.to_bytes());
    append_field(&mut output, host_resume_public_key.as_bytes());
    append_field(&mut output, &authorization_generation.get().to_be_bytes());
    append_field(&mut output, challenge.as_bytes());
    append_field(&mut output, client_public_key.as_bytes());
    append_field(&mut output, &metadata_digest);
    output
}

pub fn authorization_metadata_digest(
    label: &str,
    client_build: Option<&str>,
    route_observation: Option<&str>,
    browser_observation: Option<&str>,
) -> [u8; 32] {
    let mut digest = Sha256::new();
    append_digest_field(&mut digest, AUTHORIZATION_METADATA_DOMAIN);
    append_digest_field(&mut digest, label.as_bytes());
    for value in [client_build, route_observation, browser_observation] {
        match value {
            Some(value) => {
                Digest::update(&mut digest, [1]);
                append_digest_field(&mut digest, value.as_bytes());
            }
            None => Digest::update(&mut digest, [0]),
        }
    }
    digest.finalize().into()
}

fn append_digest_field(digest: &mut Sha256, value: &[u8]) {
    Digest::update(
        digest,
        u32::try_from(value.len()).unwrap_or(u32::MAX).to_be_bytes(),
    );
    Digest::update(digest, value);
}

pub fn verify_authorization_signature(
    client_public_key: P256PublicKey,
    transcript: &[u8],
    signature: P256Signature,
) -> Result<()> {
    verify_signature(client_public_key, transcript, signature)
}

fn resume_transcript(
    context: &ResumeContext,
    hello: &ResumeClientHello,
    server_nonce: &[u8; NONCE_BYTES],
    server_ephemeral_public_key: P256PublicKey,
) -> Vec<u8> {
    let mut output = Vec::with_capacity(768);
    append_field(&mut output, RESUME_TRANSCRIPT_DOMAIN);
    append_field(&mut output, &context.binding.canonical_bytes());
    append_field(&mut output, &context.host_pin.to_bytes());
    append_field(&mut output, context.host_resume_public_key.as_bytes());
    append_field(&mut output, context.client_id.as_bytes());
    append_field(
        &mut output,
        &context.authorization_generation.get().to_be_bytes(),
    );
    append_field(&mut output, &context.client_generation.get().to_be_bytes());
    append_field(&mut output, &context.protocol_floor.to_be_bytes());
    append_field(&mut output, &hello.client_nonce);
    append_field(&mut output, hello.client_ephemeral_public_key.as_bytes());
    append_field(&mut output, server_nonce);
    append_field(&mut output, server_ephemeral_public_key.as_bytes());
    output
}

fn role_transcript(domain: &[u8], transcript: &[u8]) -> Vec<u8> {
    let mut output = Vec::with_capacity(domain.len() + transcript.len() + 4);
    append_field(&mut output, domain);
    append_field(&mut output, transcript);
    output
}

fn append_field(output: &mut Vec<u8>, value: &[u8]) {
    let length = u32::try_from(value.len()).expect("resume fields are statically bounded");
    output.extend_from_slice(&length.to_be_bytes());
    output.extend_from_slice(value);
}

fn verify_signature(
    public_key: P256PublicKey,
    message: &[u8],
    signature: P256Signature,
) -> Result<()> {
    public_key
        .verifying_key()?
        .verify(message, &signature.signature()?)
        .map_err(|_| RemoteCryptoError::AuthenticationFailed)
}

fn derive_resume_channel(
    role: Role,
    shared_secret: &[u8],
    transcript: &[u8],
    binding: &Binding,
) -> Result<SecureChannel> {
    if shared_secret.len() != 32 {
        return Err(RemoteCryptoError::KeyDerivationFailed);
    }
    let salt = Sha512::digest(transcript);
    let hkdf = Hkdf::<Sha512>::new(Some(&salt), shared_secret);
    let mut intermediate = Zeroizing::new([0_u8; 64]);
    hkdf.expand(RESUME_SESSION_LABEL, &mut *intermediate)
        .map_err(|_| RemoteCryptoError::KeyDerivationFailed)?;
    SecureChannel::derive(role, &*intermediate, binding)
}

fn public_key_from_ecdh(secret: &EphemeralSecret) -> P256PublicKey {
    let encoded = secret.public_key().to_sec1_point(false);
    P256PublicKey::from_bytes(encoded.as_bytes())
        .expect("generated P-256 public keys use canonical uncompressed SEC1")
}

fn public_key_from_verifying_key(key: &VerifyingKey) -> P256PublicKey {
    let encoded = key.to_sec1_point(false);
    P256PublicKey::from_bytes(encoded.as_bytes())
        .expect("generated P-256 public keys use canonical uncompressed SEC1")
}

fn rng_from_seed(seed: &OperationSeed) -> RngCompat<ChaCha20Rng> {
    RngCompat::new(ChaCha20Rng::from_seed(*seed.as_bytes()))
}

#[cfg(test)]
mod tests {
    use p256::ecdsa::signature::Signer;
    use sha2::Sha256;

    use super::*;
    use crate::{HostId, RelayId, Username};

    fn seed(byte: u8) -> OperationSeed {
        OperationSeed::new([byte; 32])
    }

    fn signing_key(byte: u8) -> SigningKey {
        let mut rng = rng_from_seed(&seed(byte));
        SigningKey::generate_from_rng(&mut rng)
    }

    fn public_key(signing_key: &SigningKey) -> P256PublicKey {
        public_key_from_verifying_key(signing_key.verifying_key())
    }

    #[test]
    fn persisted_key_and_signature_from_p256_0_13_remain_compatible() {
        // First-party synthetic scalar/message, generated with the previously
        // shipped p256 0.13.2 and ECDSA 0.16.9. No upstream test data is copied.
        let decode = |hex: &str| {
            hex.as_bytes()
                .chunks_exact(2)
                .map(|pair| u8::from_str_radix(core::str::from_utf8(pair).unwrap(), 16).unwrap())
                .collect::<Vec<_>>()
        };
        let public = decode(concat!(
            "041e18532fd4754c02f3041d9c75ceb33b83ffd81ac7ce4fe882ccb1c98bc5896ea4",
            "6c311c4e2ff40dd96a3653e6e45445d32dfe486eced75c7a90c6a18881c0a3"
        ));
        let signature = decode(concat!(
            "9ec23917d13cf82238838b9ce668314fb2248e9c8f00f95bfccaf4203dbdd95dd9",
            "d11570a19f788815176ffe9fad4873bb0b86b9de9d9b99a5a814494737cd1a"
        ));
        let key = HostResumeKey::from_bytes(&[7; 32]).unwrap();
        let message = b"JSTorrent persisted P-256 compatibility v1";
        assert_eq!(key.public_key().as_bytes().as_slice(), public);
        assert_eq!(key.sign(message).as_bytes().as_slice(), signature);
        verify_signature(
            P256PublicKey::from_bytes(&public).unwrap(),
            message,
            P256Signature::from_bytes(&signature).unwrap(),
        )
        .unwrap();
    }

    fn test_context(
        host_key: &HostResumeKey,
        client_key: &SigningKey,
        authorization_generation: u64,
    ) -> ResumeContext {
        ResumeContext::new(
            Binding::new(
                RelayId::new([1; 32]),
                Username::parse("alice").unwrap(),
                HostId::new([2; 32]),
            ),
            HostPin::new(HostId::new([2; 32]), [3; 32]),
            host_key.public_key(),
            ClientId::new([4; 16]),
            public_key(client_key),
            AuthorizationGeneration::new(authorization_generation),
            AuthorizationGeneration::new(9),
            1,
        )
    }

    fn complete_resume(
        host_key: &HostResumeKey,
        client_key: &SigningKey,
        context: ResumeContext,
        client_seed: u8,
        server_seed: u8,
    ) -> (
        SecureChannel,
        SecureChannel,
        ResumeServerChallenge,
        ClientResumeProof,
    ) {
        let client = start_client_resume(context.clone(), seed(client_seed));
        let server =
            start_server_resume(host_key, context, client.hello(), seed(server_seed)).unwrap();
        let challenge = server.challenge().clone();
        let client_finish = finish_client_resume(client, &challenge).unwrap();
        let signature: Signature = client_key.sign(client_finish.client_signature_input());
        let proof = ClientResumeProof::new(P256Signature(signature.to_bytes().into()));
        let server_channel = finish_server_resume(server, proof).unwrap();
        (
            client_finish.into_channel(),
            server_channel,
            challenge,
            proof,
        )
    }

    #[test]
    fn host_resume_key_round_trips_without_public_identity_change() {
        let first = HostResumeKey::generate(seed(1));
        let exported = first.export();
        let restored = HostResumeKey::from_bytes(&*exported).unwrap();
        assert_eq!(first.public_key(), restored.public_key());
        assert!(HostResumeKey::from_bytes(&[0; 32]).is_err());
    }

    #[test]
    fn resume_messages_have_one_strict_encoding() {
        let host_key = HostResumeKey::generate(seed(1));
        let client_key = signing_key(2);
        let context = test_context(&host_key, &client_key, 7);
        let client = start_client_resume(context.clone(), seed(3));
        let hello = ResumeClientHello::from_bytes(&client.hello().to_bytes()).unwrap();
        assert_eq!(&hello, client.hello());
        let server = start_server_resume(&host_key, context, &hello, seed(4)).unwrap();
        let challenge = ResumeServerChallenge::from_bytes(&server.challenge().to_bytes()).unwrap();
        assert_eq!(&challenge, server.challenge());

        let signature: Signature = client_key.sign(b"proof");
        let proof = ClientResumeProof::new(P256Signature(signature.to_bytes().into()));
        assert_eq!(
            ClientResumeProof::from_bytes(&proof.to_bytes()).unwrap(),
            proof
        );
        assert_eq!(
            ResumeClientHello::from_bytes(&client.hello().to_bytes()[..100]),
            Err(RemoteCryptoError::InvalidMessage)
        );
    }

    #[test]
    fn mutually_authenticated_resume_derives_fresh_directional_records() {
        let host_key = HostResumeKey::generate(seed(1));
        let client_key = signing_key(2);
        let context = test_context(&host_key, &client_key, 7);
        let (mut client, mut host, _, _) =
            complete_resume(&host_key, &client_key, context.clone(), 10, 11);
        let record = client.seal(b"command").unwrap();
        assert_eq!(host.open(&record).unwrap().plaintext, b"command");
        let reply = host.seal(b"view").unwrap();
        assert_eq!(client.open(&reply).unwrap().plaintext, b"view");

        let (mut next_client, _, _, _) = complete_resume(&host_key, &client_key, context, 12, 13);
        assert_ne!(next_client.seal(b"command").unwrap(), record);
    }

    #[test]
    fn host_client_generation_and_role_substitution_fail_closed() {
        let host_key = HostResumeKey::generate(seed(1));
        let wrong_host_key = HostResumeKey::generate(seed(8));
        let client_key = signing_key(2);
        let context = test_context(&host_key, &client_key, 7);
        let client = start_client_resume(context.clone(), seed(3));
        assert!(
            start_server_resume(&wrong_host_key, context.clone(), client.hello(), seed(4)).is_err()
        );

        let server =
            start_server_resume(&host_key, context.clone(), client.hello(), seed(4)).unwrap();
        let challenge = server.challenge().clone();
        let stale = test_context(&host_key, &client_key, 8);
        let stale_client = start_client_resume(stale, seed(3));
        assert!(finish_client_resume(stale_client, &challenge).is_err());

        let client_finish = finish_client_resume(client, &challenge).unwrap();
        let reflected: Signature = host_key
            .signing_key()
            .sign(client_finish.client_signature_input());
        let proof = ClientResumeProof::new(P256Signature(reflected.to_bytes().into()));
        assert!(finish_server_resume(server, proof).is_err());
    }

    #[test]
    fn replayed_proof_does_not_authenticate_a_fresh_challenge() {
        let host_key = HostResumeKey::generate(seed(1));
        let client_key = signing_key(2);
        let context = test_context(&host_key, &client_key, 7);
        let (_, _, _, old_proof) = complete_resume(&host_key, &client_key, context.clone(), 10, 11);
        let client = start_client_resume(context.clone(), seed(12));
        let server = start_server_resume(&host_key, context, client.hello(), seed(13)).unwrap();
        assert!(finish_server_resume(server, old_proof).is_err());
    }

    #[test]
    fn authorization_proof_binds_metadata_and_generation() {
        let host_key = HostResumeKey::generate(seed(1));
        let client_key = signing_key(2);
        let binding = Binding::new(
            RelayId::new([1; 32]),
            Username::parse("alice").unwrap(),
            HostId::new([2; 32]),
        );
        let pin = HostPin::new(HostId::new([2; 32]), [3; 32]);
        let metadata_digest: [u8; 32] = Sha256::digest(b"browser label").into();
        let transcript = authorization_transcript(
            &binding,
            pin,
            host_key.public_key(),
            AuthorizationGeneration::new(7),
            AuthorizationChallenge::new([8; 32]),
            public_key(&client_key),
            metadata_digest,
        );
        let signature: Signature = client_key.sign(&transcript);
        let signature = P256Signature(signature.to_bytes().into());
        assert!(
            verify_authorization_signature(public_key(&client_key), &transcript, signature).is_ok()
        );

        let mut changed = transcript;
        let last = changed.len() - 1;
        changed[last] ^= 1;
        assert_eq!(
            verify_authorization_signature(public_key(&client_key), &changed, signature),
            Err(RemoteCryptoError::AuthenticationFailed)
        );
    }

    #[test]
    fn public_keys_and_signatures_reject_noncanonical_lengths_and_points() {
        assert_eq!(
            P256PublicKey::from_bytes(&[0; 65]),
            Err(RemoteCryptoError::InvalidIdentifier)
        );
        assert_eq!(
            P256PublicKey::from_bytes(&[4; 64]),
            Err(RemoteCryptoError::InvalidIdentifier)
        );
        assert_eq!(
            P256Signature::from_bytes(&[0; 63]),
            Err(RemoteCryptoError::InvalidMessage)
        );
    }
}
