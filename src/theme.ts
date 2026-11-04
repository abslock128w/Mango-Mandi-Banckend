// The panel's light/dark switch. "system" follows the computer; light or dark is kept in this
// browser and set as data-theme on <html>, which design/tokens.css reads.
export type ThemeChoice = 'system' | 'light' | 'dark'

const KEY = 'mango-ops.theme'

export function readTheme(): ThemeChoice {
  try {
    const v = window.localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement
  if (choice === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', choice)
  try {
    if (choice === 'system') window.localStorage.removeItem(KEY)
    else window.localStorage.setItem(KEY, choice)
  } catch {
    // Private windows: the choice lasts for this page only.
  }
  window.dispatchEvent(new Event('mm:theme'))
}

/** What the page shows now, for the switch's label. */
export function shownTheme(choice: ThemeChoice): 'light' | 'dark' {
  if (choice !== 'system') return choice
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
