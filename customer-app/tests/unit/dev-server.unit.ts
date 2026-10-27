import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { createServer, loadConfigFromFile } from 'vite'
import { isDevPath, PROXY_PATH, shopServer } from '../../dev-server.ts'
import { safeNext } from '../../src/next.ts'

// SEC-01: the shop's dev server, which start-local --phone puts on a public
// link: its own files only, its own host names only, and no /v1/dev.

const shop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const repo = path.resolve(shop, '..')

test('the dev server serves the shop, design, shared code and packages, not the rest of the repo', () => {
  const s = shopServer(shop, {})
  assert.deepEqual(s.fs.allow, [shop, path.join(repo, 'design'), path.join(repo, 'shared'), path.join(repo, 'node_modules')])
  assert.ok(!s.fs.allow.includes(repo), 'not the repo root (lockfiles, workflows, .local)')
  assert.equal('proxy' in s, false)
  assert.equal('allowedHosts' in s, false)
})

test('proxied for phones: /v1 goes to the API, /v1/dev does not, and only known hosts are answered', () => {
  const s = shopServer(shop, { SHOP_API_PROXY: 'http://localhost:3000', SHOP_ALLOWED_HOSTS: 'shop.example.in' }) as ReturnType<typeof shopServer> & {
    allowedHosts: string[]
    proxy: Record<string, { target: string }>
  }
  assert.notEqual(s.allowedHosts as unknown, true)
  assert.deepEqual(s.allowedHosts, ['.trycloudflare.com', 'shop.example.in'])
  assert.deepEqual(Object.keys(s.proxy), [PROXY_PATH])
  assert.equal(s.proxy[PROXY_PATH].target, 'http://localhost:3000')
  const passes = (p: string) => new RegExp(PROXY_PATH).test(p)
  for (const p of ['/v1/auth/otp/request', '/v1/orders/o1', '/v1/developers', '/v1/devices']) assert.ok(passes(p), p)
  for (const p of ['/v1/dev', '/v1/dev/pay', '/v1/dev/mark-paid-at-gateway', '/@fs/etc/passwd', '/package-lock.json']) assert.ok(!passes(p), p)
})

test('the real vite.config.ts uses those options', async () => {
  const saved = process.env.SHOP_API_PROXY
  process.env.SHOP_API_PROXY = 'http://localhost:3999'
  try {
    const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' }, path.join(shop, 'vite.config.ts'), shop, 'silent')
    const server = loaded!.config.server!
    assert.notEqual(server.allowedHosts, true)
    assert.ok(Array.isArray(server.allowedHosts) && server.allowedHosts.includes('.trycloudflare.com'))
    assert.deepEqual(Object.keys(server.proxy ?? {}), [PROXY_PATH])
    assert.ok(!server.fs!.allow!.includes(repo))
  } finally {
    if (saved === undefined) delete process.env.SHOP_API_PROXY
    else process.env.SHOP_API_PROXY = saved
  }
})

test('?next= only goes to a path on this site (SEC-11)', () => {
  assert.equal(safeNext('/checkout'), '/checkout')
  assert.equal(safeNext('/orders/o1?x=1'), '/orders/o1?x=1')
  for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example', 'evil', '', null, undefined]) assert.equal(safeNext(bad), '/', String(bad))
})

// SEC-01 (24 Oct audit): the API routes paths case-insensitively and decodes them, so any
// spelling of /v1/dev must be refused, not only the lowercase one PROXY_PATH sees.
const DEV_SPELLINGS = ['/v1/Dev/pay', '/v1/DEV/pay', '/v1/dEv/reconcile', '/v1/%64ev/pay', '/v1/%44EV/pay', '/v1/%2564ev/pay', '/v1//dev/pay', '/v1/./dev/pay', '/v1/x/../dev/pay', '/v1/Dev', '/V1/dev/pay', '/v1/%E0%A4%A']

test('every spelling of /v1/dev is a dev path; real API paths are not', () => {
  for (const p of ['/v1/dev', '/v1/dev/pay', '/v1/dev/mark-paid-at-gateway?x=1', ...DEV_SPELLINGS]) assert.ok(isDevPath(p), p)
  for (const p of ['/v1/auth/otp/request', '/v1/orders/o1', '/v1/developers', '/v1/devices', '/v1/catalogue?q=dev', '/v1/orders/dev']) assert.ok(!isDevPath(p), p)
})

test('through the real Vite proxy, no spelling of /v1/dev reaches the API', async () => {
  const seen: string[] = []
  const api = http.createServer((req, res) => {
    seen.push(req.url ?? '')
    res.setHeader('Content-Type', 'application/json')
    res.end('{"ok":true}')
  })
  await new Promise<void>((r) => api.listen(0, '127.0.0.1', r))
  const apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`
  const server = await createServer({
    configFile: false,
    root: shop,
    logLevel: 'silent',
    server: { ...shopServer(shop, { SHOP_API_PROXY: apiUrl }), port: 0, host: '127.0.0.1', hmr: false, watch: null },
  })
  await server.listen()
  const base = `http://127.0.0.1:${(server.httpServer!.address() as AddressInfo).port}`
  try {
    // node's fetch would normalise dot segments and %-case; a raw request sends the path as written.
    const status = (path: string, method = 'POST') =>
      new Promise<number>((resolve, reject) => {
        const req = http.request(base, { method, path, headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' } }, (res) => {
          res.resume()
          res.on('end', () => resolve(res.statusCode ?? 0))
        })
        req.on('error', reject)
        req.end(method === 'GET' ? undefined : '{}')
      })
    for (const p of DEV_SPELLINGS) assert.equal(await status(p), 404, p)
    assert.deepEqual(seen, [], 'nothing under /v1/dev was passed on')
    assert.equal(await status('/v1/auth/config', 'GET'), 200)
    assert.deepEqual(seen, ['/v1/auth/config'])
  } finally {
    await server.close()
    await new Promise((r) => api.close(r))
  }
})
