// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AndroidCompanionPairingFailed, AndroidCompanionUnavailable, AndroidCompanionUpdateRequired } from "./android-companion-client";
const mock = vi.hoisted(() => ({ connect: vi.fn(), mount: vi.fn(), permission: vi.fn(), grant: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }));
vi.mock("./android-companion-client", async (original) => ({
  ...await original<typeof import("./android-companion-client")>(), connectAndroidCompanion: mock.connect,
}));
vi.mock("./inspection/companion-bootstrap", () => ({ startCompanionInspection: mock.mount }));
vi.mock("./localization/runtime", () => ({ message: (key: string) => key }));
import { startAndroidCompanion } from "./android-companion-main";

const button = (id = "companion-cancel") => document.getElementById(id) as HTMLButtonElement;
const status = () => document.getElementById("companion-status")!.textContent;
function connected(hello: object = {}) {
  let disconnect!: () => void;
  const close = vi.fn().mockResolvedValue(undefined);
  const unmount = vi.fn().mockResolvedValue(undefined);
  mock.mount.mockResolvedValue(unmount);
  mock.connect.mockResolvedValueOnce({ client: { close }, hello, disconnected: new Promise<void>(resolve => { disconnect = resolve; }) });
  return { close, unmount, disconnect: () => disconnect() };
}
describe("Android pre-connection recovery ownership", () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.resetAllMocks();
    document.body.innerHTML = '<section id="companion-bootstrap"><p id="companion-status"></p><button id="companion-cancel"></button><button id="companion-permission" hidden></button><a id="companion-update-android" hidden></a><a id="companion-update-extension" hidden></a><button id="companion-preview"></button><textarea id="companion-context" hidden></textarea><p id="companion-context-privacy" hidden></p></section><header id="companion-identity" hidden></header><main id="app" hidden></main>';
    mock.permission.mockResolvedValue(true);
    vi.stubGlobal("chrome", { runtime: { id: "extension", getManifest: () => ({ version: "1.1.2" }), onMessage: { addListener: mock.addListener, removeListener: mock.removeListener } }, tabs: { getCurrent: async () => ({ id: 7 }) }, permissions: { contains: mock.permission, request: mock.grant } });
  });
  afterEach(async () => {
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    await vi.advanceTimersByTimeAsync(0);
    vi.useRealTimers(); vi.unstubAllGlobals();
  });
  it("denied optional permission contacts no service and makes no app/Play claim", async () => {
    mock.permission.mockResolvedValue(false);
    await startAndroidCompanion();
    expect(mock.connect).not.toHaveBeenCalled();
    expect(status()).toBe("android.companion.permission-denied");
    button("companion-preview").click();
    const report = JSON.parse((document.getElementById("companion-context") as HTMLTextAreaElement).value);
    expect(report).toMatchObject({ category: "permission_denied", browser_permission: "denied", play_availability: "unknown", app_presence: "unknown", device_policy: "unknown" });
  });
  it.each(["rejected", "expired"] as const)("reports observed pairing %s without a Play claim", async (outcome) => {
    mock.connect.mockRejectedValue(new AndroidCompanionPairingFailed(outcome));
    await startAndroidCompanion();
    button("companion-preview").click();
    const report = JSON.parse((document.getElementById("companion-context") as HTMLTextAreaElement).value);
    expect(report).toMatchObject({ stage: "pairing", category: `pairing_${outcome}`, play_availability: "unknown", device_policy: "unknown" });
    expect(status()).toBe(new AndroidCompanionPairingFailed(outcome).message);
    expect(button().textContent).toBe("android.companion.retry-connection");
  });
  it("permission denial exposes a user action and grant retries without launching Android", async () => {
    mock.permission.mockResolvedValueOnce(false).mockResolvedValue(true);
    mock.grant.mockResolvedValue(true);
    mock.connect.mockRejectedValue(new AndroidCompanionUnavailable());
    await startAndroidCompanion();
    expect(button("companion-permission").hidden).toBe(false);
    expect(mock.grant).not.toHaveBeenCalled();
    expect(mock.connect).not.toHaveBeenCalled();
    button("companion-permission").click(); button("companion-permission").click();
    expect(mock.grant).toHaveBeenCalledExactlyOnceWith({ origins: ["http://100.115.92.2/*"] });
    await vi.advanceTimersByTimeAsync(0);
    expect(mock.connect).toHaveBeenCalledOnce();
  });
  it("only a handoff addressed to this owned tab can retry an idle failure", async () => {
    mock.connect.mockRejectedValue(new AndroidCompanionUnavailable());
    await startAndroidCompanion();
    const listener = mock.addListener.mock.calls[0]![0];
    const respond = vi.fn();
    for (const [request, sender] of [
      [{ type: "androidAttachRequested", tabId: 8 }, { id: "extension" }],
      [{ type: "androidAttachRequested", tabId: 7 }, { id: "other" }],
      [{ type: "androidAttachRequested", tabId: 7, credential: "untrusted" }, { id: "extension" }],
    ]) listener(request, sender, respond);
    expect(mock.connect).toHaveBeenCalledOnce();
    listener({ type: "androidAttachRequested", tabId: 7 }, { id: "extension" }, respond);
    listener({ type: "androidAttachRequested", tabId: 7 }, { id: "extension" }, respond);
    await vi.advanceTimersByTimeAsync(0);
    expect(mock.connect).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    expect(mock.removeListener).toHaveBeenCalledWith(listener);
  });
  it("passes only a well-formed Android version to About", async () => {
    let connection = connected({ backend: { product_version: "1.0.31" } });
    let running = startAndroidCompanion();
    await vi.advanceTimersByTimeAsync(0);
    expect(mock.mount).toHaveBeenLastCalledWith(expect.anything(), true,
      { connection: "android-companion", hostVersion: "1.0.31" });
    connection.disconnect(); await running;
    connection = connected({ backend: { product_version: "<script>" } });
    running = startAndroidCompanion();
    await vi.advanceTimersByTimeAsync(0);
    expect(mock.mount).toHaveBeenLastCalledWith(expect.anything(), true, { connection: "android-companion" });
    connection.disconnect(); await running;
  });

  it("handoff focuses a connected owner and retries after its disconnect", async () => {
    const connection = connected();
    const running = startAndroidCompanion();
    await vi.advanceTimersByTimeAsync(0);
    const listener = mock.addListener.mock.calls[0]![0];
    listener({ type: "androidAttachRequested", tabId: 7 }, { id: "extension" }, vi.fn());
    expect(mock.connect).toHaveBeenCalledOnce();
    connection.disconnect(); await running;
    mock.connect.mockRejectedValue(new AndroidCompanionUnavailable());
    listener({ type: "androidAttachRequested", tabId: 7 }, { id: "extension" }, vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(mock.connect).toHaveBeenCalledTimes(2);
  });
  it("offline failure stays terminal until manual attach-only retry", async () => {
    mock.connect.mockRejectedValue(new AndroidCompanionUnavailable());
    await startAndroidCompanion();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(mock.connect).toHaveBeenCalledOnce();
    button().click(); button().click();
    await vi.advanceTimersByTimeAsync(0);
    expect(mock.connect).toHaveBeenCalledTimes(2);
  });
  it("cancel joins the pending attempt before allowing retry", async () => {
    mock.connect.mockImplementation((_status, signal: AbortSignal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })));
    const task = startAndroidCompanion();
    await vi.advanceTimersByTimeAsync(0);
    button().click();
    await task;
    expect(status()).toBe("shell.companion.connection-canceled");
    expect(button().disabled).toBe(false);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(mock.connect).toHaveBeenCalledOnce();
  });
  it("cancel releases a client blocked during mount and joins that release", async () => {
    const connection = connected();
    let failed!: (error: Error) => void;
    let released!: () => void;
    mock.mount.mockReturnValue(new Promise((_, reject) => { failed = reject; }));
    connection.close.mockImplementation(() => {
      failed(new Error("transport closed"));
      return new Promise<void>(resolve => { released = resolve; });
    });
    const task = startAndroidCompanion();
    await vi.advanceTimersByTimeAsync(0);
    button().click();
    await vi.advanceTimersByTimeAsync(0);
    expect(connection.close).toHaveBeenCalledOnce();
    expect(button().disabled).toBe(true);
    released(); await task;
    expect(button().disabled).toBe(false);
    expect(document.getElementById("app")!.hidden).toBe(true);
    expect(connection.close).toHaveBeenCalledOnce();
  });
  it("cancel during pairing explains the separately owned Android request", async () => {
    mock.connect.mockImplementation((update, signal: AbortSignal) => {
      update("approve", "pairing");
      return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    });
    const task = startAndroidCompanion(); await vi.advanceTimersByTimeAsync(0);
    button().click(); await task;
    expect(status()).toBe("android.companion.pairing-canceled");
    expect(button().disabled).toBe(false);
    expect(mock.connect).toHaveBeenCalledOnce();
  });
  it("caps the whole pairing/authentication attempt and reports timeout", async () => {
    mock.connect.mockImplementation((update, signal: AbortSignal) => {
      update("approve", "pairing");
      return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    });
    const task = startAndroidCompanion();
    await vi.advanceTimersByTimeAsync(150_000);
    await task;
    expect(status()).toBe("android.companion.attempt-timeout");
    button("companion-preview").click();
    expect((document.getElementById("companion-context") as HTMLTextAreaElement).value).toContain('"category": "timeout"');
  });
  it.each(["android", "extension"] as const)("keeps %s update requirements separate", async (component) => {
    mock.connect.mockRejectedValue(new AndroidCompanionUpdateRequired(component));
    await startAndroidCompanion();
    expect(document.getElementById("companion-update-android")!.hidden).toBe(component !== "android");
    expect(document.getElementById("companion-update-extension")!.hidden).toBe(component !== "extension");
    await vi.advanceTimersByTimeAsync(300_000);
    expect(mock.connect).toHaveBeenCalledOnce();
  });
  it("clears update links before a retry whose connection outcome is unknown", async () => {
    mock.connect.mockRejectedValueOnce(new AndroidCompanionUpdateRequired("extension"));
    mock.connect.mockImplementation((_update, signal: AbortSignal) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
    await startAndroidCompanion();
    button().click();
    await vi.advanceTimersByTimeAsync(0);
    expect(document.getElementById("companion-update-extension")!.hidden).toBe(true);
    expect(document.getElementById("companion-update-android")!.hidden).toBe(true);
    button().click();
    await vi.advanceTimersByTimeAsync(0);
  });
  it("previews closed context without copying raw errors or arbitrary versions", async () => {
    vi.stubGlobal("chrome", { runtime: { getManifest: () => ({ version: "secret/path" }) }, permissions: { contains: mock.permission } });
    mock.connect.mockRejectedValue(new Error("/personal/path token=private account@example.test"));
    await startAndroidCompanion();
    button("companion-preview").click();
    const report = (document.getElementById("companion-context") as HTMLTextAreaElement).value;
    expect(report).not.toMatch(/personal|private|example|secret/u);
    expect(JSON.parse(report)).toMatchObject({ category: "connection_failed", extension_version: "unknown" });
    expect(status()).toBe("android.companion.failed");
  });
  it("labels frozen browser user-agent versions without claiming actual OS builds", async () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) Chrome/150.0.0.0" });
    mock.permission.mockResolvedValue(false);
    await startAndroidCompanion();
    button("companion-preview").click();
    const report = JSON.parse((document.getElementById("companion-context") as HTMLTextAreaElement).value);
    expect(report).toMatchObject({ chrome_user_agent_version: "150.0.0.0", chromeos_user_agent_version: "14541.0.0",
      chrome_build_version: "unknown", chromeos_build_version: "unknown" });
    expect(report).not.toHaveProperty("os_version");
    expect(report).not.toHaveProperty("chrome_version");
  });
  it("disconnect unmounts and closes before exposing manual recovery", async () => {
    const connection = connected();
    const task = startAndroidCompanion();
    await vi.advanceTimersByTimeAsync(0);
    expect(document.getElementById("companion-identity")!.querySelector("a")!.href).toContain("crostini/setup.html#android");
    expect(document.getElementById("companion-identity")!.textContent).toContain("shell.companion.title");
    connection.disconnect(); await task;
    expect(connection.unmount).toHaveBeenCalledOnce(); expect(connection.close).toHaveBeenCalledOnce();
    expect(document.getElementById("app")!.hidden).toBe(true);
    expect(status()).toBe("shell.companion.disconnected");
    await vi.advanceTimersByTimeAsync(300_000);
    expect(mock.connect).toHaveBeenCalledOnce();
  });
  it("departure during delayed mount joins the view and does not reconnect on restoration", async () => {
    const connection = connected();
    let mounted!: (close: () => Promise<void>) => void;
    mock.mount.mockReturnValue(new Promise(resolve => { mounted = resolve; }));
    const task = startAndroidCompanion(); await vi.advanceTimersByTimeAsync(0);
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    mounted(connection.unmount); await task; await vi.advanceTimersByTimeAsync(0);
    expect(connection.unmount).toHaveBeenCalledOnce();
    expect(document.getElementById("app")!.hidden).toBe(true);
    expect(mock.connect).toHaveBeenCalledOnce();
  });
  it("failed UI mount releases its authenticated client", async () => {
    const connection = connected(); mock.mount.mockRejectedValue(new Error("mount failure"));
    await startAndroidCompanion();
    expect(connection.close).toHaveBeenCalledOnce();
    expect(document.getElementById("app")!.hidden).toBe(true);
  });
});
