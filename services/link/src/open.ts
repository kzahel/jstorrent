import { decryptFragment, MAX_RECORD_BYTES, parseShortLinkFragment } from "./codec.ts";

const status = document.getElementById("status")!;
const retry = document.getElementById("retry") as HTMLButtonElement;
let pending: AbortController | null = null;
let generation = 0;

async function open(): Promise<void> {
  const current = ++generation;
  pending?.abort();
  pending = null;
  if (location.hash === "") {
    location.replace("https://jstorrent.com/");
    return;
  }
  retry.hidden = true;
  status.textContent = "Opening your shared link…";
  try {
    const { id, key } = parseShortLinkFragment(location.hash);
    const controller = new AbortController();
    pending = controller;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`/v1/links/${id}`, { signal: controller.signal, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
      if (current !== generation) return;
      if (!response.ok) {
        status.textContent = response.status === 404
          ? "This link is unavailable or has expired. If it was just created, try again shortly."
          : "This link could not be opened right now. Please try again.";
        retry.hidden = false;
        return;
      }
      // Bounded streamed read; never allocate an unbounded response body.
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Missing record");
      const bytes = new Uint8Array(MAX_RECORD_BYTES);
      let length = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value.length > MAX_RECORD_BYTES - length) {
            await reader.cancel();
            throw new Error("Oversized record");
          }
          bytes.set(value, length);
          length += value.length;
        }
      } finally {
        reader.releaseLock();
      }
      const fragment = await decryptFragment(bytes.subarray(0, length), key);
      if (current === generation) location.replace("https://jstorrent.com/share/#" + fragment);
    } finally {
      clearTimeout(timeout);
      if (pending === controller) pending = null;
    }
  } catch {
    if (current !== generation) return;
    status.textContent = "This link is invalid, damaged or could not be opened. Please check the complete link and try again.";
    retry.hidden = false;
  }
}
retry.addEventListener("click", () => void open());
window.addEventListener("hashchange", () => void open());
window.addEventListener("pagehide", () => { generation++; pending?.abort(); });
void open();
