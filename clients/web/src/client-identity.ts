import { version as webVersion } from "../package.json";
import type { ApiClientInfo } from "./api";

/**
 * What this client reports to the host in `connect` (Tactical 370). Hosts
 * only count and log it; features are decided by host capabilities.
 */
export type ClientKind = "remote" | "extension" | "web";

export function clientIdentity(
  kind: ClientKind,
  options: { readonly version?: string | undefined; readonly buildId?: string | undefined } = {},
): ApiClientInfo {
  return {
    kind,
    version: printable(options.version, 32) ?? webVersion,
    build_id: printable(options.buildId, 64) ?? "development",
  };
}

/** The extension's manifest version, when this page runs in the extension. */
export function extensionVersion(): string | undefined {
  const runtime = (globalThis as { chrome?: { runtime?: { getManifest?: () => { version?: unknown } } } })
    .chrome?.runtime;
  const version = runtime?.getManifest?.().version;
  return typeof version === "string" ? version : undefined;
}

function printable(value: string | undefined, maximum: number): string | undefined {
  return value !== undefined && value.length <= maximum && /^[\x21-\x7e]+$/u.test(value)
    ? value
    : undefined;
}
