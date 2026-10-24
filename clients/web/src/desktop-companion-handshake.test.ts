import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContractError } from "./validation";
const socket = vi.hoisted(() => ({ hello: vi.fn(), close: vi.fn() }));
vi.mock("./websocket-view-client", () => ({
  WebSocketApplicationViewClient: class {
    hello = socket.hello; close = socket.close;
    dispatch() {} addTorrentBytes() {} chooseDownloadRoot() {} openViewSet() {}
    updateViewSet() {} streamUpdates() {} closeViewSet() {}
  },
}));
import { connectDesktopCompanion } from "./desktop-companion-client";
const ready = { kind: "ready", endpoint: "http://127.0.0.1:32145", credential: "ab".repeat(32), instanceId: "cd".repeat(16), profileId: "default" };
const backend = { kind: "desktop", instance_id: ready.instanceId, profile_id: "default", product_version: "0.1.4", capability_profile: ["desktop_control_v1"] };
let send: ReturnType<typeof vi.fn>;
describe("desktop handshake refusal and recovery", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    socket.close.mockResolvedValue(undefined);
    send = vi.fn().mockResolvedValue({ ok: true, result: ready });
    vi.stubGlobal("chrome", { runtime: { sendMessage: send } });
  });
  afterEach(() => vi.unstubAllGlobals());
  it("closes a schema-incompatible socket and classifies it terminally", async () => {
    socket.hello.mockRejectedValue(new ContractError("API version 1 is not supported"));
    await expect(connectDesktopCompanion(new AbortController().signal)).rejects.toHaveProperty("code", "invalid_version");
    expect(socket.close).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: "nativeBootstrap", op: "attach_control" });
  });
  it("refuses missing desktop capability independently of a matching identity", async () => {
    socket.hello.mockResolvedValue({ backend: { ...backend, capability_profile: [] } });
    await expect(connectDesktopCompanion(new AbortController().signal)).rejects.toHaveProperty("code", "invalid_version");
    expect(socket.close).toHaveBeenCalledOnce();
  });
  it.each([{ instance_id: "ef".repeat(16) }, { profile_id: "other" }, { kind: "android" }])("refuses changed identity %j", async (change) => {
    socket.hello.mockResolvedValue({ backend: { ...backend, ...change } });
    await expect(connectDesktopCompanion(new AbortController().signal)).rejects.toHaveProperty("code", "authentication_failed");
    expect(socket.close).toHaveBeenCalledOnce();
  });
  it("accepts a compatible product version and fetches fresh bootstrap after replacement", async () => {
    socket.hello.mockResolvedValueOnce({ backend: { ...backend, product_version: "future-compatible" } });
    const first = await connectDesktopCompanion(new AbortController().signal);
    await first.client.close();
    const next = "ef".repeat(16);
    send.mockResolvedValue({ ok: true, result: { ...ready, instanceId: next, credential: "12".repeat(32) } });
    socket.hello.mockResolvedValue({ backend: { ...backend, instance_id: next } });
    const second = await connectDesktopCompanion(new AbortController().signal);
    expect(second.hello.backend?.instance_id).toBe(next);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.every(([request]) => request.op === "attach_control")).toBe(true);
    await second.client.close();
  });
});
