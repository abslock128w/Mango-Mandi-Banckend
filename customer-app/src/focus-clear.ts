// Keeps a control reached with the keyboard clear of the sticky header and the bottom bars.
// The CSS scroll-padding does this in Chromium; Safari ignores it when Tab moves focus, so a
// focused control could sit under a bar (WCAG 2.4.11). Taps and clicks are left alone, so this
// never fights the on-screen keyboard.

let byKeyboard = false

const inBar = (el: HTMLElement) => {
  for (let x: HTMLElement | null = el; x && x !== document.body; x = x.parentElement) {
    const position = getComputedStyle(x).position
    if (position === 'fixed' || position === 'sticky') return true
  }
  return false
}

function keepClear(el: HTMLElement) {
  const css = getComputedStyle(document.documentElement)
  const top = parseFloat(css.scrollPaddingTop) || 0
  const bottom = parseFloat(css.scrollPaddingBottom) || 0
  const r = el.getBoundingClientRect()
  if (r.top < top) window.scrollBy(0, r.top - top)
  else if (r.bottom > window.innerHeight - bottom) window.scrollBy(0, r.bottom - (window.innerHeight - bottom))
}

if (typeof document !== 'undefined') {
  document.addEventListener('keydown', () => (byKeyboard = true), true)
  document.addEventListener('pointerdown', () => (byKeyboard = false), true)
  document.addEventListener('focusin', (e) => {
    const el = e.target
    if (!byKeyboard || !(el instanceof HTMLElement) || el === document.body || inBar(el)) return
    keepClear(el)
    // Again once the browser has done its own scrolling for the focus.
    requestAnimationFrame(() => keepClear(el))
  })
}
