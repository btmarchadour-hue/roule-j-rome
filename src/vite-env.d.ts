/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WINDSUP_PROXY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
