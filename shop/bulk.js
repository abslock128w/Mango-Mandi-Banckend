/* The bulk page's three tabs and the bulk order paid at once (mango-api README, Bulk orders).
   /bulk (Bulk order: 100 kg and above, ordered and paid now), /bulk/enquiry (Send enquiry: 250 kg and above, a quote)
   and /bulk/farm-visit (Farm visit: 100 kg and above, pick your own, the stay is free; farm.js books it). Each tab is
   its own address, so it can be linked and the back button works. The tab row is a real tablist (arrow keys, Home,
   End) whose bead slides from the old tab to the new one.
   The list builder is pages.js's; this file adds the bulk prices (GET /v1/bulk/prices: the shop price less the
   default discount, or a manager's own price; the 10 kg box is twice the 5 kg), the order flow (details, the
   checkout's own sign-in steps, review, pay by Razorpay payment link, or the test payment locally) and the order
   page /bulk/orders/:id (payment, receipt, cancel within 4 hours of paying for a full refund, refund).
   Money from these routes stays in paise (api.js `bulk…` calls) and is shown with bulkRs.
   Loaded after pages.js and farm.js (it adds to PAGES) and before app.js: top-level code only declares and listens. */

PAGES.push([/^\/bulk\/orders\/([^/]+)\/?$/, (m) => signedInThen('Bulk order', () => bulkOrderView(decodeURIComponent(m[1])))])

const BULK_TABS = [
  { id: 'order', href: '/bulk', name: 'Bulk order', promise: ['100 kg and above', 'order and pay now'] },
  { id: 'enquiry', href: '/bulk/enquiry', name: 'Send enquiry', promise: ['250 kg and above', 'get a quote'] },
  { id: 'farm-visit', href: '/bulk/farm-visit', name: 'Farm visit', promise: ['100 kg and above', 'pick your own, stay free'] },
]
let bulkTab = 'order'
const bulkRs = (paise) => currency((Number(paise) || 0) / 100)

// ---- The tabs

function bulkTabsHTML(tab) {
  return `<div class="bulk-tabs" role="tablist" aria-label="Ways to buy in bulk"><span class="bulk-tabs-pill" aria-hidden="true"></span>${BULK_TABS.map((t) => {
    const on = t.id === tab
    return `<a class="bulk-tab${on ? ' is-on' : ''}" role="tab" id="bulk-tab-${t.id}" href="${t.href}" data-route aria-selected="${on}" aria-controls="bulk-panel" tabindex="${on ? 0 : -1}"><strong>${t.name}</strong><small><span>${t.promise[0]}</span><span>${t.promise[1]}</span></small></a>`
  }).join('')}</div>`
}

/** Where the tab row sat on screen before a switch, so the new page keeps it there (a page change scrolls to the top). */
let bulkTabsTop = null
let bulkTabsFocus = false

/** Puts the bead on the chosen tab, sliding it from the tab that was chosen before (none: it just appears). */
function bulkTabsSlide(was) {
  const row = $('.bulk-tabs'), pill = row && $('.bulk-tabs-pill', row), on = row && $('.bulk-tab.is-on', row)
  if (!pill || !on) return
  if (bulkTabsTop != null) {
    window.scrollTo({ top: Math.max(0, row.getBoundingClientRect().top + scrollY - bulkTabsTop), behavior: 'instant' })
    bulkTabsTop = null
  }
  if (bulkTabsFocus) { on.focus({ preventScroll: true }); bulkTabsFocus = false }
  const place = (el) => { pill.style.width = `${el.offsetWidth}px`; pill.style.height = `${el.offsetHeight}px`; pill.style.transform = `translate(${el.offsetLeft}px, ${el.offsetTop}px)` }
  const from = was && was !== bulkTab && $(`#bulk-tab-${was}`, row)
  pill.classList.remove('is-moving')
  place(from || on)
  if (!from || reduced) { place(on); return }
  void pill.offsetWidth
  pill.classList.add('is-moving')
  requestAnimationFrame(() => place(on))
}
window.addEventListener('resize', () => {
  const row = $('.bulk-tabs'), pill = row && $('.bulk-tabs-pill', row), on = row && $('.bulk-tab.is-on', row)
  if (!pill || !on) return
  pill.classList.remove('is-moving')
  pill.style.width = `${on.offsetWidth}px`; pill.style.height = `${on.offsetHeight}px`; pill.style.transform = `translate(${on.offsetLeft}px, ${on.offsetTop}px)`
})
// Remember where the row is before a tab is chosen (pointer or keys).
document.addEventListener('pointerdown', (e) => {
  const t = e.target instanceof Element && e.target.closest('.bulk-tab')
  if (t) bulkTabsTop = t.closest('.bulk-tabs').getBoundingClientRect().top
}, true)
// The tablist's keys: arrows move and choose (each tab is a page), Home and End go to the ends.
document.addEventListener('keydown', (e) => {
  const t = e.target instanceof Element && e.target.closest('.bulk-tab')
  if (!t || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
  e.preventDefault()
  const i = BULK_TABS.findIndex((x) => `bulk-tab-${x.id}` === t.id)
  const n = e.key === 'Home' ? 0 : e.key === 'End' ? BULK_TABS.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + BULK_TABS.length) % BULK_TABS.length
  if (n === i) return
  bulkTabsTop = t.closest('.bulk-tabs').getBoundingClientRect().top
  bulkTabsFocus = true
  go(BULK_TABS[n].href)
})

/** "How it works" for the tab: each card shows its title; a tap (or Enter/Space) opens its detail line. */
function bulkKeyHTML(tab) {
  const li = (ic, title, text) => `<li><details><summary>${icon(ic)}<strong>${title}</strong>${icon('chevron')}</summary><span>${text}</span></details></li>`
  const items = tab === 'enquiry' ? [
    li('scale', `${BULK_ENQUIRY_MIN_KG} kg minimum`, `Enquiries are for ${BULK_ENQUIRY_MIN_KG} kg and more. From ${BULK_MIN_KG} kg you can also order and pay at the bulk price straight away.`),
    li('tag', 'A price for you', 'We start from the bulk price and quote you on WhatsApp. Your quote can be lower.'),
    li('check', 'Nothing paid now', 'Accept or decline the quote on your account. We call you to arrange delivery and payment.'),
    li('truck', `Delivery: ${BULK_DELIVERY_PCT}% of the mangoes’ value`, 'Shown on the quote, with any extra costs such as special packaging.'),
  ] : tab === 'farm-visit' ? [
    li('scale', `${BULK_MIN_KG} kg minimum`, `Book ${BULK_MIN_KG} kg or more of one variety for your visit day.`),
    li('tree', 'Your stay is free', 'Stay at the farmhouse at no charge while you visit.'),
    li('store', 'Food is paid at the farm', 'Meals are cooked by our farm team and paid to them directly at the farm. They are never on our bill.'),
    li('mango', 'Pick your own mangoes', 'Walk the orchard and pick them with our farm team.'),
    li('scale', 'Pay for the mangoes after weighing', 'You pay only for the kilograms weighed and accepted, after picking.'),
  ] : [
    li('scale', `${BULK_MIN_KG} kg minimum`, `Your list must reach ${BULK_MIN_KG} kg, in 5 kg or 10 kg boxes.`),
    li('tag', `Bulk price: about ${bulkDiscountWords()} off`, 'Lower than the shop price on every box, shown on each one. No waiting for a quote.'),
    li('check', 'Order and pay now', 'You pay the full amount online. Our team then calls you on WhatsApp to arrange the delivery.'),
    li('calendar', `Delivered in ${BULK_DAYS}`, `Delivery is ${BULK_DELIVERY_PCT}% of the mangoes’ value, added to the total.`),
    li('clock', `Cancel within ${hoursWord(cancelHours())} of paying`, 'For a full refund, until it is dispatched.'),
  ]
  const title = tab === 'enquiry' ? 'How enquiries work' : tab === 'farm-visit' ? 'How farm visits work' : 'How bulk orders work'
  return `<section class="bulk-key" aria-labelledby="bulk-key-h"><h2 id="bulk-key-h">${title}</h2><ul class="bulk-key-list">${items.join('')}</ul></section>`
}

// ---- Bulk prices (GET /v1/bulk/prices, paise) as rupees, by the list's ids ("ALP-5", "ALP-5@10").

let bulkPriceMap = null, bulkPricePct = null, bulkPriceAsk = null
function loadBulkPrices() {
  return bulkPriceAsk ??= MM.bulkPrices().then((r) => {
    bulkPricePct = r.discountPct
    bulkPriceMap = new Map()
    for (const it of r.items || []) for (const p of it.packs || []) bulkPriceMap.set(p.packKg === 10 ? `${it.sku}@10` : it.sku, { price: p.price / 100, bulk: p.bulkPrice / 100, pct: p.savingPct })
  }, () => { bulkPriceAsk = null })
}
/** { price, bulk, pct } in rupees for a list id, once the prices are in; else null. */
const bulkPriceFor = (id) => (bulkPriceMap && bulkPriceMap.get(id)) || null
const bulkDiscountWords = () => `${bulkPricePct ?? 25}%`
/** A box's price on the adder: the shop's struck through and the bulk price. */
function bulkPriceHTML(id, shop) {
  const bp = bulkPriceFor(id)
  return bp
    ? `<strong class="bulk-price"><s aria-label="shop price ${currency(bp.price)}">${currency(bp.price)}</s> ${currency(bp.bulk)}<small> / box in bulk</small></strong>`
    : `<strong>${currency(shop)}<small> / box</small></strong>`
}
/** A list line's money: shop price struck through, bulk price. */
function bulkLineMoney(x) {
  const bp = bulkPriceFor(x.sku)
  return bp ? `<small class="bulk-line-price"><s aria-label="at shop prices ${currency(bp.price * x.qty)}">${currency(bp.price * x.qty)}</s> ${currency(bp.bulk * x.qty)}</small>` : ''
}
/** Under the list: mangoes at bulk prices, what you save, and on the order tab delivery and the total to pay. */
function bulkMoneyHTML(t) {
  if (!t.boxes || !t.priced) return t.boxes ? `<p class="bulk-money-note">${icon('info')}<span>Getting the bulk prices…</span></p>` : ''
  const save = t.value - t.bulk, pct = t.value ? Math.round((save / t.value) * 100) : 0, fee = Math.round(t.bulk * BULK_DELIVERY_PCT / 100)
  const row = (dt, dd, cls = '') => `<div${cls ? ` class="${cls}"` : ''}><dt>${dt}</dt><dd>${dd}</dd></div>`
  if (bulkTab === 'enquiry') {
    return `<dl class="bulk-money">${row('Mangoes at bulk prices', `<s>${currency(t.value)}</s> ${currency(t.bulk)}`)}${row('You save', `${currency(save)} (${pct}%)`, 'is-save')}</dl><p class="bulk-money-note">${icon('info')}<span>Your quote starts here and can be lower. Delivery (${BULK_DELIVERY_PCT}%) is added on the quote.</span></p>`
  }
  return `<dl class="bulk-money">${row('Mangoes at bulk prices', `<s>${currency(t.value)}</s> ${currency(t.bulk)}`)}${row('You save', `${currency(save)} (${pct}%)`, 'is-save')}${row(`Delivery <small>${BULK_DELIVERY_PCT}% of the mangoes’ value</small>`, currency(fee))}${row('Total to pay', currency(t.bulk + fee), 'is-total')}</dl>`
}

// ---- The order flow under the list: details → (sign in) → review → pay.

const bf = { step: null, key: null, error: '', busy: false }
const BULK_ORDER_DRAFT = 'mm-bulk-draft'
const bulkFlowOpen = () => Boolean(bf.step) && !!$('#bulk-box') && !$('#bulk-box').hidden
function bulkFlowReset() { bf.step = null; bf.error = ''; bf.busy = false }
const bulkDraft = () => { const d = read(BULK_ORDER_DRAFT, {}); return d && typeof d === 'object' ? d : {} }

/** "Order and pay" in the bar: the details form under the list. */
function bulkOrderStart() {
  const box = $('#bulk-box')
  if (!box || bulkTotals().kg < BULK_MIN_KG) return
  bf.step = 'details'
  bf.error = ''
  box.hidden = false
  bulkOrderDraw()
  bulkBar()
  box.scrollIntoView({ block: 'start', behavior: reduced ? 'instant' : 'smooth' })
  const h = $('.flow-head', box)
  if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }) }
}

/** The list changed while the flow is open: follow it, or close it under 100 kg (the bar says why). */
function bulkOrderFollow() {
  if (!bulkFlowOpen()) return
  if (bulkTotals().kg < BULK_MIN_KG) { const box = $('#bulk-box'); box.hidden = true; box.innerHTML = ''; bulkFlowReset(); bulkBar(); return }
  if (bf.step === 'details') bulkKeepTyped()
  bf.key = null // a new list is a new order
  bulkOrderDraw()
}

function bulkKeepTyped() {
  const f = $('#bulk-order-form')
  if (!f) return
  const d = bulkDraft()
  for (const k of ['name', 'business', 'phone', 'city', 'address', 'pincode', 'notes']) { const el = f.elements.namedItem(k); if (el) d[k] = el.value }
  save(BULK_ORDER_DRAFT, d)
}

const bulkLinesHTML = () => bulkSummary().map((l) => {
  const bp = bulkPriceFor(l.packKg ? `${l.sku}@${l.packKg}` : l.sku)
  return `<li><span>${esc(l.label)} <small>${l.boxes} × ${bp ? `<s>${currency(bp.price)}</s> ${currency(bp.bulk)}` : '…'}</small></span><strong>${bp ? currency(bp.bulk * l.boxes) : ''}</strong></li>`
}).join('')

function bulkOrderDraw() {
  const box = $('#bulk-box')
  if (!box) return
  const t = bulkTotals(), fee = Math.round(t.bulk * BULK_DELIVERY_PCT / 100), d = bulkDraft(), me = MM.profile() || {}
  const err = bf.error ? `<p class="prototype-tag bulk-error" role="alert">${esc(bf.error)}</p>` : ''
  if (bf.step === 'details') {
    const v = (k, fallback = '') => esc(d[k] ?? fallback)
    box.innerHTML = `${flowHead('Where should it go?')}<p>Your details for this bulk order. Next you sign in (if you haven’t) and see the total before paying.</p>${err}
      <form id="bulk-order-form" novalidate><div class="form-grid">
        <label class="field">Your name<input name="name" autocomplete="name" required maxlength="100" value="${v('name', me.name || '')}"></label>
        <label class="field">Business / organisation <small>(optional)</small><input name="business" autocomplete="organization" maxlength="120" value="${v('business')}"></label>
        <label class="field">Phone / WhatsApp number<input name="phone" type="tel" inputmode="tel" autocomplete="tel" required maxlength="20" placeholder="10-digit mobile" value="${v('phone', String(me.phone || '').replace(/^\+91/, ''))}"></label>
        <label class="field">City<input name="city" autocomplete="address-level2" required maxlength="100" value="${v('city')}"></label>
        <label class="field wide">Delivery address<textarea name="address" rows="2" autocomplete="street-address" required maxlength="500" placeholder="Building, street, area">${v('address')}</textarea></label>
        <label class="field">Pincode<input name="pincode" inputmode="numeric" autocomplete="postal-code" required maxlength="6" value="${v('pincode', where.pincode || '')}"></label>
        <label class="field wide">Anything else? <small>(optional)</small><textarea name="notes" rows="2" maxlength="1000" placeholder="Timing, unloading, packaging">${v('notes')}</textarea></label>
      </div>
      <button class="button primary full" type="submit">${MM.profile() ? 'See the total' : 'Sign in and see the total'} ${icon('arrow')}</button>
      <button type="button" class="text-button bulk-lines-edit" data-bulk-edit>Change the list</button></form>`
    return
  }
  if (bf.step === 'review') {
    const h = hoursWord(cancelHours())
    box.innerHTML = `${flowHead('Check and pay.')}${err}
      <section class="bulk-review" aria-label="Your bulk order">
        <ul class="bulk-review-lines">${bulkLinesHTML()}</ul>
        <dl class="bulk-money">
          <div><dt>Mangoes at bulk prices <small>${t.kg} kg · ${t.boxes} ${t.boxes === 1 ? 'box' : 'boxes'}</small></dt><dd><s>${currency(t.value)}</s> ${currency(t.bulk)}</dd></div>
          <div class="is-save"><dt>You save</dt><dd>${currency(t.value - t.bulk)} (${t.value ? Math.round(((t.value - t.bulk) / t.value) * 100) : 0}%)</dd></div>
          <div><dt>Delivery <small>${BULK_DELIVERY_PCT}% of the mangoes’ value</small></dt><dd>${currency(fee)}</dd></div>
          <div class="is-total"><dt>Total to pay now</dt><dd>${currency(t.bulk + fee)}</dd></div>
        </dl>
        <p class="bulk-review-to">${icon('pin')}<span>${esc(d.name || '')}${d.business ? `, ${esc(d.business)}` : ''} · +91 ${esc(normPhone(d.phone))}<br>${esc(d.address || '')}, ${esc(d.city || '')} ${esc(d.pincode || '')}</span></p>
        <p class="bulk-pay-notice">${icon('info')}<span><strong>You pay the full amount now.</strong> Our team will call you on WhatsApp to arrange the delivery, usually within ${BULK_DAYS}.</span></p>
        <div class="co-cancel cancel-note" role="note"><span class="co-cancel-icon" aria-hidden="true">${icon('clock')}</span><div><p class="co-cancel-lead">You can cancel within ${h} of paying for a full refund.</p><p class="co-cancel-more">Only until it is dispatched. After that it can’t be cancelled here: message us and our team will help.${policyLink()}</p></div></div>
        <button class="button primary full" type="button" data-bulk-pay ${bf.busy || !t.priced ? 'disabled' : ''}>${bf.busy ? 'Placing your order…' : `Pay ${currency(t.bulk + fee)} now`} ${bf.busy ? '' : icon('arrow')}</button>
        ${t.priced ? '' : `<p class="bulk-add-why">${icon('lock')}<span>Getting today’s bulk prices. Try again in a moment.</span></p>`}
        <div class="bulk-review-more"><button type="button" class="text-button" data-bulk-details>Change details</button><button type="button" class="text-button" data-bulk-edit>Change the list</button></div>
      </section>`
  }
}

function bulkDetailsSubmit(form) {
  if (!checkFields(form, [
    ['name', (v) => (v.trim() ? '' : 'Tell us your name.')],
    ['phone', (v) => (/^[6-9]\d{9}$/.test(normPhone(v)) ? '' : 'Enter a 10-digit mobile number.')],
    ['city', (v) => (v.trim() ? '' : 'Tell us the city.')],
    ['address', (v) => (v.trim().length >= 5 ? '' : 'Enter the delivery address.')],
    ['pincode', (v) => (/^[1-9]\d{5}$/.test(v.trim()) ? '' : 'Enter the 6-digit pincode.')],
  ])) return
  bulkKeepTyped()
  if (MM.profile()) return bulkReview()
  // The checkout's own sign-in steps (phone, then the code), drawn here under the list; then the review.
  view = '#bulk-box'
  startSteps('Sign in to pay', false, () => { view = '#page-body'; bulkReview() }, 'bulk')
}

function bulkReview() {
  if (document.body.dataset.page !== 'bulk') return
  bf.step = 'review'
  bf.error = ''
  $('#bulk-box').hidden = false
  bulkOrderDraw()
  const h = $('#bulk-box .flow-head')
  if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); h.scrollIntoView({ block: 'start', behavior: reduced ? 'instant' : 'smooth' }) }
}

async function bulkPay() {
  if (bf.busy) return
  const t = bulkTotals(), d = bulkDraft(), shown = Math.round((t.bulk + Math.round(t.bulk * BULK_DELIVERY_PCT / 100)) * 100)
  bf.key ||= MM.idem()['Idempotency-Key']
  bf.busy = true
  bf.error = ''
  bulkOrderDraw()
  const body = {
    name: String(d.name || '').trim(), business: String(d.business || '').trim() || null, phone: normPhone(d.phone), city: String(d.city || '').trim(),
    address: String(d.address || '').trim(), pincode: String(d.pincode || '').trim(), notes: String(d.notes || '').trim() || null,
    lines: bulkSummary().map(({ sku, stage, boxes, kg, packKg }) => ({ sku, stage, boxes, kg, ...(packKg ? { packKg } : {}) })),
  }
  let r
  try {
    r = await MM.placeBulkOrder(body, bf.key)
  } catch (e) {
    bf.busy = false
    if (e.status === 401) { bf.step = 'details'; bf.error = 'Please sign in again to pay.'; bulkOrderDraw(); return }
    bf.error = e.code === 'NETWORK' ? 'You seem to be offline. Nothing was paid. Try again when you’re back online.' : e.status === 404 ? 'Bulk orders are paused right now. Message us on WhatsApp instead.' : e.message
    bulkOrderDraw()
    return
  }
  // Placed: the list is done. The payment page next (the order page shows it again if anything goes wrong).
  save('mm-bulk', []); bulkList = null
  bulkFlowReset()
  const o = r.order || {}
  if (realUrl(o.paymentUrl) && o.amountPaise === shown) { location.href = o.paymentUrl; return }
  go(`/bulk/orders/${encodeURIComponent(r.id)}`)
}

document.addEventListener('submit', (e) => {
  if (e.target.id !== 'bulk-order-form') return
  e.preventDefault()
  bulkDetailsSubmit(e.target)
})
document.addEventListener('click', (e) => {
  const b = e.target instanceof Element ? e.target.closest('button') : null
  if (!b) return
  if (b.hasAttribute('data-bulk-pay')) bulkPay()
  else if (b.hasAttribute('data-bulk-details')) { bf.step = 'details'; bulkOrderDraw() }
  else if (b.dataset.bulkOrderPayTest) bulkTestPay(b.dataset.bulkOrderPayTest, b.dataset.outcome || 'captured')
  else if (b.dataset.bulkOrderPayAgain) bulkPayAgain(b.dataset.bulkOrderPayAgain)
  else if (b.dataset.bulkOrderCancel) bulkCancelAsk(b.dataset.bulkOrderCancel, true)
  else if (b.dataset.bulkOrderKeep) bulkCancelAsk(b.dataset.bulkOrderKeep, false)
  else if (b.dataset.bulkOrderCancelYes) bulkCancel(b.dataset.bulkOrderCancelYes, b)
})

// ---- The farm visit tab: a farm visit ENQUIRY (POST /v1/farm-visit-enquiries), always open, signed in or not. Our team
// calls to plan the visit. (The full Farm Experience booking stays in farm.js for later: a quiet link under the form
// only while FARM_EXPERIENCE is on and bookings are open.)

const FARM_VISIT_MIN_KG = 100
const FARM_VISIT_DRAFT = 'mm-farm-visit-draft'
// `captcha`, `captchaOn`, `widget`: the Turnstile check (AUTH-01, app.js formCaptcha), drawn afresh with the form.
const fv = { key: null, busy: false, sent: null, captcha: null, captchaOn: false, widget: null }
const fvToday = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10)

async function bulkFarmTab() {
  const el = $('#bulk-farm')
  if (!el) return
  await shelfReady()
  if (!$('#bulk-farm') || bulkTab !== 'farm-visit') return
  el.removeAttribute('aria-busy')
  bulkFarmDraw()
  // The quiet way into the full booking, for a date already agreed with us: only while it is switched on and open.
  if (await farmFeature()) {
    let f = null
    try { f = await MM.farmExperience() } catch { f = null }
    const spot = $('#bulk-farm-book')
    if (spot && f && f.bookingsOpen) spot.innerHTML = `<a class="text-button" href="/farm-experience/book" data-route>Already agreed a date with us? Book your visit ${icon('arrow')}</a>`
  }
}

function bulkFarmDraw(errors = {}, top = '') {
  const el = $('#bulk-farm')
  if (!el) return
  if (fv.sent) {
    const x = fv.sent
    el.innerHTML = `<section class="page-card bulk-farm-sent" tabindex="-1" role="status"><div class="success">${icon('check')}<h2>Farm visit enquiry <span class="no-wrap">${esc(orderNo(x.number))}</span> sent.</h2>
      <p>Our team will call you on WhatsApp on <strong>+91 ${esc(x.phone)}</strong> to plan your visit.</p>
      ${MM.profile() ? `<a class="button primary" href="/account?enquiry=${encodeURIComponent(x.id)}" data-route>See it in your account ${icon('arrow')}</a>` : ''}
      <button type="button" class="text-button" data-farm-visit-again style="margin:15px auto 0">Send another enquiry</button></div></section>`
    return
  }
  const d = read(FARM_VISIT_DRAFT, {}) || {}, me = MM.profile() || {}
  const v = (k, fallback = '') => esc(d[k] ?? fallback)
  const varieties = [...new Set((shelf || []).map((x) => x.name))]
  const err = (k) => errors[k] ? `<span class="field-error" id="fv-${k}-err">${icon('info')}${esc(errors[k])}</span>` : ''
  const inv = (k) => errors[k] ? ` aria-invalid="true" aria-describedby="fv-${k}-err"` : ''
  const flexible = d.flexible === true || d.flexible === 'on'
  el.innerHTML = `<form class="page-card bulk-farm-form" id="farm-visit-form" novalidate aria-labelledby="farm-visit-h">
      <h2 id="farm-visit-h" class="flow-head">Ask about a farm visit</h2>
      <p>Tell us who is coming and roughly what you want. Our team calls you on WhatsApp to plan the day. Nothing is booked or paid now, and you don’t need to sign in.</p>
      ${top ? `<p class="prototype-tag bulk-error" role="alert">${esc(top)}</p>` : ''}
      <div class="form-grid">
        <label class="field">Your name<input name="name" autocomplete="name" maxlength="100" required value="${v('name', me.name || '')}"${inv('name')}>${err('name')}</label>
        <label class="field">Mobile / WhatsApp number<input name="phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" required placeholder="10-digit mobile" value="${v('phone', String(me.phone || '').replace(/^\+91/, ''))}"${inv('phone')}>${err('phone')}</label>
        <label class="field">City<input name="city" autocomplete="address-level2" maxlength="100" required value="${v('city')}"${inv('city')}>${err('city')}</label>
        <label class="field">Which mango<span class="bulk-select"><select name="variety"${inv('variety')}><option value="">Not sure yet</option>${varieties.map((n) => `<option${d.variety === n ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>${icon('chevron')}</span>${err('variety')}</label>
        <label class="field">About how many kg <small>(${FARM_VISIT_MIN_KG} or more)</small><input name="kg" type="number" inputmode="numeric" min="${FARM_VISIT_MIN_KG}" step="1" required value="${v('kg', String(FARM_VISIT_MIN_KG))}"${inv('kg')}>${err('kg')}</label>
        <label class="field">How many people are coming<input name="people" type="number" inputmode="numeric" min="1" step="1" required value="${v('people', '2')}"${inv('people')}>${err('people')}</label>
        <label class="field">Preferred visit date <small>(optional)</small><input name="visitDate" type="date" min="${fvToday()}" value="${v('visitDate')}"${flexible ? ' disabled' : ''}${inv('visitDate')}>${err('visitDate')}</label>
        <label class="bulk-farm-flex"><input type="checkbox" name="flexible"${flexible ? ' checked' : ''}><span>I’m flexible about the date</span></label>
        <label class="field wide">Anything else? <small>(optional)</small><textarea name="notes" rows="3" maxlength="1000" placeholder="Who is coming, food needs, the week that suits you">${v('notes')}</textarea></label>
      </div>
      <div class="pn-captcha" hidden></div>
      <button class="button primary full" type="submit" ${fv.busy ? 'disabled aria-describedby="fv-busy"' : ''}>${fv.busy ? 'Sending…' : `Send farm visit enquiry ${icon('arrow')}`}</button>
      ${fv.busy ? `<p class="bulk-add-why" id="fv-busy">${icon('clock')}<span>Sending your enquiry. One moment.</span></p>` : ''}
      <p class="form-footer">We use your details only to plan this visit.</p>
      <p class="bulk-farm-book" id="bulk-farm-book"></p>
    </form>`
  // A token works once: while sending, the one taken is kept (fv.busy) and no new check is drawn.
  if (!fv.busy) formCaptcha($('#farm-visit-form .pn-captcha', el), 'farm-visit', fv)
}

function bulkFarmKeep(form) {
  const d = {}
  for (const k of ['name', 'phone', 'city', 'variety', 'kg', 'people', 'visitDate', 'notes']) { const el = form.elements.namedItem(k); if (el) d[k] = el.value }
  d.flexible = form.elements.namedItem('flexible').checked
  save(FARM_VISIT_DRAFT, d)
  return d
}

async function bulkFarmSend(form) {
  if (fv.busy) return
  const d = bulkFarmKeep(form), errors = {}
  if (!String(d.name).trim()) errors.name = 'Tell us your name.'
  if (!/^[6-9]\d{9}$/.test(normPhone(d.phone))) errors.phone = 'Enter a 10-digit mobile number.'
  if (!String(d.city).trim()) errors.city = 'Tell us your city.'
  if (!/^\d+$/.test(String(d.kg).trim()) || Number(d.kg) < FARM_VISIT_MIN_KG) errors.kg = `Farm visits are for ${FARM_VISIT_MIN_KG} kg and above, in whole kg.`
  if (!/^\d+$/.test(String(d.people).trim()) || Number(d.people) < 1) errors.people = 'At least one person is coming.'
  if (!d.flexible && d.visitDate && d.visitDate < fvToday()) errors.visitDate = 'That date has passed. Choose a later one, or tick “I’m flexible”.'
  if (Object.keys(errors).length) { bulkFarmDraw(errors); $(`#farm-visit-form [aria-invalid="true"]`)?.focus(); return }
  if (fv.captchaOn && !fv.captcha) return bulkFarmDraw({}, CAPTCHA_ASK)
  const captcha = fv.captcha
  fv.key ||= MM.idem()['Idempotency-Key']
  fv.busy = true
  bulkFarmDraw()
  const body = {
    name: String(d.name).trim(), phone: normPhone(d.phone), city: String(d.city).trim(), variety: d.variety || null, kg: Number(d.kg), people: Number(d.people),
    visitDate: d.flexible ? null : d.visitDate || null, flexible: Boolean(d.flexible) || !d.visitDate, notes: String(d.notes || '').trim() || null,
  }
  try {
    const r = await MM.farmVisitEnquiry(body, fv.key, captcha)
    fv.sent = { ...r, phone: body.phone }
    fv.key = null
    try { localStorage.removeItem(FARM_VISIT_DRAFT) } catch {}
  } catch (e) {
    fv.busy = false
    const field = e.extra && e.extra.field
    const msg = e.code === 'NETWORK' ? 'You seem to be offline. Your details are still here: send it again when you’re back online.' : e.status === 404 ? 'Farm visit enquiries are paused right now. Message us on WhatsApp instead.' : e.message
    return bulkFarmDraw(field ? { [field]: msg } : {}, field ? '' : msg)
  }
  fv.busy = false
  bulkFarmDraw()
  $('#bulk-farm .bulk-farm-sent')?.focus()
  bulkWatch()
}

document.addEventListener('submit', (e) => {
  if (e.target.id !== 'farm-visit-form') return
  e.preventDefault()
  bulkFarmSend(e.target)
})
document.addEventListener('change', (e) => {
  const f = e.target.form
  if (!f || f.id !== 'farm-visit-form') return
  if (e.target.name === 'flexible') { const dt = f.elements.namedItem('visitDate'); dt.disabled = e.target.checked; if (e.target.checked) dt.value = '' }
  bulkFarmKeep(f)
})
document.addEventListener('click', (e) => {
  const b = e.target instanceof Element ? e.target.closest('[data-farm-visit-again]') : null
  if (!b) return
  fv.sent = null
  bulkFarmDraw()
})

/** The shop's WhatsApp contact as a button (shop config supportWhatsapp), or the help link when none is set. */
function bulkWhatsApp(text) {
  const wa = String((window.MM_CONFIG || {}).supportWhatsapp || '').trim()
  return /^\d+$/.test(wa)
    ? `<a class="button primary" href="https://wa.me/${wa}?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">${icon('chat')}<span>Message us on WhatsApp</span></a>`
    : helpLink('Message us on WhatsApp', text)
}

// ---- The order page: /bulk/orders/:id

const BULK_STEPS = [['Paid', ['PAID']], ['Called', ['CONFIRMED']], ['Dispatched', ['DISPATCHED']], ['Delivered', ['DELIVERED']]]
let bulkCancelOpen = null

async function bulkOrderView(id, seq = ++sheetSeq, polls = 0) {
  document.title = 'Bulk order · VMR Mangoes'
  if (!polls) host().innerHTML = pageHead('Bulk order') + marker(seq) + '<p>Loading your bulk order…</p>'
  let x
  try {
    x = await MM.bulkOrder(id)
  } catch (e) {
    if (!alive(seq)) return
    host().innerHTML = pageHead('Bulk order') + marker(seq) + `<section class="page-card"><p class="prototype-tag" role="alert">${esc(e.status === 404 ? 'We couldn’t find this bulk order on your account.' : e.message)}</p><a class="button secondary" href="/account" data-route>Your account</a></section>`
    return
  }
  if (!alive(seq)) return
  const o = x.order
  if (x.kind !== 'ORDER' || !o) {
    host().innerHTML = pageHead('Bulk order') + marker(seq) + `<section class="page-card"><p>${esc(orderNo(x.number))} is ${x.kind === 'ORDER' ? 'a bulk order placed before online payment: our team arranges it with you' : 'an enquiry: its quote is on your account'}.</p><a class="button primary" href="/account?enquiry=${encodeURIComponent(x.id)}" data-route>Open it on your account ${icon('arrow')}</a></section>`
    return
  }
  const paid = o.paymentStatus === 'SUCCEEDED' || o.paymentStatus === 'REFUNDED'
  const back = /razorpay_payment_link_status=paid/.test(location.search)
  const pending = x.status === 'PAYMENT_PENDING'
  const when = (t) => esc(new Date(t).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }))
  const h = hoursWord(o.cancelHours || cancelHours())
  let top
  if (pending) {
    const pay = realUrl(o.paymentUrl)
      ? `<a class="button primary" href="${esc(o.paymentUrl)}">Pay ${bulkRs(o.amountPaise)} now ${icon('arrow')}</a>`
      : o.paymentUrl
        ? `<div class="prototype-tag">Test mode: no payment service is connected, so no money is taken.</div><div class="bulk-order-actions"><button class="button primary" data-bulk-order-pay-test="${esc(x.id)}">Pay ${bulkRs(o.amountPaise)} (test) ${icon('arrow')}</button><button class="button secondary" data-bulk-order-pay-test="${esc(x.id)}" data-outcome="failed">Fail payment (test)</button></div>`
        : `<button class="button primary" data-bulk-order-pay-again="${esc(x.id)}">Get the payment page ${icon('arrow')}</button>`
    top = `<div class="success is-waiting">${icon('clock')}<h2>Order <span class="no-wrap">${esc(orderNo(x.number))}</span> is waiting for payment.</h2>
      <p>Pay ${bulkRs(o.amountPaise)}${o.payBy ? ` by ${when(o.payBy)}` : ''}. Once it is paid, our team calls you on WhatsApp to arrange the delivery.</p>${back ? `<p role="status">${icon('clock')} Checking your payment…</p>` : ''}${pay}</div>`
  } else if (o.payAgain) {
    top = `<div class="success is-waiting">${icon('clock')}<h2>The time to pay for <span class="no-wrap">${esc(orderNo(x.number))}</span> ran out.</h2><p>Nothing was paid. Pay again at today’s bulk prices (the total may change).</p><button class="button primary" data-bulk-order-pay-again="${esc(x.id)}">Pay again ${icon('arrow')}</button></div>`
  } else if (x.status === 'CANCELLED') {
    const r = o.refund
    top = `<div class="success">${icon('close')}<h2>Order <span class="no-wrap">${esc(orderNo(x.number))}</span> is cancelled.</h2><p>${o.cancelledBy === 'shop' ? 'We cancelled it.' : 'You cancelled it.'} ${r ? (r.refundedAt ? `Your full refund of ${bulkRs(o.paidPaise || o.amountPaise)} is on its way to how you paid (usually 5–7 working days).` : r.gaveUp ? 'Your refund needs our team: we will contact you.' : `Your full refund of ${bulkRs(o.paidPaise || o.amountPaise)} is being sent.`) : 'Nothing was paid.'}</p></div>`
  } else {
    const at = Math.max(0, BULK_STEPS.findIndex(([, st]) => st.includes(x.status)))
    top = `<div class="success">${back || polls ? paidMark() : icon('check')}<h2>Order <span class="no-wrap">${esc(orderNo(x.number))}</span> ${x.status === 'DELIVERED' ? 'delivered' : 'is paid'}.</h2>
      <p>We have your payment of <strong>${bulkRs(o.paidPaise || o.amountPaise)}</strong>. ${x.status === 'PAID' ? `Our team will call you on WhatsApp to arrange the delivery, usually within ${BULK_DAYS}.` : x.status === 'CONFIRMED' ? 'Our team has called you and arranged the delivery.' : x.status === 'DISPATCHED' ? 'It is on its way.' : 'Thank you for buying from us.'}</p>
      <ol class="bulk-steps" aria-label="Where your order is">${BULK_STEPS.map(([label], i) => `<li class="${i < at ? 'is-done' : i === at ? 'is-now' : ''}"${i === at ? ' aria-current="step"' : ''}>${i <= at ? icon('check') : ''}<span>${label}</span></li>`).join('')}</ol></div>`
  }
  let cancel = ''
  if (o.canCancel && paid) {
    cancel = bulkCancelOpen === x.id
      ? `<div class="co-cancel cancel-note" role="group" aria-label="Cancel this order"><span class="co-cancel-icon" aria-hidden="true">${icon('clock')}</span><div><p class="co-cancel-lead">Cancel order ${esc(orderNo(x.number))} and get ${bulkRs(o.paidPaise || o.amountPaise)} back?</p><p class="co-cancel-more">The full amount goes back to how you paid.</p><div class="bulk-order-actions"><button class="button primary" data-bulk-order-cancel-yes="${esc(x.id)}">Yes, cancel and refund</button><button class="button secondary" data-bulk-order-keep="${esc(x.id)}">Keep my order</button></div></div></div>`
      : `<div class="co-cancel cancel-note" role="note"><span class="co-cancel-icon" aria-hidden="true">${icon('clock')}</span><div><p class="co-cancel-lead">You can cancel until ${when(o.cancelUntil)} for a full refund.</p><p class="co-cancel-more">That is ${h} after paying, and only until it is dispatched. <button class="text-button inline-link" data-bulk-order-cancel="${esc(x.id)}">Cancel this order</button></p></div></div>`
  } else if (paid && x.status !== 'CANCELLED' && o.cancelUntil) {
    cancel = `<div class="co-cancel cancel-note is-closed" role="note"><span class="co-cancel-icon" aria-hidden="true">${icon('clock')}</span><div><p class="co-cancel-lead">${['DISPATCHED', 'DELIVERED'].includes(x.status) ? 'It is dispatched, so it can no longer be cancelled here.' : `Cancelling closed at ${when(o.cancelUntil)}.`}</p><p class="co-cancel-more">A paid bulk order can be cancelled within ${h} of paying. Something wrong? ${helpLink('Message us', `Hi VMR Mangoes, about my bulk order ${orderNo(x.number)}`)}.</p></div></div>`
  } else if (pending) {
    cancel = `<p class="bulk-order-unpaid-cancel"><button class="text-button inline-link" data-bulk-order-cancel-yes="${esc(x.id)}">Cancel this order</button> <span>Nothing has been paid.</span></p>`
  }
  const rc = o.receipt
  const lines = (x.lines || []).map((l) => `<li><span>${esc(l.label)} <small>${l.boxes} × ${l.shopUnitPaise ? `<s>${bulkRs(l.shopUnitPaise)}</s> ` : ''}${bulkRs(l.unitPaise)}</small></span><strong>${bulkRs(l.linePaise)}</strong></li>`).join('')
  host().innerHTML = pageHead('Bulk order') + marker(seq) + `
    <section class="page-card bulk-order-top">${top}${cancel}</section>
    <section class="page-card bulk-receipt" aria-labelledby="bulk-receipt-h">
      <h3 id="bulk-receipt-h">${paid ? 'Payment receipt' : 'Your order'}</h3>
      <dl class="bulk-receipt-facts">
        <div><dt>Order</dt><dd>${esc(orderNo(x.number))}</dd></div>
        <div><dt>Placed</dt><dd>${when(x.createdAt)}</dd></div>
        ${rc ? `<div><dt>Paid</dt><dd>${when(rc.paidAt)}</dd></div><div><dt>Paid by</dt><dd>${esc([rc.method === 'dev' ? 'test payment' : rc.method, rc.card, rc.upiRef ? `UPI ref ${rc.upiRef}` : ''].filter(Boolean).join(' · ') || 'online')}</dd></div><div><dt>Payment ID</dt><dd class="no-wrap">${esc(rc.paymentId || '')}</dd></div>` : ''}
        <div><dt>Deliver to</dt><dd>${esc(o.address || '')}${o.pincode ? `, ${esc(o.pincode)}` : ''} · ${esc(x.city || '')}</dd></div>
      </dl>
      <ul class="bulk-review-lines">${lines}</ul>
      <dl class="bulk-money">
        <div><dt>Mangoes at bulk prices <small>${x.quantityKg} kg · ${x.boxes} ${x.boxes === 1 ? 'box' : 'boxes'}</small></dt><dd>${bulkRs(o.mangoesPaise)}</dd></div>
        ${o.savingPaise ? `<div class="is-save"><dt>You saved</dt><dd>${bulkRs(o.savingPaise)}</dd></div>` : ''}
        <div><dt>Delivery <small>${o.deliveryPct}% of the mangoes’ value</small></dt><dd>${bulkRs(o.deliveryPaise)}</dd></div>
        <div class="is-total"><dt>${paid ? 'Total paid' : 'Total to pay'}</dt><dd>${bulkRs(paid ? o.paidPaise || o.amountPaise : o.amountPaise)}</dd></div>
      </dl>
      ${paid ? '<p class="page-note">This page is your payment receipt for the bulk order. A bill is not issued for bulk orders yet: ask our team on WhatsApp if you need one.</p>' : ''}
    </section>
    <a class="text-button" href="/account?enquiry=${encodeURIComponent(x.id)}" data-route style="margin:15px auto 0">All your bulk orders ${icon('arrow')}</a>`
  // Back from the payment page, or just test-paid: the webhook may take a moment.
  if (pending && (back || polls) && polls < 10) setTimeout(() => { if (alive(seq)) bulkOrderView(id, seq, polls + 1) }, 2000)
}

async function bulkTestPay(id, outcome) {
  $$('[data-bulk-order-pay-test]').forEach((b) => { b.disabled = true })
  try {
    const r = await MM.api('/' + ['dev', 'pay-bulk'].join('/'), { method: 'POST', body: { bulkOrderId: id, outcome } })
    if (outcome === 'failed' || (r && r.result === 'ignored')) toast('Payment didn’t go through. Please try again.')
  } catch (e) { toast(e.message) }
  bulkOrderView(id, sheetSeq, 1)
}

async function bulkPayAgain(id) {
  $$('[data-bulk-order-pay-again]').forEach((b) => { b.disabled = true })
  try {
    const x = await MM.payBulkOrder(id)
    if (x.order && realUrl(x.order.paymentUrl)) { location.href = x.order.paymentUrl; return }
  } catch (e) { toast(e.message) }
  bulkOrderView(id)
}

function bulkCancelAsk(id, open) {
  bulkCancelOpen = open ? id : null
  bulkOrderView(id).then(() => $(open ? '[data-bulk-order-cancel-yes]' : '[data-bulk-order-cancel]')?.focus())
}

async function bulkCancel(id, b) {
  if (b) b.disabled = true
  try {
    const x = await MM.cancelBulkOrder(id)
    toast(x.order && x.order.refund ? 'Order cancelled. Your full refund is on its way.' : 'Order cancelled.')
  } catch (e) { toast(e.message) }
  bulkCancelOpen = null
  bulkOrderView(id)
}
