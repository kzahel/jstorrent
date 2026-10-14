import { describe, expect, it } from "vitest";
import type { DesktopUpdaterSnapshot } from "../updater/types";
import type { AboutFacts } from "./about";
import { productFlavor } from "./about";
import { buildDiagnostics } from "./diagnostics";

describe("local diagnostics allowlist", () => {
  it("preserves useful build facts and closed failure operation only", () => {
    const updater: DesktopUpdaterSnapshot = {
      info: { version: "0.1.3", buildId: "abcdef1234567-dirty", arch: "aarch64",
        target: "aarch64-apple-darwin", bundleType: "app", checkPrivacy: "anonymous" },
      state: { phase: "error", operation: "install", message: "/private/payload?token=secret" },
    };
    const about: AboutFacts = { connection: "desktop", identifier: "com.jstorrent.desktop" };
    expect(JSON.parse(buildDiagnostics({ about, updater }))).toEqual({ schema: 2, product: "JSTorrent",
      connection: "desktop", version: "0.1.3", build: "abcdef1234567-dirty",
      target: "aarch64-apple-darwin", package: "app", identity: "com.jstorrent.desktop",
      flavor: "production", update_check_privacy: "anonymous", updater_phase: "error",
      updater_operation: "install" });
  });

  it("reports hosts without an updater from the facts they make known", () => {
    const remote = JSON.parse(buildDiagnostics({ about: {
      connection: "remote", pageBuild: "0123456789abcdef0123456789abcdef01234567",
    } }));
    expect(remote).toEqual({ schema: 2, product: "JSTorrent", connection: "remote",
      version: "unknown", build: "unknown", target: "unknown", package: "unknown",
      identity: "unknown", flavor: "unknown",
      page_build: "0123456789abcdef0123456789abcdef01234567" });

    const companion = JSON.parse(buildDiagnostics({ about: {
      connection: "android-companion", hostVersion: "1.0.31",
    } }));
    expect(companion.version).toBe("1.0.31");
    expect(companion).not.toHaveProperty("updater_phase");

    const crostini = JSON.parse(buildDiagnostics({ about: { connection: "server", hostBuild: "local-webui" } }));
    expect(crostini.build).toBe("local-webui");
  });

  it("accepts the version-shaped build ID that headless reports", () => {
    const updater: DesktopUpdaterSnapshot = {
      info: { version: "0.1.1", buildId: "0.1.1", arch: "x86_64", target: "linux-gnu",
        bundleType: "headless", checkPrivacy: "anonymous" },
      state: { phase: "idle" },
    };
    expect(JSON.parse(buildDiagnostics({ about: { connection: "server" }, updater })).build).toBe("0.1.1");
  });

  it("marks preview and development identities", () => {
    expect(productFlavor("com.jstorrent.desktop")).toBe("production");
    expect(productFlavor("com.jstorrent.app")).toBe("production");
    expect(productFlavor("com.jstorrent.rstorrent")).toBe("preview");
    expect(productFlavor("com.jstorrent.check")).toBe("development");
    const text = buildDiagnostics({ about: { identifier: "org.rstorrent.bootstrap" } });
    expect(JSON.parse(text)).toMatchObject({ identity: "org.rstorrent.bootstrap", flavor: "development" });
  });

  it("rejects hostile and oversized fields without serializing unknown properties", () => {
    const secret = "/Users/private/torrent?token=credential";
    const updater = {
      info: { version: secret, buildId: "a".repeat(100000), target: secret,
        arch: secret, bundleType: secret, checkPrivacy: secret, installationId: secret },
      state: { phase: "error", operation: secret, message: secret, version: secret,
        notes: secret, manualApply: { command: secret, releaseUrl: secret } },
      logs: [secret],
    } as unknown as DesktopUpdaterSnapshot;
    const about = { connection: secret, hostVersion: secret, hostBuild: secret,
      identifier: secret, pageBuild: secret, profilePath: secret } as unknown as AboutFacts;
    const text = buildDiagnostics({ about, updater });
    expect(text).not.toContain(secret);
    expect(text).not.toContain("installationId");
    expect(text).not.toContain("profilePath");
    expect(text).not.toContain("logs");
    expect(new TextEncoder().encode(text).length).toBeLessThan(2048);
    const report = JSON.parse(text);
    expect(report.build).toBe("unknown");
    expect(report.identity).toBe("unknown");
    expect(report.flavor).toBe("unknown");
    expect(report.page_build).toBe("unknown");
    expect(report.updater_operation).toBe("unknown");
  });

  it("reports bounded startup phases and drops anything else", () => {
    const startup = { entry: 40, shell_rendered: 120, hello: -1, first_library: 1.5,
      view_set_open: 700_000, url: 5 } as unknown as Record<string, number>;
    const report = JSON.parse(buildDiagnostics({ about: { connection: "desktop" }, startup }));
    expect(report.startup_ms).toEqual({ entry: 40, shell_rendered: 120 });
    expect(JSON.parse(buildDiagnostics({ about: {} }))).not.toHaveProperty("startup_ms");
  });
});
