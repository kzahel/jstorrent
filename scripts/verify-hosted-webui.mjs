#!/usr/bin/env node

import fs from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const options = parseOptions(process.argv.slice(2));
const password = stripOneLineEnding(
  await fs.readFile(options.passwordFile, "utf8"),
);
if (password.length === 0 || password.length > 128 || /[\r\n]/u.test(password)) {
  throw new Error("password file must contain one bounded password line");
}
const authorization = `Basic ${Buffer.from(
  `${options.username}:${password}`,
  "utf8",
).toString("base64")}`;
// A direct private hop still addresses the configured public virtual host.
// Keep the gateway's exact Host check intact when transport uses loopback/LAN.
const host = new URL(options.origin).host;
const headers = { Authorization: authorization, Host: host };

const indexUrl = new URL("/", options.url);
const indexResponse = await fetchWithTimeout(indexUrl, { headers });
if (!indexResponse.ok) {
  throw new Error(`hosted index returned HTTP ${indexResponse.status}`);
}
if (!indexResponse.headers.get("content-type")?.startsWith("text/html")) {
  throw new Error("hosted index did not return HTML");
}
const index = await indexResponse.text();
const entrypoint = index.match(
  /<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["']/u,
)?.[1];
if (!entrypoint) {
  throw new Error("hosted index did not name a module entrypoint");
}
const entrypointResponse = await fetchWithTimeout(
  new URL(entrypoint, indexUrl),
  { headers },
);
if (!entrypointResponse.ok) {
  throw new Error(
    `hosted module entrypoint returned HTTP ${entrypointResponse.status}`,
  );
}

const healthUrl = new URL("/healthz", options.url);
const healthResponse = await fetchWithTimeout(healthUrl, {
  headers,
});
if (!healthResponse.ok) {
  throw new Error(`hosted health returned HTTP ${healthResponse.status}`);
}
const health = await healthResponse.json();
if (health.status !== "ok" || health.build_id !== options.buildId) {
  throw new Error("hosted health returned the wrong build identity");
}

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const wsModule = pathToFileURL(
  path.join(repositoryRoot, "clients/web/node_modules/ws/wrapper.mjs"),
).href;
const { WebSocket } = await import(wsModule);
const socketUrl = new URL("/api/v1/connect", options.url);
socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";

await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    socket.terminate();
    reject(new Error("hosted WebSocket verification timed out"));
  }, 10_000);
  const finish = (callback, value) => {
    clearTimeout(timeout);
    callback(value);
  };
  const socket = new WebSocket(socketUrl, {
    headers: {
      Authorization: authorization,
      Host: host,
      Origin: options.origin,
    },
  });
  socket.once("open", () => {
    socket.send(
      JSON.stringify({
        type: "connect",
        api_version: 1,
        encoding: "json",
        client_instance_id: "00000000000000000000000000000001",
      }),
    );
  });
  socket.once("message", (data, binary) => {
    if (binary) {
      finish(reject, new Error("hosted WebSocket returned a binary frame"));
      return;
    }
    let frame;
    try {
      frame = JSON.parse(data.toString());
    } catch (error) {
      finish(reject, error);
      return;
    }
    if (frame.type !== "connected" || frame.api_version !== 1) {
      finish(reject, new Error("hosted WebSocket did not negotiate API v1"));
      return;
    }
    socket.close(1000, "verification complete");
    finish(resolve);
  });
  socket.once("error", (error) => finish(reject, error));
});

process.stdout.write(
  `verified hosted build ${options.buildId} static assets, health, and WebSocket\n`,
);

async function fetchWithTimeout(url, init) {
  // Node fetch does not preserve a caller-supplied Host on a private hop.
  // Use the HTTP client so the configured virtual host reaches the gateway.
  const transport = url.protocol === "https:" ? https : http;
  return await new Promise((resolve, reject) => {
    const request = transport.request(url, init, (response) => {
      const chunks = [];
      let bytes = 0;
      response.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > 8 * 1024 * 1024) {
          request.destroy(new Error("hosted response exceeds 8 MiB"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => {
        resolve(new Response(Buffer.concat(chunks), {
          status: response.statusCode,
          headers: response.headers,
        }));
      });
    });
    const timeout = setTimeout(() => {
      request.destroy(new Error("hosted verification request timed out"));
    }, 10_000);
    request.on("error", reject);
    request.on("close", () => clearTimeout(timeout));
    request.end();
  });
}

function stripOneLineEnding(value) {
  if (value.endsWith("\r\n")) return value.slice(0, -2);
  if (value.endsWith("\n")) return value.slice(0, -1);
  return value;
}

function parseOptions(arguments_) {
  const values = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new Error(
        "usage: verify-hosted-webui.mjs --url URL --origin ORIGIN --username USER --password-file PATH --build-id ID",
      );
    }
    values.set(name.slice(2), value);
  }
  const required = ["url", "origin", "username", "password-file", "build-id"];
  for (const name of required) {
    if (!values.get(name)) throw new Error(`missing --${name}`);
  }
  const url = new URL(values.get("url"));
  const origin = new URL(values.get("origin")).origin;
  const username = values.get("username");
  if (!/^https?:$/u.test(url.protocol)) throw new Error("URL must use HTTP(S)");
  if (!/^https:$/u.test(new URL(origin).protocol)) {
    throw new Error("Origin must use HTTPS");
  }
  if (username.length > 64 || username.includes(":")) {
    throw new Error("username must be bounded and contain no colon");
  }
  return {
    url,
    origin,
    username,
    passwordFile: values.get("password-file"),
    buildId: values.get("build-id"),
  };
}
