/* Gifting: the /gifts page (choose the mangoes, then who gets it) and /gifts/:id (one gift order: the confirmation after
   paying, and where the buyer finds it later; the Orders list links here with a "Gift" badge, app.js ordersView).
   A gift goes to ONE person with as many mangoes as they like (change request 02, CR2-06 and CR2-07, 25 Nov 2026): any
   variety the shop sells (the live catalogue, GET /v1/products, so a new variety shows up by itself), in any size and
   ripeness, paid once, and everything arrives together in one delivery.
   - Screen 1, /gifts, "Choose the mangoes": one card per variety (Mixed Variety Mangoes first, "Most gifted"), with its
     photo, shop price, size (3 kg / 5 kg, or "One size"), ripeness behind "Change", and "+ Add to gift", which becomes a
     stepper "− 1 in gift +". The same variety in two sizes or ripenesses is two lines. A search box filters the cards. A
     sticky bar says "Gift for one person · 3 boxes · 9 kg · ₹5,597 · Arrives together · week of 1 Mar" with "Next: who gets
     it", off until there is a box. At most 20 boxes (the API's GIFT_MAX_BOXES, policy giftMaxBoxes).
   - Screen 2, /gifts/send, "Who gets it?": "Their gift" (every line with its own stepper; 0 takes it out; "+ Add more
     mangoes" goes back to screen 1 with everything kept), the person (name, WhatsApp, house / flat, street, area, an
     optional landmark, pincode, and the city from the pincode), "With the gift" (note, From, price hidden), in season the
     day and time, and one sticky bar that pays: the pre-order tick (before the season), "Gift for one person · 3 boxes ·
     9 kg", "Arrives together · week of 1 Mar" and "Pay ₹5,597". Pay checks the details, the tick, then sign-in, then books.
   - One delivery: before the season every box arrives in the week of the box that is ready last (giftTogetherWeek, the
     API's togetherWeek); in season only days with every box in stock are offered.
   - Booking: before the season POST /v1/preorders/groups with oneDelivery (one booking per box line, one week, one
     payment link; the season's allocator makes them one delivery order, mango-api preorders.js); in season the gift
     order (POST /v1/gifts/quote and /confirm) with one recipient and their box lines, one delivery order (gift-routes.js).
   The gifting switch (MULTI_GIFT, GET /v1/policy features.multiGift): while it is off the page still shows the mangoes,
   says gifting opens soon, never calls the gift routes, and a card puts its box in the bag as a gift instead (gift-bag.js).
   The selection and the person are this tab's draft (sessionStorage mm-gift-draft, v4; older drafts for several people
   open as a gift for their first person), so screen 2 and back, a reload or the sign-in page keep it. Pure helpers (the
   draft, the lines, the week, the bodies) are in gift-rows.js. Gift orders and gift pre-orders booked for several people
   before this change still open (/gifts/:id, /gifts/pre/:id) and show each person.
   Reuses app.js and pages.js: prices and stock from the shop's catalogue (skus, shelf, MM.catalogue), the field errors
   (fieldError), the sign-in page (/login?next=), the payment script (loadScript(RAZORPAY)) and the page frame.
   Loaded after pages.js (it adds to PAGES) and before app.js, so top-level code only declares and listens.
   Styles: style.css (the "Gifting" block, .gift-), dark: theme.css. */

// Back and Forward (the browser's, the phone's, the page's back arrow) walk the steps: /gifts (the mangoes) → /gifts/send
// (who gets it), and /gifts/done after a pre-season gift is paid (replacing the pay step, so Back never returns into a
// paid flow). A step reached by a button pushes its address (giftUrl); Back and Forward redraw the page from it.
PAGES.push(
  [/^\/gifts\/?$/, () => giftsPage('pick')],
  [/^\/gifts\/send\/?$/, () => giftsPage('form')],
  [/^\/gifts\/send\/review\/?$/, () => giftsPage('form')], // an older link: screen 2 now pays
  [/^\/gifts\/done\/?$/, () => giftsPage('done')],
  // A gift pre-order (from Your orders): its boxes and, for one booked before change request 02, each person.
  [/^\/gifts\/pre\/([^/]+)\/?$/, (m) => signedInThen('Your gift pre-order', () => giftGroupView(decodeURIComponent(m[1])))],
  [/^\/gifts\/([^/]+)\/?$/, (m) => signedInThen('Your gift order', () => giftOrderView(decodeURIComponent(m[1])))],
)
const GIFT_PATHS = { pick: '/gifts', form: '/gifts/send', review: '/gifts/send/review', done: '/gifts/done' }
/** The address for a step the buyer moved to with a button: a new history entry that knows where it came from
 *  (giftBack), or with `replace` the same entry redrawn. Nothing is redrawn here: the caller has drawn the step. */
function giftUrl(step, replace = false) {
  const to = GIFT_PATHS[step]
  if (!to || location.pathname === to) return
  if (replace) history.replaceState({ ...(history.state || {}), mm: true }, '', to)
  else history.pushState({ mm: true, giftBack: location.pathname }, '', to)
  window.dispatchEvent(new CustomEvent('mm:route', { detail: { path: to } }))
}
/** "+ Add more mangoes" / "Back to the mangoes": the browser's Back when the step before is that one (no double entries,
 *  no loops); otherwise (opened from a link or a reload) the step drawn here, on the same entry. */
function giftBackTo(step, here) {
  if (history.state && history.state.giftBack === GIFT_PATHS[step]) { history.back(); return }
  here()
  giftUrl(step, true)
}

const GIFT_TITLE = 'Gifting · VMR Mangoes', GIFT_DRAFT = 'mm-gift-draft'
// The API's limits: a note up to 200 characters, a landmark up to 100.
const GIFT_NOTE_MAX = 200, GIFT_LANDMARK_MAX = 100
/** The variety shown first, with "Most gifted" (the owner's pick; the bulk page leads with it too, bulk.js BULK_FIRST). */
const GIFT_FIRST = 'Mixed Variety Mangoes'
let giftSeq = 0
// What the page knows: the policy (the switch), the catalogue's days and stock, the slots, which pincodes we serve and
// their city, and each card's size, ripeness and "Change" (by variety), and the search.
const giftEnv = { ready: false, policy: null, catPin: null, dates: [], days: null, cutoff: '', slots: [], slotsFor: '', pins: {}, cities: {}, stage: {}, size: {}, open: {}, q: '' }
let gift = giftFresh()

/** The gift being made: its box lines [{ sku, stage, qty }], the one person, the note and From, the day and time (in
 *  season), the GST details, and where the flow is (step: form, pay, pre-pay, pre-done). `flow`: screen 2 is open. */
function giftFresh() {
  return { lines: [], person: giftPersonFrom({}), note: '', flow: false, wantPay: false, date: null, slotId: null, sender: '', business: false, bizName: '', gstin: '', errors: {}, step: 'form', pay: null, busy: false, error: '', unpaid: null, key: null, agree: false, group: null, barHint: '' }
}

// ---- Before the season: the gift is pre-ordered (one booking per box line, one week, paid once).

/** The pre-order notice, said plainly and prominently wherever a gift is pre-ordered (the owner, 18 Nov 2026): the bag's
 *  Gift group (gift-bag.js). `when` is HTML (escaped by the caller). */
function preNoticeHTML(when, paid = false) {
  return `<div class="pre-when pre-notice" role="note">${icon('calendar')}<p><strong>This is a pre-order.</strong> It will be delivered in <strong>${when}</strong>.</p></div>` +
    `<div class="pre-warn pre-notice" role="note">${icon('info')}<p><strong>${paid ? 'Paid in full. It can’t be cancelled, unless we delay it.' : 'Paid in full now. It can’t be cancelled once you pay, unless we delay it.'}</strong> If we can’t deliver, we refund you in full.${policyLink()}</p></div>` + harvestNote()
}
/** The pre-order terms, said once on a screen: "Pre-order · arrives together week of 1 Mar · Details", whose Details opens
 *  the terms in the "About pre-orders" pop-up (app.js preAbout), so the chip never changes the page's height. `when` is
 *  HTML (escaped by the caller). */
function preChipHTML(when, paid = false) {
  return `<div class="gift-pre-chip-wrap"><p class="gift-pre-chip">${icon('sun')}<span><strong>Pre-order</strong> · ${paid ? 'delivered' : 'arrives together'} ${when}</span><button type="button" class="text-button gift-terms-btn" data-gift-terms="${paid ? 'paid' : ''}" aria-haspopup="dialog">Details</button></p></div>`
}
/** "week of 1 Mar" (or "weeks of 1 Mar – 8 Mar" when bookings' weeks differ; else the first open week). Plain text. */
function giftWhen(weeks) {
  const span = giftWeekSpan(weeks, fmtWeek)
  if (span) return span
  const f = firstPreWeek()
  return f ? `week of ${fmtWeek(f)}` : 'in the first open delivery week'
}
/** "the first week of March (week of 2 Mar)", escaped. */
const preWeekText = (d) => `${esc(weekPhrase(d))} <span class="no-wrap">(week of ${esc(fmtWeek(d))})</span>`
const varietyOfSku = (sku) => (skuOf(sku) || {}).variety || sku
/** Before the season, the one week the whole gift arrives in: the week of the box that is ready last (every box of a
 *  variety sharing its weekly kg, as the API books them); null when no week has room for all of it together. An older API
 *  that counts boxes per box: each box's own weeks. */
function giftWeek(lines = gift.lines) {
  if (!lines.length) return null
  if (pre.countsBy !== 'boxes' && pre.days.length) return giftTogetherWeek(lines, preDaysOf, varietyOfSku, preNeed)
  return giftTogetherWeek(lines, (sku) => pre.weeks.filter((w) => w.sku === sku), (sku) => sku, preNeed)
}
/** "week of 1 Mar": the gift's week, or (nothing chosen yet) the first open week. '' when no week has room for it all. */
function giftWeekWords() {
  if (!gift.lines.length) return giftWhen([])
  const w = giftWeek()
  return w ? `week of ${fmtWeek(w)}` : ''
}
/** The rule, said next to the week. */
const GIFT_WEEK_RULE = 'Everything arrives together, in the week of the box that’s ready last.'
const GIFT_DAY_RULE = 'Everything arrives together. Only days with every box in stock are offered.'

// ---- Small helpers

const giftOn = () => !!(giftEnv.policy && giftEnv.policy.features && giftEnv.policy.features.multiGift)
/** The most boxes in one gift (the API's policy giftMaxBoxes; 20 from an API that does not say). */
const giftMaxBoxes = () => Number(giftEnv.policy && giftEnv.policy.giftMaxBoxes) || GIFT_MAX_BOXES
const giftBills = () => !!(giftEnv.policy && giftEnv.policy.bills)
const giftPage = () => document.body.dataset.page === 'gifts'
const giftForm = () => $('#gift-form')
const longDate = (d) => { if (!d) return ''; const [y, m, day] = String(d).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, day).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) }
/** A gift's number as the shop shows every number (orderNo, app.js): G-743 406 080; an older GFT-12 as it is. */
const giftNo = (n) => orderNo(n || '')
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

/** Every variety the shop sells, as gift cards: Mixed Variety Mangoes first, then A to Z. From the live catalogue
 *  (shelf.js shelf), so a new variety is giftable as soon as the shop sells it. */
function giftVarieties() {
  return shelf.filter((v) => v.skus.length).slice().sort((a, b) => (b.name === GIFT_FIRST) - (a.name === GIFT_FIRST) || a.name.localeCompare(b.name))
}
/** A shop box as the gift shows it: its variety's name, picture, size and price (live from the catalogue). */
function packOf(sku) {
  const s = skuOf(sku)
  if (!s) return null
  return { sku: s.sku, s, c: contentForLine(s.sku, s.name) || {}, name: s.variety, kg: String(s.boxSize).replace('kg', ' kg') }
}
const packPhoto = (p, stage) => p.c.photos && (p.c.photos[stage] || p.c.photos.SEMI_RIPE)
/** "Alphonso · 3 kg · Semi-ripe" */
const boxLine = (sku, stage) => { const p = packOf(sku); return p ? `${p.name} · ${p.kg} · ${stageOf(stage).stage}` : '' }

// Stock: boxes free per box, ripeness and day, from the catalogue (unknown until a served pincode is known).
const stockKnown = () => !preSeason() && !!giftEnv.days
const dayQty = (sku, stage, date) => (giftEnv.days && giftEnv.days[sku] && giftEnv.days[sku][stage] && giftEnv.days[sku][stage][date]) || 0
const anyQty = (sku, stage) => giftEnv.dates.some((d) => dayQty(sku, stage, d) > 0)

/** Why nothing can be sent right now (the switch), or null. */
function giftGate() {
  if (!giftEnv.ready) return { kind: 'loading', icon: 'clock', short: 'Checking…', long: 'Checking whether gifting is open…' }
  if (!giftOn()) return { kind: 'off', icon: 'lock', short: 'Opening soon', long: 'Gifting is opening soon: sending gifts isn’t switched on yet.' }
  return null
}

/** Why this box can't be had at all right now, from the stock on the deliverable days: another ripeness is in, it is out
 *  of season, or it is sold out; null when it can. `long` is one short line (the card's reason slot), `short` a badge. */
function stockWhy(p, stage) {
  if (!giftEnv.ready) return { kind: 'loading', icon: 'clock', short: 'Checking…', long: 'Checking the stock…' }
  if (!stockKnown()) return null
  if (SOLD_API.some((st) => anyQty(p.sku, st))) {
    if (stage && !anyQty(p.sku, stage)) {
      const other = SOLD_API.find((st) => anyQty(p.sku, st))
      return { kind: 'stage', icon: 'close', short: `${stageOf(stage).stage} is out`, long: `${stageOf(stage).stage} sold out · ${stageOf(other).stage} is in` }
    }
    return null
  }
  const se = p.c.season, m = new Date().getMonth() + 1
  if (se && se.from && se.to && !(m >= se.from && m <= se.to)) return { kind: 'season', icon: 'leaf', short: 'Out of season', long: `Out of season until ${MONTHS[se.from]}` }
  return { kind: 'stock', icon: 'close', short: 'Sold out', long: 'Sold out for now' }
}
/** Before the season a box can be pre-ordered while one of its variety's weeks has room for it. */
const preOpenFor = (sku) => (pre.countsBy !== 'boxes' && pre.days.length ? preDaysOf(sku).some((d) => d.remaining >= preNeed(1, sku)) : pre.weeks.some((w) => w.sku === sku && w.remaining >= preNeed(1, sku)))
/** Why this box can't go in the gift now: before the season, no week has room; in season, the stock. */
const lineWhy = (p, stage) => (preSeason() ? (preOpenFor(p.sku) ? null : { kind: 'stock', icon: 'close', short: 'Fully booked', long: 'Fully booked for now' }) : stockWhy(p, stage))

/** The ripeness a variety's card shows: the one picked, else one in stock, else Semi-ripe. */
function cardStageFor(variety, sku) {
  if (giftEnv.stage[variety]) return giftEnv.stage[variety]
  if (stockKnown()) { const st = ['SEMI_RIPE', 'RAW'].find((x) => anyQty(sku, x)); if (st) return st }
  return 'SEMI_RIPE'
}
/** The size a variety's card shows: the one picked, else 3 kg, else the first. */
const cardSku = (v) => v.skus.find((x) => x.sku === giftEnv.size[v.name]) || v.skus.find((x) => kgOf(x) === 3) || v.skus[0]

// ---- The draft: kept for this tab only (someone else's address), so screen 2 and back, a reload or the sign-in page
// keep it. Every change is saved a moment after it is made, with no Save button (gift-rows.js reads and writes its shape).
let draftTimer = 0
function saveDraft() {
  clearTimeout(draftTimer)
  draftTimer = setTimeout(() => {
    try {
      if (!gift.lines.length && giftBlank(gift.person)) sessionStorage.removeItem(GIFT_DRAFT)
      else sessionStorage.setItem(GIFT_DRAFT, giftDraftJSON(gift))
    } catch {}
  }, 300)
}
function readDraft() {
  let d = null
  try { d = readGiftDraft(sessionStorage.getItem(GIFT_DRAFT)) } catch {}
  if (!d) return
  gift.lines = giftMergeLines(d.lines, giftMaxBoxes())
  gift.person = d.person
  Object.assign(gift, { note: d.note, date: d.date, slotId: d.slotId, sender: d.sender, business: d.business, bizName: d.bizName, gstin: d.gstin, wantPay: d.wantPay })
}
function dropDraft() { clearTimeout(draftTimer); try { sessionStorage.removeItem(GIFT_DRAFT) } catch {} }

/** Whether the address can be asked of the person on WhatsApp: before the season, when the API offers it. */
const askOn = () => !!(preSeason() && giftEnv.policy && giftEnv.policy.features && giftEnv.policy.features.giftAddressAsk)
/** Whether we ask them: where asking is open, unless the giver chose to type the address. */
const askOf = () => askOn() && gift.person.ask !== false
/** The note that goes with the gift. */
const noteOf = () => gift.note.trim()
const whoOf = () => gift.person.name.trim() || 'them'

// ---- GSTIN: the same checks as the API (mango-api gstin.js): the shape, the state code and the check character.
const GST_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
function gstinWhy(raw) {
  const g = String(raw || '').replace(/\s+/g, '').toUpperCase()
  if (!g) return 'Enter the GSTIN'
  if (g.length !== 15) return 'A GSTIN has 15 characters'
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z][A-Z0-9][0-9A-Z]$/.test(g)) return 'That is not a GSTIN: 2-digit state code, 10-character PAN, then 3 characters'
  const st = Number(g.slice(0, 2))
  if (!((st >= 1 && st <= 38) || st === 97 || st === 99)) return `${g.slice(0, 2)} is not a GST state code`
  let sum = 0
  for (let i = 0; i < 14; i++) { const p = GST_CHARS.indexOf(g[i]) * (i % 2 === 0 ? 1 : 2); sum += Math.floor(p / 36) + (p % 36) }
  if (GST_CHARS[(36 - (sum % 36)) % 36] !== g[14]) return 'That GSTIN has a typo: its last character does not match (check it against the GST certificate)'
  return ''
}

// ---- The page

function giftsPage(want = 'pick') {
  document.title = GIFT_TITLE
  const seq = ++giftSeq
  if (want === 'review') want = 'form'
  if (want === 'done' && gift.step !== 'pre-done') want = 'pick'
  if (want !== 'done' && gift.step === 'pre-done') gift = giftFresh()
  if (!gift.lines.length && giftBlank(gift.person)) readDraft()
  if (want === 'form' && !gift.lines.length) {
    // Nothing chosen (an old link, a paid gift): the mangoes. When the entry before is the mangoes, step back to it rather
    // than show them twice in a row.
    if (history.state && history.state.giftBack === GIFT_PATHS.pick) { history.back(); return }
    want = 'pick'
  }
  if (want === 'form' && gift.step !== 'form' && gift.step !== 'pay' && gift.step !== 'pre-pay') { gift.step = 'form'; gift.error = ''; gift.key = null }
  gift.flow = want !== 'pick'
  if (location.pathname.replace(/\/$/, '') !== GIFT_PATHS[want]) history.replaceState({ ...(history.state || {}), mm: true }, '', GIFT_PATHS[want])
  host().innerHTML = pageHead('Gifting') + `
    <div id="gift-notice"></div>
    <div id="gift-shop"${gift.flow ? ' hidden' : ''}>
    <section class="gift-hero" aria-labelledby="gift-hero-h">
      <div class="gift-hero-copy">
        <p class="gift-kicker">${icon('gift')}<span>VMR Mangoes gifting</span></p>
        <h2 id="gift-hero-h">Send a gift of <span class="why-u">the season<svg class="sun-swash" viewBox="0 0 120 16" preserveAspectRatio="none" aria-hidden="true"><path d="M3 11C28 5 66 2 117 6"/></svg></span></h2>
        <p>Pick as many mangoes as you like for one person. You pay once, and everything arrives together.</p>
      </div>
      ${stepLineHTML(1)}
    </section>
    <section class="gift-packs" aria-labelledby="gift-packs-h">
      <div class="gift-packs-head"><h2 id="gift-packs-h" tabindex="-1">Choose the mangoes</h2><p>Every mango in the shop, at the shop price. Prices include GST.</p></div>
      <div class="gift-tools"><div class="gift-when-chip" id="gift-when-chip"></div><label class="gift-search">${icon('search')}<span class="sr-only">Find a mango by name</span><input type="search" id="gift-q" autocomplete="off" enterkeyhint="search" placeholder="Find your kind of mango…" value="${esc(giftEnv.q)}" aria-controls="gift-grid"></label></div>
      <div class="gift-grid" id="gift-grid" aria-busy="true">${Array.from({ length: 4 }, () => '<div class="gift-card is-skeleton" aria-hidden="true"><div class="gift-card-photo"></div><div class="gift-card-body"><span class="sk-block"></span><span class="sk-block"></span></div></div>').join('')}</div>
      <p class="gift-grid-count" id="gift-count" aria-live="polite"></p>
    </section>
    </div>
    <section class="gift-send page-card" id="gift-send" aria-labelledby="gift-send-h"${gift.flow ? '' : ' hidden'}></section>
    <p class="sr-only" id="gift-live" aria-live="polite"></p>`
  giftLoad(seq)
}

async function giftLoad(seq) {
  const [pol] = await Promise.all([
    policy ? Promise.resolve(policy) : MM.policy().catch(() => null),
    season ? null : loadWeeks().catch(() => null),
    shelfReady(),
  ])
  if (seq !== giftSeq || !giftPage()) return
  // Before the season a gift is pre-ordered: which weeks have room for each variety (app.js pre).
  if (preSeason() && !pre.weeks.length) await loadWeeks().catch(() => null)
  if (seq !== giftSeq || !giftPage()) return
  giftEnv.policy = pol || null
  giftEnv.ready = true
  // Stock and the delivery days: from the shop's pincode, or the person's when we serve it.
  const own = gift.person.pincode.trim()
  const pin = (where.pincode && where.serviceable && where.pincode) || (/^[1-9]\d{5}$/.test(own) ? own : null)
  if (pin && !giftEnv.days) await giftStock(pin)
  if (seq !== giftSeq || !giftPage()) return
  if (/^[1-9]\d{5}$/.test(own) && giftEnv.pins[own] === undefined) checkPin(own)
  renderGiftNotice()
  renderGiftGrid()
  if (gift.flow && !giftGate()) {
    setFlow(true)
    renderGiftSend()
    giftSlots()
    // Back from the sign-in page that Pay opened: the details again, with Pay ready (nothing is paid without a press).
    if (gift.wantPay && MM.profile() && gift.step === 'form') {
      gift.wantPay = false
      gift.barHint = 'You’re signed in. Check the details and press Pay.'
      saveDraft()
      giftBar()
      focusSel('#pay-bar [data-gift-pay]')
    }
  } else {
    if (gift.flow) setFlow(false)
    giftBar()
  }
}

/** Screen 2 on its own (the cards step aside), or the cards again (the gift is kept). */
function setFlow(on) {
  gift.flow = !!on
  const shop = $('#gift-shop'), send = $('#gift-send')
  if (shop) shop.hidden = gift.flow
  if (send) { send.hidden = !gift.flow; if (!gift.flow) send.innerHTML = '' }
  giftBar()
  renderGiftNotice()
}
/** Scrolls to the top of screen 2 and puts the focus on `sel` (else the step's heading). */
function giftTop(sel) {
  const box = $('#gift-send')
  if (!box) return
  box.scrollIntoView({ block: 'start', behavior: reduced ? 'instant' : 'smooth' })
  const el = (sel && box.querySelector(sel)) || box.querySelector('#gift-send-h')
  if (el) el.focus({ preventScroll: true })
}

/** The catalogue for a served pincode: the open delivery days and the boxes free on each (all pincodes share the stock). */
async function giftStock(pin) {
  try {
    const c = await MM.catalogue(pin)
    if (!c || !c.serviceable) return false
    if (c.season) setSeason(c.season)
    const days = {}
    for (const i of c.items || []) for (const a of i.availability || []) ((days[i.sku] ??= {})[i.stage] ??= {})[a.date] = a.qty
    giftEnv.days = days
    giftEnv.dates = c.deliveryDates || []
    giftEnv.cutoff = c.cutoffTime || ''
    giftEnv.catPin = pin
    if (!giftEnv.dates.includes(gift.date)) gift.date = null
    if (!gift.date) gift.date = giftEnv.dates.find((d) => dayFits(d)) || null
    return true
  } catch { return false }
}

/** The notice above the mangoes (the gifting switch) and, before the season, the pre-order chip by the search. */
function renderGiftNotice() {
  const box = $('#gift-notice'), chip = $('#gift-when-chip')
  if (chip) {
    const g = giftGate(), words = giftWeekWords()
    chip.innerHTML = !g && preSeason() ? preChipHTML(esc(words || 'when every box has room')) : ''
  }
  if (!box) return
  const g = giftGate()
  if (gift.flow || !g || g.kind === 'loading') { box.innerHTML = ''; return }
  box.innerHTML = `<div class="gift-notice" role="status"><span class="gift-notice-icon" aria-hidden="true">${icon('gift')}</span><div><p><strong>Gifting is opening soon.</strong></p><p>You can look through the mangoes now. Sending a gift opens shortly; the prices are the shop’s.</p></div></div>`
}

/** Whether a variety matches what was typed in the search: its name, or its tags and flavour words. */
function giftMatch(v, q) {
  const c = v.c || {}
  return [v.name, ...(c.tags || []), c.flavour || '', c.bestFor || ''].some((t) => String(t).toLowerCase().includes(q))
}

function renderGiftGrid(focus) {
  const grid = $('#gift-grid')
  if (!grid) return
  const all = giftVarieties()
  grid.removeAttribute('aria-busy')
  const count = $('#gift-count')
  if (!all.length) {
    grid.innerHTML = `<div class="page-card empty-cart bag-empty empty-state">${icon('gift')}<h2>The mangoes are a moment away.</h2><p>We couldn’t load them just now. Try again in a minute.</p><button class="button primary bag-explore" data-gift-retry>Try again ${icon('arrow')}</button></div>`
    if (count) count.textContent = ''
    return
  }
  const q = giftEnv.q.trim().toLowerCase(), list = q ? all.filter((v) => giftMatch(v, q)) : all
  grid.innerHTML = list.length
    ? list.map(giftCard).join('')
    : `<div class="gift-none">${icon('search')}<p>No mango matches “${esc(giftEnv.q.trim())}”.</p><button type="button" class="button secondary" data-gift-q-clear>Show every mango</button></div>`
  if (count) count.textContent = q ? `${plural(list.length, 'mango matches', 'mangoes match')} “${giftEnv.q.trim()}”, of ${all.length}.` : `All ${all.length} mangoes in the shop can be gifted.`
  refocus(grid, focus)
}

/** A card's two-way switches (ripeness, box size) slide: the lens moves to the tapped choice first, and the card is
    redrawn once it has arrived (redrawing at once replaced the switch, so nothing ever moved). */
function slideSwitch(btn, then) {
  const seg = btn.closest('.segmented')
  if (!seg || btn.classList.contains('selected') || matchMedia('(prefers-reduced-motion: reduce)').matches) { then(); return }
  const btns = [...seg.querySelectorAll('button')]
  seg.style.setProperty('--i', btns.indexOf(btn))
  for (const x of btns) { x.classList.toggle('selected', x === btn); x.setAttribute('aria-pressed', String(x === btn)) }
  setTimeout(then, 260)
}

/** The gift boxes of this box and ripeness already in the bag (gifting switched off: a card adds to the bag). */
const inBag = (sku, stage) => cart.concat(typeof cartAside === 'undefined' ? [] : cartAside).filter((x) => x.gift && x.sku === sku && x.stage === stage).reduce((n, x) => n + x.qty, 0)
const lineOf = (sku, stage) => gift.lines.find((l) => l.sku === sku && l.stage === stage) || null

/** The − n + stepper of one gift line (a card, or a row of "Their gift"). `where`: 'card' or 'row', for the focus. */
function stepperHTML(l, label, where) {
  const full = giftBoxCount(gift.lines) >= giftMaxBoxes()
  return `<div class="gift-step${where === 'row' ? ' is-row' : ''}" role="group" aria-label="${esc(label)}, boxes in the gift"><button type="button" data-gift-qty="-1" data-sku="${esc(l.sku)}" data-stage="${l.stage}" data-at="${where}" aria-label="${l.qty === 1 ? 'Take out' : 'One fewer'}: ${esc(label)}">−</button><span class="gift-step-n" aria-live="polite"><b>${l.qty}</b>${where === 'card' ? ' in gift' : ''}</span><button type="button" data-gift-qty="1" data-sku="${esc(l.sku)}" data-stage="${l.stage}" data-at="${where}" aria-label="One more: ${esc(label)}"${full ? ' aria-disabled="true"' : ''}>+</button></div>`
}

/** One variety's card: photo, name, shop price, size (3 kg / 5 kg, or one size), ripeness behind "Change", and "+ Add to
 *  gift", which becomes the stepper once the box is in. While gifting is switched off the one button puts the box in the
 *  bag as a gift for one person instead (gift-bag.js), checked out through the regular checkout. */
function giftCard(v) {
  const s0 = cardSku(v), p = packOf(s0.sku), stage = cardStageFor(v.name, p.sku), src = packPhoto(p, stage), id = `gift-why-${p.sku}`
  const label = `${v.name} ${p.kg} ${stageOf(stage).stage.toLowerCase()}`, open = !!giftEnv.open[v.name], pres = !!preSeason()
  const off = lineWhy(p, stage), gate = giftGate(), toBag = !!gate && gate.kind === 'off'
  const line = toBag ? null : lineOf(p.sku, stage), have = toBag ? inBag(p.sku, stage) : 0
  const reason = off || (gate && gate.kind !== 'loading' && !toBag ? gate : null)
  const sizes = v.skus.length > 1
    ? `<div class="segmented glass detail-stages gift-sizes" role="group" aria-label="Box size for ${esc(v.name)}" style="--i:${v.skus.findIndex((x) => x.sku === p.sku)};--n:${v.skus.length}"><span class="detail-lens" aria-hidden="true"></span>${v.skus.map((x) => `<button type="button" class="${x.sku === p.sku ? 'selected' : ''}" data-gift-size="${esc(x.sku)}" data-variety="${esc(v.name)}" aria-pressed="${x.sku === p.sku}">${esc(String(x.boxSize).replace('kg', ' kg'))}</button>`).join('')}</div>`
    : `<p class="gift-size-one">${esc(p.kg)} · <small>One size</small></p>`
  const optsId = `gift-opts-${p.sku}`
  const stages = `<div class="segmented glass detail-stages gift-stages is-small" role="group" aria-label="Ripeness for ${esc(v.name)}" style="--i:${SOLD.findIndex((x) => x.apiStage === stage)};--n:${SOLD.length}"><span class="detail-lens" aria-hidden="true"></span>${SOLD.map((x) => {
    const on = x.apiStage === stage, out = !pres && stockKnown() && !anyQty(p.sku, x.apiStage)
    return `<button type="button" class="${on ? 'selected' : ''}${out ? ' out' : ''}" data-gift-stage="${x.apiStage}" data-variety="${esc(v.name)}" aria-pressed="${on}"${out ? ` aria-label="${x.stage}, sold out"` : ''}><span class="dot ${x.id}"></span>${x.stage}</button>`
  }).join('')}</div>`
  const ripe = `<div class="gift-ripe"><p class="gift-ripe-now"><span class="dot ${stageOf(stage).id}" aria-hidden="true"></span><span>${stageOf(stage).stage}</span><button type="button" class="text-button gift-change" data-gift-change="${esc(v.name)}" aria-expanded="${open}" aria-controls="${esc(optsId)}" aria-label="${open ? 'Done changing' : 'Change'} the ripeness of ${esc(v.name)}">${open ? 'Done' : 'Change'}</button></p><div class="gift-pick-opts" id="${esc(optsId)}"${open ? '' : ' hidden'}>${stages}</div></div>`
  const why = ` disabled aria-describedby="${id}"`
  let act
  if (toBag) {
    const bagOff = stockWhy(p, stage)
    act = `<button type="button" class="button secondary gift-add-btn"${bagOff ? why : ` data-gift-bag="${esc(p.sku)}" data-stage="${stage}" aria-label="Add ${esc(label)} to your bag as a gift"`}>${icon(bagOff ? bagOff.icon : 'bag')}<span>Add to bag as a gift</span></button>`
  } else if (line) act = stepperHTML(line, label, 'card')
  else act = `<button type="button" class="button secondary gift-add-btn"${off || gate ? why : ` data-gift-add-line="${esc(p.sku)}" data-stage="${stage}" aria-label="Add ${esc(label)} to the gift"`}><span aria-hidden="true">+</span><span>Add to gift</span></button>`
  const also = gift.lines.filter((l) => l !== line && varietyOfSku(l.sku) === v.name)
  const alsoLine = also.length ? `<p class="gift-card-also">${icon('gift')}<span>Also in the gift: ${esc(also.map((l) => `${l.qty} × ${packOf(l.sku)?.kg || ''} ${stageOf(l.stage).stage.toLowerCase()}`).join(', '))}</span></p>` : ''
  const reasonLine = `<p class="gift-why${reason ? ` is-${reason.kind}` : ''}" id="${id}">${reason ? `${icon(reason.icon)}<span>${esc(reason.long)}</span>` : ''}</p>`
  const tag = v.name === GIFT_FIRST ? `<span class="gift-tag">${icon('heart')}Most gifted</span>` : ''
  const badge = off && off.kind !== 'stage' && off.kind !== 'loading' ? `<span class="gift-badge is-${off.kind}">${icon(off.icon)}${esc(off.short)}</span>` : ''
  const bagged = have ? `<a class="gift-in-bag" href="/cart" data-route>${icon('check')}<span>${have} in your bag</span></a>` : ''
  return `<article class="gift-card${line ? ' is-in' : ''}${off && off.kind !== 'stage' ? ' is-off' : ''}" data-variety="${esc(v.name)}"><div class="gift-card-photo${src ? ' photo' : ''}">${src ? `<img src="${src}" alt="" loading="lazy" decoding="async" width="720" height="720">` : ''}${tag}${badge}${bagged}</div><div class="gift-card-body"><div class="gift-card-top"><h3>${esc(v.name)}</h3><p class="gift-card-price"><strong>${currency(p.s.price)}</strong> · ${esc(p.kg)}</p></div><div class="gift-card-controls">${sizes}${ripe}<div class="gift-acts">${act}</div>${alsoLine}${reasonLine}</div></div></article>`
}

/** The step line: "1 Choose the mangoes · 2 Who gets it", the current step marked. */
function stepLineHTML(now) {
  const steps = ['Choose the mangoes', 'Who gets it']
  return `<ol class="gift-stepline" aria-label="Steps">${steps.map((s, i) => {
    const n = i + 1, done = n < now, cur = n === now
    return `<li class="${done ? 'is-done' : cur ? 'is-now' : ''}"${cur ? ' aria-current="step"' : ''}><span class="gift-stepline-n" aria-hidden="true">${done ? icon('check') : n}</span><span class="gift-stepline-t"><span class="sr-only">Step ${n} of ${steps.length}: </span>${s}${done ? '<span class="sr-only"> (done)</span>' : ''}</span></li>`
  }).join('')}</ol>`
}

// ---- The gift's lines: add, change, take out (both screens), with the 20-box cap.

/** Adds `delta` boxes of one box and ripeness to the gift (0 takes the line out). Says what happened; a friendly line
 *  when the cap stops it. Returns whether anything changed. */
function giftChange(sku, stage, delta) {
  const before = giftBoxCount(gift.lines), max = giftMaxBoxes()
  if (delta > 0 && before >= max) {
    const msg = `A gift can hold up to ${max} boxes. To send more, send a second gift, or place a bulk order.`
    toast(msg)
    say(msg)
    return false
  }
  const r = giftAddLine(gift.lines, sku, stage, delta, max)
  gift.lines = r.lines
  delete gift.errors['#gift-their']
  if (!preSeason() && gift.date && !dayFits(gift.date)) gift.date = giftEnv.dates.find((d) => dayFits(d)) || gift.date
  saveDraft()
  const l = lineOf(sku, stage), words = boxLine(sku, stage), n = giftBoxCount(gift.lines)
  say(l ? `${l.qty} × ${words} in the gift. ${plural(n, 'box', 'boxes')} in all.` : `${words} taken out of the gift. ${plural(n, 'box', 'boxes')} in all.`)
  if (r.capped) toast(`A gift can hold up to ${max} boxes.`)
  return true
}

function giftTotals() {
  let boxes = 0, total = 0, kg = 0
  for (const l of gift.lines) {
    const s = skuOf(l.sku)
    if (!s) continue
    boxes += l.qty
    total += s.price * l.qty
    kg += kgOf(s) * l.qty
  }
  return { boxes, total, kg }
}

// ---- Screen 2, "Who gets it?": their gift, the person, the note; the sticky bar pays.

function renderGiftSend(focus) {
  const box = $('#gift-send')
  if (!box) return
  if (gift.step === 'pay' || gift.step === 'pre-pay' || gift.step === 'pre-done') {
    box.innerHTML = gift.step === 'pay' ? stepLineHTML(2) + giftPayHTML() : gift.step === 'pre-pay' ? giftPrePayHTML() : giftPreDoneHTML()
    giftBar()
    refocus(box, focus)
    return
  }
  const pres = !!preSeason()
  box.innerHTML = `${stepLineHTML(2)}
    <div class="gift-send-head"><h2 id="gift-send-h" tabindex="-1">Who gets it?</h2><p>One person. Everything arrives together, in one delivery.</p></div>
    <form id="gift-form" novalidate>
      ${theirGiftHTML()}
      ${personHTML()}
      <section class="gift-sec gift-from" aria-labelledby="gift-from-h">
        <h3 id="gift-from-h">With the gift</h3>
        <label class="field gift-note">Gift note <small class="gift-opt">(optional)</small><textarea name="gift-note" rows="3" maxlength="${GIFT_NOTE_MAX}" placeholder="Happy summer! Enjoy the first mangoes of the season." aria-describedby="gift-note-count">${esc(gift.note)}</textarea><small class="gift-count" id="gift-note-count">${noteCount(gift.note)}</small></label>
        <label class="field">From<input name="gift-sender" maxlength="80" autocomplete="name" placeholder="Your name, as they know you" value="${esc(gift.sender)}"></label>
        <p class="gift-hidden-price">${icon('check')}<span><strong>The price is hidden.</strong> Nothing they get shows what you paid.</span></p>
      </section>
      ${pres ? '' : `<section class="gift-sec" aria-labelledby="gift-when-h"><h3 id="gift-when-h">When should it arrive?</h3><div id="gift-when">${whenHTML()}</div></section>`}
      ${giftBills() && !pres ? bizHTML() : ''}
      <div id="gift-alert">${alertHTML()}</div>
      ${MM.profile() ? '' : `<p class="gift-muted gift-signin">${icon('user')}<span>You’ll sign in with your mobile number when you pay.</span></p>`}
    </form>
    <button type="button" class="text-button gift-quiet gift-to-boxes" data-gift-boxes>${icon('back')}<span>Back to the mangoes</span></button>`
  applyErrors()
  giftBar()
  refocus(box, focus)
}

/** "Their gift": one row per line (photo, name, size · ripeness, − qty +, price; 0 takes it out), "+ Add more mangoes",
 *  the boxes and kg, and when it all arrives. */
function theirGiftHTML() {
  const t = giftTotals(), pres = !!preSeason(), err = gift.errors['#gift-their']
  const rows = gift.lines.map((l) => {
    const p = packOf(l.sku)
    if (!p) return ''
    const label = `${p.name} ${p.kg} ${stageOf(l.stage).stage.toLowerCase()}`
    return `<li class="gift-line">${thumb(l.sku, l.stage, p.s.name)}<div class="gift-line-copy"><strong>${esc(p.name)}</strong><small>${esc(p.kg)} · ${stageOf(l.stage).stage}</small></div>${stepperHTML(l, label, 'row')}<strong class="gift-line-price">${currency(p.s.price * l.qty)}</strong></li>`
  }).join('')
  const words = pres ? giftWeekWords() : gift.date ? `on ${fmtDate(gift.date)}` : ''
  const when = pres
    ? (words ? `<p class="gift-together">${icon('calendar')}<span><strong>Arrives together · ${esc(words)}</strong><small>${GIFT_WEEK_RULE}</small></span></p>` : (gift.lines.length ? `<p class="gift-together is-off">${icon('close')}<span><strong>No delivery week has room for all of these together.</strong><small>Take a box out, or choose another.</small></span></p>` : ''))
    : `<p class="gift-together">${icon('calendar')}<span><strong>Arrives together${words ? ` · ${esc(words)}` : ''}</strong><small>${GIFT_DAY_RULE}</small></span></p>`
  return `<section class="gift-their" id="gift-their" aria-labelledby="gift-their-h" tabindex="-1">
    <div class="gift-their-top"><h3 id="gift-their-h">Their gift</h3><span>${esc(giftBarLine(t.boxes, t.kg))}</span></div>
    ${err ? `<p class="gift-why is-error" role="alert">${icon('info')}<span>${esc(err)}</span></p>` : ''}
    ${rows ? `<ul class="gift-lines" aria-label="The boxes in the gift">${rows}</ul>` : `<p class="gift-muted gift-empty">${icon('gift')}<span>Nothing in the gift yet.</span></p>`}
    <div class="gift-their-foot"><button type="button" class="button secondary gift-more-btn" data-gift-more><span aria-hidden="true">+</span><span>Add more mangoes</span></button>${when}</div>
  </section>`
}

/** The one person: name and WhatsApp number; then their address (house / flat, street, area; an optional landmark;
 *  pincode, and the city from it), or before the season, when the API offers it, "Ask them on WhatsApp". */
function personHTML() {
  const r = gift.person, pin = r.pincode.trim(), served = giftEnv.pins[pin], ask = askOf(), city = served === true ? giftEnv.cities[pin] || '' : ''
  const pinHint = served === true ? `<small class="field-hint gift-pin is-ok">${icon('check')}<span>We deliver to ${esc(pin)}</span></small>` : served === 'checking' ? `<small class="field-hint gift-pin">${icon('clock')}<span>Checking ${esc(pin)}…</span></small>` : ''
  const choice = askOn() ? `<fieldset class="gift-addr-choice"><legend>Their address</legend><label class="gift-radio"><input type="radio" name="gp-ask" value="ask"${ask ? ' checked' : ''}><span><strong>Ask them on WhatsApp</strong><small>We send them a link to add it</small></span></label><label class="gift-radio"><input type="radio" name="gp-ask" value="enter"${ask ? '' : ' checked'}><span><strong>I’ll enter it</strong><small>You know where they live</small></span></label></fieldset>` : ''
  const addr = ask ? '' : `<div class="gift-fields gift-addr">
      <label class="field wide">House / flat, street, area<textarea name="gp-address" rows="2" maxlength="500" autocomplete="off" placeholder="House, street, area">${esc(r.address)}</textarea></label>
      <label class="field wide">Landmark <small class="gift-opt">(optional)</small><input name="gp-landmark" maxlength="${GIFT_LANDMARK_MAX}" autocomplete="off" placeholder="e.g. near Sai Baba temple, opposite bus stop" value="${esc(r.landmark)}" aria-describedby="gp-landmark-hint"><small class="field-hint" id="gp-landmark-hint">Helps the delivery person find them</small></label>
      <label class="field gift-pin-field">Pincode<input name="gp-pincode" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" placeholder="6 digits" value="${esc(r.pincode)}">${pinHint}</label>
      <label class="field gift-city-field">City<input name="gp-city" readonly aria-readonly="true" tabindex="-1" placeholder="From the pincode" value="${esc(city)}"></label>
    </div>`
  return `<section class="gift-sec gift-who" aria-labelledby="gift-who-h">
    <h3 id="gift-who-h">Who gets it</h3>
    <div class="gift-fields">
      <label class="field">Name<input name="gp-name" maxlength="80" autocomplete="off" value="${esc(r.name)}"></label>
      <label class="field">WhatsApp number<span class="gift-tel"><span class="gift-tel-cc" aria-hidden="true">+91</span><input name="gp-phone" type="tel" inputmode="numeric" maxlength="16" autocomplete="off" placeholder="10-digit number" value="${esc(r.phone)}" aria-describedby="gp-phone-hint"></span><small class="field-hint" id="gp-phone-hint">${ask ? 'We message them here to ask for their address' : 'Only for the delivery person'}</small></label>
    </div>
    ${choice}${addr}
  </section>`
}
const noteCount = (s) => `${s.length} / ${GIFT_NOTE_MAX}${s.length >= GIFT_NOTE_MAX ? ' · that’s the most a note can hold' : ''}`

/** Business name and GSTIN for the one bill (in season), tucked behind a link. */
function bizHTML() {
  if (!gift.business) return `<button type="button" class="text-button gift-quiet gift-biz-link" data-gift-biz="on">${icon('store')}<span>Buying for a business? Add GST details</span></button>`
  return `<section class="gift-sec" aria-labelledby="gift-biz-h"><h3 id="gift-biz-h">GST details for the bill</h3><p class="gift-muted">${icon('info')}<span>They go on the one bill for the whole gift.</span></p><div class="gift-fields gift-biz"><label class="field">Business name<input name="gift-biz-name" maxlength="100" autocomplete="organization" placeholder="As on the GST certificate" value="${esc(gift.bizName)}"></label><label class="field">GSTIN<input name="gift-gstin" maxlength="20" autocapitalize="characters" spellcheck="false" placeholder="15 characters" value="${esc(gift.gstin)}"></label></div><button type="button" class="text-button gift-quiet" data-gift-biz="off">${icon('close')}<span>Remove the GST details</span></button></section>`
}

/** In season: the boxes needed per box and ripeness; a day fits when every one is in stock (unknown stock fits). */
function giftNeed() {
  const need = new Map()
  for (const l of gift.lines) if (packOf(l.sku)) need.set(`${l.sku}|${l.stage}`, (need.get(`${l.sku}|${l.stage}`) || 0) + l.qty)
  return need
}
function dayFits(d) {
  if (!stockKnown()) return true
  for (const [key, qty] of giftNeed()) { const [sku, stage] = key.split('|'); if (dayQty(sku, stage, d) < qty) return false }
  return true
}

function whenHTML() {
  if (preSeason()) return ''
  if (!giftEnv.dates.length) return `<p class="gift-muted">${icon('pin')}<span>Add a pincode we deliver to and the delivery days show here.</span></p>`
  const cut = esc(giftEnv.cutoff || (policy && policy.cutoffTime) || '18:00 IST')
  const cards = giftEnv.dates.map((x) => {
    const dt = new Date(x + 'T00:00:00'), on = x === gift.date, unfit = !dayFits(x)
    return `<button type="button" class="date-card${unfit ? ' is-unfit' : ''}" data-gift-date="${x}" aria-pressed="${on}" aria-label="${fmtDate(x)}${unfit ? ', not every box is in stock' : ''}"${unfit ? ' aria-disabled="true"' : ''}><small>${dayName(x)}</small><strong>${dt.getDate()}</strong><small>${dt.toLocaleDateString('en-IN', { month: 'short' })}</small>${unfit ? `<small class="date-unfit">${icon('close')}<span>Not all in</span></small>` : ''}</button>`
  }).join('')
  const slots = giftEnv.slots.length ? `<p class="gift-label" id="gift-slot-l">Time</p><div class="slot-cards" id="gift-slots" role="group" aria-labelledby="gift-slot-l" tabindex="-1">${giftEnv.slots.map((s) => {
    const off = s.available === false, on = s.id === gift.slotId
    return `<button type="button" class="slot-card" data-gift-slot="${esc(s.id)}" aria-pressed="${on}" ${off ? 'disabled' : ''}><strong>${esc(s.label)}</strong><small>${esc(s.startsAt)}–${esc(s.endsAt)}${off ? ' · Full' : ''}</small>${on ? icon('check') : ''}</button>`
  }).join('')}</div>` : ''
  return `<p class="gift-muted">${icon('calendar')}<span>${GIFT_DAY_RULE} Order by ${cut} for the next day.</span></p><p class="gift-label" id="gift-date-l">Day</p><div class="date-cards" id="gift-dates" role="group" aria-labelledby="gift-date-l" tabindex="-1">${cards}</div>${slots}`
}

/** ", until Wed, 18 Nov, 3:45 pm" when the API says when the buyer's cancel closes (gift-routes.js cancelUntil). */
function giftCancelUntil(g) {
  const t = g.cancelUntil ? new Date(g.cancelUntil) : null
  return t && !Number.isNaN(t.getTime()) ? ` (until ${esc(t.toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }))})` : ''
}

function alertHTML() {
  if (gift.unpaid && gift.unpaid.pre) return `<div class="prototype-tag gift-alert" role="alert">${icon('info')}<span>You have an unpaid pre-order ${esc(orderNo(gift.unpaid.number || ''))}. Pay for it or cancel it first, then pre-order this gift.</span><button type="button" class="text-button" data-pre="view" data-id="${esc(gift.unpaid.preorderId || '')}">Open it</button></div>`
  if (gift.unpaid) return `<div class="prototype-tag gift-alert" role="alert">${icon('info')}<span>You have an unpaid order ${esc(orderNo(gift.unpaid.number || ''))}. Pay for it or cancel it in <a href="/orders" data-route>Your orders</a>, then send your gift.</span></div>`
  return gift.error ? `<div class="prototype-tag gift-alert" role="alert">${icon('info')}<span>${esc(gift.error)}</span></div>` : ''
}

/** The person's problems, in form order: [{ name, msg, pending }]. The address only when the giver types it. `strict`: a
 *  pincode that could not be checked is an error to act on, not a wait. */
function personProblems(strict) {
  const out = [], add = (name, msg, pending) => out.push({ name, msg, pending: !!pending })
  const r = gift.person, name = r.name.trim(), a = r.address.trim(), pin = r.pincode.trim()
  if (!name) add('gp-name', 'Enter their name')
  else if (name.length > 80) add('gp-name', 'Keep the name to 80 letters')
  const ph = giftPhoneWhy(r.phone)
  if (ph) add('gp-phone', ph)
  if (!askOf()) {
    if (!a) add('gp-address', 'Enter their house or flat, street and area')
    else if (a.length < 10) add('gp-address', 'Enter the full address: house, street and area')
    if (r.landmark.trim().length > GIFT_LANDMARK_MAX) add('gp-landmark', `Keep the landmark to ${GIFT_LANDMARK_MAX} letters`)
    if (!pin) add('gp-pincode', 'Enter the pincode')
    else if (!/^[1-9]\d{5}$/.test(pin)) add('gp-pincode', 'Enter a 6-digit pincode')
    else if (giftEnv.pins[pin] === false) add('gp-pincode', `We don’t deliver to ${pin} yet`)
    else if (giftEnv.pins[pin] !== true) {
      if (strict && giftEnv.pins[pin] !== 'checking') add('gp-pincode', 'We couldn’t check this pincode just now. Check your connection and try again.')
      else add('gp-pincode', `Checking the pincode ${pin}…`, true)
    }
  }
  return out
}

/** Every problem in the gift, in page order: [{ name, msg, pending }]. `name` is a field's name, or #id for a part. */
function giftProblems(strict) {
  const out = [], add = (name, msg, pending) => { if (!out.some((x) => x.name === name && x.msg === msg)) out.push({ name, msg, pending: !!pending }) }
  const max = giftMaxBoxes(), t = giftTotals()
  if (!gift.lines.length) add('#gift-their', 'Add at least one box: press Add more mangoes')
  else if (t.boxes > max) add('#gift-their', `A gift can hold up to ${max} boxes: take some out`)
  for (const l of gift.lines) {
    const p = packOf(l.sku)
    if (!p) { add('#gift-their', 'One of these boxes is no longer sold: take it out'); continue }
    if (stockKnown() && !anyQty(l.sku, l.stage)) add('#gift-their', `${stageOf(l.stage).stage} ${p.name} ${p.kg} is out of stock: take it out or choose the other ripeness`)
  }
  for (const x of personProblems(strict)) out.push(x)
  if (gift.note.length > GIFT_NOTE_MAX) add('gift-note', `Keep the note to ${GIFT_NOTE_MAX} letters`)
  // In season, stock on the chosen day for every box together.
  if (stockKnown() && gift.date) {
    for (const [key, qty] of giftNeed()) {
      const [sku, stage] = key.split('|'), left = dayQty(sku, stage, gift.date)
      if (left >= qty || !anyQty(sku, stage)) continue
      const p = packOf(sku)
      add('#gift-their', `Only ${left} ${stageOf(stage).stage.toLowerCase()} ${p.kg} ${p.name} ${left === 1 ? 'box is' : 'boxes are'} left on ${fmtDate(gift.date)}: choose another day or fewer boxes`)
    }
  }
  if (preSeason()) {
    if (gift.lines.length && !giftWeek()) add('#gift-their', 'No delivery week has room for all of these boxes together. Take a box out, or choose another.')
  } else if (gift.lines.length) {
    if (!giftEnv.dates.length) add('#gift-when', 'Add a pincode we deliver to, to choose the day', true)
    else if (!gift.date) add('#gift-dates', 'Choose the delivery day')
    else if (giftEnv.slots.length && !gift.slotId) add('#gift-slots', 'Choose the delivery time')
  }
  if (gift.business && giftBills() && !preSeason()) {
    if (gift.bizName.trim().length < 2) add('gift-biz-name', 'Enter the business name as on its GST certificate')
    const w = gstinWhy(gift.gstin)
    if (w) add('gift-gstin', w)
  }
  return out
}
const problemText = (p) => p.msg

/** The field errors on screen (kept across redraws until the field is fixed). */
function applyErrors() {
  const f = giftForm()
  if (!f) return
  for (const [name, msg] of Object.entries(gift.errors)) {
    if (name.startsWith('#')) continue
    const el = f.elements.namedItem(name)
    if (el && el.nodeType === 1) fieldError(el, msg)
  }
}
/** Shows (or clears) the error of one field from the current problems. */
function checkField(name, announce) {
  const f = giftForm(), el = f && f.elements.namedItem(name)
  if (!el || el.nodeType !== 1) return
  const p = giftProblems().find((x) => x.name === name && !x.pending)
  if (p) gift.errors[name] = p.msg
  else delete gift.errors[name]
  fieldError(el, p ? p.msg : '')
  if (p && announce) { const live = $('#gift-live'); if (live) live.textContent = problemText(p) }
}

/** The sticky bar. Screen 1: "Gift for one person", "3 boxes · 9 kg · ₹5,597", "Arrives together · week of 1 Mar" with
 *  the rule under it ("Everything arrives together, in the week of the box that’s ready last.") and "Next: who gets it" (off until there is a box). Screen 2: the pre-order tick (before the season), the same words, the
 *  total and Pay. Redrawn only when it changes, keeping the focus on the control in use; empty on every other step. */
let lastBar = ''
function giftBar() {
  if (!giftPage()) return
  const bar = $('#pay-bar'), mine = !!(bar && bar.querySelector('.gift-bar'))
  const pick = !gift.flow && !!$('#gift-grid') && giftEnv.ready && !giftGate(), form = gift.flow && gift.step === 'form' && !!$('#gift-form')
  if (!pick && !form) { lastBar = ''; if (mine) setBar(''); return }
  const t = giftTotals(), pres = !!preSeason()
  const words = pres ? giftWeekWords() : gift.date && form ? `on ${fmtDate(gift.date)}` : (() => { const d = gift.lines.length && giftEnv.dates.find((x) => dayFits(x)); return d ? `from ${fmtDate(d)}` : '' })()
  const when = pres && gift.lines.length && !words ? `<p class="gift-bar-when is-off">${icon('close')}<span>No week has room for all of these together</span></p>` : `<p class="gift-bar-when">${icon('calendar')}<span>Arrives together${words ? ` · ${esc(words)}` : ''}</span></p>`
  const capped = pick && t.boxes >= giftMaxBoxes() ? `${giftMaxBoxes()} boxes is the most one gift can hold. To send more, send a second gift.` : ''
  const hint = gift.barHint || capped ? `<p class="pay-bar-hint" role="status">${esc(gift.barHint || capped)}</p>` : ''
  let html
  if (pick) {
    const go = t.boxes > 0
    // CR2-06: the one-delivery rule sits right under the delivery week it explains.
    const rule = `<small class="gift-bar-rule">${pres ? GIFT_WEEK_RULE : GIFT_DAY_RULE}</small>`
    const whenRule = when.replace(/<\/span><\/p>$/, `${rule}</span></p>`).replace('class="gift-bar-when', 'class="gift-bar-when has-rule')
    html = `${hint}<div class="gift-bar is-pick"><div class="gift-bar-sum"><small>Gift for one person</small><strong>${esc(giftBarLine(t.boxes, t.kg))} · ${currency(t.total)}</strong></div>${whenRule}<button type="button" class="button primary pay-bar-go gift-next" data-gift-next${go ? '' : ' disabled aria-describedby="gift-next-why"'}><span>Next: who gets it</span>${icon('arrow')}</button>${go ? '' : '<p class="sr-only" id="gift-next-why">Add at least one box first.</p>'}</div>`
  } else {
    const agree = pres ? `<label class="gift-bar-agree"><input type="checkbox" name="gift-pre-agree-all"${gift.agree ? ' checked' : ''}${gift.busy ? ' disabled' : ''}><span>I understand it’s paid in full now and can’t be cancelled once paid, unless you delay it.</span></label>` : ''
    html = `${hint}<div class="gift-bar is-pay">${agree}<div class="pay-bar-row"><div class="pay-bar-total"><small>Gift for one person · ${esc(giftBarLine(t.boxes, t.kg))}</small>${when}<strong>${currency(t.total)}</strong></div><button type="button" class="button primary pay-bar-go" data-gift-pay${gift.busy || !t.boxes ? ' disabled' : ''}>${icon(gift.busy ? 'clock' : 'lock')}<span>${gift.busy ? (pres ? 'Booking…' : 'Placing…') : `Pay ${currency(t.total)}`}</span></button></div></div>`
  }
  if (html === lastBar && mine && !bar.hidden) return
  const a = document.activeElement, keep = a && bar && bar.contains(a) ? (a.name ? { name: a.name } : a.hasAttribute('data-gift-next') ? { 'data-gift-next': '' } : { 'data-gift-pay': '' }) : null
  lastBar = html
  setBar(html)
  if (keep && bar) refocus(bar, keep)
}

/** Redraws what follows from the lines (the cards, their gift, the chip, the day list and the bar), keeping the focus. */
function giftRefresh(focus) {
  if (gift.flow) {
    const their = $('#gift-their')
    if (their && gift.step === 'form') {
      const a = document.activeElement, sel = focus || (a && their.contains(a) && a.dataset.giftQty ? { 'data-gift-qty': a.dataset.giftQty, 'data-sku': a.dataset.sku, 'data-stage': a.dataset.stage } : null)
      their.outerHTML = theirGiftHTML()
      if (sel) refocus($('#gift-their'), sel)
    }
    const when = $('#gift-when')
    if (when) {
      const a = document.activeElement, sel = a && when.contains(a) && (a.dataset.giftDate ? { 'data-gift-date': a.dataset.giftDate } : a.dataset.giftSlot ? { 'data-gift-slot': a.dataset.giftSlot } : null)
      when.innerHTML = whenHTML()
      refocus(when, sel)
    }
  } else {
    const grid = $('#gift-grid'), a = document.activeElement
    const sel = focus || (a && grid && grid.contains(a) ? (a.dataset.giftQty ? { 'data-gift-qty': a.dataset.giftQty, 'data-sku': a.dataset.sku, 'data-stage': a.dataset.stage } : null) : null)
    renderGiftGrid(sel)
    renderGiftNotice()
  }
  giftBar()
  saveDraft()
}

const say = (t) => { const live = $('#gift-live'); if (live) { live.textContent = ''; setTimeout(() => { live.textContent = t }, 30) } }
/** Puts the focus on a field of the gift form (scrolled to the middle of the screen). */
function focusField(name) {
  const el = giftForm()?.elements.namedItem(name)
  if (!el || el.nodeType !== 1) return false
  el.scrollIntoView({ block: 'center', behavior: reduced ? 'instant' : 'smooth' })
  el.focus({ preventScroll: true })
  return true
}
function focusSel(sel, block = 'center') {
  const el = $(sel)
  if (!el) return
  el.scrollIntoView({ block, behavior: reduced ? 'instant' : 'smooth' })
  el.focus({ preventScroll: true })
}

/** "Next: who gets it": screen 2, everything kept, the focus on the first empty field (else the heading). */
function openForm() {
  if (giftGate() || !gift.lines.length) return
  if (gift.step !== 'form' && gift.step !== 'pay' && gift.step !== 'pre-pay') gift.step = 'form'
  if (!preSeason() && (!gift.date || !dayFits(gift.date))) gift.date = giftEnv.dates.find((d) => dayFits(d)) || gift.date
  setFlow(true)
  giftUrl('form')
  renderGiftSend()
  giftSlots()
  saveDraft()
  const empty = ['gp-name', 'gp-phone'].find((n) => !gift.person[n.slice(3)].trim())
  giftTop(empty ? `[name="${empty}"]` : null)
}
/** "+ Add more mangoes" (and "Back to the mangoes"): screen 1 again, the gift kept. */
function backToPick() {
  saveDraft()
  giftBackTo('pick', () => {
    setFlow(false)
    renderGiftGrid()
    renderGiftNotice()
    giftBar()
    focusSel('#gift-packs-h', 'start')
  })
}

/** "Order again" on a gift (reorder.js): that box in the gift (one, unless it is in already), and screen 2. */
function openSend(sku, stage) {
  if (giftGate() || !skuOf(sku)) return
  if (!lineOf(sku, stage)) gift.lines = giftAddLine(gift.lines, sku, stage, 1, giftMaxBoxes()).lines
  gift.step = 'form'
  openForm()
  say(`${boxLine(sku, stage)} is in the gift. Now tell us who gets it.`)
}

/** Pay on the sticky bar: every detail checked (the first mistake shown and focused), the pre-order tick, sign-in, then
 *  the booking (before the season) or the gift order (in season). */
async function giftCheckout() {
  if (gift.busy) return
  gift.error = ''
  gift.barHint = ''
  const pin = gift.person.pincode.trim()
  if (!askOf() && /^[1-9]\d{5}$/.test(pin) && giftEnv.pins[pin] !== true && giftEnv.pins[pin] !== false) await checkPin(pin)
  if (!giftPage() || gift.step !== 'form') return
  const probs = giftProblems(true), p = probs.find((x) => !x.pending) || probs[0]
  if (p) {
    if (p.pending) { gift.error = `${problemText(p)} Press Pay again in a moment.`; renderGiftSend(); $('#gift-alert')?.scrollIntoView({ block: 'center', behavior: reduced ? 'instant' : 'smooth' }); say(gift.error) } else fixProblem(p)
    return
  }
  if (preSeason() && !gift.agree) {
    gift.barHint = 'Tick the box to say you understand, then press Pay.'
    giftBar()
    focusSel('#pay-bar [name="gift-pre-agree-all"]')
    say(gift.barHint)
    return
  }
  if (!MM.profile()) {
    gift.wantPay = true
    saveDraft()
    setTimeout(() => go(`/login?next=${encodeURIComponent('/gifts/send')}`), 200)
    return
  }
  if (preSeason()) giftGroupBook()
  else giftPay()
}

/** Checks a pincode the way checkout does (GET /v1/delivery/check), once per pincode, and keeps its city; the promise
 *  settles when the answer is in. */
const pinWait = {}
function checkPin(pin) {
  if (giftEnv.pins[pin] === true || giftEnv.pins[pin] === false) return Promise.resolve()
  if (giftEnv.pins[pin] === 'checking' && pinWait[pin]) return pinWait[pin]
  giftEnv.pins[pin] = 'checking'
  return (pinWait[pin] = pinCheck(pin))
}
async function pinCheck(pin) {
  let ok
  try { const c = await MM.deliveryCheck(pin); ok = !!c.serviceable; if (ok && c.city) giftEnv.cities[pin] = c.city } catch { ok = undefined }
  giftEnv.pins[pin] = ok
  if (!giftPage()) return
  if (ok && !giftEnv.days) { await giftStock(pin); if (!gift.flow) renderGiftGrid() }
  if (gift.person.pincode.trim() === pin) {
    const label = $('#gift-form .gift-pin-field')
    if (label) {
      label.querySelector('.gift-pin')?.remove()
      if (ok === true) label.insertAdjacentHTML('beforeend', `<small class="field-hint gift-pin is-ok">${icon('check')}<span>We deliver to ${esc(pin)}</span></small>`)
    }
    const city = $('#gift-form [name="gp-city"]')
    if (city) city.value = ok === true ? giftEnv.cities[pin] || '' : ''
    if (ok === false || gift.errors['gp-pincode']) checkField('gp-pincode', ok === false)
  }
  giftSlots()
  giftRefresh()
}

/** The slots for the chosen day (the person's pincode when served, else the shop's; every served pincode has the same). */
async function giftSlots() {
  if (preSeason()) return
  const own = gift.person.pincode.trim(), pin = giftEnv.pins[own] === true ? own : giftEnv.catPin
  if (!pin || !gift.date) return
  const key = `${pin}|${gift.date}`
  if (giftEnv.slotsFor === key) return
  giftEnv.slotsFor = key
  try {
    const r = await MM.slots(pin, gift.date)
    if (giftEnv.slotsFor !== key) return
    giftEnv.slots = r.slots || []
    if (gift.slotId && !giftEnv.slots.some((s) => s.id === gift.slotId && s.available !== false)) gift.slotId = null
  } catch { giftEnv.slots = []; giftEnv.slotsFor = '' }
  if (giftPage()) giftRefresh()
}

// ---- Paying in season: quote (checked again by the API) → confirm (one Razorpay order) → pay.

const giftBody = () => ({ deliveryDate: gift.date, slotId: gift.slotId || null, recipients: [giftSeasonRecipient(gift.person, gift.lines, noteOf())] })

/** An API mistake: on the person's field when it is one, on "Their gift" for a box, else one line above the pay bar. */
const PERSON_FIELDS = { name: 'gp-name', phone: 'gp-phone', address: 'gp-address', pincode: 'gp-pincode', landmark: 'gp-landmark', recipientName: 'gp-name', recipientPhone: 'gp-phone' }
function markPersonError(field, msg) {
  if (PERSON_FIELDS[field]) gift.errors[PERSON_FIELDS[field]] = msg
  else if (['sku', 'stage', 'qty', 'lines', 'weekStart'].includes(field)) gift.errors['#gift-their'] = msg
  else if (field === 'note' || field === 'message') gift.errors['gift-note'] = msg
  else gift.error = msg
}

/** The API's answer, on the fields it names (RECIPIENTS_INVALID rows), else one line above the pay bar. */
function giftFailed(e) {
  gift.error = ''
  const x = e.extra || {}
  if (e.code === 'RECIPIENTS_INVALID' && Array.isArray(x.rows)) {
    for (const row of x.rows) markPersonError(row.field, row.message)
    gift.error ||= 'Some details need a look: they are marked below.'
  } else if (e.code === 'STOCK_INSUFFICIENT') {
    const p = packOf(x.sku)
    gift.error = `Not enough ${p ? `${p.name} ${p.kg}` : 'of one box'} boxes on ${fmtDate(gift.date)}. Choose fewer boxes or another day.`
    giftEnv.days = null
    if (giftEnv.catPin) giftStock(giftEnv.catPin).then(() => giftRefresh())
  } else if (e.code === 'HOLD_LIMIT') gift.error = `One order can hold up to ${x.maxHeldBoxes || 40} boxes at a time. Take some boxes out.`
  else if (e.code === 'UNPAID_ORDER_EXISTS') gift.unpaid = x
  else if (e.code === 'BILLS_OFF') { gift.business = false; gift.error = 'Business details for the bill are not taken at the moment. Pay without them.' }
  else if (e.code === 'VALIDATION_ERROR' && /^business\.(name|gstin)/.test(e.message)) {
    const field = /^business\.gstin/.test(e.message) ? 'gift-gstin' : 'gift-biz-name'
    gift.errors[field] = e.message.replace(/^business\.\w+:\s*/, '')
  } else if (e.code === 'NOT_SERVICEABLE') gift.errors['gp-pincode'] = 'We don’t deliver to this pincode yet'
  else if (e.status === 404) gift.error = 'Gifting isn’t open right now. Please try again later.'
  else if (e.code === 'SLOT_FULL' || e.code === 'SLOT_REQUIRED' || e.code === 'SLOT_INVALID') { gift.slotId = null; giftEnv.slotsFor = ''; gift.error = e.code === 'SLOT_FULL' ? 'That time just filled up. Choose another.' : 'Choose the delivery time.'; giftSlots() }
  else if (['INVALID_DATE', 'NO_DELIVERY_DAY', 'DATE_CLOSED', 'DATE_FULL'].includes(e.code)) { gift.error = orderError(e); giftEnv.days = null; gift.date = null; if (giftEnv.catPin) giftStock(giftEnv.catPin).then(() => { giftEnv.slotsFor = ''; giftSlots(); giftRefresh() }) }
  else gift.error = orderError(e)
}

/** In season, Pay (giftCheckout has checked everything): quote, then confirm (one Razorpay order), then pay. */
async function giftPay() {
  if (gift.busy || preSeason()) return
  gift.busy = true
  gift.error = ''
  gift.unpaid = null
  renderGiftSend()
  const before = giftTotals().total
  let c = null
  try {
    let q = await MM.giftQuote(giftBody())
    if (Math.round(q.total) !== Math.round(before)) {
      gift.error = `The total is now ${currency(q.total)}. Check it and press Pay again.`
      return
    }
    gift.key ??= MM.idem()['Idempotency-Key']
    const body = () => ({ quoteId: q.quoteId, ...(gift.sender.trim() ? { name: gift.sender.trim() } : {}), ...(gift.business && giftBills() ? { business: { name: gift.bizName.trim(), gstin: gift.gstin.replace(/\s+/g, '').toUpperCase() } } : {}) })
    let requoted = false, starting = 0
    for (;;) {
      try { c = await MM.giftConfirm(body(), gift.key); break } catch (e) {
        if (e.code === 'PAYMENT_STARTING' && starting < 5) { starting++; await wait(2000); continue }
        if (e.code === 'QUOTE_EXPIRED' && !requoted) { requoted = true; gift.key = MM.idem()['Idempotency-Key']; q = await MM.giftQuote(giftBody()); continue }
        if (e.code === 'PRICE_CHANGED') { gift.error = e.message; await loadProducts(); return }
        throw e
      }
    }
  } catch (e) {
    if (e.status === 401) { gift.wantPay = true; saveDraft(); go(`/login?next=${encodeURIComponent('/gifts/send')}`); return }
    giftFailed(e)
  } finally {
    gift.busy = false
    if (!c && giftPage() && $('#gift-send') && gift.step !== 'pay') {
      renderGiftSend()
      focusFirstError()
    }
  }
  if (!c) return
  gift.key = null
  gift.pay = { id: c.giftOrderId, number: c.number, total: c.total, deliveryDate: c.deliveryDate, people: c.recipientCount, razorpayKeyId: c.razorpayKeyId, razorpayOrderId: c.razorpayOrderId, holdExpiresAt: c.holdExpiresAt }
  gift.step = 'pay'
  renderGiftSend({ 'data-gift-pay-now': '1' })
  $('#gift-send')?.scrollIntoView({ block: 'start', behavior: reduced ? 'instant' : 'smooth' })
  if (c.razorpayKeyId) giftRazorpay()
}

function giftPayHTML() {
  const p = gift.pay, slot = giftEnv.slots.find((s) => s.id === gift.slotId)
  return `<div class="co-pay gift-pay"><p class="co-pay-no">Gift order <strong>${esc(giftNo(p.number))}</strong></p><p class="co-pay-total">${currency(p.total)}</p><p class="gift-pay-for">For ${esc(whoOf())} · ${plural(giftTotals().boxes, 'box', 'boxes')} together · delivered ${esc(fmtDate(p.deliveryDate))}${slot ? `, ${esc(slot.label)}` : ''}</p>${p.failed ? (typeof payStateHTML === 'function' ? payStateHTML({ status: 'PAYMENT_PENDING', paymentFailed: true, holdExpiresAt: p.holdExpiresAt }) : '') : `<p class="co-pay-hold">${icon('box')}<span>Every box is held for you until <strong>${fmtTime(p.holdExpiresAt)}</strong>. Pay before then to confirm.</span></p>`}${gift.error ? `<p class="prototype-tag" role="alert">${esc(gift.error)}</p>` : ''}${p.razorpayKeyId
    ? `<button type="button" class="button primary full" data-gift-rzp data-gift-pay-now="1" ${gift.busy ? 'disabled' : ''}>${p.failed ? 'Try payment again' : 'Pay'} ${currency(p.total)} ${icon('arrow')}</button>`
    : `<div class="prototype-tag">Test mode: no payment service is connected, so no money is taken.</div><button type="button" class="button primary full" data-gift-testpay data-gift-pay-now="1" ${gift.busy ? 'disabled' : ''}>${p.failed ? 'Try payment again (test)' : 'Pay (test)'} ${icon('arrow')}</button><button type="button" class="text-button" data-gift-testfail ${gift.busy ? 'disabled' : ''}>Fail payment (test)</button>`}${gift.busy ? '<p class="form-footer" role="status">Confirming your payment…</p>' : ''}<a class="text-button" href="/gifts/${encodeURIComponent(p.id)}" data-route>View gift order ${icon('arrow')}</a></div>`
}

/** Razorpay Checkout for the one payment (the same script and window as checkout; the gift's own verify route). */
async function giftRazorpay(p = gift.pay, after) {
  try { await loadScript(RAZORPAY) } catch { gift.error = 'We couldn’t open the payment window. Check your connection and try again.'; if (!after) renderGiftSend(); else toast(gift.error); return }
  let failedTry = false
  const rz = new window.Razorpay({
    key: p.razorpayKeyId, order_id: p.razorpayOrderId, amount: Math.round(p.total * 100), currency: 'INR', name: 'VMR Mangoes', description: 'Gift order ' + giftNo(p.number),
    prefill: { contact: MM.profile()?.phone || '' }, timeout: Math.max(1, Math.floor((Date.parse(p.holdExpiresAt) - Date.now()) / 1000)),
    handler: async (reply) => {
      gift.busy = true
      if (!after) renderGiftSend()
      try { await MM.giftVerify(p.id, reply) } catch {}
      await giftSettle(p.id)
    },
    modal: {
      ondismiss: () => {
        // A failed attempt: the failed state with Try payment again (the flow's pay step, or the gift order page).
        if (failedTry) { if (!after && gift.step === 'pay') { p.failed = true; gift.error = ''; renderGiftSend() } else if (after) giftOrderView(p.id, true); return }
        if (!after && gift.step === 'pay') { gift.error = `Payment window closed. Your boxes are held until ${fmtTime(p.holdExpiresAt)}.`; renderGiftSend() }
      },
    },
  })
  rz.on('payment.failed', () => { failedTry = true })
  rz.open()
}

/** Test mode only: a failed payment attempt (the API's gift demo-pay route with outcome failed, as Razorpay's payment.failed would). */
async function giftTestFail(id, after) {
  try { await MM.demoPayGift(id, 'failed') } catch (e) { toast(e.message); return }
  if (after) { giftOrderView(id, true); return }
  if (gift.pay) gift.pay.failed = true
  gift.busy = false
  gift.error = ''
  renderGiftSend()
}

/** The test payment (DEMO_PAYMENTS or a developer's machine: the API's gift demo-pay route, as the Razorpay webhook would). */
async function giftTestPay(id, after) {
  gift.busy = true
  if (!after) renderGiftSend()
  try { await MM.demoPayGift(id, 'captured') } catch (e) { gift.busy = false; gift.error = e.message; if (!after) renderGiftSend(); else toast(e.message); return }
  await giftSettle(id)
}

/** Waits for the payment to land, then opens the gift order with its confirmation. */
async function giftSettle(id) {
  let g = null
  for (let i = 0; i < 20; i++) {
    try { g = await MM.gift(id) } catch { g = null }
    if (g && g.paymentStatus !== 'INITIATED') break
    await wait(1500)
  }
  gift.busy = false
  if (g && g.paymentStatus === 'SUCCEEDED') {
    gift = giftFresh()
    dropDraft()
    go(`/gifts/${encodeURIComponent(id)}?paid=1`, { replace: true })
  } else {
    toast(g && g.paymentStatus === 'FAILED' ? 'Payment didn’t go through.' : 'We’re still confirming your payment.')
    go(`/gifts/${encodeURIComponent(id)}`)
  }
}

/** After the API said no: the focus on the first marked field, else the message above the bar. */
function focusFirstError() {
  const bad = $('#gift-form [aria-invalid="true"]')
  if (bad) { bad.scrollIntoView({ block: 'center', behavior: reduced ? 'instant' : 'smooth' }); bad.focus({ preventScroll: true }) }
  else $('#gift-alert')?.scrollIntoView({ block: 'center', behavior: reduced ? 'instant' : 'smooth' })
}

/** Shows one problem where it is: the field (with the person's other mistakes), "Their gift", or the part of the page. */
function fixProblem(p) {
  if (!p) return
  gift.step = 'form'
  if (p.name.startsWith('gp-')) {
    for (const x of personProblems(true).filter((x) => !x.pending)) gift.errors[x.name] = x.msg
    if (!p.pending) gift.errors[p.name] = p.msg
    renderGiftSend()
    focusField(p.name)
    say(problemText(p))
    return
  }
  if (p.name === '#gift-their') {
    gift.errors['#gift-their'] = p.msg
    renderGiftSend()
    focusSel('#gift-their')
    say(p.msg)
    return
  }
  if (p.name.startsWith('#') || p.name.startsWith('[')) {
    gift.error = p.msg
    renderGiftSend()
    const el = $(p.name)
    if (el) { el.scrollIntoView({ block: 'center', behavior: reduced ? 'instant' : 'smooth' }); ((el.querySelector && el.querySelector('button:not([disabled])')) || el).focus({ preventScroll: true }) }
    say(p.msg)
    return
  }
  if (!p.pending) gift.errors[p.name] = p.msg
  renderGiftSend()
  focusField(p.name)
  say(problemText(p))
}

// ---- Before the season: book (POST /v1/preorders/groups), pay once, done.

/** The API's answer to the booking: on the person's field or "Their gift", the unpaid pre-order, or one line above Pay. */
async function giftPreFailed(e) {
  gift.error = ''
  const x = e.extra || {}
  if (!e.status || e.status >= 500) { gift.error = e.message || 'Something went wrong. Nothing was charged: try again.'; return }
  gift.key = null
  const field = String(e.message || '').match(/^recipients\.(\d+)\.(?:gift\.)?(\w+)/)
  if (e.code === 'UNPAID_PREORDER_EXISTS') gift.unpaid = { ...x, pre: true }
  else if (e.code === 'GIFT_TOO_MANY_BOXES') gift.errors['#gift-their'] = `A gift can hold up to ${x.maxBoxes || giftMaxBoxes()} boxes: take some out.`
  else if (e.code === 'PREORDER_TOO_BIG') {
    await loadWeeks().catch(() => {})
    gift.errors['#gift-their'] = `${e.message.replace(/^Box line \d+ \([^)]*\):\s*/, '')} Nothing was charged.`
  } else if (e.code === 'PREORDER_FULL' || e.code === 'PREORDER_WEEK_CHANGED' || e.code === 'INVALID_WEEK') {
    await loadWeeks().catch(() => {})
    const w = giftWeek()
    gift.error = `${e.code === 'PREORDER_WEEK_CHANGED' ? 'An earlier week has room again' : 'That week just filled up'}${w ? `: the whole gift now arrives in the week of ${fmtWeek(w)}` : ''}. Check it and pay again. Nothing was charged.`
  } else if (e.code === 'RECIPIENTS_INVALID' && Array.isArray(x.rows)) {
    for (const row of x.rows) markPersonError(row.field, row.message)
    gift.error ||= 'Some details need a look: they are marked below.'
  } else if (field) {
    markPersonError(field[2], e.message.replace(/^[^:]+:\s*/, ''))
    gift.error ||= 'Some details need a look: they are marked below.'
  } else if (e.code === 'NOT_SERVICEABLE') gift.errors['gp-pincode'] = 'We don’t deliver to this pincode yet'
  else if (e.status === 404) gift.error = 'Gifting isn’t open right now. Please try again later.'
  else gift.error = preError(e) || e.message
}

/** Before the season, Pay (giftCheckout has checked everything): one booking per box line, all in the gift's one week,
 *  one payment (POST /v1/preorders/groups with oneDelivery), then the payment link (or the test payment). */
async function giftGroupBook() {
  if (gift.busy) return
  const week = giftWeek()
  if (!gift.agree || !week || !gift.lines.length) return
  gift.busy = true
  gift.error = ''
  gift.unpaid = null
  renderGiftSend()
  gift.key ??= MM.idem()['Idempotency-Key']
  const body = {
    ...(gift.sender.trim() ? { name: gift.sender.trim() } : {}),
    oneDelivery: true,
    recipients: gift.lines.map((l) => giftGroupLine(gift.person, l, week, askOf(), noteOf())),
  }
  let g = null
  try {
    for (let i = 0; ; i++) {
      try { g = await MM.bookPreorderGroup(body, gift.key); break } catch (e) { if (e.code === 'PAYMENT_STARTING' && i < 5) { await wait(2000); continue } throw e }
    }
  } catch (e) {
    gift.busy = false
    if (e.status === 401) { gift.wantPay = true; saveDraft(); go(`/login?next=${encodeURIComponent('/gifts/send')}`); return }
    await giftPreFailed(e)
    if (giftPage()) {
      gift.step = 'form'
      renderGiftSend()
      focusFirstError()
    }
    return
  }
  gift.busy = false
  gift.key = null
  gift.error = ''
  gift.group = g
  for (const p of g.preorders || []) rememberGift(p.id)
  gift.step = 'pre-pay'
  renderGiftSend()
  $('#gift-send')?.scrollIntoView({ block: 'start', behavior: reduced ? 'instant' : 'smooth' })
  if (realUrl(g.paymentUrl)) window.location.assign(g.paymentUrl)
}

const groupWeeks = (g) => (g.preorders || []).filter((p) => p.status !== 'CANCELLED').map((p) => p.weekStart)

function giftPrePayHTML() {
  const g = gift.group
  if (!g) return ''
  const pay = realUrl(g.paymentUrl)
    ? `<a class="button primary full" href="${esc(g.paymentUrl)}">${g.paymentFailed ? 'Try payment again' : 'Pay'} ${currency(g.total)} ${icon('arrow')}</a>`
    : `<div class="prototype-tag">Test mode: no payment service is connected, so no money is taken.</div><button type="button" class="button primary full" data-gift-pre-testpay ${gift.busy ? 'disabled aria-describedby="gift-pre-paying"' : ''}>${icon(gift.busy ? 'clock' : 'sun')}<span>${g.paymentFailed ? 'Try payment again (test)' : 'Pay (test)'} ${currency(g.total)}</span></button><button type="button" class="text-button" data-gift-pre-testfail ${gift.busy ? 'disabled' : ''}>Fail payment (test)</button>${gift.busy ? `<p class="pre-why" id="gift-pre-paying" role="status">${icon('clock')}<span>Confirming your payment…</span></p>` : ''}`
  return `<div class="co-pay gift-pay gift-pre-pay"><p class="gift-pre-chips"><span class="pre-chip">${icon('sun')}Pre-order</span><span class="pre-chip gift-chip">${icon('gift')}Gift</span></p><p class="co-pay-no">Gift pre-order <strong>${esc(giftNo(g.number))}</strong></p><p class="co-pay-total">${currency(g.total)}</p><p class="gift-pay-for">${g.oneDelivery ? `For ${esc(groupWho(g))} · ${plural(g.boxes, 'box', 'boxes')} together` : `${plural(g.recipientCount, 'person', 'people')} · ${plural(g.boxes, 'box', 'boxes')}`} · one payment</p>
    ${preChipHTML(esc(giftWhen(groupWeeks(g))))}
    ${g.paymentFailed ? (typeof payStateHTML === 'function' ? payStateHTML({ status: 'PAYMENT_PENDING', paymentFailed: true, holdExpiresAt: g.holdExpiresAt }) : '') : `<p class="co-pay-hold">${icon('box')}<span>${g.oneDelivery ? 'The week is' : 'Each person’s week is'} held for you until <strong>${fmtTime(g.holdExpiresAt)}</strong>. Pay before then to book it.</span></p>`}
    ${gift.error ? `<p class="prototype-tag" role="alert">${esc(gift.error)}</p>` : ''}${pay}
    <button type="button" class="text-button" data-gift-pre-cancel ${gift.busy ? 'disabled' : ''}>Cancel this gift pre-order</button></div>`
}

/** The test payment (DEMO_PAYMENTS or a developer's machine: the API's pre-order demo-pay route, as the Razorpay webhook would): any booking of
 *  the group pays the whole group. */
async function giftPreTestPay() {
  const g = gift.group
  if (!g || gift.busy) return
  gift.busy = true
  gift.error = ''
  renderGiftSend()
  try { await MM.demoPayPreorder(g.leadId, 'captured') } catch (e) { gift.busy = false; gift.error = e.message; renderGiftSend(); return }
  let paid = null
  for (let i = 0; i < 10; i++) {
    try { paid = await MM.preorderGroup(g.id) } catch { paid = null }
    if (paid && paid.paymentStatus === 'SUCCEEDED') break
    await wait(1000)
  }
  if (!giftPage()) return
  if (paid && paid.paymentStatus === 'SUCCEEDED') {
    gift = giftFresh()
    dropDraft()
    gift.group = paid
    gift.step = 'pre-done'
    giftUrl('done', true)
    gift.flow = true
  } else {
    gift.busy = false
    gift.error = 'We’re still confirming your payment. Your pre-orders show in Your orders.'
  }
  renderGiftSend()
  $('#gift-send')?.scrollIntoView({ block: 'start', behavior: reduced ? 'instant' : 'smooth' })
}

/** Test mode only: a failed attempt on the group's one payment (pre-order demo-pay, outcome failed); the step then says so. */
async function giftPreTestFail() {
  const g = gift.group
  if (!g || gift.busy) return
  try { await MM.demoPayPreorder(g.leadId, 'failed') } catch (e) { toast(e.message); return }
  try { gift.group = await MM.preorderGroup(g.id) } catch {}
  // The step now says the attempt failed: an older error (one from before this attempt) would only confuse it.
  gift.error = ''
  if (giftPage()) renderGiftSend()
}

async function giftPreCancel(b) {
  const g = gift.group
  if (!g || !window.confirm(`Cancel gift pre-order ${giftNo(g.number)}${g.oneDelivery ? '' : ` for ${plural(g.recipientCount, 'person', 'people')}`}? Nothing is charged.`)) return
  b.disabled = true
  try { await MM.cancelPreorder(g.leadId); toast(`Gift pre-order ${giftNo(g.number)} cancelled`) } catch (e) { toast(e.message); b.disabled = false; return }
  gift.group = null
  gift.step = 'form'
  // The booking is gone: an error about paying for it (a failed or refused test payment) no longer applies.
  gift.error = ''
  gift.busy = false
  saveDraft()
  renderGiftSend()
}

function giftPreDoneHTML() {
  const g = gift.group
  if (!g) return ''
  return `<div class="success gift-done gift-pre-done">${icon('check')}<p class="gift-pre-chips"><span class="pre-chip">${icon('sun')}Pre-order</span><span class="pre-chip gift-chip">${icon('gift')}Gift</span></p><h2>Gift pre-order <span class="no-wrap">${esc(giftNo(g.number))}</span> is booked.</h2><p>${g.oneDelivery ? `${esc(groupWho(g))} gets ${plural(g.boxes, 'box', 'boxes')}, all together, in the ${esc(giftWhen(groupWeeks(g)))}.` : `${plural(g.recipientCount, 'person gets', 'people get')} their own pre-order.`} Paid once: <strong>${currency(g.total)}</strong>.</p></div>
    ${giftGroupBodyHTML(g, true)}
    <button type="button" class="text-button" data-gift-again>Send another gift ${icon('arrow')}</button>`
}

/** When a link may go again: `resendAfter` is a time, or seconds from now. */
const resendAt = (l) => giftResendAt(l)
const whenWords = (t) => (t ? new Date(t).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '')

/** One person's address, as the giver sees it: typed by the giver at booking, asked of them on WhatsApp (when the link
 *  went, "Send link" again, and the message they get), or given by them. */
function giftAddrHTML(g, p) {
  const st = p.addressState, l = p.addressLink || null
  if (p.status === 'CANCELLED') return ''
  if (st === 'ADDRESS_GIVEN') return `<p class="gift-addr-status is-done">${icon('check')}<span><strong>Address received</strong>${p.pincode ? ` · ${esc(p.pincode)}` : ''}</span></p>`
  if (st !== 'ADDRESS_PENDING') return ''
  const at = resendAt(l), wait = l && l.canResend === false, whyId = `gift-link-why-${p.id}`
  const sent = l && l.sentAt ? `Link sent ${esc(whenWords(l.sentAt))}${l.sendCount > 1 ? ` (${l.sendCount} times)` : ''}` : 'We send the link once the payment is in'
  const until = l && l.expiresAt ? ` · it works until ${esc(whenWords(l.expiresAt))}` : ''
  const why = wait ? `<small class="gift-link-why" id="${esc(whyId)}">${at ? `You can send it again at ${esc(fmtTime(at))}` : 'It can’t be sent again'}</small>` : ''
  const btn = g.paymentStatus === 'SUCCEEDED' ? `<button type="button" class="button secondary gift-link-btn" data-gift-link="${esc(p.id)}" data-gift-group="${esc(g.id)}"${wait ? ` disabled aria-describedby="${esc(whyId)}"` : ''} aria-label="Send the address link to ${esc(p.gift ? p.gift.recipientName : 'them')} again">${icon('mail')}<span>Send link</span></button>${why}` : ''
  const preview = p.addressMessage ? `<details class="gift-wa-preview"><summary>Their WhatsApp message</summary><p>${esc(p.addressMessage)}</p></details>` : ''
  return `<div class="gift-addr-status is-waiting">${icon('clock')}<div><p id="gift-addr-${esc(p.id)}" tabindex="-1"><strong>Waiting for their address</strong><small>${sent}${until}</small></p><div class="gift-link-row">${btn}</div>${preview}</div></div>`
}

/** Who a gift for one person goes to (its first booking's recipient). */
const groupWho = (g) => { const p = (g.preorders || [])[0]; return (p && p.gift && p.gift.recipientName) || 'them' }

/** A gift pre-order's boxes and where they go (the done screen and /gifts/pre/:id). A gift for one person (oneDelivery):
 *  the person, their address and landmark (or the address status), and every box, arriving together. One booked before
 *  change request 02 for several people: each person with their box, week and address. */
function giftGroupBodyHTML(g, paid) {
  const asked = (g.preorders || []).some((p) => p.addressState === 'ADDRESS_PENDING' && p.status !== 'CANCELLED')
  const askNote = asked ? `<p class="gift-muted">${icon('mail')}<span>We’ve asked on WhatsApp for the address${g.oneDelivery ? '' : 'es you didn’t enter'}. If it is still missing 5 days before the week, we remind them and tell you.</span></p>` : ''
  const find = `<p class="gift-find">${icon('box')}<span>Find ${g.oneDelivery ? 'it' : 'each one'} in <a href="/orders" data-route>Your orders</a>, marked “Pre-order” and “Gift”.</span></p>`
  if (g.oneDelivery) {
    const list = g.preorders || [], first = list[0] || {}, live = list.filter((p) => p.status !== 'CANCELLED')
    const linked = list.find((p) => p.addressLink) || list.find((p) => p.addressState) || first
    const where = first.address ? `<small>Delivering to ${esc(first.address)}${first.pincode ? ` · ${esc(first.pincode)}` : ''}${landmarkText(first)}</small>` : ''
    const rows = list.map((p) => `<li class="gift-review-row${p.status === 'CANCELLED' ? ' is-cancelled' : ''}">${thumb(p.sku, p.stage, p.productName)}<div><strong>${esc(boxName(p.productName, p.sku))}</strong><small>${stageOf(p.stage).stage} · ${plural(p.qty, 'box', 'boxes')} · ${currency(p.total)}</small><small>Pre-order ${esc(orderNo(p.number))} · ${esc(PRE_STATUS[p.status] || p.status)}</small></div></li>`).join('')
    return `${preChipHTML(esc(giftWhen(groupWeeks(g))), paid)}
    ${askNote}
    <div class="gift-group-who">${icon('user')}<div><strong>${esc(groupWho(g))}</strong>${where}${giftAddrHTML(g, linked)}</div></div>
    <p class="gift-together">${icon('calendar')}<span><strong>${plural(live.reduce((n, p) => n + p.qty, 0), 'box arrives', 'boxes arrive')} together</strong><small>${GIFT_WEEK_RULE}</small></span></p>
    <ol class="gift-review">${rows}</ol>
    ${find}`
  }
  const rows = (g.preorders || []).map((p) => `<li class="gift-review-row">${thumb(p.sku, p.stage, p.productName)}<div><strong>${esc(p.gift ? p.gift.recipientName : '')}</strong><small>${esc(boxName(p.productName, p.sku))} · ${stageOf(p.stage).stage} · ${plural(p.qty, 'box', 'boxes')}</small><small class="gift-review-week">${icon('calendar')}<span>Delivered in ${preWeekText(p.weekStart)}</span></small><small>Pre-order ${esc(orderNo(p.number))} · ${esc(PRE_STATUS[p.status] || p.status)}</small>${giftAddrHTML(g, p)}</div></li>`).join('')
  return `${preChipHTML(esc(giftWhen(groupWeeks(g))), paid)}
    ${askNote}
    <ol class="gift-review">${rows}</ol>
    ${find}`
}

/** /gifts/pre/:id: a gift pre-order for several people, opened again later (from Your orders). */
async function giftGroupView(id, quiet = false) {
  document.title = 'Your gift pre-order · VMR Mangoes'
  if (!quiet) host().innerHTML = pageHead('Your gift pre-order') + '<section class="page-card gift-group-view" id="gift-group-view" aria-busy="true"><p class="gift-muted">Loading…</p></section>'
  let g
  try { g = await MM.preorderGroup(id) } catch (e) {
    const box = $('#gift-group-view')
    if (box) { box.removeAttribute('aria-busy'); box.innerHTML = `<p class="prototype-tag" role="alert">${esc(e.status === 404 ? 'We couldn’t find this gift pre-order.' : e.message)}</p><a class="text-button" href="/orders" data-route>All orders ${icon('arrow')}</a>` }
    return
  }
  const box = $('#gift-group-view')
  if (!box) return
  box.removeAttribute('aria-busy')
  const paid = g.paymentStatus === 'SUCCEEDED'
  box.innerHTML = `<div class="gift-group-top"><p class="gift-pre-chips"><span class="pre-chip">${icon('sun')}Pre-order</span><span class="pre-chip gift-chip">${icon('gift')}Gift</span></p><h2>Gift pre-order <span class="no-wrap">${esc(giftNo(g.number))}</span></h2><p>${g.oneDelivery ? `For ${esc(groupWho(g))}` : plural(g.recipientCount, 'person', 'people')} · ${plural(g.boxes, 'box', 'boxes')} · ${currency(g.total)}${paid ? ', paid' : ', not paid yet'}</p></div>${giftGroupBodyHTML(g, paid)}`
}

/** "Send link": the address link goes to that person again on WhatsApp; the status is read again after. */
async function giftSendLink(b) {
  const gid = b.dataset.giftGroup, pid = b.dataset.giftLink
  b.disabled = true
  try {
    await MM.api(`/preorders/groups/${encodeURIComponent(gid)}/preorders/${encodeURIComponent(pid)}/send-link`, { method: 'POST', body: {}, auth: true })
    toast('Sent. They’ll get the link on WhatsApp in a moment.')
  } catch (e) {
    const s = e.extra && Number(e.extra.retryAfter)
    toast(e.code === 'RESEND_TOO_SOON' ? `You can send it again in ${Math.max(1, Math.ceil((s || 60) / 60))} min.` : e.code === 'RESEND_LIMIT' ? 'The link has been sent as many times as it can be. Ask them to look for our earlier message.' : e.code === 'ADDRESS_GIVEN' ? 'They’ve just given their address.' : e.message)
  }
  try {
    const g = await MM.preorderGroup(gid)
    if (gift.group && gift.group.id === gid && gift.step === 'pre-done') { gift.group = g; renderGiftSend() }
    else if ($('#gift-group-view')) await giftGroupView(gid, true)
    // The button is held for a while after a send: the focus goes to that person's status, which says until when.
    const btn = $(`[data-gift-link="${CSS.escape(pid)}"]`)
    if (btn && !btn.disabled) btn.focus()
    else $(`#gift-addr-${CSS.escape(pid)}`)?.focus()
  } catch { b.disabled = false }
}

// ---- One gift order (/gifts/:id): the confirmation after paying, and where the buyer finds it later.

const GIFT_STATUS = { PAYMENT_PENDING: 'Awaiting payment', PAID: 'Paid', CANCELLED: 'Cancelled' }

async function giftOrderView(id, quiet = false) {
  document.title = 'Your gift order · VMR Mangoes'
  const seq = quiet ? giftSeq : ++giftSeq, body = $('#page-body')
  if (!quiet) body.innerHTML = pageHead('Your gift order') + `<div class="page-card"><p>Loading your gift order…</p></div>`
  let g
  try { g = await MM.gift(id) } catch (e) {
    if (seq !== giftSeq || !giftPage() || quiet) return
    body.innerHTML = pageHead('Your gift order') + `<div class="page-card"><p class="prototype-tag" role="alert">${esc(e.status === 401 ? 'Please sign in again to see your gift order.' : e.status === 404 ? 'We couldn’t find this gift order. It may belong to another account.' : e.message)}</p><a class="text-button" href="/orders" data-route>All orders ${icon('arrow')}</a></div>`
    return
  }
  if (seq !== giftSeq || !giftPage()) return
  const paidNow = new URLSearchParams(location.search).has('paid') && g.status === 'PAID'
  const slot = g.slot ? `${g.slot.label} (${g.slot.startsAt}–${g.slot.endsAt})` : ''
  const when = `${fmtDate(g.deliveryDate)}${slot ? `, ${slot}` : ''}`
  const live = g.recipients.filter((r) => r.status !== 'CANCELLED')
  const left = g.holdExpiresAt ? Date.parse(g.holdExpiresAt) - Date.now() : 0
  const canPay = g.status === 'PAYMENT_PENDING' && g.paymentStatus === 'INITIATED' && left > 30000
  const hero = paidNow
    ? `<div class="success paid gift-done">${paidMark()}<span class="pre-chip gift-chip">${icon('gift')}Gift</span><h2>Gift order <span class="no-wrap">${esc(giftNo(g.number))}</span> confirmed.</h2><p>${g.recipientCount === 1 ? `${esc(live[0] ? live[0].name || 'They' : 'They')} ${live[0] ? 'gets' : 'get'} everything together on <strong>${esc(when)}</strong>.` : `${plural(live.length, 'person gets', 'people get')} their own delivery on <strong>${esc(when)}</strong>.`} We’ll send you updates on WhatsApp.</p><p class="gift-find">${icon('box')}<span>Find this gift order any time in <a href="/orders" data-route>Your orders</a>, marked “Gift”.</span></p></div>`
    : ''
  const statusLine = g.status === 'CANCELLED'
    ? (g.cancelReason === 'HOLD_EXPIRED' ? 'Cancelled: the payment didn’t arrive in time, so the boxes went back on sale. Nothing was charged.' : 'Cancelled.')
    : g.status === 'PAYMENT_PENDING' ? `Awaiting payment. The boxes are held until ${fmtTime(g.holdExpiresAt)}.` : `Paid${g.paidAt ? ` on ${new Date(g.paidAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}.`
  const people = g.recipients.map((r) => {
    const refund = r.refundStatus === 'REFUNDED' || r.refundStatus === 'PENDING' ? `Refund of ${currency(r.total)} is on its way (usually 5 to 7 working days)` : ''
    // Every box line of this person's one delivery (change request 02); an older API: the one box.
    const lines = Array.isArray(r.lines) && r.lines.length ? r.lines : [{ sku: r.sku, stage: r.stage, qty: r.qty, boxName: r.boxName }]
    const boxes = lines.map((l) => { const p = packOf(l.sku); return `${esc(p ? `${p.name} · ${p.kg}` : l.boxName || '')} · ${esc(stageOf(l.stage).stage)} · ${plural(l.qty, 'box', 'boxes')}` })
    return `<li class="gift-rcpt${r.status === 'CANCELLED' ? ' is-cancelled' : ''}">
      ${r.sku ? thumb(r.sku, r.stage, r.boxName) : ''}
      <div class="gift-rcpt-copy">
        <p class="gift-rcpt-top"><strong>${esc(r.name || `Person ${r.position}`)}</strong><span class="gift-status is-${esc(String(r.status).toLowerCase())}">${esc(STATUS[r.status] || r.status)}</span></p>
        ${boxes.map((b, i) => `<small>${b}${i === boxes.length - 1 ? ` · ${currency(r.total)}` : ''}</small>`).join('')}
        <small>${esc(r.address || '')}${r.pincode ? ` · ${esc(r.pincode)}` : ''}${landmarkText(r)}${r.phone ? ` · ${esc(String(r.phone).replace(/^\+91/, '+91 '))}` : ''}</small>
        ${r.note ? `<blockquote class="gift-rcpt-note">“${esc(r.note)}”</blockquote>` : ''}
        ${refund ? `<small class="gift-refund">${icon('check')}<span>${esc(refund)}</span></small>` : ''}
        ${r.cancellable ? `<button type="button" class="text-button gift-cancel-one" data-gift-cancel-one="${esc(r.orderId)}" data-gift="${esc(g.id)}" data-name="${esc(r.name || '')}" data-amount="${esc(currency(r.total))}">Cancel this delivery</button>` : ''}
      </div>
    </li>`
  }).join('')
  const testPay = canPay && !g.razorpayKeyId
  body.innerHTML = pageHead(`Gift order ${esc(giftNo(g.number))}`) + hero + `
    <div class="page-card gift-order">
      <p class="gift-order-top"><span class="pre-chip order-pre-chip gift-chip">${icon('gift')}Gift</span><span class="gift-status is-${esc(String(g.status).toLowerCase())}">${esc(GIFT_STATUS[g.status] || g.status)}</span></p>
      <p>${esc(statusLine)}</p>
      <dl class="gift-facts"><div><dt>Delivery</dt><dd>${esc(when)}</dd></div>${g.recipientCount === 1 ? `<div><dt>For</dt><dd>${esc((g.recipients[0] && g.recipients[0].name) || '')}</dd></div>` : `<div><dt>People</dt><dd>${g.recipientCount}</dd></div>`}<div><dt>Boxes</dt><dd>${g.boxes}</dd></div><div><dt>Total</dt><dd>${currency(g.total)}${g.discount ? ` <small>(saved ${currency(g.discount)})</small>` : ''}</dd></div>${g.business ? `<div><dt>Bill to</dt><dd>${esc(g.business.name)} · GSTIN ${esc(g.business.gstin)}</dd></div>` : ''}</dl>
      ${typeof payStateHTML === 'function' ? payStateHTML(g) : ''}
      ${canPay ? (testPay ? `<div class="prototype-tag">Test mode: no payment service is connected, so no money is taken.</div><button type="button" class="button primary full" data-gift-testpay-order="${esc(g.id)}">${g.paymentFailed ? 'Try payment again (test)' : 'Pay (test)'} ${currency(g.total)} ${icon('arrow')}</button><button type="button" class="text-button" data-gift-testfail-order="${esc(g.id)}">Fail payment (test)</button>` : `<button type="button" class="button primary full" data-gift-rzp-order="${esc(g.id)}">${g.paymentFailed ? 'Try payment again' : 'Pay'} ${currency(g.total)} ${icon('arrow')}</button>`) : ''}
      ${g.bill ? `<button type="button" class="button secondary gift-bill" data-gift-bill="${esc(g.id)}" data-number="${esc(g.number)}">${icon('mail')}<span>Download the bill</span></button>` : ''}
      ${typeof roGiftHTML === 'function' ? roGiftHTML(g) : ''}
    </div>
    <section class="page-card gift-order" aria-labelledby="gift-rcpts-h">
      <h2 id="gift-rcpts-h" class="gift-h">${g.recipientCount === 1 ? 'The delivery' : 'Each delivery'}</h2>
      <p class="gift-muted">${icon('info')}<span>${g.status === 'PAID' ? `You can cancel one person’s delivery only within ${hoursWord(cancelHours())} of placing this order${giftCancelUntil(g)}, as long as their box isn’t packed; it is refunded its own amount. After that it can’t be cancelled or refunded.` : 'Each person’s delivery shows here.'}</span></p>
      <ol class="gift-rcpts">${people}</ol>
    </section>
    <div class="gift-order-foot">${g.cancellable ? `<button type="button" class="text-button gift-cancel" data-gift-cancel="${esc(g.id)}" data-number="${esc(g.number)}" data-paid="${g.paymentStatus === 'SUCCEEDED' ? 1 : 0}">Cancel the whole gift order</button>` : ''}<a class="text-button" href="/orders" data-route>All orders ${icon('arrow')}</a><a class="text-button" href="/gifts" data-route>Send another gift ${icon('arrow')}</a></div>`
  if (g.status === 'PAYMENT_PENDING' && g.paymentStatus === 'INITIATED') setTimeout(() => { if (giftPage() && location.pathname === `/gifts/${encodeURIComponent(id)}` && seq === giftSeq) giftOrderView(id, true) }, 5000)
}

async function giftCancel(b) {
  const d = b.dataset, one = !!d.giftCancelOne
  const msg = one
    ? `Cancel ${d.name || 'this person'}’s delivery? ${d.amount} is refunded to your payment.`
    : `Cancel gift order ${giftNo(d.number)}? ${d.paid === '1' ? 'Each delivery is refunded its own amount.' : 'Nothing is charged.'}`
  if (!window.confirm(msg)) return
  b.disabled = true
  try {
    if (one) await MM.cancelGiftRecipient(d.gift, d.giftCancelOne)
    else await MM.cancelGift(d.giftCancel)
    toast(one ? 'Delivery cancelled' : `Gift order ${giftNo(d.number)} cancelled`)
  } catch (e) { toast(e.code === 'NOT_CANCELLABLE' ? (one ? 'This box is already packed, so it can’t be cancelled.' : 'Some boxes are already packed, so the whole order can’t be cancelled.') : e.message) }
  route()
}

async function giftBill(b) {
  b.disabled = true
  try {
    const blob = await MM.giftBill(b.dataset.giftBill)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `VMR-Mangoes-gift-bill-${String(b.dataset.number || '').replace(/[^A-Za-z0-9-]/g, '')}.pdf`
    document.body.append(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 4000)
    toast('Bill downloaded')
  } catch (e) { toast(e.status === 404 ? 'The bill isn’t ready yet. Try again in a minute.' : e.message) } finally { b.disabled = false }
}

// ---- The Orders list (app.js ordersView): gift orders with a "Gift" badge; their deliveries are listed inside them.

/** The buyer's gift orders, or [] while the switch is off (the routes would answer 404). */
async function giftOrdersFor() {
  const pol = policy || await MM.policy().catch(() => null)
  return pol && pol.features && pol.features.multiGift ? MM.gifts() : []
}
const giftListed = (r) => r && r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : null
/** A gift order's deliveries are left out of the list when the gift order itself is in it. */
const giftHides = (o, r) => !!(o && o.giftOrderId && (giftListed(r) || []).some((g) => g.id === o.giftOrderId))
function giftRows(r) {
  return (giftListed(r) || []).map((g) => ({
    at: String(g.placedAt || g.deliveryDate || ''),
    html: `<div class="order-row is-gift"><button class="guide-choice" data-gift-open="${esc(g.id)}"><span class="dot ${g.status === 'PAYMENT_PENDING' ? 'semi' : g.status === 'CANCELLED' ? 'raw' : 'ripe'}"></span><span><strong>${esc(giftNo(g.number))} · ${esc(GIFT_STATUS[g.status] || g.status)}</strong><span class="pre-chip order-pre-chip gift-chip">${icon('gift')}Gift</span><small>${plural(g.recipientCount, 'person', 'people')} · Delivery ${fmtDate(g.deliveryDate)} · ${currency(g.total)}</small></span>${icon('arrow')}</button>${typeof roRowHTML === 'function' ? roRowHTML(g, 'gift') : ''}</div>`,
  }))
}

// ---- Events

document.addEventListener('click', (e) => {
  const b = e.target instanceof Element ? e.target.closest('button') : null
  if (!b) return
  const d = b.dataset
  if (d.giftOpen) { go(`/gifts/${encodeURIComponent(d.giftOpen)}`); return }
  if (d.giftLink) { giftSendLink(b); return }
  if (d.giftCancel || d.giftCancelOne) { giftCancel(b); return }
  if (d.giftBill) { giftBill(b); return }
  if (d.giftTestpayOrder) { b.disabled = true; giftTestPay(d.giftTestpayOrder, true); return }
  if (d.giftTestfailOrder) { b.disabled = true; giftTestFail(d.giftTestfailOrder, true); return }
  if (d.giftRzpOrder) { MM.gift(d.giftRzpOrder).then((g) => giftRazorpay({ id: g.id, number: g.number, total: g.total, razorpayKeyId: g.razorpayKeyId, razorpayOrderId: g.razorpayOrderId, holdExpiresAt: g.holdExpiresAt }, true), (err) => toast(err.message)); return }
  if (!giftPage()) return
  if (b.hasAttribute('data-gift-terms')) {
    // The pre-order chip's Details: the terms in the "About pre-orders" pop-up.
    preAbout(b, { paid: d.giftTerms === 'paid', gift: true })
  } else if (d.giftChange) {
    giftEnv.open[d.giftChange] = !giftEnv.open[d.giftChange]
    renderGiftGrid({ 'data-gift-change': d.giftChange })
  } else if (d.giftSize) {
    slideSwitch(b, () => {
      giftEnv.size[d.variety] = d.giftSize
      renderGiftGrid({ 'data-gift-size': d.giftSize })
    })
  } else if (d.giftStage) {
    slideSwitch(b, () => {
      giftEnv.stage[d.variety] = d.giftStage
      renderGiftGrid({ 'data-gift-stage': d.giftStage, 'data-variety': d.variety })
    })
  } else if (d.giftAddLine) {
    // "+ Add to gift": the card's box and ripeness, one box; the card's stepper takes the focus.
    if (giftChange(d.giftAddLine, d.stage, 1)) giftRefresh({ 'data-gift-qty': '1', 'data-sku': d.giftAddLine, 'data-stage': d.stage })
  } else if (d.giftQty) {
    if (b.getAttribute('aria-disabled') === 'true') { const m = `A gift can hold up to ${giftMaxBoxes()} boxes. To send more, send a second gift, or place a bulk order.`; toast(m); say(m); return }
    const delta = Number(d.giftQty), was = lineOf(d.sku, d.stage)
    if (!giftChange(d.sku, d.stage, delta)) return
    const still = lineOf(d.sku, d.stage)
    // Taken out: on a card the focus goes to its "+ Add to gift"; in "Their gift" to "+ Add more mangoes" when it was the last.
    const focus = still ? { 'data-gift-qty': d.giftQty, 'data-sku': d.sku, 'data-stage': d.stage } : d.at === 'card' ? { 'data-gift-add-line': d.sku } : null
    giftRefresh(focus)
    if (!still && was && d.at === 'row') ($('#gift-their [data-gift-qty]') || $('#gift-their [data-gift-more]'))?.focus()
  } else if (d.giftBag) {
    // Gifting switched off: the box goes in the bag as a gift for one person.
    if (bagAddGift(d.giftBag, d.stage || 'SEMI_RIPE', 1)) renderGiftGrid()
  } else if (b.hasAttribute('data-gift-q-clear')) {
    giftEnv.q = ''
    const q = $('#gift-q')
    if (q) { q.value = ''; q.focus() }
    renderGiftGrid()
  } else if (b.hasAttribute('data-gift-next')) openForm()
  else if (b.hasAttribute('data-gift-more') || b.hasAttribute('data-gift-boxes')) backToPick()
  else if (b.hasAttribute('data-gift-pay')) giftCheckout()
  else if (d.giftBiz) {
    gift.business = d.giftBiz === 'on'
    if (!gift.business) { delete gift.errors['gift-biz-name']; delete gift.errors['gift-gstin'] }
    renderGiftSend()
    saveDraft()
    if (gift.business) focusField('gift-biz-name'); else focusSel('[data-gift-biz="on"]')
  } else if (d.giftDate) {
    if (b.getAttribute('aria-disabled') === 'true') { toast('Not every box in the gift is in stock that day. Choose another day.'); return }
    gift.date = d.giftDate
    gift.slotId = null
    gift.error = ''
    giftEnv.slotsFor = ''
    delete gift.errors['#gift-their']
    renderGiftSend({ 'data-gift-date': d.giftDate })
    giftSlots()
    saveDraft()
  } else if (d.giftSlot) {
    gift.slotId = d.giftSlot
    if (gift.error) { gift.error = ''; const a = $('#gift-alert'); if (a) a.innerHTML = '' }
    giftRefresh()
  } else if (b.hasAttribute('data-gift-pre-testpay')) giftPreTestPay()
  else if (b.hasAttribute('data-gift-pre-testfail')) giftPreTestFail()
  else if (b.hasAttribute('data-gift-testfail')) giftTestFail(gift.pay.id)
  else if (b.hasAttribute('data-gift-pre-cancel')) giftPreCancel(b)
  else if (b.hasAttribute('data-gift-again')) { gift = giftFresh(); dropDraft(); setFlow(false); giftUrl('pick'); renderGiftGrid(); renderGiftNotice(); giftBar(); focusSel('#gift-packs-h', 'start') }
  else if (b.hasAttribute('data-gift-testpay')) giftTestPay(gift.pay.id)
  else if (b.hasAttribute('data-gift-rzp')) giftRazorpay()
  else if (b.hasAttribute('data-gift-retry')) { loadProducts(); shelfReady().then(() => renderGiftGrid()) }
})

const PERSON_FIELD = /^gp-(name|phone|address|landmark|pincode)$/
let pinTimer = 0, qTimer = 0
// Typing: the value, kept and saved a moment later (no Save button); the bar follows. The search filters the cards.
document.addEventListener('input', (e) => {
  const t = e.target
  if (!giftPage()) return
  if (t.id === 'gift-q') {
    giftEnv.q = t.value
    clearTimeout(qTimer)
    qTimer = setTimeout(() => renderGiftGrid(), 120)
    return
  }
  if (!t.form || t.form.id !== 'gift-form') return
  const m = t.name.match(PERSON_FIELD)
  if (m) {
    const f = m[1]
    gift.person[f] = t.value
    if (f === 'pincode') {
      const pin = t.value.trim()
      t.closest('.field')?.querySelector('.gift-pin')?.remove()
      const city = $('#gift-form [name="gp-city"]')
      if (city) city.value = giftEnv.pins[pin] === true ? giftEnv.cities[pin] || '' : ''
      clearTimeout(pinTimer)
      if (/^[1-9]\d{5}$/.test(pin)) pinTimer = setTimeout(() => checkPin(pin), 250)
    }
    if (gift.errors[t.name]) delete gift.errors[t.name]
  } else if (t.name === 'gift-note') {
    gift.note = t.value
    delete gift.errors['gift-note']
    const c = $('#gift-note-count')
    if (c) c.textContent = noteCount(gift.note)
  } else if (t.name === 'gift-sender') gift.sender = t.value
  else if (t.name === 'gift-biz-name') { gift.bizName = t.value; delete gift.errors[t.name] }
  else if (t.name === 'gift-gstin') { gift.gstin = t.value; delete gift.errors[t.name] }
  saveDraft()
  giftBar()
})
document.addEventListener('change', (e) => {
  const t = e.target
  // The sticky bar's pre-order tick (outside the form).
  if (giftPage() && t.name === 'gift-pre-agree-all') { gift.agree = t.checked; gift.barHint = ''; giftBar(); return }
  if (!giftPage() || !t.form || t.form.id !== 'gift-form') return
  if (t.name === 'gp-ask') {
    gift.person.ask = t.value === 'ask'
    for (const k of ['gp-address', 'gp-pincode', 'gp-landmark']) delete gift.errors[k]
    renderGiftSend({ name: t.name, value: t.value })
    saveDraft()
    say(gift.person.ask ? `We’ll ask ${whoOf()} for their address on WhatsApp.` : `Enter ${whoOf()}’s address.`)
  }
})
// A field's error shows once it has been left (and stays until it is fixed).
document.addEventListener('focusout', (e) => {
  const t = e.target
  if (!giftPage() || !t.form || t.form.id !== 'gift-form' || !t.name || t.type === 'checkbox' || t.type === 'radio' || t.readOnly) return
  if (String(t.value || '').trim() === '' && !gift.errors[t.name]) return
  // A WhatsApp number typed with +91, a 0 or spaces is shown as its 10 digits (the +91 is beside the field).
  if (t.name === 'gp-phone' && !giftPhoneWhy(t.value)) { gift.person.phone = giftPhone(t.value); t.value = gift.person.phone; saveDraft() }
  const to = e.relatedTarget
  if (to instanceof Element && to.closest('#gift-send button')) return
  checkField(t.name, true)
  giftBar()
})
// Enter in a one-line field does not send the form (there is no submit button in it: the pay bar pays).
document.addEventListener('submit', (e) => { if (e.target.id === 'gift-form') e.preventDefault() })
// Enter in the search keeps the page where it is.
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target && e.target.id === 'gift-q') e.preventDefault() })

window.addEventListener('mm:route', () => {
  if (document.title === GIFT_TITLE && !giftPage()) document.title = 'VMR Mangoes — A little taste of summer.'
  if (document.title === 'Your gift order · VMR Mangoes' && !giftPage()) document.title = 'VMR Mangoes — A little taste of summer.'
})
// Signing in (the sign-in page comes back to /gifts/send) or out: the sign-in line follows.
window.addEventListener('mm:profile', () => { if (giftPage() && $('#gift-form')) { const b = $('.gift-signin'); if (b && MM.profile()) b.remove() } })
// The bag changed (a gift added here while gifting is off): the cards' "n in your bag" follow, unless a card is in use.
window.addEventListener('mm:cart', () => { const g = $('#gift-grid'); if (giftPage() && g && giftEnv.ready && !gift.flow && !g.contains(document.activeElement)) renderGiftGrid() })
