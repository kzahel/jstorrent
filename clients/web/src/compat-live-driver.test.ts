// Live happy path for the mixed-version compatibility matrix
// (docs/tactical/359-mixed-version-compatibility-matrix.md, Slice 6).
//
// tests/interop/compat_live_matrix.py starts a real host and runs this file
// inside the checkout of the client version under test, so it uses that
// version's own LiveApplication and WebSocket client. It must therefore use
// only APIs present in every supported release. Skipped unless the
// orchestrator sets its environment.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { describe, it } from "vitest";
import { WebSocket as NodeWebSocket } from "ws";

import { LiveApplication } from "./inspection/live/LiveApplication";
import { WebSocketApplicationViewClient } from "./websocket-view-client";

const environment = process.env;
const gatewayUrl = environment.RSTORRENT_COMPAT_GATEWAY_URL;
const gatewayOrigin = environment.RSTORRENT_COMPAT_GATEWAY_ORIGIN;
const gatewayToken = environment.RSTORRENT_COMPAT_GATEWAY_TOKEN;
const storageRoot = environment.RSTORRENT_COMPAT_STORAGE_ROOT;
const magnet = environment.RSTORRENT_COMPAT_MAGNET;
const payloadPath = environment.RSTORRENT_COMPAT_PAYLOAD;
const payloadSha1 = environment.RSTORRENT_COMPAT_PAYLOAD_SHA1;
const resultPath = environment.RSTORRENT_COMPAT_RESULT;
const enabled = [
  gatewayUrl,
  gatewayOrigin,
  gatewayToken,
  storageRoot,
  magnet,
  payloadPath,
  payloadSha1,
  resultPath,
].every((value) => value !== undefined);

const STEP_TIMEOUT_MS = 60_000;

type Step =
  | "connect"
  | "set_download_folder"
  | "add"
  | "download"
  | "verify_payload"
  | "remove"
  | "data_removed";

interface Outcome {
  readonly completed: Step[];
  failedAt: Step | null;
  error: string | null;
}

interface Snapshot {
  readonly torrentOrder: readonly string[];
  readonly torrents: Readonly<Record<string, { readonly progress: number | null }>>;
}

(enabled ? describe : describe.skip)("compatibility live happy path", () => {
  it(
    "connects, sets the download folder, downloads, and removes with data",
    async () => {
      const outcome: Outcome = { completed: [], failedAt: null, error: null };
      let application: LiveApplication | undefined;
      let client: WebSocketApplicationViewClient | undefined;
      let latest: Snapshot | null = null;
      let current: Step = "connect";
      try {
        client = new WebSocketApplicationViewClient(
          gatewayUrl!,
          gatewayToken!,
          (url) => new NodeWebSocket(url, { origin: gatewayOrigin! }) as never,
          "00000000000000000000000000000001",
          // Sent by clients from Tactical 370 on and ignored by releases
          // before it, so every captured host proves it accepts the field.
          { client: { kind: "web", version: "compat-live", build_id: "compat-live" } } as never,
        );
        application = await LiveApplication.open(client);
        application.subscribe((update) => {
          if (update.type === "snapshot") latest = update.snapshot as unknown as Snapshot;
        });
        outcome.completed.push(current);

        current = "set_download_folder";
        accepted(
          await application.dispatch({ type: "set_default_download_root", rootId: storageRoot! }),
        );
        outcome.completed.push(current);

        current = "add";
        accepted(
          await application.dispatch({
            type: "add_magnet",
            magnet: magnet!,
            storageRoot: storageRoot!,
            startContent: true,
          }),
        );
        outcome.completed.push(current);

        current = "download";
        const torrentId = await until(() => {
          const snapshot = latest as Snapshot | null;
          const id = snapshot?.torrentOrder[0];
          return id !== undefined && snapshot?.torrents[id]?.progress === 1 ? id : undefined;
        });
        outcome.completed.push(current);

        current = "verify_payload";
        const digest = createHash("sha1").update(readFileSync(payloadPath!)).digest("hex");
        if (digest !== payloadSha1) throw new Error(`payload SHA-1 ${digest}, expected ${payloadSha1}`);
        outcome.completed.push(current);

        current = "remove";
        accepted(await application.dispatch({ type: "remove", torrentId, deleteData: true }));
        await until(() =>
          (latest as Snapshot | null)?.torrentOrder.includes(torrentId) === false ? true : undefined,
        );
        outcome.completed.push(current);

        current = "data_removed";
        await until(() => (existsSync(payloadPath!) ? undefined : true));
        outcome.completed.push(current);
      } catch (error) {
        outcome.failedAt = current;
        outcome.error = error instanceof Error ? error.message : String(error);
      } finally {
        await application?.close().catch(() => undefined);
        await client?.close().catch(() => undefined);
        writeFileSync(resultPath!, `${JSON.stringify(outcome)}\n`);
      }
    },
    5 * STEP_TIMEOUT_MS,
  );
});

function accepted(result: { readonly accepted: boolean; readonly message?: string }): void {
  if (!result.accepted) throw new Error(result.message ?? "command was not accepted");
}

async function until<T>(read: () => T | undefined): Promise<T> {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out after ${STEP_TIMEOUT_MS} ms`);
}
