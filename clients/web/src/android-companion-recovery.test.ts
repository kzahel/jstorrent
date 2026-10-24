// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApplicationViewError } from "./api/client";
import { connectAndroidCompanion } from "./android-companion-client";

const socket = vi.hoisted(() => ({ hello: vi.fn(), close: vi.fn(async () => {}) }));
vi.mock("./websocket-view-client", () => ({
  WebSocketApplicationViewClient: class {
    hello = socket.hello;
    close = socket.close;
  },
}));
const origin = "chrome-extension://gcgoepclopkgijmclmlheafaglmbjlcc";
const backend = { kind: "android", instance_id: "abcdefghijklmnop", profile_id: "default", product_version: "0.1.0",
  capability_profile: ["android_saf_acquisition", "retained_storage_roots", "one_current_root", "joined_platform_root_removal"] };
const hello = { backend, capabilities: ["torrent_list"] };
function setup(saved = true) {
  const set = vi.fn();
  const stored = { installationId: "00000000000000000000000000000001", credential: "saved-credential", backend };
  vi.stubGlobal("chrome", { storage: { local: { get: async () => saved ? { rstorrentAndroidCompanionV1: stored } : {}, set } } });
  vi.stubGlobal("location", { origin });
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: URL) => {
    requests.push(url.pathname);
    if (url.port !== "3030") throw new TypeError("unavailable port");
    if (url.pathname.endsWith("/hello")) return new Response(JSON.stringify({ product: "rstorrent", backend: "android", protocol_min: 1,
      protocol_max: 1, nonce: "abcdefghijklmnop", paired: saved, port: 3030 }));
    if (url.pathname.endsWith("/pairing/request")) return new Response(JSON.stringify({ request_id: "abcdefghijklmnop", expires_in_seconds: 120 }));
    if (url.pathname.endsWith("/pairing/poll")) return new Response(JSON.stringify({ status: "approved", credential: "approved-credential" }));
    throw new Error("unexpected request");
  }));
  return { set, requests };
}
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); socket.hello.mockReset(); });

describe("Android saved pairing after interruption", () => {
  it.each([
    new Error("application WebSocket connection failed"),
    new ApplicationViewError("connection_closed", "interrupted handshake"),
    new ApplicationViewError("resource_limit", "busy"),
  ])("preserves saved authority on a non-authentication failure: %s", async (failure) => {
    const { set, requests } = setup();
    socket.hello.mockRejectedValueOnce(failure).mockResolvedValue(hello);
    await expect(connectAndroidCompanion(() => {})).rejects.toBe(failure);
    expect(requests.some(path => path.includes("/pairing/"))).toBe(false);
    expect(set).not.toHaveBeenCalled();
    expect(socket.close).toHaveBeenCalledOnce();
    const connection = await connectAndroidCompanion(() => {});
    expect(connection.hello).toEqual(hello);
    expect(requests.some(path => path.includes("/pairing/"))).toBe(false);
    await connection.client.close();
  });
  it("requests fresh approval only after explicit saved-credential rejection", async () => {
    const { requests, set } = setup();
    socket.hello.mockRejectedValueOnce(new ApplicationViewError("authentication_failed", "rejected")).mockResolvedValue(hello);
    const connection = await connectAndroidCompanion(() => {});
    expect(requests.filter(path => path.endsWith("/pairing/request"))).toHaveLength(1);
    expect(set).toHaveBeenCalledWith({ rstorrentAndroidCompanionV1: expect.objectContaining({ credential: "approved-credential" }) });
    await connection.client.close();
  });
  it("does not start a second approval loop when a fresh credential fails", async () => {
    const { requests, set } = setup(false);
    const failure = new ApplicationViewError("authentication_failed", "rejected");
    socket.hello.mockRejectedValue(failure);
    await expect(connectAndroidCompanion(() => {})).rejects.toBe(failure);
    expect(requests.filter(path => path.endsWith("/pairing/request"))).toHaveLength(1);
    expect(set).not.toHaveBeenCalled();
  });
});
