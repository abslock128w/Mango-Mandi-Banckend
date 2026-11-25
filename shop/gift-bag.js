/* A gift in the bag: boxes added from a gift card while sending gifts is switched off (/gifts, "Add to bag as a gift"),
   or kept in a bag from before the two-screen gifting flow, are bag lines marked `gift: true`, in the one bag
   with your own boxes (same bag icon, same count). The bag page shows them in two groups, "For you" and "Gift", each with
   its own subtotal and checkout; a line can be moved between them. The API's regular checkout makes one order to one
   address per confirm, so each group is its own order and payment, checked out one after the other:
   - checkout() (app.js) calls coSplit(): `cart` becomes the lines of the group being checked out and the other group waits
     in `cartAside` (still saved, still counted: app.js updateCart/bagTotals add it). Everything the checkout already does
     (the server cart sync, the earliest delivery day, stock messages, the totals, the cancellation callout) then works on
     that group alone. Leaving the checkout (or opening the bag) puts the bag back together: coUnsplit().
   - A paid order takes only its own group's lines out of the bag (paidDrop); the success screen and the bag then prompt for
     the other group. The API holds one unpaid order at a time: an abandoned first order is found by app.js's existing
     "You already have an unpaid order" handling when the second is confirmed.
   - The gift group's checkout asks "Who is it for?" (the recipient's name, mobile, an optional message) and sends
     `gift` on POST /v1/checkout/confirm (mango-api customer.js): delivered to the address given, not saved as yours.
   - Gift orders made this way are remembered by id on this device (localStorage mm-gift-orders), so the orders list can
     tag them: the list answer from the API does not say which orders are gifts; the order page's answer does (`gift`).
   Loaded after gifts.js and before app.js: top-level code only declares and listens (app.js's functions are used at call time). */

let cartAside = [], coGroup = null, bagKind = false
let coGift = { name: '', phone: '', message: '' }, coGiftErr = {}
const CO_GROUP = 'mm-co-group', BAG_NEXT = 'mm-bag-next', GIFT_TO = 'mm-gift-to', GIFT_ORDERS = 'mm-gift-orders', WHERE_HELD = 'mm-where-held', CO_ORDERS = 'mm-co-orders'
const GIFT_MSG_MAX = 200

const ssGet = (k) => { try { return sessionStorage.getItem(k) } catch { return null } }
const ssSet = (k, v) => { try { sessionStorage.setItem(k, v) } catch {} }
const ssDel = (k) => { try { sessionStorage.removeItem(k) } catch {} }
const ssJSON = (k, d) => { try { return JSON.parse(sessionStorage.getItem(k)) ?? d } catch { return d } }
try { const g = JSON.parse(sessionStorage.getItem(GIFT_TO)); if (g) coGift = { name: String(g.name || ''), phone: String(g.phone || ''), message: String(g.message || '').slice(0, GIFT_MSG_MAX) } } catch {}

const ofKind = (lines, gift) => lines.filter((x) => !!x.gift === gift)
/** The bag's first group: your own boxes, or the gift when that is all there is. The bag page's date, bill and bar follow it. */
function bagMine() { const s = ofKind(cart, false), g = ofKind(cart, true); if (preSeason() && g.length) return g; return s.length ? s : cart }
/** Before the season the gift group is a gift pre-order (one booking per box line, delivered in its week). */
const giftPre = () => !!preSeason()
/** bumpError for a line of the kind set in bagKind (the bag page's steppers), then back to your own boxes. */
function bagWhyKind(sku, stage, qty) { try { return bumpError(sku, stage, qty) } finally { bagKind = false } }

// ---- Adding from a gift card: the shop's own add (shelf.js add()), for a gift line and a chosen number of boxes.
function bagAddGift(sku, stage, n = 1) {
  const s = skuOf(sku), st = stageOf(stage)
  if (!s) return false
  const match = cart.concat(cartAside).find((x) => x.gift && x.sku === sku && x.stage === stage)
  const have = match ? match.qty : 0
  if (have + n > 20) { toast(have ? `20 boxes is the most per line, and ${boxWord(have)} of these are already in your bag as a gift. For more, place a bulk order.` : 'For larger quantities, place a bulk order.'); return false }
  // Before the season the gift is pre-ordered (booked for a delivery week at checkout), so the day's stock doesn't apply.
  if (giftPre()) {
    if (preTooBig(have + n, sku)) { toast(preTooBigWords(sku)); return false }
    if (!(pre.days.length && pre.countsBy !== 'boxes' ? preDayFor(have + n, sku) : pre.weeks.some((w) => w.sku === sku && w.remaining >= preNeed(n, sku)))) { toast('Every delivery week is fully booked for now.'); return false }
  } else {
    bagKind = true
    const why = bagWhyKind(sku, stage, have + n)
    if (why) { toast(why); return false }
  }
  if (match) match.qty += n
  else cart.push({ sku, stage, qty: n, weight: kgOf(s), gift: true })
  updateCart()
  toast(`${giftPre() ? 'Added as a gift pre-order' : 'Added as a gift'}: ${boxWord(n)} of ${st.stage.toLowerCase()} ${s.variety || s.name}, ${String(s.boxSize).replace('kg', ' kg')}`)
  if (window.gsap && !reduced && !(window.MMFly && MMFly.took)) gsap.fromTo('.bag-count', { scale: 1.5 }, { scale: 1, duration: 0.5, ease: 'elastic.out(1,.5)' })
  return true
}

// ---- The bag page (app.js renderCartPage calls these)

const groupWord = (gift) => (gift ? 'the gift' : 'your order')
function bagBillHead() {
  const g = cart.some((x) => x.gift), s = cart.some((x) => !x.gift)
  return g && s ? 'Bill for your order' : 'Bill details'
}

/** Your own boxes and the gift, as two groups (one group: the bag as it always was, with the gift heading for a gift). */
function bagGroups(row, { wd, stuck }) {
  const g = ofKind(cart, true), s = ofKind(cart, false)
  // Change request 02 (Q5): a box of your own is no longer made a gift here; gifts are sent from the Gifts page (one
  // person, as many boxes as they like). A gift line kept in a bag from before can still be moved back to your own.
  const line = (x) => {
    const i = cart.indexOf(x), name = `${stageOf(x.stage).stage} ${skuOf(x.sku)?.variety || x.sku}`
    if (!x.gift) return row(x, i)
    const move = `<button type="button" class="text-button bag-kind" data-bag-kind="${i}" aria-label="Move the ${esc(name)} to your own order">${icon('user')}<span>This one is for me</span></button>`
    return row(x, i).replace('</div><div class="bag-row-end">', `${move}</div><div class="bag-row-end">`)
  }
  const toGifts = s.length ? `<p class="bag-to-gifts">${icon('gift')}<span>Sending a gift?</span><a href="/gifts" data-route>Gifts ${icon('arrow')}</a></p>` : ''
  const more = `${toGifts}<a class="bag-more" href="/#shop" data-route><span>Forgot something?</span><b>Add more mangoes ${icon('arrow')}</b></a>`
  let h = nextBanner(s, g)
  if (!g.length) return h + s.map(line).join('') + more
  // Before the season the pre-order is said plainly and prominently (the owner, 18 Nov 2026), not in small print.
  const giftHead = `<h2 class="bag-group-head is-gift">${icon('gift')}<span>Gift${giftPre() ? ` <span class="pre-chip bag-pre-chip">${icon('sun')}Pre-order</span>` : ''}<small>Delivered to someone else. You add their name, mobile and address at checkout.</small></span></h2>${giftPre() ? `<div class="bag-pre-notice">${preNoticeHTML(bagGiftWeek() ? preWeekText(bagGiftWeek()) : 'the first open delivery week')}</div>` : ''}`
  if (!s.length) return h + giftHead + g.map(line).join('') + groupFoot(true, g, wd, false) + more
  return h + `<h2 class="bag-group-head">${icon('user')}<span>For you<small>Delivered to you</small></span></h2>` + s.map(line).join('') + groupFoot(false, s, wd, true, stuck) +
    giftHead + g.map(line).join('') + groupFoot(true, g, wd, true) + more
}

/** Under a group: its subtotal and checkout (when there are two groups), the gift's earliest day and the several-people link. */
function groupFoot(gift, lines, wd, both, stuck) {
  const t = totals(lines), pre = preSeason()
  let note = '', off = ''
  if (gift && pre) {
    if (lines.length > 1) note = `<p class="bag-group-note">${icon('info')}<span>Each box is its own pre-order: you pay for them one after the other.</span></p>`
    const big = lines.find((x) => preTooBig(x.qty, x.sku))
    if (big) off = preTooBigWords(big.sku)
  } else if (gift) {
    const gd = wd ? bagDate(lines) : null
    if (wd && !gd) off = 'No single day has every gift box. Lower a quantity to check out.'
    else if (gd && gd !== wd) note = `<p class="bag-group-note">${icon('leaf')}<span>The gift can go from ${esc(fmtDate(gd))}: some of its boxes are only ready then.</span></p>`
  } else if (stuck) off = 'No single day has every box. Lower a quantity to check out.'
  // Before the season your own boxes are one pre-order (pre-bag.js): one payment, each box in its own week.
  if (pre && !gift) note = `<p class="bag-group-note">${icon('sun')}<span>Pre-ordered together: one payment, each box delivered in its own week.</span></p>`
  const id = `bag-co-why-${gift ? 'gift' : 'self'}`
  const btn = both ? `<div class="bag-group-go"><p class="bag-group-sum"><span>Subtotal · ${boxWord(t.count)}</span><strong>${currency(t.price)}</strong></p><button type="button" class="button ${gift ? 'primary' : 'secondary'}" data-bag-checkout="${gift ? 'gift' : 'self'}"${off ? ` disabled aria-describedby="${id}"` : ''}>${off ? icon('lock') : ''}${gift ? 'Checkout the gift' : pre ? 'Pre-order my boxes' : 'Checkout my order'} ${off ? '' : icon('arrow')}</button>${off ? `<p class="pay-bar-why bag-group-why" id="${id}">${icon('info')}<span>${esc(off)}</span></p>` : ''}</div>` : ''
  const several = gift ? `<p class="bag-group-note">${icon('gift')}<span>One bag, one person, one address${both || pre ? '' : ', with its own delivery charge if there is one'}. Sending a gift with several boxes? <a href="/gifts" data-route>Send it from Gifts</a>: one person, as many boxes as you like, one payment</span></p>` : ''
  return `<div class="bag-group-foot${gift ? ' is-gift' : ''}">${note}${btn}${several}</div>`
}

/** After one group is paid: "Your order is placed. Your gift is still in your bag: check it out now." */
function nextBanner(s, g) {
  const n = ssJSON(BAG_NEXT, null)
  if (!n) return ''
  const left = n.done === 'gift' ? s : g
  if (!left.length) { ssDel(BAG_NEXT); return '' }
  if (n.done === 'gift-pre') return `<div class="bag-next" role="status"><span class="bag-next-icon" aria-hidden="true">${icon('check')}</span><div><p><strong>Your gift pre-order ${esc(orderNo(n.number))} is booked.</strong> Another gift box is still in your bag: once that one is paid, pre-order this one.</p><button type="button" class="button primary" data-bag-checkout="gift">Pre-order the next gift ${icon('arrow')}</button></div></div>`
  const gift = n.done !== 'gift'
  return `<div class="bag-next" role="status"><span class="bag-next-icon" aria-hidden="true">${icon('check')}</span><div><p><strong>Your ${n.done === 'gift' ? 'gift order' : 'order'} ${esc(orderNo(n.number))} is placed.</strong> ${gift ? 'Your gift is still in your bag: check it out now.' : 'Your own boxes are still in your bag: check them out now.'}</p><button type="button" class="button primary" data-bag-checkout="${gift ? 'gift' : 'self'}">${gift ? 'Checkout the gift' : 'Checkout my order'} ${icon('arrow')}</button></div></div>`
}

/** The sticky bar's Checkout: which group it checks out, said on the button. */
function bagKindsBar(stuck) {
  const g = cart.some((x) => x.gift), s = cart.some((x) => !x.gift)
  const b = document.querySelector('#pay-bar #checkout')
  if (!g || !b) return
  // Before the season your own boxes check out as the pre-order bag (pre-bag.js), the gift on its own after.
  const self = s
  b.dataset.bagCheckout = self ? 'self' : 'gift'
  b.innerHTML = `${self ? (preSeason() ? 'Pre-order my boxes' : 'Checkout my order') : 'Checkout the gift'} ${icon('arrow')}`
}

// ---- The checkout, one group at a time

function coSplit() {
  const want0 = ssGet(CO_GROUP)
  coUnsplit()
  const g = ofKind(cart, true), s = ofKind(cart, false)
  // Before the season your own boxes check out as the pre-order bag (pre-bag.js) and the gift as gift pre-orders.
  let want = want0 === 'gift' && g.length ? 'gift' : want0 === 'self' && s.length ? 'self' : s.length ? 'self' : g.length ? 'gift' : null
  coGroup = want
  if (!want) return
  ssSet(CO_GROUP, want)
  cart = want === 'gift' ? g : s
  cartAside = want === 'gift' ? s : g
  // The gift's pincode is the recipient's: yours is put back when the checkout is left.
  if (want === 'gift' && !ssGet(WHERE_HELD)) ssSet(WHERE_HELD, JSON.stringify(where))
}

function coUnsplit() {
  if (cartAside.length) { cart = cart.concat(cartAside); cartAside = [] }
  coGroup = null
  const held = ssJSON(WHERE_HELD, null)
  ssDel(WHERE_HELD)
  if (held && held.pincode && held.pincode !== where.pincode) {
    where = held
    save('mm-where', where)
    if (typeof renderWhereChip === 'function') renderWhereChip()
    loadStock()
  }
}

/** A confirmed order: which group it was (so paying it takes out the right lines), and the gift it carries. */
function coMark(c) {
  const map = ssJSON(CO_ORDERS, {})
  map[c.orderId] = coGroup || 'self'
  ssSet(CO_ORDERS, JSON.stringify(map))
  if (coGroup === 'gift' && co.pay) {
    co.pay.gift = { recipientName: coGift.name.trim(), message: coGift.message.trim() }
    rememberGift(c.orderId)
  }
}

/** A paid order leaves the bag: its own group's lines only. */
function paidDrop(p) {
  const g = ssJSON(CO_ORDERS, {})[p.orderId]
  if (g && coGroup && g !== coGroup) cartAside = ofKind(cartAside, g !== 'gift')
  else if (g && !coGroup) cart = ofKind(cart, g !== 'gift')
  else cart = []
  const done = g || coGroup || 'self'
  if (done === 'gift') { coGift = { name: '', phone: '', message: '' }; coGiftErr = {}; ssDel(GIFT_TO) }
  if (ofKind(cart.concat(cartAside), done !== 'gift').length) ssSet(BAG_NEXT, JSON.stringify({ number: p.number, done }))
  else ssDel(BAG_NEXT)
}

/** The success screen: the gift it was, and the other group still waiting in the bag. */
function coDoneHTML(p) {
  let h = ''
  if (p.gift && p.gift.recipientName) h += `<div class="co-gift-done"><span class="pre-chip gift-chip">${icon('gift')}Gift</span><p><strong>Gift for ${esc(p.gift.recipientName)}</strong></p>${p.gift.message ? `<p class="co-gift-msg">“${esc(p.gift.message)}”</p>` : ''}</div>`
  const left = cart.concat(cartAside) // what is still in the bag once this order's lines are out
  if (left.length) {
    const gift = left.some((x) => x.gift)
    h += `<div class="bag-next is-done" role="status"><span class="bag-next-icon" aria-hidden="true">${icon(gift ? 'gift' : 'bag')}</span><div><p><strong>${gift ? 'Your gift is still in your bag: check it out now.' : 'Your own boxes are still in your bag: check them out now.'}</strong> It’s a separate delivery and payment.</p><button type="button" class="button primary" data-bag-checkout="${gift ? 'gift' : 'self'}">${gift ? 'Checkout the gift' : 'Checkout my order'} ${icon('arrow')}</button></div></div>`
  }
  return h
}

// ---- "Who is it for?" (the gift group's delivery step)

const giftErrId = (n) => `co-delivery-${n}-error`
function giftField(name, msg) {
  return msg ? ` aria-invalid="true" aria-describedby="${giftErrId(name)}${name === 'gift-to-msg' ? ' gift-to-count' : name === 'gift-to-phone' ? ' gift-to-phone-hint' : ''}"` : name === 'gift-to-msg' ? ' aria-describedby="gift-to-count"' : name === 'gift-to-phone' ? ' aria-describedby="gift-to-phone-hint"' : ''
}
const giftErrHTML = (name, msg) => (msg ? `<span class="field-error" id="${giftErrId(name)}" aria-hidden="true">${icon('info')}<span>${esc(msg)}</span></span>` : '')
const msgCount = () => `${coGift.message.length} / ${GIFT_MSG_MAX}${coGift.message.length >= GIFT_MSG_MAX ? ' · that’s the most a message can hold' : ''}`

function coWhoHTML() {
  if (coGroup !== 'gift') return ''
  const e = coGiftErr
  return `<section class="co-sec co-who" aria-labelledby="co-who-h"><h2 id="co-who-h">${icon('gift')}<span>Who is it for?</span></h2><p class="co-who-lead">This order goes to them, with your message. You pay for it here${cartAside.length ? ', and your own boxes check out separately' : ''}.</p><div class="form-grid">` +
    `<label class="field">Recipient’s name<input name="gift-to-name" maxlength="80" autocomplete="off" required value="${esc(coGift.name)}"${giftField('gift-to-name', e.name)}>${giftErrHTML('gift-to-name', e.name)}</label>` +
    `<label class="field">Recipient’s mobile<input name="gift-to-phone" type="tel" inputmode="tel" autocomplete="off" maxlength="16" placeholder="10-digit mobile number" required value="${esc(coGift.phone)}"${giftField('gift-to-phone', e.phone)}><small class="field-hint" id="gift-to-phone-hint">Our rider calls this number on the day.</small>${giftErrHTML('gift-to-phone', e.phone)}</label>` +
    `<label class="field wide">Gift message <small>(optional)</small><textarea name="gift-to-msg" rows="2" maxlength="${GIFT_MSG_MAX}" placeholder="Happy summer! Enjoy the mangoes."${giftField('gift-to-msg', e.message)}>${esc(coGift.message)}</textarea><small class="gift-count" id="gift-to-count">${msgCount()}</small>${giftErrHTML('gift-to-msg', e.message)}</label>` +
    `</div></section>`
}
const coGiftPinNote = () => (coGroup === 'gift' ? `<p class="co-gift-pin">${icon('info')}<span>This must be the <strong>recipient’s</strong> pincode, where the gift goes. If they live somewhere else, tap Change.</span></p>` : '')
const giftSumText = () => (coGift.name.trim() ? `Gift for <strong>${esc(coGift.name.trim())}</strong>` : 'A gift: add who it is for above')
const coGiftSum = () => (coGroup === 'gift' ? `<p class="co-gift-sum">${icon('gift')}<span>${giftSumText()}</span></p>` : '')

function giftWhy(k, v) {
  v = String(v || '').trim()
  if (k === 'name') return !v ? 'Enter the recipient’s name' : v.length > 80 ? 'Keep the name to 80 characters' : ''
  if (k === 'phone') return !v ? 'Enter the recipient’s mobile number' : /^[6-9]\d{9}$/.test(normPhone(v)) ? '' : 'Enter a 10-digit Indian mobile number'
  if (k === 'message') return v.length > GIFT_MSG_MAX ? `Keep the message to ${GIFT_MSG_MAX} characters` : ''
  return ''
}
const GIFT_INPUT = { 'gift-to-name': 'name', 'gift-to-phone': 'phone', 'gift-to-msg': 'message' }
let liveEl = null
function announce(text) {
  if (!liveEl) { liveEl = document.createElement('p'); liveEl.className = 'sr-only'; liveEl.setAttribute('aria-live', 'assertive'); document.body.appendChild(liveEl) }
  liveEl.textContent = ''
  setTimeout(() => { liveEl.textContent = text }, 60)
}
function focusGiftError() {
  setTimeout(() => {
    const k = ['name', 'phone', 'message'].find((x) => coGiftErr[x])
    const el = k && host()?.querySelector(`[name="${Object.keys(GIFT_INPUT).find((n) => GIFT_INPUT[n] === k)}"]`)
    if (el) { el.focus(); announce(`Check who the gift is for: ${coGiftErr[k]}.`) }
  }, 0)
}

/** Before paying for the gift: its fields, with the errors beside them (kept until fixed). */
function coGiftCheck() {
  if (coGroup !== 'gift') return true
  coGiftErr = {}
  for (const k of ['name', 'phone', 'message']) { const m = giftWhy(k, coGift[k]); if (m) coGiftErr[k] = m }
  if (!Object.keys(coGiftErr).length) return true
  co.error = ''
  renderCo()
  focusGiftError()
  return false
}
function coGiftBody() {
  if (coGroup !== 'gift') return {}
  const m = coGift.message.trim()
  return { gift: { recipientName: coGift.name.trim(), recipientPhone: normPhone(coGift.phone), ...(m ? { message: m } : {}) } }
}
/** The API's own check of these fields ("gift.recipientPhone: …"), in plain words beside the field. */
function coGiftApiErr(e) {
  if (coGroup !== 'gift') return false
  const m = String(e && e.message || '').match(/^gift\.(recipientName|recipientPhone|message)\b/)
  if (!m) return false
  const k = { recipientName: 'name', recipientPhone: 'phone', message: 'message' }[m[1]]
  coGiftErr = { ...coGiftErr, [k]: k === 'name' ? 'Enter the recipient’s name (up to 80 characters)' : k === 'phone' ? 'Enter a 10-digit Indian mobile number' : `Keep the message to ${GIFT_MSG_MAX} characters` }
  co.error = ''
  focusGiftError()
  return true
}
const saveGiftTo = () => ssSet(GIFT_TO, JSON.stringify(coGift))

// ---- Orders: the Gift tag and the gift on an order

function giftIds() { try { const a = JSON.parse(localStorage.getItem(GIFT_ORDERS)); return Array.isArray(a) ? a : [] } catch { return [] } }
function rememberGift(id) { const a = giftIds(); if (!a.includes(id)) { a.unshift(id); try { localStorage.setItem(GIFT_ORDERS, JSON.stringify(a.slice(0, 200))) } catch {} } }
const bagGiftTag = (o) => {
  if (o.giftOrderId || !(o.gift || o.giftRecipient || giftIds().includes(o.id))) return ''
  const who = (o.gift && o.gift.recipientName) || o.giftRecipient || ''
  return `<span class="pre-chip order-pre-chip gift-chip">${icon('gift')}Gift${who ? ` for ${esc(who)}` : ''}</span>`
}
/** "Gift for Asha", the mobile and the message, on the order page (pages.js trackView) and the order sheet (app.js orderView). */
function giftFor(o) {
  const g = o && o.gift
  if (!g || !g.recipientName) return ''
  rememberGift(o.id)
  return `<div class="order-gift"><span class="pre-chip gift-chip">${icon('gift')}Gift</span><p class="order-gift-for"><strong>Gift for ${esc(g.recipientName)}</strong>${g.recipientPhone ? ` · ${esc(g.recipientPhone)}` : ''}</p>${g.message ? `<p class="order-gift-msg">“${esc(g.message)}”</p>` : ''}</div>`
}

// ---- Before the season: the gift as a pre-order (POST /v1/preorders with `gift`, mango-api preorders.js). A booking is
// one box line, so a gift bag with two different boxes is two gift pre-orders, booked and paid one after the other (the
// API holds one unpaid pre-order at a time). Each is paid in full, non-refundable once paid, delivered in its week (the
// API's: the earliest week with room, every box sharing one weekly limit; when earlier weeks are full it says so before
// paying, and the API refuses the booking if the week changed since), and converted
// into a delivery order carrying the recipient. The booked line leaves the bag: it is a pre-order of its own, paid on
// its own page (the shop's pre-order sheet, app.js preorderView), and listed in Your orders with the Pre-order and Gift tags.
let gp = { agree: false, unpaid: null, done: null }
const gpLine = () => ofKind(cart, true)[0] || null
/** The bag's gift boxes' earliest week: each box's own variety's week (migration 078), else the shop's first week. */
function bagGiftWeek() {
  const ws = ofKind(cart, true).map((x) => (gpWeek(x).week || {}).weekStart).filter(Boolean).map(String).sort()
  return ws[0] || firstPreWeek()
}
function gpWeek(x) {
  const all = pre.weeks.filter((w) => w.sku === x.sku).sort((a, b) => String(a.weekStart).localeCompare(String(b.weekStart)))
  // The API's weeks (deliveryWeeks): the earliest with room for this booking's whole kg. An older API: per box.
  const days = pre.days.length && pre.countsBy !== 'boxes' ? preDaysOf(x.sku) : all
  return { first: days[0] || null, week: days.find((w) => w.remaining >= preNeed(x.qty, x.sku)) || null, big: preTooBig(x.qty, x.sku) }
}
async function enterGiftPre() {
  co.step = 'gift-pre'
  co.loading = true
  gp = { agree: false, unpaid: null, done: null }
  renderCo()
  try { await loadWeeks() } catch (e) { co.error = e.message }
  co.loading = false
  if (!gpLine()) co.step = 'empty'
  renderCo()
}
function giftPreHTML(dis) {
  if (co.step === 'gift-pre-done' && gp.done) {
    const r = gp.done, more = ofKind(cart, true).length
    return `<div class="success">${icon('check')}<span class="pre-chip">${icon('sun')}Pre-order</span><span class="pre-chip gift-chip">${icon('gift')}Gift</span><h2>Gift pre-order <span class="no-wrap">${esc(orderNo(r.number))}</span> is booked.</h2><p>For <strong>${esc(r.gift ? r.gift.recipientName : coGift.name)}</strong> · delivers in ${esc(weekPhrase(r.weekStart))}.${r.status === 'PAYMENT_PENDING' ? ' Pay for it to confirm it.' : ''}</p><button type="button" class="button primary" data-pre="view" data-id="${esc(r.id)}">${r.status === 'PAYMENT_PENDING' ? `Pay ${currency(r.total)}` : 'View the pre-order'} ${icon('arrow')}</button>${more ? `<div class="bag-next is-done" role="status"><span class="bag-next-icon" aria-hidden="true">${icon('gift')}</span><div><p><strong>Another gift box is still in your bag.</strong> Pay for this one first, then book the next.</p><button type="button" class="button secondary" data-bag-checkout="gift">Pre-order the next gift ${icon('arrow')}</button></div></div>` : ''}<a class="text-button" href="/cart" data-route style="margin:15px auto 0">Back to your bag</a></div>`
  }
  const x = gpLine()
  if (!x) return ''
  if (co.loading && !pre.weeks.length) return '<p class="form-footer">Checking the delivery weeks…</p>'
  const s = skuOf(x.sku), st = stageOf(x.stage), { first, week, big } = gpWeek(x), w = week || first
  const price = (w && w.price) || (s && s.price) || 0, many = ofKind(cart, true).length
  const moved = week && first && week.weekStart !== first.weekStart
  const when = w && !big ? `<div class="pre-when" role="note">${icon('calendar')}<p><strong>This is a pre-order.</strong> ${moved ? `${esc(preFullLine(first.weekStart, w.weekStart))} Your order` : 'It'} will be delivered in <strong>${esc(weekPhrase(w.weekStart))}</strong> <span class="no-wrap">(week of ${esc(fmtWeek(w.weekStart))})</span>.</p></div>` : ''
  const warn = `<div class="pre-warn" role="note">${icon('info')}<p><strong>Paid in full now. It can’t be cancelled once you pay, unless we delay it.</strong> If we can’t deliver, we refund you in full.${policyLink()}</p></div>${harvestNote()}<label class="pre-agree"><input type="checkbox" name="gift-pre-agree" ${gp.agree ? 'checked' : ''} required><span>I understand this pre-order can only be cancelled if it is delayed.</span></label>`
  const unpaid = gp.unpaid ? `<p class="prototype-tag">You already have an unpaid pre-order ${esc(orderNo(gp.unpaid.number))}. Pay for it or cancel it first.</p><button type="button" class="button primary full" data-pre="view" data-id="${esc(gp.unpaid.preorderId)}">Pay for it ${icon('arrow')}</button><button type="button" class="text-button" data-gp="unpaid-cancel" style="margin:15px auto 0" ${dis}>Cancel it and continue</button>` : ''
  const off = !gp.agree ? 'Tick the box above to continue' : ''
  const go = big ? `<p class="pre-why is-block" id="gp-big-why">${icon('info')}<span>${esc(preTooBigWords(x.sku))}</span></p><button class="button primary full" type="button" disabled aria-describedby="gp-big-why">${icon('lock')} Choose fewer boxes</button>`
    : !w ? `<p class="pre-why is-block">${icon('info')}<span>No delivery week is open yet. Check back soon.</span></p>`
    : `<button class="button primary full pre-go" type="submit" ${dis}${off ? ` disabled aria-describedby="gp-why"` : ''}>${icon(week ? 'sun' : 'clock')} ${co.busy ? 'Booking…' : week ? `Pre-order · pay ${currency(price * x.qty)}` : 'Join the waitlist'}</button>${off ? `<p class="pre-why" id="gp-why">${icon('info')}<span>${off}</span></p>` : ''}${week ? '' : '<p class="pre-note">Every delivery week is fully booked. Nothing is charged now: if a spot opens we send a payment link.</p>'}`
  return `<form id="co-giftpre" novalidate>
    <section class="co-sec"><h2>Your gift pre-order${many > 1 ? ` <small class="gp-of">box 1 of ${many}</small>` : ''}</h2><div class="pre-pick">${thumb(x.sku, x.stage)}<div class="pre-pick-copy"><h3>${esc(s ? s.variety || s.name : x.sku)}</h3><small>${esc(s ? String(s.boxSize).replace('kg', ' kg') : '')} box · ${st.stage} · ${boxWord(x.qty)}</small></div><strong class="pre-pick-price">${currency(price * x.qty)}</strong></div>${many > 1 ? `<p class="bag-group-note">${icon('info')}<span>Each gift box is its own pre-order: you book and pay for them one after the other.</span></p>` : ''}${when}</section>
    ${coWhoHTML()}
    <section class="co-sec"><h2>Recipient’s address</h2><p class="co-where">${icon('pin')}<span>To <strong>${esc(placeLabel())}</strong></span><button type="button" class="bag-change" data-co="pincode" aria-label="Change the recipient’s pincode" ${dis}>Change</button></p>${coGiftPinNote()}<div class="form-grid"><label class="field wide">Flat, building, street and landmark<textarea name="co-address" rows="3" maxlength="500" required autocomplete="off" placeholder="Flat, building, street, landmark">${esc(co.draft.address || '')}</textarea></label></div></section>
    ${errorBox()}${unpaid || (big ? go : `${warn}${go}`)}
  </form>`
}
async function giftPreBook() {
  if (co.busy || co.loading) return
  keepDraft()
  if (!coGiftCheck()) return
  const address = String(co.draft.address || '').trim()
  if (address.length < 10) { co.error = 'Enter the recipient’s full address (at least 10 characters).'; renderCo(); host()?.querySelector('[name="co-address"]')?.focus(); return }
  if (!gp.agree) { co.error = 'Tick the box to confirm you understand this pre-order is non-refundable.'; renderCo(); return }
  const x = gpLine(), { first, week, big } = gpWeek(x), w = week || first
  if (!w || big) return
  co.busy = true; co.error = ''; renderCo()
  let r
  try {
    const body = { sku: x.sku, stage: x.stage, qty: x.qty, weekStart: w.weekStart, pincode: where.pincode, address, ...coGiftBody(), waitlist: !week }
    r = await MM.bookPreorder(body, MM.keyFor(gp, body))
  } catch (e) {
    co.busy = false
    if (e.status === 401) { co.step = 'phone'; co.error = 'Please sign in again.' }
    else if (coGiftApiErr(e)) {}
    else if (e.code === 'UNPAID_PREORDER_EXISTS') gp.unpaid = e.extra || null
    else if (e.code === 'PREORDER_TOO_BIG') { await loadWeeks().catch(() => {}); co.error = preError(e) }
    else if (e.code === 'PREORDER_FULL' || e.code === 'PREORDER_WEEK_CHANGED' || e.code === 'INVALID_WEEK') { await loadWeeks().catch(() => {}); co.error = `${e.code === 'PREORDER_WEEK_CHANGED' ? 'An earlier week has room again' : `${capFirst(weekPhrase(w.weekStart))} just filled up`}. The week below is the one your gift gets now: check it and pay again. Nothing was charged.` }
    else co.error = preError(e) || e.message
    renderCo()
    return
  }
  co.busy = false
  rememberGift(r.id)
  // The line is a pre-order of its own now: it leaves the bag, and the next gift box (if any) waits there.
  cart = cart.filter((y) => y !== x)
  updateCart()
  if (ofKind(cart, true).length) ssSet(BAG_NEXT, JSON.stringify({ number: r.number, done: 'gift-pre' }))
  else ssDel(BAG_NEXT)
  gp = { agree: false, unpaid: null, done: r }
  co.step = 'gift-pre-done'
  renderCo()
  if (realUrl(r.paymentUrl)) window.location.assign(r.paymentUrl)
  else preorderView(r.id)
}
document.addEventListener('submit', (e) => { if (e.target.id === 'co-giftpre') { e.preventDefault(); giftPreBook() } })
// The pre-order sheet (app.js preorderView) closed over the booked gift: the page draws again (it had pointed `view` at
// the sheet), with the booking as it is now (paid or not).
document.getElementById('form-dialog')?.addEventListener('close', () => {
  if (document.body.dataset.page !== 'checkout' || co.step !== 'gift-pre-done' || !gp.done) return
  view = '#page-body'
  MM.preorder(gp.done.id).then((p) => { gp.done = p; renderCo() }, () => renderCo())
})
document.addEventListener('change', (e) => {
  if (e.target.name !== 'gift-pre-agree') return
  gp.agree = e.target.checked
  if (gp.agree && co.error.startsWith('Tick the box')) co.error = ''
  const go = host()?.querySelector('#co-giftpre .pre-go'), why = host()?.querySelector('#gp-why')
  if (go) { go.disabled = !gp.agree; if (gp.agree) go.removeAttribute('aria-describedby'); else go.setAttribute('aria-describedby', 'gp-why') }
  if (why) why.hidden = gp.agree
})
document.addEventListener('click', async (e) => {
  const b = e.target instanceof Element ? e.target.closest('[data-gp]') : null
  if (!b || b.dataset.gp !== 'unpaid-cancel' || !gp.unpaid) return
  b.disabled = true
  try { await MM.cancelPreorder(gp.unpaid.preorderId); toast(`Pre-order ${orderNo(gp.unpaid.number)} cancelled`); gp.unpaid = null; renderCo(); giftPreBook() } catch (err) { co.error = err.message; renderCo() }
})

// ---- Events

document.addEventListener('click', (e) => {
  const b = e.target instanceof Element ? e.target.closest('button') : null
  if (!b) return
  if (b.dataset.bagCheckout) {
    if (b.disabled) return
    ssSet(CO_GROUP, b.dataset.bagCheckout)
    if (b.id !== 'checkout') { closeDialogs(); go('/checkout') } // the bar's own #checkout is opened by app.js
    return
  }
  if (b.dataset.bagKind != null) {
    const x = cart[Number(b.dataset.bagKind)]
    if (!x) return
    const gift = !x.gift, other = cart.find((y) => y !== x && y.sku === x.sku && y.stage === x.stage && !!y.gift === gift)
    let moved = x
    if (other) {
      if (other.qty + x.qty > 20) { toast('That would be more than 20 boxes in one line. Lower the quantity first.'); return }
      other.qty += x.qty
      cart.splice(cart.indexOf(x), 1)
      moved = other
    } else if (gift) x.gift = true
    else delete x.gift
    updateCart()
    toast(gift ? 'Moved to the gift. It checks out on its own, to their address.' : 'Moved to your own order.')
    host()?.querySelector(`[data-bag-kind="${cart.indexOf(moved)}"]`)?.focus()
  }
})

document.addEventListener('input', (e) => {
  const t = e.target, k = t && GIFT_INPUT[t.name]
  if (!k || coGroup !== 'gift') return
  coGift[k] = k === 'message' ? t.value.slice(0, GIFT_MSG_MAX) : t.value
  saveGiftTo()
  if (coGiftErr[k] && !giftWhy(k, coGift[k])) { delete coGiftErr[k]; fieldError(t, '') }
  if (k === 'message') { const c = document.getElementById('gift-to-count'); if (c) c.textContent = msgCount() }
  if (k === 'name') { const s = host()?.querySelector('.co-gift-sum span'); if (s) s.innerHTML = giftSumText() }
})
// A field's error shows once it has been left with something in it (and stays until it is fixed).
document.addEventListener('focusout', (e) => {
  const t = e.target, k = t && GIFT_INPUT[t.name]
  if (!k || coGroup !== 'gift') return
  if (!String(t.value || '').trim() && !coGiftErr[k]) return
  const m = giftWhy(k, t.value)
  if (m) coGiftErr[k] = m
  else delete coGiftErr[k]
  fieldError(t, m)
  if (t.name === 'gift-to-phone' || t.name === 'gift-to-msg') {
    const extra = t.name === 'gift-to-phone' ? 'gift-to-phone-hint' : 'gift-to-count', by = new Set((t.getAttribute('aria-describedby') || '').split(' ').filter(Boolean))
    by.add(extra)
    t.setAttribute('aria-describedby', [...by].join(' '))
  }
})

// Leaving the checkout puts the bag back together (and your own pincode back, after a gift's).
window.addEventListener('mm:route', (e) => {
  const path = (e.detail && e.detail.path) || location.pathname
  if (/^\/checkout\/?$/.test(path)) return
  coUnsplit()
  ssDel(CO_GROUP)
})
