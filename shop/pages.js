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
  [/^\/orders\/?$/, () => signedInThen('Your orders', ordersView)],
  [/^\/orders?\/([^/]+)\/?$/, (m) => signedInThen('Your order', () => trackView(decodeURIComponent(m[1])))],
  [/^\/account\/?$/, () => signedInThen('Your profile', accountView)],
  [/^\/login\/?$/, () => loginView()],
  // /bulk is the order tab; /bulk/enquiry and /bulk/farm-visit the other two (bulk.js draws the tabs and the order flow).
  [/^\/bulk(?:\/(enquiry|farm-visit))?\/?$/, (m) => bulkPage(m[1] || 'order')],
]
// The home page's old sections, now pages: /#bulk (an old link, a bookmark) opens /bulk. /#preorder lands on the shop.
const ANCHOR_PAGES = { preorder: '/', bulk: '/bulk', partner: '/partner' }
/** The retired pre-order page: an old link or bookmark lands on the home page (the shop takes pre-orders before the season). */
const OLD_PREORDER = /^\/preorder\/?$/
const anchorPage = () => (location.pathname === '/' || location.pathname === '/index.html') && ANCHOR_PAGES[location.hash.slice(1)] || null
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

/** The page's heading: a back button, the title, and on the account pages their tabs. */
function pageHead(title) {
  const tabs = ['account', 'orders', 'farm-bookings'].includes(document.body.dataset.page)
    ? `<nav class="page-tabs" aria-label="Your account">${ACCOUNT_TABS.map(([href, label]) => {
      const on = location.pathname === href || (href === '/orders' && location.pathname.startsWith('/order')) || (href === '/farm-bookings' && location.pathname.startsWith('/farm-bookings/'))
      return `<a href="${href}" data-route ${on ? 'aria-current="page"' : ''}>${label}</a>`
    }).join('')}</nav>`
    : ''
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
// prices), Send enquiry (250 kg and above, a quote) and Farm visit (250 kg and above, farm.js). On the first two one
// adder (a variety <select>, ripeness, 5 kg / 10 kg box, number of boxes) fills one bulk list (localStorage `mm-bulk`,
// not the bag), shared by both tabs, shown under it with a stepper per line and both prices (the shop's struck through,
// the bulk price from GET /v1/bulk/prices). The sticky bar (#pay-bar) offers the tab's one action: "Order and pay"
// from 100 kg (bulk.js bulkOrderStart), or "Send enquiry" from 250 kg (app.js bulkForm).

const BULK_MIN_KG = 100
/** Enquiries are for this many kg and more (the API's BULK_ENQUIRY_MIN_KG): below it, order and pay instead. */
const BULK_ENQUIRY_MIN_KG = 250
const BULK_ENQUIRY_MIN_TEXT = `Enquiries are for ${BULK_ENQUIRY_MIN_KG} kg and above. From ${BULK_MIN_KG} kg you can order and pay directly.`
// Bulk boxes are 5 kg or 10 kg only. The catalogue has no 10 kg box, so the 10 kg bulk box is the variety's 5 kg fruit packed
// double: id "<5 kg sku>@10" in the list, sent to the API as that sku with packKg 10, shown at twice the 5 kg price.
const BULK_PACKS_KG = [5, 10]
const BULK_DELIVERY_PCT = 10 // delivery on a bulk order, as a share of the mangoes' value (the API works out the real figure)
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
const adder = { variety: '', stage: 'SEMI_RIPE', pack: 5, qty: 1 } // what the adder on /bulk is set to
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

// ---- The adder

const adderVariety = () => shelf.find((v) => v.name === adder.variety && bulkBoxes(v).length) || null
const adderBox = (v) => bulkBoxes(v).find((s) => kgOf(s) === adder.pack) || bulkBoxes(v)[0]
const adderStages = () => SOLD.filter((x) => SOLD_API.includes(x.apiStage))
/** How many more boxes the list's line for the adder's choice can take. */
function adderRoom(v) {
  const s = adderBox(v), line = bulkLines().find((x) => x.sku === s.sku && x.stage === adder.stage)
  return Math.max(0, BULK_MAX_BOXES - (line ? line.qty : 0))
}
function adderFix() {
  if (!adderStages().some((x) => x.apiStage === adder.stage)) adder.stage = adderStages().some((x) => x.apiStage === 'SEMI_RIPE') ? 'SEMI_RIPE' : adderStages()[0]?.apiStage
  if (!BULK_PACKS_KG.includes(adder.pack)) adder.pack = BULK_PACKS_KG[0]
  const v = adderVariety(), max = v ? Math.max(1, adderRoom(v)) : BULK_MAX_BOXES
  adder.qty = Math.min(max, Math.max(1, Math.floor(Number(adder.qty)) || 1))
  return max
}
const addsText = () => `${adder.qty} × ${adder.pack} kg = ${adder.qty * adder.pack} kg`

function adderHTML() {
  const max = adderFix(), v = adderVariety(), list = shelf.filter((x) => bulkBoxes(x).length)
  const s = v && adderBox(v), st = stageOf(adder.stage), src = v && v.c.photos && v.c.photos[adder.stage], room = v ? adderRoom(v) : 0
  const preview = v
    ? `<div class="bulk-pick-photo fruit-photo${src ? ' photo' : ''}" role="img" aria-label="${st.stage} ${esc(v.name)}">${src ? `<img src="${src}" alt="" width="720" height="720" decoding="async">` : ''}</div><div class="bulk-pick-copy"><p class="bulk-pick-kicker">Your pick</p><h3>${esc(v.name)}</h3><p>${esc(v.c.flavour)}</p><p class="bulk-pick-meta"><span>${st.stage}</span><span>${esc(kgText(s))} box</span>${bulkPriceHTML(s.sku, s.price)}</p></div>`
    : `<div class="bulk-pick-photo is-empty" aria-hidden="true">${icon('mango')}</div><div class="bulk-pick-copy"><p class="bulk-pick-kicker">Your pick</p><h3>Choose a variety</h3><p>Pick one from the list: its picture and a line about it show here.</p></div>`
  const why = !v ? 'Choose a variety first.' : room <= 0 ? `This line already has ${BULK_MAX_BOXES} boxes, the most one line can hold.` : ''
  return `<div class="bulk-pick${v ? '' : ' is-empty'}">${preview}</div>
    <div class="bulk-adder-form">
      <label class="field bulk-variety">Variety<span class="bulk-select"><select id="bulk-variety"><option value=""${v ? '' : ' selected'}>Choose a variety…</option>${list.map((x) => { const five = bulkBoxes(x)[0], bp = bulkPriceFor(five.sku); return `<option value="${esc(x.name)}"${v && x.name === v.name ? ' selected' : ''}>${esc(x.name)} · ${currency(bp ? bp.bulk : five.price)} / 5 kg box</option>` }).join('')}</select>${icon('chevron')}</span></label>
      <p class="pre-label" id="bulk-stage-label">Ripeness</p>
      <div class="door-stages" role="group" aria-labelledby="bulk-stage-label">${adderStages().map((x) => `<button type="button" data-adder-stage="${x.apiStage}" aria-pressed="${x.apiStage === adder.stage}"><span class="dot ${x.id}"></span>${x.stage}</button>`).join('')}</div>
      <p class="pre-label" id="bulk-box-label">Box size</p>
      <div class="bulk-packs" role="group" aria-labelledby="bulk-box-label">${BULK_PACKS_KG.map((k) => { const b = v && bulkBoxes(v).find((x) => kgOf(x) === k); const bp = b && bulkPriceFor(b.sku); return `<button type="button" class="bulk-pack" data-adder-pack="${k}" aria-pressed="${adder.pack === k}"><strong>${k} kg box</strong>${b ? `<small>${bp ? `<s aria-label="shop price ${currency(b.price)}">${currency(b.price)}</s> ${currency(bp.bulk)}` : currency(b.price)} / box</small>` : ''}</button>` }).join('')}</div>
      <p class="pre-label" id="bulk-qty-label">Number of boxes</p>
      <div class="bulk-qty"><div class="card-stepper bulk-stepper" role="group" aria-labelledby="bulk-qty-label"><button type="button" data-adder-step="-1" aria-label="One box fewer" ${adder.qty <= 1 ? 'aria-disabled="true"' : ''}>−</button><input id="bulk-qty" type="number" inputmode="numeric" min="1" max="${max}" step="1" value="${adder.qty}" aria-labelledby="bulk-qty-label" aria-describedby="bulk-adds"><button type="button" data-adder-step="1" aria-label="One box more" ${adder.qty >= max ? 'aria-disabled="true"' : ''}>+</button></div><button type="button" class="door-more bulk-more" data-adder-step="10" aria-label="Ten boxes more">+10 boxes</button></div>
      <p class="bulk-adds" id="bulk-adds" aria-live="polite">${icon('scale')}<span>${addsText()}</span></p>
      <button type="button" class="button primary full bulk-add" data-adder-add ${why ? 'disabled aria-describedby="bulk-add-why"' : ''}>${icon(why ? 'lock' : 'box')}<span>Add to bulk list</span></button>
      ${why ? `<p class="bulk-add-why" id="bulk-add-why">${icon('info')}<span>${why}</span></p>` : ''}
    </div>`
}

/** The bulk list under the adder: one line per variety, box and ripeness, with a stepper and Remove. */
function bulkListHTML() {
  const lines = bulkLines().filter((x) => bulkSku(x.sku)), t = bulkTotals(), ok = t.kg >= BULK_MIN_KG
  if (!lines.length) return `<section class="bulk-list is-empty" id="bulk-list" aria-labelledby="bulk-list-h"><h3 id="bulk-list-h" tabindex="-1">Your bulk list</h3><p>${icon('box')}<span>Nothing here yet. Choose a variety above and add your boxes.</span></p></section>`
  return `<section class="bulk-list" id="bulk-list" aria-labelledby="bulk-list-h"><h3 id="bulk-list-h" tabindex="-1">Your bulk list</h3><ul>${lines.map((x) => {
    const s = bulkSku(x.sku), st = stageOf(x.stage), what = esc(`${kgText(s)} boxes of ${st.stage.toLowerCase()} ${s.variety}`)
    const key = `data-sku="${esc(x.sku)}" data-stage="${esc(x.stage)}"`
    return `<li class="bulk-line">${thumb(s.base || s.sku, x.stage, s.variety)}<div class="bulk-line-copy"><strong>${esc(s.variety)}</strong><small>${esc(kgText(s))} box · ${st.stage}</small></div><div class="bulk-line-qty"><div class="card-stepper" role="group" aria-label="${what} in your bulk list"><button type="button" data-bulk-qty="-1" ${key} aria-label="One box fewer">−</button><span aria-live="polite">${x.qty}</span><button type="button" data-bulk-qty="1" ${key} aria-label="One box more">+</button></div><strong class="bulk-line-kg">${x.qty * kgOf(s)} kg${bulkLineMoney(x)}</strong></div><button type="button" class="text-button bulk-line-remove" data-bulk-remove ${key} aria-label="Remove ${what} from your bulk list">Remove</button></li>`
  }).join('')}</ul><p class="bulk-list-total${ok ? ' is-ok' : ''}"><span>Total</span><strong>${t.kg} kg · ${t.boxes} ${t.boxes === 1 ? 'box' : 'boxes'}</strong></p>${bulkMoneyHTML(t)}</section>`
}

function renderBulkGrid(focus) {
  const grid = $('#bulk-grid')
  if (!grid) return
  if (!shelf.length) {
    grid.innerHTML = grid.dataset.waited
      ? `<div class="page-card empty-cart bag-empty empty-state">${icon('box')}<h2>The mangoes are a moment away.</h2><p>We couldn’t load the boxes just now. Try again in a minute.</p><button class="button primary bag-explore" data-bulk-retry>Try again ${icon('arrow')}</button></div>`
      : `<div class="bulk-adder is-loading" aria-busy="true"><span class="sk-block"></span><span class="sk-block"></span></div>`
    return
  }
  // A list saved before the 5 kg / 10 kg rule may hold other boxes: they leave it.
  if (skus.length && bulkLines().some((x) => !BULK_PACKS_KG.includes(kgOf(bulkSku(x.sku) || {})))) {
    bulkList = bulkLines().filter((x) => BULK_PACKS_KG.includes(kgOf(bulkSku(x.sku) || {})))
    save('mm-bulk', bulkList)
  }
  const intro = bulkTab === 'enquiry'
    ? `Pick a variety, the ripeness and a <strong>5 kg or 10 kg box</strong>. Enquiries are for <strong>${BULK_ENQUIRY_MIN_KG} kg and above</strong>: we price your list and send a quote, which can be lower than the bulk price shown. Nothing is paid now.`
    : `Pick a variety, the ripeness and a <strong>5 kg or 10 kg box</strong>. Bulk orders start at ${BULK_MIN_KG} kg, at <strong>bulk prices</strong> (the shop price is struck through), and you pay when you order.`
  grid.innerHTML = `<div class="door-intro"><h2 class="flow-head">Build your bulk list</h2><p>${intro}</p></div><div class="bulk-adder">${adderHTML()}</div>${bulkListHTML()}`
  refocus(grid, focus)
}

/** "Add to bulk list": the adder's boxes join the list (the same variety, ripeness and box adds to its line). */
function bulkAdd() {
  const v = adderVariety()
  if (!v) return
  const typed = $('#bulk-qty')
  if (typed) adder.qty = Number(typed.value)
  adderFix()
  const room = adderRoom(v)
  if (room <= 0) return
  const s = adderBox(v), n = Math.min(room, adder.qty), list = bulkLines(), stage = adder.stage
  let line = list.find((x) => x.sku === s.sku && x.stage === stage)
  if (!line) list.push(line = { sku: s.sku, stage, qty: 0 })
  line.qty += n
  save('mm-bulk', list)
  const photo = $('#bulk-grid .bulk-pick-photo'), from = photo && photo.getBoundingClientRect(), src = photo && $('img', photo)?.src
  adder.qty = 1
  renderBulkGrid({ 'data-adder-add': '' })
  bulkBar()
  toast(`${n} × ${kgText(s)} ${stageOf(stage).stage.toLowerCase()} ${v.name} added to your bulk list`)
  if (window.MMFly && from) MMFly.fly({ from, src, to: () => $('#pay-bar .pay-bar-total') || $('#pay-bar') })
  bulkFollow()
}

/** A change to the adder (ripeness, box, number): drawn again, focus kept on the control used. */
function adderSet(b) {
  const d = b.dataset
  if (d.adderStage) adder.stage = d.adderStage
  else if (d.adderPack) adder.pack = Number(d.adderPack)
  else if (d.adderStep) {
    const typed = $('#bulk-qty')
    if (typed) adder.qty = Number(typed.value) || 1
    adder.qty += Number(d.adderStep)
  }
  renderBulkGrid(usedAttrs(b, ['data-adder-stage', 'data-adder-pack', 'data-adder-step']))
}

/** The sticky bar on /bulk: the list's weight and boxes, and the tab's action: "Order and pay" (from 100 kg) or "Send
 *  enquiry" (from 250 kg). The farm tab has no bar. */
function bulkBar() {
  if (document.body.dataset.page !== 'bulk') return
  if (bulkTab === 'farm-visit') return setBar('')
  if (bulkTab === 'enquiry') return bulkEnquiryBar()
  const t = bulkTotals(), ok = t.kg >= BULK_MIN_KG
  // Just sent (the "sent" card is on screen and the list is empty): say so, no disabled button or hint.
  const sent = !t.boxes && [...document.querySelectorAll('#bulk-box .bulk-sent')].find((el) => el.getClientRects().length)
  if (sent) {
    return setBar(`<div class="pay-bar-row is-sent"><p class="pay-bar-sent" role="status">${icon('check')}<span>Sent · we will be in touch on WhatsApp</span></p></div>`)
  }
  if (bulkFlowOpen()) return setBar('')
  const fee = Math.round(t.bulk * BULK_DELIVERY_PCT / 100)
  const hint = ok
    ? `<p class="pay-bar-hint is-next is-ok" role="status">${icon('check')}<span>${t.kg} kg at bulk prices${t.priced ? ` · ${currency(t.bulk)} + ${currency(fee)} delivery` : ''}. You pay now; delivery in ${BULK_DAYS}.</span></p>`
    : `<p class="pay-bar-hint is-next" role="status" id="bulk-order-why">${icon('lock')}<span>Bulk orders start at ${BULK_MIN_KG} kg${t.kg ? ` · add ${BULK_MIN_KG - t.kg} kg more` : ''}.</span></p>`
  setBar(`${hint}<div class="pay-bar-row bulk-bar"><div class="pay-bar-total"><small>${ok && t.priced ? 'Total to pay' : 'Your bulk list'}</small><strong>${ok && t.priced ? `<span>${currency(t.bulk + fee)}</span>` : `<span>${t.kg} kg ·</span> <span>${t.boxes} ${t.boxes === 1 ? 'box' : 'boxes'}</span>`}</strong></div><div class="bulk-bar-go"><button class="button primary pay-bar-go" id="bulk-order" ${ok ? '' : `disabled aria-describedby="bulk-order-why"`}>${ok ? '' : icon('lock')}<span>Order and pay</span>${ok ? icon('arrow') : ''}</button></div></div>`)
}

/** The enquiry tab's bar: "Send enquiry" from 250 kg; under it, why not, and the way to order and pay instead. */
function bulkEnquiryBar() {
  const t = bulkTotals(), ok = t.kg >= BULK_ENQUIRY_MIN_KG
  const sent = !t.boxes && [...document.querySelectorAll('#bulk-box .bulk-sent')].find((el) => el.getClientRects().length)
  if (sent) return setBar(`<div class="pay-bar-row is-sent"><p class="pay-bar-sent" role="status">${icon('check')}<span>Enquiry sent · your quote comes on WhatsApp</span></p></div>`)
  const hint = ok
    ? `<p class="pay-bar-hint is-next is-ok" role="status">${icon('check')}<span>${t.kg} kg: send it and we will quote you. Nothing is paid now.</span></p>`
    : `<p class="pay-bar-hint is-next" role="status" id="bulk-enquiry-why">${icon('lock')}<span>${BULK_ENQUIRY_MIN_TEXT}${t.kg ? ` Your list is ${t.kg} kg.` : ''}</span></p>`
  const order = !ok && t.kg >= BULK_MIN_KG ? `<a class="button secondary pay-bar-alt" href="/bulk" data-route>Order and pay</a>` : ''
  setBar(`${hint}<div class="pay-bar-row bulk-bar"><div class="pay-bar-total"><small>Your bulk list</small><strong><span>${t.kg} kg ·</span> <span>${t.boxes} ${t.boxes === 1 ? 'box' : 'boxes'}</span></strong></div><div class="bulk-bar-go">${order}<button class="button primary pay-bar-go" id="bulk-enquiry" ${ok ? '' : 'disabled aria-describedby="bulk-enquiry-why"'}>${ok ? '' : icon('lock')}<span>Send enquiry</span>${ok ? icon('arrow') : ''}</button></div></div>`)
}

function bulkStep(b) {
  const { sku, stage } = b.dataset, delta = Number(b.dataset.bulkQty), list = bulkLines()
  let line = list.find((x) => x.sku === sku && x.stage === stage)
  if (!line && delta > 0) list.push(line = { sku, stage, qty: 0 })
  if (!line) return
  line.qty = Math.min(5000, line.qty + delta)
  if (line.qty <= 0) list.splice(list.indexOf(line), 1)
  save('mm-bulk', list)
  const focus = usedAttrs(b, ['data-bulk-qty', 'data-sku', 'data-stage'])
  renderBulkGrid(focus)
  if (!$('#bulk-grid').contains(document.activeElement)) refocus($('#bulk-grid'), { 'data-bulk-qty': '1', 'data-sku': sku, 'data-stage': stage })
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
  box.scrollIntoView({ block: 'start', behavior: reduced ? 'instant' : 'smooth' })
  const h = $('.flow-head', box)
  if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }) }
}

function bulkPage(tab = 'order') {
  const was = bulkTab
  bulkTab = tab
  document.title = `${BULK_TABS.find((x) => x.id === tab).name} · VMR Mangoes`
  host().innerHTML = pageHead('Bulk orders') + bulkTabsHTML(tab) + `<div class="bulk-panel" id="bulk-panel" role="tabpanel" aria-labelledby="bulk-tab-${tab}" tabindex="-1">${bulkKeyHTML(tab)}${tab === 'farm-visit' ? '<section class="bulk-farm" id="bulk-farm" aria-busy="true"><p>Loading the farm visit…</p></section>' : `
    <section class="door-cards bulk-build" id="bulk-grid" aria-label="Build your bulk list"></section>
    <section class="page-card door-flow" id="bulk-box" aria-label="${tab === 'enquiry' ? 'Your enquiry' : 'Your bulk order'}" hidden></section>`}</div>`
  bulkTabsSlide(was)
  bulkFlowReset()
  bulkBar()
  if (tab === 'farm-visit') { bulkFarmTab(); return }
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
  if (d.adderStage || d.adderPack || d.adderStep) adderSet(b)
  else if (b.hasAttribute('data-adder-add')) bulkAdd()
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
// The adder's variety (a <select>) and its typed number of boxes.
document.addEventListener('change', (e) => {
  const t = e.target
  if (t.id === 'bulk-variety') {
    adder.variety = t.value
    renderBulkGrid({ id: 'bulk-variety' })
  } else if (t.id === 'bulk-qty') {
    // Settled in place (no redraw: the tap that blurred the field may be on "Add to bulk list").
    adder.qty = Number(t.value)
    const max = adderFix()
    t.value = adder.qty
    const out = $('#bulk-adds span')
    if (out) out.textContent = addsText()
    document.querySelectorAll('#bulk-grid [data-adder-step]').forEach((b) => {
      const off = (b.dataset.adderStep === '-1' && adder.qty <= 1) || (b.dataset.adderStep === '1' && adder.qty >= max)
      if (off) b.setAttribute('aria-disabled', 'true')
      else b.removeAttribute('aria-disabled')
    })
  }
})
// Enter in the number of boxes adds them, as the button does.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.target.id !== 'bulk-qty') return
  e.preventDefault()
  bulkAdd()
})
document.addEventListener('input', (e) => {
  if (e.target.id !== 'bulk-qty') return
  const n = Math.floor(Number(e.target.value))
  if (!(n >= 1)) return
  adder.qty = Math.min(Number(e.target.max) || BULK_MAX_BOXES, n)
  const out = $('#bulk-adds span')
  if (out) out.textContent = addsText()
})
// Another tab changed the bulk list: follow it.
window.addEventListener('storage', (e) => {
  if (e.key !== 'mm-bulk') return
  bulkList = null
  renderBulkGrid()
  bulkBar()
})

// ---- The profile page.

async function accountView(seq = ++sheetSeq) {
  host().innerHTML = head('Your profile') + marker(seq) + '<p>Loading your profile…</p>'
  let me = MM.profile() || {}, addresses = [], enquiries = null, error = ''
  try {
    ;[me, addresses, enquiries] = await Promise.all([MM.me(), MM.addresses().catch(() => []), MM.myBulkEnquiries().then((r) => r.items || [], () => null)])
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
    ${bulkSection(enquiries)}
    <section class="page-card help-card" data-help-link hidden></section>
    <section class="page-card">
      <h3>Updates</h3>
      <label class="toggle-row"><span><strong>WhatsApp reminders</strong><small>A note a week after delivery to ask how your mangoes were.</small></span><input type="checkbox" role="switch" data-reminders ${me.remindersOptIn ? 'checked' : ''}></label>
    </section>
    <section class="page-card page-actions">
      <button class="button secondary" data-signout>Sign out</button>
    </section>`
  if (enquiries) bulkOpened(enquiries)
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
      <p class="track-address">${esc(addressText(o.deliveryAddress))}${o.pincode ? ` · ${esc(o.pincode)}` : ''}</p>
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
    ${signed ? `<a class="button primary" href="/account?enquiry=${encodeURIComponent(r.id)}" data-route>View in account ${icon('arrow')}</a>` : `<button class="button primary" data-bulk-signin="${esc(r.id)}">Sign in to track it ${icon('arrow')}</button>`}
    ${waOk ? `<a class="button secondary" href="https://wa.me/${wa}?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">Also send on WhatsApp</a>` : ''}
    <button class="text-button" data-close style="margin:15px auto 0">Back to the mangoes ${icon('arrow')}</button></div>`
  bulkBar()
  const h = $('h2', $(box))
  if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }) }
  $(box).scrollIntoView({ block: 'start', behavior: reduced ? 'instant' : 'smooth' })
  bulkWatch()
}

function bulkSection(items) {
  if (!items) return ''
  if (!items.length && !(policy?.features?.bulkEnquiries ?? true)) return ''
  return `<section class="page-card bulk-mine" aria-labelledby="bulk-mine-h">
      <h3 id="bulk-mine-h">Bulk orders and farm visits</h3>
      ${items.length ? `<ul class="bq-list">${items.map(bulkItem).join('')}</ul>` : `<p class="page-note">Ordering ${BULK_MIN_KG} kg or more? <a href="/bulk" data-route>Place a bulk order</a> at bulk prices.</p>`}
    </section>`
}

function bulkItem(x) {
  const q = x.quote, what = `${x.quantityKg} kg${x.boxes ? ` · ${x.boxes} ${x.boxes === 1 ? 'box' : 'boxes'}` : ''}`
  const open = x.status === 'QUOTED' && q
  return `<li class="bq-item${x.unread ? ' is-new' : ''}" id="enquiry-${esc(x.id)}" data-enquiry="${esc(x.id)}">
    <div class="bq-head"><div><strong>${esc(orderNo(x.number))}</strong><small>${x.kind === 'ORDER' ? 'Bulk order' : x.kind === 'FARM_VISIT' ? 'Farm visit enquiry' : 'Enquiry'} · ${x.kind === 'FARM_VISIT' ? 'sent ' : ''}${fmtDate(String(x.createdAt).slice(0, 10))} · ${esc(what)}</small></div><span class="bq-chip is-${x.status.toLowerCase()}">${x.kind === 'FARM_VISIT' ? (FARM_VISIT_STATUS[x.status] || esc(x.status)) : x.unread ? (x.kind === 'ORDER' ? 'Price confirmed' : 'New quote') : (x.kind === 'ORDER' && BULK_ORDER_STATUS[x.status]) || BULK_STATUS[x.status] || esc(x.status)}</span></div>
    ${x.farmVisit ? `<p class="bq-done">${icon('leaf')}<span>${x.farmVisit.variety ? esc(x.farmVisit.variety) : 'Mango not chosen yet'} · ${x.farmVisit.people} ${x.farmVisit.people === 1 ? 'person' : 'people'} · ${x.farmVisit.plannedDate ? `visit on <strong>${fmtDate(x.farmVisit.plannedDate)}</strong>` : x.farmVisit.preferredDate ? `you asked for ${fmtDate(x.farmVisit.preferredDate)}` : 'dates flexible'}${x.status === 'CLOSED' && x.farmVisit.closeReason ? ` · closed: ${esc(x.farmVisit.closeReason)}` : ''}</span></p>` : ''}
    ${x.order ? `<p class="bq-done"><span>${x.order.amountPaise != null ? `${paise(x.order.amountPaise)} · ` : ''}${x.order.refund ? (x.order.refund.refundedAt ? 'refunded in full' : 'refund on its way') : x.status === 'PAYMENT_PENDING' ? 'not paid yet' : x.status === 'CANCELLED' ? 'cancelled' : 'paid in full'}</span> <a class="text-button inline-link" href="/bulk/orders/${encodeURIComponent(x.id)}" data-route>View order ${icon('arrow')}</a></p>` : ''}
    ${q && x.status !== 'CLOSED' ? `<div class="bq-quote" aria-label="Quote for ${esc(orderNo(x.number))}">
      <ul class="bq-lines">${q.lines.map((l) => `<li><span>${esc(l.label)} <small>× ${l.qty} @ ${currency(l.unitPrice)}</small></span><strong>${currency(l.linePrice)}</strong></li>`).join('')}
      ${q.extras.map((e) => `<li class="bq-extra"><span>${esc(e.label)}</span><strong>${paise(e.amount)}</strong></li>`).join('')}
      ${q.deliveryFee ? `<li class="bq-extra"><span>Delivery <small>${Number(q.deliveryPct) || BULK_DELIVERY_PCT}% of the order value</small></span><strong>${paise(q.deliveryFee)}</strong></li>` : ''}</ul>
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
    if (li) { li.outerHTML = bulkItem(next); document.getElementById(`enquiry-${id}`)?.querySelector('.bq-chip')?.setAttribute('tabindex', '-1') }
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
  if (fresh.length && document.body.dataset.page !== 'account') {
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
  if (!show || document.body.dataset.page === 'account') { if (bar) bar.hidden = true; return }
  if (!bar) {
    bar = document.createElement('aside')
    bar.id = 'bulk-quote-banner'
    bar.className = 'bulk-banner wrap'
    bar.setAttribute('aria-label', 'Your bulk quote')
    $('header.header').insertAdjacentElement('afterend', bar)
  }
  bar.innerHTML = `<a class="bulk-banner-go" href="/account?enquiry=${encodeURIComponent(show.id)}" data-route>${icon('box')}<span><strong>Your bulk quote is ready</strong><small>${esc(orderNo(show.number))} · ${currency(show.quote.total)}</small></span><span class="bulk-banner-cta">View quote ${icon('arrow')}</span></a><button class="bulk-banner-close" data-bulk-dismiss="${esc(show.id)}:${esc(show.quotedAt)}" aria-label="Hide this for now">${icon('close')}</button>`
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
    go(`/login?next=${encodeURIComponent(`/account?enquiry=${d.bulkSignin}`)}`)
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
/** How to reach us about this page, as a sentence: the email when there is one, the help form, and WhatsApp when there is one. */
function legalAsk() {
  const b = bizInfo()
  const ways = [b.email && `email <a href="mailto:${esc(b.email)}">${esc(b.email)}</a>`, `send us a request from <a href="/help" data-route>Help</a>`, b.wa && `message us on <a href="https://wa.me/${b.wa}" target="_blank" rel="noopener">WhatsApp</a>`].filter(Boolean)
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
