import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RemoteApplicationWebSocket,
  type RemoteAuthorization,
  type RemoteConnectionFailure,
} from "./remote-application-websocket";

import {
  text,
  relayId,
  hostId,
  hostPin,
  clientId,
  FakeSocket,
  ChangedPinLogin,
  wasm,
  subtle,
  passwordSocket,
  passwordHandshake,
  authorization,
  greeting,
  hostResumePublicKey,
  encryptedJson,
  encrypted,
  framed,
  asText,
  tick,
  outcome,
} from "./test-support/remote-connection";

describe("product remote application WebSocket", () => {
  it("terminates circuit-owned peers once and removes unsubscribed listeners", async () => {
    const { socket, relay } = passwordSocket("shared");
    await passwordHandshake(relay, false);
    let closed = 0;
    const remove = socket.onCircuitClosed(() => {
      closed += 100;
    });
    socket.onCircuitClosed(() => {
      closed += 1;
    });
    remove();
    relay.close();
    socket.close();
    expect(closed).toBe(1);
    socket.onCircuitClosed(() => {
      closed += 1;
    });
    expect(closed).toBe(2);
  });
  it("notifies peers on explicit local circuit closure before the relay closes", async () => {
    const { socket, relay } = passwordSocket("shared");
    await passwordHandshake(relay, false);
    let closed = 0;
    socket.onCircuitClosed(() => {
      closed++;
    });
    socket.close();
    expect(closed).toBe(1);
  });
  it("completes greeting, password, shared choice, and application records", async () => {
    const { socket, relay } = passwordSocket("shared");
    let opened = 0;
    socket.onopen = () => {
      opened += 1;
    };
    await passwordHandshake(relay, false);
    expect(opened).toBe(1);
    expect(relay.url).toBe("wss://127.0.0.1:7443/client");
    expect(asText(relay.sent[0])).toBe("RSC1\u0005alice");

    const control = socket.remoteControl({ type: "inspect" });
    expect(asText(relay.sent.at(-1)?.slice(1, 5))).toBe("RSC2");
    const request = JSON.parse(asText(relay.sent.at(-1)?.slice(5))) as {
      request_id: number;
    };
    relay.server(
      encryptedJson("RSC3", {
        request_id: request.request_id,
        outcome: { type: "security", security: { enabled: true } },
      }),
    );
    await expect(control).resolves.toEqual({
      type: "security",
      security: { enabled: true },
    });

    socket.send('{"type":"connect"}');
    expect(relay.sent.at(-1)?.[0]).toBe(0xa0);
    let received: unknown;
    socket.onmessage = (event) => {
      received = event.data;
    };
    relay.server(encrypted(text.encode('{"type":"connected"}')));
    await tick();
    expect(received).toBe('{"type":"connected"}');
    expect(() => socket.send(new ArrayBuffer(1))).toThrow("attachments");
    expect(() =>
      socket.send(JSON.stringify({ type: "call", operation: { type: "create_media_url" } })),
    ).toThrow("media");
  });

  it("creates a challenge-bound private authorization only after acknowledgement", async () => {
    let authorization: RemoteAuthorization | undefined;
    const { socket, relay } = passwordSocket("private", {
      onAuthorization: (value) => {
        authorization = value;
      },
    });
    await passwordHandshake(relay, true);
    expect(socket.readyState).toBe(1);
    expect(authorization?.clientId).toEqual(clientId);
    expect(authorization?.hostResumePublicKey).toEqual(hostResumePublicKey);
    expect(authorization?.authorizationGeneration).toBe(7n);
  });

  it("accepts protocol-2 capability context and exchanges bounded direct signaling", async () => {
    const { socket, relay } = passwordSocket("shared");
    await passwordHandshake(relay, false, 2);
    expect(socket.directFileSupported()).toBe(true);
    expect(socket.directFileConnectionGeneration()).toBe(9);

    const response = socket.directFile({
      type: "open",
      request_id: 11,
      circuit_generation: 9,
      browser_peer_generation: 4,
      torrent_id: "torrent",
      file_index: 2,
      offer: { type: "offer", sdp: "v=0\r\n" },
    });
    expect(asText(relay.sent.at(-1)?.slice(1, 5))).toBe("RDF1");
    relay.server(
      encryptedJson("RDF2", {
        type: "opened",
        request_id: 11,
        circuit_generation: 9,
        browser_peer_generation: 4,
        host_peer_generation: 5,
        file_length: "6",
        max_chunk_bytes: 16_384,
        answer: { type: "answer", sdp: "v=0\r\n" },
        candidates: [],
      }),
    );
    await expect(response).resolves.toMatchObject({
      type: "opened",
      file_length: "6",
    });
  });

  it("does not open before browser persistence completes", async () => {
    let releasePersistence: (() => void) | undefined;
    const persisted = new Promise<void>((resolve) => {
      releasePersistence = resolve;
    });
    const { socket, relay } = passwordSocket("private", {
      onAuthorization: async () => persisted,
    });
    await passwordHandshake(relay, true);
    expect(socket.readyState).toBe(0);
    releasePersistence?.();
    await tick();
    expect(socket.readyState).toBe(1);
  });

  it("resumes before password with fresh host and client proofs", async () => {
    let relay: FakeSocket | undefined;
    const socket = new RemoteApplicationWebSocket({
      relayUrl: "wss://127.0.0.1:7443/ignored",
      username: "alice",
      authentication: {
        type: "resume",
        authorization: authorization(),
        key: {} as CryptoKey,
      },
      crypto: wasm,
      subtle,
      entropy: () => new Uint8Array(32).fill(8),
      socketFactory: (url) => (relay = new FakeSocket(url)),
    });
    relay?.open();
    relay?.server(text.encode("RSP1"));
    relay?.server(greeting());
    await tick();
    expect(asText(relay?.sent[1]?.slice(0, 4))).toBe("RSR1");
    expect(relay?.sent[1]?.slice(4, 20)).toEqual(clientId);
    relay?.server(framed("RSR2", Uint8Array.of(0x62)));
    await tick();
    expect(asText(relay?.sent[2]?.slice(0, 4))).toBe("RSR3");
    relay?.server(encryptedJson("RSA4", outcome(true)));
    await tick();
    expect(socket.readyState).toBe(1);
  });

  it("blocks a changed greeting identity without password fallback", async () => {
    let relay: FakeSocket | undefined;
    let failure: RemoteConnectionFailure | undefined;
    const changed = authorization();
    changed.hostId[0] = 99;
    const socket = new RemoteApplicationWebSocket({
      relayUrl: "wss://127.0.0.1:7443/",
      username: "alice",
      authentication: {
        type: "resume",
        authorization: changed,
        key: {} as CryptoKey,
      },
      crypto: wasm,
      subtle,
      socketFactory: (url) => (relay = new FakeSocket(url)),
      onFailure: (value) => {
        failure = value;
      },
    });
    relay?.open();
    relay?.server(text.encode("RSP1"));
    relay?.server(greeting());
    await tick();
    expect(failure).toBe("host_identity_changed");
    expect(socket.readyState).toBe(3);
    expect(relay?.sent).toHaveLength(1);
  });

  it("classifies an authenticated OPAQUE pin mismatch as an identity change", async () => {
    let relay: FakeSocket | undefined;
    let failure: RemoteConnectionFailure | undefined;
    new RemoteApplicationWebSocket({
      relayUrl: "wss://127.0.0.1:7443/",
      username: "alice",
      authentication: {
        type: "password",
        passphrase: text.encode("correct horse battery staple"),
        expectedIdentity: { relayId, hostId, hostPin },
        choice: { type: "shared" },
      },
      crypto: { ...wasm, ClientLogin: ChangedPinLogin },
      subtle,
      socketFactory: (url) => (relay = new FakeSocket(url)),
      onFailure: (value) => {
        failure = value;
      },
    });
    relay?.open();
    relay?.server(text.encode("RSP1"));
    relay?.server(greeting());
    await tick();
    relay?.server(framed("RSL2", Uint8Array.of(0x12)));
    await tick();
    expect(failure).toBe("host_identity_changed");
  });

  it("keeps an unproven post-greeting close retryable", async () => {
    let relay: FakeSocket | undefined;
    let failure: RemoteConnectionFailure | undefined;
    new RemoteApplicationWebSocket({
      relayUrl: "wss://127.0.0.1:7443/",
      username: "alice",
      authentication: {
        type: "resume",
        authorization: authorization(),
        key: {} as CryptoKey,
      },
      crypto: wasm,
      subtle,
      socketFactory: (url) => (relay = new FakeSocket(url)),
      onFailure: (value) => {
        failure = value;
      },
    });
    relay?.open();
    relay?.server(text.encode("RSP1"));
    relay?.server(greeting());
    await tick();
    relay?.close(4_008, "unavailable");
    expect(failure).toBe("connection_failed");
  });

  it("reports an unexpected authenticated transport close for reconnect", async () => {
    let failure: RemoteConnectionFailure | undefined;
    const { relay } = passwordSocket("shared", {
      onFailure: (value) => {
        failure = value;
      },
    });
    await passwordHandshake(relay, false);
    relay.close(1_006, "relay outage");
    expect(failure).toBe("connection_failed");
  });

  it("retires a socket immediately when sending fails", async () => {
    const failures: RemoteConnectionFailure[] = [];
    const { socket, relay } = passwordSocket("shared", {
      onFailure: (value) => failures.push(value),
    });
    await passwordHandshake(relay, false);
    relay.send = () => {
      throw new Error("network disappeared");
    };
    relay.close = () => {};
    expect(() => socket.send('{"type":"ack","stream_id":"view-1","cursor":"1"}')).toThrow(
      "relay send failed",
    );
    expect(socket.readyState).toBe(3);
    expect(failures).toEqual(["connection_failed"]);
  });
});

describe("remote connection liveness", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function browser() {
    vi.useFakeTimers();
    const target = new EventTarget();
    const documentTarget = Object.assign(new EventTarget(), { visibilityState: "visible" });
    vi.stubGlobal("window", target);
    vi.stubGlobal("document", documentTarget);
    return { target, documentTarget };
  }

  it("coalesces foreground probes and closes a silent socket promptly", async () => {
    const { target, documentTarget } = browser();
    const failures: RemoteConnectionFailure[] = [];
    const { socket, relay } = passwordSocket("shared", { onFailure: (f) => failures.push(f) });
    await passwordHandshake(relay, false);
    await vi.advanceTimersByTimeAsync(1_001);
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    target.dispatchEvent(new Event("online"));
    target.dispatchEvent(new Event("focus"));
    const probes = relay.sent.filter((record) => asText(record.slice(1, 5)) === "RSC2");
    expect(probes).toHaveLength(1);
    // Simulate a browser closing handshake that never finishes.
    relay.close = () => {};
    await vi.advanceTimersByTimeAsync(2_000);
    expect(socket.readyState).toBe(3);
    expect(failures).toEqual(["connection_failed"]);
    expect(socket.connectionError).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    target.dispatchEvent(new Event("focus"));
    expect(relay.sent.filter((record) => asText(record.slice(1, 5)) === "RSC2")).toHaveLength(1);
  });

  it("accepts a health response without interrupting a live circuit", async () => {
    const { target } = browser();
    const { socket, relay } = passwordSocket("shared");
    await passwordHandshake(relay, false);
    await vi.advanceTimersByTimeAsync(1_001);
    target.dispatchEvent(new Event("focus"));
    const request = JSON.parse(asText(relay.sent.at(-1)?.slice(5))) as { request_id: number };
    relay.server(
      encryptedJson("RSC3", {
        request_id: request.request_id,
        outcome: { type: "security", security: {} },
      }),
    );
    await tick();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(socket.readyState).toBe(1);
    socket.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not retire hidden connections, but detects visible stream stalls", async () => {
    const { documentTarget } = browser();
    const { socket, relay } = passwordSocket("shared");
    await passwordHandshake(relay, false);
    documentTarget.visibilityState = "hidden";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(socket.readyState).toBe(1);
    documentTarget.visibilityState = "visible";
    await vi.advanceTimersByTimeAsync(10_000);
    expect(socket.readyState).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("treats a resume timeout as network loss and invalid proof as terminal", async () => {
    vi.useFakeTimers();
    for (const invalidProof of [false, true]) {
      const failures: RemoteConnectionFailure[] = [];
      let relay!: FakeSocket;
      const socket = new RemoteApplicationWebSocket({
        relayUrl: "wss://127.0.0.1:7443/",
        username: "alice",
        authentication: { type: "resume", authorization: authorization(), key: {} as CryptoKey },
        crypto: wasm,
        subtle,
        socketFactory: (url) => (relay = new FakeSocket(url)),
        onFailure: (f) => failures.push(f),
      });
      relay.open();
      relay.server(text.encode("RSP1"));
      relay.server(greeting());
      await tick();
      if (invalidProof) {
        relay.server(text.encode("invalid challenge"));
        await tick();
        expect(failures).toEqual(["verification_failed"]);
        expect(socket.connectionError).toBeInstanceOf(Error);
      } else {
        await vi.advanceTimersByTimeAsync(20_000);
        expect(failures).toEqual(["connection_failed"]);
        expect(socket.connectionError).toBeUndefined();
      }
      expect(socket.readyState).toBe(3);
    }
  });
});
