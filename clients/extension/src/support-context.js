// Disposable browser-session observations. Never store URLs supplied by a page.
export const SUPPORT_CONTEXT_KEY = "supportContextV1";
export const SUPPORT_FAILURES = new Set([
  "none", "permission_denied", "service_unreachable", "connection_failed",
  "disconnected", "timeout", "canceled", "app_update_required",
  "extension_update_required", "pairing_rejected", "pairing_expired",
  "native_host_unavailable", "bootstrap_timeout", "authentication_failed",
  "invalid_version", "unreachable", "service_error", "wrong_service",
  "incompatible", "invalid_response",
]);
const ENTRIES = new Set(["popup/popup.html", "companion/companion.html", "crostini/connect.html"]);

export function supportObservation(url, failure, extensionOrigin) {
  if (!SUPPORT_FAILURES.has(failure)) throw new Error("unknown support failure");
  const parsed = new URL(url);
  const entry = parsed.pathname.slice(1);
  if (`${parsed.protocol}//${parsed.host}/` !== extensionOrigin || !ENTRIES.has(entry)) {
    throw new Error("unknown support entry");
  }
  return { entry, failure };
}

export async function supportEnvironment(chromeApi, userAgent = globalThis.navigator?.userAgent ?? "") {
  let platform = "unknown";
  try {
    const os = (await chromeApi.runtime.getPlatformInfo()).os;
    platform = ({ cros: "chromeos", win: "win", mac: "mac", linux: "linux", android: "android" })[os] ?? "unknown";
  } catch { /* Report missing platform honestly. */ }
  // UA versions may be reduced; never present these as exact OS/build versions.
  const chrome = userAgent.match(/(?:Chrome|Chromium)\/(\d{1,6}(?:\.\d{1,6}){0,3})\b/u)?.[1];
  return { platform, ...(chrome ? { chrome } : {}) };
}

export function appendSupportContext(url, environment, observation, version) {
  url.searchParams.set("surface", "jst-extension");
  url.searchParams.set("extv", version);
  if (["chromeos", "win", "mac", "linux", "android", "unknown"].includes(environment?.platform)) {
    url.searchParams.set("platform", environment.platform);
  }
  if (/^\d{1,6}(?:\.\d{1,6}){0,3}$/u.test(environment?.chrome ?? "")) url.searchParams.set("chrome", environment.chrome);
  if (ENTRIES.has(observation?.entry)) url.searchParams.set("entry", observation.entry);
  if (SUPPORT_FAILURES.has(observation?.failure)) url.searchParams.set("failure", observation.failure);
}
