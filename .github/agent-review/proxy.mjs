import http from 'node:http';
import https from 'node:https';

const routes = new Set(['POST /responses', 'POST /responses/compact', 'GET /models']);
const requestHeaders = ['content-type', 'accept', 'originator', 'user-agent'];
const responseHeaders = ['content-type', 'cache-control', 'retry-after'];

// No arbitrary destination, redirects, owner API, or caller-supplied auth.
export function createProxy({ token, origin, socketPath, maxBytes = 32 * 1024 * 1024,
  transport = https, maxRequests = 512 }) {
  const base = new URL(origin);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash ||
      base.pathname !== '/codex') throw new Error('Router URL must be HTTPS with path /codex');
  let count = 0;
  const server = http.createServer({ maxHeaderSize: 16 * 1024 }, async (req, res) => {
    const route = (req.url ?? '').split('?')[0];
    if (!routes.has(`${req.method} ${route}`) || !req.url.startsWith('/') || req.url.startsWith('//')) {
      res.writeHead(404).end(); return;
    }
    if (++count > maxRequests) { res.writeHead(429).end(); return; }
    const chunks = []; let size = 0;
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > maxBytes) { res.writeHead(413).end(); return; }
        chunks.push(chunk);
      }
    } catch { res.destroy(); return; }
    const headers = { authorization: `Bearer ${token}` };
    for (const name of requestHeaders) if (req.headers[name]) headers[name] = req.headers[name];
    for (const [name, value] of Object.entries(req.headers)) {
      if (name.startsWith('x-codex-')) headers[name] = value;
    }
    const upstream = transport.request(new URL(base.href + req.url), { method: req.method, headers }, reply => {
      if (reply.statusCode >= 300 && reply.statusCode < 400) {
        reply.destroy(); res.writeHead(502).end(); return;
      }
      const safe = {};
      for (const name of responseHeaders) if (reply.headers[name]) safe[name] = reply.headers[name];
      res.writeHead(reply.statusCode ?? 502, safe);
      reply.on('error', () => res.destroy());
      reply.pipe(res);
    });
    upstream.setTimeout(10 * 60 * 1000, () => upstream.destroy());
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502).end(); else res.destroy(); });
    res.on('close', () => upstream.destroy());
    upstream.end(Buffer.concat(chunks));
  });
  server.requestTimeout = 120_000;
  server.headersTimeout = 30_000;
  server.on('upgrade', (_req, socket) => socket.destroy());
  return { server, socketPath };
}

export function createSocketBridge(socketPath) {
  return http.createServer((req, res) => {
    const upstream = http.request({ socketPath, path: req.url, method: req.method, headers: req.headers }, reply => {
      res.writeHead(reply.statusCode, reply.headers); reply.pipe(res);
      reply.on('error', () => res.destroy());
    });
    res.on('close', () => upstream.destroy());
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502).end(); else res.destroy(); });
    req.pipe(upstream);
  });
}
