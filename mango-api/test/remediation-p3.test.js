// Remediation Stage 3 regression tests, one block per audit finding.
import { adminToken, client, closeAll, customerToken, resetDb, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { Writable } from 'node:stream'
import { after, before, beforeEach, describe, test } from 'node:test'
import pino from 'pino'
import { isDate } from '../src/clock.js'
import { REDACT_PATHS } from '../src/logger.js'

let srv
let api
let manager

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
  manager = await adminToken(api)
})

describe('SEC-01: a deleted account cannot keep using its token', () => {
  test('cart, checkout, orders and phone change all answer 401 after deletion', async () => {
    const cust = await customerToken(api)
    const t = { token: cust.accessToken }
    assert.equal((await api.get('/v1/cart', t)).status, 200)
    assert.equal((await api.del('/v1/me', t)).status, 204)
    assert.equal((await api.get('/v1/cart', t)).status, 401)
    assert.equal((await api.get('/v1/orders', t)).status, 401)
    assert.equal((await api.post('/v1/checkout/confirm', {}, t)).status, 401)
    assert.equal((await api.post('/v1/me/phone/verify', { phone: '9876500001', code: '000000' }, t)).status, 401)
  })
})

describe('INV-05: impossible calendar dates are refused', () => {
  test('isDate refuses dates that would roll over', () => {
    for (const d of ['2026-02-31', '2026-04-31', '2026-13-01', '2026-00-10', '2025-02-29']) assert.equal(isDate(d), false, d)
    for (const d of ['2026-02-28', '2028-02-29', '2026-12-31']) assert.equal(isDate(d), true, d)
  })

  test('staff routes answer 400 instead of using the rolled-over day', async () => {
    const opts = { token: manager }
    assert.equal((await api.get('/admin/v1/pack-list?date=2026-02-31', opts)).status, 400)
    assert.equal((await api.del('/admin/v1/calendar/2026-02-30', opts)).status, 400)
    assert.equal((await api.get('/admin/v1/pack-list?date=2026-02-28', opts)).status, 200)
  })
})

describe('OPS-06: error codes reach the logs; login codes do not', () => {
  test('err.code and SQLSTATEs stay, codes in bodies are redacted', () => {
    const lines = []
    const sink = new Writable({
      write(chunk, _enc, cb) {
        lines.push(JSON.parse(chunk))
        cb()
      },
    })
    const log = pino({ redact: { paths: REDACT_PATHS, censor: '[redacted]' } }, sink)
    const err = Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' })
    log.error({ err }, 'db down')
    log.warn({ sqlState: '40001' }, 'retried')
    log.info({ body: { phone: '98xxxxxx01', code: '123456' } }, 'verify')
    log.info({ req: { body: { code: '654321' } } }, 'nested')
    log.info({ code: '111111', devCode: '222222', accessToken: 'tok' }, 'top level')
    assert.equal(lines[0].err.code, 'ECONNREFUSED')
    assert.equal(lines[1].sqlState, '40001')
    assert.equal(lines[2].body.code, '[redacted]')
    assert.equal(lines[3].req.body.code, '[redacted]')
    assert.equal(lines[4].code, '[redacted]')
    assert.equal(lines[4].devCode, '[redacted]')
    assert.equal(lines[4].accessToken, '[redacted]')
    assert.ok(!JSON.stringify(lines).match(/123456|654321|111111|222222/))
  })
})
