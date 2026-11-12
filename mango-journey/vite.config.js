// One Mango: Vite dev server on 5180 (strict). three.js is one large chunk by nature, so the size warning is raised.
export default {
  server: { port: 5180, strictPort: true },
  preview: { port: 5180, strictPort: true },
  build: { chunkSizeWarningLimit: 1200 },
}
