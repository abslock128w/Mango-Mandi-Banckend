/* Search suggestions: mango names in a dropdown from the first letter typed (the list the shop wants customers to see).
   Choosing one fills the search box, which filters the shelf as typing does (catalog.js maps the other spellings,
   such as Himayath or Dasari, to the variety's name on the shelf), and takes the customer straight to that mango's
   card (goToResult); Enter on typed text does the same. Arrow keys, Enter and Escape work.
   Two search boxes get it: the one under the header (the list drops below it) and the one in the phone dock (the list
   rises above the dock). Loaded after app.js and before dock.js. Styles: style.css (.search-names). */
(() => {
  const NAMES = ['Imam Pasand / Himayath', 'Malgova', 'Rathgiri', 'Alphonso', 'Dasari', 'Banginapalli', 'Raspuri', 'Badami', 'Mallika', 'Kalepad', 'Small Rasalu', 'Big Rasalu', 'Chausa']
  // what goes into the search box for a name (the first part of "Imam Pasand / Himayath")
  const termFor = (name) => name.split(' / ')[0]
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  // a name matches when the typed text starts it or starts one of its words; those that start the name come first
  const matches = (q) => {
    const starts = [], words = []
    for (const n of NAMES) {
      const low = n.toLowerCase()
      if (low.startsWith(q)) starts.push(n)
      else if (low.split(/[\s/]+/).some((w) => w.startsWith(q))) words.push(n)
    }
    return [...starts, ...words]
  }
  // the name with the typed letters in bold, where they start a word
  const mark = (name, q) => {
    const low = name.toLowerCase()
    let i = -1
    for (const m of low.matchAll(/[^\s/]+/g)) if (low.startsWith(q, m.index)) { i = m.index; break }
    return i < 0 ? esc(name) : esc(name.slice(0, i)) + '<b>' + esc(name.slice(i, i + q.length)) + '</b>' + esc(name.slice(i + q.length))
  }

  // After a search is chosen (a suggestion, or Enter): take the customer straight to that mango. The shelf has just
  // been filtered, so the first card is the one asked for; it is brought to the middle of the screen and lit for a
  // moment. With nothing on the shelf for that name, the "no mangoes match" message is shown instead.
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches
  function goToResult(fromDock) {
    // on a phone the keyboard leaves first, so the card is not hidden behind it
    if (fromDock && document.activeElement && document.activeElement.blur) document.activeElement.blur()
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const grid = document.getElementById('products'), none = document.getElementById('no-results')
      const card = grid && grid.querySelector('.product-card')
      const target = card || (none && !none.hidden ? none : document.getElementById('shop'))
      if (!target) return
      // a card taller than the room between the header and the dock is shown from its top (photo and name first)
      const tall = card && card.getBoundingClientRect().height > innerHeight - 230
      target.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: card && !tall ? 'center' : 'start' })
      if (card) { card.classList.remove('is-found'); void card.offsetWidth; card.classList.add('is-found'); setTimeout(() => card.classList.remove('is-found'), 2200) }
    }))
  }

  function attach(input, key, { above = false } = {}) {
    if (!input) return
    const list = document.createElement('ul')
    list.className = 'search-names' + (above ? ' is-above' : '')
    list.id = 'search-names-' + key
    list.setAttribute('role', 'listbox')
    list.setAttribute('aria-label', 'Mango names')
    list.hidden = true
    // below the header's box the list sits inside it; above the dock it is laid over the page, clear of the dock's glass
    if (above) document.body.appendChild(list); else input.closest('.search').appendChild(list)
    input.setAttribute('role', 'combobox')
    input.setAttribute('aria-autocomplete', 'list')
    input.setAttribute('aria-controls', list.id)
    input.setAttribute('aria-expanded', 'false')
    input.setAttribute('autocomplete', 'off')
    let shown = [], at = -1
    const close = () => { list.hidden = true; shown = []; at = -1; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant') }
    const paint = () => {
      list.querySelectorAll('[role=option]').forEach((el, i) => { el.setAttribute('aria-selected', String(i === at)); if (i === at) { input.setAttribute('aria-activedescendant', el.id); el.scrollIntoView({ block: 'nearest' }) } })
      if (at < 0) input.removeAttribute('aria-activedescendant')
    }
    const open = () => {
      const q = input.value.trim().toLowerCase()
      shown = q ? matches(q) : []
      // nothing to suggest, or the box already holds exactly one of the names
      if (!shown.length || shown.some((n) => termFor(n).toLowerCase() === q)) return close()
      at = -1
      list.innerHTML = shown.map((n, i) => `<li role="option" id="${list.id}-${i}" aria-selected="false" data-name="${esc(n)}"><svg aria-hidden="true"><use href="#i-search"/></svg><span>${mark(n, q)}</span></li>`).join('')
      if (above) { const r = input.getBoundingClientRect(); list.style.bottom = Math.round(innerHeight - r.top + 14) + 'px' }
      list.hidden = false
      input.setAttribute('aria-expanded', 'true')
    }
    const choose = (name) => {
      input.value = termFor(name)
      close()
      input.dispatchEvent(new Event('input', { bubbles: true })) // the shelf filters as if it had been typed
      goToResult(above)
    }
    input.addEventListener('input', (e) => { if (e.isTrusted) open() })
    input.addEventListener('focus', open)
    input.addEventListener('keydown', (e) => {
      if (list.hidden) { if (e.key === 'ArrowDown') open(); else if (e.key === 'Enter' && input.value.trim()) { e.preventDefault(); goToResult(above) } return }
      if (e.key === 'ArrowDown') { e.preventDefault(); at = (at + 1) % shown.length; paint() }
      else if (e.key === 'ArrowUp') { e.preventDefault(); at = (at - 1 + shown.length) % shown.length; paint() }
      else if (e.key === 'Enter' && at >= 0) { e.preventDefault(); choose(shown[at]) }
      else if (e.key === 'Enter') { e.preventDefault(); close(); goToResult(above) }
      else if (e.key === 'Escape') { e.preventDefault(); close() }
    })
    // pointerdown, not click: the choice is made before the box loses focus
    list.addEventListener('pointerdown', (e) => { const li = e.target.closest('[data-name]'); if (li) { e.preventDefault(); choose(li.dataset.name) } })
    document.addEventListener('pointerdown', (e) => { if (e.target !== input && !list.contains(e.target)) close() })
    input.addEventListener('blur', () => setTimeout(close, 150))
    window.addEventListener('mm:route', close)
  }

  attach(document.getElementById('search'), 'top')
  attach(document.querySelector('.dock-search input'), 'dock', { above: true })
})()
