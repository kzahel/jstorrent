import { ID_PATTERN, MAX_RECORD_BYTES, validRecord } from "./codec.ts";

interface Env {
  LINKS: KVNamespace;
  CREATE_LIMIT: RateLimit;
  READ_LIMIT: RateLimit;
  ASSETS: Fetcher;
}
const TTL = 30 * 24 * 60 * 60;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'none'; base-uri 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; frame-ancestors 'none'; form-action 'none'",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

/** Rejection sampling avoids modulo bias. Callers cannot choose a storage key. */
export function randomId(): string {
  let id = "";
  while (id.length < 10) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      if (byte < 248 && id.length < 10) id += ALPHABET[byte % 62];
    }
  }
  return id;
}

async function readBounded(request: Request): Promise<Uint8Array<ArrayBuffer> | null> {
  const length = request.headers.get("Content-Length");
  if (length !== null && Number(length) > MAX_RECORD_BYTES) return null;
  if (request.body === null) return new Uint8Array();
  const reader = request.body.getReader();
  const result = new Uint8Array(MAX_RECORD_BYTES);
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return result.slice(0, size);
      if (value.length > MAX_RECORD_BYTES - size) {
        await reader.cancel();
        return null;
      }
      result.set(value, size);
      size += value.length;
    }
  } finally {
    reader.releaseLock();
  }
}

export async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const api = url.pathname.startsWith("/v1/");
  const headers = { ...SECURITY_HEADERS, ...(api ? CORS : {}) };
  const reply = (body: BodyInit | null, status: number, extra = {}) =>
    new Response(body, { status, headers: { ...headers, ...extra } });
  try {
    if (!api) {
      if (request.method !== "GET" && request.method !== "HEAD") return reply(null, 405, { Allow: "GET, HEAD" });
      // Route through the Worker so HTML, scripts and errors all receive policy.
      const asset = await env.ASSETS.fetch(request);
      const response = new Response(asset.body, asset);
      for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
      return response;
    }
    const create = url.pathname === "/v1/links";
    const id = url.pathname.startsWith("/v1/links/") ? url.pathname.slice(10) : "";
    if (!create && !ID_PATTERN.test(id)) return reply(null, 404);
    if (request.method === "OPTIONS") return reply(null, 204);
    if ((create && request.method !== "POST") || (!create && request.method !== "GET")) {
      return reply(null, 405, { Allow: create ? "POST, OPTIONS" : "GET, OPTIONS" });
    }
    const limiter = create ? env.CREATE_LIMIT : env.READ_LIMIT;
    if (!(await limiter.limit({ key: request.headers.get("CF-Connecting-IP") ?? "local" })).success) {
      return reply(null, 429, { "Retry-After": "60" });
    }
    if (create) {
      if (url.search !== "") return reply(null, 400);
      if (request.headers.get("Content-Type")?.toLowerCase() !== "application/octet-stream") return reply(null, 415);
      const record = await readBounded(request);
      if (record === null) return reply(null, 413);
      if (!validRecord(record)) return reply(null, 400);
      // No public update endpoint. Collisions are negligibly likely, but checked.
      for (let attempt = 0; attempt < 5; attempt++) {
        const id = randomId();
        if (await env.LINKS.get(id, "arrayBuffer") !== null) continue;
        const expiresAt = new Date(Date.now() + TTL * 1000).toISOString();
        await env.LINKS.put(id, record, { expirationTtl: TTL });
        return reply(JSON.stringify({ id, expiresAt }), 201, { "Content-Type": "application/json" });
      }
      return reply(null, 503);
    }
    const stored = await env.LINKS.get(id, "arrayBuffer");
    if (stored === null) return reply(null, 404);
    if (!validRecord(new Uint8Array(stored))) return reply(null, 503);
    return reply(stored, 200, { "Content-Type": "application/octet-stream" });
  } catch {
    // No request data, encrypted bodies or identifiers in logs or responses.
    return reply(null, 503);
  }
}
export default { fetch: handle };
