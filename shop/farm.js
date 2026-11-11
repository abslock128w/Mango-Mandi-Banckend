/* Farm Experience (docs/farm-experience.md, FARM_EXPERIENCE): the farm card on /bulk, /farm-experience (what the
   visit is), /farm-experience/book (six steps: variety, kilograms, date, group, details, review), /farm-bookings (the
   customer's visits) and /farm-bookings/:id (one visit: status, check-in code, itinerary, the bill after weighing and
   Pay, cancel, change of date, and the answer to a proposed arrangement).
   Hidden unless GET /v1/policy says features.farmExperience: no card, no tab, and the pages say the visit is not open
   (every farm route answers 404 while the switch is off).
   The rules are the API's: 250 kg or more of one variety, no guest limit, nothing paid at booking, the bill after
   weighing, cancel and move by the farm's policy. This file only shows what the API sends and asks it again.
   Everything about the farm (name, rooms, meals, policies, FAQs) is what the farm team wrote on the panel's Farm
   settings; where they have written nothing, the page says our team will confirm it, and never makes it up.
   Money in farm answers stays in paise (api.js `farm`), shown with fxMoney. Answers in the booking form are kept in
   localStorage (mm-farm-draft) until the visit is booked.
   Loaded after pages.js (it adds to PAGES) and before app.js, so top-level code only declares and listens. */

PAGES.push(
  [/^\/farm-experience\/?$/, () => farmView()],
  [/^\/farm-experience\/book\/?$/, () => fxSigned('Book a farm visit', farmBookView)],
  [/^\/farm-bookings\/?$/, () => fxSigned('My farm visits', farmBookingsView)],
  [/^\/farm-bookings\/([^/]+)\/?$/, (m) => fxSigned('Farm visit', () => farmBookingView(decodeURIComponent(m[1])))],
)

// ---- The switch: asked once per visit (GET /v1/policy). A failed answer is asked again next time.

let fxFlag = null
function farmFeature() {
  return fxFlag ??= MM.policy().then((p) => Boolean(p && p.features && p.features.farmExperience), () => { fxFlag = null; return false })
}

/** The feature is on: the "Farm visits" tab on the account pages, and the card on /bulk. */
function fxOn() {
  if (!ACCOUNT_TABS.some(([href]) => href === '/farm-bookings')) ACCOUNT_TABS.push(['/farm-bookings', 'Farm visits'])
  const tabs = $('.page-tabs')
  if (tabs && !$('a[href="/farm-bookings"]', tabs)) tabs.insertAdjacentHTML('beforeend', '<a href="/farm-bookings" data-route>Farm visits</a>')
  farmCard()
}

/** The farm card on /bulk, under the hero. */
function farmCard() {
  if (document.body.dataset.page !== 'bulk' || $('#fx-card')) return
  const hero = $('#page-body .door-hero.bulk')
  if (!hero) return
  hero.insertAdjacentHTML('afterend', `<section class="page-card fx-card" id="fx-card" aria-labelledby="fx-card-title"><span class="pn-icon" aria-hidden="true">${icon('sun')}</span><div><h2 id="fx-card-title">Farm Experience</h2><p>Visit our mango farm, pick 250 kg or more yourself, stay at the farmhouse and pay after picking.</p></div><a class="button secondary" href="/farm-experience" data-route>See the farm visit ${icon('arrow')}</a></section>`)
}

document.addEventListener('DOMContentLoaded', () => farmFeature().then((on) => { if (on) fxOn() }))
window.addEventListener('mm:route', () => farmFeature().then((on) => { if (on) fxOn() }))
// Signing out on a signed-in farm page leaves it for the page about the visit.
window.addEventListener('mm:profile', () => {
  if (pageOpen() && !MM.profile() && /^\/(farm-bookings|farm-experience\/book)(\/|$)/.test(location.pathname)) go('/farm-experience')
})

// ---- Shared bits.

const FX_CONFIRM = 'Our team will confirm this with you.'
const FX_MEALS = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['refreshments', 'Refreshments']]
const FX_STATUS = {
  HOSPITALITY_REVIEW: 'Booked · stay being arranged', CONFIRMED: 'Confirmed', PREPARING: 'Being prepared', READY_FOR_VISIT: 'Ready for your visit',
  CHECKED_IN: 'Checked in', HARVESTING: 'Harvesting', WEIGHING: 'Weighing and checking', PAYMENT_DUE: 'Ready to pay', PACKING: 'Paid · packing',
  COMPLETED: 'Completed', CANCELLED: 'Cancelled', NO_SHOW: 'Missed',
}
const FX_TONE = {
  HOSPITALITY_REVIEW: 'info', CONFIRMED: 'good', PREPARING: 'good', READY_FOR_VISIT: 'good', CHECKED_IN: 'info', HARVESTING: 'info', WEIGHING: 'info',
  PAYMENT_DUE: 'warn', PACKING: 'info', COMPLETED: 'good', CANCELLED: 'muted', NO_SHOW: 'muted',
}
const FX_ENDED = ['COMPLETED', 'CANCELLED', 'NO_SHOW']

/** Paise as rupees: whole rupees without decimals, anything else with both. */
const fxMoney = (p) => {
  const r = (Number(p) || 0) / 100
  return Number.isInteger(r) ? currency(r) : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(r)
}
const fxKg = (n) => `${(Number(n) || 0).toLocaleString('en-IN')} kg`
/** "14:00" → "2:00 pm". */
const fxClock = (t) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''))
  return m ? new Date(2000, 0, 1, Number(m[1]), Number(m[2])).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : ''
}
/** A whole number from a box, or null. No upper limit here: the API checks stock and group size. */
const fxWhole = (s) => (/^\d+$/.test(String(s ?? '').trim()) ? Number(String(s).trim()) : null)
const fxPlusDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const fxMeals = (meals) => {
  const names = FX_MEALS.filter(([k]) => meals && meals[k]).map(([, label]) => label)
  return names.length ? names.join(', ') : FX_CONFIRM
}
const fxTransport = (yes) => (yes ? 'Transport is included, as described in the transport policy.' : 'Transport is not included.')
/** What the farm team wrote, or that our team will confirm it. */
const fxSaid = (text) => (text ? esc(text) : `<span class="fx-soft">${FX_CONFIRM}</span>`)
const fxFact = (label, html) => `<div><dt>${label}</dt><dd>${html}</dd></div>`
/** A note with the info icon: why something is as it is, or can't be done. */
const fxNote = (html, { warn = false, alert = false } = {}) => `<p class="fx-note${warn ? ' is-warn' : ''}" role="${alert ? 'alert' : 'status'}">${icon('info')}<span>${html}</span></p>`
const fxPill = (status) => `<span class="fx-pill is-${FX_TONE[status] || 'muted'}">${FX_STATUS[status] || esc(status)}</span>`
const fxStay = (from, to) => (from === to ? fmtDate(from) : `${fmtDate(from)} to ${fmtDate(to)}`)
const fxGroup = (adults, children, overnight) => `${adults} ${adults === 1 ? 'adult' : 'adults'}, ${children} ${children === 1 ? 'child' : 'children'}, ${overnight} staying overnight`

/** The switch is off (or the route answered 404): the visit is not open. */
function fxClosed(seq) {
  document.title = 'Farm Experience · Mango Mandi'
  host().innerHTML = pageHead('Farm Experience') + marker(seq) + `
    <section class="page-card pn-closed">
      <span class="pn-closed-art" aria-hidden="true">${icon('leaf')}</span>
      <h2>Farm visits are <em>not open right now.</em></h2>
      <p>We open the farm for visits during the season. Please check back soon. The mangoes are all still here.</p>
      <a class="button primary" href="/" data-route>Back to the mangoes ${icon('arrow')}</a>
    </section>`
}

function fxLoadFailed(title, seq, e, retry) {
  host().innerHTML = pageHead(title) + marker(seq) + `<section class="page-card">${fxNote(esc(e.status === 401 ? 'Please sign in again to see this page.' : e.message), { warn: true, alert: true })}<button class="button secondary" data-fx-retry>Try again</button></section>`
  $('[data-fx-retry]', host()).addEventListener('click', retry)
}

/** A signed-in farm page: the switch first (off: the closed page, no sign-in asked), then sign-in, then the page. */
function fxSigned(title, then) {
  const seq = ++sheetSeq
  document.title = `${title} · Mango Mandi`
  host().innerHTML = pageHead(title) + marker(seq) + '<p>Loading…</p>'
  farmFeature().then((on) => {
    if (!alive(seq)) return
    if (on) signedInThen(title, then)
    else fxClosed(seq)
  })
}

/** The farm page's answer (GET /v1/farm-experience), fresh each time a page opens: stock and dates move. */
async function fxLoad(title, seq, retry) {
  try {
    // Off: the closed page, without asking a route that would answer 404.
    if (!(await farmFeature())) { if (alive(seq)) fxClosed(seq); return null }
    const f = await MM.farmExperience()
    return alive(seq) ? f : null
  } catch (e) {
    if (!alive(seq)) return null
    if (e.status === 404) fxClosed(seq)
    else fxLoadFailed(title, seq, e, retry)
    return null
  }
}

function fxPolicies(f) {
  const s = f.settings
  return `<dl class="fx-facts">
    ${fxFact('Minimum', `${fxKg(f.minKg)} of one variety per booking. No upper limit beyond what is available.`)}
    ${fxFact('Payment', `Nothing is paid when you book. After picking, you pay for the kilograms weighed and accepted, at the price per kg shown when you booked. ${s.extraPricePerKg != null ? `Mangoes picked beyond your booking cost ${fxMoney(s.extraPricePerKg)} per kg.` : 'Mangoes picked beyond your booking cost the same per kg.'}`)}
    ${fxFact('Cancelling', `Cancel ${s.cancelDays} or more days before your visit at no charge. Closer to the visit, our team reviews your request.`)}
    ${fxFact('Changing the date', `Change your visit date up to ${s.rescheduleDays} days before it, if the new date has room. Closer to the visit, our team reviews your request.`)}
    ${fxFact('Transport', `${fxTransport(s.transportIncluded)}${s.transportPolicy ? ` ${esc(s.transportPolicy)}` : ''}`)}
    ${fxFact('Weather', fxSaid(s.weatherPolicy))}
    ${fxFact('Harvest', fxSaid(s.harvestPolicy))}
    ${fxFact('If you can’t come', fxSaid(s.noShowPolicy))}
    ${s.guestCharges ? fxFact('Extra services', esc(s.guestCharges)) : ''}
  </dl>`
}

// ---- /farm-experience: what the visit is, what is included, the varieties, how booking works, the policies and FAQs.

async function farmView(seq = ++sheetSeq) {
  document.title = 'Farm Experience · Mango Mandi'
  host().innerHTML = pageHead('Farm Experience') + marker(seq) + '<p>Loading the farm visit…</p>'
  const f = await fxLoad('Farm Experience', seq, () => farmView())
  if (!f) return
  const s = f.settings
  const where = [s.farmName, s.location].filter(Boolean).map(esc).join(' · ')
  const book = f.bookingsOpen
    ? `<a class="button cream" href="/farm-experience/book" data-route>Book a visit ${icon('arrow')}</a>`
    : `<p class="fx-hero-note" role="status">${icon('info')}<span>Bookings for farm visits are not open yet. Please check again soon.</span></p>`
  const variety = (v) => `<li class="fx-variety${v.available ? '' : ' is-out'}">
      <div class="fx-variety-head"><h3>${esc(v.name)}</h3><strong>${fxMoney(v.pricePerKg)} <small>per kg</small></strong></div>
      ${v.description ? `<p>${esc(v.description)}</p>` : ''}
      ${v.ripenessNote ? `<p class="fx-soft">${esc(v.ripenessNote)}</p>` : ''}
      ${(v.tiers || []).length ? `<ul class="fx-tiers">${v.tiers.map((x) => `<li>${fxKg(x.minKg)} or more: ${fxMoney(x.pricePerKg)} per kg</li>`).join('')}</ul>` : ''}
      ${v.harvestFrom && v.harvestTo ? `<p class="fx-soft">Harvest from ${fmtDate(v.harvestFrom)} to ${fmtDate(v.harvestTo)}</p>` : ''}
      <p class="fx-avail">${v.available ? `${icon('check')}<span>Up to ${fxKg(v.bestDayKg ?? 0)} on the best day</span>` : `${icon('close')}<span>Not available right now</span>`}</p>
    </li>`
  host().innerHTML = pageHead('Farm Experience') + marker(seq) + `
    <section class="pn-hero fx-hero">
      <span class="pn-kicker">${where || 'Mango Mandi farm visits'}</span>
      <h2>Pick your own mangoes, <em>stay at the farm.</em></h2>
      <p>Visit our mango farm, pick your mangoes with our team and stay at the farmhouse. Every booking is for ${fxKg(f.minKg)} or more of one variety.</p>
      ${book}
      <small>Nothing to pay when you book · you pay after picking</small>
      ${MM.profile() ? `<a class="fx-hero-link" href="/farm-bookings" data-route>My farm visits ${icon('arrow')}</a>` : ''}
    </section>
    <section class="page-card">
      <h3>Your visit</h3>
      <ol class="fx-steps">
        <li>Arrive at the farm and check in with your QR code.</li>
        <li>Walk the orchard with our farm team.</li>
        <li>Pick the mangoes of the variety you booked.</li>
        <li>Weigh and check them together with our team.</li>
        <li>We pack them for you to take home.</li>
      </ol>
    </section>
    <section class="page-card">
      <h3>What’s included</h3>
      <ul class="fx-list">
        <li>${icon('check')}<span>${fxKg(f.minKg)} or more of the variety you choose, at the price shown when you book.</span></li>
        <li>${icon('check')}<span>A stay at the farmhouse for your group, as our team confirms it.</span></li>
        <li>${icon('check')}<span>Meals during your stay: ${fxMeals(s.meals)}${fxMeals(s.meals) === FX_CONFIRM ? '' : '.'}</span></li>
        <li>${icon(s.transportIncluded ? 'check' : 'info')}<span>${fxTransport(s.transportIncluded)}</span></li>
      </ul>
      ${s.mealNotes ? `<p class="fx-text">${esc(s.mealNotes)}</p>` : ''}
    </section>
    <section class="page-card">
      <h3>The farmhouse</h3>
      <dl class="fx-facts">
        ${fxFact('Check-in and check-out', s.checkInTime && s.checkOutTime ? `Check-in from ${fxClock(s.checkInTime)}, check-out by ${fxClock(s.checkOutTime)}` : `<span class="fx-soft">${FX_CONFIRM}</span>`)}
        ${fxFact('Sleeping arrangements', fxSaid(s.sleepingArrangements))}
        ${fxFact('Bathrooms', fxSaid(s.bathroomFacilities))}
        ${s.otherFacilities ? fxFact('Other facilities', esc(s.otherFacilities)) : ''}
        ${fxFact('Large groups', s.groupCoordination ? esc(s.groupCoordination) : 'There is no fixed limit on your group. If it is larger than the farmhouse, our team will plan rooms and meals with you before confirming your stay.')}
      </dl>
    </section>
    <section class="page-card">
      <h3>Varieties you can book</h3>
      ${f.varieties.length ? `<ul class="fx-varieties">${f.varieties.map(variety).join('')}</ul>` : fxNote('No varieties are open for farm visits yet.')}
    </section>
    <section class="page-card">
      <h3>How booking works</h3>
      <ol class="fx-steps">
        <li>Choose a variety and how many kilograms (${fxKg(f.minKg)} or more).</li>
        <li>Pick a visit date that has enough of your variety.</li>
        <li>Tell us who is coming, how long you stay and what you eat.</li>
        <li>Book without paying anything now.</li>
        <li>Our team plans your rooms and meals and confirms your stay.</li>
        <li>After picking, our team weighs and checks the mangoes with you, and you pay for the kilograms accepted, online or at the farm.</li>
      </ol>
    </section>
    <section class="page-card">
      <h3>Important information</h3>
      ${fxPolicies(f)}
    </section>
    ${(s.faqs || []).length ? `<section class="page-card"><h3>Questions</h3><div class="fx-faqs">${s.faqs.map((x) => `<details><summary>${esc(x.q)}${icon('chevron')}</summary><p>${esc(x.a)}</p></details>`).join('')}</div></section>` : ''}
    ${f.bookingsOpen ? `<a class="button primary fx-wide" href="/farm-experience/book" data-route>Book a visit ${icon('arrow')}</a>` : ''}`
}

// ---- /farm-experience/book: six steps, then the booking (nothing is paid).

const FX_STEPS = [['variety', 'Variety'], ['kg', 'Kilograms'], ['date', 'Visit date'], ['guests', 'Your group'], ['details', 'Your details'], ['summary', 'Review']]
const FX_DRAFT = 'mm-farm-draft'
const FX_PLACED = 'mm-farm-placed'
const fxNewKey = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : `fx-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`)

/** The form while /farm-experience/book is open. */
let fx = null
let fxQuoteTimer = 0

function fxBlank(f) {
  const p = MM.profile() || {}
  return {
    varietyId: (f.varieties.find((v) => v.available) || {}).id || null, kg: String(f.minKg), visitDate: null, arrivalDate: '', departureDate: '',
    adults: '2', children: '0', overnight: '0', veg: '', nonVeg: '', jain: '', allergies: '', requests: '', accessibility: '', notes: '',
    contactName: p.name || '', contactEmail: p.email || '', billingName: '', billingGstin: '', accept: false,
  }
}
function fxSaveDraft() {
  if (fx) save(FX_DRAFT, { d: { ...fx.d, accept: false }, at: fx.at, key: fx.key })
}
function fxClearDraft() {
  try { localStorage.removeItem(FX_DRAFT) } catch {}
}

const fxVariety = () => fx.f.varieties.find((v) => v.id === fx.d.varietyId) || null
const fxKgOk = () => { const kg = fxWhole(fx.d.kg); return kg != null && kg >= fx.f.minKg }
/** The stay the customer picked, or by default the visit day plus the farm's usual nights when anyone stays overnight. */
function fxStayOf() {
  const d = fx.d
  const nights = (fxWhole(d.overnight) ?? 0) > 0 ? fx.f.settings.stayNights : 0
  return { from: d.arrivalDate || d.visitDate, to: d.departureDate || fxPlusDays(d.visitDate, nights) }
}
/** The kilograms of the chosen variety left on a visit date. (The day buttons carry data-day, never data-date: app.js
 * takes a click on [data-date] as the delivery day.) */
const fxLeftOn = (day) => ((day.varieties || []).find((v) => v.varietyId === fx.d.varietyId) || {}).availableKg || 0
const fxDayOk = (date) => {
  const day = fx.dates.list.find((x) => x.date === date)
  return Boolean(day) && fxLeftOn(day) >= (fxWhole(fx.d.kg) ?? Infinity)
}

async function farmBookView(seq = ++sheetSeq) {
  document.title = 'Book a farm visit · Mango Mandi'
  host().innerHTML = pageHead('Book a farm visit') + marker(seq) + '<p>Getting the booking ready…</p>'
  const f = await fxLoad('Book a farm visit', seq, () => farmBookView())
  if (!f) return
  if (!f.bookingsOpen) {
    host().innerHTML = pageHead('Book a farm visit') + marker(seq) + `
      <section class="page-card pn-closed">
        <span class="pn-closed-art" aria-hidden="true">${icon('leaf')}</span>
        <h2>Bookings are <em>not open yet.</em></h2>
        <p>Bookings for farm visits are not open yet. Please check again soon.</p>
        <a class="button primary" href="/farm-experience" data-route>About the farm visit ${icon('arrow')}</a>
      </section>`
    return
  }
  const saved = read(FX_DRAFT, null)
  const blank = fxBlank(f)
  let d = blank, at = 0, key = fxNewKey(), restored = false
  if (saved && saved.d && typeof saved.d === 'object') {
    d = { ...blank }
    for (const k of Object.keys(blank)) if (typeof saved.d[k] === typeof blank[k] || (k === 'varietyId' || k === 'visitDate') && typeof saved.d[k] === 'string') d[k] = saved.d[k]
    d.accept = false
    if (!f.varieties.some((v) => v.id === d.varietyId && v.available)) { d.varietyId = blank.varietyId; d.visitDate = null }
    at = Number.isInteger(saved.at) ? Math.max(0, Math.min(saved.at, FX_STEPS.length - 1)) : 0
    key = typeof saved.key === 'string' ? saved.key : key
    restored = JSON.stringify({ ...d, varietyId: 0 }) !== JSON.stringify({ ...blank, varietyId: 0 })
  }
  fx = { seq, f, d, at: 0, key, error: '', notice: restored ? 'restored' : '', busy: false, quote: null, dates: { state: 'idle', list: [], forId: null, error: '' } }
  // Back where the customer was, but never past a step that still has something to fix.
  while (fx.at < at && !fxProblem(FX_STEPS[fx.at][0], true)) fx.at++
  fxSaveDraft()
  fxEnterStep()
  fxRender()
}

/** What stops the customer moving on from a step: { msg, field? } or null. `quiet`: for restoring a draft (dates not loaded yet). */
function fxProblem(step, quiet = false) {
  const d = fx.d, f = fx.f
  if (step === 'variety') return fxVariety() && fxVariety().available ? null : { msg: 'Choose a variety that is available.' }
  if (step === 'kg') return fxKgOk() ? null : { field: 'kg', msg: `Enter ${fxKg(f.minKg)} or more, in whole kilograms.` }
  if (step === 'date') {
    if (!d.visitDate) return { msg: 'Choose a visit date.' }
    // A restored draft keeps its date: the dates are asked again on the next step, and the API checks it when booking.
    if (quiet) return null
    if (fx.dates.state !== 'ready') return { msg: 'The visit dates are still loading. Try again in a moment.' }
    return fxDayOk(d.visitDate) ? null : { msg: `That day no longer has ${fxKg(fxWhole(d.kg))} of this variety. Choose another date.` }
  }
  if (step === 'guests') {
    const adults = fxWhole(d.adults), children = fxWhole(d.children), overnight = fxWhole(d.overnight)
    if (adults == null || adults < 1) return { field: 'adults', msg: 'At least one adult has to come.' }
    if (children == null) return { field: 'children', msg: 'Enter a whole number.' }
    if (overnight == null) return { field: 'overnight', msg: 'Enter a whole number.' }
    if (overnight > adults + children) return { field: 'overnight', msg: 'Overnight guests can’t be more than the whole group.' }
    for (const k of ['veg', 'nonVeg', 'jain']) if (String(d[k]).trim() && fxWhole(d[k]) == null) return { field: k, msg: 'Enter a whole number.' }
    const { from, to } = fxStayOf()
    if (from > d.visitDate) return { field: 'arrivalDate', msg: 'Your stay has to include the visit date.' }
    if (to < d.visitDate) return { field: 'departureDate', msg: 'Your stay has to include the visit date.' }
    return null
  }
  if (step === 'details') {
    if (!(MM.profile() || {}).phone) return { msg: 'Add your mobile number on your profile first, so the farm team can reach you.' }
    if (!d.contactName.trim()) return { field: 'contactName', msg: 'Enter your name.' }
    if (d.contactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.contactEmail.trim())) return { field: 'contactEmail', msg: 'Enter a valid email, or leave it empty.' }
    return null
  }
  return d.accept ? null : { field: 'accept', msg: 'Please read and accept the booking policies.' }
}

/** What a step needs from the API as it opens: the visit dates, the estimate. */
function fxEnterStep() {
  const step = FX_STEPS[fx.at][0]
  if (step === 'kg' || step === 'summary') fxQuote()
  if (step === 'date' || step === 'guests' || step === 'summary') fxDates()
}

/** The estimate for the variety and kilograms (POST /v1/farm-experience/quote: the API prices it). */
async function fxQuote() {
  const v = fxVariety(), kg = fxWhole(fx.d.kg)
  if (!v || !fxKgOk()) { fx.quote = null; fxShowQuote(); return }
  const key = `${v.id}:${kg}`
  if (fx.quote && fx.quote.key === key) return fxShowQuote()
  const mine = fx
  mine.quote = { key, state: 'loading' }
  fxShowQuote()
  try {
    const q = await MM.farmQuote(v.id, kg)
    if (fx !== mine || !mine.quote || mine.quote.key !== key) return
    mine.quote = { key, state: 'ready', ...q }
  } catch (e) {
    if (fx !== mine || !mine.quote || mine.quote.key !== key) return
    mine.quote = { key, state: 'error', error: e.message }
  }
  if (!alive(mine.seq)) return
  if (FX_STEPS[mine.at][0] === 'summary') fxRender()
  else fxShowQuote()
}
function fxQuoteHtml() {
  const q = fx.quote
  if (!fxKgOk()) return ''
  if (!q || q.state === 'loading') return '<p class="fx-quote fx-soft">Working out the estimate…</p>'
  if (q.state === 'error') return fxNote(esc(q.error), { warn: true })
  return `<p class="fx-quote"><span>${fxKg(q.kg)} at ${fxMoney(q.pricePerKg)} per kg</span><strong>${fxMoney(q.total)}</strong></p><p class="fx-soft">An estimate. Nothing is paid now.</p>`
}
function fxShowQuote() {
  const box = $('#fx-quote')
  if (box) box.innerHTML = fxQuoteHtml()
}

/** The visit dates with 250 kg or more of the chosen variety (GET /v1/farm-experience/dates). A day with less than the
 * customer's kilograms shows crossed, with how much is left. */
async function fxDates(fresh = false) {
  const id = fx.d.varietyId
  if (!id) return
  if (!fresh && fx.dates.forId === id && (fx.dates.state === 'ready' || fx.dates.state === 'loading')) return
  const mine = fx
  mine.dates = { state: 'loading', list: [], forId: id, error: '' }
  try {
    const r = await MM.farmDates(id, mine.f.minKg)
    if (fx !== mine || mine.dates.forId !== id) return
    mine.dates = { state: 'ready', list: r.dates || [], forId: id, error: '' }
  } catch (e) {
    if (fx !== mine || mine.dates.forId !== id) return
    mine.dates = { state: 'error', list: [], forId: id, error: e.message }
  }
  if (alive(mine.seq) && FX_STEPS[mine.at][0] === 'date') fxRender()
}

const fxNum = (name, label, min, opt = false) => `<label class="field">${label}${opt ? '<span class="pn-opt">optional</span>' : ''}<input name="${name}" type="number" inputmode="numeric" min="${min}" step="1" value="${esc(fx.d[name])}"></label>`
const fxInput = (name, label, max, attrs = '', opt = false) => `<label class="field">${label}${opt ? '<span class="pn-opt">optional</span>' : ''}<input name="${name}" type="text" maxlength="${max}" value="${esc(fx.d[name])}" ${attrs}></label>`
const fxArea = (name, label, max, rows) => `<label class="field">${label}<span class="pn-opt">optional</span><textarea name="${name}" rows="${rows}" maxlength="${max}">${esc(fx.d[name])}</textarea></label>`

function fxDayCards(list, picked, kg, attr) {
  let any = false
  const cards = list.map((x) => {
    const left = x.left, ok = left >= kg, dt = new Date(x.date + 'T00:00:00')
    if (!ok) any = true
    return `<button type="button" class="date-card fx-day${ok ? '' : ' is-unfit'}" ${attr}="${x.date}" aria-pressed="${x.date === picked}" aria-label="${fmtDate(x.date)}, ${ok ? `${fxKg(left)} available` : `only ${fxKg(left)} left`}"${ok ? '' : ' aria-disabled="true"'}><small>${dt.toLocaleDateString('en-IN', { weekday: 'short' })}</small><strong>${dt.getDate()}</strong><small>${dt.toLocaleDateString('en-IN', { month: 'short' })}</small>${ok ? '' : `<small class="date-unfit">${icon('close')}<span>${fxKg(left)} left</span></small>`}</button>`
  }).join('')
  return `<div class="date-cards fx-days" role="group" aria-label="Visit date">${cards}</div>${any ? `<p class="date-caption">${icon('close')}<span>Crossed days have less than ${fxKg(kg)} of this variety left.</span></p>` : ''}`
}

function fxStepHtml(step) {
  const d = fx.d, f = fx.f, s = f.settings, v = fxVariety(), kg = fxWhole(d.kg)
  if (step === 'variety') {
    return `<div class="fx-choices" role="radiogroup" aria-label="Variety">${f.varieties.map((x) => `<button type="button" class="fx-choice" role="radio" data-fx="variety" data-id="${esc(x.id)}" aria-checked="${x.id === d.varietyId}"${x.available ? '' : ' aria-disabled="true"'}>
        <span class="fx-choice-mark" aria-hidden="true">${x.available ? icon('check') : icon('close')}</span>
        <span class="fx-choice-text"><strong>${esc(x.name)}</strong><small>${fxMoney(x.pricePerKg)} per kg · ${x.available ? `up to ${fxKg(x.bestDayKg ?? 0)} on the best day` : 'not available right now'}</small></span>
      </button>`).join('')}</div>${f.varieties.length ? '' : fxNote('No varieties are open for farm visits yet.')}`
  }
  if (step === 'kg') {
    return `<label class="field">Kilograms of mangoes<input name="kg" type="number" inputmode="numeric" min="${f.minKg}" step="1" value="${esc(d.kg)}" aria-describedby="fx-kg-hint"></label>
      <p class="fx-hint" id="fx-kg-hint">${fxKg(f.minKg)} or more.${v ? ` Up to ${fxKg(v.bestDayKg ?? 0)} of ${esc(v.name)} can be booked on its best day.` : ''}</p>
      <div id="fx-quote" aria-live="polite">${fxQuoteHtml()}</div>`
  }
  if (step === 'date') {
    const ds = fx.dates
    if (ds.state === 'error') return `${fxNote(esc(ds.error), { warn: true, alert: true })}<button type="button" class="button secondary" data-fx="dates-retry">Try again</button>`
    if (ds.state !== 'ready') return '<p class="fx-soft">Finding visit dates…</p>'
    const list = ds.list.map((x) => ({ date: x.date, left: fxLeftOn(x) }))
    if (!list.some((x) => x.left >= kg)) return fxNote(`No visit date has ${fxKg(kg)} of ${esc(v ? v.name : 'this variety')} left. Go back and try fewer kilograms or another variety.`) + (list.length ? fxDayCards(list, null, kg, 'data-fx="date" data-day') : '')
    return fxDayCards(list, d.visitDate, kg, 'data-fx="date" data-day') + `<p class="fx-hint" id="fx-date-line">${d.visitDate && fxDayOk(d.visitDate) ? `Your visit: <strong>${fmtDate(d.visitDate)}</strong>` : 'Choose the day you want to pick your mangoes.'}</p>`
  }
  if (step === 'guests') {
    const stay = fxStayOf()
    return `${fxNote('There is no limit on your group. If it is larger than the farmhouse, our team will plan rooms and meals with you before confirming your stay.')}
      <div class="fx-grid">${fxNum('adults', 'Adults', 1)}${fxNum('children', 'Children', 0)}${fxNum('overnight', 'Staying overnight', 0)}</div>
      <div class="fx-grid two">
        <label class="field">Arrival date<input name="arrivalDate" type="date" max="${esc(d.visitDate)}" value="${esc(stay.from)}"></label>
        <label class="field">Departure date<input name="departureDate" type="date" min="${esc(d.visitDate)}" value="${esc(stay.to)}"></label>
      </div>
      <p class="fx-hint" id="fx-stay-line">Visit day ${fmtDate(d.visitDate)} · stay ${fxStay(stay.from, stay.to)}</p>
      <fieldset class="fx-set"><legend>Food</legend>
        <p class="fx-hint">How many people eat each way. Leave empty if you are not sure yet.</p>
        <div class="fx-grid">${fxNum('veg', 'Vegetarian', 0, true)}${fxNum('nonVeg', 'Non-vegetarian', 0, true)}${fxNum('jain', 'Jain', 0, true)}</div>
        ${fxInput('allergies', 'Allergies', 1000, '', true)}
        ${fxInput('requests', 'Other food requests', 1000, '', true)}
      </fieldset>
      ${fxArea('accessibility', 'Accessibility needs', 1000, 2)}
      ${fxArea('notes', 'Anything else we should know', 2000, 3)}`
  }
  if (step === 'details') {
    const phone = (MM.profile() || {}).phone
    return `${fxInput('contactName', 'Your name', 80, 'autocomplete="name"')}
      <dl class="fx-facts">${fxFact('Mobile number', phone ? esc(phone) : `<a href="/account" data-route>Add your mobile number on your profile first.</a>`)}</dl>
      <p class="fx-hint">The farm team calls this number about your visit.</p>
      <label class="field">Email<span class="pn-opt">optional</span><input name="contactEmail" type="email" maxlength="200" autocomplete="email" value="${esc(d.contactEmail)}"></label>
      ${fxInput('billingName', 'Business name for the bill', 120, 'autocomplete="organization"', true)}
      ${fxInput('billingGstin', 'GSTIN', 20, 'autocapitalize="characters" spellcheck="false"', true)}`
  }
  const stay = fxStayOf(), q = fx.quote && fx.quote.state === 'ready' ? fx.quote : null
  return `<dl class="fx-facts">
      ${fxFact('Variety', esc(v ? v.name : ''))}
      ${fxFact('Mangoes', q ? `${fxKg(kg)} at ${fxMoney(q.pricePerKg)} per kg` : fxKg(kg))}
      ${fxFact('Visit date', fmtDate(d.visitDate))}
      ${fxFact('Stay', fxStay(stay.from, stay.to))}
      ${fxFact('Group', fxGroup(fxWhole(d.adults) ?? 0, fxWhole(d.children) ?? 0, fxWhole(d.overnight) ?? 0))}
      ${fxFact('Meals', fxMeals(s.meals))}
      ${fxFact('Transport', fxTransport(s.transportIncluded))}
    </dl>
    <div class="fx-total"><span>Estimated price</span><strong>${q ? fxMoney(q.total) : fx.quote && fx.quote.state === 'error' ? 'Not available' : 'Working it out…'}</strong></div>
    ${fxNote('Nothing is paid now. This is an estimate: after picking, you pay for the kilograms weighed and accepted.')}
    <details class="fx-more"><summary>Important information${icon('chevron')}</summary>${fxPolicies(f)}</details>
    <label class="fx-accept"><input type="checkbox" name="accept"${d.accept ? ' checked' : ''}><span>I have read the booking policies, including cancelling and changing the date.</span></label>`
}

function fxProgress() {
  const at = fx.at, n = FX_STEPS.length
  return `<ol class="pn-progress" aria-label="Booking steps" style="--pn-n:${n};--pn-fill:${at / (n - 1)}">${FX_STEPS.map(([, title], i) => {
    const state = i < at ? 'done' : i === at ? 'current' : ''
    const inner = `<span class="pn-dot">${i < at ? icon('check') : `<span>${i + 1}</span>`}</span><span class="pn-progress-title">${title}</span>`
    return `<li class="${state}"${i === at ? ' aria-current="step"' : ''}>${i < at ? `<button type="button" data-fx="step" data-step="${i}" aria-label="Back to step ${i + 1}: ${title}">${inner}</button>` : inner}</li>`
  }).join('')}</ol>`
}

function fxRender() {
  const [step, title] = FX_STEPS[fx.at], last = fx.at === FX_STEPS.length - 1
  const notice = fx.notice === 'restored' ? '<div class="pn-notice is-soft" role="status">Welcome back. We kept your answers, so you can carry on where you left off.</div>' : ''
  host().innerHTML = pageHead('Book a farm visit') + marker(fx.seq) + `
    <div class="pn-apply fx-apply">
      <p class="pn-crumb"><a href="/farm-experience" data-route>${icon('sun')} About the farm visit</a></p>
      ${fxProgress()}
      <form id="fx-form" class="page-card pn-form fx-form" novalidate aria-labelledby="fx-step-title">
        <p class="pn-step-count">Step ${fx.at + 1} of ${FX_STEPS.length}</p>
        <h2 id="fx-step-title" tabindex="-1">${title}</h2>
        ${notice}
        <div class="fx-step">${fxStepHtml(step)}</div>
        <div id="fx-error">${fx.error ? fxNote(fx.error, { warn: true, alert: true }) : ''}</div>
        <div class="pn-actions fx-actions">
          ${fx.at > 0 ? `<button type="button" class="button secondary" data-fx="back"${fx.busy ? ' disabled' : ''}>${icon('back')} Back</button>` : '<span></span>'}
          <button type="submit" class="button primary"${fx.busy ? ' disabled' : ''}>${last ? (fx.busy ? 'Booking your visit…' : 'Book the visit') : 'Continue'} ${icon('arrow')}</button>
        </div>
        <p class="pn-saved">${icon('check')} ${last ? 'You pay after picking. Nothing is charged now.' : 'Your answers are saved on this device as you go.'}</p>
      </form>
    </div>`
  document.title = `${title} · Book a farm visit · Mango Mandi`
}

function fxShowError(p) {
  const form = $('#fx-form')
  if (!form) return
  const el = p.field ? form.elements.namedItem(p.field) : null
  if (el && p.field !== 'accept') {
    fieldError(el, p.msg)
    el.focus()
    return
  }
  fx.error = esc(p.msg)
  $('#fx-error').innerHTML = fxNote(fx.error, { warn: true, alert: true })
  if (el) el.focus()
}

function fxGo(i) {
  fx.at = i
  fx.error = ''
  fx.notice = ''
  fxSaveDraft()
  fxEnterStep()
  fxRender()
  window.scrollTo({ top: 0, behavior: 'instant' })
  $('#fx-step-title')?.focus({ preventScroll: true })
}

function fxNext() {
  if (!fx || fx.busy) return
  const step = FX_STEPS[fx.at][0]
  const p = fxProblem(step)
  if (p) return fxShowError(p)
  if (step === 'summary') return fxBook()
  fxGo(fx.at + 1)
}

function fxBookError(e) {
  if (e.code === 'IDEMPOTENCY_KEY_REUSED') return 'This visit may already be booked. Check <a href="/farm-bookings" data-route>My farm visits</a> before booking again.'
  if (e.status === 401) return 'Please sign in again, then book your visit.'
  if (e.status === 404) return 'Farm visits are not open right now.'
  return esc(e.message)
}

async function fxBook() {
  const d = fx.d, mine = fx, stay = fxStayOf(), n = (s) => fxWhole(s) ?? undefined, t = (s) => String(s).trim()
  const food = {
    ...(n(d.veg) != null && { veg: n(d.veg) }), ...(n(d.nonVeg) != null && { nonVeg: n(d.nonVeg) }), ...(n(d.jain) != null && { jain: n(d.jain) }),
    ...(t(d.allergies) && { allergies: t(d.allergies) }), ...(t(d.requests) && { requests: t(d.requests) }),
  }
  const input = {
    varietyId: d.varietyId, kg: fxWhole(d.kg), visitDate: d.visitDate, arrivalDate: stay.from, departureDate: stay.to,
    adults: fxWhole(d.adults), children: fxWhole(d.children) ?? 0, overnightGuests: fxWhole(d.overnight) ?? 0, food,
    ...(t(d.accessibility) && { accessibility: t(d.accessibility) }), ...(t(d.notes) && { notes: t(d.notes) }),
    contactName: t(d.contactName), ...(t(d.contactEmail) && { contactEmail: t(d.contactEmail) }),
    ...(t(d.billingName) && { billingName: t(d.billingName) }), ...(t(d.billingGstin) && { billingGstin: t(d.billingGstin) }),
    acceptPolicies: true,
  }
  mine.busy = true
  mine.error = ''
  fxRender()
  try {
    // Nothing is paid now: the bill comes after picking and weighing.
    const b = await MM.bookFarm(input, mine.key)
    fxClearDraft()
    try { sessionStorage.setItem(FX_PLACED, b.bookingId) } catch {}
    if (fx === mine) fx = null
    if (alive(mine.seq)) go('/farm-bookings/' + encodeURIComponent(b.bookingId), { replace: true })
  } catch (e) {
    mine.busy = false
    mine.error = fxBookError(e)
    // A key the API has already seen with other answers: the next try is a new booking.
    if (e.code === 'IDEMPOTENCY_KEY_REUSED') { mine.key = fxNewKey(); fxSaveDraft() }
    // The day filled up or the stock moved: the dates are asked again.
    mine.dates.forId = null
    if (!alive(mine.seq)) return
    fxRender()
    $('#fx-error .fx-note')?.scrollIntoView({ block: 'center', behavior: 'instant' })
  }
}

// ---- /farm-bookings: the customer's visits.

async function farmBookingsView(seq = ++sheetSeq) {
  document.title = 'My farm visits · Mango Mandi'
  host().innerHTML = pageHead('My farm visits') + marker(seq) + '<p>Loading your farm visits…</p>'
  let list
  try {
    list = await MM.farmBookings()
  } catch (e) {
    if (!alive(seq)) return
    return e.status === 404 ? fxClosed(seq) : fxLoadFailed('My farm visits', seq, e, () => farmBookingsView())
  }
  if (!alive(seq)) return
  const body = list.length
    ? list.map((b) => `<div class="order-row"><a class="guide-choice fx-row" href="/farm-bookings/${encodeURIComponent(b.id)}" data-route><span class="dot ${['CANCELLED', 'NO_SHOW'].includes(b.status) ? 'raw' : b.status === 'PAYMENT_DUE' ? 'semi' : 'ripe'}"></span><span><strong>${esc(b.number)} · ${FX_STATUS[b.status] || esc(b.status)}</strong><small>${fxKg(b.kg)} ${esc(b.variety)} · ${fmtDate(b.visitDate)} · ${b.billAmount != null ? fxMoney(b.billAmount) : `about ${fxMoney(b.total)}`}</small></span>${icon('arrow')}</a></div>`).join('')
    : `<div class="empty-cart bag-empty empty-state">${icon('sun')}<h2>No farm visits yet.</h2><p>Pick your own mangoes and stay at the farmhouse.</p><a class="button primary bag-explore" href="/farm-experience" data-route>About the farm visit ${icon('arrow')}</a></div>`
  host().innerHTML = pageHead('My farm visits') + marker(seq) + `<div class="page-card">${body}</div>${list.length ? `<a class="button secondary fx-wide" href="/farm-experience" data-route>About the farm visit ${icon('arrow')}</a>` : ''}`
}

// ---- /farm-bookings/:id: one visit.

/** The booking page while it is open: the booking, the open panel (move, cancel), and what was just done. */
let fb = null
const FX_METHODS = { upi: 'UPI', card: 'Card', netbanking: 'Net banking', wallet: 'Wallet', emi: 'EMI', paylater: 'Pay later', cash: 'Cash', dev: 'Test payment' }
/** What a quiet refresh compares: only a real change redraws the page (a panel being typed in stays). */
const fbSign = (b) => JSON.stringify([b.status, b.payment, b.hospitality.status, b.request, b.visitDate, b.canPay, b.canCancel, b.canMove, b.money, b.checkinCode])

async function farmBookingView(id, seq = ++sheetSeq) {
  document.title = 'Farm visit · Mango Mandi'
  host().innerHTML = pageHead('Farm visit') + marker(seq) + '<p>Loading your farm visit…</p>'
  let b
  try {
    b = await MM.farmBooking(id)
  } catch (e) {
    if (!alive(seq)) return
    if (e.status === 404) {
      host().innerHTML = pageHead('Farm visit') + marker(seq) + `<section class="page-card">${fxNote('We couldn’t find this farm visit on your account.', { warn: true, alert: true })}<a class="button secondary" href="/farm-bookings" data-route>My farm visits ${icon('arrow')}</a></section>`
      return
    }
    return fxLoadFailed('Farm visit', seq, e, () => farmBookingView(id))
  }
  if (!alive(seq)) return
  let placed = false
  try { placed = sessionStorage.getItem(FX_PLACED) === b.id; sessionStorage.removeItem(FX_PLACED) } catch {}
  if (fb && fb.qr) URL.revokeObjectURL(fb.qr.url)
  fb = { id, seq, b, panel: null, dates: null, date: null, note: '', reason: '', busy: '', error: '', done: '', thanks: placed && b.status === 'HOSPITALITY_REVIEW' ? 'booked' : '', qr: null }
  fbRender()
  if (fb.thanks) $('.fx-thanks')?.focus({ preventScroll: true })
  fbWatch()
}

/** While the bill is due the page asks again on its own: a payment may land, or the farm team may record one. */
function fbWatch() {
  const mine = fb
  if (!mine || mine.b.status !== 'PAYMENT_DUE') return
  setTimeout(() => { if (fb === mine && alive(mine.seq)) fbRefresh(true).then(() => fbWatch()) }, 5000)
}

async function fbRefresh(quiet = false) {
  const mine = fb
  if (!mine) return
  let b
  try { b = await MM.farmBooking(mine.id) } catch (e) { if (!quiet && fb === mine && alive(mine.seq)) { mine.error = esc(e.message); fbRender() } return }
  if (fb !== mine || !alive(mine.seq)) return
  const was = mine.b
  if (quiet && fbSign(was) === fbSign(b)) return
  mine.b = b
  if (was.status === 'PAYMENT_DUE' && b.status === 'PACKING') mine.thanks = 'paid'
  if (was.status !== 'PAYMENT_DUE' && b.status === 'PAYMENT_DUE') fbWatch()
  fbRender()
}

function fbBill(b) {
  const bill = b.bill, paid = b.payment && b.payment.status === 'PAID' ? b.payment : null, due = b.payment && b.payment.status === 'DUE' ? b.payment : null
  const busy = fb.busy === 'pay'
  let pay = ''
  if (b.canPay) {
    pay = b.razorpayKeyId
      ? `<button type="button" class="button primary" data-fx="pay"${busy ? ' disabled' : ''}>${busy ? 'Opening payment…' : `Pay ${fxMoney(bill.amount)}`} ${icon('arrow')}</button>`
      : `<div class="prototype-tag">Test mode: no payment service is connected, so no money is taken.</div><button type="button" class="button primary" data-fx="pay-test"${busy ? ' disabled' : ''}>Pay ${fxMoney(bill.amount)} (test) ${icon('arrow')}</button><button type="button" class="button secondary" data-fx="fail-test"${busy ? ' disabled' : ''}>Fail payment (test)</button>`
    pay += `<p class="fx-hint">You can also pay at the farm by UPI, card or cash. Our team records it here.</p>`
  }
  return `<section class="page-card fx-bill${b.canPay ? ' is-due' : ''}" aria-live="polite" aria-labelledby="fx-bill-title">
      <h3 id="fx-bill-title">Your bill</h3>
      ${b.canPay ? '<p class="fx-text">Your mangoes are weighed. Please pay the bill so our team can pack them.</p>' : ''}
      <dl class="fx-facts">
        ${fxFact('Weighed and accepted', fxKg(bill.acceptedKg))}
        ${fxFact('Mangoes', `${fxKg(bill.bookedPartKg)} at ${fxMoney(bill.pricePerKg)} per kg`)}
        ${bill.extraKg > 0 && bill.extraPricePerKg != null ? fxFact('Extra mangoes', `${fxKg(bill.extraKg)} at ${fxMoney(bill.extraPricePerKg)} per kg`) : ''}
      </dl>
      <div class="fx-total"><span>${paid ? 'Paid' : 'To pay'}</span><strong>${fxMoney(bill.amount)}</strong></div>
      ${paid ? `<p class="fx-paid">${icon('check')}<span>Paid on ${when(paid.paidAt)}${FX_METHODS[paid.method] ? ` · ${FX_METHODS[paid.method]}` : ''}</span></p>` : ''}
      ${b.money.refunded > 0 ? `<p class="fx-hint">Refunded ${fxMoney(b.money.refunded)}</p>` : ''}
      ${due && due.failed ? fxNote('The last payment try did not go through. You can try again.', { warn: true }) : ''}
      ${fb.error && fb.busy === '' && fb.errorAt === 'pay' ? fxNote(fb.error, { warn: true, alert: true }) : ''}
      ${pay}
    </section>`
}

function fbChanges(b) {
  const ended = FX_ENDED.includes(b.status)
  if (!b.canCancel && !b.canMove && !fb.done) {
    if (ended || b.request) return ''
    return `<section class="page-card"><h3>Change or cancel</h3>${fxNote('This visit can’t be changed or cancelled here at this stage. Call the farm team if you need help.')}</section>`
  }
  const rules = `<p class="fx-hint">Cancel ${b.policy.cancelDays} or more days before your visit at no charge. Change your visit date up to ${b.policy.rescheduleDays} days before it, if the new date has room. Closer to the visit, our team reviews your request.</p>`
  const err = fb.error && fb.errorAt === 'change' ? fxNote(fb.error, { warn: true, alert: true }) : ''
  let body = ''
  if (fb.panel === 'move') {
    const ds = fb.dates
    let days
    if (!ds || ds.state === 'loading') days = '<p class="fx-soft">Finding visit dates…</p>'
    else if (ds.state === 'error') days = `${fxNote(esc(ds.error), { warn: true, alert: true })}<button type="button" class="button secondary" data-fx="move-open">Try again</button>`
    else {
      const list = ds.list.filter((x) => x.date !== b.visitDate).map((x) => ({ date: x.date, left: ((x.varieties || []).find((v) => v.varietyId === b.variety.id) || {}).availableKg || 0 }))
      days = list.some((x) => x.left >= b.kg) ? fxDayCards(list, fb.date, b.kg, 'data-fx="move-date" data-day') : fxNote(`No other visit date has ${fxKg(b.kg)} of ${esc(b.variety.name)} left right now.`)
    }
    const busy = fb.busy === 'move'
    body = `<div class="fx-panel" id="fx-change">
        <h4 tabindex="-1">Change the visit date</h4>
        <p class="fx-hint">Now: ${fmtDate(b.visitDate)}</p>
        ${days}
        ${b.canMove === 'REQUEST' ? `<label class="field">Reason<span class="pn-opt">optional</span><textarea name="fbNote" rows="2" maxlength="1000">${esc(fb.note)}</textarea></label>` : ''}
        ${fb.date ? `<p class="fx-hint">New date: <strong>${fmtDate(fb.date)}</strong></p>` : `<p class="fx-why">${icon('info')}<span>Choose a new date to continue.</span></p>`}
        ${err}
        <div class="fx-actions-row">
          <button type="button" class="button primary" data-fx="move-send"${!fb.date || busy ? ' disabled' : ''}>${busy ? 'Sending…' : b.canMove === 'MOVE' ? 'Move my visit' : 'Ask to move my visit'}</button>
          <button type="button" class="button secondary" data-fx="panel-close"${busy ? ' disabled' : ''}>Keep this date</button>
        </div>
      </div>`
  } else if (fb.panel === 'cancel') {
    const busy = fb.busy === 'cancel'
    body = `<div class="fx-panel" id="fx-change">
        <h4 tabindex="-1">Cancel this farm visit?</h4>
        <p class="fx-text">${b.canCancel === 'CANCEL' ? 'Nothing has been charged, and the mangoes go back on sale.' : 'Your visit is close, so our team reviews the request and gets back to you.'}</p>
        <label class="field">Reason<span class="pn-opt">optional</span><textarea name="fbReason" rows="2" maxlength="1000">${esc(fb.reason)}</textarea></label>
        ${err}
        <div class="fx-actions-row">
          <button type="button" class="button secondary" data-fx="panel-close"${busy ? ' disabled' : ''}>Keep my booking</button>
          <button type="button" class="button secondary fx-danger" data-fx="cancel-send"${busy ? ' disabled' : ''}>${busy ? 'Cancelling…' : b.canCancel === 'REQUEST' ? 'Ask to cancel' : 'Cancel booking'}</button>
        </div>
      </div>`
  } else {
    const move = b.canMove && !b.request ? `<button type="button" class="button secondary" data-fx="move-open">Change the visit date</button>` : ''
    const cancel = b.canCancel && !(b.canCancel === 'REQUEST' && b.request) ? `<button type="button" class="button secondary fx-danger" data-fx="cancel-open">${b.canCancel === 'REQUEST' ? 'Ask to cancel' : 'Cancel booking'}</button>` : ''
    const why = !move && !ended && !fb.done ? `<p class="fx-why">${icon('info')}<span>${b.request ? 'The date can’t be changed while your request is with our team.' : 'The date can’t be changed at this stage of the visit.'}</span></p>` : ''
    body = `${move || cancel ? `<div class="fx-actions-row">${move}${cancel}</div>` : ''}${why}`
  }
  return `<section class="page-card" aria-labelledby="fx-change-title"><h3 id="fx-change-title">Change or cancel</h3>${fb.done ? `<div class="fx-done" tabindex="-1">${fxNote(fb.done)}</div>` : ''}${ended ? '' : rules}${body}</section>`
}

function fbRender() {
  const b = fb.b, f = b.farm, g = b.guests, h = b.hospitality
  const title = `Farm visit ${esc(b.number)}`
  document.title = `Farm visit ${b.number} · Mango Mandi`
  const thanks = fb.thanks === 'booked'
    ? `<section class="page-card fx-thanks" tabindex="-1" role="status">${icon('check')}<div><strong>Thank you, your farm visit is booked.</strong><p>Our team will plan your rooms and meals and let you know. You pay after picking.</p></div></section>`
    : fb.thanks === 'paid'
      ? `<section class="page-card fx-thanks" tabindex="-1" role="status">${icon('check')}<div><strong>Thank you, your payment is received.</strong><p>Our team is packing your mangoes.</p></div></section>`
      : ''
  const notes = [
    b.status === 'HOSPITALITY_REVIEW' && !fb.thanks && !['ALTERNATIVE_PROPOSED', 'CUSTOMER_DECLINED'].includes(h.status) ? 'Booked. Our team is planning rooms and meals for your group and will confirm your stay.' : '',
    b.status === 'CANCELLED' ? (b.money.paid > 0 ? 'This visit was cancelled.' : 'This visit was cancelled. Nothing was charged.') : '',
    b.status === 'NO_SHOW' ? 'This visit was marked as missed. Contact us if this is wrong.' : '',
    h.status === 'CUSTOMER_DECLINED' && b.status !== 'CANCELLED' ? 'You declined the proposed arrangement. Our team will contact you, or you can cancel at no charge.' : '',
    b.request ? (b.request.kind === 'CANCEL' ? 'Your request to cancel has been sent to our team. They will get back to you.' : `Your request to change the date${b.request.date ? ` to ${fmtDate(b.request.date)}` : ''} has been sent to our team. They will get back to you.`) : '',
  ].filter(Boolean).map((x) => `<section class="page-card fx-flat">${fxNote(x)}</section>`).join('')
  const altBusy = fb.busy === 'alt'
  const alt = h.status === 'ALTERNATIVE_PROPOSED' && h.alternative
    ? `<section class="page-card fx-alt" aria-labelledby="fx-alt-title">
        <h3 id="fx-alt-title">Our team proposes a different arrangement</h3>
        <p class="fx-text">${esc(h.alternative)}</p>
        ${fb.error && fb.errorAt === 'alt' ? fxNote(fb.error, { warn: true, alert: true }) : ''}
        <div class="fx-actions-row">
          <button type="button" class="button primary" data-fx="alt-yes"${altBusy ? ' disabled' : ''}>Accept</button>
          <button type="button" class="button secondary" data-fx="alt-no"${altBusy ? ' disabled' : ''}>Decline</button>
        </div>
        <p class="fx-hint">If you decline, you can cancel. Nothing has been charged.</p>
      </section>`
    : ''
  const checkin = b.checkinCode && !FX_ENDED.includes(b.status)
    ? `<section class="page-card fx-checkin" aria-labelledby="fx-qr-title">
        <h3 id="fx-qr-title">Your check-in code</h3>
        <div class="fx-qr" id="fx-qr">${fb.qr ? `<img src="${fb.qr.url}" alt="QR code for checking in at the farm" width="200" height="200">` : '<span class="fx-soft">Loading the code…</span>'}</div>
        <p class="fx-code">${esc(b.checkinCode)}</p>
        <p class="fx-hint">Show this at the farm when you arrive. Keep it to yourself until then.</p>
      </section>`
    : ''
  const stayCard = h.rooms.length || h.plan || h.mealPlan.length
    ? `<section class="page-card">
        <h3>Your stay</h3>
        ${h.plan ? `<p class="fx-text">${esc(h.plan)}</p>` : ''}
        ${h.rooms.length ? `<ul class="fx-list">${h.rooms.map((r) => `<li>${icon('check')}<span>${esc(r.name)} · ${r.guests} ${r.guests === 1 ? 'guest' : 'guests'}, ${fxStay(r.fromDate, r.toDate)}</span></li>`).join('')}</ul>` : ''}
        ${h.mealPlan.length ? `<div class="fx-table"><table><caption>Meals planned for your group (number of people)</caption><thead><tr><th scope="col">Day</th>${FX_MEALS.map(([, label]) => `<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${h.mealPlan.map((m) => `<tr><th scope="row">${fmtDate(m.date)}</th>${FX_MEALS.map(([k, label]) => `<td data-label="${label}">${m[k]}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : ''}
      </section>`
    : ''
  const there = f.name || f.location || f.contactPhone || f.arrivalInstructions
    ? `<section class="page-card">
        <h3>Getting there</h3>
        <dl class="fx-facts">
          ${f.name ? fxFact('Farm', esc(f.name)) : ''}
          ${f.location ? fxFact('Where', `${esc(f.location)}${/^https:\/\//.test(f.mapUrl || '') ? ` · <a href="${esc(f.mapUrl)}" target="_blank" rel="noreferrer noopener">Open the map</a>` : ''}`) : ''}
          ${f.contactPhone ? fxFact('Farm contact', `<a href="tel:${esc(String(f.contactPhone).replace(/[^+\d]/g, ''))}">${esc(f.contactPhone)}</a>`) : ''}
          ${f.arrivalInstructions ? fxFact('When you arrive', esc(f.arrivalInstructions)) : ''}
        </dl>
      </section>`
    : ''
  host().innerHTML = pageHead(title) + marker(fb.seq) + `
    <div class="fx-booking">
      <p class="fx-status">${fxPill(b.status)}<span>Visit on ${fmtDate(b.visitDate)}</span></p>
      ${thanks}
      ${b.bill ? fbBill(b) : ''}
      ${notes}
      ${alt}
      ${checkin}
      <section class="page-card">
        <h3>Your itinerary</h3>
        <dl class="fx-facts">
          ${fxFact('Visit date', fmtDate(b.visitDate))}
          ${fxFact('Stay', fxStay(g.arrivalDate, g.departureDate))}
          ${f.checkInTime && f.checkOutTime ? fxFact('Check-in and check-out', `Check-in from ${fxClock(f.checkInTime)}, check-out by ${fxClock(f.checkOutTime)}`) : ''}
          ${fxFact('Group', fxGroup(g.adults, g.children, g.overnight))}
          ${fxFact('Variety', esc(b.variety.name))}
          ${fxFact('Mangoes', `${fxKg(b.kg)} at ${fxMoney(b.pricePerKg)} per kg`)}
          ${b.bill ? '' : fxFact('Estimated price', `<strong>${fxMoney(b.total)}</strong> · you pay after picking`)}
          ${fxFact('Meals', `${fxMeals(f.meals)}${f.mealNotes ? ` · ${esc(f.mealNotes)}` : ''}`)}
          ${fxFact('Transport', `${fxTransport(f.transportIncluded)}${f.transportPolicy ? ` ${esc(f.transportPolicy)}` : ''}`)}
        </dl>
      </section>
      ${stayCard}
      ${there}
      ${fbChanges(b)}
      <a class="button secondary fx-wide" href="/farm-bookings" data-route>My farm visits ${icon('arrow')}</a>
    </div>`
  if (checkin && !fb.qr) fbQr()
}

/** The check-in QR: fetched with the session (not a public address), shown from an object URL. */
async function fbQr() {
  const mine = fb, code = mine.b.checkinCode
  if (mine.qrLoading) return
  mine.qrLoading = true
  try {
    const blob = await MM.farmQr(mine.id)
    if (fb !== mine) return
    mine.qr = { code, url: URL.createObjectURL(blob) }
    const box = $('#fx-qr')
    if (box && alive(mine.seq)) box.innerHTML = `<img src="${mine.qr.url}" alt="QR code for checking in at the farm" width="200" height="200">`
  } catch {
    const box = $('#fx-qr')
    if (fb === mine && box && alive(mine.seq)) box.innerHTML = `<p class="fx-why">${icon('info')}<span>The QR code didn’t load. The code below works too.</span></p>`
  } finally { mine.qrLoading = false }
}

function fbFail(at, e) {
  fb.busy = ''
  fb.errorAt = at
  fb.error = esc(e.status === 401 ? 'Please sign in again.' : e.message)
  fbRender()
}

/** Pay the bill: the API starts (or reuses) the Razorpay order, Checkout opens, and the page asks the API what happened. */
async function fbPay() {
  const mine = fb
  if (mine.busy) return
  mine.busy = 'pay'; mine.error = ''
  fbRender()
  let r
  try {
    r = await MM.payFarm(mine.id)
    if (r.razorpayKeyId) await loadScript(RAZORPAY)
  } catch (e) {
    if (fb !== mine || !alive(mine.seq)) return
    return fbFail('pay', e.message === 'load' ? { message: 'We couldn’t open the payment window. Check your connection and try again.' } : e)
  }
  if (fb !== mine || !alive(mine.seq)) return
  const settle = async () => { if (fb !== mine) return; mine.busy = ''; await fbRefresh(); fbWatch() }
  if (!r.razorpayKeyId) return settle()
  new window.Razorpay({
    key: r.razorpayKeyId, order_id: r.razorpayOrderId, amount: r.amount, currency: 'INR', name: 'Mango Mandi', description: 'Farm visit ' + r.number,
    prefill: { contact: (MM.profile() || {}).phone || '' },
    handler: async (reply) => { try { await MM.verifyFarmPayment(mine.id, reply) } catch {} await settle() },
    modal: { ondismiss: () => { settle() } },
  }).open()
}

/** Test mode (no payment service connected, dev routes on): pays or fails the bill as the Razorpay webhook would. */
async function fbTestPay(outcome) {
  const mine = fb
  if (mine.busy) return
  mine.busy = 'pay'; mine.error = ''
  fbRender()
  try {
    await MM.payFarm(mine.id)
    const r = await MM.api('/' + ['dev', 'pay-farm'].join('/'), { method: 'POST', body: { bookingId: mine.id, outcome }, paise: true })
    if (outcome === 'failed' || (r && r.result === 'ignored')) toast('Payment didn’t go through. Please try again.')
  } catch (e) {
    if (fb !== mine || !alive(mine.seq)) return
    return fbFail('pay', e.status === 404 ? { message: 'Test payments are switched off here. Pay at the farm, or ask our team.' } : e)
  }
  if (fb !== mine || !alive(mine.seq)) return
  mine.busy = ''
  await fbRefresh()
}

async function fbAnswer(accept) {
  const mine = fb
  if (mine.busy) return
  mine.busy = 'alt'; mine.error = ''
  fbRender()
  try {
    const b = await MM.answerFarmArrangement(mine.id, accept)
    if (fb !== mine || !alive(mine.seq)) return
    mine.busy = ''
    mine.b = b
    fbRender()
    toast(accept ? 'Thank you. Our team will confirm your stay.' : 'We’ve told our team you declined.')
  } catch (e) {
    if (fb === mine && alive(mine.seq)) fbFail('alt', e)
  }
}

async function fbMoveOpen() {
  const mine = fb, b = mine.b
  mine.panel = 'move'; mine.error = ''; mine.done = ''; mine.date = null
  mine.dates = { state: 'loading', list: [] }
  fbRender()
  $('#fx-change h4')?.focus({ preventScroll: true })
  try {
    const r = await MM.farmDates(b.variety.id)
    if (fb !== mine || mine.panel !== 'move') return
    mine.dates = { state: 'ready', list: r.dates || [] }
  } catch (e) {
    if (fb !== mine || mine.panel !== 'move') return
    mine.dates = { state: 'error', list: [], error: e.message }
  }
  if (alive(mine.seq)) fbRender()
}

async function fbMoveSend() {
  const mine = fb
  if (mine.busy || !mine.date) return
  mine.busy = 'move'; mine.error = ''
  fbRender()
  try {
    const r = await MM.moveFarmBooking(mine.id, mine.date, mine.note.trim() || undefined)
    if (fb !== mine || !alive(mine.seq)) return
    mine.busy = ''; mine.panel = null; mine.b = r.booking
    mine.done = r.requested ? 'Your request to change the date has been sent to our team. They will get back to you.' : `Your visit has been moved to ${fmtDate(r.booking.visitDate)}. Our team will confirm your stay again.`
    fbRender()
    $('.fx-done')?.focus({ preventScroll: true })
  } catch (e) {
    if (fb === mine && alive(mine.seq)) fbFail('change', e)
  }
}

async function fbCancelSend() {
  const mine = fb
  if (mine.busy) return
  mine.busy = 'cancel'; mine.error = ''
  fbRender()
  try {
    const r = await MM.cancelFarmBooking(mine.id, mine.reason.trim() || undefined)
    if (fb !== mine || !alive(mine.seq)) return
    mine.busy = ''; mine.panel = null; mine.b = r.booking
    mine.done = r.requested ? 'Your request to cancel has been sent to our team. They will get back to you.' : 'Your farm visit is cancelled. Nothing was charged.'
    fbRender()
    $('.fx-done')?.focus({ preventScroll: true })
  } catch (e) {
    if (fb === mine && alive(mine.seq)) fbFail('change', e)
  }
}

// ---- Events.

document.addEventListener('click', (e) => {
  const b = e.target instanceof Element ? e.target.closest('[data-fx]') : null
  if (!b) return
  const what = b.dataset.fx
  // A crossed day or an unavailable variety: it says why on itself, and does nothing.
  if (b.getAttribute('aria-disabled') === 'true') return e.preventDefault()
  const onBook = fx && alive(fx.seq) && $('#fx-form')
  if (onBook) {
    if (what === 'variety') {
      if (fx.d.varietyId !== b.dataset.id) { fx.d.varietyId = b.dataset.id; fx.d.visitDate = null }
      fx.error = ''
      fxSaveDraft()
      fxRender()
      $(`[data-fx="variety"][data-id="${CSS.escape(b.dataset.id)}"]`)?.focus()
    } else if (what === 'date') {
      fx.d.visitDate = b.dataset.day
      fx.d.arrivalDate = ''
      fx.d.departureDate = ''
      fx.error = ''
      fxSaveDraft()
      fxRender()
      $(`[data-fx="date"][data-day="${b.dataset.day}"]`)?.focus()
    } else if (what === 'step') fxGo(Number(b.dataset.step))
    else if (what === 'back') fxGo(fx.at - 1)
    else if (what === 'dates-retry') { fxDates(true); fxRender() }
    return
  }
  if (!fb || !alive(fb.seq) || !$('.fx-booking')) return
  if (what === 'pay') fbPay()
  else if (what === 'pay-test') fbTestPay('captured')
  else if (what === 'fail-test') fbTestPay('failed')
  else if (what === 'alt-yes') fbAnswer(true)
  else if (what === 'alt-no') fbAnswer(false)
  else if (what === 'move-open') fbMoveOpen()
  else if (what === 'move-date') { fb.date = b.dataset.day; fb.error = ''; fbRender(); $(`[data-fx="move-date"][data-day="${b.dataset.day}"]`)?.focus() }
  else if (what === 'move-send') fbMoveSend()
  else if (what === 'cancel-open') { fb.panel = 'cancel'; fb.error = ''; fb.done = ''; fbRender(); $('#fx-change h4')?.focus({ preventScroll: true }) }
  else if (what === 'cancel-send') fbCancelSend()
  else if (what === 'panel-close') { const was = fb.panel; fb.panel = null; fb.error = ''; fbRender(); $(`[data-fx="${was}-open"]`)?.focus() }
})

document.addEventListener('submit', (e) => {
  if (!(e.target instanceof Element) || e.target.id !== 'fx-form') return
  e.preventDefault()
  fxNext()
})

document.addEventListener('input', (e) => {
  const t = e.target
  if (!(t instanceof Element) || !t.name) return
  if (fb && t.closest('#fx-change')) {
    if (t.name === 'fbNote') fb.note = t.value
    else if (t.name === 'fbReason') fb.reason = t.value
    return
  }
  if (!fx || !t.closest('#fx-form') || !(t.name in fx.d)) return
  if (t.name === 'billingGstin') t.value = t.value.toUpperCase()
  fx.d[t.name] = t.type === 'checkbox' ? t.checked : t.value
  if (fx.error) { fx.error = ''; $('#fx-error').innerHTML = '' }
  fxSaveDraft()
  if (t.name === 'kg') {
    clearTimeout(fxQuoteTimer)
    fx.d.visitDate = fx.dates.state === 'ready' && fx.d.visitDate && !fxDayOk(fx.d.visitDate) ? null : fx.d.visitDate
    if (fxKgOk()) { $('#fx-quote').innerHTML = '<p class="fx-quote fx-soft">Working out the estimate…</p>'; fxQuoteTimer = setTimeout(() => fx && fxQuote(), 350) }
    else { fx.quote = null; fxShowQuote() }
  }
  if (['overnight', 'arrivalDate', 'departureDate'].includes(t.name)) {
    const stay = fxStayOf(), form = t.form
    if (t.name === 'overnight' && !fx.d.departureDate && form.elements.departureDate) form.elements.departureDate.value = stay.to
    const line = $('#fx-stay-line')
    if (line && stay.from && stay.to) line.textContent = `Visit day ${fmtDate(fx.d.visitDate)} · stay ${fxStay(stay.from, stay.to)}`
  }
})
