// 24 Oct 2026 audit, staff-account leftovers (docs/audit-2026-10-24-status-B.md).
// SEC-07 behind STAFF_STEP_UP, SEC-08 behind STAFF_AUDIT_TRAIL. Each flag-on test failed on the code before the
// fix; the flag-off tests show the rollback keeps the old behaviour.
import { adminToken, checkout, client, closeAll, customerToken, makeBatch, resetDb, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { drainBackground } from '../src/background.js'
import { now, setNow } from '../src/clock.js'
import { query } from '../src/db.js'
import { env } from '../src/env.js'
import { logger } from '../src/logger.js'
import { STEP_UP_TRIES } from '../src/admin/step-up.js'
import { codeAt, stepAt } from '../src/totp.js'

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
afterEach(() => {
  env.STAFF_STEP_UP = false
  env.STAFF_AUDIT_TRAIL = false
})

const PASSWORD = 'manager123'
const NEW_STAFF = { email: 'asha@mandimangoes.test', role: 'MANAGER', password: 'long-enough-1' }
const later = (s) => setNow(new Date(now().getTime() + s * 1000).toISOString())
const code = (secret) => codeAt(secret, stepAt(now().getTime()))
/** After-response audit writes start on the response's 'finish'; give them a moment, then wait for them. */
const settled = async () => {
  await delay(50)
  await drainBackground()
}

describe('SEC-07: staff changes ask the manager to confirm it is them', () => {
  test('with STAFF_STEP_UP and no two-step: the password confirms each change; a token alone does nothing', async () => {
    env.STAFF_STEP_UP = true
    const bare = await api.post('/admin/v1/staff', NEW_STAFF, { token: manager })
    assert.equal(bare.status, 403)
    assert.deepEqual([bare.body.error.code, bare.body.error.method], ['REAUTH_REQUIRED', 'password'])
    assert.equal((await query('SELECT 1 FROM admin_users WHERE email = $1', [NEW_STAFF.email])).rowCount, 0, 'no manager was minted')
    const wrong = await api.post('/admin/v1/staff', { ...NEW_STAFF, confirmCode: 'not-my-password' }, { token: manager })
    assert.equal(wrong.body.error.code, 'REAUTH_FAILED')
    const added = await api.post('/admin/v1/staff', { ...NEW_STAFF, confirmCode: PASSWORD }, { token: manager })
    assert.equal(added.status, 201, JSON.stringify(added.body))
    const id = added.body.id

    // Every other staff-changing route asks too.
    const asks = [
      ['patch', `/admin/v1/staff/${id}`, { password: 'another-long-1' }],
      ['post', `/admin/v1/staff/${id}/two-step/setup-code`, {}],
      ['post', `/admin/v1/staff/${id}/two-step/reset`, {}],
      ['del', `/admin/v1/staff/${id}`, undefined],
    ]
    for (const [m, path, body] of asks) {
      const r = m === 'del' ? await api.del(path, { token: manager }) : await api[m](path, body, { token: manager })
      assert.equal(r.status, 403, `${m} ${path}`)
      assert.equal(r.body.error.code, 'REAUTH_REQUIRED', `${m} ${path}`)
    }
    assert.equal((await api.patch(`/admin/v1/staff/${id}`, { role: 'PACKER', confirmCode: PASSWORD }, { token: manager })).status, 200)
    assert.equal((await api.post(`/admin/v1/staff/${id}/two-step/setup-code`, { confirmCode: PASSWORD }, { token: manager })).status, 200)
    assert.equal((await api.raw('DELETE', `/admin/v1/staff/${id}`, { token: manager, headers: { 'Content-Type': 'application/json' }, raw: JSON.stringify({ confirmCode: PASSWORD }) })).status, 204)
    // The password never lands in the audit trail.
    const { rows } = await query(`SELECT detail::text AS d FROM staff_audit WHERE action LIKE '%/staff%'`)
    assert.ok(rows.length >= 3)
    for (const r of rows) assert.doesNotMatch(r.d ?? '', /manager123/)
  })

  test(`with STAFF_STEP_UP: ${STEP_UP_TRIES} wrong confirmations lock step-up for 15 minutes`, async () => {
    env.STAFF_STEP_UP = true
    for (let i = 0; i < STEP_UP_TRIES; i++) {
      assert.equal((await api.post('/admin/v1/staff', { ...NEW_STAFF, confirmCode: `guess-${i}` }, { token: manager })).body.error.code, 'REAUTH_FAILED')
    }
    const locked = await api.post('/admin/v1/staff', { ...NEW_STAFF, confirmCode: PASSWORD }, { token: manager })
    assert.equal(locked.status, 429)
    assert.equal(locked.body.error.code, 'REAUTH_LOCKED')
    later(16 * 60)
    assert.equal((await api.post('/admin/v1/staff', { ...NEW_STAFF, confirmCode: PASSWORD }, { token: manager })).status, 201)
  })

  test('with STAFF_STEP_UP and two-step on: the authenticator code confirms, once', async () => {
    env.STAFF_STEP_UP = true
    const setup = await api.post('/admin/v1/me/two-step/setup', { confirmCode: PASSWORD }, { token: manager })
    assert.equal((await api.post('/admin/v1/me/two-step/enable', { code: code(setup.body.secret) }, { token: manager })).status, 200)
    later(31)
    const ask = await api.post('/admin/v1/staff', NEW_STAFF, { token: manager })
    assert.equal(ask.body.error.method, 'code')
    assert.equal((await api.post('/admin/v1/staff', { ...NEW_STAFF, confirmCode: PASSWORD }, { token: manager })).body.error.code, 'REAUTH_FAILED', 'the password is not enough once two-step is on')
    const c = code(setup.body.secret)
    const added = await api.post('/admin/v1/staff', { ...NEW_STAFF, confirmCode: c }, { token: manager })
    assert.equal(added.status, 201, JSON.stringify(added.body))
    const again = await api.post(`/admin/v1/staff/${added.body.id}/two-step/setup-code`, { confirmCode: c }, { token: manager })
    assert.equal(again.body.error.code, 'REAUTH_FAILED', 'a used code is spent')
  })

  /** Turns two-step on for the signed-in manager (password confirmed) and returns the secret. */
  async function twoStepOn(token, password = PASSWORD) {
    const setup = await api.post('/admin/v1/me/two-step/setup', { confirmCode: password }, { token })
    assert.equal(setup.status, 200, JSON.stringify(setup.body))
    assert.equal((await api.post('/admin/v1/me/two-step/enable', { code: code(setup.body.secret) }, { token })).status, 200)
    later(31)
    return setup.body.secret
  }

  test('with STAFF_STEP_UP: a token alone cannot turn two-step on and then answer step-up with the thief\'s own app', async () => {
    env.STAFF_STEP_UP = true
    const bare = await api.post('/admin/v1/me/two-step/setup', {}, { token: manager })
    assert.equal(bare.status, 403, JSON.stringify(bare.body))
    assert.deepEqual([bare.body.error.code, bare.body.error.method], ['REAUTH_REQUIRED', 'password'])
    const [u] = (await query('SELECT totp_pending, totp_enabled_at FROM admin_users WHERE email = $1', ['manager@mandimangoes.test'])).rows
    assert.deepEqual(u, { totp_pending: null, totp_enabled_at: null }, 'no secret was handed out')
    assert.equal((await api.post('/admin/v1/me/two-step/setup', { confirmCode: 'not-my-password' }, { token: manager })).body.error.code, 'REAUTH_FAILED')
    // The owner of the session, who knows the password, still turns it on.
    const secret = await twoStepOn(manager)
    assert.equal((await api.post('/admin/v1/staff', { ...NEW_STAFF, confirmCode: code(secret) }, { token: manager })).status, 201)
  })

  test('flag off: a token alone turns two-step on (the old behaviour)', async () => {
    assert.equal((await api.post('/admin/v1/me/two-step/setup', {}, { token: manager })).status, 200)
  })

  test(`with STAFF_STEP_UP: a burst of parallel guesses gets at most ${STEP_UP_TRIES} checked`, async () => {
    env.STAFF_STEP_UP = true
    const answers = await Promise.all(
      Array.from({ length: 30 }, (_, i) => api.post('/admin/v1/staff', { ...NEW_STAFF, confirmCode: `guess-${i}` }, { token: manager })),
    )
    const tally = {}
    for (const r of answers) tally[`${r.status}:${r.body.error.code}`] = (tally[`${r.status}:${r.body.error.code}`] ?? 0) + 1
    assert.equal(tally['403:REAUTH_FAILED'], STEP_UP_TRIES, JSON.stringify(tally))
    assert.equal(tally['429:REAUTH_LOCKED'], 30 - STEP_UP_TRIES, JSON.stringify(tally))
    assert.equal((await api.post('/admin/v1/staff', { ...NEW_STAFF, confirmCode: PASSWORD }, { token: manager })).status, 429, 'the right password waits too')
  })

  test('with STAFF_STEP_UP: a code is not spent on a change refused for a mistake', async () => {
    env.STAFF_STEP_UP = true
    const secret = await twoStepOn(manager)
    const c = code(secret)
    const short = await api.post('/admin/v1/staff', { ...NEW_STAFF, password: 'short', confirmCode: c }, { token: manager })
    assert.equal(short.status, 400)
    assert.equal(short.body.error.code, 'VALIDATION_ERROR')
    const taken = await api.post('/admin/v1/staff', { ...NEW_STAFF, email: 'manager@mandimangoes.test', confirmCode: c }, { token: manager })
    assert.equal(taken.body.error.code, 'STAFF_EXISTS')
    const added = await api.post('/admin/v1/staff', { ...NEW_STAFF, confirmCode: c }, { token: manager })
    assert.equal(added.status, 201, `the same code still works once the mistake is fixed: ${JSON.stringify(added.body)}`)
    assert.equal((await query(`SELECT 1 FROM rate_limits WHERE key LIKE 'step-up:%'`)).rowCount, 0, 'no wrong try was counted')
  })

  test('with STAFF_STEP_UP: the last manager with two-step on cannot be removed or demoted', async () => {
    env.STAFF_STEP_UP = true
    // Asha is a second manager without two-step; the first manager turns it on.
    assert.equal((await api.post('/admin/v1/staff', { ...NEW_STAFF, confirmCode: PASSWORD }, { token: manager })).status, 201)
    const asha = await adminToken(api, NEW_STAFF.email, NEW_STAFF.password)
    await twoStepOn(manager)
    const [{ id: firstId }] = (await query('SELECT id FROM admin_users WHERE email = $1', ['manager@mandimangoes.test'])).rows
    const del = await api.raw('DELETE', `/admin/v1/staff/${firstId}`, { token: asha, headers: { 'Content-Type': 'application/json' }, raw: JSON.stringify({ confirmCode: NEW_STAFF.password }) })
    assert.equal(del.status, 409, JSON.stringify(del.body))
    assert.equal(del.body.error.code, 'LAST_TWO_STEP_MANAGER')
    const demote = await api.patch(`/admin/v1/staff/${firstId}`, { role: 'OPERATOR', confirmCode: NEW_STAFF.password }, { token: asha })
    assert.equal(demote.body.error.code, 'LAST_TWO_STEP_MANAGER')
    assert.equal((await query(`SELECT role FROM admin_users WHERE id = $1`, [firstId])).rows[0]?.role, 'MANAGER')
    // Once Asha has two-step on too, the first manager can go.
    const ashaSecret = await twoStepOn(asha, NEW_STAFF.password)
    const ok = await api.patch(`/admin/v1/staff/${firstId}`, { role: 'OPERATOR', confirmCode: code(ashaSecret) }, { token: asha })
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
  })

  test('flag off: a manager token alone adds a manager (the old behaviour)', async () => {
    assert.equal((await api.post('/admin/v1/staff', NEW_STAFF, { token: manager })).status, 201)
  })
})

describe('SEC-08: staff-account changes are recorded with the change; views of customer details are recorded', () => {
  test('with STAFF_AUDIT_TRAIL: if the audit row cannot be written, the new manager is not created either', async () => {
    env.STAFF_AUDIT_TRAIL = true
    await query('ALTER TABLE staff_audit RENAME TO staff_audit_gone')
    const r = await api.post('/admin/v1/staff', NEW_STAFF, { token: manager })
    await query('ALTER TABLE staff_audit_gone RENAME TO staff_audit')
    assert.equal(r.status, 500)
    assert.equal((await query('SELECT 1 FROM admin_users WHERE email = $1', [NEW_STAFF.email])).rowCount, 0)
    // With the table back, the change and its row land together, without the password.
    const ok = await api.post('/admin/v1/staff', NEW_STAFF, { token: manager })
    assert.equal(ok.status, 201)
    const { rows } = await query(`SELECT action, target, detail FROM staff_audit WHERE action = 'POST /staff'`)
    assert.equal(rows.length, 1, 'written once, not again after the response')
    assert.equal(rows[0].target, ok.body.id)
    assert.equal(rows[0].detail.password, '[removed]')
  })

  test('flag off: the change goes through and its audit row is lost (the old behaviour)', async () => {
    await query('ALTER TABLE staff_audit RENAME TO staff_audit_gone')
    const r = await api.post('/admin/v1/staff', NEW_STAFF, { token: manager })
    await settled()
    await query('ALTER TABLE staff_audit_gone RENAME TO staff_audit')
    assert.equal(r.status, 201)
    assert.equal((await query(`SELECT 1 FROM staff_audit WHERE action = 'POST /staff'`)).rowCount, 0)
  })

  async function anOrder() {
    await makeBatch({ age: 4, rating: 'RIPE', lines: { 'ALP-3': 5 } })
    const cust = await customerToken(api)
    const o = await checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage: 'RIPE', qty: 1 }])
    assert.equal(o.status, 201)
    return o.body.orderId
  }
  const reads = async () => (await query(`SELECT action, target, detail FROM staff_audit WHERE action LIKE 'GET %' ORDER BY created_at, id`)).rows

  test('with STAFF_AUDIT_TRAIL: opening an order and searching are recorded, at most every 10 minutes, without the search words', async () => {
    env.STAFF_AUDIT_TRAIL = true
    const id = await anOrder()
    assert.equal((await api.get(`/admin/v1/orders/${id}`, { token: manager })).status, 200)
    assert.equal((await api.get(`/admin/v1/orders/${id}`, { token: manager })).status, 200)
    assert.equal((await api.get('/admin/v1/orders?q=98765', { token: manager })).status, 200)
    assert.equal((await api.get('/admin/v1/orders', { token: manager })).status, 200, 'a plain list is not a search')
    await settled()
    assert.deepEqual(await reads(), [
      { action: 'GET /orders/:id', target: id, detail: null },
      { action: 'GET /orders', target: null, detail: { search: true } },
    ])
    later(11 * 60)
    await api.get(`/admin/v1/orders/${id}`, { token: manager })
    await settled()
    assert.equal((await reads()).length, 3)
    // The activity list leaves views out unless asked.
    const plain = await api.get('/admin/v1/audit', { token: manager })
    assert.equal(plain.body.items.some((a) => a.action.startsWith('GET ')), false)
    const withReads = await api.get('/admin/v1/audit?reads=true', { token: manager })
    assert.equal(withReads.body.items.filter((a) => a.action.startsWith('GET ')).length, 3)
  })

  test('flag off: views leave no row (the old behaviour)', async () => {
    const id = await anOrder()
    await api.get(`/admin/v1/orders/${id}`, { token: manager })
    await settled()
    assert.deepEqual(await reads(), [])
  })

  test('with STAFF_AUDIT_TRAIL: a refused staff request is logged with who and where', async () => {
    await api.post('/admin/v1/staff', { email: 'pia@mandimangoes.test', role: 'PACKER', password: 'long-enough-1' }, { token: manager })
    const packer = await adminToken(api, 'pia@mandimangoes.test', 'long-enough-1')
    const seen = []
    const warn = logger.warn
    logger.warn = function (obj, msg) {
      if (msg === 'staff request refused') seen.push(obj)
      return warn.apply(this, arguments)
    }
    try {
      assert.equal((await api.get('/admin/v1/staff', { token: packer })).status, 403)
      assert.equal(seen.length, 0, 'flag off: not logged')
      env.STAFF_AUDIT_TRAIL = true
      assert.equal((await api.get('/admin/v1/staff', { token: packer })).status, 403)
      assert.equal((await api.get('/admin/v1/audit', { token: packer })).status, 403)
    } finally {
      logger.warn = warn
    }
    assert.equal(seen.length, 2)
    assert.equal(seen[0].role, 'PACKER')
    assert.equal(seen[0].method, 'GET')
    assert.equal(seen[0].path, '/admin/v1/staff')
    assert.ok(seen[0].staffId)
  })
})
