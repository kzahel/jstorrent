/** Shared, bounded v1 format. No storage, UI or platform adapter dependencies. */
export const MAX_FRAGMENT_BYTES = 20 * 1024;
export const BLOCK_BYTES = 1024;
export const MAX_RECORD_BYTES = 21 * 1024 + 29;
export const ID_PATTERN = /^[A-Za-z0-9]{10}$/;
const AAD = new TextEncoder().encode("jstorrent-link-v1");
const FRAGMENT_PATTERN = /^(?:[A-Za-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9A-Fa-f]{2})+$/;

export function validateFragment(fragment: string): void {
  // Allowed characters are ASCII, so the length is also the UTF-8 byte length.
  if (fragment.length > MAX_FRAGMENT_BYTES || !FRAGMENT_PATTERN.test(fragment)) {
    throw new Error("Invalid share fragment");
  }
}

export function validRecord(record: Uint8Array): boolean {
  return record[0] === 1 && record.length >= BLOCK_BYTES + 29 &&
    record.length <= MAX_RECORD_BYTES && (record.length - 29) % BLOCK_BYTES === 0;
}

export function encodeKey(key: Uint8Array): string {
  if (key.length !== 16) throw new Error("Invalid link key");
  return btoa(String.fromCharCode(...key)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function decodeKey(key: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]{22}$/.test(key)) throw new Error("Invalid link key");
  const bytes = Uint8Array.from(atob(key.replaceAll("-", "+").replaceAll("_", "/") + "=="), c => c.charCodeAt(0));
  if (encodeKey(bytes) !== key) throw new Error("Invalid link key");
  return bytes;
}

export function parseShortLinkFragment(hash: string): { id: string; key: Uint8Array<ArrayBuffer> } {
  const match = /^#([A-Za-z0-9]{10})\.([A-Za-z0-9_-]{22})$/.exec(hash);
  if (!match) throw new Error("Invalid short link");
  return { id: match[1]!, key: decodeKey(match[2]!) };
}

/** Optional explicit key/IV are for reproducible independently authored vectors. */
export async function encryptFragment(
  fragment: string,
  key = crypto.getRandomValues(new Uint8Array(16)),
  iv = crypto.getRandomValues(new Uint8Array(12)),
): Promise<{ record: Uint8Array<ArrayBuffer>; key: string }> {
  validateFragment(fragment);
  if (key.length !== 16 || iv.length !== 12) throw new Error("Invalid key or IV");
  const text = new TextEncoder().encode(fragment);
  const padded = new Uint8Array((Math.floor(text.length / BLOCK_BYTES) + 1) * BLOCK_BYTES);
  padded.set(text);
  padded[text.length] = 0x80;
  const imported = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD, tagLength: 128 }, imported, padded);
  const record = new Uint8Array(13 + encrypted.byteLength);
  record[0] = 1;
  record.set(iv, 1);
  record.set(new Uint8Array(encrypted), 13);
  return { record, key: encodeKey(key) };
}

export async function decryptFragment(record: Uint8Array, key: Uint8Array): Promise<string> {
  if (!validRecord(record) || key.length !== 16) throw new Error("Invalid encrypted link");
  const imported = await crypto.subtle.importKey("raw", new Uint8Array(key), "AES-GCM", false, ["decrypt"]);
  const plaintext = new Uint8Array(await crypto.subtle.decrypt({
    name: "AES-GCM", iv: new Uint8Array(record.subarray(1, 13)), additionalData: AAD, tagLength: 128,
  }, imported, new Uint8Array(record.subarray(13))));
  let end = plaintext.length - 1;
  while (end >= 0 && plaintext[end] === 0) end--;
  if (plaintext[end] !== 0x80) throw new Error("Invalid link padding");
  const fragment = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(plaintext.subarray(0, end));
  validateFragment(fragment);
  return fragment;
}
