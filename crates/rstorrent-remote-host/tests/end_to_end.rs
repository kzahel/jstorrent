use std::sync::Arc;
use std::time::Duration;

use base64::Engine as _;
use futures_util::{SinkExt, StreamExt};
use p256::ecdsa::signature::Signer as _;
use p256::ecdsa::{Signature, SigningKey};
use rcgen::{CertifiedKey, generate_simple_self_signed};
use rstorrent_gateway::{
    ApplicationClientFrame, ApplicationServerFrame, GatewayAuthentication, GatewayConfig, bind,
};
use rstorrent_remote_crypto::{
    AuthorizationChallenge, AuthorizationGeneration, ClientId, HostPin, P256PublicKey,
    P256Signature, ResumeContext, SecureChannel, authorization_metadata_digest,
    authorization_transcript, finish_client_login, finish_client_resume, start_client_login,
    start_client_resume,
};
use rstorrent_remote_host::{
    AUTHENTICATED_READY_MAGIC, AUTHENTICATION_SUCCEEDED_MAGIC, AUTHORIZATION_CHOICE_MAGIC,
    AuthenticationReady, AuthenticationSucceeded, AuthorizationChoice, HostGreeting,
    LOGIN_FINALIZATION, LOGIN_REQUEST, LOGIN_RESPONSE, RESUME_FINALIZATION, RESUME_RESPONSE,
    RemoteAccessOwner, RemoteControlOperation, RemoteControlOutcome, RemoteControlRequest,
    RemoteControlResponse, RemoteHostConfig, decode_control_response, decode_json_record,
    encode_control_request, encode_json_record, encode_resume_request, protocol_payload,
};
use rstorrent_remote_relay::{PAIRED_CONTROL, TlsProductRelayServer, encode_client_select};
use rstorrent_session::{
    ApiEncoding, ApplicationConfig, ApplicationService, ConfiguredStorageRoot, NetworkConfig,
    NetworkPolicy,
};
use tempfile::TempDir;
use tokio::sync::Mutex;
use tokio::time::timeout;
use tokio_rustls::rustls::pki_types::CertificateDer;
use tokio_rustls::rustls::{ClientConfig, RootCertStore};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::client::IntoClientRequest as _;
use tokio_tungstenite::{
    Connector, MaybeTlsStream, WebSocketStream, connect_async_tls_with_config,
};
use tokio_util::sync::CancellationToken;

const CLIENT_ORIGIN: &str = "https://localhost:7443";
const GATEWAY_ORIGIN: &str = "http://localhost:7444";
const USERNAME: &str = "alice-local";
const PASSPHRASE: &[u8] = b"correct horse battery staple";

type ClientSocket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

struct Harness {
    root: TempDir,
    certificate: Vec<u8>,
    relay_address: std::net::SocketAddr,
    relay: rstorrent_remote_relay::ProductRelay,
    relay_task: tokio::task::JoinHandle<()>,
    gateway_shutdown: CancellationToken,
    gateway_task: tokio::task::JoinHandle<()>,
    service: Arc<Mutex<ApplicationService>>,
    owner: RemoteAccessOwner,
}

struct PasswordClient {
    socket: ClientSocket,
    channel: SecureChannel,
    binding: rstorrent_remote_crypto::Binding,
    pin: HostPin,
    ready: AuthenticationReady,
}

#[cfg(unix)]
#[tokio::test]
async fn private_browser_resumes_and_revocation_closes_its_application_circuit() {
    let harness = start_harness().await;
    wait_for(|| harness.relay.metrics().waiting_hosts == 1).await;

    let mut client = password_client(&harness, None).await;
    let client_key = SigningKey::from_slice(&[11; 32]).unwrap();
    let client_id = ClientId::new([12; 16]);
    let client_public = P256PublicKey::from_bytes(
        client_key
            .verifying_key()
            .to_encoded_point(false)
            .as_bytes(),
    )
    .unwrap();
    let host_resume_public =
        P256PublicKey::from_bytes(&decode::<65>(&client.ready.host_resume_public_key)).unwrap();
    let challenge = AuthorizationChallenge::new(decode(&client.ready.authorization_challenge));
    let digest = authorization_metadata_digest(
        "My browser",
        Some("test-client"),
        Some("relay"),
        Some("headless test"),
    );
    let transcript = authorization_transcript(
        &client.binding,
        client.pin,
        host_resume_public,
        AuthorizationGeneration::new(client.ready.authorization_generation),
        challenge,
        client_public,
        digest,
    );
    let signature: Signature = client_key.sign(&transcript);
    send_choice(
        &mut client,
        AuthorizationChoice::Private {
            client_id: encode(client_id.as_bytes()),
            client_public_key: encode(client_public.as_bytes()),
            signature: encode(signature.to_bytes().as_slice()),
            label: "My browser".to_owned(),
            client_build: Some("test-client".to_owned()),
            route_observation: Some("relay".to_owned()),
            browser_observation: Some("headless test".to_owned()),
        },
    )
    .await;
    let succeeded = authentication_succeeded(&mut client.socket, &mut client.channel).await;
    assert_eq!(
        succeeded.authorization.as_ref().unwrap().client_id,
        encode(client_id.as_bytes())
    );
    application_connect(&mut client.socket, &mut client.channel).await;
    let view = harness.owner.security_view().await.unwrap();
    assert_eq!(view.authority.as_ref().unwrap().clients.len(), 1);
    assert_eq!(view.live_circuits.len(), 1);
    let safe_view = serde_json::to_string(&view).unwrap();
    assert!(!safe_view.contains(std::str::from_utf8(PASSPHRASE).unwrap()));
    assert!(!safe_view.contains("internal-remote-gateway-token"));
    assert!(!safe_view.contains(&encode(client_public.as_bytes())));
    let inspected = remote_control(
        &mut client.socket,
        &mut client.channel,
        1,
        RemoteControlOperation::Inspect,
    )
    .await;
    let RemoteControlOutcome::Security { security } = inspected.outcome else {
        panic!("remote inspect returned the wrong result")
    };
    assert_eq!(security.authority.as_ref().unwrap().clients.len(), 1);
    assert_eq!(security.live_circuits.len(), 1);
    let renamed = remote_control(
        &mut client.socket,
        &mut client.channel,
        2,
        RemoteControlOperation::Rename {
            client_id: encode(client_id.as_bytes()),
            label: "Renamed browser".to_owned(),
        },
    )
    .await;
    assert_eq!(renamed.outcome, RemoteControlOutcome::Complete);
    assert_eq!(
        harness
            .owner
            .security_view()
            .await
            .unwrap()
            .authority
            .unwrap()
            .clients[0]
            .label,
        "Renamed browser"
    );

    let resume_context = ResumeContext::new(
        client.binding.clone(),
        client.pin,
        host_resume_public,
        client_id,
        client_public,
        AuthorizationGeneration::new(client.ready.authorization_generation),
        AuthorizationGeneration::new(1),
        client.ready.protocol_floor,
    );
    client
        .socket
        .send(Message::Binary(client.channel.seal_close().unwrap().into()))
        .await
        .unwrap();
    client.socket.close(None).await.unwrap();
    wait_for_async(|| async {
        harness
            .owner
            .security_view()
            .await
            .unwrap()
            .live_circuits
            .is_empty()
            && harness.relay.metrics().waiting_hosts == 1
    })
    .await;

    let (mut resumed_socket, greeting) = connect_routed(&harness).await;
    assert_eq!(greeting.relay_id, *client.binding.relay_id().as_bytes());
    assert_eq!(greeting.host_id, *client.binding.host_id().as_bytes());
    let resume = start_client_resume(resume_context, seed(21));
    resumed_socket
        .send(Message::Binary(
            encode_resume_request(client_id, resume.hello()).into(),
        ))
        .await
        .unwrap();
    let response = binary(&mut resumed_socket).await;
    let challenge = rstorrent_remote_crypto::ResumeServerChallenge::from_bytes(
        protocol_payload(&response, RESUME_RESPONSE).unwrap(),
    )
    .unwrap();
    let finish = finish_client_resume(resume, &challenge).unwrap();
    let resume_signature: Signature = client_key.sign(finish.client_signature_input());
    let proof = rstorrent_remote_crypto::ClientResumeFinish::proof(
        P256Signature::from_bytes(&resume_signature.to_bytes()).unwrap(),
    );
    let mut finalization = RESUME_FINALIZATION.to_vec();
    finalization.extend_from_slice(&proof.to_bytes());
    resumed_socket
        .send(Message::Binary(finalization.into()))
        .await
        .unwrap();
    let mut resumed_channel = finish.into_channel();
    let resumed = authentication_succeeded(&mut resumed_socket, &mut resumed_channel).await;
    assert_eq!(
        resumed.authorization.unwrap().client_id,
        encode(client_id.as_bytes())
    );
    application_connect(&mut resumed_socket, &mut resumed_channel).await;
    wait_for_async(|| async {
        harness
            .owner
            .security_view()
            .await
            .unwrap()
            .live_circuits
            .len()
            == 1
    })
    .await;

    let signed_out = remote_control(
        &mut resumed_socket,
        &mut resumed_channel,
        3,
        RemoteControlOperation::SignOutThisBrowser,
    )
    .await;
    assert_eq!(
        signed_out.outcome,
        RemoteControlOutcome::SignedOut {
            authorization_revoked: true
        }
    );
    let close_record = binary(&mut resumed_socket).await;
    assert!(resumed_channel.open(&close_record).unwrap().is_close);
    wait_for_async(|| async {
        harness
            .owner
            .security_view()
            .await
            .unwrap()
            .live_circuits
            .is_empty()
    })
    .await;
    let view = harness.owner.security_view().await.unwrap();
    assert!(view.authority.as_ref().unwrap().clients.is_empty());
    assert_eq!(view.authority.as_ref().unwrap().tombstones.len(), 1);
    assert!(
        view.authority
            .as_ref()
            .unwrap()
            .events
            .iter()
            .any(|event| event.kind == rstorrent_remote_access::EventKind::ResumeSucceeded)
    );

    stop_harness(harness).await;
}

#[cfg(unix)]
#[tokio::test]
async fn shared_browser_gets_application_access_without_durable_authorization() {
    let harness = start_harness().await;
    wait_for(|| harness.relay.metrics().waiting_hosts == 1).await;
    let mut client = password_client(&harness, None).await;
    send_choice(
        &mut client,
        AuthorizationChoice::Shared {
            client_build: Some("test-client".to_owned()),
        },
    )
    .await;
    let succeeded = authentication_succeeded(&mut client.socket, &mut client.channel).await;
    assert!(succeeded.authorization.is_none());
    application_connect(&mut client.socket, &mut client.channel).await;
    // A newer client's command this host cannot parse fails only that call.
    let unsupported = br#"{"type":"call","call_id":"future-1","operation":{"type":"dispatch","request":{"version":1,"request_id":"r-1","command":{"type":"future_command"}}}}"#;
    client
        .socket
        .send(Message::Binary(
            client.channel.seal(unsupported).unwrap().into(),
        ))
        .await
        .unwrap();
    let response = binary(&mut client.socket).await;
    let frame: ApplicationServerFrame =
        serde_json::from_slice(&client.channel.open(&response).unwrap().plaintext).unwrap();
    assert!(matches!(
        frame,
        ApplicationServerFrame::CallError { call_id, .. } if call_id == "future-1"
    ));
    let view = harness.owner.security_view().await.unwrap();
    assert!(view.authority.as_ref().unwrap().clients.is_empty());
    assert_eq!(view.live_circuits.len(), 1);
    assert_eq!(view.live_circuits[0].route, view.route.as_deref().unwrap());
    let circuit_id = view.live_circuits[0].circuit_id.clone();
    harness.owner.close_circuit(&circuit_id).await.unwrap();
    let close_record = binary(&mut client.socket).await;
    assert!(client.channel.open(&close_record).unwrap().is_close);
    wait_for_async(|| async {
        harness
            .owner
            .security_view()
            .await
            .unwrap()
            .live_circuits
            .is_empty()
    })
    .await;
    stop_harness(harness).await;
}

#[cfg(unix)]
#[tokio::test]
async fn operator_can_disable_clear_history_and_recover_the_local_route() {
    let harness = start_harness().await;
    wait_for(|| harness.relay.metrics().waiting_hosts == 1).await;

    let outcome = harness.owner.disable().await.unwrap();
    assert!(outcome.authority_file_removed);
    assert!(outcome.route_released);
    assert_eq!(harness.relay.metrics().registered_routes, 0);
    let disabled = harness.owner.security_view().await.unwrap();
    assert!(!disabled.enabled);
    assert!(disabled.authority.is_none());
    assert!(disabled.live_circuits.is_empty());
    assert!(
        disabled
            .retained_history
            .as_ref()
            .unwrap()
            .events
            .iter()
            .any(|event| event.kind == rstorrent_remote_access::EventKind::Disabled)
    );
    assert!(harness.owner.clear_history().await.unwrap());
    assert!(
        harness
            .owner
            .security_view()
            .await
            .unwrap()
            .retained_history
            .is_none()
    );

    let enabled = harness.owner.enable(USERNAME, PASSPHRASE).await.unwrap();
    assert!(enabled.enabled);
    wait_for(|| harness.relay.metrics().waiting_hosts == 1).await;
    assert_eq!(
        harness
            .owner
            .change_passphrase(b"replacement horse password")
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        harness.owner.require_password_everywhere().await.unwrap(),
        0
    );
    let reset = harness.owner.recover(USERNAME, PASSPHRASE).await.unwrap();
    assert!(reset.enabled);
    wait_for(|| harness.relay.metrics().waiting_hosts == 1).await;

    stop_harness(harness).await;
}

async fn start_harness() -> Harness {
    use std::os::unix::fs::PermissionsExt as _;

    let root = TempDir::new().unwrap();
    let certificate_path = root.path().join("relay-certificate.der");
    let private_key_path = root.path().join("relay-private-key.der");
    let CertifiedKey { cert, signing_key } =
        generate_simple_self_signed(["localhost".to_owned()]).unwrap();
    let certificate = cert.der().to_vec();
    std::fs::write(&certificate_path, &certificate).unwrap();
    std::fs::write(&private_key_path, signing_key.serialize_der()).unwrap();
    std::fs::set_permissions(&private_key_path, std::fs::Permissions::from_mode(0o600)).unwrap();
    let relay_server = TlsProductRelayServer::bind(
        "127.0.0.1:0".parse().unwrap(),
        root.path().join("relay-state"),
        CLIENT_ORIGIN,
        &certificate_path,
        &private_key_path,
    )
    .await
    .unwrap();
    let relay_address = relay_server.local_addr();
    let relay = relay_server.relay();
    let relay_task = tokio::spawn(async move { relay_server.serve().await.unwrap() });

    let payload_root = root.path().join("payload");
    std::fs::create_dir_all(&payload_root).unwrap();
    let service = Arc::new(Mutex::new(
        ApplicationService::open(ApplicationConfig::ephemeral(
            "remote-host-test".to_owned(),
            vec![ConfiguredStorageRoot::path("downloads", payload_root)],
            NetworkConfig::new(
                NetworkPolicy::LoopbackOnly,
                Duration::from_secs(1),
                Duration::from_secs(1),
            ),
        ))
        .await
        .unwrap(),
    ));
    let gateway_token = "internal-remote-gateway-token".to_owned();
    let gateway = bind(
        GatewayConfig {
            bind: "127.0.0.1:0".parse().unwrap(),
            authentication: GatewayAuthentication::Bearer {
                token: gateway_token.clone(),
            },
            allowed_origin: GATEWAY_ORIGIN.to_owned(),
            max_connections: 2,
        },
        service.clone(),
    )
    .await
    .unwrap();
    let gateway_address = gateway.local_addr();
    let gateway_shutdown = CancellationToken::new();
    let task_shutdown = gateway_shutdown.clone();
    let gateway_task = tokio::spawn(async move { gateway.serve(task_shutdown).await.unwrap() });

    let config = RemoteHostConfig::validation(
        &format!("https://localhost:{}/", relay_address.port()),
        certificate.clone(),
        format!("ws://127.0.0.1:{}/api/v1/connect", gateway_address.port()),
        GATEWAY_ORIGIN,
        gateway_token,
        "test-host",
    )
    .unwrap();
    let owner = RemoteAccessOwner::open(root.path().join("authority"), config)
        .await
        .unwrap();
    owner.enable(USERNAME, PASSPHRASE).await.unwrap();
    Harness {
        root,
        certificate,
        relay_address,
        relay,
        relay_task,
        gateway_shutdown,
        gateway_task,
        service,
        owner,
    }
}

async fn stop_harness(harness: Harness) {
    harness.owner.shutdown().await;
    harness.gateway_shutdown.cancel();
    harness.relay.shutdown();
    timeout(Duration::from_secs(3), harness.gateway_task)
        .await
        .unwrap()
        .unwrap();
    timeout(Duration::from_secs(3), harness.relay_task)
        .await
        .unwrap()
        .unwrap();
    harness.service.lock().await.shutdown().await.unwrap();
    drop(harness.service);
    harness.root.close().unwrap();
}

async fn password_client(harness: &Harness, expected_pin: Option<HostPin>) -> PasswordClient {
    let (mut socket, greeting) = connect_routed(harness).await;
    let binding = rstorrent_remote_crypto::Binding::new(
        rstorrent_remote_crypto::RelayId::new(greeting.relay_id),
        rstorrent_remote_crypto::Username::parse(USERNAME).unwrap(),
        rstorrent_remote_crypto::HostId::new(greeting.host_id),
    );
    let start = start_client_login(PASSPHRASE, seed(1)).unwrap();
    send_protocol(&mut socket, LOGIN_REQUEST, start.request()).await;
    let response = binary(&mut socket).await;
    let finish = finish_client_login(
        start,
        PASSPHRASE,
        &binding,
        expected_pin,
        protocol_payload(&response, LOGIN_RESPONSE).unwrap(),
        seed(2),
    )
    .unwrap();
    let (finalization, mut channel, pin) = finish.into_parts();
    send_protocol(&mut socket, LOGIN_FINALIZATION, &finalization).await;
    let ready_record = binary(&mut socket).await;
    let ready = channel.open(&ready_record).unwrap();
    let ready = decode_json_record(AUTHENTICATED_READY_MAGIC, &ready.plaintext).unwrap();
    PasswordClient {
        socket,
        channel,
        binding,
        pin,
        ready,
    }
}

async fn connect_routed(harness: &Harness) -> (ClientSocket, HostGreeting) {
    let mut roots = RootCertStore::empty();
    roots
        .add(CertificateDer::from(harness.certificate.clone()))
        .unwrap();
    let tls = ClientConfig::builder_with_provider(Arc::new(
        tokio_rustls::rustls::crypto::aws_lc_rs::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .unwrap()
    .with_root_certificates(roots)
    .with_no_client_auth();
    let mut request = format!("wss://localhost:{}/client", harness.relay_address.port())
        .into_client_request()
        .unwrap();
    request
        .headers_mut()
        .insert("origin", CLIENT_ORIGIN.parse().unwrap());
    let (mut socket, _) =
        connect_async_tls_with_config(request, None, false, Some(Connector::Rustls(Arc::new(tls))))
            .await
            .unwrap();
    socket
        .send(Message::Binary(
            encode_client_select(USERNAME).unwrap().into(),
        ))
        .await
        .unwrap();
    assert_eq!(binary(&mut socket).await, PAIRED_CONTROL);
    let greeting = HostGreeting::from_bytes(&binary(&mut socket).await).unwrap();
    (socket, greeting)
}

async fn send_choice(client: &mut PasswordClient, choice: AuthorizationChoice) {
    let plaintext = encode_json_record(AUTHORIZATION_CHOICE_MAGIC, &choice).unwrap();
    let record = client.channel.seal(&plaintext).unwrap();
    client
        .socket
        .send(Message::Binary(record.into()))
        .await
        .unwrap();
}

async fn authentication_succeeded(
    socket: &mut ClientSocket,
    channel: &mut SecureChannel,
) -> AuthenticationSucceeded {
    let record = binary(socket).await;
    let opened = channel.open(&record).unwrap();
    decode_json_record(AUTHENTICATION_SUCCEEDED_MAGIC, &opened.plaintext).unwrap()
}

async fn application_connect(socket: &mut ClientSocket, channel: &mut SecureChannel) {
    let connect = ApplicationClientFrame::Connect {
        api_version: 1,
        encoding: ApiEncoding::Json,
        client_instance_id: "00000000000000000000000000000001".to_owned(),
        token: None,
    };
    let plaintext = serde_json::to_vec(&connect).unwrap();
    socket
        .send(Message::Binary(channel.seal(&plaintext).unwrap().into()))
        .await
        .unwrap();
    let response = binary(socket).await;
    let opened = channel.open(&response).unwrap();
    let frame: ApplicationServerFrame = serde_json::from_slice(&opened.plaintext).unwrap();
    assert!(matches!(frame, ApplicationServerFrame::Connected { .. }));
}

async fn remote_control(
    socket: &mut ClientSocket,
    channel: &mut SecureChannel,
    request_id: u32,
    operation: RemoteControlOperation,
) -> RemoteControlResponse {
    let plaintext = encode_control_request(&RemoteControlRequest {
        request_id,
        operation,
    })
    .unwrap();
    socket
        .send(Message::Binary(channel.seal(&plaintext).unwrap().into()))
        .await
        .unwrap();
    let response = binary(socket).await;
    let opened = channel.open(&response).unwrap();
    decode_control_response(&opened.plaintext).unwrap()
}

async fn send_protocol(socket: &mut ClientSocket, magic: &[u8; 4], payload: &[u8]) {
    let mut message = magic.to_vec();
    message.extend_from_slice(payload);
    socket.send(Message::Binary(message.into())).await.unwrap();
}

async fn binary(socket: &mut ClientSocket) -> Vec<u8> {
    loop {
        match timeout(Duration::from_secs(3), socket.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap()
        {
            Message::Binary(bytes) => return bytes.to_vec(),
            Message::Ping(bytes) => socket.send(Message::Pong(bytes)).await.unwrap(),
            Message::Pong(_) => {}
            other => panic!("expected binary message, got {other:?}"),
        }
    }
}

fn seed(byte: u8) -> rstorrent_remote_crypto::OperationSeed {
    rstorrent_remote_crypto::OperationSeed::new([byte; 32])
}

fn encode(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn decode<const N: usize>(encoded: &str) -> [u8; N] {
    base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(encoded)
        .unwrap()
        .try_into()
        .unwrap()
}

async fn wait_for<F>(mut condition: F)
where
    F: FnMut() -> bool,
{
    timeout(Duration::from_secs(3), async {
        while !condition() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}

async fn wait_for_async<F, Fut>(mut condition: F)
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = bool>,
{
    timeout(Duration::from_secs(3), async {
        while !condition().await {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}
