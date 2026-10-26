// 24 Oct 2026 audit, staff-account leftovers (docs/audit-2026-10-24-status-B.md).
// SEC-07 behind STAFF_STEP_UP. Each flag-on test failed on the code before the
// fix; the flag-off tests show the rollback keeps the old behaviour.
import { adminToken, client, closeAll, resetDb, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { now, setNow } from '../src/clock.js'
import { query } from '../src/db.js'
import { env } from '../src/env.js'
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
})

const PASSWORD = 'manager123'
const NEW_STAFF = { email: 'asha@mandimangoes.test', role: 'MANAGER', password: 'long-enough-1' }
const later = (s) => setNow(new Date(now().getTime() + s * 1000).toISOString())
const code = (secret) => codeAt(secret, stepAt(now().getTime()))

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
    const setup = await api.post('/admin/v1/me/two-step/setup', undefined, { token: manager })
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

  test('flag off: a manager token alone adds a manager (the old behaviour)', async () => {
    assert.equal((await api.post('/admin/v1/staff', NEW_STAFF, { token: manager })).status, 201)
  })
})
