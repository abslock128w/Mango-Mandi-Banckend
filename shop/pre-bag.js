/* The pre-order bag (mango-api POST /v1/preorders/quote and /v1/preorders/confirm, migration 089). Before the season the
   pre-order panel (app.js renderPreorder) has "Add to bag" beside "Pre-order · pay": your own boxes (bag lines without
   `gift`) then wait in the one bag, and check out together as ONE pre-order and ONE payment. Each line is its own booking
   and keeps its own delivery week, the earliest with room for its kg in its variety, counting the lines above it: the
   bag page and the checkout show that week on every line (the API's quote), the checkout sends those weeks back, and the
   API refuses the whole bag (nothing booked, nothing charged) if one changed since, so the customer sees the new weeks
   and pays again. Paid pre-orders are non-refundable unless we delay them: the checkout says so and waits for the tick.
   The single-box "Pre-order · pay" stays as the shortcut. Gift boxes (gift-bag.js) are unchanged: they check out on their own.
   Loaded after gift-bag.js and before app.js: top-level code only declares and listens (app.js's functions are used at call time).
   The first three functions and preGiftSum are pure (tests/unit/pre-bag.unit.ts). */

/** Your own (not gift) bag lines as the API takes them: one line per box and ripeness, in bag order, at most 20 boxes a line. */
function preBagLines(lines) {
  const out = []
  for (const x of lines || []) {
    if (!x || x.gift || typeof x.sku !== 'string' || !x.stage) continue
    const q = Math.floor(Number(x.qty)) || 0
    if (q < 1) continue
    const m = out.find((y) => y.sku === x.sku && y.stage === x.stage)
    if (m) m.qty = Math.min(20, m.qty + q)
    else out.push({ sku: x.sku, stage: x.stage, qty: Math.min(20, q) })
  }
  return out
}

/** Whether a quote is for exactly these lines (same boxes, ripeness and quantities, in the same order). */
function preBagSame(lines, q) {
  return !!q && Array.isArray(q.lines) && q.lines.length === lines.length && lines.every((l, i) => q.lines[i].sku === l.sku && q.lines[i].stage === l.stage && q.lines[i].qty === l.qty)
}

/** Pre-orders as the orders list shows them (GET /v1/preorders keeps a group's lines together): each bag as one row with
 * its lines ({ bag, lines }), each gift for ONE person (change request 02: `oneDelivery`, or a gift group for one person) as
 * one row with its boxes ({ bag: null, gift, lines }), every other pre-order alone ({ bag: null, lines: [p] }; a gift for
 * several people booked before CR2 stays one row per person), in the API's order. */
function preBagRows(list) {
  const rows = [], at = new Map()
  for (const p of list || []) {
    const k = p && p.group, bag = k && k.kind === 'BAG' ? k : null
    const gift = k && k.kind === 'GIFT' && k.id && (k.oneDelivery || Number(k.people) === 1) ? k : null
    if (!bag && !gift) { rows.push({ bag: null, lines: [p] }); continue }
    if (!at.has(k.id)) { at.set(k.id, rows.length); rows.push(bag ? { bag, lines: [] } : { bag: null, gift, lines: [] }) }
    rows[at.get(k.id)].lines.push(p)
  }
  return rows
}

/** A gift for one person, summed for its row: boxes and kg (cancelled boxes left out, unless all are), the ONE week it
 * arrives in (the latest), the status the row shows, and when it was booked (for newest first). `kgOf(p)` is a line's box kg. */
function preGiftSum(lines, kgOf) {
  const all = lines || [], live = all.filter((p) => p.status !== 'CANCELLED'), use = live.length ? live : all
  const boxes = use.reduce((n, p) => n + (Number(p.qty) || 0), 0)
  const kg = use.reduce((n, p) => n + (Number(p.qty) || 0) * (Number(kgOf(p)) || 0), 0)
  const week = use.map((p) => p.weekStart).filter(Boolean).sort().pop() || null
  const status = !live.length ? 'CANCELLED' : live.some((p) => p.status === 'PAYMENT_PENDING') ? 'PAYMENT_PENDING' : live.some((p) => p.status === 'WAITLISTED') ? 'WAITLISTED' : live.every((p) => p.status === 'CONVERTED') ? 'CONVERTED' : 'BOOKED'
  const at = all.map((p) => String(p.createdAt || p.bookedAt || '')).filter(Boolean).sort()[0] || ''
  return { boxes, kg: Math.round(kg * 10) / 10, week, status, at }
}

// ---- State: the last quote (for the bag page and the checkout), the tick, an unpaid pre-order in the way, the booked bag.
let pb = { quote: null, asking: '', agree: false, unpaid: null, key: null, keyFor: '', done: null }
const pbSig = (lines) => JSON.stringify(lines)
const ownLines = () => preBagLines(cart.concat(cartAside))

/** The week a quoted line gets, in words for a chip or a summary row. */
function pbWeekWords(l) {
  if (!l) return ''
  if (l.tooBig) return preTooBigWords(l.sku)
  if (!l.weekStart) return 'Every delivery week is fully booked for this box'
  return `Delivers in ${weekPhrase(l.weekStart)} (week of ${fmtWeek(l.weekStart)})`
}
const pbLineOf = (x) => pb.quote && (pb.quote.lines || []).find((l) => l.sku === x.sku && l.stage === x.stage)

/** Asks the API for the weeks of the bag's own lines, once per bag; `then` runs when the answer is for the bag as it is now. */
async function preBagQuote(then) {
  const lines = ownLines(), sig = pbSig(lines)
  if (!lines.length) { pb.quote = null; return }
  if (preBagSame(lines, pb.quote) || pb.asking === sig) { if (pb.quote) then && then(); return }
  pb.asking = sig
  try {
    const q = await MM.preorderQuote(lines)
    if (pbSig(ownLines()) === sig) { pb.quote = q; then && then() }
  } catch {} finally { if (pb.asking === sig) pb.asking = '' }
}

// ---- Adding from the pre-order panel ("Add to bag")

function preAddToBag() {
  const sku = pre.sku, stage = pre.stage, n = pre.qty
  if (!sku) return
  const box = skuOf(sku) || pre.weeks.find((w) => w.sku === sku) || {}
  const match = cart.concat(cartAside).find((x) => !x.gift && x.sku === sku && x.stage === stage)
  const have = match ? match.qty : 0
  if (have + n > 20) { toast(have ? `20 boxes is the most per line, and ${boxWord(have)} of these are already in your bag. For more, place a bulk order.` : 'For larger quantities, place a bulk order.'); return }
  if (preTooBig(have + n, sku)) { toast(preTooBigWords(sku)); return }
  if (match) match.qty += n
  else cart.push({ sku, stage, qty: n, weight: kgOf(box) })
  pb.quote = null
  updateCart()
  toast(`Added to your bag: ${boxWord(n)} of ${stageOf(stage).stage.toLowerCase()} ${box.variety || box.name || sku}. Pre-order them together at checkout.`)
  if (window.gsap && typeof reduced !== 'undefined' && !reduced) gsap.fromTo('.bag-count', { scale: 1.5 }, { scale: 1, duration: 0.5, ease: 'elastic.out(1,.5)' })
}

/** The bag page's "+" before the season: no day's stock applies, only the week's kg (and 20 boxes a line). */
function preBagBump(x, d) {
  return preTooBig(x.qty + d, x.sku) ? preTooBigWords(x.sku) : ''
}

// ---- The bag page before the season (app.js renderCartPage calls this after drawing): each own line's week, and a
// pre-order bill (no delivery charge: a pre-order is the boxes' price).

function preBagDecorate() {
  const h = host()
  if (!h || document.body.dataset.page !== 'cart') return
  const paint = () => {
    cart.forEach((x, i) => {
      if (x.gift) return
      const row = h.querySelector(`[data-qty="${i}"]`)?.closest('.bag-row'), copy = row && row.querySelector('.bag-row-copy')
      if (!copy) return
      copy.querySelector('.pb-week')?.remove()
      const l = pbLineOf(x)
      if (l) copy.querySelector('small')?.insertAdjacentHTML('afterend', `<span class="bag-ready pb-week${l.weekStart ? '' : ' is-sourcing'}">${icon(l.weekStart ? 'calendar' : 'info')}${esc(pbWeekWords(l))}</span>`)
    })
    const bill = h.querySelector('.bag-bill')
    if (bill && !cart.some((x) => x.gift)) {
      const t = totals(cart.filter((x) => !x.gift)), q = preBagSame(ownLines(), pb.quote) ? pb.quote : null
      const amount = document.querySelector('#pay-bar .pay-bar-total strong')
      if (amount && q) amount.textContent = currency(q.total)
      bill.innerHTML = `<h2>Pre-order bill</h2><div class="bill-row"><span>Subtotal <small>(${boxWord(t.count)} · ${t.kg} kg)</small></span><span>${currency(q ? q.total : t.price)}</span></div><div class="bill-row"><span>Delivery</span><span>Included</span></div><div class="bill-row is-total"><span>Total</span><strong>${currency(q ? q.total : t.price)}</strong></div><p class="cart-disclaimer">Prices include GST. One payment for every box; each box is delivered in its own week, shown above.</p>`
    }
  }
  paint()
  preBagQuote(paint)
}

// ---- The checkout: the pre-order bag's own step (app.js checkout() before the season, then renderCo draws preBagHTML)

async function enterPreBag() {
  co.step = 'pre-bag'
  co.loading = true
  pb.agree = false
  pb.unpaid = null
  renderCo()
  try { await loadWeeks() } catch {}
  try { pb.quote = await MM.preorderQuote(ownLines()) } catch (e) { co.error = e.message }
  co.loading = false
  if (!ownLines().length) co.step = 'empty'
  renderCo()
}

function preBagHTML(dis) {
  if (co.step === 'pre-bag-done' && pb.done) {
    const g = pb.done, paid = g.status === 'PAID'
    return `<div class="success">${icon(paid ? 'check' : 'clock')}<span class="pre-chip">${icon('sun')}Pre-order</span><h2>Pre-order <span class="no-wrap">${esc(orderNo(g.number))}</span> is ${paid ? 'paid' : 'booked'}.</h2><p>${g.preorders.length} ${g.preorders.length === 1 ? 'box line' : 'box lines'}, one payment of <strong>${currency(g.total)}</strong>.${paid ? '' : ' Pay for it to confirm it.'}</p>${pbSummary(g.preorders.map((p) => ({ sku: p.sku, stage: p.stage, qty: p.qty, name: p.productName, linePrice: p.total, weekStart: p.weekStart })))}${!paid && g.leadId ? `<button type="button" class="button primary" data-pre="view" data-id="${esc(g.leadId)}">Pay ${currency(g.total)} ${icon('arrow')}</button>` : ''}<button class="text-button" data-orders style="margin:15px auto 0">All orders</button></div>`
  }
  const lines = ownLines(), q = preBagSame(lines, pb.quote) ? pb.quote : null
  if (co.loading && !q) return '<p class="form-footer">Checking the delivery weeks…</p>'
  if (!q) return `${errorBox()}<button type="button" class="button primary full" data-pb="requote" ${dis}>Try again ${icon('arrow')}</button>`
  const weeks = new Set(q.lines.map((l) => l.weekStart).filter(Boolean))
  const stuck = q.lines.find((l) => !l.weekStart)
  const warn = `<div class="pre-warn" role="note">${icon('info')}<p><strong>Paid in full now. A pre-order can’t be cancelled once you pay, unless we delay it.</strong> If we can’t deliver, we refund you in full.</p></div>${harvestNote()}<label class="pre-agree"><input type="checkbox" name="pre-bag-agree" ${pb.agree ? 'checked' : ''} required><span>I understand these pre-orders can only be cancelled if they are delayed.</span></label>`
  const unpaid = pb.unpaid ? `<p class="prototype-tag">You already have an unpaid pre-order ${esc(orderNo(pb.unpaid.number))}. Pay for it or cancel it first.</p><button type="button" class="button primary full" data-pre="view" data-id="${esc(pb.unpaid.preorderId)}">Pay for it ${icon('arrow')}</button><button type="button" class="text-button" data-pb="unpaid-cancel" style="margin:15px auto 0" ${dis}>Cancel it and continue</button>` : ''
  const off = stuck ? 'Remove or change the box that no week can take, in your bag.' : !pb.agree ? 'Tick the box above to continue' : ''
  const go = `<button class="button primary full pre-go" type="submit" ${dis}${off ? ' disabled aria-describedby="pb-why"' : ''}>${icon('sun')} ${co.busy ? 'Booking…' : `Pre-order · pay ${currency(q.total)}`}</button>${off ? `<p class="pre-why" id="pb-why">${icon('info')}<span>${esc(off)}</span></p>` : ''}`
  return `<form id="co-prebag" novalidate>
    <section class="co-sec co-summary"><h2>Your pre-order</h2>${pbSummary(q.lines)}<div class="bill-row is-total"><span>Total <small>(${boxWord(q.boxes)} · one payment)</small></span><strong>${currency(q.total)}</strong></div>${weeks.size > 1 ? `<p class="bag-group-note">${icon('calendar')}<span>Your boxes come in ${weeks.size} different weeks: each is delivered in the week shown.</span></p>` : ''}</section>
    <section class="co-sec"><h2>Address</h2><p class="co-where">${icon('pin')}<span>To <strong>${esc(placeLabel())}</strong></span><button type="button" class="bag-change" data-co="pincode" ${dis}>Change</button></p><div class="form-grid"><label class="field wide">Flat, building, street and landmark<textarea name="co-address" rows="3" maxlength="500" required autocomplete="street-address" placeholder="Flat, building, street, landmark">${esc(co.draft.address || '')}</textarea></label><label class="field wide">Name (optional)<input name="co-name" maxlength="80" autocomplete="name" value="${esc(co.draft.name || '')}"></label></div></section>
    ${errorBox()}${unpaid || `${warn}${go}`}
  </form>`
}

/** The lines with their prices and weeks (the checkout's summary, and the booked bag). */
function pbSummary(lines) {
  return lines.map((l) => {
    const st = stageOf(l.stage)
    return `<div class="sum-row">${thumb(l.sku, l.stage, l.name)}<div><strong>${esc(boxName(l.name || skuName(l.sku), l.sku))}</strong><small>${st.stage} · ${boxWord(l.qty)}</small><small class="co-sourcing">${icon(l.weekStart ? 'calendar' : 'info')}${esc(pbWeekWords(l))}</small></div><span>${currency(l.linePrice)}</span></div>`
  }).join('')
}

async function preBagPay() {
  if (co.busy || co.loading) return
  keepDraft()
  const address = String(co.draft.address || '').trim(), name = String(co.draft.name || '').trim()
  const lines = ownLines(), q = preBagSame(lines, pb.quote) ? pb.quote : null
  if (!q || q.lines.some((l) => !l.weekStart)) return
  if (address.length < 10) { co.error = 'Enter your full delivery address (at least 10 characters).'; renderCo(); host()?.querySelector('[name="co-address"]')?.focus(); return }
  if (!pb.agree) { co.error = 'Tick the box to confirm you understand these pre-orders are non-refundable.'; renderCo(); return }
  const body = { lines: q.lines.map((l) => ({ sku: l.sku, stage: l.stage, qty: l.qty, weekStart: l.weekStart })), pincode: where.pincode, address, ...(name ? { name } : {}), nonRefundable: true }
  // The same bag sent again (a retry after a dropped answer) keeps its Idempotency-Key, so it is not booked twice.
  const sig = pbSig(body)
  if (!pb.key || pb.keyFor !== sig) { pb.key = MM.idem()['Idempotency-Key']; pb.keyFor = sig }
  co.busy = true; co.error = ''; renderCo()
  let g
  try {
    g = await MM.confirmPreorders(body, pb.key)
  } catch (e) {
    co.busy = false
    if (e.status === 401) { co.step = 'phone'; co.error = 'Please sign in again.' }
    else if (e.code === 'UNPAID_PREORDER_EXISTS') pb.unpaid = e.extra || null
    else if (['PREORDER_FULL', 'PREORDER_WEEK_CHANGED', 'PREORDER_TOO_BIG', 'INVALID_WEEK'].includes(e.code)) {
      pb.quote = null
      pb.key = null
      try { pb.quote = await MM.preorderQuote(ownLines()) } catch {}
      co.error = `${e.message} The weeks below are the ones your boxes get now: check them and pay again. Nothing was charged.`
    } else if (e.code === 'NOT_SERVICEABLE') { where.serviceable = false; save('mm-where', where); co.error = e.message }
    else co.error = preError(e) || e.message
    renderCo()
    return
  }
  co.busy = false
  pb = { ...pb, done: g, key: null, keyFor: '', unpaid: null, agree: false }
  // The booked boxes leave the bag (they are pre-orders now); any gift boxes stay for their own checkout.
  cart = cart.filter((x) => x.gift)
  updateCart()
  co.step = 'pre-bag-done'
  renderCo()
  if (realUrl(g.paymentUrl)) window.location.assign(g.paymentUrl)
  else if (g.leadId) preorderView(g.leadId)
}

/** The orders list's heading for a pre-order bag (app.js preRow draws its lines under it). */
function preBagHead(g, lines) {
  const paid = lines.some((p) => p.paymentStatus === 'SUCCEEDED')
  return `<p class="pre-group-line">${icon('bag')}<span>Pre-order ${esc(orderNo(g.number || ''))} · ${lines.length} ${lines.length === 1 ? 'box line' : 'box lines'} · ${paid ? 'paid' : 'one payment of'} ${currency(g.total || 0)}</span></p>`
}

/** A box line's kg: the catalogue's box, else the "-5" of its SKU or the "5kg" of its name. */
function preLineKg(p) {
  const s = typeof skuOf === 'function' && skuOf(p.sku)
  if (s && kgOf(s)) return kgOf(s)
  const m = String(p.sku || '').match(/-(\d+(?:\.\d+)?)$/) || String(p.productName || '').match(/(\d+(?:\.\d+)?)\s*kg/i)
  return m ? Number(m[1]) : 0
}

/** The orders list's row for a gift for one person (change request 02): ONE card, "Gift for Asha · G-270 509 835", its
 * boxes, kg, status, the week they arrive together and the one payment, its lines listed inside; it opens the gift's page
 * (/gifts/pre/:id, gifts.js giftGroupView). Styles: style.css ("Your orders: a gift for one person"). */
function preGiftHTML(g, lines) {
  const s = preGiftSum(lines, preLineKg), live = lines.filter((p) => p.status !== 'CANCELLED')
  const who = ((lines.find((p) => p.gift && p.gift.recipientName) || {}).gift || {}).recipientName || ''
  const paid = lines.some((p) => p.paymentStatus === 'SUCCEEDED'), total = Number(g.total) || lines.reduce((n, p) => n + (Number(p.total) || 0), 0)
  const dot = ['PAYMENT_PENDING', 'WAITLISTED'].includes(s.status) ? 'semi' : s.status === 'CANCELLED' ? 'raw' : 'ripe'
  const when = s.status !== 'CANCELLED' && s.week ? ` · arrives together week of ${esc(fmtWeek(s.week))}` : ''
  const kg = s.kg ? ` · ${s.kg} kg` : ''
  const refund = live.some((p) => p.nonRefundable && !p.delayed) ? ` · ${paid ? 'Non-refundable' : 'Non-refundable once paid'}` : ''
  const items = lines.map((p) => `<li${p.status === 'CANCELLED' ? ' class="is-cancelled"' : ''}><span>${esc(boxName(p.productName, p.sku))} · ${stageOf(p.stage).stage} · ${boxWord(p.qty)}${p.status === 'CANCELLED' ? ' · cancelled' : ''}</span><span>${currency(p.total)}</span></li>`).join('')
  const name = `Gift for ${esc(who || 'one person')} · ${esc(orderNo(g.number || ''))}`
  const act = lines.find((p) => p.status === 'PAYMENT_PENDING') || live[0] || lines[0]
  const delays = lines.map((p) => `${p.status === 'BOOKED' ? delayBlock(p, 'pre', 'list') : ''}${delayDone(p)}`).join('')
  return `<div class="order-row is-pre is-gift ord-gift-group"><a class="guide-choice" href="/gifts/pre/${encodeURIComponent(g.id)}" data-route><span class="dot ${dot}"></span><span><strong>${name}</strong><span class="pre-chip order-pre-chip">${icon('sun')}Pre-order</span><span class="pre-chip order-pre-chip gift-chip">${icon('gift')}Gift</span><small>${boxWord(s.boxes)}${kg} · ${esc(PRE_STATUS[s.status] || s.status)}${when} · ${currency(total)}${refund}</small><ul class="ord-gift-lines" aria-label="The boxes in this gift">${items}</ul></span>${icon('arrow')}</a>${delays}${typeof roRowHTML === 'function' && act ? roRowHTML(act, 'pre') : ''}</div>`
}

/** One row of pre-orders (preBagRows) as the orders lists draw it: a bag, a gift for one person, or one pre-order. */
function preRowsHTML(r, cls = '') {
  if (r.bag) return `<div class="pre-bag-rows${cls ? ` ${cls}` : ''}">${preBagHead(r.bag, r.lines)}${r.lines.map(preRow).join('')}</div>`
  if (r.gift) return preGiftHTML(r.gift, r.lines)
  return preRow(r.lines[0])
}
/** When a row of pre-orders was booked, for newest first. */
const preRowsAt = (r) => (r.gift ? preGiftSum(r.lines, () => 0).at : String(r.lines[0].createdAt || r.lines[0].bookedAt || r.lines[0].weekStart || ''))

if (typeof document !== 'undefined') {
  document.addEventListener('submit', (e) => { if (e.target.id === 'co-prebag') { e.preventDefault(); preBagPay() } })
  document.addEventListener('change', (e) => {
    if (e.target.name !== 'pre-bag-agree') return
    pb.agree = e.target.checked
    if (pb.agree && co.error.startsWith('Tick the box')) co.error = ''
    keepDraft() // the address typed so far survives the redraw
    renderCo()
    host()?.querySelector('[name="pre-bag-agree"]')?.focus()
  })
  document.addEventListener('click', async (e) => {
    const b = e.target instanceof Element ? e.target.closest('[data-pb]') : null
    if (!b) return
    if (b.dataset.pb === 'requote') { co.error = ''; enterPreBag(); return }
    if (b.dataset.pb === 'unpaid-cancel' && pb.unpaid) {
      b.disabled = true
      try { await MM.cancelPreorder(pb.unpaid.preorderId); toast(`Pre-order ${orderNo(pb.unpaid.number)} cancelled`); pb.unpaid = null; renderCo(); preBagPay() } catch (err) { co.error = err.message; renderCo() }
    }
  })
  // The pre-order sheet closed over the booked bag: the page draws again with the bag as it is now (paid or not).
  document.getElementById('form-dialog')?.addEventListener('close', () => {
    if (document.body.dataset.page !== 'checkout' || co.step !== 'pre-bag-done' || !pb.done) return
    view = '#page-body'
    MM.preorderGroup(pb.done.id).then((g) => { pb.done = g; renderCo() }, () => renderCo())
  })
}
