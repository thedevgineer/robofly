/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PUMP_MINT?: string;
  readonly VITE_GITHUB_URL?: string;
  readonly VITE_ARXIV_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
