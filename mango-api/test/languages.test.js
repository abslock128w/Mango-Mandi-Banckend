// Shop languages (SHOP_LANGUAGES, docs/languages.md): a signed-in customer reads and
// saves the language they chose for the shop. Their own account only; validated
// here; 404 while the switch is off; a manager can turn it on from the panel.
import { adminToken, client, closeAll, customerToken, resetDb, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { query } from '../src/db.js'
import { env } from '../src/env.js'
import { forgetSwitches } from '../src/feature-switches.js'

let srv
let api

const FLAGS = ['SHOP_LANGUAGES', 'PANEL_FEATURE_SWITCHES', 'STAFF_STEP_UP']
const saved = Object.fromEntries(FLAGS.map((k) => [k, env[k]]))

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
  forgetSwitches()
  env.SHOP_LANGUAGES = true
})
afterEach(() => {
  Object.assign(env, saved)
  delete process.env.SHOP_LANGUAGES
  forgetSwitches()
})

const as = (cu) => ({ token: cu.accessToken })
const stored = async (id) => (await query('SELECT language FROM customers WHERE id = $1', [id])).rows[0].language

describe('GET/PUT /v1/me/language', () => {
  test('a new customer has no choice yet; a saved one comes back and is stored on their account', async () => {
    const cu = await customerToken(api)
    const first = await api.get('/v1/me/language', as(cu))
    assert.equal(first.status, 200)
    assert.deepEqual(first.body, { language: null, languages: ['en', 'hi', 'kn'] })

    const hi = await api.put('/v1/me/language', { language: 'hi' }, as(cu))
    assert.equal(hi.status, 200, JSON.stringify(hi.body))
    assert.equal(hi.body.language, 'hi')
    assert.equal(await stored(cu.customer.id), 'hi')
    assert.equal((await api.get('/v1/me/language', as(cu))).body.language, 'hi')

    const kn = await api.put('/v1/me/language', { language: 'kn' }, as(cu))
    assert.equal(kn.body.language, 'kn')
    assert.equal(await stored(cu.customer.id), 'kn')
    // English is a choice too (not the same as never having chosen).
    assert.equal((await api.put('/v1/me/language', { language: 'en' }, as(cu))).body.language, 'en')
    assert.equal(await stored(cu.customer.id), 'en')
  })

  test('the server refuses anything but en, hi or kn, and extra fields', async () => {
    const cu = await customerToken(api)
    await api.put('/v1/me/language', { language: 'hi' }, as(cu))
    for (const body of [{ language: 'ta' }, { language: 'HI' }, { language: 'hi-IN' }, { language: '' }, { language: null }, { language: 1 }, {}, { language: 'hi', customerId: 'x' }]) {
      const r = await api.put('/v1/me/language', body, as(cu))
      assert.equal(r.status, 400, JSON.stringify(body))
      assert.equal(r.body.error.code, 'VALIDATION_ERROR', JSON.stringify(r.body))
    }
    // Nothing was changed by the refused requests.
    assert.equal(await stored(cu.customer.id), 'hi')
    // The database refuses it too (migration 043's CHECK).
    await assert.rejects(query(`UPDATE customers SET language = 'fr' WHERE id = $1`, [cu.customer.id]), /customers_language_check/)
  })

  test('sign-in is needed, and each customer reads and changes only their own', async () => {
    assert.equal((await api.get('/v1/me/language')).status, 401)
    assert.equal((await api.put('/v1/me/language', { language: 'hi' })).status, 401)
    const a = await customerToken(api)
    const b = await customerToken(api)
    await api.put('/v1/me/language', { language: 'kn' }, as(a))
    assert.equal((await api.get('/v1/me/language', as(b))).body.language, null)
    await api.put('/v1/me/language', { language: 'hi' }, as(b))
    assert.equal(await stored(a.customer.id), 'kn')
    assert.equal(await stored(b.customer.id), 'hi')
    // A staff token is not a customer token.
    const manager = await adminToken(api)
    assert.equal((await api.get('/v1/me/language', { token: manager })).status, 401)
  })

  test('switched off: both answer 404 and nothing is saved; the policy says off', async () => {
    const cu = await customerToken(api)
    assert.equal((await api.get('/v1/policy')).body.features.languages, true)
    env.SHOP_LANGUAGES = false
    assert.equal((await api.get('/v1/policy')).body.features.languages, false)
    assert.equal((await api.get('/v1/me/language', as(cu))).status, 404)
    const put = await api.put('/v1/me/language', { language: 'hi' }, as(cu))
    assert.equal(put.status, 404)
    assert.equal(await stored(cu.customer.id), null)
  })

  test('a manager can turn it on from the panel; false in the environment keeps it off', async () => {
    env.SHOP_LANGUAGES = false
    env.PANEL_FEATURE_SWITCHES = true
    env.STAFF_STEP_UP = false
    const manager = await adminToken(api)
    const cu = await customerToken(api)
    const on = await api.put('/admin/v1/settings/switches/SHOP_LANGUAGES', { enabled: true, confirmCode: 'manager123' }, { token: manager })
    assert.equal(on.status, 200, JSON.stringify(on.body))
    assert.equal((await api.get('/v1/policy')).body.features.languages, true)
    assert.equal((await api.put('/v1/me/language', { language: 'kn' }, as(cu))).status, 200)

    process.env.SHOP_LANGUAGES = 'false'
    forgetSwitches()
    assert.equal((await api.get('/v1/policy')).body.features.languages, false)
    assert.equal((await api.get('/v1/me/language', as(cu))).status, 404)
  })

  test('the choice is in the data export and is cleared when the account is deleted', async () => {
    const cu = await customerToken(api)
    await api.put('/v1/me/language', { language: 'kn' }, as(cu))
    const exp = await api.get('/v1/me/export', as(cu))
    assert.equal(exp.status, 200)
    assert.equal(exp.body.account.language, 'kn')
    const del = await api.del('/v1/me', as(cu))
    assert.equal(del.status, 204, JSON.stringify(del.body))
    assert.equal(await stored(cu.customer.id), null)
  })
})
