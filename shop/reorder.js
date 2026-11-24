/* Order again (the owner, 23 Nov 2026: "just press a button to re-order the same order").
   - Your orders (app.js ordersView, orderView, preorderView; gifts.js giftRows, giftOrderView): every past order, pre-order
     and gift order has "Order again" ("Send again" for a gift). It reads the order from the API (GET /v1/orders/:id,
     /v1/preorders/:id, /v1/gifts/:id), so it works on any device, and puts the same boxes (box, ripeness, quantity) in the
     bag at today's prices, merged with what is there, under the bag's own rules (20 boxes a line, the day's stock: app.js
     bumpError, the check every add makes). The bag then opens with a note at the top: what was added, and each box that
     could not be, and why. A gift for one person goes back in as a gift line (the recipient is entered at checkout, as
     always; the old one is never reused). A gift to several people opens the gift flow with the same box and no people.
   - Before the season the shop only takes pre-orders, booked from a box's pre-order sheet (the bag can't check out your
     own boxes then: app.js seasonBag). So the first box's pre-order sheet opens with its ripeness and quantity, and the
     order's other boxes are listed under "Then pre-order these", one button each. A gift still goes in the bag (a gift
     pre-order is checked out from the bag, gift-bag.js).
   - "Ordered before" on the cards and the product sheet (shelf.js cardHTML, renderDetail): from GET /v1/me/ordered-products
     (per variety, the signed-in customer's DELIVERED orders), read once per sign-in and kept in memory. The card's
     "Order again" is the shop's own Add (data-add: shelf.js add(), the fly-into-bag) for the last box size and ripeness.
   Loaded after app.js, shelf.js, gifts.js and gift-bag.js: their functions are used at call time. Styles: style.css
   ("Order again" block). */

const RO_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 11a7.5 7.5 0 0 1 13.2-4.4L20 9"/><path d="M20 4v5h-5"/><path d="M19.5 13a7.5 7.5 0 0 1-13.2 4.4L4 15"/><path d="M4 20v-5h5"/></svg>'
let roOrdered = null, roFor = null, roNote = null, roQueue = null

// ---- "Ordered before"

/** "16 Nov" (with the year when it isn't this year's). */
function roDay(d) {
  const [y, m, day] = String(d || '').split('-').map(Number)
  if (!y) return ''
  return new Date(y, m - 1, day).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(y !== new Date().getFullYear() ? { year: 'numeric' } : {}) })
}
const roTagText = (e) => (e.times > 1 ? `Ordered ${e.times} times · last ${roDay(e.lastDeliveredOn)}` : `Ordered before · ${roDay(e.lastDeliveredOn)}`)
/** The tag's words, with the day kept on one line. */
const roTagHTML = (e) => `${e.times > 1 ? `Ordered ${e.times} times` : 'Ordered before'} · <span class="ro-when">${e.times > 1 ? 'last ' : ''}${esc(roDay(e.lastDeliveredOn))}</span>`
const roKg = (s) => String(s.boxSize).replace('kg', ' kg')
/** "Alphonso 3 kg" for a box, from the shop's products or, for one no longer sold, its API name ("Kesar 3kg Box"). */
function roBoxName(sku, name) {
  const s = skuOf(sku)
  if (s) return `${s.variety || s.name} ${roKg(s)}`
  const m = String(name || '').match(/^(.*?)\s*(\d+(?:\.\d+)?)\s*kg\s*box$/i)
  return m ? `${m[1]} ${m[2]} kg` : String(name || sku || 'This box')
}
const roStage = (stage) => (STAGES.find((x) => x.apiStage === stage) || { stage: String(stage || '').toLowerCase() }).stage.toLowerCase()

/** Can the last box of this variety be ordered again now? { ok } or { why } in a few words. */
function roCan(e) {
  const s = skuOf(e.sku)
  if (!s) return { why: 'No longer sold' }
  if (!SOLD_API.includes(e.stage)) return { why: `${stageOf(e.stage).stage} no longer sold` }
  if (preSeason() === 'BEFORE') return { why: `Pre-orders open ${fmtDate(season.preorderOpensOn)}` }
  if (preSeason() && !pre.weeks.some((w) => w.sku === e.sku)) return { why: 'No weeks open yet' }
  return { ok: true }
}

/** The data on the button: the shop's own Add in season (shelf.js add, fly.js), the prefilled pre-order sheet before it. */
function roGo(e, v) {
  const key = `data-sku="${esc(e.sku)}" data-stage="${esc(e.stage)}"`
  return preSeason() ? `data-ro-pre-one="${esc(v.name)}" ${key}` : `data-add="${esc(v.name)}" ${key}`
}

/** On a card's photo: the tag and a compact Order again (absolute, so the card keeps its height). */
function roCardHTML(v) {
  const e = roOrdered && roOrdered.get(v.name)
  if (!e) return ''
  const s = skuOf(e.sku), what = esc(`${s ? `${v.name} ${roKg(s)}` : roBoxName(e.sku)} ${roStage(e.stage)}`), can = roCan(e)
  // On a phone the tag rides inside the button as its second line (ro-again-sub), so both fit on a narrow photo.
  const told = esc(`${roTagText(e)}`), sub = `<span class="ro-again-sub" aria-hidden="true">${e.times > 1 ? `Ordered ${e.times}×` : 'Ordered'} · <span class="ro-when">${esc(roDay(e.lastDeliveredOn))}</span></span>`
  const btn = can.ok
    ? `<button type="button" class="ro-again" ${roGo(e, v)} aria-label="Order again: ${what}. ${told}">${RO_ICON}<span class="ro-again-copy"><span class="ro-again-text">Order again</span>${sub}</span></button>`
    : `<button type="button" class="ro-again is-off" disabled aria-label="Order again: ${what}. ${esc(can.why)}. ${told}" title="${esc(can.why)}">${icon('info')}<span class="ro-again-copy"><span class="ro-again-text">${esc(can.why)}</span>${sub}</span></button>`
  return `<div class="ro-card"><span class="ro-tag" aria-hidden="true">${icon('check')}<span>${roTagHTML(e)}</span></span>${btn}</div>`
}

/** In the product sheet, under the name: the tag, and Order again (or why it can't be) with the box in words. */
function roDetailHTML(v) {
  const e = roOrdered && roOrdered.get(v.name)
  if (!e) return ''
  const s = skuOf(e.sku), what = `${s ? `${v.name} ${roKg(s)}` : roBoxName(e.sku)} ${roStage(e.stage)}`, can = roCan(e)
  const btn = can.ok
    ? `<button type="button" class="button secondary ro-detail-go" ${roGo(e, v)} aria-label="Order again: ${esc(what)}">${RO_ICON}<span>Order again · ${esc(what)}</span></button>`
    : `<p class="ro-why">${icon('info')}<span>${esc(what)}: ${esc(can.why.toLowerCase())}.</span></p>`
  return `<div class="ro-detail"><span class="ro-tag">${icon('check')}<span>${roTagHTML(e)}</span></span>${btn}</div>`
}

/** Puts the tags on the cards already drawn (no redraw of the grid). */
function roPaint() {
  $$('.product-card[data-variety]').forEach((card) => {
    const v = shelf.find((x) => x.name === card.dataset.variety), img = card.querySelector('.product-image')
    if (!v || !img) return
    img.querySelector('.ro-card')?.remove()
    const h = roCardHTML(v)
    if (h) img.insertAdjacentHTML('beforeend', h)
  })
}

/** Read once per signed-in customer; forgotten on sign-out. */
function roLoad() {
  const p = window.MM && MM.profile(), id = p ? p.id : null
  if (id === roFor) return
  roFor = id
  roOrdered = null
  roPaint()
  if (!id) return
  MM.api('/me/ordered-products', { auth: true }).then((list) => {
    if (roFor !== id || !Array.isArray(list)) return
    roOrdered = new Map(list.map((e) => [e.variety, e]))
    roPaint()
  }, () => {})
}
window.addEventListener('mm:profile', roLoad)
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', roLoad)
else roLoad()

// ---- Order again buttons in Your orders

const roGiftish = (x, kind) => kind === 'gift' || !!(x.giftRecipient || x.giftOrderId || x.gift || x.group)
const roWord = (gift) => (gift ? 'Send again' : 'Order again')

/** Under a row of the orders list (not for an unpaid one, which has its own Pay, nor bulk orders). */
function roRowHTML(x, kind) {
  if (x && x.status === 'PAYMENT_PENDING' && !/^B/.test(String(x.number || ''))) return payRowHTML(x, kind)
  if (!x || x.status === 'WAITLISTED' || /^B/.test(String(x.number || ''))) return ''
  const closed = x.paymentClosed && x.status === 'CANCELLED' ? payStateHTML(x) : ''
  const gift = roGiftish(x, kind), no = kind === 'gift' ? giftNo(x.number) : orderNo(x.number)
  return `${closed}<button type="button" class="text-button ro-row" data-reorder="${kind}" data-id="${esc(x.id)}" aria-label="${roWord(gift)}: the boxes of ${kind === 'pre' ? 'pre-order' : kind === 'gift' ? 'gift order' : 'order'} ${esc(no)}">${RO_ICON}<span>${roWord(gift)}</span></button>`
}

/** On an order's own sheet or page, where its boxes are known: the name says what goes in the bag. */
function roSheetHTML(x, kind) {
  if (!x || x.status === 'PAYMENT_PENDING' || x.status === 'WAITLISTED' || /^B/.test(String(x.number || ''))) return ''
  const gift = roGiftish(x, kind)
  const lines = kind === 'pre' ? [{ sku: x.sku, stage: x.stage, qty: x.qty, name: x.productName }]
    : kind === 'gift' ? [] : (x.items || []).filter((i) => !i.bulk).map((i) => ({ sku: i.sku, stage: i.stage, qty: i.quantity, name: i.name }))
  const what = lines.length === 1 ? `${roBoxName(lines[0].sku, lines[0].name)} ${roStage(lines[0].stage)}, ${boxWord(lines[0].qty)}`
    : `the boxes of ${kind === 'gift' ? 'gift order ' + giftNo(x.number) : orderNo(x.number)}`
  return `<button type="button" class="button secondary full ro-sheet" data-reorder="${kind}" data-id="${esc(x.id)}" aria-label="${roWord(gift)}: ${esc(what)}">${RO_ICON}<span>${roWord(gift)}</span></button>`
}
const roGiftHTML = (g) => roSheetHTML(g, 'gift')

// ---- The payment, said the same way everywhere (API migration 086: paymentFailed, paymentClosed)
// Your orders, the order page and sheet, the pre-order sheet, the gift order page, the checkout and gift pay steps:
// - the last attempt failed and it can still be paid: a red "Payment failed" tag, one plain line, "Try payment again";
// - closed unpaid by us (the hold ran out): "Payment failed · this order was closed", and Order again;
// - still waiting: "Pay now", with the time it is held until.

const payHeld = (x) => (x && x.holdExpiresAt && Date.parse(x.holdExpiresAt) > Date.now() ? fmtTime(x.holdExpiresAt) : '')
const payWord = (x) => (x && x.paymentFailed ? 'Try payment again' : 'Pay now')
/** The tag and the line (no buttons: each place keeps its own pay button, worded with payWord). */
function payStateHTML(x) {
  if (!x) return ''
  const held = payHeld(x)
  if (x.paymentFailed && x.status === 'PAYMENT_PENDING') return `<div class="pay-state is-failed" role="status"><span class="pay-tag">${icon('close')}Payment failed</span><p>Your payment didn’t go through. Nothing was charged.${held ? ` It’s held for you until ${esc(held)}: try again before then.` : ''}</p></div>`
  if (x.paymentClosed && x.status === 'CANCELLED') return `<div class="pay-state is-closed" role="status"><span class="pay-tag">${icon('close')}Payment failed · this order was closed</span><p>It wasn’t paid in time, so its boxes went back on sale. Order again to put the same boxes in your bag.</p></div>`
  if (x.status === 'PAYMENT_PENDING' && held) return `<div class="pay-state is-waiting"><p>${icon('clock')}<span>Waiting for your payment · held until ${esc(held)}</span></p></div>`
  return ''
}

/** Under a row of Your orders: the payment state and its button (Try payment again / Pay now), or '' when paid. */
function payRowHTML(x, kind) {
  const st = payStateHTML(x)
  if (!st) return ''
  if (x.status !== 'PAYMENT_PENDING' || !payHeld(x)) return st
  const no = kind === 'gift' ? giftNo(x.number) : orderNo(x.number), label = `${payWord(x)}: ${kind === 'pre' ? 'pre-order' : kind === 'gift' ? 'gift order' : 'order'} ${no}`
  const btn = kind === 'order' ? `<button type="button" class="button primary pay-row-go" data-pay-order="${esc(x.id)}" aria-label="${esc(label)}">${payWord(x)} ${icon('arrow')}</button>`
    : kind === 'pre' ? (realUrl(x.paymentUrl) ? `<a class="button primary pay-row-go" href="${esc(x.paymentUrl)}" aria-label="${esc(label)}">${payWord(x)} ${icon('arrow')}</a>` : `<button type="button" class="button primary pay-row-go" data-pre="view" data-id="${esc(x.id)}" aria-label="${esc(label)}">${payWord(x)} ${icon('arrow')}</button>`)
    : `<button type="button" class="button primary pay-row-go" data-gift-open="${esc(x.id)}" aria-label="${esc(label)}">${payWord(x)} ${icon('arrow')}</button>`
  return st.replace(/<\/div>$/, `${btn}</div>`)
}

// ---- Doing it

/** The order as a job: its number, its boxes, and whether it was a gift for one person or several. */
function roJob(kind, x) {
  if (kind === 'pre') return { number: x.number, gift: !!x.gift && !x.group, group: !!x.group, lines: [{ sku: x.sku, stage: x.stage, qty: x.qty, name: x.productName, unitPrice: x.unitPrice }], skipped: [] }
  if (kind === 'gift') {
    // Several people: the box most of them got (the gift flow gives everyone one box).
    const count = new Map()
    for (const r of x.recipients || []) if (r.sku) { const k = `${r.sku}|${r.stage}|${r.qty}`; count.set(k, (count.get(k) || 0) + 1) }
    const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0]
    const [sku, stage, qty] = top ? top[0].split('|') : []
    return { number: x.number, group: true, lines: sku ? [{ sku, stage, qty: Number(qty) || 1, name: (x.recipients.find((r) => r.sku === sku) || {}).boxName }] : [], skipped: [] }
  }
  const items = x.items || []
  return {
    number: x.number, gift: !!x.gift && !x.giftOrderId, group: !!x.giftOrderId, giftOrderId: x.giftOrderId || null,
    lines: items.filter((i) => !i.bulk).map((i) => ({ sku: i.sku, stage: i.stage, qty: i.quantity, name: i.name, unitPrice: i.unitPrice })),
    skipped: items.filter((i) => i.bulk).map((i) => `${roBoxName(i.sku, i.name)} was a bulk deal: order it from the Bulk page`),
  }
}

async function roStart(b) {
  const kind = b.dataset.reorder, id = b.dataset.id
  if (b.getAttribute('aria-busy') === 'true') return
  b.setAttribute('aria-busy', 'true')
  b.disabled = true
  try {
    if (!skus.length) throw new Error('The shop is still loading. Try again in a moment.')
    const x = kind === 'pre' ? await MM.preorder(id) : kind === 'gift' ? await MM.gift(id) : await MM.order(id)
    let job = roJob(kind, x)
    if (job.giftOrderId) job = roJob('gift', await MM.gift(job.giftOrderId))
    if (job.group) await roGroup(job)
    else if (preSeason() && !job.gift) roPre(job)
    else roBag(job)
  } catch (e) {
    toast(e.status === 401 ? 'Please sign in again to order again.' : e.message)
  } finally {
    b.removeAttribute('aria-busy')
    b.disabled = false
  }
}

/** Why a line can't come at all, before any stock is looked at: the box or its ripeness is no longer sold. */
function roGone(l) {
  const name = roBoxName(l.sku, l.name)
  if (!skuOf(l.sku)) return `${name} is no longer sold`
  if (!SOLD_API.includes(l.stage)) return `${capFirst(roStage(l.stage))} ${name} is no longer sold: we now sell ${SOLD.map((x) => x.stage.toLowerCase()).join(' and ')}`
  return ''
}

/**
 * Into the bag, merged with what is there, each line as far as the bag's rules let it: at most 20 boxes a line
 * (the per-order limit), and only as many as the stock allows (bumpError: the same check as the shop's Add and the bag's +;
 * for a gift before the season, the gift pre-order's own checks, gift-bag.js bagAddGift). Every box left out is said.
 */
function roBag(job) {
  const notes = [...job.skipped]
  let added = 0, repriced = false
  for (const l of job.lines) {
    const gone = roGone(l)
    if (gone) { notes.push(gone); continue }
    const s = skuOf(l.sku), name = `${capFirst(roStage(l.stage))} ${roBoxName(l.sku, l.name)}`, want = Math.max(1, Number(l.qty) || 1)
    const match = (job.gift ? cart.concat(cartAside) : cart).find((x) => !!x.gift === job.gift && x.sku === l.sku && x.stage === l.stage)
    const have = match ? match.qty : 0
    let n = Math.min(want, 20 - have), why = n < want ? (have ? `20 is the most per order, and ${boxWord(have)} ${have === 1 ? 'was' : 'were'} already in your bag` : '20 is the most per order') : ''
    const blocked = (k) => {
      if (job.gift && giftPre()) return preTooBig(have + k, l.sku) ? preTooBigWords(l.sku) : !(pre.days.length && pre.countsBy !== 'boxes' ? preDayFor(have + k, l.sku) : pre.weeks.some((w) => w.sku === l.sku && w.remaining >= preNeed(k, l.sku))) ? 'every delivery week is fully booked for now' : ''
      bagKind = job.gift
      return bagWhyKind(l.sku, l.stage, have + k)
    }
    while (n > 0) {
      const w = blocked(n)
      if (!w) break
      if (n === Math.min(want, 20 - have)) why = w.replace(/\.$/, '')
      n--
    }
    if (n > 0) {
      if (match) match.qty += n
      else cart.push({ sku: l.sku, stage: l.stage, qty: n, weight: kgOf(s), ...(job.gift ? { gift: true } : {}) })
      added += n
      if (l.unitPrice != null && Number(l.unitPrice) !== Number(s.price)) repriced = true
    }
    if (n < want) notes.push(n === 0 ? `${name} couldn’t be added: ${lowFirst(why)}` : `Only ${n} of ${want} ${name} boxes could be added: ${lowFirst(why)}`)
  }
  if (added) updateCart()
  const no = orderNo(job.number), what = job.gift ? 'gift order' : 'order'
  roNote = {
    ok: added > 0,
    head: added
      ? `Added from ${what} ${no}: ${boxWord(added)}${job.gift ? ' as a gift' : ''}${repriced ? ', at today’s prices' : ''}.`
      : `Nothing from ${what} ${no} could be added.`,
    more: added && job.gift ? 'You add who it’s for (name, mobile and address) at checkout.' : '',
    notes,
  }
  // Focus goes to the note (it says what happened); a redraw of the bag in the next moments (the day's stock arriving) keeps it there.
  roNote.focusUntil = Date.now() + 2500
  closeDialogs()
  go('/cart')
}
const capFirst2 = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1)
const lowFirst = (s) => String(s).charAt(0).toLowerCase() + String(s).slice(1)

/** At the top of the bag (app.js renderCartPage) after Order again, until the bag is left or the note closed. */
function roNoteHTML() {
  if (!roNote) return ''
  const n = roNote
  if (n.focusUntil > Date.now()) setTimeout(() => { const el = $('#ro-note'), a = document.activeElement; if (el && (!a || a === document.body || !a.isConnected)) el.focus() })
  return `<section class="page-card ro-note${n.ok ? '' : ' is-none'}" id="ro-note" tabindex="-1" role="status" aria-labelledby="ro-note-h"><span class="ro-note-icon" aria-hidden="true">${icon(n.ok ? 'check' : 'info')}</span><div class="ro-note-copy"><p id="ro-note-h"><strong>${esc(n.head)}</strong>${n.more ? ` ${esc(n.more)}` : ''}</p>${n.notes.length ? `<ul class="ro-note-why">${n.notes.map((t) => `<li>${icon('info')}<span>${esc(capFirst2(t))}.</span></li>`).join('')}</ul>` : ''}</div><button type="button" class="icon-button ro-note-close" data-ro-close aria-label="Close this message">${icon('close')}</button></section>`
}
window.addEventListener('mm:route', (e) => { if (roNote && (e.detail || {}).path !== '/cart') roNote = null })

// ---- Before the season: the pre-order sheet, one box at a time

function roPre(job) {
  const notes = [...job.skipped], ok = []
  for (const l of job.lines) {
    const gone = roGone(l)
    if (gone) { notes.push(gone); continue }
    if (!pre.weeks.some((w) => w.sku === l.sku)) { notes.push(`${roBoxName(l.sku, l.name)} has no harvest weeks open yet`); continue }
    ok.push(l)
  }
  if (!ok.length) {
    $('#form-dialog').innerHTML = formHeader('Order again') + `<div class="ro-pre-none" role="status"><p><strong>Nothing from order ${esc(orderNo(job.number))} can be pre-ordered right now.</strong></p><ul class="ro-note-why">${notes.map((t) => `<li>${icon('info')}<span>${esc(capFirst2(t))}.</span></li>`).join('')}</ul><button type="button" class="button primary full" data-close>Back to the mangoes ${icon('arrow')}</button></div>`
    if (!$('#form-dialog').open) openDialog('#form-dialog')
    return
  }
  roQueue = { number: job.number, rest: ok.slice(1), notes }
  roOpenPre(ok[0], true)
}

/** The box's pre-order sheet (the product sheet's booking panel), with its ripeness and quantity already chosen. */
function roOpenPre(l, fromQueue = false) {
  const s = skuOf(l.sku), v = s && shelf.find((x) => x.name === s.variety)
  if (!v) { toast(`${roBoxName(l.sku, l.name)} isn’t in the shop right now.`); return }
  if (!fromQueue) roQueue = null
  // The pre-order sheet belongs to the shop: from Your orders, back to the shop first (as a card's Pre-order).
  if (pageOpen()) go('/')
  openPreBooking(v.name, l.sku, l.stage)
  if (preSeason() === 'PREORDER' && pre.weeks.some((w) => w.sku === l.sku)) {
    pre.sku = l.sku
    if (pre.stages.includes(l.stage)) pre.stage = l.stage
    pre.qty = Math.min(20, Math.max(1, Number(l.qty) || 1))
    pre.weekStart = null
    preFix()
    renderPreorder()
  }
  const box = $('#pre-box')
  if (!box || !roQueue) return
  // This sheet is for the order's box: the variety's own "Order again" (its last box) would only confuse here.
  $('#product-dialog .ro-detail-go')?.remove()
  const q = roQueue
  box.insertAdjacentHTML('beforebegin', `<p class="ro-pre-from" role="status">${RO_ICON}<span>Ordering again from ${esc(orderNo(q.number))}. Before the season each box is its own pre-order${q.rest.length ? ': book this one, then the others below' : ''}.</span></p>`)
  if (q.rest.length || q.notes.length) {
    box.insertAdjacentHTML('afterend', `<section class="ro-pre-next" aria-labelledby="ro-pre-next-h">${q.rest.length ? `<h3 id="ro-pre-next-h">Then pre-order these</h3><ul>${q.rest.map((x, i) => `<li><span>${esc(roBoxName(x.sku, x.name))} · ${esc(roStage(x.stage))} · ${boxWord(x.qty)}</span><button type="button" class="button secondary" data-ro-next="${i}" aria-label="Pre-order ${esc(roBoxName(x.sku, x.name))} ${esc(roStage(x.stage))}, ${boxWord(x.qty)}">${icon('sun')}<span>Pre-order</span></button></li>`).join('')}</ul>` : `<h3 id="ro-pre-next-h">Not included</h3>`}${q.notes.length ? `<ul class="ro-note-why">${q.notes.map((t) => `<li>${icon('info')}<span>${esc(capFirst2(t))}.</span></li>`).join('')}</ul>` : ''}</section>`)
  }
}

// ---- Several people: the gift flow, with the same box and nobody filled in

async function roGroup(job) {
  const l = job.lines[0]
  const gone = l ? roGone(l) : 'That gift’s box isn’t known'
  closeDialogs()
  go('/gifts')
  if (gone) { toast(`${capFirst2(gone)}. Choose a gift box below.`); return }
  for (let i = 0; i < 100 && !(giftEnv.ready && giftPage()); i++) await new Promise((r) => setTimeout(r, 100))
  if (!giftPage()) return
  const g = giftGate()
  if (g) { toast(g.long); return }
  openSend(l.sku, l.stage, Math.min(20, Math.max(1, Number(l.qty) || 1)))
  toast(`The same box is chosen: ${roBoxName(l.sku, l.name)}, ${roStage(l.stage)}. Add the people.`)
}

// ---- Events

document.addEventListener('click', (e) => {
  const b = e.target instanceof Element ? e.target.closest('button') : null
  if (!b) return
  if (b.dataset.reorder) { e.preventDefault(); roStart(b) }
  else if (b.hasAttribute('data-ro-close')) {
    roNote = null
    const n = $('#ro-note')
    const next = n && (n.nextElementSibling?.querySelector('button,a') || $('.page-head h1, .page-head h2'))
    n?.remove()
    next?.focus?.()
  } else if (b.dataset.roPreOne) roOpenPre({ sku: b.dataset.sku, stage: b.dataset.stage, qty: 1 })
  else if (b.dataset.roNext && roQueue) {
    const i = Number(b.dataset.roNext), l = roQueue.rest[i]
    if (!l) return
    roQueue = { ...roQueue, rest: roQueue.rest.filter((_, j) => j !== i) }
    roOpenPre(l, true)
  }
})
