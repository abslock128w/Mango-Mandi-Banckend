// SEC-09 (24 Oct 2026 audit): with API_HARDENING a 503 also says in its body how
// long to wait, for a cross-origin client that cannot read Retry-After. This
// file's process points at a closed port, as db-outage.test.js does.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'

process.env.TEST_DATABASE_URL = 'postgres://mango:mango@127.0.0.1:1/mango_outage_test'
process.env.DB_CONNECT_TIMEOUT_MS = '1000'
const { closeAll, startServer } = await import('./helpers.js')
const { env } = await import('../src/env.js')

let srv
before(async () => {
  srv = await startServer()
})
after(async () => {
  await srv.close()
  await closeAll()
})

test('UNAVAILABLE carries retryAfterSeconds with API_HARDENING, and not without it', async () => {
  const plain = await (await fetch(`${srv.base}/v1/catalogue?pincode=400001`)).json()
  assert.equal(plain.error.code, 'UNAVAILABLE')
  assert.equal('retryAfterSeconds' in plain.error, false)
  env.API_HARDENING = true
  const res = await fetch(`${srv.base}/v1/catalogue?pincode=400001`)
  assert.equal(res.status, 503)
  assert.equal(res.headers.get('retry-after'), '5')
  const body = await res.json()
  assert.equal(body.error.code, 'UNAVAILABLE')
  assert.equal(body.error.retryAfterSeconds, 5)
})
