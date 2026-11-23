/* Gifting: the /gifts page (the gift packs and the send flow) and /gifts/:id (one gift order: the confirmation after
   paying, and where the buyer finds it later; the Orders list links here with a "Gift" badge, app.js ordersView).
   The API is mango-api's gift orders (docs/gifting.md, mango-api/src/gift-routes.js): one or many recipients, one
   delivery day and slot for everyone, one payment, no delivery charge. It sits behind the MULTI_GIFT switch, read from
   GET /v1/policy (features.multiGift, multiGiftMaxRecipients): while it is off the page still shows the packs, says
   gifting is opening soon and never calls the gift routes. A gift needs boxes in stock on the delivery day, so before
   the season (app.js preSeason()) a gift is pre-ordered instead (the owner, 18 Nov 2026: one person or several, the same
   thing): "Send as a gift" books one gift pre-order per person, each delivered in the first open delivery week with room
   for its box, paid once (POST /v1/preorders/groups, mango-api preorders.js bookPreorderGroup, docs/gifting.md "Before
   the season"). The steps are then: the people, a review that states the pre-order, the weeks, the non-refundable tick
   and the total, the one payment, and a done screen; each booking shows in Your orders with the Pre-order and Gift tags.
   Reuses app.js and pages.js: prices and stock from the shop's catalogue (skus, MM.catalogue), the field errors
   (fieldError), the sign-in page (/login?next=), the payment script (loadScript(RAZORPAY)) and the page frame.
   Loaded after pages.js (it adds to PAGES) and before app.js, so top-level code only declares and listens.
   Each card also has "Add to bag": the box goes into the regular bag as a gift line, checked out on its own to one
   person at one address through the regular checkout (gift-bag.js; delivery charge as for any order).
   Styles: style.css (the "Gifting" block, .gift-), dark: theme.css. */

// ---- THE GIFT PACKS (the owner's list; edit here).
// Each pack is an existing shop box, shown as a gift at exactly its shop price: the name, picture, price and stock
// come live from the catalogue (GET /v1/products and /v1/catalogue), never from this table. A sku the shop no longer
// sells is left out on its own. In the order shown:
//   sku   the shop box (variety and size), e.g. 'ALP-3'
//   name  optional: the gift's name on its card (default "<variety> gift box")
//   line  optional: one line about it (default: the variety's flavour line from catalog.js)
// Until the owner names his own packs and prices, these are the Mixed Box and the varieties most given as gifts
// (Alphonso, Kesar, Himsagar, Imam Pasand), in 3 kg and 5 kg.
const GIFT_PACKS = [
  { sku: 'MIX-3', name: 'Mixed gift box', line: 'Four favourites in one box: Alphonso, Kesar, Banganapalli and Himsagar.' },
  { sku: 'MIX-5', name: 'Mixed gift box', line: 'The four favourites, with more of each to go round.' },
  { sku: 'ALP-3', name: 'Alphonso gift box' },
  { sku: 'ALP-5', name: 'Alphonso gift box' },
  { sku: 'KES-3', name: 'Kesar gift box' },
  { sku: 'KES-5', name: 'Kesar gift box' },
  { sku: 'HIM-3', name: 'Himsagar gift box' },
  { sku: 'IMP-3', name: 'Imam Pasand gift box' },
]

// The several-people flow has its own addresses, so Back and Forward (the browser's, the phone's, the page's back arrow)
// walk its steps: /gifts (the packs) → /gifts/send (who gets it) → /gifts/send/review (check and pay), and /gifts/done
// after a pre-season gift is paid (replacing the pay step, so Back never returns into a paid flow). A step reached by a
// button pushes its address (giftUrl); Back and Forward redraw the page from the address (giftsPage).
PAGES.push(
  [/^\/gifts\/?$/, () => giftsPage('packs')],
  [/^\/gifts\/send\/?$/, () => giftsPage('form')],
  [/^\/gifts\/send\/review\/?$/, () => giftsPage('review')],
  [/^\/gifts\/done\/?$/, () => giftsPage('done')],
  [/^\/gifts\/([^/]+)\/?$/, (m) => signedInThen('Your gift order', () => giftOrderView(decodeURIComponent(m[1])))],
)
const GIFT_PATHS = { packs: '/gifts', form: '/gifts/send', review: '/gifts/send/review', done: '/gifts/done' }
/** The address for a step the buyer moved to with a button: a new history entry that knows where it came from
 *  (giftBack), or with `replace` the same entry redrawn. Nothing is redrawn here: the caller has drawn the step. */
function giftUrl(step, replace = false) {
  const to = GIFT_PATHS[step]
  if (!to || location.pathname === to) return
  if (replace) history.replaceState({ ...(history.state || {}), mm: true }, '', to)
  else history.pushState({ mm: true, giftBack: location.pathname }, '', to)
  window.dispatchEvent(new CustomEvent('mm:route', { detail: { path: to } }))
}
/** "Back to the people" / "Back to the gift boxes": the browser's Back when the step before is that one (no double
 *  entries, no loops); otherwise (opened from a link or a reload) the step drawn here, on the same entry. */
function giftBackTo(step, here) {
  if (history.state && history.state.giftBack === GIFT_PATHS[step]) { history.back(); return }
  here()
  giftUrl(step, true)
}

const GIFT_TITLE = 'Gifting · VMR Mangoes', GIFT_DRAFT = 'mm-gift-draft'
// The API's limits: a note up to 200 characters; a recipient up to 20 boxes (the bag's per-line limit).
const GIFT_NOTE_MAX = 200, GIFT_BOX_MAX = 20
let giftSeq = 0, giftRid = 0
// What the page knows: the policy (the switch), the catalogue's days and stock, the slots, which pincodes we serve.
const giftEnv = { ready: false, policy: null, catPin: null, dates: [], days: null, cutoff: '', slots: [], slotsFor: '', pins: {}, stage: {} }
let gift = giftFresh()

/** The send flow, made simple for everyone (the owner, 18 Nov 2026: "for older people it's hard to use"): three steps
 *  with a step line (1 Choose the box, 2 Who gets it, 3 Pay). The box is chosen once, on the card (`box`: pack,
 *  ripeness and boxes for each person); people are added one at a time in one short form (`editing`: the one open form,
 *  never more than one), then shown as a one-line row. One note goes with every box (`note`); a person can still have
 *  their own box (`own`) or note (`ownNote`) behind a quiet link. While the flow is open (`flow`) the gift cards step
 *  aside, so the page shows only the step the buyer is on. */
function giftFresh() {
  return { recipients: [], box: null, note: '', editing: null, snap: null, boxOpen: false, removed: null, flow: false, wantReview: false, date: null, slotId: null, sender: '', business: false, bizName: '', gstin: '', errors: {}, step: 'form', pay: null, busy: false, error: '', unpaid: null, key: null, agree: false, group: null }
}

// ---- Before the season: the gift is pre-ordered (one booking per person, paid once).

/** The pre-order notice, said plainly and prominently wherever a gift is pre-ordered (the owner, 18 Nov 2026): the
 *  Gifting page, its people, review and done steps, the single gift pre-order checkout and the bag's Gift group.
 *  `when` is HTML (escaped by the caller). */
function preNoticeHTML(when, paid = false) {
  return `<div class="pre-when pre-notice" role="note">${icon('calendar')}<p><strong>This is a pre-order.</strong> It will be delivered in <strong>${when}</strong>.</p></div>` +
    `<div class="pre-warn pre-notice" role="note">${icon('info')}<p><strong>${paid ? 'Paid in full. It can’t be cancelled, unless we delay it.' : 'Paid in full now. It can’t be cancelled once you pay, unless we delay it.'}</strong> If we can’t deliver, we refund you in full.${policyLink()}</p></div>` + harvestNote()
}
/** "the first week of March (week of 2 Mar)", escaped. */
const preWeekText = (d) => `${esc(weekPhrase(d))} <span class="no-wrap">(week of ${esc(fmtWeek(d))})</span>`
/** Each person's delivery week, as the API gives it: the earliest week with room for their boxes' kg, counting the people
 *  before them (the API books them in this order and checks the same). Every box shares one weekly limit in kg (the API's
 *  deliveryWeeks), so a group can straddle two weeks; one person's boxes are never split. An older API without them: per box, as before. `moved`: earlier weeks are full. */
function giftPreWeeks() {
  const used = {}
  const shared = pre.countsBy !== 'boxes' && pre.days.length > 0
  // Each variety has its own weeks (migration 078): people booking the same variety share them.
  const varietyKey = (sku) => (skuOf(sku) || {}).variety || sku
  const key = (w, sku) => (shared ? `${varietyKey(sku)}|${w.weekStart}` : `${w.sku}|${w.weekStart}`)
  return gift.recipients.map((r) => {
    const all = shared ? preDaysOf(r.sku) : pre.weeks.filter((w) => w.sku === r.sku).sort((a, b) => String(a.weekStart).localeCompare(String(b.weekStart)))
    const need = preNeed(r.qty, r.sku)
    const week = all.find((w) => w.remaining - (used[key(w, r.sku)] || 0) >= need) || null
    if (week) used[key(week, r.sku)] = (used[key(week, r.sku)] || 0) + need
    return { r, first: all[0] || null, week, big: !!r.sku && preTooBig(r.qty, r.sku), moved: !!(week && all[0] && week.weekStart !== all[0].weekStart) }
  })
}
/** The notice's week: one week for everyone, or the first and last when people's weeks differ. */
function giftPreWhen(weeks) {
  const ws = [...new Set(weeks.filter(Boolean).map(String))].sort()
  if (!ws.length) { const f = firstPreWeek(); return f ? preWeekText(f) : 'the first open delivery week' }
  if (ws.length === 1) return preWeekText(ws[0])
  return `${esc(weekPhrase(ws[0]))} or ${esc(weekPhrase(ws[ws.length - 1]))} (each person’s week is shown)`
}
const giftPreWeekList = (list) => list.map((x) => x.week && x.week.weekStart)

// ---- Small helpers

const giftOn = () => !!(giftEnv.policy && giftEnv.policy.features && giftEnv.policy.features.multiGift)
const giftMax = () => Number(giftEnv.policy && giftEnv.policy.multiGiftMaxRecipients) || 25
const giftBills = () => !!(giftEnv.policy && giftEnv.policy.bills)
const giftPage = () => document.body.dataset.page === 'gifts'
const giftForm = () => $('#gift-form')
const longDate = (d) => { if (!d) return ''; const [y, m, day] = String(d).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, day).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) }
/** A gift's number as the shop shows every number (orderNo, app.js): G-743 406 080; an older GFT-12 as it is. */
const giftNo = (n) => orderNo(n || '')
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

/** The gift packs that the shop sells now, with their live box, price and content. */
function giftPacks() {
  return GIFT_PACKS.map((p) => {
    const s = skuOf(p.sku)
    if (!s) return null
    const c = contentForLine(s.sku, s.name) || {}
    return { sku: s.sku, s, c, name: p.name || `${s.variety} gift box`, line: p.line || c.flavour || s.description || '', kg: String(s.boxSize).replace('kg', ' kg') }
  }).filter(Boolean)
}
const packOf = (sku) => giftPacks().find((p) => p.sku === sku) || null
const packPhoto = (p, stage) => p.c.photos && (p.c.photos[stage] || p.c.photos.SEMI_RIPE)

// Stock: boxes free per box, ripeness and day, from the catalogue (unknown until a served pincode is known).
const stockKnown = () => !preSeason() && !!giftEnv.days
const dayQty = (sku, stage, date) => (giftEnv.days && giftEnv.days[sku] && giftEnv.days[sku][stage] && giftEnv.days[sku][stage][date]) || 0
const anyQty = (sku, stage) => giftEnv.dates.some((d) => dayQty(sku, stage, d) > 0)

/** Why nothing can be sent right now (the switch, the season), or null. */
function giftGate() {
  if (!giftEnv.ready) return { kind: 'loading', icon: 'clock', short: 'Checking…', long: 'Checking whether gifting is open…' }
  if (!giftOn()) return { kind: 'off', icon: 'lock', short: 'Opening soon', long: 'Gifting is opening soon: sending gifts isn’t switched on yet.' }
  // Gifting is open before the season too (the owner's choice, 17 Nov 2026): a pack can be sent whenever it is in
  // stock on the delivery day, and says why when it is not.
  return null
}

/** Why this box can't be had at all right now, from the stock on the deliverable days (the same test for "Add to bag"
 *  and "Send as a gift", before the season too): another ripeness is in, it is out of season, or it is sold out; null
 *  when it can. `long` is one short line (the card's reason slot), `short` the badge on the photo. */
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
/** "Send as a gift": the gifting switch (said once, at the top of the page), then the stock. */
const packWhy = (p, stage) => giftGate() || (preSeason() ? (preOpenFor(p.sku) ? null : { kind: 'stock', icon: 'close', short: 'Fully booked', long: 'Fully booked for now' }) : stockWhy(p, stage))
/** "Add to bag": the stock only. The bag's gift lines are checked out through the regular checkout, before the season
 *  too (the owner, 18 Nov 2026), so neither the gifting switch nor the pre-order mode applies. */
const bagWhy = (p, stage) => stockWhy(p, stage)

/** The ripeness a pack's card shows: the one picked, else one in stock, else Semi-ripe. */
function cardStageFor(p) {
  if (giftEnv.stage[p.sku]) return giftEnv.stage[p.sku]
  if (stockKnown()) { const st = ['SEMI_RIPE', 'RAW'].find((x) => anyQty(p.sku, x)); if (st) return st }
  return 'SEMI_RIPE'
}

// ---- The draft: kept for this tab only (other people's addresses), so a reload or the sign-in page keeps it, the
// half-typed person too. Shape 2 (the simple flow): { v: 2, box, note, editing (an index), recipients, ... }. A draft
// from before (each person with their own box and note) is read into the new shape: the first person's box is
// everyone's, a person whose box or note differs keeps their own.
let draftTimer = 0
function saveDraft() {
  clearTimeout(draftTimer)
  draftTimer = setTimeout(() => {
    try {
      if (!gift.recipients.length) sessionStorage.removeItem(GIFT_DRAFT)
      else sessionStorage.setItem(GIFT_DRAFT, JSON.stringify({ v: 2, box: gift.box, note: gift.note, editing: gift.recipients.findIndex((r) => r.id === gift.editing), recipients: gift.recipients, date: gift.date, slotId: gift.slotId, sender: gift.sender, business: gift.business, bizName: gift.bizName, gstin: gift.gstin }))
    } catch {}
  }, 250)
}
const cleanBox = (b) => (b && typeof b === 'object' ? { sku: String(b.sku || ''), stage: SOLD_API.includes(b.stage) ? b.stage : 'SEMI_RIPE', qty: Math.min(GIFT_BOX_MAX, Math.max(1, Math.round(Number(b.qty)) || 1)) } : null)
function readDraft() {
  try {
    const d = JSON.parse(sessionStorage.getItem(GIFT_DRAFT))
    if (!d || !Array.isArray(d.recipients) || !d.recipients.length) return
    const raw = d.recipients.slice(0, 100).filter((r) => r && typeof r === 'object')
    let people, box, note = '', open = null
    if (d.v === 2) {
      people = raw.map((r) => newPerson(r))
      box = cleanBox(d.box)
      note = String(d.note || '').slice(0, GIFT_NOTE_MAX)
      const i = Number.isInteger(d.editing) ? d.editing : -1
      open = people[i] && !people[i].saved ? people[i].id : null
    } else {
      // The old shape: every person had a box and a note of their own.
      people = raw.map((r) => newPerson({ ...r, saved: true })).filter((r) => !blankPerson(r))
      const first = people.find((r) => packOf(r.sku)) || people[0]
      box = first ? cleanBox(first) : null
      const notes = people.map((r) => r.note.trim())
      if (notes.length && notes.every((x) => x && x === notes[0])) note = notes[0]
      for (const r of people) {
        r.own = !!(box && (r.sku !== box.sku || r.stage !== box.stage || r.qty !== box.qty))
        r.ownNote = !note && !!r.note.trim()
      }
    }
    if (!people.length) return
    gift.recipients = people
    gift.box = box || { sku: '', stage: 'SEMI_RIPE', qty: 1 }
    gift.note = note
    gift.editing = open
    gift.snap = null
    gift.date = d.date || null
    gift.slotId = d.slotId || null
    gift.sender = String(d.sender || '')
    gift.business = !!d.business
    gift.bizName = String(d.bizName || '')
    gift.gstin = String(d.gstin || '')
  } catch {}
}
function dropDraft() { clearTimeout(draftTimer); try { sessionStorage.removeItem(GIFT_DRAFT) } catch {} }

function newPerson(r = {}) {
  return { id: `r${++giftRid}`, name: String(r.name || ''), phone: String(r.phone || ''), address: String(r.address || ''), pincode: String(r.pincode || ''), sku: String(r.sku || ''), stage: SOLD_API.includes(r.stage) ? r.stage : 'SEMI_RIPE', qty: Math.min(GIFT_BOX_MAX, Math.max(1, Number(r.qty) || 1)), note: String(r.note || '').slice(0, GIFT_NOTE_MAX), own: !!r.own, ownNote: !!r.ownNote, saved: !!r.saved }
}
const blankPerson = (r) => !r.name.trim() && !r.phone.trim() && !r.address.trim() && !r.pincode.trim() && !(r.ownNote && r.note.trim())
/** The note that goes with this person's box: their own when they have one, else the one for everyone. */
const noteOf = (r) => (r.ownNote ? r.note : gift.note).trim()
/** Everyone without a box of their own gets the box chosen on the card. */
function syncPeople() {
  const b = gift.box
  if (!b) return
  for (const r of gift.recipients) if (!r.own) { r.sku = b.sku; r.stage = b.stage; r.qty = b.qty }
}
/** "2 × Alphonso gift box · 3 kg · Semi-ripe" */
const boxLine = (sku, stage, qty) => { const p = packOf(sku); return p ? `${qty} × ${p.name} · ${p.kg} · ${stageOf(stage).stage}` : '' }
const whoOf = (r) => r.name.trim() || `Person ${gift.recipients.indexOf(r) + 1}`

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

function giftsPage(want = 'packs') {
  document.title = GIFT_TITLE
  const seq = ++giftSeq, pres = !!preSeason()
  if (want === 'done' && gift.step !== 'pre-done') want = 'packs'
  if (want !== 'done' && gift.step === 'pre-done') gift = giftFresh()
  if (want === 'form' || want === 'review') {
    // The gift being made (in memory, or this tab's draft); none (an old link, a paid gift): the packs.
    if (!gift.recipients.length) readDraft()
    if (!gift.recipients.length) {
      // Back into a flow that was paid (or cleared): the packs. When the entry before is the packs, step back to it
      // rather than show them twice in a row.
      if (history.state && history.state.giftBack === GIFT_PATHS.packs) { history.back(); return }
      want = 'packs'
    } else {
      gift.flow = true
      gift.box ??= { sku: '', stage: 'SEMI_RIPE', qty: 1 }
      if (want === 'form' && gift.step !== 'form') { gift.step = 'form'; gift.editing = null; gift.error = ''; gift.key = null }
      // Check and pay: the review is drawn again after the usual checks (giftLoad → giftToReview), never trusted from the address.
      if (want === 'review' && gift.step === 'form') gift.wantReview = true
    }
  }
  if (want === 'packs') gift.flow = false
  if (location.pathname.replace(/\/$/, '') !== GIFT_PATHS[want]) history.replaceState({ ...(history.state || {}), mm: true }, '', GIFT_PATHS[want])
  host().innerHTML = pageHead('Gifting') + `
    <div id="gift-notice"></div>
    <div id="gift-shop"${gift.flow ? ' hidden' : ''}>
    <p class="gift-ways">${icon('info')}<span><strong>Add to bag:</strong> for one person, checked out from your bag. <strong>Send as a gift:</strong> for several people at once.${pres ? ' Before the season both are pre-orders.' : ''}</span></p>
    <section class="gift-hero" aria-labelledby="gift-hero-h">
      <div class="gift-hero-copy">
        <p class="gift-kicker">${icon('gift')}<span>VMR Mangoes gifting</span></p>
        <h2 id="gift-hero-h">Send a box of <span class="why-u">the season<svg class="sun-swash" viewBox="0 0 120 16" preserveAspectRatio="none" aria-hidden="true"><path d="M3 11C28 5 66 2 117 6"/></svg></span></h2>
        <p>${pres ? 'Choose a gift box, tell us who gets it and add a note. You pay once, and we deliver to each person in their delivery week when the season starts.' : 'Choose a gift box, tell us who gets it and add a note. You pay once, and we deliver to each person on the day you pick.'}</p>
      </div>
      <ol class="gift-steps">
        <li>${icon('gift')}<span><strong>Choose the box</strong>Any gift pack, raw or semi-ripe</span></li>
        <li>${icon('user')}<span><strong>Tell us who</strong>One person or many, each with a note</span></li>
        <li>${icon('lock')}<span><strong>Pay once</strong>One payment for every box</span></li>
        <li>${icon('truck')}<span><strong>We deliver</strong>${pres ? 'To each person, in their delivery week' : 'To each person, the same day'}</span></li>
      </ol>
    </section>
    <section class="gift-packs" aria-labelledby="gift-packs-h">
      <div class="gift-packs-head"><h2 id="gift-packs-h" tabindex="-1">Gift packs</h2><p>Our boxes, packed to give, at the shop price. Prices include GST.</p></div>
      <div class="gift-grid" id="gift-grid" aria-busy="true">${Array.from({ length: 4 }, () => '<div class="gift-card is-skeleton" aria-hidden="true"><div class="gift-card-photo"></div><div class="gift-card-body"><span class="sk-block"></span><span class="sk-block"></span></div></div>').join('')}</div>
    </section>
    </div>
    <section class="gift-send page-card" id="gift-send" aria-labelledby="gift-send-h" hidden></section>
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
  // Before the season a gift is pre-ordered: which weeks have room for each box (app.js pre.weeks).
  if (preSeason() && !pre.weeks.length) await loadWeeks().catch(() => null)
  if (seq !== giftSeq || !giftPage()) return
  giftEnv.policy = pol || null
  giftEnv.ready = true
  // Stock and the delivery days: from the shop's pincode, or the first recipient's that we serve.
  const pin = (where.pincode && where.serviceable && where.pincode) || gift.recipients.map((r) => r.pincode.trim()).find((p) => /^[1-9]\d{5}$/.test(p))
  if (pin && !giftEnv.days) await giftStock(pin)
  if (seq !== giftSeq || !giftPage()) return
  gift.recipients.forEach((r) => { if (/^[1-9]\d{5}$/.test(r.pincode.trim()) && giftEnv.pins[r.pincode.trim()] === undefined) checkPin(r.pincode.trim()) })
  renderGiftNotice()
  renderGiftGrid()
  if (gift.flow && gift.recipients.length && !giftGate()) {
    setFlow(true)
    renderGiftSend()
    giftSlots()
    // Back from the sign-in page that "That's everyone" opened: straight on to the review.
    if (gift.wantReview && MM.profile() && gift.step === 'form') giftToReview()
  } else if (gift.flow) setFlow(false)
}

/** The flow on its own (the gift cards step aside), or the cards again (the flow is kept, "Continue" brings it back). */
function setFlow(on) {
  gift.flow = !!on
  const shop = $('#gift-shop'), send = $('#gift-send')
  if (shop) shop.hidden = gift.flow
  if (send) { send.hidden = !gift.flow; if (!gift.flow) send.innerHTML = '' }
  if (!gift.flow && giftPage()) setBar('')
  renderGiftNotice()
}
/** Opens the flow where it was left and brings the buyer to it. */
function openFlow(focusSel) {
  if (giftGate() || !gift.recipients.length) return
  gift.box ??= { sku: '', stage: 'SEMI_RIPE', qty: 1 }
  setFlow(true)
  giftUrl('form')
  renderGiftSend()
  giftSlots()
  giftTop(focusSel)
}
/** Scrolls to the top of the flow and puts the focus on `sel` (else the step's heading). */
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

/** A send started on an earlier visit (this tab's saved draft), not open on screen now. */
function savedDraft() {
  if (gift.recipients.length) return null
  try { const d = JSON.parse(sessionStorage.getItem(GIFT_DRAFT)); return d && Array.isArray(d.recipients) && d.recipients.length ? d : null } catch { return null }
}
function renderGiftNotice() {
  const box = $('#gift-notice')
  if (!box) return
  // While the flow is open it says everything itself.
  if (gift.flow) { box.innerHTML = ''; return }
  const g = giftGate(), d = !g && (gift.recipients.length ? { recipients: gift.recipients } : savedDraft())
  const named = d ? d.recipients.filter((r) => r && String(r.name || '').trim()).length : 0
  const draft = d ? `<div class="gift-draft">${icon('gift')}<p>You started a gift${named ? ` for ${plural(named, 'person', 'people')}` : ''}. It is kept here for you.</p><div class="gift-draft-acts"><button type="button" class="button primary gift-big" data-gift-draft="go">Continue the gift you started ${icon('arrow')}</button><button type="button" class="text-button gift-quiet" data-gift-draft="clear" aria-label="Clear the gift you started">Clear it</button></div></div>` : ''
  if (!g && preSeason()) { box.innerHTML = draft + `<div class="gift-pre-top">${preNoticeHTML(giftPreWhen([]))}</div>`; return }
  if (!g || g.kind === 'loading') { box.innerHTML = draft; return }
  const head = g.kind === 'off' ? 'Gifting is opening soon.' : `Gifting opens ${season && season.startsOn ? longDate(season.startsOn) : 'with the season'}.`
  const more = g.kind === 'off'
    ? 'You can look through the gift packs now. Sending them opens shortly; the prices are the shop’s.'
    : 'A gift goes out from boxes in stock on its delivery day, and the first boxes come in when the season starts. Until then, have a look at the gift packs.'
  box.innerHTML = `<div class="gift-notice" role="status"><span class="gift-notice-icon" aria-hidden="true">${icon(g.kind === 'off' ? 'gift' : 'sun')}</span><div><p><strong>${esc(head)}</strong></p><p>${esc(more)}</p></div></div>`
}

function renderGiftGrid(focus) {
  const grid = $('#gift-grid')
  if (!grid) return
  const packs = giftPacks()
  grid.removeAttribute('aria-busy')
  if (!packs.length) {
    grid.innerHTML = `<div class="page-card empty-cart bag-empty empty-state">${icon('gift')}<h2>The gift boxes are a moment away.</h2><p>We couldn’t load them just now. Try again in a minute.</p><button class="button primary bag-explore" data-gift-retry>Try again ${icon('arrow')}</button></div>`
    return
  }
  // One card per variety: its sizes (3 kg, 5 kg) are a switch on the card, not separate cards.
  const groups = new Map()
  for (const p of packs) { const k = p.s.variety; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p) }
  giftEnv.size = giftEnv.size || {}
  grid.innerHTML = [...groups.values()].map((sibs) => giftCard(sibs.find((x) => x.sku === giftEnv.size[sibs[0].s.variety]) || sibs[0], sibs)).join('')
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

/** How many boxes the card is set to (0, the start, to the per-line limit): what "Add to bag" adds and what fills the first
 *  person's count when sending. */
const cardQty = (sku) => Math.min(GIFT_BOX_MAX, Math.max(0, Number((giftEnv.qty || {})[sku]) || 0))
/** The gift boxes of this box and ripeness already in the bag. */
const inBag = (sku, stage) => cart.concat(typeof cartAside === 'undefined' ? [] : cartAside).filter((x) => x.gift && x.sku === sku && x.stage === stage).reduce((n, x) => n + x.qty, 0)

/** Before the season a gift goes in the bag as a pre-order (gift-bag.js): open when a delivery week for this box has room. */
const preOpenFor = (sku) => pre.weeks.some((w) => w.sku === sku && w.remaining >= preNeed(1, sku))
/** "1 March": the day the season starts, from the season data. */
const seasonDay = () => (season && season.startsOn ? new Date(`${String(season.startsOn).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' }) : '')

/** One gift card. Every card has the same rows, so neighbouring cards line up: photo, name and price, a two-line
 *  description, then (anchored to the bottom) Ripeness, Box size (a plain chip for a one-size variety), Quantity,
 *  the two buttons and one short reason line. The quantity starts at 0: nothing can be added or sent until it is set. */
function giftCard(p, sibs = [p]) {
  const stage = cardStageFor(p), src = packPhoto(p, stage), id = `gift-why-${p.sku}`
  const label = `${p.name}, ${p.kg}`, pres = !!preSeason(), n = cardQty(p.sku), have = inBag(p.sku, stage)
  // Why the box can't be had at all (said once: a badge on the photo and the reason line); else why each button waits.
  const stockOff = pres ? (preOpenFor(p.sku) ? null : { kind: 'stock', icon: 'close', short: 'Fully booked', long: 'Fully booked for now' }) : stockWhy(p, stage)
  // Before the season sending is a gift pre-order for several people (the owner, 18 Nov 2026): only the gifting switch applies.
  const sendOff = giftGate()
  const zero = !stockOff && n === 0
  const reason = stockOff ? stockOff : zero ? { kind: 'qty', icon: 'info', long: 'Choose how many boxes' } : sendOff && sendOff.kind !== 'loading' ? sendOff : null
  const stages = `<div class="segmented glass detail-stages gift-stages" role="group" aria-label="Ripeness for the ${esc(label)}" style="--i:${SOLD.findIndex((x) => x.apiStage === stage)};--n:${SOLD.length}"><span class="detail-lens" aria-hidden="true"></span>${SOLD.map((x) => {
    const on = x.apiStage === stage, out = !pres && stockKnown() && !anyQty(p.sku, x.apiStage)
    return `<button type="button" class="${on ? 'selected' : ''}${out ? ' out' : ''}" data-gift-stage="${x.apiStage}" data-sku="${esc(p.sku)}" aria-pressed="${on}"${out ? ` aria-label="${x.stage}, sold out"` : ''}><span class="dot ${x.id}"></span>${x.stage}</button>`
  }).join('')}</div>`
  const sizes = sibs.length > 1
    ? `<div class="segmented glass detail-stages gift-sizes" role="group" aria-label="Box size for the ${esc(p.name)}" style="--i:${sibs.findIndex((x) => x.sku === p.sku)};--n:${sibs.length}"><span class="detail-lens" aria-hidden="true"></span>${sibs.map((x) => `<button type="button" class="${x.sku === p.sku ? 'selected' : ''}" data-gift-size="${esc(x.sku)}" data-variety="${esc(x.s.variety)}" aria-pressed="${x.sku === p.sku}">${esc(x.kg)} · ${currency(x.s.price)}</button>`).join('')}</div>`
    : `<p class="gift-size-one"><span>${esc(p.kg)} · ${currency(p.s.price)}</span><small>One size</small></p>`
  const qty = `<div class="gift-qty" role="group" aria-label="How many ${esc(label)} boxes"><span class="gift-qty-label">Quantity</span><div class="gift-qty-step"><button type="button" data-gift-qty="-1" data-sku="${esc(p.sku)}" aria-label="One box fewer"${n <= 0 ? ' disabled' : ''}>−</button><output aria-live="polite">${n}</output><button type="button" data-gift-qty="1" data-sku="${esc(p.sku)}" aria-label="One box more"${n >= GIFT_BOX_MAX || stockOff ? ' disabled' : ''}>+</button></div><span class="gift-qty-sum">${n > 0 && p.s.price ? currency(p.s.price * n) : ''}</span></div>`
  const why = reason ? ` disabled aria-describedby="${id}"` : ''
  const addOff = stockOff || zero, addWhy = addOff ? ` disabled aria-describedby="${id}"` : ''
  const sendDis = stockOff || zero || sendOff
  const add = `<button type="button" class="button secondary gift-act gift-bag-add"${addOff ? addWhy : ` data-gift-bag="${esc(p.sku)}" aria-label="${pres ? 'Pre-order' : 'Add'} ${n} of the ${esc(label)} to your bag as a gift, for one person"`}>${icon(addOff ? (stockOff ? stockOff.icon : 'info') : 'bag')}<span class="gift-act-copy"><b>${n > 0 ? `Add ${n} to bag` : 'Add to bag'}</b><small>${pres ? 'Pre-order · one person' : 'For one person'}</small></span></button>`
  // In the several-people flow the card's quantity is the boxes each person gets.
  const send = `<button type="button" class="button primary gift-act gift-go"${sendDis ? why || ` disabled aria-describedby="${id}"` : ` data-gift-send="${esc(p.sku)}" aria-label="Send the ${esc(label)} as a gift to several people, ${plural(n, 'box', 'boxes')} each"`}>${icon(sendDis ? (sendOff && !stockOff && !zero ? sendOff.icon : stockOff ? stockOff.icon : 'info') : 'gift')}<span class="gift-act-copy"><b>Send as a gift</b><small>${n > 0 ? `${plural(n, 'box', 'boxes')} each · several people` : pres ? 'Pre-order · several people' : 'To several people'}</small></span></button>`
  const line = `<p class="gift-why${reason ? ` is-${reason.kind}` : ''}" id="${id}">${reason ? `${icon(reason.icon)}<span>${esc(reason.long)}</span>` : ''}</p>`
  const badge = stockOff && stockOff.kind !== 'stage' && stockOff.kind !== 'loading' ? `<span class="gift-badge is-${stockOff.kind}">${icon(stockOff.icon)}${esc(stockOff.short)}</span>` : `<span class="gift-badge">${icon(pres ? 'sun' : 'gift')}${pres ? 'Gift · Pre-order' : 'Gift'}</span>`
  const bagged = have ? `<a class="gift-in-bag" href="/cart" data-route>${icon('check')}<span>${have} in your bag</span></a>` : ''
  return `<article class="gift-card${stockOff && stockOff.kind !== 'stage' ? ' is-off' : ''}" data-sku="${esc(p.sku)}"><div class="gift-card-photo${src ? ' photo' : ''}">${src ? `<img src="${src}" alt="" loading="lazy" decoding="async" width="720" height="720">` : ''}${badge}${bagged}</div><div class="gift-card-body"><div class="gift-card-top"><h3>${esc(p.name)}</h3><p class="gift-card-meta"><span>${esc(p.s.variety)}</span><strong>${currency(p.s.price)}</strong></p><p class="gift-card-line">${esc(p.line)}</p></div><div class="gift-card-controls"><p class="gift-card-label" aria-hidden="true">Ripeness</p>${stages}<p class="gift-card-label" aria-hidden="true">Box size</p>${sizes}${qty}<div class="gift-acts">${add}${send}</div>${line}</div></div></article>`
}

// ---- The send flow: 1 Choose the box (on the card), 2 Who gets it (one person at a time), 3 Pay.

const fname = (r, f) => `g-${r.id}-${f}`

/** The step line at the top of the flow: "1 Choose the box · 2 Who gets it · 3 Pay", the current step marked. */
function stepLineHTML(now) {
  return `<ol class="gift-stepline" aria-label="Steps">${['Choose the box', 'Who gets it', 'Pay'].map((s, i) => {
    const n = i + 1, done = n < now, cur = n === now
    return `<li class="${done ? 'is-done' : cur ? 'is-now' : ''}"${cur ? ' aria-current="step"' : ''}><span class="gift-stepline-n" aria-hidden="true">${done ? icon('check') : n}</span><span class="gift-stepline-t"><span class="sr-only">Step ${n} of 3: </span>${s}${done ? '<span class="sr-only"> (done)</span>' : ''}</span></li>`
  }).join('')}</ol>`
}

function renderGiftSend(focus) {
  const box = $('#gift-send')
  if (!box) return
  syncPeople()
  if (gift.step === 'pay') { box.innerHTML = stepLineHTML(3) + giftPayHTML(); giftBar(); refocus(box, focus); return }
  if (gift.step === 'review' || gift.step === 'pre-pay' || gift.step === 'pre-done') {
    box.innerHTML = gift.step === 'review' ? stepLineHTML(3) + giftReviewHTML() : gift.step === 'pre-pay' ? stepLineHTML(3) + giftPrePayHTML() : giftPreDoneHTML()
    giftBar()
    refocus(box, focus)
    return
  }
  const pres = !!preSeason(), open = gift.recipients.find((r) => r.id === gift.editing) || null
  const anySaved = gift.recipients.some((r) => r.saved)
  // Before the season the pre-order notice is on this step too, under the people (the form comes first on a phone).
  const preTag = pres ? `<div id="gift-pre-notice">${preNoticeHTML(giftPreWhen(giftPreWeekList(giftPreWeeks())))}</div>` : ''
  const people = gift.recipients.map((r, i) => (r === open ? personFormHTML(r, i) : personRowHTML(r, i))).join('')
  const removed = gift.removed ? `<div class="gift-removed" role="status">${icon('close')}<p>${esc(gift.removed.r.name.trim() || 'That person')} is removed.</p><button type="button" class="button secondary gift-undo" data-gift-undo>Undo</button></div>` : ''
  box.innerHTML = `${stepLineHTML(2)}
    <div class="gift-send-head"><h2 id="gift-send-h" tabindex="-1">Who gets it?</h2><p>${anySaved ? 'Add each person, one at a time.' : 'Fill in the first person. You can add more after.'}</p></div>
    <form id="gift-form" novalidate>
      ${everyoneHTML()}
      ${gift.recipients.length ? `<ol class="gift-people" aria-label="The people">${people}</ol>` : ''}
      ${removed}
      ${open ? `<div id="gift-alert">${alertHTML()}</div>${preTag}` : afterPeopleHTML(preTag)}
    </form>
    <button type="button" class="text-button gift-quiet gift-to-boxes" data-gift-boxes>${icon('back')}<span>Back to the gift boxes</span></button>`
  applyErrors()
  giftBar()
  refocus(box, focus)
}

/** "Everyone gets: 2 × Alphonso gift box · 3 kg · Semi-ripe [Change]", or the box picker while it is being changed. */
function everyoneHTML() {
  const b = gift.box || { sku: '', stage: 'SEMI_RIPE', qty: 1 }, p = packOf(b.sku), err = gift.errors['#gift-everyone']
  const errLine = err ? `<p class="gift-why is-error" role="alert">${icon('info')}<span>${esc(err)}</span></p>` : ''
  if (gift.boxOpen || !p) {
    return `<section class="gift-everyone is-open" id="gift-everyone" aria-labelledby="gift-every-h" tabindex="-1"><h3 id="gift-every-h">The box everyone gets</h3>${errLine}${boxPickerHTML(null)}<button type="button" class="button primary gift-big" data-gift-box-done>${icon('check')}<span>Done</span></button></section>`
  }
  return `<section class="gift-everyone" id="gift-everyone" aria-labelledby="gift-every-h" tabindex="-1">${thumb(p.sku, b.stage, p.s.name)}<div class="gift-everyone-copy"><h3 id="gift-every-h">Everyone gets</h3><p class="gift-everyone-box">${esc(boxLine(b.sku, b.stage, b.qty))}</p><p class="gift-everyone-price">${currency(p.s.price * b.qty)} for each person</p>${errLine}</div><button type="button" class="button secondary gift-change" data-gift-box-change aria-label="Change the box everyone gets">Change</button></section>`
}

/** The box picker: the gift box, its ripeness and how many. `r`: that person's own box; null: the box for everyone. */
function boxPickerHTML(r) {
  const b = r || gift.box || { sku: '', stage: 'SEMI_RIPE', qty: 1 }, p = packOf(b.sku), packs = giftPacks()
  const id = r ? fname(r, 'box') : 'gift-box', selName = r ? fname(r, 'sku') : 'gift-box-sku', qtyName = r ? fname(r, 'qty') : 'gift-box-qty'
  const stageAt = (x) => (r ? `data-gift-rstage="${x}" data-rid="${esc(r.id)}"` : `data-gift-bstage="${x}"`)
  const stepAt = (n) => (r ? `data-gift-step="${n}" data-rid="${esc(r.id)}"` : `data-gift-bstep="${n}"`)
  const opts = `${p ? '' : '<option value="" selected>Choose a gift box…</option>'}${packs.map((x) => {
    const why = packWhy(x)
    return `<option value="${esc(x.sku)}"${x.sku === b.sku ? ' selected' : ''}${why && x.sku !== b.sku ? ' disabled' : ''}>${esc(x.name)} · ${esc(x.kg)} · ${currency(x.s.price)}${why ? ` (${esc(why.short.toLowerCase())})` : ''}</option>`
  }).join('')}`
  const left = p && stockKnown() && gift.date ? dayQty(p.sku, b.stage, gift.date) : null
  return `<div class="gift-box-pick">
      <label class="field gift-box-field">Gift box<span class="bulk-select gift-select"><select name="${selName}">${opts}</select>${icon('chevron')}</span></label>
      <div class="field gift-ripe"><span class="gift-lab" id="${id}-stage-l">Ripeness</span><div class="segmented glass detail-stages gift-stages is-small" role="group" aria-labelledby="${id}-stage-l" style="--i:${SOLD.findIndex((x) => x.apiStage === b.stage)};--n:${SOLD.length}"><span class="detail-lens" aria-hidden="true"></span>${SOLD.map((x) => {
        const on = x.apiStage === b.stage, out = p && stockKnown() && !anyQty(p.sku, x.apiStage)
        return `<button type="button" class="${on ? 'selected' : ''}${out ? ' out' : ''}" ${stageAt(x.apiStage)} aria-pressed="${on}"${out ? ` aria-label="${x.stage}, out of stock"` : ''}><span class="dot ${x.id}"></span>${x.stage}</button>`
      }).join('')}</div></div>
      <div class="field gift-boxes"><span class="gift-lab" id="${id}-qty-l">${r ? 'Boxes for this person' : 'Boxes for each person'}</span><div class="card-stepper gift-stepper" role="group" aria-labelledby="${id}-qty-l"><button type="button" ${stepAt(-1)} aria-label="One box fewer"${b.qty <= 1 ? ' aria-disabled="true"' : ''}>−</button><input name="${qtyName}" type="number" inputmode="numeric" min="1" max="${GIFT_BOX_MAX}" step="1" value="${b.qty}" aria-labelledby="${id}-qty-l"><button type="button" ${stepAt(1)} aria-label="One box more"${b.qty >= GIFT_BOX_MAX ? ' aria-disabled="true"' : ''}>+</button></div>${left !== null && left > 0 && left < 10 ? `<small class="field-hint">${left} left on ${esc(fmtDate(gift.date))}</small>` : ''}</div>
    </div>`
}

/** The one open form: who the person is and where they live; their own box or note only behind a quiet link. */
function personFormHTML(r, i) {
  const k = (f) => fname(r, f), pin = r.pincode.trim(), served = giftEnv.pins[pin], name = r.name.trim()
  const pinHint = served === true ? `<small class="field-hint gift-pin is-ok">${icon('check')}<span>We deliver to ${esc(pin)}</span></small>` : served === 'checking' ? `<small class="field-hint gift-pin">${icon('clock')}<span>Checking ${esc(pin)}…</span></small>` : ''
  const others = gift.recipients.some((x) => x !== r && x.saved)
  const cancel = r.saved ? 'Cancel the changes' : others ? 'Don’t add this person' : ''
  return `<li class="gift-person is-open" data-person="${esc(r.id)}" aria-labelledby="${k('h')}">
    <h3 class="gift-person-h" id="${k('h')}" tabindex="-1">${icon('user')}<span>${r.saved && name ? `Change ${esc(name)}` : `Person ${i + 1}`}</span></h3>
    <div class="gift-fields">
      <label class="field">Their name<input name="${k('name')}" maxlength="80" autocomplete="off" value="${esc(r.name)}"></label>
      <label class="field">Their mobile number<input name="${k('phone')}" type="tel" inputmode="tel" maxlength="16" autocomplete="off" placeholder="10-digit number" value="${esc(r.phone)}" aria-describedby="${k('phone-hint')}"><small class="field-hint" id="${k('phone-hint')}">Only for the delivery person</small></label>
      <label class="field wide">Their address<textarea name="${k('address')}" rows="3" maxlength="500" autocomplete="off" placeholder="House, street, area, landmark">${esc(r.address)}</textarea></label>
      <label class="field gift-pin-field">Pincode<input name="${k('pincode')}" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" placeholder="6 digits" value="${esc(r.pincode)}">${pinHint}</label>
    </div>
    <div class="gift-extra">
      ${r.own
        ? `<div class="gift-own"><p class="gift-own-h">${icon('gift')}<span>A different box for ${esc(name || 'this person')}</span></p>${boxPickerHTML(r)}<button type="button" class="text-button gift-quiet" data-gift-own="off" data-rid="${esc(r.id)}">${icon('close')}<span>Give them the same box as everyone</span></button></div>`
        : `<button type="button" class="text-button gift-quiet" data-gift-own="on" data-rid="${esc(r.id)}">${icon('gift')}<span>Give this person a different box</span></button>`}
      ${r.ownNote
        ? `<div class="gift-own"><label class="field gift-note">A note just for ${esc(name || 'this person')}<textarea name="${k('note')}" rows="3" maxlength="${GIFT_NOTE_MAX}" placeholder="Happy summer!" aria-describedby="${k('count')}">${esc(r.note)}</textarea><small class="gift-count" id="${k('count')}">${noteCount(r.note)}</small></label><button type="button" class="text-button gift-quiet" data-gift-ownnote="off" data-rid="${esc(r.id)}">${icon('close')}<span>Use the note for everyone</span></button></div>`
        : `<button type="button" class="text-button gift-quiet" data-gift-ownnote="on" data-rid="${esc(r.id)}">${icon('mail')}<span>Write a different note for this person</span></button>`}
    </div>
    <div class="gift-person-go"><button type="button" class="button primary gift-big" data-gift-save="${esc(r.id)}">${icon('check')}<span>Save this person</span></button>${cancel ? `<button type="button" class="text-button gift-quiet" data-gift-discard="${esc(r.id)}">${cancel}</button>` : ''}</div>
  </li>`
}
const noteCount = (s) => `${s.length} / ${GIFT_NOTE_MAX}${s.length >= GIFT_NOTE_MAX ? ' · that’s the most a note can hold' : ''}`

/** A saved person, in one line: "✓ Meera Rao · 2 boxes · 560001   [Edit] [Remove]". */
function personRowHTML(r, i) {
  const p = packOf(r.sku), name = r.name.trim() || `Person ${i + 1}`
  const bits = [plural(r.qty, 'box', 'boxes'), r.pincode.trim()].filter(Boolean).join(' · ')
  const extra = [r.own && p ? `Own box: ${p.name} · ${p.kg} · ${stageOf(r.stage).stage}` : '', r.ownNote && r.note.trim() ? 'Own note' : ''].filter(Boolean).join(' · ')
  return `<li class="gift-row${r.saved ? '' : ' is-unfinished'}" data-row="${esc(r.id)}"><span class="gift-row-mark" aria-hidden="true">${icon(r.saved ? 'check' : 'info')}</span><div class="gift-row-main" id="gift-row-${esc(r.id)}" tabindex="-1"><p><strong>${esc(name)}</strong> <span>· ${esc(bits)}</span></p>${extra ? `<small>${esc(extra)}</small>` : ''}${r.saved ? '' : '<small class="gift-row-todo">Not finished yet: press Edit</small>'}</div><div class="gift-row-acts"><button type="button" class="button secondary gift-row-btn" data-gift-edit="${esc(r.id)}" aria-label="Edit ${esc(name)}">Edit</button><button type="button" class="button secondary gift-row-btn" data-gift-remove="${esc(r.id)}" aria-label="Remove ${esc(name)}">Remove</button></div></li>`
}

/** Below the people (no form open): add another, the note for everyone, the day (in season), GST, the total, go on. */
function afterPeopleHTML(preTag = '') {
  const pres = !!preSeason(), max = giftMax(), full = gift.recipients.length >= max, signed = !!MM.profile()
  return `<div class="gift-more">
      <button type="button" class="button secondary gift-big gift-add" data-gift-add${full ? ' disabled aria-describedby="gift-add-why"' : ''}>${icon(full ? 'lock' : 'user')}<span>Add another person</span></button>
      ${full ? `<p class="gift-why" id="gift-add-why">${icon('info')}<span>${max} people is the most one gift can have. Send the rest as a second gift.</span></p>` : ''}
    </div>
    <section class="gift-sec" aria-label="Gift note">
      <label class="field gift-note">Gift note (goes with every box)<textarea name="gift-note" rows="3" maxlength="${GIFT_NOTE_MAX}" placeholder="Happy summer! Enjoy the first mangoes of the season." aria-describedby="gift-note-count">${esc(gift.note)}</textarea><small class="gift-count" id="gift-note-count">Optional · ${noteCount(gift.note)}</small></label>
      <label class="field">Your name on the note (optional)<input name="gift-sender" maxlength="80" autocomplete="name" value="${esc(gift.sender)}"></label>
    </section>
    ${pres ? '' : `<section class="gift-sec" aria-labelledby="gift-when-h"><h3 id="gift-when-h">When should it arrive?</h3><div id="gift-when">${whenHTML()}</div></section>`}
    ${giftBills() && !pres ? bizHTML() : ''}
    ${preTag}
    <div class="gift-total" id="gift-total">${totalHTML()}</div>
    <div id="gift-alert">${alertHTML()}</div>
    <button type="button" class="button primary gift-big gift-continue" data-gift-review><span>That’s everyone: review and pay</span>${icon('arrow')}</button>
    ${signed ? '' : `<p class="gift-muted gift-signin">${icon('user')}<span>You’ll sign in with your mobile number first.</span></p>`}`
}

/** Business name and GSTIN for the one bill (in season), tucked behind a link. */
function bizHTML() {
  if (!gift.business) return `<button type="button" class="text-button gift-quiet gift-biz-link" data-gift-biz="on">${icon('store')}<span>Buying for a business? Add GST details</span></button>`
  return `<section class="gift-sec" aria-labelledby="gift-biz-h"><h3 id="gift-biz-h">GST details for the bill</h3><p class="gift-muted">${icon('info')}<span>They go on the one bill for the whole gift.</span></p><div class="gift-fields gift-biz"><label class="field">Business name<input name="gift-biz-name" maxlength="100" autocomplete="organization" placeholder="As on the GST certificate" value="${esc(gift.bizName)}"></label><label class="field">GSTIN<input name="gift-gstin" maxlength="20" autocapitalize="characters" spellcheck="false" placeholder="15 characters" value="${esc(gift.gstin)}"></label></div><button type="button" class="text-button gift-quiet" data-gift-biz="off">${icon('close')}<span>Remove the GST details</span></button></section>`
}

function totalHTML() {
  const t = giftTotals()
  return `<p class="gift-total-row"><span>Total, paid once<small>${plural(t.people, 'person', 'people')} · ${plural(t.boxes, 'box', 'boxes')} · delivery included</small></span><strong>${currency(t.total)}</strong></p>`
}

/** Days the boxes chosen so far are in stock on (all recipients together); unknown stock counts as fitting. */
function giftNeed() {
  const need = new Map()
  for (const r of gift.recipients) if (packOf(r.sku)) need.set(`${r.sku}|${r.stage}`, (need.get(`${r.sku}|${r.stage}`) || 0) + r.qty)
  return need
}
function dayFits(d) {
  if (!stockKnown()) return true
  for (const [key, qty] of giftNeed()) { const [sku, stage] = key.split('|'); if (dayQty(sku, stage, d) < qty) return false }
  return true
}

function whenHTML() {
  if (preSeason()) return preWhenHTML()
  if (!giftEnv.dates.length) return `<p class="gift-muted">${icon('pin')}<span>Add a pincode we deliver to and the delivery days show here.</span></p>`
  const cut = esc(giftEnv.cutoff || (policy && policy.cutoffTime) || '18:00 IST')
  const cards = giftEnv.dates.map((x) => {
    const dt = new Date(x + 'T00:00:00'), on = x === gift.date, unfit = !dayFits(x)
    return `<button type="button" class="date-card${unfit ? ' is-unfit' : ''}" data-gift-date="${x}" aria-pressed="${on}" aria-label="${fmtDate(x)}${unfit ? ', not enough boxes for this order' : ''}"${unfit ? ' aria-disabled="true"' : ''}><small>${dayName(x)}</small><strong>${dt.getDate()}</strong><small>${dt.toLocaleDateString('en-IN', { month: 'short' })}</small>${unfit ? `<small class="date-unfit">${icon('close')}<span>Not enough</span></small>` : ''}</button>`
  }).join('')
  const slots = giftEnv.slots.length ? `<p class="gift-label" id="gift-slot-l">Time</p><div class="slot-cards" id="gift-slots" role="group" aria-labelledby="gift-slot-l" tabindex="-1">${giftEnv.slots.map((s) => {
    const off = s.available === false, on = s.id === gift.slotId
    return `<button type="button" class="slot-card" data-gift-slot="${esc(s.id)}" aria-pressed="${on}" ${off ? 'disabled' : ''}><strong>${esc(s.label)}</strong><small>${esc(s.startsAt)}–${esc(s.endsAt)}${off ? ' · Full' : ''}</small>${on ? icon('check') : ''}</button>`
  }).join('')}</div>` : ''
  return `<p class="gift-muted">${icon('calendar')}<span>One day and time for everyone. Order by ${cut} for the next day.</span></p><p class="gift-label" id="gift-date-l">Day</p><div class="date-cards" id="gift-dates" role="group" aria-labelledby="gift-date-l" tabindex="-1">${cards}</div>${slots}`
}

/** Before the season: each person's delivery week (a pre-order has a week, not a day or a time). */
function preWhenHTML() {
  const list = giftPreWeeks()
  if (!list.length) return ''
  const ws = new Set(list.filter((x) => x.week).map((x) => String(x.week.weekStart)))
  const rows = list.map(({ r, week, first, moved, big }, i) => {
    const who = esc(r.name.trim() || `Person ${i + 1}`)
    const what = !packOf(r.sku) ? 'Choose a gift pack to see the week'
      : big ? esc(preTooBigWords(r.sku))
      : week ? `Delivered in ${preWeekText(week.weekStart)}${moved ? `<small class="pre-moved">${esc(preFullLine(first.weekStart, week.weekStart))}</small>` : ''}`
        : `No delivery week has room for ${plural(r.qty, 'box', 'boxes')} of this pack. Choose fewer boxes or another pack.`
    return `<li class="${week || !packOf(r.sku) ? '' : 'is-off'}">${icon(week ? 'calendar' : packOf(r.sku) ? 'close' : 'info')}<span><strong>${who}</strong> · ${what}</span></li>`
  }).join('')
  return `<ul class="gift-pre-weeks">${rows}</ul>${ws.size > 1 ? `<p class="pre-why is-block">${icon('info')}<span>Not everyone gets their gift in the same week: each person’s week is shown above.</span></p>` : ''}`
}

function giftTotals() {
  let boxes = 0, total = 0
  const lines = gift.recipients.map((r, i) => {
    const p = packOf(r.sku)
    const line = p ? p.s.price * r.qty : 0
    if (p) { boxes += r.qty; total += line }
    return { r, i, p, line }
  })
  return { lines, boxes, total, people: gift.recipients.length }
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

/** One person's problems (their own fields only), in form order: [{ name, msg, pending }]. Their box is checked here
 *  only when it is their own (else it is everyone's box, checked once). `strict`: a pincode that could not be checked
 *  is an error to act on, not a wait. */
function personProblems(r, strict) {
  const out = [], add = (name, msg, pending) => out.push({ name, msg, pending: !!pending })
  const k = (f) => fname(r, f), name = r.name.trim(), ph = normPhone(r.phone), a = r.address.trim(), pin = r.pincode.trim()
  if (preSeason() && r.own && packOf(r.sku) && preTooBig(r.qty, r.sku)) add(k('qty'), preTooBigWords(r.sku))
  if (!name) add(k('name'), 'Enter their name')
  else if (name.length > 80) add(k('name'), 'Keep the name to 80 letters')
  if (!ph) add(k('phone'), 'Enter their mobile number')
  else if (!/^[6-9]\d{9}$/.test(ph)) add(k('phone'), 'Enter a 10-digit mobile number')
  if (!a) add(k('address'), 'Enter their address')
  else if (a.length < 10) add(k('address'), 'Enter the full address: house, street and area')
  if (!pin) add(k('pincode'), 'Enter the pincode')
  else if (!/^[1-9]\d{5}$/.test(pin)) add(k('pincode'), 'Enter a 6-digit pincode')
  else if (giftEnv.pins[pin] === false) add(k('pincode'), `We don’t deliver to ${pin} yet`)
  else if (giftEnv.pins[pin] !== true) {
    if (strict && giftEnv.pins[pin] !== 'checking') add(k('pincode'), 'We couldn’t check this pincode just now. Check your connection and try again.')
    else add(k('pincode'), `Checking the pincode ${pin}…`, true)
  }
  if (r.own) {
    const p = packOf(r.sku)
    if (!p) add(k('sku'), 'Choose a gift box')
    else if (stockKnown() && !anyQty(p.sku, r.stage)) add(k('qty'), `${stageOf(r.stage).stage} ${p.name.toLowerCase()} is out of stock: choose the other ripeness`)
    if (!(Number.isInteger(r.qty) && r.qty >= 1 && r.qty <= GIFT_BOX_MAX)) add(k('qty'), `Choose 1 to ${GIFT_BOX_MAX} boxes`)
  }
  if (r.ownNote && r.note.length > GIFT_NOTE_MAX) add(k('note'), `Keep the note to ${GIFT_NOTE_MAX} letters`)
  return out
}

/** Every problem in the gift, in page order: [{ name, msg, pending }]. `name` is a field's name, or #id for a part. */
function giftProblems(strict) {
  syncPeople()
  const out = [], add = (name, msg, pending) => { if (!out.some((x) => x.name === name && x.msg === msg)) out.push({ name, msg, pending: !!pending }) }
  const b = gift.box, bp = b && packOf(b.sku)
  if (gift.recipients.some((r) => !r.own)) {
    if (!bp) add('#gift-everyone', 'Choose the box everyone gets')
    else if (stockKnown() && !anyQty(bp.sku, b.stage)) add('#gift-everyone', `${stageOf(b.stage).stage} ${bp.name.toLowerCase()} is out of stock: choose the other ripeness`)
  }
  if (!gift.recipients.length) add('[data-gift-add]', 'Add a person to send the gift to')
  gift.recipients.forEach((r) => { for (const x of personProblems(r, strict)) out.push(x) })
  if (gift.note.length > GIFT_NOTE_MAX) add('gift-note', `Keep the note to ${GIFT_NOTE_MAX} letters`)
  // Stock on the chosen day, for every person with the same box and ripeness together.
  if (stockKnown() && gift.date) {
    for (const [key, qty] of giftNeed()) {
      const [sku, stage] = key.split('|'), left = dayQty(sku, stage, gift.date)
      if (left >= qty || !anyQty(sku, stage)) continue
      const p = packOf(sku), who = gift.recipients.filter((r) => r.sku === sku && r.stage === stage)
      const msg = `Only ${left} ${stageOf(stage).stage.toLowerCase()} ${p.kg} ${p.s.variety} ${left === 1 ? 'box is' : 'boxes are'} left on ${fmtDate(gift.date)}${who.length > 1 ? ' for everyone together' : ''}: choose fewer boxes or another day`
      who.forEach((r) => add(r.own ? fname(r, 'qty') : '#gift-everyone', msg))
    }
  }
  if (preSeason()) {
    for (const { r, week, big } of giftPreWeeks()) if (packOf(r.sku) && !week) add(r.own ? fname(r, 'qty') : '#gift-everyone', big ? `${whoOf(r)}: ${preTooBigWords(r.sku)}` : `No delivery week has room for ${whoOf(r)}’s ${plural(r.qty, 'box', 'boxes')}: choose fewer boxes or another box`)
  } else if (gift.recipients.length) {
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

/** A problem in words, with whose it is: "Meera Rao: enter their mobile number". */
function problemText(p) {
  const m = p.name.match(/^g-(r\d+)-/)
  const r = m && gift.recipients.find((x) => x.id === m[1])
  if (!r) return p.msg
  return `${whoOf(r)}: ${p.msg.charAt(0).toLowerCase()}${p.msg.slice(1)}`
}

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

/** The flow has its own big buttons in the page, so the sticky pay bar stays empty on the Gifting page. */
function giftBar() { if (giftPage()) setBar('') }

/** Redraws the parts that follow from the form's numbers (not the fields being typed in). */
function giftRefresh() {
  syncPeople()
  const note = $('#gift-pre-notice')
  if (note && preSeason()) note.innerHTML = preNoticeHTML(giftPreWhen(giftPreWeekList(giftPreWeeks())))
  const tot = $('#gift-total')
  if (tot) tot.innerHTML = totalHTML()
  const when = $('#gift-when')
  if (when) {
    const a = document.activeElement, sel = a && when.contains(a) && (a.dataset.giftDate ? { 'data-gift-date': a.dataset.giftDate } : a.dataset.giftSlot ? { 'data-gift-slot': a.dataset.giftSlot } : null)
    when.innerHTML = whenHTML()
    refocus(when, sel)
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

/** "Send as a gift" on a card: its box (pack, ripeness, and the card's quantity as the boxes each person gets) is the
 *  box everyone gets, and the flow opens on step 2 with the first person's form (or where it was left). */
function openSend(sku, stage, qty = 1) {
  if (giftGate() || qty < 1) return
  const changed = gift.recipients.some((r) => r.saved && !r.own) && gift.box && (gift.box.sku !== sku || gift.box.stage !== stage || gift.box.qty !== qty)
  gift.box = { sku, stage, qty: Math.min(GIFT_BOX_MAX, qty) }
  gift.boxOpen = false
  delete gift.errors['#gift-everyone']
  if (gift.step === 'review') gift.step = 'form'
  if (!gift.recipients.length) { const r = newPerson({}); gift.recipients.push(r); gift.editing = r.id; gift.snap = null }
  syncPeople()
  if (!preSeason() && (!gift.date || !dayFits(gift.date))) gift.date = giftEnv.dates.find((d) => dayFits(d)) || gift.date
  setFlow(true)
  giftUrl('form')
  renderGiftSend()
  giftSlots()
  saveDraft()
  const open = gift.recipients.find((r) => r.id === gift.editing)
  giftTop(open ? `[name="${fname(open, 'name')}"]` : null)
  say(changed ? `Everyone now gets ${boxLine(sku, stage, gift.box.qty)}.` : `${boxLine(sku, stage, gift.box.qty)} for each person. Now tell us who gets it.`)
}

// ---- One person at a time: save, edit, remove, add another.

function showPersonErrors(r, probs) {
  for (const x of probs) gift.errors[x.name] = x.msg
  renderGiftSend()
  focusField(probs[0].name)
  say(`${probs.length === 1 ? 'One thing to fix' : `${probs.length} things to fix`}. ${problemText(probs[0])}`)
}
/** Closes the open form before another one opens: saved when it is complete, dropped when it is still empty. When it
 *  has a mistake it stays open with the mistakes shown, and false is returned. */
function closeOpen() {
  const r = gift.recipients.find((x) => x.id === gift.editing)
  if (!r) { gift.editing = null; gift.snap = null; return true }
  if (!r.saved && blankPerson(r)) { gift.recipients.splice(gift.recipients.indexOf(r), 1); gift.editing = null; gift.snap = null; return true }
  const probs = personProblems(r).filter((x) => !x.pending)
  if (probs.length) { showPersonErrors(r, probs); return false }
  r.saved = true
  gift.editing = null
  gift.snap = null
  return true
}
async function savePerson(id) {
  const r = gift.recipients.find((x) => x.id === id)
  if (!r || gift.editing !== id) return
  const pin = r.pincode.trim()
  if (/^[1-9]\d{5}$/.test(pin) && giftEnv.pins[pin] !== true && giftEnv.pins[pin] !== false) {
    const b = $(`[data-gift-save="${CSS.escape(id)}"]`)
    if (b) { b.disabled = true; b.querySelector('span').textContent = 'Checking the pincode…' }
    await checkPin(pin)
    if (!giftPage() || gift.editing !== id) return
  }
  const probs = personProblems(r, true)
  if (probs.length) { if (!$('#gift-form')) return; showPersonErrors(r, probs); return }
  r.saved = true
  gift.editing = null
  gift.snap = null
  gift.removed = null
  renderGiftSend()
  saveDraft()
  focusSel(`#gift-row-${CSS.escape(r.id)}`)
  const n = gift.recipients.filter((x) => x.saved).length
  say(`${r.name.trim()} is saved. ${plural(n, 'person', 'people')} so far.`)
}
function editPerson(id) {
  const r = gift.recipients.find((x) => x.id === id)
  if (!r) return
  if (gift.editing && gift.editing !== id && !closeOpen()) return
  gift.editing = id
  gift.snap = r.saved ? { ...r } : null
  gift.removed = null
  renderGiftSend()
  saveDraft()
  focusField(fname(r, 'name'))
}
function discardPerson(id) {
  const r = gift.recipients.find((x) => x.id === id)
  if (!r) return
  Object.keys(gift.errors).forEach((k) => { if (k.startsWith(`g-${r.id}-`)) delete gift.errors[k] })
  if (gift.snap && gift.snap.id === r.id) Object.assign(r, gift.snap, { saved: true })
  else gift.recipients.splice(gift.recipients.indexOf(r), 1)
  gift.editing = null
  gift.snap = null
  renderGiftSend()
  saveDraft()
  if (gift.recipients.includes(r)) focusSel(`#gift-row-${CSS.escape(r.id)}`)
  else focusSel('[data-gift-add]')
}
function addPerson() {
  if (gift.recipients.length >= giftMax()) return
  if (gift.editing && !closeOpen()) return
  const r = newPerson({})
  gift.recipients.push(r)
  gift.editing = r.id
  gift.snap = null
  gift.removed = null
  renderGiftSend()
  saveDraft()
  focusField(fname(r, 'name'))
  say(`Person ${gift.recipients.length}: fill in their details.`)
}
function removePerson(id) {
  const i = gift.recipients.findIndex((r) => r.id === id)
  if (i < 0) return
  const r = gift.recipients[i]
  gift.recipients.splice(i, 1)
  Object.keys(gift.errors).forEach((k) => { if (k.startsWith(`g-${r.id}-`)) delete gift.errors[k] })
  if (gift.editing === r.id) { gift.editing = null; gift.snap = null }
  gift.removed = { r, i }
  // Nobody left: the first person's form again.
  if (!gift.recipients.length) { const n = newPerson({}); gift.recipients.push(n); gift.editing = n.id }
  if (gift.date && !dayFits(gift.date)) gift.date = giftEnv.dates.find((x) => dayFits(x)) || gift.date
  renderGiftSend()
  saveDraft()
  focusSel('[data-gift-undo]')
  say(`${r.name.trim() || 'That person'} is removed. Press Undo to bring them back.`)
}
function undoRemove() {
  const x = gift.removed
  if (!x) return
  gift.removed = null
  // The empty form opened because nobody was left goes again.
  const open = gift.recipients.find((r) => r.id === gift.editing)
  if (open && !open.saved && blankPerson(open)) { gift.recipients.splice(gift.recipients.indexOf(open), 1); gift.editing = null }
  if (gift.recipients.length >= giftMax()) { renderGiftSend(); return }
  gift.recipients.splice(Math.min(x.i, gift.recipients.length), 0, x.r)
  renderGiftSend()
  saveDraft()
  focusSel(`#gift-row-${CSS.escape(x.r.id)}`)
  say(`${x.r.name.trim() || 'That person'} is back.`)
}

/** "That's everyone: review and pay": everything is checked (the first mistake is opened and shown), then the review. */
async function giftToReview() {
  if (gift.busy) return
  gift.wantReview = false
  gift.error = ''
  gift.removed = null
  if (gift.editing && !closeOpen()) return
  gift.recipients = gift.recipients.filter((r) => r.saved || !blankPerson(r))
  if (!gift.recipients.length) { const r = newPerson({}); gift.recipients.push(r); gift.editing = r.id; renderGiftSend(); focusField(fname(r, 'name')); return }
  const pins = [...new Set(gift.recipients.map((r) => r.pincode.trim()).filter((p) => /^[1-9]\d{5}$/.test(p) && giftEnv.pins[p] !== true && giftEnv.pins[p] !== false))]
  if (pins.length) await Promise.all(pins.map((p) => checkPin(p)))
  if (!giftPage() || gift.step !== 'form') return
  const probs = giftProblems(true), p = probs.find((x) => !x.pending) || probs[0]
  if (p) {
    if (p.pending) { gift.error = `${problemText(p)} Press the button again in a moment.`; renderGiftSend(); focusSel('[data-gift-review]') } else fixProblem(p)
    return
  }
  if (!MM.profile()) {
    gift.wantReview = true
    saveDraft()
    setTimeout(() => go(`/login?next=${encodeURIComponent('/gifts/send/review')}`), 200)
    return
  }
  for (const r of gift.recipients) r.saved = true
  gift.step = 'review'
  gift.agree = false
  gift.unpaid = null
  gift.key = null
  renderGiftSend()
  saveDraft()
  giftUrl('review')
  giftTop()
}

/** Checks a pincode the way checkout does (GET /v1/delivery/check), once per pincode; the promise settles when the
 *  answer is in ("Save this person" waits for it). */
const pinWait = {}
function checkPin(pin) {
  if (giftEnv.pins[pin] === true || giftEnv.pins[pin] === false) return Promise.resolve()
  if (giftEnv.pins[pin] === 'checking' && pinWait[pin]) return pinWait[pin]
  giftEnv.pins[pin] = 'checking'
  return (pinWait[pin] = pinCheck(pin))
}
async function pinCheck(pin) {
  let ok
  try { ok = !!(await MM.deliveryCheck(pin)).serviceable } catch { ok = undefined }
  giftEnv.pins[pin] = ok
  if (!giftPage()) return
  if (ok && !giftEnv.days) { await giftStock(pin); renderGiftGrid() }
  // Each recipient with this pincode: its hint and error.
  for (const r of gift.recipients) {
    if (r.pincode.trim() !== pin) continue
    const li = $(`[data-person="${r.id}"]`)
    const label = li && li.querySelector('.gift-pin-field')
    if (label) {
      label.querySelector('.gift-pin')?.remove()
      if (ok === true) label.insertAdjacentHTML('beforeend', `<small class="field-hint gift-pin is-ok">${icon('check')}<span>We deliver to ${esc(pin)}</span></small>`)
    }
    const name = fname(r, 'pincode')
    if (ok === false || gift.errors[name]) checkField(name, ok === false)
  }
  giftSlots()
  giftRefresh()
}

/** The slots for the chosen day (the first served pincode's; every served pincode has the same). */
async function giftSlots() {
  if (preSeason()) return
  const pin = gift.recipients.map((r) => r.pincode.trim()).find((p) => giftEnv.pins[p] === true) || giftEnv.catPin
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

// ---- Paying: quote (every recipient checked again by the API) → confirm (one Razorpay order) → pay.

const giftBody = () => (syncPeople(), {
  deliveryDate: gift.date, slotId: gift.slotId || null,
  recipients: gift.recipients.map((r) => ({ name: r.name.trim(), phone: normPhone(r.phone), address: r.address.trim(), pincode: r.pincode.trim(), sku: r.sku, stage: r.stage, qty: r.qty, note: noteOf(r) || null })),
})

/** The API's answer, on the fields it names (RECIPIENTS_INVALID rows), else one line above the pay bar. */
function giftFailed(e) {
  gift.error = ''
  const x = e.extra || {}
  if (e.code === 'RECIPIENTS_INVALID' && Array.isArray(x.rows)) {
    const map = { stage: 'qty' }
    for (const row of x.rows) {
      const r = gift.recipients[row.row - 1]
      if (r) gift.errors[fname(r, map[row.field] || row.field)] = row.message
    }
    gift.error = 'Some details need a look: they are marked on each person.'
  } else if (e.code === 'STOCK_INSUFFICIENT') {
    const p = packOf(x.sku)
    gift.error = `Not enough ${p ? `${p.s.variety} ${p.kg}` : 'of one box'} boxes on ${fmtDate(gift.date)}. Choose fewer boxes or another day.`
    giftEnv.days = null
    if (giftEnv.catPin) giftStock(giftEnv.catPin).then(() => { renderGiftGrid(); giftRefresh() })
  } else if (e.code === 'TOO_MANY_RECIPIENTS') gift.error = `A gift order can have up to ${x.maxRecipients || giftMax()} people.`
  else if (e.code === 'HOLD_LIMIT') gift.error = `One order can hold up to ${x.maxHeldBoxes || 40} boxes at a time. Send fewer boxes, or split the gift into two orders.`
  else if (e.code === 'UNPAID_ORDER_EXISTS') gift.unpaid = x
  else if (e.code === 'BILLS_OFF') { gift.business = false; gift.error = 'Business details for the bill are not taken at the moment. Pay without them.' }
  else if (e.code === 'VALIDATION_ERROR' && /^business\.(name|gstin)/.test(e.message)) {
    const field = /^business\.gstin/.test(e.message) ? 'gift-gstin' : 'gift-biz-name'
    gift.errors[field] = e.message.replace(/^business\.\w+:\s*/, '')
  } else if (e.code === 'NOT_SERVICEABLE') gift.error = 'We don’t deliver to the first person’s pincode yet.'
  else if (e.status === 404) gift.error = 'Gifting isn’t open right now. Please try again later.'
  else if (e.code === 'SLOT_FULL' || e.code === 'SLOT_REQUIRED' || e.code === 'SLOT_INVALID') { gift.slotId = null; giftEnv.slotsFor = ''; gift.error = e.code === 'SLOT_FULL' ? 'That time just filled up. Choose another.' : 'Choose the delivery time.'; giftSlots() }
  else if (['INVALID_DATE', 'NO_DELIVERY_DAY', 'DATE_CLOSED', 'DATE_FULL'].includes(e.code)) { gift.error = orderError(e); giftEnv.days = null; gift.date = null; if (giftEnv.catPin) giftStock(giftEnv.catPin).then(() => { giftEnv.slotsFor = ''; giftSlots(); giftRefresh() }) }
  else gift.error = orderError(e)
}

/** In season, the review's "Pay" (before the season the review books the pre-orders instead, giftGroupBook). */
async function giftPay() {
  if (gift.busy || preSeason()) return
  const probs = giftProblems(true)
  if (probs.length) { fixProblem(probs.find((x) => !x.pending) || probs[0]); return }
  if (!MM.profile()) {
    gift.wantReview = true
    saveDraft()
    setTimeout(() => go(`/login?next=${encodeURIComponent('/gifts/send/review')}`), 300)
    return
  }
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
        if (e.code === 'PRICE_CHANGED') { gift.error = e.message; await loadProducts(); renderGiftGrid(); return }
        throw e
      }
    }
  } catch (e) {
    if (e.status === 401) { saveDraft(); go(`/login?next=${encodeURIComponent('/gifts/send/review')}`); return }
    giftFailed(e)
  } finally {
    gift.busy = false
    if (!c && giftPage() && $('#gift-send') && gift.step !== 'pay') {
      backToErrors()
      renderGiftSend()
      const open = gift.recipients.find((r) => r.id === gift.editing), bad = open && Object.keys(gift.errors).find((k) => k.startsWith(`g-${open.id}-`))
      if (!(bad && focusField(bad))) $('#gift-alert')?.scrollIntoView({ block: 'center', behavior: reduced ? 'instant' : 'smooth' })
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
  return `<div class="co-pay gift-pay"><p class="co-pay-no">Gift order <strong>${esc(giftNo(p.number))}</strong></p><p class="co-pay-total">${currency(p.total)}</p><p class="gift-pay-for">${plural(p.people || gift.recipients.length, 'person', 'people')} · delivered ${esc(fmtDate(p.deliveryDate))}${slot ? `, ${esc(slot.label)}` : ''}</p>${p.failed ? (typeof payStateHTML === 'function' ? payStateHTML({ status: 'PAYMENT_PENDING', paymentFailed: true, holdExpiresAt: p.holdExpiresAt }) : '') : `<p class="co-pay-hold">${icon('box')}<span>Every box is held for you until <strong>${fmtTime(p.holdExpiresAt)}</strong>. Pay before then to confirm.</span></p>`}${gift.error ? `<p class="prototype-tag" role="alert">${esc(gift.error)}</p>` : ''}${p.razorpayKeyId
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

/** Test mode only: a failed payment attempt (the API's dev pay-gift route with outcome failed, as Razorpay's payment.failed would). */
async function giftTestFail(id, after) {
  try { await MM.api('/' + ['dev', 'pay-gift'].join('/'), { method: 'POST', body: { giftOrderId: id, outcome: 'failed' } }) } catch (e) { toast(e.message); return }
  if (after) { giftOrderView(id, true); return }
  if (gift.pay) gift.pay.failed = true
  gift.busy = false
  gift.error = ''
  renderGiftSend()
}

/** The test payment (development only: the API's dev pay-gift route, as the Razorpay webhook would). */
async function giftTestPay(id, after) {
  gift.busy = true
  if (!after) renderGiftSend()
  try { await MM.api('/' + ['dev', 'pay-gift'].join('/'), { method: 'POST', body: { giftOrderId: id, outcome: 'captured' } }) } catch (e) { gift.busy = false; gift.error = e.message; if (!after) renderGiftSend(); else toast(e.message); return }
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

/** Shows one problem where it is: that person's form opened with the mistake next to the field (the first wrong field
 *  gets the focus), the box everyone gets opened, or the part of the page it is about. */
function fixProblem(p) {
  if (!p) return
  gift.step = 'form'
  const m = p.name.match(/^g-(r\d+)-\w+$/)
  if (m) {
    const r = gift.recipients.find((x) => x.id === m[1])
    if (!r) return
    if (gift.editing && gift.editing !== r.id && !closeOpen()) return
    if (gift.editing !== r.id) { gift.snap = r.saved ? { ...r } : null; gift.editing = r.id }
    const probs = personProblems(r, true).filter((x) => !x.pending)
    if (!p.pending && !probs.some((x) => x.name === p.name)) probs.push(p)
    for (const x of probs) gift.errors[x.name] = x.msg
    renderGiftSend()
    const first = probs[0] || p
    if (!focusField(first.name)) focusSel(`#${CSS.escape(fname(r, 'h'))}`)
    say(problemText(first))
    return
  }
  if (p.name === '#gift-everyone') {
    gift.boxOpen = true
    gift.errors['#gift-everyone'] = p.msg
    renderGiftSend()
    focusField('gift-box-sku')
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

/** The API marked a person's field: back to step 2 with that person's form open. A mistake in a box or note that is
 *  everyone's (not on that person's form) is said in one line instead. */
function backToErrors() {
  const key = Object.keys(gift.errors).find((k) => /^g-r\d+-/.test(k))
  const biz = gift.errors['gift-biz-name'] || gift.errors['gift-gstin']
  if (!key && !biz) return
  gift.step = 'form'
  if (!key) return
  const [, id, f] = key.match(/^g-(r\d+)-(\w+)$/)
  const r = gift.recipients.find((x) => x.id === id)
  if (!r) return
  if ((['sku', 'qty', 'stage'].includes(f) && !r.own) || (f === 'note' && !r.ownNote)) {
    gift.error = `${whoOf(r)}: ${gift.errors[key]}`
    delete gift.errors[key]
    if (f === 'note') gift.errors['gift-note'] = gift.error
    return
  }
  gift.editing = r.id
  gift.snap = { ...r }
}

// ---- Before the season: review, book (POST /v1/preorders/groups), pay once, done.

function giftReviewHTML() {
  const pres = !!preSeason(), t = giftTotals()
  const list = pres ? giftPreWeeks() : gift.recipients.map((r) => ({ r }))
  const ws = new Set(list.filter((x) => x.week).map((x) => String(x.week.weekStart)))
  const blocked = pres && list.some((x) => !x.week)
  const bigAt = pres ? list.findIndex((x) => x.big) : -1
  const slot = giftEnv.slots.find((s) => s.id === gift.slotId)
  const day = !pres && gift.date ? `${fmtDate(gift.date)}${slot ? `, ${slot.label} (${slot.startsAt}–${slot.endsAt})` : ''}` : ''
  const rows = list.map(({ r, week, first, moved, big }, i) => {
    const p = packOf(r.sku), note = noteOf(r)
    const when = pres
      ? `<small class="gift-review-week${week ? '' : ' is-off'}">${icon(week ? 'calendar' : 'close')}<span>${week ? `Delivered in ${preWeekText(week.weekStart)}` : big ? esc(preTooBigWords(r.sku)) : 'No delivery week has room for these boxes'}</span></small>${moved ? `<small class="pre-moved">${esc(preFullLine(first.weekStart, week.weekStart))}</small>` : ''}`
      : `<small class="gift-review-week">${icon('calendar')}<span>Delivered on ${esc(day)}</span></small>`
    return `<li class="gift-review-row">${p ? thumb(p.sku, r.stage, p.s.name) : ''}<div><strong>${esc(r.name.trim() || `Person ${i + 1}`)}</strong><small>${p ? `${esc(p.name)} · ${esc(p.kg)} · ${stageOf(r.stage).stage} · ${plural(r.qty, 'box', 'boxes')}` : ''}</small><small>${esc(r.address.trim())} · ${esc(r.pincode.trim())}</small>${note ? `<small class="gift-review-note">Note: “${esc(note.length > 90 ? `${note.slice(0, 89)}…` : note)}”</small>` : ''}${when}</div><span>${p ? currency(p.s.price * r.qty) : ''}</span></li>`
  }).join('')
  const back = `<button type="button" class="text-button gift-quiet gift-back" data-gift-back ${gift.busy ? 'disabled' : ''}>${icon('arrow')}<span>Back to the people</span></button>`
  if (!pres) {
    return `<div class="gift-send-head"><h2 id="gift-send-h" tabindex="-1">Check and pay</h2><p>${plural(t.people, 'person', 'people')} · ${plural(t.boxes, 'box', 'boxes')} · one payment</p></div>
      <ol class="gift-review">${rows}</ol>
      ${gift.business && giftBills() ? `<p class="gift-muted">${icon('store')}<span>Bill to ${esc(gift.bizName.trim())} · GSTIN ${esc(gift.gstin.replace(/\s+/g, '').toUpperCase())}</span></p>` : ''}
      <div class="bill-row is-total gift-review-total"><span>Total, paid once</span><strong>${currency(t.total)}</strong></div>
      <p class="cart-disclaimer">Prices include GST. No delivery charge on gifts.</p>
      ${coCancelNote()}
      <div id="gift-alert">${alertHTML()}</div>
      <button type="button" class="button primary full gift-big pre-go" data-gift-pay ${gift.busy ? 'disabled aria-describedby="gift-pay-why"' : ''}>${icon(gift.busy ? 'clock' : 'lock')}<span>${gift.busy ? 'Placing…' : `Pay ${currency(t.total)}`}</span></button>${gift.busy ? `<p class="pre-why" id="gift-pay-why" role="status">${icon('clock')}<span>Checking stock and placing your gift order…</span></p>` : ''}
      ${back}`
  }
  const differ = ws.size > 1 ? `<p class="pre-why is-block">${icon('info')}<span>Not everyone gets their gift in the same week: each person’s week is shown above.</span></p>` : ''
  const off = gift.busy ? 'Booking your gift pre-order…' : bigAt >= 0 ? `${list[bigAt].r.name.trim() || `Person ${bigAt + 1}`}: ${preTooBigWords(list[bigAt].r.sku)}` : blocked ? 'No delivery week has room for someone: go back and change their boxes' : !gift.agree ? 'Tick the box above to continue' : ''
  return `<div class="gift-send-head"><h2 id="gift-send-h" tabindex="-1">Review your gift pre-order</h2><p>${plural(t.people, 'person', 'people')} · ${plural(t.boxes, 'box', 'boxes')} · one payment</p></div>
    ${preNoticeHTML(giftPreWhen(giftPreWeekList(list)))}
    <ol class="gift-review">${rows}</ol>${differ}
    <div class="bill-row is-total gift-review-total"><span>Total, paid once</span><strong>${currency(t.total)}</strong></div>
    <p class="cart-disclaimer">Prices include GST. No delivery charge on gifts.</p>
    <div id="gift-alert">${alertHTML()}</div>
    <label class="pre-agree"><input type="checkbox" name="gift-pre-agree-all" ${gift.agree ? 'checked' : ''} ${gift.busy ? 'disabled' : ''}><span>I understand this pre-order can only be cancelled if it is delayed.</span></label>
    <button type="button" class="button primary full gift-big pre-go" data-gift-pre-book ${off ? 'disabled aria-describedby="gift-pre-why"' : ''}>${icon(gift.busy ? 'clock' : off ? 'lock' : 'sun')}<span>${gift.busy ? 'Booking…' : `Pre-order · pay ${currency(t.total)}`}</span></button>${off ? `<p class="pre-why" id="gift-pre-why"${gift.busy ? ' role="status"' : ''}>${icon(gift.busy ? 'clock' : 'info')}<span>${esc(off)}</span></p>` : ''}
    ${back}`
}

/** The API's answer to the booking: on the person's field, the unpaid pre-order, or one line above the pay button. */
async function giftPreFailed(e) {
  gift.error = ''
  const x = e.extra || {}
  if (!e.status || e.status >= 500) { gift.error = e.message || 'Something went wrong. Nothing was charged: try again.'; return }
  gift.key = null
  const who = (row) => { const r = gift.recipients[row - 1]; return r ? r.name.trim() || `Person ${row}` : 'Someone' }
  const field = String(e.message || '').match(/^recipients\.(\d+)\.(?:gift\.)?(\w+)/)
  if (e.code === 'UNPAID_PREORDER_EXISTS') gift.unpaid = { ...x, pre: true }
  else if (e.code === 'PREORDER_TOO_BIG') {
    await loadWeeks().catch(() => {})
    gift.error = `${who(x.row)}’s boxes are more than we can deliver in one week. Choose fewer boxes${x.limit ? ` (up to ${x.limit} kg)` : ''}. Nothing was charged.`
  } else if (e.code === 'PREORDER_FULL' || e.code === 'PREORDER_WEEK_CHANGED' || e.code === 'INVALID_WEEK') {
    await loadWeeks().catch(() => {})
    gift.error = `${e.code === 'PREORDER_WEEK_CHANGED' ? `An earlier week has room again for ${who(x.row)}` : `${who(x.row)}’s week just filled up`}. The weeks above are updated: check them and pay again. Nothing was charged.`
  } else if (e.code === 'RECIPIENTS_INVALID' && Array.isArray(x.rows)) {
    for (const row of x.rows) { const r = gift.recipients[row.row - 1]; if (r) gift.errors[fname(r, row.field)] = row.message }
    gift.step = 'form'
    gift.error = 'Some details need a look: they are marked on each person.'
  } else if (field) {
    const r = gift.recipients[Number(field[1])], map = { recipientName: 'name', recipientPhone: 'phone', message: 'note', weekStart: 'qty', stage: 'qty' }
    if (r) gift.errors[fname(r, map[field[2]] || field[2])] = e.message.replace(/^[^:]+:\s*/, '')
    gift.step = 'form'
    gift.error = 'Some details need a look: they are marked on each person.'
  } else if (e.code === 'NOT_SERVICEABLE') gift.error = `${e.message.replace(/^Person \d+: /, `${who(x.row)}: `)}`
  else if (e.status === 404) gift.error = 'Gifting isn’t open right now. Please try again later.'
  else gift.error = preError(e) || e.message
}

async function giftGroupBook() {
  if (gift.busy) return
  syncPeople()
  const list = giftPreWeeks()
  if (!gift.agree || list.some((x) => !x.week)) return
  gift.busy = true
  gift.error = ''
  gift.unpaid = null
  renderGiftSend()
  gift.key ??= MM.idem()['Idempotency-Key']
  const body = {
    ...(gift.sender.trim() ? { name: gift.sender.trim() } : {}),
    recipients: list.map(({ r, week }) => ({
      sku: r.sku, stage: r.stage, qty: r.qty, weekStart: week.weekStart, pincode: r.pincode.trim(), address: r.address.trim(),
      gift: { recipientName: r.name.trim(), recipientPhone: normPhone(r.phone), ...(noteOf(r) ? { message: noteOf(r) } : {}) },
    })),
  }
  let g = null
  try {
    for (let i = 0; ; i++) {
      try { g = await MM.bookPreorderGroup(body, gift.key); break } catch (e) { if (e.code === 'PAYMENT_STARTING' && i < 5) { await wait(2000); continue } throw e }
    }
  } catch (e) {
    gift.busy = false
    if (e.status === 401) { saveDraft(); go(`/login?next=${encodeURIComponent('/gifts/send/review')}`); return }
    await giftPreFailed(e)
    if (giftPage()) {
      backToErrors()
      renderGiftSend()
      const bad = $('[data-person] [aria-invalid="true"]')
      if (bad) { bad.scrollIntoView({ block: 'center', behavior: reduced ? 'instant' : 'smooth' }); bad.focus({ preventScroll: true }) } else $('#gift-alert')?.scrollIntoView({ block: 'center', behavior: reduced ? 'instant' : 'smooth' })
    }
    return
  }
  gift.busy = false
  gift.key = null
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
  return `<div class="co-pay gift-pay gift-pre-pay"><p class="gift-pre-chips"><span class="pre-chip">${icon('sun')}Pre-order</span><span class="pre-chip gift-chip">${icon('gift')}Gift</span></p><p class="co-pay-no">Gift pre-order <strong>${esc(giftNo(g.number))}</strong></p><p class="co-pay-total">${currency(g.total)}</p><p class="gift-pay-for">${plural(g.recipientCount, 'person', 'people')} · ${plural(g.boxes, 'box', 'boxes')} · one payment</p>
    ${preNoticeHTML(giftPreWhen(groupWeeks(g)))}
    ${g.paymentFailed ? (typeof payStateHTML === 'function' ? payStateHTML({ status: 'PAYMENT_PENDING', paymentFailed: true, holdExpiresAt: g.holdExpiresAt }) : '') : `<p class="co-pay-hold">${icon('box')}<span>Each person’s week is held for you until <strong>${fmtTime(g.holdExpiresAt)}</strong>. Pay before then to book it.</span></p>`}
    ${gift.error ? `<p class="prototype-tag" role="alert">${esc(gift.error)}</p>` : ''}${pay}
    <button type="button" class="text-button" data-gift-pre-cancel ${gift.busy ? 'disabled' : ''}>Cancel this gift pre-order</button></div>`
}

/** The test payment (development only: the API's dev pay-preorder route, as the Razorpay webhook would): any booking of
 *  the group pays the whole group. */
async function giftPreTestPay() {
  const g = gift.group
  if (!g || gift.busy) return
  gift.busy = true
  gift.error = ''
  renderGiftSend()
  try { await MM.api('/' + ['dev', 'pay-preorder'].join('/'), { method: 'POST', body: { preorderId: g.leadId, outcome: 'captured' } }) } catch (e) { gift.busy = false; gift.error = e.message; renderGiftSend(); return }
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

/** Test mode only: a failed attempt on the group's one payment (dev pay-preorder, outcome failed); the step then says so. */
async function giftPreTestFail() {
  const g = gift.group
  if (!g || gift.busy) return
  try { await MM.api('/' + ['dev', 'pay-preorder'].join('/'), { method: 'POST', body: { preorderId: g.leadId, outcome: 'failed' } }) } catch (e) { toast(e.message); return }
  try { gift.group = await MM.preorderGroup(g.id) } catch {}
  if (giftPage()) renderGiftSend()
}

async function giftPreCancel(b) {
  const g = gift.group
  if (!g || !window.confirm(`Cancel gift pre-order ${giftNo(g.number)} for ${plural(g.recipientCount, 'person', 'people')}? Nothing is charged.`)) return
  b.disabled = true
  try { await MM.cancelPreorder(g.leadId); toast(`Gift pre-order ${giftNo(g.number)} cancelled`) } catch (e) { toast(e.message); b.disabled = false; return }
  gift.group = null
  gift.step = 'form'
  saveDraft()
  renderGiftSend()
}

function giftPreDoneHTML() {
  const g = gift.group
  if (!g) return ''
  const rows = (g.preorders || []).map((p) => `<li class="gift-review-row">${thumb(p.sku, p.stage, p.productName)}<div><strong>${esc(p.gift ? p.gift.recipientName : '')}</strong><small>${esc(boxName(p.productName, p.sku))} · ${stageOf(p.stage).stage} · ${plural(p.qty, 'box', 'boxes')}</small><small class="gift-review-week">${icon('calendar')}<span>Delivered in ${preWeekText(p.weekStart)}</span></small><small>Pre-order ${esc(orderNo(p.number))} · ${esc(PRE_STATUS[p.status] || p.status)}</small></div><span>${currency(p.total)}</span></li>`).join('')
  return `<div class="success gift-done gift-pre-done">${icon('check')}<p class="gift-pre-chips"><span class="pre-chip">${icon('sun')}Pre-order</span><span class="pre-chip gift-chip">${icon('gift')}Gift</span></p><h2>Gift pre-order <span class="no-wrap">${esc(giftNo(g.number))}</span> is booked.</h2><p>${plural(g.recipientCount, 'person gets', 'people get')} their own pre-order. Paid once: <strong>${currency(g.total)}</strong>.</p></div>
    ${preNoticeHTML(giftPreWhen(groupWeeks(g)), true)}
    <ol class="gift-review">${rows}</ol>
    <p class="gift-find">${icon('box')}<span>Find each one in <a href="/orders" data-route>Your orders</a>, marked “Pre-order” and “Gift”.</span></p>
    <button type="button" class="text-button" data-gift-again>Send another gift ${icon('arrow')}</button>`
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
    ? `<div class="success paid gift-done">${paidMark()}<span class="pre-chip gift-chip">${icon('gift')}Gift</span><h2>Gift order <span class="no-wrap">${esc(giftNo(g.number))}</span> confirmed.</h2><p>${plural(live.length, 'person gets', 'people get')} their own delivery on <strong>${esc(when)}</strong>. We’ll send you updates on WhatsApp.</p><p class="gift-find">${icon('box')}<span>Find this gift order any time in <a href="/orders" data-route>Your orders</a>, marked “Gift”.</span></p></div>`
    : ''
  const statusLine = g.status === 'CANCELLED'
    ? (g.cancelReason === 'HOLD_EXPIRED' ? 'Cancelled: the payment didn’t arrive in time, so the boxes went back on sale. Nothing was charged.' : 'Cancelled.')
    : g.status === 'PAYMENT_PENDING' ? `Awaiting payment. The boxes are held until ${fmtTime(g.holdExpiresAt)}.` : `Paid${g.paidAt ? ` on ${new Date(g.paidAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}.`
  const people = g.recipients.map((r) => {
    const p = packOf(r.sku), refund = r.refundStatus === 'REFUNDED' || r.refundStatus === 'PENDING' ? `Refund of ${currency(r.total)} is on its way (usually 5 to 7 working days)` : ''
    return `<li class="gift-rcpt${r.status === 'CANCELLED' ? ' is-cancelled' : ''}">
      ${r.sku ? thumb(r.sku, r.stage, r.boxName) : ''}
      <div class="gift-rcpt-copy">
        <p class="gift-rcpt-top"><strong>${esc(r.name || `Person ${r.position}`)}</strong><span class="gift-status is-${esc(String(r.status).toLowerCase())}">${esc(STATUS[r.status] || r.status)}</span></p>
        <small>${esc(p ? `${p.name} · ${p.kg}` : r.boxName || '')} · ${esc(stageOf(r.stage).stage)} · ${plural(r.qty, 'box', 'boxes')} · ${currency(r.total)}</small>
        <small>${esc(r.address || '')}${r.pincode ? ` · ${esc(r.pincode)}` : ''}${r.phone ? ` · ${esc(String(r.phone).replace(/^\+91/, '+91 '))}` : ''}</small>
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
      <dl class="gift-facts"><div><dt>Delivery</dt><dd>${esc(when)}</dd></div><div><dt>People</dt><dd>${g.recipientCount}</dd></div><div><dt>Boxes</dt><dd>${g.boxes}</dd></div><div><dt>Total</dt><dd>${currency(g.total)}${g.discount ? ` <small>(saved ${currency(g.discount)})</small>` : ''}</dd></div>${g.business ? `<div><dt>Bill to</dt><dd>${esc(g.business.name)} · GSTIN ${esc(g.business.gstin)}</dd></div>` : ''}</dl>
      ${typeof payStateHTML === 'function' ? payStateHTML(g) : ''}
      ${canPay ? (testPay ? `<div class="prototype-tag">Test mode: no payment service is connected, so no money is taken.</div><button type="button" class="button primary full" data-gift-testpay-order="${esc(g.id)}">${g.paymentFailed ? 'Try payment again (test)' : 'Pay (test)'} ${currency(g.total)} ${icon('arrow')}</button><button type="button" class="text-button" data-gift-testfail-order="${esc(g.id)}">Fail payment (test)</button>` : `<button type="button" class="button primary full" data-gift-rzp-order="${esc(g.id)}">${g.paymentFailed ? 'Try payment again' : 'Pay'} ${currency(g.total)} ${icon('arrow')}</button>`) : ''}
      ${g.bill ? `<button type="button" class="button secondary gift-bill" data-gift-bill="${esc(g.id)}" data-number="${esc(g.number)}">${icon('mail')}<span>Download the bill</span></button>` : ''}
      ${typeof roGiftHTML === 'function' ? roGiftHTML(g) : ''}
    </div>
    <section class="page-card gift-order" aria-labelledby="gift-rcpts-h">
      <h2 id="gift-rcpts-h" class="gift-h">Each delivery</h2>
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
  if (d.giftCancel || d.giftCancelOne) { giftCancel(b); return }
  if (d.giftBill) { giftBill(b); return }
  if (d.giftTestpayOrder) { b.disabled = true; giftTestPay(d.giftTestpayOrder, true); return }
  if (d.giftTestfailOrder) { b.disabled = true; giftTestFail(d.giftTestfailOrder, true); return }
  if (d.giftRzpOrder) { MM.gift(d.giftRzpOrder).then((g) => giftRazorpay({ id: g.id, number: g.number, total: g.total, razorpayKeyId: g.razorpayKeyId, razorpayOrderId: g.razorpayOrderId, holdExpiresAt: g.holdExpiresAt }, true), (err) => toast(err.message)); return }
  if (!giftPage()) return
  if (d.giftSize) {
    slideSwitch(b, () => {
      giftEnv.size = giftEnv.size || {}
      giftEnv.size[d.variety] = d.giftSize
      renderGiftGrid({ 'data-gift-size': d.giftSize })
    })
  } else if (d.giftStage) {
    slideSwitch(b, () => {
      giftEnv.stage[d.sku] = d.giftStage
      renderGiftGrid({ 'data-gift-stage': d.giftStage, 'data-sku': d.sku })
    })
  } else if (d.giftQty) {
    giftEnv.qty = giftEnv.qty || {}
    giftEnv.qty[d.sku] = Math.min(GIFT_BOX_MAX, Math.max(0, cardQty(d.sku) + Number(d.giftQty)))
    // At 0 (or the limit) that button turns off: keep the focus on the stepper.
    const other = { 'data-gift-qty': String(-Number(d.giftQty)), 'data-sku': d.sku }
    renderGiftGrid((d.giftQty === '-1' && cardQty(d.sku) === 0) || (d.giftQty === '1' && cardQty(d.sku) >= GIFT_BOX_MAX) ? other : { 'data-gift-qty': d.giftQty, 'data-sku': d.sku })
  } else if (d.giftBag) {
    const n = cardQty(d.giftBag)
    if (n > 0 && bagAddGift(d.giftBag, cardStageFor(packOf(d.giftBag) || { sku: d.giftBag }), n)) {
      giftEnv.qty[d.giftBag] = 0
      renderGiftGrid({ 'data-gift-qty': '1', 'data-sku': d.giftBag })
    }
  } else if (d.giftDraft) {
    if (d.giftDraft === 'clear') { gift = giftFresh(); dropDraft(); renderGiftNotice(); toast('Cleared the gift you started'); focusSel('#gift-grid', 'start') }
    else {
      if (!gift.recipients.length) readDraft()
      const open = gift.recipients.find((r) => r.id === gift.editing)
      openFlow(open ? `[name="${fname(open, 'name')}"]` : null)
    }
  } else if (d.giftSend) openSend(d.giftSend, cardStageFor(packOf(d.giftSend) || { sku: d.giftSend }), cardQty(d.giftSend))
  else if (b.hasAttribute('data-gift-add')) addPerson()
  else if (d.giftSave) savePerson(d.giftSave)
  else if (d.giftEdit) editPerson(d.giftEdit)
  else if (d.giftDiscard) discardPerson(d.giftDiscard)
  else if (d.giftRemove) removePerson(d.giftRemove)
  else if (b.hasAttribute('data-gift-undo')) undoRemove()
  else if (b.hasAttribute('data-gift-review')) giftToReview()
  else if (b.hasAttribute('data-gift-boxes')) {
    // The gift cards again; the gift is kept ("Continue the gift you started").
    gift.removed = null
    saveDraft()
    giftBackTo('packs', () => {
      setFlow(false)
      renderGiftGrid()
      focusSel('#gift-notice [data-gift-draft="go"]', 'start')
    })
  } else if (b.hasAttribute('data-gift-box-change')) {
    gift.boxOpen = true
    renderGiftSend()
    focusField('gift-box-sku')
  } else if (b.hasAttribute('data-gift-box-done')) {
    const bx = gift.box, p = bx && packOf(bx.sku)
    if (!p) { gift.errors['#gift-everyone'] = 'Choose a gift box'; renderGiftSend(); focusField('gift-box-sku'); say('Choose a gift box'); return }
    gift.boxOpen = false
    delete gift.errors['#gift-everyone']
    renderGiftSend({ 'data-gift-box-change': '' })
    say(`Everyone gets ${boxLine(bx.sku, bx.stage, bx.qty)}.`)
  } else if (d.giftBstage) {
    slideSwitch(b, () => {
      gift.box ??= { sku: '', stage: 'SEMI_RIPE', qty: 1 }
      gift.box.stage = d.giftBstage
      delete gift.errors['#gift-everyone']
      if (gift.date && !dayFits(gift.date)) gift.date = giftEnv.dates.find((x) => dayFits(x)) || gift.date
      renderGiftSend({ 'data-gift-bstage': d.giftBstage })
      saveDraft()
    })
  } else if (d.giftBstep) {
    if (b.getAttribute('aria-disabled') === 'true') return
    gift.box ??= { sku: '', stage: 'SEMI_RIPE', qty: 1 }
    gift.box.qty = Math.min(GIFT_BOX_MAX, Math.max(1, gift.box.qty + Number(d.giftBstep)))
    delete gift.errors['#gift-everyone']
    renderGiftSend({ 'data-gift-bstep': d.giftBstep })
    saveDraft()
  } else if (d.giftOwn) {
    const r = gift.recipients.find((x) => x.id === d.rid)
    if (!r) return
    r.own = d.giftOwn === 'on'
    if (!r.own) { delete gift.errors[fname(r, 'sku')]; delete gift.errors[fname(r, 'qty')] }
    renderGiftSend()
    saveDraft()
    if (r.own) focusField(fname(r, 'sku')); else focusSel(`[data-gift-own="on"][data-rid="${CSS.escape(r.id)}"]`)
  } else if (d.giftOwnnote) {
    const r = gift.recipients.find((x) => x.id === d.rid)
    if (!r) return
    r.ownNote = d.giftOwnnote === 'on'
    if (!r.ownNote) delete gift.errors[fname(r, 'note')]
    renderGiftSend()
    saveDraft()
    if (r.ownNote) focusField(fname(r, 'note')); else focusSel(`[data-gift-ownnote="on"][data-rid="${CSS.escape(r.id)}"]`)
  } else if (d.giftBiz) {
    gift.business = d.giftBiz === 'on'
    if (!gift.business) { delete gift.errors['gift-biz-name']; delete gift.errors['gift-gstin'] }
    renderGiftSend()
    saveDraft()
    if (gift.business) focusField('gift-biz-name'); else focusSel('[data-gift-biz="on"]')
  } else if (d.giftRstage) {
    const r = gift.recipients.find((x) => x.id === d.rid)
    if (!r) return
    slideSwitch(b, () => {
      r.stage = d.giftRstage
      delete gift.errors[fname(r, 'qty')]
      if (gift.date && !dayFits(gift.date)) gift.date = giftEnv.dates.find((x) => dayFits(x)) || gift.date
      renderGiftSend({ 'data-gift-rstage': d.giftRstage, 'data-rid': d.rid })
      saveDraft()
    })
  } else if (d.giftStep) {
    const r = gift.recipients.find((x) => x.id === d.rid)
    if (!r || b.getAttribute('aria-disabled') === 'true') return
    r.qty = Math.min(GIFT_BOX_MAX, Math.max(1, r.qty + Number(d.giftStep)))
    delete gift.errors[fname(r, 'qty')]
    renderGiftSend({ 'data-gift-step': d.giftStep, 'data-rid': d.rid })
    saveDraft()
  } else if (d.giftDate) {
    if (b.getAttribute('aria-disabled') === 'true') { toast('Not enough of these boxes on that day. Choose another day, or fewer boxes.'); return }
    gift.date = d.giftDate
    gift.slotId = null
    gift.error = ''
    giftEnv.slotsFor = ''
    Object.keys(gift.errors).forEach((k) => { if (k.endsWith('-qty')) delete gift.errors[k] })
    renderGiftSend({ 'data-gift-date': d.giftDate })
    giftSlots()
  } else if (d.giftSlot) {
    gift.slotId = d.giftSlot
    if (gift.error) { gift.error = ''; const a = $('#gift-alert'); if (a) a.innerHTML = '' }
    giftRefresh()
  } else if (b.hasAttribute('data-gift-pre-book')) giftGroupBook()
  else if (b.hasAttribute('data-gift-pre-testpay')) giftPreTestPay()
  else if (b.hasAttribute('data-gift-pre-testfail')) giftPreTestFail()
  else if (b.hasAttribute('data-gift-testfail')) giftTestFail(gift.pay.id)
  else if (b.hasAttribute('data-gift-pre-cancel')) giftPreCancel(b)
  else if (b.hasAttribute('data-gift-back')) giftBackTo('form', () => { gift.step = 'form'; gift.editing = null; gift.error = ''; gift.key = null; renderGiftSend(); giftTop() })
  else if (b.hasAttribute('data-gift-again')) { gift = giftFresh(); setFlow(false); giftUrl('packs'); renderGiftGrid(); focusSel('#gift-packs-h', 'start') }
  else if (b.hasAttribute('data-gift-pay')) giftPay()
  else if (d.giftFix) fixProblem(giftProblems().find((p) => p.name === d.giftFix))
  else if (b.hasAttribute('data-gift-testpay')) giftTestPay(gift.pay.id)
  else if (b.hasAttribute('data-gift-rzp')) giftRazorpay()
  else if (b.hasAttribute('data-gift-retry')) { loadProducts(); shelfReady().then(() => renderGiftGrid()) }
})

const PERSON_FIELD = /^g-(r\d+)-(name|phone|address|pincode|sku|qty|note)$/
let pinTimer = 0
document.addEventListener('input', (e) => {
  const t = e.target
  if (!giftPage() || !t.form || t.form.id !== 'gift-form') return
  const m = t.name.match(PERSON_FIELD)
  if (m) {
    const r = gift.recipients.find((x) => x.id === m[1])
    if (!r) return
    const f = m[2]
    if (f === 'qty') { const n = Number(t.value); if (Number.isFinite(n) && t.value !== '') r.qty = Math.round(n) }
    else if (f !== 'sku') r[f] = t.value
    if (f === 'note') { const c = $(`#${CSS.escape(fname(r, 'count'))}`); if (c) c.textContent = noteCount(r.note) }
    if (f === 'pincode') {
      const pin = t.value.trim()
      t.closest('.field')?.querySelector('.gift-pin')?.remove()
      clearTimeout(pinTimer)
      if (/^[1-9]\d{5}$/.test(pin)) pinTimer = setTimeout(() => checkPin(pin), 250)
    }
    if (gift.errors[t.name]) delete gift.errors[t.name]
  } else if (t.name === 'gift-note') {
    gift.note = t.value
    delete gift.errors['gift-note']
    const c = $('#gift-note-count')
    if (c) c.textContent = `Optional · ${noteCount(gift.note)}`
  } else if (t.name === 'gift-box-qty') {
    const n = Number(t.value)
    if (gift.box && Number.isFinite(n) && t.value !== '') gift.box.qty = Math.min(GIFT_BOX_MAX, Math.max(1, Math.round(n)))
  } else if (t.name === 'gift-sender') gift.sender = t.value
  else if (t.name === 'gift-biz-name') { gift.bizName = t.value; delete gift.errors[t.name] }
  else if (t.name === 'gift-gstin') { gift.gstin = t.value; delete gift.errors[t.name] }
  giftRefresh()
})
document.addEventListener('change', (e) => {
  const t = e.target
  if (!giftPage() || !t.form || t.form.id !== 'gift-form') return
  const m = t.name.match(PERSON_FIELD)
  if (m && m[2] === 'sku') {
    const r = gift.recipients.find((x) => x.id === m[1])
    if (!r) return
    r.sku = t.value
    const p = packOf(r.sku)
    if (p && stockKnown() && !anyQty(p.sku, r.stage)) r.stage = SOLD_API.find((st) => anyQty(p.sku, st)) || r.stage
    delete gift.errors[t.name]
    delete gift.errors[fname(r, 'qty')]
    if (gift.date && !dayFits(gift.date)) gift.date = giftEnv.dates.find((x) => dayFits(x)) || gift.date
    renderGiftSend({ name: t.name })
    saveDraft()
  } else if (m && m[2] === 'qty') {
    const r = gift.recipients.find((x) => x.id === m[1])
    if (!r) return
    r.qty = Math.min(GIFT_BOX_MAX, Math.max(1, Math.round(Number(t.value)) || 1))
    renderGiftSend({ name: t.name })
    saveDraft()
  } else if (t.name === 'gift-box-sku') {
    gift.box ??= { sku: '', stage: 'SEMI_RIPE', qty: 1 }
    gift.box.sku = t.value
    const p = packOf(gift.box.sku)
    if (p && stockKnown() && !anyQty(p.sku, gift.box.stage)) gift.box.stage = SOLD_API.find((st) => anyQty(p.sku, st)) || gift.box.stage
    delete gift.errors['#gift-everyone']
    if (gift.date && !dayFits(gift.date)) gift.date = giftEnv.dates.find((x) => dayFits(x)) || gift.date
    renderGiftSend({ name: t.name })
    saveDraft()
  } else if (t.name === 'gift-box-qty') {
    if (!gift.box) return
    gift.box.qty = Math.min(GIFT_BOX_MAX, Math.max(1, Math.round(Number(t.value)) || 1))
    renderGiftSend({ name: t.name })
    saveDraft()
  } else if (t.name === 'gift-business') {
    gift.business = t.checked
    if (!t.checked) { delete gift.errors['gift-biz-name']; delete gift.errors['gift-gstin'] }
    renderGiftSend({ name: t.checked ? 'gift-biz-name' : 'gift-business' })
    saveDraft()
  }
})
// The review's non-refundable tick (before the season): the pay button follows it.
document.addEventListener('change', (e) => {
  if (!giftPage() || e.target.name !== 'gift-pre-agree-all') return
  gift.agree = e.target.checked
  renderGiftSend({ name: 'gift-pre-agree-all' })
})
// A field's error shows once it has been left (and stays until it is fixed).
document.addEventListener('focusout', (e) => {
  const t = e.target
  if (!giftPage() || !t.form || t.form.id !== 'gift-form' || !t.name || t.type === 'checkbox') return
  if (String(t.value || '').trim() === '' && !gift.errors[t.name]) return
  const to = e.relatedTarget
  if (to instanceof Element && to.closest('#gift-send button')) return
  checkField(t.name, true)
  giftBar()
})
// Enter in a one-line field does not send the form (there is no submit button in it: the pay bar pays).
document.addEventListener('submit', (e) => { if (e.target.id === 'gift-form') e.preventDefault() })

window.addEventListener('mm:route', () => {
  if (document.title === GIFT_TITLE && !giftPage()) document.title = 'VMR Mangoes — A little taste of summer.'
  if (document.title === 'Your gift order · VMR Mangoes' && !giftPage()) document.title = 'VMR Mangoes — A little taste of summer.'
})
// Signing in (the sign-in page comes back to /gifts) or out: the pay button's words follow.
window.addEventListener('mm:profile', () => { if (giftPage() && $('#gift-form')) { const b = $('.gift-signin'); if (b && MM.profile()) b.remove() } })
// The bag changed (a gift added here, or a line moved in the bag): the cards' "n in your bag" follow, unless a card is in use.
window.addEventListener('mm:cart', () => { const g = $('#gift-grid'); if (giftPage() && g && giftEnv.ready && !g.contains(document.activeElement)) renderGiftGrid() })
