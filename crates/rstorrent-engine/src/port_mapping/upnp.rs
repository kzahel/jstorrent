//! Bounded UPnP IGD v2 control point.
//!
//! One source-bound root-device discovery may yield independent IPv4 mapping
//! and IPv6 firewall-control clients. XML, URL, SOAP, and lease transitions
//! remain deterministic; Tokio owns only discovery and HTTP awaits.

use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;
use std::fmt;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, SocketAddrV4, SocketAddrV6};
use std::time::Duration;

use quick_xml::Reader;
use quick_xml::events::Event;
use reqwest::Client;
use reqwest::header::{CONTENT_TYPE, HeaderMap};
use tokio::net::UdpSocket;
use tokio::time::{Instant, timeout_at};
use tokio_util::sync::CancellationToken;
use url::Url;

pub const SSDP_MULTICAST_ENDPOINT: SocketAddrV4 =
    SocketAddrV4::new(Ipv4Addr::new(239, 255, 255, 250), 1_900);
pub const REQUESTED_LEASE_SECONDS: u32 = 3_600;
pub const RECONCILIATION_LEASE_SECONDS: u32 = REQUESTED_LEASE_SECONDS + 1;
pub const RENEWAL_NUMERATOR: u32 = 3;
pub const RENEWAL_DENOMINATOR: u32 = 4;
pub const MAX_SSDP_DATAGRAM_BYTES: usize = 8 * 1_024;
pub const MAX_SSDP_HEADERS: usize = 64;
pub const MAX_DEVICE_LOCATIONS: usize = 8;
pub const MAX_URL_BYTES: usize = 2 * 1_024;
pub const MAX_HTTP_BODY_BYTES: usize = 256 * 1_024;
pub const MAX_XML_DEPTH: usize = 32;
pub const MAX_XML_EVENTS: usize = 8_192;
pub const MAX_XML_TEXT_BYTES: usize = 2 * 1_024;
pub const MAX_SERVICE_CANDIDATES: usize = 64;
pub const MAX_MAPPING_CANDIDATES: usize = 4;
pub const MAX_ERROR_DETAIL_BYTES: usize = 512;

const WAN_IP_CONNECTION_V2: &str = "urn:schemas-upnp-org:service:WANIPConnection:2";
const WAN_IPV6_FIREWALL_CONTROL_V1: &str = "urn:schemas-upnp-org:service:WANIPv6FirewallControl:1";
const MAPPING_DESCRIPTION: &str = "JSTorrent";
const DISCOVERY_ATTEMPTS: usize = 3;
const DISCOVERY_WINDOW: Duration = Duration::from_millis(900);
const DISCOVERY_DEADLINE: Duration = Duration::from_secs(8);
const HTTP_TIMEOUT: Duration = Duration::from_secs(5);
const HTTP_OPERATION_PAUSE: Duration = Duration::from_millis(100);
const HIGH_PORT_START: u16 = 40_000;
const HIGH_PORT_COUNT: u16 = 10_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum UpnpStage {
    Discovery,
    Description,
    ExternalAddress,
    Add,
    Verify,
    Renewal,
    Delete,
    FirewallStatus,
    PinholeAdd,
    PinholeVerify,
    PinholeRenewal,
    PinholeDelete,
    PinholePackets,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpnpError {
    stage: UpnpStage,
    detail: String,
    fault_code: Option<u16>,
    transport: bool,
}

impl UpnpError {
    fn new(stage: UpnpStage, detail: impl AsRef<str>) -> Self {
        Self {
            stage,
            detail: bounded(detail.as_ref(), MAX_ERROR_DETAIL_BYTES),
            fault_code: None,
            transport: false,
        }
    }

    fn fault(stage: UpnpStage, code: u16, description: &str) -> Self {
        Self {
            stage,
            detail: bounded(
                &format!("UPnP fault {code}: {description}"),
                MAX_ERROR_DETAIL_BYTES,
            ),
            fault_code: Some(code),
            transport: false,
        }
    }

    pub fn stage(&self) -> UpnpStage {
        self.stage
    }

    pub fn detail(&self) -> &str {
        &self.detail
    }

    pub fn fault_code(&self) -> Option<u16> {
        self.fault_code
    }

    pub fn is_transport(&self) -> bool {
        self.transport
    }
}

impl fmt::Display for UpnpError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.detail)
    }
}

impl Error for UpnpError {}

#[derive(Clone, Debug)]
pub struct UpnpDiscoveryConfig {
    local_address: Ipv4Addr,
    discovery_endpoint: SocketAddrV4,
    allow_loopback_gateway: bool,
    attempts: usize,
    response_window: Duration,
    overall_deadline: Duration,
    http_timeout: Duration,
}

impl UpnpDiscoveryConfig {
    pub fn new(local_address: Ipv4Addr) -> Result<Self, UpnpError> {
        if !eligible_local_address(local_address) {
            return Err(UpnpError::new(
                UpnpStage::Discovery,
                "UPnP requires a concrete non-loopback IPv4 listener address",
            ));
        }
        Ok(Self {
            local_address,
            discovery_endpoint: SSDP_MULTICAST_ENDPOINT,
            allow_loopback_gateway: false,
            attempts: DISCOVERY_ATTEMPTS,
            response_window: DISCOVERY_WINDOW,
            overall_deadline: DISCOVERY_DEADLINE,
            http_timeout: HTTP_TIMEOUT,
        })
    }

    /// Builds a loopback-scoped configuration for deterministic protocol tests.
    ///
    /// Product code must use [`Self::new`], which enforces a concrete local-
    /// network address and multicast discovery.
    #[doc(hidden)]
    pub fn scripted_for_testing(local_address: Ipv4Addr, discovery_endpoint: SocketAddrV4) -> Self {
        Self {
            local_address,
            discovery_endpoint,
            allow_loopback_gateway: true,
            attempts: 1,
            response_window: Duration::from_millis(300),
            overall_deadline: Duration::from_secs(2),
            http_timeout: Duration::from_secs(1),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpnpMappingEntry {
    pub internal_client: Ipv4Addr,
    pub internal_port: u16,
    pub enabled: bool,
    pub description: String,
    pub lease_seconds: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum UpnpTransport {
    Tcp,
    Udp,
}

impl UpnpTransport {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Tcp => "TCP",
            Self::Udp => "UDP",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpnpMapping {
    pub local_endpoint: SocketAddrV4,
    pub external_address: Ipv4Addr,
    pub external_port: u16,
    pub lease_seconds: u32,
    pub transport: UpnpTransport,
}

impl UpnpMapping {
    pub fn renewal_delay(&self) -> Duration {
        Duration::from_secs(
            u64::from(self.lease_seconds) * u64::from(RENEWAL_NUMERATOR)
                / u64::from(RENEWAL_DENOMINATOR),
        )
    }
}

#[derive(Clone, Debug)]
pub struct UpnpGateway {
    local_address: Ipv4Addr,
    gateway_address: Ipv4Addr,
    control_url: Url,
    service_type: String,
    client: Client,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct UpnpFirewallStatus {
    pub firewall_enabled: bool,
    pub inbound_pinhole_allowed: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpnpPinhole {
    pub internal_endpoint: SocketAddrV6,
    pub lease_seconds: u32,
    unique_id: u16,
    gateway_address: Ipv4Addr,
}

impl UpnpPinhole {
    pub fn renewal_delay(&self) -> Duration {
        Duration::from_secs(
            u64::from(self.lease_seconds) * u64::from(RENEWAL_NUMERATOR)
                / u64::from(RENEWAL_DENOMINATOR),
        )
    }

    #[doc(hidden)]
    pub fn unique_id_for_testing(&self) -> u16 {
        self.unique_id
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpnpUncertainPinhole {
    pub internal_endpoint: SocketAddrV6,
    pub lease_seconds: u32,
    pub detail: String,
}

#[derive(Clone, Debug)]
pub enum UpnpPinholeCreateError {
    Failed(UpnpError),
    Uncertain(UpnpUncertainPinhole),
}

#[derive(Clone, Debug)]
pub struct UpnpIpv6Firewall {
    local_address: Ipv4Addr,
    gateway_address: Ipv4Addr,
    control_url: Url,
    service_type: String,
    client: Client,
}

#[derive(Clone, Debug)]
pub enum UpnpDiscoveredService<T> {
    Available(T),
    Absent,
    Unavailable(UpnpError),
}

#[derive(Clone, Debug)]
pub struct UpnpIgdV2Services {
    pub ipv4_mapping: UpnpDiscoveredService<UpnpGateway>,
    pub ipv6_firewall: UpnpDiscoveredService<UpnpIpv6Firewall>,
}

impl UpnpGateway {
    pub async fn external_address(
        &self,
        cancellation: &CancellationToken,
    ) -> Result<Ipv4Addr, UpnpError> {
        let leaves = self
            .idempotent_soap(
                UpnpStage::ExternalAddress,
                "GetExternalIPAddress",
                &[],
                cancellation,
            )
            .await?;
        let value = unique_leaf(&leaves, "NewExternalIPAddress", UpnpStage::ExternalAddress)?;
        let address = value.parse::<Ipv4Addr>().map_err(|_| {
            UpnpError::new(
                UpnpStage::ExternalAddress,
                "gateway returned an invalid external IPv4 address",
            )
        })?;
        if !eligible_external_address(address) {
            return Err(UpnpError::new(
                UpnpStage::ExternalAddress,
                "gateway returned a non-public external IPv4 address",
            ));
        }
        Ok(address)
    }

    pub async fn query_mapping(
        &self,
        external_port: u16,
        transport: UpnpTransport,
        stage: UpnpStage,
        cancellation: &CancellationToken,
    ) -> Result<Option<UpnpMappingEntry>, UpnpError> {
        let port = external_port.to_string();
        let result = self
            .idempotent_soap(
                stage,
                "GetSpecificPortMappingEntry",
                &[
                    ("NewRemoteHost", ""),
                    ("NewExternalPort", &port),
                    ("NewProtocol", transport.as_str()),
                ],
                cancellation,
            )
            .await;
        let leaves = match result {
            Ok(leaves) => leaves,
            Err(error) if error.fault_code() == Some(714) => return Ok(None),
            Err(error) => return Err(error),
        };
        let internal_client = unique_leaf(&leaves, "NewInternalClient", stage)?
            .parse::<Ipv4Addr>()
            .map_err(|_| UpnpError::new(stage, "mapping entry has an invalid internal client"))?;
        let internal_port = parse_u16(
            unique_leaf(&leaves, "NewInternalPort", stage)?,
            stage,
            "mapping entry has an invalid internal port",
        )?;
        let enabled = match unique_leaf(&leaves, "NewEnabled", stage)? {
            "0" => false,
            "1" => true,
            _ => {
                return Err(UpnpError::new(
                    stage,
                    "mapping entry has invalid enabled state",
                ));
            }
        };
        let description = unique_leaf(&leaves, "NewPortMappingDescription", stage)?.to_owned();
        let lease_seconds = unique_leaf(&leaves, "NewLeaseDuration", stage)?
            .parse::<u32>()
            .map_err(|_| UpnpError::new(stage, "mapping entry has an invalid lease"))?;
        Ok(Some(UpnpMappingEntry {
            internal_client,
            internal_port,
            enabled,
            description,
            lease_seconds,
        }))
    }

    pub async fn create_mapping(
        &self,
        transport: UpnpTransport,
        local_port: u16,
        cancellation: &CancellationToken,
    ) -> Result<UpnpMapping, UpnpError> {
        if local_port == 0 {
            return Err(UpnpError::new(
                UpnpStage::Add,
                "mapping requires a nonzero local port",
            ));
        }
        let candidates = mapping_candidates(local_port)?;
        self.create_mapping_from_candidates(transport, local_port, candidates, cancellation)
            .await
    }

    /// Creates one mapping at an exact external port.
    ///
    /// Diagnostic owners use this when crash cleanup must be able to derive
    /// the only possible external entry before an add response is observed.
    pub async fn create_exact_mapping(
        &self,
        transport: UpnpTransport,
        local_port: u16,
        external_port: u16,
        cancellation: &CancellationToken,
    ) -> Result<UpnpMapping, UpnpError> {
        if local_port == 0 || external_port == 0 {
            return Err(UpnpError::new(
                UpnpStage::Add,
                "exact mapping requires nonzero local and external ports",
            ));
        }
        self.create_mapping_from_candidates(
            transport,
            local_port,
            vec![external_port],
            cancellation,
        )
        .await
    }

    async fn create_mapping_from_candidates(
        &self,
        transport: UpnpTransport,
        local_port: u16,
        candidates: Vec<u16>,
        cancellation: &CancellationToken,
    ) -> Result<UpnpMapping, UpnpError> {
        let external_address = self.external_address(cancellation).await?;
        let mut last_conflict = None;
        for external_port in candidates {
            let existing = self
                .query_mapping(external_port, transport, UpnpStage::Add, cancellation)
                .await?;
            if existing
                .as_ref()
                .is_some_and(|entry| !mapping_entry_matches(entry, self.local_address, local_port))
            {
                last_conflict = Some(external_port);
                continue;
            }
            tokio::time::sleep(HTTP_OPERATION_PAUSE).await;
            let mut transport_failure = None;
            for attempt in 0..2 {
                match self
                    .add_mapping(
                        external_port,
                        local_port,
                        transport,
                        UpnpStage::Add,
                        cancellation,
                    )
                    .await
                {
                    Ok(()) => {
                        transport_failure = None;
                        break;
                    }
                    Err(error) if error.fault_code() == Some(718) => {
                        last_conflict = Some(external_port);
                        break;
                    }
                    Err(error) if error.is_transport() => {
                        transport_failure = Some(error);
                        tokio::time::sleep(HTTP_OPERATION_PAUSE).await;
                        match self
                            .query_mapping(
                                external_port,
                                transport,
                                UpnpStage::Verify,
                                cancellation,
                            )
                            .await
                        {
                            Ok(Some(entry)) => {
                                verify_mapping_entry(
                                    &entry,
                                    self.local_address,
                                    local_port,
                                    transport,
                                    UpnpStage::Verify,
                                )?;
                                return Ok(UpnpMapping {
                                    local_endpoint: SocketAddrV4::new(
                                        self.local_address,
                                        local_port,
                                    ),
                                    external_address,
                                    external_port,
                                    lease_seconds: entry.lease_seconds,
                                    transport,
                                });
                            }
                            Ok(None) if attempt == 0 => {
                                tokio::time::sleep(HTTP_OPERATION_PAUSE).await;
                                continue;
                            }
                            Ok(None) => break,
                            Err(query_error) => return Err(query_error),
                        }
                    }
                    Err(error) => return Err(error),
                }
            }
            if last_conflict == Some(external_port) {
                continue;
            }
            if let Some(error) = transport_failure {
                return Err(error);
            }
            tokio::time::sleep(HTTP_OPERATION_PAUSE).await;
            let entry = self
                .query_mapping(external_port, transport, UpnpStage::Verify, cancellation)
                .await?
                .ok_or_else(|| {
                    UpnpError::new(
                        UpnpStage::Verify,
                        "gateway did not return the mapping after add",
                    )
                })?;
            verify_mapping_entry(
                &entry,
                self.local_address,
                local_port,
                transport,
                UpnpStage::Verify,
            )?;
            return Ok(UpnpMapping {
                local_endpoint: SocketAddrV4::new(self.local_address, local_port),
                external_address,
                external_port,
                lease_seconds: entry.lease_seconds,
                transport,
            });
        }
        Err(UpnpError::new(
            UpnpStage::Add,
            match last_conflict {
                Some(_) => "all bounded external-port candidates were occupied",
                None => "no external-port candidate was available",
            },
        ))
    }

    pub async fn renew_mapping(
        &self,
        mapping: &mut UpnpMapping,
        cancellation: &CancellationToken,
    ) -> Result<(), UpnpError> {
        if mapping.local_endpoint.ip() != &self.local_address {
            return Err(UpnpError::new(
                UpnpStage::Renewal,
                "mapping belongs to another local address",
            ));
        }
        self.add_mapping(
            mapping.external_port,
            mapping.local_endpoint.port(),
            mapping.transport,
            UpnpStage::Renewal,
            cancellation,
        )
        .await?;
        let entry = self
            .query_mapping(
                mapping.external_port,
                mapping.transport,
                UpnpStage::Renewal,
                cancellation,
            )
            .await?
            .ok_or_else(|| {
                UpnpError::new(
                    UpnpStage::Renewal,
                    "gateway did not return the mapping after renewal",
                )
            })?;
        verify_mapping_entry(
            &entry,
            self.local_address,
            mapping.local_endpoint.port(),
            mapping.transport,
            UpnpStage::Renewal,
        )?;
        mapping.lease_seconds = entry.lease_seconds;
        Ok(())
    }

    pub async fn delete_mapping(
        &self,
        mapping: &UpnpMapping,
        cancellation: &CancellationToken,
    ) -> Result<(), UpnpError> {
        if mapping.local_endpoint.ip() != &self.local_address {
            return Err(UpnpError::new(
                UpnpStage::Delete,
                "mapping belongs to another local address",
            ));
        }
        let port = mapping.external_port.to_string();
        self.soap(
            UpnpStage::Delete,
            "DeletePortMapping",
            &[
                ("NewRemoteHost", ""),
                ("NewExternalPort", &port),
                ("NewProtocol", mapping.transport.as_str()),
            ],
            cancellation,
        )
        .await?;
        if self
            .query_mapping(
                mapping.external_port,
                mapping.transport,
                UpnpStage::Delete,
                cancellation,
            )
            .await?
            .is_some()
        {
            return Err(UpnpError::new(
                UpnpStage::Delete,
                "gateway retained the mapping after delete",
            ));
        }
        Ok(())
    }

    async fn add_mapping(
        &self,
        external_port: u16,
        internal_port: u16,
        transport: UpnpTransport,
        stage: UpnpStage,
        cancellation: &CancellationToken,
    ) -> Result<(), UpnpError> {
        let external_port = external_port.to_string();
        let internal_port = internal_port.to_string();
        let internal_client = self.local_address.to_string();
        let lease = REQUESTED_LEASE_SECONDS.to_string();
        self.soap(
            stage,
            "AddPortMapping",
            &[
                ("NewRemoteHost", ""),
                ("NewExternalPort", &external_port),
                ("NewProtocol", transport.as_str()),
                ("NewInternalPort", &internal_port),
                ("NewInternalClient", &internal_client),
                ("NewEnabled", "1"),
                ("NewPortMappingDescription", MAPPING_DESCRIPTION),
                ("NewLeaseDuration", &lease),
            ],
            cancellation,
        )
        .await?;
        Ok(())
    }

    async fn soap(
        &self,
        stage: UpnpStage,
        action: &str,
        arguments: &[(&str, &str)],
        cancellation: &CancellationToken,
    ) -> Result<Vec<XmlLeaf>, UpnpError> {
        soap(
            &self.client,
            &self.control_url,
            &self.service_type,
            stage,
            action,
            arguments,
            cancellation,
        )
        .await
    }

    async fn idempotent_soap(
        &self,
        stage: UpnpStage,
        action: &str,
        arguments: &[(&str, &str)],
        cancellation: &CancellationToken,
    ) -> Result<Vec<XmlLeaf>, UpnpError> {
        for attempt in 0..2 {
            match self.soap(stage, action, arguments, cancellation).await {
                Err(error) if error.is_transport() && attempt == 0 => {
                    tokio::time::sleep(HTTP_OPERATION_PAUSE).await;
                }
                result => return result,
            }
        }
        unreachable!("bounded idempotent SOAP retry always returns")
    }

    pub fn gateway_address(&self) -> Ipv4Addr {
        self.gateway_address
    }
}

impl UpnpIpv6Firewall {
    pub async fn firewall_status(
        &self,
        cancellation: &CancellationToken,
    ) -> Result<UpnpFirewallStatus, UpnpError> {
        let stage = UpnpStage::FirewallStatus;
        let leaves = self
            .soap(stage, "GetFirewallStatus", &[], cancellation)
            .await?;
        Ok(UpnpFirewallStatus {
            firewall_enabled: parse_upnp_boolean(
                unique_leaf(&leaves, "FirewallEnabled", stage)?,
                stage,
            )?,
            inbound_pinhole_allowed: parse_upnp_boolean(
                unique_leaf(&leaves, "InboundPinholeAllowed", stage)?,
                stage,
            )?,
        })
    }

    pub async fn create_pinhole(
        &self,
        internal_endpoint: SocketAddrV6,
        cancellation: &CancellationToken,
    ) -> Result<UpnpPinhole, UpnpPinholeCreateError> {
        validate_pinhole_endpoint(internal_endpoint).map_err(UpnpPinholeCreateError::Failed)?;
        match self
            .add_pinhole(internal_endpoint, REQUESTED_LEASE_SECONDS, cancellation)
            .await
        {
            Ok(unique_id) => Ok(UpnpPinhole {
                internal_endpoint,
                lease_seconds: REQUESTED_LEASE_SECONDS,
                unique_id,
                gateway_address: self.gateway_address,
            }),
            Err(error) if error.is_transport() => {
                tokio::time::sleep(HTTP_OPERATION_PAUSE).await;
                match self
                    .add_pinhole(
                        internal_endpoint,
                        RECONCILIATION_LEASE_SECONDS,
                        cancellation,
                    )
                    .await
                {
                    Ok(unique_id) => Ok(UpnpPinhole {
                        internal_endpoint,
                        lease_seconds: RECONCILIATION_LEASE_SECONDS,
                        unique_id,
                        gateway_address: self.gateway_address,
                    }),
                    Err(second) if second.is_transport() => {
                        Err(UpnpPinholeCreateError::Uncertain(UpnpUncertainPinhole {
                            internal_endpoint,
                            lease_seconds: RECONCILIATION_LEASE_SECONDS,
                            detail: bounded(
                                "both bounded AddPinhole responses were transport-ambiguous",
                                MAX_ERROR_DETAIL_BYTES,
                            ),
                        }))
                    }
                    Err(second) => Err(UpnpPinholeCreateError::Failed(second)),
                }
            }
            Err(error) => Err(UpnpPinholeCreateError::Failed(error)),
        }
    }

    pub async fn renew_pinhole(
        &self,
        pinhole: &mut UpnpPinhole,
        cancellation: &CancellationToken,
    ) -> Result<(), UpnpError> {
        validate_pinhole_owner(self, pinhole, UpnpStage::PinholeRenewal)?;
        let unique_id = pinhole.unique_id.to_string();
        let lease = REQUESTED_LEASE_SECONDS.to_string();
        self.soap(
            UpnpStage::PinholeRenewal,
            "UpdatePinhole",
            &[("UniqueID", &unique_id), ("NewLeaseTime", &lease)],
            cancellation,
        )
        .await?;
        pinhole.lease_seconds = REQUESTED_LEASE_SECONDS;
        Ok(())
    }

    pub async fn delete_pinhole(
        &self,
        pinhole: &UpnpPinhole,
        cancellation: &CancellationToken,
    ) -> Result<(), UpnpError> {
        validate_pinhole_owner(self, pinhole, UpnpStage::PinholeDelete)?;
        let unique_id = pinhole.unique_id.to_string();
        self.soap(
            UpnpStage::PinholeDelete,
            "DeletePinhole",
            &[("UniqueID", &unique_id)],
            cancellation,
        )
        .await?;
        Ok(())
    }

    pub async fn check_pinhole_working(
        &self,
        pinhole: &UpnpPinhole,
        cancellation: &CancellationToken,
    ) -> Result<bool, UpnpError> {
        validate_pinhole_owner(self, pinhole, UpnpStage::PinholeVerify)?;
        let unique_id = pinhole.unique_id.to_string();
        let leaves = self
            .soap(
                UpnpStage::PinholeVerify,
                "CheckPinholeWorking",
                &[("UniqueID", &unique_id)],
                cancellation,
            )
            .await?;
        parse_upnp_boolean(
            unique_leaf(&leaves, "IsWorking", UpnpStage::PinholeVerify)?,
            UpnpStage::PinholeVerify,
        )
    }

    pub async fn pinhole_packets(
        &self,
        pinhole: &UpnpPinhole,
        cancellation: &CancellationToken,
    ) -> Result<u32, UpnpError> {
        validate_pinhole_owner(self, pinhole, UpnpStage::PinholePackets)?;
        let unique_id = pinhole.unique_id.to_string();
        let leaves = self
            .soap(
                UpnpStage::PinholePackets,
                "GetPinholePackets",
                &[("UniqueID", &unique_id)],
                cancellation,
            )
            .await?;
        unique_leaf(&leaves, "PinholePackets", UpnpStage::PinholePackets)?
            .parse::<u32>()
            .map_err(|_| {
                UpnpError::new(
                    UpnpStage::PinholePackets,
                    "gateway returned an invalid pinhole packet count",
                )
            })
    }

    async fn add_pinhole(
        &self,
        internal_endpoint: SocketAddrV6,
        lease_seconds: u32,
        cancellation: &CancellationToken,
    ) -> Result<u16, UpnpError> {
        let internal_client = internal_endpoint.ip().to_string();
        let internal_port = internal_endpoint.port().to_string();
        let lease = lease_seconds.to_string();
        let leaves = self
            .soap(
                UpnpStage::PinholeAdd,
                "AddPinhole",
                &[
                    ("RemoteHost", ""),
                    ("RemotePort", "0"),
                    ("InternalClient", &internal_client),
                    ("InternalPort", &internal_port),
                    ("Protocol", "6"),
                    ("LeaseTime", &lease),
                ],
                cancellation,
            )
            .await?;
        unique_leaf(&leaves, "UniqueID", UpnpStage::PinholeAdd)?
            .parse::<u16>()
            .map_err(|_| {
                UpnpError::new(
                    UpnpStage::PinholeAdd,
                    "gateway returned an invalid pinhole unique ID",
                )
            })
    }

    async fn soap(
        &self,
        stage: UpnpStage,
        action: &str,
        arguments: &[(&str, &str)],
        cancellation: &CancellationToken,
    ) -> Result<Vec<XmlLeaf>, UpnpError> {
        soap(
            &self.client,
            &self.control_url,
            &self.service_type,
            stage,
            action,
            arguments,
            cancellation,
        )
        .await
    }

    pub fn gateway_address(&self) -> Ipv4Addr {
        self.gateway_address
    }

    pub fn control_local_address(&self) -> Ipv4Addr {
        self.local_address
    }
}

async fn soap(
    client: &Client,
    control_url: &Url,
    service_type: &str,
    stage: UpnpStage,
    action: &str,
    arguments: &[(&str, &str)],
    cancellation: &CancellationToken,
) -> Result<Vec<XmlLeaf>, UpnpError> {
    let body = soap_request(service_type, action, arguments);
    let soap_action = format!("\"{service_type}#{action}\"");
    let request = client
        .post(control_url.clone())
        .header("connection", "close")
        .header(CONTENT_TYPE, "text/xml; charset=\"utf-8\"")
        .header("soapaction", soap_action)
        .body(body);
    let response = cancellable(cancellation, request.send(), stage).await?;
    let status = response.status();
    validate_xml_content_type(response.headers(), stage)?;
    let body = read_bounded_body(response, stage, cancellation).await?;
    let leaves = parse_xml_leaves(&body, stage)?;
    if let Some((code, description)) = parse_soap_fault(&leaves, stage)? {
        return Err(UpnpError::fault(stage, code, &description));
    }
    if !status.is_success() {
        return Err(UpnpError::new(
            stage,
            "gateway returned an HTTP error without a SOAP fault",
        ));
    }
    Ok(leaves)
}

pub async fn discover_igd_v2(
    config: UpnpDiscoveryConfig,
    cancellation: &CancellationToken,
) -> Result<UpnpGateway, UpnpError> {
    let candidates = discover_locations(&config, cancellation).await?;
    let client = Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(config.http_timeout)
        .timeout(config.http_timeout)
        .local_address(IpAddr::V4(config.local_address))
        .build()
        .map_err(|_| UpnpError::new(UpnpStage::Description, "build bounded HTTP client"))?;
    let mut last_error = None;
    for candidate in candidates {
        match describe_gateway(&config, &client, candidate, cancellation).await {
            Ok(gateway) => return Ok(gateway),
            Err(error) => last_error = Some(error),
        }
    }
    Err(last_error.unwrap_or_else(|| {
        UpnpError::new(
            UpnpStage::Discovery,
            "no bounded IGD v2 device response was usable",
        )
    }))
}

/// Discovers one root device and independently resolves its IPv4 mapping and
/// IPv6 firewall-control services.
///
/// A missing or malformed optional sibling does not discard a usable service.
pub async fn discover_igd_v2_services(
    config: UpnpDiscoveryConfig,
    cancellation: &CancellationToken,
) -> Result<UpnpIgdV2Services, UpnpError> {
    let candidates = discover_locations(&config, cancellation).await?;
    let client = Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(config.http_timeout)
        .timeout(config.http_timeout)
        .local_address(IpAddr::V4(config.local_address))
        .build()
        .map_err(|_| UpnpError::new(UpnpStage::Description, "build bounded HTTP client"))?;
    let mut fallback = None;
    let mut last_error = None;
    for candidate in candidates {
        match describe_gateway_services(&config, &client, candidate, cancellation).await {
            Ok(services)
                if matches!(&services.ipv4_mapping, UpnpDiscoveredService::Available(_))
                    || matches!(&services.ipv6_firewall, UpnpDiscoveredService::Available(_)) =>
            {
                return Ok(services);
            }
            Ok(services) => {
                fallback.get_or_insert(services);
            }
            Err(error) => last_error = Some(error),
        }
    }
    fallback.ok_or_else(|| {
        last_error.unwrap_or_else(|| {
            UpnpError::new(
                UpnpStage::Discovery,
                "no bounded IGD v2 device response was usable",
            )
        })
    })
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
struct DeviceLocation {
    source: Ipv4Addr,
    url: Url,
}

async fn discover_locations(
    config: &UpnpDiscoveryConfig,
    cancellation: &CancellationToken,
) -> Result<Vec<DeviceLocation>, UpnpError> {
    let socket = UdpSocket::bind(SocketAddrV4::new(config.local_address, 0))
        .await
        .map_err(|_| UpnpError::new(UpnpStage::Discovery, "bind SSDP discovery socket"))?;
    let request = ssdp_search_request(config.discovery_endpoint);
    let overall = Instant::now() + config.overall_deadline;
    let mut found = BTreeSet::new();
    let mut buffer = vec![0_u8; MAX_SSDP_DATAGRAM_BYTES + 1];
    for _ in 0..config.attempts {
        tokio::select! {
            _ = cancellation.cancelled() => {
                return Err(UpnpError::new(UpnpStage::Discovery, "UPnP discovery cancelled"));
            }
            result = socket.send_to(&request, config.discovery_endpoint) => {
                result.map_err(|_| {
                    UpnpError::new(UpnpStage::Discovery, "send SSDP discovery request")
                })?;
            }
        }
        let round = (Instant::now() + config.response_window).min(overall);
        loop {
            let receive = timeout_at(round, socket.recv_from(&mut buffer));
            let received = tokio::select! {
                _ = cancellation.cancelled() => {
                    return Err(UpnpError::new(UpnpStage::Discovery, "UPnP discovery cancelled"));
                }
                result = receive => result,
            };
            let Ok(result) = received else {
                break;
            };
            let (length, source) = result
                .map_err(|_| UpnpError::new(UpnpStage::Discovery, "receive SSDP response"))?;
            if length > MAX_SSDP_DATAGRAM_BYTES {
                continue;
            }
            let SocketAddr::V4(source) = source else {
                continue;
            };
            if let Ok(location) = parse_ssdp_response(
                &buffer[..length],
                *source.ip(),
                config.allow_loopback_gateway,
            ) {
                found.insert(location);
                if found.len() >= MAX_DEVICE_LOCATIONS {
                    return Ok(found.into_iter().collect());
                }
            }
        }
        if Instant::now() >= overall {
            break;
        }
    }
    if found.is_empty() {
        Err(UpnpError::new(
            UpnpStage::Discovery,
            "no IGD v2 device answered bounded SSDP discovery",
        ))
    } else {
        Ok(found.into_iter().collect())
    }
}

fn ssdp_search_request(endpoint: SocketAddrV4) -> Vec<u8> {
    format!(
        "M-SEARCH * HTTP/1.1\r\nHOST: {endpoint}\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: upnp:rootdevice\r\n\r\n"
    )
    .into_bytes()
}

fn parse_ssdp_response(
    bytes: &[u8],
    source: Ipv4Addr,
    allow_loopback: bool,
) -> Result<DeviceLocation, UpnpError> {
    let text = std::str::from_utf8(bytes)
        .map_err(|_| UpnpError::new(UpnpStage::Discovery, "SSDP response is not UTF-8"))?;
    let mut lines = text.split("\r\n");
    let status = lines.next().unwrap_or_default();
    if !status.starts_with("HTTP/1.1 200") && !status.starts_with("HTTP/1.0 200") {
        return Err(UpnpError::new(
            UpnpStage::Discovery,
            "SSDP response status is not successful",
        ));
    }
    let mut headers = 0_usize;
    let mut location = None;
    for line in lines {
        if line.is_empty() {
            break;
        }
        headers += 1;
        if headers > MAX_SSDP_HEADERS {
            return Err(UpnpError::new(
                UpnpStage::Discovery,
                "SSDP response exceeds the header bound",
            ));
        }
        let Some((name, value)) = line.split_once(':') else {
            return Err(UpnpError::new(
                UpnpStage::Discovery,
                "SSDP response contains a malformed header",
            ));
        };
        if name.eq_ignore_ascii_case("location") && location.replace(value.trim()).is_some() {
            return Err(UpnpError::new(
                UpnpStage::Discovery,
                "SSDP response contains duplicate locations",
            ));
        }
    }
    let url = validate_gateway_url(
        location.ok_or_else(|| {
            UpnpError::new(UpnpStage::Discovery, "SSDP response omitted its location")
        })?,
        source,
        allow_loopback,
        UpnpStage::Discovery,
    )?;
    Ok(DeviceLocation { source, url })
}

async fn describe_gateway(
    config: &UpnpDiscoveryConfig,
    client: &Client,
    candidate: DeviceLocation,
    cancellation: &CancellationToken,
) -> Result<UpnpGateway, UpnpError> {
    let description = http_get_xml(client, candidate.url.clone(), cancellation).await?;
    let leaves = parse_xml_leaves(&description, UpnpStage::Description)?;
    let base = optional_unique_leaf(&leaves, "URLBase", UpnpStage::Description)?
        .map(|value| {
            validate_gateway_url(
                value,
                candidate.source,
                config.allow_loopback_gateway,
                UpnpStage::Description,
            )
        })
        .transpose()?
        .unwrap_or_else(|| candidate.url.clone());
    let service = select_wan_ip_service(&leaves)?;
    let control_url = resolve_gateway_url(
        &base,
        &service.control_url,
        candidate.source,
        config.allow_loopback_gateway,
    )?;
    let scpd_url = resolve_gateway_url(
        &base,
        &service.scpd_url,
        candidate.source,
        config.allow_loopback_gateway,
    )?;
    let scpd = http_get_xml(client, scpd_url, cancellation).await?;
    let scpd_leaves = parse_xml_leaves(&scpd, UpnpStage::Description)?;
    require_actions(&scpd_leaves)?;
    Ok(UpnpGateway {
        local_address: config.local_address,
        gateway_address: candidate.source,
        control_url,
        service_type: WAN_IP_CONNECTION_V2.to_owned(),
        client: client.clone(),
    })
}

async fn describe_gateway_services(
    config: &UpnpDiscoveryConfig,
    client: &Client,
    candidate: DeviceLocation,
    cancellation: &CancellationToken,
) -> Result<UpnpIgdV2Services, UpnpError> {
    let description = http_get_xml(client, candidate.url.clone(), cancellation).await?;
    let leaves = parse_xml_leaves(&description, UpnpStage::Description)?;
    let base = optional_unique_leaf(&leaves, "URLBase", UpnpStage::Description)?
        .map(|value| {
            validate_gateway_url(
                value,
                candidate.source,
                config.allow_loopback_gateway,
                UpnpStage::Description,
            )
        })
        .transpose()?
        .unwrap_or_else(|| candidate.url.clone());
    let ipv4 = select_service(&leaves, WAN_IP_CONNECTION_V2, "WAN IP v2")?;
    let ipv6 = select_service(
        &leaves,
        WAN_IPV6_FIREWALL_CONTROL_V1,
        "WAN IPv6 firewall-control v1",
    )?;

    let ipv4_mapping = match ipv4 {
        None => UpnpDiscoveredService::Absent,
        Some(service) => match load_service(
            config,
            client,
            candidate.source,
            &base,
            &service,
            &[
                "GetExternalIPAddress",
                "GetSpecificPortMappingEntry",
                "AddPortMapping",
                "DeletePortMapping",
            ],
            "WAN IP",
            cancellation,
        )
        .await
        {
            Ok(control_url) => UpnpDiscoveredService::Available(UpnpGateway {
                local_address: config.local_address,
                gateway_address: candidate.source,
                control_url,
                service_type: WAN_IP_CONNECTION_V2.to_owned(),
                client: client.clone(),
            }),
            Err(error) => UpnpDiscoveredService::Unavailable(error),
        },
    };
    let ipv6_firewall = match ipv6 {
        None => UpnpDiscoveredService::Absent,
        Some(service) => match load_service(
            config,
            client,
            candidate.source,
            &base,
            &service,
            &[
                "GetFirewallStatus",
                "AddPinhole",
                "UpdatePinhole",
                "DeletePinhole",
                "GetPinholePackets",
            ],
            "WAN IPv6 firewall-control",
            cancellation,
        )
        .await
        {
            Ok(control_url) => UpnpDiscoveredService::Available(UpnpIpv6Firewall {
                local_address: config.local_address,
                gateway_address: candidate.source,
                control_url,
                service_type: WAN_IPV6_FIREWALL_CONTROL_V1.to_owned(),
                client: client.clone(),
            }),
            Err(error) => UpnpDiscoveredService::Unavailable(error),
        },
    };
    Ok(UpnpIgdV2Services {
        ipv4_mapping,
        ipv6_firewall,
    })
}

#[allow(clippy::too_many_arguments)]
async fn load_service(
    config: &UpnpDiscoveryConfig,
    client: &Client,
    source: Ipv4Addr,
    base: &Url,
    service: &SelectedService,
    required_actions: &[&str],
    label: &str,
    cancellation: &CancellationToken,
) -> Result<Url, UpnpError> {
    let control_url = resolve_gateway_url(
        base,
        &service.control_url,
        source,
        config.allow_loopback_gateway,
    )?;
    let scpd_url = resolve_gateway_url(
        base,
        &service.scpd_url,
        source,
        config.allow_loopback_gateway,
    )?;
    let scpd = http_get_xml(client, scpd_url, cancellation).await?;
    let leaves = parse_xml_leaves(&scpd, UpnpStage::Description)?;
    require_service_actions(&leaves, required_actions, label)?;
    Ok(control_url)
}

async fn http_get_xml(
    client: &Client,
    url: Url,
    cancellation: &CancellationToken,
) -> Result<Vec<u8>, UpnpError> {
    let response = cancellable(
        cancellation,
        client
            .get(url)
            .header("connection", "close")
            .header("accept", "text/xml, application/xml")
            .send(),
        UpnpStage::Description,
    )
    .await?;
    if !response.status().is_success() {
        return Err(UpnpError::new(
            UpnpStage::Description,
            "gateway description returned an HTTP error",
        ));
    }
    validate_xml_content_type(response.headers(), UpnpStage::Description)?;
    read_bounded_body(response, UpnpStage::Description, cancellation).await
}

async fn read_bounded_body(
    mut response: reqwest::Response,
    stage: UpnpStage,
    cancellation: &CancellationToken,
) -> Result<Vec<u8>, UpnpError> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_HTTP_BODY_BYTES as u64)
    {
        return Err(UpnpError::new(stage, "gateway HTTP body exceeds its bound"));
    }
    let mut body = Vec::new();
    loop {
        let chunk = cancellable(cancellation, response.chunk(), stage).await?;
        let Some(chunk) = chunk else {
            break;
        };
        if body.len().saturating_add(chunk.len()) > MAX_HTTP_BODY_BYTES {
            return Err(UpnpError::new(stage, "gateway HTTP body exceeds its bound"));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn validate_xml_content_type(headers: &HeaderMap, stage: UpnpStage) -> Result<(), UpnpError> {
    let value = headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let media = value.split(';').next().unwrap_or_default().trim();
    if matches!(media, "text/xml" | "application/xml") {
        Ok(())
    } else {
        Err(UpnpError::new(stage, "gateway response is not XML"))
    }
}

async fn cancellable<F, T>(
    cancellation: &CancellationToken,
    future: F,
    stage: UpnpStage,
) -> Result<T, UpnpError>
where
    F: Future<Output = Result<T, reqwest::Error>>,
{
    tokio::select! {
        _ = cancellation.cancelled() => Err(UpnpError::new(stage, "UPnP operation cancelled")),
        result = future => result.map_err(|error| sanitize_transport_error(error, stage)),
    }
}

fn sanitize_transport_error(error: reqwest::Error, stage: UpnpStage) -> UpnpError {
    let detail = if error.is_timeout() {
        "gateway HTTP request timed out"
    } else if error.is_redirect() {
        "gateway HTTP redirect was rejected"
    } else {
        "gateway HTTP transport failed"
    };
    let mut error = UpnpError::new(stage, detail);
    error.transport = true;
    error
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct XmlLeaf {
    path: Vec<String>,
    parent_id: Option<u64>,
    value: String,
}

#[derive(Debug)]
struct XmlElement {
    id: u64,
    name: String,
    text: String,
    has_child: bool,
}

fn parse_xml_leaves(bytes: &[u8], stage: UpnpStage) -> Result<Vec<XmlLeaf>, UpnpError> {
    let mut reader = Reader::from_reader(bytes);
    reader.config_mut().trim_text(true);
    reader.config_mut().check_comments = true;
    let mut stack = Vec::<XmlElement>::new();
    let mut leaves = Vec::new();
    let mut events = 0_usize;
    let mut next_element_id = 1_u64;
    loop {
        events += 1;
        if events > MAX_XML_EVENTS {
            return Err(UpnpError::new(stage, "XML exceeds the event bound"));
        }
        match reader.read_event() {
            Ok(Event::Start(start)) => {
                if stack.len() >= MAX_XML_DEPTH {
                    return Err(UpnpError::new(stage, "XML exceeds the nesting bound"));
                }
                if let Some(parent) = stack.last_mut() {
                    parent.has_child = true;
                }
                stack.push(XmlElement {
                    id: next_element_id,
                    name: xml_local_name(start.name().as_ref(), stage)?,
                    text: String::new(),
                    has_child: false,
                });
                next_element_id = next_element_id
                    .checked_add(1)
                    .ok_or_else(|| UpnpError::new(stage, "XML element identity overflow"))?;
            }
            Ok(Event::Empty(empty)) => {
                if stack.len() >= MAX_XML_DEPTH {
                    return Err(UpnpError::new(stage, "XML exceeds the nesting bound"));
                }
                if let Some(parent) = stack.last_mut() {
                    parent.has_child = true;
                }
                let _ = xml_local_name(empty.name().as_ref(), stage)?;
            }
            Ok(Event::Text(text)) => {
                if let Some(element) = stack.last_mut() {
                    append_xml_text(
                        element,
                        &text
                            .decode()
                            .map_err(|_| UpnpError::new(stage, "XML text encoding is invalid"))?,
                        stage,
                    )?;
                }
            }
            Ok(Event::CData(text)) => {
                if let Some(element) = stack.last_mut() {
                    append_xml_text(
                        element,
                        &text
                            .decode()
                            .map_err(|_| UpnpError::new(stage, "XML CDATA encoding is invalid"))?,
                        stage,
                    )?;
                }
            }
            Ok(Event::GeneralRef(reference)) => {
                if let Some(element) = stack.last_mut() {
                    let value = if let Some(character) = reference
                        .resolve_char_ref()
                        .map_err(|_| UpnpError::new(stage, "XML character reference is invalid"))?
                    {
                        character.to_string()
                    } else {
                        match reference
                            .decode()
                            .map_err(|_| UpnpError::new(stage, "XML entity reference is invalid"))?
                            .as_ref()
                        {
                            "amp" => "&".to_owned(),
                            "lt" => "<".to_owned(),
                            "gt" => ">".to_owned(),
                            "apos" => "'".to_owned(),
                            "quot" => "\"".to_owned(),
                            _ => {
                                return Err(UpnpError::new(
                                    stage,
                                    "XML contains an unsupported entity reference",
                                ));
                            }
                        }
                    };
                    append_xml_text(element, &value, stage)?;
                }
            }
            Ok(Event::End(_)) => {
                let Some(element) = stack.pop() else {
                    return Err(UpnpError::new(stage, "XML closes an unopened element"));
                };
                let value = element.text.trim();
                if !element.has_child && !value.is_empty() {
                    let mut path = stack
                        .iter()
                        .map(|element| element.name.clone())
                        .collect::<Vec<_>>();
                    path.push(element.name);
                    leaves.push(XmlLeaf {
                        path,
                        parent_id: stack.last().map(|element| element.id),
                        value: value.to_owned(),
                    });
                }
            }
            Ok(Event::Eof) => break,
            Ok(Event::Decl(_) | Event::PI(_) | Event::DocType(_) | Event::Comment(_)) => {}
            Err(_) => return Err(UpnpError::new(stage, "gateway XML is malformed")),
        }
    }
    if !stack.is_empty() {
        return Err(UpnpError::new(stage, "gateway XML is truncated"));
    }
    Ok(leaves)
}

fn append_xml_text(
    element: &mut XmlElement,
    text: &str,
    stage: UpnpStage,
) -> Result<(), UpnpError> {
    if element.text.len().saturating_add(text.len()) > MAX_XML_TEXT_BYTES {
        return Err(UpnpError::new(stage, "XML text exceeds its bound"));
    }
    element.text.push_str(text);
    Ok(())
}

fn xml_local_name(bytes: &[u8], stage: UpnpStage) -> Result<String, UpnpError> {
    let bytes = bytes.rsplit(|byte| *byte == b':').next().unwrap_or(bytes);
    if bytes.is_empty() || bytes.len() > 128 {
        return Err(UpnpError::new(stage, "XML element name is invalid"));
    }
    std::str::from_utf8(bytes)
        .map(str::to_owned)
        .map_err(|_| UpnpError::new(stage, "XML element name is not UTF-8"))
}

#[derive(Default)]
struct ServiceParts {
    service_type: Option<String>,
    control_url: Option<String>,
    scpd_url: Option<String>,
}

struct SelectedService {
    control_url: String,
    scpd_url: String,
}

fn select_wan_ip_service(leaves: &[XmlLeaf]) -> Result<SelectedService, UpnpError> {
    select_service(leaves, WAN_IP_CONNECTION_V2, "WAN IP v2")?.ok_or_else(|| {
        UpnpError::new(
            UpnpStage::Description,
            "device does not advertise WANIPConnection:2",
        )
    })
}

fn select_service(
    leaves: &[XmlLeaf],
    service_type: &str,
    label: &str,
) -> Result<Option<SelectedService>, UpnpError> {
    let mut services = BTreeMap::<u64, ServiceParts>::new();
    for leaf in leaves {
        let Some(last) = leaf.path.last() else {
            continue;
        };
        if !matches!(last.as_str(), "serviceType" | "controlURL" | "SCPDURL")
            || leaf.path.len() < 2
            || leaf.path[leaf.path.len() - 2] != "service"
        {
            continue;
        }
        let key = leaf.parent_id.ok_or_else(|| {
            UpnpError::new(
                UpnpStage::Description,
                "service value has no enclosing service",
            )
        })?;
        if !services.contains_key(&key) && services.len() >= MAX_SERVICE_CANDIDATES {
            return Err(UpnpError::new(
                UpnpStage::Description,
                "device description exceeds the service bound",
            ));
        }
        let parts = services.entry(key).or_default();
        let slot = match last.as_str() {
            "serviceType" => &mut parts.service_type,
            "controlURL" => &mut parts.control_url,
            "SCPDURL" => &mut parts.scpd_url,
            _ => unreachable!(),
        };
        if slot.replace(leaf.value.clone()).is_some() {
            return Err(UpnpError::new(
                UpnpStage::Description,
                "device description duplicates a critical service value",
            ));
        }
    }
    let mut selected = None;
    for parts in services.into_values() {
        if parts.service_type.as_deref() != Some(service_type) {
            continue;
        }
        let service = SelectedService {
            control_url: parts.control_url.ok_or_else(|| {
                UpnpError::new(
                    UpnpStage::Description,
                    format!("{label} service omitted controlURL"),
                )
            })?,
            scpd_url: parts.scpd_url.ok_or_else(|| {
                UpnpError::new(
                    UpnpStage::Description,
                    format!("{label} service omitted SCPDURL"),
                )
            })?,
        };
        if selected.replace(service).is_some() {
            return Err(UpnpError::new(
                UpnpStage::Description,
                format!("device description contains duplicate {label} services"),
            ));
        }
    }
    Ok(selected)
}

fn require_actions(leaves: &[XmlLeaf]) -> Result<(), UpnpError> {
    require_service_actions(
        leaves,
        &[
            "GetExternalIPAddress",
            "GetSpecificPortMappingEntry",
            "AddPortMapping",
            "DeletePortMapping",
        ],
        "WAN IP",
    )
}

fn require_service_actions(
    leaves: &[XmlLeaf],
    required_actions: &[&str],
    label: &str,
) -> Result<(), UpnpError> {
    let actions = leaves
        .iter()
        .filter(|leaf| path_ends_with(&leaf.path, &["action", "name"]))
        .map(|leaf| leaf.value.as_str())
        .collect::<BTreeSet<_>>();
    for required in required_actions {
        if !actions.contains(required) {
            return Err(UpnpError::new(
                UpnpStage::Description,
                format!("{label} service omits required action {required}"),
            ));
        }
    }
    Ok(())
}

fn soap_request(service_type: &str, action: &str, arguments: &[(&str, &str)]) -> String {
    let mut body = format!(
        "<?xml version=\"1.0\"?>\r\n<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:{action} xmlns:u=\"{service_type}\">"
    );
    for (name, value) in arguments {
        body.push('<');
        body.push_str(name);
        body.push('>');
        body.push_str(value);
        body.push_str("</");
        body.push_str(name);
        body.push('>');
    }
    body.push_str("</u:");
    body.push_str(action);
    body.push_str("></s:Body></s:Envelope>");
    body
}

fn parse_soap_fault(
    leaves: &[XmlLeaf],
    stage: UpnpStage,
) -> Result<Option<(u16, String)>, UpnpError> {
    let Some(code) = optional_unique_leaf(leaves, "errorCode", stage)? else {
        return Ok(None);
    };
    let code = code
        .parse::<u16>()
        .map_err(|_| UpnpError::new(stage, "SOAP fault code is invalid"))?;
    let description = optional_unique_leaf(leaves, "errorDescription", stage)?
        .unwrap_or("unspecified gateway error");
    Ok(Some((code, bounded(description, MAX_ERROR_DETAIL_BYTES))))
}

fn unique_leaf<'a>(
    leaves: &'a [XmlLeaf],
    name: &str,
    stage: UpnpStage,
) -> Result<&'a str, UpnpError> {
    optional_unique_leaf(leaves, name, stage)?
        .ok_or_else(|| UpnpError::new(stage, format!("gateway response omitted {name}")))
}

fn optional_unique_leaf<'a>(
    leaves: &'a [XmlLeaf],
    name: &str,
    stage: UpnpStage,
) -> Result<Option<&'a str>, UpnpError> {
    let mut found = None;
    for leaf in leaves
        .iter()
        .filter(|leaf| leaf.path.last().is_some_and(|candidate| candidate == name))
    {
        if found.replace(leaf.value.as_str()).is_some() {
            return Err(UpnpError::new(
                stage,
                format!("gateway response duplicates {name}"),
            ));
        }
    }
    Ok(found)
}

fn path_ends_with(path: &[String], suffix: &[&str]) -> bool {
    path.len() >= suffix.len()
        && path[path.len() - suffix.len()..]
            .iter()
            .zip(suffix)
            .all(|(left, right)| left == right)
}

fn validate_gateway_url(
    value: &str,
    source: Ipv4Addr,
    allow_loopback: bool,
    stage: UpnpStage,
) -> Result<Url, UpnpError> {
    if value.len() > MAX_URL_BYTES {
        return Err(UpnpError::new(stage, "gateway URL exceeds its bound"));
    }
    let url = Url::parse(value).map_err(|_| UpnpError::new(stage, "gateway URL is invalid"))?;
    validate_resolved_gateway_url(&url, source, allow_loopback, stage)?;
    Ok(url)
}

fn resolve_gateway_url(
    base: &Url,
    value: &str,
    source: Ipv4Addr,
    allow_loopback: bool,
) -> Result<Url, UpnpError> {
    if value.len() > MAX_URL_BYTES {
        return Err(UpnpError::new(
            UpnpStage::Description,
            "service URL exceeds its bound",
        ));
    }
    let url = base
        .join(value)
        .map_err(|_| UpnpError::new(UpnpStage::Description, "service URL is invalid"))?;
    validate_resolved_gateway_url(&url, source, allow_loopback, UpnpStage::Description)?;
    Ok(url)
}

fn validate_resolved_gateway_url(
    url: &Url,
    source: Ipv4Addr,
    allow_loopback: bool,
    stage: UpnpStage,
) -> Result<(), UpnpError> {
    if url.as_str().len() > MAX_URL_BYTES
        || url.scheme() != "http"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || url.port_or_known_default().is_none_or(|port| port == 0)
    {
        return Err(UpnpError::new(
            stage,
            "gateway URL violates HTTP safety policy",
        ));
    }
    let Some(url::Host::Ipv4(host)) = url.host() else {
        return Err(UpnpError::new(
            stage,
            "gateway URL host must be an IPv4 literal",
        ));
    };
    if host != source {
        return Err(UpnpError::new(
            stage,
            "gateway URL host differs from the SSDP response source",
        ));
    }
    if !eligible_gateway_address(host, allow_loopback) {
        return Err(UpnpError::new(
            stage,
            "gateway URL host is outside the local IPv4 scope",
        ));
    }
    Ok(())
}

fn eligible_local_address(address: Ipv4Addr) -> bool {
    !address.is_unspecified()
        && !address.is_loopback()
        && !address.is_multicast()
        && address != Ipv4Addr::BROADCAST
}

fn eligible_gateway_address(address: Ipv4Addr, allow_loopback: bool) -> bool {
    (allow_loopback && address.is_loopback()) || is_private_or_link_local(address)
}

fn eligible_external_address(address: Ipv4Addr) -> bool {
    !address.is_unspecified()
        && !address.is_loopback()
        && !address.is_multicast()
        && address != Ipv4Addr::BROADCAST
        && !is_private_or_link_local(address)
}

fn validate_pinhole_endpoint(endpoint: SocketAddrV6) -> Result<(), UpnpError> {
    if endpoint.port() < 1_024 || !crate::session_socket::eligible_global_ipv6(*endpoint.ip()) {
        return Err(UpnpError::new(
            UpnpStage::PinholeAdd,
            "pinhole requires an eligible global-unicast IPv6 listener port at or above 1024",
        ));
    }
    Ok(())
}

fn validate_pinhole_owner(
    gateway: &UpnpIpv6Firewall,
    pinhole: &UpnpPinhole,
    stage: UpnpStage,
) -> Result<(), UpnpError> {
    if pinhole.gateway_address != gateway.gateway_address
        || pinhole.lease_seconds == 0
        || pinhole.lease_seconds > 86_400
        || pinhole.internal_endpoint.port() < 1_024
        || !crate::session_socket::eligible_global_ipv6(*pinhole.internal_endpoint.ip())
    {
        return Err(UpnpError::new(
            stage,
            "pinhole belongs to another gateway or has invalid finite state",
        ));
    }
    Ok(())
}

fn parse_upnp_boolean(value: &str, stage: UpnpStage) -> Result<bool, UpnpError> {
    if value == "1" || value.eq_ignore_ascii_case("true") || value.eq_ignore_ascii_case("yes") {
        Ok(true)
    } else if value == "0"
        || value.eq_ignore_ascii_case("false")
        || value.eq_ignore_ascii_case("no")
    {
        Ok(false)
    } else {
        Err(UpnpError::new(
            stage,
            "gateway returned an invalid UPnP boolean",
        ))
    }
}

fn is_private_or_link_local(address: Ipv4Addr) -> bool {
    let [a, b, _, _] = address.octets();
    a == 10
        || (a == 172 && (16..=31).contains(&b))
        || (a == 192 && b == 168)
        || (a == 169 && b == 254)
        || (a == 100 && (64..=127).contains(&b))
}

fn mapping_candidates(local_port: u16) -> Result<Vec<u16>, UpnpError> {
    let mut random = [0_u8; (MAX_MAPPING_CANDIDATES - 1) * 2];
    getrandom::fill(&mut random)
        .map_err(|_| UpnpError::new(UpnpStage::Add, "generate external-port candidates"))?;
    let mut candidates = Vec::with_capacity(MAX_MAPPING_CANDIDATES);
    if (HIGH_PORT_START..HIGH_PORT_START + HIGH_PORT_COUNT).contains(&local_port) {
        candidates.push(local_port);
    }
    for bytes in random.chunks_exact(2) {
        let candidate =
            HIGH_PORT_START + (u16::from_be_bytes([bytes[0], bytes[1]]) % HIGH_PORT_COUNT);
        if !candidates.contains(&candidate) {
            candidates.push(candidate);
        }
        if candidates.len() == MAX_MAPPING_CANDIDATES {
            break;
        }
    }
    let mut candidate = HIGH_PORT_START;
    while candidates.len() < MAX_MAPPING_CANDIDATES {
        if !candidates.contains(&candidate) {
            candidates.push(candidate);
        }
        candidate += 1;
    }
    Ok(candidates)
}

fn mapping_entry_matches(entry: &UpnpMappingEntry, address: Ipv4Addr, port: u16) -> bool {
    entry.internal_client == address
        && entry.internal_port == port
        && entry.enabled
        && entry.description == MAPPING_DESCRIPTION
        && entry.lease_seconds > 0
}

fn verify_mapping_entry(
    entry: &UpnpMappingEntry,
    address: Ipv4Addr,
    port: u16,
    transport: UpnpTransport,
    stage: UpnpStage,
) -> Result<(), UpnpError> {
    if !mapping_entry_matches(entry, address, port) {
        return Err(UpnpError::new(
            stage,
            format!(
                "installed mapping does not match the requested finite {} entry",
                transport.as_str()
            ),
        ));
    }
    Ok(())
}

fn parse_u16(value: &str, stage: UpnpStage, detail: &str) -> Result<u16, UpnpError> {
    let value = value
        .parse::<u16>()
        .map_err(|_| UpnpError::new(stage, detail))?;
    if value == 0 {
        Err(UpnpError::new(stage, detail))
    } else {
        Ok(value)
    }
}

fn bounded(value: &str, maximum_bytes: usize) -> String {
    if value.len() <= maximum_bytes {
        return value.to_owned();
    }
    let mut boundary = maximum_bytes;
    while !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    value[..boundary].to_owned()
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[test]
    fn ssdp_request_and_response_are_closed_and_source_bound() {
        let request = String::from_utf8(ssdp_search_request(SSDP_MULTICAST_ENDPOINT)).unwrap();
        assert!(request.starts_with("M-SEARCH * HTTP/1.1\r\n"));
        assert!(request.contains("ST: upnp:rootdevice\r\n"));
        assert!(request.ends_with("\r\n\r\n"));

        let source = Ipv4Addr::new(192, 168, 1, 1);
        let response = b"HTTP/1.1 200 OK\r\nLOCATION: http://192.168.1.1:5000/root.xml\r\nUSN: uuid:test::upnp:rootdevice\r\n\r\n";
        let parsed = parse_ssdp_response(response, source, false).unwrap();
        assert_eq!(parsed.source, source);
        assert_eq!(parsed.url.path(), "/root.xml");
        assert!(parse_ssdp_response(response, Ipv4Addr::new(192, 168, 1, 2), false).is_err());
        assert!(
            parse_ssdp_response(
                b"HTTP/1.1 200 OK\r\nLOCATION: https://192.168.1.1/root.xml\r\n\r\n",
                source,
                false,
            )
            .is_err()
        );
    }

    #[test]
    fn device_and_service_documents_select_only_complete_v2_service() {
        let description = br#"<?xml version="1.0"?>
          <root><URLBase>http://192.168.1.1:5000/base/</URLBase><device><serviceList>
          <service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType>
          <controlURL>/old</controlURL><SCPDURL>/old.xml</SCPDURL></service>
          <service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:2</serviceType>
          <controlURL>control</controlURL><SCPDURL>wan.xml</SCPDURL></service>
          </serviceList></device></root>"#;
        let leaves = parse_xml_leaves(description, UpnpStage::Description).unwrap();
        let service = select_wan_ip_service(&leaves).unwrap();
        assert_eq!(service.control_url, "control");
        assert_eq!(service.scpd_url, "wan.xml");
        let actions = br#"<scpd><actionList>
          <action><name>GetExternalIPAddress</name></action>
          <action><name>GetSpecificPortMappingEntry</name></action>
          <action><name>AddPortMapping</name></action>
          <action><name>DeletePortMapping</name></action>
          </actionList></scpd>"#;
        require_actions(&parse_xml_leaves(actions, UpnpStage::Description).unwrap()).unwrap();
    }

    #[test]
    fn xml_and_soap_fault_parsing_enforce_bounds_and_typed_codes() {
        let fault = br#"<s:Envelope><s:Body><s:Fault><detail><UPnPError>
          <errorCode>725</errorCode><errorDescription>OnlyPermanentLeasesSupported</errorDescription>
          </UPnPError></detail></s:Fault></s:Body></s:Envelope>"#;
        let leaves = parse_xml_leaves(fault, UpnpStage::Add).unwrap();
        assert_eq!(
            parse_soap_fault(&leaves, UpnpStage::Add).unwrap(),
            Some((725, "OnlyPermanentLeasesSupported".to_owned()))
        );
        let deep = format!(
            "{}x{}",
            "<a>".repeat(MAX_XML_DEPTH + 1),
            "</a>".repeat(MAX_XML_DEPTH + 1)
        );
        assert!(parse_xml_leaves(deep.as_bytes(), UpnpStage::Description).is_err());
        let long = format!("<a>{}</a>", "x".repeat(MAX_XML_TEXT_BYTES + 1));
        assert!(parse_xml_leaves(long.as_bytes(), UpnpStage::Description).is_err());
    }

    #[test]
    fn mapping_verification_rejects_permanent_or_foreign_entries() {
        let exact = UpnpMappingEntry {
            internal_client: Ipv4Addr::new(192, 168, 1, 20),
            internal_port: 42_000,
            enabled: true,
            description: MAPPING_DESCRIPTION.to_owned(),
            lease_seconds: REQUESTED_LEASE_SECONDS,
        };
        assert!(mapping_entry_matches(
            &exact,
            exact.internal_client,
            exact.internal_port
        ));
        let mut permanent = exact.clone();
        permanent.lease_seconds = 0;
        assert!(!mapping_entry_matches(
            &permanent,
            exact.internal_client,
            exact.internal_port
        ));
        let mut foreign = exact.clone();
        foreign.description = "another client".to_owned();
        assert!(!mapping_entry_matches(
            &foreign,
            exact.internal_client,
            exact.internal_port
        ));
    }

    #[test]
    fn renewal_uses_three_quarters_of_finite_lease() {
        let mapping = UpnpMapping {
            local_endpoint: SocketAddrV4::new(Ipv4Addr::new(192, 168, 1, 20), 42_000),
            external_address: Ipv4Addr::new(203, 0, 113, 10),
            external_port: 48_000,
            lease_seconds: REQUESTED_LEASE_SECONDS,
            transport: UpnpTransport::Tcp,
        };
        assert_eq!(mapping.renewal_delay(), Duration::from_secs(2_700));
    }

    #[test]
    fn mapping_transport_has_exact_upnp_wire_values() {
        assert_eq!(UpnpTransport::Tcp.as_str(), "TCP");
        assert_eq!(UpnpTransport::Udp.as_str(), "UDP");
        for transport in [UpnpTransport::Tcp, UpnpTransport::Udp] {
            let request = soap_request(
                WAN_IP_CONNECTION_V2,
                "GetSpecificPortMappingEntry",
                &[
                    ("NewRemoteHost", ""),
                    ("NewExternalPort", "42000"),
                    ("NewProtocol", transport.as_str()),
                ],
            );
            assert!(request.contains(&format!(
                "<NewProtocol>{}</NewProtocol>",
                transport.as_str()
            )));
        }
    }

    #[test]
    fn url_policy_rejects_dns_credentials_fragments_and_cross_host() {
        let source = Ipv4Addr::new(192, 168, 1, 1);
        for value in [
            "http://gateway.local/root.xml",
            "http://user@192.168.1.1/root.xml",
            "http://192.168.1.1/root.xml#fragment",
            "http://192.168.1.2/root.xml",
        ] {
            assert!(validate_gateway_url(value, source, false, UpnpStage::Discovery).is_err());
        }
    }

    #[test]
    fn scripted_config_is_strictly_loopback_scoped() {
        let config = UpnpDiscoveryConfig::scripted_for_testing(
            Ipv4Addr::LOCALHOST,
            SocketAddrV4::new(Ipv4Addr::LOCALHOST, 19_000),
        );
        assert!(config.allow_loopback_gateway);
        assert_eq!(config.attempts, 1);
    }

    #[tokio::test]
    async fn scripted_gateway_runs_exact_add_verify_renew_delete_lifecycle() {
        let (config, transcript, udp_task, http_task) =
            scripted_gateway(ScriptedAddBehavior::Normal).await;
        let cancellation = CancellationToken::new();
        let gateway = discover_igd_v2(config, &cancellation)
            .await
            .expect("discover scripted IGD v2 gateway");
        assert_eq!(gateway.gateway_address(), Ipv4Addr::LOCALHOST);
        let mut mapping = gateway
            .create_mapping(UpnpTransport::Udp, 42_000, &cancellation)
            .await
            .expect("add and verify finite mapping");
        assert_eq!(mapping.external_port, 42_000);
        assert_eq!(mapping.lease_seconds, REQUESTED_LEASE_SECONDS);
        assert_eq!(mapping.transport, UpnpTransport::Udp);
        gateway
            .renew_mapping(&mut mapping, &cancellation)
            .await
            .expect("renew and verify mapping");
        gateway
            .delete_mapping(&mapping, &cancellation)
            .await
            .expect("delete and independently query absence");
        udp_task.await.expect("join SSDP task");
        http_task.await.expect("join HTTP task");
        assert_eq!(
            transcript.lock().unwrap().as_slice(),
            [
                "GET /root.xml",
                "GET /wan.xml",
                "GetExternalIPAddress",
                "GetSpecificPortMappingEntry",
                "AddPortMapping",
                "GetSpecificPortMappingEntry",
                "AddPortMapping",
                "GetSpecificPortMappingEntry",
                "DeletePortMapping",
                "GetSpecificPortMappingEntry",
            ]
        );
    }

    #[tokio::test]
    async fn add_transport_failure_reconciles_an_installed_mapping() {
        let (config, transcript, udp_task, http_task) =
            scripted_gateway(ScriptedAddBehavior::DropAfterApply).await;
        let cancellation = CancellationToken::new();
        let gateway = discover_igd_v2(config, &cancellation)
            .await
            .expect("discover scripted gateway");
        let mapping = gateway
            .create_mapping(UpnpTransport::Tcp, 42_000, &cancellation)
            .await
            .expect("reconcile mapping installed before transport failure");
        assert_eq!(mapping.external_port, 42_000);
        gateway
            .delete_mapping(&mapping, &cancellation)
            .await
            .expect("delete reconciled mapping");
        udp_task.await.expect("join SSDP task");
        http_task.await.expect("join HTTP task");
        assert_eq!(
            transcript.lock().unwrap().as_slice(),
            [
                "GET /root.xml",
                "GET /wan.xml",
                "GetExternalIPAddress",
                "GetSpecificPortMappingEntry",
                "AddPortMapping",
                "GetSpecificPortMappingEntry",
                "DeletePortMapping",
                "GetSpecificPortMappingEntry",
            ]
        );
    }

    #[tokio::test]
    async fn exact_mapping_uses_only_the_requested_external_port() {
        let (config, transcript, udp_task, http_task) =
            scripted_gateway(ScriptedAddBehavior::ExactPort).await;
        let cancellation = CancellationToken::new();
        let gateway = discover_igd_v2(config, &cancellation)
            .await
            .expect("discover scripted gateway");
        let mapping = gateway
            .create_exact_mapping(UpnpTransport::Udp, 42_000, 42_001, &cancellation)
            .await
            .expect("create exact mapping");
        assert_eq!(mapping.local_endpoint.port(), 42_000);
        assert_eq!(mapping.external_port, 42_001);
        assert_eq!(mapping.transport, UpnpTransport::Udp);
        gateway
            .delete_mapping(&mapping, &cancellation)
            .await
            .expect("delete exact mapping");
        udp_task.await.expect("join SSDP task");
        http_task.await.expect("join HTTP task");
        assert_eq!(
            transcript.lock().unwrap().as_slice(),
            [
                "GET /root.xml",
                "GET /wan.xml",
                "GetExternalIPAddress",
                "GetSpecificPortMappingEntry",
                "AddPortMapping",
                "GetSpecificPortMappingEntry",
                "DeletePortMapping",
                "GetSpecificPortMappingEntry",
            ]
        );
    }

    #[tokio::test]
    async fn idempotent_external_address_query_retries_one_transport_reset() {
        let (config, transcript, udp_task, http_task) =
            scripted_gateway(ScriptedAddBehavior::DropFirstExternalAddress).await;
        let cancellation = CancellationToken::new();
        let gateway = discover_igd_v2(config, &cancellation)
            .await
            .expect("discover scripted gateway");
        assert_eq!(
            gateway
                .external_address(&cancellation)
                .await
                .expect("retry idempotent external-address query"),
            Ipv4Addr::new(203, 0, 113, 10)
        );
        udp_task.await.expect("join SSDP task");
        http_task.await.expect("join HTTP task");
        assert_eq!(
            transcript.lock().unwrap().as_slice(),
            [
                "GET /root.xml",
                "GET /wan.xml",
                "GetExternalIPAddress",
                "GetExternalIPAddress",
            ]
        );
    }

    #[tokio::test]
    async fn permanent_lease_fault_is_a_typed_hard_stop() {
        let (config, _, udp_task, http_task) =
            scripted_gateway(ScriptedAddBehavior::PermanentLeaseFault).await;
        let cancellation = CancellationToken::new();
        let gateway = discover_igd_v2(config, &cancellation)
            .await
            .expect("discover scripted gateway");
        let error = gateway
            .create_mapping(UpnpTransport::Tcp, 42_000, &cancellation)
            .await
            .expect_err("fault 725 must not retry with a permanent lease");
        assert_eq!(error.stage(), UpnpStage::Add);
        assert_eq!(error.fault_code(), Some(725));
        udp_task.await.expect("join SSDP task");
        http_task.await.expect("join HTTP task");
    }

    #[test]
    fn ipv6_firewall_wire_values_boole_and_faults_are_typed() {
        let endpoint = SocketAddrV6::new("2606:4700:4700::1111".parse().unwrap(), 42_000, 0, 0);
        validate_pinhole_endpoint(endpoint).unwrap();
        for invalid in [
            SocketAddrV6::new("::".parse().unwrap(), 42_000, 0, 0),
            SocketAddrV6::new("::1".parse().unwrap(), 42_000, 0, 0),
            SocketAddrV6::new("fd00::1".parse().unwrap(), 42_000, 0, 0),
            SocketAddrV6::new("2606:4700:4700::1111".parse().unwrap(), 1_023, 0, 0),
        ] {
            assert!(
                validate_pinhole_endpoint(invalid).is_err(),
                "accepted {invalid}"
            );
        }
        let request = soap_request(
            WAN_IPV6_FIREWALL_CONTROL_V1,
            "AddPinhole",
            &[
                ("RemoteHost", ""),
                ("RemotePort", "0"),
                ("InternalClient", &endpoint.ip().to_string()),
                ("InternalPort", "42000"),
                ("Protocol", "6"),
                ("LeaseTime", "3600"),
            ],
        );
        assert!(request.contains("<RemoteHost></RemoteHost>"));
        assert!(request.contains("<RemotePort>0</RemotePort>"));
        assert!(request.contains("<InternalClient>2606:4700:4700::1111</InternalClient>"));
        assert!(request.contains("<InternalPort>42000</InternalPort>"));
        assert!(request.contains("<Protocol>6</Protocol>"));
        assert!(!request.contains("<Protocol>TCP</Protocol>"));
        assert!(request.contains("<LeaseTime>3600</LeaseTime>"));

        for value in ["1", "true", "TRUE", "yes", "YES"] {
            assert!(parse_upnp_boolean(value, UpnpStage::FirewallStatus).unwrap());
        }
        for value in ["0", "false", "FALSE", "no", "NO"] {
            assert!(!parse_upnp_boolean(value, UpnpStage::FirewallStatus).unwrap());
        }
        assert!(parse_upnp_boolean("enabled", UpnpStage::FirewallStatus).is_err());

        for code in std::iter::once(606).chain(701..=709) {
            let body = soap_fault(code, "scripted");
            let leaves = parse_xml_leaves(body.as_bytes(), UpnpStage::PinholeAdd).unwrap();
            assert_eq!(
                parse_soap_fault(&leaves, UpnpStage::PinholeAdd)
                    .unwrap()
                    .map(|fault| fault.0),
                Some(code),
            );
        }
    }

    #[test]
    fn dual_service_inventory_keeps_required_actions_independent() {
        let description = br#"<root><device><serviceList>
          <service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:2</serviceType>
          <controlURL>/v4</controlURL><SCPDURL>/v4.xml</SCPDURL></service>
          <service><serviceType>urn:schemas-upnp-org:service:WANIPv6FirewallControl:1</serviceType>
          <controlURL>/v6</controlURL><SCPDURL>/v6.xml</SCPDURL></service>
          </serviceList></device></root>"#;
        let leaves = parse_xml_leaves(description, UpnpStage::Description).unwrap();
        assert_eq!(
            select_service(&leaves, WAN_IP_CONNECTION_V2, "v4")
                .unwrap()
                .unwrap()
                .control_url,
            "/v4",
        );
        assert_eq!(
            select_service(&leaves, WAN_IPV6_FIREWALL_CONTROL_V1, "v6")
                .unwrap()
                .unwrap()
                .control_url,
            "/v6",
        );
        let firewall_actions = br#"<scpd><actionList>
          <action><name>GetFirewallStatus</name></action>
          <action><name>AddPinhole</name></action>
          <action><name>UpdatePinhole</name></action>
          <action><name>DeletePinhole</name></action>
          <action><name>GetPinholePackets</name></action>
          </actionList></scpd>"#;
        let leaves = parse_xml_leaves(firewall_actions, UpnpStage::Description).unwrap();
        require_service_actions(
            &leaves,
            &[
                "GetFirewallStatus",
                "AddPinhole",
                "UpdatePinhole",
                "DeletePinhole",
                "GetPinholePackets",
            ],
            "firewall",
        )
        .unwrap();
        assert!(
            require_service_actions(
                &leaves,
                &["GetFirewallStatus", "CheckPinholeWorking"],
                "firewall",
            )
            .is_err()
        );
    }

    #[tokio::test]
    async fn scripted_ipv6_firewall_runs_status_create_renew_verify_delete_lifecycle() {
        let (config, transcript, udp_task, http_task) =
            scripted_ipv6_firewall(ScriptedPinholeBehavior::Normal).await;
        let cancellation = CancellationToken::new();
        let services = discover_igd_v2_services(config, &cancellation)
            .await
            .expect("discover dual-service gateway");
        assert!(matches!(
            services.ipv4_mapping,
            UpnpDiscoveredService::Available(_)
        ));
        let UpnpDiscoveredService::Available(firewall) = services.ipv6_firewall else {
            panic!("IPv6 firewall service unavailable");
        };
        assert_eq!(
            firewall.firewall_status(&cancellation).await.unwrap(),
            UpnpFirewallStatus {
                firewall_enabled: true,
                inbound_pinhole_allowed: true,
            },
        );
        let endpoint = SocketAddrV6::new("2606:4700:4700::1111".parse().unwrap(), 42_000, 0, 0);
        let mut pinhole = firewall
            .create_pinhole(endpoint, &cancellation)
            .await
            .expect("create finite pinhole");
        assert_eq!(pinhole.unique_id_for_testing(), 73);
        assert_eq!(pinhole.lease_seconds, REQUESTED_LEASE_SECONDS);
        assert_eq!(pinhole.renewal_delay(), Duration::from_secs(2_700));
        firewall
            .renew_pinhole(&mut pinhole, &cancellation)
            .await
            .expect("renew pinhole");
        assert!(
            firewall
                .check_pinhole_working(&pinhole, &cancellation)
                .await
                .expect("check pinhole")
        );
        assert_eq!(
            firewall
                .pinhole_packets(&pinhole, &cancellation)
                .await
                .expect("packet count"),
            9,
        );
        firewall
            .delete_pinhole(&pinhole, &cancellation)
            .await
            .expect("delete pinhole");
        let missing = firewall
            .pinhole_packets(&pinhole, &cancellation)
            .await
            .expect_err("deleted pinhole must be absent");
        assert_eq!(missing.fault_code(), Some(704));
        udp_task.await.expect("join SSDP task");
        http_task.await.expect("join HTTP task");
        assert_eq!(
            transcript.lock().unwrap().as_slice(),
            [
                "GET /root.xml",
                "GET /wan.xml",
                "GET /firewall.xml",
                "GetFirewallStatus",
                "AddPinhole:3600",
                "UpdatePinhole",
                "CheckPinholeWorking",
                "GetPinholePackets",
                "DeletePinhole",
                "GetPinholePackets",
            ]
        );
    }

    #[tokio::test]
    async fn ambiguous_create_reconciles_with_different_lease_or_becomes_bounded_uncertainty() {
        let endpoint = SocketAddrV6::new("2606:4700:4700::1111".parse().unwrap(), 42_000, 0, 0);
        let (config, transcript, udp_task, http_task) =
            scripted_ipv6_firewall(ScriptedPinholeBehavior::DropFirstCreate).await;
        let cancellation = CancellationToken::new();
        let services = discover_igd_v2_services(config, &cancellation)
            .await
            .unwrap();
        let UpnpDiscoveredService::Available(firewall) = services.ipv6_firewall else {
            panic!("IPv6 firewall service unavailable");
        };
        let pinhole = firewall
            .create_pinhole(endpoint, &cancellation)
            .await
            .expect("different-lease reconciliation succeeds");
        assert_eq!(pinhole.unique_id_for_testing(), 73);
        assert_eq!(pinhole.lease_seconds, RECONCILIATION_LEASE_SECONDS);
        firewall
            .delete_pinhole(&pinhole, &cancellation)
            .await
            .unwrap();
        udp_task.await.unwrap();
        http_task.await.unwrap();
        assert_eq!(
            transcript.lock().unwrap().as_slice(),
            [
                "GET /root.xml",
                "GET /wan.xml",
                "GET /firewall.xml",
                "AddPinhole:3600",
                "AddPinhole:3601",
                "DeletePinhole",
            ]
        );

        let (config, transcript, udp_task, http_task) =
            scripted_ipv6_firewall(ScriptedPinholeBehavior::DropBothCreates).await;
        let services = discover_igd_v2_services(config, &cancellation)
            .await
            .unwrap();
        let UpnpDiscoveredService::Available(firewall) = services.ipv6_firewall else {
            panic!("IPv6 firewall service unavailable");
        };
        let error = firewall
            .create_pinhole(endpoint, &cancellation)
            .await
            .expect_err("two ambiguous responses retain uncertainty");
        let UpnpPinholeCreateError::Uncertain(uncertain) = error else {
            panic!("expected uncertain pinhole");
        };
        assert_eq!(uncertain.internal_endpoint, endpoint);
        assert_eq!(uncertain.lease_seconds, RECONCILIATION_LEASE_SECONDS);
        udp_task.await.unwrap();
        http_task.await.unwrap();
        assert_eq!(
            transcript.lock().unwrap().as_slice(),
            [
                "GET /root.xml",
                "GET /wan.xml",
                "GET /firewall.xml",
                "AddPinhole:3600",
                "AddPinhole:3601",
            ]
        );
    }

    #[tokio::test]
    async fn discovery_cancellation_preempts_the_response_window() {
        let socket = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let endpoint = match socket.local_addr().unwrap() {
            SocketAddr::V4(endpoint) => endpoint,
            SocketAddr::V6(_) => unreachable!(),
        };
        let config = UpnpDiscoveryConfig::scripted_for_testing(Ipv4Addr::LOCALHOST, endpoint);
        let cancellation = CancellationToken::new();
        cancellation.cancel();
        let error = discover_igd_v2(config, &cancellation)
            .await
            .expect_err("cancelled discovery must terminate");
        assert_eq!(error.stage(), UpnpStage::Discovery);
    }

    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    enum ScriptedPinholeBehavior {
        Normal,
        DropFirstCreate,
        DropBothCreates,
    }

    async fn scripted_ipv6_firewall(
        behavior: ScriptedPinholeBehavior,
    ) -> (
        UpnpDiscoveryConfig,
        Arc<Mutex<Vec<String>>>,
        tokio::task::JoinHandle<()>,
        tokio::task::JoinHandle<()>,
    ) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let http_port = listener.local_addr().unwrap().port();
        let ssdp = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let SocketAddr::V4(ssdp_endpoint) = ssdp.local_addr().unwrap() else {
            unreachable!();
        };
        let response_count = match behavior {
            ScriptedPinholeBehavior::Normal => 10,
            ScriptedPinholeBehavior::DropFirstCreate => 6,
            ScriptedPinholeBehavior::DropBothCreates => 5,
        };
        let transcript = Arc::new(Mutex::new(Vec::new()));
        let http_transcript = transcript.clone();
        let http_task = tokio::spawn(async move {
            let mut pinhole_present = false;
            let mut create_count = 0_u8;
            for _ in 0..response_count {
                let (mut stream, _) = listener.accept().await.unwrap();
                let request = read_http_request(&mut stream).await;
                let first_line = request.lines().next().unwrap_or_default();
                let (status, content_type, body, event, drop_response) = if first_line
                    .starts_with("GET /root.xml ")
                {
                    (
                        "200 OK",
                        "text/xml",
                        dual_service_description(http_port),
                        "GET /root.xml".to_owned(),
                        false,
                    )
                } else if first_line.starts_with("GET /wan.xml ") {
                    (
                        "200 OK",
                        "application/xml",
                        scpd_description(),
                        "GET /wan.xml".to_owned(),
                        false,
                    )
                } else if first_line.starts_with("GET /firewall.xml ") {
                    (
                        "200 OK",
                        "application/xml",
                        firewall_scpd_description(),
                        "GET /firewall.xml".to_owned(),
                        false,
                    )
                } else {
                    let action = soap_action(&request);
                    let mut event = action.to_owned();
                    let (status, body, drop_response) = match action {
                        "GetFirewallStatus" => (
                            "200 OK",
                            firewall_soap_response(
                                action,
                                "<FirewallEnabled>true</FirewallEnabled><InboundPinholeAllowed>yes</InboundPinholeAllowed>",
                            ),
                            false,
                        ),
                        "AddPinhole" => {
                            create_count += 1;
                            assert!(request.contains("<RemoteHost></RemoteHost>"));
                            assert!(request.contains("<RemotePort>0</RemotePort>"));
                            assert!(
                                request.contains(
                                    "<InternalClient>2606:4700:4700::1111</InternalClient>"
                                )
                            );
                            assert!(request.contains("<InternalPort>42000</InternalPort>"));
                            assert!(request.contains("<Protocol>6</Protocol>"));
                            let lease = if request.contains("<LeaseTime>3601</LeaseTime>") {
                                3_601
                            } else {
                                assert!(request.contains("<LeaseTime>3600</LeaseTime>"));
                                3_600
                            };
                            event = format!("AddPinhole:{lease}");
                            pinhole_present = true;
                            let drop = behavior == ScriptedPinholeBehavior::DropBothCreates
                                || (behavior == ScriptedPinholeBehavior::DropFirstCreate
                                    && create_count == 1);
                            (
                                "200 OK",
                                firewall_soap_response(action, "<UniqueID>73</UniqueID>"),
                                drop,
                            )
                        }
                        "UpdatePinhole" => {
                            assert!(pinhole_present);
                            assert!(request.contains("<UniqueID>73</UniqueID>"));
                            assert!(request.contains("<NewLeaseTime>3600</NewLeaseTime>"));
                            ("200 OK", firewall_soap_response(action, ""), false)
                        }
                        "CheckPinholeWorking" => {
                            assert!(pinhole_present);
                            (
                                "200 OK",
                                firewall_soap_response(action, "<IsWorking>1</IsWorking>"),
                                false,
                            )
                        }
                        "GetPinholePackets" if pinhole_present => (
                            "200 OK",
                            firewall_soap_response(action, "<PinholePackets>9</PinholePackets>"),
                            false,
                        ),
                        "GetPinholePackets" => (
                            "500 Internal Server Error",
                            soap_fault(704, "NoSuchEntry"),
                            false,
                        ),
                        "DeletePinhole" => {
                            assert!(pinhole_present);
                            pinhole_present = false;
                            ("200 OK", firewall_soap_response(action, ""), false)
                        }
                        other => panic!("unexpected scripted action {other}"),
                    };
                    (
                        status,
                        "text/xml; charset=utf-8",
                        body,
                        event,
                        drop_response,
                    )
                };
                http_transcript.lock().unwrap().push(event);
                if drop_response {
                    continue;
                }
                let response = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                stream.write_all(response.as_bytes()).await.unwrap();
                stream.shutdown().await.unwrap();
            }
        });
        let udp_task = tokio::spawn(async move {
            let mut request = [0_u8; 1_024];
            let (length, peer) = ssdp.recv_from(&mut request).await.unwrap();
            let request = std::str::from_utf8(&request[..length]).unwrap();
            assert!(request.contains("ST: upnp:rootdevice\r\n"));
            let response = format!(
                "HTTP/1.1 200 OK\r\nLOCATION: http://127.0.0.1:{http_port}/root.xml\r\nUSN: uuid:scripted::upnp:rootdevice\r\n\r\n"
            );
            ssdp.send_to(response.as_bytes(), peer).await.unwrap();
        });
        (
            UpnpDiscoveryConfig::scripted_for_testing(Ipv4Addr::LOCALHOST, ssdp_endpoint),
            transcript,
            udp_task,
            http_task,
        )
    }

    fn dual_service_description(port: u16) -> String {
        format!(
            "<?xml version=\"1.0\"?><root><URLBase>http://127.0.0.1:{port}/</URLBase><device><serviceList><service><serviceType>{WAN_IP_CONNECTION_V2}</serviceType><controlURL>/v4-control</controlURL><SCPDURL>/wan.xml</SCPDURL></service><service><serviceType>{WAN_IPV6_FIREWALL_CONTROL_V1}</serviceType><controlURL>/v6-control</controlURL><SCPDURL>/firewall.xml</SCPDURL></service></serviceList></device></root>"
        )
    }

    fn firewall_scpd_description() -> String {
        "<scpd><actionList><action><name>GetFirewallStatus</name></action><action><name>AddPinhole</name></action><action><name>UpdatePinhole</name></action><action><name>DeletePinhole</name></action><action><name>GetPinholePackets</name></action><action><name>CheckPinholeWorking</name></action></actionList></scpd>".to_owned()
    }

    fn firewall_soap_response(action: &str, arguments: &str) -> String {
        format!(
            "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\"><s:Body><u:{action}Response xmlns:u=\"{WAN_IPV6_FIREWALL_CONTROL_V1}\">{arguments}</u:{action}Response></s:Body></s:Envelope>"
        )
    }

    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    enum ScriptedAddBehavior {
        Normal,
        ExactPort,
        DropFirstExternalAddress,
        PermanentLeaseFault,
        DropAfterApply,
    }

    async fn scripted_gateway(
        add_behavior: ScriptedAddBehavior,
    ) -> (
        UpnpDiscoveryConfig,
        Arc<Mutex<Vec<String>>>,
        tokio::task::JoinHandle<()>,
        tokio::task::JoinHandle<()>,
    ) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let http_port = listener.local_addr().unwrap().port();
        let ssdp = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let ssdp_endpoint = match ssdp.local_addr().unwrap() {
            SocketAddr::V4(endpoint) => endpoint,
            SocketAddr::V6(_) => unreachable!(),
        };
        let response_count = match add_behavior {
            ScriptedAddBehavior::Normal => 10,
            ScriptedAddBehavior::ExactPort => 8,
            ScriptedAddBehavior::DropFirstExternalAddress => 4,
            ScriptedAddBehavior::PermanentLeaseFault => 5,
            ScriptedAddBehavior::DropAfterApply => 8,
        };
        let transcript = Arc::new(Mutex::new(Vec::new()));
        let http_transcript = transcript.clone();
        let http_task = tokio::spawn(async move {
            let mut mapped = false;
            let mut external_address_queries = 0;
            for _ in 0..response_count {
                let (mut stream, _) = listener.accept().await.unwrap();
                let request = read_http_request(&mut stream).await;
                let first_line = request.lines().next().unwrap_or_default();
                let (status, content_type, body, event, drop_response) = if first_line
                    .starts_with("GET /root.xml ")
                {
                    (
                        "200 OK",
                        "text/xml",
                        device_description(http_port),
                        "GET /root.xml",
                        false,
                    )
                } else if first_line.starts_with("GET /wan.xml ") {
                    (
                        "200 OK",
                        "application/xml",
                        scpd_description(),
                        "GET /wan.xml",
                        false,
                    )
                } else {
                    let action = soap_action(&request);
                    if add_behavior == ScriptedAddBehavior::ExactPort
                        && matches!(
                            action,
                            "GetSpecificPortMappingEntry" | "AddPortMapping" | "DeletePortMapping"
                        )
                    {
                        assert!(request.contains("<NewExternalPort>42001</NewExternalPort>"));
                    }
                    let (status, body, drop_response) = match action {
                        "GetExternalIPAddress" => {
                            external_address_queries += 1;
                            (
                                "200 OK",
                                soap_response(
                                    action,
                                    "<NewExternalIPAddress>203.0.113.10</NewExternalIPAddress>",
                                ),
                                add_behavior == ScriptedAddBehavior::DropFirstExternalAddress
                                    && external_address_queries == 1,
                            )
                        }
                        "GetSpecificPortMappingEntry" if mapped => (
                            "200 OK",
                            soap_response(
                                action,
                                "<NewInternalPort>42000</NewInternalPort><NewInternalClient>127.0.0.1</NewInternalClient><NewEnabled>1</NewEnabled><NewPortMappingDescription>JSTorrent</NewPortMappingDescription><NewLeaseDuration>3600</NewLeaseDuration>",
                            ),
                            false,
                        ),
                        "GetSpecificPortMappingEntry" => (
                            "500 Internal Server Error",
                            soap_fault(714, "NoSuchEntryInArray"),
                            false,
                        ),
                        "AddPortMapping"
                            if add_behavior == ScriptedAddBehavior::PermanentLeaseFault =>
                        {
                            (
                                "500 Internal Server Error",
                                soap_fault(725, "OnlyPermanentLeasesSupported"),
                                false,
                            )
                        }
                        "AddPortMapping" => {
                            assert!(request.contains("<NewLeaseDuration>3600</NewLeaseDuration>"));
                            assert!(
                                request
                                    .contains("<NewInternalClient>127.0.0.1</NewInternalClient>")
                            );
                            assert!(request.contains("<NewInternalPort>42000</NewInternalPort>"));
                            mapped = true;
                            (
                                "200 OK",
                                soap_response(action, ""),
                                add_behavior == ScriptedAddBehavior::DropAfterApply,
                            )
                        }
                        "DeletePortMapping" => {
                            mapped = false;
                            ("200 OK", soap_response(action, ""), false)
                        }
                        other => panic!("unexpected scripted action {other}"),
                    };
                    (
                        status,
                        "text/xml; charset=utf-8",
                        body,
                        action,
                        drop_response,
                    )
                };
                http_transcript.lock().unwrap().push(event.to_owned());
                if drop_response {
                    continue;
                }
                let response = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                stream.write_all(response.as_bytes()).await.unwrap();
                stream.shutdown().await.unwrap();
            }
        });
        let udp_task = tokio::spawn(async move {
            let mut request = [0_u8; 1_024];
            let (length, peer) = ssdp.recv_from(&mut request).await.unwrap();
            let request = std::str::from_utf8(&request[..length]).unwrap();
            assert!(request.contains("ST: upnp:rootdevice\r\n"));
            let response = format!(
                "HTTP/1.1 200 OK\r\nLOCATION: http://127.0.0.1:{http_port}/root.xml\r\nUSN: uuid:scripted::upnp:rootdevice\r\n\r\n"
            );
            ssdp.send_to(response.as_bytes(), peer).await.unwrap();
        });
        (
            UpnpDiscoveryConfig::scripted_for_testing(Ipv4Addr::LOCALHOST, ssdp_endpoint),
            transcript,
            udp_task,
            http_task,
        )
    }

    async fn read_http_request(stream: &mut tokio::net::TcpStream) -> String {
        let mut bytes = Vec::new();
        let mut buffer = [0_u8; 4_096];
        let header_end = loop {
            let length = stream.read(&mut buffer).await.unwrap();
            assert_ne!(length, 0, "request ended before headers");
            bytes.extend_from_slice(&buffer[..length]);
            if let Some(position) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
                break position + 4;
            }
        };
        let headers = std::str::from_utf8(&bytes[..header_end]).unwrap();
        let content_length = headers
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().parse::<usize>().unwrap())
            })
            .unwrap_or(0);
        while bytes.len() < header_end + content_length {
            let length = stream.read(&mut buffer).await.unwrap();
            assert_ne!(length, 0, "request ended before body");
            bytes.extend_from_slice(&buffer[..length]);
        }
        String::from_utf8(bytes).unwrap()
    }

    fn soap_action(request: &str) -> &str {
        request
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("soapaction")
                    .then(|| value.trim().trim_matches('"').rsplit('#').next().unwrap())
            })
            .expect("SOAPAction header")
    }

    fn device_description(port: u16) -> String {
        format!(
            "<?xml version=\"1.0\"?><root><URLBase>http://127.0.0.1:{port}/</URLBase><device><serviceList><service><serviceType>{WAN_IP_CONNECTION_V2}</serviceType><controlURL>/control</controlURL><SCPDURL>/wan.xml</SCPDURL></service></serviceList></device></root>"
        )
    }

    fn scpd_description() -> String {
        "<scpd><actionList><action><name>GetExternalIPAddress</name></action><action><name>GetSpecificPortMappingEntry</name></action><action><name>AddPortMapping</name></action><action><name>DeletePortMapping</name></action></actionList></scpd>".to_owned()
    }

    fn soap_response(action: &str, arguments: &str) -> String {
        format!(
            "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\"><s:Body><u:{action}Response xmlns:u=\"{WAN_IP_CONNECTION_V2}\">{arguments}</u:{action}Response></s:Body></s:Envelope>"
        )
    }

    fn soap_fault(code: u16, description: &str) -> String {
        format!(
            "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\"><s:Body><s:Fault><detail><UPnPError><errorCode>{code}</errorCode><errorDescription>{description}</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>"
        )
    }
}
