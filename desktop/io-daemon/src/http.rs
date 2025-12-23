use axum::{routing::get, Json, Router};
use serde::Serialize;
use std::sync::Arc;

use crate::AppState;

#[derive(Serialize)]
struct NetworkInterface {
    name: String,
    address: String,
    #[serde(rename = "prefixLength")]
    prefix_length: u8,
}

pub fn routes() -> Router<Arc<AppState>> {
    Router::new().route("/network/interfaces", get(network_interfaces))
}

async fn network_interfaces() -> Json<Vec<NetworkInterface>> {
    let interfaces = if_addrs::get_if_addrs()
        .map(|addrs| {
            addrs
                .into_iter()
                .filter_map(|iface| {
                    if let std::net::IpAddr::V4(addr) = iface.ip() {
                        let prefix_length = match iface.addr {
                            if_addrs::IfAddr::V4(ref v4) => {
                                let mask = u32::from(v4.netmask);
                                mask.count_ones() as u8
                            }
                            _ => 24,
                        };
                        Some(NetworkInterface {
                            name: iface.name,
                            address: addr.to_string(),
                            prefix_length,
                        })
                    } else {
                        None // Skip IPv6
                    }
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Json(interfaces)
}
