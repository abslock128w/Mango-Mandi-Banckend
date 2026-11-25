/* VMR Mangoes catalogue content: the words and photos for each variety the shop can sell.
   Brought over from the MangoKart shop (~/mangokart/mocks/seed/catalog.ts, lib/ripeness.ts).
   Prices, boxes and stock are NOT here: they come from mango-api (/v1/products, /v1/catalogue).
   A variety joins its API products on `name` === product.variety. A variety the API does not
   sell is never shown; an API variety with no entry here gets a plain fallback (shelf.js).
   Also here: where every mango is grown (ORIGIN, one line for all of them), the names customers see for a variety the
   API keys under an older name (SHOWN: "Mixed Box" is shown as "Mixed Variety Mangoes", renamed where the data comes
   in, so every page says the new name and compares like with like), and the search that forgives typos (find: other
   names, misspellings, typos; suggest.js and shelf.js use it). No styles. */
(() => {
  const photo = (n) => `assets/mangoes/m${String(n).padStart(2, '0')}.webp`

  // Every VMR mango comes from the family farm (the owner, change request 01, 25 Nov 2026). The product sheet shows
  // ORIGIN above the name; the cards show ORIGIN_SHORT before the ripeness ("Piler · Semi-ripe").
  const ORIGIN = 'Yellamanda Village, Piler, Andhra Pradesh'
  const ORIGIN_SHORT = 'Piler'

  // The API keys a variety by products.variety, which can't change once a batch holds it (mango-api admin/products.js).
  // A variety renamed for customers keeps its key there and is shown under its new name here.
  const SHOWN = { 'Mixed Box': 'Mixed Variety Mangoes' }
  const shown = (variety) => SHOWN[variety] || variety
  const keyOf = (name) => Object.keys(SHOWN).find((k) => SHOWN[k] === name) || name

  // [name, flavour, story, season [from, to] (months), sweetness 1-5, popularity,
  //  photos [ripe, semi, raw, ...gallery], best for, tags, occasions]. The origin is ORIGIN for every one.
  const ROWS = [
    ['Alphonso', 'Rich, creamy and fragrant with saffron-gold flesh',
      'Known locally as Hapus, Alphonso grows in the red laterite soil of the Konkan coast. Each fruit is hand-picked at maturity and ripened in hay, never with carbide.',
      [3, 6], 5, 100, [0, 7, 22, 32], 'Most loved for desserts', ['hapus', 'dessert', 'aamras', 'premium'], ['dessert']],
    ['Kesar', 'Saffron-sweet with a hint of honey',
      'Grown in the foothills of Gir, Kesar takes its name from its saffron colour. It is the classic choice for aamras and shrikhand.',
      [5, 7], 5, 92, [5, 12, 23, 33], 'The classic aamras mango', ['aamras', 'dessert', 'saffron', 'shrikhand'], ['dessert']],
    ['Banganapalli', 'Mild, sweet and fibreless with a firm bite',
      'Also called Benishan, Banganapalli has a GI tag and thin golden skin. Its fibreless flesh slices cleanly for salads and lunch boxes.',
      [3, 6], 4, 85, [16, 19, 24, 11], 'Slices clean, no fibre', ['benishan', 'slices', 'fibreless'], ['pickle']],
    ['Dasheri', 'Aromatic and honey-sweet, long and slender',
      'Dasheri traces back to the orchards of Malihabad. Its aroma fills a room, and it is best eaten whole, squeezed from the skin.',
      [5, 7], 4, 80, [4, 14, 25, 10], 'Fills the room with aroma', ['aromatic', 'lucknow'], ['dessert']],
    ['Langra', 'Tangy-sweet with green skin even when ripe',
      'Langra stays green outside when ripe. Its lemon-yellow flesh is juicy, with a gentle tang that balances the sweetness.',
      [6, 8], 4, 70, [29, 26, 26, 31], 'Green outside, gold inside', ['banarasi', 'green skin', 'tangy'], ['pickle']],
    ['Chausa', 'Very sweet, soft and juicy',
      'Chausa arrives late in the season. It is soft and very sweet, and best enjoyed chilled and sucked straight from the fruit.',
      [7, 8], 5, 68, [15, 21, 27, 9], 'Best enjoyed chilled', ['late season', 'juicy'], ['dessert', 'juice']],
    ['Totapuri', 'Tangy and firm with a parrot-beak tip',
      'Totapuri is named for its parrot-beak shape. Firm and tangy, it is the go-to mango for pickles, chutneys and pulp.',
      [5, 7], 2, 75, [22, 24, 28, 23], 'For the pickle jar', ['pickle', 'kairi', 'chutney', 'tangy', 'achar'], ['pickle']],
    ['Himsagar', 'Creamy, fibreless and very sweet',
      "Bengal's pride, Himsagar has a short season and a creamy texture loved for mishti doi and desserts.",
      [5, 6], 5, 78, [1, 34, 30, 20], "Bengal's creamy pride", ['bengal', 'dessert', 'fibreless'], ['dessert']],
    ['Neelam', 'Floral, mildly sweet with a long shelf life',
      'Neelam fruits late and keeps well. Its floral aroma makes it a favourite for smoothies and milkshakes.',
      [6, 8], 3, 60, [17, 28, 22, 13], 'Keeps well, blends well', ['floral', 'shake', 'smoothie'], ['juice']],
    ['Mallika', 'Honeyed and citrusy with deep orange flesh',
      'A cross of Neelam and Dasheri, Mallika carries the aroma of one and the sweetness of the other.',
      [5, 6], 4, 64, [3, 25, 23, 35], 'Honeyed and citrusy', ['hybrid', 'citrus'], ['dessert']],
    ['Amrapali', 'Intensely sweet with deep orange flesh',
      'Amrapali is a dwarf hybrid of Dasheri and Neelam, rich in carotene and very sweet.',
      [5, 7], 5, 66, [6, 38, 24, 8], 'Intensely sweet', ['hybrid', 'sweet'], ['dessert', 'juice']],
    ['Badami', 'Alphonso-like richness at a gentler price',
      'Called the Karnataka Alphonso, Badami shares the creamy texture of Hapus with an almond-shaped profile.',
      [3, 6], 4, 72, [2, 30, 25, 36], "Karnataka's Alphonso", ['karnataka alphonso', 'dessert'], ['dessert']],
    ['Raspuri', 'Juicy and sweet, made for pulp and juice',
      'Raspuri means full of juice. It is the mango Mysuru grows for pulp, juice and ice cream.',
      [4, 6], 4, 58, [18, 27, 26, 37], 'Juiciest pulp', ['juice', 'pulp', 'ice cream'], ['juice']],
    ['Imam Pasand', 'Large, fibreless and richly sweet',
      'Once reserved for royalty, Imam Pasand is a large, thin-skinned mango with fibreless flesh and a lingering finish.',
      [3, 6], 5, 74, [39, 9, 27, 34], 'Once a royal favourite', ['himayat', 'royal', 'premium'], ['dessert']],
    ['Malgova', 'Round, juicy and sweet with a soft texture',
      'Malgova is a round mango from Salem with soft, juicy flesh, a summer staple across Tamil Nadu.',
      [5, 7], 4, 62, [11, 15, 28, 33], 'Round, soft and juicy', ['salem', 'round'], ['juice']],
    ['Mixed Variety Mangoes', 'Four favourites in one box',
      "Can't pick one? Mixed Variety Mangoes packs a fixed assortment of four in-season favourites, each wrapped and labelled so you can taste them side by side.",
      [5, 7], 5, 90, [20, 21, 30, 12], 'Four favourites, one box', ['gift', 'assorted', 'sampler', 'mixed', 'combo', 'mixed box', 'mixed variety'], []],
  ]

  const varieties = ROWS.map(([name, flavour, story, season, sweetness, popularity, pics, bestFor, tags, occasions]) => ({
    name, region: ORIGIN_SHORT, origin: ORIGIN, flavour, story,
    season: { from: season[0], to: season[1] },
    sweetness, popularity, bestFor, tags, occasions,
    photos: { RIPE: photo(pics[0]), SEMI_RIPE: photo(pics[1]), RAW: photo(pics[2]) },
    gallery: [photo(pics[0]), photo(pics[1]), photo(pics[3])],
  }))

  const mixed = varieties.find((v) => v.name === 'Mixed Variety Mangoes')
  mixed.contents = ['Alphonso', 'Kesar', 'Banganapalli', 'Himsagar'].map((name) => ({ name, share: 'a quarter of the box' }))

  // ---- Search that forgives typos (suggest.js lists the mangoes as you type; shelf.js filters the shelf with it when
  // the words typed are not found as they are). Other names and spellings customers type for a variety, so old
  // wording ("mixed box") and common misspellings still find it.
  const ALIASES = {
    Alphonso: ['hapus', 'alfonso', 'alphanso', 'alphonzo', 'alfanso', 'rathgiri', 'ratnagiri', 'rathnagiri'],
    Banganapalli: ['banganapalle', 'benishan', 'banginapalli', 'banganpalli', 'bangalapalli'],
    Dasheri: ['dussehri', 'dasari', 'dasehri'],
    Langra: ['langda'],
    'Imam Pasand': ['himayath', 'himayat', 'himam pasand'],
    Malgova: ['malgoa', 'malgoba'],
    'Mixed Variety Mangoes': ['mix', 'mixed', 'mixed box', 'mixed variety', 'assorted', 'assorted box'],
  }
  // Words a search for a name leaves out: "mango", the box, and the ripeness (shelf.js reads that from the words itself).
  const STOP = new Set(['mango', 'mangoes', 'mangos', 'mangoe', 'aam', 'the', 'a', 'an', 'of', 'for', 'and', 'box', 'raw', 'ripe', 'semi', 'semiripe'])
  /** Lower case, letters and digits only, single spaces. */
  const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
  /** Edits from a to b (add, drop or change a letter, or swap two side by side); max + 1 as soon as it is more than max. */
  function edits(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1
    let before = null, prev = Array.from({ length: b.length + 1 }, (_, j) => j)
    for (let i = 1; i <= a.length; i++) {
      const row = [i]
      let low = i
      for (let j = 1; j <= b.length; j++) {
        let d = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, before[j - 2] + 1)
        row[j] = d
        if (d < low) low = d
      }
      if (low > max) return max + 1
      before = prev
      prev = row
    }
    return prev[b.length]
  }
  /** Typos allowed in what is typed: 2 from 5 letters, 1 at 4, none in shorter words. */
  const typos = (n) => (n >= 5 ? 2 : n === 4 ? 1 : 0)
  /** The fewest typos between the typed text and a word, or the start of it while it is still being typed; Infinity when too many. */
  function near(q, word) {
    const max = typos(q.replace(/ /g, '').length)
    if (!max) return Infinity
    let d = edits(q, word, max)
    if (word.length > q.length + 1) d = Math.min(d, edits(q, word.slice(0, q.length), max))
    return d <= max ? d : Infinity
  }
  /** What a variety's search finds besides its name: flavour, best for, search words and, for the mixed box, what is in it. */
  const aboutOf = (c) => [c.flavour, c.bestFor, ...(c.tags || []), ...(c.contents || []).map((x) => x.name)].filter(Boolean).join(' · ')

  /**
   * The mangoes a search finds, best first. `list`: the varieties on sale, [{ name, about }] (about: aboutOf).
   * Returns { items: [{ name, how, mark, word }], fixed } where `how` is
   *   'name'   the name, or one of its words, starts with what was typed (mark: [start, end] of that part of the name);
   *   'about'  a word in its flavour, best for or search words does (word: that word, e.g. "Alphonso-like");
   *   'alias'  another name or spelling for it (ALIASES: hapus, alfonso, mixed box…);
   *   'typo'   its name or another name is within the typos allowed (typos: alpfonso → Alphonso).
   * Read as typed first; only when that finds nothing are other names and typos tried, and then `fixed` is the name the
   * search was read as ("Showing results for Alphonso") and the items are what a search for that name finds.
   */
  function find(query, list) {
    const q = fold(query).split(' ').filter((w) => w && !STOP.has(w)).join(' ')
    if (!q) return { items: [], fixed: null }
    const literal = (text) => {
      const out = []
      for (const v of list) {
        const name = fold(v.name)
        if (name.startsWith(text)) { out.push({ name: v.name, how: 'name', rank: 0, mark: [0, text.length] }); continue }
        const at = name.indexOf(' ' + text)
        if (at >= 0) { out.push({ name: v.name, how: 'name', rank: 1, mark: [at + 1, at + 1 + text.length] }); continue }
        if (text.length < 3) continue
        const about = String(v.about || '')
        const m = about.match(new RegExp(`(?:^|[^a-z0-9])(${text.replace(/ /g, '[^a-z0-9]+')}[a-z0-9-]*)`, 'i'))
        // a search word that is another name for it (hapus) reads as its name
        if (m) out.push((ALIASES[v.name] || []).includes(fold(m[1])) ? { name: v.name, how: 'alias', rank: 2, mark: null } : { name: v.name, how: 'about', rank: 2, word: m[1] })
      }
      return out.sort((a, b) => a.rank - b.rank).map(({ rank, ...x }) => x)
    }
    const found = literal(q)
    if (found.length) return { items: found, fixed: null }
    // Nothing as typed: another name for one (exact, or its start from 3 letters), else the closest name within the typos allowed.
    let best = null
    for (const v of list) {
      const names = ALIASES[v.name] || []
      if (names.some((a) => a === q || (q.length >= 3 && a.startsWith(q)))) { best = { name: v.name, how: 'alias', d: -1 }; break }
      const name = fold(v.name)
      const d = Math.min(near(q, name), near(q, name.replace(/ /g, '')), ...name.split(' ').filter((w) => !STOP.has(w)).map((w) => near(q, w)), ...names.map((a) => near(q, a)))
      if (d < Infinity && (!best || d < best.d)) best = { name: v.name, how: 'typo', d }
    }
    if (!best) return { items: [], fixed: null }
    const again = literal(fold(best.name)).filter((x) => x.name !== best.name)
    return { items: [{ name: best.name, how: best.how, mark: null }, ...again], fixed: best.name }
  }

  window.MM_CATALOG = {
    varieties,

    // Per stage: when to use it and when to eat it (MangoKart), keyed by the API stage.
    ripeness: {
      RAW: { use: 'Firm and sour, for pickle and cooking', eatBy: 'Use within a week for pickle, chutney or panna' },
      SEMI_RIPE: { use: 'Keep a few days, eat through the week', eatBy: 'Ripens at room temperature in 1 to 4 days' },
      RIPE: { use: 'Ready to eat, slice or make aamras', eatBy: 'Eat within 2 to 3 days of delivery' },
    },

    occasions: [
      { id: 'all', label: 'Every mango' },
      { id: 'dessert', label: 'Dessert & aamras' },
      { id: 'pickle', label: 'Pickle & chutney' },
      { id: 'juice', label: 'Juice & shakes' },
    ],

    // Search words that point at a variety (and the stage it should open at).
    synonyms: [
      { terms: ['pickle', 'achar', 'achaar', 'kairi', 'chutney', 'sour'], variety: 'Totapuri', stage: 'RAW', reason: 'Best for pickle' },
      { terms: ['pickle', 'achar', 'kairi'], variety: 'Banganapalli', stage: 'RAW', reason: 'Firm raw slices' },
      { terms: ['dessert', 'sweet', 'aamras', 'shrikhand', 'premium'], variety: 'Alphonso', stage: 'SEMI_RIPE', reason: 'Most loved for desserts' },
      { terms: ['aamras', 'dessert'], variety: 'Kesar', stage: 'SEMI_RIPE', reason: 'Classic aamras mango' },
      { terms: ['hapus'], variety: 'Alphonso', stage: 'SEMI_RIPE', reason: 'Hapus is Alphonso' },
      { terms: ['juice', 'pulp', 'shake', 'smoothie'], variety: 'Raspuri', stage: 'SEMI_RIPE', reason: 'Juiciest pulp' },
      { terms: ['gift', 'assorted', 'sampler', 'mix', 'combo'], variety: 'Mixed Variety Mangoes', stage: null, reason: 'Four varieties in one box' },
      { terms: ['panna', 'green', 'raw'], variety: 'Totapuri', stage: 'RAW', reason: 'Tangy raw mango' },
      { terms: ['benishan'], variety: 'Banganapalli', stage: 'SEMI_RIPE', reason: 'Benishan is Banganapalli' },
      // other spellings customers use (the search suggestions offer these names: suggest.js)
      { terms: ['banginapalli', 'banganpalli', 'bangalapalli'], variety: 'Banganapalli', stage: 'SEMI_RIPE', reason: 'Also spelt Banganapalli' },
      { terms: ['himayath', 'himayat', 'himam pasand'], variety: 'Imam Pasand', stage: 'SEMI_RIPE', reason: 'Himayath is Imam Pasand' },
      { terms: ['rathgiri', 'ratnagiri', 'rathnagiri'], variety: 'Alphonso', stage: 'SEMI_RIPE', reason: 'Ratnagiri Alphonso' },
      { terms: ['dasari', 'dussehri', 'dasehri'], variety: 'Dasheri', stage: 'SEMI_RIPE', reason: 'Dasari is Dasheri' },
      { terms: ['malgoa', 'malgoba'], variety: 'Malgova', stage: 'SEMI_RIPE', reason: 'Also spelt Malgova' },
    ],

    trending: ['Alphonso', 'Raw mango for pickle', 'Kesar', 'Mixed Variety Mangoes', 'Dasheri', 'Mango for aamras'],

    origin: ORIGIN,
    originShort: ORIGIN_SHORT,
    shown,
    keyOf,
    aliases: ALIASES,
    find,
    aboutOf,
    typos,
  }

  // Where the API's data comes in: a variety renamed for customers (SHOWN) gets its new name in the boxes
  // (GET /v1/products), the pre-order weeks (GET /v1/preorders/weeks) and the boxes bought before (reorder.js),
  // so the shelf, the bag, the bulk list and the pre-order panel all say it and match each other. What goes back to
  // the API is sent by sku, or by keyOf (bulk.js, the farm visit's mango).
  // Favourites saved on this device by the old name follow the rename (app.js reads mm-favorites after this file).
  try {
    const favs = JSON.parse(localStorage.getItem('mm-favorites'))
    if (Array.isArray(favs) && favs.some((n) => SHOWN[n])) localStorage.setItem('mm-favorites', JSON.stringify([...new Set(favs.map(shown))]))
  } catch {}
  const MM = window.MM
  if (!MM) return
  const rename = (x) => (x && typeof x.variety === 'string' ? { ...x, variety: shown(x.variety) } : x)
  const renameAll = (list) => (Array.isArray(list) ? list.map(rename) : list)
  const { products, preorderWeeks, api } = MM
  if (products) MM.products = (...a) => products(...a).then((r) => (r && Array.isArray(r.items) ? { ...r, items: renameAll(r.items) } : r))
  if (preorderWeeks) MM.preorderWeeks = (...a) => preorderWeeks(...a).then((r) => (r ? { ...r, weeks: renameAll(r.weeks), varieties: renameAll(r.varieties), boxes: renameAll(r.boxes) } : r))
  if (api) MM.api = (path, ...a) => api(path, ...a).then((r) => (path === '/me/ordered-products' ? renameAll(r) : r))
})()
