import type { APIRequestContext } from '@playwright/test'
import { expect } from '../../tests/fixtures'

// One manager sign-in per test worker, reused by every spec in it. Staff
// sign-ins are rate limited (30 per 15 minutes per address), and the whole
// suite signing in once per test ran past that in CI.

const API = (process.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const REUSE_MS = 10 * 60_000 // access tokens last 15 minutes

let cached: { token: string; at: number } | null = null

export async function managerToken(request: APIRequestContext): Promise<string> {
  if (cached && Date.now() - cached.at < REUSE_MS) return cached.token
  const r = await request.post(`${API}/admin/v1/auth/login`, { data: { email: 'manager@mandimangoes.test', password: 'manager123' } })
  expect(r.status(), await r.text()).toBe(200)
  cached = { token: ((await r.json()) as { accessToken: string }).accessToken, at: Date.now() }
  return cached.token
}
