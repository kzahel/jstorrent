import { STARTUP_PHASES, type StartupTimings } from "../../startup-timing";
import { productFlavor, type SupportFacts } from "./about";

const TARGETS = new Set([
  "aarch64-apple-darwin", "x86_64-apple-darwin", "x86_64-pc-windows-msvc",
  "aarch64-unknown-linux-gnu", "x86_64-unknown-linux-gnu", "linux-gnu",
  "aarch64-linux-android", "x86_64-linux-android",
]);
const PACKAGES = new Set(["app", "nsis", "appimage", "msi", "deb", "rpm", "headless"]);
const PHASES = new Set(["idle", "checking", "up-to-date", "waiting-for-stable", "available",
  "manual-install", "downloading", "installing", "error"]);
const PRIVACY = new Set(["installation-id", "preference-controlled", "anonymous"]);
const CONNECTIONS = new Set(["desktop", "server", "remote", "android-companion",
  "desktop-companion", "demo"]);
const VERSION = /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:-(?:alpha|beta|rc)(?:\.\d{1,6})?)?$/;
// Source commits, plus the version-shaped and local IDs headless and
// development gateways report.
const BUILD = /^(?:[a-f0-9]{7,40}(?:-dirty)?|\d{1,6}\.\d{1,6}\.\d{1,6}|local(?:-webui)?|development|unknown)$/i;
const IDENTIFIER = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*){1,4}$/;

function member(value: unknown, allowed: ReadonlySet<string>): string {
  return typeof value === "string" && allowed.has(value) ? value : "unknown";
}

function bounded(value: unknown, pattern: RegExp): string {
  return typeof value === "string" && value.length <= 48 && pattern.test(value) ? value : "unknown";
}

/** Local support format, deliberately independent from raw application/log DTOs. */
export function buildDiagnostics({ about, updater, startup }: SupportFacts): string {
  const identity = bounded(about.identifier, IDENTIFIER);
  const report = {
    schema: 2,
    product: "JSTorrent",
    connection: member(about.connection, CONNECTIONS),
    version: bounded(updater?.info.version ?? about.hostVersion, VERSION),
    build: bounded(updater?.info.buildId ?? about.hostBuild, BUILD),
    target: member(updater?.info.target ?? about.hostTarget, TARGETS),
    package: member(updater?.info.bundleType, PACKAGES),
    identity,
    flavor: identity === "unknown" ? "unknown" : productFlavor(identity),
    ...(about.pageBuild === undefined ? {} : { page_build: bounded(about.pageBuild, BUILD) }),
    ...(updater === undefined ? {} : {
      update_check_privacy: member(updater.info.checkPrivacy, PRIVACY),
      updater_phase: member(updater.state.phase, PHASES),
      ...(updater.state.phase === "error" ? {
        updater_operation: updater.state.operation === "check" || updater.state.operation === "install"
          ? updater.state.operation : "unknown",
      } : {}),
    }),
    ...(startup === undefined ? {} : { startup_ms: boundedStartup(startup) }),
  };
  const text = JSON.stringify(report, null, 2) + "\n";
  if (new TextEncoder().encode(text).length > 2048) {
    throw new Error("support diagnostics exceeded its fixed bound");
  }
  return text;
}

function boundedStartup(startup: StartupTimings): Record<string, number> {
  const report: Record<string, number> = {};
  for (const phase of STARTUP_PHASES) {
    const value: unknown = startup[phase];
    if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 600_000) {
      report[phase] = value;
    }
  }
  return report;
}

export const DIAGNOSTICS_FILENAME = "jstorrent-diagnostics.json";
