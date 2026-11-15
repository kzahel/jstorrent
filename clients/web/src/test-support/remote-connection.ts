import {
  RemoteApplicationWebSocket,
  type RemoteAuthorization,
  type RemoteConnectionFailure,
  type RemoteCryptoWasmModule,
  type WasmClientLogin,
  type WasmClientResume,
  type WasmClientResumeProof,
  type WasmClientSession,
  type WasmOpenedRecord,
} from "../remote-application-websocket";
import type { ApplicationWebSocket } from "../websocket-view-client";

const text = new TextEncoder();
const relayId = new Uint8Array(32).fill(1);
const hostId = new Uint8Array(32).fill(2);
const hostPin = new Uint8Array(64).fill(3);
const hostResumePublicKey = new Uint8Array(65).fill(4);
const clientId = new Uint8Array(16).fill(5);
const clientPublicKey = new Uint8Array(65).fill(6);

class FakeSocket implements ApplicationWebSocket {
  public readyState = 0;
  public binaryType: BinaryType = "blob";
  public onopen: ((event: Event) => void) | null = null;
  public onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;
  public onclose: ((event: CloseEvent) => void) | null = null;
  public readonly sent: Uint8Array[] = [];
  public readonly closes: Array<{ code: number; reason: string }> = [];

  public constructor(public readonly url: string) {}

  public open(): void {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }

  public send(data: string | ArrayBuffer): void {
    if (typeof data === "string") throw new Error("relay received plaintext");
    this.sent.push(new Uint8Array(data).slice());
  }

  public server(data: Uint8Array): void {
    // TextEncoder in jsdom can allocate in Node's realm. WebSocket events
    // carry an ArrayBuffer from the page's realm.
    const buffer = new ArrayBuffer(data.byteLength);
    new Uint8Array(buffer).set(data);
    this.onmessage?.({ data: buffer } as MessageEvent<ArrayBuffer>);
  }

  public close(code = 1_000, reason = ""): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.closes.push({ code, reason });
    this.onclose?.({ code, reason } as CloseEvent);
  }
}

class FakeSession implements WasmClientSession {
  private finalization: Uint8Array | undefined = Uint8Array.of(0x33);

  public take_finalization(): Uint8Array {
    const value = this.finalization;
    if (value === undefined) throw new Error("already consumed");
    this.finalization = undefined;
    return value;
  }

  public host_pin(): Uint8Array {
    return hostPin.slice();
  }

  public seal(plaintext: Uint8Array): Uint8Array {
    return concatenate(Uint8Array.of(0xa0), plaintext);
  }

  public seal_close(): Uint8Array {
    return Uint8Array.of(0xaf);
  }

  public open(record: Uint8Array): WasmOpenedRecord {
    if (record[0] !== 0xa1) throw new Error("invalid record");
    return { plaintext: record.slice(1), isClose: false };
  }
}

class FakeLogin implements WasmClientLogin {
  public request(): Uint8Array {
    return Uint8Array.of(0x11);
  }

  public finish(): WasmClientSession {
    return new FakeSession();
  }
}

class ChangedPinLogin extends FakeLogin {
  public override finish(): WasmClientSession {
    throw new Error("host identity changed");
  }
}

class FakeResumeProof implements WasmClientResumeProof {
  public signature_input(): Uint8Array {
    return Uint8Array.of(0x71);
  }

  public complete(): WasmClientSession {
    return new FakeSession();
  }
}

class FakeResume implements WasmClientResume {
  public request(): Uint8Array {
    return new Uint8Array(101).fill(0x61);
  }

  public finish(): WasmClientResumeProof {
    return new FakeResumeProof();
  }
}

const wasm: RemoteCryptoWasmModule = {
  ClientLogin: FakeLogin,
  ClientResume: FakeResume,
  authorizationTranscript: () => Uint8Array.of(0x72),
};

const subtle = {
  sign: async () => new Uint8Array(64).fill(0x73).buffer,
} as unknown as SubtleCrypto;

function passwordSocket(
  choice: "shared" | "private",
  callbacks: {
    readonly onAuthorization?: (authorization: RemoteAuthorization) => void | Promise<void>;
    readonly onFailure?: (failure: RemoteConnectionFailure) => void;
  } = {},
): { socket: RemoteApplicationWebSocket; relay: FakeSocket } {
  let relay: FakeSocket | undefined;
  const socket = new RemoteApplicationWebSocket({
    relayUrl: "wss://127.0.0.1:7443/ignored?discarded=yes",
    username: "alice",
    authentication: {
      type: "password",
      passphrase: text.encode("correct horse battery staple"),
      choice:
        choice === "shared"
          ? { type: "shared", clientBuild: "test" }
          : {
              type: "private",
              credential: {
                key: {} as CryptoKey,
                clientId,
                clientPublicKey,
                label: "My browser",
                clientBuild: "test",
              },
            },
    },
    crypto: wasm,
    subtle,
    entropy: () => new Uint8Array(32).fill(8),
    socketFactory: (url) => (relay = new FakeSocket(url)),
    ...callbacks,
  });
  if (relay === undefined) throw new Error("fake relay missing");
  return { socket, relay };
}

async function passwordHandshake(
  relay: FakeSocket,
  privateChoice: boolean,
  protocolVersion = 1,
): Promise<void> {
  relay.open();
  relay.server(text.encode("RSP1"));
  relay.server(greeting(protocolVersion));
  await tick();
  relay.server(framed("RSL2", Uint8Array.of(0x12)));
  await tick();
  relay.server(encryptedJson("RSA2", ready(protocolVersion)));
  await tick();
  relay.server(encryptedJson("RSA4", outcome(privateChoice, protocolVersion)));
  await tick();
}

function authorization(): RemoteAuthorization {
  return {
    relayId: relayId.slice(),
    hostId: hostId.slice(),
    hostPin: hostPin.slice(),
    username: "alice",
    hostResumePublicKey: hostResumePublicKey.slice(),
    clientId: clientId.slice(),
    clientPublicKey: clientPublicKey.slice(),
    authorizationGeneration: 7n,
    clientGeneration: 1n,
    protocolFloor: 1,
    label: "My browser",
  };
}

function greeting(protocolVersion = 1): Uint8Array {
  return concatenate(
    text.encode("RHG1"),
    relayId,
    hostId,
    Uint8Array.of(protocolVersion >> 8, protocolVersion & 0xff),
  );
}

function ready(protocolVersion = 1): object {
  return {
    protocol_version: protocolVersion,
    host_build: "test-host",
    host_pin: encodeId(hostPin),
    host_resume_public_key: encodeId(hostResumePublicKey),
    authorization_generation: 7,
    authorization_challenge: encodeId(new Uint8Array(32).fill(9)),
    protocol_floor: 1,
  };
}

function outcome(privateChoice: boolean, protocolVersion = 1): object {
  return {
    protocol_version: protocolVersion,
    authorization: privateChoice
      ? { client_id: encodeId(clientId), fingerprint: "SHA256:test" }
      : null,
    ...(protocolVersion === 2
      ? {
          capabilities: ["direct_file_v1"],
          circuit_id: encodeId(new Uint8Array(16).fill(7)),
          connection_generation: 9,
        }
      : {}),
  };
}

function encryptedJson(magic: string, value: object): Uint8Array {
  return encrypted(concatenate(text.encode(magic), text.encode(JSON.stringify(value))));
}

function encrypted(plaintext: Uint8Array): Uint8Array {
  return concatenate(Uint8Array.of(0xa1), plaintext);
}

function framed(magic: string, payload: Uint8Array): Uint8Array {
  return concatenate(text.encode(magic), payload);
}

function concatenate(...values: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(values.reduce((total, value) => total + value.length, 0));
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.length;
  }
  return output;
}

function encodeId(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function asText(value: Uint8Array | undefined): string {
  return value === undefined ? "" : new TextDecoder().decode(value);
}

async function tick(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

export {
  text,
  relayId,
  hostId,
  hostPin,
  clientId,
  hostResumePublicKey,
  clientPublicKey,
  FakeSocket,
  FakeSession,
  FakeResume,
  FakeResumeProof,
  FakeLogin,
  ChangedPinLogin,
  wasm,
  subtle,
  passwordSocket,
  passwordHandshake,
  authorization,
  greeting,
  ready,
  outcome,
  encryptedJson,
  encrypted,
  framed,
  concatenate,
  encodeId,
  asText,
  tick,
};
