import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DICTS, fill, isLang, isLoaded, LANGS, loadLang, LOCALES, placeholders, translate, type Key } from '../../src/i18n-core.ts'
import { en } from '../../src/i18n/en.ts'
import { hi } from '../../src/i18n/hi.ts'
import { kn } from '../../src/i18n/kn.ts'

const dicts = { hi, kn }

// The shop's dictionaries (SHOP_LANGUAGES, docs/languages.md): Hindi and Kannada have exactly
// the English keys, with the same {placeholders} and the same shape (plain or { one, other }),
// so no customer ever sees a raw key, a missing word or an unfilled {name}.

const keys = Object.keys(en).sort()

for (const lang of ['hi', 'kn'] as const) {
  test(`${lang} has exactly the English keys`, () => {
    const have = Object.keys(dicts[lang]).sort()
    assert.deepEqual(
      keys.filter((k) => !have.includes(k)),
      [],
      `missing in ${lang}`,
    )
    assert.deepEqual(
      have.filter((k) => !keys.includes(k)),
      [],
      `in ${lang} but not in English`,
    )
  })

  test(`${lang} uses the same placeholders and plural shape as English`, () => {
    const wrong: string[] = []
    for (const k of keys as Key[]) {
      const source = en[k]
      const entry = dicts[lang][k]
      if (typeof source !== typeof entry) wrong.push(`${k}: ${typeof source === 'string' ? 'plain' : 'plural'} in English`)
      else if (placeholders(source).join() !== placeholders(entry).join()) wrong.push(`${k}: {${placeholders(source).join('}, {')}} in English, {${placeholders(entry).join('}, {')}} in ${lang}`)
      for (const text of typeof entry === 'string' ? [entry] : [entry.one, entry.other]) {
        if (!text.trim()) wrong.push(`${k}: empty`)
        if (/\{(?!\w+\})|(?<!\{\w+)\}/.test(text)) wrong.push(`${k}: a stray brace in ${JSON.stringify(text)}`)
      }
    }
    assert.deepEqual(wrong, [])
  })

  test(`${lang} is written in its own script, not copied from English`, () => {
    // A guard against a dictionary left as an English copy: almost every entry has some
    // Devanagari (hi) or Kannada (kn) letters. Entries that are only placeholders, numbers,
    // codes or the brand ("{label}, {from}"…) are the only ones allowed to match English.
    const script = lang === 'hi' ? /[ऀ-ॿ]/ : /[ಀ-೿]/
    const copied = (keys as Key[]).filter((k) => {
      const entry = dicts[lang][k]
      const text = typeof entry === 'string' ? entry : `${entry.one} ${entry.other}`
      return !script.test(text) && /[A-Za-z]{3,}/.test(text.replace(/\{\w+\}/g, '').replace(/MandiMangoes|GSTIN|WhatsApp|Razorpay|PDF|CSV|UPI/g, ''))
    })
    assert.deepEqual(copied, [])
  })
}

test('placeholders are filled, and a missing one stays visible instead of vanishing', () => {
  assert.equal(fill('Order {number} for {name}', { number: 'MM-1', name: 'Asha' }), 'Order MM-1 for Asha')
  assert.equal(fill('Order {number}', {}), 'Order {number}')
  assert.equal(fill('{a}{a}', { a: 1 }), '11')
  // A value is never read as a pattern.
  assert.equal(fill('Hi {name}', { name: '{number} $& $1' }), 'Hi {number} $& $1')
  // Only own keys, never Object.prototype.
  assert.equal(fill('{toString}', {}), '{toString}')
})

test('Hindi and Kannada load on demand; until then their words fall back to English', async () => {
  assert.equal(isLoaded('en'), true)
  assert.equal(isLoaded('hi'), false)
  assert.equal(translate('hi', 'nav.cart'), translate('en', 'nav.cart'))
  await Promise.all([loadLang('hi'), loadLang('hi'), loadLang('kn')])
  assert.equal(isLoaded('hi'), true)
  assert.equal(DICTS.hi, hi)
  assert.equal(DICTS.kn, kn)
})

test('plural forms follow each language’s rules for the count', async () => {
  await Promise.all([loadLang('hi'), loadLang('kn')])
  assert.equal(translate('en', 'common.boxes', { count: 1 }), '1 box')
  assert.equal(translate('en', 'common.boxes', { count: 2 }), '2 boxes')
  assert.equal(translate('en', 'common.boxes', { count: 0 }), '0 boxes')
  assert.equal(translate('kn', 'common.boxes', { count: 1 }), '1 ಬಾಕ್ಸ್')
  assert.equal(translate('kn', 'common.boxes', { count: 5 }), '5 ಬಾಕ್ಸ್‌ಗಳು')
  assert.equal(translate('hi', 'common.boxes', { count: 3 }), '3 बॉक्स')
  assert.equal(translate('hi', 'nav.cart'), 'कार्ट')
})

test('dates and money use Latin digits in every language', () => {
  for (const lang of LANGS) {
    const money = new Intl.NumberFormat(LOCALES[lang], { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(123456)
    // Grouping follows the locale (1,23,456 in en-IN and hi-IN; kn-IN groups in thousands).
    assert.equal(money.replace(/[^0-9]/g, ''), '123456', `${lang}: ${money}`)
    assert.match(money, /₹/, `${lang}: ${money}`)
    const date = new Intl.DateTimeFormat(LOCALES[lang], { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date('2026-05-23T00:00:00Z'))
    assert.match(date, /23/, `${lang}: ${date}`)
    assert.doesNotMatch(`${money} ${date}`, /[०-९೦-೯]/, `${lang}: no Devanagari or Kannada digits`)
  }
})

test('only en, hi and kn are languages', () => {
  assert.deepEqual(LANGS, ['en', 'hi', 'kn'])
  for (const ok of ['en', 'hi', 'kn']) assert.equal(isLang(ok), true)
  for (const no of ['ta', 'HI', 'hi-IN', '', null, undefined, 1, 'toString']) assert.equal(isLang(no), false)
})
