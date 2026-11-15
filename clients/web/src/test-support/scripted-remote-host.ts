import type { ApplicationClientFrame, ApplicationServerFrame } from "../api";
import trace from "../fixtures/view-set-trace.json";
import {
  FakeSocket,
  asText,
  encrypted,
  encryptedJson,
  framed,
  greeting,
  outcome,
  text,
} from "./remote-connection";

/** Real client/gate/view owners, with only crypto and the relay boundary scripted. */
export class ScriptedRemoteHost {
  public readonly sockets: FakeSocket[] = [];
  public mode: "online" | "offline" | "changed" | "invalid" = "online";
  public interruptResumes = 0;
  public inspectReplies = true;

  public connect(url: string): FakeSocket {
    const socket = new FakeSocket(url);
    this.sockets.push(socket);
    socket.send = (data) => {
      if (!(data instanceof ArrayBuffer)) throw new Error("expected encrypted relay bytes");
      const record = new Uint8Array(data);
      socket.sent.push(record);
      queueMicrotask(() => this.receive(socket, record));
    };
    queueMicrotask(() => {
      socket.open();
      if (this.mode === "offline") socket.close(1006, "network unavailable");
    });
    return socket;
  }

  private receive(socket: FakeSocket, record: Uint8Array): void {
    if (socket.readyState !== 1) return;
    const magic = asText(record.slice(0, 4));
    if (magic === "RSC1") {
      socket.server(text.encode("RSP1"));
      const hello = greeting();
      if (this.mode === "changed") hello[36] = 99;
      socket.server(hello);
    } else if (magic === "RSR1") {
      if (this.interruptResumes-- > 0) socket.close(1006, "interrupted resume");
      else
        socket.server(
          this.mode === "invalid"
            ? text.encode("invalid challenge")
            : framed("RSR2", Uint8Array.of(1)),
        );
    } else if (magic === "RSR3") {
      socket.server(encryptedJson("RSA4", outcome(true)));
    } else if (record[0] === 0xa0) {
      if (asText(record.slice(1, 5)) === "RSC2") {
        if (this.inspectReplies) {
          const request = JSON.parse(asText(record.slice(5))) as { request_id: number };
          socket.server(
            encryptedJson("RSC3", {
              request_id: request.request_id,
              outcome: { type: "security", security: {} },
            }),
          );
        }
        return;
      }
      const frame = JSON.parse(asText(record.slice(1))) as ApplicationClientFrame;
      const respond = (value: ApplicationServerFrame) =>
        socket.server(encrypted(text.encode(JSON.stringify(value))));
      if (frame.type === "connect") respond(connected());
      else if (frame.type === "call" && frame.operation.type === "open_view_set") {
        respond({
          type: "result",
          call_id: frame.call_id,
          result: { type: "view_set_opened", response: trace.open },
        } as ApplicationServerFrame);
      } else if (frame.type === "call" && frame.operation.type === "close_view_set") {
        respond({ type: "result", call_id: frame.call_id, result: { type: "view_set_closed" } });
      } else if (frame.type === "attach") {
        respond({
          type: "attached",
          call_id: frame.call_id,
          stream_id: frame.stream_id,
          view_set_id: frame.view_set_id,
        });
        if (this.sockets.length > 1) {
          const batch = structuredClone(trace.updates[0]!);
          batch.base_cursor = frame.after;
          batch.cursor = String(BigInt(frame.after) + 1n);
          respond({
            type: "view_batch",
            stream_id: frame.stream_id,
            batch,
          } as ApplicationServerFrame);
        }
      } else if (frame.type === "detach") {
        respond({ type: "detached", call_id: frame.call_id, stream_id: frame.stream_id });
      }
    }
  }
}

function connected(): ApplicationServerFrame {
  return {
    type: "connected",
    api_version: 1,
    encoding: "json",
    hello: {
      api: { current: 1, minimum: 1 },
      encodings: ["json"],
      deliveries: ["poll", "long_poll", "stream"],
      capabilities: ["torrent_list"],
      limits: {
        max_view_sets_per_owner: 8,
        max_views_per_set: 16,
        max_view_id_bytes: 64,
        min_queue_bytes: 16_384,
        default_queue_bytes: 262_144,
        max_queue_bytes: 524_288,
        max_snapshot_bytes: 16_777_216,
        max_wait_millis: 20_000,
        lease_millis: "300000",
      },
    },
    connection_limits: {
      max_attachments: 8,
      max_pending_calls: 16,
      max_client_message_bytes: 65_536,
      max_application_payload_bytes: 16_777_216,
      max_torrent_source_bytes: 67_108_864,
      heartbeat_idle_millis: 15_000,
      heartbeat_timeout_millis: 10_000,
    },
  };
}
