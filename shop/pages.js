/* Pages: /cart, /checkout, /orders, /orders/:id (and the API's /order/:id), /account, /bulk, and the four policy pages
   (/privacy, /terms, /refund, /shipping) with the footer's business small print (bizInfo, footerLegal, legalView).
   (The Partner Network pages are in partner.js, the Farm Experience pages in farm.js and /legacy in legacy.js; all add to PAGES.)
   There is no pre-order page any more: before the season the home page is the pre-order shop (shelf.js), and the
   old /preorder and /#preorder land on / (shop/vercel.json redirects /preorder; route() does the same here).
   They replace the home page (main#home) with #page-view, keep the header, footer and dock, and
   use the History API, so back and forward work and the addresses can be shared or reloaded
   (shop/vercel.json serves index.html for them, or for a page in routes.js its own copy in _routes/; scripts/serve-shop.mjs
   serves index.html). Checkout and orders
   reuse app.js's flows, which draw wherever `view` points; the profile page is here.
   The home page's old sections (#bulk, #partner) are pages now: those anchors open them (anchorPage).
   Every route change fires `mm:route` on window (dock.js and the desktop nav mark the current tab from it).
   Loaded before app.js, so top-level code only declares and listens. */

const PAGES = [
  [/^\/cart\/?$/, () => renderCartPage()],
  [/^\/checkout\/?$/, () => checkout()],
  // Every kind of order, the filters and the Grow with us tab (accountOrdersView below; app.js ordersView is the sheet's list).
  [/^\/orders\/?$/, () => signedInThen('Your orders', accountOrdersView)],
  [/^\/orders?\/([^/]+)\/?$/, (m) => signedInThen('Your order', () => trackView(decodeURIComponent(m[1])))],
  // An old "/account?enquiry=<id>" link (a bulk quote) opens the Bulk orders list, where quotes are now.
  [/^\/account\/?$/, () => new URLSearchParams(location.search).get('enquiry') ? go(`/orders?tab=bulk&enquiry=${encodeURIComponent(new URLSearchParams(location.search).get('enquiry'))}`, { replace: true }) : signedInThen('Your profile', accountView)],
  [/^\/login\/?$/, () => loginView()],
  // /bulk is the order tab; /bulk/enquiry and /bulk/farm-visit the other two (bulk.js draws the tabs and the order flow).
  [/^\/bulk(?:\/(enquiry|farm-visit))?\/?$/, (m) => bulkPage(m[1] || 'order')],
]
// The home page's old sections, now pages: /#bulk (an old link, a bookmark) opens /bulk. /#preorder lands on the shop.
const ANCHOR_PAGES = { preorder: '/', bulk: '/bulk', partner: '/partner' }
/** The retired pre-order page: an old link or bookmark lands on the home page (the shop takes pre-orders before the season). */
const OLD_PREORDER = /^\/preorder\/?$/
const anchorPage = () => (location.pathname === '/' || location.pathname === '/index.html') && ANCHOR_PAGES[location.hash.slice(1)] || null
// The account's tabs are drawn by accountTabs() (the orders page's two layouts); farm.js still adds to this list.
const ACCOUNT_TABS = [['/account', 'Profile'], ['/orders', 'My orders']]
let homeScroll = 0, nameEditing = false

const isPage = (path) => PAGES.some(([re]) => re.test(path))
const pageOpen = () => document.body.classList.contains('page-open')

function go(path, { replace = false } = {}) {
  // An entry this app pushed is marked, so the back button knows it can go back within the site.
  if (location.pathname + location.search + location.hash !== path) history[replace ? 'replaceState' : 'pushState']({ mm: true }, '', path)
  route()
}

function route() {
  if (OLD_PREORDER.test(location.pathname)) history.replaceState(history.state, '', '/' + location.search)
  const moved = anchorPage()
  if (moved) history.replaceState(history.state, '', moved)
  const path = location.pathname
  for (const [re, open] of PAGES) {
    const m = path.match(re)
    if (!m) continue
    showPage(path)
    open(m)
    routed()
    return
  }
  // Any other path that isn't a file: a small not-found page (old server links still land on the shop).
  if (missingPath(path)) {
    showPage(path)
    document.body.dataset.page = 'not-found'
    notFoundView()
    routed()
    return
  }
  hidePage()
  routed()
}
const missingPath = (p) => p !== '/' && p !== '/index.html' && !OLD_PREORDER.test(p) && !/^\/(invite|help|account|preorders|gift-address)\//.test(p) && !PAGES.some(([re]) => re.test(p))

function notFoundView() {
  document.title = 'Page not found · VMR Mangoes'
  notFoundNoindex(true)
  host().innerHTML = pageHead('That page isn’t here') + `<section class="page-card empty-cart bag-empty empty-state not-found"><p>The link may be old, or the address may have a typo. The mangoes are all still here.</p><a class="button primary bag-explore" href="/" data-route>Back to the mangoes ${icon('arrow')}</a></section>`
}
const routed = () => window.dispatchEvent(new CustomEvent('mm:route', { detail: { path: location.pathname } }))
/** The not-found page asks search engines not to index it (like the server's own 404.html); the next page takes that away (the mm:route listener below). */
function notFoundNoindex(on) {
  const m = document.querySelector('meta[name="robots"][data-not-found]')
  if (on && !m) document.head.insertAdjacentHTML('beforeend', '<meta name="robots" content="noindex" data-not-found>')
  else if (!on && m) m.remove()
}

function showPage(path) {
  if (!pageOpen()) homeScroll = scrollY
  closeDialogs()
  setBar('')
  view = '#page-body'
  ++sheetSeq
  document.body.classList.add('page-open')
  document.body.dataset.page = path.split('/')[1]
  const skip = $('.skip')
  if (skip) { skip.textContent = 'Skip to content'; skip.setAttribute('href', '#page-view') }
  $('#home').hidden = true
  $('#page-view').hidden = false
  window.scrollTo({ top: 0, behavior: 'instant' })
  window.Liquid?.enter($('#page-view'), { soft: true })
}

function hidePage() {
  if (!pageOpen()) return
  document.body.classList.remove('page-open')
  setBar('')
  const skip = $('.skip')
  if (skip) { skip.textContent = 'Skip to mangoes'; skip.setAttribute('href', '#shop') }
  delete document.body.dataset.page
  $('#page-view').hidden = true
  $('#page-body').innerHTML = ''
  $('#home').hidden = false
  view = '#form-dialog'
  ++sheetSeq
  const target = location.hash && document.getElementById(location.hash.slice(1))
  if (target) target.scrollIntoView({ behavior: 'instant' })
  else window.scrollTo({ top: homeScroll, behavior: 'instant' })
  positionPill(false)
}

/** Signed in already: go on. Otherwise sign in on the page first (the checkout's own steps). */
/** Signed in already: go on. Otherwise the sign-in page first, which comes back here once the code is verified. */
function signedInThen(title, then) {
  MM.restore().then(() => {
    if (!pageOpen()) return
    if (MM.profile()) then()
    else go(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true })
  })
}

/** Where the sign-in page goes afterwards: only a path on this site (never another site's address). */
function loginNext() {
  const next = new URLSearchParams(location.search).get('next') || '/account'
  return /^\/(?!\/)[\w\-/]*(\?[\w\-=&%.]*)?$/.test(next) ? next : '/account'
}

// ---- The sign-in page (/login): the phone and code steps, then on to where the customer was going.

function loginView() {
  MM.restore().then(() => {
    if (!pageOpen()) return
    if (MM.profile()) return go(loginNext(), { replace: true })
    startSteps('Sign in', false, () => go(loginNext(), { replace: true }), 'login')
  })
}

function loginIntro() {
  return `<p class="login-intro">Sign in with your mobile number to see your orders and check out faster. We’ll send you a 6-digit code; new here, your account is made when you verify it.</p>`
}

/** The page's heading: a back button, the title, and on the account pages their tabs (accountTabs). */
function pageHead(title) {
  const tabs = ['account', 'orders', 'farm-bookings'].includes(document.body.dataset.page) ? accountTabs() : ''
  return `<div class="page-head"><button class="icon-button" data-page-back aria-label="Back">${icon('back')}</button><h1>${title}</h1></div>${tabs}`
}

/** A paid order can be cancelled only within cancelHours() of placing it (the API's rule: canCancel and cancelUntil on the
    order). Says, as big as the checkout's note, the exact time cancelling closes, or that it has closed and how to reach us. */
function cancelNote(o, canCancel) {
  if (!o.cancelUntil) return ''
  const until = new Date(o.cancelUntil)
  if (Number.isNaN(until.getTime())) return ''
  const when = esc(until.toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }))
  const h = hoursWord(cancelHours())
  const box = (cls, lead, more) => `<div class="co-cancel cancel-note${cls}" role="note"><span class="co-cancel-icon" aria-hidden="true">${icon('clock')}</span><div><p class="co-cancel-lead">${lead}</p><p class="co-cancel-more">${more}${policyLink()}</p></div></div>`
  if (canCancel) return box('', `You can cancel this order until ${when}.`, `That is ${h} after it was placed. After that cancelling closes and the order can’t be cancelled or refunded.`)
  if (until.getTime() >= Date.now()) return ''
  return box(' is-closed', `Cancelling closed at ${when}.`, `Orders can be cancelled only within ${h} of placing them. Something wrong? ${helpLink('Message us', `Hi VMR Mangoes, about my order ${orderNo(o.number)}`)}.`)
}

// ---- The bulk page: three tabs under the heading (bulk.js): Bulk order (100 kg and above, ordered and paid now at bulk
// prices), Send enquiry (250 kg+ mangoes, a quote: three numbered steps and a kg meter in the bar, CR2-05) and Farm visit
// (250 kg+ mangoes, a farm visit enquiry: bulk.js). On the first two a grid of the shop's own product cards (one per
// variety, each with its ripeness, 5 kg / 10 kg box and "Add to bulk list", then a stepper) fills one bulk list
// (localStorage `mm-bulk`, not the bag), shared by both tabs, shown under it with a stepper per line and both prices (the
// shop's struck through, the bulk price from GET /v1/bulk/prices). The sticky bar (#pay-bar) offers the tab's one action: "Order and pay"
// from 100 kg (bulk.js bulkOrderStart), or "Send enquiry" from 250 kg (app.js bulkForm).

const BULK_MIN_KG = 100
/** Enquiries are for this many kg and more (the API's BULK_ENQUIRY_MIN_KG): below it, order and pay instead. */
const BULK_ENQUIRY_MIN_KG = 250
const BULK_ENQUIRY_MIN_TEXT = `Enquiries need at least ${BULK_ENQUIRY_MIN_KG} kg of mangoes. From ${BULK_MIN_KG} kg you can order and pay directly.`
// Bulk boxes are 5 kg or 10 kg only. The catalogue has no 10 kg box, so the 10 kg bulk box is the variety's 5 kg fruit packed
// double: id "<5 kg sku>@10" in the list, sent to the API as that sku with packKg 10, shown at twice the 5 kg price.
const BULK_PACKS_KG = [5, 10]
const BULK_DELIVERY_PCT = 10 // delivery on a bulk order, as a share of the mangoes' value (the API works out the real figure)
/** The delivery fee in the same words wherever it shows (the owner, 26 Nov 2026): the "How it works" card, the list's
 *  money, the bar, the review and the receipt. */
const BULK_FEE_SHARE = `${BULK_DELIVERY_PCT}% of the order value`
const BULK_FEE_WORDS = `Delivery fee: ${BULK_FEE_SHARE}`
/** The list's delivery fee in rupees, worked out as the API does (mango-api bulk-orders.js orderMoney): to the paisa on the
 *  mangoes at bulk prices, so the total shown is the total charged. */
const bulkFee = (t) => Math.round((Math.round(t.bulk * 100) * BULK_DELIVERY_PCT) / 100) / 100
/** Rupees for bulk money: whole rupees, or with the paise when there are any (a 10% fee can end in paise: ₹1,977.80). */
const bulkMoney = (rs) => Math.round(rs * 100) % 100 ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(rs) : currency(rs)
const BULK_DAYS = '5–7 days'
const tenOf = (five) => ({ ...five, sku: `${five.sku}@10`, boxSize: '10kg', price: five.price * 2, base: five.sku, packKg: 10 })
/** A bulk list id → the box it stands for (a real 5 kg sku, or its 10 kg bulk box). */
function bulkSku(id) {
  const [base, pack] = String(id).split('@'), s = skuOf(base)
  return !s ? null : pack === '10' ? tenOf(s) : s
}
/** The bulk boxes of a variety: its 5 kg box and the 10 kg bulk box; none when it has no 5 kg box. */
function bulkBoxes(v) {
  const five = v.skus.find((s) => kgOf(s) === 5)
  return five ? [five, tenOf(five)] : []
}
const BULK_MAX_BOXES = 5000 // the most boxes one line of the list holds
let bulkList = null

/** The shop's catalogue, once GET /v1/products has answered (shelf.js loadProducts), or after 15 s without it. */
function shelfReady() {
  return new Promise((ok) => {
    const t0 = Date.now()
    ;(function poll() {
      if (skus.length) {
        if (!shelf.length) buildShelf()
        ok()
      } else if (Date.now() - t0 > 15000) ok()
      else setTimeout(poll, 150)
    })()
  })
}

const kgText = (s) => String(s.boxSize).replace('kg', ' kg')


/** Re-find the control that was used after a redraw (by its data attributes) and focus it. */
function refocus(root, attrs) {
  if (!attrs) return
  const sel = Object.entries(attrs).map(([k, v]) => `[${k}="${CSS.escape(v)}"]`).join('')
  ;($(sel, root) || null)?.focus()
}
const usedAttrs = (b, names) => b ? Object.fromEntries(names.filter((n) => b.hasAttribute(n)).map((n) => [n, b.getAttribute(n)])) : null

// ---- Pre-orders in the product sheet (before the season, shelf.js renderDetail → app.js preDetail)

/** "Pre-order" on a card: the product sheet for that variety, with its box and ripeness, booking a harvest week. */
function openPreBooking(name, sku, stage) {
  if (sku) cardBox[name] = sku
  if (stage && filter === 'all') cardStage[name] = stage
  productDetail(name)
}

/** A choice inside the booking panel (box, ripeness, quantity). The week is not chosen: the API gives the earliest week with
 *  room (app.js preFix, preWhen). The sheet's photo follows the ripeness. */
function prePanel(b) {
  const d = b.dataset
  if (d.preBox) { pre.sku = d.preBox; pre.weekStart = null }
  else if (d.preStage) pre.stage = d.preStage
  else if (d.preStep) pre.qty += Number(d.preStep)
  pre.error = ''
  pre.offer = false
  preFix()
  if (detail && pre.variety === detail.name) {
    detail.sku = pre.sku
    if (d.preStage) {
      detail.stage = pre.stage
      const v = shelf.find((x) => x.name === detail.name), img = $('#detail-photo')
      const src = v && v.c.photos && v.c.photos[pre.stage]
      if (img && src) img.src = src
    }
  }
  renderPreorder()
  refocus(preHost(), usedAttrs(b, ['data-pre-box', 'data-pre-stage', 'data-pre-step']))
  if (d.preStep && document.activeElement === document.body) $('[data-pre-step]:not(:disabled)', preHost())?.focus()
}

// ---- /bulk

const bulkLines = () => bulkList ??= read('mm-bulk', []).filter((x) => x && typeof x.sku === 'string' && SOLD.some((p) => p.apiStage === x.stage) && Number.isInteger(x.qty) && x.qty > 0)

/** The list's boxes, kg, value at shop prices (value) and at bulk prices (bulk; `priced` once every line has its bulk price). Rupees. */
function bulkTotals() {
  return bulkLines().reduce((t, x) => {
    const s = bulkSku(x.sku), bp = s && bulkPriceFor(x.sku)
    t.boxes += x.qty
    t.kg += (s ? kgOf(s) : 0) * x.qty
    t.value += (s ? s.price : 0) * x.qty
    t.bulk += (bp ? bp.bulk : s ? s.price : 0) * x.qty
    if (s && !bp) t.priced = false
    return t
  }, { boxes: 0, kg: 0, value: 0, bulk: 0, priced: true })
}

/** The list as the enquiry shows and sends it: one line per box and ripeness. */
function bulkSummary() {
  return bulkLines().map((x) => {
    const s = bulkSku(x.sku), kg = (s ? kgOf(s) : 0) * x.qty
    return { sku: s?.base || x.sku, ...(s?.packKg ? { packKg: s.packKg } : {}), stage: x.stage, boxes: x.qty, kg, label: `${s ? s.variety : x.sku} · ${s ? kgText(s) + ' box' : 'box'} · ${stageOf(x.stage).stage}` }
  })
}

// ---- The cards (the owner, 26 Nov 2026: "like the normal shop"): the shop's own card (shelf.js cardHTML's markup and
// classes, so it looks the same in both themes and on phones): photo, name, flavour line, price, box cards, the action and
// "Piler · Semi-ripe". One card per variety with a 5 kg box, the mixed box first (bulk.js bulkVarietyOrder; "Most asked"
// on the Send enquiry tab). Each card keeps its own ripeness and box size (bulkPick), shows the bulk price for that box
// with the shop price struck through, and "Add to bulk list" (one box), which becomes a − n + stepper (the number can be
// typed) for that box and ripeness once it is in the list. The photo does not open the product sheet: that sheet adds to
// the bag. Styles: style.css "The bulk page's cards".

const bulkPick = {} // variety → { stage, pack } chosen on its card
function bulkPickOf(v) {
  const p = bulkPick[v.name] ||= { stage: 'SEMI_RIPE', pack: BULK_PACKS_KG[0] }
  if (!SOLD_API.includes(p.stage)) p.stage = SOLD_API.includes('SEMI_RIPE') ? 'SEMI_RIPE' : SOLD_API[0]
  if (!BULK_PACKS_KG.includes(p.pack)) p.pack = BULK_PACKS_KG[0]
  return p
}
const bulkBoxOf = (v, pack) => bulkBoxes(v).find((s) => kgOf(s) === pack) || bulkBoxes(v)[0]
const bulkLineOf = (id, stage) => bulkLines().find((x) => x.sku === id && x.stage === stage) || null
/** The varieties on the cards, in the bulk lists' order. */
const bulkShelf = () => bulkVarietyOrder(shelf.filter((x) => bulkBoxes(x).length))

/** The card's price: the bulk price, the shop price struck through beside it and "/ 5 kg box in bulk" (shelf.js
 *  priceHTML's look). Until GET /v1/bulk/prices answers: the shop price. */
function bulkCardPrice(s) {
  const bp = bulkPriceFor(s.sku), box = `${kgText(s)} box`
  return bp
    ? `${currency(bp.bulk)}<s class="price-was" aria-label="shop price ${currency(bp.price)}">${currency(bp.price)}</s><small>/ ${box} in bulk</small>`
    : `${currency(s.price)}<small>/ ${box}</small>`
}

/** "Add to bulk list", or once this box and ripeness are in the list its − n + stepper (data-at="card", so bulkStep keeps
 *  the focus on the card's own control and not on the list's). */
function bulkCardAction(v) {
  const p = bulkPickOf(v), s = bulkBoxOf(v, p.pack), st = stageOf(p.stage), line = bulkLineOf(s.sku, p.stage)
  const what = esc(`${kgText(s)} boxes of ${st.stage.toLowerCase()} ${v.name}`)
  if (!line) return `<button type="button" class="quick-add bulk-card-add" data-bulk-card-add="${esc(v.name)}" aria-label="Add a ${esc(kgText(s))} box of ${st.stage.toLowerCase()} ${esc(v.name)} to your bulk list">${icon('box')}<span>Add to bulk list</span></button>`
  const key = `data-sku="${esc(s.sku)}" data-stage="${esc(p.stage)}" data-at="card"`
  return `<div class="card-stepper bulk-card-step" role="group" aria-label="${what} in your bulk list"><button type="button" data-bulk-qty="-1" ${key} aria-label="${line.qty === 1 ? 'Take out' : 'One box fewer'}: ${what}">−</button><input class="bulk-card-qty" type="number" inputmode="numeric" min="0" max="${BULK_MAX_BOXES}" step="1" value="${line.qty}" ${key} aria-label="Number of ${what}"><button type="button" data-bulk-qty="1" ${key} aria-label="One box more: ${what}"${line.qty >= BULK_MAX_BOXES ? ' aria-disabled="true"' : ''}>+</button></div>`
}

/** A row of the shop's box cards with the glass lens behind the chosen one (shelf.js boxCards' look). */
const bulkToggle = (label, buttons, i) => `<div class="box-cards bulk-card-toggle" role="group" aria-label="${label}" style="--n:${buttons.length};--i:${Math.max(0, i)}"><span class="box-lens" aria-hidden="true"></span>${buttons.join('')}</div>`

function bulkCardHTML(v) {
  const p = bulkPickOf(v), st = stageOf(p.stage), s = bulkBoxOf(v, p.pack), name = esc(v.name), src = v.c.photos && v.c.photos[p.stage]
  const photo = `<span class="fruit-photo${src ? ' photo' : ''}" role="img" aria-label="${st.stage} ${name}">${src ? `<img src="${src}" alt="" loading="lazy" decoding="async" width="720" height="720">` : ''}</span>`
  const tag = bulkTab === 'enquiry' && v.name === BULK_FIRST ? '<span class="bq-most">Most asked</span>' : ''
  const stages = SOLD.map((x) => `<button type="button" class="box-card" data-bulk-card-stage="${x.apiStage}" aria-pressed="${x.apiStage === p.stage}"><strong><span class="dot ${x.id}" aria-hidden="true"></span>${x.stage}</strong></button>`)
  const packs = bulkBoxes(v).map((b) => { const bp = bulkPriceFor(b.sku); return `<button type="button" class="box-card" data-bulk-card-pack="${kgOf(b)}" aria-pressed="${b.sku === s.sku}"><strong>${esc(kgText(b))}</strong><small>${currency(bp ? bp.bulk : b.price)}</small></button>` })
  return `<article class="product-card bulk-card${bulkLineOf(s.sku, p.stage) ? ' is-in' : ''}" data-kind="${st.id}" data-variety="${name}"><div class="product-image">${photo}${tag}</div><div class="product-info"><div class="product-topline"><h3><span>${name}</span></h3></div><p class="product-desc">${esc(v.c.flavour)}</p><div class="product-bottom"><div class="product-price">${bulkCardPrice(s)}</div>${bulkToggle(`${name} ripeness`, stages, SOLD.indexOf(st))}${bulkToggle(`${name} box size`, packs, bulkBoxes(v).findIndex((b) => b.sku === s.sku))}</div><div class="card-action">${bulkCardAction(v)}</div><div class="product-status">${icon('leaf')}<span>${v.c.region ? esc(v.c.region) + ' · ' : ''}${st.stage}</span></div></div></article>`
}

/** A card after its ripeness, box or line changed: photo, price, action and status line, in place (the lens keeps sliding). */
function bulkCardFill(card, v, pop = true) {
  const p = bulkPickOf(v), st = stageOf(p.stage), s = bulkBoxOf(v, p.pack), src = v.c.photos && v.c.photos[p.stage]
  card.dataset.kind = st.id
  card.classList.toggle('is-in', !!bulkLineOf(s.sku, p.stage))
  const photo = $('.fruit-photo', card), img = photo && $('img', photo)
  if (photo) photo.setAttribute('aria-label', `${st.stage} ${v.name}`)
  if (img && src && img.getAttribute('src') !== src) img.src = src
  const price = $('.product-price', card), html = bulkCardPrice(s)
  if (price.innerHTML !== html) { price.innerHTML = html; if (pop) window.Liquid?.pop(price, 0.35) }
  const action = $('.card-action', card), act = bulkCardAction(v)
  if (action.innerHTML !== act) action.innerHTML = act
  $('.product-status span', card).textContent = `${v.c.region ? v.c.region + ' · ' : ''}${st.stage}`
}

/** A ripeness or box size chosen on a card. */
function bulkCardSet(b) {
  const card = b.closest('.bulk-card'), v = card && shelf.find((x) => x.name === card.dataset.variety)
  if (!v) return
  const p = bulkPickOf(v)
  if (b.dataset.bulkCardStage) p.stage = b.dataset.bulkCardStage
  else p.pack = Number(b.dataset.bulkCardPack)
  const group = b.closest('.box-cards'), buttons = $$('.box-card', group)
  buttons.forEach((x) => x.setAttribute('aria-pressed', x === b))
  slideLens(group, '.box-lens', buttons.indexOf(b))
  bulkCardFill(card, v)
}

/** The bulk list under the cards: one line per variety, box and ripeness, with a stepper and Remove. */
function bulkListHTML() {
  const lines = bulkLines().filter((x) => bulkSku(x.sku)), t = bulkTotals(), ok = t.kg >= BULK_MIN_KG
  if (!lines.length) return `<section class="bulk-list is-empty" id="bulk-list" aria-labelledby="bulk-list-h"><h3 id="bulk-list-h" tabindex="-1">Your bulk list</h3><p>${icon('box')}<span>Nothing here yet. Choose a variety above and add your boxes.</span></p></section>`
  return `<section class="bulk-list" id="bulk-list" aria-labelledby="bulk-list-h"><h3 id="bulk-list-h" tabindex="-1">Your bulk list</h3><ul>${lines.map((x) => {
    const s = bulkSku(x.sku), st = stageOf(x.stage), what = esc(`${kgText(s)} boxes of ${st.stage.toLowerCase()} ${s.variety}`)
    const key = `data-sku="${esc(x.sku)}" data-stage="${esc(x.stage)}" data-at="list"`
    return `<li class="bulk-line">${thumb(s.base || s.sku, x.stage, s.variety)}<div class="bulk-line-copy"><strong>${esc(s.variety)}</strong><small>${esc(kgText(s))} box · ${st.stage}</small></div><div class="bulk-line-qty"><div class="card-stepper" role="group" aria-label="${what} in your bulk list"><button type="button" data-bulk-qty="-1" ${key} aria-label="One box fewer">−</button><span aria-live="polite">${x.qty}</span><button type="button" data-bulk-qty="1" ${key} aria-label="One box more">+</button></div><strong class="bulk-line-kg">${x.qty * kgOf(s)} kg${bulkLineMoney(x)}</strong></div><button type="button" class="text-button bulk-line-remove" data-bulk-remove ${key} aria-label="Remove ${what} from your bulk list">Remove</button></li>`
  }).join('')}</ul><p class="bulk-list-total${ok ? ' is-ok' : ''}"><span>Total</span><strong>${t.kg} kg · ${t.boxes} ${t.boxes === 1 ? 'box' : 'boxes'}</strong></p>${bulkMoneyHTML(t)}</section>`
}

function renderBulkGrid(focus) {
  const grid = $('#bulk-grid')
  if (!grid) return
  if (!shelf.length) {
    grid.innerHTML = grid.dataset.waited
      ? `<div class="page-card empty-cart bag-empty empty-state">${icon('box')}<h2>The mangoes are a moment away.</h2><p>We couldn’t load the boxes just now. Try again in a minute.</p><button class="button primary bag-explore" data-bulk-retry>Try again ${icon('arrow')}</button></div>`
      : `<div class="product-grid bulk-cards" aria-busy="true">${skeletonCards(4)}</div>`
    grid.dataset.drawn = ''
    return
  }
  // A list saved before the 5 kg / 10 kg rule may hold other boxes: they leave it.
  if (skus.length && bulkLines().some((x) => !BULK_PACKS_KG.includes(kgOf(bulkSku(x.sku) || {})))) {
    bulkList = bulkLines().filter((x) => BULK_PACKS_KG.includes(kgOf(bulkSku(x.sku) || {})))
    save('mm-bulk', bulkList)
  }
  const cards = bulkShelf()
  // The cards are drawn once for the tab, the varieties and the prices; after that a change to the list only redraws
  // each card's action and the list, so the photos never flash.
  const drawn = [bulkTab, cards.map((v) => v.name).join('|'), bulkPriceMap ? 'priced' : ''].join('#')
  if (grid.dataset.drawn === drawn && $('#bulk-cards', grid)) {
    $$('#bulk-cards .bulk-card', grid).forEach((card) => { const v = cards.find((x) => x.name === card.dataset.variety); if (v) bulkCardFill(card, v, false) })
    $('#bulk-list', grid).outerHTML = bulkListHTML()
    refocus(grid, focus)
    return
  }
  const intro = bulkTab === 'enquiry'
    ? `Choose the ripeness and a <strong>5 kg or 10 kg box</strong> on each mango and add it to your list. Enquiries are for <strong>${BULK_ENQUIRY_MIN_KG} kg+ mangoes</strong>: we price your list and send a quote, which can be lower than the bulk price shown. Nothing is paid now.`
    : `Choose the ripeness and a <strong>5 kg or 10 kg box</strong> on each mango and add it to your list. Bulk orders start at ${BULK_MIN_KG} kg, at <strong>bulk prices</strong> (the shop price is struck through), and you pay when you order.`
  // Send enquiry (change request 02, CR2-05): the section's head has its step number, as on the farm visit page.
  const title = bulkTab === 'enquiry' ? '<span class="fv-num" aria-hidden="true">1</span>Build your bulk list' : 'Build your bulk list'
  grid.innerHTML = `<div class="door-intro${bulkTab === 'enquiry' ? ' bq-head' : ''}"><h2 class="flow-head${bulkTab === 'enquiry' ? ' fv-sec-h' : ''}">${title}</h2><p>${intro}</p></div><div class="product-grid bulk-cards" id="bulk-cards">${cards.map(bulkCardHTML).join('')}</div>${bulkListHTML()}`
  grid.dataset.drawn = drawn
  refocus(grid, focus)
}

/** "Add to bulk list" on a card: one box of the card's box and ripeness joins the list (its line, if it has one). */
function bulkAdd(b) {
  const card = b.closest('.bulk-card'), v = card && shelf.find((x) => x.name === card.dataset.variety)
  if (!v) return
  const p = bulkPickOf(v), s = bulkBoxOf(v, p.pack), list = bulkLines(), stage = p.stage
  let line = list.find((x) => x.sku === s.sku && x.stage === stage)
  if (line && line.qty >= BULK_MAX_BOXES) return
  if (!line) list.push(line = { sku: s.sku, stage, qty: 0 })
  line.qty += 1
  save('mm-bulk', list)
  const photo = $('.fruit-photo', card), from = photo && photo.getBoundingClientRect(), src = photo && $('img', photo)?.src
  renderBulkGrid({ 'data-bulk-qty': '1', 'data-sku': s.sku, 'data-stage': stage, 'data-at': 'card' })
  bulkBar()
  toast(`1 × ${kgText(s)} ${stageOf(stage).stage.toLowerCase()} ${v.name} added to your bulk list`)
  if (window.MMFly && from) MMFly.fly({ from, src, to: () => $('#pay-bar .pay-bar-total') || $('#pay-bar') })
  bulkFollow()
}

/** A number typed on a card's stepper: that line becomes that many boxes (0 takes it out). Settled without redrawing the
 *  card while the field is in use (the tap that blurred it may be on the card's own + or −). */
function bulkCardTyped(t) {
  const list = bulkLines(), line = list.find((x) => x.sku === t.dataset.sku && x.stage === t.dataset.stage)
  if (!line) return
  const n = Math.floor(Number(t.value))
  if (t.value.trim() === '' || !(n >= 0)) { t.value = line.qty; return }
  if (n === 0) list.splice(list.indexOf(line), 1)
  else line.qty = Math.min(BULK_MAX_BOXES, n)
  t.value = n === 0 ? 0 : line.qty
  save('mm-bulk', list)
  if (n === 0) renderBulkGrid(document.activeElement === t ? { 'data-bulk-card-add': t.closest('.bulk-card')?.dataset.variety || '' } : null)
  else $('#bulk-list').outerHTML = bulkListHTML()
  bulkBar()
  bulkFollow()
}

/** The sticky bar on /bulk: the list's weight and boxes, and the tab's action: "Order and pay" (from 100 kg) or "Send
 *  enquiry" (from 250 kg). The farm tab's bar (phones only) is bulk.js bulkFarmBar. */
function bulkBar() {
  if (document.body.dataset.page !== 'bulk') return
  if (bulkTab === 'farm-visit') return bulkFarmBar()
  if (bulkTab === 'enquiry') return bulkEnquiryBar()
  const t = bulkTotals(), ok = t.kg >= BULK_MIN_KG
  // Just sent (the "sent" card is on screen and the list is empty): say so, no disabled button or hint.
  const sent = !t.boxes && [...document.querySelectorAll('#bulk-box .bulk-sent')].find((el) => el.getClientRects().length)
  if (sent) {
    return setBar(`<div class="pay-bar-row is-sent"><p class="pay-bar-sent" role="status">${icon('check')}<span>Sent · we will be in touch on WhatsApp</span></p></div>`)
  }
  if (bulkFlowOpen()) return setBar('')
  const fee = bulkFee(t)
  const hint = ok
    ? `<p class="pay-bar-hint is-next is-ok" role="status">${icon('check')}<span>${t.kg} kg at bulk prices${t.priced ? `, ${bulkMoney(t.bulk)}` : ''}. ${BULK_FEE_WORDS}${t.priced ? `, ${bulkMoney(fee)}` : ''}. You pay now; delivery in ${BULK_DAYS}.</span></p>`
    : `<p class="pay-bar-hint is-next" role="status" id="bulk-order-why">${icon('lock')}<span>Bulk orders start at ${BULK_MIN_KG} kg${t.kg ? ` · add ${BULK_MIN_KG - t.kg} kg more` : ''}.</span></p>`
  setBar(`${hint}<div class="pay-bar-row bulk-bar"><div class="pay-bar-total"><small>${ok && t.priced ? 'Total to pay' : 'Your bulk list'}</small><strong>${ok && t.priced ? `<span>${bulkMoney(t.bulk + fee)}</span>` : `<span>${t.kg} kg ·</span> <span>${t.boxes} ${t.boxes === 1 ? 'box' : 'boxes'}</span>`}</strong></div><div class="bulk-bar-go"><button class="button primary pay-bar-go" id="bulk-order" ${ok ? '' : `disabled aria-describedby="bulk-order-why"`}>${ok ? '' : icon('lock')}<span>Order and pay</span>${ok ? icon('arrow') : ''}</button></div></div>`)
}

/** The Send enquiry tab's three steps (change request 02, CR2-05), under the tabs: 1 while the list is built, 2 once the
 *  details form is open, 3 once it is sent. bulkEnquirySteps marks the one you are on. */
function bulkStepsHTML() {
  const steps = [['Build your list', `${BULK_ENQUIRY_MIN_KG} kg+ mangoes`], ['Your details', 'name, city, WhatsApp'], ['Get your quote', 'on WhatsApp, often lower']]
  return `<ol class="bq-steps" aria-label="Sending an enquiry">${steps.map(([t, sub], i) => `<li${i ? '' : ' class="is-now" aria-current="step"'}><span class="fv-num" aria-hidden="true">${i + 1}</span><span class="bq-step-copy"><strong>${t}</strong><small>${sub}</small></span></li>`).join('')}</ol>`
}
function bulkEnquirySteps() {
  const ol = $('.bq-steps')
  if (!ol) return
  const box = $('#bulk-box'), sent = box && [...box.querySelectorAll('.bulk-sent')].some((el) => el.getClientRects().length)
  const at = sent ? 3 : box && !box.hidden && $('#bulk-form', box) ? 2 : 1
  $$('li', ol).forEach((li, i) => {
    li.classList.toggle('is-now', i + 1 === at)
    li.classList.toggle('is-done', i + 1 < at)
    if (i + 1 === at) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current')
  })
}

/** The enquiry tab's bar: a meter of the list's kg towards 250 ("Your bulk list · 180 kg of 250 kg", "Add 70 kg more
 *  mangoes to send · enquiries are for 250 kg+ mangoes", CR2-02's wording), green and "Ready" from 250 kg, when "Send enquiry" unlocks; under 250 kg from 100 kg, the way to
 *  order and pay instead. */
function bulkEnquiryBar() {
  bulkEnquirySteps()
  const t = bulkTotals(), ok = t.kg >= BULK_ENQUIRY_MIN_KG
  const sent = !t.boxes && [...document.querySelectorAll('#bulk-box .bulk-sent')].find((el) => el.getClientRects().length)
  if (sent) return setBar(`<div class="pay-bar-row is-sent"><p class="pay-bar-sent" role="status">${icon('check')}<span>Enquiry sent · your quote comes on WhatsApp</span></p></div>`)
  const pct = Math.min(100, Math.round((t.kg / BULK_ENQUIRY_MIN_KG) * 100)), more = BULK_ENQUIRY_MIN_KG - t.kg
  const say = ok
    ? `${icon('check')}<span>Ready: send it and we’ll quote you.</span>`
    : `${icon('lock')}<span>${t.kg ? `Add ${more} kg more mangoes to send · enquiries are for ${BULK_ENQUIRY_MIN_KG} kg+ mangoes.` : `Enquiries are for ${BULK_ENQUIRY_MIN_KG} kg+ mangoes. Add boxes to your list.`}</span>`
  const order = !ok && t.kg >= BULK_MIN_KG ? `<a class="button secondary pay-bar-alt" href="/bulk" data-route>Order and pay</a>` : ''
  setBar(`<div class="pay-bar-row bulk-bar bq-bar${ok ? ' is-ready' : ''}"><div class="bq-meter">
      <p class="bq-meter-top"><strong>Your bulk list · <span class="no-wrap">${t.kg} kg of ${BULK_ENQUIRY_MIN_KG} kg</span></strong><small>${t.boxes} ${t.boxes === 1 ? 'box' : 'boxes'}</small></p>
      <div class="bq-track" role="progressbar" aria-label="Your bulk list towards ${BULK_ENQUIRY_MIN_KG} kg" aria-valuemin="0" aria-valuemax="${BULK_ENQUIRY_MIN_KG}" aria-valuenow="${Math.min(t.kg, BULK_ENQUIRY_MIN_KG)}" aria-valuetext="${t.kg} kg of ${BULK_ENQUIRY_MIN_KG} kg"><span></span><i aria-hidden="true"></i></div>
      <p class="bq-meter-say" id="bulk-enquiry-why" role="status">${say}</p>
    </div><div class="bulk-bar-go">${order}<button class="button primary pay-bar-go bq-go" id="bulk-enquiry" ${ok ? '' : 'disabled aria-describedby="bulk-enquiry-why"'}>${ok ? '' : icon('lock')}<span>Send enquiry</span>${ok ? icon('arrow') : ''}</button></div></div>`)
  const fill = $('#pay-bar .bq-track span')
  if (fill) fill.style.width = `${pct}%`
}

function bulkStep(b) {
  const { sku, stage } = b.dataset, delta = Number(b.dataset.bulkQty), list = bulkLines()
  let line = list.find((x) => x.sku === sku && x.stage === stage)
  if (!line && delta > 0) list.push(line = { sku, stage, qty: 0 })
  if (!line) return
  line.qty = Math.min(5000, line.qty + delta)
  if (line.qty <= 0) list.splice(list.indexOf(line), 1)
  save('mm-bulk', list)
  // data-at: the card's stepper or the list's, so the focus stays on the one that was used.
  const focus = usedAttrs(b, ['data-bulk-qty', 'data-sku', 'data-stage', 'data-at']), card = b.closest('.bulk-card')?.dataset.variety
  renderBulkGrid(focus)
  if (!$('#bulk-grid').contains(document.activeElement)) refocus($('#bulk-grid'), { 'data-bulk-qty': '1', 'data-sku': sku, 'data-stage': stage, ...(b.dataset.at ? { 'data-at': b.dataset.at } : {}) })
  // A card's last box taken out: its "Add to bulk list" again.
  if (card && !$('#bulk-grid').contains(document.activeElement)) refocus($('#bulk-grid'), { 'data-bulk-card-add': card })
  if (!$('#bulk-grid').contains(document.activeElement)) $('#bulk-list-h')?.focus()
  bulkBar()
  bulkFollow()
}

/** Draws the form under the list again (the list changed, or the other kind was asked for) and keeps what was typed. */
function bulkRedraw(kind) {
  const box = $('#bulk-box'), was = box && $('#bulk-form', box)
  const typed = was ? [...new FormData(was)].filter(([k, v]) => k !== 'quantity' && typeof v === 'string') : []
  const qty = was && was.querySelector('input[name="quantity"][type="number"]')?.value
  bulkForm('#bulk-box', kind)
  const now = $('#bulk-form', box)
  if (!now) return
  // Send enquiry (CR2-05): the details are step 2, headed like the farm visit page's sections.
  const head = bulkTab === 'enquiry' && $('.flow-head', box)
  box.classList.toggle('bq-details', Boolean(head))
  if (head) { head.classList.add('fv-sec-h'); head.innerHTML = '<span class="fv-num" aria-hidden="true">2</span>Your details' }
  for (const [k, v] of typed) { const f = now.elements.namedItem(k); if (f && f.type !== 'hidden') f.value = v }
  const q = now.querySelector('input[name="quantity"][type="number"]')
  if (q && qty) q.value = qty
}

/** An open form follows the list: the order flow (bulk.js) or the enquiry form; it closes when the list drops under the tab's minimum. */
function bulkFollow() {
  if (bulkTab === 'order') return bulkOrderFollow()
  const box = $('#bulk-box'), form = box && !box.hidden && $('#bulk-form', box)
  if (!form) return
  if (bulkTotals().kg >= BULK_ENQUIRY_MIN_KG) bulkRedraw('ENQUIRY')
  else { box.hidden = true; box.innerHTML = '' }
  bulkEnquirySteps()
}

/** Opens the tab's form under the list: the order flow (100 kg or more, bulk.js) or the enquiry form (250 kg or more). */
function openBulkEnquiry(kind = 'ORDER') {
  if (kind === 'ORDER') return bulkOrderStart()
  const box = $('#bulk-box')
  if (!box || bulkTotals().kg < BULK_ENQUIRY_MIN_KG) return
  const open = !box.hidden && $('#bulk-form', box)
  // The bar's button for the form that is already open sends that form (it says the same as the form's own button);
  // it used to draw the form afresh and lose everything typed.
  if (open && open.dataset.kind === kind) {
    if (open.requestSubmit) open.requestSubmit()
    else open.querySelector('[type="submit"]')?.click()
    return
  }
  box.hidden = false
  bulkRedraw(kind)
  bulkEnquirySteps()
  box.scrollIntoView({ block: 'start', behavior: reduced ? 'instant' : 'smooth' })
  const h = $('.flow-head', box)
  if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }) }
}

function bulkPage(tab = 'order') {
  const was = bulkTab
  bulkTab = tab
  document.title = `${BULK_TABS.find((x) => x.id === tab).name} · VMR Mangoes`
  // Farm visit: the hero, how it works, then the form, drawn at once (bulk.js). Send enquiry: its three steps first.
  host().innerHTML = pageHead('Bulk orders') + bulkTabsHTML(tab) + `<div class="bulk-panel${tab === 'farm-visit' ? ' is-farm' : ''}" id="bulk-panel" role="tabpanel" aria-labelledby="bulk-tab-${tab}" tabindex="-1">${tab === 'farm-visit' ? bulkFarmHeroHTML() : tab === 'enquiry' ? bulkStepsHTML() : ''}${bulkKeyHTML(tab)}${tab === 'farm-visit' ? '<section class="bulk-farm" id="bulk-farm" aria-label="Ask about a farm visit"></section>' : `
    <section class="door-cards bulk-build" id="bulk-grid" aria-label="Build your bulk list"></section>
    <section class="page-card door-flow" id="bulk-box" aria-label="${tab === 'enquiry' ? 'Your enquiry' : 'Your bulk order'}" hidden></section>`}</div>`
  bulkTabsSlide(was)
  bulkFlowReset()
  if (tab === 'farm-visit') { bulkFarmTab(); return }
  bulkBar()
  renderBulkGrid()
  loadBulkPrices().then(() => { if (document.body.dataset.page === 'bulk' && bulkTab === tab) { renderBulkGrid(); bulkBar() } })
  shelfReady().then(() => {
    if (document.body.dataset.page !== 'bulk' || bulkTab !== tab) return
    const g = $('#bulk-grid')
    if (g) g.dataset.waited = '1'
    renderBulkGrid()
    bulkBar()
  })
}

document.addEventListener('click', (e) => {
  const b = e.target instanceof Element ? e.target.closest('button,a') : null
  if (!b) return
  const d = b.dataset
  if (d.bulkCardStage || d.bulkCardPack) bulkCardSet(b)
  else if (d.bulkCardAdd) bulkAdd(b)
  else if (b.hasAttribute('data-bulk-remove')) {
    const line = bulkLines().find((x) => x.sku === d.sku && x.stage === d.stage)
    if (line) { b.dataset.bulkQty = String(-line.qty); bulkStep(b) }
  } else if (d.preOpen) openPreBooking(d.preOpen, d.sku, d.stage)
  else if (d.preBox || d.preStage || d.preStep) prePanel(b)
  else if (d.bulkQty) bulkStep(b)
  else if (b.id === 'bulk-order') openBulkEnquiry('ORDER')
  else if (b.id === 'bulk-enquiry') openBulkEnquiry('ENQUIRY')
  else if (b.hasAttribute('data-bulk-retry')) {
    loadProducts()
    $('#bulk-grid').dataset.waited = ''
    renderBulkGrid()
    shelfReady().then(() => { const g = $('#bulk-grid'); if (g) { g.dataset.waited = '1'; renderBulkGrid(); bulkBar() } })
  }
  else if (b.hasAttribute('data-bulk-edit')) {
    e.preventDefault()
    $('#bulk-grid')?.scrollIntoView({ block: 'start', behavior: reduced ? 'instant' : 'smooth' })
  }
})
// A number typed on a card's stepper; Enter settles it too (and keeps the field).
document.addEventListener('change', (e) => {
  if (e.target instanceof HTMLInputElement && e.target.classList.contains('bulk-card-qty')) bulkCardTyped(e.target)
})
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !(e.target instanceof HTMLInputElement) || !e.target.classList.contains('bulk-card-qty')) return
  e.preventDefault()
  bulkCardTyped(e.target)
})
// Another tab changed the bulk list: follow it.
window.addEventListener('storage', (e) => {
  if (e.key !== 'mm-bulk') return
  bulkList = null
  renderBulkGrid()
  bulkBar()
})

// ---- Your account: the tabs, and the orders page (/orders) with every kind of order (change request 01, CR-11).
// Two layouts, switched by the small "Layout: A | B" control on the orders page (localStorage mm-orders-layout, A unless
// changed), so the client can compare them live:
//   A: Profile | My orders | Grow with us. My orders has chips All · Shop · Pre-order · Bulk · Gifts (mm-orders-chip).
//   B: Profile | My orders | Bulk | Gifts | Grow with us (one line, sideways on phones; the last one chosen: mm-orders-tab).
//      My orders = shop orders and pre-orders; Bulk = bulk orders, enquiries with their quotes, farm visit requests and
//      farm visits; Gifts = gift orders (with each person's name and how their box is doing) and gift boxes.
// The tabs are links (/orders?tab=orders|bulk|gifts|grow), so back, forward and reload keep them; layout A reads ?tab=bulk
// and ?tab=gifts as those chips. "All" is everything, newest first: orders (GET /orders), pre-orders (GET /preorders, a
// bag as one card with its lines: pre-bag.js), gift orders (GET /gifts, MULTI_GIFT), bulk orders, enquiries and farm visit
// requests (GET /me/bulk-enquiries) and farm visits (GET /farm-bookings, only while FARM_EXPERIENCE is on: a 404 is none).
// One list that can't load leaves the others, with a note. Grow with us: the applications sent with this number
// (GET /me/partner-enquiries) and any reference added by hand (localStorage mm-partner-refs, read through the public
// status check), each drawn by partner.js pnTimeline, the same card as the /partner status check.
// Styles: style.css ("Your orders: tabs, chips, cards").

const ORD_LAYOUT = 'mm-orders-layout', ORD_CHIP = 'mm-orders-chip', ORD_TAB = 'mm-orders-tab', PN_REFS = 'mm-partner-refs'
const ORD_CHIPS = [['all', 'All'], ['shop', 'Shop'], ['pre', 'Pre-order'], ['bulk', 'Bulk'], ['gifts', 'Gifts']]
const ORD_LISTS = ['orders', 'bulk', 'gifts']
let ordData = null, ordChipNow = 'all'

const ordLayout = () => (read(ORD_LAYOUT, 'A') === 'B' ? 'B' : 'A')
const ordQuery = (k) => new URLSearchParams(location.search).get(k)
/** The orders page's tab: ?tab=, else (layout B) the last list chosen, else My orders. Layout A has no Bulk or Gifts tab. */
function ordTab() {
  const q = ordQuery('tab')
  if (q === 'grow') return 'grow'
  const b = ordLayout() === 'B'
  if (ORD_LISTS.includes(q)) return b ? q : 'orders'
  const last = read(ORD_TAB, 'orders')
  return b && ORD_LISTS.includes(last) ? last : 'orders'
}
/** Layout A's chip: ?tab=bulk or ?tab=gifts (a link from elsewhere), else the last one chosen. */
function ordChip() {
  const q = ordQuery('tab')
  if (q === 'bulk' || q === 'gifts') return q
  const c = read(ORD_CHIP, 'all')
  return ORD_CHIPS.some(([k]) => k === c) ? c : 'all'
}

/** The account's tabs for the layout in use, the current one marked. */
function accountTabs() {
  const b = ordLayout() === 'B', page = document.body.dataset.page, path = location.pathname
  const now = page === 'account' ? 'profile' : page === 'farm-bookings' ? (b ? 'bulk' : 'orders') : /^\/orders\/?$/.test(path) ? ordTab() : 'orders'
  const tabs = [['/account', 'Profile', 'profile'], ['/orders?tab=orders', 'My orders', 'orders'], ...(b ? [['/orders?tab=bulk', 'Bulk', 'bulk'], ['/orders?tab=gifts', 'Gifts', 'gifts']] : []), ['/orders?tab=grow', 'Grow with us', 'grow']]
  // farm.js adds a "Farm visits" tab to any account tabs without a /farm-bookings link: farm visits are in Bulk now, so
  // the (hidden) link tells it there is nothing to add.
  return `<nav class="page-tabs acct-tabs${b ? ' is-wide' : ''}" aria-label="Your account">${tabs.map(([href, label, key]) => `<a href="${href}" data-route${key === now ? ' aria-current="page"' : ''}>${label}</a>`).join('')}<a href="/farm-bookings" data-route hidden tabindex="-1" aria-hidden="true"></a></nav>${b ? '<p class="acct-tabs-hint" aria-hidden="true">Swipe for more tabs</p>' : ''}`
}

/** The chosen account tab (layout B scrolls sideways on phones) and the chosen chip (layout A) scrolled fully into view in
    their own strip, never the page: the last tab, "Grow with us", sat half outside the strip (CR-01 acceptance test). */
function ordRevealCurrent() {
  requestAnimationFrame(() => {
    for (const [strip, on] of [[$('.acct-tabs'), $('.acct-tabs [aria-current="page"]')], [$('.ord-chips'), $('.ord-chips [aria-pressed="true"]')]]) {
      if (!strip || !on || strip.scrollWidth <= strip.clientWidth + 1) continue
      const s = strip.getBoundingClientRect(), r = on.getBoundingClientRect(), pad = 16
      if (r.left < s.left) strip.scrollLeft -= s.left - r.left + pad
      else if (r.right > s.right) strip.scrollLeft += r.right - s.right + pad
    }
  })
}
window.addEventListener('mm:route', ordRevealCurrent)

/** "Layout: A | B" (signed in, orders page only). */
function ordLayoutSwitch() {
  const l = ordLayout()
  return `<div class="ord-layout" role="group" aria-label="Orders layout"><span>Layout:</span>${['A', 'B'].map((k) => `<button type="button" data-ord-layout="${k}" aria-pressed="${k === l}" title="${k === 'A' ? 'Three tabs, with filter chips in My orders' : 'Five tabs: My orders, Bulk and Gifts apart'}">${k}</button>`).join('<span aria-hidden="true">|</span>')}</div>`
}

async function accountOrdersView(seq = ++sheetSeq) {
  const tab = ordTab(), q = ordQuery('tab')
  if (ordLayout() === 'B' && ORD_LISTS.includes(q)) save(ORD_TAB, q)
  if (ordLayout() === 'A' && (q === 'bulk' || q === 'gifts')) save(ORD_CHIP, q)
  document.title = `${tab === 'grow' ? 'Grow with us' : 'Your orders'} · VMR Mangoes`
  const top = head(tab === 'grow' ? 'Your account' : 'Your orders') + marker(seq) + ordLayoutSwitch()
  host().innerHTML = top + `<p>${tab === 'grow' ? 'Loading your applications…' : 'Loading your orders…'}</p>`
  ordRevealCurrent()
  if (tab === 'grow') return accountGrow(seq, top)
  const [ro, rp, rg, rb, rf] = await Promise.allSettled([MM.orders(), MM.preorders(), giftOrdersFor(), MM.myBulkEnquiries().then((r) => r.items || []), ordFarmBookings()])
  if (!alive(seq)) return
  const got = (r) => (r.status === 'fulfilled' ? r.value || [] : null)
  // A list whose feature is off answers 404: nothing to show, not an error.
  const none = (r) => r.status === 'rejected' && r.reason && r.reason.status === 404
  const signedOut = [ro, rp].some((r) => r.status === 'rejected' && r.reason && r.reason.status === 401)
  ordData = { ro, rp, rg, orders: got(ro), pres: got(rp), bulk: none(rb) ? [] : got(rb), farm: none(rf) ? [] : got(rf) }
  const missing = [[ordData.orders, 'your orders'], [ordData.pres, 'your pre-orders'], [ordData.bulk, 'your bulk orders'], [rg.status === 'rejected' ? null : [], 'your gifts']].filter(([v]) => !v).map(([, w]) => w)
  ordData.miss = missing.length ? `We couldn’t load ${listOf(missing)} just now, so they aren’t shown. Please try again in a minute.` : ''
  if (signedOut || (!ordData.orders && !ordData.pres && !ordData.bulk)) {
    host().innerHTML = top + `<div class="page-card"><p class="prototype-tag" role="alert">${esc(signedOut ? 'Please sign in again to see your orders.' : ro.reason?.message || 'We couldn’t load your orders. Please try again.')}</p></div>`
    return
  }
  ordChipNow = ordChip()
  host().innerHTML = top + `<div class="page-card ord-card">${ordLayout() === 'A' ? '<div class="ord-chips" role="group" aria-label="Show"></div>' : ''}<div id="ord-list"></div></div>`
  ordPaint(tab)
}

/** Every row: { at (for newest first), kinds (the chips and tabs it shows under), html }. */
function ordRows(d) {
  const rows = [], gift = (x) => (typeof bagGiftTag === 'function' && bagGiftTag(x) ? ['gifts'] : [])
  const became = new Set((d.pres || []).filter((p) => p.status === 'CONVERTED' && p.orderId).map((p) => p.orderId))
  for (const g of giftListed(d.rg) || []) rows.push({ at: String(g.placedAt || g.deliveryDate || ''), kinds: ['gifts'], html: ordGiftRow(g) })
  for (const o of (d.orders || []).filter((o) => !giftHides(o, d.rg))) {
    const pre = became.has(o.id)
    rows.push({ at: String(o.placedAt || o.createdAt || o.deliveryDate || ''), kinds: [pre ? 'pre' : 'shop', ...gift(o)], html: orderRow(o, pre) })
  }
  // A bag is one row; a gift for one person is ONE row (and counts once under Gifts), whatever its number of boxes.
  for (const r of preBagRows((d.pres || []).filter((p) => !(p.status === 'CONVERTED' && p.orderId && d.orders)))) {
    rows.push({ at: preRowsAt(r), kinds: ['pre', ...(r.gift || r.lines.some((p) => gift(p).length) ? ['gifts'] : [])], html: preRowsHTML(r, 'ord-bag') })
  }
  for (const x of d.bulk || []) rows.push({ at: String(x.createdAt || ''), kinds: ['bulk'], html: ordBulkRow(x, x.unread || x.id === ordQuery('enquiry')) })
  for (const b of d.farm || []) rows.push({ at: String(b.createdAt || ''), kinds: ['bulk'], html: ordFarmRow(b) })
  return rows.sort((a, b) => b.at.localeCompare(a.at))
}

const ORD_SHOWS = { all: () => true, orders: (k) => k.includes('shop') || k.includes('pre'), shop: (k) => k.includes('shop'), pre: (k) => k.includes('pre'), bulk: (k) => k.includes('bulk'), gifts: (k) => k.includes('gifts') }
/** What an empty list says will appear there, and where to start one. */
function ordEmpty(which) {
  const pre = typeof preSeason === 'function' && preSeason()
  const browse = (label) => `<button class="button primary bag-explore" data-browse>${label} ${icon('arrow')}</button>`
  const link = (href, label) => `<a class="button primary bag-explore" href="${href}" data-route>${label} ${icon('arrow')}</a>`
  const [ic, title, line, cta] = {
    all: ['box', 'No orders yet.', 'Your shop orders, pre-orders, bulk orders and gifts will all appear here, newest first.', browse('Explore the mangoes')],
    orders: ['box', 'No orders yet.', 'Your shop orders and pre-orders will appear here, newest first.', browse('Explore the mangoes')],
    shop: ['bag', 'No shop orders yet.', 'The boxes you order from the shop will appear here.', browse('Shop the mangoes')],
    pre: ['sun', 'No pre-orders yet.', 'The boxes you book before the season will appear here, each with its delivery week.', pre ? link('/', 'Pre-order a box') : browse('Explore the mangoes')],
    bulk: ['box', 'No bulk orders yet.', 'Bulk orders, enquiries with their quotes, and farm visit requests will appear here.', link('/bulk', 'Order in bulk')],
    gifts: ['gift', 'No gifts yet.', 'The gifts you send will appear here, with each person’s name and how their box is doing.', link('/gifts', 'Send a gift')],
  }[which]
  return `<div class="empty-cart bag-empty empty-state ord-empty">${icon(ic)}<h2>${title}</h2><p>${line}</p>${cta}</div>`
}

/** Draws the list for the tab (B) or chip (A) from the lists already read; the chips are switched without reading again. */
function ordPaint(tab = ordTab()) {
  const list = $('#ord-list')
  if (!list || !ordData) return
  const rows = ordRows(ordData), a = ordLayout() === 'A', which = a ? ordChipNow : tab
  const chips = $('.ord-chips')
  if (chips) {
    chips.innerHTML = ORD_CHIPS.map(([k, label]) => {
      const n = rows.filter((r) => ORD_SHOWS[k](r.kinds)).length
      return `<button type="button" class="ord-chip" data-ord-chip="${k}" aria-pressed="${k === which}">${label}${n ? ` <span class="ord-count">${n}</span>` : ''}</button>`
    }).join('')
  }
  const shown = rows.filter((r) => ORD_SHOWS[which](r.kinds))
  list.innerHTML = (ordData.miss ? `<p class="prototype-tag orders-partial" role="alert">${icon('info')}<span>${esc(ordData.miss)}</span></p>` : '') + (shown.length ? shown.map((r) => r.html).join('') : ordEmpty(which))
  if (which === 'all' || which === 'bulk') ordBulkOpened()
  ordRevealCurrent()
}

// ---- Bulk rows: an order paid online opens its page; an enquiry with a quote opens in place to accept or decline it.

const ORD_ENQUIRY = { NEW: 'Waiting for our quote', QUOTED: 'Quote sent', ACCEPTED: 'Quote accepted', DECLINED: 'Quote declined', CLOSED: 'Closed' }
const ORD_BULK_TAG = { ORDER: ['box', 'Bulk'], ENQUIRY: ['mail', 'Enquiry'], FARM_VISIT: ['tree', 'Farm visit'] }
function ordBulkWords(x) {
  if (x.kind === 'FARM_VISIT') return FARM_VISIT_STATUS[x.status] || x.status
  if (x.kind === 'ORDER') return x.unread ? 'Price confirmed' : BULK_ORDER_STATUS[x.status] || x.status
  if (x.status === 'QUOTED' && x.quote && x.quote.validUntil && x.quote.validUntil < istDateOf(new Date().toISOString())) return 'Quote expired'
  return x.unread ? 'New quote' : ORD_ENQUIRY[x.status] || x.status
}
function ordBulkLine(x) {
  const boxes = x.boxes ? ` · ${x.boxes} ${x.boxes === 1 ? 'box' : 'boxes'}` : ''
  if (x.kind === 'FARM_VISIT') {
    const f = x.farmVisit || {}
    return `${f.variety ? esc(f.variety) : 'Mango not chosen yet'}${x.quantityKg ? ` · ${x.quantityKg} kg` : ''}${f.people ? ` · ${f.people} ${f.people === 1 ? 'person' : 'people'}` : ''} · ${f.plannedDate ? `visit on ${fmtDate(f.plannedDate)}` : f.visitWords ? `asked for ${esc(f.visitWords)}` : f.preferredDate ? `asked for ${fmtDate(f.preferredDate)}` : 'dates flexible'}`
  }
  const q = x.quote
  if (x.kind === 'ORDER' && x.order) return `${x.quantityKg} kg${boxes}${x.order.amountPaise != null ? ` · ${paise(x.order.amountPaise)}` : ''}${x.order.refund ? (x.order.refund.refundedAt ? ' · refunded' : ' · refund on its way') : ''}`
  return `${x.quantityKg} kg${boxes}${q && x.status !== 'CLOSED' ? ` · quote ${currency(q.total)}${q.validUntil && x.status === 'QUOTED' ? ` valid till ${fmtDate(q.validUntil)}` : ''}` : ` · sent ${fmtDate(istDateOf(x.createdAt))}`}`
}
function ordBulkRow(x, open = false) {
  const [ic, tag] = ORD_BULK_TAG[x.kind] || ORD_BULK_TAG.ENQUIRY
  const dot = ['CANCELLED', 'DECLINED', 'CLOSED'].includes(x.status) ? 'raw' : ['NEW', 'QUOTED', 'PAYMENT_PENDING'].includes(x.status) ? 'semi' : 'ripe'
  const text = `<span class="dot ${dot}"></span><span><strong>${esc(orderNo(x.number))} · ${esc(ordBulkWords(x))}</strong><span class="pre-chip order-pre-chip ord-tag">${icon(ic)}${tag}</span><small>${ordBulkLine(x)}</small></span>`
  if (x.kind === 'ORDER' && x.order) return `<div class="order-row is-bulk" id="ord-${esc(x.id)}"><a class="guide-choice" href="/bulk/orders/${encodeURIComponent(x.id)}" data-route>${text}${icon('arrow')}</a></div>`
  if (x.quote && x.status !== 'CLOSED') return `<details class="order-row is-bulk ord-bulk" id="ord-${esc(x.id)}" data-ord-bulk="${esc(x.id)}"${open ? ' open' : ''}><summary class="guide-choice">${text}<span class="ord-chev" aria-hidden="true">${icon('chevron')}</span></summary><ul class="bq-list ord-bq">${bulkItem(x, true)}</ul></details>`
  return `<div class="order-row is-bulk" id="ord-${esc(x.id)}"><div class="guide-choice ord-static">${text}</div></div>`
}
/** Keeps the lists in step after a quote is answered (bulkAnswer). */
function ordBulkSeen(next) { if (ordData && ordData.bulk) ordData.bulk = ordData.bulk.map((x) => (x.id === next.id ? next : x)) }
/** The bulk list is on screen: its quotes are seen (the account dot goes), and ?enquiry=<id> opens and shows that one. */
function ordBulkOpened() {
  if (!ordData || !ordData.bulk) return
  bulkOpened(ordData.bulk)
  const want = ordQuery('enquiry'), el = want && document.getElementById(`ord-${want}`)
  if (!el) return
  if (el.tagName === 'DETAILS') el.open = true
  el.classList.add('is-target')
  requestAnimationFrame(() => el.scrollIntoView({ block: 'center', behavior: reduced ? 'instant' : 'smooth' }))
}

/** The customer's farm visits, or none while the Farm Experience is off (farm.js farmFeature: GET /v1/policy), without asking. */
const ordFarmBookings = () => (typeof farmFeature === 'function' ? farmFeature() : Promise.resolve(true)).then((on) => (on ? MM.farmBookings() : []))
/** A farm visit (Farm Experience, farm.js): its page has the check-in code and the bill. */
function ordFarmRow(b) {
  const st = (typeof FX_STATUS === 'object' && FX_STATUS[b.status]) || b.status
  const kg = typeof fxKg === 'function' ? fxKg(b.kg) : `${b.kg} kg`
  const money = typeof fxMoney === 'function' ? (b.billAmount != null ? fxMoney(b.billAmount) : `about ${fxMoney(b.total)}`) : ''
  return `<div class="order-row is-bulk"><a class="guide-choice fx-row" href="/farm-bookings/${encodeURIComponent(b.id)}" data-route><span class="dot ${['CANCELLED', 'NO_SHOW'].includes(b.status) ? 'raw' : b.status === 'PAYMENT_DUE' ? 'semi' : 'ripe'}"></span><span><strong>${esc(b.number)} · ${esc(st)}</strong><span class="pre-chip order-pre-chip ord-tag">${icon('tree')}Farm visit</span><small>${kg} ${esc(b.variety || '')} · ${fmtDate(b.visitDate)}${money ? ` · ${money}` : ''}</small></span>${icon('arrow')}</a></div>`
}

/** A gift order (gifts.js giftRows, with who each box is for when the API says: GET /v1/gifts `recipients`). */
function ordGiftRow(g) {
  const people = Array.isArray(g.recipients) ? g.recipients.filter((r) => r && r.name) : []
  const names = people.length ? `For ${listOf(people.slice(0, 3).map((r) => esc(r.name)).concat(people.length > 3 ? [`${people.length - 3} more`] : []))}` : plural(g.recipientCount, 'person', 'people')
  const each = people.length > 1 ? `<small class="ord-gift-people">${people.slice(0, 6).map((r) => `${esc(r.name)}: ${esc(STATUS[r.status] || r.status)}`).join(' · ')}${people.length > 6 ? ' · …' : ''}</small>` : people.length === 1 ? `<small class="ord-gift-people">${esc(STATUS[people[0].status] || people[0].status)}</small>` : ''
  return `<div class="order-row is-gift"><button class="guide-choice" data-gift-open="${esc(g.id)}"><span class="dot ${g.status === 'PAYMENT_PENDING' ? 'semi' : g.status === 'CANCELLED' ? 'raw' : 'ripe'}"></span><span><strong>${esc(giftNo(g.number))} · ${esc(GIFT_STATUS[g.status] || g.status)}</strong><span class="pre-chip order-pre-chip gift-chip">${icon('gift')}Gift</span><small>${names} · Delivery ${fmtDate(g.deliveryDate)} · ${currency(g.total)}</small>${each}</span>${icon('arrow')}</button>${typeof roRowHTML === 'function' ? roRowHTML(g, 'gift') : ''}</div>`
}

// ---- Grow with us: the customer's partner applications and where each one is.

function pnRefsAll() { const a = read(PN_REFS, {}); return a && typeof a === 'object' && !Array.isArray(a) ? a : {} }
/** References this customer added by hand (sent with another number), on this device. */
function pnRefsMine() { const id = (MM.profile() || {}).id, l = id ? pnRefsAll()[id] : null; return Array.isArray(l) ? l.filter((r) => /^MMP-[A-Z0-9]{8}$/.test(r)) : [] }
function pnRefsSave(list) { const id = (MM.profile() || {}).id; if (!id) return; const a = pnRefsAll(); a[id] = [...new Set(list)].slice(0, 10); save(PN_REFS, a) }

async function accountGrow(seq, top) {
  const added = pnRefsMine()
  const [rm, ...ra] = await Promise.allSettled([MM.myPartnerEnquiries(), ...added.map((r) => MM.partnerStatus(r))])
  if (!alive(seq)) return
  const off = policy && policy.features && policy.features.partnerNetwork === false
  if (off) {
    host().innerHTML = top + `<div class="page-card"><div class="empty-cart bag-empty empty-state">${icon('tree')}<h2>Grow with us isn’t open right now.</h2><p>Your applications will show here again when it reopens.</p></div></div>`
    return ordRevealCurrent()
  }
  // An API without the list yet answers 404: only the references added by hand show.
  const mine = rm.status === 'fulfilled' ? rm.value.items || [] : rm.reason && rm.reason.status === 404 ? [] : null
  const have = new Set((mine || []).map((p) => p.reference))
  const extra = added.map((ref, i) => ({ ref, r: ra[i] })).filter((x) => !have.has(x.ref))
  const phone = (MM.profile() || {}).phone || ''
  const cards = [
    ...(mine || []).map((p) => pnTimeline(p)),
    ...extra.map(({ ref, r }) => r.status === 'fulfilled' ? pnTimeline({ ...r.value, reference: r.value.reference || ref }, { remove: true })
      : `<article class="pn-app is-missing" data-pn-ref="${esc(ref)}"><p class="pn-status-msg is-bad"><strong>${r.reason && r.reason.status === 404 ? `We couldn’t find ${esc(ref)}.` : `We couldn’t check ${esc(ref)} just now.`}</strong></p><button type="button" class="text-button pn-app-drop" data-pn-forget="${esc(ref)}">Remove from this list</button></article>`),
  ]
  const refs = [...have, ...extra.map((x) => x.ref)]
  const wa = String((window.MM_CONFIG || {}).supportWhatsapp || '').trim()
  const team = /^\d+$/.test(wa)
    ? `<a class="button secondary full pn-team" href="https://wa.me/${wa}?text=${encodeURIComponent(`Hi VMR Mangoes, about my Grow with us application${refs.length ? ` ${refs.join(', ')}` : ''}`)}" target="_blank" rel="noopener">${icon('chat')} Message our team</a>`
    : `<a class="button secondary full pn-team" href="/help" data-route>${icon('chat')} Message our team</a>`
  host().innerHTML = top + `
    <section class="page-card pn-mine" aria-labelledby="pn-mine-h">
      <h2 id="pn-mine-h" class="pn-mine-h">Your applications</h2>
      <p class="page-note">The applications sent with ${phone ? `<span class="no-wrap">${esc(phone.replace(/^\+91(\d{5})(\d{5})$/, '+91 $1 $2'))}</span>` : 'your mobile number'}, and where each one is.</p>
      ${mine === null ? `<p class="prototype-tag" role="alert">We couldn’t load your applications just now. Please try again in a minute.</p>` : ''}
      ${cards.length ? cards.join('') : mine === null ? '' : `<div class="empty-cart bag-empty empty-state ord-empty">${icon('tree')}<h2>No applications yet.</h2><p>When you apply to grow with us, your application and where it is will appear here.</p><a class="button primary bag-explore" href="/partner" data-route>Apply to grow with us ${icon('arrow')}</a></div>`}
    </section>
    <section class="page-card pn-add">
      <h3>Applied with another number?</h3>
      <p class="page-note">Add the reference from your confirmation (it starts with MMP-) to follow it here too.</p>
      <form id="pn-add-form" class="pn-status-form" novalidate>
        <label class="field">Your reference<input name="ref" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="MMP-7K2QXD9T" maxlength="20" aria-describedby="pn-add-msg"></label>
        <button class="button primary" type="submit">Add</button>
      </form>
      <div id="pn-add-msg" class="pn-status-result" aria-live="polite"></div>
    </section>
    ${team}`
  ordRevealCurrent()
}

document.addEventListener('click', (e) => {
  const b = e.target instanceof Element ? e.target.closest('button') : null
  if (!b) return
  if (b.dataset.ordChip) {
    ordChipNow = b.dataset.ordChip
    save(ORD_CHIP, ordChipNow)
    // A link's ?tab=bulk chose the chip once; the choice made here is the one the address keeps.
    if (ordQuery('tab') === 'bulk' || ordQuery('tab') === 'gifts') history.replaceState(history.state, '', '/orders?tab=orders')
    ordPaint()
    $(`[data-ord-chip="${ordChipNow}"]`)?.focus()
  } else if (b.dataset.ordLayout) {
    const to = b.dataset.ordLayout, tab = ordTab(), chip = ordChip()
    if (to === ordLayout()) return
    save(ORD_LAYOUT, to)
    // The same list in the other layout: A's Bulk or Gifts chip is B's tab, and back.
    const next = tab === 'grow' ? 'grow' : to === 'B' ? (chip === 'bulk' || chip === 'gifts' ? chip : 'orders') : tab
    if (to === 'A' && (tab === 'bulk' || tab === 'gifts')) save(ORD_CHIP, tab)
    go(`/orders?tab=${next}`, { replace: true })
  } else if (b.dataset.pnForget) {
    pnRefsSave(pnRefsMine().filter((r) => r !== b.dataset.pnForget))
    toast(`${b.dataset.pnForget} removed from this list`)
    route()
  }
})

// "Applied with another number?": the reference is checked (the public status check), then kept on this device.
document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'pn-add-form') return
  e.preventDefault()
  const form = e.target, out = $('#pn-add-msg'), input = form.elements.ref, button = form.querySelector('button')
  const ref = pnReference(input.value)
  if (!ref) {
    out.innerHTML = '<p class="pn-status-msg is-bad">That doesn’t look like a reference. It starts with MMP- and has 8 letters and numbers, like MMP-7K2QXD9T.</p>'
    input.setAttribute('aria-invalid', 'true')
    return
  }
  input.removeAttribute('aria-invalid')
  input.value = ref
  if ($(`.pn-mine [data-pn-ref="${CSS.escape(ref)}"]`)) { out.innerHTML = `<p class="pn-status-msg">${esc(ref)} is already in your list.</p>`; return }
  button.disabled = true
  out.innerHTML = '<p class="pn-status-msg">Looking…</p>'
  try {
    await MM.partnerStatus(ref)
    pnRefsSave([...pnRefsMine(), ref])
    toast(`${ref} added`)
    route()
  } catch (err) {
    button.disabled = false
    out.innerHTML = err.status === 404
      ? `<p class="pn-status-msg is-bad"><strong>We couldn’t find ${esc(ref)}.</strong> Check the letters and numbers against your confirmation and try again.</p>`
      : `<p class="pn-status-msg is-bad">${esc(err.status === 429 ? 'That’s a lot of checks in a short while. Please try again in a few minutes.' : err.message)}</p>`
  }
})

// ---- The profile page.

async function accountView(seq = ++sheetSeq) {
  host().innerHTML = head('Your profile') + marker(seq) + '<p>Loading your profile…</p>'
  let me = MM.profile() || {}, addresses = [], error = ''
  try {
    ;[me, addresses] = await Promise.all([MM.me(), MM.addresses().catch(() => [])])
  } catch (e) {
    error = e.status === 401 ? 'Please sign in again.' : e.message
  }
  if (!alive(seq)) return
  const named = me.name || (MM.profile() || {}).name || ''
  const name = named || 'Mango lover', phone = me.phone || ''
  const editing = nameEditing || !named
  const favs = favorites.filter((n) => shelf.some((v) => v.name === n))
  host().innerHTML = head('Your profile') + marker(seq) + `
    ${error ? `<p class="prototype-tag" role="alert">${esc(error)}</p>` : ''}
    <section class="page-card profile-card">
      <span class="avatar" aria-hidden="true">${esc(name.trim()[0] || 'M').toUpperCase()}</span>
      ${editing
        ? `<form id="name-form" class="name-form"><label class="field">${named ? 'Your name' : 'What should we call you?'}<input name="name" maxlength="80" autocomplete="name" required value="${esc(named)}" placeholder="Your name"></label><button class="button primary" type="submit">Save</button></form>`
        : `<div><h2>${esc(name)}</h2><p>${esc(phone)} · <button class="text-button inline-link" data-edit-name>Edit name</button></p></div>`}
    </section>
    <section class="page-card">
      <h3>Saved addresses</h3>
      ${addresses.length ? addresses.map((a) => `<div class="address-row"><div><strong>${esc(a.name || 'Saved address')}</strong><small>${esc(addressText(a.address))} <span class="no-wrap">· ${esc(a.pincode)}</span></small></div><button class="text-button" type="button" data-remove-address="${esc(a.id)}" aria-label="Remove ${esc(a.name || 'saved address')}, ${esc(a.pincode)}">Remove</button></div>`).join('') : '<p class="page-note">The addresses you deliver to are saved here after your first order, ready to pick at checkout.</p>'}
    </section>
    <section class="page-card">
      <h3>Favourites</h3>
      ${favs.length ? `<div class="fav-chips">${favs.map((n) => `<button class="occasion" data-fav-open="${esc(n)}">${icon('heart')}${esc(n)}</button>`).join('')}</div>` : '<p class="page-note">Tap the heart on a mango to keep it here.</p>'}
    </section>
    <section class="page-card help-card" data-help-link hidden></section>
    <section class="page-card">
      <h3>Updates</h3>
      <label class="toggle-row"><span><strong>WhatsApp reminders</strong><small>A note a week after delivery to ask how your mangoes were.</small></span><input type="checkbox" role="switch" data-reminders ${me.remindersOptIn ? 'checked' : ''}></label>
    </section>
    <section class="page-card page-actions">
      <button class="button secondary" data-signout>Sign out</button>
    </section>`
  // Bulk orders, enquiries and their quotes, and farm visits are under My orders (accountOrdersView).
  // Help requests and our replies (help-requests.js), while the help centre is on.
  if (typeof helpAccountLink === 'function') helpAccountLink(seq)
}

// ---- The order tracking page (/orders/:id).

// The third step is "Being packed" while the box is being packed (PROCESSING) and "Packed" once it is (PACKED).
const TRACK_STEPS = [
  ['Placed', ['PAYMENT_PENDING']],
  ['Confirmed', ['CONFIRMED']],
  [(o) => (o.status === 'PROCESSING' ? 'Being packed' : 'Packed'), ['PROCESSING', 'PACKED']],
  ['On the way', ['SHIPPED', 'OUT_FOR_DELIVERY']],
  ['Delivered', ['DELIVERED']],
]
const ENDED = ['DELIVERED', 'CANCELLED', 'RTO']
const when = (t) => (t ? new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '')
let lastTrack = ''

function trackHeadline(o) {
  const name = o.rider && o.rider.firstName
  const slot = o.slot ? ` · ${esc(o.slot.label)}, ${esc(o.slot.startsAt)}–${esc(o.slot.endsAt)}` : ''
  const arriving = `Arriving ${fmtDate(o.deliveryDate)}${slot}`
  switch (o.status) {
    case 'PAYMENT_PENDING': return ['Waiting for payment', o.holdExpiresAt ? `Your ${o.planned ? 'place is' : 'mangoes are'} held until ${fmtTime(o.holdExpiresAt)}.` : arriving]
    // Backorders: some boxes are being sourced for this order's day.
    // Booked against the plan: paid, its fruit comes after that week's pre-orders.
    case 'CONFIRMED': if (o.planned && o.waitingForFruit) return [`Booked for ${fmtDate(o.deliveryDate)}`, `Confirmed when the fruit arrives${slot}. Pre-orders are delivered first, then orders like yours, oldest first. If the fruit falls short we’ll message you a new date, and you can then cancel for a full refund until it is packed.`]
      if (o.backorder && o.findingStock) return ['Confirmed. Being sourced', `Being sourced · delivery ${fmtDate(o.deliveryDate)}${slot}. We’ll message you once your mangoes are in.`]
      return [o.findingStock ? 'Confirmed. Finding your mangoes' : 'Confirmed', o.findingStock ? 'We’re lining up the right fruit for your date and will message you if anything changes.' : arriving]
    case 'PROCESSING': return ['Being packed', arriving]
    case 'PACKED': return ['Packed and ready', arriving]
    case 'SHIPPED': case 'OUT_FOR_DELIVERY': return [`${name ? esc(name) + ' is' : 'Your mangoes are'} on the way`, o.tracking ? `About ${o.tracking.etaMinutes} min · ${o.tracking.stopsAway ? `${o.tracking.stopsAway} ${o.tracking.stopsAway === 1 ? 'stop' : 'stops'} before yours` : 'you’re next'}` : `Arriving today${slot}`]
    case 'DELIVERED': return ['Delivered', o.delivery ? `${when(o.delivery.at)}${o.delivery.receivedBy ? ` · received by ${esc(o.delivery.receivedBy)}` : ''}` : 'Enjoy your mangoes.']
    case 'DELIVERY_FAILED': return ['We missed you', o.retryScheduled ? 'We’ll try again on the next delivery run.' : 'We’ll call you to arrange a new time.']
    case 'CANCELLED': return ['Cancelled', o.cancelReason === 'HOLD_EXPIRED' ? 'The payment didn’t come through in time, so the hold ran out.' : o.cancelledAt ? `Cancelled ${when(o.cancelledAt)}.` : '']
    case 'RTO': return ['Returned', 'The order came back to us. We’ll be in touch.']
    default: return [STATUS[o.status] || esc(o.status), arriving]
  }
}

function tracker(o) {
  if (['CANCELLED', 'RTO'].includes(o.status)) return ''
  const at = TRACK_STEPS.findIndex(([, list]) => list.includes(o.status === 'DELIVERY_FAILED' ? 'OUT_FOR_DELIVERY' : o.status))
  const stamp = (list) => {
    // The packing step's time: when it was packed, else when packing started.
    const t = (list.includes('PACKED') && (o.timeline || []).find((e) => e.status === 'PACKED')) || (o.timeline || []).find((e) => list.includes(e.status))
    return t ? when(t.at) : ''
  }
  return `<ol class="tracker" aria-label="Order progress">${TRACK_STEPS.map(([label, list], i) => {
    const state = i < at ? 'done' : i === at ? (o.status === 'DELIVERY_FAILED' ? 'missed' : 'current') : ''
    return `<li class="${state}"${i === at ? ' aria-current="step"' : ''}><span class="tracker-dot">${i < at || (i === at && o.status === 'DELIVERED') ? icon('check') : ''}</span><strong>${typeof label === 'function' ? label(o) : label}</strong><small>${i <= at ? stamp(list).split(', ').map((x) => `<span>${esc(x)}</span>`).join(', ') : ''}</small></li>`
  }).join('')}</ol>`
}

/** A refund in the customer's words, from the API's refund (PENDING, PROCESSED or FAILED; refundAmount in rupees here).
    The time a refund takes is the one the shop's WhatsApp messages give (mango-api chat.js): 5 to 7 working days. */
function refundWords(r) {
  if (!r) return ''
  const amount = currency(Number(r.refundAmount) || 0)
  if (r.status === 'PROCESSED') return `Refunded ${amount}${r.processedAt ? ` on ${new Date(r.processedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}`
  if (r.status === 'FAILED') return `Your refund of ${amount} didn’t go through the first time. We’re sorting it out and will message you when it’s on its way.`
  return `Refund of ${amount} is on its way (usually 5 to 7 working days)`
}
/** The refund line: a tick once paid back, a clock while on its way, a note while we sort out a failed one. */
/** In the orders list (inside the row's button) it is a <small>, not a paragraph. */
const refundLine = (r, cls = 'refund-line') => {
  if (!r) return ''
  const tag = cls === 'refund-line' ? 'p' : 'small'
  return `<${tag} class="${cls} is-${esc(String(r.status).toLowerCase())}">${icon(r.status === 'PROCESSED' ? 'check' : r.status === 'FAILED' ? 'info' : 'clock')}<span>${esc(refundWords(r))}</span></${tag}>`
}
/** A pre-order's refund (its API answer has requestedAt, refundedAt and the gateway's status) as refundWords takes it. */
const preRefund = (p) => (p && p.refund ? { status: ['processed', 'manual'].includes(p.refund.status) ? 'PROCESSED' : p.refund.status === 'failed' ? 'FAILED' : 'PENDING', refundAmount: p.total, processedAt: ['processed', 'manual'].includes(p.refund.status) ? p.refund.refundedAt : null } : null)

const PAY_METHODS = { upi: 'UPI', card: 'Card', netbanking: 'Net banking', wallet: 'Wallet', emi: 'EMI', paylater: 'Pay later', demo: 'Test payment' }

/** How the order was paid, with the references a bank or UPI app shows (the invoice prints the same). */
function paymentBlock(o) {
  const p = o.payment
  if (!p) return ''
  const how = [PAY_METHODS[p.method] || p.method || 'Online', p.vpa, p.card, p.bank, p.wallet].filter(Boolean).map(esc).join(' · ')
  const rows = [
    ['Paid by', how],
    p.upiRef && ['UPI ref no.', esc(p.upiRef)],
    p.bankRef && ['Bank ref', esc(p.bankRef)],
    p.paymentId && [`${esc(p.gateway || 'Razorpay')} payment ID`, esc(p.paymentId), 'pay-id'],
    p.paidAt && ['Paid on', when(p.paidAt)],
  ].filter(Boolean)
  return `<dl class="pay-facts">${rows.map(([k, v, c]) => `<div${c ? ` class="${c}"` : ''}><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`
}

async function trackView(id, quiet = false, seq = ++sheetSeq) {
  if (!quiet) {
    lastTrack = ''
    host().innerHTML = head('Your order') + marker(seq) + '<p>Loading your order…</p>'
  }
  let o
  try {
    o = await MM.order(id)
  } catch (e) {
    if (!alive(seq)) return
    if (quiet) setTimeout(() => alive(seq) && trackView(id, true, seq), 30000)
    else host().innerHTML = head('Your order') + marker(seq) + `<p class="prototype-tag" role="alert">${esc(e.message)}</p><button class="text-button" data-orders>All orders</button>`
    return
  }
  if (!alive(seq)) return
  const again = () => setTimeout(() => alive(seq) && trackView(id, true, seq), o.status === 'PAYMENT_PENDING' ? 5000 : 30000)
  // A quiet refresh only redraws when something changed, so the map and photo don't blink.
  const snapshot = JSON.stringify(o)
  if (quiet && snapshot === lastTrack) {
    if (!ENDED.includes(o.status)) again()
    return
  }
  lastTrack = snapshot
  const [title, sub] = trackHeadline(o)
  const left = o.holdExpiresAt ? Date.parse(o.holdExpiresAt) - Date.now() : 0
  const canPay = o.status === 'PAYMENT_PENDING' && o.razorpayOrderId && left > 60000
  const fromPre = o.preorder && o.preorder.nonRefundable
  const canCancel = o.canCancel ?? (['PAYMENT_PENDING', 'CONFIRMED', 'PROCESSING'].includes(o.status) && !fromPre)
  const pin = addressPin(o.deliveryAddress)
  const wa = String((window.MM_CONFIG || {}).supportWhatsapp || '').trim()
  host().innerHTML = head(`Order ${esc(orderNo(o.number))}`) + marker(seq) + `
    <section class="page-card track-hero status-${esc(o.status.toLowerCase())}">
      ${fromPre ? `<span class="pre-chip">${icon('sun')}Pre-order · non-refundable</span>` : ''}
      <h2>${title}</h2><p>${sub}</p>
      ${giftFor(o)}
      ${refundLine(o.refund)}
      ${tracker(o)}
      ${o.deliveryCode ? `<div class="delivery-code"><span>Delivery code</span><strong>${[...String(o.deliveryCode)].map((d) => `<i>${esc(d)}</i>`).join('')}</strong><small>Share it with ${o.rider && o.rider.firstName ? esc(o.rider.firstName) : 'your rider'} when your mangoes arrive.</small></div>` : ''}
      ${o.delivery && o.delivery.hasPhoto ? '<figure class="delivery-photo"><img alt="Photo taken at delivery" hidden><figcaption>Photo at delivery</figcaption></figure>' : ''}
      ${typeof payStateHTML === 'function' ? payStateHTML(o) : ''}
      ${canPay ? `<button class="button primary full" data-pay-order="${esc(o.id)}">${o.paymentFailed ? 'Try payment again' : 'Pay now'} ${currency(o.total)} ${icon('arrow')}</button>` : ''}
    </section>
    <section class="page-card">
      <h3>${o.gift && o.gift.recipientName ? `Delivering to ${esc(o.gift.recipientName)}` : 'Delivering to'}</h3>
      <p class="track-address">${esc(addressText(o.deliveryAddress))}${o.pincode ? ` · ${esc(o.pincode)}` : ''}${landmarkText(o)}</p>
      ${pin ? '<div class="track-map" role="img" aria-label="Delivery location on the map"></div>' : ''}
    </section>
    <section class="page-card">
      <h3>Your box${(o.items || []).length > 1 ? 'es' : ''}</h3>
      ${(o.items || []).map((l) => {
        const st = stageOf(l.stage)
        return `<div class="cart-row">${thumb(l.sku, l.stage, l.name)}<div><h3>${esc(boxName(l.name, l.sku))}</h3><small>${st.stage} · ${l.quantity} × ${currency(l.unitPrice)}${l.eatBy ? ` · best by ${fmtDate(l.eatBy)}` : ''}</small>${l.backordered && o.findingStock ? `<small class="co-sourcing">${icon('leaf')}Being sourced · delivery ${fmtDate(o.deliveryDate)}</small>` : ''}<div class="cart-row-bottom"><span></span><strong>${currency(l.linePrice)}</strong></div></div></div>`
      }).join('')}
      ${o.discount ? `<div class="subtotal"><span>Discount</span><strong>−${currency(o.discount)}</strong></div>` : ''}
      ${o.deliveryFee ? `<div class="subtotal"><span>Delivery${o.deliveryKm != null ? ` <small>about ${o.deliveryKm} km</small>` : ''}</span><strong>${currency(o.deliveryFee / 100)}</strong></div>` : ''}
      <div class="subtotal"><span>Total</span><strong>${currency(o.total)}</strong></div>
      <p class="cart-disclaimer">Placed ${when(o.placedAt)} · Prices include GST.</p>
      ${typeof roSheetHTML === 'function' ? roSheetHTML(o, 'order') : ''}
      ${paymentBlock(o)}
    </section>
    ${o.status === 'DELIVERED' ? '<section class="page-card claim-card" id="order-claim" aria-busy="true"><h3>Something wrong with your box?</h3><div class="claim-body"><p>One moment…</p></div></section>' : ''}
    <section class="page-card page-actions track-actions">
      ${/^\d+$/.test(wa) ? `<a class="button secondary" href="https://wa.me/${wa}?text=${encodeURIComponent(`Hi VMR Mangoes, about my order ${orderNo(o.number)}`)}" target="_blank" rel="noopener">Help on WhatsApp</a>` : ''}
      ${o.bill ? `<button class="button primary" data-invoice="${esc(o.id)}" data-number="${esc(o.number)}">Download invoice ${icon('arrow')}</button>` : ''}
      ${o.status === 'DELIVERED' ? `<button class="button secondary" data-review="${esc(o.id)}">${o.rating ? 'Edit your review' : 'Rate this order'}</button>` : ''}
      ${o.delayed && o.status !== 'CANCELLED' ? delayBlock(o, 'order', 'page') : canCancel ? `<button class="button secondary is-danger" data-cancel-order="${esc(o.id)}" data-number="${esc(orderNo(o.number))}">${icon('close')} Cancel order</button>` : ''}
      ${o.delayed ? '' : cancelNote(o, canCancel)}
      ${fromPre && !o.delayed && !ENDED.includes(o.status) ? `<p class="pre-nocancel">${icon('info')}<span>This was a pre-order, so it can’t be cancelled unless we delay it; then you can cancel it for a full refund until it is packed. Something wrong? ${helpLink('Message us', `Hi VMR Mangoes, about my order ${orderNo(o.number)}`)}</span></p>` : ''}
      <button class="button secondary" data-orders>All orders</button>
    </section>`
  if (pin) MapPick.readOnly($('.track-map', host()), pin).catch(() => {})
  if (o.delivery && o.delivery.hasPhoto) {
    MM.deliveryPhoto(o.id).then((b) => {
      const img = $('.delivery-photo img', host())
      if (!img || !alive(seq)) return
      img.src = URL.createObjectURL(b)
      img.hidden = false
    }, () => $('.delivery-photo', host())?.remove())
  }
  // A delivered order: report a problem with it, or the report's progress (claims.js).
  if (o.status === 'DELIVERED' && typeof orderClaimBox === 'function') orderClaimBox(o, seq)
  if (!ENDED.includes(o.status)) again()
}

// ---- Bulk enquiries (mango-api README, Bulk enquiries): the form's send, the Account page's section with
// each quote, and the signs that a quote is waiting (a dot on the account button, a banner, a toast).

const BULK_STATUS = { NEW: 'Sent · waiting for our quote', QUOTED: 'Quote ready', ACCEPTED: 'Accepted · we’ll call to arrange delivery', DECLINED: 'Declined', CLOSED: 'Closed' }
// A farm visit enquiry (bulk.js, kind FARM_VISIT): sent, then our team calls, plans the visit, and it happens.
const FARM_VISIT_STATUS = { NEW: 'We will call you', CONTACTED: 'We called you', VISIT_PLANNED: 'Visit planned', VISITED: 'Visited', CLOSED: 'Closed' }
// A bulk order placed directly reads differently while it waits and once it is priced.
const BULK_ORDER_STATUS = {
  NEW: 'Placed · our agent will call you', QUOTED: 'Price confirmed · please accept',
  // Paid at once (bulk.js): the order page has the receipt, the cancel window and any refund.
  PAYMENT_PENDING: 'Waiting for payment', PAID: 'Paid · we will call you', CONFIRMED: 'Paid · delivery arranged', DISPATCHED: 'On its way', DELIVERED: 'Delivered', CANCELLED: 'Cancelled',
}
let bulkMine = []
const paise = (n) => currency((Number(n) || 0) / 100)

function bulkError(e) {
  if (e.code === 'NETWORK') return 'You seem to be offline. Your details are still here: send it again when you’re back online.'
  if (e.status === 404) return 'Bulk orders are paused right now. Message us on WhatsApp instead.'
  if (e.code === 'BULK_TOO_SMALL') return `Bulk orders start at ${BULK_MIN_KG} kg. Add more boxes to place the order.`
  if (e.code === 'BULK_ENQUIRY_TOO_SMALL') return BULK_ENQUIRY_MIN_TEXT
  return e.message || 'We couldn’t send it. Please try again.'
}

/** The bulk form's submit (app.js): sends it to VMR Mangoes, then shows the enquiry number. */
async function sendBulkEnquiry(form) {
  if (form.dataset.busy) return
  const data = Object.fromEntries(new FormData(form)), listed = !!form.querySelector('.bulk-lines'), order = form.dataset.kind === 'ORDER'
  const lines = listed ? bulkSummary().map(({ sku, stage, boxes, kg, packKg }) => ({ sku, stage, boxes, kg, ...(packKg ? { packKg } : {}) })) : []
  const said = listed ? bulkSummary() : []
  const kg = listed ? bulkTotals().kg : Number(data.quantity)
  const fail = (message) => {
    const el = $('.bulk-error', form)
    if (el) { el.textContent = message; el.hidden = false; el.scrollIntoView({ block: 'nearest', behavior: reduced ? 'instant' : 'smooth' }) }
  }
  // The shop's own inline errors (the form is novalidate): each invalid field says what it needs, the first one takes focus.
  $('.bulk-error', form).hidden = true
  if (!checkFields(form, [
    ['name', (v) => v ? '' : 'Tell us your name.'],
    ['phone', (v) => /^[6-9]\d{9}$/.test(normPhone(v)) ? '' : 'Enter a 10-digit mobile number.'],
    ['email', (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? '' : 'That email doesn’t look right.'],
    ['city', (v) => v ? '' : 'Tell us the delivery city.'],
  ])) return
  if (order ? !lines.length || kg < BULK_MIN_KG : listed ? !lines.length : !(kg >= 1)) return fail(order ? `Bulk orders start at ${BULK_MIN_KG} kg. Add more boxes to place the order.` : 'Tell us how many kg you need.')
  if (!order && kg < BULK_ENQUIRY_MIN_KG) return fail(BULK_ENQUIRY_MIN_TEXT)
  const phone = normPhone(data.phone)
  save('mm-bulk-draft', { name: data.name || '', business: data.business || '', email: data.email || '', phone: data.phone || '', city: data.city || '' })
  const body = {
    name: String(data.name || '').trim(), business: String(data.business || '').trim() || null, email: String(data.email || '').trim() || null, phone,
    city: String(data.city || '').trim(), notes: String(data.notes || '').trim() || null,
    ...(listed ? { lines } : { quantityKg: Math.round(kg), ripeness: data.ripeness || null }),
    ...(order ? { kind: 'ORDER' } : {}),
  }
  // AUTH-01: the Turnstile check, when the shop has it on (app.js formCaptcha).
  if (bulkCap.captchaOn && !bulkCap.captcha) return fail(CAPTCHA_ASK)
  // One key per filled-in form: a retry after a dropped connection is the same enquiry.
  form.dataset.key ||= MM.idem()['Idempotency-Key']
  const button = form.querySelector('[type="submit"]')
  form.dataset.busy = '1'
  if (button) { button.disabled = true; button.firstChild.textContent = 'Sending… ' }
  $('.bulk-error', form).hidden = true
  let r
  try {
    r = await MM.bulkEnquiry(body, form.dataset.key, bulkCap.captcha)
  } catch (e) {
    delete form.dataset.busy
    resetFormCaptcha(bulkCap)
    if (button) { button.disabled = false; button.firstChild.textContent = order ? 'Place bulk order ' : 'Send enquiry ' }
    return fail(bulkError(e))
  }
  if (listed) { save('mm-bulk', []); bulkList = null; renderBulkGrid(); bulkBar() }
  const box = form.closest('#bulk-box') ? '#bulk-box' : '#form-dialog'
  const wa = String((window.MM_CONFIG || {}).supportWhatsapp || '').trim(), waOk = /^\d+$/.test(wa)
  const text = [`VMR Mangoes — Bulk ${order ? 'order' : 'enquiry'} ${orderNo(r.number)}`, `Name: ${body.name}`, ...(body.business ? [`Business: ${body.business}`] : []), `Phone: +91 ${phone}`, ...(body.email ? [`Email: ${body.email}`] : []), `City: ${body.city}`,
    ...(listed ? said.map((l) => `${l.label} · ${l.boxes} ${l.boxes === 1 ? 'box' : 'boxes'} · ${l.kg} kg`) : [`Quantity: ${body.quantityKg} kg${body.ripeness ? ` (${body.ripeness})` : ''}`]),
    ...(body.notes ? [`Note: ${body.notes}`] : [])].join('\n')
  const signed = !!MM.profile()
  // One heading: the card's own ("Order B-743 406 080 placed."); the sheet keeps only its close button.
  $(box).innerHTML = (box === '#form-dialog' ? `<div class="sheet-head is-bare"><button class="icon-button" data-close aria-label="Close form">${icon('close')}</button></div>` : '') + `<div class="success bulk-sent" data-kind="${order ? 'ORDER' : 'ENQUIRY'}">${icon('check')}<h2>${order ? 'Order' : 'Enquiry'} <span class="no-wrap">${esc(orderNo(r.number))}</span> ${order ? 'placed' : 'sent'}.</h2>
    ${order ? `<p>Our agent will <strong>call and WhatsApp you on +91 ${esc(phone)}</strong> to confirm your wholesale price, the delivery day (${BULK_DAYS}) and payment. Nothing is charged until then. Delivery is ${BULK_DELIVERY_PCT}% of the order value.</p>` : `<p>We’ll price it and send the quote on WhatsApp to <strong>+91 ${esc(phone)}</strong>, and you’ll see it here under your account.</p>`}
    ${signed ? `<a class="button primary" href="/orders?tab=bulk&enquiry=${encodeURIComponent(r.id)}" data-route>View in your orders ${icon('arrow')}</a>` : `<button class="button primary" data-bulk-signin="${esc(r.id)}">Sign in to track it ${icon('arrow')}</button>`}
    ${waOk ? `<a class="button secondary" href="https://wa.me/${wa}?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">Also send on WhatsApp</a>` : ''}
    <button class="text-button" data-close style="margin:15px auto 0">Back to the mangoes ${icon('arrow')}</button></div>`
  bulkBar()
  const h = $('h2', $(box))
  if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }) }
  $(box).scrollIntoView({ block: 'start', behavior: reduced ? 'instant' : 'smooth' })
  bulkWatch()
}

/** One bulk order, enquiry or farm visit with its quote (accept or decline) and payment. `bare`: inside its row on the
 *  orders page (ordBulkRow), which already says its number, kind and status. */
function bulkItem(x, bare = false) {
  const q = x.quote, what = `${x.quantityKg} kg${x.boxes ? ` · ${x.boxes} ${x.boxes === 1 ? 'box' : 'boxes'}` : ''}`
  const open = x.status === 'QUOTED' && q
  return `<li class="bq-item${x.unread ? ' is-new' : ''}${bare ? ' is-bare' : ''}" id="enquiry-${esc(x.id)}" data-enquiry="${esc(x.id)}"${bare ? ' data-bare' : ''}>
    ${bare ? '' : `<div class="bq-head"><div><strong>${esc(orderNo(x.number))}</strong><small>${x.kind === 'ORDER' ? 'Bulk order' : x.kind === 'FARM_VISIT' ? 'Farm visit enquiry' : 'Enquiry'} · ${x.kind === 'FARM_VISIT' ? 'sent ' : ''}${fmtDate(istDateOf(x.createdAt))} · ${esc(what)}</small></div><span class="bq-chip is-${x.status.toLowerCase()}">${x.kind === 'FARM_VISIT' ? (FARM_VISIT_STATUS[x.status] || esc(x.status)) : x.unread ? (x.kind === 'ORDER' ? 'Price confirmed' : 'New quote') : (x.kind === 'ORDER' && BULK_ORDER_STATUS[x.status]) || BULK_STATUS[x.status] || esc(x.status)}</span></div>`}
    ${x.farmVisit && !bare ? `<p class="bq-done">${icon('leaf')}<span>${x.farmVisit.variety ? esc(x.farmVisit.variety) : 'Mango not chosen yet'} · ${x.farmVisit.people} ${x.farmVisit.people === 1 ? 'person' : 'people'} · ${x.farmVisit.plannedDate ? `visit on <strong>${fmtDate(x.farmVisit.plannedDate)}</strong>` : x.farmVisit.visitWords ? `you asked for ${esc(x.farmVisit.visitWords)}` : x.farmVisit.preferredDate ? `you asked for ${fmtDate(x.farmVisit.preferredDate)}` : 'dates flexible'}${x.status === 'CLOSED' && x.farmVisit.closeReason ? ` · closed: ${esc(x.farmVisit.closeReason)}` : ''}</span></p>` : ''}
    ${x.order ? `<p class="bq-done"><span>${x.order.amountPaise != null ? `${paise(x.order.amountPaise)} · ` : ''}${x.order.refund ? (x.order.refund.refundedAt ? 'refunded in full' : 'refund on its way') : x.status === 'PAYMENT_PENDING' ? 'not paid yet' : x.status === 'CANCELLED' ? 'cancelled' : 'paid in full'}</span> <a class="text-button inline-link" href="/bulk/orders/${encodeURIComponent(x.id)}" data-route>View order ${icon('arrow')}</a></p>` : ''}
    ${q && x.status !== 'CLOSED' ? `<div class="bq-quote" aria-label="Quote for ${esc(orderNo(x.number))}">
      <ul class="bq-lines">${q.lines.map((l) => `<li><span>${esc(l.label)} <small>× ${l.qty} @ ${currency(l.unitPrice)}</small></span><strong>${currency(l.linePrice)}</strong></li>`).join('')}
      ${q.extras.map((e) => `<li class="bq-extra"><span>${esc(e.label)}</span><strong>${paise(e.amount)}</strong></li>`).join('')}
      ${q.deliveryFee ? `<li class="bq-extra"><span>Delivery fee <small>(${Number(q.deliveryPct) || BULK_DELIVERY_PCT}% of the order value)</small></span><strong>${paise(q.deliveryFee)}</strong></li>` : ''}</ul>
      ${q.note ? `<p class="bq-note">${esc(q.note)}</p>` : ''}
      <p class="bq-total"><span>Total${q.validUntil ? ` <small>valid until ${fmtDate(q.validUntil)}</small>` : ''}</span><strong>${currency(q.total)}</strong></p>
      ${open ? `<div class="bq-actions"><button class="button primary" data-bulk-accept="${esc(x.id)}">Accept quote ${icon('check')}</button><button class="button secondary" data-bulk-decline="${esc(x.id)}">Decline</button></div>
        <form class="bq-decline" data-bulk-decline-form="${esc(x.id)}" hidden><label class="field">Tell us why <small>(optional)</small><textarea name="message" rows="2" maxlength="1000" placeholder="Price, timing, quantity…"></textarea></label><div class="bq-actions"><button class="button primary" type="submit">Decline quote</button><button class="text-button" type="button" data-bulk-decline-cancel>Keep it</button></div></form>` : ''}
      ${x.status === 'ACCEPTED' ? `<p class="bq-done">${icon('check')}<span>You accepted this quote. We’ll call you to arrange delivery and payment.</span></p>` : ''}
      ${x.status === 'DECLINED' ? `<p class="bq-done">You declined this quote${x.customerMessage ? `: “${esc(x.customerMessage)}”` : ''}. Message us if you’d like a new one.</p>` : ''}
    </div>` : ''}
  </li>`
}

/** The account page is open: the quotes it shows are seen, and ?enquiry=<id> scrolls to that one. */
function bulkOpened(items) {
  bulkMine = items
  const want = new URLSearchParams(location.search).get('enquiry')
  const unseen = items.filter((x) => x.unread)
  if (unseen.length) {
    Promise.all(unseen.map((x) => MM.bulkSeen(x.id).catch(() => null))).then(() => {
      for (const x of unseen) x.unread = false
      bulkSigns()
    })
  }
  const el = want && document.getElementById(`enquiry-${want}`)
  if (el) {
    el.classList.add('is-target')
    requestAnimationFrame(() => el.scrollIntoView({ block: 'center', behavior: reduced ? 'instant' : 'smooth' }))
  }
}

async function bulkAnswer(id, decision, message, button) {
  if (button) button.disabled = true
  try {
    const next = await MM.bulkRespond(id, decision, message)
    toast(decision === 'ACCEPT' ? `Quote accepted. We’ll call you to arrange delivery.` : 'Quote declined. Thank you for letting us know.')
    bulkMine = bulkMine.map((x) => (x.id === id ? next : x))
    const li = document.getElementById(`enquiry-${id}`)
    // On the orders page the whole row is drawn again (its status line changes too); on its own, the item.
    const row = li && li.closest('[data-ord-bulk]')
    if (row) { ordBulkSeen(next); row.outerHTML = ordBulkRow(next, true); document.querySelector(`[data-ord-bulk="${CSS.escape(id)}"] summary`)?.focus() }
    else if (li) { li.outerHTML = bulkItem(next); document.getElementById(`enquiry-${id}`)?.querySelector('.bq-chip')?.setAttribute('tabindex', '-1') }
    bulkSigns()
  } catch (e) {
    if (button) button.disabled = false
    toast(e.message)
  }
}

// ---- The signs: a dot on the account buttons, a banner on the shop and bulk pages, a toast once per quote.

const BULK_DISMISSED = 'mm-bulk-dismissed', BULK_TOASTED = 'mm-bulk-toasted'
async function bulkWatch() {
  if (!window.MM || !MM.profile()) { bulkMine = []; bulkSigns(); return }
  try { bulkMine = (await MM.myBulkEnquiries()).items || [] } catch { return }
  bulkSigns()
  const toasted = read(BULK_TOASTED, [])
  const fresh = bulkMine.filter((x) => x.unread && !toasted.includes(`${x.id}:${x.quotedAt}`))
  if (fresh.length && !['account', 'orders'].includes(document.body.dataset.page)) {
    toast(fresh.length === 1 ? `New bulk quote ready: ${orderNo(fresh[0].number)}` : `${fresh.length} new bulk quotes ready`)
    save(BULK_TOASTED, [...toasted, ...fresh.map((x) => `${x.id}:${x.quotedAt}`)].slice(-30))
  }
}

function bulkSigns() {
  const unread = bulkMine.filter((x) => x.unread)
  for (const a of $$('a[href="/account"], [data-account]')) {
    a.classList.toggle('has-updates', unread.length > 0)
    if (!a.querySelector('.update-dot')) a.insertAdjacentHTML('beforeend', '<span class="update-dot" aria-hidden="true"></span>')
    const base = a.dataset.baseLabel ||= a.getAttribute('aria-label') || 'Your profile and orders'
    a.setAttribute('aria-label', unread.length ? `${base} (${unread.length === 1 ? 'a new bulk quote' : `${unread.length} new bulk quotes`})` : base)
  }
  const dismissed = read(BULK_DISMISSED, [])
  const show = unread.find((x) => !dismissed.includes(`${x.id}:${x.quotedAt}`))
  let bar = $('#bulk-quote-banner')
  if (!show || ['account', 'orders'].includes(document.body.dataset.page)) { if (bar) bar.hidden = true; return }
  if (!bar) {
    bar = document.createElement('aside')
    bar.id = 'bulk-quote-banner'
    bar.className = 'bulk-banner wrap'
    bar.setAttribute('aria-label', 'Your bulk quote')
    $('header.header').insertAdjacentElement('afterend', bar)
  }
  bar.innerHTML = `<a class="bulk-banner-go" href="/orders?tab=bulk&enquiry=${encodeURIComponent(show.id)}" data-route>${icon('box')}<span><strong>Your bulk quote is ready</strong><small>${esc(orderNo(show.number))} · ${currency(show.quote.total)}</small></span><span class="bulk-banner-cta">View quote ${icon('arrow')}</span></a><button class="bulk-banner-close" data-bulk-dismiss="${esc(show.id)}:${esc(show.quotedAt)}" aria-label="Hide this for now">${icon('close')}</button>`
  bar.hidden = false
}

document.addEventListener('click', (e) => {
  const b = e.target instanceof Element ? e.target.closest('button') : null
  if (!b) return
  const d = b.dataset
  if (d.bulkAccept) bulkAnswer(d.bulkAccept, 'ACCEPT', null, b)
  else if (d.bulkDecline) {
    const f = document.querySelector(`[data-bulk-decline-form="${CSS.escape(d.bulkDecline)}"]`)
    if (f) { f.hidden = false; f.previousElementSibling.hidden = true; f.querySelector('textarea').focus({ preventScroll: true }); f.scrollIntoView({ block: 'center', behavior: reduced ? 'instant' : 'smooth' }) }
  } else if (b.hasAttribute('data-bulk-decline-cancel')) {
    const f = b.closest('form')
    f.hidden = true
    f.previousElementSibling.hidden = false
    f.previousElementSibling.querySelector('[data-bulk-decline]')?.focus()
  } else if (d.bulkDismiss) {
    save(BULK_DISMISSED, [...read(BULK_DISMISSED, []), d.bulkDismiss].slice(-30))
    bulkSigns()
  } else if (d.bulkSignin) {
    closeDialogs()
    go(`/login?next=${encodeURIComponent(`/orders?tab=bulk&enquiry=${d.bulkSignin}`)}`)
  }
})
document.addEventListener('submit', (e) => {
  const id = e.target.dataset && e.target.dataset.bulkDeclineForm
  if (!id) return
  e.preventDefault()
  bulkAnswer(id, 'DECLINE', String(new FormData(e.target).get('message') || '').trim() || null, e.target.querySelector('[type="submit"]'))
})
// Signing in or out, and moving between pages (the banner stays off the account page, where the quote is).
window.addEventListener('mm:profile', () => bulkWatch())
window.addEventListener('mm:route', () => bulkSigns())

// ---- The business details and the four policy pages (/privacy, /terms, /refund, /shipping).
// Legal copy: a draft from the shop's own rules, to be confirmed by the owner's CA/lawyer. Every number comes from the
// same place the rest of the shop reads it (cancelHours(), GET /v1/policy, BULK_DAYS), so a page never drifts from the
// API. A business detail the build did not set (build-config.mjs: BUSINESS_NAME, BUSINESS_ADDRESS, FSSAI_NUMBER, GSTIN,
// SUPPORT_EMAIL…) is left out, never shown as a placeholder. Styles: style.css (.legal-, .footer-legal).

/** The contact and business details the build wrote into config.js: '' for each one it did not. */
function bizInfo() {
  const c = window.MM_CONFIG || {}, s = (k) => String(c[k] || '').trim()
  const wa = s('supportWhatsapp')
  return { legalName: s('businessName'), name: s('businessName') || 'VMR Mangoes', address: s('businessAddress'), fssai: s('fssaiNumber'), gstin: s('gstin'), phone: s('supportPhone'), email: s('supportEmail'), wa: /^\d+$/.test(wa) ? wa : '' }
}

/** The footer's small print: name, address, FSSAI and GSTIN, only those that are set (called once on load). */
function footerLegal() {
  const el = document.getElementById('footer-legal')
  if (!el) return
  const b = bizInfo()
  const parts = [b.legalName, b.address, b.fssai && `FSSAI Lic. No. ${b.fssai}`, b.gstin && `GSTIN ${b.gstin}`].filter(Boolean)
  el.textContent = parts.join(' · ')
  el.hidden = !parts.length
}
footerLegal()

/** "Full policy", appended to each note that states a cancelling rule (checkout, pre-order, bulk, gift, order page). */
const policyLink = () => ` <a class="text-button inline-link" href="/refund" data-route>Full policy</a>`

const LEGAL_UPDATED = '23 November 2026'
const LEGAL_PAGES = { privacy: 'Privacy policy', terms: 'Terms and conditions', refund: 'Refund and cancellation policy', shipping: 'Shipping and delivery' }
const LEGAL_TITLES = Object.values(LEGAL_PAGES).map((t) => `${t} · VMR Mangoes`)
let legalPolicy = null

PAGES.push([/^\/(privacy|terms|refund|shipping)\/?$/, (m) => legalView(m[1])])

/** The live rules (GET /v1/policy), from app.js once it has them, else asked here once. */
const legalPol = () => (typeof policy !== 'undefined' && policy) || legalPolicy
/** The cancel window, in hours: cancelHours() (the API's cancelWindowHours), also before app.js has the policy. */
const legalHours = () => { const h = Number(legalPol() && legalPol().cancelWindowHours); return hoursWord(Number.isFinite(h) && h > 0 ? h : cancelHours()) }
const legalClaim = () => { const h = Number(legalPol() && legalPol().claimWindowHours); return Number.isFinite(h) && h > 0 ? `within ${hoursWord(h)} of delivery` : 'soon after delivery' }
const legalRs = (paise) => currency(Math.round(Number(paise) || 0) / 100)

function legalView(key) {
  document.title = `${LEGAL_PAGES[key]} · VMR Mangoes`
  const body = { privacy: privacyHTML, terms: termsHTML, refund: refundHTML, shipping: shippingHTML }[key]()
  host().innerHTML = `<!-- Legal copy: a draft from the shop's own rules, to be confirmed by the owner's CA/lawyer. -->` + pageHead(LEGAL_PAGES[key]) + body +
    `<section class="page-card help-card legal-card legal-foot"><p>${legalOthers(key)}</p><p class="legal-updated">Last updated ${LEGAL_UPDATED}</p></section>`
  // The numbers once the policy has loaded, if it hadn't yet.
  if (!legalPol()) MM.policy().then((p) => { legalPolicy = p; if (p && document.body.dataset.page === key) legalView(key) }).catch(() => {})
}

const legalSec = (title, ...paras) => `<section class="page-card help-card legal-card"><h2 class="flow-head">${title}</h2>${paras.filter(Boolean).map((p) => p.startsWith('<') ? p : `<p>${p}</p>`).join('')}</section>`
const legalOthers = (key) => 'Our other policies: ' + Object.entries(LEGAL_PAGES).filter(([k]) => k !== key).map(([k, t]) => `<a href="/${k}" data-route>${t}</a>`).join(', ') + '.'
/** How to reach us about this page, as a sentence: the email and phone when set, the help form only while the help centre
 *  is on (the policy's care.helpCentre), WhatsApp when set; with none of them, our address, else the Contact page. */
function legalAsk() {
  const b = bizInfo(), p = legalPol(), form = Boolean(p && p.care && p.care.helpCentre)
  const ways = [
    b.email && `email <a href="mailto:${esc(b.email)}">${esc(b.email)}</a>`,
    b.phone && `call <a href="tel:${esc(b.phone.replace(/[^\d+]/g, ''))}">${esc(b.phone)}</a>`,
    form && `send us a request from <a href="/help" data-route>Help</a>`,
    b.wa && `message us on <a href="https://wa.me/${b.wa}" target="_blank" rel="noopener">WhatsApp</a>`,
  ].filter(Boolean)
  if (!ways.length) return b.address ? `Write to us at ${esc(b.name)}, ${esc(b.address)}` : 'See <a href="/contact" data-route>Contact us</a>'
  const s = ways.length > 2 ? `${ways.slice(0, -1).join(', ')} or ${ways[ways.length - 1]}` : ways.join(' or ')
  return s[0].toUpperCase() + s.slice(1)
}
/** Who we are, in one line: the name, and the address and GSTIN when the build set them. */
function legalWho() {
  const b = bizInfo()
  return `${esc(b.name)}${b.address ? `, ${esc(b.address)}` : ''}${b.gstin ? ` (GSTIN ${esc(b.gstin)})` : ''}${b.fssai ? `, FSSAI Lic. No. ${esc(b.fssai)}` : ''}`
}

function privacyHTML() {
  return legalSec('Who we are', `This policy explains what ${legalWho()} (“we”) keeps about you when you use this shop, why, and who else sees it. We do not sell your information.`) +
    legalSec('What we keep',
      `<ul class="legal-list">
        <li><strong>Your mobile number</strong>, to sign you in with a one-time code (OTP) and to tell you about your orders.</li>
        <li><strong>Your name, delivery addresses and pincode</strong>, and the spot you drop on the delivery map if you choose to, so the rider can find you and we can work out the delivery charge.</li>
        <li><strong>Your orders, pre-orders, gift orders and payments</strong>: what you bought, for whom, when and how much. For a gift, the name, phone number and address of the person you send it to.</li>
        <li><strong>Your ratings and notes</strong> on a delivered order, and the <strong>photos and description</strong> you send when you report a problem.</li>
        <li><strong>The help requests you send us</strong> and our replies.</li>
        <li><strong>Bulk order, enquiry and farm visit details</strong>: your name, business, phone number, address, quantities and dates.</li>
        <li><strong>Grow with us applications</strong>: your answers and any files you attach.</li>
      </ul>`) +
    legalSec('Why we keep it', 'To take and deliver your orders, to take payment and give refunds, to answer you and put problems right, to send order updates on WhatsApp or SMS (and reminders only if you turn them on), to stop fake or automated orders, and to keep the accounts the law asks of us.') +
    legalSec('Who else sees it',
      `<ul class="legal-list">
        <li><strong>Razorpay</strong> takes your payment. Your card, UPI or bank details go to Razorpay and are never stored by us; we keep only the payment’s reference and amount.</li>
        <li><strong>The rider</strong> who brings your order sees your name, address and phone number for that delivery.</li>
        <li><strong>Our WhatsApp and SMS providers</strong> carry your order updates and sign-in codes to your number.</li>
        <li><strong>Cloudflare Turnstile</strong> checks that a form is sent by a person, not a bot.</li>
        <li><strong>Google Maps or OpenStreetMap</strong> look up an address or place when you search for one or use the delivery map.</li>
        <li><strong>Our own staff</strong>, to pack, deliver and answer you. And anyone the law requires us to share it with.</li>
      </ul>`) +
    legalSec('On this device', 'Signing in sets a cookie that keeps you signed in. Your bag, your saved area, your favourites, the light or dark look and any half-filled form are kept in this browser’s own storage, so they are still here next time. We use no advertising or tracking cookies. Clearing this site’s data in your browser removes them.') +
    legalSec('How long we keep it', 'Your account details are kept while your account is open. Records of orders and payments are kept for as long as our accounts and the tax rules require.') +
    legalSec('Your choices', `You can see and change your name and saved addresses on <a href="/account" data-route>your profile</a>, and turn WhatsApp reminders on or off there. You can delete your account at any time once no order is on its way, from the <a href="/help" data-route>Help</a> page: your name, number, email and addresses are removed and your bag is emptied. The amounts of past orders are kept, without your details, because our accounts need them.`,
      `Questions about your information? ${legalAsk()}.`)
}

function termsHTML() {
  const pol = legalPol(), hold = Number(pol && pol.holdMinutes)
  return legalSec('Who sells', `This shop is run by ${legalWho()}. By placing an order you agree to these terms.`) +
    legalSec('Ordering and paying', `Prices are in rupees and include GST. You pay in full when you order, online through Razorpay; there is no cash on delivery. ${hold > 0 ? `At Pay your mangoes are held for you for ${hold} minutes` : 'At Pay your mangoes are held for you for a short time, shown on the page'}; an order not paid by then lapses and nothing is charged. An order is confirmed once the payment comes through.`,
      'Mangoes are natural produce: size, colour and ripeness vary from fruit to fruit, and pictures on the site are illustrative.') +
    legalSec('Pre-orders', 'Before the season you can pre-order. You pay in full now, so the price is fixed when you pay, and you choose the week it is delivered in. Harvest varies with the weather and other conditions, so we may have to move your week; we tell you when we do. A pre-order can’t be cancelled once paid, unless we delay it; then you can cancel it for a full refund until it is packed.') +
    legalSec('Bulk orders', `From ${BULK_MIN_KG} kg you can order and pay directly at bulk prices; from ${BULK_ENQUIRY_MIN_KG} kg you can also send an enquiry and we quote a price. Delivery on a bulk order is ${BULK_DELIVERY_PCT}% of the mangoes’ value, added to the total, and our team calls you to arrange the day, usually within ${BULK_DAYS}.`) +
    legalSec('Gifts', 'You can send boxes to other people. Please make sure their name, phone number and address are right and that they are happy for us to use them to deliver. Each person’s box is a delivery of its own.') +
    legalSec('Delivery', `We deliver only within our delivery area, on the days the shop offers. The <a href="/shipping" data-route>Shipping and delivery</a> page has the details and the delivery charge.`) +
    legalSec('Cancelling and refunds', `A normal order can be cancelled within ${legalHours()} of placing it, before it is packed. A pre-order can’t be cancelled once paid, unless we delay it; then you can cancel it for a full refund until it is packed. A paid bulk order can be cancelled within ${legalHours()} of paying, until it is dispatched. On a gift order, each person’s delivery can be cancelled within ${legalHours()} of placing it, as long as their box isn’t packed. If we can’t deliver an order, we refund you in full. The <a href="/refund" data-route>Refund and cancellation policy</a> has every rule.`) +
    legalSec('Damaged, wrong or missing mangoes', `Tell us ${legalClaim()} from the order’s page under <a href="/orders" data-route>Your orders</a>, with a photo if you can. We look at every report and send a replacement for what went wrong.`) +
    legalSec('Using the shop', 'Please give true details, order only for real deliveries, and treat our riders and staff with respect. Don’t try to break, overload or copy the site, or use it with automated tools. We may refuse or cancel an order that looks fraudulent, refunding anything paid.') +
    legalSec('The law', 'These terms are governed by the laws of India, and the courts of India decide any dispute about them. We may update these terms; the version on this page when you place an order applies to that order.')
}

function refundHTML() {
  const h = legalHours()
  const rows = [
    ['Normal order', `Within ${h} of placing it`, 'As long as it hasn’t been packed', 'In full'],
    ['Pre-order', 'Not once paid, unless we delay it', 'If we delay it: until it is packed', 'In full'],
    ['Bulk order', `Within ${h} of paying`, 'Until it is dispatched', 'In full'],
    ['Gift order', `Each person’s delivery, within ${h} of placing the order`, 'As long as that person’s box hasn’t been packed', 'That delivery’s own amount'],
  ]
  const heads = ['Order', 'When you can cancel', 'Condition', 'Refund']
  return legalSec('Cancelling, at a glance', `Each kind of order has its own rule. You cancel from the order’s page under <a href="/orders" data-route>Your orders</a> (a bulk order from its own page, a gift from the gift order’s page).`,
    `<div class="legal-table-wrap"><table class="legal-table"><caption class="sr-only">When each kind of order can be cancelled</caption><thead><tr>${heads.map((x) => `<th scope="col">${x}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr><th scope="row">${r[0]}</th>${r.slice(1).map((c, i) => `<td data-label="${heads[i + 1]}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`,
    `After those times cancelling closes and the order can’t be cancelled or refunded: by then your box is being picked and packed. An order you didn’t pay for costs nothing: its hold simply lapses, or you can cancel it.`) +
    legalSec('When we delay an order', 'Harvest varies with the weather. If we move a pre-order’s week, or give an order a new date because the fruit fell short, you can cancel it for a full refund until it is packed, even after the usual time. The order shows a “Cancel and get a refund” button while you can.') +
    legalSec('How refunds are paid', 'A refund goes back to the way you paid (your card, UPI or bank account through Razorpay), usually within 5 to 7 working days. If we can’t deliver an order, we cancel it and refund you in full.') +
    legalSec('Damaged, wrong or missing mangoes', `Report it ${legalClaim()}: open the order under <a href="/orders" data-route>Your orders</a> and choose “Report a problem with this order”, with up to three photos. We look at every report and put it right with a replacement for what went wrong, rather than a refund.`) +
    legalSec('Questions', `Something not covered here? ${legalAsk()}.`)
}

function shippingHTML() {
  const pol = legalPol(), fee = pol && pol.deliveryFee, cut = pol && pol.cutoffTime, ahead = Number(pol && pol.maxDaysAhead)
  let charge
  if (!fee) charge = 'The delivery charge depends on how far you are from our warehouse and what your order weighs. It is shown at checkout, before you pay.'
  else if (!fee.enabled) charge = 'Delivery on a normal order is free at present. If a charge applies, it is shown at checkout, before you pay.'
  else {
    const bands = Array.isArray(fee.bands) ? fee.bands : [], last = bands[bands.length - 1], kg = Number(fee.freeFromKg) || 0
    const table = bands.length ? `<div class="legal-table-wrap"><table class="legal-table"><caption class="sr-only">The delivery charge by distance</caption><thead><tr><th scope="col">Distance</th>${kg ? `<th scope="col">${kg} kg and above</th><th scope="col">Under ${kg} kg</th>` : '<th scope="col">Charge</th>'}</tr></thead><tbody>${bands.map((b, i) => `<tr><th scope="row">${i ? `${bands[i - 1].uptoKm} to ${b.uptoKm} km` : `Up to ${b.uptoKm} km`}</th>${kg ? `<td data-label="${kg} kg and above">${b.uptoKm <= fee.freeWithinKm ? 'Free' : legalRs(b.fee)}</td><td data-label="Under ${kg} kg">${legalRs(b.feeSmall)}</td>` : `<td data-label="Charge">${legalRs(b.feeSmall)}</td>`}</tr>`).join('')}</tbody></table></div>` : ''
    const beyond = !last ? '' : fee.beyond === 'refuse' ? `We don’t deliver past ${last.uptoKm} km.` : fee.beyond === 'perKm' && fee.perKmBeyond ? `Past ${last.uptoKm} km the last charge goes up by ${legalRs(fee.perKmBeyond.fee)}${kg ? ` (${legalRs(fee.perKmBeyond.feeSmall)} under ${kg} kg)` : ''} for every km further.` : `Past ${last.uptoKm} km the last charge applies.`
    charge = `${kg && fee.freeWithinKm > 0 ? `Delivery is free on orders of ${kg} kg and above within ${fee.freeWithinKm} km of our warehouse. ` : ''}Otherwise the charge depends on the distance (a straight line from our nearest warehouse to your pin, or to your pincode) and on what your order weighs:</p>${table}<p>${beyond} The exact charge is shown at checkout, before you pay.`
  }
  return legalSec('Where we deliver', 'We deliver within our delivery area around our warehouse. Enter your pincode, or drop a pin on the map, and the shop tells you straight away whether we deliver there and on which days. We don’t deliver outside that area, and the shop won’t take an order we can’t deliver.') +
    legalSec('The delivery charge', charge) +
    legalSec('When it arrives', `${cut ? `Order before ${esc(cut)} for delivery the next day, when that day has room.` : 'Order before the day’s cutoff, shown at checkout, for delivery the next day, when that day has room.'} At checkout you choose the delivery day${ahead > 0 ? ` (up to ${ahead} days ahead)` : ''} and a time slot. We send updates on WhatsApp or SMS, and you can follow the order under <a href="/orders" data-route>Your orders</a>.`) +
    legalSec('Pre-orders', 'A pre-order is delivered in the week you chose. Harvest varies with the weather and other conditions, so the week can change; if we delay it we tell you, and you can then cancel it for a full refund until it is packed.') +
    legalSec('Bulk orders and gifts', `A bulk order is delivered on a day our team arranges with you by phone or WhatsApp, usually within ${BULK_DAYS} of paying; its delivery is ${BULK_DELIVERY_PCT}% of the mangoes’ value. A gift is delivered to each person’s own address, within the same delivery area.`) +
    legalSec('If nobody is home', 'If nobody can take the box, the rider marks the delivery missed. We try again on the next delivery run, or call you to arrange a new time.')
}

// The canonical link follows the page. The HTML names the shop's origin once, in that link (the build writes it from SHOP_URL,
// and each page in routes.js gets its own HTML in _routes/ with its own canonical); the path is the page's own.
window.addEventListener('mm:route', () => {
  const c = document.querySelector('link[rel="canonical"]')
  if (c) c.href = new URL(location.pathname === '/index.html' ? '/' : location.pathname, c.dataset.origin ||= new URL(c.href).origin).href
})
window.addEventListener('mm:route', () => { if (document.body.dataset.page !== 'not-found') notFoundNoindex(false) })
window.addEventListener('mm:route', () => { if (LEGAL_TITLES.includes(document.title) && !LEGAL_PAGES[document.body.dataset.page]) document.title = 'VMR Mangoes — A little taste of summer.' })

// ---- Events.

// Links inside the app (data-route) and the home anchors (#shop, #bulk…) while a page is open.
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey) return
  const a = e.target instanceof Element ? e.target.closest('a') : null
  if (!a) return
  const href = a.getAttribute('href') || ''
  if (a.classList.contains('skip') && pageOpen()) {
    e.preventDefault()
    const h = $('#page-body h1')
    if (h) { h.tabIndex = -1; h.focus() }
    return
  }
  if (a.hasAttribute('data-route')) {
    e.preventDefault()
    closeDialogs()
    go(href)
  } else if (href.startsWith('#') && pageOpen()) {
    e.preventDefault()
    go('/' + href)
  }
}, true)

document.addEventListener('click', (e) => {
  const b = e.target instanceof Element ? e.target.closest('button') : null
  if (!b) return
  if (b.hasAttribute('data-page-back')) {
    if (history.state && history.state.mm) history.back()
    else go('/')
  } else if (b.hasAttribute('data-edit-name')) {
    nameEditing = true
    accountView()
  } else if (b.dataset.removeAddress) {
    // Asked first, in the row itself (as declining a bulk quote is): Remove, or Keep it.
    const row = b.closest('.address-row')
    if (!row || row.querySelector('.address-confirm')) return
    const ask = document.createElement('div')
    ask.className = 'address-confirm'
    ask.setAttribute('role', 'group')
    ask.setAttribute('aria-label', 'Remove this address?')
    ask.innerHTML = `<p>Remove this address? You can add it again at checkout.</p><div class="bq-actions"><button class="button secondary is-danger" type="button" data-remove-address-yes="${esc(b.dataset.removeAddress)}">${icon('close')} Remove</button><button class="text-button" type="button" data-remove-address-no>Keep it</button></div>`
    b.hidden = true
    row.classList.add('is-asking')
    row.appendChild(ask)
    ask.querySelector('[data-remove-address-no]').focus()
  } else if (b.hasAttribute('data-remove-address-no')) {
    const row = b.closest('.address-row')
    row.classList.remove('is-asking')
    b.closest('.address-confirm').remove()
    const again = row.querySelector('[data-remove-address]')
    again.hidden = false
    again.focus()
  } else if (b.dataset.removeAddressYes) {
    b.disabled = true
    MM.deleteAddress(b.dataset.removeAddressYes).then(() => {
      toast('Address removed')
      accountView()
    }, (err) => {
      b.disabled = false
      toast(err.message)
    })
  } else if (b.dataset.favOpen) {
    const name = b.dataset.favOpen
    go('/#shop')
    productDetail(name)
  }
})

// The name on the profile page: saved to the account (PATCH /v1/me); if the API doesn't take it yet, kept on
// this device so checkout still fills it in.
document.addEventListener('submit', (e) => {
  if (e.target.id !== 'name-form') return
  e.preventDefault()
  const name = String(new FormData(e.target).get('name') || '').trim()
  if (!name) return
  const b = e.target.querySelector('button')
  b.disabled = true
  MM.updateMe({ name }).then(
    (me) => {
      MM.rememberProfile({ name: me.name ?? name })
      toast('Name saved')
    },
    (err) => {
      if (err.status !== 400) throw err
      MM.rememberProfile({ name })
      toast('Name saved on this device')
    },
  ).then(() => {
    nameEditing = false
    accountView()
  }, (err) => {
    b.disabled = false
    toast(err.message)
  })
})

document.addEventListener('change', (e) => {
  const t = e.target
  if (!t.matches || !t.matches('[data-reminders]')) return
  t.disabled = true
  MM.updateMe({ remindersOptIn: t.checked }).then(
    () => toast(t.checked ? 'WhatsApp reminders on' : 'WhatsApp reminders off'),
    (err) => {
      t.checked = !t.checked
      toast(err.message)
    },
  ).finally(() => {
    t.disabled = false
  })
})

window.addEventListener('popstate', route)
// A home anchor typed or followed on the home page itself (#bulk) changes only the hash.
window.addEventListener('hashchange', () => { if (anchorPage()) route() })
// Signing out on an account page leaves it.
window.addEventListener('mm:profile', () => {
  if (pageOpen() && !MM.profile() && ['account', 'orders'].includes(document.body.dataset.page)) go('/')
})
