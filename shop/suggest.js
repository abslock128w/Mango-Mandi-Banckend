/* Search suggestions: the mangoes on the shelf in a list under the search box (#search) from the second letter typed,
   like a shop's search: up to six rows, each with a small photo, the name with the typed part in bold and one grey
   line (its ripeness and pre-order week, or the words that matched, such as “Alphonso-like”). The search forgives
   typos and knows other names (catalog.js find: "alpfonso", "alfonso" and "hapus" find Alphonso, "mix" finds Mixed
   Variety Mangoes); when it read the search as another name the list says so ("Showing results for Alphonso · search
   instead for ‘alpfonso’") and the shelf under it is filtered the same way (shelf.js visibleShelf).
   Tapping a row, or Enter on it, opens that mango's product sheet (shelf.js productDetail); Enter with no row chosen
   takes the customer to the shelf's first card (goToResult). Up and down arrows move, Escape closes. The box is an
   ARIA combobox with a listbox, and a status line says how many mangoes were found.
   The list sits inside the search box's own field (.search), so it follows the field wherever the page puts it (under
   the header, or higher up on phones: phone-search.js). Loaded after app.js and shelf.js, whose globals (shelf,
   stageFor, stageOf, preSeason, pre, productDetail, searchExact) it reads at call time. Styles: style.css (.search-names). */
(() => {
  const ROWS = 6
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const catalog = () => window.MM_CATALOG || {}
  const onShelf = () => (typeof shelf !== 'undefined' && Array.isArray(shelf) ? shelf : [])
  // the name with the part that was typed in bold; a name found another way (another name, a typo) is bold all through
  const mark = (name, at) => (at ? esc(name.slice(0, at[0])) + '<b>' + esc(name.slice(at[0], at[1])) + '</b>' + esc(name.slice(at[1])) : `<b>${esc(name)}</b>`)
  const weekWords = (d) => { const [y, m, day] = String(d).split('-').map(Number); return new Date(y, m - 1, day).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) }

  /** The grey line under a name: its ripeness and, before the season, the first pre-order week with room. */
  function lineFor(v, hit) {
    const stage = typeof stageFor === 'function' ? stageFor(v) : 'SEMI_RIPE'
    const ripe = typeof stageOf === 'function' ? stageOf(stage).stage : 'Semi-ripe'
    if (hit.how === 'about') return `“${hit.word}” · ${ripe}`
    if (typeof preSeason === 'function' && preSeason()) {
      const mine = typeof pre !== 'undefined' && pre && Array.isArray(pre.weeks) ? pre.weeks.filter((w) => w.remaining > 0 && v.skus.some((s) => s.sku === w.sku)).map((w) => w.weekStart).sort() : []
      return `${ripe} · ${mine.length ? `pre-order, week of ${weekWords(mine[0])}` : 'pre-order'}`
    }
    return v.c.bestFor ? `${ripe} · ${v.c.bestFor}` : ripe
  }
  function photoFor(v) {
    const stage = typeof stageFor === 'function' ? stageFor(v) : 'SEMI_RIPE', p = v.c.photos || {}
    const src = p[stage] || p.SEMI_RIPE || p.RAW
    return src ? `<img src="${esc(src)}" alt="" width="40" height="40" loading="lazy" decoding="async">` : '<span class="search-names-nophoto"></span>'
  }

  /** What the list shows for a search: { rows: [{ v, hit }], fixed }. */
  function look(text) {
    const list = onShelf(), C = catalog()
    if (!C.find || !list.length) return { rows: [], fixed: null }
    const r = C.find(text, list.map((v) => ({ name: v.name, about: C.aboutOf(v.c) })))
    // "search instead for …": the words as typed, which found nothing
    if (r.fixed && typeof searchExact !== 'undefined' && searchExact === text.trim().toLowerCase()) return { rows: [], fixed: null }
    const rows = r.items.map((hit) => ({ v: list.find((v) => v.name === hit.name), hit })).filter((x) => x.v).slice(0, ROWS)
    return { rows, fixed: rows.length ? r.fixed : null }
  }

  // After Enter with no row chosen: take the customer straight to the shelf. It has just been filtered, so the first
  // card is the best match; it is brought to the middle of the screen and lit for a moment. With nothing on the shelf
  // for the search, the "No mangoes found" message is shown instead.
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches
  function goToResult() {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const grid = document.getElementById('products'), none = document.getElementById('no-results')
      const card = grid && grid.querySelector('.product-card')
      const target = card || (none && !none.hidden ? none : document.getElementById('shop'))
      if (!target) return
      // a card taller than the room between the header and the bottom of the screen is shown from its top
      const tall = card && card.getBoundingClientRect().height > innerHeight - 230
      target.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: card && !tall ? 'center' : 'start' })
      if (card) { card.classList.remove('is-found'); void card.offsetWidth; card.classList.add('is-found'); setTimeout(() => card.classList.remove('is-found'), 2200) }
    }))
  }

  function attach(input, key) {
    const field = input && input.closest('.search')
    if (!field) return
    const panel = document.createElement('div')
    panel.className = 'search-names'
    panel.hidden = true
    const list = document.createElement('ul')
    list.className = 'search-names-list'
    list.id = 'search-names-' + key
    list.setAttribute('role', 'listbox')
    list.setAttribute('aria-label', 'Mangoes')
    const fix = document.createElement('p')
    fix.className = 'search-names-fix'
    fix.hidden = true
    panel.append(fix, list)
    field.appendChild(panel)
    // how many mangoes were found, for screen readers (the list itself is not announced as it changes)
    const count = document.createElement('p')
    count.className = 'sr-only'
    count.id = list.id + '-count'
    count.setAttribute('role', 'status')
    field.appendChild(count)
    input.setAttribute('role', 'combobox')
    input.setAttribute('aria-autocomplete', 'list')
    input.setAttribute('aria-controls', list.id)
    input.setAttribute('aria-expanded', 'false')
    input.setAttribute('autocomplete', 'off')
    let shown = [], at = -1, said = '', sayTimer = 0
    const say = (text) => {
      clearTimeout(sayTimer)
      sayTimer = setTimeout(() => { if (text !== said) { said = text; count.textContent = text } }, 400)
    }
    const close = () => {
      panel.hidden = true; shown = []; at = -1
      input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant')
    }
    const paint = () => {
      list.querySelectorAll('[role=option]').forEach((el, i) => { el.setAttribute('aria-selected', String(i === at)); if (i === at) { input.setAttribute('aria-activedescendant', el.id); el.scrollIntoView({ block: 'nearest' }) } })
      if (at < 0) input.removeAttribute('aria-activedescendant')
    }
    const open = () => {
      const text = input.value.trim()
      if (text.length < 2) { say(''); return close() }
      const { rows, fixed } = look(text)
      shown = rows
      const n = rows.length, words = `${n} ${n === 1 ? 'mango' : 'mangoes'}`
      if (!n) { say('No mangoes found.'); return close() }
      say(fixed ? `Showing results for ${fixed}: ${words}.` : `${words} found.`)
      at = -1
      fix.hidden = !fixed
      fix.innerHTML = fixed ? `<span>Showing results for <strong>${esc(fixed)}</strong></span> <span aria-hidden="true">·</span> <button type="button" class="search-names-exact" data-search-exact tabindex="-1">search instead for ‘${esc(text)}’</button>` : ''
      list.innerHTML = rows.map(({ v, hit }, i) => `<li role="option" id="${list.id}-${i}" aria-selected="false" data-name="${esc(v.name)}">${photoFor(v)}<span class="search-names-text"><span class="search-names-name">${mark(v.name, hit.how === 'name' ? hit.mark : null)}</span><small>${esc(lineFor(v, hit))}</small></span></li>`).join('')
      panel.hidden = false
      input.setAttribute('aria-expanded', 'true')
    }
    const choose = (name) => {
      close()
      if (typeof productDetail === 'function') productDetail(name)
    }
    input.addEventListener('input', (e) => { if (e.isTrusted) open() })
    input.addEventListener('focus', open)
    input.addEventListener('keydown', (e) => {
      if (panel.hidden) { if (e.key === 'ArrowDown') open(); else if (e.key === 'Enter' && input.value.trim()) { e.preventDefault(); goToResult() } return }
      if (e.key === 'ArrowDown') { e.preventDefault(); at = (at + 1) % shown.length; paint() }
      else if (e.key === 'ArrowUp') { e.preventDefault(); at = (at - 1 + shown.length) % shown.length; paint() }
      else if (e.key === 'Enter' && at >= 0) { e.preventDefault(); choose(shown[at].v.name) }
      else if (e.key === 'Enter') { e.preventDefault(); close(); goToResult() }
      else if (e.key === 'Escape') { e.preventDefault(); close() }
    })
    // A press on the list keeps the focus in the box (so it does not close on blur); the click then chooses. The sheet
    // opens on the click, not the press, so the release can't land on the sheet's backdrop. "search instead" is a
    // button handled by shelf.js (its click).
    panel.addEventListener('pointerdown', (e) => e.preventDefault())
    panel.addEventListener('click', (e) => {
      const li = e.target.closest('[data-name]')
      if (li) choose(li.dataset.name)
    })
    window.addEventListener('mm:search-exact', () => { if (document.activeElement === input) open(); else close() })
    document.addEventListener('pointerdown', (e) => { if (e.target !== input && !panel.contains(e.target)) close() })
    input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input) close() }, 150))
    window.addEventListener('mm:route', close)
  }

  attach(document.getElementById('search'), 'top')
})()
