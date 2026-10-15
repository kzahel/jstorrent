import { encryptFragment, ID_PATTERN } from "../../../../services/link/src/codec";
import { SHARE_PAGE_URL } from "./share-link";

export const SHORT_LINK_ORIGIN = "https://link.jstorrent.com";
export interface ShortLink {
  readonly link: string;
  readonly expiresAt: string;
}

/** One bounded upload, with no automatic retries and no plaintext in HTTP. */
export async function createShortLink(fullLink: string, signal: AbortSignal): Promise<ShortLink> {
  const prefix = SHARE_PAGE_URL + "#";
  if (!fullLink.startsWith(prefix)) throw new Error("Invalid share link");
  const { record, key } = await encryptFragment(fullLink.slice(prefix.length));
  signal.throwIfAborted();
  const response = await fetch(SHORT_LINK_ORIGIN + "/v1/links", {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: record,
    signal,
    credentials: "omit",
    referrerPolicy: "no-referrer",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Short link service unavailable");
  // The response is tiny by contract. Read with a cap before JSON parsing.
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Invalid short link response");
  const bytes = new Uint8Array(1024);
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value.length > bytes.length - length) {
        await reader.cancel();
        throw new Error("Invalid short link response");
      }
      bytes.set(value, length);
      length += value.length;
    }
  } finally {
    reader.releaseLock();
  }
  const result: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(0, length)));
  if (typeof result !== "object" || result === null) throw new Error("Invalid short link response");
  const { id, expiresAt } = result as { id?: unknown; expiresAt?: unknown };
  if (typeof id !== "string" || !ID_PATTERN.test(id) || typeof expiresAt !== "string" ||
      expiresAt.length > 40 || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) {
    throw new Error("Invalid short link response");
  }
  return { link: `${SHORT_LINK_ORIGIN}/#${id}.${key}`, expiresAt };
}
