/* The mango shelf: one card per variety the API sells.
   Content (story, origin, photos, search words) from catalog.js; boxes and prices from
   GET /v1/products (`skus`, app.js); stock per sku and stage from GET /v1/catalogue (`stock`,
   app.js) once a pincode is known. Loaded before app.js: top-level code here only declares,
   so app.js globals (cart, favorites, filter, skus, stock, toast, …) are used at call time.
   Before the season (app.js preSeason()) the shelf is the pre-order shop: each card has a "Pre-order" badge and button
   (no stock, sold-out or delivery-day words: there is no fruit yet), and the product sheet books a harvest week.
   The product sheet also shows "What buyers say" (approved reviews, fetched when the sheet opens; see showReviews). */

// The ripeness stages, in the words of the glass design. `id` matches the filter rail. Ripe is kept only so old
// bags and orders still read; the shop sells Raw and Semi-ripe (SOLD).
const STAGES = [
  { id: 'raw', stage: 'Raw', apiStage: 'RAW', pos: '0%', care: 'Keep in a cool, ventilated place. Wash before preparing.' },
  { id: 'semi', stage: 'Semi-ripe', apiStage: 'SEMI_RIPE', pos: '50%', care: 'Allow to ripen at room temperature, out of direct sunlight. Check daily.' },
  { id: 'ripe', stage: 'Ripe', apiStage: 'RIPE', pos: '100%', care: 'Refrigerate once ripe and enjoy soon. Wash before cutting.', hidden: true },
]
const SOLD = STAGES.filter((x) => !x.hidden)
const SOLD_API = SOLD.map((x) => x.apiStage)
const stageOf = (apiStage) => STAGES.find((s) => s.apiStage === apiStage) || STAGES[0]
const stageById = (id) => STAGES.find((s) => s.id === id)
const CATALOG = window.MM_CATALOG || { varieties: [], ripeness: {}, occasions: [], synonyms: [], trending: [] }
const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const STOP_WORDS = new Set(['mango', 'mangoes', 'for', 'the', 'a', 'an', 'and', 'of', 'box'])
const STAGE_WORDS = { raw: 'RAW', semi: 'SEMI_RIPE', 'semi-ripe': 'SEMI_RIPE', 'semi-ripe': 'SEMI_RIPE', ripe: 'SEMI_RIPE' }

let shelf = [] // [{ name, c: content, skus: [api product] }]
let occasion = 'all'
let sortBy = 'loved'
const cardStage = {} // variety → stage picked on its card
const cardBox = {} // variety → sku picked on its card
const hits = new Map() // variety → synonym hit for the current search
let searchStage = null // a stage word typed into search
let searchFix = null // { from, to }: the search read as another name or a typo ("Showing results for Alphonso"); catalog.js find
let searchExact = null // the words the customer asked to search as typed ("search instead for …")
let detail = null // the open product sheet: { name, stage, sku }

const boxText = (s) => `${String(s.boxSize).replace('kg', ' kg')} box`

function contentFor(name, list) {
  const want = String(CATALOG.shown ? CATALOG.shown(name) : name).toLowerCase()
  const known = CATALOG.varieties.find((v) => v.name.toLowerCase() === want)
  // Every VMR mango is grown at the farm in Piler (catalog.js ORIGIN), a variety the catalogue does not know too.
  const c = known ? { ...known } : {
    name, region: CATALOG.originShort || '', origin: CATALOG.origin || '', flavour: list[0]?.description || '', story: list[0]?.description || '',
    season: null, sweetness: null, popularity: 0, bestFor: '', tags: [], occasions: [], photos: null, gallery: [],
  }
  // A photo uploaded on the panel replaces the illustrative one for every stage.
  const uploaded = list.find((s) => s.photoUrl)?.photoUrl
  if (uploaded) {
    const src = ((window.MM_CONFIG || {}).apiUrl || '') + uploaded
    c.photos = { RAW: src, SEMI_RIPE: src, RIPE: src }
    c.gallery = [src, ...(c.gallery || []).slice(1)]
  }
  return c
}

/** Content for a past or current line (bag, checkout, orders) by sku or by product name. */
function contentForLine(sku, name) {
  const s = skuOf(sku)
  const onShelf = s && shelf.find((v) => v.name === s.variety)
  if (onShelf) return onShelf.c
  const label = String(s ? s.variety : name || '').toLowerCase()
  // a line from before a rename ("Mixed Box 5kg Box") still finds its variety by the old name (catalog.js keyOf)
  const names = (v) => [v.name, CATALOG.keyOf ? CATALOG.keyOf(v.name) : v.name].map((n) => n.toLowerCase())
  return CATALOG.varieties.slice().sort((a, b) => b.name.length - a.name.length).find((v) => names(v).some((n) => label.startsWith(n))) || null
}

function buildShelf() {
  const groups = new Map()
  for (const s of skus) {
    if (!groups.has(s.variety)) groups.set(s.variety, [])
    groups.get(s.variety).push(s)
  }
  shelf = [...groups].map(([name, list]) => ({ name, c: contentFor(name, list), skus: list.slice().sort((a, b) => kgOf(a) - kgOf(b)) }))
}

async function loadProducts() {
  try {
    const r = await MM.products()
    skus = (r.items || []).slice().sort((a, b) => a.variety.localeCompare(b.variety) || kgOf(a) - kgOf(b))
    buildShelf()
    renderProducts()
    updateCart()
  } catch {
    setTimeout(loadProducts, 5000)
  }
}

// ---- What a card shows

const soldOut = (v, stage) => !preSeason() && stock !== null && v.skus.every((s) => qtyOf(s.sku, stage) === 0)
/** Before the season: the pre-order weeks (app.js pre.weeks) for a box. */
const preWeeksOf = (sku) => pre.weeks.filter((w) => w.sku === sku)
/** When every box is out on the chosen day: the first day one of them is back, or null. */
const nextFor = (v, stage) => v.skus.map((s) => nextOf(s.sku, stage)).filter(Boolean).sort()[0] || null

function stageFor(v) {
  if (filter !== 'all') return stageById(filter).apiStage
  if (searchStage) return searchStage
  if (cardStage[v.name]) return cardStage[v.name]
  const hit = hits.get(v.name)
  if (hit && hit.stage) return hit.stage
  if (stock && !preSeason()) {
    const inStock = ['SEMI_RIPE', 'RAW'].find((st) => v.skus.some((s) => qtyOf(s.sku, st) > 0))
    if (inStock) return inStock
    // Nothing on the chosen day: show the ripeness that is back soonest, so the card can offer that day.
    const soon = SOLD_API.map((st) => [st, nextFor(v, st)]).filter((x) => x[1]).sort((a, b) => (a[1] < b[1] ? -1 : 1))[0]
    if (soon) return soon[0]
  }
  return 'SEMI_RIPE'
}

function boxFor(v, stage, chosen = cardBox[v.name]) {
  // Before the season: the chosen box, else the first with a harvest week open.
  if (preSeason()) return (chosen && v.skus.some((s) => s.sku === chosen) ? chosen : (v.skus.find((s) => preWeeksOf(s.sku).length) || v.skus[0]).sku)
  if (chosen && v.skus.some((s) => s.sku === chosen) && (qtyOf(chosen, stage) !== 0 || (!v.skus.some((s) => qtyOf(s.sku, stage) > 0) && maxOn(chosen, stage) > 0) || (maxOn(chosen, stage) === 0 && planOf(chosen)))) return chosen
  const first = v.skus.find((s) => qtyOf(s.sku, stage) > 0) || (chosen && v.skus.find((s) => s.sku === chosen && maxOn(s.sku, stage) > 0)) || v.skus.find((s) => maxOn(s.sku, stage) > 0) || v.skus.find((s) => s.sku === chosen) || v.skus[0]
  return first.sku
}

/** The box choice as one card per size (3 kg / 5 kg) with a glass lens behind the chosen one:
    one tap picks a box. `scope` is 'card' (shelf) or 'detail' (product sheet). */
function boxCards(v, stage, selected, scope) {
  const i = Math.max(0, v.skus.findIndex((s) => s.sku === selected))
  return `<div class="box-cards" role="group" aria-label="${esc(v.name)} box size" style="--n:${v.skus.length};--i:${i}"><span class="box-lens" aria-hidden="true"></span>${v.skus.map((s) => {
    const none = !preSeason() && qtyOf(s.sku, stage) === 0 && maxOn(s.sku, stage) === 0 && !canSource(s.sku, stage), ahead = none && planOf(s.sku), out = none && !ahead, on = s.sku === selected
    return `<button class="box-card" data-box="${esc(v.name)}" data-sku="${esc(s.sku)}" data-scope="${scope}" aria-pressed="${on}" ${out ? 'disabled' : ''}><strong>${esc(String(s.boxSize).replace('kg', ' kg'))}</strong><small>${out ? 'Sold out' : currency(s.price)}</small></button>`
  }).join('')}</div>`
}

/** Slide a lens (box cards, sheet ripeness rail) to item `i`, with the jelly stretch. */
function slideLens(group, lensSel, i) {
  const lens = $(lensSel, group)
  if (!lens) return
  const from = lens.offsetLeft
  group.style.setProperty('--i', i)
  window.Liquid?.flip(lens, from - lens.offsetLeft)
}

function pickBox(b) {
  const group = b.closest('.box-cards'), sku = b.dataset.sku, name = b.dataset.box
  const cards = $$('.box-card', group)
  cards.forEach((c) => c.setAttribute('aria-pressed', c === b))
  slideLens(group, '.box-lens', cards.indexOf(b))
  if (b.dataset.scope === 'detail') {
    const was = detail.sku
    detail.sku = sku
    // To or from a box fully booked this week: the notice and the button change with it.
    if (maxOn(sku, detail.stage) === 0 || maxOn(was, detail.stage) === 0) return renderDetail()
    $('#detail-price').innerHTML = `${currency(priceOf(sku))}<small> / box</small>`
    window.Liquid?.pop($('#detail-price'), 0.35)
    return
  }
  cardBox[name] = sku
  const card = b.closest('.product-card'), s = skuOf(sku)
  $('.product-price', card).innerHTML = priceHTML(s)
  const action = $('.card-action', card)
  action.dataset.sku = sku
  refreshActions(action)
  window.Liquid?.pop($('.product-price', card), 0.35)
}

function photoButton(v, stage) {
  const src = v.c.photos && v.c.photos[stage]
  const label = `View ${esc(v.name)} details`
  // Without a photo the card falls back to the design's stage sprite (by data-kind).
  return src
    ? `<button class="fruit-photo photo" data-product="${esc(v.name)}" aria-label="${label}"><img src="${src}" alt="" loading="lazy" decoding="async" width="720" height="720"></button>`
    : `<button class="fruit-photo" data-product="${esc(v.name)}" aria-label="${label}"></button>`
}

/** The card's price: bold, with the retail price struck through beside it when the API sends one (mrp). */
function priceHTML(s) {
  const was = Number(s.mrp || s.compareAtPrice || s.retailPrice) || 0
  return `${currency(s.price)}${was > s.price ? `<s class="price-was" aria-label="was ${currency(was)}">${currency(was)}</s>` : ''}<small>/ box</small>`
}

/** The card's buying control: "Add", or once this box and stage are in the bag a − qty + stepper. A box out on the
    chosen day but ready on a later one can still be added (the order then goes on the first day the whole bag is
    ready, app.js bagDate); "Sold out" only when no bookable day has it. */
function cardAction(v, sku, stage, out) {
  const s = skuOf(sku), st = stageOf(stage)
  if (!s) return ''
  if (preSeason()) return preCardAction(v, s, st)
  const what = esc(`${boxText(s)} of ${st.stage.toLowerCase()} ${v.name}`)
  const line = cart.find((x) => x.sku === sku && x.stage === stage && !x.gift)
  const key = `data-sku="${esc(sku)}" data-stage="${esc(stage)}" data-variety="${esc(v.name)}"`
  if (!line && (out || qtyOf(sku, stage) === 0)) {
    const next = nextOf(sku, stage) || (maxOn(sku, stage) > 0 ? nextFor(v, stage) : null)
    if (next) return `<button class="quick-add is-next" data-add="${esc(v.name)}" ${key} aria-label="${what}: earliest delivery ${esc(fmtDate(next))}. Add to bag">Add</button>${out ? '' : `<small class="quick-add-why is-next">${icon('info')}<span>Earliest delivery: ${esc(fmtDate(next))}</span></small>`}`
    // Backorders: no stock on any bookable day, still addable; it is sourced and delivered in lead–window days.
    if (canSource(sku, stage) && maxOn(sku, stage) === 0) return `<button class="quick-add is-later" data-add="${esc(v.name)}" ${key} aria-label="${what}: delivered in ${esc(boSpan())}. Add to bag">Add</button>`
    // Fully booked this week, with room in the plan: still addable, and checkout offers the days (app.js planOf).
    if (planOf(sku) && maxOn(sku, stage) === 0) return `<button class="quick-add is-later" data-add="${esc(v.name)}" ${key} aria-label="${what}: this week is fully booked, delivered ${esc(planOf(sku).words)}. Add to bag">Add</button><small class="quick-add-why is-next">${icon('clock')}<span>Fully booked this week. Delivered ${esc(planOf(sku).words)}</span></small>`
    return `<button class="quick-add is-out" disabled aria-label="${what}: sold out for now, not on any delivery day this week">${icon('close')}<span>Sold out</span></button><small class="quick-add-why">Not on any delivery day this week</small>`
  }
  if (!line) return `<button class="quick-add" data-add="${esc(v.name)}" aria-label="Add a ${what} to bag">Add</button>`
  return `<div class="card-stepper" role="group" aria-label="${what} in your bag"><button data-card-qty="-1" ${key} aria-label="Remove one ${what}">−</button><span aria-live="polite">${line.qty}</span><button data-card-qty="1" ${key} aria-label="Add one more ${what}"${line.qty >= 20 ? ' aria-disabled="true" title="20 boxes is the most per order"' : ''}>+</button></div>${line.qty >= 20 ? `<small class="quick-add-why is-next">${icon('info')}<span>20 max · bulk order for more</span></small>` : ''}`
}

/** Before the season: "Pre-order" (opens the product sheet's booking panel), or disabled with an icon and the reason. */
function preCardAction(v, s, st) {
  const what = esc(`${boxText(s)} of ${st.stage.toLowerCase()} ${v.name}`)
  const key = `data-sku="${esc(s.sku)}" data-stage="${esc(st.apiStage)}"`
  if (preSeason() === 'BEFORE') {
    const when = esc(fmtDate(season.preorderOpensOn))
    return `<button class="quick-add is-out is-pre" disabled aria-label="${what}: pre-orders open ${when}">${icon('info')}<span>Pre-orders open ${when}</span></button>`
  }
  if (!preWeeksOf(s.sku).length) return `<button class="quick-add is-out is-pre" disabled aria-label="${what}: no harvest weeks open yet">${icon('info')}<span>No weeks open yet</span></button>`
  // The box's own week (its variety's room, migration 078): the API's per-box nextWeek, else the last week it is offered.
  const own = ((pre.boxes || []).find((b) => b.sku === s.sku) || {}).nextWeek
  const week = (own && own.weekStart) || (preWeeksOf(s.sku).map((w) => String(w.weekStart)).sort().at(-1)) || null
  // The button says only "Pre-order" (one line at 360px); the week is a caption under it, already in the button's label.
  return `<button class="quick-add is-pre" data-pre-open="${esc(v.name)}" ${key} aria-label="Pre-order a ${what}${week ? `, delivered in the week of ${esc(fmtWeek(week))}` : ''}">${icon('sun')}<span>Pre-order</span></button>${week ? `<small class="card-pre-week" aria-hidden="true">${icon('calendar')}<span>Week of ${esc(fmtWeek(week))}</span></small>` : ''}`
}

/** Redraw the cards' Add/stepper controls from the bag (all, or one), keeping focus on the control that was used. */
function refreshActions(only) {
  const active = document.activeElement
  ;(only ? [only] : $$('.card-action')).forEach((el) => {
    const v = shelf.find((x) => x.name === el.dataset.variety)
    if (!v) return
    const had = el.contains(active), html = cardAction(v, el.dataset.sku, el.dataset.stage, el.dataset.out === '1')
    if (el.innerHTML === html) return
    el.innerHTML = html
    if (had) ($('[data-card-qty="1"]', el) || $('.quick-add', el))?.focus()
  })
}
window.addEventListener('mm:cart', () => refreshActions())

function cardHTML(v) {
  const stage = stageFor(v), st = stageOf(stage), sku = boxFor(v, stage), s = skuOf(sku)
  const out = soldOut(v, stage), saved = favorites.includes(v.name), hit = hits.get(v.name)
  const next = out ? nextFor(v, stage) : null
  // Backorders: nothing on any bookable day, but still sold (sourced for the customer).
  const later = out && !next && canSource(sku, stage) && maxOn(sku, stage) === 0
  // Fully booked this week: it can still come from the plan's next days.
  const ahead = out && !next && !later && maxOn(sku, stage) === 0 ? planOf(sku) : null
  const tag = out ? (next ? `Earliest delivery: ${fmtDate(next)}` : later ? `Delivered in ${boSpan()}` : ahead ? `Delivered ${ahead.words}` : 'Sold out for now') : hit ? hit.reason : v.c.bestFor
  const name = esc(v.name)
  // Before the season every card is a pre-order: the badge on the photo says so.
  const badge = preSeason() ? `<span class="product-tag pre-badge">${icon('sun')}Pre-order</span>` : tag ? `<span class="product-tag liquid${out ? ' is-stock' : ''}">${esc(tag)}</span>` : ''
  return `<article class="product-card${out && !next && !later && !ahead ? ' sold-out' : ''}${preSeason() ? ' is-pre' : ''}" data-kind="${st.id}" data-variety="${name}"><div class="product-image">${photoButton(v, stage)}${badge}${typeof roCardHTML === 'function' ? roCardHTML(v) : ''}</div><div class="product-info"><div class="product-topline"><h3><button data-product="${name}">${name}</button></h3><button class="heart ${saved ? 'saved' : ''}" data-favorite="${name}" aria-label="Save ${name}" aria-pressed="${saved}">${icon('heart')}</button></div>${cardRating(v)}<p class="product-desc">${esc(v.c.flavour)}</p><div class="product-bottom"><div class="product-price">${priceHTML(s)}</div>${boxCards(v, stage, sku, 'card')}</div><div class="card-action" data-variety="${name}" data-sku="${esc(sku)}" data-stage="${esc(stage)}" data-out="${out ? 1 : 0}">${cardAction(v, sku, stage, out)}</div><div class="product-status">${icon('leaf')}<span>${v.c.region ? esc(v.c.region) + ' · ' : ''}${st.stage}</span></div></div></article>`
}

// ---- Which cards, in what order

function haystack(v) {
  return [v.name, v.c.region, v.c.origin, v.c.flavour, v.c.bestFor, ...(v.c.tags || []), ...(v.c.contents || []).map((x) => x.name)].join(' ').toLowerCase()
}

function visibleShelf() {
  const q = $('#search').value.trim().toLowerCase()
  hits.clear()
  searchStage = null
  searchFix = null
  if (searchExact && searchExact !== q) searchExact = null
  let fixed = null
  let list = occasion === 'all' ? shelf : shelf.filter((v) => (v.c.occasions || []).includes(occasion))
  if (q) {
    for (const syn of CATALOG.synonyms) {
      if (!hits.has(syn.variety) && syn.terms.some((t) => q.includes(t) || (q.length >= 3 && t.startsWith(q)))) hits.set(syn.variety, syn)
    }
    const words = q.split(/\s+/).filter((w) => !STOP_WORDS.has(w))
    const stageWord = words.find((w) => STAGE_WORDS[w])
    if (stageWord) searchStage = STAGE_WORDS[stageWord]
    const rest = words.filter((w) => !STAGE_WORDS[w])
    const base = list
    list = list.filter((v) => hits.has(v.name) || (rest.length ? rest.every((w) => haystack(v).includes(w)) : Boolean(stageWord)))
    // Nothing as typed: read it as another name or a typo (catalog.js find: "alpfonso" is Alphonso) and show what that
    // finds, with a line saying so, unless the customer asked to search the words as typed.
    if (!list.length && rest.length && searchExact !== q && CATALOG.find) {
      const r = CATALOG.find(rest.join(' '), base.map((v) => ({ name: v.name, about: CATALOG.aboutOf(v.c) })))
      if (r.fixed) {
        fixed = r.items.map((x) => x.name)
        list = base.filter((v) => fixed.includes(v.name))
        searchFix = { from: $('#search').value.trim(), to: r.fixed }
      }
    }
  }
  const price = (v) => skuOf(boxFor(v, stageFor(v))).price
  const order = {
    loved: (a, b) => b.c.popularity - a.c.popularity,
    sweet: (a, b) => (b.c.sweetness || 0) - (a.c.sweetness || 0) || b.c.popularity - a.c.popularity,
    'price-asc': (a, b) => price(a) - price(b),
    'price-desc': (a, b) => price(b) - price(a),
  }[sortBy]
  // Search hits first (in the synonyms' order), sold-out cards last, then the chosen order.
  const rank = [...hits.keys()]
  const hitRank = (v) => (hits.has(v.name) ? rank.indexOf(v.name) : rank.length)
  return list.slice().sort((a, b) =>
    (fixed ? fixed.indexOf(a.name) - fixed.indexOf(b.name) : 0) ||
    hitRank(a) - hitRank(b) ||
    Number(soldOut(a, stageFor(a))) - Number(soldOut(b, stageFor(b))) ||
    order(a, b))
}

/** Placeholder cards (the real card's size) while GET /v1/products is on its way; index.html starts with six. */
const skeletonCards = (n) => '<div class="product-card is-skeleton" aria-hidden="true"><div class="product-image"><span class="fruit-photo"></span></div><div class="product-info"><span class="sk-line sk-title"></span><span class="sk-line"></span><span class="sk-line sk-short"></span><span class="sk-block"></span></div></div>'.repeat(n)

// A card photo that has arrived stops its shimmer (style.css .fruit-photo.photo:not(.is-loaded)).
document.addEventListener('load', (e) => {
  const t = e.target
  if (t instanceof HTMLImageElement && t.parentElement && t.parentElement.classList.contains('fruit-photo')) t.parentElement.classList.add('is-loaded')
}, true)
document.addEventListener('error', (e) => {
  const t = e.target
  if (t instanceof HTMLImageElement && t.parentElement && t.parentElement.classList.contains('fruit-photo')) t.parentElement.classList.add('is-loaded')
}, true)

function renderProducts() {
  const grid = $('#products')
  if (!skus.length) {
    if (!grid.querySelector('.is-skeleton')) grid.innerHTML = skeletonCards(6)
    grid.setAttribute('aria-busy', 'true')
    $('#no-results').hidden = true
    return
  }
  grid.removeAttribute('aria-busy')
  if (!shelf.length) buildShelf()
  const list = visibleShelf()
  grid.innerHTML = list.map(cardHTML).join('')
  $('#no-results').hidden = list.length > 0
  searchFixLine(grid)
  $('#shelf-count').textContent = list.length === shelf.length ? `${shelf.length} ${shelf.length === 1 ? 'variety' : 'varieties'} · ` : `${list.length} of ${shelf.length} varieties · `
  if (!list.length) {
    $('#search-suggest').innerHTML = CATALOG.trending.map((t) => `<button class="occasion" data-trending="${esc(t)}">${esc(t)}</button>`).join('')
  }
  if (window.gsap && !reduced) gsap.fromTo('.product-card', { y: 12, opacity: 0.5 }, { y: 0, opacity: 1, duration: 0.45, stagger: 0.06, ease: 'power3.out', clearProps: 'transform,translate,rotate,scale,opacity' })
  window.Liquid?.scan(grid)
}

/** Over the shelf while a search was read as another name: "Showing results for Alphonso · search instead for ‘alpfonso’". */
function searchFixLine(grid) {
  let line = $('#search-fix')
  if (!line && !searchFix) return
  if (!line) {
    line = document.createElement('p')
    line.id = 'search-fix'
    line.className = 'search-names-fix is-shelf'
    line.setAttribute('aria-live', 'polite')
    grid.before(line)
  }
  line.hidden = !searchFix
  line.innerHTML = searchFix ? `<span>Showing results for <strong>${esc(searchFix.to)}</strong></span> <span aria-hidden="true">·</span> <button type="button" class="search-names-exact" data-search-exact>search instead for ‘${esc(searchFix.from)}’</button>` : ''
}

/** Re-render one card in place (stage or box change) and keep focus on the control used. */
function rerenderCard(name, focus) {
  const v = shelf.find((x) => x.name === name)
  const el = $$('.product-card').find((a) => a.dataset.variety === name)
  if (!v || !el) return
  el.outerHTML = cardHTML(v)
  const fresh = $$('.product-card').find((a) => a.dataset.variety === name)
  if (!fresh) return
  if (focus) $(focus, fresh)?.focus()
  window.Liquid?.scan(fresh)
}

/** The occasion chips for the ripeness on show. Pickle and chutney are made from raw fruit only, so that chip is not
    offered under Semi-ripe. */
const occasionsShown = () => CATALOG.occasions.filter((o) => !(filter === 'semi' && o.id === 'pickle'))

function renderOccasions() {
  $('#occasions').innerHTML = occasionsShown().map((o) =>
    `<button class="occasion${o.id === occasion ? ' selected' : ''}" data-occasion="${o.id}" aria-pressed="${o.id === occasion}">${esc(o.label)}</button>`).join('')
}

/** The ripeness rail's green pill: jumps to the chosen stage, then liquid.js springs it over
    from where it was (stretching as it travels, wobbling as it lands). */
function positionPill(animate = true) {
  const b = $('.segmented .selected'), pill = $('.selection-pill')
  if (!b) return
  const from = pill.offsetLeft
  pill.style.left = b.offsetLeft + 'px'
  pill.style.width = b.offsetWidth + 'px'
  if (animate) window.Liquid?.flip(pill, from - b.offsetLeft)
}

function setFilter(value) {
  filter = value
  if (!occasionsShown().some((o) => o.id === occasion)) occasion = 'all' // a chip that is not offered here cannot stay chosen
  renderOccasions()
  $$('[data-filter]').forEach((b) => {
    const active = b.dataset.filter === value
    b.classList.toggle('selected', active)
    b.setAttribute('aria-pressed', active)
  })
  positionPill()
  renderProducts()
}

function setOccasion(value) {
  // An occasion the shop no longer offers (the old 'gifting' chip, say) falls back to every mango.
  occasion = occasionsShown().some((o) => o.id === value) ? value : 'all'
  renderOccasions()
  renderProducts()
}

// ---- Bag

function add(name, sku, stage) {
  const v = shelf.find((x) => x.name === name)
  if (!v) return
  stage = stage || stageFor(v)
  sku = sku || boxFor(v, stage)
  const s = skuOf(sku), st = stageOf(stage)
  if (!s) return
  const match = cart.find((x) => x.sku === sku && x.stage === stage && !x.gift)
  if (match && match.qty >= 20) {
    toast('For larger quantities, place a bulk order.')
    return
  }
  // Out on the chosen day is fine when a later day has it: the order moves to the first day the whole bag is ready.
  const why = bumpError(sku, stage, (match ? match.qty : 0) + 1)
  if (why) {
    toast(why)
    return
  }
  if (match) match.qty++
  else cart.push({ sku, stage, qty: 1, weight: kgOf(s) })
  // Gift lines (gift-bag.js) are their own delivery: only your own boxes move your day.
  const mine = cart.filter((x) => !x.gift), after = bagDate(mine), was = where.deliveryDate, gone = was ? bagBlockers(was, mine) : []
  updateCart()
  // The order goes on the first day every box can come (app.js moveBagDate); the bag can offer the old day back.
  const moved = after && was && after !== was ? moveBagDate(after) : null
  if (!after && bagPlan(mine)) toast(`Added. ${planFull(planBox(sku, stage))} It can be delivered ${bagPlan(mine).offer.words}: choose a day at checkout.`)
  else if (!match && isBackorder(cart[cart.length - 1]) && after) toast(`Added. ${st.stage} ${v.name} is being sourced for you, so this order will be delivered ${fmtDate(after)}${after === backorderDate() ? ` (in ${boSpan()})` : ''}.`)
  else if (moved) toast(`Added. ${movedLine(moved, after, gone)}`)
  else toast(`${String(s.boxSize).replace('kg', ' kg')} of ${st.stage.toLowerCase()} ${v.name} added`)
  // fly.js takes the pop when its flight (or, under reduced motion, its light) follows this add.
  if (window.gsap && !reduced && !(window.MMFly && MMFly.took)) gsap.fromTo('.bag-count', { scale: 1.5 }, { scale: 1, duration: 0.5, ease: 'elastic.out(1,.5)' })
}

/** Photo for a bag, checkout or order row. */
function thumb(sku, apiStage, name) {
  const st = stageOf(apiStage), c = contentForLine(sku, name)
  const src = c && c.photos && c.photos[apiStage]
  return src
    ? `<div class="cart-thumb photo" role="img" aria-label="${st.stage} ${esc(c.name)}"><img src="${src}" alt="" loading="lazy"></div>`
    : `<div class="cart-thumb" style="background-position:${st.pos} center" role="img" aria-label="${st.stage} mangoes"></div>`
}

// ---- Product sheet

function productDetail(name) {
  const v = shelf.find((x) => x.name === name)
  if (!v) return
  const stage = stageFor(v)
  detail = { name, stage, sku: boxFor(v, stage), photo: null }
  renderDetail()
  openDialog('#product-dialog')
}

function renderDetail(focus) {
  const v = shelf.find((x) => x.name === detail.name)
  if (!v) return
  const c = v.c, st = stageOf(detail.stage), s = skuOf(detail.sku), r = CATALOG.ripeness[detail.stage] || {}
  // Out on the chosen day but ready later: still addable, and the button says the day.
  const sourced = stock !== null && maxOn(detail.sku, detail.stage) === 0 && canSource(detail.sku, detail.stage)
  // Fully booked this week, with room in the plan: added, and a day is chosen at checkout.
  const ahead = stock !== null && maxOn(detail.sku, detail.stage) === 0 && !sourced ? planOf(detail.sku) : null
  const never = stock !== null && maxOn(detail.sku, detail.stage) === 0 && !sourced && !ahead, later = !never && qtyOf(detail.sku, detail.stage) === 0 ? nextOf(detail.sku, detail.stage) : null
  // When it would come, under the button rather than in it, so "Add to bag" stays one line at 360px.
  const when = never ? '' : ahead ? `Delivered ${ahead.words}` : sourced ? `Delivered in ${boSpan()}` : later ? `Earliest delivery: ${fmtDate(later)}` : ''
  const main = detail.photo || (c.photos && c.photos[detail.stage])
  const gallery = [...new Set([c.photos && c.photos[detail.stage], ...(c.gallery || [])].filter(Boolean))].slice(0, 3)
  const sweet = c.sweetness ? `<span class="sweet-meter" role="img" aria-label="${c.sweetness} out of 5">${[1, 2, 3, 4, 5].map((n) => `<i class="${n <= c.sweetness ? 'on' : ''}"></i>`).join('')}</span>` : ''
  const facts = [
    c.season && ['Season', `${MONTHS[c.season.from]} to ${MONTHS[c.season.to]}`],
    sweet && ['Sweetness', sweet],
    c.bestFor && ['Best for', esc(c.bestFor)],
  ].filter(Boolean)
  const preMode = preSeason()
  $('#product-dialog').innerHTML = `<div class="product-detail${preMode ? ' is-pre' : ''}"><div class="detail-media"><div class="detail-image${main ? ' photo' : ''}" ${main ? '' : `style="background-position:${st.pos} center"`} role="img" aria-label="${st.stage} ${esc(v.name)}">${main ? `<img id="detail-photo" src="${main}" alt="">` : ''}</div>${gallery.length > 1 ? `<div class="detail-thumbs">${gallery.map((src, i) => `<button data-detail-photo="${src}" aria-label="Photo ${i + 1} of ${gallery.length}" aria-current="${src === main}"><img src="${src}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}</div><div class="detail-info"><div class="detail-close"><button class="icon-button" data-close aria-label="Close product details">${icon('close')}</button></div>${c.origin ? `<span class="detail-origin">${icon('leaf')}${esc(c.origin)}</span>` : ''}<h2>${esc(v.name)}</h2>${typeof roDetailHTML === 'function' ? roDetailHTML(v) : ''}<p>${esc(c.flavour)}. ${esc(c.story)}</p>${facts.length ? `<dl class="detail-facts">${facts.map(([k, val]) => `<div><dt>${k}</dt><dd>${val}</dd></div>`).join('')}</dl>` : ''}${c.contents ? `<ul class="detail-contents">${c.contents.map((x) => `<li>${icon('check')}${esc(x.name)} <small>· ${esc(x.share)}</small></li>`).join('')}</ul>` : ''}${preMode ? `<section id="pre-box" class="detail-pre" aria-label="Pre-order ${esc(v.name)}"></section><p class="detail-care">${st.care}</p></div></div>` : `<div class="segmented glass detail-stages" role="group" aria-label="Choose ripeness" style="--i:${SOLD.findIndex((x) => x.apiStage === detail.stage)};--n:${SOLD.length}"><span class="detail-lens" aria-hidden="true"></span>${SOLD.map((x) => {
    const on = x.apiStage === detail.stage, out = stock && soldOut(v, x.apiStage) && !nextFor(v, x.apiStage) && !v.skus.some((s) => canSource(s.sku, x.apiStage) || planOf(s.sku))
    return `<button class="${on ? 'selected' : ''}${out ? ' out' : ''}" data-detail-stage="${x.apiStage}" aria-pressed="${on}" ${out ? `aria-label="${x.stage}, sold out" title="Sold out for this day"` : ''}><span class="dot ${x.id}"></span>${x.stage}</button>`
  }).join('')}</div><p class="detail-stage-note">${esc(r.use || '')}. ${esc(r.eatBy || '')}.</p><div class="product-price" id="detail-price">${currency(s.price)}<small> / box</small></div><div class="field">Choose your box</div>${boxCards(v, detail.stage, detail.sku, 'detail')}${ahead ? `<div class="bag-moved co-moved is-plan" role="status"><span class="bag-moved-icon" aria-hidden="true">${icon('clock')}</span><p><strong>${esc(planFull(planBox(detail.sku, detail.stage)))}</strong> It can be delivered ${esc(ahead.words)}: choose a day at checkout.</p></div>` : ''}<button class="button primary full" data-detail-add ${never ? 'disabled' : ''}${when ? ' aria-describedby="detail-add-when"' : ''}>${never ? `${icon('close')} Sold out for now` : `${icon('bag')} Add to bag`}</button>${when ? `<p class="detail-add-when" id="detail-add-when">${icon('clock')}<span>${esc(when)}</span></p>` : ''}<p class="detail-care">${st.care}</p></div></div>`}`
  showReviews(v)
  if (preMode) preDetail(v.name, detail.sku, detail.stage)
  if (focus) $(focus, $('#product-dialog'))?.focus()
}

// ---- What buyers say: approved reviews of the variety, in the product sheet (GET /v1/products/:sku/reviews, public,
// mango-api review-routes.js; a variety's boxes share one list). Fetched once per variety, when its sheet first opens,
// and kept for the visit (the sheet redraws on every ripeness or box change); shown only when there is at least one.
// "Show more" fetches the next page by its cursor. Styles: style.css "What buyers say".
const REVIEWS_FIRST = 3, REVIEWS_MORE = 6
const reviewsOf = {} // variety → { summary, items, next, busy, failed } once asked
const reviewer = (n) => (!n || n === 'Anonymous' || n === 'Verified buyer' ? 'A buyer' : n)
const reviewDate = (d) => { const t = new Date(d); return isNaN(t) ? '' : t.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) }
/** Five stars filled to `n` (0 to 5, decimals allowed); screen readers hear `label`. */
const starsHTML = (n, label) => `<span class="stars" style="--fill:${Math.max(0, Math.min(5, Number(n) || 0)) * 20}%" role="img" aria-label="${esc(label)}">★★★★★</span>`
const reviewPhoto = (url, w) => `${(window.MM_CONFIG || {}).apiUrl || ''}${url}?w=${w}`

function reviewItemHTML(r) {
  const name = esc(reviewer(r.displayName)), when = reviewDate(r.createdAt)
  const photos = (r.photos || []).slice(0, 4).map((ph) => `<a href="${esc(reviewPhoto(ph.url, 960))}" target="_blank" rel="noopener"><img src="${esc(reviewPhoto(ph.url, 160))}" alt="Photo from ${name}" loading="lazy" width="64" height="64"></a>`).join('')
  return `<li class="review-item"><div class="review-head">${starsHTML(r.rating, `${r.rating} out of 5 stars`)}<strong>${name}</strong>${when ? `<time datetime="${esc(istDateOf(r.createdAt))}">${esc(when)}</time>` : ''}</div>${r.comment ? `<p>${esc(r.comment)}</p>` : ''}${photos ? `<div class="review-photos">${photos}</div>` : ''}${r.reply && r.reply.body ? `<p class="review-reply"><strong>VMR Mangoes:</strong> ${esc(r.reply.body)}</p>` : ''}</li>`
}

function reviewsHTML(name) {
  const r = reviewsOf[name], sum = r && r.summary
  if (!sum || !(sum.count > 0) || !r.items.length) return ''
  const avg = Number(sum.average).toFixed(1), count = `${sum.count} ${sum.count === 1 ? 'review' : 'reviews'}`
  return `<section class="detail-reviews" id="detail-reviews" aria-labelledby="detail-reviews-h"><h3 id="detail-reviews-h">What buyers say</h3><p class="reviews-summary">${starsHTML(sum.average, `Rated ${avg} out of 5`)}<strong>${avg}</strong><span>from ${count}</span></p><ul class="review-list">${r.items.map(reviewItemHTML).join('')}</ul>${r.next ? `<button class="button secondary reviews-more" data-reviews-more ${r.busy ? 'disabled' : ''}>${r.busy ? 'Loading…' : 'Show more reviews'}</button>` : ''}</section>`
}

/** Draws the sheet's reviews from what is known, and asks for them the first time this variety's sheet opens. */
function showReviews(v) {
  const info = $('#product-dialog .detail-info')
  if (!info) return
  $('#detail-reviews')?.remove()
  info.insertAdjacentHTML('beforeend', reviewsHTML(v.name))
  const known = reviewsOf[v.name]
  if ((known && !known.failed) || !v.skus.length || !window.MM || !MM.productReviews) return
  const mine = reviewsOf[v.name] = { summary: null, items: [], next: null, busy: false, failed: false }
  MM.productReviews(v.skus[0].sku, { limit: REVIEWS_FIRST }).then((r) => {
    Object.assign(mine, { summary: r.summary || null, items: r.items || [], next: r.nextCursor || null })
    if (detail && detail.name === v.name && $('#product-dialog').open) showReviews(v)
  }, () => { mine.failed = true }) // no section on a failure; the next opening asks again
}

async function moreReviews() {
  const v = detail && shelf.find((x) => x.name === detail.name), mine = v && reviewsOf[v.name]
  if (!mine || !mine.next || mine.busy) return
  mine.busy = true
  showReviews(v)
  const from = mine.items.length
  try {
    const r = await MM.productReviews(v.skus[0].sku, { cursor: mine.next, limit: REVIEWS_MORE })
    mine.items = [...mine.items, ...(r.items || [])]
    mine.next = r.nextCursor || null
    if (r.summary) mine.summary = r.summary
  } catch (e) {
    toast(e.message)
  }
  mine.busy = false
  if (detail.name !== v.name || !$('#product-dialog').open) return
  showReviews(v)
  // Keep the place: the first new review takes focus (the button again when nothing came).
  const items = $$('#detail-reviews .review-item')
  if (items[from]) { items[from].tabIndex = -1; items[from].focus() } else $('[data-reviews-more]')?.focus()
}

/** The card's "★ 4.6 (23)", only when GET /v1/products sends a rating summary on its boxes (`rating: { average, count }`,
    the variety's). It does not today, so nothing shows; the card never asks for reviews itself. */
function cardRating(v) {
  const r = (v.skus.find((s) => s.rating && s.rating.count > 0) || {}).rating
  if (!r) return ''
  const avg = Number(r.average).toFixed(1)
  return `<p class="card-rating" role="img" aria-label="Rated ${avg} out of 5 from ${r.count} ${r.count === 1 ? 'review' : 'reviews'}"><span aria-hidden="true">★</span> ${avg} <small>(${r.count})</small></p>`
}

// ---- Events (catalogue controls only; the rest is in app.js)

document.addEventListener('click', (e) => {
  const b = e.target.closest('button')
  if (!b) return
  if (b.dataset.filter) setFilter(b.dataset.filter)
  else if (b.dataset.occasion) setOccasion(b.dataset.occasion)
  else if (b.dataset.add) add(b.dataset.add, b.dataset.sku, b.dataset.stage)
  else if (b.dataset.cardQty) {
    const { sku, stage, variety } = b.dataset
    if (b.dataset.cardQty === '1') add(variety, sku, stage)
    else {
      const i = cart.findIndex((x) => x.sku === sku && x.stage === stage && !x.gift)
      if (i < 0) return
      if (--cart[i].qty <= 0) cart.splice(i, 1)
      updateCart()
    }
  }
  else if (b.dataset.product) productDetail(b.dataset.product)
  else if (b.hasAttribute('data-reviews-more')) moreReviews()
  else if (b.dataset.favorite) {
    const id = b.dataset.favorite
    favorites = favorites.includes(id) ? favorites.filter((x) => x !== id) : [...favorites, id]
    save('mm-favorites', favorites)
    b.classList.toggle('saved', favorites.includes(id))
    b.setAttribute('aria-pressed', favorites.includes(id))
    toast(favorites.includes(id) ? 'Saved to your favourites on this device' : 'Removed from favourites')
  } else if (b.dataset.detailStage) {
    const v = shelf.find((x) => x.name === detail.name)
    detail.stage = b.dataset.detailStage
    detail.sku = boxFor(v, detail.stage, detail.sku)
    detail.photo = null
    const from = $('.detail-lens')?.offsetLeft ?? 0
    renderDetail(`[data-detail-stage="${detail.stage}"]`)
    const lens = $('.detail-lens')
    if (lens) window.Liquid?.flip(lens, from - lens.offsetLeft)
  } else if (b.dataset.box) {
    pickBox(b)
  } else if (b.dataset.detailPhoto) {
    detail.photo = b.dataset.detailPhoto
    $('#detail-photo').src = detail.photo
    $$('[data-detail-photo]').forEach((t) => t.setAttribute('aria-current', t === b))
  } else if (b.hasAttribute('data-detail-add')) {
    if (filter === 'all') cardStage[detail.name] = detail.stage
    cardBox[detail.name] = detail.sku
    add(detail.name, detail.sku, detail.stage)
    closeDialogs()
    rerenderCard(detail.name)
  } else if (b.hasAttribute('data-search-exact')) {
    searchExact = $('#search').value.trim().toLowerCase()
    renderProducts()
    window.dispatchEvent(new Event('mm:search-exact'))
  } else if (b.dataset.trending) {
    $('#search').value = b.dataset.trending
    renderProducts()
  } else if (b.id === 'clear-search') {
    $('#search').value = ''
    occasion = 'all'
    renderOccasions()
    setFilter('all')
  }
})

document.addEventListener('change', (e) => {
  const t = e.target
  if (t.id === 'sort') {
    sortBy = t.value
    renderProducts()
  }
})
