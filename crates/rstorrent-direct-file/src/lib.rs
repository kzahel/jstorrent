#![forbid(unsafe_code)]
//! Experimental bounded direct-file transport components.
//!
//! The protocol codec is runtime independent. The optional WebRTC adapter is
//! deliberately feature-gated so product builds that do not request it omit
//! the ICE, DTLS, SCTP, and certificate dependency graph.

pub mod codec;
#[cfg(feature = "webrtc")]
mod send_window;

#[cfg(feature = "webrtc")]
mod endpoint;

#[cfg(feature = "webrtc")]
pub use endpoint::{
    DirectFileEndpoint, DirectFileEndpointError, DirectFileEndpointFactory,
    DirectFileEndpointSnapshot, OfferAnswer,
};

#[cfg(feature = "webrtc")]
pub use rtc::peer_connection::sdp::RTCSessionDescription;
#[cfg(feature = "webrtc")]
pub use rtc::peer_connection::transport::RTCIceCandidateInit;
