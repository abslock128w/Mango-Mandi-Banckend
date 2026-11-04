// The contract walk, part 1: every route the API registers, as every role (anonymous, a
// customer, RIDER, PACKER, QC, OPERATOR, MANAGER), with every kind of bad input (no body,
// wrong types, a JSON array, broken JSON, a body over the 100 kb limit; a GET gets a bad
// query string). Path ids are ones that do not exist.
//
// It asserts what must hold everywhere: no 5xx, every refusal in the one error shape,
// broken JSON is a 400 and an oversized body a 413, and who can reach what. That last part
// is a snapshot (role-access.json): a change in access fails here until it is reviewed and
// the snapshot rewritten with QA_UPDATE_SNAPSHOT=1. The right answers to valid input are
// the other test files' job (and journeys.test.js).
import '../setup-env.js'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { after, before, test } from 'node:test'
import { createApp } from '../../src/app.js'
import { adminToken, client, closeAll, resetDb } from '../helpers.js'
import { allRoutes, BAD_QUERY, errorShapeProblem, fillPath, ROLES, tokensFor, VARIANTS } from './lib.js'

const SNAPSHOT = new URL('./role-access.json', import.meta.url)
/** Routes that end the caller's session or account: walked last, so they do not cut the walk short. */
const ENDS_SESSION = new Set(['POST /v1/auth/logout', 'POST /admin/v1/auth/logout', 'DELETE /v1/me'])
/** Machine endpoints that answer with a bare status, for their callers (Meta, Prometheus, the cron). */
const BARE = new Set(['GET /webhooks/whatsapp', 'GET /metrics'])
/** They check a signature or secret before reading the body. */
const SIGNED = new Set(['POST /webhooks/razorpay', 'POST /webhooks/whatsapp', 'POST /internal/maintenance'])

let server
let results = []

before(async () => {
  await resetDb()
  const app = createApp()
  server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  const base = `http://127.0.0.1:${server.address().port}`
  const api = client(base)
  const tokens = await tokensFor(api, await adminToken(api))
  const routes = allRoutes(app).sort((a, b) => ENDS_SESSION.has(`${a.method} ${a.path}`) - ENDS_SESSION.has(`${b.method} ${b.path}`))
  for (const role of ROLES) {
    for (const r of routes) {
      const path = fillPath(r.path)
      const variants = r.method === 'GET' ? { query: { path: path + BAD_QUERY } } : VARIANTS
      for (const [variant, v] of Object.entries(variants)) {
        const headers = { ...(tokens[role] ? { Authorization: `Bearer ${tokens[role]}` } : {}), ...(v.raw !== undefined ? { 'Content-Type': 'application/json' } : {}) }
        const res = await fetch(base + (v.path ?? path), { method: r.method, headers, body: v.raw })
        const text = await res.text()
        let body = null
        try {
          body = JSON.parse(text)
        } catch {}
        results.push({ role, key: `${r.method} ${r.path}`, variant, status: res.status, body, text })
      }
    }
  }
})
after(async () => {
  server?.close()
  await closeAll()
})

test('the walk covers every route, role and variant', () => {
  const keys = new Set(results.map((r) => r.key))
  assert.ok(keys.size >= 340, `only ${keys.size} routes found: the router walk no longer reads the app`)
  assert.ok(results.length >= keys.size * ROLES.length)
})

test('no route answers 5xx to bad input, whoever asks', () => {
  const bad = results.filter((r) => r.status >= 500).map((r) => `${r.role} ${r.key} [${r.variant}] ${r.status} ${r.text.slice(0, 120)}`)
  assert.deepEqual(bad, [])
})

test('every refusal has the error shape { error: { code, message, requestId } }', () => {
  const bad = results
    .filter((r) => r.status >= 400 && !BARE.has(r.key))
    .map((r) => [r, errorShapeProblem(r.body)])
    .filter(([, p]) => p)
    .map(([r, p]) => `${r.role} ${r.key} [${r.variant}] ${r.status}: ${p}`)
  assert.deepEqual(bad, [])
})

test('broken JSON is 400 VALIDATION_ERROR and an oversized body 413 PAYLOAD_TOO_LARGE, before anything else', () => {
  const want = { notJson: [400, 'VALIDATION_ERROR'], oversized: [413, 'PAYLOAD_TOO_LARGE'] }
  const bad = results
    .filter((r) => want[r.variant] && !SIGNED.has(r.key))
    .filter((r) => r.status !== want[r.variant][0] || r.body?.error?.code !== want[r.variant][1])
    .map((r) => `${r.role} ${r.key} [${r.variant}] ${r.status} ${r.body?.error?.code}`)
  assert.deepEqual(bad, [])
})

test('signed endpoints refuse an unsigned body whatever it holds', () => {
  const bad = results.filter((r) => SIGNED.has(r.key) && r.key.startsWith('POST') && r.status < 400).map((r) => `${r.role} ${r.key} [${r.variant}] ${r.status}`)
  assert.deepEqual(bad, [])
})

test('without a token, only the public routes answer', () => {
  const open = [...new Set(results.filter((r) => r.role === 'anonymous' && r.status < 400).map((r) => r.key))].sort()
  assert.deepEqual(open, [
    'GET /admin/v1/auth/config',
    'GET /health',
    'GET /metrics',
    'GET /ready',
    'GET /v1/auth/config',
    'GET /v1/policy',
    'GET /v1/preorders/weeks',
    'GET /v1/products',
    'POST /admin/v1/auth/logout',
    'POST /v1/auth/logout',
    'POST /v1/dev/reconcile',
    'POST /v1/events',
  ])
})

test('a customer token opens nothing on the staff API but its sign-in config and sign-out', () => {
  const open = [...new Set(results.filter((r) => r.role === 'customer' && r.key.includes(' /admin/') && r.status < 400).map((r) => r.key))].sort()
  assert.deepEqual(open, ['GET /admin/v1/auth/config', 'POST /admin/v1/auth/logout'])
})

test('a staff token opens nothing that needs a signed-in customer', () => {
  const bad = results
    .filter((r) => r.role !== 'customer' && r.role !== 'anonymous' && r.key.includes(' /v1/') && r.status === 401 && r.body?.error?.code !== 'INVALID_TOKEN')
    .map((r) => `${r.role} ${r.key} ${r.body?.error?.code}`)
  assert.deepEqual([...new Set(bad)], [])
})

/** What each role gets from each route with no body: the access snapshot. */
function accessMatrix() {
  const kind = (s) => (s < 300 ? 'ok' : s === 401 ? 'signin' : s === 403 ? 'forbidden' : s === 404 ? 'notfound' : s === 409 ? 'conflict' : 'refused')
  const m = {}
  for (const r of results.filter((x) => x.variant === 'missing' || x.variant === 'query')) {
    m[r.key] ??= {}
    m[r.key][r.role] = kind(r.status)
  }
  return Object.fromEntries(Object.entries(m).sort(([a], [b]) => a.localeCompare(b)))
}

test('who can reach each route matches the reviewed snapshot (role-access.json)', () => {
  const now = accessMatrix()
  if (process.env.QA_UPDATE_SNAPSHOT) writeFileSync(SNAPSHOT, `${JSON.stringify(now, null, 1)}\n`)
  const was = JSON.parse(readFileSync(SNAPSHOT, 'utf8'))
  const changed = []
  for (const key of new Set([...Object.keys(was), ...Object.keys(now)])) {
    for (const role of ROLES) if (was[key]?.[role] !== now[key]?.[role]) changed.push(`${key} ${role}: ${was[key]?.[role]} -> ${now[key]?.[role]}`)
  }
  assert.deepEqual(changed, [], 'access changed: review, then QA_UPDATE_SNAPSHOT=1 npm test -- test/contract/sweep.test.js')
})
