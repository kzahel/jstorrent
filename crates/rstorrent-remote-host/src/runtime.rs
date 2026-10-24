use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use rstorrent_gateway::{ApplicationClientFrame, ApplicationServerFrame, unsupported_call_id};
use rstorrent_remote_access::{
    AuthenticationMethod, AuthorizationMetadata, AuthorizationRequest, FailedAttemptKind,
};
use rstorrent_remote_crypto::{
    AuthorizationChallenge, ClientId, ClientResumeProof, P256PublicKey, P256Signature,
    ResumeClientHello, SecureChannel, finish_server_login, random_operation_seed,
    start_server_login,
};
use rstorrent_remote_relay::{
    HOST_CHALLENGE_MAGIC, PAIRED_CONTROL, encode_host_proof, host_claim_transcript,
};
use rstorrent_session::{ApplicationCall, ApplicationCallResult};
use tokio_tungstenite::tungstenite::client::IntoClientRequest as _;
use tokio_tungstenite::tungstenite::{self, Message};
use tokio_tungstenite::{
    MaybeTlsStream, WebSocketStream, connect_async, connect_async_tls_with_config,
};
use tokio_util::sync::CancellationToken;

use crate::error::Result;
use crate::owner::{LiveCircuit, SharedOwner, now, random_array, random_event_id, random_seed};
use crate::wire::{
    AUTHENTICATED_READY_MAGIC, AUTHENTICATION_SUCCEEDED_MAGIC, AUTHORIZATION_CHOICE_MAGIC,
    AuthenticationReady, AuthenticationSucceeded, AuthorizationChoice, AuthorizationSucceeded,
    HostGreeting, LOGIN_FINALIZATION, LOGIN_REQUEST, LOGIN_RESPONSE, REMOTE_CONTROL_REQUEST_MAGIC,
    RESUME_FINALIZATION, RESUME_RESPONSE, RemoteControlOperation, RemoteControlOutcome,
    RemoteControlResponse, decode_control_request, decode_id, decode_json_record,
    decode_resume_request, encode_control_response, encode_id, encode_json_record,
    protocol_payload,
};
use crate::{RESUME_REQUEST, RemoteHostError};

#[cfg(feature = "direct-file-webrtc")]
use crate::wire::{
    DIRECT_FILE_REQUEST_MAGIC, DirectFileCloseOutcome, DirectFileFailure, DirectFileRequest,
    DirectFileResponse, DirectSdpType, decode_direct_file_request, encode_direct_file_response,
};

const HANDSHAKE_DEADLINE: Duration = Duration::from_secs(20);
const CIRCUIT_LIFETIME: Duration = Duration::from_secs(24 * 60 * 60);
const RECONNECT_DELAY: Duration = Duration::from_millis(250);
const HANDSHAKE_MESSAGE_BYTES: usize = 4 * 1024;

type RelaySocket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

struct AuthenticatedCircuit {
    channel: SecureChannel,
    client_id: Option<ClientId>,
    method: AuthenticationMethod,
    circuit_id: [u8; 16],
    cancellation: CancellationToken,
    success: AuthenticationSucceeded,
    connection_generation: u64,
}

pub(crate) async fn run_host(owner: Arc<SharedOwner>, cancellation: CancellationToken) {
    while !cancellation.is_cancelled() && !owner.shutdown.is_cancelled() {
        let route = {
            let state = owner.state.lock().await;
            state
                .authority
                .as_ref()
                .map(|authority| authority.route().to_owned())
        };
        let Some(route) = route else {
            break;
        };
        let path = format!("/host/{route}");
        let relay_url = match owner.config.relay_websocket_url(&path) {
            Ok(url) => url,
            Err(_) => break,
        };
        let connection = tokio::select! {
            () = cancellation.cancelled() => break,
            () = owner.shutdown.cancelled() => break,
            connection = connect_async_tls_with_config(
                relay_url,
                None,
                false,
                Some(owner.config.relay_connector()),
            ) => connection,
        };
        let Ok((mut relay, _)) = connection else {
            reconnect_delay(&owner, &cancellation).await;
            continue;
        };
        if claim_route(&owner, &route, &mut relay).await.is_err() {
            let _ = relay.close(None).await;
            reconnect_delay(&owner, &cancellation).await;
            continue;
        }
        let paired = tokio::select! {
            () = cancellation.cancelled() => None,
            () = owner.shutdown.cancelled() => None,
            paired = next_binary(&mut relay) => paired.ok(),
        };
        if paired.as_deref() != Some(PAIRED_CONTROL) {
            let _ = relay.close(None).await;
            reconnect_delay(&owner, &cancellation).await;
            continue;
        }
        let greeting = {
            let state = owner.state.lock().await;
            let Some(authority) = state.authority.as_ref() else {
                break;
            };
            HostGreeting {
                relay_id: *authority.binding().relay_id().as_bytes(),
                host_id: *authority.binding().host_id().as_bytes(),
                protocol_version: advertised_protocol(&owner),
            }
            .to_bytes()
        };
        if relay
            .send(Message::Binary(greeting.to_vec().into()))
            .await
            .is_err()
        {
            reconnect_delay(&owner, &cancellation).await;
            continue;
        }

        let authenticated =
            tokio::time::timeout(HANDSHAKE_DEADLINE, authenticate(&owner, &mut relay)).await;
        let Ok(Ok(mut circuit)) = authenticated else {
            let _ = relay.close(None).await;
            reconnect_delay(&owner, &cancellation).await;
            continue;
        };
        let succeeded = match encode_json_record(AUTHENTICATION_SUCCEEDED_MAGIC, &circuit.success)
            .and_then(|plaintext| {
                circuit
                    .channel
                    .seal(&plaintext)
                    .map_err(|_| RemoteHostError::Protocol)
            }) {
            Ok(record) => relay.send(Message::Binary(record.into())).await.is_ok(),
            Err(_) => false,
        };
        let close_reason = if succeeded {
            match bridge_application(
                &owner,
                &mut relay,
                &mut circuit.channel,
                circuit.circuit_id,
                circuit.client_id,
                circuit.connection_generation,
                &circuit.cancellation,
                &cancellation,
            )
            .await
            {
                Ok(()) => "closed",
                Err(_) => "transport_error",
            }
        } else {
            "authentication_delivery"
        };
        close_circuit(&owner, &circuit, close_reason).await;
        let _ = relay.close(None).await;
        reconnect_delay(&owner, &cancellation).await;
    }
}

async fn claim_route(owner: &SharedOwner, route: &str, relay: &mut RelaySocket) -> Result<()> {
    let challenge = next_binary(relay).await?;
    if challenge.len() != 68 || &challenge[..4] != HOST_CHALLENGE_MAGIC {
        return Err(RemoteHostError::Relay);
    }
    let relay_id: [u8; 32] = challenge[4..36]
        .try_into()
        .map_err(|_| RemoteHostError::Relay)?;
    let nonce: [u8; 32] = challenge[36..]
        .try_into()
        .map_err(|_| RemoteHostError::Relay)?;
    let transcript =
        host_claim_transcript(relay_id, route, nonce, false).map_err(|_| RemoteHostError::Relay)?;
    let signature = {
        let state = owner.state.lock().await;
        let authority = state.authority.as_ref().ok_or(RemoteHostError::Relay)?;
        if authority.binding().relay_id().as_bytes() != &relay_id {
            return Err(RemoteHostError::Relay);
        }
        authority.sign_relay_transcript(&transcript)
    };
    relay
        .send(Message::Binary(
            encode_host_proof(signature.as_bytes())
                .map_err(|_| RemoteHostError::Relay)?
                .into(),
        ))
        .await
        .map_err(|_| RemoteHostError::Relay)
}

async fn authenticate(
    owner: &Arc<SharedOwner>,
    relay: &mut RelaySocket,
) -> Result<AuthenticatedCircuit> {
    let initial = next_binary(relay).await?;
    if initial.starts_with(LOGIN_REQUEST) {
        authenticate_password(owner, relay, &initial).await
    } else if initial.starts_with(RESUME_REQUEST) {
        authenticate_resume(owner, relay, &initial).await
    } else {
        Err(RemoteHostError::Protocol)
    }
}

async fn authenticate_password(
    owner: &Arc<SharedOwner>,
    relay: &mut RelaySocket,
    initial: &[u8],
) -> Result<AuthenticatedCircuit> {
    let request = protocol_payload(initial, LOGIN_REQUEST)?;
    let login = {
        let state = owner.state.lock().await;
        let authority = state.authority.as_ref().ok_or(RemoteHostError::Protocol)?;
        start_server_login(
            authority.opaque_authority(),
            Some(authority.password_file()),
            authority.binding(),
            request,
            random_operation_seed().map_err(|_| RemoteHostError::Protocol)?,
        )
        .map_err(|_| RemoteHostError::Protocol)?
    };
    send_protocol(relay, LOGIN_RESPONSE, login.response()).await?;
    let finalization = next_binary(relay).await?;
    let finalization = protocol_payload(&finalization, LOGIN_FINALIZATION)?;
    let mut channel = match finish_server_login(login, finalization) {
        Ok(channel) => channel,
        Err(_) => {
            record_failed(owner, FailedAttemptKind::Password).await;
            return Err(RemoteHostError::Protocol);
        }
    };
    let authorization_challenge = AuthorizationChallenge::new(random_array()?);
    let ready = {
        let state = owner.state.lock().await;
        let authority = state.authority.as_ref().ok_or(RemoteHostError::Protocol)?;
        AuthenticationReady {
            protocol_version: advertised_protocol(owner),
            host_build: owner.config.host_build().to_owned(),
            host_pin: encode_id(&authority.host_pin().to_bytes()),
            host_resume_public_key: encode_id(authority.host_resume_key().public_key().as_bytes()),
            authorization_generation: authority.authorization_generation().get(),
            authorization_challenge: encode_id(authorization_challenge.as_bytes()),
            protocol_floor: authority.protocol_floor(),
        }
    };
    send_encrypted_json(relay, &mut channel, AUTHENTICATED_READY_MAGIC, &ready).await?;
    let choice_record = next_binary(relay).await?;
    let choice =
        open_json::<AuthorizationChoice>(&mut channel, AUTHORIZATION_CHOICE_MAGIC, &choice_record)?;

    let circuit_id = random_array()?;
    let circuit_cancellation = CancellationToken::new();
    let started = now();
    let generation = owner.connection_generation();
    let (client_id, authorization) = match choice {
        AuthorizationChoice::Shared { client_build } => {
            let login_event = random_event_id()?;
            let open_event = random_event_id()?;
            let mut state = owner.state.lock().await;
            let authority = state.authority.as_mut().ok_or(RemoteHostError::Protocol)?;
            let route = authority.route().to_owned();
            owner.store.update(authority, |candidate| {
                candidate.record_full_login(None, started, login_event, client_build)?;
                candidate.record_circuit_event(
                    true,
                    None,
                    circuit_id,
                    AuthenticationMethod::Password,
                    started,
                    open_event,
                    None,
                )
            })?;
            state.circuits.insert(
                circuit_id,
                LiveCircuit {
                    client_id: None,
                    authentication_method: AuthenticationMethod::Password,
                    connection_generation: generation,
                    started,
                    last_activity: started,
                    route,
                    cancellation: circuit_cancellation.clone(),
                },
            );
            (None, None)
        }
        AuthorizationChoice::Private {
            client_id,
            client_public_key,
            signature,
            label,
            client_build,
            route_observation,
            browser_observation,
        } => {
            let client_id = ClientId::new(decode_id(&client_id)?);
            let public_key = P256PublicKey::from_bytes(&decode_id::<65>(&client_public_key)?)
                .map_err(|_| RemoteHostError::Protocol)?;
            let signature = P256Signature::from_bytes(&decode_id::<64>(&signature)?)
                .map_err(|_| RemoteHostError::Protocol)?;
            let metadata = AuthorizationMetadata::new(
                label,
                client_build.clone(),
                route_observation,
                browser_observation,
            )?;
            let authorize_event = random_event_id()?;
            let login_event = random_event_id()?;
            let open_event = random_event_id()?;
            let mut state = owner.state.lock().await;
            let authority = state.authority.as_mut().ok_or(RemoteHostError::Protocol)?;
            let route = authority.route().to_owned();
            let fingerprint = owner.store.update(authority, |candidate| {
                candidate.authorize_client(AuthorizationRequest::new(
                    client_id,
                    public_key,
                    authorization_challenge,
                    signature,
                    metadata,
                    started,
                    authorize_event,
                ))?;
                candidate.record_full_login(Some(client_id), started, login_event, client_build)?;
                candidate.record_circuit_event(
                    true,
                    Some(client_id),
                    circuit_id,
                    AuthenticationMethod::Password,
                    started,
                    open_event,
                    None,
                )?;
                candidate
                    .security_snapshot()
                    .clients
                    .into_iter()
                    .find(|client| client.client_id == encode_id(client_id.as_bytes()))
                    .map(|client| client.fingerprint)
                    .ok_or(rstorrent_remote_access::RemoteAccessError::NotFound)
            })?;
            state.circuits.insert(
                circuit_id,
                LiveCircuit {
                    client_id: Some(client_id),
                    authentication_method: AuthenticationMethod::Password,
                    connection_generation: generation,
                    started,
                    last_activity: started,
                    route,
                    cancellation: circuit_cancellation.clone(),
                },
            );
            (
                Some(client_id),
                Some(AuthorizationSucceeded {
                    client_id: encode_id(client_id.as_bytes()),
                    fingerprint,
                }),
            )
        }
    };
    Ok(AuthenticatedCircuit {
        channel,
        client_id,
        method: AuthenticationMethod::Password,
        circuit_id,
        cancellation: circuit_cancellation,
        success: AuthenticationSucceeded {
            protocol_version: advertised_protocol(owner),
            authorization,
            capabilities: advertised_capabilities(owner),
            circuit_id: (advertised_protocol(owner) >= 2).then(|| encode_id(circuit_id.as_slice())),
            connection_generation: (advertised_protocol(owner) >= 2).then_some(generation),
        },
        connection_generation: generation,
    })
}

async fn authenticate_resume(
    owner: &Arc<SharedOwner>,
    relay: &mut RelaySocket,
    initial: &[u8],
) -> Result<AuthenticatedCircuit> {
    let (client_id, hello): (ClientId, ResumeClientHello) = decode_resume_request(initial)?;
    let pending = {
        let state = owner.state.lock().await;
        let authority = state.authority.as_ref().ok_or(RemoteHostError::Protocol)?;
        authority.begin_resume(client_id, &hello, now(), random_seed()?)
    };
    let pending = match pending {
        Ok(pending) => pending,
        Err(_) => {
            record_failed(owner, FailedAttemptKind::Resume).await;
            return Err(RemoteHostError::Protocol);
        }
    };
    send_protocol(relay, RESUME_RESPONSE, &pending.challenge().to_bytes()).await?;
    let proof = next_binary(relay).await?;
    let proof = ClientResumeProof::from_bytes(protocol_payload(&proof, RESUME_FINALIZATION)?)
        .map_err(|_| RemoteHostError::Protocol)?;
    let circuit_id = random_array()?;
    let circuit_cancellation = CancellationToken::new();
    let started = now();
    let resume_event = random_event_id()?;
    let open_event = random_event_id()?;
    let generation = owner.connection_generation();
    let mut state = owner.state.lock().await;
    let authority = state.authority.as_mut().ok_or(RemoteHostError::Protocol)?;
    let route = authority.route().to_owned();
    let channel = match owner.store.update(authority, |candidate| {
        let channel = candidate.finish_resume(pending, proof, started, resume_event)?;
        candidate.record_circuit_event(
            true,
            Some(client_id),
            circuit_id,
            AuthenticationMethod::Resume,
            started,
            open_event,
            None,
        )?;
        Ok(channel)
    }) {
        Ok(channel) => channel,
        Err(error) => {
            drop(state);
            record_failed(owner, FailedAttemptKind::Resume).await;
            return Err(error.into());
        }
    };
    let fingerprint = authority
        .security_snapshot()
        .clients
        .into_iter()
        .find(|client| client.client_id == encode_id(client_id.as_bytes()))
        .map(|client| client.fingerprint)
        .ok_or(RemoteHostError::Protocol)?;
    state.circuits.insert(
        circuit_id,
        LiveCircuit {
            client_id: Some(client_id),
            authentication_method: AuthenticationMethod::Resume,
            connection_generation: generation,
            started,
            last_activity: started,
            route,
            cancellation: circuit_cancellation.clone(),
        },
    );
    Ok(AuthenticatedCircuit {
        channel,
        client_id: Some(client_id),
        method: AuthenticationMethod::Resume,
        circuit_id,
        cancellation: circuit_cancellation,
        success: AuthenticationSucceeded {
            protocol_version: advertised_protocol(owner),
            authorization: Some(AuthorizationSucceeded {
                client_id: encode_id(client_id.as_bytes()),
                fingerprint,
            }),
            capabilities: advertised_capabilities(owner),
            circuit_id: (advertised_protocol(owner) >= 2).then(|| encode_id(circuit_id.as_slice())),
            connection_generation: (advertised_protocol(owner) >= 2).then_some(generation),
        },
        connection_generation: generation,
    })
}

#[allow(clippy::too_many_arguments)]
async fn bridge_application(
    owner: &Arc<SharedOwner>,
    relay: &mut RelaySocket,
    channel: &mut SecureChannel,
    circuit_id: [u8; 16],
    authenticated_client_id: Option<ClientId>,
    connection_generation: u64,
    circuit_cancellation: &CancellationToken,
    host_cancellation: &CancellationToken,
) -> Result<()> {
    #[cfg(not(feature = "direct-file-webrtc"))]
    let _ = connection_generation;
    let mut request = owner
        .config
        .gateway_websocket_url()
        .into_client_request()
        .map_err(|_| RemoteHostError::Gateway)?;
    request.headers_mut().insert(
        "Origin",
        owner
            .config
            .gateway_origin()
            .parse()
            .map_err(|_| RemoteHostError::Gateway)?,
    );
    let (mut gateway, _) = connect_async(request)
        .await
        .map_err(|_| RemoteHostError::Gateway)?;
    let lifetime = tokio::time::sleep(CIRCUIT_LIFETIME);
    tokio::pin!(lifetime);
    let mut first_application_frame = true;
    loop {
        tokio::select! {
            () = owner.shutdown.cancelled() => break,
            () = host_cancellation.cancelled() => break,
            () = circuit_cancellation.cancelled() => break,
            () = &mut lifetime => break,
            message = relay.next() => {
                let Some(message) = message else { break; };
                let message = message.map_err(|_| RemoteHostError::Protocol)?;
                match message {
                    Message::Binary(record) => {
                        let opened = channel.open(&record).map_err(|_| RemoteHostError::Protocol)?;
                        if opened.is_close { break; }
                        #[cfg(feature = "direct-file-webrtc")]
                        if opened.plaintext.starts_with(DIRECT_FILE_REQUEST_MAGIC) {
                            let request = decode_direct_file_request(&opened.plaintext)?;
                            let response = execute_direct_file_request(
                                owner,
                                circuit_id,
                                authenticated_client_id,
                                connection_generation,
                                request,
                            ).await;
                            let response = encode_direct_file_response(&response)?;
                            let record = channel.seal(&response)
                                .map_err(|_| RemoteHostError::Protocol)?;
                            relay.send(Message::Binary(record.into())).await
                                .map_err(|_| RemoteHostError::Protocol)?;
                            touch(owner, circuit_id).await;
                            continue;
                        }
                        if opened.plaintext.starts_with(REMOTE_CONTROL_REQUEST_MAGIC) {
                            let request = decode_control_request(&opened.plaintext)?;
                            let (outcome, close_after) = execute_remote_control(
                                owner,
                                authenticated_client_id,
                                request.operation,
                            ).await;
                            let response = encode_control_response(&RemoteControlResponse {
                                request_id: request.request_id,
                                outcome,
                            })?;
                            let record = channel.seal(&response)
                                .map_err(|_| RemoteHostError::Protocol)?;
                            relay.send(Message::Binary(record.into())).await
                                .map_err(|_| RemoteHostError::Protocol)?;
                            touch(owner, circuit_id).await;
                            if close_after { break; }
                            continue;
                        }
                        let text = std::str::from_utf8(&opened.plaintext)
                            .map_err(|_| RemoteHostError::Protocol)?;
                        let mut frame: ApplicationClientFrame = match serde_json::from_str(text) {
                            Ok(frame) => frame,
                            // A newer client's call this host cannot parse. The
                            // gateway parses the same types, so it cannot accept
                            // the frame either; it answers that call alone
                            // instead of this circuit closing.
                            Err(_) if !first_application_frame
                                && unsupported_call_id(text).is_some() =>
                            {
                                gateway.send(Message::Text(text.to_owned().into())).await
                                    .map_err(|_| RemoteHostError::Gateway)?;
                                touch(owner, circuit_id).await;
                                continue;
                            }
                            Err(_) => return Err(RemoteHostError::Protocol),
                        };
                        validate_client_frame(&frame)?;
                        if first_application_frame {
                            let ApplicationClientFrame::Connect { token, .. } = &mut frame else {
                                return Err(RemoteHostError::Protocol);
                            };
                            if token.is_some() {
                                return Err(RemoteHostError::Protocol);
                            }
                            *token = Some(owner.config.gateway_token().to_owned());
                            first_application_frame = false;
                        }
                        let forwarded = serde_json::to_string(&frame)
                            .map_err(|_| RemoteHostError::Protocol)?;
                        gateway.send(Message::Text(forwarded.into())).await
                            .map_err(|_| RemoteHostError::Gateway)?;
                        touch(owner, circuit_id).await;
                    }
                    Message::Ping(payload) => relay.send(Message::Pong(payload)).await
                        .map_err(|_| RemoteHostError::Protocol)?,
                    Message::Pong(_) => {}
                    Message::Close(_) => break,
                    Message::Text(_) | Message::Frame(_) => return Err(RemoteHostError::Protocol),
                }
            }
            message = gateway.next() => {
                let Some(message) = message else { break; };
                let message = message.map_err(|_| RemoteHostError::Gateway)?;
                match message {
                    Message::Text(text) => {
                        let frame: ApplicationServerFrame = serde_json::from_str(&text)
                            .map_err(|_| RemoteHostError::Gateway)?;
                        validate_server_frame(&frame)?;
                        let record = channel.seal(text.as_bytes())
                            .map_err(|_| RemoteHostError::Protocol)?;
                        relay.send(Message::Binary(record.into())).await
                            .map_err(|_| RemoteHostError::Protocol)?;
                        touch(owner, circuit_id).await;
                    }
                    Message::Ping(payload) => gateway.send(Message::Pong(payload)).await
                        .map_err(|_| RemoteHostError::Gateway)?,
                    Message::Pong(_) => {}
                    Message::Close(_) => break,
                    Message::Binary(_) | Message::Frame(_) => return Err(RemoteHostError::Gateway),
                }
            }
        }
    }
    if let Ok(record) = channel.seal_close() {
        let _ = relay.send(Message::Binary(record.into())).await;
    }
    let _ = gateway.close(None).await;
    #[cfg(feature = "direct-file-webrtc")]
    if let Some(supervisor) = &owner.direct_file
        && let Some(closed) = supervisor.close(circuit_id).await
    {
        owner
            .record_closed_direct_file(closed, "circuit_closed")
            .await;
    }
    Ok(())
}

async fn execute_remote_control(
    owner: &SharedOwner,
    authenticated_client_id: Option<ClientId>,
    operation: RemoteControlOperation,
) -> (RemoteControlOutcome, bool) {
    let close_after = matches!(&operation, RemoteControlOperation::SignOutThisBrowser);
    let result = match operation {
        RemoteControlOperation::Inspect => {
            owner
                .security_view()
                .await
                .map(|security| RemoteControlOutcome::Security {
                    security: Box::new(security),
                })
        }
        RemoteControlOperation::Rename { client_id, label } => owner
            .rename(&client_id, &label)
            .await
            .map(|()| RemoteControlOutcome::Complete),
        RemoteControlOperation::Revoke { client_id } => owner
            .revoke(&client_id)
            .await
            .map(|()| RemoteControlOutcome::Complete),
        RemoteControlOperation::RevokeAllOther { retained_client_id } => owner
            .revoke_all_other(&retained_client_id)
            .await
            .map(|count| RemoteControlOutcome::Count { count }),
        RemoteControlOperation::CloseCircuit { circuit_id } => owner
            .close_circuit(&circuit_id)
            .await
            .map(|()| RemoteControlOutcome::Complete),
        RemoteControlOperation::RequirePasswordEverywhere => owner
            .require_password_everywhere()
            .await
            .map(|count| RemoteControlOutcome::Count { count }),
        RemoteControlOperation::SetDirectFileTransfers { enabled } => owner
            .set_direct_file_transfers_enabled(enabled)
            .await
            .map(|()| RemoteControlOutcome::Complete),
        RemoteControlOperation::StopDirectFileTransfers => owner
            .stop_direct_file_transfers("operator_stop")
            .await
            .map(|()| RemoteControlOutcome::Complete),
        RemoteControlOperation::SignOutThisBrowser => match authenticated_client_id {
            Some(client_id) => owner
                .revoke(&encode_id(client_id.as_bytes()))
                .await
                .map(|()| RemoteControlOutcome::SignedOut {
                    authorization_revoked: true,
                }),
            None => Ok(RemoteControlOutcome::SignedOut {
                authorization_revoked: false,
            }),
        },
        RemoteControlOperation::ClearHistory => owner
            .clear_history()
            .map(|_| RemoteControlOutcome::Complete),
    };
    match result {
        Ok(outcome) => (outcome, close_after),
        Err(_) => (
            RemoteControlOutcome::Error {
                message: "remote security operation was rejected".to_owned(),
            },
            false,
        ),
    }
}

#[cfg(feature = "direct-file-webrtc")]
async fn execute_direct_file_request(
    owner: &Arc<SharedOwner>,
    circuit_id: [u8; 16],
    client_id: Option<ClientId>,
    connection_generation: u64,
    request: DirectFileRequest,
) -> DirectFileResponse {
    let (request_id, request_generation, browser_peer_generation) = match &request {
        DirectFileRequest::Open {
            request_id,
            circuit_generation,
            browser_peer_generation,
            ..
        }
        | DirectFileRequest::Candidate {
            request_id,
            circuit_generation,
            browser_peer_generation,
            ..
        }
        | DirectFileRequest::EndOfCandidates {
            request_id,
            circuit_generation,
            browser_peer_generation,
        }
        | DirectFileRequest::Close {
            request_id,
            circuit_generation,
            browser_peer_generation,
            ..
        } => (*request_id, *circuit_generation, *browser_peer_generation),
    };
    if request_id == 0
        || browser_peer_generation == 0
        || request_generation != connection_generation
    {
        return direct_rejected(
            request_id,
            request_generation,
            browser_peer_generation,
            DirectFileFailure::InvalidRequest,
        );
    }
    let allowed = {
        let state = owner.state.lock().await;
        state
            .authority
            .as_ref()
            .is_some_and(|authority| authority.direct_file_transfers_enabled())
            && state
                .circuits
                .get(&circuit_id)
                .is_some_and(|circuit| circuit.connection_generation == connection_generation)
    };
    if !allowed {
        return direct_rejected(
            request_id,
            request_generation,
            browser_peer_generation,
            DirectFileFailure::Disabled,
        );
    }
    let Some(supervisor) = &owner.direct_file else {
        return direct_rejected(
            request_id,
            request_generation,
            browser_peer_generation,
            DirectFileFailure::Unsupported,
        );
    };
    match request {
        DirectFileRequest::Open {
            torrent_id,
            file_index,
            offer,
            ..
        } => {
            if offer.kind != DirectSdpType::Offer {
                return direct_rejected(
                    request_id,
                    request_generation,
                    browser_peer_generation,
                    DirectFileFailure::InvalidRequest,
                );
            }
            let opened = supervisor
                .open(
                    circuit_id,
                    request_id,
                    request_generation,
                    browser_peer_generation,
                    torrent_id.clone(),
                    file_index,
                    offer,
                )
                .await;
            let opened = match opened {
                Ok(opened) => opened,
                Err(reason) => {
                    return direct_rejected(
                        request_id,
                        request_generation,
                        browser_peer_generation,
                        direct_failure(reason),
                    );
                }
            };
            if owner
                .record_direct_file_started(client_id, circuit_id, torrent_id, file_index)
                .await
                .is_err()
            {
                if let Some(closed) = supervisor.close(circuit_id).await {
                    owner
                        .record_closed_direct_file(closed, "audit_failure")
                        .await;
                }
                return direct_rejected(
                    request_id,
                    request_generation,
                    browser_peer_generation,
                    DirectFileFailure::Internal,
                );
            }
            DirectFileResponse::Opened {
                request_id,
                circuit_generation: request_generation,
                browser_peer_generation,
                host_peer_generation: opened.host_peer_generation,
                file_length: opened.file_length.to_string(),
                max_chunk_bytes: u32::try_from(rstorrent_direct_file::codec::MAX_CHUNK_BYTES)
                    .expect("direct-file chunk bound fits u32"),
                answer: opened.answer,
                candidates: opened.candidates,
            }
        }
        DirectFileRequest::Candidate { candidate, .. } => {
            match supervisor
                .add_candidate(
                    circuit_id,
                    request_generation,
                    browser_peer_generation,
                    request_id,
                    candidate,
                )
                .await
            {
                Ok(host_peer_generation) => DirectFileResponse::Status {
                    request_id,
                    circuit_generation: request_generation,
                    browser_peer_generation,
                    host_peer_generation,
                    state: crate::wire::DirectFileStatus::Negotiating,
                    bytes_sent: "0".to_owned(),
                    candidate_class: None,
                },
                Err(reason) => direct_rejected(
                    request_id,
                    request_generation,
                    browser_peer_generation,
                    direct_failure(reason),
                ),
            }
        }
        DirectFileRequest::EndOfCandidates { .. } => {
            match supervisor
                .validate_peer(
                    circuit_id,
                    request_generation,
                    browser_peer_generation,
                    request_id,
                )
                .await
            {
                Ok(host_peer_generation) => DirectFileResponse::EndOfCandidates {
                    request_id,
                    circuit_generation: request_generation,
                    browser_peer_generation,
                    host_peer_generation,
                },
                Err(reason) => direct_rejected(
                    request_id,
                    request_generation,
                    browser_peer_generation,
                    direct_failure(reason),
                ),
            }
        }
        DirectFileRequest::Close { outcome, .. } => {
            match supervisor
                .close_matching(
                    circuit_id,
                    request_generation,
                    browser_peer_generation,
                    request_id,
                )
                .await
            {
                Ok(closed) => {
                    let host_peer_generation = closed.host_peer_generation;
                    let reason = match outcome {
                        DirectFileCloseOutcome::Complete => "complete",
                        DirectFileCloseOutcome::Cancelled => "cancelled",
                        DirectFileCloseOutcome::SinkFailed => "sink_failed",
                    };
                    owner.record_closed_direct_file(closed, reason).await;
                    DirectFileResponse::Closed {
                        request_id,
                        circuit_generation: request_generation,
                        browser_peer_generation,
                        host_peer_generation: Some(host_peer_generation),
                        outcome,
                    }
                }
                Err(reason) => direct_rejected(
                    request_id,
                    request_generation,
                    browser_peer_generation,
                    direct_failure(reason),
                ),
            }
        }
    }
}

#[cfg(feature = "direct-file-webrtc")]
fn direct_rejected(
    request_id: u32,
    circuit_generation: u64,
    browser_peer_generation: u64,
    reason: DirectFileFailure,
) -> DirectFileResponse {
    DirectFileResponse::Rejected {
        request_id,
        circuit_generation,
        browser_peer_generation,
        reason,
    }
}

#[cfg(feature = "direct-file-webrtc")]
fn direct_failure(reason: &str) -> DirectFileFailure {
    match reason {
        "disabled" => DirectFileFailure::Disabled,
        "busy" => DirectFileFailure::Busy,
        "file_unavailable" => DirectFileFailure::FileUnavailable,
        "invalid_request" => DirectFileFailure::InvalidRequest,
        "signaling_limit" => DirectFileFailure::SignalingLimit,
        "direct_unavailable" => DirectFileFailure::DirectUnavailable,
        _ => DirectFileFailure::Internal,
    }
}

fn validate_client_frame(frame: &ApplicationClientFrame) -> Result<()> {
    if matches!(frame, ApplicationClientFrame::BeginTorrentUpload { .. })
        || matches!(
            frame,
            ApplicationClientFrame::Call {
                operation: ApplicationCall::CreateMediaUrl { .. },
                ..
            }
        )
    {
        return Err(RemoteHostError::Protocol);
    }
    Ok(())
}

fn validate_server_frame(frame: &ApplicationServerFrame) -> Result<()> {
    if matches!(frame, ApplicationServerFrame::TorrentUploadReady { .. })
        || matches!(
            frame,
            ApplicationServerFrame::Result {
                result: ApplicationCallResult::MediaUrl { .. },
                ..
            }
        )
    {
        return Err(RemoteHostError::Gateway);
    }
    Ok(())
}

async fn close_circuit(owner: &SharedOwner, circuit: &AuthenticatedCircuit, reason: &str) {
    let Ok(event_id) = random_event_id() else {
        return;
    };
    let mut state = owner.state.lock().await;
    state.circuits.remove(&circuit.circuit_id);
    let Some(authority) = state.authority.as_mut() else {
        return;
    };
    let _ = owner.store.update(authority, |candidate| {
        candidate.record_circuit_event(
            false,
            circuit.client_id,
            circuit.circuit_id,
            circuit.method,
            now(),
            event_id,
            Some(reason.to_owned()),
        )
    });
}

async fn touch(owner: &SharedOwner, circuit_id: [u8; 16]) {
    if let Some(circuit) = owner.state.lock().await.circuits.get_mut(&circuit_id) {
        circuit.last_activity = now();
    }
}

async fn record_failed(owner: &SharedOwner, kind: FailedAttemptKind) {
    let mut state = owner.state.lock().await;
    let Some(authority) = state.authority.as_mut() else {
        return;
    };
    let _ = owner.store.update(authority, |candidate| {
        candidate.record_failed_attempt(kind, "relay", now())
    });
}

async fn send_encrypted_json<T: serde::Serialize>(
    relay: &mut RelaySocket,
    channel: &mut SecureChannel,
    magic: &[u8; 4],
    value: &T,
) -> Result<()> {
    let plaintext = encode_json_record(magic, value)?;
    let record = channel
        .seal(&plaintext)
        .map_err(|_| RemoteHostError::Protocol)?;
    relay
        .send(Message::Binary(record.into()))
        .await
        .map_err(|_| RemoteHostError::Protocol)
}

fn open_json<T: serde::de::DeserializeOwned>(
    channel: &mut SecureChannel,
    magic: &[u8; 4],
    record: &[u8],
) -> Result<T> {
    let opened = channel
        .open(record)
        .map_err(|_| RemoteHostError::Protocol)?;
    if opened.is_close {
        return Err(RemoteHostError::Protocol);
    }
    decode_json_record(magic, &opened.plaintext)
}

async fn next_binary(socket: &mut RelaySocket) -> Result<Vec<u8>> {
    loop {
        let message = socket
            .next()
            .await
            .ok_or(RemoteHostError::Protocol)?
            .map_err(|_| RemoteHostError::Protocol)?;
        match message {
            Message::Binary(message) if message.len() <= HANDSHAKE_MESSAGE_BYTES => {
                return Ok(message.to_vec());
            }
            Message::Ping(payload) => socket
                .send(Message::Pong(payload))
                .await
                .map_err(|_| RemoteHostError::Protocol)?,
            Message::Pong(_) => {}
            Message::Text(_) | Message::Binary(_) | Message::Close(_) | Message::Frame(_) => {
                return Err(RemoteHostError::Protocol);
            }
        }
    }
}

async fn send_protocol(socket: &mut RelaySocket, magic: &[u8; 4], payload: &[u8]) -> Result<()> {
    if payload.is_empty() || payload.len() + 4 > HANDSHAKE_MESSAGE_BYTES {
        return Err(RemoteHostError::Protocol);
    }
    let mut message = Vec::with_capacity(4 + payload.len());
    message.extend_from_slice(magic);
    message.extend_from_slice(payload);
    socket
        .send(Message::Binary(message.into()))
        .await
        .map_err(|_| RemoteHostError::Protocol)
}

async fn reconnect_delay(owner: &SharedOwner, cancellation: &CancellationToken) {
    tokio::select! {
        () = owner.shutdown.cancelled() => {}
        () = cancellation.cancelled() => {}
        () = tokio::time::sleep(RECONNECT_DELAY) => {}
    }
}

fn advertised_protocol(_owner: &SharedOwner) -> u16 {
    #[cfg(feature = "direct-file-webrtc")]
    if _owner.direct_file.is_some() {
        return 2;
    }
    1
}

fn advertised_capabilities(_owner: &SharedOwner) -> Vec<String> {
    #[cfg(feature = "direct-file-webrtc")]
    if _owner.direct_file.is_some() {
        return vec!["direct_file_v1".to_owned()];
    }
    Vec::new()
}

impl From<tungstenite::Error> for RemoteHostError {
    fn from(_: tungstenite::Error) -> Self {
        Self::Protocol
    }
}
