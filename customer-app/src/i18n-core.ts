// The shop's words in English, Hindi and Kannada (SHOP_LANGUAGES, docs/languages.md).
// No React and no browser here, so the dictionaries and the plural and placeholder
// rules are unit tested on their own (customer-app/tests/unit/i18n.unit.ts).
//
// A dictionary entry is a string with {placeholders}, or { one, other } where the
// form is picked by the language's own plural rules for vars.count. Product and
// variety names, addresses and anything else from the database are never looked up
// here: they stay as the shop team entered them.
import { en } from './i18n/en.ts'
import { hi } from './i18n/hi.ts'
import { kn } from './i18n/kn.ts'

export type Lang = 'en' | 'hi' | 'kn'
export type Entry = string | { one: string; other: string }
export type Key = keyof typeof en
export type Dict = Record<Key, Entry>
export type Vars = Record<string, string | number>

export const LANGS: Lang[] = ['en', 'hi', 'kn']
export const DICTS: Record<Lang, Dict> = { en, hi, kn }
/** Each language's name in its own script, as the language control shows it. */
export const LANG_NAMES: Record<Lang, string> = { en: 'English', hi: 'हिन्दी', kn: 'ಕನ್ನಡ' }
/** Dates and money: Indian formats, with Latin digits (0-9) in every language. */
export const LOCALES: Record<Lang, string> = { en: 'en-IN', hi: 'hi-IN-u-nu-latn', kn: 'kn-IN-u-nu-latn' }

export const isLang = (v: unknown): v is Lang => typeof v === 'string' && (LANGS as string[]).includes(v)

let current: Lang = 'en'
/** The language the shop is showing now (English until the provider says otherwise). */
export const currentLang = (): Lang => current
export const setCurrentLang = (lang: Lang) => {
  current = lang
}
/** The Intl locale for the current language. */
export const locale = () => LOCALES[current]

const plurals = new Map<Lang, Intl.PluralRules>()
function pluralForm(lang: Lang, n: number): 'one' | 'other' {
  let rules = plurals.get(lang)
  if (!rules) {
    rules = new Intl.PluralRules(LOCALES[lang])
    plurals.set(lang, rules)
  }
  return rules.select(n) === 'one' ? 'one' : 'other'
}

/** {name} in a string, filled from vars; a missing var leaves the {name} in place, so it shows in testing. */
export function fill(text: string, vars?: Vars): string {
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (all, name: string) => (Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : all))
}

/** The entry's text in `lang` (English when that dictionary lacks it), with the plural form for vars.count. */
export function translate(lang: Lang, key: Key, vars?: Vars): string {
  const entry = DICTS[lang][key] ?? en[key]
  if (typeof entry === 'string') return fill(entry, vars)
  const n = Number(vars?.count ?? 0)
  return fill(entry[pluralForm(lang, n)], vars)
}

/** The current language's text for `key`. Components use useT() instead, so they redraw when it changes. */
export const t = (key: Key, vars?: Vars) => translate(current, key, vars)

/** The placeholders an entry uses, sorted: the same set in every language (tested). */
export function placeholders(entry: Entry): string[] {
  const texts = typeof entry === 'string' ? [entry] : [entry.one, entry.other]
  return [...new Set(texts.flatMap((s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1])))].sort()
}
