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
      // Local runs for phones (scripts/start-local.mjs): the shop calls its own address and Vite
      // passes /v1 on to the API, so a phone needs to reach only this server, by Wi-Fi address or
      // through the temporary phone link. The API then sees the request as coming from the shop.
      ...(env.SHOP_API_PROXY
        ? {
            allowedHosts: true,
            proxy: {
              '/v1': {
                target: env.SHOP_API_PROXY,
                configure: (proxy) => proxy.on('proxyReq', (req) => req.getHeader('origin') && req.setHeader('origin', 'http://localhost:5174')),
              },
            },
          }
        : {}),
    },
    preview: { port: 5174 },
    build: { outDir: 'dist', emptyOutDir: true },
  }
})
