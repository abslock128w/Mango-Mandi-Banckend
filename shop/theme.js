/* Light / dark theme. Runs in <head> (not deferred) so the page never flashes the wrong theme.
   Follows the device setting until the viewer picks one with the header toggle ([data-theme-toggle]);
   the pick is kept in localStorage (`mm-theme`). theme.css holds the dark colours. */
(() => {
  const KEY = 'mm-theme'
  const root = document.documentElement
  const system = matchMedia('(prefers-color-scheme: dark)')
  const saved = () => {
    try {
      return localStorage.getItem(KEY)
    } catch {
      return null
    }
  }

  function apply(theme) {
    root.dataset.theme = theme
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.content = theme === 'dark' ? '#0e0d0a' : '#174631'
    // The header toggle is a switch: on means dark.
    document.querySelectorAll('[data-theme-toggle]').forEach((b) => b.setAttribute('aria-checked', theme === 'dark'))
  }

  apply(saved() || (system.matches ? 'dark' : 'light'))
  system.addEventListener('change', (e) => {
    if (!saved()) apply(e.matches ? 'dark' : 'light')
  })
  document.addEventListener('DOMContentLoaded', () => apply(root.dataset.theme))

  document.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest('[data-theme-toggle]') : null
    if (!b) return
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark'
    root.classList.add('theme-switching')
    apply(next)
    try {
      localStorage.setItem(KEY, next)
    } catch {}
    setTimeout(() => root.classList.remove('theme-switching'), 450)
  })
})()
