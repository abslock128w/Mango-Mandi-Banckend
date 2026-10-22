import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { cspPlugin } from './scripts/csp'

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, __dirname, 'VITE_'), ...process.env }
  return {
    plugins: [react(), cspPlugin('panel', env.VITE_API_URL)],
    server: { port: 5173 },
    // Pages load lazily, so let Vite find every page's imports at start-up (no mid-session re-bundle).
    optimizeDeps: { entries: ['index.html', 'src/**/*.{ts,tsx}'] },
  }
})
