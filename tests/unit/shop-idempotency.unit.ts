import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// AUDIT.md STOCK-01: the shop sends one Idempotency-Key per quote (and per pre-order booking), so a retry
// of the same request is answered from the first try instead of a fresh key every call.
const shop = (f: string) => readFileSync(new URL(`../../shop/${f}`, import.meta.url), 'utf8')
const api = shop('api.js')
const entry = (name: string) => {
  const m = new RegExp(`^\\s*${name}:(.*)$`, 'm').exec(api)
  assert.ok(m, `shop/api.js has no ${name}`)
  return m[1]
}

for (const name of ['confirm', 'bookPreorder']) {
  test(`shop api ${name} takes the Idempotency-Key from its caller`, () => {
    const line = entry(name)
    assert.doesNotMatch(line, /idem\(\)/, `${name} must not make a new key on every call`)
    assert.match(line, /^\(body,key\)=>/, `${name} takes (body,key)`)
    assert.match(line, /\{'Idempotency-Key':key\}/)
  })
}

test('every shop caller of confirm and bookPreorder passes a key', () => {
  const calls = ['app.js', 'gift-bag.js'].flatMap((f) =>
    [...shop(f).matchAll(/MM\.(confirm|bookPreorder)\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)].map((m) => ({ f, what: m[1], args: m[2] })),
  )
  assert.ok(calls.length >= 3, 'found the checkout and both pre-order callers')
  for (const c of calls) assert.match(c.args, /,\s*MM\.keyFor\(/, `${c.f} MM.${c.what} passes a kept key`)
})

test('the checkout key is dropped when a new quote is taken', () => {
  assert.match(shop('app.js'), /async function doQuote\(\)\{co\.quote=null;co\.key=null;/)
})
