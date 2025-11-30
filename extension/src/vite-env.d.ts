/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly DEV_EXTENSION_ID?: string
  readonly SHARE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
