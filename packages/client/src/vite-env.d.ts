/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly SHARE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
