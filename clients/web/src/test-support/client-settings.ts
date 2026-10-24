import { DEFAULT_CLIENT_SETTINGS as FILE_SAFETY_DEFAULTS } from "../api";
import type { ClientSettings, ClientSettingsRuntimeView } from "../api";

export function clientSettingsFixture(): ClientSettings {
  return {
    file_safety: FILE_SAFETY_DEFAULTS.file_safety,
    listener: { type: "disabled" },
    preferred_listen_port: 6_881,
    port_mapping: "disabled",
    peer_connection_limit: 200,
    upload_slots: 8,
    active_downloads: 3,
    active_seeds: { type: "limited", torrents: 5 },
    share_ratio_limit_percent: 200,
    finished_download_ratio_limit_percent: 700,
    finished_time_limit_seconds: 86_400,
    seed_stop_ratio_percent: { type: "off" as const },
    seed_stop_time_seconds: { type: "off" as const },
    upload_rate_limit: { type: "unlimited" },
    download_rate_limit: { type: "unlimited" },
    encryption: "allow",
    ipv6_enabled: true,
    dht_enabled: true,
    peer_exchange_enabled: true,
    tracker_https_server_authentication: "system_trust",
  };
}

export function clientSettingsRuntimeFixture(): ClientSettingsRuntimeView {
  return {
    configured: clientSettingsFixture(),
    application_network: {
      requested_generation: "1",
      requested_prerequisite: "allowed",
      effective_generation: "1",
      effective_prerequisite: "allowed",
      state: "allowed",
      degraded_detail: null,
    },
    effective_listener: {
      listener: { type: "disabled" },
      preferred_listen_port: 6_881,
    },
    effective_port_mapping: "disabled",
    effective_peer_connection_limit: 200,
    effective_upload_slots: 8,
    effective_active_downloads: 3,
    effective_active_seeds: { type: "limited", torrents: 5 },
    effective_upload_rate_limit: { type: "unlimited" },
    effective_download_rate_limit: { type: "unlimited" },
    active_download_count: 0,
    checking_count: 0,
    active_seed_count: 0,
    inactive_seed_count: 0,
    effective_encryption: "allow",
    effective_ipv6_enabled: true,
    effective_dht_enabled: true,
    effective_peer_exchange_enabled: true,
    effective_tracker_https_server_authentication: "system_trust",
    transport_application: { type: "applied" },
    port_mapping_application: { type: "applied" },
    peer_connections_application: { type: "applied" },
    upload_slots_application: { type: "applied" },
    bandwidth_application: { type: "applied" },
    bandwidth: {
      upload: bandwidthDirectionFixture(),
      download: bandwidthDirectionFixture(),
    },
    encryption_application: { type: "applied" },
    ipv6_application: { type: "applied" },
    dht_application: { type: "applied" },
    peer_exchange_application: { type: "applied" },
    tracker_https_authentication_application: { type: "applied" },
    listener_status: { type: "disabled" },
    session_udp_status: { type: "unavailable" },
    port_mapping_status: { type: "disabled" },
    udp_port_mapping_status: { type: "disabled" },
    ipv6_pinhole_status: { type: "disabled" },
    advertised_peer_endpoint: { type: "unavailable" },
    transport_families: [
      {
        family: "ipv4",
        configured: true,
        tcp_endpoint: null,
        udp_endpoint: null,
        advertised_endpoint: null,
      },
      {
        family: "ipv6",
        configured: true,
        tcp_endpoint: null,
        udp_endpoint: null,
        advertised_endpoint: null,
      },
    ],
  };
}

function bandwidthDirectionFixture() {
  return {
    registered_torrents: 0,
    active_waiters: 0,
    queued_requested_bytes: "0",
    granted_bytes: "0",
    returned_bytes: "0",
    cancelled_requests: "0",
    throttle_wait_micros: "0",
    throttle_wait_high_water_micros: "0",
    current_burst_credit_bytes: "0",
  };
}
