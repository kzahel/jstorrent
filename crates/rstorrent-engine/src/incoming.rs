//! One session listener with generation-fenced torrent routing.

mod peer_io;
mod upload_runtime;

use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};
use std::error::Error;
use std::fmt;
use std::io;
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, Weak};
use std::time::Duration;

use rstorrent_protocol::content::{HybridPaddingMap, TorrentContent, TorrentIntegrity};
use rstorrent_protocol::extension::{
    ExtensionAdvertisement, ExtensionHandshake, ExtensionMap, ExtensionUpdate, PexFlags,
    UT_PEX_LOCAL_ID, encode_extension_handshake as encode_recognized_extension_handshake,
    encode_extension_handshake_update,
    parse_extension_handshake as parse_recognized_extension_handshake,
};
use rstorrent_protocol::identity::{InfoHashes, SwarmKey, V1InfoHash};
use rstorrent_protocol::merkle::{MERKLE_BLOCK_SIZE, MerkleAccumulator, hash_block, zero_hash};
use rstorrent_protocol::metadata::{
    MetadataExtensionUpdate, MetadataMessage, MetadataUpload, MetadataUploadAction,
    UT_METADATA_LOCAL_ID, encode_metadata_data, encode_metadata_reject, parse_extension_handshake,
    parse_metadata_message,
};
use rstorrent_protocol::metainfo::DURABLE_METAINFO_LIMITS;
use rstorrent_protocol::mse::{
    DH_PRIVATE_EXPONENT_LEN, MSE_KNOWN_METHODS, MSE_MAX_PADDING_LEN, MseAction, MseCipherPair,
    MseHandshake, MseMethod, MsePadding, MseResume, MseRole, MseStep, req2_hash,
};
use rstorrent_protocol::peer_wire::{
    BlockRequest, HANDSHAKE_LENGTH, MAX_REQUEST_BLOCK_LENGTH, NegotiatedPeerCapabilities,
    PeerMessage, PeerProtocol, decode_handshake, encode_handshake_with_reserved,
    hybrid_response_key,
};
use rstorrent_protocol::v2_hashes::{HashRequest, HashResponse, V2FileHashGeometry, V2HashCatalog};
use sha1::{Digest, Sha1};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpSocket, UdpSocket};
use tokio::sync::{Mutex as AsyncMutex, OwnedSemaphorePermit, Semaphore};
use tokio::task::{JoinHandle, JoinSet};
use tokio::time::{Instant, timeout_at};
use tokio_util::sync::CancellationToken;

use crate::metrics::{ByteMetric, ByteMetricSink};
use crate::mse::{
    MseDhWorkOwner, MseHandshakeAccounting, MseHandshakeFailure, MseHandshakeOutcome,
    MseHandshakeSink, record_mse_handshake,
};
use crate::network::{
    DEFAULT_PEER_ID, NetworkPolicy, PeerEncryptionPolicy, PeerExchangePolicyHandle,
};
use crate::peer::{PeerEndpoint, PeerFailure};
use crate::peer_budget::{
    DEFAULT_LISTEN_BACKLOG, PeerBudget, PeerBudgetDirection, PeerBudgetPermit, PeerBudgetSnapshot,
};
use crate::peer_io::{PeerIo, record_bytes};
use crate::peer_runtime::{PeerConnectionRole, PeerTransport, PeerUploadActivity, PeerUploadGrant};
use crate::peer_socket::advertised_reserved_bits;
use crate::peer_stream::PeerStream;
use crate::pex::{PexReceiveContext, PexReceiveDisposition};
use crate::piece_availability::AvailabilityDrain;
use crate::seed_content::SeedContent;
use crate::swarm::MAX_FAST_ADVISORY_PIECES;
use crate::torrent_peer::{
    INCOMING_CONTENT_COMMAND_CAPACITY, IncomingContentCapabilities, IncomingContentCommand,
    IncomingContentEvent, IncomingPeerAttachment, TorrentPeerHandle,
};
use crate::upload::{MAX_GENERATED_ALLOWED_FAST_PIECES, generate_allowed_fast_set};
use crate::upload::{UploadAction, UploadCloseReason, UploadPeerState, UploadRead};
use crate::upload_scheduler::{UploadGrant, UploadSchedulerConfig, UploadSchedulerSnapshot};
use crate::utp_runtime::UtpStream;

use self::peer_io::{FrameValidity, IncomingPeerIo};
use self::upload_runtime::UploadCoordinator;
use crate::active_seed_content::ActiveSeedContent;

pub const MAX_SEED_REGISTRATIONS: usize = 1024;
pub const MAX_INCOMING_PENDING: usize = 8;
pub const DEFAULT_UPLOAD_READ_JOBS: usize = 10;
pub const MAX_CONFIGURED_UPLOAD_READ_JOBS: usize = 1_024;
pub const MAX_DEFERRED_METADATA_REQUESTS: usize = 1_024;
pub const MAX_V2_HASH_SERVICE_JOBS_PER_TORRENT: usize = 8;
pub const METADATA_SEND_BUFFER_WATERMARK: usize = 160 * 1_024;
pub const DEFAULT_INCOMING_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
pub const DEFAULT_INCOMING_PEER_ACTIVITY_TIMEOUT: Duration = Duration::from_secs(120);
pub const DEFAULT_INCOMING_KEEPALIVE_INTERVAL: Duration = Duration::from_secs(60);
pub const DEFAULT_INCOMING_NO_REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
pub const DEFAULT_INCOMING_INACTIVITY_TIMEOUT: Duration = Duration::from_secs(600);
pub const MAX_INCOMING_WRITER_BYTES: usize = peer_io::MAX_INCOMING_WRITER_BYTES;
pub const INCOMING_WRITER_NO_PROGRESS_TIMEOUT: Duration =
    peer_io::INCOMING_WRITER_NO_PROGRESS_TIMEOUT;
const MAX_RECENT_REJECTIONS: usize = 32;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum IncomingTcpBootstrap {
    #[default]
    Disabled,
    AutomaticLoopback,
    FixedLoopback(u16),
    AutomaticLocalNetwork,
    FixedLocalNetwork(u16),
}

#[derive(Clone, Debug)]
pub struct IncomingPeerServiceConfig {
    pub bootstrap: IncomingTcpBootstrap,
    pub handshake_timeout: Duration,
    pub peer_activity_timeout: Duration,
    pub keepalive_interval: Duration,
    pub no_request_timeout: Duration,
    pub inactivity_timeout: Duration,
    pub peer_id: [u8; 20],
    pub byte_metric_sink: Option<Arc<dyn ByteMetricSink>>,
    pub mse_handshake_sink: Option<Arc<dyn MseHandshakeSink>>,
    pub peer_budget: PeerBudget,
    pub upload_scheduler: UploadSchedulerConfig,
    pub upload_read_jobs: usize,
    pub encryption: PeerEncryptionPolicy,
    pub peer_exchange: PeerExchangePolicyHandle,
    pub mse_dh: MseDhWorkOwner,
}

impl IncomingPeerServiceConfig {
    pub fn new(bootstrap: IncomingTcpBootstrap) -> Self {
        Self {
            bootstrap,
            handshake_timeout: DEFAULT_INCOMING_HANDSHAKE_TIMEOUT,
            peer_activity_timeout: DEFAULT_INCOMING_PEER_ACTIVITY_TIMEOUT,
            keepalive_interval: DEFAULT_INCOMING_KEEPALIVE_INTERVAL,
            no_request_timeout: DEFAULT_INCOMING_NO_REQUEST_TIMEOUT,
            inactivity_timeout: DEFAULT_INCOMING_INACTIVITY_TIMEOUT,
            peer_id: DEFAULT_PEER_ID,
            byte_metric_sink: None,
            mse_handshake_sink: None,
            peer_budget: PeerBudget::system_default(),
            upload_scheduler: UploadSchedulerConfig::default(),
            upload_read_jobs: DEFAULT_UPLOAD_READ_JOBS,
            encryption: PeerEncryptionPolicy::Allow,
            peer_exchange: crate::PeerExchangePolicyHandle::default(),
            mse_dh: MseDhWorkOwner::new(),
        }
    }

    pub fn with_peer_budget(mut self, peer_budget: PeerBudget) -> Self {
        self.peer_budget = peer_budget;
        self
    }

    pub fn with_encryption(mut self, encryption: PeerEncryptionPolicy) -> Self {
        self.encryption = encryption;
        self
    }

    pub fn with_peer_exchange(mut self, peer_exchange: PeerExchangePolicyHandle) -> Self {
        self.peer_exchange = peer_exchange;
        self
    }

    pub fn with_mse_dh(mut self, mse_dh: MseDhWorkOwner) -> Self {
        self.mse_dh = mse_dh;
        self
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SeedRegistrationToken {
    pub swarm_key: SwarmKey,
    pub generation: u64,
}

#[derive(Clone, Debug)]
pub struct SeedRegistration {
    swarm_key: SwarmKey,
    info_hashes: InfoHashes,
    raw_info: Arc<[u8]>,
    content: RegisteredSeedContent,
    piece_lengths: Arc<[u32]>,
    hybrid_padding: Option<HybridPaddingMap>,
    torrent_peers: TorrentPeerHandle,
    private: bool,
    v2_hashes: Option<Arc<V2SeedHashService>>,
    byte_metric_sink: Option<Arc<dyn ByteMetricSink>>,
}

#[derive(Debug)]
pub(crate) struct V2SeedHashService {
    content: TorrentContent,
    catalog: Mutex<V2HashCatalog>,
    jobs: Semaphore,
}

#[derive(Clone, Debug)]
enum RegisteredSeedContent {
    Complete(SeedContent),
    Active(ActiveSeedContent),
}

impl RegisteredSeedContent {
    const fn local_complete(&self) -> bool {
        matches!(self, Self::Complete(_))
    }

    fn upload_state(&self, piece_lengths: Arc<[u32]>) -> Result<UploadPeerState, ()> {
        match self {
            Self::Complete(content) => UploadPeerState::from_shared(
                piece_lengths,
                Arc::<[bool]>::from(content.availability()),
            )
            .map_err(|_| ()),
            Self::Active(content) => {
                UploadPeerState::from_availability(piece_lengths, content.availability())
                    .map_err(|_| ())
            }
        }
    }

    async fn read_block(&self, request: BlockRequest) -> Result<Vec<u8>, ()> {
        match self {
            Self::Complete(content) => content.read_block(request).await.map_err(|_| ()),
            Self::Active(content) => content.read_block(request).await.map_err(|_| ()),
        }
    }
}

impl V2SeedHashService {
    pub(crate) fn new(content: TorrentContent, catalog: V2HashCatalog) -> Arc<Self> {
        Arc::new(Self {
            content,
            catalog: Mutex::new(catalog),
            jobs: Semaphore::new(MAX_V2_HASH_SERVICE_JOBS_PER_TORRENT),
        })
    }

    fn from_raw_info(
        raw_info: &[u8],
        swarm_key: SwarmKey,
    ) -> Result<Option<Arc<Self>>, IncomingPeerError> {
        if !matches!(swarm_key, SwarmKey::V2Truncated(_)) {
            return Ok(None);
        }
        let runtime =
            TorrentContent::from_v2_info_bytes_with_limits(raw_info, DURABLE_METAINFO_LIMITS)
                .or_else(|_| {
                    TorrentContent::from_hybrid_info_bytes_with_limits(
                        raw_info,
                        DURABLE_METAINFO_LIMITS,
                    )
                })
                .map_err(|_| {
                    IncomingPeerError::InvalidRegistration(
                        "v2 seed metadata is not strict v2 content",
                    )
                })?;
        if !runtime.content.swarm_keys().any(|key| key == swarm_key) {
            return Err(IncomingPeerError::InvalidRegistration(
                "v2 seed metadata and swarm key differ",
            ));
        }
        let (TorrentIntegrity::V2(catalog) | TorrentIntegrity::Hybrid(catalog)) = runtime.integrity
        else {
            return Err(IncomingPeerError::InvalidRegistration(
                "v2 seed metadata has non-v2 integrity",
            ));
        };
        Ok(Some(Self::new(runtime.content, catalog)))
    }

    pub(crate) fn replace_catalog(&self, catalog: V2HashCatalog) {
        *self
            .catalog
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = catalog;
    }

    pub(crate) async fn response_active(
        &self,
        seed: &ActiveSeedContent,
        request: HashRequest,
    ) -> Result<HashResponse, ()> {
        self.response(&RegisteredSeedContent::Active(seed.clone()), request)
            .await
    }

    async fn response(
        &self,
        seed: &RegisteredSeedContent,
        request: HashRequest,
    ) -> Result<HashResponse, ()> {
        let _job = self.jobs.acquire().await.map_err(|_| ())?;
        let geometry = self
            .content
            .v2_hash_geometry_for_root(request.pieces_root)
            .map_err(|_| ())?
            .ok_or(())?;
        let catalog = self
            .catalog
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        if let Ok(response) = catalog.response_for(geometry, request, true) {
            return Ok(response);
        }
        let piece_layer = geometry.piece_layer().map_err(|_| ())?;
        if request.base_layer == u32::from(piece_layer) {
            let mut reconstructed = catalog.clone();
            self.ensure_piece_layer(seed, geometry, &mut reconstructed)
                .await?;
            let response = reconstructed
                .response_for(geometry, request, true)
                .map_err(|_| ())?;
            let mut current = self
                .catalog
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if *current == catalog {
                *current = reconstructed;
            }
            return Ok(response);
        }
        if request.base_layer != 0 {
            return Err(());
        }

        let leaves_per_piece = 1_u64.checked_shl(u32::from(piece_layer)).ok_or(())?;
        let request_end = u64::from(request.index)
            .checked_add(u64::from(request.count))
            .ok_or(())?;
        let first_local_piece = u64::from(request.index) / leaves_per_piece;
        let last_local_piece = request_end.div_ceil(leaves_per_piece);
        let supplied_leaf_start = first_local_piece.checked_mul(leaves_per_piece).ok_or(())?;
        let supplied_count = last_local_piece
            .checked_sub(first_local_piece)
            .and_then(|pieces| pieces.checked_mul(leaves_per_piece))
            .and_then(|count| usize::try_from(count).ok())
            .ok_or(())?;
        let mut supplied = Vec::with_capacity(supplied_count);
        for local_piece in first_local_piece..last_local_piece {
            if local_piece < u64::from(geometry.piece_count) {
                let global_piece = u64::from(geometry.first_piece)
                    .checked_add(local_piece)
                    .and_then(|piece| u32::try_from(piece).ok())
                    .ok_or(())?;
                supplied.extend(self.read_piece_leaves(seed, global_piece).await?);
            }
            let target_length = usize::try_from(
                local_piece
                    .checked_sub(first_local_piece)
                    .and_then(|piece| piece.checked_add(1))
                    .and_then(|pieces| pieces.checked_mul(leaves_per_piece))
                    .ok_or(())?,
            )
            .map_err(|_| ())?;
            supplied.resize(target_length, zero_hash(0).map_err(|_| ())?);
        }
        catalog
            .response_from_authenticated_leaves(
                geometry,
                request,
                supplied_leaf_start,
                &supplied,
                true,
            )
            .map_err(|_| ())
    }

    async fn ensure_piece_layer(
        &self,
        seed: &RegisteredSeedContent,
        geometry: V2FileHashGeometry,
        catalog: &mut V2HashCatalog,
    ) -> Result<(), ()> {
        if catalog.piece_root(geometry.first_piece).is_some() {
            return Ok(());
        }
        let mut roots = Vec::with_capacity(geometry.piece_count as usize);
        for piece in geometry.first_piece..geometry.first_piece + geometry.piece_count {
            let leaves = self.read_piece_leaves(seed, piece).await?;
            let mut accumulator = MerkleAccumulator::new(0).map_err(|_| ())?;
            for leaf in leaves {
                accumulator.push(leaf).map_err(|_| ())?;
            }
            roots.push(
                accumulator
                    .finish_padded_to(geometry.piece_layer().map_err(|_| ())?)
                    .map_err(|_| ())?,
            );
        }
        catalog
            .seed_complete_piece_layer(geometry, &roots)
            .map_err(|_| ())
    }

    async fn read_piece_leaves(
        &self,
        seed: &RegisteredSeedContent,
        piece: u32,
    ) -> Result<Vec<[u8; 32]>, ()> {
        let length = self.content.v2_piece(piece).map_err(|_| ())?.payload_length;
        let mut leaves = Vec::with_capacity(
            usize::try_from(u64::from(length).div_ceil(MERKLE_BLOCK_SIZE as u64))
                .map_err(|_| ())?,
        );
        let mut begin = 0_u32;
        while begin < length {
            let block_length = (length - begin).min(MERKLE_BLOCK_SIZE as u32);
            let block = seed
                .read_block(BlockRequest {
                    index: piece,
                    begin,
                    length: block_length,
                })
                .await?;
            if block.len() != block_length as usize {
                return Err(());
            }
            leaves.push(hash_block(&block).map_err(|_| ())?);
            begin = begin.checked_add(block_length).ok_or(())?;
        }
        Ok(leaves)
    }
}

impl SeedRegistration {
    pub fn new(
        raw_info: Vec<u8>,
        content: SeedContent,
        torrent_peers: TorrentPeerHandle,
    ) -> Result<Self, IncomingPeerError> {
        let info_hash: [u8; 20] = Sha1::digest(&raw_info).into();
        Self::new_with_swarm_key(
            raw_info,
            SwarmKey::V1(info_hash.into()),
            content,
            torrent_peers,
        )
    }

    pub fn new_with_swarm_key(
        raw_info: Vec<u8>,
        swarm_key: SwarmKey,
        content: SeedContent,
        torrent_peers: TorrentPeerHandle,
    ) -> Result<Self, IncomingPeerError> {
        let info_hash = swarm_key.into_bytes();
        if !content.supports_swarm_key(swarm_key)
            || matches!(swarm_key, SwarmKey::V1(_))
                && <[u8; 20]>::from(Sha1::digest(&raw_info)) != info_hash
        {
            return Err(IncomingPeerError::InvalidRegistration(
                "metadata and seed content identities differ",
            ));
        }
        let runtime =
            TorrentContent::from_v2_info_bytes_with_limits(&raw_info, DURABLE_METAINFO_LIMITS)
                .or_else(|_| {
                    TorrentContent::from_hybrid_info_bytes_with_limits(
                        &raw_info,
                        DURABLE_METAINFO_LIMITS,
                    )
                })
                .ok();
        let info_hashes = match &runtime {
            Some(runtime) => runtime.content.info_hashes(),
            None => match swarm_key {
                SwarmKey::V1(hash) => InfoHashes::v1(hash),
                SwarmKey::V2Truncated(_) => {
                    return Err(IncomingPeerError::InvalidRegistration(
                        "v2 seed metadata is not strict v2 content",
                    ));
                }
            },
        };
        let mut known = false;
        info_hashes.for_each(|identity| known |= identity.swarm_key() == swarm_key);
        if !known {
            return Err(IncomingPeerError::InvalidRegistration(
                "metadata and seed swarm key differ",
            ));
        }
        let raw_info: Arc<[u8]> = raw_info.into();
        MetadataUpload::new(&raw_info).map_err(|_| {
            IncomingPeerError::InvalidRegistration("metadata exceeds upload limits")
        })?;
        let piece_lengths = if let Some(runtime) = runtime
            .as_ref()
            .filter(|runtime| runtime.content.hybrid_padding().is_some())
        {
            (0..runtime.content.piece_count())
                .map(|piece| {
                    runtime
                        .content
                        .hybrid_peer_piece_length_at(piece.try_into().map_err(|_| ())?)
                        .map_err(|_| ())
                })
                .collect::<Result<Vec<_>, _>>()
                .map_err(|_| {
                    IncomingPeerError::InvalidRegistration("invalid hybrid peer geometry")
                })?
        } else {
            content.piece_lengths().map_err(|_| {
                IncomingPeerError::InvalidRegistration("invalid seed piece geometry")
            })?
        };
        let private = content.is_private();
        let v2_hashes = V2SeedHashService::from_raw_info(&raw_info, swarm_key)?;
        Ok(Self {
            swarm_key,
            info_hashes,
            raw_info,
            content: RegisteredSeedContent::Complete(content),
            piece_lengths: piece_lengths.into(),
            hybrid_padding: runtime.and_then(|runtime| runtime.content.hybrid_padding().cloned()),
            torrent_peers,
            private,
            v2_hashes,
            byte_metric_sink: None,
        })
    }

    #[cfg(test)]
    pub(crate) fn new_active(
        raw_info: Arc<[u8]>,
        content: ActiveSeedContent,
        torrent_peers: TorrentPeerHandle,
    ) -> Result<Self, IncomingPeerError> {
        let info_hash: [u8; 20] = Sha1::digest(&raw_info).into();
        Self::new_active_with_swarm_key(
            raw_info,
            SwarmKey::V1(info_hash.into()),
            content,
            torrent_peers,
            None,
        )
    }

    pub(crate) fn new_active_with_swarm_key(
        raw_info: Arc<[u8]>,
        swarm_key: SwarmKey,
        content: ActiveSeedContent,
        torrent_peers: TorrentPeerHandle,
        shared_v2_hashes: Option<Arc<V2SeedHashService>>,
    ) -> Result<Self, IncomingPeerError> {
        let info_hash = swarm_key.into_bytes();
        let runtime =
            TorrentContent::from_v2_info_bytes_with_limits(&raw_info, DURABLE_METAINFO_LIMITS)
                .or_else(|_| {
                    TorrentContent::from_hybrid_info_bytes_with_limits(
                        &raw_info,
                        DURABLE_METAINFO_LIMITS,
                    )
                })
                .ok();
        let info_hashes = match &runtime {
            Some(runtime) => runtime.content.info_hashes(),
            None => match swarm_key {
                SwarmKey::V1(hash) => InfoHashes::v1(hash),
                SwarmKey::V2Truncated(_) => {
                    return Err(IncomingPeerError::InvalidRegistration(
                        "v2 active seed metadata is not strict v2 content",
                    ));
                }
            },
        };
        let mut selected_known = false;
        info_hashes.for_each(|identity| selected_known |= identity.swarm_key() == swarm_key);
        let mut content_known = false;
        info_hashes.for_each(|identity| {
            content_known |= identity.swarm_key().into_bytes() == content.info_hash()
        });
        if !selected_known
            || !content_known
            || matches!(swarm_key, SwarmKey::V1(_))
                && <[u8; 20]>::from(Sha1::digest(&raw_info)) != info_hash
        {
            return Err(IncomingPeerError::InvalidRegistration(
                "metadata and active seed content identities differ",
            ));
        }
        MetadataUpload::new(&raw_info).map_err(|_| {
            IncomingPeerError::InvalidRegistration("metadata exceeds upload limits")
        })?;
        let piece_lengths = if let Some(runtime) = runtime
            .as_ref()
            .filter(|runtime| runtime.content.hybrid_padding().is_some())
        {
            (0..runtime.content.piece_count())
                .map(|piece| {
                    runtime
                        .content
                        .hybrid_peer_piece_length_at(piece.try_into().map_err(|_| ())?)
                        .map_err(|_| ())
                })
                .collect::<Result<Vec<_>, _>>()
                .map(Arc::from)
                .map_err(|_| {
                    IncomingPeerError::InvalidRegistration("invalid hybrid peer geometry")
                })?
        } else {
            content.piece_lengths()
        };
        let private = content.is_private();
        let v2_hashes = match (swarm_key, shared_v2_hashes) {
            (SwarmKey::V2Truncated(_), Some(service)) => Some(service),
            (SwarmKey::V2Truncated(_), None) => {
                V2SeedHashService::from_raw_info(&raw_info, swarm_key)?
            }
            (SwarmKey::V1(_), None) => None,
            (SwarmKey::V1(_), Some(_)) => {
                return Err(IncomingPeerError::InvalidRegistration(
                    "v1 active seed received a v2 hash service",
                ));
            }
        };
        Ok(Self {
            swarm_key,
            info_hashes,
            raw_info,
            content: RegisteredSeedContent::Active(content),
            piece_lengths,
            hybrid_padding: runtime.and_then(|runtime| runtime.content.hybrid_padding().cloned()),
            torrent_peers,
            private,
            v2_hashes,
            byte_metric_sink: None,
        })
    }

    pub fn with_byte_metric_sink(mut self, sink: Arc<dyn ByteMetricSink>) -> Self {
        self.byte_metric_sink = Some(sink);
        self
    }

    pub fn info_hash(&self) -> [u8; 20] {
        self.swarm_key.into_bytes()
    }

    async fn read_block(&self, request: BlockRequest) -> Result<Vec<u8>, ()> {
        let Some(padding) = self.hybrid_padding.as_ref() else {
            return self.content.read_block(request).await;
        };
        let piece_length = self
            .piece_lengths
            .get(usize::try_from(request.index).map_err(|_| ())?)
            .copied()
            .ok_or(())?;
        let request_end = request.begin.checked_add(request.length).ok_or(())?;
        if request.length == 0 || request_end > piece_length {
            return Err(());
        }
        let padding_begin = padding
            .piece_spans(request.index)
            .map(|span| span.begin)
            .min();
        let Some(padding_begin) = padding_begin else {
            return self.content.read_block(request).await;
        };
        let mut block = vec![0; request.length as usize];
        let real_end = request_end.min(padding_begin);
        if request.begin < real_end {
            let real_length = real_end - request.begin;
            let real = self
                .content
                .read_block(BlockRequest {
                    length: real_length,
                    ..request
                })
                .await?;
            if real.len() != real_length as usize {
                return Err(());
            }
            block[..real.len()].copy_from_slice(&real);
        }
        Ok(block)
    }

    async fn hash_response(&self, request: HashRequest) -> Option<HashResponse> {
        let service = self.v2_hashes.as_ref()?;
        service.response(&self.content, request).await.ok()
    }
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum IncomingRejectionReason {
    PendingLimit,
    HandshakeTimeout,
    HandshakeInvalid,
    UnknownTorrent,
    StaleRegistration,
    SelfConnection,
    ConnectionLimit,
    PeerState,
    ActivityTimeout,
    NoRequestTimeout,
    InactivityTimeout,
    Protocol,
    Storage,
    Accept,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct IncomingRejection {
    pub reason: IncomingRejectionReason,
    pub remote: Option<SocketAddr>,
    pub info_hash: Option<[u8; 20]>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IncomingPeerServiceSnapshot {
    pub bootstrap: IncomingTcpBootstrap,
    pub listen_address: SocketAddr,
    pub registrations: usize,
    pub pending: usize,
    pub pending_high_water: usize,
    pub established: usize,
    pub established_high_water: usize,
    pub peer_budget: PeerBudgetSnapshot,
    pub upload_scheduler: UploadSchedulerSnapshot,
    pub upload_read_limit: usize,
    pub reads: usize,
    pub read_bytes: usize,
    pub queued_requests_high_water: usize,
    pub queued_bytes_high_water: usize,
    pub metadata_requests_high_water: usize,
    pub metadata_send_buffer_high_water: usize,
    pub writer_send_buffer_high_water: usize,
    pub upload_regular_high_water: usize,
    pub upload_optimistic_high_water: usize,
    pub upload_slots_high_water: usize,
    pub read_high_water: usize,
    pub read_bytes_high_water: usize,
    pub payload_bytes_sent: u64,
    pub payload_rate_bytes: u64,
    pub torrent_uploads: Vec<TorrentUploadSnapshot>,
    pub peer_uploads: Vec<PeerUploadSnapshot>,
    pub rejection_counts: BTreeMap<IncomingRejectionReason, u64>,
    pub recent_rejections: Vec<IncomingRejection>,
    pub accepting_registrations: bool,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct UploadTrafficSnapshot {
    pub payload_bytes: u64,
    pub payload_rate_bytes: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TorrentUploadSnapshot {
    pub info_hash: [u8; 20],
    pub peers: usize,
    pub traffic: UploadTrafficSnapshot,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PeerUploadSnapshot {
    pub generation: u64,
    pub info_hash: [u8; 20],
    pub traffic: UploadTrafficSnapshot,
}

#[derive(Debug, Default)]
struct ObservationState {
    pending: usize,
    pending_high_water: usize,
    established: usize,
    established_high_water: usize,
    reads: usize,
    read_bytes: usize,
    queued_requests_high_water: usize,
    queued_bytes_high_water: usize,
    metadata_requests_high_water: usize,
    metadata_send_buffer_high_water: usize,
    writer_send_buffer_high_water: usize,
    upload_regular_high_water: usize,
    upload_optimistic_high_water: usize,
    upload_slots_high_water: usize,
    read_high_water: usize,
    read_bytes_high_water: usize,
    rejection_counts: BTreeMap<IncomingRejectionReason, u64>,
    recent_rejections: VecDeque<IncomingRejection>,
}

#[derive(Debug)]
struct PeerUploadEntry {
    swarm_key: SwarmKey,
    counter: Arc<UploadCounter>,
}

#[derive(Debug)]
struct UploadCounter {
    total: AtomicU64,
    started_at: Instant,
    rate: Mutex<UploadRateWindow>,
}

impl UploadCounter {
    fn new() -> Self {
        Self {
            total: AtomicU64::new(0),
            started_at: Instant::now(),
            rate: Mutex::new(UploadRateWindow::default()),
        }
    }

    fn record(&self, bytes: u64) {
        let _ = self
            .total
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |total| {
                Some(total.saturating_add(bytes))
            });
        self.rate_guard().record(bytes, self.started_at.elapsed());
    }

    fn snapshot(&self) -> UploadTrafficSnapshot {
        UploadTrafficSnapshot {
            payload_bytes: self.total.load(Ordering::Acquire),
            payload_rate_bytes: self.rate_guard().snapshot(self.started_at.elapsed()),
        }
    }

    fn rate_guard(&self) -> MutexGuard<'_, UploadRateWindow> {
        self.rate
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[derive(Debug, Default)]
struct UploadRateWindow {
    window_started: Duration,
    window_bytes: u64,
    last_rate: u64,
}

impl UploadRateWindow {
    fn record(&mut self, bytes: u64, now: Duration) {
        self.roll(now);
        self.window_bytes = self.window_bytes.saturating_add(bytes);
    }

    fn snapshot(&mut self, now: Duration) -> u64 {
        self.roll(now);
        self.last_rate
    }

    fn roll(&mut self, now: Duration) {
        let elapsed = now.saturating_sub(self.window_started);
        if elapsed < Duration::from_secs(1) {
            return;
        }
        let millis = u64::try_from(elapsed.as_millis())
            .unwrap_or(u64::MAX)
            .max(1);
        self.last_rate = self.window_bytes.saturating_mul(1_000) / millis;
        self.window_bytes = 0;
        self.window_started = now;
    }
}

#[derive(Debug)]
struct IncomingUploadMetricSink {
    upstream: Option<Arc<dyn ByteMetricSink>>,
    torrent_accounting: Option<Arc<dyn ByteMetricSink>>,
    peer: Arc<UploadCounter>,
    torrent: Arc<UploadCounter>,
    session: Arc<UploadCounter>,
}

impl ByteMetricSink for IncomingUploadMetricSink {
    fn record(&self, metric: ByteMetric, bytes: u64) {
        if let Some(upstream) = &self.upstream {
            upstream.record(metric, bytes);
        }
        if let Some(torrent_accounting) = &self.torrent_accounting {
            torrent_accounting.record(metric, bytes);
        }
        if metric == ByteMetric::PayloadUploaded {
            self.peer.record(bytes);
            self.torrent.record(bytes);
            self.session.record(bytes);
        }
    }
}

#[derive(Debug)]
struct Shared {
    cancellation: CancellationToken,
    listener: Mutex<IncomingListenerObservation>,
    registry: Mutex<BTreeMap<SwarmKey, Arc<RegistrationRuntime>>>,
    mse_index: Mutex<HashMap<[u8; 20], BTreeSet<SwarmKey>>>,
    mutations: AsyncMutex<()>,
    accepting_registrations: AtomicBool,
    accepting_incoming: AtomicBool,
    next_generation: AtomicU64,
    peer_budget: PeerBudget,
    upload_coordinator: UploadCoordinator,
    upload_reads: Arc<Semaphore>,
    pending_handshakes: Arc<Semaphore>,
    upload_read_limit: usize,
    session_upload: Arc<UploadCounter>,
    peer_uploads: Mutex<BTreeMap<crate::upload_scheduler::UploadPeerId, PeerUploadEntry>>,
    observations: Mutex<ObservationState>,
    peer_activity_timeout: Duration,
    keepalive_interval: Duration,
    no_request_timeout: Duration,
    inactivity_timeout: Duration,
    peer_id: [u8; 20],
    byte_metric_sink: Option<Arc<dyn ByteMetricSink>>,
    mse_handshake_sink: Option<Arc<dyn MseHandshakeSink>>,
    encryption: Mutex<PeerEncryptionPolicy>,
    peer_exchange: PeerExchangePolicyHandle,
    mse_dh: MseDhWorkOwner,
}

#[derive(Clone, Copy, Debug)]
struct IncomingListenerObservation {
    bootstrap: IncomingTcpBootstrap,
    listen_address: SocketAddr,
}

#[derive(Debug)]
struct RegistrationRuntime {
    generation: u64,
    data: Arc<SeedRegistration>,
    accepting: AtomicBool,
    healthy: AtomicBool,
    cancellation: CancellationToken,
    upload: Arc<UploadCounter>,
    peers: AsyncMutex<JoinSet<()>>,
}

struct IncomingPeerAttachmentGuard {
    peers: TorrentPeerHandle,
    attachment: IncomingPeerAttachment,
    failure: Option<PeerFailure>,
    disconnecting: bool,
    removed: bool,
}

impl IncomingPeerAttachmentGuard {
    fn new(peers: TorrentPeerHandle, attachment: IncomingPeerAttachment) -> Self {
        Self {
            peers,
            attachment,
            failure: None,
            disconnecting: false,
            removed: false,
        }
    }

    fn handshake_completed(
        &self,
        local_peer_id: [u8; 20],
    ) -> Result<crate::peer_runtime::PeerAdmissionOutcome, ()> {
        self.peers
            .incoming_handshake_completed(self.attachment, local_peer_id)
            .map_err(|_| ())
    }

    fn set_upload(&self, activity: PeerUploadActivity) -> Result<(), ()> {
        self.peers
            .set_incoming_upload(self.attachment, activity)
            .map_err(|_| ())
    }

    fn set_metadata_extension(&self, supported: bool) -> Result<(), ()> {
        self.peers
            .set_incoming_metadata_extension(self.attachment, supported)
            .map_err(|_| ())
    }

    fn apply_extension_handshake(
        &self,
        handshake: rstorrent_protocol::extension::ExtensionHandshake,
        remote: SocketAddr,
        verified_public: bool,
        peer_exchange_enabled: bool,
        policy: NetworkPolicy,
    ) -> Result<ExtensionMap, ()> {
        let map = self.peers.with_state(|state| {
            let map = state
                .pex
                .apply_extension_handshake(self.attachment.connection_id(), handshake);
            if !peer_exchange_enabled {
                state.pex.disable_outbound(self.attachment.connection_id());
            }
            if peer_exchange_enabled
                && verified_public
                && let Some(port) = map.listen_port()
                && let Ok(endpoint) = PeerEndpoint::new(SocketAddr::new(remote.ip(), port))
                && policy.allows(endpoint.address())
            {
                state.pex.peer_established(endpoint, PexFlags::default());
            }
            map
        });
        self.peers.publish_active(true).map_err(|_| ())?;
        Ok(map)
    }

    fn receive_pex(
        &self,
        payload: &[u8],
        remote: SocketAddr,
        verified_public: bool,
        policy: NetworkPolicy,
        self_endpoint: SocketAddr,
    ) -> Result<PexReceiveDisposition, ()> {
        let now = self.peers.elapsed();
        let disposition = self
            .peers
            .with_state(|state| {
                state.pex.receive(
                    self.attachment.connection_id(),
                    payload,
                    PexReceiveContext {
                        source_endpoint: remote,
                        now,
                        verified_public,
                        network_policy: policy,
                        address_families: self.peers.address_family_policy(),
                        self_endpoints: &[self_endpoint],
                    },
                    &mut state.registry,
                )
            })
            .map_err(|_| ())?;
        self.peers.publish_active(true).map_err(|_| ())?;
        Ok(disposition)
    }

    fn next_pex(&self, remote: SocketAddr) -> Result<Option<(u8, Vec<u8>)>, ()> {
        let now = self.peers.elapsed();
        self.peers
            .with_state(|state| {
                let connection = self.attachment.connection_id();
                let remote_id = state.pex.extension_map(connection).pex_id();
                let receiver = PeerEndpoint::new(remote).ok();
                match (remote_id, receiver) {
                    (Some(remote_id), Some(receiver)) => state
                        .pex
                        .next_outbound(connection, receiver, now)
                        .map(|payload| payload.map(|payload| (remote_id, payload))),
                    _ => Ok(None),
                }
            })
            .map_err(|_| ())
    }

    fn apply_peer_exchange_policy(&self, enabled: bool) -> Result<(), ()> {
        self.peers
            .with_state(|state| state.pex.set_session_enabled(enabled, &mut state.registry));
        self.peers.publish_active(true).map_err(|_| ())
    }

    fn begin_disconnect(&mut self, failure: Option<PeerFailure>) {
        if self.disconnecting {
            if self.failure.is_none() && failure.is_some() {
                self.failure = failure;
                let _ = self
                    .peers
                    .begin_incoming_disconnect(self.attachment, failure);
            }
            return;
        }
        self.failure = failure;
        if self
            .peers
            .begin_incoming_disconnect(self.attachment, failure)
            .is_ok()
        {
            self.disconnecting = true;
        }
    }

    fn finalize_upload(&self, traffic: UploadTrafficSnapshot) {
        let _ = self.peers.finalize_incoming_upload(
            self.attachment,
            traffic.payload_bytes,
            traffic.payload_rate_bytes,
        );
    }

    fn remove(mut self) {
        self.begin_disconnect(self.failure);
        if self
            .peers
            .remove_incoming(self.attachment, self.failure)
            .is_ok()
        {
            self.removed = true;
        }
    }
}

impl Drop for IncomingPeerAttachmentGuard {
    fn drop(&mut self) {
        if self.removed {
            return;
        }
        let failure = self.failure.or(Some(PeerFailure::Protocol));
        if !self.disconnecting {
            let _ = self
                .peers
                .begin_incoming_disconnect(self.attachment, failure);
        }
        let _ = self.peers.remove_incoming(self.attachment, failure);
    }
}

impl RegistrationRuntime {
    fn new(generation: u64, registration: SeedRegistration) -> Self {
        Self {
            generation,
            data: Arc::new(registration),
            accepting: AtomicBool::new(true),
            healthy: AtomicBool::new(true),
            cancellation: CancellationToken::new(),
            upload: Arc::new(UploadCounter::new()),
            peers: AsyncMutex::new(JoinSet::new()),
        }
    }

    async fn admit(self: &Arc<Self>, admission: IncomingAdmission) -> bool {
        let IncomingAdmission {
            stream,
            ciphers,
            carried,
            remote,
            capabilities,
            permit,
            shared,
            peer_attachment,
        } = admission;
        let mut peers = self.peers.lock().await;
        while let Some(joined) = peers.try_join_next() {
            if joined.is_err() {
                shared.reject(
                    IncomingRejectionReason::Protocol,
                    None,
                    Some(self.data.info_hash()),
                );
            }
        }
        if !self.accepting.load(Ordering::Acquire)
            || !self.healthy.load(Ordering::Acquire)
            || self.cancellation.is_cancelled()
        {
            return false;
        }
        let data = self.data.clone();
        let cancellation = self.cancellation.clone();
        let registration = self.clone();
        let piece_length = data.piece_lengths.first().copied().unwrap_or(1);
        let membership = shared.upload_coordinator.register(
            data.info_hash(),
            piece_length,
            data.content.local_complete(),
        );
        let peer_upload = Arc::new(UploadCounter::new());
        shared.peer_uploads_guard().insert(
            membership.id,
            PeerUploadEntry {
                swarm_key: data.swarm_key,
                counter: peer_upload.clone(),
            },
        );
        let torrent_upload = self.upload.clone();
        peers.spawn(async move {
            let budget_cancellation = permit.cancellation_token();
            let membership_guard = UploadMembershipGuard {
                shared: shared.clone(),
                id: membership.id,
            };
            let established_guard = ObservationGuard::established(&shared);
            let (termination, mut peer_attachment) = run_incoming_peer(
                stream,
                IncomingPeerStart {
                    capabilities,
                    ciphers,
                    carried,
                    remote,
                    registration: data,
                    cancellation,
                    budget_cancellation,
                    shared: shared.clone(),
                    peer_attachment,
                    membership: IncomingUploadMembership {
                        id: membership.id,
                        grants: membership.grants,
                        peer: peer_upload,
                        torrent: torrent_upload,
                    },
                },
            )
            .await;
            peer_attachment.begin_disconnect(termination.peer_failure());
            drop(membership_guard);
            drop(permit);
            drop(established_guard);
            peer_attachment.remove();
            match termination {
                PeerTermination::Storage => {
                    registration.healthy.store(false, Ordering::Release);
                    registration.cancellation.cancel();
                    shared.reject(
                        IncomingRejectionReason::Storage,
                        Some(remote),
                        Some(registration.data.info_hash()),
                    );
                }
                PeerTermination::Protocol => shared.reject(
                    IncomingRejectionReason::Protocol,
                    Some(remote),
                    Some(registration.data.info_hash()),
                ),
                PeerTermination::ActivityTimeout => shared.reject(
                    IncomingRejectionReason::ActivityTimeout,
                    Some(remote),
                    Some(registration.data.info_hash()),
                ),
                PeerTermination::NoRequestTimeout => shared.reject(
                    IncomingRejectionReason::NoRequestTimeout,
                    Some(remote),
                    Some(registration.data.info_hash()),
                ),
                PeerTermination::InactivityTimeout => shared.reject(
                    IncomingRejectionReason::InactivityTimeout,
                    Some(remote),
                    Some(registration.data.info_hash()),
                ),
                PeerTermination::Closed | PeerTermination::Cancelled => {}
            }
        });
        true
    }

    async fn shutdown(&self) -> Result<(), IncomingPeerError> {
        self.accepting.store(false, Ordering::Release);
        self.cancellation.cancel();
        let mut peers = self.peers.lock().await;
        while let Some(joined) = peers.join_next().await {
            joined.map_err(|error| IncomingPeerError::TaskJoin(error.to_string()))?;
        }
        Ok(())
    }
}

struct IncomingAdmission {
    stream: PeerStream,
    ciphers: Option<MseCipherPair>,
    carried: Vec<u8>,
    remote: SocketAddr,
    capabilities: IncomingPeerCapabilities,
    permit: PeerBudgetPermit,
    shared: Arc<Shared>,
    peer_attachment: IncomingPeerAttachmentGuard,
}

struct UploadMembershipGuard {
    shared: Arc<Shared>,
    id: crate::upload_scheduler::UploadPeerId,
}

impl Drop for UploadMembershipGuard {
    fn drop(&mut self) {
        self.shared.peer_uploads_guard().remove(&self.id);
        self.shared.upload_coordinator.remove(self.id);
    }
}

#[derive(Clone, Debug)]
pub struct IncomingPeerHandle {
    shared: Arc<Shared>,
}

pub(crate) struct SessionUploadMembership {
    shared: Arc<Shared>,
    swarm_key: SwarmKey,
    id: crate::upload_scheduler::UploadPeerId,
    grants: tokio::sync::watch::Receiver<UploadGrant>,
    peer_upload: Arc<UploadCounter>,
    payload_uploaded: u64,
    payload_downloaded: u64,
}

impl SessionUploadMembership {
    pub(crate) fn grant(&self) -> UploadGrant {
        *self.grants.borrow()
    }

    pub(crate) fn update_interest(&self, interested: bool) {
        self.shared
            .upload_coordinator
            .update_interest(self.id, interested);
    }

    pub(crate) fn record_payload(&mut self, bytes: usize) {
        let bytes = u64::try_from(bytes).unwrap_or(u64::MAX);
        self.payload_uploaded = self.payload_uploaded.saturating_add(bytes);
        self.peer_upload.record(bytes);
        self.shared.session_upload.record(bytes);
        if let Some(registration) = self.shared.registry_guard().get(&self.swarm_key) {
            registration.upload.record(bytes);
        }
        self.shared
            .upload_coordinator
            .update_payload(self.id, self.payload_uploaded);
    }

    pub(crate) fn record_downloaded(&mut self, bytes: usize) {
        let bytes = u64::try_from(bytes).unwrap_or(u64::MAX);
        self.payload_downloaded = self.payload_downloaded.saturating_add(bytes);
        self.shared
            .upload_coordinator
            .update_downloaded(self.id, self.payload_downloaded);
    }
}

impl Drop for SessionUploadMembership {
    fn drop(&mut self) {
        self.shared.peer_uploads_guard().remove(&self.id);
        self.shared.upload_coordinator.remove(self.id);
    }
}

impl IncomingPeerHandle {
    pub async fn admit_utp(
        &self,
        stream: UtpStream,
        handshake_timeout: Duration,
    ) -> Result<(), IncomingPeerError> {
        if handshake_timeout.is_zero() {
            return Err(IncomingPeerError::InvalidTimeout);
        }
        let remote = stream.peer_addr();
        let Ok(pending_permit) = self.shared.pending_handshakes.clone().try_acquire_owned() else {
            self.shared
                .reject(IncomingRejectionReason::PendingLimit, Some(remote), None);
            return Ok(());
        };
        let Ok(budget_permit) = self
            .shared
            .peer_budget
            .try_acquire(PeerBudgetDirection::Incoming)
        else {
            self.shared
                .reject(IncomingRejectionReason::ConnectionLimit, Some(remote), None);
            return Ok(());
        };
        if !self.shared.accepting_incoming.load(Ordering::Acquire) {
            return Ok(());
        }
        let _pending = ObservationGuard::pending(&self.shared);
        run_handshake(
            stream.into(),
            remote,
            handshake_timeout,
            self.shared.clone(),
            self.shared.cancellation.clone(),
            budget_permit,
        )
        .await;
        drop(pending_permit);
        Ok(())
    }

    pub(crate) fn register_session_upload(
        &self,
        swarm_key: SwarmKey,
        piece_length: u32,
    ) -> SessionUploadMembership {
        let info_hash = swarm_key.into_bytes();
        let membership = self
            .shared
            .upload_coordinator
            .register(info_hash, piece_length, false);
        let peer_upload = Arc::new(UploadCounter::new());
        self.shared.peer_uploads_guard().insert(
            membership.id,
            PeerUploadEntry {
                swarm_key,
                counter: peer_upload.clone(),
            },
        );
        SessionUploadMembership {
            shared: self.shared.clone(),
            swarm_key,
            id: membership.id,
            grants: membership.grants,
            peer_upload,
            payload_uploaded: 0,
            payload_downloaded: 0,
        }
    }

    pub(crate) fn evaluate_uploads(&self) {
        self.shared.upload_coordinator.evaluate();
    }

    pub(crate) async fn acquire_upload_read(&self) -> Option<OwnedSemaphorePermit> {
        self.shared.upload_reads.clone().acquire_owned().await.ok()
    }

    pub fn reconfigure_encryption(&self, encryption: PeerEncryptionPolicy) {
        *self
            .shared
            .encryption
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = encryption;
    }

    pub async fn register(
        &self,
        registration: SeedRegistration,
    ) -> Result<SeedRegistrationToken, IncomingPeerError> {
        self.register_all(vec![registration])
            .await
            .map(|mut tokens| tokens.pop().expect("one registration returns one token"))
    }

    pub async fn register_all(
        &self,
        registrations: Vec<SeedRegistration>,
    ) -> Result<Vec<SeedRegistrationToken>, IncomingPeerError> {
        if !self.shared.accepting_registrations.load(Ordering::Acquire) {
            return Err(IncomingPeerError::Closed);
        }
        if registrations.is_empty() {
            return Err(IncomingPeerError::InvalidRegistration(
                "registration set is empty",
            ));
        }
        let keys = registrations
            .iter()
            .map(|registration| registration.swarm_key)
            .collect::<BTreeSet<_>>();
        if keys.len() != registrations.len() {
            return Err(IncomingPeerError::InvalidRegistration(
                "registration set repeats a swarm key",
            ));
        }
        let _mutation = self.shared.mutations.lock().await;
        if !self.shared.accepting_registrations.load(Ordering::Acquire) {
            return Err(IncomingPeerError::Closed);
        }
        let old = {
            let mut registry = self.shared.registry_guard();
            let retained =
                registry.len() - keys.iter().filter(|key| registry.contains_key(key)).count();
            if retained.saturating_add(registrations.len()) > MAX_SEED_REGISTRATIONS {
                return Err(IncomingPeerError::RegistrationLimit {
                    maximum: MAX_SEED_REGISTRATIONS,
                });
            }
            keys.iter()
                .filter_map(|key| {
                    registry
                        .remove(key)
                        .map(|registration| (*key, registration))
                })
                .collect::<Vec<_>>()
        };
        for (swarm_key, old) in old {
            self.shared.remove_mse_registration(swarm_key);
            old.shutdown().await?;
        }
        let mut entries = Vec::with_capacity(registrations.len());
        for registration in registrations {
            let swarm_key = registration.swarm_key;
            let generation = self
                .shared
                .next_generation
                .fetch_add(1, Ordering::AcqRel)
                .max(1);
            entries.push((
                SeedRegistrationToken {
                    swarm_key,
                    generation,
                },
                Arc::new(RegistrationRuntime::new(generation, registration)),
            ));
        }
        {
            let mut registry = self.shared.registry_guard();
            for (token, registration) in &entries {
                registry.insert(token.swarm_key, registration.clone());
            }
        }
        for (token, _) in &entries {
            self.shared.add_mse_registration(token.swarm_key);
        }
        Ok(entries.into_iter().map(|(token, _)| token).collect())
    }

    pub async fn unregister(
        &self,
        token: SeedRegistrationToken,
    ) -> Result<bool, IncomingPeerError> {
        let _mutation = self.shared.mutations.lock().await;
        let registration = {
            let mut registry = self.shared.registry_guard();
            match registry.get(&token.swarm_key) {
                Some(registration) if registration.generation == token.generation => {
                    registry.remove(&token.swarm_key)
                }
                _ => None,
            }
        };
        let Some(registration) = registration else {
            return Ok(false);
        };
        self.shared.remove_mse_registration(token.swarm_key);
        registration.shutdown().await?;
        Ok(true)
    }

    pub fn registration_is_current(&self, token: SeedRegistrationToken) -> bool {
        self.shared
            .registry_guard()
            .get(&token.swarm_key)
            .is_some_and(|registration| registration.generation == token.generation)
    }

    pub fn snapshot(&self) -> IncomingPeerServiceSnapshot {
        self.shared.snapshot()
    }
}

#[derive(Debug)]
pub struct IncomingPeerRuntime {
    handle: IncomingPeerHandle,
    cancellation: CancellationToken,
    upload_task: Option<JoinHandle<()>>,
}

impl IncomingPeerRuntime {
    pub fn start(config: IncomingPeerServiceConfig) -> Result<Self, IncomingPeerError> {
        Self::start_with_cancellation(config, CancellationToken::new())
    }

    pub fn start_with_cancellation(
        config: IncomingPeerServiceConfig,
        cancellation: CancellationToken,
    ) -> Result<Self, IncomingPeerError> {
        validate_service_config(&config)?;
        let upload_coordinator = UploadCoordinator::new(config.upload_scheduler)
            .map_err(IncomingPeerError::InvalidScheduler)?;
        let upload_interval = config
            .upload_scheduler
            .unchoke_interval
            .min(config.upload_scheduler.optimistic_interval);
        let shared = Arc::new(Shared {
            cancellation: cancellation.clone(),
            listener: Mutex::new(IncomingListenerObservation {
                bootstrap: IncomingTcpBootstrap::Disabled,
                listen_address: SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, 0).into(),
            }),
            registry: Mutex::new(BTreeMap::new()),
            mse_index: Mutex::new(HashMap::new()),
            mutations: AsyncMutex::new(()),
            accepting_registrations: AtomicBool::new(true),
            accepting_incoming: AtomicBool::new(true),
            next_generation: AtomicU64::new(1),
            peer_budget: config.peer_budget,
            upload_coordinator,
            upload_reads: Arc::new(Semaphore::new(config.upload_read_jobs)),
            pending_handshakes: Arc::new(Semaphore::new(MAX_INCOMING_PENDING)),
            upload_read_limit: config.upload_read_jobs,
            session_upload: Arc::new(UploadCounter::new()),
            peer_uploads: Mutex::new(BTreeMap::new()),
            observations: Mutex::new(ObservationState::default()),
            peer_activity_timeout: config.peer_activity_timeout,
            keepalive_interval: config.keepalive_interval,
            no_request_timeout: config.no_request_timeout,
            inactivity_timeout: config.inactivity_timeout,
            peer_id: config.peer_id,
            byte_metric_sink: config.byte_metric_sink,
            mse_handshake_sink: config.mse_handshake_sink,
            encryption: Mutex::new(config.encryption),
            peer_exchange: config.peer_exchange,
            mse_dh: config.mse_dh,
        });
        let upload_task = tokio::spawn(run_upload_scheduler(
            shared.clone(),
            cancellation.clone(),
            upload_interval,
        ));
        Ok(Self {
            handle: IncomingPeerHandle { shared },
            cancellation,
            upload_task: Some(upload_task),
        })
    }

    pub fn handle(&self) -> IncomingPeerHandle {
        self.handle.clone()
    }

    pub fn start_acceptor(
        &self,
        bootstrap: IncomingTcpBootstrap,
        listener: TcpListener,
        handshake_timeout: Duration,
    ) -> Result<IncomingPeerAcceptor, IncomingPeerError> {
        if handshake_timeout.is_zero() {
            return Err(IncomingPeerError::InvalidTimeout);
        }
        let listen_address = listener
            .local_addr()
            .map_err(|source| IncomingPeerError::Io {
                operation: "read supplied incoming listener address",
                source,
            })?;
        validate_supplied_listener(bootstrap, listen_address)?;
        let cancellation = self.cancellation.child_token();
        let task = tokio::spawn(run_accept_loop(
            listener,
            handshake_timeout,
            self.handle.shared.clone(),
            cancellation.clone(),
        ));
        *self.handle.shared.listener_guard() = IncomingListenerObservation {
            bootstrap,
            listen_address,
        };
        Ok(IncomingPeerAcceptor {
            bootstrap,
            listen_address,
            cancellation,
            task: Some(task),
        })
    }

    pub fn set_incoming_enabled(&self, enabled: bool) {
        self.handle
            .shared
            .accepting_incoming
            .store(enabled, Ordering::Release);
        if !enabled {
            self.handle.shared.peer_budget.cancel_incoming();
        }
    }

    pub fn disable_listener(&self) {
        self.set_incoming_enabled(false);
        *self.handle.shared.listener_guard() = IncomingListenerObservation {
            bootstrap: IncomingTcpBootstrap::Disabled,
            listen_address: SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, 0).into(),
        };
    }

    pub fn reconfigure_upload_slots(&self, slots: usize) {
        self.handle
            .shared
            .upload_coordinator
            .reconfigure_slots(slots);
    }

    pub fn reconfigure_encryption(&self, encryption: PeerEncryptionPolicy) {
        self.handle.reconfigure_encryption(encryption);
    }

    pub fn snapshot(&self) -> IncomingPeerServiceSnapshot {
        self.handle.snapshot()
    }

    pub async fn shutdown(mut self) -> Result<IncomingPeerServiceSnapshot, IncomingPeerError> {
        self.handle
            .shared
            .accepting_registrations
            .store(false, Ordering::Release);
        self.cancellation.cancel();
        self.upload_task
            .take()
            .expect("incoming upload task exists before shutdown")
            .await
            .map_err(|error| IncomingPeerError::TaskJoin(error.to_string()))?;
        let _mutation = self.handle.shared.mutations.lock().await;
        let registrations = {
            let mut registry = self.handle.shared.registry_guard();
            std::mem::take(&mut *registry)
                .into_values()
                .collect::<Vec<_>>()
        };
        self.handle.shared.mse_index_guard().clear();
        for registration in registrations {
            registration.shutdown().await?;
        }
        Ok(self.handle.snapshot())
    }
}

impl Drop for IncomingPeerRuntime {
    fn drop(&mut self) {
        self.handle
            .shared
            .accepting_registrations
            .store(false, Ordering::Release);
        self.cancellation.cancel();
    }
}

#[derive(Debug)]
pub struct IncomingPeerAcceptor {
    bootstrap: IncomingTcpBootstrap,
    listen_address: SocketAddr,
    cancellation: CancellationToken,
    task: Option<JoinHandle<()>>,
}

impl IncomingPeerAcceptor {
    pub fn bootstrap(&self) -> IncomingTcpBootstrap {
        self.bootstrap
    }

    pub fn listen_address(&self) -> SocketAddr {
        self.listen_address
    }

    pub async fn shutdown(mut self) -> Result<(), IncomingPeerError> {
        self.cancellation.cancel();
        self.task
            .take()
            .expect("incoming accept task exists before shutdown")
            .await
            .map_err(|error| IncomingPeerError::TaskJoin(error.to_string()))
    }
}

impl Drop for IncomingPeerAcceptor {
    fn drop(&mut self) {
        self.cancellation.cancel();
    }
}

#[derive(Debug)]
pub struct IncomingPeerService {
    runtime: Option<IncomingPeerRuntime>,
    acceptor: Option<IncomingPeerAcceptor>,
}

impl IncomingPeerService {
    pub async fn bind(
        config: IncomingPeerServiceConfig,
    ) -> Result<Option<Self>, IncomingPeerError> {
        validate_service_config(&config)?;
        let (bind_address, port) = match config.bootstrap {
            IncomingTcpBootstrap::Disabled => return Ok(None),
            IncomingTcpBootstrap::AutomaticLoopback => (Ipv4Addr::LOCALHOST, 0),
            IncomingTcpBootstrap::FixedLoopback(0) => {
                return Err(IncomingPeerError::InvalidFixedPort);
            }
            IncomingTcpBootstrap::FixedLoopback(port) => (Ipv4Addr::LOCALHOST, port),
            IncomingTcpBootstrap::AutomaticLocalNetwork => (Ipv4Addr::UNSPECIFIED, 0),
            IncomingTcpBootstrap::FixedLocalNetwork(0) => {
                return Err(IncomingPeerError::InvalidFixedPort);
            }
            IncomingTcpBootstrap::FixedLocalNetwork(port) => (Ipv4Addr::UNSPECIFIED, port),
        };
        let socket =
            TcpSocket::new_v4().map_err(|source| IncomingPeerError::Bind { port, source })?;
        socket
            .bind(SocketAddrV4::new(bind_address, port).into())
            .map_err(|source| IncomingPeerError::Bind { port, source })?;
        let listener = socket
            .listen(DEFAULT_LISTEN_BACKLOG)
            .map_err(|source| IncomingPeerError::Bind { port, source })?;
        Self::start(config, listener).map(Some)
    }

    pub fn start(
        config: IncomingPeerServiceConfig,
        listener: TcpListener,
    ) -> Result<Self, IncomingPeerError> {
        let bootstrap = config.bootstrap;
        let handshake_timeout = config.handshake_timeout;
        let runtime = IncomingPeerRuntime::start(config)?;
        let acceptor = runtime.start_acceptor(bootstrap, listener, handshake_timeout)?;
        Ok(Self {
            runtime: Some(runtime),
            acceptor: Some(acceptor),
        })
    }

    pub fn handle(&self) -> IncomingPeerHandle {
        self.runtime
            .as_ref()
            .expect("incoming runtime exists before shutdown")
            .handle()
    }

    pub fn listen_address(&self) -> SocketAddr {
        self.acceptor
            .as_ref()
            .expect("incoming acceptor exists before shutdown")
            .listen_address()
    }

    pub fn snapshot(&self) -> IncomingPeerServiceSnapshot {
        self.runtime
            .as_ref()
            .expect("incoming runtime exists before shutdown")
            .snapshot()
    }

    pub async fn shutdown(mut self) -> Result<IncomingPeerServiceSnapshot, IncomingPeerError> {
        if let Some(acceptor) = self.acceptor.take() {
            acceptor.shutdown().await?;
        }
        self.runtime
            .take()
            .expect("incoming runtime exists before shutdown")
            .shutdown()
            .await
    }
}

fn validate_service_config(config: &IncomingPeerServiceConfig) -> Result<(), IncomingPeerError> {
    if config.handshake_timeout.is_zero()
        || config.peer_activity_timeout.is_zero()
        || config.keepalive_interval.is_zero()
        || config.no_request_timeout.is_zero()
        || config.inactivity_timeout.is_zero()
    {
        return Err(IncomingPeerError::InvalidTimeout);
    }
    if !(1..=MAX_CONFIGURED_UPLOAD_READ_JOBS).contains(&config.upload_read_jobs) {
        return Err(IncomingPeerError::InvalidUploadReadJobs {
            maximum: MAX_CONFIGURED_UPLOAD_READ_JOBS,
        });
    }
    Ok(())
}

fn validate_supplied_listener(
    bootstrap: IncomingTcpBootstrap,
    address: SocketAddr,
) -> Result<(), IncomingPeerError> {
    let valid = match address {
        SocketAddr::V4(address) => match bootstrap {
            IncomingTcpBootstrap::Disabled => false,
            IncomingTcpBootstrap::AutomaticLoopback => address.ip().is_loopback(),
            IncomingTcpBootstrap::FixedLoopback(port) => {
                address.ip().is_loopback() && address.port() == port
            }
            IncomingTcpBootstrap::AutomaticLocalNetwork => address.ip().is_unspecified(),
            IncomingTcpBootstrap::FixedLocalNetwork(port) => {
                address.ip().is_unspecified() && address.port() == port
            }
        },
        SocketAddr::V6(address) => match bootstrap {
            IncomingTcpBootstrap::Disabled => false,
            IncomingTcpBootstrap::AutomaticLoopback => address.ip().is_loopback(),
            IncomingTcpBootstrap::FixedLoopback(port) => {
                address.ip().is_loopback() && address.port() == port
            }
            IncomingTcpBootstrap::AutomaticLocalNetwork => {
                crate::session_socket::eligible_global_ipv6(*address.ip())
            }
            IncomingTcpBootstrap::FixedLocalNetwork(port) => {
                crate::session_socket::eligible_global_ipv6(*address.ip()) && address.port() == port
            }
        },
    };
    if valid {
        Ok(())
    } else {
        Err(IncomingPeerError::InvalidSuppliedListener)
    }
}

pub(crate) async fn select_local_network_ipv4(
    address_override: Option<Ipv4Addr>,
) -> Result<Ipv4Addr, IncomingPeerError> {
    if let Some(address) = address_override {
        return require_eligible_local_network_ipv4(address);
    }

    #[cfg(target_os = "macos")]
    {
        probe_local_network_ipv4(SocketAddrV4::new(Ipv4Addr::new(192, 0, 2, 1), 1))
            .await
            .and_then(require_eligible_local_network_ipv4)
    }

    #[cfg(not(target_os = "macos"))]
    let primary =
        probe_local_network_ipv4(SocketAddrV4::new(Ipv4Addr::new(239, 255, 255, 250), 1900))
            .await
            .and_then(require_eligible_local_network_ipv4);
    #[cfg(not(target_os = "macos"))]
    if primary.is_ok() {
        return primary;
    }

    #[cfg(target_os = "windows")]
    {
        // Windows may route a connected multicast socket through loopback even
        // when an eligible default-route adapter exists. TEST-NET-1 exercises
        // ordinary source selection without sending a datagram to a third party.
        return probe_local_network_ipv4(SocketAddrV4::new(Ipv4Addr::new(192, 0, 2, 1), 1))
            .await
            .and_then(require_eligible_local_network_ipv4);
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    primary
}

async fn probe_local_network_ipv4(target: SocketAddrV4) -> Result<Ipv4Addr, IncomingPeerError> {
    let probe = UdpSocket::bind(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, 0))
        .await
        .map_err(|source| IncomingPeerError::LocalNetworkAddress { source })?;
    probe
        .connect(target)
        .await
        .map_err(|source| IncomingPeerError::LocalNetworkAddress { source })?;
    match probe
        .local_addr()
        .map_err(|source| IncomingPeerError::LocalNetworkAddress { source })?
    {
        SocketAddr::V4(address) => Ok(*address.ip()),
        SocketAddr::V6(_) => Err(IncomingPeerError::InvalidLocalNetworkAddress),
    }
}

fn require_eligible_local_network_ipv4(address: Ipv4Addr) -> Result<Ipv4Addr, IncomingPeerError> {
    eligible_local_network_ipv4(address)
        .then_some(address)
        .ok_or(IncomingPeerError::InvalidLocalNetworkAddress)
}

fn eligible_local_network_ipv4(address: Ipv4Addr) -> bool {
    !address.is_unspecified()
        && !address.is_loopback()
        && !address.is_multicast()
        && !address.is_broadcast()
}

impl Shared {
    fn listener_guard(&self) -> MutexGuard<'_, IncomingListenerObservation> {
        self.listener
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn registry_guard(&self) -> MutexGuard<'_, BTreeMap<SwarmKey, Arc<RegistrationRuntime>>> {
        self.registry
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn mse_index_guard(&self) -> MutexGuard<'_, HashMap<[u8; 20], BTreeSet<SwarmKey>>> {
        self.mse_index
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn add_mse_registration(&self, swarm_key: SwarmKey) {
        let info_hash = swarm_key.into_bytes();
        self.mse_index_guard()
            .entry(req2_hash(&info_hash))
            .or_default()
            .insert(swarm_key);
    }

    fn remove_mse_registration(&self, swarm_key: SwarmKey) {
        let info_hash = swarm_key.into_bytes();
        let key = req2_hash(&info_hash);
        let mut index = self.mse_index_guard();
        let remove_bucket = index.get_mut(&key).is_some_and(|bucket| {
            bucket.remove(&swarm_key);
            bucket.is_empty()
        });
        if remove_bucket {
            index.remove(&key);
        }
    }

    fn identify_mse_torrent(&self, key: [u8; 20]) -> Option<[u8; 20]> {
        let index = self.mse_index_guard();
        unique_mse_registration(&index, key)
    }

    fn registration_for_handshake(
        &self,
        info_hash: [u8; 20],
        handshake: &rstorrent_protocol::peer_wire::Handshake,
    ) -> Option<(SwarmKey, Arc<RegistrationRuntime>)> {
        let registry = self.registry_guard();
        let v1_key = SwarmKey::V1(V1InfoHash::new(info_hash));
        let v2_key = SwarmKey::V2Truncated(info_hash);
        let (request_key, request) = match (registry.get(&v1_key), registry.get(&v2_key)) {
            (Some(registration), None) => (v1_key, registration),
            (None, Some(registration)) => (v2_key, registration),
            (Some(_), Some(_)) | (None, None) => return None,
        };
        let response_key = hybrid_response_key(request_key, handshake, request.data.info_hashes)
            .unwrap_or(request_key);
        if response_key == request_key {
            return Some((request_key, request.clone()));
        }
        let Some(response) = registry.get(&response_key) else {
            return Some((request_key, request.clone()));
        };
        if request.data.raw_info == response.data.raw_info
            && request
                .data
                .torrent_peers
                .same_owner(&response.data.torrent_peers)
        {
            Some((response_key, response.clone()))
        } else {
            Some((request_key, request.clone()))
        }
    }

    fn encryption_policy(&self) -> PeerEncryptionPolicy {
        *self
            .encryption
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn observations_guard(&self) -> MutexGuard<'_, ObservationState> {
        self.observations
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn peer_uploads_guard(
        &self,
    ) -> MutexGuard<'_, BTreeMap<crate::upload_scheduler::UploadPeerId, PeerUploadEntry>> {
        self.peer_uploads
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn reject(
        &self,
        reason: IncomingRejectionReason,
        remote: Option<SocketAddr>,
        info_hash: Option<[u8; 20]>,
    ) {
        let mut observations = self.observations_guard();
        *observations.rejection_counts.entry(reason).or_default() += 1;
        if observations.recent_rejections.len() == MAX_RECENT_REJECTIONS {
            observations.recent_rejections.pop_front();
        }
        observations.recent_rejections.push_back(IncomingRejection {
            reason,
            remote,
            info_hash,
        });
    }

    fn snapshot(&self) -> IncomingPeerServiceSnapshot {
        let listener = *self.listener_guard();
        let observations = self.observations_guard();
        let peer_uploads = self.peer_uploads_guard();
        let registry = self.registry_guard();
        let torrent_uploads = registry
            .iter()
            .map(|(swarm_key, registration)| TorrentUploadSnapshot {
                info_hash: swarm_key.into_bytes(),
                peers: peer_uploads
                    .values()
                    .filter(|peer| peer.swarm_key == *swarm_key)
                    .count(),
                traffic: registration.upload.snapshot(),
            })
            .collect();
        let peer_uploads = peer_uploads
            .iter()
            .map(|(id, peer)| PeerUploadSnapshot {
                generation: id.get(),
                info_hash: peer.swarm_key.into_bytes(),
                traffic: peer.counter.snapshot(),
            })
            .collect();
        let session_upload = self.session_upload.snapshot();
        IncomingPeerServiceSnapshot {
            bootstrap: listener.bootstrap,
            listen_address: listener.listen_address,
            registrations: registry.len(),
            pending: observations.pending,
            pending_high_water: observations.pending_high_water,
            established: observations.established,
            established_high_water: observations.established_high_water,
            peer_budget: self.peer_budget.snapshot(),
            upload_scheduler: self.upload_coordinator.snapshot(),
            upload_read_limit: self.upload_read_limit,
            reads: observations.reads,
            read_bytes: observations.read_bytes,
            queued_requests_high_water: observations.queued_requests_high_water,
            queued_bytes_high_water: observations.queued_bytes_high_water,
            metadata_requests_high_water: observations.metadata_requests_high_water,
            metadata_send_buffer_high_water: observations.metadata_send_buffer_high_water,
            writer_send_buffer_high_water: observations.writer_send_buffer_high_water,
            upload_regular_high_water: observations.upload_regular_high_water,
            upload_optimistic_high_water: observations.upload_optimistic_high_water,
            upload_slots_high_water: observations.upload_slots_high_water,
            read_high_water: observations.read_high_water,
            read_bytes_high_water: observations.read_bytes_high_water,
            payload_bytes_sent: session_upload.payload_bytes,
            payload_rate_bytes: session_upload.payload_rate_bytes,
            torrent_uploads,
            peer_uploads,
            rejection_counts: observations.rejection_counts.clone(),
            recent_rejections: observations.recent_rejections.iter().copied().collect(),
            accepting_registrations: self.accepting_registrations.load(Ordering::Acquire),
        }
    }
}

fn unique_mse_registration(
    index: &HashMap<[u8; 20], BTreeSet<SwarmKey>>,
    key: [u8; 20],
) -> Option<[u8; 20]> {
    let bucket = index.get(&key)?;
    (bucket.len() == 1).then(|| {
        bucket
            .first()
            .expect("one-element MSE registration bucket")
            .into_bytes()
    })
}

struct ObservationGuard {
    shared: Arc<Shared>,
    kind: ObservationKind,
}

enum ObservationKind {
    Pending,
    Established,
    Read(usize),
}

impl ObservationGuard {
    fn pending(shared: &Arc<Shared>) -> Self {
        {
            let mut observations = shared.observations_guard();
            observations.pending += 1;
            observations.pending_high_water =
                observations.pending_high_water.max(observations.pending);
        }
        Self {
            shared: shared.clone(),
            kind: ObservationKind::Pending,
        }
    }

    fn established(shared: &Arc<Shared>) -> Self {
        {
            let mut observations = shared.observations_guard();
            observations.established += 1;
            observations.established_high_water = observations
                .established_high_water
                .max(observations.established);
        }
        Self {
            shared: shared.clone(),
            kind: ObservationKind::Established,
        }
    }

    fn read(shared: &Arc<Shared>, bytes: usize) -> Self {
        {
            let mut observations = shared.observations_guard();
            observations.reads += 1;
            observations.read_bytes += bytes;
            observations.read_high_water = observations.read_high_water.max(observations.reads);
            observations.read_bytes_high_water = observations
                .read_bytes_high_water
                .max(observations.read_bytes);
        }
        Self {
            shared: shared.clone(),
            kind: ObservationKind::Read(bytes),
        }
    }
}

impl Drop for ObservationGuard {
    fn drop(&mut self) {
        let mut observations = self.shared.observations_guard();
        match self.kind {
            ObservationKind::Pending => observations.pending -= 1,
            ObservationKind::Established => observations.established -= 1,
            ObservationKind::Read(bytes) => {
                observations.reads -= 1;
                observations.read_bytes -= bytes;
            }
        }
    }
}

async fn run_accept_loop(
    listener: TcpListener,
    handshake_timeout: Duration,
    shared: Arc<Shared>,
    cancellation: CancellationToken,
) {
    let pending = shared.pending_handshakes.clone();
    let mut handshakes = JoinSet::new();
    loop {
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => break,
            joined = handshakes.join_next(), if !handshakes.is_empty() => {
                if joined.is_some_and(|result| result.is_err()) {
                    shared.reject(IncomingRejectionReason::Protocol, None, None);
                }
            }
            accepted = listener.accept() => match accepted {
                Ok((stream, remote)) => {
                    let Ok(permit) = pending.clone().try_acquire_owned() else {
                        shared.reject(IncomingRejectionReason::PendingLimit, Some(remote), None);
                        continue;
                    };
                    let Ok(budget_permit) = shared
                        .peer_budget
                        .try_acquire(PeerBudgetDirection::Incoming)
                    else {
                        shared.reject(
                            IncomingRejectionReason::ConnectionLimit,
                            Some(remote),
                            None,
                        );
                        continue;
                    };
                    let shared = shared.clone();
                    let cancellation = cancellation.clone();
                    handshakes.spawn(async move {
                        let _pending = ObservationGuard::pending(&shared);
                        run_handshake(
                            PeerStream::Tcp(stream),
                            remote,
                            handshake_timeout,
                            shared,
                            cancellation,
                            budget_permit,
                        )
                        .await;
                        drop(permit);
                    });
                }
                Err(_) => {
                    shared.reject(IncomingRejectionReason::Accept, None, None);
                    tokio::task::yield_now().await;
                }
            },
        }
    }
    handshakes.abort_all();
    while handshakes.join_next().await.is_some() {}
}

async fn run_upload_scheduler(
    shared: Arc<Shared>,
    cancellation: CancellationToken,
    cadence: Duration,
) {
    let mut interval = tokio::time::interval(cadence);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => break,
            _ = interval.tick() => shared.upload_coordinator.evaluate(),
        }
    }
}

struct ReceivedIncomingHandshake {
    info_hash: [u8; 20],
    handshake: rstorrent_protocol::peer_wire::Handshake,
    method: Option<MseMethod>,
    ciphers: Option<MseCipherPair>,
    carried: Vec<u8>,
    mse_accounting: Option<MseHandshakeAccounting>,
}

enum IncomingHandshakeFailure {
    Cancelled,
    Timeout,
    Invalid {
        info_hash: Option<[u8; 20]>,
        mse_failure: Option<MseHandshakeFailure>,
    },
    UnknownTorrent,
}

enum IncomingIoFailure {
    Cancelled,
    Timeout,
    Invalid,
}

async fn receive_incoming_handshake(
    stream: &mut PeerStream,
    deadline: Instant,
    policy: PeerEncryptionPolicy,
    shared: &Arc<Shared>,
    cancellation: &CancellationToken,
    budget_cancellation: &CancellationToken,
) -> Result<ReceivedIncomingHandshake, IncomingHandshakeFailure> {
    let mut first = [0_u8; HANDSHAKE_LENGTH];
    read_incoming_exact(
        stream,
        &mut first,
        deadline,
        shared,
        cancellation,
        budget_cancellation,
    )
    .await
    .map_err(map_incoming_io_failure)?;

    if first.starts_with(b"\x13BitTorrent protocol") {
        let info_hash: [u8; 20] = first[28..48]
            .try_into()
            .expect("handshake info hash has a fixed length");
        if policy == PeerEncryptionPolicy::Required {
            return Err(IncomingHandshakeFailure::Invalid {
                info_hash: Some(info_hash),
                mse_failure: None,
            });
        }
        let handshake =
            decode_handshake(&first, info_hash).map_err(|_| IncomingHandshakeFailure::Invalid {
                info_hash: Some(info_hash),
                mse_failure: None,
            })?;
        record_bytes(
            shared.byte_metric_sink.as_ref(),
            ByteMetric::PeerProtocolReceived,
            HANDSHAKE_LENGTH,
        );
        return Ok(ReceivedIncomingHandshake {
            info_hash,
            handshake,
            method: None,
            ciphers: None,
            carried: Vec::new(),
            mse_accounting: None,
        });
    }
    if stream.transport() == PeerTransport::Utp {
        return Err(IncomingHandshakeFailure::Invalid {
            info_hash: None,
            mse_failure: Some(MseHandshakeFailure::PolicyRejected),
        });
    }
    if policy == PeerEncryptionPolicy::Disabled {
        let mut accounting = MseHandshakeAccounting::new(MseRole::Responder, policy);
        accounting.wire_received(HANDSHAKE_LENGTH);
        record_mse_handshake(
            shared.mse_handshake_sink.as_ref(),
            accounting.finish(
                MseHandshakeOutcome::Failed(MseHandshakeFailure::PolicyRejected),
                false,
            ),
        );
        return Err(IncomingHandshakeFailure::Invalid {
            info_hash: None,
            mse_failure: Some(MseHandshakeFailure::PolicyRejected),
        });
    }
    run_incoming_mse(
        stream,
        first,
        deadline,
        shared,
        cancellation,
        budget_cancellation,
        policy,
    )
    .await
}

async fn run_incoming_mse(
    stream: &mut PeerStream,
    first: [u8; HANDSHAKE_LENGTH],
    deadline: Instant,
    shared: &Arc<Shared>,
    cancellation: &CancellationToken,
    budget_cancellation: &CancellationToken,
    policy: PeerEncryptionPolicy,
) -> Result<ReceivedIncomingHandshake, IncomingHandshakeFailure> {
    let mut accounting = MseHandshakeAccounting::new(MseRole::Responder, policy);
    accounting.wire_received(HANDSHAKE_LENGTH);
    let result = run_incoming_mse_inner(
        stream,
        first,
        deadline,
        shared,
        cancellation,
        budget_cancellation,
        &mut accounting,
    )
    .await;
    match result {
        Ok(mut received) => {
            received.mse_accounting = Some(accounting);
            Ok(received)
        }
        Err(failure) => {
            let reason = incoming_mse_failure_reason(&failure);
            record_mse_handshake(
                shared.mse_handshake_sink.as_ref(),
                accounting.finish(MseHandshakeOutcome::Failed(reason), false),
            );
            Err(failure)
        }
    }
}

async fn run_incoming_mse_inner(
    stream: &mut PeerStream,
    first: [u8; HANDSHAKE_LENGTH],
    deadline: Instant,
    shared: &Arc<Shared>,
    cancellation: &CancellationToken,
    budget_cancellation: &CancellationToken,
    accounting: &mut MseHandshakeAccounting,
) -> Result<ReceivedIncomingHandshake, IncomingHandshakeFailure> {
    let mut private_entropy = [0_u8; DH_PRIVATE_EXPONENT_LEN];
    getrandom::fill(&mut private_entropy).map_err(|_| IncomingHandshakeFailure::Invalid {
        info_hash: None,
        mse_failure: Some(MseHandshakeFailure::Entropy),
    })?;
    let pad_b = random_incoming_mse_padding()?;
    let pad_d = random_incoming_mse_padding()?;
    let mut handshake = MseHandshake::new_responder(
        private_entropy,
        pad_b,
        pad_d,
        MSE_KNOWN_METHODS,
        accounting.policy().prefers_rc4_when_selecting(),
    )
    .map_err(|error| IncomingHandshakeFailure::Invalid {
        info_hash: None,
        mse_failure: Some(MseHandshakeFailure::Protocol(error)),
    })?;
    let mut step = handshake
        .start()
        .map_err(|error| IncomingHandshakeFailure::Invalid {
            info_hash: None,
            mse_failure: Some(MseHandshakeFailure::Protocol(error)),
        })?;
    let mut network_buffer = [0_u8; crate::peer_io::NETWORK_READ_LENGTH];
    network_buffer[..HANDSHAKE_LENGTH].copy_from_slice(&first);
    let mut buffered = HANDSHAKE_LENGTH;
    let mut consumed = 0;

    loop {
        step = match step {
            MseStep::NeedInput => {
                if consumed == buffered {
                    buffered = read_incoming_some(
                        stream,
                        &mut network_buffer,
                        deadline,
                        shared,
                        cancellation,
                        budget_cancellation,
                        Some(accounting),
                    )
                    .await
                    .map_err(map_incoming_io_failure)?;
                    consumed = 0;
                }
                let feed = handshake
                    .feed(&network_buffer[consumed..buffered])
                    .map_err(|error| IncomingHandshakeFailure::Invalid {
                        info_hash: None,
                        mse_failure: Some(MseHandshakeFailure::Protocol(error)),
                    })?;
                consumed += feed.consumed;
                feed.step
            }
            MseStep::Action(MseAction::ComputePublicKey { private }) => {
                accounting.exponentiation_started();
                let (private, public) =
                    shared
                        .mse_dh
                        .compute_public_key(private)
                        .await
                        .map_err(|_| IncomingHandshakeFailure::Invalid {
                            info_hash: None,
                            mse_failure: Some(MseHandshakeFailure::DiffieHellman),
                        })?;
                handshake
                    .resume(MseResume::PublicKeyComputed { private, public })
                    .map_err(|error| IncomingHandshakeFailure::Invalid {
                        info_hash: None,
                        mse_failure: Some(MseHandshakeFailure::Protocol(error)),
                    })?
            }
            MseStep::Action(MseAction::ComputeSharedSecret {
                private,
                remote_public,
            }) => {
                accounting.exponentiation_started();
                let shared_secret = shared
                    .mse_dh
                    .compute_shared_secret(private, remote_public)
                    .await
                    .map_err(|_| IncomingHandshakeFailure::Invalid {
                        info_hash: None,
                        mse_failure: Some(MseHandshakeFailure::DiffieHellman),
                    })?;
                handshake
                    .resume(MseResume::SharedSecretComputed(shared_secret))
                    .map_err(|error| IncomingHandshakeFailure::Invalid {
                        info_hash: None,
                        mse_failure: Some(MseHandshakeFailure::Protocol(error)),
                    })?
            }
            MseStep::Action(MseAction::IdentifyTorrent { req2_hash }) => {
                let Some(info_hash) = shared.identify_mse_torrent(req2_hash) else {
                    return Err(IncomingHandshakeFailure::UnknownTorrent);
                };
                handshake
                    .resume(MseResume::TorrentIdentified(Some(info_hash)))
                    .map_err(|error| IncomingHandshakeFailure::Invalid {
                        info_hash: Some(info_hash),
                        mse_failure: Some(MseHandshakeFailure::Protocol(error)),
                    })?
            }
            MseStep::Action(MseAction::Send(bytes)) => {
                write_incoming_mse_action(
                    stream,
                    bytes.as_slice(),
                    deadline,
                    shared,
                    cancellation,
                    budget_cancellation,
                    accounting,
                )
                .await
                .map_err(map_incoming_io_failure)?;
                handshake.resume(MseResume::Sent).map_err(|error| {
                    IncomingHandshakeFailure::Invalid {
                        info_hash: None,
                        mse_failure: Some(MseHandshakeFailure::Protocol(error)),
                    }
                })?
            }
            MseStep::Complete(mut complete) => {
                let info_hash = complete.info_hash;
                let remote_handshake: [u8; HANDSHAKE_LENGTH] = complete
                    .carried
                    .as_slice()
                    .get(..HANDSHAKE_LENGTH)
                    .and_then(|bytes| bytes.try_into().ok())
                    .ok_or(IncomingHandshakeFailure::Invalid {
                        info_hash: Some(info_hash),
                        mse_failure: Some(MseHandshakeFailure::Protocol(
                            rstorrent_protocol::mse::MseHandshakeError::BufferOverflow,
                        )),
                    })?;
                let decoded = decode_handshake(&remote_handshake, info_hash).map_err(|_| {
                    IncomingHandshakeFailure::Invalid {
                        info_hash: Some(info_hash),
                        mse_failure: Some(MseHandshakeFailure::BitTorrentHandshake),
                    }
                })?;
                let mut carried = complete.carried.as_slice()[HANDSHAKE_LENGTH..].to_vec();
                if consumed < buffered {
                    let unread = &mut network_buffer[consumed..buffered];
                    if let Some(ciphers) = complete.ciphers.as_mut() {
                        ciphers.apply_receive(unread);
                    }
                    carried.extend_from_slice(unread);
                }
                accounting.carried_wire(carried.len());
                record_bytes(
                    shared.byte_metric_sink.as_ref(),
                    ByteMetric::PeerProtocolReceived,
                    HANDSHAKE_LENGTH,
                );
                accounting.protocol_received(HANDSHAKE_LENGTH);
                return Ok(ReceivedIncomingHandshake {
                    info_hash,
                    handshake: decoded,
                    method: Some(complete.method),
                    ciphers: complete.ciphers,
                    carried,
                    mse_accounting: None,
                });
            }
        };
    }
}

fn random_incoming_mse_padding() -> Result<MsePadding, IncomingHandshakeFailure> {
    let mut selector = [0_u8; 2];
    getrandom::fill(&mut selector).map_err(|_| IncomingHandshakeFailure::Invalid {
        info_hash: None,
        mse_failure: Some(MseHandshakeFailure::Entropy),
    })?;
    let len = usize::from(u16::from_ne_bytes(selector)) % (MSE_MAX_PADDING_LEN + 1);
    let mut bytes = [0_u8; MSE_MAX_PADDING_LEN];
    getrandom::fill(&mut bytes[..len]).map_err(|_| IncomingHandshakeFailure::Invalid {
        info_hash: None,
        mse_failure: Some(MseHandshakeFailure::Entropy),
    })?;
    MsePadding::new(&bytes[..len]).map_err(|error| IncomingHandshakeFailure::Invalid {
        info_hash: None,
        mse_failure: Some(MseHandshakeFailure::Protocol(error)),
    })
}

fn map_incoming_io_failure(error: IncomingIoFailure) -> IncomingHandshakeFailure {
    match error {
        IncomingIoFailure::Cancelled => IncomingHandshakeFailure::Cancelled,
        IncomingIoFailure::Timeout => IncomingHandshakeFailure::Timeout,
        IncomingIoFailure::Invalid => IncomingHandshakeFailure::Invalid {
            info_hash: None,
            mse_failure: Some(MseHandshakeFailure::TransportIo),
        },
    }
}

fn incoming_mse_failure_reason(failure: &IncomingHandshakeFailure) -> MseHandshakeFailure {
    match failure {
        IncomingHandshakeFailure::Cancelled => MseHandshakeFailure::Cancelled,
        IncomingHandshakeFailure::Timeout => MseHandshakeFailure::TimedOut,
        IncomingHandshakeFailure::Invalid { mse_failure, .. } => {
            mse_failure.unwrap_or(MseHandshakeFailure::BitTorrentHandshake)
        }
        IncomingHandshakeFailure::UnknownTorrent => MseHandshakeFailure::UnknownTorrent,
    }
}

async fn read_incoming_exact(
    stream: &mut PeerStream,
    bytes: &mut [u8],
    deadline: Instant,
    shared: &Arc<Shared>,
    cancellation: &CancellationToken,
    budget_cancellation: &CancellationToken,
) -> Result<(), IncomingIoFailure> {
    let mut read = 0;
    while read < bytes.len() {
        read += read_incoming_some(
            stream,
            &mut bytes[read..],
            deadline,
            shared,
            cancellation,
            budget_cancellation,
            None,
        )
        .await?;
    }
    Ok(())
}

async fn read_incoming_some(
    stream: &mut PeerStream,
    bytes: &mut [u8],
    deadline: Instant,
    shared: &Arc<Shared>,
    cancellation: &CancellationToken,
    budget_cancellation: &CancellationToken,
    accounting: Option<&mut MseHandshakeAccounting>,
) -> Result<usize, IncomingIoFailure> {
    let read = tokio::select! {
        biased;
        _ = cancellation.cancelled() => return Err(IncomingIoFailure::Cancelled),
        _ = budget_cancellation.cancelled() => return Err(IncomingIoFailure::Cancelled),
        result = timeout_at(deadline, stream.read(bytes)) => result,
    }
    .map_err(|_| IncomingIoFailure::Timeout)?
    .map_err(|_| IncomingIoFailure::Invalid)?;
    if read == 0 {
        return Err(IncomingIoFailure::Invalid);
    }
    record_bytes(
        shared.byte_metric_sink.as_ref(),
        ByteMetric::PeerWireReceived,
        read,
    );
    if let Some(accounting) = accounting {
        accounting.wire_received(read);
    }
    Ok(read)
}

async fn write_incoming_mse_action(
    stream: &mut PeerStream,
    bytes: &[u8],
    deadline: Instant,
    shared: &Arc<Shared>,
    cancellation: &CancellationToken,
    budget_cancellation: &CancellationToken,
    accounting: &mut MseHandshakeAccounting,
) -> Result<(), IncomingIoFailure> {
    let mut written = 0;
    while written < bytes.len() {
        let count = tokio::select! {
            biased;
            _ = cancellation.cancelled() => return Err(IncomingIoFailure::Cancelled),
            _ = budget_cancellation.cancelled() => return Err(IncomingIoFailure::Cancelled),
            result = timeout_at(deadline, stream.write(&bytes[written..])) => result,
        }
        .map_err(|_| IncomingIoFailure::Timeout)?
        .map_err(|_| IncomingIoFailure::Invalid)?;
        if count == 0 {
            return Err(IncomingIoFailure::Invalid);
        }
        record_bytes(
            shared.byte_metric_sink.as_ref(),
            ByteMetric::PeerWireSent,
            count,
        );
        accounting.wire_sent(count);
        written += count;
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn write_incoming_response(
    stream: &mut PeerStream,
    bytes: &[u8],
    deadline: Instant,
    shared: &Arc<Shared>,
    cancellation: &CancellationToken,
    registration_cancellation: &CancellationToken,
    budget_cancellation: &CancellationToken,
    mut accounting: Option<&mut MseHandshakeAccounting>,
) -> Result<(), IncomingIoFailure> {
    let mut written = 0;
    while written < bytes.len() {
        let count = tokio::select! {
            biased;
            _ = cancellation.cancelled() => return Err(IncomingIoFailure::Cancelled),
            _ = registration_cancellation.cancelled() => {
                return Err(IncomingIoFailure::Cancelled);
            }
            _ = budget_cancellation.cancelled() => return Err(IncomingIoFailure::Cancelled),
            result = timeout_at(deadline, stream.write(&bytes[written..])) => result,
        }
        .map_err(|_| IncomingIoFailure::Timeout)?
        .map_err(|_| IncomingIoFailure::Invalid)?;
        if count == 0 {
            return Err(IncomingIoFailure::Invalid);
        }
        record_bytes(
            shared.byte_metric_sink.as_ref(),
            ByteMetric::PeerWireSent,
            count,
        );
        if let Some(accounting) = accounting.as_deref_mut() {
            accounting.wire_sent(count);
        }
        written += count;
    }
    Ok(())
}

fn finish_incoming_mse_failure(
    shared: &Shared,
    accounting: &mut Option<MseHandshakeAccounting>,
    failure: MseHandshakeFailure,
) {
    let Some(accounting) = accounting.take() else {
        return;
    };
    record_mse_handshake(
        shared.mse_handshake_sink.as_ref(),
        accounting.finish(MseHandshakeOutcome::Failed(failure), false),
    );
}

fn finish_incoming_mse_success(
    shared: &Shared,
    accounting: &mut Option<MseHandshakeAccounting>,
    method: MseMethod,
) {
    let Some(accounting) = accounting.take() else {
        return;
    };
    record_mse_handshake(
        shared.mse_handshake_sink.as_ref(),
        accounting.finish(MseHandshakeOutcome::Negotiated(method), false),
    );
}

async fn run_handshake(
    mut stream: PeerStream,
    remote: SocketAddr,
    timeout: Duration,
    shared: Arc<Shared>,
    cancellation: CancellationToken,
    mut budget_permit: PeerBudgetPermit,
) {
    if !shared.accepting_incoming.load(Ordering::Acquire) {
        return;
    }
    let remote = stream.peer_addr().unwrap_or(remote);
    let budget_cancellation = budget_permit.cancellation_token();
    let deadline = Instant::now() + timeout;
    let policy = shared.encryption_policy();
    let transport = stream.transport();
    let received = match receive_incoming_handshake(
        &mut stream,
        deadline,
        policy,
        &shared,
        &cancellation,
        &budget_cancellation,
    )
    .await
    {
        Ok(received) => received,
        Err(IncomingHandshakeFailure::Cancelled) => return,
        Err(IncomingHandshakeFailure::Timeout) => {
            shared.reject(
                IncomingRejectionReason::HandshakeTimeout,
                Some(remote),
                None,
            );
            return;
        }
        Err(IncomingHandshakeFailure::Invalid { info_hash, .. }) => {
            shared.reject(
                IncomingRejectionReason::HandshakeInvalid,
                Some(remote),
                info_hash,
            );
            return;
        }
        Err(IncomingHandshakeFailure::UnknownTorrent) => {
            shared.reject(IncomingRejectionReason::UnknownTorrent, Some(remote), None);
            return;
        }
    };
    let mut mse_accounting = received.mse_accounting;
    let request_info_hash = received.info_hash;
    let handshake = received.handshake;
    let mse_method = received.method;
    if handshake.peer_id == shared.peer_id {
        finish_incoming_mse_failure(
            &shared,
            &mut mse_accounting,
            MseHandshakeFailure::SelfConnection,
        );
        shared.reject(
            IncomingRejectionReason::SelfConnection,
            Some(remote),
            Some(request_info_hash),
        );
        return;
    }
    let registration = shared.registration_for_handshake(request_info_hash, &handshake);
    let Some((response_key, registration)) = registration else {
        finish_incoming_mse_failure(
            &shared,
            &mut mse_accounting,
            MseHandshakeFailure::UnknownTorrent,
        );
        shared.reject(
            IncomingRejectionReason::UnknownTorrent,
            Some(remote),
            Some(request_info_hash),
        );
        return;
    };
    let info_hash = response_key.into_bytes();
    if !registration.accepting.load(Ordering::Acquire)
        || !registration.healthy.load(Ordering::Acquire)
    {
        finish_incoming_mse_failure(
            &shared,
            &mut mse_accounting,
            MseHandshakeFailure::StaleRegistration,
        );
        shared.reject(
            IncomingRejectionReason::StaleRegistration,
            Some(remote),
            Some(info_hash),
        );
        return;
    }
    let local = match stream.local_addr() {
        Ok(local) => local,
        Err(_) => {
            finish_incoming_mse_failure(
                &shared,
                &mut mse_accounting,
                MseHandshakeFailure::TransportIo,
            );
            shared.reject(
                IncomingRejectionReason::HandshakeInvalid,
                Some(remote),
                Some(info_hash),
            );
            return;
        }
    };
    let attachment = match registration
        .data
        .torrent_peers
        .begin_incoming_with_transport(
            remote,
            local,
            handshake.peer_id,
            handshake.supports_extensions(),
            PeerConnectionRole::Content,
            transport,
            mse_method,
        ) {
        Ok(attachment) => attachment,
        Err(_) => {
            finish_incoming_mse_failure(
                &shared,
                &mut mse_accounting,
                MseHandshakeFailure::PeerAdmission,
            );
            shared.reject(
                IncomingRejectionReason::PeerState,
                Some(remote),
                Some(info_hash),
            );
            return;
        }
    };
    let mut peer_attachment =
        IncomingPeerAttachmentGuard::new(registration.data.torrent_peers.clone(), attachment);
    registration
        .data
        .torrent_peers
        .register_connection_cancellation(attachment.connection_id(), budget_cancellation.clone());
    let reserved = advertised_reserved_bits(true);
    let capabilities = NegotiatedPeerCapabilities::negotiate(reserved, &handshake);
    let mut response = encode_handshake_with_reserved(info_hash, shared.peer_id, reserved);
    let mut ciphers = received.ciphers;
    if let Some(ciphers) = ciphers.as_mut() {
        ciphers.apply_send(&mut response);
    }
    let response_result = write_incoming_response(
        &mut stream,
        &response,
        deadline,
        &shared,
        &cancellation,
        &registration.cancellation,
        &budget_cancellation,
        mse_accounting.as_mut(),
    )
    .await;
    match response_result {
        Ok(()) => {}
        Err(IncomingIoFailure::Cancelled) => {
            finish_incoming_mse_failure(
                &shared,
                &mut mse_accounting,
                MseHandshakeFailure::Cancelled,
            );
            peer_attachment.begin_disconnect(None);
            return;
        }
        Err(IncomingIoFailure::Timeout) => {
            finish_incoming_mse_failure(
                &shared,
                &mut mse_accounting,
                MseHandshakeFailure::TimedOut,
            );
            peer_attachment.begin_disconnect(Some(PeerFailure::Handshake));
            shared.reject(
                IncomingRejectionReason::HandshakeTimeout,
                Some(remote),
                Some(info_hash),
            );
            return;
        }
        Err(IncomingIoFailure::Invalid) => {
            finish_incoming_mse_failure(
                &shared,
                &mut mse_accounting,
                MseHandshakeFailure::TransportIo,
            );
            peer_attachment.begin_disconnect(Some(PeerFailure::Handshake));
            shared.reject(
                IncomingRejectionReason::HandshakeTimeout,
                Some(remote),
                Some(info_hash),
            );
            return;
        }
    }
    let admission = peer_attachment.handshake_completed(shared.peer_id);
    if !matches!(
        admission,
        Ok(crate::peer_runtime::PeerAdmissionOutcome::Admitted { .. })
    ) {
        finish_incoming_mse_failure(
            &shared,
            &mut mse_accounting,
            MseHandshakeFailure::PeerAdmission,
        );
        shared.reject(
            IncomingRejectionReason::PeerState,
            Some(remote),
            Some(info_hash),
        );
        return;
    }
    record_bytes(
        shared.byte_metric_sink.as_ref(),
        ByteMetric::PeerProtocolSent,
        response.len(),
    );
    if let Some(accounting) = mse_accounting.as_mut() {
        accounting.protocol_sent(response.len());
    }
    if let Some(method) = mse_method {
        finish_incoming_mse_success(&shared, &mut mse_accounting, method);
    }
    budget_permit.mark_established();
    if !registration
        .admit(IncomingAdmission {
            stream,
            ciphers,
            carried: received.carried,
            remote,
            capabilities: IncomingPeerCapabilities {
                extensions: handshake.supports_extensions(),
                fast: capabilities.fast_extension,
            },
            permit: budget_permit,
            shared: shared.clone(),
            peer_attachment,
        })
        .await
    {
        shared.reject(
            IncomingRejectionReason::StaleRegistration,
            Some(remote),
            Some(info_hash),
        );
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PeerTermination {
    Closed,
    Cancelled,
    ActivityTimeout,
    NoRequestTimeout,
    InactivityTimeout,
    Protocol,
    Storage,
}

impl PeerTermination {
    fn peer_failure(self) -> Option<PeerFailure> {
        match self {
            Self::Closed => Some(PeerFailure::RemoteClosed),
            Self::Protocol => Some(PeerFailure::Protocol),
            Self::Cancelled
            | Self::ActivityTimeout
            | Self::NoRequestTimeout
            | Self::InactivityTimeout
            | Self::Storage => None,
        }
    }
}

type ActiveRead = (UploadRead, JoinHandle<Result<Vec<u8>, ()>>);

struct IncomingUploadMembership {
    id: crate::upload_scheduler::UploadPeerId,
    grants: tokio::sync::watch::Receiver<UploadGrant>,
    peer: Arc<UploadCounter>,
    torrent: Arc<UploadCounter>,
}

struct IncomingPeerStart {
    capabilities: IncomingPeerCapabilities,
    ciphers: Option<MseCipherPair>,
    carried: Vec<u8>,
    remote: SocketAddr,
    registration: Arc<SeedRegistration>,
    cancellation: CancellationToken,
    budget_cancellation: CancellationToken,
    shared: Arc<Shared>,
    peer_attachment: IncomingPeerAttachmentGuard,
    membership: IncomingUploadMembership,
}

#[derive(Clone, Copy)]
struct IncomingPeerCapabilities {
    extensions: bool,
    fast: bool,
}

struct IncomingPeerConnectionRuntime {
    shared: Arc<Shared>,
    attachment: IncomingPeerAttachmentGuard,
    upload_peer: crate::upload_scheduler::UploadPeerId,
    grants: tokio::sync::watch::Receiver<UploadGrant>,
    peer_upload: Arc<UploadCounter>,
    content_bridge: Option<IncomingContentBridge>,
}

struct IncomingContentBridge {
    attachment: IncomingPeerAttachment,
    events: tokio::sync::mpsc::Sender<IncomingContentEvent>,
    commands: tokio::sync::mpsc::Receiver<IncomingContentCommand>,
}

impl IncomingContentBridge {
    async fn attach(
        registration: &SeedRegistration,
        attachment: IncomingPeerAttachment,
        capabilities: IncomingPeerCapabilities,
        protocol: PeerProtocol,
    ) -> Option<Self> {
        let events = registration.torrent_peers.incoming_content_route()?;
        let (commands, command_receiver) =
            tokio::sync::mpsc::channel(INCOMING_CONTENT_COMMAND_CAPACITY);
        events
            .send(IncomingContentEvent::Connected {
                attachment,
                capabilities: IncomingContentCapabilities {
                    fast: capabilities.fast,
                    protocol,
                },
                commands,
            })
            .await
            .ok()?;
        Some(Self {
            attachment,
            events,
            commands: command_receiver,
        })
    }

    async fn forward(&self, message: PeerMessage) -> Result<(), ()> {
        self.events
            .send(IncomingContentEvent::Message {
                attachment: self.attachment,
                message,
            })
            .await
            .map_err(|_| ())
    }

    fn stopped(&self, failure: Option<PeerFailure>) {
        let _ = self.events.try_send(IncomingContentEvent::Stopped {
            attachment: self.attachment,
            failure,
        });
    }
}

#[derive(Default)]
struct QueuedPieceFrames {
    frames: Vec<(BlockRequest, Weak<FrameValidity>)>,
}

#[derive(Default)]
struct QueuedChokeFrame {
    latest: Option<Weak<FrameValidity>>,
}

impl QueuedChokeFrame {
    fn replace(&mut self) -> Arc<FrameValidity> {
        if let Some(validity) = self.latest.take().and_then(|validity| validity.upgrade()) {
            validity.cancel();
        }
        let validity = Arc::new(FrameValidity::new());
        self.latest = Some(Arc::downgrade(&validity));
        validity
    }
}

impl QueuedPieceFrames {
    fn track(&mut self, request: BlockRequest) -> Arc<FrameValidity> {
        self.frames
            .retain(|(_, validity)| validity.strong_count() != 0);
        let validity = Arc::new(FrameValidity::new());
        self.frames.push((request, Arc::downgrade(&validity)));
        validity
    }

    fn cancel(&mut self, request: BlockRequest) {
        self.frames.retain(|(queued, validity)| {
            let Some(validity) = validity.upgrade() else {
                return false;
            };
            if *queued == request {
                validity.cancel();
            }
            true
        });
    }

    fn cancel_all(&mut self) {
        self.frames.retain(|(_, validity)| {
            let Some(validity) = validity.upgrade() else {
                return false;
            };
            validity.cancel();
            true
        });
    }
}

const MIN_UPLOAD_SEND_TARGET: usize = 10 * 1_024;
const MAX_PIECE_FRAME_BYTES: usize = MAX_REQUEST_BLOCK_LENGTH as usize + 13;
// A read completion may cross the target after the upload state has already
// started the following read. Reserve both Piece frames beneath the writer's
// hard byte fence so ordinary backpressure cannot become a peer disconnect.
const MAX_UPLOAD_SEND_TARGET: usize = MAX_INCOMING_WRITER_BYTES - 2 * MAX_PIECE_FRAME_BYTES;
const UPLOAD_SEND_TARGET_FACTOR_PERCENT: u64 = 50;

struct UploadSendTarget {
    window_started: Instant,
    window_payload: u64,
    target: usize,
}

impl UploadSendTarget {
    fn new(payload: u64) -> Self {
        Self {
            window_started: Instant::now(),
            window_payload: payload,
            target: MIN_UPLOAD_SEND_TARGET,
        }
    }

    fn observe(&mut self, payload: u64) {
        let elapsed = self.window_started.elapsed();
        if elapsed < Duration::from_secs(1) {
            return;
        }
        let millis = u64::try_from(elapsed.as_millis())
            .unwrap_or(u64::MAX)
            .max(1);
        let per_second = payload
            .saturating_sub(self.window_payload)
            .saturating_mul(1_000)
            / millis;
        let target = per_second.saturating_mul(UPLOAD_SEND_TARGET_FACTOR_PERCENT) / 100;
        self.target = usize::try_from(target)
            .unwrap_or(usize::MAX)
            .clamp(MIN_UPLOAD_SEND_TARGET, MAX_UPLOAD_SEND_TARGET);
        self.window_started = Instant::now();
        self.window_payload = payload;
    }
}

async fn run_incoming_peer(
    stream: PeerStream,
    start: IncomingPeerStart,
) -> (PeerTermination, IncomingPeerAttachmentGuard) {
    let IncomingPeerStart {
        capabilities,
        ciphers,
        carried,
        remote,
        registration,
        cancellation,
        budget_cancellation,
        shared,
        peer_attachment,
        membership,
    } = start;
    let IncomingUploadMembership {
        id: upload_peer,
        grants,
        peer: peer_upload,
        torrent: torrent_upload,
    } = membership;
    let byte_metric_sink: Arc<dyn ByteMetricSink> = Arc::new(IncomingUploadMetricSink {
        upstream: shared.byte_metric_sink.clone(),
        torrent_accounting: registration.byte_metric_sink.clone(),
        peer: peer_upload.clone(),
        torrent: torrent_upload,
        session: shared.session_upload.clone(),
    });
    let protocol = match registration.swarm_key {
        SwarmKey::V1(_) => PeerProtocol::V1,
        SwarmKey::V2Truncated(_) => PeerProtocol::V2,
    };
    let mut io = match IncomingPeerIo::new_with_mse_bandwidth_and_protocol(
        stream,
        shared.peer_activity_timeout,
        Some(byte_metric_sink),
        ciphers,
        &carried,
        registration.torrent_peers.bandwidth(),
        protocol,
    ) {
        Ok(io) => io,
        Err(_) => return (PeerTermination::Protocol, peer_attachment),
    };
    let content_bridge = IncomingContentBridge::attach(
        &registration,
        peer_attachment.attachment,
        capabilities,
        protocol,
    )
    .await;
    let mut runtime = IncomingPeerConnectionRuntime {
        shared,
        attachment: peer_attachment,
        upload_peer,
        grants,
        peer_upload,
        content_bridge,
    };
    let termination = run_incoming_peer_loop(
        &mut io,
        capabilities,
        remote,
        registration,
        cancellation,
        budget_cancellation,
        &mut runtime,
    )
    .await;
    if let Some(bridge) = &runtime.content_bridge {
        bridge.stopped(termination.peer_failure());
    }
    runtime
        .attachment
        .begin_disconnect(termination.peer_failure());
    let payload = io.uploaded_payload_bytes();
    if payload != 0 {
        runtime
            .shared
            .upload_coordinator
            .update_payload(runtime.upload_peer, payload);
    }
    let termination = match (termination, io.shutdown().await) {
        (PeerTermination::Cancelled, _) => PeerTermination::Cancelled,
        (termination, Ok(())) => termination,
        (_, Err(_)) => PeerTermination::Closed,
    };
    runtime
        .attachment
        .finalize_upload(runtime.peer_upload.snapshot());
    runtime
        .attachment
        .begin_disconnect(termination.peer_failure());
    (termination, runtime.attachment)
}

async fn run_incoming_peer_loop(
    io: &mut IncomingPeerIo,
    capabilities: IncomingPeerCapabilities,
    remote: SocketAddr,
    registration: Arc<SeedRegistration>,
    cancellation: CancellationToken,
    budget_cancellation: CancellationToken,
    runtime: &mut IncomingPeerConnectionRuntime,
) -> PeerTermination {
    let IncomingPeerCapabilities {
        extensions: supports_extensions,
        fast: supports_fast,
    } = capabilities;
    let shared = &runtime.shared;
    let peer_attachment = &runtime.attachment;
    let upload_peer = runtime.upload_peer;
    let grants = &mut runtime.grants;
    let peer_upload = &runtime.peer_upload;
    let self_endpoint = shared
        .listener
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .listen_address;
    let network_policy = if self_endpoint.ip().is_loopback() {
        NetworkPolicy::LoopbackOnly
    } else {
        NetworkPolicy::Online
    };
    let mut upload = match registration
        .content
        .upload_state(registration.piece_lengths.clone())
    {
        Ok(upload) => upload,
        Err(_) => return PeerTermination::Storage,
    };
    let allowed_fast = if supports_fast {
        match remote.ip() {
            std::net::IpAddr::V4(address) => match generate_allowed_fast_set(
                registration.info_hash(),
                address,
                registration.piece_lengths.len(),
                MAX_GENERATED_ALLOWED_FAST_PIECES,
            ) {
                Ok(allowed) => allowed,
                Err(_) => return PeerTermination::Protocol,
            },
            std::net::IpAddr::V6(_) => Vec::new(),
        }
    } else {
        Vec::new()
    };
    if supports_fast
        && upload
            .enable_fast_extension(allowed_fast.iter().copied())
            .is_err()
    {
        return PeerTermination::Protocol;
    }
    if !supports_extensions && peer_attachment.set_metadata_extension(false).is_err() {
        return PeerTermination::Protocol;
    }
    if publish_incoming_upload(peer_attachment, &upload, *grants.borrow(), io, peer_upload).is_err()
    {
        return PeerTermination::Protocol;
    }
    if let Some(initial_availability) = upload.initial_availability_message(supports_fast)
        && io.send_message(&initial_availability).await.is_err()
    {
        return PeerTermination::Closed;
    }
    let mut peer_exchange_updates = shared.peer_exchange.subscribe();
    let mut peer_exchange_enabled = shared.peer_exchange.load() && !registration.private;
    let mut availability_cursor = upload.availability().snapshot().cursor();
    for piece in allowed_fast {
        if io
            .send_message(&PeerMessage::AllowedFast(piece))
            .await
            .is_err()
        {
            return PeerTermination::Closed;
        }
    }
    if supports_extensions
        && io
            .send_message(&PeerMessage::Extended {
                id: 0,
                payload: encode_recognized_extension_handshake(ExtensionAdvertisement {
                    metadata_id: Some(UT_METADATA_LOCAL_ID),
                    pex_id: peer_exchange_enabled.then_some(UT_PEX_LOCAL_ID),
                    metadata_size: Some(registration.raw_info.len()),
                    listen_port: Some(self_endpoint.port()),
                })
                .expect("verified local extension advertisement is valid"),
            })
            .await
            .is_err()
    {
        return PeerTermination::Closed;
    }
    let mut metadata = match MetadataUpload::new(&registration.raw_info) {
        Ok(metadata) => metadata,
        Err(_) => return PeerTermination::Storage,
    };
    let mut remote_metadata_id = None;
    let mut fast_initial_availability = false;
    let mut fast_suggestions = BTreeSet::new();
    let mut fast_allowed = BTreeSet::new();
    let mut deferred_metadata = VecDeque::new();
    let mut read: Option<ActiveRead> = None;
    let mut queued_piece_frames = QueuedPieceFrames::default();
    let mut queued_choke_frame = QueuedChokeFrame::default();
    let mut accounted_payload = io.uploaded_payload_bytes();
    let mut send_target = UploadSendTarget::new(accounted_payload);
    let maintenance_cadence = Duration::from_secs(1)
        .min(shared.peer_activity_timeout)
        .min(shared.keepalive_interval)
        .min(shared.no_request_timeout)
        .min(shared.inactivity_timeout);
    let mut maintenance = tokio::time::interval(maintenance_cadence);
    maintenance.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut last_peer_activity = Instant::now();
    let mut last_meaningful_activity = last_peer_activity;
    let mut last_request_or_unchoke = last_peer_activity;
    let mut last_keepalive = last_peer_activity;
    loop {
        match upload.availability().drain(availability_cursor) {
            AvailabilityDrain::Changes { cursor, pieces, .. } => {
                availability_cursor = cursor;
                for piece in pieces {
                    if io.queue_message(&PeerMessage::Have(piece)).is_err() {
                        join_read(read.take()).await;
                        return PeerTermination::Closed;
                    }
                }
            }
            AvailabilityDrain::EpochChanged(_) | AvailabilityDrain::Lagged => {
                join_read(read.take()).await;
                return PeerTermination::Storage;
            }
        }
        send_target.observe(io.uploaded_payload_bytes());
        let ready = io.send_buffer_size() < send_target.target;
        if let Some(termination) = apply_upload_actions(
            upload.set_read_enabled(ready),
            io,
            &mut read,
            &mut queued_piece_frames,
            &mut queued_choke_frame,
            &registration,
            shared,
        )
        .await
        {
            return termination;
        }
        if drain_metadata_requests(
            io,
            &mut metadata,
            remote_metadata_id,
            &mut deferred_metadata,
        )
        .is_err()
        {
            join_read(read.take()).await;
            return PeerTermination::Closed;
        }
        let event = tokio::select! {
            biased;
            _ = cancellation.cancelled() => PeerEvent::Cancelled,
            _ = budget_cancellation.cancelled() => PeerEvent::Cancelled,
            _ = maintenance.tick() => PeerEvent::Maintenance,
            changed = grants.changed() => PeerEvent::Grant(changed.map(|()| *grants.borrow_and_update())),
            changed = peer_exchange_updates.changed() => PeerEvent::PeerExchange(
                changed.map(|()| *peer_exchange_updates.borrow_and_update())
            ),
            command = async {
                runtime.content_bridge
                    .as_mut()
                    .expect("content command branch is guarded")
                    .commands
                    .recv()
                    .await
            }, if runtime.content_bridge.is_some() => PeerEvent::ContentCommand(command),
            joined = async {
                let (_, task) = read.as_mut().expect("read branch is guarded");
                task.await
            }, if read.is_some() => PeerEvent::Read(joined),
            message = io.next_message_or_send_ready(send_target.target.min(METADATA_SEND_BUFFER_WATERMARK)) => {
                PeerEvent::Message(message)
            },
        };
        let actions = match event {
            PeerEvent::Cancelled => {
                join_read(read.take()).await;
                let actions = upload.shutdown();
                if let Some(termination) = apply_upload_actions(
                    actions,
                    io,
                    &mut read,
                    &mut queued_piece_frames,
                    &mut queued_choke_frame,
                    &registration,
                    shared,
                )
                .await
                {
                    return termination;
                }
                let _ = io.flush().await;
                return PeerTermination::Cancelled;
            }
            PeerEvent::Maintenance => {
                let now = Instant::now();
                if !io.download_rate_limited()
                    && now.saturating_duration_since(last_peer_activity)
                        >= shared.peer_activity_timeout
                {
                    join_read(read.take()).await;
                    return PeerTermination::ActivityTimeout;
                }
                let snapshot = upload.snapshot();
                if !io.download_rate_limited()
                    && snapshot.interested
                    && !snapshot.choking
                    && snapshot.queued_requests == 0
                    && read.is_none()
                    && io.send_buffer_size() == 0
                    && now.saturating_duration_since(last_request_or_unchoke)
                        >= shared.no_request_timeout
                {
                    return PeerTermination::NoRequestTimeout;
                }
                let budget = shared.peer_budget.snapshot();
                if !io.upload_rate_limited()
                    && !io.download_rate_limited()
                    && budget.total >= budget.effective_limit
                    && now.saturating_duration_since(last_meaningful_activity)
                        >= shared.inactivity_timeout
                {
                    join_read(read.take()).await;
                    return PeerTermination::InactivityTimeout;
                }
                match peer_exchange_enabled.then(|| peer_attachment.next_pex(remote)) {
                    Some(Ok(Some((id, payload)))) => {
                        if io
                            .queue_message(&PeerMessage::Extended { id, payload })
                            .is_err()
                        {
                            return PeerTermination::Closed;
                        }
                    }
                    Some(Ok(None)) | None => {}
                    Some(Err(())) => return PeerTermination::Protocol,
                }
                if now.saturating_duration_since(last_keepalive) >= shared.keepalive_interval {
                    last_keepalive = now;
                    vec![UploadAction::Send(PeerMessage::KeepAlive)]
                } else {
                    Vec::new()
                }
            }
            PeerEvent::Read(joined) => {
                let (pending, _) = read.take().expect("completed read is present");
                let result = match joined {
                    Ok(result) => result,
                    Err(_) => Err(()),
                };
                upload.on_read_complete(pending, result)
            }
            PeerEvent::Grant(Ok(grant)) => {
                if grant == UploadGrant::Choked && !supports_fast {
                    queued_piece_frames.cancel_all();
                }
                if grant != UploadGrant::Choked {
                    last_request_or_unchoke = Instant::now();
                    last_meaningful_activity = last_request_or_unchoke;
                }
                upload.set_granted(grant != UploadGrant::Choked)
            }
            PeerEvent::Grant(Err(_)) => {
                join_read(read.take()).await;
                return PeerTermination::Cancelled;
            }
            PeerEvent::PeerExchange(Ok(enabled)) => {
                let enabled = enabled && !registration.private;
                if enabled != peer_exchange_enabled {
                    if peer_attachment.apply_peer_exchange_policy(enabled).is_err() {
                        return PeerTermination::Protocol;
                    }
                    peer_exchange_enabled = enabled;
                    if supports_extensions
                        && io
                            .queue_message(&PeerMessage::Extended {
                                id: 0,
                                payload: encode_extension_handshake_update(ExtensionHandshake {
                                    pex: if enabled {
                                        ExtensionUpdate::Enabled(UT_PEX_LOCAL_ID)
                                    } else {
                                        ExtensionUpdate::Disabled
                                    },
                                    ..ExtensionHandshake::default()
                                })
                                .expect("the stable local PEX extension update is valid"),
                            })
                            .is_err()
                    {
                        return PeerTermination::Closed;
                    }
                }
                Vec::new()
            }
            PeerEvent::PeerExchange(Err(_)) => return PeerTermination::Cancelled,
            PeerEvent::ContentCommand(Some(IncomingContentCommand::Send(message))) => {
                if io.queue_message(&message).is_err() {
                    join_read(read.take()).await;
                    return PeerTermination::Closed;
                }
                Vec::new()
            }
            PeerEvent::ContentCommand(None) => {
                runtime.content_bridge = None;
                Vec::new()
            }
            PeerEvent::Message(Ok(None)) => Vec::new(),
            PeerEvent::Message(Err(crate::peer_io::PeerIoError::Frame(_))) => {
                join_read(read.take()).await;
                return PeerTermination::Protocol;
            }
            PeerEvent::Message(Err(_)) => {
                join_read(read.take()).await;
                return PeerTermination::Closed;
            }
            PeerEvent::Message(Ok(Some(message))) => {
                last_peer_activity = Instant::now();
                if validate_incoming_fast_message(
                    supports_fast,
                    &message,
                    registration.piece_lengths.len(),
                    &mut fast_initial_availability,
                    &mut fast_suggestions,
                    &mut fast_allowed,
                )
                .is_err()
                {
                    join_read(read.take()).await;
                    return PeerTermination::Protocol;
                }
                if matches!(
                    message,
                    PeerMessage::Choke
                        | PeerMessage::Unchoke
                        | PeerMessage::Have(_)
                        | PeerMessage::Bitfield(_)
                        | PeerMessage::HaveAll
                        | PeerMessage::HaveNone
                        | PeerMessage::RejectRequest(_)
                        | PeerMessage::Piece { .. }
                        | PeerMessage::SuggestPiece(_)
                        | PeerMessage::AllowedFast(_)
                        | PeerMessage::Hashes(_)
                        | PeerMessage::HashReject(_)
                ) && let Some(bridge) = runtime.content_bridge.as_ref()
                    && bridge.forward(message.clone()).await.is_err()
                {
                    runtime.content_bridge = None;
                }
                if matches!(
                    message,
                    PeerMessage::Interested
                        | PeerMessage::NotInterested
                        | PeerMessage::Request(_)
                        | PeerMessage::Cancel(_)
                ) {
                    last_meaningful_activity = last_peer_activity;
                }
                if matches!(message, PeerMessage::Request(_)) {
                    last_request_or_unchoke = last_peer_activity;
                }
                if let PeerMessage::HashRequest(request) = &message {
                    let request = *request;
                    let response = match shared.upload_reads.clone().acquire_owned().await {
                        Ok(_permit) => {
                            let _observation = ObservationGuard::read(shared, 0);
                            registration.hash_response(request).await
                        }
                        Err(_) => None,
                    };
                    let reply =
                        response.map_or(PeerMessage::HashReject(request), PeerMessage::Hashes);
                    if io.queue_message(&reply).is_err() {
                        join_read(read.take()).await;
                        return PeerTermination::Closed;
                    }
                    last_meaningful_activity = last_peer_activity;
                }
                if let PeerMessage::Extended { id: 0, payload } = &message {
                    let handshake = match parse_recognized_extension_handshake(payload) {
                        Ok(handshake) => handshake,
                        Err(_) => return PeerTermination::Protocol,
                    };
                    if peer_attachment
                        .apply_extension_handshake(
                            handshake,
                            remote,
                            !registration.private,
                            peer_exchange_enabled,
                            network_policy,
                        )
                        .is_err()
                    {
                        return PeerTermination::Protocol;
                    }
                } else if let PeerMessage::Extended {
                    id: UT_PEX_LOCAL_ID,
                    payload,
                } = &message
                {
                    if !peer_exchange_enabled {
                        continue;
                    }
                    match peer_attachment.receive_pex(
                        payload,
                        remote,
                        !registration.private,
                        network_policy,
                        self_endpoint,
                    ) {
                        Ok(PexReceiveDisposition::RateLimited { close: true, .. }) | Err(()) => {
                            return PeerTermination::Protocol;
                        }
                        Ok(_) => {}
                    }
                }
                match message {
                    PeerMessage::NotInterested => queued_piece_frames.cancel_all(),
                    PeerMessage::Cancel(request) if !supports_fast => {
                        queued_piece_frames.cancel(request)
                    }
                    _ => {}
                }
                let previous_metadata_id = remote_metadata_id;
                match handle_metadata_message(
                    io,
                    &mut metadata,
                    &mut remote_metadata_id,
                    &mut deferred_metadata,
                    &message,
                ) {
                    Ok(()) => {
                        if remote_metadata_id != previous_metadata_id
                            && peer_attachment
                                .set_metadata_extension(remote_metadata_id.is_some())
                                .is_err()
                        {
                            join_read(read.take()).await;
                            return PeerTermination::Protocol;
                        }
                        let actions = upload.on_message(&message);
                        shared
                            .upload_coordinator
                            .update_interest(upload_peer, upload.snapshot().interested);
                        actions
                    }
                    Err(()) => {
                        join_read(read.take()).await;
                        return PeerTermination::Protocol;
                    }
                }
            }
        };
        if let Some(termination) = apply_upload_actions(
            actions,
            io,
            &mut read,
            &mut queued_piece_frames,
            &mut queued_choke_frame,
            &registration,
            shared,
        )
        .await
        {
            return termination;
        }
        let payload = io.uploaded_payload_bytes();
        let payload_delta = payload.saturating_sub(accounted_payload);
        if payload_delta != 0 {
            accounted_payload = payload;
            last_meaningful_activity = Instant::now();
            shared
                .upload_coordinator
                .update_payload(upload_peer, payload);
        }
        let snapshot = upload.snapshot();
        {
            let mut observations = shared.observations_guard();
            observations.queued_requests_high_water = observations
                .queued_requests_high_water
                .max(snapshot.queued_requests_high_water);
            observations.queued_bytes_high_water = observations
                .queued_bytes_high_water
                .max(snapshot.queued_bytes_high_water);
            observations.metadata_requests_high_water = observations
                .metadata_requests_high_water
                .max(deferred_metadata.len());
            observations.metadata_send_buffer_high_water = observations
                .metadata_send_buffer_high_water
                .max(io.send_buffer_high_water());
            observations.writer_send_buffer_high_water = observations
                .writer_send_buffer_high_water
                .max(io.send_buffer_high_water());
            let scheduler = shared.upload_coordinator.snapshot();
            observations.upload_regular_high_water = observations
                .upload_regular_high_water
                .max(scheduler.regular);
            observations.upload_optimistic_high_water = observations
                .upload_optimistic_high_water
                .max(scheduler.optimistic);
            observations.upload_slots_high_water = observations
                .upload_slots_high_water
                .max(scheduler.regular.saturating_add(scheduler.optimistic));
        }
        let grant = *grants.borrow();
        if publish_incoming_upload(peer_attachment, &upload, grant, io, peer_upload).is_err() {
            join_read(read.take()).await;
            return PeerTermination::Protocol;
        }
    }
}

fn validate_incoming_fast_message(
    negotiated: bool,
    message: &PeerMessage,
    piece_count: usize,
    initial_availability: &mut bool,
    suggestions: &mut BTreeSet<u32>,
    allowed_fast: &mut BTreeSet<u32>,
) -> Result<(), ()> {
    let fast_message = matches!(
        message,
        PeerMessage::SuggestPiece(_)
            | PeerMessage::HaveAll
            | PeerMessage::HaveNone
            | PeerMessage::RejectRequest(_)
            | PeerMessage::AllowedFast(_)
    );
    if !negotiated {
        return if fast_message { Err(()) } else { Ok(()) };
    }
    let initial = matches!(
        message,
        PeerMessage::Bitfield(_) | PeerMessage::HaveAll | PeerMessage::HaveNone
    );
    if !*initial_availability {
        if !initial {
            let requires_availability = fast_message
                || matches!(
                    message,
                    PeerMessage::Have(_)
                        | PeerMessage::Request(_)
                        | PeerMessage::Cancel(_)
                        | PeerMessage::Piece { .. }
                );
            return if requires_availability {
                Err(())
            } else {
                Ok(())
            };
        }
        if let PeerMessage::Bitfield(bitfield) = message {
            let expected = piece_count.div_ceil(8);
            if bitfield.len() != expected {
                return Err(());
            }
            let remainder = piece_count % 8;
            if remainder != 0
                && bitfield
                    .last()
                    .is_some_and(|byte| byte & ((1 << (8 - remainder)) - 1) != 0)
            {
                return Err(());
            }
        }
        *initial_availability = true;
        return Ok(());
    }
    if initial {
        return Err(());
    }
    let target = match message {
        PeerMessage::SuggestPiece(piece) => Some((*piece, suggestions)),
        PeerMessage::AllowedFast(piece) => Some((*piece, allowed_fast)),
        _ => None,
    };
    if let Some((piece, retained)) = target {
        if usize::try_from(piece).map_or(true, |piece| piece >= piece_count) {
            return Err(());
        }
        if retained.len() < MAX_FAST_ADVISORY_PIECES {
            retained.insert(piece);
        }
    }
    Ok(())
}

fn publish_incoming_upload(
    peer_attachment: &IncomingPeerAttachmentGuard,
    upload: &UploadPeerState,
    grant: UploadGrant,
    io: &IncomingPeerIo,
    peer_upload: &UploadCounter,
) -> Result<(), ()> {
    let upload = upload.snapshot();
    let traffic = peer_upload.snapshot();
    peer_attachment.set_upload(PeerUploadActivity {
        interested: upload.interested,
        grant: match grant {
            UploadGrant::Choked => PeerUploadGrant::Choked,
            UploadGrant::Regular => PeerUploadGrant::Regular,
            UploadGrant::Optimistic => PeerUploadGrant::Optimistic,
        },
        queued_requests: upload.queued_requests,
        queued_bytes: upload.queued_bytes,
        read_active: upload.read_in_flight,
        writer_bytes: io.send_buffer_size(),
        payload_bytes: traffic.payload_bytes,
        payload_rate: traffic.payload_rate_bytes,
    })
}

async fn apply_upload_actions(
    actions: Vec<UploadAction>,
    io: &mut IncomingPeerIo,
    read: &mut Option<ActiveRead>,
    queued_piece_frames: &mut QueuedPieceFrames,
    queued_choke_frame: &mut QueuedChokeFrame,
    registration: &Arc<SeedRegistration>,
    shared: &Arc<Shared>,
) -> Option<PeerTermination> {
    for action in actions {
        match action {
            UploadAction::Send(message) => {
                let result = match &message {
                    PeerMessage::Piece {
                        index,
                        begin,
                        block,
                    } => {
                        let Ok(length) = u32::try_from(block.len()) else {
                            return Some(PeerTermination::Storage);
                        };
                        let validity = queued_piece_frames.track(BlockRequest {
                            index: *index,
                            begin: *begin,
                            length,
                        });
                        io.queue_generation_fenced_message(&message, validity)
                    }
                    PeerMessage::Choke | PeerMessage::Unchoke => {
                        io.queue_generation_fenced_message(&message, queued_choke_frame.replace())
                    }
                    _ => io.queue_message(&message),
                };
                if result.is_err() {
                    join_read(read.take()).await;
                    return Some(PeerTermination::Closed);
                }
            }
            UploadAction::Read(pending) => {
                if read.is_some() {
                    join_read(read.take()).await;
                    return Some(PeerTermination::Protocol);
                }
                let registration = registration.clone();
                let read_permits = shared.upload_reads.clone();
                let read_shared = shared.clone();
                *read = Some((
                    pending,
                    tokio::spawn(async move {
                        let Ok(_permit) = read_permits.acquire_owned().await else {
                            return Err(());
                        };
                        let _observation =
                            ObservationGuard::read(&read_shared, pending.request.length as usize);
                        registration.read_block(pending.request).await
                    }),
                ));
            }
            UploadAction::Close(reason) => {
                join_read(read.take()).await;
                return Some(match reason {
                    UploadCloseReason::ReadFailed | UploadCloseReason::ShortRead => {
                        PeerTermination::Storage
                    }
                    UploadCloseReason::InvalidRequest | UploadCloseReason::RequestLimit => {
                        PeerTermination::Protocol
                    }
                });
            }
        }
    }
    None
}

enum PeerEvent {
    Cancelled,
    Maintenance,
    ContentCommand(Option<IncomingContentCommand>),
    Read(Result<Result<Vec<u8>, ()>, tokio::task::JoinError>),
    Grant(Result<UploadGrant, tokio::sync::watch::error::RecvError>),
    PeerExchange(Result<bool, tokio::sync::watch::error::RecvError>),
    Message(Result<Option<PeerMessage>, crate::peer_io::PeerIoError>),
}

trait MetadataSendBuffer {
    fn queue_metadata_message(&mut self, message: &PeerMessage) -> Result<(), ()>;
    fn metadata_send_buffer_size(&self) -> usize;
}

impl MetadataSendBuffer for PeerIo {
    fn queue_metadata_message(&mut self, message: &PeerMessage) -> Result<(), ()> {
        self.queue_message(message).map_err(|_| ())
    }

    fn metadata_send_buffer_size(&self) -> usize {
        self.send_buffer_size()
    }
}

impl MetadataSendBuffer for IncomingPeerIo {
    fn queue_metadata_message(&mut self, message: &PeerMessage) -> Result<(), ()> {
        self.queue_message(message).map_err(|_| ())
    }

    fn metadata_send_buffer_size(&self) -> usize {
        self.send_buffer_size()
    }
}

fn handle_metadata_message<I: MetadataSendBuffer>(
    io: &mut I,
    upload: &mut MetadataUpload,
    remote_metadata_id: &mut Option<u8>,
    deferred: &mut VecDeque<i64>,
    message: &PeerMessage,
) -> Result<(), ()> {
    match message {
        PeerMessage::Extended { id: 0, payload } => {
            let handshake = parse_extension_handshake(payload).map_err(|_| ())?;
            match handshake.metadata_extension {
                MetadataExtensionUpdate::Unchanged => {}
                MetadataExtensionUpdate::Disabled => {
                    *remote_metadata_id = None;
                    deferred.clear();
                }
                MetadataExtensionUpdate::Enabled(id) => *remote_metadata_id = Some(id),
            }
        }
        PeerMessage::Extended {
            id: UT_METADATA_LOCAL_ID,
            payload,
        } => {
            let message = parse_metadata_message(payload).map_err(|_| ())?;
            let piece = match message {
                MetadataMessage::Request { piece } => piece,
                MetadataMessage::Unknown { .. } => return Ok(()),
                MetadataMessage::Data { .. } | MetadataMessage::Reject { .. } => return Err(()),
            };
            let remote_id = remote_metadata_id.ok_or(())?;
            if !upload.can_serve(piece)
                || io.metadata_send_buffer_size() < METADATA_SEND_BUFFER_WATERMARK
            {
                queue_metadata_response(io, upload, remote_id, piece)?;
            } else if deferred.len() < MAX_DEFERRED_METADATA_REQUESTS {
                deferred.push_back(piece);
            } else {
                io.queue_metadata_message(&PeerMessage::Extended {
                    id: remote_id,
                    payload: encode_metadata_reject(piece),
                })?;
            }
        }
        PeerMessage::Extended { .. } => {}
        _ => {}
    }
    Ok(())
}

fn drain_metadata_requests<I: MetadataSendBuffer>(
    io: &mut I,
    upload: &mut MetadataUpload,
    remote_metadata_id: Option<u8>,
    deferred: &mut VecDeque<i64>,
) -> Result<(), ()> {
    let Some(remote_metadata_id) = remote_metadata_id else {
        return Ok(());
    };
    while io.metadata_send_buffer_size() < METADATA_SEND_BUFFER_WATERMARK {
        let Some(piece) = deferred.pop_front() else {
            break;
        };
        queue_metadata_response(io, upload, remote_metadata_id, piece)?;
    }
    Ok(())
}

fn queue_metadata_response<I: MetadataSendBuffer>(
    io: &mut I,
    upload: &mut MetadataUpload,
    remote_metadata_id: u8,
    piece: i64,
) -> Result<(), ()> {
    let payload = match upload.on_request(piece).map_err(|_| ())? {
        MetadataUploadAction::Data {
            piece,
            total_size,
            block,
        } => encode_metadata_data(piece, total_size, &block).map_err(|_| ())?,
        MetadataUploadAction::Reject { piece } => encode_metadata_reject(piece),
    };
    io.queue_metadata_message(&PeerMessage::Extended {
        id: remote_metadata_id,
        payload,
    })
}

async fn join_read(read: Option<ActiveRead>) {
    if let Some((_, read)) = read {
        let _ = read.await;
    }
}

#[derive(Debug)]
pub enum IncomingPeerError {
    InvalidFixedPort,
    InvalidSuppliedListener,
    InvalidLocalNetworkAddress,
    LocalNetworkAddress {
        source: io::Error,
    },
    InvalidTimeout,
    InvalidScheduler(&'static str),
    InvalidUploadReadJobs {
        maximum: usize,
    },
    Closed,
    RegistrationLimit {
        maximum: usize,
    },
    InvalidRegistration(&'static str),
    Bind {
        port: u16,
        source: io::Error,
    },
    Io {
        operation: &'static str,
        source: io::Error,
    },
    TaskJoin(String),
}

impl fmt::Display for IncomingPeerError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidFixedPort => formatter.write_str("fixed incoming port must be nonzero"),
            Self::InvalidSuppliedListener => formatter
                .write_str("supplied incoming listener does not match its bootstrap policy"),
            Self::InvalidLocalNetworkAddress => formatter
                .write_str("local-network listener requires a concrete non-loopback IPv4 address"),
            Self::LocalNetworkAddress { source } => {
                write!(formatter, "select local-network listener address: {source}")
            }
            Self::InvalidTimeout => formatter.write_str("incoming peer timeouts must be nonzero"),
            Self::InvalidScheduler(reason) => {
                write!(formatter, "invalid upload scheduler: {reason}")
            }
            Self::InvalidUploadReadJobs { maximum } => {
                write!(
                    formatter,
                    "upload read jobs must be between 1 and {maximum}"
                )
            }
            Self::Closed => formatter.write_str("incoming peer service is closed"),
            Self::RegistrationLimit { maximum } => {
                write!(formatter, "seed registration limit {maximum} reached")
            }
            Self::InvalidRegistration(reason) => {
                write!(formatter, "invalid seed registration: {reason}")
            }
            Self::Bind { port, source } => {
                write!(formatter, "bind incoming port {port}: {source}")
            }
            Self::Io { operation, source } => write!(formatter, "{operation}: {source}"),
            Self::TaskJoin(error) => write!(formatter, "incoming task join: {error}"),
        }
    }
}

impl Error for IncomingPeerError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::LocalNetworkAddress { source }
            | Self::Bind { source, .. }
            | Self::Io { source, .. } => Some(source),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeSet, HashMap, VecDeque};
    use std::net::Ipv4Addr;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use rstorrent_protocol::content::TorrentContent;
    use rstorrent_protocol::identity::{SwarmKey, V1InfoHash};
    use rstorrent_protocol::merkle::{
        MERKLE_BLOCK_SIZE, MerkleAccumulator, file_root_from_data, hash_block,
    };
    use rstorrent_protocol::metadata::{
        MetadataExtensionUpdate, MetadataMessage, MetadataUpload,
        encode_extension_handshake_with_id, encode_metadata_request, parse_extension_handshake,
        parse_metadata_message,
    };
    use rstorrent_protocol::metainfo::{BEP9_METAINFO_LIMITS, Metainfo};
    use rstorrent_protocol::mse::MseMethod;
    use rstorrent_protocol::peer_wire::{
        BlockRequest, EXTENSION_PROTOCOL_RESERVED_BIT, EXTENSION_PROTOCOL_RESERVED_INDEX,
        FrameDecoder, HANDSHAKE_LENGTH, HYBRID_V2_RESERVED_BIT, HYBRID_V2_RESERVED_INDEX,
        PeerMessage, PeerProtocol, decode_handshake, decode_hybrid_response,
        encode_handshake_with_reserved, encode_message,
    };
    use rstorrent_protocol::storage_layout::{FileSelection, TorrentLayout};
    use rstorrent_protocol::v2_hashes::{HashRequest, HashResponse};
    use sha1::{Digest, Sha1};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::{TcpListener, TcpStream};
    use tokio::sync::mpsc;
    use tokio::time::timeout;

    use super::{
        IncomingPeerError, IncomingPeerRuntime, IncomingPeerService, IncomingPeerServiceConfig,
        IncomingRejectionReason, IncomingTcpBootstrap, MAX_DEFERRED_METADATA_REQUESTS,
        MAX_INCOMING_WRITER_BYTES, MAX_PIECE_FRAME_BYTES, MAX_UPLOAD_SEND_TARGET,
        METADATA_SEND_BUFFER_WATERMARK, QueuedChokeFrame, QueuedPieceFrames, SeedRegistration,
        UploadRateWindow, drain_metadata_requests, handle_metadata_message,
        unique_mse_registration, validate_incoming_fast_message,
    };
    use crate::SelectiveStorage;
    use crate::active_seed_content::{
        ACTIVE_UPLOAD_PLAN_CAPACITY, ActiveSeedContent, ActiveUploadPlanRequest,
    };
    use crate::peer::PeerFailure;
    use crate::peer::{
        PeerEndpoint, PeerObservation, PeerRegistry, PeerRegistryConfig, PeerSelectionContext,
        PeerSelector, PeerSource,
    };
    use crate::peer_io::PeerIo;
    use crate::peer_socket;
    use crate::piece_availability::PieceAvailability;
    use crate::{
        DEFAULT_PEER_ID, MseDhWorkOwner, MseHandshakeObservation, MseHandshakeOutcome,
        MseHandshakeSink, NetworkConfig, NetworkPolicy, PeerBudget, PeerBudgetConfig,
        PeerConnectionDirection, PeerConnectionLifecycle, PeerConnectionObservation,
        PeerEncryptionPolicy, PeerUploadGrant, SeedContent, TorrentPeerActivitySink,
        TorrentPeerHandle, UploadSchedulerConfig,
    };

    #[derive(Debug, Default)]
    struct RecordingMseHandshakes(Mutex<Vec<MseHandshakeObservation>>);

    impl MseHandshakeSink for RecordingMseHandshakes {
        fn record(&self, observation: MseHandshakeObservation) {
            self.0.lock().expect("MSE observations").push(observation);
        }
    }

    static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    #[derive(Default)]
    struct TestPeerActivity {
        connections: Mutex<Vec<Vec<PeerConnectionObservation>>>,
    }

    impl std::fmt::Debug for TestPeerActivity {
        fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            formatter.write_str("TestPeerActivity")
        }
    }

    impl TorrentPeerActivitySink for TestPeerActivity {
        fn record_peer_connections(
            &self,
            _captured_at: Duration,
            peers: Vec<PeerConnectionObservation>,
        ) {
            self.connections
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .push(peers);
        }

        fn record_peer_registry(
            &self,
            _active: bool,
            _snapshot: crate::peer::PeerRegistrySnapshot,
        ) {
        }
    }

    #[test]
    fn queued_piece_cancellation_invalidates_only_matching_frames() {
        let first = BlockRequest {
            index: 0,
            begin: 0,
            length: 4,
        };
        let second = BlockRequest {
            index: 0,
            begin: 4,
            length: 4,
        };
        let mut frames = QueuedPieceFrames::default();
        let first_validity = frames.track(first);
        let second_validity = frames.track(second);
        frames.cancel(first);
        assert!(first_validity.is_cancelled());
        assert!(!second_validity.is_cancelled());
        frames.cancel_all();
        assert!(second_validity.is_cancelled());
    }

    #[test]
    fn queued_choke_state_coalesces_to_latest_frame() {
        let mut frame = QueuedChokeFrame::default();
        let first = frame.replace();
        let latest = frame.replace();
        assert!(first.is_cancelled());
        assert!(!latest.is_cancelled());
    }

    #[test]
    fn adaptive_upload_target_reserves_two_piece_frames() {
        assert_eq!(
            MAX_UPLOAD_SEND_TARGET + 2 * MAX_PIECE_FRAME_BYTES,
            MAX_INCOMING_WRITER_BYTES
        );
    }

    #[test]
    fn incoming_fast_validation_requires_negotiation_and_one_initial_state() {
        let mut initial = false;
        let mut suggestions = BTreeSet::new();
        let mut allowed = BTreeSet::new();
        assert!(
            validate_incoming_fast_message(
                false,
                &PeerMessage::HaveAll,
                2,
                &mut initial,
                &mut suggestions,
                &mut allowed,
            )
            .is_err()
        );
        validate_incoming_fast_message(
            true,
            &PeerMessage::Extended {
                id: 0,
                payload: Vec::new(),
            },
            2,
            &mut initial,
            &mut suggestions,
            &mut allowed,
        )
        .expect("extension handshake may precede availability");
        assert!(
            validate_incoming_fast_message(
                true,
                &PeerMessage::SuggestPiece(0),
                2,
                &mut initial,
                &mut suggestions,
                &mut allowed,
            )
            .is_err()
        );
        validate_incoming_fast_message(
            true,
            &PeerMessage::HaveNone,
            2,
            &mut initial,
            &mut suggestions,
            &mut allowed,
        )
        .expect("initial state");
        validate_incoming_fast_message(
            true,
            &PeerMessage::SuggestPiece(1),
            2,
            &mut initial,
            &mut suggestions,
            &mut allowed,
        )
        .expect("bounded suggestion");
        assert_eq!(suggestions, BTreeSet::from([1]));
        assert!(
            validate_incoming_fast_message(
                true,
                &PeerMessage::HaveAll,
                2,
                &mut initial,
                &mut suggestions,
                &mut allowed,
            )
            .is_err()
        );
    }

    #[test]
    fn upload_rate_uses_completed_nonoverlapping_windows() {
        let mut rate = UploadRateWindow::default();
        rate.record(4_000, Duration::from_millis(250));
        assert_eq!(rate.snapshot(Duration::from_millis(999)), 0);
        assert_eq!(rate.snapshot(Duration::from_secs(1)), 4_000);
        rate.record(2_000, Duration::from_millis(1_250));
        assert_eq!(rate.snapshot(Duration::from_secs(2)), 2_000);
        assert_eq!(rate.snapshot(Duration::from_secs(3)), 0);
    }

    #[test]
    fn mse_req2_index_fails_closed_on_an_ambiguous_bucket() {
        let key = [7; 20];
        let wire_key = [1; 20];
        let first = SwarmKey::V1(V1InfoHash::new(wire_key));
        let second = SwarmKey::V2Truncated(wire_key);
        let mut index = HashMap::from([(key, BTreeSet::from([first]))]);
        assert_eq!(unique_mse_registration(&index, key), Some(wire_key));
        index.get_mut(&key).expect("bucket").insert(second);
        assert_eq!(unique_mse_registration(&index, key), None);
        assert_eq!(unique_mse_registration(&index, [8; 20]), None);
    }

    #[tokio::test]
    async fn equal_v1_and_v2_wire_keys_are_registered_but_rejected_as_ambiguous() {
        let (root, _raw_info, v1, _torrent_peers, _peer_activity) =
            registration("versioned-collision").await;
        let info_hash = v1.info_hash();
        let mut v2 = v1.clone();
        v2.swarm_key = SwarmKey::V2Truncated(info_hash);
        let service = IncomingPeerService::bind(config(IncomingTcpBootstrap::AutomaticLoopback))
            .await
            .expect("bind collision listener")
            .expect("collision listener enabled");
        let handle = service.handle();
        let v1_token = handle.register(v1).await.expect("register v1 owner");
        let v2_token = handle.register(v2).await.expect("register v2 owner");
        assert_eq!(handle.snapshot().registrations, 2);

        let mut ambiguous = TcpStream::connect(service.listen_address())
            .await
            .expect("connect ambiguous peer");
        ambiguous
            .write_all(&encode_handshake_with_reserved(
                info_hash,
                *b"-RS-COLLIDE-00000000",
                [0; 8],
            ))
            .await
            .expect("send ambiguous handshake");
        let mut response = [0; HANDSHAKE_LENGTH];
        let read = timeout(Duration::from_secs(1), ambiguous.read(&mut response))
            .await
            .expect("ambiguous route closes")
            .expect("observe ambiguous route close");
        assert_eq!(read, 0);
        assert_eq!(
            handle
                .snapshot()
                .rejection_counts
                .get(&IncomingRejectionReason::UnknownTorrent),
            Some(&1)
        );

        assert!(handle.unregister(v2_token).await.expect("remove v2 owner"));
        let (mut peer, mut decoder, mut queued) = connect(
            service.listen_address(),
            info_hash,
            *b"-RS-V1-ONLY-00000000",
        )
        .await;
        assert!(matches!(
            next_message(&mut peer, &mut decoder, &mut queued).await,
            PeerMessage::Bitfield(_)
        ));
        drop(peer);
        assert!(handle.unregister(v1_token).await.expect("remove v1 owner"));
        service
            .shutdown()
            .await
            .expect("shutdown collision listener");
        tokio::fs::remove_dir_all(root).await.expect("remove root");
    }

    #[tokio::test]
    async fn incoming_hybrid_offer_upgrades_only_with_same_owner_v2_route() {
        let (root, registrations, v1_key, v2_key) = hybrid_registrations("hybrid-upgrade").await;
        let v1_registration = registrations
            .iter()
            .find(|registration| registration.swarm_key == v1_key)
            .expect("v1 registration");
        assert_eq!(
            v1_registration
                .read_block(BlockRequest {
                    index: 0,
                    begin: 0,
                    length: 4,
                })
                .await
                .expect("crossing padding read"),
            vec![1, 0, 0, 0]
        );
        assert_eq!(
            v1_registration
                .read_block(BlockRequest {
                    index: 0,
                    begin: 100,
                    length: 4,
                })
                .await
                .expect("padding-only read"),
            vec![0; 4]
        );

        let service = IncomingPeerService::bind(config(IncomingTcpBootstrap::AutomaticLoopback))
            .await
            .expect("bind hybrid listener")
            .expect("hybrid listener enabled");
        let handle = service.handle();
        let tokens = handle
            .register_all(registrations)
            .await
            .expect("register both hybrid routes");
        assert_eq!(tokens.len(), 2);
        assert_eq!(handle.snapshot().registrations, 2);

        let (upgraded, protocol) = connect_hybrid(
            service.listen_address(),
            v1_key,
            v2_key,
            *b"-RS-HYB-UP--00000000",
        )
        .await;
        assert_eq!(protocol, PeerProtocol::V2);
        drop(upgraded);

        let v2_token = tokens
            .iter()
            .copied()
            .find(|token| token.swarm_key == v2_key)
            .expect("v2 token");
        assert!(handle.unregister(v2_token).await.expect("remove v2 route"));
        let (declined, protocol) = connect_hybrid(
            service.listen_address(),
            v1_key,
            v2_key,
            *b"-RS-HYB-V1--00000000",
        )
        .await;
        assert_eq!(protocol, PeerProtocol::V1);
        drop(declined);

        for token in tokens.into_iter().filter(|token| *token != v2_token) {
            assert!(handle.unregister(token).await.expect("remove v1 route"));
        }
        service.shutdown().await.expect("shutdown hybrid listener");
        tokio::fs::remove_dir_all(root)
            .await
            .expect("remove hybrid root");
    }

    fn root(label: &str) -> PathBuf {
        let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "rstorrent-incoming-{label}-{}-{sequence}",
            std::process::id()
        ))
    }

    fn raw_info(payload: &[u8]) -> Vec<u8> {
        let mut hashes = Vec::new();
        for piece in payload.chunks(4) {
            hashes.extend_from_slice(&Sha1::digest(piece));
        }
        let mut info = format!(
            "d6:lengthi{}e4:name8:seed.bin12:piece lengthi4e6:pieces{}:",
            payload.len(),
            hashes.len()
        )
        .into_bytes();
        info.extend_from_slice(&hashes);
        info.push(b'e');
        info
    }

    fn hybrid_raw_info() -> Vec<u8> {
        fn bstr(output: &mut Vec<u8>, value: &[u8]) {
            output.extend_from_slice(value.len().to_string().as_bytes());
            output.push(b':');
            output.extend_from_slice(value);
        }
        let roots = [
            file_root_from_data(&[1]).expect("first root"),
            file_root_from_data(&[2]).expect("second root"),
        ];
        let mut tree = vec![b'd'];
        for (name, root) in [(b'a', roots[0]), (b'b', roots[1])] {
            bstr(&mut tree, &[name]);
            tree.extend_from_slice(b"d0:d6:lengthi1e11:pieces root32:");
            tree.extend_from_slice(&root);
            tree.extend_from_slice(b"ee");
        }
        tree.push(b'e');
        let mut info = b"d9:file tree".to_vec();
        info.extend_from_slice(&tree);
        info.extend_from_slice(
            concat!(
                "5:filesl",
                "d6:lengthi1e4:pathl1:aee",
                "d4:attr1:p6:lengthi16383ee",
                "d6:lengthi1e4:pathl1:bee",
                "e12:meta versioni2e4:name4:root12:piece lengthi16384e",
                "6:pieces40:"
            )
            .as_bytes(),
        );
        info.extend_from_slice(&[7; 40]);
        info.push(b'e');
        info
    }

    async fn hybrid_registrations(
        label: &str,
    ) -> (PathBuf, Vec<SeedRegistration>, SwarmKey, SwarmKey) {
        let raw_info = hybrid_raw_info();
        let runtime =
            rstorrent_protocol::content::TorrentContent::from_hybrid_info_bytes_with_limits(
                &raw_info,
                BEP9_METAINFO_LIMITS,
            )
            .expect("hybrid runtime");
        let root = root(label);
        tokio::fs::create_dir_all(root.join("root"))
            .await
            .expect("create hybrid root");
        tokio::fs::write(root.join("root/a"), [1])
            .await
            .expect("write first payload");
        tokio::fs::write(root.join("root/b"), [2])
            .await
            .expect("write second payload");
        let torrent_id = crate::TorrentId::new([0x72; 16]).expect("nonzero hybrid owner");
        let pool =
            crate::StorageFilePool::new(crate::storage_file_pool::DEFAULT_STORAGE_FILE_LIMIT, None)
                .expect("seed file pool");
        let seed = SeedContent::open_verified_content_with_pool(
            &root,
            torrent_id,
            &runtime.content,
            &[true, true],
            &[],
            pool,
        )
        .await
        .expect("open hybrid seed");
        let peers = TorrentPeerHandle::new(Arc::new(TestPeerActivity::default()))
            .expect("hybrid torrent peer state");
        let keys = runtime.content.swarm_keys().collect::<Vec<_>>();
        let registrations = keys
            .iter()
            .copied()
            .map(|key| {
                SeedRegistration::new_with_swarm_key(
                    raw_info.clone(),
                    key,
                    seed.clone(),
                    peers.clone(),
                )
                .expect("hybrid seed registration")
            })
            .collect();
        (root, registrations, keys[0], keys[1])
    }

    async fn registration(
        label: &str,
    ) -> (
        PathBuf,
        Vec<u8>,
        SeedRegistration,
        TorrentPeerHandle,
        Arc<TestPeerActivity>,
    ) {
        let payload = b"abcdefg";
        let raw_info = raw_info(payload);
        let metainfo = Metainfo::from_info_bytes_with_limits(&raw_info, BEP9_METAINFO_LIMITS)
            .expect("parse fixture info");
        let root = root(label);
        tokio::fs::create_dir_all(&root).await.expect("create root");
        tokio::fs::write(root.join("seed.bin"), payload)
            .await
            .expect("write verified payload");
        let torrent_id = crate::TorrentId::new([0x71; 16]).expect("nonzero test owner");
        let content = SeedContent::open_verified(&root, torrent_id, &metainfo, &[true, true], &[])
            .await
            .expect("open seed content");
        let peer_activity = Arc::new(TestPeerActivity::default());
        let torrent_peers =
            TorrentPeerHandle::new(peer_activity.clone()).expect("valid torrent peer state");
        let registration = SeedRegistration::new(raw_info.clone(), content, torrent_peers.clone())
            .expect("valid registration");
        (root, raw_info, registration, torrent_peers, peer_activity)
    }

    fn config(bootstrap: IncomingTcpBootstrap) -> IncomingPeerServiceConfig {
        IncomingPeerServiceConfig {
            bootstrap,
            handshake_timeout: Duration::from_millis(250),
            peer_activity_timeout: Duration::from_secs(2),
            keepalive_interval: Duration::from_secs(1),
            no_request_timeout: Duration::from_secs(1),
            inactivity_timeout: Duration::from_secs(2),
            peer_id: DEFAULT_PEER_ID,
            byte_metric_sink: None,
            mse_handshake_sink: None,
            peer_budget: PeerBudget::system_default(),
            upload_scheduler: UploadSchedulerConfig::default(),
            upload_read_jobs: super::DEFAULT_UPLOAD_READ_JOBS,
            encryption: PeerEncryptionPolicy::Allow,
            peer_exchange: crate::PeerExchangePolicyHandle::default(),
            mse_dh: MseDhWorkOwner::new(),
        }
    }

    #[test]
    fn local_network_address_eligibility_is_closed() {
        for address in [
            Ipv4Addr::UNSPECIFIED,
            Ipv4Addr::LOCALHOST,
            Ipv4Addr::BROADCAST,
            Ipv4Addr::new(239, 255, 255, 250),
        ] {
            assert!(!super::eligible_local_network_ipv4(address));
        }
        for address in [
            Ipv4Addr::new(10, 0, 0, 2),
            Ipv4Addr::new(192, 168, 1, 2),
            Ipv4Addr::new(203, 0, 113, 2),
        ] {
            assert!(super::eligible_local_network_ipv4(address));
        }
    }

    #[cfg(target_os = "windows")]
    #[tokio::test]
    async fn windows_native_local_network_selection_returns_an_eligible_route() {
        let address = super::select_local_network_ipv4(None)
            .await
            .expect("Windows has an eligible local-network route");
        assert!(super::eligible_local_network_ipv4(address));
    }

    #[tokio::test]
    async fn metadata_upload_defers_by_occupancy_not_connection_lifetime() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let address = listener.local_addr().expect("listen address");
        let client = TcpStream::connect(address).await.expect("connect");
        let (server, _) = listener.accept().await.expect("accept");
        let drain = tokio::spawn(async move {
            let mut client = client;
            let mut bytes = [0_u8; 64 * 1_024];
            while client.read(&mut bytes).await.unwrap_or(0) != 0 {}
        });
        let mut io = PeerIo::new(server, Duration::from_secs(2), None);
        let metadata = vec![7; 16 * 1_024];
        let mut upload = MetadataUpload::new(&metadata).expect("local metadata");
        let mut remote_id = Some(7);
        let mut deferred = VecDeque::new();
        let request = PeerMessage::Extended {
            id: rstorrent_protocol::metadata::UT_METADATA_LOCAL_ID,
            payload: encode_metadata_request(0),
        };

        while io.send_buffer_size() < METADATA_SEND_BUFFER_WATERMARK {
            handle_metadata_message(
                &mut io,
                &mut upload,
                &mut remote_id,
                &mut deferred,
                &request,
            )
            .expect("queue immediate metadata response");
        }
        for _ in 0..MAX_DEFERRED_METADATA_REQUESTS {
            handle_metadata_message(
                &mut io,
                &mut upload,
                &mut remote_id,
                &mut deferred,
                &request,
            )
            .expect("defer metadata response");
        }
        assert_eq!(deferred.len(), MAX_DEFERRED_METADATA_REQUESTS);
        let before_reject = io.send_buffer_size();
        handle_metadata_message(
            &mut io,
            &mut upload,
            &mut remote_id,
            &mut deferred,
            &request,
        )
        .expect("reject request above deferred occupancy bound");
        assert!(io.send_buffer_size() > before_reject);

        while !deferred.is_empty() {
            assert!(
                timeout(
                    Duration::from_secs(2),
                    io.next_message_or_send_ready(METADATA_SEND_BUFFER_WATERMARK),
                )
                .await
                .expect("queued send drains")
                .expect("queued send remains connected")
                .is_none()
            );
            drain_metadata_requests(&mut io, &mut upload, remote_id, &mut deferred)
                .expect("refill bounded send buffer");
        }
        assert!(upload.request_count() > MAX_DEFERRED_METADATA_REQUESTS);
        drop(io);
        drain.await.expect("reader task");
    }

    async fn send(stream: &mut TcpStream, message: &PeerMessage) {
        stream
            .write_all(&encode_message(message).expect("encode message"))
            .await
            .expect("send message");
    }

    async fn next_message(
        stream: &mut TcpStream,
        decoder: &mut FrameDecoder,
        queued: &mut VecDeque<PeerMessage>,
    ) -> PeerMessage {
        timeout(Duration::from_secs(2), async {
            while queued.is_empty() {
                let mut bytes = [0; 4096];
                let read = stream.read(&mut bytes).await.expect("read peer message");
                assert_ne!(read, 0, "incoming service closed before response");
                queued.extend(decoder.push(&bytes[..read]).expect("decode peer message"));
            }
            queued.pop_front().expect("queued peer message")
        })
        .await
        .expect("peer response timeout")
    }

    async fn connect(
        address: std::net::SocketAddr,
        info_hash: [u8; 20],
        peer_id: [u8; 20],
    ) -> (TcpStream, FrameDecoder, VecDeque<PeerMessage>) {
        let mut stream = TcpStream::connect(address).await.expect("connect listener");
        let mut reserved = [0; 8];
        reserved[EXTENSION_PROTOCOL_RESERVED_INDEX] = EXTENSION_PROTOCOL_RESERVED_BIT;
        let handshake = encode_handshake_with_reserved(info_hash, peer_id, reserved);
        stream
            .write_all(&handshake[..17])
            .await
            .expect("send fragmented handshake prefix");
        stream
            .write_all(&handshake[17..])
            .await
            .expect("send fragmented handshake tail");
        let mut response = [0; HANDSHAKE_LENGTH];
        stream
            .read_exact(&mut response)
            .await
            .expect("read server handshake");
        assert!(
            decode_handshake(&response, info_hash)
                .expect("valid server handshake")
                .supports_extensions()
        );
        (stream, FrameDecoder::new(), VecDeque::new())
    }

    async fn connect_hybrid(
        address: std::net::SocketAddr,
        v1: SwarmKey,
        v2: SwarmKey,
        peer_id: [u8; 20],
    ) -> (TcpStream, PeerProtocol) {
        let mut stream = TcpStream::connect(address).await.expect("connect listener");
        let mut reserved = [0; 8];
        reserved[HYBRID_V2_RESERVED_INDEX] = HYBRID_V2_RESERVED_BIT;
        stream
            .write_all(&encode_handshake_with_reserved(
                v1.into_bytes(),
                peer_id,
                reserved,
            ))
            .await
            .expect("send hybrid handshake");
        let mut response = [0; HANDSHAKE_LENGTH];
        stream
            .read_exact(&mut response)
            .await
            .expect("read server handshake");
        let selection = decode_hybrid_response(&response, v1, v2, true)
            .expect("valid hybrid response identity");
        (stream, selection.protocol)
    }

    fn dial_attempt(address: std::net::SocketAddr) -> crate::peer::DialAttempt {
        let endpoint = PeerEndpoint::new(address).expect("valid endpoint");
        let mut registry = PeerRegistry::new(PeerRegistryConfig::default()).expect("peer registry");
        registry
            .observe(
                PeerObservation::dialable(endpoint, PeerSource::Manual),
                Duration::ZERO,
            )
            .expect("peer observation");
        let context = PeerSelectionContext {
            now: Duration::ZERO,
        };
        let candidate = PeerSelector
            .select(&registry, context)
            .expect("dial candidate");
        registry
            .begin_dial(candidate, context)
            .expect("dial attempt")
    }

    async fn observe_close(stream: &mut TcpStream) {
        timeout(Duration::from_secs(2), async {
            let mut byte = [0; 1];
            loop {
                match stream.read(&mut byte).await {
                    Ok(0) => break,
                    Ok(_) => continue,
                    Err(error) if error.kind() == std::io::ErrorKind::ConnectionReset => break,
                    result => panic!("unexpected peer close result {result:?}"),
                }
            }
        })
        .await
        .expect("peer close deadline");
    }

    #[tokio::test]
    async fn disabled_and_fixed_bind_contracts_are_exact() {
        assert!(
            IncomingPeerService::bind(config(IncomingTcpBootstrap::Disabled))
                .await
                .expect("disabled service")
                .is_none()
        );
        assert!(matches!(
            IncomingPeerService::bind(config(IncomingTcpBootstrap::FixedLoopback(0))).await,
            Err(IncomingPeerError::InvalidFixedPort)
        ));
        let blocker = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind fixed-port blocker");
        let port = blocker.local_addr().expect("blocker address").port();
        assert!(matches!(
            IncomingPeerService::bind(config(IncomingTcpBootstrap::FixedLoopback(port))).await,
            Err(IncomingPeerError::Bind { port: failed, .. }) if failed == port
        ));

        let ordinary =
            IncomingPeerService::bind(config(IncomingTcpBootstrap::AutomaticLocalNetwork))
                .await
                .expect("bind ordinary listener")
                .expect("ordinary listener enabled");
        assert!(ordinary.listen_address().ip().is_unspecified());
        ordinary
            .shutdown()
            .await
            .expect("shutdown ordinary listener");

        let supplied = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind supplied listener");
        let supplied_address = supplied.local_addr().expect("supplied address");
        let supplied_service =
            IncomingPeerService::start(config(IncomingTcpBootstrap::AutomaticLoopback), supplied)
                .expect("start supplied listener");
        assert_eq!(supplied_service.listen_address(), supplied_address);
        supplied_service
            .shutdown()
            .await
            .expect("shutdown supplied");

        let mismatched = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind mismatched listener");
        assert!(matches!(
            IncomingPeerService::start(
                config(IncomingTcpBootstrap::FixedLoopback(6_881)),
                mismatched,
            ),
            Err(IncomingPeerError::InvalidSuppliedListener)
        ));
    }

    #[tokio::test]
    async fn stable_runtime_survives_acceptor_and_slot_replacement() {
        let (root, _raw_info, registration, _torrent_peers, peer_activity) =
            registration("replace-acceptor").await;
        let info_hash = registration.info_hash();
        let runtime = IncomingPeerRuntime::start(config(IncomingTcpBootstrap::Disabled))
            .expect("start stable incoming runtime");
        let handle = runtime.handle();
        let token = handle.register(registration).await.expect("register seed");

        let first_listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind first listener");
        let first_address = first_listener.local_addr().expect("first address");
        let first = runtime
            .start_acceptor(
                IncomingTcpBootstrap::AutomaticLoopback,
                first_listener,
                Duration::from_millis(250),
            )
            .expect("start first acceptor");
        let (mut first_peer, mut first_decoder, mut first_queued) =
            connect(first_address, info_hash, *b"-RS-FIRST---00000000").await;
        assert!(matches!(
            next_message(&mut first_peer, &mut first_decoder, &mut first_queued).await,
            PeerMessage::Bitfield(_)
        ));
        assert!(matches!(
            next_message(&mut first_peer, &mut first_decoder, &mut first_queued).await,
            PeerMessage::Extended { id: 0, .. }
        ));

        let second_listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind second listener");
        let second_address = second_listener.local_addr().expect("second address");
        let second = runtime
            .start_acceptor(
                IncomingTcpBootstrap::AutomaticLoopback,
                second_listener,
                Duration::from_millis(250),
            )
            .expect("start second acceptor");
        first.shutdown().await.expect("retire first acceptor");
        assert!(TcpStream::connect(first_address).await.is_err());

        let (mut second_peer, mut second_decoder, mut second_queued) =
            connect(second_address, info_hash, *b"-RS-SECOND--00000000").await;
        assert!(matches!(
            next_message(&mut second_peer, &mut second_decoder, &mut second_queued).await,
            PeerMessage::Bitfield(_)
        ));
        assert_eq!(handle.snapshot().registrations, 1);
        assert_eq!(handle.snapshot().established, 2);
        assert_eq!(handle.snapshot().listen_address, second_address);

        send(&mut first_peer, &PeerMessage::Interested).await;
        assert_eq!(
            next_message(&mut first_peer, &mut first_decoder, &mut first_queued).await,
            PeerMessage::Unchoke
        );
        runtime.reconfigure_upload_slots(0);
        assert_eq!(
            next_message(&mut first_peer, &mut first_decoder, &mut first_queued).await,
            PeerMessage::Choke
        );

        second.shutdown().await.expect("retire second acceptor");
        drop((first_peer, second_peer));
        handle.unregister(token).await.expect("unregister seed");
        drop(handle);
        let terminal = runtime.shutdown().await.expect("shutdown stable runtime");
        assert_eq!(terminal.registrations, 0);
        assert_eq!(terminal.established, 0);
        drop(peer_activity);
        std::fs::remove_dir_all(root).expect("remove root");
    }

    #[tokio::test]
    async fn serves_metadata_then_payload_on_one_incoming_connection() {
        let (root, raw_info, registration, torrent_peers, peer_activity) =
            registration("vertical").await;
        let info_hash = registration.info_hash();
        let mut service_config = config(IncomingTcpBootstrap::AutomaticLoopback);
        service_config.peer_activity_timeout = Duration::from_secs(5);
        service_config.no_request_timeout = Duration::from_secs(5);
        let service = IncomingPeerService::bind(service_config)
            .await
            .expect("bind service")
            .expect("enabled service");
        assert_eq!(service.listen_address().ip().to_string(), "127.0.0.1");
        assert_ne!(service.listen_address().port(), 0);
        let handle = service.handle();
        let token = handle.register(registration).await.expect("register seed");
        let (mut stream, mut decoder, mut queued) = connect(
            service.listen_address(),
            info_hash,
            *b"-RS-LEECH-0000000000",
        )
        .await;
        let connected = torrent_peers.connection_snapshot();
        assert_eq!(connected.len(), 1);
        assert_eq!(connected[0].direction, PeerConnectionDirection::Incoming);
        assert_eq!(connected[0].lifecycle, PeerConnectionLifecycle::Connected);
        assert_eq!(
            connected[0].endpoint,
            stream.local_addr().expect("peer endpoint")
        );
        assert_eq!(connected[0].local_endpoint, Some(service.listen_address()));
        assert!(connected[0].supports_extensions.is_some_and(|value| value));

        assert_eq!(
            next_message(&mut stream, &mut decoder, &mut queued).await,
            PeerMessage::Bitfield(vec![0b1100_0000])
        );
        let PeerMessage::Extended {
            id: 0,
            payload: handshake,
        } = next_message(&mut stream, &mut decoder, &mut queued).await
        else {
            panic!("expected extension handshake");
        };
        let handshake = parse_extension_handshake(&handshake).expect("parse extensions");
        assert_eq!(
            handshake.metadata_extension,
            MetadataExtensionUpdate::Enabled(1)
        );
        assert_eq!(handshake.metadata_size, Some(raw_info.len()));
        send(
            &mut stream,
            &PeerMessage::Extended {
                id: 0,
                payload: encode_extension_handshake_with_id(7, None)
                    .expect("directional extension ID"),
            },
        )
        .await;
        send(
            &mut stream,
            &PeerMessage::Extended {
                id: 1,
                payload: encode_metadata_request(0),
            },
        )
        .await;
        let PeerMessage::Extended { id, payload } =
            next_message(&mut stream, &mut decoder, &mut queued).await
        else {
            panic!("expected metadata response");
        };
        assert_eq!(id, 7);
        let MetadataMessage::Data {
            piece,
            total_size,
            block,
        } = parse_metadata_message(&payload).expect("parse metadata data")
        else {
            panic!("expected metadata data");
        };
        assert_eq!(piece, 0);
        assert_eq!(total_size, raw_info.len());
        assert_eq!(block, raw_info);

        send(&mut stream, &PeerMessage::Interested).await;
        assert_eq!(
            next_message(&mut stream, &mut decoder, &mut queued).await,
            PeerMessage::Unchoke
        );
        send(
            &mut stream,
            &PeerMessage::Request(rstorrent_protocol::peer_wire::BlockRequest {
                index: 0,
                begin: 0,
                length: 4,
            }),
        )
        .await;
        assert_eq!(
            next_message(&mut stream, &mut decoder, &mut queued).await,
            PeerMessage::Piece {
                index: 0,
                begin: 0,
                block: b"abcd".to_vec(),
            }
        );

        let live = handle.snapshot();
        assert_eq!(live.payload_bytes_sent, 4);
        assert_eq!(live.torrent_uploads.len(), 1);
        assert_eq!(live.torrent_uploads[0].info_hash, info_hash);
        assert_eq!(live.torrent_uploads[0].peers, 1);
        assert_eq!(live.torrent_uploads[0].traffic.payload_bytes, 4);
        assert_eq!(live.peer_uploads.len(), 1);
        assert_eq!(live.peer_uploads[0].info_hash, info_hash);
        assert_eq!(live.peer_uploads[0].traffic.payload_bytes, 4);
        let projected = timeout(Duration::from_secs(2), async {
            loop {
                let peers = torrent_peers.connection_snapshot();
                if peers
                    .first()
                    .and_then(|peer| peer.upload)
                    .is_some_and(|upload| {
                        upload.interested
                            && upload.grant != PeerUploadGrant::Choked
                            && upload.payload_bytes == 4
                    })
                {
                    break peers;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap_or_else(|_| {
            panic!(
                "incoming peer projection deadline: {:?}",
                torrent_peers.connection_snapshot()
            )
        });
        assert_eq!(projected[0].supports_ut_metadata, Some(true));
        assert_eq!(
            projected[0]
                .upload
                .expect("upload projection")
                .queued_requests,
            0
        );

        assert!(handle.unregister(token).await.expect("unregister seed"));
        observe_close(&mut stream).await;
        assert!(torrent_peers.connection_snapshot().is_empty());
        let disconnecting_precedes_empty = {
            let connection_history = peer_activity
                .connections
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let disconnecting = connection_history
                .iter()
                .position(|peers| {
                    peers.first().is_some_and(|peer| {
                        peer.lifecycle == PeerConnectionLifecycle::Disconnecting
                    })
                })
                .expect("disconnecting projection precedes cleanup");
            connection_history
                .iter()
                .skip(disconnecting + 1)
                .any(Vec::is_empty)
        };
        assert!(disconnecting_precedes_empty);
        let before_shutdown = handle.snapshot();
        assert_eq!(before_shutdown.registrations, 0);
        assert_eq!(before_shutdown.established, 0);
        assert_eq!(before_shutdown.reads, 0);
        assert_eq!(before_shutdown.read_bytes, 0);
        assert_eq!(before_shutdown.payload_bytes_sent, 4);
        assert!(before_shutdown.torrent_uploads.is_empty());
        assert!(before_shutdown.peer_uploads.is_empty());
        assert_eq!(before_shutdown.established_high_water, 1);
        assert_eq!(before_shutdown.queued_requests_high_water, 1);
        assert_eq!(before_shutdown.read_high_water, 1);
        assert_eq!(before_shutdown.read_bytes_high_water, 4);
        let terminal = service.shutdown().await.expect("shutdown service");
        assert_eq!(terminal.pending, 0);
        assert_eq!(terminal.established, 0);
        assert_eq!(terminal.reads, 0);
        assert_eq!(terminal.registrations, 0);
        assert!(!terminal.accepting_registrations);
        tokio::fs::remove_dir_all(root).await.expect("remove root");
    }

    #[tokio::test]
    async fn live_allow_policy_selects_plaintext_payload_from_both_methods() {
        let (root, _, registration, _, _) = registration("allow-mse-method").await;
        let info_hash = registration.info_hash();
        let mut service_config = config(IncomingTcpBootstrap::AutomaticLoopback);
        service_config.encryption = PeerEncryptionPolicy::Allow;
        service_config.handshake_timeout = Duration::from_secs(2);
        let mse_observations = Arc::new(RecordingMseHandshakes::default());
        service_config.mse_handshake_sink = Some(mse_observations.clone());
        let service = IncomingPeerService::bind(service_config)
            .await
            .expect("bind service")
            .expect("enabled service");
        let handle = service.handle();
        let token = handle.register(registration).await.expect("register seed");

        let network = NetworkConfig::new(
            NetworkPolicy::LoopbackOnly,
            Duration::from_secs(2),
            Duration::from_secs(2),
        )
        .with_peer_id(*b"-RS-ALLOW---00000000")
        .with_encryption(PeerEncryptionPolicy::Required);
        let (peer, handshake) = peer_socket::connect(
            dial_attempt(service.listen_address()),
            info_hash,
            true,
            network,
        )
        .await
        .expect("connect MSE peer");
        assert_eq!(handshake.peer_id, DEFAULT_PEER_ID);
        assert_eq!(peer.mse_method(), Some(MseMethod::PlaintextPayload));
        assert_eq!(
            mse_observations.0.lock().expect("MSE observations")[0].outcome,
            MseHandshakeOutcome::Negotiated(MseMethod::PlaintextPayload)
        );

        drop(peer);
        assert!(handle.unregister(token).await.expect("unregister seed"));
        drop(handle);
        service.shutdown().await.expect("shutdown service");
        tokio::fs::remove_dir_all(root).await.expect("remove root");
    }

    #[tokio::test]
    async fn live_required_policy_retains_plaintext_and_serves_rc4_mse() {
        let (root, _, registration, torrent_peers, _) = registration("required-mse").await;
        let info_hash = registration.info_hash();
        let mut service_config = config(IncomingTcpBootstrap::AutomaticLoopback);
        service_config.encryption = PeerEncryptionPolicy::Allow;
        service_config.handshake_timeout = Duration::from_secs(2);
        let mse_observations = Arc::new(RecordingMseHandshakes::default());
        service_config.mse_handshake_sink = Some(mse_observations.clone());
        let service = IncomingPeerService::bind(service_config)
            .await
            .expect("bind service")
            .expect("enabled service");
        let handle = service.handle();
        let token = handle.register(registration).await.expect("register seed");

        let (mut retained_plain, mut plain_decoder, mut plain_queued) = connect(
            service.listen_address(),
            info_hash,
            *b"-RS-PLAIN---00000000",
        )
        .await;
        assert!(matches!(
            next_message(&mut retained_plain, &mut plain_decoder, &mut plain_queued).await,
            PeerMessage::Bitfield(_)
        ));
        assert!(matches!(
            next_message(&mut retained_plain, &mut plain_decoder, &mut plain_queued).await,
            PeerMessage::Extended { id: 0, .. }
        ));
        handle.reconfigure_encryption(PeerEncryptionPolicy::Required);

        let mut rejected_plain = TcpStream::connect(service.listen_address())
            .await
            .expect("connect rejected plaintext peer");
        rejected_plain
            .write_all(&rstorrent_protocol::peer_wire::encode_handshake(
                info_hash,
                *b"-RS-PLAIN---00000001",
            ))
            .await
            .expect("write plaintext handshake");
        observe_close(&mut rejected_plain).await;
        send(&mut retained_plain, &PeerMessage::Interested).await;
        assert_eq!(
            next_message(&mut retained_plain, &mut plain_decoder, &mut plain_queued).await,
            PeerMessage::Unchoke
        );

        let network = NetworkConfig::new(
            NetworkPolicy::LoopbackOnly,
            Duration::from_secs(2),
            Duration::from_secs(2),
        )
        .with_peer_id(*b"-RS-MSE-----00000000")
        .with_encryption(PeerEncryptionPolicy::Required);
        let (mut peer, handshake) = peer_socket::connect(
            dial_attempt(service.listen_address()),
            info_hash,
            true,
            network,
        )
        .await
        .expect("connect encrypted peer");
        assert_eq!(handshake.peer_id, DEFAULT_PEER_ID);
        assert_eq!(peer.mse_method(), Some(MseMethod::Rc4));
        let mse_observation = mse_observations.0.lock().expect("MSE observations")[0];
        assert_eq!(mse_observation.policy, PeerEncryptionPolicy::Required);
        assert_eq!(
            mse_observation.outcome,
            MseHandshakeOutcome::Negotiated(MseMethod::Rc4)
        );
        assert_eq!(mse_observation.exponentiations, 2);
        assert_eq!(mse_observation.protocol_bytes_sent, HANDSHAKE_LENGTH as u64);
        assert_eq!(
            mse_observation.protocol_bytes_received,
            HANDSHAKE_LENGTH as u64
        );
        let first = peer_socket::next_message(&mut peer)
            .await
            .expect("encrypted availability");
        assert!(
            matches!(first, PeerMessage::Bitfield(_) | PeerMessage::HaveAll),
            "unexpected first encrypted message: {first:?}"
        );
        let mut extension_handshake = false;
        for _ in 0..32 {
            match peer_socket::next_message(&mut peer)
                .await
                .expect("encrypted initial message")
            {
                PeerMessage::Extended { id: 0, .. } => {
                    extension_handshake = true;
                    break;
                }
                PeerMessage::AllowedFast(_) => {}
                message => panic!("unexpected encrypted initial message: {message:?}"),
            }
        }
        assert!(extension_handshake, "missing encrypted extension handshake");
        peer_socket::send_message(&mut peer, &PeerMessage::Interested)
            .await
            .expect("send encrypted interest");
        assert_eq!(
            peer_socket::next_message(&mut peer)
                .await
                .expect("encrypted unchoke"),
            PeerMessage::Unchoke
        );
        let observations = torrent_peers.connection_snapshot();
        assert_eq!(observations.len(), 2);
        assert!(
            observations
                .iter()
                .any(|observation| observation.mse_method == Some(MseMethod::Rc4))
        );

        drop((peer, retained_plain));
        assert!(handle.unregister(token).await.expect("unregister seed"));
        drop(handle);
        service.shutdown().await.expect("shutdown service");
        tokio::fs::remove_dir_all(root).await.expect("remove root");
    }

    #[tokio::test]
    async fn active_incomplete_registration_serves_verified_piece_and_later_have() {
        let payload = b"abcdefg";
        let raw_info = raw_info(payload);
        let metainfo = Metainfo::from_info_bytes_with_limits(&raw_info, BEP9_METAINFO_LIMITS)
            .expect("parse active fixture");
        let root = root("active-incomplete");
        tokio::fs::create_dir_all(&root)
            .await
            .expect("create active root");
        let output = root.join("seed.bin");
        let layout = TorrentLayout::from_metainfo(&metainfo);
        let selection = FileSelection::new(&layout, &[]).expect("active selection");
        let artifact_identity = crate::TorrentArtifactIdentity {
            torrent_id: crate::TorrentId::new([0x72; 16]).expect("nonzero test owner"),
            content_fingerprint: crate::ContentFingerprint::for_info_bytes(&raw_info),
        };
        let content_path = crate::torrent_storage_paths_for_metainfo(
            &root,
            &metainfo,
            artifact_identity.torrent_id,
        )
        .expect("active storage paths")
        .content;
        let mut storage = SelectiveStorage::create(
            output.clone(),
            artifact_identity,
            &metainfo,
            layout.clone(),
            selection,
        )
        .await
        .expect("create active storage");
        storage
            .write_block(0, 0, b"abcd".to_vec())
            .await
            .expect("write first active piece");
        storage.record_verified(0).expect("verify first piece");
        storage
            .write_block(1, 0, b"efg".to_vec())
            .await
            .expect("write second active piece");
        storage.record_verified(1).expect("verify second piece");
        let route_epoch = storage.route_epoch();
        let availability =
            PieceAvailability::new(route_epoch, &[true, false]).expect("active availability");
        let (plans, mut requests) = mpsc::channel(ACTIVE_UPLOAD_PLAN_CAPACITY);
        let storage_owner = tokio::spawn(async move {
            while let Some(ActiveUploadPlanRequest {
                request,
                route_epoch,
                response,
            }) = requests.recv().await
            {
                let _ = response.send(storage.prepare_upload_read(request, route_epoch));
            }
            storage
        });
        let content = ActiveSeedContent::new(
            metainfo.info_hash,
            false,
            vec![4, 3],
            availability.clone(),
            plans,
        );
        let failure = content.failure_signal();
        let torrent_peers = TorrentPeerHandle::new(Arc::new(TestPeerActivity::default()))
            .expect("active peer state");
        let registration =
            SeedRegistration::new_active(Arc::<[u8]>::from(raw_info), content, torrent_peers)
                .expect("active registration");
        let info_hash = registration.info_hash();
        let mut active_config = config(IncomingTcpBootstrap::AutomaticLoopback);
        active_config.peer_activity_timeout = Duration::from_secs(5);
        active_config.no_request_timeout = Duration::from_secs(5);
        active_config.inactivity_timeout = Duration::from_secs(5);
        let service = IncomingPeerService::bind(active_config)
            .await
            .expect("bind active service")
            .expect("active service enabled");
        let handle = service.handle();
        let token = handle
            .register(registration)
            .await
            .expect("register active route");
        let (mut stream, mut decoder, mut queued) =
            connect(service.listen_address(), info_hash, [71; 20]).await;
        assert_eq!(
            next_message(&mut stream, &mut decoder, &mut queued).await,
            PeerMessage::Bitfield(vec![0b1000_0000])
        );
        assert!(matches!(
            next_message(&mut stream, &mut decoder, &mut queued).await,
            PeerMessage::Extended { id: 0, .. }
        ));
        send(&mut stream, &PeerMessage::Interested).await;
        assert_eq!(
            next_message(&mut stream, &mut decoder, &mut queued).await,
            PeerMessage::Unchoke
        );
        send(
            &mut stream,
            &PeerMessage::Request(BlockRequest {
                index: 0,
                begin: 0,
                length: 4,
            }),
        )
        .await;
        assert_eq!(
            next_message(&mut stream, &mut decoder, &mut queued).await,
            PeerMessage::Piece {
                index: 0,
                begin: 0,
                block: b"abcd".to_vec(),
            }
        );
        availability
            .publish(1, route_epoch)
            .expect("publish second active piece");
        send(&mut stream, &PeerMessage::KeepAlive).await;
        assert_eq!(
            next_message(&mut stream, &mut decoder, &mut queued).await,
            PeerMessage::Have(1)
        );

        tokio::fs::OpenOptions::new()
            .write(true)
            .truncate(true)
            .open(&content_path)
            .await
            .expect("open active payload for truncation");
        send(
            &mut stream,
            &PeerMessage::Request(BlockRequest {
                index: 0,
                begin: 0,
                length: 4,
            }),
        )
        .await;
        timeout(Duration::from_secs(2), failure.cancelled())
            .await
            .expect("active upload failure signal");
        let retracted = availability.snapshot();
        assert_eq!(retracted.epoch, route_epoch + 1);
        assert_eq!(retracted.available_count, 0);
        let (piece, error) = failure
            .take_failure()
            .expect("active upload failure detail");
        assert_eq!(piece, 0);
        assert!(error.to_string().contains("length"));
        timeout(Duration::from_secs(2), async {
            loop {
                if service.snapshot().established == 0 {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("failed active route peers joined");

        assert!(handle.unregister(token).await.expect("unregister active"));
        drop(handle);
        service.shutdown().await.expect("shutdown active service");
        drop(storage_owner.await.expect("join active storage owner"));
        tokio::fs::remove_dir_all(root)
            .await
            .expect("remove active root");
    }

    #[tokio::test]
    async fn v2_seed_hash_service_reconstructs_piece_and_leaf_proofs_on_demand() {
        let blocks = [
            vec![0x11; 16 * 1024],
            vec![0x22; 16 * 1024],
            vec![0x33; 16 * 1024],
            vec![0x44; 16 * 1024],
        ];
        let leaves = blocks
            .each_ref()
            .map(|block| rstorrent_protocol::merkle::hash_block(block).unwrap());
        let piece_roots = [
            rstorrent_protocol::merkle::hash_pair(&leaves[0], &leaves[1]),
            rstorrent_protocol::merkle::hash_pair(&leaves[2], &leaves[3]),
        ];
        let file_root = rstorrent_protocol::merkle::hash_pair(&piece_roots[0], &piece_roots[1]);
        let mut raw_info = b"d9:file treed1:ad0:d6:lengthi65536e11:pieces root32:".to_vec();
        raw_info.extend_from_slice(&file_root);
        raw_info.extend_from_slice(b"eee12:meta versioni2e4:name4:root12:piece lengthi32768ee");
        let runtime = super::TorrentContent::from_v2_info_bytes_with_limits(
            &raw_info,
            super::DURABLE_METAINFO_LIMITS,
        )
        .expect("v2 seed descriptor");
        let root = root("v2-hash-service");
        tokio::fs::create_dir_all(&root)
            .await
            .expect("create v2 hash root");
        let artifact_identity = crate::TorrentArtifactIdentity {
            torrent_id: crate::TorrentId::new([0x73; 16]).expect("nonzero v2 seed owner"),
            content_fingerprint: crate::ContentFingerprint::for_info_bytes(&raw_info),
        };
        let mut storage = SelectiveStorage::create_content(
            root.join(runtime.content.name()),
            artifact_identity,
            Arc::new(runtime.content.clone()),
            &[],
        )
        .await
        .expect("create active v2 seed storage");
        for piece in 0..2_u32 {
            for block in 0..2_u32 {
                storage
                    .write_block(
                        piece,
                        block * 16 * 1024,
                        blocks[(piece * 2 + block) as usize].clone(),
                    )
                    .await
                    .expect("write v2 seed block");
            }
            storage
                .record_verified(piece as usize)
                .expect("verify v2 seed piece");
        }
        let availability = PieceAvailability::new(storage.route_epoch(), &[true, true])
            .expect("v2 seed availability");
        let (plans, mut requests) = mpsc::channel(ACTIVE_UPLOAD_PLAN_CAPACITY);
        let storage_owner = tokio::spawn(async move {
            while let Some(ActiveUploadPlanRequest {
                request,
                route_epoch,
                response,
            }) = requests.recv().await
            {
                let _ = response.send(storage.prepare_upload_read(request, route_epoch));
            }
            storage
        });
        let active = ActiveSeedContent::new(
            runtime.content.swarm_key().into_bytes(),
            false,
            vec![32 * 1024, 32 * 1024],
            availability,
            plans,
        );
        let peers = TorrentPeerHandle::new(Arc::new(TestPeerActivity::default()))
            .expect("v2 seed peer state");
        let registration = SeedRegistration::new_active_with_swarm_key(
            Arc::<[u8]>::from(raw_info),
            runtime.content.swarm_key(),
            active,
            peers,
            None,
        )
        .expect("v2 active registration");
        let info_hash = registration.info_hash();
        let mut service_config = config(IncomingTcpBootstrap::AutomaticLoopback);
        service_config.peer_activity_timeout = Duration::from_secs(5);
        let service = IncomingPeerService::bind(service_config)
            .await
            .expect("bind v2 incoming service")
            .expect("v2 incoming service enabled");
        let handle = service.handle();
        let token = handle
            .register(registration)
            .await
            .expect("register active v2 seed");
        let (mut peer, mut decoder, mut queued) = connect(
            service.listen_address(),
            info_hash,
            *b"-RS-V2LEECH-00000000",
        )
        .await;
        decoder.set_protocol(PeerProtocol::V2);
        assert_eq!(
            next_message(&mut peer, &mut decoder, &mut queued).await,
            PeerMessage::Bitfield(vec![0b1100_0000])
        );
        assert!(matches!(
            next_message(&mut peer, &mut decoder, &mut queued).await,
            PeerMessage::Extended { id: 0, .. }
        ));
        let piece_request = super::HashRequest {
            pieces_root: file_root,
            base_layer: 1,
            index: 0,
            count: 2,
            proof_layers: 0,
        };
        send(&mut peer, &PeerMessage::HashRequest(piece_request)).await;
        assert_eq!(
            next_message(&mut peer, &mut decoder, &mut queued).await,
            PeerMessage::Hashes(super::HashResponse {
                request: piece_request,
                hashes: piece_roots.to_vec(),
            })
        );
        let leaf_request = super::HashRequest {
            pieces_root: file_root,
            base_layer: 0,
            index: 0,
            count: 2,
            proof_layers: 1,
        };
        send(&mut peer, &PeerMessage::HashRequest(leaf_request)).await;
        assert_eq!(
            next_message(&mut peer, &mut decoder, &mut queued).await,
            PeerMessage::Hashes(super::HashResponse {
                request: leaf_request,
                hashes: vec![leaves[0], leaves[1], piece_roots[1]],
            })
        );
        assert_eq!(handle.snapshot().read_high_water, 1);
        drop(peer);
        assert!(handle.unregister(token).await.expect("unregister v2 seed"));
        drop(handle);
        service.shutdown().await.expect("shutdown v2 service");
        drop(runtime);
        drop(storage_owner.await.expect("join v2 seed storage owner"));
        tokio::fs::remove_dir_all(root)
            .await
            .expect("remove v2 hash root");
    }

    #[tokio::test]
    async fn hybrid_v2_seed_hash_service_reconstructs_piece_layer_on_demand() {
        fn bstr(output: &mut Vec<u8>, value: &[u8]) {
            output.extend_from_slice(value.len().to_string().as_bytes());
            output.push(b':');
            output.extend_from_slice(value);
        }

        let data = (0..32 * 1024 + 731)
            .map(|index| (index % 251) as u8)
            .collect::<Vec<_>>();
        let mut piece_roots = Vec::new();
        for piece in data.chunks(32 * 1024) {
            let mut accumulator = MerkleAccumulator::new(0).expect("piece accumulator");
            for block in piece.chunks(MERKLE_BLOCK_SIZE) {
                accumulator
                    .push(hash_block(block).expect("block hash"))
                    .expect("append block hash");
            }
            piece_roots.push(
                accumulator
                    .finish_padded_to(1)
                    .expect("padded hybrid piece root"),
            );
        }
        let file_root = rstorrent_protocol::merkle::hash_pair(&piece_roots[0], &piece_roots[1]);
        let mut v1_pieces = Vec::new();
        for piece in data.chunks(32 * 1024) {
            v1_pieces.extend_from_slice(&Sha1::digest(piece));
        }
        let mut raw_info = b"d9:file treed5:a.bind0:d6:lengthi33499e11:pieces root32:".to_vec();
        raw_info.extend_from_slice(&file_root);
        raw_info.extend_from_slice(b"eee5:filesld6:lengthi33499e4:pathl5:a.bineee12:meta versioni2e4:name4:root12:piece lengthi32768e6:pieces");
        bstr(&mut raw_info, &v1_pieces);
        raw_info.push(b'e');
        let runtime =
            TorrentContent::from_hybrid_info_bytes_with_limits(&raw_info, BEP9_METAINFO_LIMITS)
                .expect("hybrid seed descriptor");
        let root = root("hybrid-v2-hash-service");
        tokio::fs::create_dir_all(root.join("root"))
            .await
            .expect("create hybrid hash root");
        tokio::fs::write(root.join("root/a.bin"), &data)
            .await
            .expect("write hybrid payload");
        let pool =
            crate::StorageFilePool::new(crate::storage_file_pool::DEFAULT_STORAGE_FILE_LIMIT, None)
                .expect("hybrid hash file pool");
        let seed = SeedContent::open_verified_content_with_pool(
            &root,
            crate::TorrentId::new([0x74; 16]).expect("nonzero hybrid hash owner"),
            &runtime.content,
            &[true, true],
            &[],
            pool,
        )
        .await
        .expect("open hybrid hash seed");
        let peers = TorrentPeerHandle::new(Arc::new(TestPeerActivity::default()))
            .expect("hybrid hash peer state");
        let v2_key = runtime
            .content
            .swarm_keys()
            .find(|key| matches!(key, SwarmKey::V2Truncated(_)))
            .expect("hybrid v2 key");
        let registration = SeedRegistration::new_with_swarm_key(raw_info, v2_key, seed, peers)
            .expect("hybrid v2 registration");
        let request = HashRequest {
            pieces_root: file_root,
            base_layer: 1,
            index: 0,
            count: 2,
            proof_layers: 0,
        };
        assert_eq!(
            registration
                .hash_response(request)
                .await
                .expect("hybrid piece-layer response"),
            HashResponse {
                request,
                hashes: piece_roots,
            }
        );
        tokio::fs::remove_dir_all(root)
            .await
            .expect("remove hybrid hash root");
    }

    #[tokio::test]
    async fn duplicate_incoming_peer_id_keeps_first_and_releases_loser() {
        let (root, _raw_info, registration, torrent_peers, peer_activity) =
            registration("duplicate-peer-id").await;
        let info_hash = registration.info_hash();
        let mut service_config = config(IncomingTcpBootstrap::AutomaticLoopback);
        service_config.peer_budget = PeerBudget::new(PeerBudgetConfig {
            configured_limit: 1,
            incoming_slack: 1,
            max_open_files: 10_000,
        });
        let service = IncomingPeerService::bind(service_config)
            .await
            .expect("bind service")
            .expect("enabled service");
        let handle = service.handle();
        let token = handle.register(registration).await.expect("register seed");
        let remote_peer_id = *b"-RS-LEECH-0000000000";

        let (mut winner, mut decoder, mut queued) =
            connect(service.listen_address(), info_hash, remote_peer_id).await;
        assert!(matches!(
            next_message(&mut winner, &mut decoder, &mut queued).await,
            PeerMessage::Bitfield(_)
        ));
        assert!(matches!(
            next_message(&mut winner, &mut decoder, &mut queued).await,
            PeerMessage::Extended { id: 0, .. }
        ));
        let (mut loser, _, _) = connect(service.listen_address(), info_hash, remote_peer_id).await;
        observe_close(&mut loser).await;

        let live = handle.snapshot();
        assert_eq!(live.pending, 0);
        assert_eq!(live.established, 1);
        assert_eq!(live.peer_budget.total_high_water, 2);
        assert_eq!(live.peer_uploads.len(), 1);
        let peers = torrent_peers.connection_snapshot();
        assert_eq!(peers.len(), 1);
        assert_eq!(peers[0].peer_id, Some(remote_peer_id));
        assert_eq!(peers[0].lifecycle, PeerConnectionLifecycle::Connected);
        send(&mut winner, &PeerMessage::Interested).await;
        assert_eq!(
            next_message(&mut winner, &mut decoder, &mut queued).await,
            PeerMessage::Unchoke
        );
        assert!(
            peer_activity
                .connections
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .iter()
                .flatten()
                .any(|peer| peer.close_reason == Some(PeerFailure::DuplicatePeerId))
        );

        assert!(handle.unregister(token).await.expect("unregister seed"));
        observe_close(&mut winner).await;
        drop(handle);
        let terminal = service.shutdown().await.expect("shutdown service");
        assert_eq!(terminal.pending, 0);
        assert_eq!(terminal.established, 0);
        assert!(torrent_peers.connection_snapshot().is_empty());
        tokio::fs::remove_dir_all(root).await.expect("remove root");
    }

    #[tokio::test]
    async fn ten_peers_share_eight_slots_and_a_departure_fills_immediately() {
        let (root, _, registration, torrent_peers, _) = registration("ten-peers").await;
        let info_hash = registration.info_hash();
        let service = IncomingPeerService::bind(config(IncomingTcpBootstrap::AutomaticLoopback))
            .await
            .expect("bind service")
            .expect("enabled service");
        let handle = service.handle();
        let token = handle.register(registration).await.expect("register seed");
        let mut peers = Vec::new();
        for generation in 1_u8..=10 {
            let mut peer = connect(service.listen_address(), info_hash, [generation; 20]).await;
            assert!(matches!(
                next_message(&mut peer.0, &mut peer.1, &mut peer.2).await,
                PeerMessage::Bitfield(_)
            ));
            assert!(matches!(
                next_message(&mut peer.0, &mut peer.1, &mut peer.2).await,
                PeerMessage::Extended { id: 0, .. }
            ));
            send(&mut peer.0, &PeerMessage::Interested).await;
            peers.push(peer);
        }

        for peer in peers.iter_mut().take(8) {
            assert_eq!(
                next_message(&mut peer.0, &mut peer.1, &mut peer.2).await,
                PeerMessage::Unchoke
            );
        }
        let (first, rest) = peers.split_at_mut(9);
        let ninth = &mut first[8];
        assert!(
            timeout(
                Duration::from_millis(50),
                next_message(&mut ninth.0, &mut ninth.1, &mut ninth.2),
            )
            .await
            .is_err(),
            "ninth interested peer must remain choked"
        );
        assert_eq!(rest.len(), 1);
        let saturated = handle.snapshot();
        assert_eq!(saturated.established, 10);
        assert_eq!(saturated.established_high_water, 10);
        assert_eq!(saturated.upload_scheduler.interested, 10);
        assert_eq!(saturated.upload_scheduler.regular, 7);
        assert_eq!(saturated.upload_scheduler.optimistic, 1);
        assert_eq!(torrent_peers.connection_snapshot().len(), 10);

        for peer in peers.iter_mut().take(8) {
            send(
                &mut peer.0,
                &PeerMessage::Request(rstorrent_protocol::peer_wire::BlockRequest {
                    index: 0,
                    begin: 0,
                    length: 4,
                }),
            )
            .await;
        }
        for peer in peers.iter_mut().take(8) {
            assert!(matches!(
                next_message(&mut peer.0, &mut peer.1, &mut peer.2).await,
                PeerMessage::Piece { block, .. } if block == b"abcd"
            ));
        }

        drop(peers.remove(0));
        let ninth = &mut peers[7];
        assert_eq!(
            next_message(&mut ninth.0, &mut ninth.1, &mut ninth.2).await,
            PeerMessage::Unchoke
        );
        assert!(handle.unregister(token).await.expect("unregister seed"));
        assert!(torrent_peers.connection_snapshot().is_empty());
        let terminal = service.shutdown().await.expect("shutdown service");
        assert_eq!(terminal.established, 0);
        assert_eq!(terminal.peer_budget.total, 0);
        assert_eq!(terminal.upload_scheduler.peers, 0);
        assert_eq!(terminal.payload_bytes_sent, 8 * 4);
        assert!(terminal.read_high_water <= super::DEFAULT_UPLOAD_READ_JOBS);
        tokio::fs::remove_dir_all(root).await.expect("remove root");
    }

    #[tokio::test]
    async fn keepalive_activity_no_request_and_near_limit_timeouts_are_distinct() {
        let (root, _, seed, _, _) = registration("peer-timeouts").await;
        let info_hash = seed.info_hash();
        let mut service_config = config(IncomingTcpBootstrap::AutomaticLoopback);
        service_config.peer_activity_timeout = Duration::from_millis(500);
        service_config.keepalive_interval = Duration::from_millis(20);
        service_config.no_request_timeout = Duration::from_millis(500);
        service_config.inactivity_timeout = Duration::from_millis(500);
        let service = IncomingPeerService::bind(service_config)
            .await
            .expect("bind keepalive service")
            .expect("enabled keepalive service");
        let handle = service.handle();
        let token = handle.register(seed).await.expect("register seed");
        let mut peer = connect(service.listen_address(), info_hash, [31; 20]).await;
        assert!(matches!(
            next_message(&mut peer.0, &mut peer.1, &mut peer.2).await,
            PeerMessage::Bitfield(_)
        ));
        assert!(matches!(
            next_message(&mut peer.0, &mut peer.1, &mut peer.2).await,
            PeerMessage::Extended { id: 0, .. }
        ));
        assert_eq!(
            next_message(&mut peer.0, &mut peer.1, &mut peer.2).await,
            PeerMessage::KeepAlive
        );
        assert!(handle.unregister(token).await.expect("unregister seed"));
        service
            .shutdown()
            .await
            .expect("shutdown keepalive service");
        tokio::fs::remove_dir_all(root).await.expect("remove root");

        let (root, _, seed, _, _) = registration("activity-timeout").await;
        let info_hash = seed.info_hash();
        let mut service_config = config(IncomingTcpBootstrap::AutomaticLoopback);
        service_config.peer_activity_timeout = Duration::from_millis(30);
        service_config.keepalive_interval = Duration::from_secs(5);
        service_config.no_request_timeout = Duration::from_secs(5);
        service_config.inactivity_timeout = Duration::from_secs(5);
        let service = IncomingPeerService::bind(service_config)
            .await
            .expect("bind activity service")
            .expect("enabled activity service");
        let handle = service.handle();
        handle.register(seed).await.expect("register seed");
        let mut peer = connect(service.listen_address(), info_hash, [32; 20]).await;
        let _ = next_message(&mut peer.0, &mut peer.1, &mut peer.2).await;
        let _ = next_message(&mut peer.0, &mut peer.1, &mut peer.2).await;
        observe_close(&mut peer.0).await;
        assert_eq!(
            handle
                .snapshot()
                .rejection_counts
                .get(&IncomingRejectionReason::ActivityTimeout),
            Some(&1)
        );
        service.shutdown().await.expect("shutdown activity service");
        tokio::fs::remove_dir_all(root).await.expect("remove root");

        let (root, _, seed, _, _) = registration("no-request-timeout").await;
        let info_hash = seed.info_hash();
        let mut service_config = config(IncomingTcpBootstrap::AutomaticLoopback);
        service_config.peer_activity_timeout = Duration::from_secs(5);
        service_config.keepalive_interval = Duration::from_secs(5);
        service_config.no_request_timeout = Duration::from_millis(30);
        service_config.inactivity_timeout = Duration::from_secs(5);
        let service = IncomingPeerService::bind(service_config)
            .await
            .expect("bind no-request service")
            .expect("enabled no-request service");
        let handle = service.handle();
        handle.register(seed).await.expect("register seed");
        let mut peer = connect(service.listen_address(), info_hash, [33; 20]).await;
        let _ = next_message(&mut peer.0, &mut peer.1, &mut peer.2).await;
        let _ = next_message(&mut peer.0, &mut peer.1, &mut peer.2).await;
        send(&mut peer.0, &PeerMessage::Interested).await;
        assert_eq!(
            next_message(&mut peer.0, &mut peer.1, &mut peer.2).await,
            PeerMessage::Unchoke
        );
        observe_close(&mut peer.0).await;
        assert_eq!(
            handle
                .snapshot()
                .rejection_counts
                .get(&IncomingRejectionReason::NoRequestTimeout),
            Some(&1)
        );
        service
            .shutdown()
            .await
            .expect("shutdown no-request service");
        tokio::fs::remove_dir_all(root).await.expect("remove root");

        let (root, _, seed, _, _) = registration("inactivity-timeout").await;
        let info_hash = seed.info_hash();
        let mut service_config = config(IncomingTcpBootstrap::AutomaticLoopback);
        service_config.peer_activity_timeout = Duration::from_secs(5);
        service_config.keepalive_interval = Duration::from_secs(5);
        service_config.no_request_timeout = Duration::from_secs(5);
        service_config.inactivity_timeout = Duration::from_millis(30);
        service_config.peer_budget = PeerBudget::new(PeerBudgetConfig {
            configured_limit: 1,
            incoming_slack: 0,
            max_open_files: 10_000,
        });
        let service = IncomingPeerService::bind(service_config)
            .await
            .expect("bind inactivity service")
            .expect("enabled inactivity service");
        let handle = service.handle();
        handle.register(seed).await.expect("register seed");
        let mut peer = connect(service.listen_address(), info_hash, [34; 20]).await;
        let _ = next_message(&mut peer.0, &mut peer.1, &mut peer.2).await;
        let _ = next_message(&mut peer.0, &mut peer.1, &mut peer.2).await;
        observe_close(&mut peer.0).await;
        assert_eq!(
            handle
                .snapshot()
                .rejection_counts
                .get(&IncomingRejectionReason::InactivityTimeout),
            Some(&1)
        );
        service
            .shutdown()
            .await
            .expect("shutdown inactivity service");
        tokio::fs::remove_dir_all(root).await.expect("remove root");
    }

    #[tokio::test]
    async fn unknown_timeout_self_and_connection_saturation_are_bounded() {
        let (root, _, registration, torrent_peers, _) = registration("rejections").await;
        let info_hash = registration.info_hash();
        let mut service_config = config(IncomingTcpBootstrap::AutomaticLoopback);
        service_config.handshake_timeout = Duration::from_millis(50);
        service_config.peer_budget = PeerBudget::new(PeerBudgetConfig {
            configured_limit: 1,
            incoming_slack: 0,
            max_open_files: 10_000,
        });
        let service = IncomingPeerService::bind(service_config)
            .await
            .expect("bind service")
            .expect("enabled service");
        let handle = service.handle();
        handle.register(registration).await.expect("register seed");

        let mut silent = TcpStream::connect(service.listen_address())
            .await
            .expect("connect silent peer");
        timeout(Duration::from_secs(1), silent.read(&mut [0; 1]))
            .await
            .expect("silent peer close deadline")
            .expect("silent peer read");

        let mut unknown = TcpStream::connect(service.listen_address())
            .await
            .expect("connect unknown peer");
        unknown
            .write_all(&encode_handshake_with_reserved(
                [9; 20],
                *b"-RS-UNKNOWN-00000000",
                [0; 8],
            ))
            .await
            .expect("send unknown handshake");
        assert_eq!(unknown.read(&mut [0; 1]).await.expect("unknown close"), 0);

        let mut self_peer = TcpStream::connect(service.listen_address())
            .await
            .expect("connect self peer");
        self_peer
            .write_all(&encode_handshake_with_reserved(
                info_hash,
                super::DEFAULT_PEER_ID,
                [0; 8],
            ))
            .await
            .expect("send self handshake");
        assert_eq!(self_peer.read(&mut [0; 1]).await.expect("self close"), 0);

        let (first, _, _) = connect(
            service.listen_address(),
            info_hash,
            *b"-RS-FIRST--000000000",
        )
        .await;
        let mut second = TcpStream::connect(service.listen_address())
            .await
            .expect("connect saturated peer");
        second
            .write_all(&encode_handshake_with_reserved(
                info_hash,
                *b"-RS-SECOND-000000000",
                [0; 8],
            ))
            .await
            .expect("send saturated handshake");
        match second.read(&mut [0; 1]).await {
            Ok(0) => {}
            Err(error) if error.kind() == std::io::ErrorKind::ConnectionReset => {}
            result => panic!("unexpected saturated close result {result:?}"),
        }
        drop(first);

        timeout(Duration::from_secs(1), async {
            loop {
                let snapshot = handle.snapshot();
                if snapshot.pending == 0
                    && snapshot
                        .rejection_counts
                        .get(&IncomingRejectionReason::HandshakeTimeout)
                        == Some(&1)
                    && snapshot
                        .rejection_counts
                        .get(&IncomingRejectionReason::UnknownTorrent)
                        == Some(&1)
                    && snapshot
                        .rejection_counts
                        .get(&IncomingRejectionReason::SelfConnection)
                        == Some(&1)
                    && snapshot
                        .rejection_counts
                        .get(&IncomingRejectionReason::ConnectionLimit)
                        == Some(&1)
                {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("rejection observations");
        let snapshot = handle.snapshot();
        assert!(snapshot.pending_high_water <= super::MAX_INCOMING_PENDING);
        assert_eq!(snapshot.established_high_water, 1);
        assert_eq!(snapshot.peer_budget.total_high_water, 1);
        assert!(snapshot.recent_rejections.len() <= 32);
        service.shutdown().await.expect("shutdown service");
        assert!(torrent_peers.connection_snapshot().is_empty());
        tokio::fs::remove_dir_all(root).await.expect("remove root");
    }

    #[tokio::test]
    async fn pending_handshake_and_registration_caps_are_exact() {
        let (root, _, registration, _, _) = registration("caps").await;
        let mut service_config = config(IncomingTcpBootstrap::AutomaticLoopback);
        service_config.handshake_timeout = Duration::from_millis(500);
        let service = IncomingPeerService::bind(service_config)
            .await
            .expect("bind service")
            .expect("enabled service");
        let handle = service.handle();
        let template = registration.clone();
        for value in 0..super::MAX_SEED_REGISTRATIONS {
            let mut registration = template.clone();
            let mut info_hash = registration.info_hash();
            info_hash[..8].copy_from_slice(&(value as u64).to_be_bytes());
            registration.swarm_key = SwarmKey::V2Truncated(info_hash);
            handle.register(registration).await.expect("fill registry");
            if value + 1 == 500 {
                let retained = handle.snapshot();
                assert_eq!(retained.registrations, 500);
                assert_eq!(retained.pending, 0);
                assert_eq!(retained.established, 0);
                assert_eq!(retained.reads, 0);
                assert_eq!(retained.peer_budget.total, 0);
                assert_eq!(retained.upload_scheduler.peers, 0);
                assert_eq!(retained.upload_scheduler.interested, 0);
                assert_eq!(retained.upload_scheduler.regular, 0);
                assert_eq!(retained.upload_scheduler.optimistic, 0);
                assert_eq!(retained.torrent_uploads.len(), 500);
                assert!(retained.torrent_uploads.iter().all(|torrent| {
                    torrent.peers == 0 && torrent.traffic == super::UploadTrafficSnapshot::default()
                }));
                assert!(retained.peer_uploads.is_empty());
            }
        }
        let mut overflow = template;
        overflow.swarm_key = SwarmKey::V2Truncated([0xff; 20]);
        assert!(matches!(
            handle.register(overflow).await,
            Err(IncomingPeerError::RegistrationLimit { maximum })
                if maximum == super::MAX_SEED_REGISTRATIONS
        ));

        let mut silent = Vec::new();
        for _ in 0..=super::MAX_INCOMING_PENDING {
            silent.push(
                TcpStream::connect(service.listen_address())
                    .await
                    .expect("connect pending peer"),
            );
        }
        timeout(Duration::from_secs(1), async {
            loop {
                let snapshot = handle.snapshot();
                if snapshot
                    .rejection_counts
                    .get(&IncomingRejectionReason::PendingLimit)
                    == Some(&1)
                {
                    assert_eq!(snapshot.pending, super::MAX_INCOMING_PENDING);
                    assert_eq!(snapshot.pending_high_water, super::MAX_INCOMING_PENDING);
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("pending saturation observation");
        drop(silent);
        let terminal = service
            .shutdown()
            .await
            .expect("shutdown saturated service");
        assert_eq!(terminal.pending, 0);
        assert_eq!(terminal.registrations, 0);
        tokio::fs::remove_dir_all(root).await.expect("remove root");
    }
}
