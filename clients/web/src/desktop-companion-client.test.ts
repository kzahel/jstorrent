import { describe, it, expect } from "vitest";
import { validateDesktopReady } from "./desktop-companion-client";
const ready = { kind: "ready", endpoint: "http://127.0.0.1:32145", credential: "ab".repeat(32), instanceId: "cd".repeat(16), profileId: "default" };
describe("protected desktop bootstrap response", () => {
  it("accepts the bounded exact runtime", () => { expect(validateDesktopReady(ready)).toEqual(ready); });
  it.each(["http://localhost:1234", "http://192.0.2.1:1234", "http://127.0.0.1:0", "http://127.0.0.1:65536", "http://127.0.0.1:1234/?token=x"])("refuses foreign or malformed endpoint %s", (endpoint) => { expect(() => validateDesktopReady({ ...ready, endpoint })).toThrow(); });
  it("refuses identity or credential drift", () => {
    for (const change of [{ credential: "" }, { profileId: "other" }, { instanceId: "x" }, { kind: "launch" }]) expect(() => validateDesktopReady({ ...ready, ...change })).toThrow();
  });
});

describe("desktop bootstrap error disposition", () => {
  it("names desktop setup when native registration is unavailable without blaming a version", async () => {
    const { desktopBootstrapFailure, DesktopCompanionUnavailable } = await import("./desktop-companion-client");
    const failure = desktopBootstrapFailure({ ok: false, error: { code: "native_host_unavailable", message: "raw diagnostic" } });
    expect(failure).toBeInstanceOf(DesktopCompanionUnavailable);
    expect(failure.message).toContain("Install or update the desktop app");
    expect(failure.message).not.toContain("raw diagnostic");
  });
  it.each(["unsupported_protocol", "unsupported_operation", "invalid_native_response"])("keeps %s terminal", async (code) => {
    const { desktopBootstrapFailure } = await import("./desktop-companion-client");
    const failure = desktopBootstrapFailure({ ok: false, error: { code, message: "raw diagnostic" } });
    expect(failure).toHaveProperty("code", "invalid_version");
    expect(failure.message).not.toContain("raw diagnostic");
  });
  it.each(["native_host_unavailable", "bootstrap_timeout", "control_unavailable"])("keeps %s recoverable", async (code) => {
    const { desktopBootstrapFailure } = await import("./desktop-companion-client");
    expect(desktopBootstrapFailure({ ok: false, error: { code, message: "stopped" } })).not.toHaveProperty("code");
  });
});
