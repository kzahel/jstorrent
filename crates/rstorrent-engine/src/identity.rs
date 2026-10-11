//! Stable torrent ownership and protocol-identity lookup.

use std::collections::HashMap;
use std::fmt;
use std::str::FromStr;

use rstorrent_protocol::identity::{
    FullInfoHash, InfoHashes, ProtocolVersion, SwarmKey, V1InfoHash, V2InfoHash,
};
use sha2::{Digest, Sha256};

pub const MAX_TORRENT_OWNERS: usize = 1_024;
pub const MAX_IDENTITY_ALIASES: usize = 2_048;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct TorrentIdentityContext {
    torrent_id: TorrentId,
    info_hashes: InfoHashes,
    swarm_key: SwarmKey,
}

impl TorrentIdentityContext {
    pub fn new(
        torrent_id: TorrentId,
        info_hashes: InfoHashes,
        swarm_key: SwarmKey,
    ) -> Result<Self, TorrentIdentityContextError> {
        let selected = match swarm_key {
            SwarmKey::V1(hash) => info_hashes.v1_hash().is_some_and(|known| known == hash),
            SwarmKey::V2Truncated(bytes) => info_hashes
                .v2_hash()
                .is_some_and(|known| known.swarm_key() == SwarmKey::V2Truncated(bytes)),
        };
        if !selected {
            return Err(TorrentIdentityContextError::UnknownWireIdentity);
        }
        Ok(Self {
            torrent_id,
            info_hashes,
            swarm_key,
        })
    }

    pub fn v1(torrent_id: TorrentId, info_hash: V1InfoHash) -> Self {
        Self {
            torrent_id,
            info_hashes: InfoHashes::v1(info_hash),
            swarm_key: SwarmKey::V1(info_hash),
        }
    }

    pub fn for_full(torrent_id: TorrentId, identity: FullInfoHash) -> Self {
        match identity {
            FullInfoHash::V1(hash) => Self::v1(torrent_id, hash),
            FullInfoHash::V2(hash) => Self {
                torrent_id,
                info_hashes: InfoHashes::v2(hash),
                swarm_key: hash.swarm_key(),
            },
        }
    }

    pub const fn torrent_id(self) -> TorrentId {
        self.torrent_id
    }

    pub const fn info_hashes(self) -> InfoHashes {
        self.info_hashes
    }

    pub const fn swarm_key(self) -> SwarmKey {
        self.swarm_key
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TorrentIdentityContextError {
    UnknownWireIdentity,
}

impl fmt::Display for TorrentIdentityContextError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("selected wire identity is not one of the torrent's full identities")
    }
}

impl std::error::Error for TorrentIdentityContextError {}

/// A stable application and engine owner, independent from protocol identity.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct TorrentId([u8; 16]);

impl TorrentId {
    pub fn new(bytes: [u8; 16]) -> Result<Self, TorrentIdError> {
        if bytes == [0; 16] {
            return Err(TorrentIdError::Zero);
        }
        Ok(Self(bytes))
    }

    pub const fn as_bytes(&self) -> &[u8; 16] {
        &self.0
    }

    pub const fn into_bytes(self) -> [u8; 16] {
        self.0
    }

    pub fn generate() -> Result<Self, getrandom::Error> {
        let mut bytes = [0_u8; 16];
        getrandom::fill(&mut bytes)?;
        bytes[0] |= 0x80;
        Ok(Self(bytes))
    }
}

impl fmt::Display for TorrentId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("t1-")?;
        write_lower_hex(formatter, &self.0)
    }
}

impl FromStr for TorrentId {
    type Err = TorrentIdError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        if value.len() != 35 {
            return Err(TorrentIdError::Length);
        }
        let encoded = value.strip_prefix("t1-").ok_or(TorrentIdError::Prefix)?;
        if !encoded
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(TorrentIdError::Encoding);
        }

        let mut bytes = [0_u8; 16];
        for (output, pair) in bytes.iter_mut().zip(encoded.as_bytes().chunks_exact(2)) {
            *output = (decode_hex_nibble(pair[0]) << 4) | decode_hex_nibble(pair[1]);
        }
        Self::new(bytes)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TorrentIdError {
    Length,
    Prefix,
    Encoding,
    Zero,
}

impl fmt::Display for TorrentIdError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Length => formatter.write_str("torrent ID must be exactly 35 bytes"),
            Self::Prefix => formatter.write_str("torrent ID must begin with t1-"),
            Self::Encoding => formatter.write_str("torrent ID must use lowercase hexadecimal"),
            Self::Zero => formatter.write_str("torrent ID must not be all zero"),
        }
    }
}

impl std::error::Error for TorrentIdError {}

/// SHA-256 over the exact retained raw info dictionary bytes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct ContentFingerprint([u8; 32]);

impl ContentFingerprint {
    pub const fn from_digest(digest: [u8; 32]) -> Self {
        Self(digest)
    }

    pub fn for_info_bytes(info_bytes: &[u8]) -> Self {
        Self(Sha256::digest(info_bytes).into())
    }

    pub const fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    pub const fn into_bytes(self) -> [u8; 32] {
        self.0
    }
}

impl fmt::Display for ContentFingerprint {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write_lower_hex(formatter, &self.0)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IdentityLookup {
    Missing,
    Unique(TorrentId),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WireIdentityLookup {
    Missing,
    Unique(TorrentId),
    Ambiguous,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IdentityMutation {
    Inserted,
    Expanded,
    Unchanged,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IdentityRegistryError {
    UnknownOwner(TorrentId),
    IdentityConflict {
        identity: FullInfoHash,
        existing_owner: TorrentId,
        requested_owner: TorrentId,
    },
    OwnerProtocolConflict {
        owner: TorrentId,
        protocol: ProtocolVersion,
    },
    OwnerLimit {
        limit: usize,
    },
    AliasLimit {
        limit: usize,
    },
}

impl fmt::Display for IdentityRegistryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnknownOwner(owner) => write!(formatter, "unknown torrent owner {owner}"),
            Self::IdentityConflict { identity, .. } => {
                write!(
                    formatter,
                    "{:?} identity already belongs to another owner",
                    identity
                )
            }
            Self::OwnerProtocolConflict { owner, protocol } => write!(
                formatter,
                "torrent owner {owner} already has a different {} identity",
                protocol.as_str()
            ),
            Self::OwnerLimit { limit } => {
                write!(formatter, "torrent owner limit of {limit} reached")
            }
            Self::AliasLimit { limit } => {
                write!(formatter, "identity alias limit of {limit} reached")
            }
        }
    }
}

impl std::error::Error for IdentityRegistryError {}

/// A task-free, bounded mapping between stable owners and protocol identities.
#[derive(Debug)]
pub struct IdentityRegistry {
    owners: HashMap<TorrentId, InfoHashes>,
    full_index: HashMap<FullInfoHash, TorrentId>,
    wire_index: HashMap<SwarmKey, Vec<TorrentId>>,
    owner_limit: usize,
    alias_limit: usize,
}

impl Default for IdentityRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl IdentityRegistry {
    pub fn new() -> Self {
        Self::with_limits(MAX_TORRENT_OWNERS, MAX_IDENTITY_ALIASES)
    }

    fn with_limits(owner_limit: usize, alias_limit: usize) -> Self {
        Self {
            owners: HashMap::new(),
            full_index: HashMap::new(),
            wire_index: HashMap::new(),
            owner_limit,
            alias_limit,
        }
    }

    pub fn owner_count(&self) -> usize {
        self.owners.len()
    }

    pub fn alias_count(&self) -> usize {
        self.full_index.len()
    }

    pub fn identities(&self, owner: TorrentId) -> Option<InfoHashes> {
        self.owners.get(&owner).copied()
    }

    pub fn insert_owner(
        &mut self,
        owner: TorrentId,
        identities: InfoHashes,
    ) -> Result<IdentityMutation, IdentityRegistryError> {
        if self.owners.contains_key(&owner) {
            return self.attach_aliases(owner, identities);
        }
        if self.owners.len() == self.owner_limit {
            return Err(IdentityRegistryError::OwnerLimit {
                limit: self.owner_limit,
            });
        }
        self.preflight_aliases(owner, identities, identities.identity_count())?;

        self.owners.insert(owner, identities);
        identities.for_each(|identity| self.insert_alias(owner, identity));
        Ok(IdentityMutation::Inserted)
    }

    pub fn attach_aliases(
        &mut self,
        owner: TorrentId,
        discovered: InfoHashes,
    ) -> Result<IdentityMutation, IdentityRegistryError> {
        let current = self
            .owners
            .get(&owner)
            .copied()
            .ok_or(IdentityRegistryError::UnknownOwner(owner))?;

        let v1 = combine_identity(owner, current.v1_hash(), discovered.v1_hash())?;
        let v2 = combine_identity(owner, current.v2_hash(), discovered.v2_hash())?;
        let combined = InfoHashes::new(v1, v2).expect("an existing owner is always nonempty");
        let added = combined.identity_count() - current.identity_count();
        if added == 0 {
            return Ok(IdentityMutation::Unchanged);
        }
        self.preflight_aliases(owner, discovered, added)?;

        discovered.for_each(|identity| {
            if !self.full_index.contains_key(&identity) {
                self.insert_alias(owner, identity);
            }
        });
        self.owners.insert(owner, combined);
        Ok(IdentityMutation::Expanded)
    }

    pub fn remove_owner(&mut self, owner: TorrentId) -> Option<InfoHashes> {
        let identities = self.owners.remove(&owner)?;
        identities.for_each(|identity| {
            self.full_index.remove(&identity);
            let wire_key = identity.swarm_key();
            let remove_key = if let Some(members) = self.wire_index.get_mut(&wire_key) {
                members.retain(|member| *member != owner);
                members.is_empty()
            } else {
                false
            };
            if remove_key {
                self.wire_index.remove(&wire_key);
            }
        });
        Some(identities)
    }

    pub fn find_full(&self, identity: FullInfoHash) -> IdentityLookup {
        self.full_index
            .get(&identity)
            .copied()
            .map_or(IdentityLookup::Missing, IdentityLookup::Unique)
    }

    pub fn find_wire(&self, key: SwarmKey) -> WireIdentityLookup {
        match self.wire_index.get(&key).map(Vec::as_slice) {
            None | Some([]) => WireIdentityLookup::Missing,
            Some([owner]) => WireIdentityLookup::Unique(*owner),
            Some(_) => WireIdentityLookup::Ambiguous,
        }
    }

    fn preflight_aliases(
        &self,
        owner: TorrentId,
        identities: InfoHashes,
        added: usize,
    ) -> Result<(), IdentityRegistryError> {
        if self.full_index.len() + added > self.alias_limit {
            return Err(IdentityRegistryError::AliasLimit {
                limit: self.alias_limit,
            });
        }
        let mut conflict = None;
        identities.for_each(|identity| {
            if conflict.is_some() {
                return;
            }
            if let Some(existing_owner) = self.full_index.get(&identity)
                && *existing_owner != owner
            {
                conflict = Some(IdentityRegistryError::IdentityConflict {
                    identity,
                    existing_owner: *existing_owner,
                    requested_owner: owner,
                });
            }
        });
        conflict.map_or(Ok(()), Err)
    }

    fn insert_alias(&mut self, owner: TorrentId, identity: FullInfoHash) {
        self.full_index.insert(identity, owner);
        let members = self.wire_index.entry(identity.swarm_key()).or_default();
        if !members.contains(&owner) {
            members.push(owner);
        }
    }
}

trait ProtocolIdentity: Copy + PartialEq {
    const VERSION: ProtocolVersion;
}

impl ProtocolIdentity for V1InfoHash {
    const VERSION: ProtocolVersion = ProtocolVersion::V1;
}

impl ProtocolIdentity for V2InfoHash {
    const VERSION: ProtocolVersion = ProtocolVersion::V2;
}

fn combine_identity<T: ProtocolIdentity>(
    owner: TorrentId,
    current: Option<T>,
    discovered: Option<T>,
) -> Result<Option<T>, IdentityRegistryError> {
    match (current, discovered) {
        (Some(existing), Some(new)) if existing != new => {
            Err(IdentityRegistryError::OwnerProtocolConflict {
                owner,
                protocol: T::VERSION,
            })
        }
        (Some(existing), _) => Ok(Some(existing)),
        (None, value) => Ok(value),
    }
}

fn decode_hex_nibble(byte: u8) -> u8 {
    match byte {
        b'0'..=b'9' => byte - b'0',
        b'a'..=b'f' => byte - b'a' + 10,
        _ => unreachable!("caller validates lowercase hexadecimal"),
    }
}

fn write_lower_hex(formatter: &mut fmt::Formatter<'_>, bytes: &[u8]) -> fmt::Result {
    for byte in bytes {
        write!(formatter, "{byte:02x}")?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn owner(value: u128) -> TorrentId {
        TorrentId::new(value.to_be_bytes()).unwrap()
    }

    fn v1(value: u8) -> V1InfoHash {
        V1InfoHash::new([value; 20])
    }

    fn v2(value: u8) -> V2InfoHash {
        V2InfoHash::new([value; 32])
    }

    #[test]
    fn torrent_id_round_trips_only_canonical_encoding() {
        let id = TorrentId::new([0xef; 16]).unwrap();
        assert_eq!(id.to_string(), "t1-efefefefefefefefefefefefefefefef");
        assert_eq!(id.to_string().parse(), Ok(id));
        assert_eq!(
            "t1-00000000000000000000000000000000".parse::<TorrentId>(),
            Err(TorrentIdError::Zero)
        );
        assert_eq!(
            "t1-EFEFEFEFEFEFEFEFEFEFEFEFEFEFEFEF".parse::<TorrentId>(),
            Err(TorrentIdError::Encoding)
        );
        assert_eq!(
            "x1-efefefefefefefefefefefefefefefef".parse::<TorrentId>(),
            Err(TorrentIdError::Prefix)
        );
        assert_eq!("t1-ab".parse::<TorrentId>(), Err(TorrentIdError::Length));
    }

    #[test]
    fn generated_torrent_id_is_nonzero_and_canonical() {
        let id = TorrentId::generate().expect("operating-system entropy");
        assert_ne!(id.as_bytes(), &[0; 16]);
        assert_eq!(id.to_string().parse(), Ok(id));
    }

    #[test]
    fn context_requires_the_selected_wire_alias() {
        let id = owner(9);
        let identities = InfoHashes::hybrid(v1(1), v2(2));
        assert_eq!(
            TorrentIdentityContext::new(id, identities, SwarmKey::V1(v1(1)))
                .expect("known v1 wire identity")
                .torrent_id(),
            id
        );
        assert_eq!(
            TorrentIdentityContext::new(id, identities, SwarmKey::V1(v1(3))),
            Err(TorrentIdentityContextError::UnknownWireIdentity)
        );
    }

    #[test]
    fn content_fingerprint_hashes_exact_info_bytes() {
        assert_eq!(
            ContentFingerprint::for_info_bytes(b"abc").to_string(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn inserts_expands_replays_and_removes_one_owner() {
        let mut registry = IdentityRegistry::new();
        let id = owner(1);
        assert_eq!(
            registry.insert_owner(id, InfoHashes::v1(v1(1))),
            Ok(IdentityMutation::Inserted)
        );
        assert_eq!(
            registry.insert_owner(id, InfoHashes::v1(v1(1))),
            Ok(IdentityMutation::Unchanged)
        );
        assert_eq!(
            registry.attach_aliases(id, InfoHashes::v2(v2(2))),
            Ok(IdentityMutation::Expanded)
        );
        assert_eq!(registry.owner_count(), 1);
        assert_eq!(registry.alias_count(), 2);
        assert_eq!(registry.find_full(v1(1).into()), IdentityLookup::Unique(id));
        assert_eq!(registry.find_full(v2(2).into()), IdentityLookup::Unique(id));
        assert_eq!(
            registry.remove_owner(id),
            Some(InfoHashes::hybrid(v1(1), v2(2)))
        );
        assert_eq!(registry.find_full(v1(1).into()), IdentityLookup::Missing);
        assert_eq!(
            registry.find_wire(v2(2).swarm_key()),
            WireIdentityLookup::Missing
        );
    }

    #[test]
    fn alias_conflict_is_atomic() {
        let mut registry = IdentityRegistry::new();
        let first = owner(1);
        let second = owner(2);
        registry.insert_owner(first, InfoHashes::v1(v1(1))).unwrap();

        assert_eq!(
            registry.insert_owner(second, InfoHashes::hybrid(v1(1), v2(2))),
            Err(IdentityRegistryError::IdentityConflict {
                identity: v1(1).into(),
                existing_owner: first,
                requested_owner: second,
            })
        );
        assert_eq!(registry.owner_count(), 1);
        assert_eq!(registry.alias_count(), 1);
        assert_eq!(registry.find_full(v2(2).into()), IdentityLookup::Missing);
    }

    #[test]
    fn same_owner_cannot_replace_one_protocol_identity() {
        let mut registry = IdentityRegistry::new();
        let id = owner(1);
        registry.insert_owner(id, InfoHashes::v1(v1(1))).unwrap();
        assert_eq!(
            registry.attach_aliases(id, InfoHashes::v1(v1(2))),
            Err(IdentityRegistryError::OwnerProtocolConflict {
                owner: id,
                protocol: ProtocolVersion::V1,
            })
        );
        assert_eq!(registry.identities(id), Some(InfoHashes::v1(v1(1))));
    }

    #[test]
    fn truncated_v2_collision_is_ambiguous_until_removal() {
        let mut first_bytes = [3_u8; 32];
        let mut second_bytes = first_bytes;
        first_bytes[31] = 4;
        second_bytes[31] = 5;
        let first_hash = V2InfoHash::new(first_bytes);
        let second_hash = V2InfoHash::new(second_bytes);
        let first = owner(1);
        let second = owner(2);
        let mut registry = IdentityRegistry::new();
        registry
            .insert_owner(first, InfoHashes::v2(first_hash))
            .unwrap();
        registry
            .insert_owner(second, InfoHashes::v2(second_hash))
            .unwrap();

        assert_eq!(
            registry.find_wire(first_hash.swarm_key()),
            WireIdentityLookup::Ambiguous
        );
        assert_eq!(
            registry.find_full(first_hash.into()),
            IdentityLookup::Unique(first)
        );
        assert_eq!(
            registry.find_full(second_hash.into()),
            IdentityLookup::Unique(second)
        );
        registry.remove_owner(first);
        assert_eq!(
            registry.find_wire(second_hash.swarm_key()),
            WireIdentityLookup::Unique(second)
        );
    }

    #[test]
    fn equal_twenty_byte_values_remain_version_separated() {
        let bytes = [7_u8; 20];
        let mut v2_bytes = [7_u8; 32];
        v2_bytes[31] = 8;
        let v1_owner = owner(1);
        let v2_owner = owner(2);
        let mut registry = IdentityRegistry::new();
        registry
            .insert_owner(v1_owner, InfoHashes::v1(V1InfoHash::new(bytes)))
            .unwrap();
        registry
            .insert_owner(v2_owner, InfoHashes::v2(V2InfoHash::new(v2_bytes)))
            .unwrap();

        assert_eq!(
            registry.find_wire(SwarmKey::V1(V1InfoHash::new(bytes))),
            WireIdentityLookup::Unique(v1_owner)
        );
        assert_eq!(
            registry.find_wire(SwarmKey::V2Truncated(bytes)),
            WireIdentityLookup::Unique(v2_owner)
        );
    }

    #[test]
    fn owner_and_alias_limits_fail_before_mutation() {
        let mut owner_limited = IdentityRegistry::with_limits(1, 2);
        owner_limited
            .insert_owner(owner(1), InfoHashes::v1(v1(1)))
            .unwrap();
        assert_eq!(
            owner_limited.insert_owner(owner(2), InfoHashes::v1(v1(2))),
            Err(IdentityRegistryError::OwnerLimit { limit: 1 })
        );
        assert_eq!(owner_limited.owner_count(), 1);

        let mut alias_limited = IdentityRegistry::with_limits(2, 1);
        alias_limited
            .insert_owner(owner(1), InfoHashes::v1(v1(1)))
            .unwrap();
        assert_eq!(
            alias_limited.attach_aliases(owner(1), InfoHashes::v2(v2(2))),
            Err(IdentityRegistryError::AliasLimit { limit: 1 })
        );
        assert_eq!(
            alias_limited.identities(owner(1)),
            Some(InfoHashes::v1(v1(1)))
        );
    }
}
