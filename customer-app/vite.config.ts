import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { cspPlugin } from '../scripts/csp'

// The customer app shares the repo root's node_modules, so it needs no install of its own.
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, __dirname, 'VITE_'), ...process.env }
  return {
    root: __dirname,
    plugins: [react(), cspPlugin('shop', env.VITE_API_URL)],
    server: { port: 5174 },
    preview: { port: 5174 },
    build: { outDir: 'dist', emptyOutDir: true },
  }
})
