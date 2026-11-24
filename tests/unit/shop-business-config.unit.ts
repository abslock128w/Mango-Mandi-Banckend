import assert from 'node:assert/strict'
import { test } from 'node:test'

// The shop's build (shop/build-config.mjs) writes the business details the footer, the Contact page and the legal
// pages show (BUSINESS_NAME, BUSINESS_ADDRESS, FSSAI_NUMBER, GSTIN) into config.js, only when set, and refuses a bad
// value. Its GSTIN check is a copy of the API's (mango-api/src/gstin.js): these tests keep the two in step.

type Result<T> = { value?: T; error?: string }
type Env = Record<string, string | undefined>
const build = (await import(new URL('../../shop/build-config.mjs', import.meta.url).href)) as {
  gstinFrom: (raw: unknown) => Result<string>
  fssaiFrom: (raw: unknown) => Result<string>
  businessFrom: (env: Env) => Result<Record<string, string>>
  missingDetails: (env: Env) => string[]
  configSource: (apiUrl: string, wa: string, contact?: Record<string, string>) => string
}
const api = (await import(new URL('../../mango-api/src/gstin.js', import.meta.url).href)) as {
  gstinCheckChar: (first14: string) => string
  gstinProblem: (raw: unknown) => string | null
}

const VALID = '27AAPFU0939F1Z' + api.gstinCheckChar('27AAPFU0939F1Z')

test('a valid GSTIN is accepted, upper-cased and without spaces', () => {
  assert.deepEqual(build.gstinFrom(VALID), { value: VALID })
  assert.deepEqual(build.gstinFrom(` ${VALID.slice(0, 7).toLowerCase()} ${VALID.slice(7)} `), { value: VALID })
  assert.deepEqual(build.gstinFrom(''), { value: '' })
  assert.deepEqual(build.gstinFrom(undefined), { value: '' })
})

test('a bad GSTIN is refused', () => {
  const typo = VALID.slice(0, 14) + (VALID[14] === 'A' ? 'B' : 'A')
  for (const bad of ['27AAPFU0939F1Z', VALID + 'X', '00AAPFU0939F1Z1', '40AAPFU0939F1Z1', 'AAAPFU0939F1Z12', typo]) {
    assert.ok(build.gstinFrom(bad).error, `${bad} should be refused`)
  }
})

test('the build and the API agree on which GSTINs are valid', () => {
  const samples = [VALID, '29ABCDE1234F1Z' + api.gstinCheckChar('29ABCDE1234F1Z'), '99ABCDE1234F2Z' + api.gstinCheckChar('99ABCDE1234F2Z'),
    '97ABCDE1234FAZ' + api.gstinCheckChar('97ABCDE1234FAZ'), '39ABCDE1234F1Z' + api.gstinCheckChar('39ABCDE1234F1Z'),
    '38ABCDE1234F1Z' + api.gstinCheckChar('38ABCDE1234F1Z'), '27AAPFU0939F0Z1', '27AAPFU0939F1Z0', 'ZZAAPFU0939F1Z1']
  for (const g of samples) assert.equal(!build.gstinFrom(g).error, api.gstinProblem(g) === null, g)
})

test('FSSAI_NUMBER must be 14 digits', () => {
  assert.deepEqual(build.fssaiFrom('12345678901234'), { value: '12345678901234' })
  assert.deepEqual(build.fssaiFrom('1234 5678 9012 34'), { value: '12345678901234' })
  assert.deepEqual(build.fssaiFrom(''), { value: '' })
  for (const bad of ['1234567890123', '123456789012345', '1234567890123A']) assert.ok(build.fssaiFrom(bad).error, bad)
})

test('business details are written only when set', () => {
  assert.deepEqual(build.businessFrom({}), { value: {} })
  assert.deepEqual(build.businessFrom({ BUSINESS_NAME: ' VMR Mangoes ', BUSINESS_ADDRESS: '12 Orchard Road, Chittoor, Andhra Pradesh 517001', FSSAI_NUMBER: '12345678901234', GSTIN: VALID }), {
    value: { businessName: 'VMR Mangoes', businessAddress: '12 Orchard Road, Chittoor, Andhra Pradesh 517001', fssaiNumber: '12345678901234', gstin: VALID },
  })
  assert.deepEqual(build.businessFrom({ BUSINESS_ADDRESS: '12 Orchard Road, Chittoor' }), { value: { businessAddress: '12 Orchard Road, Chittoor' } })
})

test('bad business details are refused', () => {
  assert.ok(build.businessFrom({ BUSINESS_NAME: 'V' }).error)
  assert.ok(build.businessFrom({ BUSINESS_NAME: '<b>VMR</b>' }).error)
  assert.ok(build.businessFrom({ BUSINESS_ADDRESS: 'Line one\nLine two of it' }).error)
  assert.ok(build.businessFrom({ BUSINESS_ADDRESS: 'Short' }).error)
  assert.ok(build.businessFrom({ FSSAI_NUMBER: '123' }).error)
  assert.ok(build.businessFrom({ GSTIN: 'not a gstin' }).error)
})

test('a production build names each missing contact or business detail', () => {
  const all = { SUPPORT_WHATSAPP: '919800000000', SUPPORT_PHONE: '+91 98000 00000', SUPPORT_EMAIL: 'help@example.com', BUSINESS_ADDRESS: '12 Orchard Road, Chittoor', FSSAI_NUMBER: '12345678901234', GSTIN: VALID }
  assert.deepEqual(build.missingDetails(all), [])
  const none = build.missingDetails({})
  assert.equal(none.length, 6)
  for (const k of Object.keys(all)) assert.ok(none.some((line) => line.includes(k)), k)
  assert.deepEqual(build.missingDetails({ ...all, GSTIN: ' ' }).length, 1)
})

test('config.js carries the business details as MM_CONFIG keys', () => {
  const src = build.configSource('', '', { businessName: 'VMR Mangoes', gstin: VALID })
  assert.match(src, /businessName: 'VMR Mangoes'/)
  assert.match(src, new RegExp(`gstin: '${VALID}'`))
  assert.equal(build.configSource('', ''), "window.MM_CONFIG = { apiUrl: '', supportWhatsapp: '' };\n")
})
