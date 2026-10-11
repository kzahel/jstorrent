use std::future::Future;
use std::time::Duration;

use base64::Engine as _;
use futures_util::{SinkExt, StreamExt};
use p256::ecdsa::signature::Signer as _;
use p256::ecdsa::{Signature, SigningKey};
use rstorrent_remote_relay::{
    HOST_CHALLENGE_MAGIC, PAIRED_CONTROL, ProductRelay, ProductRelayOptions, ProductRelayServer,
    RELEASE_COMPLETE_MAGIC, ReserveRouteRequest, ReserveRouteResponse, encode_client_select,
    encode_host_proof, host_claim_transcript,
};
use tempfile::TempDir;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::client::IntoClientRequest as _;
use tokio_tungstenite::tungstenite::{Error as WebSocketError, Message};
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async};

const ORIGIN: &str = "https://127.0.0.1:7443";
const OPERATOR_TOKEN: &str = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";

type Socket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

struct RunningRelay {
    relay: ProductRelay,
    task: tokio::task::JoinHandle<()>,
    http_base: String,
    ws_base: String,
}

#[tokio::test]
async fn reserves_restarts_pairs_and_forwards_opaque_messages() {
    let root = TempDir::new().unwrap();
    let key = signing_key(7);
    let first = start(root.path()).await;
    let relay_id = reserve(&first, "alice", &key).await;
    assert_eq!(relay_id, first.relay.deployment_id());
    stop(first).await;

    let second = start(root.path()).await;
    assert_eq!(second.relay.deployment_id(), relay_id);
    assert_eq!(reserve(&second, "alice", &key).await, relay_id);
    assert_eq!(second.relay.metrics().registered_routes, 1);
    assert_eq!(second.relay.metrics().idempotent_reservations, 1);

    let mut host = claim(&second, "alice", &key, false).await.0;
    wait_for(|| second.relay.metrics().waiting_hosts == 1).await;
    let mut client = connect_client(&second, Some(ORIGIN)).await.unwrap();
    client
        .send(Message::Binary(
            encode_client_select("alice").unwrap().into(),
        ))
        .await
        .unwrap();
    assert_eq!(binary(&mut host).await, PAIRED_CONTROL);
    assert_eq!(binary(&mut client).await, PAIRED_CONTROL);

    client
        .send(Message::Binary(vec![1, 2, 3].into()))
        .await
        .unwrap();
    assert_eq!(binary(&mut host).await, [1, 2, 3]);
    host.send(Message::Binary(vec![4, 5].into())).await.unwrap();
    assert_eq!(binary(&mut client).await, [4, 5]);
    client.close(None).await.unwrap();
    wait_for(|| second.relay.metrics().active_circuits == 0).await;

    let metrics = second.relay.metrics();
    assert_eq!(metrics.registered_routes_high_water, 1);
    assert_eq!(metrics.active_circuits_high_water, 1);
    assert_eq!(metrics.active_pumps_high_water, 2);
    assert_eq!(metrics.forwarded_client_bytes, 3);
    assert_eq!(metrics.forwarded_host_bytes, 2);
    stop(second).await;
}

#[tokio::test]
async fn wrong_key_and_replayed_proof_cannot_replace_waiting_host() {
    let root = TempDir::new().unwrap();
    let relay = start(root.path()).await;
    let key = signing_key(7);
    reserve(&relay, "alice", &key).await;

    let (mut original, _, _) = claim(&relay, "alice", &key, false).await;
    wait_for(|| relay.relay.metrics().waiting_hosts == 1).await;

    let mut attacker = connect_host(&relay, "alice").await;
    let (_, attacker_challenge) = challenge(&mut attacker).await;
    let wrong_key = signing_key(8);
    let proof = proof(
        &wrong_key,
        relay.relay.deployment_id(),
        "alice",
        attacker_challenge,
        false,
    );
    attacker.send(Message::Binary(proof.into())).await.unwrap();
    assert_close(&mut attacker, 4_003).await;
    assert_eq!(relay.relay.metrics().waiting_hosts, 1);

    let mut client = connect_client(&relay, Some(ORIGIN)).await.unwrap();
    client
        .send(Message::Binary(
            encode_client_select("alice").unwrap().into(),
        ))
        .await
        .unwrap();
    assert_eq!(binary(&mut original).await, PAIRED_CONTROL);
    assert_eq!(binary(&mut client).await, PAIRED_CONTROL);
    client.close(None).await.unwrap();
    wait_for(|| relay.relay.metrics().active_circuits == 0).await;

    let (mut previous, old_challenge, old_proof) = claim(&relay, "alice", &key, false).await;
    wait_for(|| relay.relay.metrics().waiting_hosts == 1).await;
    previous.close(None).await.unwrap();
    wait_for(|| relay.relay.metrics().waiting_hosts == 0).await;
    let mut replay = connect_host(&relay, "alice").await;
    let (_, fresh_challenge) = challenge(&mut replay).await;
    replay
        .send(Message::Binary(old_proof.into()))
        .await
        .unwrap();
    assert_close(&mut replay, 4_003).await;
    assert_ne!(fresh_challenge, old_challenge);
    assert_eq!(relay.relay.metrics().rejected_host_claims, 2);
    stop(relay).await;
}

#[tokio::test]
async fn exact_origin_is_required_and_release_is_signed_and_durable() {
    let root = TempDir::new().unwrap();
    let relay = start(root.path()).await;
    let key = signing_key(7);
    reserve(&relay, "alice", &key).await;

    assert!(matches!(
        connect_client(&relay, None).await,
        Err(WebSocketError::Http(response)) if response.status() == 404
    ));
    assert!(matches!(
        connect_client(&relay, Some("https://localhost:7443")).await,
        Err(WebSocketError::Http(response)) if response.status() == 404
    ));

    let (mut release, _, _) = claim(&relay, "alice", &key, true).await;
    assert_eq!(binary(&mut release).await, RELEASE_COMPLETE_MAGIC);
    wait_for(|| relay.relay.metrics().registered_routes == 0).await;
    assert_eq!(relay.relay.metrics().released_routes, 1);
    stop(relay).await;

    let restarted = start(root.path()).await;
    assert_eq!(restarted.relay.metrics().registered_routes, 0);
    stop(restarted).await;
}

#[tokio::test]
async fn reservation_conflicts_and_public_failures_are_indistinguishable() {
    let root = TempDir::new().unwrap();
    let relay = start(root.path()).await;
    let key = signing_key(7);
    reserve(&relay, "alice", &key).await;

    let status = reserve_status(&relay, "alice", &signing_key(8)).await;
    assert_eq!(status, reqwest::StatusCode::NOT_FOUND);
    let status = reserve_status(&relay, "Unknown", &key).await;
    assert_eq!(status, reqwest::StatusCode::NOT_FOUND);
    let mut unknown = connect_host(&relay, "nobody").await;
    let (_, unknown_challenge) = challenge(&mut unknown).await;
    let unknown_proof = proof(
        &key,
        relay.relay.deployment_id(),
        "nobody",
        unknown_challenge,
        false,
    );
    unknown
        .send(Message::Binary(unknown_proof.into()))
        .await
        .unwrap();
    assert_close(&mut unknown, 4_003).await;

    let response = reqwest::Client::new()
        .post(format!("{}/v1/reservations", relay.http_base))
        .header("content-type", "application/json")
        .body("not json")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::NOT_FOUND);
    stop(relay).await;
}

#[cfg(unix)]
#[tokio::test]
async fn state_is_owner_only_and_corruption_fails_closed() {
    use std::os::unix::fs::PermissionsExt as _;

    let root = TempDir::new().unwrap();
    let relay = start(root.path()).await;
    stop(relay).await;
    let state = root.path().join("relay-state-v1.json");
    assert_eq!(
        std::fs::metadata(root.path()).unwrap().permissions().mode() & 0o777,
        0o700
    );
    assert_eq!(
        std::fs::metadata(&state).unwrap().permissions().mode() & 0o777,
        0o600
    );

    std::fs::write(&state, b"not relay state").unwrap();
    std::fs::set_permissions(&state, std::fs::Permissions::from_mode(0o600)).unwrap();
    let error = ProductRelay::open(root.path(), ORIGIN).unwrap_err();
    assert!(error.to_string().contains("state is invalid"));
}

#[tokio::test]
async fn non_loopback_bind_and_non_https_origin_are_rejected() {
    let root = TempDir::new().unwrap();
    assert!(
        ProductRelayServer::bind("0.0.0.0:0".parse().unwrap(), root.path(), ORIGIN)
            .await
            .is_err()
    );
    assert!(ProductRelay::open(root.path(), "http://127.0.0.1:7443").is_err());
}

#[tokio::test]
async fn production_proxy_health_operator_metrics_and_kill_switch_are_bounded() {
    let root = TempDir::new().unwrap();
    let options =
        ProductRelayOptions::production("127.0.0.1".parse().unwrap(), OPERATOR_TOKEN.to_owned())
            .unwrap();
    let server =
        ProductRelayServer::bind_with_options("127.0.0.1:0".parse().unwrap(), root.path(), options)
            .await
            .unwrap();
    let address = server.local_addr();
    let relay = server.relay();
    let task = tokio::spawn(async move { server.serve().await.unwrap() });
    let base = format!("http://{address}");
    let client = reqwest::Client::new();

    let health = client.get(format!("{base}/healthz")).send().await.unwrap();
    assert_eq!(health.status(), reqwest::StatusCode::OK);
    assert_eq!(health.text().await.unwrap(), r#"{"status":"ok"}"#);
    // Real upgrades exercise the configured production origin, not just URL
    // validation. The trusted proxy supplies an independently checked source.
    for origin in [
        "https://rstorrent.com",
        "https://www.jstorrent.com",
        "https://jstorrent.com:444",
        "https://jstorrent.com.evil.test",
    ] {
        let mut request = format!("ws://{address}/client")
            .into_client_request()
            .unwrap();
        request
            .headers_mut()
            .insert("origin", origin.parse().unwrap());
        request
            .headers_mut()
            .insert("x-rstorrent-client-ip", "198.51.100.7".parse().unwrap());
        assert!(
            matches!(
                connect_async(request).await,
                Err(WebSocketError::Http(response)) if response.status() == 404
            ),
            "accepted {origin}"
        );
    }
    let mut request = format!("ws://{address}/client")
        .into_client_request()
        .unwrap();
    request
        .headers_mut()
        .insert("origin", "https://jstorrent.com".parse().unwrap());
    request
        .headers_mut()
        .insert("x-rstorrent-client-ip", "198.51.100.7".parse().unwrap());
    let (mut controller, response) = connect_async(request).await.unwrap();
    assert_eq!(response.status(), 101);
    controller.close(None).await.unwrap();
    assert_eq!(
        client
            .get(format!("{base}/operator/v1/status"))
            .send()
            .await
            .unwrap()
            .status(),
        reqwest::StatusCode::NOT_FOUND
    );

    let key = signing_key(9);
    let public_key = key.verifying_key().to_encoded_point(false);
    let reservation = serde_json::to_vec(&ReserveRouteRequest {
        username: "proxy-owner".to_owned(),
        public_key: base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(public_key.as_bytes()),
    })
    .unwrap();
    assert_eq!(
        client
            .post(format!("{base}/v1/reservations"))
            .header("content-type", "application/json")
            .body(reservation.clone())
            .send()
            .await
            .unwrap()
            .status(),
        reqwest::StatusCode::NOT_FOUND
    );
    assert_eq!(
        client
            .post(format!("{base}/v1/reservations"))
            .header("content-type", "application/json")
            .header("x-rstorrent-client-ip", "198.51.100.7")
            .body(reservation.clone())
            .send()
            .await
            .unwrap()
            .status(),
        reqwest::StatusCode::CREATED
    );

    let disabled = client
        .put(format!("{base}/operator/v1/admission"))
        .bearer_auth(OPERATOR_TOKEN)
        .header("content-type", "application/json")
        .body(r#"{"accepting":false}"#)
        .send()
        .await
        .unwrap();
    assert_eq!(disabled.status(), reqwest::StatusCode::OK);
    let disabled: serde_json::Value =
        serde_json::from_str(&disabled.text().await.unwrap()).unwrap();
    assert_eq!(disabled["accepting"], false);
    assert_eq!(disabled["metrics"]["registered_routes"], 1);
    assert!(disabled.get("deployment_id").is_none());
    assert_eq!(
        client
            .post(format!("{base}/v1/reservations"))
            .header("content-type", "application/json")
            .header("x-rstorrent-client-ip", "198.51.100.7")
            .body(reservation.clone())
            .send()
            .await
            .unwrap()
            .status(),
        reqwest::StatusCode::NOT_FOUND
    );

    let enabled = client
        .put(format!("{base}/operator/v1/admission"))
        .bearer_auth(OPERATOR_TOKEN)
        .header("content-type", "application/json")
        .body(r#"{"accepting":true}"#)
        .send()
        .await
        .unwrap();
    assert_eq!(enabled.status(), reqwest::StatusCode::OK);
    assert_eq!(
        client
            .post(format!("{base}/v1/reservations"))
            .header("content-type", "application/json")
            .header("x-rstorrent-client-ip", "198.51.100.7")
            .body(reservation)
            .send()
            .await
            .unwrap()
            .status(),
        reqwest::StatusCode::OK
    );

    relay.shutdown();
    timeout(Duration::from_secs(2), task)
        .await
        .unwrap()
        .unwrap();
}

async fn start(root: &std::path::Path) -> RunningRelay {
    let server = ProductRelayServer::bind_loopback(root, ORIGIN)
        .await
        .unwrap();
    let address = server.local_addr();
    let relay = server.relay();
    let task = tokio::spawn(async move { server.serve().await.unwrap() });
    RunningRelay {
        relay,
        task,
        http_base: format!("http://{address}"),
        ws_base: format!("ws://{address}"),
    }
}

async fn stop(running: RunningRelay) {
    running.relay.shutdown();
    timeout(Duration::from_secs(2), running.task)
        .await
        .unwrap()
        .unwrap();
}

fn signing_key(byte: u8) -> SigningKey {
    SigningKey::from_slice(&[byte; 32]).unwrap()
}

async fn reserve(relay: &RunningRelay, username: &str, key: &SigningKey) -> [u8; 32] {
    let response = reservation_response(relay, username, key).await;
    assert!(response.status().is_success());
    let body: ReserveRouteResponse = serde_json::from_str(&response.text().await.unwrap()).unwrap();
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(body.relay_id)
        .unwrap();
    bytes.try_into().unwrap()
}

async fn reserve_status(
    relay: &RunningRelay,
    username: &str,
    key: &SigningKey,
) -> reqwest::StatusCode {
    reservation_response(relay, username, key).await.status()
}

async fn reservation_response(
    relay: &RunningRelay,
    username: &str,
    key: &SigningKey,
) -> reqwest::Response {
    let public_key = key.verifying_key().to_encoded_point(false);
    let request = ReserveRouteRequest {
        username: username.to_owned(),
        public_key: base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(public_key.as_bytes()),
    };
    reqwest::Client::new()
        .post(format!("{}/v1/reservations", relay.http_base))
        .header("content-type", "application/json")
        .body(serde_json::to_vec(&request).unwrap())
        .send()
        .await
        .unwrap()
}

async fn connect_host(relay: &RunningRelay, username: &str) -> Socket {
    connect_async(format!("{}/host/{username}", relay.ws_base))
        .await
        .unwrap()
        .0
}

async fn connect_client(
    relay: &RunningRelay,
    origin: Option<&str>,
) -> Result<Socket, WebSocketError> {
    let mut request = format!("{}/client", relay.ws_base)
        .into_client_request()
        .unwrap();
    if let Some(origin) = origin {
        request
            .headers_mut()
            .insert("origin", origin.parse().unwrap());
    }
    connect_async(request).await.map(|connected| connected.0)
}

async fn claim(
    relay: &RunningRelay,
    username: &str,
    key: &SigningKey,
    release: bool,
) -> (Socket, [u8; 32], Vec<u8>) {
    let path = if release {
        format!("{}/v1/release/{username}", relay.ws_base)
    } else {
        format!("{}/host/{username}", relay.ws_base)
    };
    let mut socket = connect_async(path).await.unwrap().0;
    let (_, challenge) = challenge(&mut socket).await;
    let proof = proof(
        key,
        relay.relay.deployment_id(),
        username,
        challenge,
        release,
    );
    socket
        .send(Message::Binary(proof.clone().into()))
        .await
        .unwrap();
    (socket, challenge, proof)
}

async fn challenge(socket: &mut Socket) -> ([u8; 32], [u8; 32]) {
    let bytes = binary(socket).await;
    assert_eq!(&bytes[..4], HOST_CHALLENGE_MAGIC);
    assert_eq!(bytes.len(), 68);
    (
        bytes[4..36].try_into().unwrap(),
        bytes[36..68].try_into().unwrap(),
    )
}

fn proof(
    key: &SigningKey,
    relay_id: [u8; 32],
    username: &str,
    challenge: [u8; 32],
    release: bool,
) -> Vec<u8> {
    let transcript = host_claim_transcript(relay_id, username, challenge, release).unwrap();
    let signature: Signature = key.sign(&transcript);
    encode_host_proof(signature.to_bytes().as_slice()).unwrap()
}

async fn binary(socket: &mut Socket) -> Vec<u8> {
    match timeout(Duration::from_secs(2), socket.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap()
    {
        Message::Binary(bytes) => bytes.to_vec(),
        other => panic!("expected binary message, got {other:?}"),
    }
}

async fn assert_close(socket: &mut Socket, expected_code: u16) {
    match timeout(Duration::from_secs(2), socket.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap()
    {
        Message::Close(Some(frame)) => assert_eq!(u16::from(frame.code), expected_code),
        other => panic!("expected close frame, got {other:?}"),
    }
}

async fn wait_for<F>(mut condition: F)
where
    F: FnMut() -> bool,
{
    wait_for_async(|| std::future::ready(condition())).await;
}

async fn wait_for_async<F, Fut>(mut condition: F)
where
    F: FnMut() -> Fut,
    Fut: Future<Output = bool>,
{
    timeout(Duration::from_secs(2), async {
        while !condition().await {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}
