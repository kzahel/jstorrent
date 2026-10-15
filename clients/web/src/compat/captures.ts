// Captured releases for the mixed-version compatibility matrix, read from
// compat/deliveries.json and compat/captures/<commit>/ (produced by
// scripts/compat-capture.mjs from each release's own source). Test-only.
// docs/tactical/359-mixed-version-compatibility-matrix.md
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { ApiHello, ClientSettingsRuntimeView } from "../api";
import type currentTrace from "../fixtures/view-set-trace.json";

const compatRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../compat");

interface Delivery {
  readonly surface: string;
  readonly version: string;
  readonly commit: string;
  readonly status: string;
  readonly roles: readonly ("host" | "client")[];
}

const ledger = JSON.parse(readFileSync(resolve(compatRoot, "deliveries.json"), "utf8")) as {
  readonly deliveries: readonly Delivery[];
};

function json(commit: string, file: string): unknown {
  return JSON.parse(readFileSync(resolve(compatRoot, "captures", commit, file), "utf8"));
}

/** One captured commit and the deliveries built from it. */
interface Capture {
  readonly commit: string;
  /** Such as "desktop 0.3.1, android 1.0.30". */
  readonly deliveries: string;
  readonly schema: unknown;
}

export interface HostCapture extends Capture {
  readonly hello: ApiHello;
  readonly settings: ClientSettingsRuntimeView;
  /** The release's generated view-set trace, shaped like the current one. */
  readonly trace: typeof currentTrace;
}

export interface CapturedDecoder {
  decodeApiHello(source: string): unknown;
  decodeOpenViewSetResponse(source: string): unknown;
  decodeUpdateBatch(source: string): unknown;
  reduceOpenViewSet(response: unknown): unknown;
  reduceUpdateBatch(state: unknown, batch: unknown): unknown;
}

export interface ClientCapture extends Capture {
  load(): Promise<CapturedDecoder>;
}

function captured(role: "host" | "client"): [string, string][] {
  const byCommit = new Map<string, string[]>();
  for (const delivery of ledger.deliveries) {
    if (delivery.status === "withdrawn" || !delivery.roles.includes(role)) continue;
    const names = byCommit.get(delivery.commit) ?? [];
    names.push(`${delivery.surface} ${delivery.version}`);
    byCommit.set(delivery.commit, names);
  }
  return [...byCommit].map(([commit, names]) => [commit, names.join(", ")]);
}

/** Every host delivery in the ledger, one entry per captured commit. */
export const HOST_CAPTURES: readonly HostCapture[] = captured("host").map(([commit, deliveries]) => ({
  commit,
  deliveries,
  schema: json(commit, "v1.schema.json"),
  hello: json(commit, "hello.json") as ApiHello,
  settings: json(commit, "settings.json") as ClientSettingsRuntimeView,
  trace: json(commit, "view-set-trace.json") as HostCapture["trace"],
}));

/** Every client delivery in the ledger, one entry per captured commit. */
export const CLIENT_CAPTURES: readonly ClientCapture[] = captured("client").map(
  ([commit, deliveries]) => {
    const decoder = resolve(compatRoot, "captures", commit, "client-decoder.mjs");
    if (!existsSync(decoder)) throw new Error(`capture ${commit} has no client decoder`);
    return {
      commit,
      deliveries,
      schema: json(commit, "v1.schema.json"),
      load: () =>
        import(/* @vite-ignore */ pathToFileURL(decoder).href) as Promise<CapturedDecoder>,
    };
  },
);

interface KnownBreak {
  readonly captures?: readonly string[];
  /** "live" entries belong to tests/interop/compat_live_matrix.py. */
  readonly check: "contract" | "client-sent" | "requests" | "live";
  readonly items?: readonly string[];
}

const knownBreakList = (
  JSON.parse(readFileSync(resolve(compatRoot, "known-breaks.json"), "utf8")) as {
    readonly breaks: readonly KnownBreak[];
  }
).breaks;

/**
 * Recorded incompatibilities (compat/known-breaks.json) for any of the given
 * captured commits. Tests accept exactly these and fail on anything else.
 */
export function knownBreaks(
  commits: readonly string[],
  check: Exclude<KnownBreak["check"], "live">,
): string[] {
  return [
    ...new Set(
      knownBreakList
        .filter((entry) => entry.check === check)
        .filter((entry) => (entry.captures ?? []).some((commit) => commits.includes(commit)))
        .flatMap((entry) => entry.items ?? []),
    ),
  ].sort();
}
