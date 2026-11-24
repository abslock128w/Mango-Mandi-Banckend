/* The gift recipient's own page, /gift-address/:token (no sign-in): someone sent them a box before the season and chose
   "Ask them on WhatsApp", so the WhatsApp message carries this link. They see who it is from, the box and its week, and
   enter their address and pincode; the pincode is checked as typed, the same check as checkout (GET /v1/delivery/check),
   and again by the API, which takes the address once (mango-api gift-address routes, docs/gifting.md "Asking the
   recipient for their address"). The page shows no price and nothing about the giver beyond the name they gave.
   Loaded after pages.js (it adds to PAGES) and gifts.js; top-level code only declares and listens. */

PAGES.push([/^\/gift-address\/([^/]+)\/?$/, (m) => giftAddressPage(decodeURIComponent(m[1]))])

const ga = { token: '', seq: 0, info: null, address: '', pincode: '', pin: null, busy: false, error: '', errors: {}, done: false }
const gaPath = (t) => `/gift-address/${encodeURIComponent(t)}`
const gaFirst = (s) => String(s || '').trim().split(/\s+/)[0] || ''

async function giftAddressPage(token) {
  document.title = 'Your gift · VMR Mangoes'
  const seq = ++ga.seq
  if (ga.token !== token) Object.assign(ga, { token, info: null, address: '', pincode: '', pin: null, busy: false, error: '', errors: {}, done: false })
  host().innerHTML = pageHead('Your gift') + '<section class="page-card ga-card" id="ga-card" aria-busy="true"><p class="gift-muted">Loading your gift…</p></section>'
  let info = null, err = null
  try { info = await MM.api(gaPath(token)) } catch (e) { err = e }
  if (seq !== ga.seq || document.body.dataset.page !== 'gift-address') return
  ga.info = info
  gaRender(err)
}

/** What a link that can't be used says, by the API's answer. */
function gaProblemHTML(e) {
  const code = e && e.code
  const [h, p] = code === 'LINK_EXPIRED' ? ['This link has expired.', 'Ask the person who sent you the gift to send a new link.']
    : code === 'GIFT_CANCELLED' ? ['This gift was cancelled.', 'There is nothing more to do here.']
    : e && (e.status === 404 || code === 'LINK_NOT_FOUND') ? ['This link isn’t right.', 'Open it again from the WhatsApp message, or ask the person who sent you the gift to send it again.']
    : ['We couldn’t open your gift just now.', 'Check your connection and try again in a minute.']
  return `<div class="ga-head">${icon('gift')}<h2>${esc(h)}</h2><p>${esc(p)}</p></div><a class="button primary" href="/" data-route>See the mangoes ${icon('arrow')}</a>`
}

const gaBoxWords = (b) => giftBoxWords(b, (st) => stageOf(st).stage)

function gaRender(err) {
  const card = $('#ga-card')
  if (!card) return
  card.removeAttribute('aria-busy')
  const g = ga.info
  if (!g) { card.innerHTML = gaProblemHTML(err); return }
  const from = String(g.fromName || '').trim() || 'Someone who thinks of you'
  const week = g.weekStart ? `the week of ${esc(fmtWeek(g.weekStart))}` : 'when the season starts'
  const gift = `<div class="ga-gift">${icon('gift')}<div><p class="ga-from">From <strong>${esc(from)}</strong></p><p class="ga-box">${esc(gaBoxWords(g.box))}</p><p class="ga-week">${icon('calendar')}<span>Arrives in ${week}</span></p>${g.message ? `<blockquote class="ga-note">“${esc(g.message)}”</blockquote>` : ''}</div></div>`
  if (g.state === 'GIVEN' || ga.done) {
    card.innerHTML = `<div class="ga-head is-done">${icon('check')}<h2>${ga.done ? 'Thank you' : 'We have your address'}${g.recipientName ? `, ${esc(gaFirst(g.recipientName))}` : ''}.</h2><p>Your mangoes arrive in ${week}. We’ll message you on WhatsApp when they’re on the way.</p></div>${gift}`
    return
  }
  const pin = ga.pincode.trim(), hint = ga.pin === true ? `<small class="field-hint gift-pin is-ok">${icon('check')}<span>We deliver to ${esc(pin)}</span></small>` : ga.pin === 'checking' ? `<small class="field-hint gift-pin">${icon('clock')}<span>Checking ${esc(pin)}…</span></small>` : ''
  card.innerHTML = `<div class="ga-head"><h2>${g.recipientName ? `Hi ${esc(gaFirst(g.recipientName))}, a` : 'A'} box of mangoes is coming your way.</h2><p>Tell us where to deliver it. That’s all we need.</p></div>${gift}
    <form id="ga-form" class="ga-form" novalidate>
      <label class="field">Your address<textarea name="ga-address" rows="3" maxlength="500" autocomplete="street-address" placeholder="House, street, area, landmark">${esc(ga.address)}</textarea></label>
      <label class="field gift-pin-field">Pincode<input name="ga-pincode" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="postal-code" placeholder="6 digits" value="${esc(ga.pincode)}">${hint}</label>
      ${ga.error ? `<p class="prototype-tag" role="alert">${icon('info')}<span>${esc(ga.error)}</span></p>` : ''}
      <button type="submit" class="button primary full gift-big"${ga.busy ? ' disabled' : ''}>${icon(ga.busy ? 'clock' : 'check')}<span>${ga.busy ? 'Saving…' : 'Send my address'}</span></button>
      <p class="gift-muted">${icon('lock')}<span>We use your address only to deliver this gift. You can give it once; if it changes, reply to our WhatsApp message.</span></p>
    </form>`
  const f = $('#ga-form')
  for (const [name, msg] of Object.entries(ga.errors)) { const el = f.elements.namedItem(name); if (el) fieldError(el, msg) }
}

/** The address's problems, as the API checks them: [name, message]. */
function gaProblems() {
  const out = [], a = ga.address.trim(), pin = ga.pincode.trim()
  if (!a) out.push(['ga-address', 'Enter your address'])
  else if (a.length < 10) out.push(['ga-address', 'Enter the full address: house, street and area'])
  if (!pin) out.push(['ga-pincode', 'Enter your pincode'])
  else if (!/^[1-9]\d{5}$/.test(pin)) out.push(['ga-pincode', 'Enter a 6-digit pincode'])
  else if (ga.pin === false) out.push(['ga-pincode', `We don’t deliver to ${pin} yet. Enter another address where someone can take the box.`])
  return out
}

async function gaCheckPin(pin) {
  ga.pin = 'checking'
  let ok
  try { ok = !!(await MM.deliveryCheck(pin)).serviceable } catch { ok = null }
  if (ga.pincode.trim() !== pin) return
  ga.pin = ok
  if (ok === false) ga.errors['ga-pincode'] = `We don’t deliver to ${pin} yet. Enter another address where someone can take the box.`
  else delete ga.errors['ga-pincode']
  gaRender()
  $('[name="ga-pincode"]')?.focus()
}

async function gaSubmit() {
  if (ga.busy) return
  ga.error = ''
  ga.errors = Object.fromEntries(gaProblems())
  if (Object.keys(ga.errors).length) { gaRender(); $(`[name="${Object.keys(ga.errors)[0]}"]`)?.focus(); return }
  ga.busy = true
  gaRender()
  try {
    const r = await MM.api(gaPath(ga.token), { method: 'POST', body: { address: ga.address.trim(), pincode: ga.pincode.trim() } })
    ga.done = true
    if (ga.info) { ga.info.state = 'GIVEN'; if (r && r.weekStart) ga.info.weekStart = r.weekStart }
  } catch (e) {
    if (e.code === 'NOT_SERVICEABLE') { ga.pin = false; ga.errors['ga-pincode'] = `We don’t deliver to ${ga.pincode.trim()} yet. Enter another address where someone can take the box.` }
    else if (e.code === 'ADDRESS_GIVEN') { if (ga.info) ga.info.state = 'GIVEN' }
    else if (e.code === 'LINK_EXPIRED' || e.code === 'GIFT_CANCELLED' || e.status === 404) { ga.busy = false; ga.info = null; gaRender(e); return }
    else if (e.code === 'VALIDATION_ERROR' && /address/i.test(e.message)) ga.errors['ga-address'] = e.message.replace(/^[^:]+:\s*/, '')
    else if (e.code === 'VALIDATION_ERROR' && /pincode/i.test(e.message)) ga.errors['ga-pincode'] = e.message.replace(/^[^:]+:\s*/, '')
    else ga.error = e.message || 'Something went wrong. Please try again.'
  }
  ga.busy = false
  gaRender()
  if (ga.done || (ga.info && ga.info.state === 'GIVEN')) $('#ga-card h2')?.focus?.()
  else { const bad = Object.keys(ga.errors)[0]; if (bad) $(`[name="${bad}"]`)?.focus() }
}

let gaPinTimer = 0
document.addEventListener('input', (e) => {
  const t = e.target
  if (!t.form || t.form.id !== 'ga-form') return
  if (t.name === 'ga-address') { ga.address = t.value; delete ga.errors['ga-address'] }
  if (t.name === 'ga-pincode') {
    ga.pincode = t.value
    ga.pin = null
    delete ga.errors['ga-pincode']
    t.closest('.field')?.querySelector('.gift-pin')?.remove()
    clearTimeout(gaPinTimer)
    const pin = t.value.trim()
    if (/^[1-9]\d{5}$/.test(pin)) gaPinTimer = setTimeout(() => gaCheckPin(pin), 250)
  }
})
document.addEventListener('submit', (e) => { if (e.target.id === 'ga-form') { e.preventDefault(); gaSubmit() } })
