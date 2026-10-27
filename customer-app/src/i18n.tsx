// The shop in English, Hindi and Kannada (SHOP_LANGUAGES, docs/languages.md).
//
// While the API's switch is off the shop is English only and offers no choice. With it on,
// a guest's choice is kept on this device; once signed in it is saved to the account
// (PUT /v1/me/language) and read back from it at sign-in (GET /v1/me/language), so it
// follows the customer to another phone. <html lang> follows the language shown.
import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, errorMessage } from './api'
import { useFeatures } from './features'
import { currentLang, isLang, LANG_NAMES, LANGS, setCurrentLang, translate, type Key, type Lang, type Vars } from './i18n-core.ts'
import { useStore } from './store'

export { LANG_NAMES, LANGS, type Key, type Lang }

const STORAGE_KEY = 'mm.lang'

function storedLang(): Lang | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return isLang(v) ? v : null
  } catch {
    return null
  }
}
function rememberLang(lang: Lang) {
  try {
    localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    // Storage blocked: the choice lasts as long as the tab (and on the account, once signed in).
  }
}

interface LanguageState {
  /** The language shown now: English whenever the switch is off. */
  lang: Lang
  /** Whether the shop offers a choice (the API's SHOP_LANGUAGES). */
  available: boolean
  /** Shows `lang` now, keeps it on this device and, when signed in, saves it to the account. */
  choose: (lang: Lang) => Promise<void>
  /** The last save to (or read from) the account that failed, shown beside the control. */
  error: string | null
}

const Ctx = createContext<LanguageState>({ lang: 'en', available: false, choose: async () => {}, error: null })

export function LanguageProvider({ children }: { children: ReactNode }) {
  const available = useFeatures().languages === true
  const { profile } = useStore()
  const [chosen, setChosen] = useState<Lang>(() => storedLang() ?? 'en')
  const [error, setError] = useState<string | null>(null)
  const lang: Lang = available ? chosen : 'en'
  // Set while rendering, before any child renders, so helpers outside React (dates, money,
  // status names) read the same language as the components that call them.
  if (currentLang() !== lang) setCurrentLang(lang)

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  // At sign-in (or when the switch comes on for a signed-in customer): the account's choice
  // wins; an account that never chose takes the one made on this device.
  const customerId = profile?.id ?? null
  useEffect(() => {
    if (!available || !customerId) return
    let live = true
    api
      .language()
      .then(async (r) => {
        if (!live) return
        if (r.language) {
          setChosen(r.language)
          rememberLang(r.language)
        } else {
          const here = storedLang()
          if (here) await api.saveLanguage(here)
        }
        if (live) setError(null)
      })
      .catch((e: unknown) => {
        if (live) setError(errorMessage(e))
      })
    return () => {
      live = false
    }
  }, [available, customerId])

  const signedIn = useRef(customerId)
  signedIn.current = customerId
  const choose = useCallback(async (next: Lang) => {
    setChosen(next)
    rememberLang(next)
    setError(null)
    if (!signedIn.current) return
    try {
      await api.saveLanguage(next)
    } catch (e) {
      setError(errorMessage(e))
      throw e
    }
  }, [])

  const value = useMemo(() => ({ lang, available, choose, error }), [lang, available, choose, error])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useLanguage = () => useContext(Ctx)

export type T = ((key: Key, vars?: Vars) => string) & {
  /** A sentence with parts that are not text (a link, a bold word): {name} in the entry becomes vars[name]. */
  rich: (key: Key, vars: Record<string, ReactNode>) => ReactNode
  lang: Lang
}

/** The words for the language shown; a component that calls it redraws when the language changes. */
export function useT(): T {
  const { lang } = useContext(Ctx)
  return useMemo(() => {
    const t = ((key: Key, vars?: Vars) => translate(lang, key, vars)) as T
    t.rich = (key, vars) => rich(translate(lang, key, plainVars(vars)), vars)
    t.lang = lang
    return t
  }, [lang])
}

function plainVars(vars: Record<string, ReactNode>): Vars {
  const out: Vars = {}
  for (const [k, v] of Object.entries(vars)) if (typeof v === 'string' || typeof v === 'number') out[k] = v
  return out
}

function rich(text: string, vars: Record<string, ReactNode>): ReactNode {
  const parts = text.split(/\{(\w+)\}/g)
  return parts.map((part, i) => (i % 2 === 1 ? <Fragment key={i}>{Object.prototype.hasOwnProperty.call(vars, part) ? vars[part] : `{${part}}`}</Fragment> : part))
}

/**
 * The language control: English, हिन्दी, ಕನ್ನಡ. Shown only while the switch is on. `compact`
 * is the small one for the sign-in page; the Account page shows it with its heading.
 */
export function LanguagePicker({ compact = false }: { compact?: boolean }) {
  const { lang, available, choose, error } = useLanguage()
  const t = useT()
  const [saved, setSaved] = useState(false)
  if (!available) return null
  const pick = (next: Lang) => {
    setSaved(false)
    choose(next).then(
      () => setSaved(true),
      () => setSaved(false),
    )
  }
  return (
    <div className={compact ? 'lang-picker lang-picker-compact' : 'lang-picker'}>
      <fieldset className="lang-choices">
        <legend className="sr-only">{t('lang.legend')}</legend>
        {LANGS.map((l) => (
          <button
            key={l}
            type="button"
            lang={l}
            className="chip"
            aria-pressed={l === lang}
            onClick={() => pick(l)}
          >
            {LANG_NAMES[l]}
          </button>
        ))}
      </fieldset>
      {saved && !error && !compact && (
        <p className="muted small" role="status">
          {t('lang.saved')}
        </p>
      )}
      {error && (
        <p className="note note-error" role="alert">
          {t('lang.saveFailed', { reason: error })}
        </p>
      )}
    </div>
  )
}
