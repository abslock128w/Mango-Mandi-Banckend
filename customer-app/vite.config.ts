import path from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { cspPlugin } from '../scripts/csp'

// The customer app shares the repo root's node_modules, so it needs no install of its own.
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, __dirname, 'VITE_'), ...process.env }
  return {
    root: __dirname,
    plugins: [react(), cspPlugin('shop', env.VITE_API_URL)],
    server: {
      port: 5174,
      // The shared design tokens live in ../design, outside this folder.
      fs: { allow: [path.resolve(__dirname, '..')] },
      // Local runs for phones: the shop calls its own address and Vite passes /v1 on to the API,
      // so a phone on the Wi-Fi only needs to reach this one port.
      ...(env.SHOP_API_PROXY ? { proxy: { '/v1': { target: env.SHOP_API_PROXY, changeOrigin: false } } } : {}),
    },
    preview: { port: 5174 },
    build: { outDir: 'dist', emptyOutDir: true },
  }
})
