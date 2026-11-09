/* The mango shelf: one card per variety the API sells.
   Content (story, origin, photos, search words) from catalog.js; boxes and prices from
   GET /v1/products (`skus`, app.js); stock per sku and stage from GET /v1/catalogue (`stock`,
   app.js) once a pincode is known. Loaded before app.js: top-level code here only declares,
   so app.js globals (cart, favorites, filter, skus, stock, toast, …) are used at call time. */

// The three ripeness stages, in the words of the glass design. `id` matches the filter rail.
const STAGES = [
  { id: 'raw', stage: 'Raw', apiStage: 'RAW', pos: '0%', care: 'Keep in a cool, ventilated place. Wash before preparing.' },
  { id: 'semi', stage: 'Semi-raw', apiStage: 'SEMI_RIPE', pos: '50%', care: 'Allow to ripen at room temperature, out of direct sunlight. Check daily.' },
  { id: 'ripe', stage: 'Ripe', apiStage: 'RIPE', pos: '100%', care: 'Refrigerate once ripe and enjoy soon. Wash before cutting.' },
]
const stageOf = (apiStage) => STAGES.find((s) => s.apiStage === apiStage) || STAGES[0]
const stageById = (id) => STAGES.find((s) => s.id === id)
const CATALOG = window.MM_CATALOG || { varieties: [], ripeness: {}, occasions: [], synonyms: [], trending: [] }
const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const STOP_WORDS = new Set(['mango', 'mangoes', 'for', 'the', 'a', 'an', 'and', 'of', 'box'])
const STAGE_WORDS = { raw: 'RAW', semi: 'SEMI_RIPE', 'semi-raw': 'SEMI_RIPE', 'semi-ripe': 'SEMI_RIPE', ripe: 'RIPE' }

let shelf = [] // [{ name, c: content, skus: [api product] }]
let occasion = 'all'
let sortBy = 'loved'
const cardStage = {} // variety → stage picked on its card
const cardBox = {} // variety → sku picked on its card
const hits = new Map() // variety → synonym hit for the current search
let searchStage = null // a stage word typed into search
let detail = null // the open product sheet: { name, stage, sku }

const boxText = (s) => `${String(s.boxSize).replace('kg', ' kg')} box`

function contentFor(name, list) {
  const known = CATALOG.varieties.find((v) => v.name.toLowerCase() === String(name).toLowerCase())
  const c = known ? { ...known } : {
    name, region: '', origin: '', flavour: list[0]?.description || '', story: list[0]?.description || '',
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
  return CATALOG.varieties.slice().sort((a, b) => b.name.length - a.name.length).find((v) => label.startsWith(v.name.toLowerCase())) || null
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

const soldOut = (v, stage) => stock !== null && v.skus.every((s) => qtyOf(s.sku, stage) === 0)
/** When every box is out on the chosen day: the first day one of them is back, or null. */
const nextFor = (v, stage) => v.skus.map((s) => nextOf(s.sku, stage)).filter(Boolean).sort()[0] || null

function stageFor(v) {
  if (filter !== 'all') return stageById(filter).apiStage
  if (searchStage) return searchStage
  if (cardStage[v.name]) return cardStage[v.name]
  const hit = hits.get(v.name)
  if (hit && hit.stage) return hit.stage
  if (stock) {
    const inStock = ['RIPE', 'SEMI_RIPE', 'RAW'].find((st) => v.skus.some((s) => qtyOf(s.sku, st) > 0))
    if (inStock) return inStock
    // Nothing on the chosen day: show the ripeness that is back soonest, so the card can offer that day.
    const soon = ['RAW', 'SEMI_RIPE', 'RIPE'].map((st) => [st, nextFor(v, st)]).filter((x) => x[1]).sort((a, b) => (a[1] < b[1] ? -1 : 1))[0]
    if (soon) return soon[0]
  }
  return 'RIPE'
}

function boxFor(v, stage, chosen = cardBox[v.name]) {
  if (chosen && v.skus.some((s) => s.sku === chosen) && (qtyOf(chosen, stage) !== 0 || (!v.skus.some((s) => qtyOf(s.sku, stage) > 0) && maxOn(chosen, stage) > 0))) return chosen
  const first = v.skus.find((s) => qtyOf(s.sku, stage) > 0) || (chosen && v.skus.find((s) => s.sku === chosen && maxOn(s.sku, stage) > 0)) || v.skus.find((s) => maxOn(s.sku, stage) > 0) || v.skus.find((s) => s.sku === chosen) || v.skus[0]
  return first.sku
}

/** The box choice as one card per size (3 kg / 5 kg) with a glass lens behind the chosen one:
    one tap picks a box. `scope` is 'card' (shelf) or 'detail' (product sheet). */
function boxCards(v, stage, selected, scope) {
  const i = Math.max(0, v.skus.findIndex((s) => s.sku === selected))
  return `<div class="box-cards" role="group" aria-label="${esc(v.name)} box size" style="--n:${v.skus.length};--i:${i}"><span class="box-lens" aria-hidden="true"></span>${v.skus.map((s) => {
    const out = qtyOf(s.sku, stage) === 0 && maxOn(s.sku, stage) === 0, on = s.sku === selected
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
    detail.sku = sku
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
  const what = esc(`${boxText(s)} of ${st.stage.toLowerCase()} ${v.name}`)
  const line = cart.find((x) => x.sku === sku && x.stage === stage)
  const key = `data-sku="${esc(sku)}" data-stage="${esc(stage)}" data-variety="${esc(v.name)}"`
  if (!line && (out || qtyOf(sku, stage) === 0)) {
    const next = nextOf(sku, stage) || (maxOn(sku, stage) > 0 ? nextFor(v, stage) : null)
    if (next) return `<button class="quick-add is-next" data-add="${esc(v.name)}" ${key} aria-label="${what}: delivered from ${esc(fmtDate(next))}. Add to bag">Add</button>`
    return `<button class="quick-add is-out" disabled aria-label="${what}: sold out for now">Sold out</button>`
  }
  if (!line) return `<button class="quick-add" data-add="${esc(v.name)}" aria-label="Add a ${what} to bag">Add</button>`
  return `<div class="card-stepper" role="group" aria-label="${what} in your bag"><button data-card-qty="-1" ${key} aria-label="Remove one ${what}">−</button><span aria-live="polite">${line.qty}</span><button data-card-qty="1" ${key} aria-label="Add one more ${what}">+</button></div>`
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
  const tag = out ? (next ? `Delivers ${fmtDate(next)}` : 'Sold out for now') : hit ? hit.reason : v.c.bestFor
  const name = esc(v.name)
  return `<article class="product-card${out && !next ? ' sold-out' : ''}" data-kind="${st.id}" data-variety="${name}"><div class="product-image">${photoButton(v, stage)}${tag ? `<span class="product-tag liquid">${esc(tag)}</span>` : ''}</div><div class="product-info"><div class="product-topline"><h3><button data-product="${name}">${name}</button></h3><button class="heart ${saved ? 'saved' : ''}" data-favorite="${name}" aria-label="Save ${name}" aria-pressed="${saved}">${icon('heart')}</button></div><p class="product-desc">${esc(v.c.flavour)}</p><div class="product-bottom"><div class="product-price">${priceHTML(s)}</div>${boxCards(v, stage, sku, 'card')}</div><div class="card-action" data-variety="${name}" data-sku="${esc(sku)}" data-stage="${esc(stage)}" data-out="${out ? 1 : 0}">${cardAction(v, sku, stage, out)}</div><div class="product-status">${icon('leaf')}<span>${v.c.region ? esc(v.c.region) + ' · ' : ''}${st.stage}</span></div></div></article>`
}

// ---- Which cards, in what order

function haystack(v) {
  return [v.name, v.c.region, v.c.origin, v.c.flavour, v.c.bestFor, ...(v.c.tags || [])].join(' ').toLowerCase()
}

function visibleShelf() {
  const q = $('#search').value.trim().toLowerCase()
  hits.clear()
  searchStage = null
  let list = occasion === 'all' ? shelf : shelf.filter((v) => (v.c.occasions || []).includes(occasion))
  if (q) {
    for (const syn of CATALOG.synonyms) {
      if (!hits.has(syn.variety) && syn.terms.some((t) => q.includes(t) || (q.length >= 3 && t.startsWith(q)))) hits.set(syn.variety, syn)
    }
    const words = q.split(/\s+/).filter((w) => !STOP_WORDS.has(w))
    const stageWord = words.find((w) => STAGE_WORDS[w])
    if (stageWord) searchStage = STAGE_WORDS[stageWord]
    const rest = words.filter((w) => !STAGE_WORDS[w])
    list = list.filter((v) => hits.has(v.name) || (rest.length ? rest.every((w) => haystack(v).includes(w)) : Boolean(stageWord)))
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
  $('#shelf-count').textContent = list.length === shelf.length ? `${shelf.length} ${shelf.length === 1 ? 'variety' : 'varieties'} · ` : `${list.length} of ${shelf.length} varieties · `
  if (!list.length) {
    $('#search-suggest').innerHTML = CATALOG.trending.map((t) => `<button class="occasion" data-trending="${esc(t)}">${esc(t)}</button>`).join('')
  }
  if (window.gsap && !reduced) gsap.fromTo('.product-card', { y: 12, opacity: 0.5 }, { y: 0, opacity: 1, duration: 0.45, stagger: 0.06, ease: 'power3.out', clearProps: 'transform,translate,rotate,scale,opacity' })
  window.Liquid?.scan(grid)
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

function renderOccasions() {
  $('#occasions').innerHTML = CATALOG.occasions.map((o) =>
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
  $$('[data-filter]').forEach((b) => {
    const active = b.dataset.filter === value
    b.classList.toggle('selected', active)
    b.setAttribute('aria-pressed', active)
  })
  positionPill()
  renderProducts()
}

function setOccasion(value) {
  occasion = value
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
  const match = cart.find((x) => x.sku === sku && x.stage === stage)
  if (match && match.qty >= 20) {
    toast('For larger quantities, use our bulk enquiry.')
    return
  }
  // Out on the chosen day is fine when a later day has it: the order moves to the first day the whole bag is ready.
  const why = bumpError(sku, stage, (match ? match.qty : 0) + 1)
  if (why) {
    toast(why)
    return
  }
  const before = bagDate()
  if (match) match.qty++
  else cart.push({ sku, stage, qty: 1, weight: kgOf(s) })
  const after = bagDate()
  updateCart()
  if (after && where.deliveryDate && after > where.deliveryDate && after !== before) toast(`Added. ${st.stage} ${v.name} is ready ${fmtDate(after)}, so this order will be delivered then.`)
  else toast(`${String(s.boxSize).replace('kg', ' kg')} of ${st.stage.toLowerCase()} ${v.name} added`)
  if (window.gsap && !reduced) gsap.fromTo('.bag-count', { scale: 1.5 }, { scale: 1, duration: 0.5, ease: 'elastic.out(1,.5)' })
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
  const never = stock !== null && maxOn(detail.sku, detail.stage) === 0, later = !never && qtyOf(detail.sku, detail.stage) === 0 ? nextOf(detail.sku, detail.stage) : null
  const main = detail.photo || (c.photos && c.photos[detail.stage])
  const gallery = [...new Set([c.photos && c.photos[detail.stage], ...(c.gallery || [])].filter(Boolean))].slice(0, 3)
  const sweet = c.sweetness ? `<span class="sweet-meter" role="img" aria-label="${c.sweetness} out of 5">${[1, 2, 3, 4, 5].map((n) => `<i class="${n <= c.sweetness ? 'on' : ''}"></i>`).join('')}</span>` : ''
  const facts = [
    c.season && ['Season', `${MONTHS[c.season.from]} to ${MONTHS[c.season.to]}`],
    sweet && ['Sweetness', sweet],
    c.bestFor && ['Best for', esc(c.bestFor)],
  ].filter(Boolean)
  $('#product-dialog').innerHTML = `<div class="product-detail"><div class="detail-media"><div class="detail-image${main ? ' photo' : ''}" ${main ? '' : `style="background-position:${st.pos} center"`} role="img" aria-label="${st.stage} ${esc(v.name)}">${main ? `<img id="detail-photo" src="${main}" alt="">` : ''}</div>${gallery.length > 1 ? `<div class="detail-thumbs">${gallery.map((src, i) => `<button data-detail-photo="${src}" aria-label="Photo ${i + 1} of ${gallery.length}" aria-current="${src === main}"><img src="${src}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}</div><div class="detail-info"><div class="detail-close"><button class="icon-button" data-close aria-label="Close product details">${icon('close')}</button></div>${c.origin ? `<span class="detail-origin">${icon('leaf')}${esc(c.origin)}</span>` : ''}<h2>${esc(v.name)}</h2><p>${esc(c.flavour)}. ${esc(c.story)}</p>${facts.length ? `<dl class="detail-facts">${facts.map(([k, val]) => `<div><dt>${k}</dt><dd>${val}</dd></div>`).join('')}</dl>` : ''}${c.contents ? `<ul class="detail-contents">${c.contents.map((x) => `<li>${icon('check')}${esc(x.name)} <small>· ${esc(x.share)}</small></li>`).join('')}</ul>` : ''}<div class="segmented glass detail-stages" role="group" aria-label="Choose ripeness" style="--i:${STAGES.findIndex((x) => x.apiStage === detail.stage)}"><span class="detail-lens" aria-hidden="true"></span>${STAGES.map((x) => {
    const on = x.apiStage === detail.stage, out = stock && soldOut(v, x.apiStage) && !nextFor(v, x.apiStage)
    return `<button class="${on ? 'selected' : ''}${out ? ' out' : ''}" data-detail-stage="${x.apiStage}" aria-pressed="${on}" ${out ? `aria-label="${x.stage}, sold out" title="Sold out for this day"` : ''}><span class="dot ${x.id}"></span>${x.stage}</button>`
  }).join('')}</div><p class="detail-stage-note">${esc(r.use || '')}. ${esc(r.eatBy || '')}.</p><div class="product-price" id="detail-price">${currency(s.price)}<small> / box</small></div><div class="field">Choose your box</div>${boxCards(v, detail.stage, detail.sku, 'detail')}<button class="button primary full" data-detail-add ${never ? 'disabled' : ''}>${never ? 'Sold out for now' : later ? `Add · delivers ${esc(fmtDate(later))} ${icon('bag')}` : `Add to bag ${icon('bag')}`}</button><p class="detail-care">${st.care}</p></div></div>`
  if (focus) $(focus, $('#product-dialog'))?.focus()
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
      const i = cart.findIndex((x) => x.sku === sku && x.stage === stage)
      if (i < 0) return
      if (--cart[i].qty <= 0) cart.splice(i, 1)
      updateCart()
    }
  }
  else if (b.dataset.product) productDetail(b.dataset.product)
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
  } else if (b.dataset.trending) {
    $('#search').value = b.dataset.trending
    renderProducts()
  } else if (b.dataset.guide) {
    closeDialogs()
    $('#search').value = ''
    setFilter(b.dataset.guide)
    location.hash = 'shop'
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
