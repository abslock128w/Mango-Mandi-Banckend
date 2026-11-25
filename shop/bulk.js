/* The bulk page's three tabs and the bulk order paid at once (mango-api README, Bulk orders).
   /bulk (Bulk order: 100 kg and above, ordered and paid now), /bulk/enquiry (Send enquiry: 250 kg+ mangoes, a quote)
   and /bulk/farm-visit (Farm visit: 250 kg+ mangoes, pick your own, the stay is free: a farm visit enquiry, below). Each tab is
   its own address, so it can be linked and the back button works. The tab row is a real tablist (arrow keys, Home,
   End) whose bead slides from the old tab to the new one.
   The list builder is pages.js's; this file adds the bulk prices (GET /v1/bulk/prices: the shop price less the
   default discount, or a manager's own price; the 10 kg box is twice the 5 kg), the order flow (details, the
   checkout's own sign-in steps, review, pay by Razorpay payment link, or the test payment locally) and the order
   page /bulk/orders/:id (payment, receipt, cancel within 4 hours of paying for a full refund, refund).
   Money from these routes stays in paise (api.js `bulk…` calls) and is shown with bulkRs.
   It also draws each tab's "How it works" cards (bulkKeyHTML: a hover panel with a mouse, tap-to-open on touch), puts
   Mixed Variety Mangoes first in the variety lists and chooses it when the adder first shows (bulkVarietyOptions).
   Loaded after pages.js and farm.js (it adds to PAGES; it sets the adder's first pick) and before app.js: other
   top-level code only declares and listens. Styles: style.css (.bulk-key, .bulk-pick, List B; .fv-* for the farm visit
   page and the numbered sections, .bq-* for the Send enquiry steps and meter, change request 02). */

PAGES.push([/^\/bulk\/orders\/([^/]+)\/?$/, (m) => signedInThen('Bulk order', () => bulkOrderView(decodeURIComponent(m[1])))])

const BULK_TABS = [
  { id: 'order', href: '/bulk', name: 'Bulk order', promise: ['100 kg and above', 'order and pay now'] },
  { id: 'enquiry', href: '/bulk/enquiry', name: 'Send enquiry', promise: ['250 kg+ mangoes', 'get a quote'] },
  { id: 'farm-visit', href: '/bulk/farm-visit', name: 'Farm visit', promise: ['250 kg+ mangoes', 'pick your own, stay free'] },
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

/** "How it works" for the tab, five cards with a title each. With a mouse (a screen that can hover: BULK_KEY_HOVER) a card
    shows its detail line in a small panel floating over the section while the pointer is on it or it has the keyboard's
    focus (Tab), so the row never changes height; Escape hides it. The line is part of the card, so a screen reader reads
    it with the title. On phones and tablets each card is a tap-to-open <details> with a chevron, all closed at first. */
const BULK_KEY_HOVER = matchMedia('(hover: hover) and (pointer: fine)')
function bulkKeyHTML(tab) {
  const li = (ic, title, text) => BULK_KEY_HOVER.matches
    ? `<li class="bulk-key-card" tabindex="0"><span class="bulk-key-head">${icon(ic)}<strong>${title}</strong></span><span class="bulk-key-tip"><span>${text}</span></span></li>`
    : `<li><details><summary>${icon(ic)}<strong>${title}</strong>${icon('chevron')}</summary><span>${text}</span></details></li>`
  const items = tab === 'enquiry' ? [
    li('scale', `${BULK_ENQUIRY_MIN_KG} kg+ mangoes`, `Enquiries are for ${BULK_ENQUIRY_MIN_KG} kg of mangoes and more. From ${BULK_MIN_KG} kg you can also order and pay at the bulk price straight away.`),
    li('tag', 'A price for you', 'We start from the bulk price and quote you on WhatsApp. Your quote can be lower.'),
    li('check', 'Nothing paid now', 'Accept or decline the quote on your account. We call you to arrange delivery and payment.'),
    li('truck', `Delivery: ${BULK_DELIVERY_PCT}% of the mangoes’ value`, 'Shown on the quote, with any extra costs such as special packaging.'),
  ] : tab === 'farm-visit' ? [
    li('scale', `${FARM_VISIT_MIN_KG} kg+ mangoes`, `Book ${FARM_VISIT_MIN_KG} kg or more of one variety for your visit.`),
    li('tree', 'Your stay is free', 'Stay at the farmhouse free for the night of your visit.'),
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
  return `<section class="bulk-key" aria-labelledby="bulk-key-h"><h2 id="bulk-key-h">${title}</h2><ul class="bulk-key-list${BULK_KEY_HOVER.matches ? ' is-hover' : ''}">${items.join('')}</ul></section>`
}
// A mouse plugged in or taken away: the cards are drawn again the other way.
BULK_KEY_HOVER.addEventListener('change', () => {
  const key = $('.bulk-key')
  if (key) key.outerHTML = bulkKeyHTML(bulkTab)
})
// Escape hides the open panel until the pointer leaves the card or the focus moves on.
document.addEventListener('keydown', (e) => {
  const card = e.key === 'Escape' && e.target instanceof Element && e.target.closest('.bulk-key-card')
  if (card) card.classList.add('is-quiet')
})
for (const type of ['mouseleave', 'focusout']) document.addEventListener(type, (e) => { if (e.target instanceof Element && e.target.matches('.bulk-key-card')) e.target.classList.remove('is-quiet') }, true)

// ---- The variety list (the owner, change request 01: "mixed mangoes pre-selected", "on top of the list")

/** The mixed box comes first in the bulk lists and is the adder's pick when /bulk or /bulk/enquiry opens. */
const BULK_FIRST = 'Mixed Variety Mangoes'
// pages.js adderHTML shows the variety in adder.variety; nothing chosen yet means the mixed box (when it is on sale).
if (!adder.variety) adder.variety = BULK_FIRST
/** Varieties in the bulk lists' order: the mixed box, then the single varieties A to Z. */
const bulkVarietyOrder = (list) => [...list.filter((v) => v.name === BULK_FIRST), ...list.filter((v) => v.name !== BULK_FIRST).sort((a, b) => a.name.localeCompare(b.name))]
/** The adder's <select id="bulk-variety"> options: the mixed box, then "Single varieties" A to Z, each with its bulk price
    for a 5 kg box. "Choose a variety…" is there only while nothing is chosen, as a hint that can't be picked. */
function bulkVarietyOptions(list, v) {
  const row = (x) => { const five = bulkBoxes(x)[0], bp = bulkPriceFor(five.sku); return `<option value="${esc(x.name)}"${v && x.name === v.name ? ' selected' : ''}>${esc(x.name)} · ${currency(bp ? bp.bulk : five.price)} / 5 kg box</option>` }
  const all = bulkVarietyOrder(list), first = all.filter((x) => x.name === BULK_FIRST), rest = all.filter((x) => x.name !== BULK_FIRST)
  return (v ? '' : '<option value="" disabled selected>Choose a variety…</option>') + first.map(row).join('') + (rest.length ? (first.length ? `<optgroup label="Single varieties">${rest.map(row).join('')}</optgroup>` : rest.map(row).join('')) : '')
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
// Change request 02 (CR2-01, CR2-02, CR2-04): a hero band (bulkFarmHeroHTML), then the form in three numbered sections
// (About you · Your visit · Your mangoes) beside a live "Your visit" card (on PC) or over a sticky bottom bar (phones,
// bulkFarmBar). The visit is two dates, Day 1 (arrive) and Day 2 (leave), 2 days at most: Day 2 is Day 1 or the next
// day (a 1-day visit is fine). They are picked on one range calendar (a month grid under the two Day boxes, built here with
// no library: fvCalHTML, its rules in fvRangePick / fvDayState / fvCalMove, tests/unit/farm-visit-range.unit.ts): the first
// tap is Day 1 and fills Day 2 with the next day; a tap on Day 1 again (or on Day 2 itself) makes it a 1-day visit; no day
// after Day 1 + 1 can be picked as Day 2 (the Day 1 box picks a new Day 1). The boxes are read-only; the dates go in the
// hidden visitFrom / visitTo fields the draft, the checks and the payload read. "I'm flexible" makes the dates optional.
// The kg field is a stepper from 250 with quick picks. The hero and form draw at once; the mangoes and the season's
// first day (GET /farm-experience, only while it is on) fill in when they arrive. Styles: style.css (.fv-*).

/** The API's FARM_VISIT_MIN_KG (bulk-enquiries.js) and the booking's MIN_KG (farm/settings.js): farm visits are for this much and more. */
const FARM_VISIT_MIN_KG = 250
const FARM_VISIT_DRAFT = 'mm-farm-visit-draft'
const FV_KG_STEP = 10
const FV_KG_PICKS = [250, 500, 1000]
// `captcha`, `captchaOn`, `widget`: the Turnstile check (AUTH-01, app.js formCaptcha), drawn afresh with the form.
// `season`: the farm's first and last visit days, when the farm sets them (GET /farm-experience settings).
// `cal`: the calendar's month on show ('2026-11'), the day keyboard focus is on, and what a tap picks ('from': Day 1, 'to').
const fv = { key: null, busy: false, sent: null, captcha: null, captchaOn: false, widget: null, season: { start: '', end: '' }, cal: { month: '', focus: '', pick: 'from' } }
const fvToday = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10)
/** Phones and narrow screens: the bottom bar instead of the card beside the form. */
const FV_WIDE = matchMedia('(min-width: 1000px)')

// Dates as YYYY-MM-DD, worked out in UTC so no time zone moves a day.
const fvAdd = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const fvDays = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1
const FV_WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], FV_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fvPart = (d) => { const t = new Date(`${d}T00:00:00Z`); return { wd: FV_WD[t.getUTCDay()], n: t.getUTCDate(), mon: FV_MON[t.getUTCMonth()] } }
const fvIsDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`))
/** "Thu 26 – Fri 27 Nov" (long) or "26–27 Nov" (short); one day: "Thu 26 Nov" / "26 Nov". */
function fvRange(from, to, short = false) {
  const a = fvPart(from), b = to && to !== from ? fvPart(to) : null
  if (short) return b ? (a.mon === b.mon ? `${a.n}–${b.n} ${b.mon}` : `${a.n} ${a.mon} – ${b.n} ${b.mon}`) : `${a.n} ${a.mon}`
  return b ? `${a.wd} ${a.n}${a.mon === b.mon ? '' : ` ${a.mon}`} – ${b.wd} ${b.n} ${b.mon}` : `${a.wd} ${a.n} ${a.mon}`
}
/** The first day Day 1 may be: today, or the season's first day if the farm sets a later one. */
const fvEarliest = () => (fv.season.start && fv.season.start > fvToday() ? fv.season.start : fvToday())

// ---- The range calendar's rules (pure: dates are 'YYYY-MM-DD' strings; `lim` is { earliest, last }, last '' for none).

/** '2026-11' moved by n months. */
const fvMonthAdd = (month, n) => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7) }
/** A month's days as weeks from Monday to Sunday: each day 'YYYY-MM-DD', or null before the 1st and after the last. */
function fvMonthWeeks(month) {
  const [y, m] = month.split('-').map(Number), first = `${month}-01`
  const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7, count = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const cells = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => fvAdd(first, i))]
  while (cells.length % 7) cells.push(null)
  const weeks = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}
/** A day on the calendar for the visit `v` { from, to, pick }: `off` when it can't be picked (before the earliest day,
 *  after the season's last, or, while Day 2 is being picked, later than Day 1 + 1), and whether it is Day 1 or Day 2. */
function fvDayState(day, v, lim) {
  const off = day < lim.earliest || (!!lim.last && day > lim.last) || (v.pick === 'to' && !!v.from && day > fvAdd(v.from, 1))
  return { off, from: !!v.from && day === v.from, to: !!v.to && day === v.to && v.to !== v.from }
}
/** The visit after a tap on `day`. Picking Day 1 (or nothing picked yet), or a day before Day 1: that day is Day 1 and
 *  Day 2 the next day (Day 1 again when the season ends that day), and Day 2 is picked next. Picking Day 2: Day 1 again,
 *  or Day 2's own day, makes a 1-day visit; the day after Day 1 makes it 2 days. A day that is off changes nothing. */
function fvRangePick(v, day, lim) {
  if (fvDayState(day, v, lim).off) return v
  const next = fvAdd(day, 1)
  if (v.pick !== 'to' || !v.from || day < v.from) return { from: day, to: lim.last && next > lim.last ? day : next, pick: 'to' }
  if (day === v.from || day === v.to) return { from: v.from, to: v.from, pick: 'to' }
  return { from: v.from, to: day, pick: 'to' }
}
/** The day the keyboard moves to: arrows a day or a week, Home / End the week's Monday / Sunday, Page Up / Down a month
 *  (the same date, or the month's last day). null for any other key. */
function fvCalMove(day, key) {
  const wd = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7
  const month = (n) => { const m = fvMonthAdd(day.slice(0, 7), n), last = fvMonthWeeks(m).flat().filter(Boolean).pop(); return `${m}-${day.slice(8)}` > last ? last : `${m}-${day.slice(8)}` }
  const to = { ArrowLeft: () => fvAdd(day, -1), ArrowRight: () => fvAdd(day, 1), ArrowUp: () => fvAdd(day, -7), ArrowDown: () => fvAdd(day, 7), Home: () => fvAdd(day, -wd), End: () => fvAdd(day, 6 - wd), PageUp: () => month(-1), PageDown: () => month(1) }[key]
  return to ? to() : null
}

/** The page's top: the farm photo with where it is, the kicker, the headline and three facts. */
function bulkFarmHeroHTML() {
  const where = (window.MM_CATALOG && MM_CATALOG.origin) || 'Yellamanda Village, Piler, Andhra Pradesh'
  return `<section class="fv-hero" aria-labelledby="fv-hero-h">
    <div class="fv-hero-photo"><img src="/assets/hero-orchard-960.webp" srcset="/assets/hero-orchard-960.webp 960w, /assets/hero-orchard.webp 1672w" sizes="(max-width: 700px) calc(100vw - 32px), 560px" alt="Ripe mangoes on a wooden tray under the mango trees of our orchard" width="960" height="541" decoding="async" fetchpriority="high"><span class="fv-pin">${icon('pin')}<span>${esc(where)}</span></span></div>
    <div class="fv-hero-copy"><p class="fv-kicker">Farm visit</p><h2 id="fv-hero-h">Pick your own mangoes at our farm</h2>
      <ul class="fv-facts" aria-label="The visit at a glance"><li>2-day visit</li><li>Free farm stay</li><li>${FARM_VISIT_MIN_KG} kg+ mangoes</li></ul></div>
  </section>`
}

function bulkFarmTab() {
  if (!$('#bulk-farm')) return
  bulkFarmDraw()
  // The mangoes to choose from arrive with the catalogue; only the list is filled in, so nothing typed is lost.
  shelfReady().then(() => { if ($('#bulk-farm') && bulkTab === 'farm-visit') fvVarietiesFill() })
  // While the Farm Experience is on: the season's first and last days, and the quiet way into the full booking.
  farmFeature().then(async (on) => {
    if (!on) return
    let f = null
    try { f = await MM.farmExperience() } catch { f = null }
    if (!f || !$('#bulk-farm') || bulkTab !== 'farm-visit') return
    const s = f.settings || {}
    fv.season = { start: fvIsDay(s.seasonStart) ? s.seasonStart : '', end: fvIsDay(s.seasonEnd) ? s.seasonEnd : '' }
    const form = $('#farm-visit-form')
    if (form) fvDatesFix(form)
    const spot = $('#bulk-farm-book')
    if (spot && f.bookingsOpen) spot.innerHTML = `<a class="text-button" href="/farm-experience/book" data-route>Already agreed a date with us? Book your visit ${icon('arrow')}</a>`
  })
}

/** The saved draft (mm-farm-visit-draft), with a draft from before CR2-01 (one visitDate) read as Day 1 and the next day. */
function fvDraft() {
  const d = read(FARM_VISIT_DRAFT, {}) || {}
  if (d.visitDate && !d.visitFrom && fvIsDay(d.visitDate)) { d.visitFrom = d.visitDate; d.visitTo = fvAdd(d.visitDate, 1) }
  delete d.visitDate
  return d
}

/** The mango choices: "Not sure yet", the mixed box, then A to Z (the value is the API's name, catalog.js keyOf). */
function fvVarietyOptions(chosen) {
  const keyOf = (n) => (window.MM_CATALOG && MM_CATALOG.keyOf ? MM_CATALOG.keyOf(n) : n)
  const names = bulkVarietyOrder([...new Map((shelf || []).map((x) => [x.name, x])).values()]).map((x) => x.name)
  const known = names.some((n) => keyOf(n) === chosen || n === chosen)
  return `<option value="">Not sure yet</option>${names.map((n) => `<option value="${esc(keyOf(n))}"${chosen && (chosen === keyOf(n) || chosen === n) ? ' selected' : ''}>${esc(n)}</option>`).join('')}${chosen && !known ? `<option value="${esc(chosen)}" selected>${esc(chosen)}</option>` : ''}`
}
function fvVarietiesFill() {
  const sel = $('#farm-visit-form select[name="variety"]')
  if (!sel) return
  sel.innerHTML = fvVarietyOptions(sel.value || fvDraft().variety || '')
  fvUpdate(sel.form)
}

function bulkFarmDraw(errors = {}, top = '') {
  const el = $('#bulk-farm')
  if (!el) return
  if (fv.sent) {
    const x = fv.sent
    el.innerHTML = `<section class="page-card bulk-farm-sent" tabindex="-1" role="status"><div class="success">${icon('check')}<h2>Farm visit enquiry <span class="no-wrap">${esc(orderNo(x.number))}</span> sent.</h2>
      <p>Our team will call you on WhatsApp on <strong>+91 ${esc(x.phone)}</strong> to plan your 2-day visit.</p>
      ${MM.profile() ? `<a class="button primary" href="/account?enquiry=${encodeURIComponent(x.id)}" data-route>See it in your account ${icon('arrow')}</a>` : ''}
      <button type="button" class="text-button" data-farm-visit-again style="margin:15px auto 0">Send another enquiry</button></div></section>`
    bulkBar()
    return
  }
  const d = fvDraft(), me = MM.profile() || {}
  const v = (k, fallback = '') => esc(d[k] ?? fallback)
  const err = (k) => errors[k] ? `<span class="field-error" id="fv-${k}-err">${icon('info')}${esc(errors[k])}</span>` : ''
  const inv = (k, also = k) => errors[k] ? ` aria-invalid="true" aria-describedby="fv-${also}-err"` : ''
  const flexible = d.flexible === true || d.flexible === 'on'
  const from = fvIsDay(d.visitFrom) ? d.visitFrom : '', to = fvIsDay(d.visitTo) ? d.visitTo : ''
  const kg = /^\d+$/.test(String(d.kg ?? '')) ? String(d.kg) : String(FARM_VISIT_MIN_KG)
  const head = (n, id, title) => `<h3 class="fv-sec-h" id="${id}"><span class="fv-num" aria-hidden="true">${n}</span>${title}</h3>`
  el.innerHTML = `<div class="fv-layout">
    <form class="page-card bulk-farm-form fv-form" id="farm-visit-form" novalidate aria-labelledby="farm-visit-h">
      <div class="fv-form-top">
        <h2 id="farm-visit-h" class="flow-head">Ask about a farm visit</h2>
        <p>Tell us who is coming and what you want. Our team calls you on WhatsApp to plan your 2-day visit. Nothing is booked or paid now, and you don’t need to sign in.</p>
        <p class="fv-min"><span class="fv-min-tag" aria-hidden="true">kg</span><span><strong>Minimum ${FARM_VISIT_MIN_KG} kg of mangoes.</strong> You buy at least ${FARM_VISIT_MIN_KG} kg on your visit.</span></p>
        ${top ? `<p class="prototype-tag bulk-error" role="alert">${esc(top)}</p>` : ''}
      </div>
      <fieldset class="fv-sec" aria-labelledby="fv-s1">${head(1, 'fv-s1', 'About you')}
        <div class="form-grid">
          <label class="field">Your name<input name="name" autocomplete="name" maxlength="100" required value="${v('name', me.name || '')}"${inv('name')}>${err('name')}</label>
          <label class="field">Mobile / WhatsApp number<input name="phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" required placeholder="10-digit mobile" value="${v('phone', String(me.phone || '').replace(/^\+91/, ''))}"${inv('phone')}>${err('phone')}</label>
          <label class="field">Another number we can reach <small>(optional)</small><input name="altPhone" type="tel" inputmode="tel" autocomplete="off" maxlength="20" placeholder="10-digit mobile" value="${v('altPhone')}"${inv('altPhone')}>${err('altPhone')}</label>
          <label class="field">Language you prefer we speak <small>(optional)</small><span class="bulk-select"><select name="preferredLanguage"${inv('preferredLanguage')}><option value="">No preference</option>${FARM_LANGUAGES.map((n) => `<option${d.preferredLanguage === n ? ' selected' : ''}>${n}</option>`).join('')}</select>${icon('chevron')}</span>${err('preferredLanguage')}</label>
        </div>
      </fieldset>
      <fieldset class="fv-sec" aria-labelledby="fv-s2">${head(2, 'fv-s2', 'Your visit')}
        <div class="fv-visit">
          <div class="fv-dates${flexible ? ' is-flexible' : ''}" role="group" aria-labelledby="fv-dates-label"${errors.dates ? ' aria-describedby="fv-dates-err"' : ''}>
            <p class="fv-dates-label" id="fv-dates-label">Visit dates · 2 days at most <small class="fv-opt"${flexible ? '' : ' hidden'}>(optional)</small></p>
            <div class="fv-range">
              <label class="field">Day 1 <small>(arrive)</small><input class="fv-day-box" id="fv-day1" data-fv-box="from" type="text" readonly placeholder="Pick a day" aria-controls="fv-cal" aria-describedby="fv-cal-help fv-range-says${errors.dates ? ' fv-dates-err' : ''}" value="${from ? fvRange(from) : ''}"${errors.dates ? ' aria-invalid="true"' : ''}></label>
              <span class="fv-range-arrow" aria-hidden="true">${icon('arrow')}</span>
              <label class="field">Day 2 <small>(leave)</small><input class="fv-day-box" id="fv-day2" data-fv-box="to" type="text" readonly placeholder="Pick a day" aria-controls="fv-cal" aria-describedby="fv-cal-help fv-range-says${errors.dates ? ' fv-dates-err' : ''}" value="${to ? fvRange(to) : ''}"${errors.dates ? ' aria-invalid="true"' : ''}></label>
              <input type="hidden" name="visitFrom" value="${from}"><input type="hidden" name="visitTo" value="${to}">
            </div>
            ${err('dates')}
            <div class="fv-cal-wrap">
              <div class="fv-cal" id="fv-cal"></div>
              <div class="fv-cal-side">
                <p class="fv-cal-help" id="fv-cal-help"></p>
                <p class="fv-range-says" id="fv-range-says" aria-live="polite"></p>
                <button type="button" class="text-button fv-cal-clear" data-fv-cal-clear hidden>Clear the dates</button>
              </div>
            </div>
          </div>
          <label class="bulk-farm-flex fv-flex"><input type="checkbox" name="flexible"${flexible ? ' checked' : ''}><span>I’m flexible about the dates</span></label>
        </div>
        <div class="form-grid">
          <label class="field">How many people are coming<input name="people" type="number" inputmode="numeric" min="1" step="1" required value="${v('people', '2')}"${inv('people')}>${err('people')}</label>
          <label class="field">City you come from<input name="city" autocomplete="address-level2" maxlength="100" required value="${v('city')}"${inv('city')}>${err('city')}</label>
        </div>
      </fieldset>
      <fieldset class="fv-sec" aria-labelledby="fv-s3">${head(3, 'fv-s3', 'Your mangoes')}
        <div class="form-grid">
          <label class="field wide">Which mango<span class="bulk-select"><select name="variety"${inv('variety')}>${fvVarietyOptions(d.variety || '')}</select>${icon('chevron')}</span>${err('variety')}</label>
          <div class="field wide fv-kg-field">
            <label for="fv-kg">How many kg of mangoes will you buy?</label>
            <div class="fv-kg-row">
              <div class="card-stepper fv-kg" role="group" aria-label="Kilograms of mangoes">
                <button type="button" data-fv-kg-step="-${FV_KG_STEP}" aria-label="${FV_KG_STEP} kg fewer">−</button>
                <span class="fv-kg-box"><input id="fv-kg" name="kg" type="number" inputmode="numeric" min="${FARM_VISIT_MIN_KG}" step="1" required value="${esc(kg)}"${inv('kg')}${errors.kg ? '' : ' aria-describedby="fv-kg-hint"'}><span aria-hidden="true">kg</span></span>
                <button type="button" data-fv-kg-step="${FV_KG_STEP}" aria-label="${FV_KG_STEP} kg more">+</button>
              </div>
              <div class="fv-kg-picks" role="group" aria-label="Quick picks">${FV_KG_PICKS.map((n) => `<button type="button" class="fv-chip" data-fv-kg="${n}" aria-pressed="false">${n.toLocaleString('en-IN')} kg</button>`).join('')}</div>
            </div>
            ${errors.kg ? err('kg') : `<small class="fv-kg-hint" id="fv-kg-hint">${FARM_VISIT_MIN_KG} kg or more, in whole kg.</small>`}
          </div>
          <label class="field wide">Anything else? <small>(optional)</small><textarea name="notes" rows="3" maxlength="1000" placeholder="Who is coming, food needs, anything we should know">${v('notes')}</textarea></label>
        </div>
      </fieldset>
      <div class="pn-captcha" hidden></div>
      <button class="button primary full fv-send-inline" type="submit" ${fv.busy ? 'disabled' : ''}>${fv.busy ? 'Sending…' : `Send farm visit enquiry ${icon('arrow')}`}</button>
      ${fv.busy ? `<p class="bulk-add-why" id="fv-busy">${icon('clock')}<span>Sending your enquiry. One moment.</span></p>` : ''}
      <p class="form-footer fv-foot">We use your details only to plan this visit.</p>
      <p class="bulk-farm-book" id="bulk-farm-book"></p>
    </form>
    <aside class="fv-sum" aria-labelledby="fv-sum-h">
      <p class="fv-sum-kicker" id="fv-sum-h">Your visit</p>
      <dl class="fv-sum-list">
        <div><dt>Dates</dt><dd data-fv-sum="dates"></dd></div>
        <div><dt>People</dt><dd data-fv-sum="people"></dd></div>
        <div><dt>Mangoes</dt><dd data-fv-sum="mangoes"></dd></div>
        <div><dt>Stay</dt><dd>Free, at the farm</dd></div>
      </dl>
      <button class="button fv-sum-go" type="submit" form="farm-visit-form" ${fv.busy ? 'disabled' : ''}>${fv.busy ? 'Sending…' : `Send enquiry ${icon('arrow')}`}</button>
      <p class="fv-sum-note">We use your details only to plan this visit. Nothing is booked or paid now.</p>
    </aside>
  </div>`
  // A token works once: while sending, the one taken is kept (fv.busy) and no new check is drawn.
  if (!fv.busy) formCaptcha($('#farm-visit-form .pn-captcha', el), 'farm-visit', fv)
  const form = $('#farm-visit-form')
  // Dates already there (a draft): a tap next changes Day 2 (Day 1 again: a 1-day visit); none: a tap picks Day 1.
  fv.cal.pick = from ? 'to' : 'from'
  fv.cal.month = ''
  fvDatesFix(form)
  fvUpdate(form)
}

/** The calendar opens on Day 1's month (or the earliest day's), never before the earliest day's month; with no Day 1 it
 *  picks Day 1. Run when the form is drawn and when the season's days arrive. */
function fvDatesFix(form) {
  const v = fvVisit(form), first = fvEarliest().slice(0, 7)
  if (!v.from) fv.cal.pick = 'from'
  const want = v.from && v.from.slice(0, 7) >= first ? v.from.slice(0, 7) : first
  if (!fv.cal.month || fv.cal.month < first || !form.contains(document.activeElement)) fv.cal.month = want
  fv.cal.focus = ''
  fvCalPaint(form)
}

const fvLim = () => ({ earliest: fvEarliest(), last: fv.season.end || '' })
/** The visit as the form holds it now: { from, to, pick }. */
function fvVisit(form) {
  const a = form.elements.namedItem('visitFrom'), b = form.elements.namedItem('visitTo')
  const from = a && fvIsDay(a.value) ? a.value : '', to = b && fvIsDay(b.value) ? b.value : ''
  return { from, to, pick: from ? fv.cal.pick : 'from' }
}
const FV_WD_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const FV_MON_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** The month grid (a real grid: arrow keys move, Enter or Space picks, the picked days are aria-selected) with the month's
 *  name and the previous / next month buttons. */
function fvCalHTML(v, lim, month, focus) {
  const [y, m] = month.split('-').map(Number)
  const prev = fvMonthAdd(month, -1) >= lim.earliest.slice(0, 7), next = (!lim.last || fvMonthAdd(month, 1) <= lim.last.slice(0, 7)) && fvMonthAdd(month, 1) <= fvMonthAdd(lim.earliest.slice(0, 7), 18)
  const head = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d) => `<th scope="col" abbr="${d}"><span aria-hidden="true">${d[0]}</span></th>`).join('')
  // Day 1 and Day 2 on the same row read as one band (not when Day 1 is a Sunday: Day 2 starts the next row).
  const joined = !!v.from && !!v.to && v.to !== v.from && new Date(`${v.from}T00:00:00Z`).getUTCDay() !== 0
  const rows = fvMonthWeeks(month).map((w) => `<tr>${w.map((day) => {
    if (!day) return '<td class="is-blank"></td>'
    const st = fvDayState(day, v, lim), t = new Date(`${day}T00:00:00Z`)
    const name = `${FV_WD_LONG[t.getUTCDay()]} ${t.getUTCDate()} ${FV_MON_LONG[t.getUTCMonth()]}${st.from ? `, Day 1${v.to === v.from ? ', a 1-day visit' : ''}` : st.to ? ', Day 2' : ''}`
    return `<td data-fv-day="${day}" tabindex="${day === focus ? 0 : -1}" aria-label="${name}" aria-selected="${st.from || st.to}"${st.off ? ' aria-disabled="true"' : ''} class="${[st.from ? 'is-from' : '', st.to ? 'is-to' : '', joined && (st.from || st.to) ? 'is-joined' : '', day === fvToday() ? 'is-today' : ''].filter(Boolean).join(' ')}">${t.getUTCDate()}</td>`
  }).join('')}</tr>`).join('')
  return `<div class="fv-cal-head"><p class="fv-cal-month" id="fv-cal-month" aria-live="polite">${FV_MON_LONG[m - 1]} ${y}</p>
      <button type="button" class="fv-cal-nav" data-fv-cal-month="-1" aria-label="Previous month"${prev ? '' : ' disabled'}>${icon('chevron')}</button><button type="button" class="fv-cal-nav is-next" data-fv-cal-month="1" aria-label="Next month"${next ? '' : ' disabled'}>${icon('chevron')}</button></div>
    <table class="fv-cal-grid" role="grid" aria-labelledby="fv-dates-label fv-cal-month" aria-describedby="fv-cal-help"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`
}

/** Draws the calendar, the two Day boxes and the help for the visit as it is, keeping the keyboard on the day it was on. */
function fvCalPaint(form) {
  const cal = $('#fv-cal', form)
  if (!cal) return
  const v = fvVisit(form), lim = fvLim(), month = fv.cal.month || (v.from || lim.earliest).slice(0, 7)
  const inMonth = (d) => d && d.slice(0, 7) === month
  // The day Tab lands on: the one the keyboard was on, else Day 2, Day 1, the first day that can be picked, the 1st.
  const days = fvMonthWeeks(month).flat().filter(Boolean)
  const focus = [fv.cal.focus, v.pick === 'to' ? v.to : v.from, v.from].find(inMonth) || days.find((d) => !fvDayState(d, v, lim).off) || days[0]
  const had = cal.contains(document.activeElement) ? document.activeElement : null
  cal.innerHTML = fvCalHTML(v, lim, month, focus)
  if (had && had.dataset.fvDay) $(`[data-fv-day="${focus}"]`, cal)?.focus()
  else if (had && had.dataset.fvCalMonth) { const b = $(`[data-fv-cal-month="${had.dataset.fvCalMonth}"]`, cal); (b && !b.disabled ? b : $(`[data-fv-day="${focus}"]`, cal))?.focus() }
  const one = $('#fv-day1', form), two = $('#fv-day2', form)
  if (one) { one.value = v.from ? fvRange(v.from) : ''; one.classList.toggle('is-picking', v.pick === 'from') }
  if (two) { two.value = v.to ? fvRange(v.to) : ''; two.classList.toggle('is-picking', v.pick === 'to') }
  const help = $('#fv-cal-help', form)
  if (help) help.textContent = v.pick === 'from' ? 'Pick Day 1, the day you arrive. Day 2 fills in as the next day.' : 'Tap Day 1 again for a 1-day visit. Day 2 is never later than the day after Day 1. To arrive on another day, tap a day before it, or the Day 1 box.'
  const clear = $('[data-fv-cal-clear]', form)
  if (clear) clear.hidden = !v.from
}

/** A day picked on the calendar (a tap, or Enter / Space): the visit after it, saved with the draft. */
function fvCalPick(form, day) {
  const a = form.elements.namedItem('visitFrom'), b = form.elements.namedItem('visitTo'), now = fvVisit(form)
  const v = fvRangePick(now, day, fvLim())
  fv.cal.focus = day
  if (v === now) return
  a.value = v.from; b.value = v.to; fv.cal.pick = v.pick
  bulkFarmKeep(form)
  fvUpdate(form)
}

/** What the form says now, from its fields (no checks). */
function fvRead(form) {
  const f = (k) => { const el = form.elements.namedItem(k); return el ? el.value : '' }
  return { name: f('name'), phone: f('phone'), altPhone: f('altPhone'), preferredLanguage: f('preferredLanguage'), city: f('city'), variety: f('variety'), kg: f('kg'), people: f('people'), visitFrom: f('visitFrom'), visitTo: f('visitTo'), notes: f('notes'), flexible: form.elements.namedItem('flexible').checked }
}

/** Live: the line under the dates, the kg picks, the greyed dates when flexible, the "Your visit" card and the phone's bar. */
function fvUpdate(form) {
  if (!form) return
  const d = fvRead(form), from = fvIsDay(d.visitFrom) ? d.visitFrom : '', to = fvIsDay(d.visitTo) ? d.visitTo : ''
  const ok = from && to && to >= from && fvDays(from, to) <= 2
  const says = $('#fv-range-says')
  if (says) says.innerHTML = ok ? `${icon('calendar')}<span>Your visit: <strong>${fvDays(from, to)} ${fvDays(from, to) === 1 ? 'day' : 'days'}, ${fvRange(from, to)}</strong></span>` : ''
  fvCalPaint(form)
  const dates = $('.fv-dates', form)
  if (dates) { dates.classList.toggle('is-flexible', d.flexible); const o = $('.fv-opt', dates); if (o) o.hidden = !d.flexible }
  const kg = Number(d.kg)
  $$('[data-fv-kg]', form).forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.fvKg) === kg)))
  const down = $('[data-fv-kg-step^="-"]', form)
  if (down) { if (!(kg > FARM_VISIT_MIN_KG)) down.setAttribute('aria-disabled', 'true'); else down.removeAttribute('aria-disabled') }
  const sel = form.elements.namedItem('variety'), mango = sel && sel.value ? sel.options[sel.selectedIndex].text : ''
  const people = /^\d+$/.test(d.people.trim()) && Number(d.people) > 0 ? Number(d.people) : 0
  const sum = {
    dates: ok ? `${fvRange(from, to, true)} · ${fvDays(from, to)} ${fvDays(from, to) === 1 ? 'day' : 'days'}` : d.flexible ? 'Flexible: we’ll agree them' : 'Pick your dates',
    people: people ? `${people} ${people === 1 ? 'person' : 'people'}` : '—',
    mangoes: `${kg > 0 ? `${kg.toLocaleString('en-IN')} kg` : '— kg'}${mango ? ` · ${mango}` : ' · mango not chosen yet'}`,
  }
  for (const [k, text] of Object.entries(sum)) { const dd = $(`.fv-sum [data-fv-sum="${k}"]`); if (dd) dd.textContent = text }
  fv.summary = { dates: ok ? fvRange(from, to, true) : d.flexible ? 'Dates flexible' : 'Dates to pick', people, kg }
  bulkBar()
}

/** The phone's sticky bar on the farm visit tab: the visit in one line and the send button (none beside the card on PC). */
function bulkFarmBar() {
  if (fv.sent) return setBar(`<div class="pay-bar-row is-sent"><p class="pay-bar-sent" role="status">${icon('check')}<span>Farm visit enquiry sent · we call you on WhatsApp</span></p></div>`)
  if (FV_WIDE.matches || !$('#farm-visit-form')) return setBar('')
  const s = fv.summary || { dates: 'Dates to pick', people: 0, kg: FARM_VISIT_MIN_KG }
  const line = [s.dates, s.people ? `${s.people} ${s.people === 1 ? 'person' : 'people'}` : '', s.kg > 0 ? `${s.kg.toLocaleString('en-IN')} kg` : ''].filter(Boolean).join(' · ')
  setBar(`<div class="pay-bar-row bulk-bar fv-bar"><div class="pay-bar-total"><small>Your visit</small><strong>${esc(line)}</strong></div><div class="bulk-bar-go"><button class="button primary pay-bar-go fv-bar-go" id="fv-send" ${fv.busy ? 'disabled' : ''}><span>${fv.busy ? 'Sending…' : 'Send farm visit enquiry'}</span>${fv.busy ? '' : icon('arrow')}</button></div></div>`)
}
FV_WIDE.addEventListener('change', () => { if (document.body.dataset.page === 'bulk' && bulkTab === 'farm-visit') bulkBar() })

function bulkFarmKeep(form) {
  const d = fvRead(form)
  save(FARM_VISIT_DRAFT, d)
  return d
}

/** The checks, each said under its own field: { field: message }. */
function fvChecks(d) {
  const errors = {}
  if (!String(d.name).trim()) errors.name = 'Tell us your name.'
  if (!/^[6-9]\d{9}$/.test(normPhone(d.phone))) errors.phone = 'Enter a 10-digit mobile number.'
  if (String(d.altPhone || '').trim() && !/^[6-9]\d{9}$/.test(normPhone(d.altPhone))) errors.altPhone = 'Enter a 10-digit mobile number, or leave it empty.'
  if (d.preferredLanguage && !FARM_LANGUAGES.includes(d.preferredLanguage)) errors.preferredLanguage = 'Choose a language from the list.'
  const from = d.visitFrom, to = d.visitTo, any = from || to
  if (!d.flexible || any) {
    if (!fvIsDay(from) || !fvIsDay(to)) errors.dates = 'Pick your visit dates.'
    else if (from < fvEarliest()) errors.dates = fvEarliest() > fvToday() ? `Visits start on ${fvRange(fvEarliest())}. Choose that day or later, or tick “I’m flexible”.` : 'That date has passed. Choose today or later, or tick “I’m flexible”.'
    else if (fv.season.end && from > fv.season.end) errors.dates = `The season’s last visit day is ${fvRange(fv.season.end)}.`
    else if (to < from) errors.dates = 'Day 2 can’t be before Day 1.'
    else if (fvDays(from, to) > 2) errors.dates = 'A farm visit is 2 days at most.'
  }
  if (!/^\d+$/.test(String(d.people).trim()) || Number(d.people) < 1) errors.people = 'At least one person is coming.'
  if (!String(d.city).trim()) errors.city = 'Tell us your city.'
  errors.kg = fvKgCheck(d.kg)
  if (!errors.kg) delete errors.kg
  return errors
}
const fvKgCheck = (kg) => (!/^\d+$/.test(String(kg).trim()) ? 'Enter the kg of mangoes, in whole kg.' : Number(kg) < FARM_VISIT_MIN_KG ? `A farm visit needs at least ${FARM_VISIT_MIN_KG} kg of mangoes.` : '')

/** The kg field said its error, or stopped saying it, without drawing the form again (it is checked when it changes). */
function fvKgSay(form) {
  const input = form.elements.namedItem('kg'), wrap = input && input.closest('.fv-kg-field')
  if (!wrap) return
  const msg = fvKgCheck(input.value)
  let out = $('#fv-kg-err', wrap)
  const hint = $('.fv-kg-hint', wrap)
  if (msg) {
    if (!out) { out = document.createElement('span'); out.className = 'field-error'; out.id = 'fv-kg-err'; wrap.append(out) }
    out.innerHTML = `${icon('info')}${esc(msg)}`
    input.setAttribute('aria-invalid', 'true'); input.setAttribute('aria-describedby', 'fv-kg-err')
    if (hint) hint.hidden = true
  } else {
    if (out) out.remove()
    input.removeAttribute('aria-invalid'); input.setAttribute('aria-describedby', 'fv-kg-hint')
    if (hint) hint.hidden = false
  }
}

async function bulkFarmSend(form) {
  if (fv.busy) return
  const d = bulkFarmKeep(form), errors = fvChecks(d)
  if (Object.keys(errors).length) {
    bulkFarmDraw(errors)
    const first = $('#farm-visit-form [aria-invalid="true"]')
    if (first) { first.focus({ preventScroll: true }); first.scrollIntoView({ block: 'center', behavior: reduced ? 'instant' : 'smooth' }) }
    return
  }
  if (fv.captchaOn && !fv.captcha) return bulkFarmDraw({}, CAPTCHA_ASK)
  const captcha = fv.captcha
  fv.key ||= MM.idem()['Idempotency-Key']
  fv.busy = true
  bulkFarmDraw()
  const dated = fvIsDay(d.visitFrom) && fvIsDay(d.visitTo)
  const body = {
    name: String(d.name).trim(), phone: normPhone(d.phone), city: String(d.city).trim(), variety: d.variety || null, kg: Number(d.kg), people: Number(d.people),
    visitFrom: dated ? d.visitFrom : null, visitTo: dated ? d.visitTo : null, flexible: Boolean(d.flexible) || !dated, notes: String(d.notes || '').trim() || null,
    preferredLanguage: d.preferredLanguage || null, altPhone: String(d.altPhone || '').trim() ? normPhone(d.altPhone) : null,
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
    const at = ['visitFrom', 'visitTo', 'visitDate'].includes(field) ? 'dates' : field
    return bulkFarmDraw(at ? { [at]: msg } : {}, at ? '' : msg)
  }
  fv.busy = false
  bulkFarmDraw()
  $('#bulk-farm .bulk-farm-sent')?.focus()
  $('#bulk-farm')?.scrollIntoView({ block: 'start', behavior: reduced ? 'instant' : 'smooth' })
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
  const n = e.target.name
  if (n === 'kg') fvKgSay(f)
  bulkFarmKeep(f)
  fvUpdate(f)
})
document.addEventListener('input', (e) => {
  const f = e.target.form
  if (!f || f.id !== 'farm-visit-form') return
  // A kg error goes as soon as the number is right again (it is said when the field changes, not while typing).
  if (e.target.name === 'kg' && $('#fv-kg-err', f) && !fvKgCheck(e.target.value)) fvKgSay(f)
  fvUpdate(f)
})
document.addEventListener('click', (e) => {
  const b = e.target instanceof Element ? e.target.closest('[data-farm-visit-again],[data-fv-kg-step],[data-fv-kg],#fv-send') : null
  if (!b) return
  if (b.hasAttribute('data-farm-visit-again')) { fv.sent = null; bulkFarmDraw(); return }
  const form = $('#farm-visit-form')
  if (!form) return
  if (b.id === 'fv-send') { if (form.requestSubmit) form.requestSubmit(); else bulkFarmSend(form); return }
  const input = form.elements.namedItem('kg'), now = Math.floor(Number(input.value)) || 0
  if (b.dataset.fvKgStep) {
    if (b.getAttribute('aria-disabled') === 'true') return
    const step = Number(b.dataset.fvKgStep)
    input.value = String(Math.min(100000, Math.max(FARM_VISIT_MIN_KG, step > 0 && now < FARM_VISIT_MIN_KG ? FARM_VISIT_MIN_KG : now + step)))
  } else input.value = b.dataset.fvKg
  fvKgSay(form)
  bulkFarmKeep(form)
  fvUpdate(form)
})

// The calendar: a day, the month buttons, the Day boxes (which say what a tap picks), "Clear the dates", and the keys.
document.addEventListener('click', (e) => {
  const el = e.target instanceof Element ? e.target.closest('[data-fv-day],[data-fv-cal-month],[data-fv-box],[data-fv-cal-clear]') : null
  const form = el && el.closest('#farm-visit-form')
  if (!form) return
  if (el.dataset.fvDay) { if (el.getAttribute('aria-disabled') !== 'true') fvCalPick(form, el.dataset.fvDay); else { fv.cal.focus = el.dataset.fvDay; fvCalPaint(form) } return }
  if (el.dataset.fvCalMonth) { fv.cal.month = fvMonthAdd(fv.cal.month, Number(el.dataset.fvCalMonth)); fv.cal.focus = ''; fvCalPaint(form); return }
  if (el.hasAttribute('data-fv-cal-clear')) {
    form.elements.namedItem('visitFrom').value = ''; form.elements.namedItem('visitTo').value = ''
    fv.cal.pick = 'from'; fv.cal.focus = ''
    bulkFarmKeep(form); fvUpdate(form)
    $('#fv-day1', form)?.focus()
    return
  }
  fvBoxPick(form, el.dataset.fvBox)
})
/** A Day box chosen: a tap picks that day next (Day 2 only once there is a Day 1), and the calendar shows its month. */
function fvBoxPick(form, which) {
  const v = fvVisit(form)
  fv.cal.pick = which === 'to' && v.from ? 'to' : 'from'
  const day = fv.cal.pick === 'to' ? v.to : v.from
  if (day) fv.cal.month = day.slice(0, 7)
  fv.cal.focus = ''
  fvCalPaint(form)
}
document.addEventListener('keydown', (e) => {
  const el = e.target instanceof Element ? e.target : null
  const form = el && el.closest('#farm-visit-form')
  if (!form) return
  // A Day box: Enter, Space or Down picks that day on the calendar (and never sends the form).
  if (el.dataset.fvBox && ['Enter', ' ', 'ArrowDown'].includes(e.key)) {
    e.preventDefault()
    fvBoxPick(form, el.dataset.fvBox)
    $('#fv-cal td[tabindex="0"]', form)?.focus()
    return
  }
  if (!el.dataset.fvDay) return
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (el.getAttribute('aria-disabled') !== 'true') fvCalPick(form, el.dataset.fvDay); return }
  const to = fvCalMove(el.dataset.fvDay, e.key)
  if (!to) return
  e.preventDefault()
  const lim = fvLim(), first = `${lim.earliest.slice(0, 7)}-01`
  // The keys never leave the months the calendar can show.
  if (to < first || fvMonthAdd(to.slice(0, 7), 0) > fvMonthAdd(lim.earliest.slice(0, 7), 18) || (lim.last && to.slice(0, 7) > lim.last.slice(0, 7))) return
  fv.cal.focus = to
  fv.cal.month = to.slice(0, 7)
  fvCalPaint(form)
  $(`#fv-cal [data-fv-day="${to}"]`, form)?.focus()
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
        ${rc ? `<div><dt>Paid</dt><dd>${when(rc.paidAt)}</dd></div><div><dt>Paid by</dt><dd>${esc([rc.method === 'dev' || rc.method === 'demo' ? 'test payment' : rc.method, rc.card, rc.upiRef ? `UPI ref ${rc.upiRef}` : ''].filter(Boolean).join(' · ') || 'online')}</dd></div><div><dt>Payment ID</dt><dd class="no-wrap">${esc(rc.paymentId || '')}</dd></div>` : ''}
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
    const r = await MM.demoPayBulk(id, outcome)
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
