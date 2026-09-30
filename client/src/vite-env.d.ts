/// <reference types="vite/client" />

// Lets `import.meta.env.VITE_*` be typed instead of an error under strict mode.
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
