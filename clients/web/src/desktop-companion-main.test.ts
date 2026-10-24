// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationViewError } from "./api/client";
const mock = vi.hoisted(() => ({ connect: vi.fn(), mount: vi.fn(), send: vi.fn() }));
const hello = { backend: { kind: "desktop", product_version: "0.3.1" } };
vi.mock("./desktop-companion-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("./desktop-companion-client")>(),
  connectDesktopCompanion: mock.connect,
  desktopRuntime: () => ({ sendMessage: mock.send }),
}));
vi.mock("./inspection/companion-bootstrap", () => ({ startCompanionInspection: mock.mount }));
vi.mock("./localization/runtime", () => ({ message: (key: string) => key }));
import { startDesktopCompanion } from "./desktop-companion-main";

describe("desktop companion connection ownership", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    document.body.innerHTML = '<section id="companion-bootstrap"><h1></h1><p id="companion-status"></p><button id="companion-cancel"></button></section><div id="companion-identity"></div><div id="app" hidden></div>';
  });
  afterEach(() => {
    window.dispatchEvent(new Event("pagehide"));
    vi.useRealTimers();
  });
  it("retries attach without sending a start request", async () => {
    mock.connect.mockRejectedValue(new Error("stopped"));
    await startDesktopCompanion();
    await vi.advanceTimersByTimeAsync(31_000);
    expect(mock.connect).toHaveBeenCalledTimes(6);
    expect(mock.send).not.toHaveBeenCalled();
    expect(document.getElementById("app")!.hidden).toBe(true);
  });
  it("allows a fresh Start after stopped retries and coalesces double clicks", async () => {
    mock.connect.mockRejectedValue(new Error("stopped"));
    let ready!: (value: unknown) => void;
    mock.send.mockReturnValue(new Promise(resolve => { ready = resolve; }));
    await startDesktopCompanion();
    const button = document.getElementById("companion-cancel") as HTMLButtonElement;
    button.click();
    button.click();
    expect(mock.send).toHaveBeenCalledExactlyOnceWith({ type: "nativeBootstrap", op: "start_control" });
    ready({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(mock.connect).toHaveBeenCalledTimes(2);
    expect(button.disabled).toBe(false);
  });
  it("restores a cached stopped page with attach only", async () => {
    mock.connect.mockRejectedValue(new Error("stopped"));
    await startDesktopCompanion();
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mock.connect).toHaveBeenCalledOnce();
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(mock.connect).toHaveBeenCalledTimes(2);
    expect(mock.send).not.toHaveBeenCalled();
  });
  it("joins a departed page's delayed mount before restoring its owner", async () => {
    let mounted!: (close: () => Promise<void>) => void;
    let disconnected!: () => void;
    const close = vi.fn(async () => { disconnected(); });
    const unmount = vi.fn().mockResolvedValue(undefined);
    mock.connect.mockResolvedValueOnce({ client: { close }, hello, disconnected: new Promise<void>(resolve => { disconnected = resolve; }) });
    mock.connect.mockRejectedValue(new Error("stopped"));
    mock.mount.mockReturnValue(new Promise(resolve => { mounted = resolve; }));
    const running = startDesktopCompanion();
    await vi.advanceTimersByTimeAsync(0);
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(mock.connect).toHaveBeenCalledOnce();
    mounted(unmount);
    await running;
    await vi.advanceTimersByTimeAsync(0);
    expect(unmount).toHaveBeenCalledOnce();
    expect(mock.connect).toHaveBeenCalledTimes(2);
    expect(document.getElementById("app")!.hidden).toBe(true);
    expect(mock.send).not.toHaveBeenCalled();
  });
  it("releases a cached page even when its socket never reports disconnect", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const unmount = vi.fn().mockResolvedValue(undefined);
    mock.connect.mockResolvedValueOnce({ client: { close }, hello, disconnected: new Promise(() => {}) });
    mock.connect.mockRejectedValue(new Error("stopped"));
    mock.mount.mockResolvedValue(unmount);
    const running = startDesktopCompanion();
    await vi.advanceTimersByTimeAsync(0);
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    await running;
    expect(unmount).toHaveBeenCalledOnce();
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(mock.connect).toHaveBeenCalledTimes(2);
    expect(mock.send).not.toHaveBeenCalled();
  });
  it("closes the connection when the shared UI fails to mount", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    mock.connect.mockResolvedValue({ client: { close }, hello, disconnected: new Promise(() => {}) });
    mock.mount.mockRejectedValue(new Error("mount failed"));
    await startDesktopCompanion();
    expect(close).toHaveBeenCalledOnce();
    expect(document.getElementById("companion-bootstrap")!.hidden).toBe(false);
  });
  it("stops automatic attempts after an authentication failure", async () => {
    mock.connect.mockRejectedValue(new ApplicationViewError("authentication_failed", "identity changed"));
    await startDesktopCompanion();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(mock.connect).toHaveBeenCalledOnce();
    expect(mock.send).not.toHaveBeenCalled();
  });
  it.each(["invalid_version", "authentication_failed"])("offers attach-only retry after %s", async (code) => {
    mock.connect.mockRejectedValueOnce(new ApplicationViewError(code, "repair required"));
    mock.connect.mockRejectedValue(new Error("stopped"));
    await startDesktopCompanion();
    const button = document.getElementById("companion-cancel") as HTMLButtonElement;
    expect(button.textContent).toBe("desktop.companion.retry");
    expect(document.getElementById("companion-status")!.textContent).toBe(
      code === "invalid_version" ? "desktop.companion.incompatible" : "desktop.companion.identity-changed",
    );
    const recovery = document.querySelector<HTMLAnchorElement>("#companion-bootstrap a")!.parentElement!;
    expect(recovery.hidden).toBe(code === "authentication_failed");
    await vi.advanceTimersByTimeAsync(90_000);
    expect(mock.connect).toHaveBeenCalledOnce();
    button.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(mock.connect).toHaveBeenCalledTimes(2);
    expect(mock.send).not.toHaveBeenCalled();
    expect(button.textContent).toBe("desktop.companion.start");
    expect(button.disabled).toBe(false);
  });
  it("keeps a Start-time version refusal terminal until an attach-only retry", async () => {
    mock.connect.mockRejectedValue(new Error("stopped"));
    mock.send.mockResolvedValue({ ok: false, error: { code: "unsupported_protocol" } });
    await startDesktopCompanion();
    const button = document.getElementById("companion-cancel") as HTMLButtonElement;
    button.click();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(mock.connect).toHaveBeenCalledOnce();
    expect(button.textContent).toBe("desktop.companion.retry");
    expect(button.disabled).toBe(false);
    button.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(mock.connect).toHaveBeenCalledTimes(2);
    expect(mock.send).toHaveBeenCalledExactlyOnceWith({ type: "nativeBootstrap", op: "start_control" });
  });
  it("offers both product links for a mismatch, then hides stale guidance while retrying", async () => {
    mock.connect.mockRejectedValueOnce(new ApplicationViewError("invalid_version", "mismatch"));
    mock.connect.mockImplementation((signal: AbortSignal) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
    await startDesktopCompanion();
    const links = [...document.querySelectorAll<HTMLAnchorElement>("#companion-bootstrap a")];
    expect(links.map(link => link.href)).toEqual([
      "https://jstorrent.com/",
      "https://chromewebstore.google.com/detail/dbokmlpefliilbjldladbimlcfgbolhk",
    ]);
    expect(links.every(link => link.target === "_blank" && link.rel === "noopener noreferrer")).toBe(true);
    expect(links[0]!.parentElement!.hidden).toBe(false);
    expect(links[1]!.parentElement!.hidden).toBe(false);
    (document.getElementById("companion-cancel") as HTMLButtonElement).click();
    await vi.advanceTimersByTimeAsync(0);
    expect(links[0]!.parentElement!.hidden).toBe(true);
    expect(mock.send).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("pagehide"));
    await vi.advanceTimersByTimeAsync(0);
  });
  it("unmounts a disconnected view before another attachment", async () => {
    let disconnect!: () => void;
    const close = vi.fn().mockResolvedValue(undefined);
    const unmount = vi.fn().mockResolvedValue(undefined);
    mock.connect.mockResolvedValueOnce({ client: { close }, hello, disconnected: new Promise<void>(resolve => { disconnect = resolve; }) });
    mock.connect.mockRejectedValue(new Error("stopped"));
    mock.mount.mockResolvedValue(unmount);
    const running = startDesktopCompanion();
    await vi.advanceTimersByTimeAsync(0);
    expect(document.getElementById("app")!.hidden).toBe(false);
    expect(mock.mount).toHaveBeenCalledWith(expect.anything(), false,
      { connection: "desktop-companion", hostVersion: "0.3.1" });
    disconnect();
    await running;
    expect(unmount).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(document.getElementById("app")!.hidden).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(mock.connect).toHaveBeenCalledTimes(2);
    expect(mock.send).not.toHaveBeenCalled();
  });
});
