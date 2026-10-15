import { resolve } from "node:path";
import { defineConfig, loadEnv, type ProxyOptions } from "vite";

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

export default defineConfig(({ mode }) => {
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
    // The player loads playsvideo lazily. Discovering it on the first Play
    // makes the dev server reload the page and drop the open player.
    optimizeDeps: { include: ["playsvideo"] },
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
          base: "/remote/",
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
