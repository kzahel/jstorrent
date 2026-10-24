import { afterEach, describe, expect, it, vi } from "vitest";
import { AndroidPlatformClient } from "./android-companion-client";

const origin = "chrome-extension://gcgoepclopkgijmclmlheafaglmbjlcc";

function client() {
  vi.stubGlobal("location", { origin });
  return new AndroidPlatformClient("http://100.115.92.2:3030", "test-installation", "test-credential");
}

afterEach(() => vi.unstubAllGlobals());

describe("Android folder picker recovery", () => {
  it("explains expiration and allows a new selection without automatic retry", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response("", { status: 408 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ root: null })));
    vi.stubGlobal("fetch", fetch);
    const platform = client();
    await expect(platform.chooseDownloadRoot({})).rejects.toThrow(
      "Folder selection timed out. Close the Android folder picker, then try selecting the folder again.",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(platform.chooseDownloadRoot({ repair_root: "retained-root" })).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
    const [url, request] = fetch.mock.calls[1]!;
    expect(url.pathname).toBe("/rstorrent/companion/v1/platform/download-root");
    expect(JSON.parse(request.body)).toEqual({ repair_root: "retained-root" });
    expect(new Headers(request.headers).get("Origin")).toBe(origin);
  });

  it("preserves caller cancellation rather than reporting a picker timeout", async () => {
    const abort = new AbortController();
    const reason = new DOMException("selection canceled", "AbortError");
    abort.abort(reason);
    const fetch = vi.fn().mockRejectedValue(reason);
    vi.stubGlobal("fetch", fetch);
    await expect(client().chooseDownloadRoot({}, abort.signal)).rejects.toBe(reason);
    expect(fetch.mock.calls[0]![1].signal).toBe(abort.signal);
  });

  it("does not mislabel lost authorization as an expired picker", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 401 })));
    await expect(client().chooseDownloadRoot({})).rejects.toThrow("Android companion request failed (401)");
  });
});
