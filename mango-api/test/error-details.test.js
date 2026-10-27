// A local run (SHOW_ERROR_DETAILS, set by scripts/start-local.mjs) puts the cause of an
// unexpected error in the 500 answer, so the panel can show it. Off by default, and never
// in production (errorDetailsOn checks NODE_ENV too).
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { client, closeAll, resetDb, startServer } from './helpers.js'
import { query } from '../src/db.js'
import { env, errorDetailsOn } from '../src/env.js'

let srv
let api
before(async () => {
  await resetDb()
  srv = await startServer()
  api = client(srv.base)
  await query('DROP TABLE otps CASCADE')
})
after(async () => {
  env.SHOW_ERROR_DETAILS = false
  await srv.close()
  await closeAll()
})

const fail = () => api.post('/v1/auth/otp/request', { phone: '9876543210' })

test('off by default: a 500 says only "Internal server error" and the reference', async () => {
  assert.equal(env.SHOW_ERROR_DETAILS, false)
  const r = await fail()
  assert.equal(r.status, 500)
  assert.deepEqual(Object.keys(r.body.error).sort(), ['code', 'message', 'requestId'])
})

test('on: the 500 carries the cause, short and without the phone number', async () => {
  env.SHOW_ERROR_DETAILS = true
  assert.equal(errorDetailsOn(), true)
  const r = await fail()
  assert.equal(r.status, 500)
  assert.equal(r.body.error.code, 'INTERNAL_ERROR')
  assert.match(r.body.error.detail, /otps/)
  assert.ok(r.body.error.detail.length <= 300)
  assert.ok(!JSON.stringify(r.body).includes('9876543210'))
})
