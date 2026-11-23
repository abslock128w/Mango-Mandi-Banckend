import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ApiError, errorFrom, parseAnswer } from '../../src/apiAnswer.ts'

// The panel's reading of API answers, without a browser (TST-3).

test("a refusal keeps the API's code, message and request id", () => {
  const err = errorFrom(409, 'Conflict', JSON.stringify({ error: { code: 'STALE_ATTEMPT', message: 'That attempt was already reported.', requestId: 'req-1' } }))
  assert.ok(err instanceof ApiError)
  assert.equal(err.name, 'ApiError')
  assert.deepEqual([err.status, err.code, err.message, err.requestId], [409, 'STALE_ATTEMPT', 'That attempt was already reported.', 'req-1'])
})

test('a refusal that is not the API JSON falls back to the status line', () => {
  const page = errorFrom(502, 'Bad Gateway', '<html><body>Bad Gateway</body></html>')
  assert.deepEqual([page.status, page.code, page.message, page.requestId], [502, 'HTTP_502', 'Bad Gateway', undefined])
  const bare = errorFrom(500, '', '')
  assert.deepEqual([bare.code, bare.message], ['HTTP_500', 'Request failed'])
  const partial = errorFrom(400, 'Bad Request', '{"error":{"code":"VALIDATION_ERROR"}}')
  assert.deepEqual([partial.code, partial.message], ['VALIDATION_ERROR', 'Bad Request'])
})

test('a JSON answer is its data; an empty one is undefined', () => {
  assert.deepEqual(parseAnswer(200, '{"id":"o1"}'), { id: 'o1' })
  assert.equal(parseAnswer(200, ''), undefined)
})

test("a 200 that isn't JSON (a proxy's page) is an ApiError, not a SyntaxError", () => {
  assert.throws(
    () => parseAnswer(200, '<!doctype html><title>Sign in to the Wi-Fi</title>'),
    (err: unknown) => err instanceof ApiError && err.code === 'BAD_RESPONSE' && err.status === 200 && /could not read/.test(err.message),
  )
})

test('order numbers read as the shop prints them; searches accept them typed any way', async () => {
  const { normaliseOrderNumber, sameOrderNumber } = await import('../../src/orderNumber.ts')
  const a = parseAnswer<Record<string, unknown>>(200, JSON.stringify({
    number: 'S743406080', orderNumber: 'P012345678', replacementNumber: 'G000000001', order_number: 'B743406080',
    old: { number: '7434060801', orderNumber: '7434060801', groupNumber: '7434060801' }, pre: { number: 'PRE-1035' }, bill: { number: 'MM/26-27/0001' }, sku: 'S743406080',
  }))
  assert.deepEqual(a, {
    number: 'S-743 406 080', orderNumber: 'P-012 345 678', replacementNumber: 'G-000 000 001', order_number: 'B-743 406 080',
    old: { number: '#7434060801', orderNumber: '#7434060801', groupNumber: '7434060801' }, pre: { number: 'PRE-1035' }, bill: { number: 'MM/26-27/0001' }, sku: 'S743406080',
  })
  for (const typed of ['s-743 406 080', '#S743406080', 'S743406080', 'S-743 406 080', ' # s 743406080 ']) assert.equal(normaliseOrderNumber(typed), 'S743406080', typed)
  assert.equal(normaliseOrderNumber('#7434060801'), '7434060801')
  assert.equal(normaliseOrderNumber('pre 1035'), 'PRE-1035')
  assert.equal(normaliseOrderNumber('Asha Rao'), 'Asha Rao')
  assert.ok(sameOrderNumber('S-743 406 080', 's743406080'))
  assert.ok(!sameOrderNumber('S-743 406 080', 'B743406080'))
})
