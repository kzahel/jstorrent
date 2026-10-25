import { execFile } from "node:child_process";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from "vite";
import { platformLocales, readLocaleRegistry } from "../../scripts/localization-registry.mjs";

const proxyTarget = process.env.RSTORRENT_WEBUI_PROXY_TARGET;
const liveReload = process.env.RSTORRENT_WEBUI_RELOAD === "1";
const proxy: Record<string, string | ProxyOptions> | undefined =
  proxyTarget === undefined
    ? undefined
    : {
        "/api": {
          target: proxyTarget,
          changeOrigin: !liveReload,
          ws: true,
        },
        // Development gateways mint media URLs on this visible origin and
        // check the visible Host, so media keeps it.
        "/media": { target: proxyTarget, changeOrigin: false },
        ...(liveReload
          ? { "/healthz": { target: proxyTarget, changeOrigin: false } }
          : {}),
      };

/**
 * Tactical 365: recompiles the message catalog when its source changes, so a
 * copy edit reaches the page through the runtime's hot update.
 */
export function compileLocalizationOnChange(webRoot = process.cwd()): Plugin {
  const repositoryRoot = resolve(webRoot, "../..");
  const manifest = resolve(repositoryRoot, "localization/locales.json");
  const generator = resolve(webRoot, "scripts/generate-localization.mjs");
  return {
    name: "rstorrent-compile-localization",
    apply: "serve",
    configureServer(server) {
      let sources = new Set<string>();
      let compiling = false;
      let queued = false;
      let closed = false;
      let child: ReturnType<typeof execFile> | undefined;
      const refreshSources = () => {
        try {
          const registry = readLocaleRegistry(repositoryRoot);
          const directory = resolve(repositoryRoot, registry.catalogs.web, "..");
          sources = new Set(platformLocales(registry, "web", true).map((locale: string) => resolve(directory, `${locale}.json`)));
          server.watcher.add([...sources, manifest]);
        } catch (error) {
          server.config.logger.error(`locale registry is invalid: ${String(error)}`);
        }
      };
      const compile = () => {
        if (closed) return;
        queued = true;
        if (compiling) return;
        compiling = true;
        queued = false;
        child = execFile(process.execPath, [generator], (error, _stdout, stderr) => {
          compiling = false;
          child = undefined;
          if (closed) return;
          if (error !== null) server.config.logger.error(`message catalogs did not compile: ${stderr || error.message}`);
          refreshSources();
          if (queued) compile();
        });
      };
      server.httpServer?.once("close", () => { closed = true; queued = false; child?.kill(); });
      refreshSources();
      server.watcher.on("all", (event, file) => {
        if (!["add", "change", "unlink"].includes(event)) return;
        const changed = resolve(file);
        if (changed !== manifest && !sources.has(changed)) return;
        if (changed === manifest) refreshSources();
        compile();
      });
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const remote = mode === "remote";
  const companion = mode === "companion";
  if (remote) {
    const environment = loadEnv(mode, process.cwd(), "");
    const relay = environment.VITE_RSTORRENT_REMOTE_RELAY_URL;
    const build = environment.VITE_RSTORRENT_REMOTE_BUILD_ID;
    if (relay === undefined || !relay.startsWith("wss://")) {
      throw new Error(
        "remote build requires VITE_RSTORRENT_REMOTE_RELAY_URL=wss://...",
      );
    }
    if (build === undefined || build.length < 1 || build.length > 160) {
      throw new Error("remote build requires VITE_RSTORRENT_REMOTE_BUILD_ID");
    }
  }
  return {
    // Fast Refresh keeps page and store state across component edits. Builds
    // keep Vite's own JSX transform.
    plugins: command === "serve" ? [react(), compileLocalizationOnChange()] : [],
    build: {
      assetsInlineLimit: 0,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                // Tactical 352: the generated validators load with the
                // transport after the first render. Without this group the
                // bundler places small modules the shell shares with them,
                // such as the API error classes, in the validator chunk.
                name: "validation",
                test: /\/src\/(?:validation\.ts|api\/schema\.ts|api\/generated\/v1\.validators\.js)$/,
                includeDependenciesRecursively: false,
              },
            ],
          },
        },
      },
    },
    server: { proxy },
    preview: { proxy },
    optimizeDeps: {
      // The remote page imports a wasm client that exists only in remote
      // builds; scanning it fails the startup scan, and late discovery then
      // reloads the page and can split React across mismatched bundles.
      entries: ["index.html", "companion.html"],
      // The player loads playsvideo lazily. Discovering it on the first Play
      // makes the dev server reload the page and drop the open player.
      include: ["playsvideo"],
    },
    ...(companion
      ? {
          base: "./",
          publicDir: false,
          build: {
            assetsInlineLimit: 0,
            outDir: "dist/companion",
            emptyOutDir: true,
            // The extension packages and reviews exactly one script and one
            // stylesheet, so on-demand panels are bundled in rather than split.
            cssCodeSplit: false,
            rollupOptions: {
              input: resolve(process.cwd(), "companion.html"),
              output: {
                codeSplitting: false,
                entryFileNames: "assets/companion.js",
                chunkFileNames: "assets/[name].js",
                assetFileNames: "assets/companion.[ext]",
              },
            },
          },
        }
      : {}),
    ...(remote
      ? {
          base: "/",
          publicDir: false,
          resolve: {
            alias: {
              "rstorrent-remote-wasm-client": resolve(
                process.cwd(),
                ".remote-wasm/rstorrent_remote_wasm.js",
              ),
            },
          },
          build: {
            assetsInlineLimit: 0,
            outDir: "dist/remote",
            rollupOptions: {
              input: resolve(process.cwd(), "remote.html"),
            },
          },
        }
      : {}),
  };
});
