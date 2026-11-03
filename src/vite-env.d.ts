/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  /** Map tile URL template for the panel's maps (default OpenStreetMap); 'none' draws no tiles. */
  readonly VITE_MAP_TILES_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
