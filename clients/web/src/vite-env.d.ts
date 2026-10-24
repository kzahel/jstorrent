/// <reference types="vite/client" />

declare module "rstorrent-remote-wasm-client" {
  const initialize: () => Promise<unknown>;
  export default initialize;
}

interface ImportMetaEnv {
  readonly VITE_RSTORRENT_REMOTE_VERSION?: string;
  readonly VITE_RSTORRENT_DEFAULT_LIVE?: "same-origin";
  readonly VITE_RSTORRENT_INTEROP_MAGNET?: string;
  readonly VITE_RSTORRENT_INTEROP_GATEWAY_URL?: string;
  readonly VITE_RSTORRENT_INTEROP_GATEWAY_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
