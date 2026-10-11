import { DesktopUpdaterController } from "./inspection/updater/controller";
import type {
  DesktopReleaseInfo,
  DesktopUpdateBackend,
  DesktopUpdater,
  ManualUpdateAction,
  UpdateCandidate,
  UpdateDownloadEvent,
} from "./inspection/updater/types";

const PRODUCT_UPDATE_PATH = "/api/v1/product-update";
const HEALTH_PATH = "/healthz";
const MAX_RESPONSE_BYTES = 16_384;
const HOST_DISCOVERY_TIMEOUT_MS = 5_000;
const APPLY_COMMAND = "$HOME/.local/bin/rstorrent-headless update --apply";

export type HostedAccessMode =
  | "basic"
  | "browser_session"
  | "lan_none"
  | "network_none";

export type HostedProduct = "headless" | "crostini";

export interface HostedHostIntegration {
  readonly product: HostedProduct;
  readonly accessMode?: HostedAccessMode;
  readonly updater?: DesktopUpdater;
}

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export async function createHostedHostIntegration(
  baseUrl: URL,
  fetcher: Fetcher = globalThis.fetch.bind(globalThis),
): Promise<HostedHostIntegration | undefined> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(
    () => controller.abort(),
    HOST_DISCOVERY_TIMEOUT_MS,
  );
  try {
    const healthResponse = await fetcher(new URL(HEALTH_PATH, baseUrl), {
      credentials: "same-origin",
      signal: controller.signal,
    });
    if (healthResponse.status === 404) return undefined;
    const health = await responseJson(healthResponse);
    if (isRecord(health) && health.product === "rstorrent-crostini") {
      if (
        !hasExactKeys(health, [
          "status",
          "build_id",
          "product",
          "launch_protocol",
        ]) ||
        health.status !== "ok" ||
        !validText(health.build_id) ||
        health.launch_protocol !== 1
      ) {
        throw new Error("Crostini health identity is invalid");
      }
      return { product: "crostini" };
    }
    if (!isRecord(health) || health.product !== "rstorrent-headless") {
      return undefined;
    }
    const accessMode = health.access_mode;
    if (
      accessMode !== "basic" &&
      accessMode !== "browser_session" &&
      accessMode !== "lan_none" &&
      accessMode !== "network_none"
    ) {
      throw new Error("Headless health omitted its exact access mode");
    }
    const updater = await createHeadlessUpdater(
      baseUrl,
      fetcher,
      controller.signal,
    );
    return { product: "headless", accessMode, updater };
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function createHeadlessUpdater(
  baseUrl: URL,
  fetcher: Fetcher,
  signal: AbortSignal,
): Promise<DesktopUpdater> {
  const endpoint = new URL(PRODUCT_UPDATE_PATH, baseUrl);
  const rawInfo = await requestJson(
    endpoint,
    { credentials: "same-origin", signal },
    fetcher,
  );
  const info = parseReleaseInfo(rawInfo);
  const backend: DesktopUpdateBackend = {
    async check(reason, timeoutMs) {
      const controller = new AbortController();
      const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
      try {
        const candidate = await requestJson(
          endpoint,
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "X-Check-Reason": reason },
            signal: controller.signal,
          },
          fetcher,
        );
        return candidate === null ? null : parseCandidate(candidate);
      } finally {
        globalThis.clearTimeout(timeout);
      }
    },
    async relaunch() {
      throw new Error("Headless updates must be applied from the server shell");
    },
  };
  return new DesktopUpdaterController(backend, info);
}

class HeadlessUpdateCandidate implements UpdateCandidate {
  readonly manualApply: ManualUpdateAction;

  constructor(
    readonly version: string,
    releaseUrl: string,
    command: string,
  ) {
    this.manualApply = { command, releaseUrl };
  }

  async downloadAndInstall(
    _onEvent: (event: UpdateDownloadEvent) => void,
  ): Promise<void> {
    throw new Error("Headless updates must be applied from the server shell");
  }

  async close(): Promise<void> {}
}

function parseReleaseInfo(value: unknown): DesktopReleaseInfo {
  if (
    !hasExactKeys(value, [
      "version",
      "build_id",
      "target",
      "arch",
      "package",
      "check_privacy",
    ]) ||
    !validVersion(value.version) ||
    !validText(value.build_id) ||
    value.target !== "linux-gnu" ||
    (value.arch !== "x86_64" && value.arch !== "aarch64") ||
    value.package !== "headless" ||
    value.check_privacy !== "anonymous"
  ) {
    throw new Error("Headless update identity is invalid");
  }
  return {
    version: value.version,
    buildId: value.build_id,
    target: value.target,
    arch: value.arch,
    bundleType: "headless",
    checkPrivacy: "anonymous",
  };
}

function parseCandidate(value: unknown): UpdateCandidate {
  if (
    !hasExactKeys(value, ["version", "release_url", "apply_command"]) ||
    !validVersion(value.version) ||
    typeof value.release_url !== "string" ||
    ![
      `https://github.com/kzahel/jstorrent/releases/tag/headless-v${value.version}`,
      `https://github.com/kzahel/rstorrent/releases/tag/headless-v${value.version}`,
    ].includes(value.release_url) ||
    value.apply_command !== APPLY_COMMAND
  ) {
    throw new Error("Headless update candidate is invalid");
  }
  return new HeadlessUpdateCandidate(
    value.version,
    value.release_url,
    value.apply_command,
  );
}

async function requestJson(
  url: URL,
  init: RequestInit,
  fetcher: Fetcher,
): Promise<unknown> {
  const response = await fetcher(url, init);
  return responseJson(response);
}

async function responseJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`Headless update service returned HTTP ${response.status}`);
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error("Headless update response exceeds its byte limit");
  }
  const body = await response.text();
  if (body.length === 0 || body.length > MAX_RESPONSE_BYTES) {
    throw new Error("Headless update response has an invalid byte length");
  }
  return JSON.parse(body) as unknown;
}

function hasExactKeys(
  value: unknown,
  expected: readonly string[],
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length &&
    [...expected].sort().every((key, index) => actual[index] === key)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validVersion(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(0|[1-9]\d{0,19})\.(0|[1-9]\d{0,19})\.(0|[1-9]\d{0,19})$/u.test(
      value,
    )
  );
}

function validText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 1_024 &&
    /^[\x21-\x7e]+$/u.test(value)
  );
}
