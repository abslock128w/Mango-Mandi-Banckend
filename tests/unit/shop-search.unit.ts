import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

// The shop's search that forgives typos and knows other names (shop/catalog.js find), and the one origin line and the
// renamed mixed box it holds: a browser script with no imports, run here in a bare context (no window.MM, so the
// API door is skipped).
type Hit = { name: string; how: 'name' | 'about' | 'alias' | 'typo'; mark?: [number, number] | null; word?: string }
type Variety = { name: string; region: string; origin: string; story: string; flavour: string; contents?: { name: string }[] }
type Catalog = {
  varieties: Variety[]
  origin: string
  originShort: string
  trending: string[]
  synonyms: { variety: string }[]
  shown: (v: string) => string
  keyOf: (n: string) => string
  typos: (n: number) => number
  aboutOf: (c: Variety) => string
  find: (q: string, list: { name: string; about: string }[]) => { items: Hit[]; fixed: string | null }
}
const ctx = { window: {} as { MM_CATALOG?: Catalog } }
vm.runInNewContext(readFileSync(new URL('../../shop/catalog.js', import.meta.url), 'utf8'), ctx)
const C = ctx.window.MM_CATALOG as Catalog
const shelf = C.varieties.map((v) => ({ name: v.name, about: C.aboutOf(v) }))
const find = (q: string) => JSON.parse(JSON.stringify(C.find(q, shelf))) as ReturnType<Catalog['find']>
const names = (q: string) => find(q).items.map((x) => x.name)

test('alpfonso, alfonso, alphanso and hapus find Alphonso first', () => {
  for (const q of ['alpfonso', 'alfonso', 'alphanso', 'hapus', 'Alphonso', 'ALPHONZO']) assert.equal(names(q)[0], 'Alphonso', q)
})

test('a typo is read as the name, and the search says which name it read', () => {
  const r = find('alpfonso')
  assert.equal(r.fixed, 'Alphonso')
  assert.deepEqual(r.items[0], { name: 'Alphonso', how: 'typo', mark: null })
  // what a search for "Alphonso" finds comes after it: Badami ("Alphonso-like") and the mixed box (it has Alphonso)
  assert.deepEqual(r.items.slice(1).map((x) => [x.name, x.how, x.word]), [['Badami', 'about', 'Alphonso-like'], ['Mixed Variety Mangoes', 'about', 'Alphonso']])
  assert.equal(find('kesr').fixed, 'Kesar')
  assert.equal(find('imam pasnd').fixed, 'Imam Pasand')
  assert.equal(find('himsagr').fixed, 'Himsagar')
})

test('the other names in the alias list point at their variety', () => {
  for (const [q, v] of [['banganapalle', 'Banganapalli'], ['benishan', 'Banganapalli'], ['dussehri', 'Dasheri'], ['langda', 'Langra'], ['himayath', 'Imam Pasand'], ['rathgiri', 'Alphonso']]) assert.equal(names(q)[0], v, q)
  assert.equal(find('langda').fixed, 'Langra')
})

test('mix, mixed, assorted and mixed box find Mixed Variety Mangoes', () => {
  for (const q of ['mix', 'mixed', 'assorted', 'mixed box', 'Mixed Box', 'mixed variety']) assert.equal(names(q)[0], 'Mixed Variety Mangoes', q)
})

test('the part of the name typed is marked, from the second letter', () => {
  assert.deepEqual(find('al').items[0], { name: 'Alphonso', how: 'name', mark: [0, 2] })
  assert.deepEqual(find('pasand').items[0], { name: 'Imam Pasand', how: 'name', mark: [5, 11] })
  // "raw" and "mango" are left out of a search for a name
  assert.deepEqual(find('raw alphonso mango').items[0], { name: 'Alphonso', how: 'name', mark: [0, 8] })
  assert.equal(find('alph').fixed, null)
  assert.deepEqual(names('alph'), ['Alphonso', 'Badami', 'Mixed Variety Mangoes'])
})

test('nothing is found when nothing is close', () => {
  for (const q of ['zzzz', 'random', 'qwerty', 'mangos', 'x']) assert.deepEqual(find(q), { items: [], fixed: null }, q)
})

test('typos allowed: two from five letters, one at four, none below', () => {
  assert.deepEqual([3, 4, 5, 8].map(C.typos), [0, 1, 2, 2])
  assert.equal(names('kesr')[0], 'Kesar')
  assert.deepEqual(names('ksr'), [])
  // three typos in an eight-letter word is too many
  assert.deepEqual(names('olpfanzo'), [])
})

test('every variety has the one origin line, and no other region is left in its origin', () => {
  assert.equal(C.origin, 'Yellamanda Village, Piler, Andhra Pradesh')
  assert.equal(C.originShort, 'Piler')
  assert.equal(C.varieties.length, 16)
  for (const v of C.varieties) {
    assert.equal(v.origin, C.origin, v.name)
    assert.equal(v.region, 'Piler', v.name)
  }
  assert.doesNotMatch(JSON.stringify(C.varieties.map((v) => [v.origin, v.region])), /West Bengal|Four regions|Maharashtra|Gujarat|Karnataka|Tamil Nadu|Uttar Pradesh/)
})

test('the mixed box is Mixed Variety Mangoes to customers, and keeps the API key "Mixed Box"', () => {
  assert.ok(C.varieties.some((v) => v.name === 'Mixed Variety Mangoes'))
  assert.equal(C.shown('Mixed Box'), 'Mixed Variety Mangoes')
  assert.equal(C.shown('Alphonso'), 'Alphonso')
  assert.equal(C.keyOf('Mixed Variety Mangoes'), 'Mixed Box')
  assert.equal(C.keyOf('Kesar'), 'Kesar')
  assert.doesNotMatch(JSON.stringify(C.varieties), /Mixed Box/)
  assert.ok(C.trending.includes('Mixed Variety Mangoes'))
  assert.ok(C.synonyms.some((s) => s.variety === 'Mixed Variety Mangoes'))
})
