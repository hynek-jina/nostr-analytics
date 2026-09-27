/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Comma-separated Evolu relay URLs; defaults to wss://evolu.linky.fit. */
  readonly VITE_EVOLU_SERVER_URLS?: string;
}
