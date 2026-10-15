import { afterEach, describe, expect, it, vi } from "vitest";
import vectors from "../../../../services/link/test-vectors.json";
import { decodeKey, decryptFragment, encryptFragment } from "../../../../services/link/src/codec";
import { createShortLink, SHORT_LINK_ORIGIN } from "./share-short-link";
import { SHARE_PAGE_URL } from "./share-link";

afterEach(() => vi.unstubAllGlobals());
describe("encrypted short links", () => {
  it("matches the shared independent v1 vector in the client suite", async () => {
    for (const v of vectors) {
      const { record } = await encryptFragment(v.fragment, decodeKey(v.key), Uint8Array.from(v.iv.match(/../g)!, x => parseInt(x, 16)));
      expect(btoa(String.fromCharCode(...record))).toBe(v.record);
      expect(await decryptFragment(record, decodeKey(v.key))).toBe(v.fragment);
    }
  });
  it("posts only ciphertext without credentials or referrer and keeps the key in the URL", async () => {
    const fragment = vectors[0]!.fragment;
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "Abcd123456", expiresAt: "2099-01-01T00:00:00.000Z" })));
    vi.stubGlobal("fetch", fetcher);
    const result = await createShortLink(SHARE_PAGE_URL + "#" + fragment, new AbortController().signal);
    expect(result.link).toMatch(/^https:\/\/link\.jstorrent\.com\/#Abcd123456\.[A-Za-z0-9_-]{22}$/);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(SHORT_LINK_ORIGIN + "/v1/links");
    expect(init.credentials).toBe("omit"); expect(init.referrerPolicy).toBe("no-referrer");
    expect(new TextDecoder().decode(init.body)).not.toContain(fragment);
    expect(await decryptFragment(init.body, decodeKey(result.link.split(".").at(-1)!))).toBe(fragment);
  });
  it("does not retry failed requests or accept malformed service responses", async () => {
    for (const response of [new Response(null, {status:429}), new Response('{}'), new Response(JSON.stringify({id:'bad',expiresAt:'2099-01-01'})), new Response('a'.repeat(1025))]) {
      const fetcher = vi.fn().mockResolvedValue(response); vi.stubGlobal("fetch", fetcher);
      await expect(createShortLink(SHARE_PAGE_URL + "#xt=test", new AbortController().signal)).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it("an aborted request never uploads", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController(); controller.abort();
    await expect(createShortLink(SHARE_PAGE_URL + "#xt=test", controller.signal)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
