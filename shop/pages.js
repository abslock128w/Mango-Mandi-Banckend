/* Pages: /cart, /checkout, /orders, /orders/:id (and the API's /order/:id), /account, /preorder, /bulk.
   They replace the home page (main#home) with #page-view, keep the header, footer and dock, and
   use the History API, so back and forward work and the addresses can be shared or reloaded
   (shop/vercel.json and scripts/serve-shop.mjs serve index.html for them). Checkout and orders
   reuse app.js's flows, which draw wherever `view` points; the profile page is here.
   The home page's old sections (#preorder, #bulk, #partner) are pages now: those anchors open them (anchorPage).
   Every route change fires `mm:route` on window (dock.js and the desktop nav mark the current tab from it).
   Loaded before app.js, so top-level code only declares and listens. */

const PAGES = [
  [/^\/cart\/?$/, () => renderCartPage()],
  [/^\/checkout\/?$/, () => checkout()],
  [/^\/orders\/?$/, () => signedInThen('Your orders', ordersView)],
  [/^\/orders?\/([^/]+)\/?$/, (m) => signedInThen('Your order', () => trackView(decodeURIComponent(m[1])))],
  [/^\/account\/?$/, () => signedInThen('Your profile', accountView)],
  [/^\/login\/?$/, () => loginView()],
  [/^\/preorder\/?$/, () => preorderPage()],
  [/^\/bulk\/?$/, () => bulkPage()],
]
// The home page's old sections, now pages: /#bulk (an old link, a bookmark) opens /bulk.
const ANCHOR_PAGES = { preorder: '/preorder', bulk: '/bulk', partner: '/partner' }
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
  hidePage()
  routed()
}
const routed = () => window.dispatchEvent(new CustomEvent('mm:route', { detail: { path: location.pathname } }))

function showPage(path) {
  if (!pageOpen()) homeScroll = scrollY
  closeDialogs()
  setBar('')
  view = '#page-body'
  ++sheetSeq
  document.body.classList.add('page-open')
  document.body.dataset.page = path.split('/')[1]
  $('#home').hidden = true
  $('#page-view').hidden = false
  window.scrollTo({ top: 0, behavior: 'instant' })
  window.Liquid?.enter($('#page-view'), { soft: true })
}

function hidePage() {
  if (!pageOpen()) return
  document.body.classList.remove('page-open')
  setBar('')
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
    else go(`/login?next=${encodeURIComponent(location.pathname)}`, { replace: true })
  })
}

/** Where the sign-in page goes afterwards: only a path on this site (never another site's address). */
function loginNext() {
  const next = new URLSearchParams(location.search).get('next') || '/account'
  return /^\/(?!\/)[\w\-/]*$/.test(next) ? next : '/account'
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
  return `<div class="login-intro"><img class="brand-light" src="assets/brand-original.jpeg" alt=""><img class="brand-dark" src="assets/brand-dark.webp" alt=""><p>Sign in with your mobile number to see your orders, keep your addresses and check out faster. New here? Your account is made when you verify the code.</p></div>`
}

/** The page's heading: a back button, the title, and on the account pages their tabs. */
function pageHead(title) {
  const tabs = ['account', 'orders'].includes(document.body.dataset.page)
    ? `<nav class="page-tabs" aria-label="Your account">${ACCOUNT_TABS.map(([href, label]) => {
      const on = location.pathname === href || (href === '/orders' && location.pathname.startsWith('/order'))
      return `<a href="${href}" data-route ${on ? 'aria-current="page"' : ''}>${label}</a>`
    }).join('')}</nav>`
    : ''
  return `<div class="page-head"><button class="icon-button" data-page-back aria-label="Back">${icon('back')}</button><h1>${title}</h1></div>${tabs}`
}

// ---- The pre-order and bulk pages: the season's copy, then the shop's product cards (doorCard). On /preorder a card's
// "Pre-order" opens the booking panel (app.js renderPreorder) in #pre-box under the cards; on /bulk the cards fill a
// bulk list (localStorage `mm-bulk`, not the bag) that the sticky bar (#pay-bar) sends as an enquiry (app.js bulkForm)
// once it reaches 100 kg.

const BULK_MIN_KG = 100
const doorPick = { pre: {}, bulk: {} } // variety → { sku, stage } picked on its card
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

/** A card in the shop's look (photo, variety, description, bold price, box picker, ripeness pills) with the page's own
    action. `o`: { kind: 'pre' | 'bulk', sku, stage, boxes, stages, extra, action, muted, chosen }. */
function doorCard(v, o) {
  const st = stageOf(o.stage), s = o.boxes.find((b) => b.sku === o.sku) || o.boxes[0]
  const name = esc(v.name), src = v.c.photos && v.c.photos[o.stage]
  const key = `data-door="${o.kind}" data-variety="${name}"`
  const i = Math.max(0, o.boxes.indexOf(s))
  const boxes = o.boxes.length > 1
    ? `<div class="box-cards" role="group" aria-label="${name} box size" style="--n:${o.boxes.length};--i:${i}"><span class="box-lens" aria-hidden="true"></span>${o.boxes.map((b) => `<button class="box-card" data-door-box="${esc(b.sku)}" ${key} aria-pressed="${b.sku === s.sku}"><strong>${esc(kgText(b))}</strong><small>${currency(b.price)}</small></button>`).join('')}</div>`
    : `<p class="door-one-box">${esc(kgText(s))} box</p>`
  const stages = `<div class="door-stages" role="group" aria-label="${name} ripeness">${STAGES.filter((x) => o.stages.includes(x.apiStage)).map((x) => `<button data-door-stage="${x.apiStage}" ${key} aria-pressed="${x.apiStage === o.stage}"><span class="dot ${x.id}"></span>${x.stage}</button>`).join('')}</div>`
  return `<article class="product-card door-card${o.muted ? ' is-muted' : ''}${o.chosen ? ' is-chosen' : ''}" data-kind="${st.id}" data-variety="${name}"><div class="product-image"><div class="fruit-photo${src ? ' photo' : ''}" role="img" aria-label="${st.stage} ${name}">${src ? `<img src="${src}" alt="" loading="lazy" decoding="async" width="720" height="720">` : ''}</div>${o.muted ? '<span class="product-tag door-tag">Coming this season</span>' : ''}</div><div class="product-info"><div class="product-topline"><h3>${name}</h3></div><p class="product-desc">${esc(v.c.flavour)}</p><div class="product-bottom"><div class="product-price">${currency(s.price)}<small>/ box</small></div>${boxes}</div>${stages}${o.extra || ''}<div class="card-action door-action">${o.action}</div></div></article>`
}

/** Re-find the control that was used after a redraw (by its data attributes) and focus it. */
function refocus(root, attrs) {
  if (!attrs) return
  const sel = Object.entries(attrs).map(([k, v]) => `[${k}="${CSS.escape(v)}"]`).join('')
  ;($(sel, root) || null)?.focus()
}
const usedAttrs = (b, names) => b ? Object.fromEntries(names.filter((n) => b.hasAttribute(n)).map((n) => [n, b.getAttribute(n)])) : null

// ---- /preorder

/** The varieties with pre-order weeks, each with its boxes (price from the weeks) and their weeks in order. */
function preVarieties() {
  const map = new Map()
  for (const w of pre.weeks) {
    if (!map.has(w.variety)) map.set(w.variety, new Map())
    const boxes = map.get(w.variety)
    if (!boxes.has(w.sku)) boxes.set(w.sku, { sku: w.sku, name: w.name, variety: w.variety, boxSize: w.boxSize, price: w.price, weeks: [] })
    boxes.get(w.sku).weeks.push(w)
  }
  return [...map].map(([name, boxes]) => {
    const list = [...boxes.values()].sort((a, b) => kgOf(a) - kgOf(b))
    list.forEach((b) => b.weeks.sort((x, y) => x.weekStart.localeCompare(y.weekStart)))
    const c = shelf.find((v) => v.name === name)?.c || contentFor(name, list.map((b) => ({ ...(skuOf(b.sku) || {}), ...b })))
    return { name, c, skus: list }
  }).sort((a, b) => (b.c.popularity || 0) - (a.c.popularity || 0) || a.name.localeCompare(b.name))
}

function prePick(v) {
  const p = doorPick.pre[v.name] ||= {}
  if (!v.skus.some((b) => b.sku === p.sku)) p.sku = (v.skus.find((b) => (b.weeks || []).some((w) => w.remaining > 0)) || v.skus[0]).sku
  if (!pre.stages.includes(p.stage)) {
    const st = stageFor(v)
    p.stage = pre.stages.includes(st) ? st : pre.stage
  }
  return p
}

function renderPreGrid(focus) {
  const grid = $('#pre-grid')
  if (!grid) return
  const alert = pre.error && !pre.weeks.length ? `<p class="prototype-tag" role="alert">${esc(pre.error)}</p>` : ''
  if (!pre.weeks.length) {
    grid.innerHTML = `<div class="door-intro"><h2 class="flow-head">Coming this season</h2><p>Pre-orders open soon. Check back before the season.</p>${alert}</div><div class="product-grid door-grid">${shelf.map((v) => {
      const p = doorPick.pre[v.name] ||= { sku: v.skus[0].sku, stage: stageFor(v) }
      return doorCard(v, { kind: 'pre', sku: p.sku, stage: p.stage, boxes: v.skus, stages: pre.stages, muted: true, action: `<button class="quick-add" disabled aria-label="Pre-order ${esc(v.name)}: opens soon">Pre-order</button>` })
    }).join('')}</div>`
    refocus(grid, focus)
    return
  }
  const list = preVarieties()
  grid.innerHTML = `<div class="door-intro"><h2 class="flow-head">Choose your box</h2><p>${list.length} ${list.length === 1 ? 'variety' : 'varieties'} open for pre-order. Pick a ripeness and box, then tap Pre-order.</p></div><div class="product-grid door-grid">${list.map((v) => {
    const p = prePick(v), box = v.skus.find((b) => b.sku === p.sku)
    const open = box.weeks.some((w) => w.remaining > 0)
    const weeks = `<p class="door-weeks"><span>Harvest weeks:</span> ${box.weeks.map((w) => w.remaining > 0 ? `<b>${fmtWeek(w.weekStart)}</b>` : `<span class="is-out"><s>${fmtWeek(w.weekStart)}</s> Sold out</span>`).join(', ')}</p>`
    const action = open
      ? `<button class="quick-add" data-pre-open="${esc(v.name)}" aria-label="Pre-order a ${esc(kgText(box))} box of ${esc(stageOf(p.stage).stage.toLowerCase())} ${esc(v.name)}">Pre-order</button>`
      : `<button class="quick-add is-out" disabled aria-label="${esc(v.name)} ${esc(kgText(box))} box: every week is sold out">Sold out</button>`
    return doorCard(v, { kind: 'pre', sku: p.sku, stage: p.stage, boxes: v.skus, stages: pre.stages, extra: weeks, action, chosen: pre.open && v.skus.some((b) => b.sku === pre.sku) })
  }).join('')}</div>`
  refocus(grid, focus)
}

/** "Pre-order" on a card: the booking panel for that box, stage and its first open week, under the cards. */
function openPreBooking(name) {
  const v = preVarieties().find((x) => x.name === name)
  if (!v) return
  const p = prePick(v), box = v.skus.find((b) => b.sku === p.sku) || v.skus[0]
  Object.assign(pre, { sku: box.sku, stage: p.stage, weekStart: (box.weeks.find((w) => w.remaining > 0) || box.weeks[0]).weekStart, qty: 1, error: '', offer: false, unpaid: null, force: false, open: true })
  preBox = view = '#pre-box'
  renderPreorder()
  const panel = $('#pre-box')
  if (!panel || panel.hidden) return
  panel.scrollIntoView({ block: 'start', behavior: reduced ? 'instant' : 'smooth' })
  const h = $('.flow-head', panel)
  if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }) }
}

/** A choice inside the booking panel (box, ripeness, week, quantity). */
function prePanel(b) {
  const d = b.dataset
  if (d.preBox) { pre.sku = d.preBox; pre.weekStart = null }
  else if (d.preStage) pre.stage = d.preStage
  else if (d.preWeek) pre.weekStart = d.preWeek
  else if (d.preStep) pre.qty += Number(d.preStep)
  pre.error = ''
  pre.offer = false
  preFix()
  const w = pre.weeks.find((x) => x.sku === pre.sku)
  if (w) doorPick.pre[w.variety] = { sku: pre.sku, stage: pre.stage }
  renderPreorder()
  refocus(preHost(), usedAttrs(b, ['data-pre-box', 'data-pre-stage', 'data-pre-week', 'data-pre-step']))
  if (d.preStep && document.activeElement === document.body) $('[data-pre-step]:not(:disabled)', preHost())?.focus()
}

function preorderPage() {
  host().innerHTML = pageHead('Pre-order') + `
    <section class="door-hero season">
      <div class="season-art"><img src="assets/hero.webp" alt="Sun-kissed mangoes among orchard leaves"><span class="season-stamp">Some things<br>are worth<br><em>the wait.</em></span></div>
      <div class="season-copy"><h2>First in line.<br><em>First taste of summer.</em></h2><p>Reserve your mango moment before the season begins. Choose your ripeness, box and harvest week, and we’ll keep your box ready.</p><small>Paid in full by Razorpay · cancel any time before packing for a full refund.</small><button class="button secondary door-mine" data-preorders hidden>My pre-orders ${icon('arrow')}</button></div>
    </section>
    <section class="door-cards" id="pre-grid" aria-label="Boxes open for pre-order"></section>
    <section class="page-card door-flow pre-flow" id="pre-box" aria-label="Book a pre-order" hidden></section>`
  preorderForm('#pre-box')
  MM.restore().then(() => {
    const b = $('#page-body .door-mine')
    if (b) b.hidden = !MM.profile()
  })
}

// ---- /bulk

const bulkLines = () => bulkList ??= read('mm-bulk', []).filter((x) => x && typeof x.sku === 'string' && STAGES.some((p) => p.apiStage === x.stage) && Number.isInteger(x.qty) && x.qty > 0)

function bulkTotals() {
  return bulkLines().reduce((t, x) => {
    const s = skuOf(x.sku)
    t.boxes += x.qty
    t.kg += (s ? kgOf(s) : 0) * x.qty
    return t
  }, { boxes: 0, kg: 0 })
}

/** The list as the enquiry shows and sends it: one line per box and ripeness. */
function bulkSummary() {
  return bulkLines().map((x) => {
    const s = skuOf(x.sku), kg = (s ? kgOf(s) : 0) * x.qty
    return { sku: x.sku, stage: x.stage, boxes: x.qty, kg, label: `${s ? s.variety : x.sku} · ${s ? kgText(s) + ' box' : 'box'} · ${stageOf(x.stage).stage}` }
  })
}

function bulkPick(v) {
  const p = doorPick.bulk[v.name] ||= {}
  if (!v.skus.some((s) => s.sku === p.sku)) p.sku = v.skus[0].sku
  if (!STAGES.some((x) => x.apiStage === p.stage)) p.stage = stageFor(v)
  return p
}

function bulkAction(v, p) {
  const s = skuOf(p.sku), st = stageOf(p.stage)
  const what = esc(`${kgText(s)} boxes of ${st.stage.toLowerCase()} ${v.name}`)
  const key = `data-sku="${esc(p.sku)}" data-stage="${esc(p.stage)}"`
  const line = bulkLines().find((x) => x.sku === p.sku && x.stage === p.stage)
  if (!line) return `<button class="quick-add" data-bulk-qty="1" ${key} aria-label="Add ${what} to your bulk list">Add to bulk list</button>`
  return `<div class="card-stepper" role="group" aria-label="${what} in your bulk list"><button data-bulk-qty="-1" ${key} aria-label="One box fewer">−</button><span aria-live="polite">${line.qty}</span><button data-bulk-qty="1" ${key} aria-label="One box more">+</button></div><p class="door-kg"><span>${line.qty} ${line.qty === 1 ? 'box' : 'boxes'} · ${line.qty * kgOf(s)} kg</span><button class="door-more" data-bulk-qty="10" ${key} aria-label="Ten more ${what}">+10 boxes</button></p>`
}

function renderBulkGrid(focus) {
  const grid = $('#bulk-grid')
  if (!grid) return
  if (!shelf.length) {
    grid.innerHTML = '<p class="page-note">Loading the mangoes…</p>'
    return
  }
  grid.innerHTML = `<div class="door-intro"><h2 class="flow-head">Build your bulk list</h2><p>Pick boxes by ripeness and size. Once your list reaches ${BULK_MIN_KG} kg, send it to us and we’ll come back with a quote. Prices shown are our shop prices per box.</p></div><div class="product-grid door-grid">${shelf.map((v) => {
    const p = bulkPick(v)
    return doorCard(v, { kind: 'bulk', sku: p.sku, stage: p.stage, boxes: v.skus, stages: STAGES.map((x) => x.apiStage), action: bulkAction(v, p), chosen: bulkLines().some((x) => v.skus.some((s) => s.sku === x.sku)) })
  }).join('')}</div>`
  refocus(grid, focus)
}

/** The sticky bar on /bulk: the list's weight and boxes, and "Send enquiry" once it reaches 100 kg. */
function bulkBar() {
  if (document.body.dataset.page !== 'bulk') return
  const t = bulkTotals(), ok = t.kg >= BULK_MIN_KG
  setBar(`${ok ? '' : `<p class="pay-bar-hint" role="status">Add at least ${BULK_MIN_KG} kg${t.kg ? ` · ${BULK_MIN_KG - t.kg} kg to go` : ' to send an enquiry'}</p>`}<div class="pay-bar-row"><div class="pay-bar-total"><small>Your bulk list</small><strong>${t.kg} kg · ${t.boxes} ${t.boxes === 1 ? 'box' : 'boxes'}</strong></div><button class="button primary pay-bar-go" id="bulk-send" ${ok ? '' : 'disabled'}>Send enquiry ${icon('arrow')}</button></div>`)
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
  bulkBar()
  // An open enquiry form follows the list.
  const box = $('#bulk-box')
  if (box && !box.hidden && $('#bulk-form', box)) bulkForm('#bulk-box')
}

function openBulkEnquiry() {
  const box = $('#bulk-box')
  if (!box || bulkTotals().kg < BULK_MIN_KG) return
  box.hidden = false
  bulkForm('#bulk-box')
  box.scrollIntoView({ block: 'start', behavior: reduced ? 'instant' : 'smooth' })
  const h = $('.flow-head', box)
  if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }) }
}

function bulkPage() {
  host().innerHTML = pageHead('Bulk orders') + `
    <section class="door-hero bulk">
      <div><h2>Big on mangoes?<br><em>So are we.</em></h2><p>For shops, kitchens, gifting and everything in between. Planning an order above ${BULK_MIN_KG} kg? Let’s make it happen.</p></div>
      <div class="bulk-type" aria-hidden="true">${BULK_MIN_KG}<span>+</span><small>KILOGRAMS OF POSSIBILITY</small></div>
    </section>
    <section class="door-cards" id="bulk-grid" aria-label="Mangoes for your bulk list"></section>
    <section class="page-card door-flow" id="bulk-box" aria-label="Bulk enquiry" hidden></section>`
  bulkBar()
  renderBulkGrid()
  shelfReady().then(() => {
    if (document.body.dataset.page !== 'bulk') return
    renderBulkGrid()
    bulkBar()
  })
}

document.addEventListener('click', (e) => {
  const b = e.target instanceof Element ? e.target.closest('button,a') : null
  if (!b) return
  const d = b.dataset
  if (d.doorStage || d.doorBox) {
    const kind = d.door, name = d.variety
    doorPick[kind][name] = { ...doorPick[kind][name], [d.doorStage ? 'stage' : 'sku']: d.doorStage || d.doorBox }
    const focus = usedAttrs(b, ['data-door-stage', 'data-door-box', 'data-variety'])
    if (kind === 'pre') renderPreGrid(focus)
    else renderBulkGrid(focus)
  } else if (d.preOpen) openPreBooking(d.preOpen)
  else if (d.preBox || d.preStage || d.preWeek || d.preStep) prePanel(b)
  else if (d.bulkQty) bulkStep(b)
  else if (b.id === 'bulk-send') openBulkEnquiry()
  else if (b.hasAttribute('data-bulk-edit')) {
    e.preventDefault()
    $('#bulk-grid')?.scrollIntoView({ block: 'start', behavior: reduced ? 'instant' : 'smooth' })
  }
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
      ${addresses.length ? addresses.map((a) => `<div class="address-row"><div><strong>${esc(a.name || 'Saved address')}</strong><small>${esc(addressText(a.address))} · ${esc(a.pincode)}</small></div><button class="text-button" data-remove-address="${esc(a.id)}">Remove</button></div>`).join('') : '<p class="page-note">The addresses you deliver to are saved here after your first order, ready to pick at checkout.</p>'}
    </section>
    <section class="page-card">
      <h3>Favourites</h3>
      ${favs.length ? `<div class="fav-chips">${favs.map((n) => `<button class="occasion" data-fav-open="${esc(n)}">${icon('heart')}${esc(n)}</button>`).join('')}</div>` : '<p class="page-note">Tap the heart on a mango to keep it here.</p>'}
    </section>
    <section class="page-card">
      <h3>Updates</h3>
      <label class="toggle-row"><span><strong>WhatsApp reminders</strong><small>A note a week after delivery to ask how your mangoes were.</small></span><input type="checkbox" role="switch" data-reminders ${me.remindersOptIn ? 'checked' : ''}></label>
    </section>
    <section class="page-card page-actions">
      <button class="button secondary" data-preorders>My pre-orders ${icon('sun')}</button>
      <button class="button secondary" data-signout>Sign out</button>
    </section>`
}

// ---- The order tracking page (/orders/:id).

const TRACK_STEPS = [
  ['Placed', ['PAYMENT_PENDING']],
  ['Confirmed', ['CONFIRMED']],
  ['Packed', ['PROCESSING', 'PACKED']],
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
    case 'PAYMENT_PENDING': return ['Waiting for payment', o.holdExpiresAt ? `Your mangoes are held until ${fmtTime(o.holdExpiresAt)}.` : arriving]
    case 'CONFIRMED': return [o.findingStock ? 'Confirmed. Finding your mangoes' : 'Confirmed', o.findingStock ? 'We’re lining up the right fruit for your date and will message you if anything changes.' : arriving]
    case 'PROCESSING': case 'PACKED': return ['Packed and ready', arriving]
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
    const t = (o.timeline || []).find((e) => list.includes(e.status))
    return t ? when(t.at) : ''
  }
  return `<ol class="tracker" aria-label="Order progress">${TRACK_STEPS.map(([label, list], i) => {
    const state = i < at ? 'done' : i === at ? (o.status === 'DELIVERY_FAILED' ? 'missed' : 'current') : ''
    return `<li class="${state}"${i === at ? ' aria-current="step"' : ''}><span class="tracker-dot">${i < at || (i === at && o.status === 'DELIVERED') ? icon('check') : ''}</span><strong>${label}</strong><small>${i <= at ? stamp(list) : ''}</small></li>`
  }).join('')}</ol>`
}

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
    p.paymentId && [`${esc(p.gateway || 'Razorpay')} payment ID`, esc(p.paymentId)],
    p.paidAt && ['Paid on', when(p.paidAt)],
  ].filter(Boolean)
  return `<dl class="pay-facts">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`
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
  const canCancel = ['PAYMENT_PENDING', 'CONFIRMED', 'PROCESSING'].includes(o.status)
  const pin = addressPin(o.deliveryAddress)
  const wa = String((window.MM_CONFIG || {}).supportWhatsapp || '').trim()
  host().innerHTML = head(`Order ${esc(orderNo(o.number))}`) + marker(seq) + `
    <section class="page-card track-hero status-${esc(o.status.toLowerCase())}">
      <h2>${title}</h2><p>${sub}</p>
      ${tracker(o)}
      ${o.deliveryCode ? `<div class="delivery-code"><span>Delivery code</span><strong>${[...String(o.deliveryCode)].map((d) => `<i>${esc(d)}</i>`).join('')}</strong><small>Share it with ${o.rider && o.rider.firstName ? esc(o.rider.firstName) : 'your rider'} when your mangoes arrive.</small></div>` : ''}
      ${o.delivery && o.delivery.hasPhoto ? '<figure class="delivery-photo"><img alt="Photo taken at delivery" hidden><figcaption>Photo at delivery</figcaption></figure>' : ''}
      ${canPay ? `<button class="button primary full" data-pay-order="${esc(o.id)}">Pay now ${currency(o.total)} ${icon('arrow')}</button>` : ''}
    </section>
    <section class="page-card">
      <h3>Delivering to</h3>
      <p class="track-address">${esc(addressText(o.deliveryAddress))}${o.pincode ? ` · ${esc(o.pincode)}` : ''}</p>
      ${pin ? '<div class="track-map" role="img" aria-label="Delivery location on the map"></div>' : ''}
    </section>
    <section class="page-card">
      <h3>Your box${(o.items || []).length > 1 ? 'es' : ''}</h3>
      ${(o.items || []).map((l) => {
        const st = stageOf(l.stage)
        return `<div class="cart-row">${thumb(l.sku, l.stage, l.name)}<div><h3>${esc(l.name)}</h3><small>${st.stage} · ${l.quantity} × ${currency(l.unitPrice)}${l.eatBy ? ` · best by ${fmtDate(l.eatBy)}` : ''}</small><div class="cart-row-bottom"><span></span><strong>${currency(l.linePrice)}</strong></div></div></div>`
      }).join('')}
      ${o.discount ? `<div class="subtotal"><span>Discount</span><strong>−${currency(o.discount)}</strong></div>` : ''}
      <div class="subtotal"><span>Total</span><strong>${currency(o.total)}</strong></div>
      <p class="cart-disclaimer">Placed ${when(o.placedAt)} · Prices include GST.</p>
      ${paymentBlock(o)}
    </section>
    <section class="page-card page-actions">
      ${/^\d+$/.test(wa) ? `<a class="button secondary" href="https://wa.me/${wa}?text=${encodeURIComponent(`Hi Mango Mandi, about my order ${orderNo(o.number)}`)}" target="_blank" rel="noopener">Help on WhatsApp</a>` : ''}
      ${o.bill ? `<button class="button primary" data-invoice="${esc(o.id)}" data-number="${esc(o.number)}">Download invoice ${icon('arrow')}</button>` : ''}
      ${o.status === 'DELIVERED' ? `<button class="button secondary" data-review="${esc(o.id)}">${o.rating ? 'Edit your review' : 'Rate this order'}</button>` : ''}
      ${canCancel ? `<button class="button secondary" data-cancel-order="${esc(o.id)}" data-number="${esc(orderNo(o.number))}">Cancel order</button>` : ''}
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
  if (!ENDED.includes(o.status)) again()
}

// ---- Events.

// Links inside the app (data-route) and the home anchors (#shop, #bulk…) while a page is open.
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey) return
  const a = e.target instanceof Element ? e.target.closest('a') : null
  if (!a) return
  const href = a.getAttribute('href') || ''
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
    MM.deleteAddress(b.dataset.removeAddress).then(() => {
      toast('Address removed')
      accountView()
    }, (err) => toast(err.message))
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
