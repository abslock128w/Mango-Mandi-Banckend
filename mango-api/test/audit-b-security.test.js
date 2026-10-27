// 24 Oct 2026 audit, security and API contract leftovers (docs/audit-2026-10-24-status-B.md).
// Each test failed on the code before its fix; the flag-off tests show the
// rollback keeps the old behaviour.
import { adminToken, client, closeAll, customerToken, resetDb, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { Writable } from 'node:stream'
import pino from 'pino'
import { env } from '../src/env.js'
import { scrubError } from '../src/logger.js'
import { clean as jioReplyForLog } from '../src/sms.js'
import { onErrorForTests } from '../src/sentry.js'

let srv
let api
let reported = []
before(async () => {
  srv = await startServer()
  api = client(srv.base)
})
after(async () => {
  await srv.close()
  await closeAll()
})
beforeEach(async () => {
  await resetDb()
  reported = []
  onErrorForTests((err) => reported.push(err))
})
afterEach(() => {
  onErrorForTests(null)
  env.API_HARDENING = false
})

const raw = (method, path, { headers = {}, body } = {}) => fetch(`${srv.base}${path}`, { method, headers, body })

describe('SEC-02: framework errors caused by the request are 4xx, not a 500 and a Sentry event', () => {
  test('with API_HARDENING: a bad %-sequence in the path is 400, an unknown charset 415; nothing is reported', async () => {
    env.API_HARDENING = true
    const { accessToken } = await customerToken(api)
    const bad = await raw('GET', '/v1/orders/%E0%A4%A', { headers: { Authorization: `Bearer ${accessToken}` } })
    assert.equal(bad.status, 400)
    const b1 = await bad.json()
    assert.equal(b1.error.code, 'VALIDATION_ERROR')
    assert.ok(b1.error.requestId)
    const charset = await raw('POST', '/v1/auth/otp/request', { headers: { 'Content-Type': 'application/json; charset=x-unknown' }, body: '{"phone":"9876543210"}' })
    assert.equal(charset.status, 415)
    assert.equal((await charset.json()).error.code, 'UNSUPPORTED_MEDIA_TYPE')
    assert.equal(reported.length, 0, 'no Sentry event for a client error')
    // Our own errors are untouched: a real bug is still a 500 and reported (see 'unknown errors' below).
  })

  test('flag off: as before, 500 and reported (the rollback)', async () => {
    const { accessToken } = await customerToken(api)
    const bad = await raw('GET', '/v1/orders/%E0%A4%A', { headers: { Authorization: `Bearer ${accessToken}` } })
    assert.equal(bad.status, 500)
    assert.equal(reported.length, 1)
  })

  test('only body-parser and path-decoding errors are mapped; any other error with a 4xx status stays a 500', async () => {
    const { clientErrorOf } = await import('../src/http-contract.js')
    assert.equal(clientErrorOf(Object.assign(new Error('Razorpay said 400'), { statusCode: 400 })), null, 'a provider error is our problem')
    assert.equal(clientErrorOf(Object.assign(new Error('x'), { status: 400, type: 'something.else' })), null)
    assert.deepEqual(clientErrorOf(Object.assign(new Error('x'), { status: 400, type: 'request.aborted' })).status, 400)
    assert.equal(clientErrorOf(Object.assign(new Error('x'), { status: 500, type: 'stream.not.readable' })), null)
  })
})

describe('SEC-04: an over-long array is refused at once (zod 4.6.7)', () => {
  test('a 100 kB photoIds array on POST /v1/claims gets one 400 in well under the old 158 ms', async () => {
    const { accessToken } = await customerToken(api)
    const body = JSON.stringify({ orderId: 'o1', reason: 'DAMAGED', description: 'crushed box', itemSkus: ['ALP-3'], photoIds: Array.from({ length: 45_000 }, () => 0) })
    assert.ok(body.length < 100_000)
    const t = performance.now()
    const r = await raw('POST', '/v1/claims', { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }, body })
    const ms = performance.now() - t
    assert.equal(r.status, 400)
    assert.equal((await r.json()).error.code, 'VALIDATION_ERROR')
    assert.ok(ms < 150, `took ${ms} ms`)
  })
})

describe('SEC-09: API contract', () => {
  test('with API_HARDENING a known path with the wrong method answers 405 and Allow', async () => {
    env.API_HARDENING = true
    const r = await raw('PUT', '/v1/catalogue')
    assert.equal(r.status, 405)
    assert.equal(r.headers.get('allow'), 'GET, HEAD')
    assert.equal((await r.json()).error.code, 'METHOD_NOT_ALLOWED')
    const manager = await adminToken(api)
    const staff = await raw('DELETE', '/admin/v1/orders/abc/cancel', { headers: { Authorization: `Bearer ${manager}` } })
    assert.equal(staff.status, 405)
    assert.equal(staff.headers.get('allow'), 'POST')
    // Unknown paths are still 404, and routes still answer their own methods.
    assert.equal((await raw('GET', '/v1/no-such-thing')).status, 404)
    assert.equal((await raw('GET', '/v1/catalogue?pincode=560034')).status, 200)
    // Gates still come first: no token on a staff path is 401, not 405.
    assert.equal((await raw('DELETE', '/admin/v1/orders/abc/cancel')).status, 401)
  })

  test('flag off: 404 as before', async () => {
    assert.equal((await raw('PUT', '/v1/catalogue')).status, 404)
  })

  test('with API_HARDENING the shop and panel origins may read Retry-After and X-Request-Id', async () => {
    const shop = env.CUSTOMER_ORIGIN.split(',')[0]
    assert.equal((await raw('GET', '/health', { headers: { Origin: shop } })).headers.get('access-control-expose-headers'), null)
    env.API_HARDENING = true
    const r = await raw('GET', '/health', { headers: { Origin: shop } })
    assert.equal(r.headers.get('access-control-expose-headers'), 'Retry-After,X-Request-Id,RateLimit,RateLimit-Policy')
    assert.equal(r.headers.get('access-control-allow-origin'), shop)
    // Another origin still gets no CORS headers at all.
    assert.equal((await raw('GET', '/health', { headers: { Origin: 'https://evil.example' } })).headers.get('access-control-allow-origin'), null)
  })
})

describe('SEC-11 and INT-16: personal data inside error text and provider replies is masked in logs', () => {
  test('a Postgres error with a phone in its detail and message is logged without it', () => {
    const lines = []
    const log = pino({ serializers: { err: scrubError } }, new Writable({ write: (c, _e, cb) => (lines.push(String(c)), cb()) }))
    const err = Object.assign(new Error('duplicate key for +919876543210'), { code: '23505', detail: 'Key (phone)=(+919876543210) already exists.', where: 'SQL statement' })
    err.cause = Object.assign(new Error('inner 9876543210'), { detail: 'Key (phone)=(9876543210)' })
    log.error({ err }, 'insert failed')
    const out = lines.join('')
    assert.doesNotMatch(out, /9876543210/)
    const parsed = JSON.parse(lines[0]).err
    assert.equal(parsed.code, '23505', 'the SQLSTATE stays for diagnosis')
    assert.equal('detail' in parsed, false)
    assert.equal('where' in parsed, false)
    assert.match(parsed.message, /duplicate key for \[Filtered\]/)
  })

  test("a Jio reply that echoes the number and the code is logged with neither", () => {
    const out = jioReplyForLog('{"error":"DLT template mismatch for 919876543210","text":"482913 is your MandiMangoes login code"}', '482913')
    assert.doesNotMatch(out, /9876543210|482913/)
    assert.match(out, /DLT template mismatch/)
  })
})
