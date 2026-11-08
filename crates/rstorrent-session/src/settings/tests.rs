use std::io;

use rstorrent_engine::{
    DEFAULT_CONNECTION_LIMIT, DEFAULT_INCOMING_CONNECTION_SLACK, DEFAULT_UNCHOKE_SLOTS,
};
use rusqlite::Connection;

use super::{
    ActiveDownloadsClampReason, ActiveSeedLimit, AdvertisedPeerEndpointScope,
    AdvertisedPeerEndpointStatus, ClientSettings, ClientSettingsApplicationState,
    ClientSettingsError, ClientSettingsPatch, ClientSettingsRuntimeView,
    DEFAULT_FINISHED_DOWNLOAD_RATIO_LIMIT_PERCENT, DEFAULT_FINISHED_TIME_LIMIT_SECONDS,
    DEFAULT_SHARE_RATIO_LIMIT_PERCENT, EffectiveListenerSettings, EncryptionPolicy,
    HttpsServerAuthenticationPolicy, Ipv6PinholeStatus, ListenerPolicy, ListenerStatus,
    PortMappingPolicy, PortMappingStatus, SessionUdpStatus, SettingsPersistenceError,
    TorrentSettingsPatch, TransferRateLimit, classify_listener_bind_failure,
    create_client_settings, read_client_settings, replace_client_settings,
};

#[test]
fn fresh_profile_defaults_enable_incoming_reachability() {
    let settings = ClientSettings::fresh_profile_default();
    assert_eq!(settings.listener, ListenerPolicy::AutomaticLocalNetwork);
    assert_eq!(settings.preferred_listen_port, 6_881);
    assert_eq!(settings.port_mapping, PortMappingPolicy::Upnp);
    assert_eq!(
        settings.peer_connection_limit,
        u32::try_from(DEFAULT_CONNECTION_LIMIT).unwrap()
    );
    assert_eq!(
        settings.upload_slots,
        u16::try_from(DEFAULT_UNCHOKE_SLOTS).unwrap()
    );
    assert_eq!(settings.encryption, EncryptionPolicy::Allow);
    assert!(settings.dht_enabled);
    assert!(settings.peer_exchange_enabled);
    assert_eq!(
        settings.tracker_https_server_authentication,
        HttpsServerAuthenticationPolicy::SystemTrust
    );
    assert_eq!(settings.validate(), Ok(()));

    let peer_budget = settings.peer_budget_config();
    assert_eq!(peer_budget.configured_limit, DEFAULT_CONNECTION_LIMIT);
    assert_eq!(
        peer_budget.incoming_slack,
        DEFAULT_INCOMING_CONNECTION_SLACK
    );
    assert_eq!(
        settings.upload_scheduler_config().slots,
        DEFAULT_UNCHOKE_SLOTS
    );

    let runtime = ClientSettingsRuntimeView::fresh_profile_default();
    assert_eq!(runtime.configured, settings);
    assert_eq!(
        runtime.effective_listener,
        Some(EffectiveListenerSettings {
            listener: ListenerPolicy::Disabled,
            preferred_listen_port: 6_881,
        })
    );
    assert_eq!(
        runtime.transport_application,
        ClientSettingsApplicationState::Applying
    );
    assert_eq!(
        runtime.port_mapping_application,
        ClientSettingsApplicationState::Applying
    );
}

#[test]
fn transfer_rate_limits_are_semantic_and_validate_finite_bounds() {
    assert_eq!(
        serde_json::to_value(TransferRateLimit::Unlimited).unwrap(),
        serde_json::json!({"type": "unlimited"})
    );
    assert_eq!(
        serde_json::to_value(TransferRateLimit::Limited {
            bytes_per_second: 1_024,
        })
        .unwrap(),
        serde_json::json!({"type": "limited", "bytes_per_second": 1024})
    );
    assert!(
        ClientSettings {
            upload_rate_limit: TransferRateLimit::Limited {
                bytes_per_second: 1_023,
            },
            ..ClientSettings::default()
        }
        .validate()
        .is_err()
    );
}

#[test]
fn seed_settings_match_pinned_defaults_and_exact_bounds() {
    let settings = ClientSettings::default();
    assert_eq!(
        settings.active_seeds,
        ActiveSeedLimit::Limited { torrents: 5 }
    );
    assert_eq!(
        settings.share_ratio_limit_percent,
        DEFAULT_SHARE_RATIO_LIMIT_PERCENT
    );
    assert_eq!(
        settings.finished_download_ratio_limit_percent,
        DEFAULT_FINISHED_DOWNLOAD_RATIO_LIMIT_PERCENT
    );
    assert_eq!(
        settings.finished_time_limit_seconds,
        DEFAULT_FINISHED_TIME_LIMIT_SECONDS
    );

    for active_seeds in [
        ActiveSeedLimit::Unlimited,
        ActiveSeedLimit::Limited { torrents: 0 },
        ActiveSeedLimit::Limited { torrents: 500 },
    ] {
        assert_eq!(
            ClientSettings {
                active_seeds,
                ..ClientSettings::default()
            }
            .validate(),
            Ok(())
        );
    }
    assert_eq!(
        ClientSettings {
            active_seeds: ActiveSeedLimit::Limited { torrents: 501 },
            ..ClientSettings::default()
        }
        .validate(),
        Err(ClientSettingsError::ActiveSeeds { value: 501 })
    );
    assert!(
        ClientSettings {
            share_ratio_limit_percent: i32::MAX as u32 + 1,
            ..ClientSettings::default()
        }
        .validate()
        .is_err()
    );

    assert_eq!(
        serde_json::to_value(ActiveSeedLimit::Unlimited).unwrap(),
        serde_json::json!({"type": "unlimited"})
    );
    assert_eq!(
        serde_json::to_value(ActiveSeedLimit::Limited { torrents: 0 }).unwrap(),
        serde_json::json!({"type": "limited", "torrents": 0})
    );
}

#[test]
fn settings_patch_json_is_sparse_and_closed() {
    let patch = ClientSettingsPatch {
        peer_connection_limit: Some(321),
        ipv6_enabled: Some(false),
        dht_enabled: Some(false),
        peer_exchange_enabled: Some(false),
        ..ClientSettingsPatch::default()
    };
    assert_eq!(
        serde_json::to_value(patch).unwrap(),
        serde_json::json!({
            "peer_connection_limit": 321,
            "ipv6_enabled": false,
            "dht_enabled": false,
            "peer_exchange_enabled": false
        })
    );
    assert!(
        serde_json::from_value::<ClientSettingsPatch>(serde_json::json!({"surprise": true}))
            .is_err()
    );
    assert!(
        serde_json::from_value::<ClientSettingsPatch>(serde_json::json!({
            "peer_connection_limit": null
        }))
        .is_err()
    );
    assert!(
        serde_json::from_value::<TorrentSettingsPatch>(serde_json::json!({
            "upload_rate_limit": {"type": "unlimited"},
            "surprise": true
        }))
        .is_err()
    );
}

#[test]
fn validates_exact_listener_connection_and_slot_boundaries() {
    for port in [1_024, 6_881, 65_535] {
        assert_eq!(
            ClientSettings {
                preferred_listen_port: port,
                ..ClientSettings::default()
            }
            .validate(),
            Ok(())
        );
    }
    assert_eq!(
        ClientSettings {
            preferred_listen_port: 1_023,
            ..ClientSettings::default()
        }
        .validate(),
        Err(ClientSettingsError::PreferredListenerPort { port: 1_023 })
    );

    for port in [1_024, 65_535] {
        assert_eq!(
            ClientSettings {
                listener: ListenerPolicy::FixedLoopback { port },
                ..ClientSettings::default()
            }
            .validate(),
            Ok(())
        );
    }
    assert_eq!(
        ClientSettings {
            listener: ListenerPolicy::FixedLoopback { port: 1_023 },
            ..ClientSettings::default()
        }
        .validate(),
        Err(ClientSettingsError::FixedListenerPort { port: 1_023 })
    );

    for value in [1, 199, 200, 2_000] {
        assert_eq!(
            ClientSettings {
                peer_connection_limit: value,
                ..ClientSettings::default()
            }
            .validate(),
            Ok(())
        );
    }
    for value in [0, 2_001] {
        assert_eq!(
            ClientSettings {
                peer_connection_limit: value,
                ..ClientSettings::default()
            }
            .validate(),
            Err(ClientSettingsError::PeerConnectionLimit { value })
        );
    }

    for value in [0, 1, 7, 8, 50] {
        assert_eq!(
            ClientSettings {
                upload_slots: value,
                ..ClientSettings::default()
            }
            .validate(),
            Ok(())
        );
    }
    assert_eq!(
        ClientSettings {
            upload_slots: 51,
            ..ClientSettings::default()
        }
        .validate(),
        Err(ClientSettingsError::UploadSlots { value: 51 })
    );
}

#[test]
fn listener_json_is_closed_and_tagged() {
    let fixed = ListenerPolicy::FixedLoopback { port: 6_881 };
    assert_eq!(
        serde_json::to_value(fixed).unwrap(),
        serde_json::json!({"type": "fixed_loopback", "port": 6881})
    );
    assert!(
        serde_json::from_value::<ListenerPolicy>(
            serde_json::json!({"type": "fixed_loopback", "port": 65536})
        )
        .is_err()
    );
    assert!(
        serde_json::from_value::<ListenerPolicy>(serde_json::json!({"type": "public"})).is_err()
    );
    assert_eq!(
        serde_json::to_value(ListenerPolicy::AutomaticLocalNetwork).unwrap(),
        serde_json::json!({"type": "automatic_local_network"})
    );
    assert_eq!(
        serde_json::to_value(ListenerPolicy::FixedLocalNetwork { port: 6_882 }).unwrap(),
        serde_json::json!({"type": "fixed_local_network", "port": 6882})
    );
    assert_eq!(
        serde_json::to_value(PortMappingPolicy::Upnp).unwrap(),
        serde_json::json!("upnp")
    );
}

#[test]
fn runtime_view_distinguishes_configured_effective_domains_and_observed_facts() {
    let configured = ClientSettings {
        file_safety: Default::default(),
        listener: ListenerPolicy::AutomaticLoopback,
        preferred_listen_port: 42_000,
        port_mapping: PortMappingPolicy::Disabled,
        peer_connection_limit: 500,
        upload_slots: 1,
        active_downloads: 3,
        upload_rate_limit: TransferRateLimit::Limited {
            bytes_per_second: 32 * 1_024,
        },
        download_rate_limit: TransferRateLimit::Limited {
            bytes_per_second: u32::MAX,
        },
        encryption: EncryptionPolicy::Required,
        ipv6_enabled: false,
        tracker_https_server_authentication: HttpsServerAuthenticationPolicy::Disabled,
        ..ClientSettings::default()
    };
    let view = ClientSettingsRuntimeView {
        configured: configured.clone(),
        application_network: Default::default(),
        effective_listener: Some(EffectiveListenerSettings {
            listener: ListenerPolicy::AutomaticLoopback,
            preferred_listen_port: 41_000,
        }),
        effective_port_mapping: PortMappingPolicy::Disabled,
        effective_peer_connection_limit: 120,
        effective_upload_slots: 8,
        effective_active_downloads: 2,
        effective_active_seeds: configured.active_seeds,
        effective_upload_rate_limit: Default::default(),
        effective_download_rate_limit: Default::default(),
        active_downloads_clamp_reason: Some(ActiveDownloadsClampReason::PlatformLimit),
        active_download_count: 2,
        checking_count: 1,
        active_seed_count: 1,
        inactive_seed_count: 1,
        effective_encryption: Default::default(),
        effective_ipv6_enabled: true,
        effective_dht_enabled: true,
        effective_peer_exchange_enabled: false,
        effective_tracker_https_server_authentication: Some(
            HttpsServerAuthenticationPolicy::SystemTrust,
        ),
        transport_application: ClientSettingsApplicationState::Applying,
        port_mapping_application: ClientSettingsApplicationState::Applied,
        peer_connections_application: ClientSettingsApplicationState::Applied,
        upload_slots_application: ClientSettingsApplicationState::Applied,
        bandwidth_application: ClientSettingsApplicationState::Applied,
        bandwidth: Default::default(),
        encryption_application: ClientSettingsApplicationState::Applied,
        ipv6_application: ClientSettingsApplicationState::Applying,
        dht_application: ClientSettingsApplicationState::Applied,
        peer_exchange_application: ClientSettingsApplicationState::Applied,
        tracker_https_authentication_application: ClientSettingsApplicationState::Applying,
        listener_status: ListenerStatus::Listening {
            address: "127.0.0.1".to_owned(),
            port: 41_000,
        },
        session_udp_status: SessionUdpStatus::Bound {
            address: "127.0.0.1".to_owned(),
            port: 41_001,
            coordinated_with_tcp: false,
        },
        port_mapping_status: PortMappingStatus::Disabled,
        udp_port_mapping_status: PortMappingStatus::Disabled,
        ipv6_pinhole_status: Ipv6PinholeStatus::Disabled,
        advertised_peer_endpoint: AdvertisedPeerEndpointStatus::Local {
            generation: "1".to_owned(),
            address: "127.0.0.1".to_owned(),
            port: 41_000,
            scope: AdvertisedPeerEndpointScope::Loopback,
            incoming_observed: false,
        },
        transport_families: Vec::new(),
    };
    assert_eq!(view.configured, configured);
    assert_eq!(
        view.effective_listener,
        Some(EffectiveListenerSettings {
            listener: ListenerPolicy::AutomaticLoopback,
            preferred_listen_port: 41_000,
        })
    );
    assert_eq!(
        view.transport_application,
        ClientSettingsApplicationState::Applying
    );
    assert_eq!(view.effective_peer_connection_limit, 120);
    assert_eq!(
        view.listener_status,
        ListenerStatus::Listening {
            address: "127.0.0.1".to_owned(),
            port: 41_000,
        }
    );
}

#[test]
fn listener_bind_failures_are_closed_classified_and_byte_bounded() {
    for (kind, expected) in [
        (
            io::ErrorKind::AddrInUse,
            crate::ListenerBindFailureReason::AddressInUse,
        ),
        (
            io::ErrorKind::PermissionDenied,
            crate::ListenerBindFailureReason::PermissionDenied,
        ),
        (
            io::ErrorKind::AddrNotAvailable,
            crate::ListenerBindFailureReason::AddressUnavailable,
        ),
        (
            io::ErrorKind::ConnectionRefused,
            crate::ListenerBindFailureReason::Other,
        ),
    ] {
        let ListenerStatus::BindFailed { reason, detail } =
            classify_listener_bind_failure(&io::Error::new(kind, "bounded detail"))
        else {
            panic!("bind failure must remain typed");
        };
        assert_eq!(reason, expected);
        assert_eq!(detail, "bounded detail");
    }

    let ListenerStatus::BindFailed { detail, .. } =
        classify_listener_bind_failure(&io::Error::other("é".repeat(400)))
    else {
        panic!("long bind failure must remain typed");
    };
    assert!(detail.len() <= 512);
    assert!(detail.is_char_boundary(detail.len()));
}

#[test]
fn typed_persistence_round_trips_one_atomic_group() {
    let mut connection = Connection::open_in_memory().unwrap();
    let transaction = connection.transaction().unwrap();
    create_client_settings(&transaction, &ClientSettings::default()).unwrap();
    crate::store_migration::upgrade_client_settings_for_test(&transaction);
    assert_eq!(
        read_client_settings(&transaction).unwrap(),
        ClientSettings::default()
    );
    let configured = ClientSettings {
        file_safety: Default::default(),
        listener: ListenerPolicy::FixedLocalNetwork { port: 42_000 },
        preferred_listen_port: 41_000,
        port_mapping: PortMappingPolicy::Upnp,
        peer_connection_limit: 1,
        upload_slots: 0,
        active_downloads: 3,
        active_seeds: ActiveSeedLimit::Unlimited,
        share_ratio_limit_percent: 0,
        finished_download_ratio_limit_percent: i32::MAX as u32,
        finished_time_limit_seconds: 123,
        seed_stop_ratio_percent: crate::SeedStopLimit::Limited { value: 150 },
        seed_stop_time_seconds: crate::SeedStopLimit::Limited { value: 3_600 },
        upload_rate_limit: TransferRateLimit::Limited {
            bytes_per_second: 32 * 1_024,
        },
        download_rate_limit: TransferRateLimit::Limited {
            bytes_per_second: u32::MAX,
        },
        encryption: Default::default(),
        ipv6_enabled: false,
        dht_enabled: false,
        peer_exchange_enabled: false,
        tracker_https_server_authentication: HttpsServerAuthenticationPolicy::Disabled,
    };
    assert!(replace_client_settings(&transaction, &configured).unwrap());
    assert!(!replace_client_settings(&transaction, &configured).unwrap());
    transaction.commit().unwrap();
    assert_eq!(read_client_settings(&connection).unwrap(), configured);
}

#[test]
fn sqlite_constraints_and_decoder_reject_invalid_durable_shapes() {
    let mut connection = Connection::open_in_memory().unwrap();
    let transaction = connection.transaction().unwrap();
    create_client_settings(&transaction, &ClientSettings::default()).unwrap();
    crate::store_migration::upgrade_client_settings_for_test(&transaction);
    transaction.commit().unwrap();

    assert!(
        connection
            .execute(
                "UPDATE client_settings SET peer_connection_limit = 0 WHERE singleton = 1",
                [],
            )
            .is_err()
    );
    assert!(
        connection
            .execute(
                "UPDATE client_settings SET active_seeds = 501 WHERE singleton = 1",
                [],
            )
            .is_err()
    );
    assert!(
        connection
            .execute(
                "UPDATE client_settings
                 SET share_ratio_limit_percent = 2147483648
                 WHERE singleton = 1",
                [],
            )
            .is_err()
    );
    assert!(
        connection
            .execute(
                "UPDATE client_settings SET preferred_listen_port = 1023 WHERE singleton = 1",
                [],
            )
            .is_err()
    );
    assert!(
        connection
            .execute(
                "UPDATE client_settings SET port_mapping_mode = 'automatic' WHERE singleton = 1",
                [],
            )
            .is_err()
    );
    connection
        .pragma_update(None, "ignore_check_constraints", true)
        .unwrap();
    connection
        .execute(
            "UPDATE client_settings
             SET tracker_https_server_authentication = 'automatic'
             WHERE singleton = 1",
            [],
        )
        .unwrap();
    assert!(matches!(
        read_client_settings(&connection),
        Err(SettingsPersistenceError::Corrupt(_))
    ));
    connection
        .execute(
            "UPDATE client_settings
             SET tracker_https_server_authentication = 'system_trust'
             WHERE singleton = 1",
            [],
        )
        .unwrap();
    connection
        .execute(
            "UPDATE client_settings
             SET listener_mode = 'fixed_loopback', listener_port = NULL
             WHERE singleton = 1",
            [],
        )
        .unwrap();
    assert!(matches!(
        read_client_settings(&connection),
        Err(SettingsPersistenceError::Corrupt(_))
    ));
    connection
        .execute("DELETE FROM client_settings", [])
        .unwrap();
    assert!(matches!(
        read_client_settings(&connection),
        Err(SettingsPersistenceError::Corrupt(_))
    ));
}
