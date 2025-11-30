/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly DEV_EXTENSION_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
