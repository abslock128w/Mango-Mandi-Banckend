/* Search suggestions: the mangoes on the shelf in a list under the search box (#search) from the second letter typed,
   like a shop's search: the first six of the cards the grid shows for it (best first), each row with a small photo,
   the name with the typed part in bold and one grey line (its ripeness and pre-order week, or the words that matched,
   such as “Alphonso-like”). The search forgives
   typos and knows other names (catalog.js find: "alpfonso", "alfonso" and "hapus" find Alphonso, "mix" finds Mixed
   Variety Mangoes); when it read the search as another name the list says so ("Showing results for Alphonso · search
   instead for ‘alpfonso’") and the shelf under it is filtered the same way (shelf.js visibleShelf).
   Tapping a row, or Enter on it, opens that mango's product sheet (shelf.js productDetail); Enter with no row chosen
   takes the customer to the shelf's first card (goToResult). Up and down arrows move, Escape closes. The box is an
   ARIA combobox with a listbox, and a status line says how many mangoes the grid now shows (not how many rows the list
   has): "Showing results for Alphonso: 3 mangoes.", "16 mangoes.", "No mangoes found.".
   The list sits inside the search box's own field (.search), so it follows the field wherever the page puts it (under
   the header, or higher up on phones: phone-search.js). Loaded after app.js and shelf.js, whose globals (shelf,
   stageFor, stageOf, preSeason, pre, productDetail, searchExact) it reads at call time. Styles: style.css (.search-names).
   The same list serves other search boxes: window.MM_SUGGEST.attach(input, options) gives one its own list (by `key`),
   with its own cards, correction and choice. The Gifts page's box (#gift-q, gifts.js giftSuggest) uses it: its rows are
   the gift cards the page shows, and choosing one goes to that card. Once this file has run it says so ('mm:suggest'),
   so a box drawn before it (a /gifts page opened directly) is given its list then. */
(() => {
  const ROWS = 6
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const catalog = () => window.MM_CATALOG || {}
  const onShelf = () => (typeof shelf !== 'undefined' && Array.isArray(shelf) ? shelf : [])
  // the name with the part that was typed in bold; a name found another way (another name, a typo) is bold all through
  const mark = (name, at, plain) => (plain ? esc(name) : at ? esc(name.slice(0, at[0])) + '<b>' + esc(name.slice(at[0], at[1])) + '</b>' + esc(name.slice(at[1])) : `<b>${esc(name)}</b>`)
  const weekWords = (d) => { const [y, m, day] = String(d).split('-').map(Number); return new Date(y, m - 1, day).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) }

  // the ripeness a row shows: the shelf card's (shelf.js stageFor), or the one the box's page shows (options.stage)
  const stageIn = (v, o) => (o.stage ? o.stage(v) : typeof stageFor === 'function' ? stageFor(v) : 'SEMI_RIPE')
  /** The grey line under a name: its ripeness and, before the season, the first pre-order week with room. */
  function lineFor(v, hit, o) {
    const stage = stageIn(v, o)
    const ripe = typeof stageOf === 'function' ? stageOf(stage).stage : 'Semi-ripe'
    if (hit.how === 'about') return `“${hit.word}” · ${ripe}`
    if (typeof preSeason === 'function' && preSeason()) {
      const mine = typeof pre !== 'undefined' && pre && Array.isArray(pre.weeks) ? pre.weeks.filter((w) => w.remaining > 0 && v.skus.some((s) => s.sku === w.sku)).map((w) => w.weekStart).sort() : []
      return `${ripe} · ${mine.length ? `pre-order, week of ${weekWords(mine[0])}` : 'pre-order'}`
    }
    return v.c.bestFor ? `${ripe} · ${v.c.bestFor}` : ripe
  }
  function photoFor(v, o) {
    const stage = stageIn(v, o), p = v.c.photos || {}
    const src = p[stage] || p.SEMI_RIPE || p.RAW
    return src ? `<img src="${esc(src)}" alt="" width="40" height="40" loading="lazy" decoding="async">` : '<span class="search-names-nophoto"></span>'
  }

  /**
   * What the list shows for a search: the first six cards the shelf now shows (shelf.js visibleShelf, best first), so the
   * list and the grid always agree, each with how it matched (catalog.js find: the typed part of the name in bold, or the
   * words that matched). Returns { rows: [{ v, hit }], fixed, count }: count is how many cards the grid shows.
   * `found`: another box's cards and correction (options.results), instead of the shelf's.
   */
  function look(text, found) {
    const C = catalog()
    const r = found ? found(text) : typeof visibleShelf === 'function' && onShelf().length ? { cards: visibleShelf(), fixed: typeof searchFix !== 'undefined' && searchFix ? searchFix.to : null } : null
    if (!r || !r.cards) return { rows: [], fixed: null, count: 0 }
    const { cards, fixed } = r
    const how = new Map()
    if (C.find) for (const hit of C.find(text, cards.map((v) => ({ name: v.name, about: C.aboutOf(v.c) }))).items) how.set(hit.name, hit)
    const words = text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !/^(mangoe?s?|box|raw|semi|ripe|the|for|and|of)$/.test(w))
    const hitFor = (v) => {
      if (how.has(v.name)) return how.get(v.name)
      // a card found some other way: the typed word in its name is still marked; otherwise the name is plain
      const name = v.name.toLowerCase()
      for (const w of words) { const at = name.indexOf(w); if (at >= 0) return { name: v.name, how: 'name', mark: [at, at + w.length] } }
      return { name: v.name, how: 'all', mark: null }
    }
    return { rows: cards.slice(0, ROWS).map((v) => ({ v, hit: hitFor(v) })), fixed, count: cards.length }
  }

  // After Enter with no row chosen: take the customer straight to the shelf. It has just been filtered, so the first
  // card is the best match; it is brought to the middle of the screen and lit for a moment. With nothing on the shelf
  // for the search, the "No mangoes found" message is shown instead.
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches
  /** Brings a card (or the "no mangoes" message) to the screen and lights a card for a moment (.is-found). */
  function bring(target, card) {
    if (!target) return
    // a card taller than the room between the header and the bottom of the screen is shown from its top
    const tall = card && card.getBoundingClientRect().height > innerHeight - 230
    target.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: card && !tall ? 'center' : 'start' })
    if (card) { card.classList.remove('is-found'); void card.offsetWidth; card.classList.add('is-found'); setTimeout(() => card.classList.remove('is-found'), 2200) }
  }
  // the shelf's grid; another box names its own (options.grid: { grid, card, none, page } as ids and a class)
  const SHELF = { grid: '#products', card: '.product-card', none: '#no-results', page: '#shop' }
  function goToResult(at = SHELF) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const grid = document.querySelector(at.grid), none = at.none && document.querySelector(at.none)
      const card = grid && grid.querySelector(at.card)
      bring(card || (none && !none.hidden ? none : at.page && document.querySelector(at.page)), card)
    }))
  }
  const live = {}

  /**
   * Gives a search box its list. `key` names the list (its ids). The options, for a box other than the shop's (#search):
   *   field    the element the list sits in (positioned), default the box's .search;
   *   results  (text) → { cards, fixed }: the cards the page shows for it, best first, and the name it was read as;
   *   stage    (variety) → the ripeness its row shows;
   *   choose   (name) → what choosing a row does (default: the product sheet);
   *   grid     where Enter with no row chosen goes ({ grid, card, none, page }, default the shelf);
   *   exact    the attribute of the correction's "search instead" button (its page handles the click), and
   *   exactEvent  the event that page sends once it has searched the words as typed.
   * A box drawn again by its page (same key) replaces the old one's listeners.
   */
  function attach(input, key, o = {}) {
    const field = input && (o.field || input.closest('.search'))
    if (!field || input.dataset.suggest) return
    input.dataset.suggest = key
    if (live[key]) live[key].abort()
    const ac = new AbortController(), signal = ac.signal
    live[key] = ac
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
    // what the status line says is the number of cards the grid shows, not the rows in the list (catalog.js status)
    const announce = (count, fixed) => say(catalog().status ? catalog().status(count, fixed) : count ? `${count} mangoes.` : 'No mangoes found.')
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
      const { rows, fixed, count } = look(text, o.results)
      shown = rows
      announce(count, fixed)
      if (!rows.length) return close()
      at = -1
      fix.hidden = !fixed
      fix.innerHTML = fixed ? `<span>Showing results for <strong>${esc(fixed)}</strong></span> <span aria-hidden="true">·</span> <button type="button" class="search-names-exact" ${o.exact || 'data-search-exact'} tabindex="-1">search instead for ‘${esc(text)}’</button>` : ''
      list.innerHTML = rows.map(({ v, hit }, i) => `<li role="option" id="${list.id}-${i}" aria-selected="false" data-name="${esc(v.name)}">${photoFor(v, o)}<span class="search-names-text"><span class="search-names-name">${mark(v.name, hit.how === 'name' ? hit.mark : null, hit.how === 'all')}</span><small>${esc(lineFor(v, hit, o))}</small></span></li>`).join('')
      panel.hidden = false
      input.setAttribute('aria-expanded', 'true')
    }
    const choose = (name) => {
      close()
      if (o.choose) o.choose(name)
      else if (typeof productDetail === 'function') productDetail(name)
    }
    const go = () => goToResult(o.grid)
    input.addEventListener('input', (e) => { if (e.isTrusted) open() })
    input.addEventListener('focus', open)
    input.addEventListener('keydown', (e) => {
      if (panel.hidden) { if (e.key === 'ArrowDown') open(); else if (e.key === 'Enter' && input.value.trim()) { e.preventDefault(); go() } return }
      if (e.key === 'ArrowDown') { e.preventDefault(); at = (at + 1) % shown.length; paint() }
      else if (e.key === 'ArrowUp') { e.preventDefault(); at = (at - 1 + shown.length) % shown.length; paint() }
      else if (e.key === 'Enter' && at >= 0) { e.preventDefault(); choose(shown[at].v.name) }
      else if (e.key === 'Enter') { e.preventDefault(); close(); go() }
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
    // "search instead for …" changed the grid: say the new count, wherever the focus is
    window.addEventListener(o.exactEvent || 'mm:search-exact', () => {
      if (document.activeElement === input) return open()
      close()
      if (input.value.trim().length >= 2) { const { fixed, count } = look(input.value.trim(), o.results); announce(count, fixed) }
    }, { signal })
    document.addEventListener('pointerdown', (e) => { if (e.target !== input && !panel.contains(e.target)) close() }, { signal })
    input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input) close() }, 150))
    // a box its page took away (another page, or the page drawn again) lets go of the window's events
    window.addEventListener('mm:route', () => { close(); if (!input.isConnected) ac.abort() }, { signal })
  }

  window.MM_SUGGEST = { attach, bring }
  attach(document.getElementById('search'), 'top')
  window.dispatchEvent(new Event('mm:suggest'))
})()
