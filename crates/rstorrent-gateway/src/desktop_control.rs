//! Desktop-owned semantic control. No assets, HTTP API or application owner.
use super::*;
use axum::extract::ws::WebSocketUpgrade;
use axum::{
    Router,
    extract::{ConnectInfo, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use rstorrent_session::{ApiBackendIdentity, ApplicationService};
use std::sync::Arc;
use std::sync::atomic::Ordering;
use tokio::sync::{Mutex, Semaphore};
use tokio_util::sync::CancellationToken;

pub struct DesktopControlServer {
    listener: tokio::net::TcpListener,
    state: GatewayState,
}

impl DesktopControlServer {
    pub async fn bind(
        service: Arc<Mutex<ApplicationService>>,
        credential: String,
        instance_id: String,
        version: String,
    ) -> Result<Self, GatewayError> {
        if credential.len() != 64 || !credential.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(GatewayError::Configuration(
                "invalid desktop credential".to_owned(),
            ));
        }
        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .map_err(GatewayError::Bind)?;
        let address = listener.local_addr().map_err(GatewayError::Bind)?;
        let origin = format!("http://{address}");
        let state = GatewayState {
            authentication: Arc::new(GatewayAuthentication::Bearer { token: credential }),
            allowed_origin: Arc::from(chromeos_companion::BETA_EXTENSION_ORIGIN),
            allowed_host: Arc::from(address.to_string()),
            media_host: Arc::from(address.to_string()),
            media_origin: Arc::from(origin),
            service,
            connections: Arc::new(Semaphore::new(4)),
            torrent_uploads: Arc::new(Semaphore::new(1)),
            http_owner_namespace: NEXT_HTTP_OWNER.fetch_add(1, Ordering::Relaxed),
            connection_registry: application_websocket::ApplicationConnectionRegistry::new(),
            connection_metrics: ApplicationConnectionMetrics::default(),
            gateway_shutdown: CancellationToken::new(),
            hello_backend: Some(ApiBackendIdentity {
                kind: "desktop".to_owned(),
                instance_id,
                profile_id: "default".to_owned(),
                product_version: version,
                capability_profile: vec![
                    "desktop_control_v1".to_owned(),
                    "native_window_root_acquisition".to_owned(),
                ],
            }),
            companion_platform: None,
            download_directory_picker: Arc::new(UnavailableDownloadDirectoryPicker),
            hosted_assets: None,
            web_auth: None,
        };
        Ok(Self { listener, state })
    }

    pub fn local_addr(&self) -> std::net::SocketAddr {
        self.listener.local_addr().expect("bound desktop listener")
    }

    pub fn with_download_directory_picker(
        mut self,
        picker: Arc<dyn rstorrent_platform::DownloadDirectoryPicker>,
    ) -> Self {
        self.state.download_directory_picker = picker;
        self.state
            .hello_backend
            .as_mut()
            .expect("desktop identity")
            .capability_profile
            .retain(|capability| capability != "native_window_root_acquisition");
        self.state
            .hello_backend
            .as_mut()
            .expect("desktop identity")
            .capability_profile
            .push("desktop_root_picker_v1".into());
        self
    }
    pub fn metrics(&self) -> ApplicationConnectionMetrics {
        self.state.connection_metrics.clone()
    }

    pub async fn serve(self, shutdown: CancellationToken) -> Result<(), GatewayError> {
        let connections = self.state.connections.clone();
        let gateway_shutdown = self.state.gateway_shutdown.clone();
        let router = Router::new()
            .route("/api/v1/connect", get(upgrade))
            .with_state(self.state);
        let mut requests = tokio::task::JoinSet::new();
        let result = loop {
            tokio::select! {
                biased;
                () = shutdown.cancelled() => break Ok(()),
                _ = requests.join_next(), if !requests.is_empty() => {},
                accepted = self.listener.accept() => {
                    let (stream, peer) = match accepted {
                        Ok(value) => value,
                        Err(error) => break Err(GatewayError::Serve(error)),
                    };
                    if requests.len() >= 8 {
                        // Refuse before allocating a parser or spawning a task.
                        drop(stream);
                        continue;
                    }
                    let service = hyper_util::service::TowerToHyperService::new(
                        router.clone().layer(axum::Extension(ConnectInfo(peer))),
                    );
                    requests.spawn(async move {
                        let mut http = hyper::server::conn::http1::Builder::new();
                        http.max_headers(32).max_buf_size(16 * 1024);
                        let connection = http.serve_connection(
                            hyper_util::rt::TokioIo::new(stream), service,
                        ).with_upgrades();
                        // Bounds slow headers and peers that never read a refusal.
                        let _ = tokio::time::timeout(std::time::Duration::from_secs(5), connection).await;
                    });
                }
            }
        };
        gateway_shutdown.cancel();
        requests.abort_all();
        while requests.join_next().await.is_some() {}
        // Axum upgrades outlive HTTP requests. Wait for their pumps/writers too.
        let _joined = connections.acquire_many(4).await;
        result
    }
}

async fn upgrade(
    State(state): State<GatewayState>,
    ConnectInfo(peer): ConnectInfo<std::net::SocketAddr>,
    headers: HeaderMap,
    socket: WebSocketUpgrade,
) -> Response {
    if !peer.ip().is_loopback()
        || headers.get(header::HOST).and_then(|v| v.to_str().ok())
            != Some(state.allowed_host.as_ref())
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    application_websocket::upgrade_application_connection(
        State(state),
        ConnectInfo(peer),
        headers,
        socket,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::{SinkExt, StreamExt};
    use serde_json::{Value, json};
    use std::time::Duration;
    use tokio_tungstenite::{
        connect_async,
        tungstenite::{Message, client::IntoClientRequest},
    };

    struct ControlledPicker(
        tokio::sync::mpsc::UnboundedSender<tokio::sync::oneshot::Sender<Option<PathBuf>>>,
    );
    impl rstorrent_platform::DownloadDirectoryPicker for ControlledPicker {
        fn choose<'a>(
            &'a self,
            _starting: &'a std::path::Path,
        ) -> rstorrent_platform::PickerFuture<'a> {
            Box::pin(async move {
                let (sender, receiver) = tokio::sync::oneshot::channel();
                self.0.send(sender).unwrap();
                Ok(receiver.await.unwrap())
            })
        }
    }

    #[tokio::test]
    async fn authenticated_picker_selection_cancel_repair_refusal_and_disconnect() {
        let root = std::env::temp_dir().join(format!("rstorrent-picker-{}", std::process::id()));
        let first = root.join("first");
        let second = root.join("second");
        std::fs::create_dir_all(&first).unwrap();
        std::fs::create_dir_all(&second).unwrap();
        let service = Arc::new(Mutex::new(
            ApplicationService::open(rstorrent_session::ApplicationConfig::new(
                root.join("profile"),
                "default".into(),
                Vec::new(),
                rstorrent_session::NetworkConfig::new(
                    rstorrent_session::NetworkPolicy::LoopbackOnly,
                    Duration::from_secs(1),
                    Duration::from_secs(1),
                ),
            ))
            .await
            .unwrap(),
        ));
        let (picker, mut requests) = tokio::sync::mpsc::unbounded_channel();
        let token = "aa".repeat(32);
        let server = DesktopControlServer::bind(
            service.clone(),
            token.clone(),
            "bb".repeat(16),
            "test".into(),
        )
        .await
        .unwrap()
        .with_download_directory_picker(Arc::new(ControlledPicker(picker)));
        let mut request = format!("ws://{}/api/v1/connect", server.local_addr())
            .into_client_request()
            .unwrap();
        request.headers_mut().insert(
            "Origin",
            chromeos_companion::PRODUCTION_EXTENSION_ORIGIN
                .parse()
                .unwrap(),
        );
        let cancel = CancellationToken::new();
        let task = tokio::spawn(server.serve(cancel.clone()));
        let (mut client, _) = connect_async(request).await.unwrap();
        client.send(Message::Text(json!({"type":"connect","api_version":1,"encoding":"json","client_instance_id":"00".repeat(16),"token":token}).to_string().into())).await.unwrap();
        assert!(
            client
                .next()
                .await
                .unwrap()
                .unwrap()
                .into_text()
                .unwrap()
                .contains("desktop_root_picker_v1")
        );
        let mut root_id = None;
        for selected in [Some(first), None] {
            client
                .send(Message::Text(
                    json!({"type":"choose_download_root","call_id":"picker","request":{}})
                        .to_string()
                        .into(),
                ))
                .await
                .unwrap();
            let response = tokio::time::timeout(Duration::from_secs(2), requests.recv())
                .await
                .unwrap()
                .unwrap();
            let cancelled = selected.is_none();
            response.send(selected).unwrap();
            let frame: Value =
                serde_json::from_str(&client.next().await.unwrap().unwrap().into_text().unwrap())
                    .unwrap();
            assert_eq!(frame["type"], "download_root_chosen", "{frame}");
            if cancelled {
                assert!(frame["response"]["root"].is_null());
            } else {
                let id = frame["response"]["root"]["root_id"]
                    .as_str()
                    .unwrap()
                    .to_owned();
                if let Some(previous) = root_id {
                    assert_eq!(id, previous);
                }
                root_id = Some(id);
            }
        }
        client.send(Message::Text(json!({"type":"choose_download_root","call_id":"repair","request":{"repair_root":root_id}}).to_string().into())).await.unwrap();
        let refusal: Value =
            serde_json::from_str(&client.next().await.unwrap().unwrap().into_text().unwrap())
                .unwrap();
        assert_eq!(refusal["type"], "call_error");
        assert!(requests.try_recv().is_err());
        assert_eq!(
            service.lock().await.storage_snapshot().unwrap().roots.len(),
            1
        );
        client
            .send(Message::Text(
                json!({"type":"choose_download_root","call_id":"orphan","request":{}})
                    .to_string()
                    .into(),
            ))
            .await
            .unwrap();
        let mut response = requests.recv().await.unwrap();
        client.close(None).await.unwrap();
        drop(client);
        tokio::time::timeout(Duration::from_secs(2), response.closed())
            .await
            .unwrap();
        assert!(response.send(Some(second)).is_err());
        assert_eq!(
            service.lock().await.storage_snapshot().unwrap().roots.len(),
            1
        );
        cancel.cancel();
        task.await.unwrap().unwrap();
        service.lock().await.shutdown().await.unwrap();
        drop(service);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn departed_pages_and_takeover_retire_only_their_view_sets() {
        use rstorrent_session::{ViewSetError, ViewSetOwner};
        let root =
            std::env::temp_dir().join(format!("rstorrent-desktop-views-{}", std::process::id()));
        let service = Arc::new(Mutex::new(
            ApplicationService::open(rstorrent_session::ApplicationConfig::new(
                root.join("profile"),
                "default".into(),
                Vec::new(),
                rstorrent_session::NetworkConfig::new(
                    rstorrent_session::NetworkPolicy::LoopbackOnly,
                    Duration::from_secs(1),
                    Duration::from_secs(1),
                ),
            ))
            .await
            .unwrap(),
        ));
        let token = "ef".repeat(32);
        let server = DesktopControlServer::bind(
            service.clone(),
            token.clone(),
            "01".repeat(16),
            "test".into(),
        )
        .await
        .unwrap();
        let namespace = server.state.http_owner_namespace;
        let address = server.local_addr();
        let request = || {
            let mut request = format!("ws://{address}/api/v1/connect")
                .into_client_request()
                .unwrap();
            request.headers_mut().insert(
                "Origin",
                chromeos_companion::BETA_EXTENSION_ORIGIN.parse().unwrap(),
            );
            request
        };
        let owner =
            |id: usize| ViewSetOwner::trusted(format!("gateway-client-{namespace}-{id:032x}"));
        let open = json!({"type":"call","call_id":"view","operation":{"type":"open_view_set","request":{"views":[{"type":"torrent_list","view_id":"library","delivery":{"kind":"immediate"}}],"options":{}}}});
        let cancel = CancellationToken::new();
        let task = tokio::spawn(server.serve(cancel.clone()));
        let connect = |id: usize| json!({"type":"connect","api_version":1,"encoding":"json","client_instance_id":format!("{id:032x}"),"token":token});
        let (mut retained, _) = connect_async(request()).await.unwrap();
        retained
            .send(Message::Text(connect(0).to_string().into()))
            .await
            .unwrap();
        retained.next().await.unwrap().unwrap();
        retained
            .send(Message::Text(open.to_string().into()))
            .await
            .unwrap();
        let frame: Value =
            serde_json::from_str(&retained.next().await.unwrap().unwrap().into_text().unwrap())
                .unwrap();
        let retained_id = frame["result"]["response"]["view_set_id"]
            .as_str()
            .expect("opened set")
            .to_owned();
        // More than the global set limit, well before the five-minute lease.
        for id in 1..=64 {
            let (mut page, _) = connect_async(request()).await.unwrap();
            page.send(Message::Text(connect(id).to_string().into()))
                .await
                .unwrap();
            page.next().await.unwrap().unwrap();
            page.send(Message::Text(open.to_string().into()))
                .await
                .unwrap();
            let frame: Value =
                serde_json::from_str(&page.next().await.unwrap().unwrap().into_text().unwrap())
                    .unwrap();
            assert_eq!(frame["type"], "result", "{frame}");
            let mut set_id = frame["result"]["response"]["view_set_id"]
                .as_str()
                .unwrap()
                .to_owned();
            if id == 1 {
                // A replacement waits for old-owner cleanup before admission.
                let (mut replacement, _) = connect_async(request()).await.unwrap();
                replacement
                    .send(Message::Text(connect(id).to_string().into()))
                    .await
                    .unwrap();
                let hello = replacement
                    .next()
                    .await
                    .unwrap()
                    .unwrap()
                    .into_text()
                    .unwrap();
                assert!(hello.contains("connected"));
                assert!(matches!(
                    service.lock().await.view_set(&owner(id), &set_id),
                    Err(ViewSetError::UnknownViewSet)
                ));
                replacement
                    .send(Message::Text(open.to_string().into()))
                    .await
                    .unwrap();
                let replacement_frame: Value = serde_json::from_str(
                    &replacement
                        .next()
                        .await
                        .unwrap()
                        .unwrap()
                        .into_text()
                        .unwrap(),
                )
                .unwrap();
                let replacement_id = replacement_frame["result"]["response"]["view_set_id"]
                    .as_str()
                    .unwrap();
                assert!(
                    service
                        .lock()
                        .await
                        .view_set(&owner(id), replacement_id)
                        .is_ok()
                );
                set_id = replacement_id.to_owned();
                drop(replacement);
            }
            // No detach or close-view-set; also covers unattached sets.
            drop(page);
            tokio::time::timeout(Duration::from_secs(2), async {
                loop {
                    if matches!(
                        service.lock().await.view_set(&owner(id), &set_id),
                        Err(ViewSetError::UnknownViewSet)
                    ) {
                        break;
                    }
                    tokio::task::yield_now().await;
                }
            })
            .await
            .unwrap();
            assert!(
                service
                    .lock()
                    .await
                    .view_set(&owner(0), &retained_id)
                    .is_ok()
            );
        }
        drop(retained);
        cancel.cancel();
        task.await.unwrap().unwrap();
        service.lock().await.shutdown().await.unwrap();
        drop(service);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn exact_admission_identity_shared_library_limits_and_joined_shutdown() {
        let root =
            std::env::temp_dir().join(format!("rstorrent-desktop-control-{}", std::process::id()));
        let service = Arc::new(Mutex::new(
            ApplicationService::open(rstorrent_session::ApplicationConfig::new(
                root.join("profile"),
                "default".to_owned(),
                Vec::new(),
                rstorrent_session::NetworkConfig::new(
                    rstorrent_session::NetworkPolicy::LoopbackOnly,
                    Duration::from_secs(1),
                    Duration::from_secs(1),
                ),
            ))
            .await
            .unwrap(),
        ));
        let token = "ab".repeat(32);
        let server = DesktopControlServer::bind(
            service.clone(),
            token.clone(),
            "cd".repeat(16),
            "test".to_owned(),
        )
        .await
        .unwrap();
        let address = server.local_addr();
        assert_eq!(address.ip(), std::net::Ipv4Addr::LOCALHOST);
        let metrics = server.metrics();
        let cancel = CancellationToken::new();
        let task = tokio::spawn(server.serve(cancel.clone()));
        let request = |origin: &str| {
            let mut request = format!("ws://{address}/api/v1/connect")
                .into_client_request()
                .unwrap();
            request
                .headers_mut()
                .insert("Origin", origin.parse().unwrap());
            request
        };
        for (header, value) in [
            ("Origin", "https://example.com"),
            (
                "Origin",
                "chrome-extension://dbokmlpefliilbjldladbimlcfgbolhk.attacker",
            ),
            ("Host", "localhost:1234"),
        ] {
            let mut bad = request(chromeos_companion::PRODUCTION_EXTENSION_ORIGIN);
            bad.headers_mut().insert(header, value.parse().unwrap());
            assert!(connect_async(bad).await.is_err());
        }
        // Before authentication, idle HTTP peers are bounded independently of
        // the four upgraded application clients.
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut idle = Vec::new();
        for _ in 0..8 {
            idle.push(tokio::net::TcpStream::connect(address).await.unwrap());
        }
        let mut overflow = tokio::net::TcpStream::connect(address).await.unwrap();
        let mut byte = [0];
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(1), overflow.read(&mut byte))
                .await
                .unwrap()
                .unwrap(),
            0
        );
        // Slow headers cannot retain their slots indefinitely.
        for peer in &mut idle {
            assert_eq!(
                tokio::time::timeout(Duration::from_secs(6), peer.read(&mut byte))
                    .await
                    .unwrap()
                    .unwrap(),
                0
            );
        }
        let mut oversized = tokio::net::TcpStream::connect(address).await.unwrap();
        oversized
            .write_all(
                format!(
                    "GET /api/v1/connect HTTP/1.1\r\nHost: {address}\r\nX-Large: {}\r\n\r\n",
                    "x".repeat(32 * 1024)
                )
                .as_bytes(),
            )
            .await
            .unwrap();
        let mut refusal = [0; 1024];
        let size = tokio::time::timeout(Duration::from_secs(1), oversized.read(&mut refusal))
            .await
            .unwrap()
            .unwrap();
        assert!(String::from_utf8_lossy(&refusal[..size]).contains("431"));
        let hello = |credential: &str, id: usize| json!({"type":"connect", "api_version":1, "encoding":"json", "client_instance_id":format!("{id:032x}"), "token":credential});
        let (mut bad, _) = connect_async(request(chromeos_companion::PRODUCTION_EXTENSION_ORIGIN))
            .await
            .unwrap();
        bad.send(Message::Text(hello("wrong", 1).to_string().into()))
            .await
            .unwrap();
        let frame: Value =
            serde_json::from_str(&bad.next().await.unwrap().unwrap().into_text().unwrap()).unwrap();
        assert_eq!(frame["error"]["code"], "authentication_failed");
        drop(bad);
        let mut clients = Vec::new();
        for id in 1..=4 {
            let origin = if id % 2 == 0 {
                chromeos_companion::BETA_EXTENSION_ORIGIN
            } else {
                chromeos_companion::PRODUCTION_EXTENSION_ORIGIN
            };
            let (mut client, _) = connect_async(request(origin)).await.unwrap();
            // Even clients report an identity; client 3's is malformed, which
            // must not fail the handshake.
            let mut connect = hello(&token, id);
            if id % 2 == 0 {
                connect["client"] =
                    json!({"kind":"extension", "version":"1.1.6", "build_id":"0123abcd"});
            } else if id == 3 {
                connect["client"] = json!({"kind": 5, "version": "x".repeat(200)});
            }
            client
                .send(Message::Text(connect.to_string().into()))
                .await
                .unwrap();
            let frame: Value =
                serde_json::from_str(&client.next().await.unwrap().unwrap().into_text().unwrap())
                    .unwrap();
            assert_eq!(frame["hello"]["backend"]["kind"], "desktop");
            assert_eq!(frame["hello"]["backend"]["profile_id"], "default");
            assert_eq!(frame["hello"]["backend"]["instance_id"], "cd".repeat(16));
            client.send(Message::Text(json!({"type":"choose_download_root","call_id":"unsupported-picker","request":{}}).to_string().into())).await.unwrap();
            let refusal: Value =
                serde_json::from_str(&client.next().await.unwrap().unwrap().into_text().unwrap())
                    .unwrap();
            assert_eq!(refusal["error"]["code"], "invalid_call");
            // A call from a newer client is refused alone and counted.
            client.send(Message::Text(json!({"type":"call", "call_id":"future", "operation":{"type":"future_operation"}}).to_string().into())).await.unwrap();
            let refusal: Value =
                serde_json::from_str(&client.next().await.unwrap().unwrap().into_text().unwrap())
                    .unwrap();
            assert_eq!(refusal["error"]["message"], crate::UNSUPPORTED_CALL_MESSAGE);
            let capabilities = frame["hello"]["capabilities"].as_array().unwrap();
            assert!(!capabilities.contains(&json!("torrent_media")));
            assert!(!capabilities.contains(&json!("library_media")));
            client.send(Message::Text(json!({"type":"call", "call_id":"library", "operation":{"type":"open_view_set", "request":{"views":[{"type":"torrent_list", "view_id":"library", "delivery":{"kind":"immediate"}}],"options":{}}}}).to_string().into())).await.unwrap();
            let frame: Value =
                serde_json::from_str(&client.next().await.unwrap().unwrap().into_text().unwrap())
                    .unwrap();
            assert_eq!(frame["type"], "result", "{frame}");
            clients.push(client);
        }
        assert!(
            connect_async(request(chromeos_companion::PRODUCTION_EXTENSION_ORIGIN))
                .await
                .is_err()
        );
        let _idle_at_quit = tokio::net::TcpStream::connect(address).await.unwrap();
        cancel.cancel();
        // Drain close frames so cooperative writer shutdown is exercised.
        for mut client in clients {
            while let Some(Ok(frame)) = client.next().await {
                if frame.is_close() {
                    break;
                }
            }
        }
        tokio::time::timeout(Duration::from_secs(6), task)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(metrics.snapshot().active_connections, 0);
        assert_eq!(metrics.snapshot().active_connections_high_water, 4);
        assert_eq!(metrics.snapshot().rejected_authentication, 1);
        let clients = metrics.snapshot().clients;
        for key in ["extension 1.1.6", "unidentified"] {
            assert_eq!(clients[key].connections, 2, "{key}");
            assert_eq!(clients[key].unsupported_calls, 2, "{key}");
        }
        assert_eq!(clients.len(), 2);
        service.lock().await.shutdown().await.unwrap();
        drop(service);
        std::fs::remove_dir_all(root).unwrap();
    }
}
