/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Vite built-in (explicitly typed for TypeScript)
  readonly DEV: boolean
  readonly PROD: boolean
  readonly MODE: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
