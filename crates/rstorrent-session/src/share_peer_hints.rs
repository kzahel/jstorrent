//! Task-free selection of the BEP 9 `x.pe` hints a share link may carry.
//!
//! The advertised-endpoint selector snapshots what the session knows about
//! its own listener; this module turns that snapshot into at most
//! [`MAX_SHARE_PEER_HINTS`] endpoints or a reason for including none. An
//! internet address needs evidence that an outside peer reached it; a mapping
//! or a public interface address alone is not enough.

use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, SocketAddrV6};

use rstorrent_engine::eligible_global_ipv6;

use crate::control::{MagnetPeerHintOmission, MagnetPeerHintScope};

pub(crate) const MAX_SHARE_PEER_HINTS: usize = 2;

/// What the session knows about its own reachability at one instant.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) struct ShareEndpointFacts {
    /// The IPv4 TCP listener's concrete local endpoint.
    pub ipv4_listener: Option<SocketAddrV4>,
    /// The healthy, unexpired port mapping's external endpoint.
    pub ipv4_mapped: Option<SocketAddrV4>,
    /// The public IPv4 endpoint a peer from a public address reached during
    /// the current listener and mapping generation.
    pub ipv4_confirmed: Option<SocketAddrV4>,
    /// The IPv6 listener's endpoint.
    pub ipv6_listener: Option<SocketAddrV6>,
    /// A peer from a public IPv6 address reached `ipv6_listener`.
    pub ipv6_confirmed: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct SharePeerHint {
    pub endpoint: SocketAddr,
    pub scope: MagnetPeerHintScope,
}

/// Choose the peer hints for a public torrent with verified metadata.
/// `None` means the session has no network runtime.
pub(crate) fn select_peer_hints(
    facts: Option<&ShareEndpointFacts>,
) -> Result<Vec<SharePeerHint>, MagnetPeerHintOmission> {
    let Some(facts) = facts else {
        return Err(MagnetPeerHintOmission::IncomingDisabled);
    };
    if facts.ipv4_listener.is_none() && facts.ipv6_listener.is_none() {
        return Err(MagnetPeerHintOmission::IncomingDisabled);
    }
    let mut hints = Vec::with_capacity(MAX_SHARE_PEER_HINTS);
    if let Some(endpoint) = facts
        .ipv4_confirmed
        .filter(|endpoint| internet_ipv4(*endpoint.ip()))
    {
        hints.push(SharePeerHint {
            endpoint: SocketAddr::V4(endpoint),
            scope: MagnetPeerHintScope::Internet,
        });
    }
    if facts.ipv6_confirmed
        && let Some(endpoint) = facts
            .ipv6_listener
            .filter(|endpoint| eligible_global_ipv6(*endpoint.ip()))
    {
        hints.push(SharePeerHint {
            endpoint: SocketAddr::V6(endpoint),
            scope: MagnetPeerHintScope::Internet,
        });
    }
    if let Some(endpoint) = facts
        .ipv4_listener
        .filter(|endpoint| endpoint.ip().is_private())
    {
        hints.push(SharePeerHint {
            endpoint: SocketAddr::V4(endpoint),
            scope: MagnetPeerHintScope::LocalNetwork,
        });
    }
    hints.truncate(MAX_SHARE_PEER_HINTS);
    if !hints.is_empty() {
        return Ok(hints);
    }
    let unconfirmed_public = facts
        .ipv4_mapped
        .into_iter()
        .chain(facts.ipv4_listener)
        .any(|endpoint| internet_ipv4(*endpoint.ip()))
        || facts
            .ipv6_listener
            .is_some_and(|endpoint| eligible_global_ipv6(*endpoint.ip()));
    Err(if unconfirmed_public {
        MagnetPeerHintOmission::NotReachable
    } else {
        MagnetPeerHintOmission::NoAddress
    })
}

/// A unicast IPv4 address routed on the public internet: not private,
/// shared (CGNAT), loopback, link-local, documentation, benchmarking,
/// reserved, multicast, broadcast or "this network".
pub(crate) fn internet_ipv4(address: Ipv4Addr) -> bool {
    let octets = address.octets();
    let shared = octets[0] == 100 && octets[1] & 0xc0 == 64;
    let protocol_assignments = octets[..3] == [192, 0, 0];
    let benchmarking = octets[0] == 198 && octets[1] & 0xfe == 18;
    !(octets[0] == 0
        || octets[0] >= 240
        || address.is_loopback()
        || address.is_private()
        || address.is_link_local()
        || address.is_documentation()
        || address.is_multicast()
        || shared
        || protocol_assignments
        || benchmarking)
}

#[cfg(test)]
mod tests {
    use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr, SocketAddrV4, SocketAddrV6};

    use super::{ShareEndpointFacts, SharePeerHint, internet_ipv4, select_peer_hints};
    use crate::control::{MagnetPeerHintOmission, MagnetPeerHintScope};

    const PUBLIC_V4: Ipv4Addr = Ipv4Addr::new(93, 184, 216, 34);
    const LAN_V4: Ipv4Addr = Ipv4Addr::new(192, 168, 1, 20);
    const PUBLIC_V6: Ipv6Addr = Ipv6Addr::new(0x2a00, 0x1450, 0, 0, 0, 0, 0, 0x20);

    fn v4(address: Ipv4Addr, port: u16) -> SocketAddrV4 {
        SocketAddrV4::new(address, port)
    }

    fn v6(port: u16) -> SocketAddrV6 {
        SocketAddrV6::new(PUBLIC_V6, port, 0, 0)
    }

    fn hint(endpoint: SocketAddr, scope: MagnetPeerHintScope) -> SharePeerHint {
        SharePeerHint { endpoint, scope }
    }

    #[test]
    fn incoming_disabled_without_runtime_or_listener() {
        assert_eq!(
            select_peer_hints(None),
            Err(MagnetPeerHintOmission::IncomingDisabled)
        );
        assert_eq!(
            select_peer_hints(Some(&ShareEndpointFacts::default())),
            Err(MagnetPeerHintOmission::IncomingDisabled)
        );
    }

    #[test]
    fn local_network_listener_is_hinted_without_internet_evidence() {
        let facts = ShareEndpointFacts {
            ipv4_listener: Some(v4(LAN_V4, 6881)),
            ..ShareEndpointFacts::default()
        };
        assert_eq!(
            select_peer_hints(Some(&facts)),
            Ok(vec![hint(
                SocketAddr::V4(v4(LAN_V4, 6881)),
                MagnetPeerHintScope::LocalNetwork
            )])
        );
    }

    #[test]
    fn mapped_address_needs_an_observed_outside_peer() {
        let mut facts = ShareEndpointFacts {
            ipv4_listener: Some(v4(LAN_V4, 6881)),
            ipv4_mapped: Some(v4(PUBLIC_V4, 40000)),
            ..ShareEndpointFacts::default()
        };
        assert_eq!(
            select_peer_hints(Some(&facts)),
            Ok(vec![hint(
                SocketAddr::V4(v4(LAN_V4, 6881)),
                MagnetPeerHintScope::LocalNetwork
            )])
        );
        facts.ipv4_confirmed = Some(v4(PUBLIC_V4, 40000));
        assert_eq!(
            select_peer_hints(Some(&facts)),
            Ok(vec![
                hint(
                    SocketAddr::V4(v4(PUBLIC_V4, 40000)),
                    MagnetPeerHintScope::Internet
                ),
                hint(
                    SocketAddr::V4(v4(LAN_V4, 6881)),
                    MagnetPeerHintScope::LocalNetwork
                ),
            ])
        );
    }

    #[test]
    fn at_most_two_hints_prefer_confirmed_internet_endpoints() {
        let facts = ShareEndpointFacts {
            ipv4_listener: Some(v4(LAN_V4, 6881)),
            ipv4_mapped: Some(v4(PUBLIC_V4, 6881)),
            ipv4_confirmed: Some(v4(PUBLIC_V4, 6881)),
            ipv6_listener: Some(v6(6881)),
            ipv6_confirmed: true,
        };
        assert_eq!(
            select_peer_hints(Some(&facts)),
            Ok(vec![
                hint(
                    SocketAddr::V4(v4(PUBLIC_V4, 6881)),
                    MagnetPeerHintScope::Internet
                ),
                hint(SocketAddr::V6(v6(6881)), MagnetPeerHintScope::Internet),
            ])
        );
    }

    #[test]
    fn unconfirmed_public_addresses_are_not_reachable() {
        for facts in [
            ShareEndpointFacts {
                ipv4_listener: Some(v4(PUBLIC_V4, 6881)),
                ..ShareEndpointFacts::default()
            },
            ShareEndpointFacts {
                ipv6_listener: Some(v6(6881)),
                ..ShareEndpointFacts::default()
            },
            ShareEndpointFacts {
                ipv4_listener: Some(v4(Ipv4Addr::new(100, 64, 0, 9), 6881)),
                ipv4_mapped: Some(v4(PUBLIC_V4, 6881)),
                ..ShareEndpointFacts::default()
            },
        ] {
            assert_eq!(
                select_peer_hints(Some(&facts)),
                Err(MagnetPeerHintOmission::NotReachable),
                "{facts:?}"
            );
        }
        let public_host = ShareEndpointFacts {
            ipv4_listener: Some(v4(PUBLIC_V4, 6881)),
            ipv4_confirmed: Some(v4(PUBLIC_V4, 6881)),
            ..ShareEndpointFacts::default()
        };
        assert_eq!(
            select_peer_hints(Some(&public_host)),
            Ok(vec![hint(
                SocketAddr::V4(v4(PUBLIC_V4, 6881)),
                MagnetPeerHintScope::Internet
            )])
        );
    }

    #[test]
    fn loopback_shared_and_non_public_addresses_are_never_hinted() {
        for address in [
            Ipv4Addr::LOCALHOST,
            Ipv4Addr::new(100, 100, 1, 1),
            Ipv4Addr::new(169, 254, 1, 1),
        ] {
            let facts = ShareEndpointFacts {
                ipv4_listener: Some(v4(address, 6881)),
                ipv4_confirmed: Some(v4(address, 6881)),
                ..ShareEndpointFacts::default()
            };
            assert_eq!(
                select_peer_hints(Some(&facts)),
                Err(MagnetPeerHintOmission::NoAddress),
                "{address}"
            );
        }
        let loopback_v6 = ShareEndpointFacts {
            ipv6_listener: Some(SocketAddrV6::new(Ipv6Addr::LOCALHOST, 6881, 0, 0)),
            ipv6_confirmed: true,
            ..ShareEndpointFacts::default()
        };
        assert_eq!(
            select_peer_hints(Some(&loopback_v6)),
            Err(MagnetPeerHintOmission::NoAddress)
        );
    }

    #[test]
    fn internet_ipv4_excludes_special_purpose_ranges() {
        assert!(internet_ipv4(PUBLIC_V4));
        assert!(internet_ipv4(Ipv4Addr::new(1, 1, 1, 1)));
        for address in [
            Ipv4Addr::UNSPECIFIED,
            Ipv4Addr::BROADCAST,
            Ipv4Addr::new(0, 1, 2, 3),
            Ipv4Addr::new(10, 0, 0, 1),
            Ipv4Addr::new(100, 64, 0, 1),
            Ipv4Addr::new(100, 127, 255, 254),
            Ipv4Addr::new(127, 0, 0, 1),
            Ipv4Addr::new(169, 254, 0, 1),
            Ipv4Addr::new(172, 16, 0, 1),
            Ipv4Addr::new(192, 0, 0, 1),
            Ipv4Addr::new(192, 0, 2, 1),
            Ipv4Addr::new(192, 168, 0, 1),
            Ipv4Addr::new(198, 18, 0, 1),
            Ipv4Addr::new(198, 19, 255, 1),
            Ipv4Addr::new(198, 51, 100, 1),
            Ipv4Addr::new(203, 0, 113, 1),
            Ipv4Addr::new(224, 0, 0, 1),
            Ipv4Addr::new(240, 0, 0, 1),
        ] {
            assert!(!internet_ipv4(address), "{address}");
        }
        assert!(internet_ipv4(Ipv4Addr::new(100, 128, 0, 1)));
        assert!(internet_ipv4(Ipv4Addr::new(198, 20, 0, 1)));
    }
}
