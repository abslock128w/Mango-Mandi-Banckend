// Two-step sign-in for staff: an authenticator-app code after the password.
import { adminToken, closeAll, client, resetDb, startServer, T0 } from './helpers.js'
import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { now, setNow } from '../src/clock.js'
import { env } from '../src/env.js'
import { base32Encode, codeAt, stepAt, verifyCode } from '../src/totp.js'
import { query, tx } from '../src/db.js'
import { openSecret, sealSecret, sealStoredSecrets } from '../src/secret-box.js'
import { checkProduction } from '../src/preflight.js'

let srv
let api
before(async () => {
  srv = await startServer()
  api = client(srv.base)
})
after(async () => {
  await srv.close()
  await closeAll()
})
beforeEach(() => resetDb())
afterEach(() => {
  env.STAFF_TWO_STEP = 'optional'
  env.TOTP_ENCRYPTION_KEY = ''
})

const MANAGER = { email: 'manager@mandimangoes.test', password: 'manager123' }
const code = (secret, offsetS = 0) => codeAt(secret, stepAt(now().getTime() + offsetS * 1000))
const later = (s) => setNow(new Date(now().getTime() + s * 1000).toISOString())

/** Turns two-step on for the manager. Returns the secret and recovery codes. */
async function enrol(token) {
  const setup = await api.post('/admin/v1/me/two-step/setup', undefined, { token })
  assert.equal(setup.status, 200, JSON.stringify(setup.body))
  assert.match(setup.body.otpauthUrl, /^otpauth:\/\/totp\/MandiMangoes%20Ops%3Amanager%40mandimangoes\.test\?secret=[A-Z2-7]{32}&/)
  assert.equal((await api.post('/admin/v1/me/two-step/enable', { code: '000000' }, { token })).body.error.code, 'WRONG_CODE')
  const on = await api.post('/admin/v1/me/two-step/enable', { code: code(setup.body.secret) }, { token })
  assert.equal(on.status, 200, JSON.stringify(on.body))
  assert.equal(on.body.recoveryCodes.length, 10)
  return { secret: setup.body.secret, recovery: on.body.recoveryCodes }
}

describe('two-step sign-in', () => {
  test('the RFC 6238 test vectors', () => {
    const s = base32Encode(Buffer.from('12345678901234567890'))
    assert.equal(codeAt(s, stepAt(59_000)), '287082')
    assert.equal(codeAt(s, stepAt(1_111_111_109_000)), '081804')
    assert.equal(verifyCode(s, '287082', 59_000), 1)
    assert.equal(verifyCode(s, '287082', 59_000, 1), null) // used already
  })

  test('after the password comes the code; codes and recovery codes work once', async () => {
    const { secret, recovery } = await enrol(await adminToken(api))
    later(60)
    const first = await api.post('/admin/v1/auth/login', MANAGER)
    assert.equal(first.status, 200)
    assert.equal(first.body.accessToken, undefined)
    assert.equal(first.body.twoStep, true)
    const { ticket } = first.body

    const wrong = await api.post('/admin/v1/auth/two-step', { ticket, code: '123456' })
    assert.equal(wrong.status, 422)
    assert.equal(wrong.body.error.triesLeft, 4)
    const c = code(secret)
    const ok = await api.post('/admin/v1/auth/two-step', { ticket, code: c })
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
    const me = await api.get('/admin/v1/auth/me', { token: ok.body.accessToken })
    assert.deepEqual(me.body.twoStep, { enabled: true, required: false, setupCodeNeeded: false })
    // The same code can't be used again.
    assert.equal((await api.post('/admin/v1/auth/two-step', { ticket, code: c })).status, 422)

    assert.equal((await api.post('/admin/v1/auth/two-step', { ticket, code: recovery[0].toUpperCase() })).status, 200)
    assert.equal((await api.post('/admin/v1/auth/two-step', { ticket, code: recovery[0] })).status, 422)

    // The ticket lasts five minutes.
    later(301)
    assert.equal((await api.post('/admin/v1/auth/two-step', { ticket, code: code(secret) })).body.error.code, 'TICKET_EXPIRED')
    assert.equal((await api.post('/admin/v1/auth/two-step', { ticket: 'x'.repeat(40), code: '123456' })).body.error.code, 'TICKET_EXPIRED')
  })

  test('five wrong codes lock it for 15 minutes', async () => {
    const { secret } = await enrol(await adminToken(api))
    later(60)
    const { ticket } = (await api.post('/admin/v1/auth/login', MANAGER)).body
    for (let i = 0; i < 5; i++) await api.post('/admin/v1/auth/two-step', { ticket, code: '000000' })
    assert.equal((await api.post('/admin/v1/auth/two-step', { ticket, code: code(secret) })).body.error.code, 'TWO_STEP_LOCKED')
    later(15 * 60 + 1)
    const fresh = (await api.post('/admin/v1/auth/login', MANAGER)).body.ticket
    assert.equal((await api.post('/admin/v1/auth/two-step', { ticket: fresh, code: code(secret) })).status, 200)
  })

  test('where it is required, a manager must set it up before anything else', async () => {
    env.STAFF_TWO_STEP = 'managers'
    const login = await api.post('/admin/v1/auth/login', MANAGER)
    const token = login.body.accessToken
    assert.ok(token)
    // The first manager to set it up needs no setup code: nobody could give them one.
    assert.deepEqual((await api.get('/admin/v1/auth/me', { token })).body.twoStep, { enabled: false, required: true, setupCodeNeeded: false })
    assert.equal((await api.get('/admin/v1/orders', { token })).body.error.code, 'TWO_STEP_SETUP_REQUIRED')
    // A refresh keeps the restriction.
    const cookie = login.headers.get('set-cookie').split(';')[0]
    const refreshed = await api.post('/admin/v1/auth/refresh', undefined, { headers: { Cookie: cookie } })
    assert.equal(refreshed.status, 200, JSON.stringify(refreshed.body))
    assert.equal((await api.get('/admin/v1/orders', { token: refreshed.body.accessToken })).status, 403)
    // Operators need it too; packers don't.
    assert.equal((await api.get('/admin/v1/orders', { token: await adminToken(api, 'ops@mandimangoes.test', 'operator123') })).body.error.code, 'TWO_STEP_SETUP_REQUIRED')
    assert.equal((await api.get('/admin/v1/pack-list', { token: await adminToken(api, 'packer@mandimangoes.test', 'packer123') })).status, 200)

    const setup = await api.post('/admin/v1/me/two-step/setup', undefined, { token })
    const on = await api.post('/admin/v1/me/two-step/enable', { code: code(setup.body.secret) }, { token })
    assert.equal((await api.get('/admin/v1/orders', { token: on.body.accessToken })).status, 200)
    assert.equal((await api.post('/admin/v1/me/two-step/disable', { code: code(setup.body.secret, 30) }, { token: on.body.accessToken })).body.error.code, 'TWO_STEP_REQUIRED')
  })

  test('a manager can reset someone who lost their phone; anyone can turn their own off where optional', async () => {
    const manager = await adminToken(api)
    const ops = await adminToken(api, 'ops@mandimangoes.test', 'operator123')
    const s = await api.post('/admin/v1/me/two-step/setup', undefined, { token: ops })
    await api.post('/admin/v1/me/two-step/enable', { code: code(s.body.secret) }, { token: ops })
    const staff = (await api.get('/admin/v1/staff', { token: manager })).body
    const opsRow = staff.find((u) => u.email === 'ops@mandimangoes.test')
    assert.equal(opsRow.twoStep, true)
    assert.equal((await api.post(`/admin/v1/staff/${opsRow.id}/two-step/reset`, undefined, { token: ops })).status, 403)
    const reset = await api.post(`/admin/v1/staff/${opsRow.id}/two-step/reset`, undefined, { token: manager })
    assert.equal(reset.status, 200)
    assert.match(reset.body.setupCode, /^[a-z0-9]{4}-[a-z0-9]{4}$/)
    // Their access token from before the reset stops working at once (SEC-8).
    assert.equal((await api.get('/admin/v1/orders', { token: ops })).status, 401)
    assert.ok((await api.post('/admin/v1/auth/login', { email: 'ops@mandimangoes.test', password: 'operator123' })).body.accessToken)

    const { secret } = await enrol(manager)
    later(30)
    assert.equal((await api.post('/admin/v1/me/two-step/disable', { code: code(secret) }, { token: manager })).status, 204)
    assert.ok((await api.post('/admin/v1/auth/login', MANAGER).then((r) => r.body.accessToken)))
    setNow(T0)
  })
})

describe('two-step secrets are encrypted at rest (TOTP_ENCRYPTION_KEY)', () => {
  const KEY = Buffer.alloc(32, 7).toString('base64')
  const stored = async () => (await query('SELECT id, totp_secret, totp_pending FROM admin_users WHERE email = $1', [MANAGER.email])).rows[0]

  test('with the key, the stored secret is sealed and sign-in, step-up and disable still work', async () => {
    env.TOTP_ENCRYPTION_KEY = KEY
    const token = await adminToken(api)
    const setup = await api.post('/admin/v1/me/two-step/setup', undefined, { token })
    const pending = await stored()
    assert.match(pending.totp_pending, /^enc:v1:/)
    assert.ok(!pending.totp_pending.includes(setup.body.secret))
    const on = await api.post('/admin/v1/me/two-step/enable', { code: code(setup.body.secret) }, { token })
    assert.equal(on.status, 200, JSON.stringify(on.body))
    const u = await stored()
    assert.match(u.totp_secret, /^enc:v1:/)
    assert.equal(openSecret(u.id, u.totp_secret), setup.body.secret)
    // Bound to its row: the same value does not open for another staff member.
    assert.throws(() => openSecret('adm_someone_else', u.totp_secret))
    later(60)
    const { ticket } = (await api.post('/admin/v1/auth/login', MANAGER)).body
    const ok = await api.post('/admin/v1/auth/two-step', { ticket, code: code(setup.body.secret) })
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
    later(60)
    const off = await api.post('/admin/v1/me/two-step/disable', { code: code(setup.body.secret) }, { token: ok.body.accessToken })
    assert.equal(off.status, 204, JSON.stringify(off.body))
  })

  test('a secret stored before the key was set keeps working and is sealed on the next sign-in', async () => {
    const { secret } = await enrol(await adminToken(api))
    assert.equal((await stored()).totp_secret, secret, 'no key: stored as before')
    env.TOTP_ENCRYPTION_KEY = KEY
    later(60)
    const { ticket } = (await api.post('/admin/v1/auth/login', MANAGER)).body
    assert.equal((await api.post('/admin/v1/auth/two-step', { ticket, code: code(secret) })).status, 200)
    const u = await stored()
    assert.match(u.totp_secret, /^enc:v1:/)
    assert.equal(openSecret(u.id, u.totp_secret), secret)
  })

  test('ops/seal-two-step.js seals every plain secret once; preflight wants the key', async () => {
    const { secret } = await enrol(await adminToken(api))
    env.TOTP_ENCRYPTION_KEY = KEY
    assert.equal(await tx((c) => sealStoredSecrets(c)), 1)
    assert.equal(await tx((c) => sealStoredSecrets(c)), 0, 'already sealed')
    const u = await stored()
    assert.equal(openSecret(u.id, u.totp_secret), secret)
    assert.notEqual(sealSecret(u.id, secret), sealSecret(u.id, secret), 'a fresh IV each time')
    const base = { ...env, JWT_SECRET: 'x'.repeat(40), COOKIE_SECURE: true }
    assert.ok(checkProduction({ ...base, TOTP_ENCRYPTION_KEY: '' }).warnings.some((w) => w.startsWith('TOTP_ENCRYPTION_KEY is not set')))
    assert.ok(checkProduction({ ...base, TOTP_ENCRYPTION_KEY: 'c2hvcnQ=' }).errors.some((e) => e.startsWith('TOTP_ENCRYPTION_KEY must be 32 bytes')))
    assert.ok(!checkProduction({ ...base, TOTP_ENCRYPTION_KEY: KEY }).errors.some((e) => e.includes('TOTP_ENCRYPTION_KEY')))
  })
})
