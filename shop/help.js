/* Contact us (/contact) and Help (/help).
   Contact: the ways to reach the shop that are configured (WhatsApp, and a phone number and email when the build sets
   them; with none of them, the help request while the help centre is on, else just the address), our address with the FSSAI and GSTIN lines when the build sets them
   (pages.js bizInfo()), and where bulk buyers and partners should go.
   Help: complaints and refunds. A signed-in customer sends a help request (the API's help centre: a topic, optionally
   one of their orders, and a message; the shop answers on the panel's Help desk and the customer is told on WhatsApp).
   When the help centre is off, or nobody is signed in, the page says how to reach us instead: only the ways that are
   set (WhatsApp, phone, email), else our address, else Your orders; it never mentions a form that isn't there. It also states the
   cancelling rules in short (app.js cancelHours(): the API's cancelWindowHours, 4 by default; the full table is /refund,
   pages.js) and, in short, what the shop does with a customer's information (the full text is /privacy), with the
   button that deletes the account (the API's DELETE /v1/me).
   Loaded after pages.js (it adds to PAGES) and before app.js. Styles: style.css (.help-). */

PAGES.push([/^\/contact\/?$/, () => contactView()], [/^\/help\/?$/, () => helpView()])

const HELP_TITLE = 'Help · VMR Mangoes', CONTACT_TITLE = 'Contact us · VMR Mangoes'
const helpCfg = () => window.MM_CONFIG || {}
const helpWa = () => { const wa = String(helpCfg().supportWhatsapp || '').trim(); return /^\d+$/.test(wa) ? wa : '' }

function contactWays() {
  const wa = helpWa(), phone = String(helpCfg().supportPhone || '').trim(), email = String(helpCfg().supportEmail || '').trim()
  const ways = []
  if (wa) ways.push(`<a class="help-way" href="https://wa.me/${wa}?text=${encodeURIComponent('Hi VMR Mangoes')}" target="_blank" rel="noopener">${icon('chat')}<span><strong>WhatsApp</strong><small>The quickest way to reach us.</small></span>${icon('arrow')}</a>`)
  if (phone) ways.push(`<a class="help-way" href="tel:${esc(phone.replace(/[^\d+]/g, ''))}">${icon('phone')}<span><strong>Call us</strong><small>${esc(phone)}</small></span>${icon('arrow')}</a>`)
  if (email) ways.push(`<a class="help-way" href="mailto:${esc(email)}">${icon('mail')}<span><strong>Email</strong><small>${esc(email)}</small></span>${icon('arrow')}</a>`)
  ways.push(`<a class="help-way" href="/help" data-route>${icon('info')}<span><strong>Help, complaints and refunds</strong><small>Cancelling, refunds and damaged boxes.</small></span>${icon('arrow')}</a>`)
  return ways.join('')
}

function contactView() {
  document.title = CONTACT_TITLE
  const b = bizInfo(), direct = Boolean(b.wa || b.phone || b.email)
  const where = b.address ? `
    <section class="page-card help-card help-address">
      <h2 class="flow-head">Our address</h2>
      <p>${b.legalName ? `${esc(b.legalName)}<br>` : ''}${esc(b.address)}</p>
      ${b.fssai ? `<p>FSSAI Lic. No. ${esc(b.fssai)}</p>` : ''}${b.gstin ? `<p>GSTIN ${esc(b.gstin)}</p>` : ''}
    </section>` : ''
  host().innerHTML = pageHead('Contact us') + `
    <section class="page-card help-card">
      <h2 class="flow-head">We’re here for you.</h2>
      <p>Questions about mangoes, an order, or a delivery?<span data-contact-lead>${direct ? ' Reach us any of these ways.' : ''}</span></p>
      <div class="help-ways">${contactWays()}</div>
    </section>${where}
    <section class="page-card help-card">
      <h2 class="flow-head">Looking for something else?</h2>
      <div class="help-ways">
        <a class="help-way" href="/bulk" data-route>${icon('box')}<span><strong>Bulk orders</strong><small>100 kg and more: restaurant kitchens, functions, birthday parties and shops.</small></span>${icon('arrow')}</a>
        <a class="help-way" href="/partner" data-route data-partner-link>${icon('leaf')}<span><strong>Grow with us</strong><small>Mango farmers, sellers and shops.</small></span>${icon('arrow')}</a>
      </div>
    </section>`
  // No WhatsApp, phone or email set: the help request, only while the help centre is on; else the address, if there is one.
  if (!direct) {
    helpCentreOn().then((on) => {
      const el = $('[data-contact-lead]')
      if (el) el.textContent = on ? ' Send us a help request and we will reply on WhatsApp.' : b.address ? ' Write to us at the address below.' : ''
    })
  }
}

function helpView() {
  document.title = HELP_TITLE
  host().innerHTML = pageHead('Help') + `
    <section class="page-card help-card" id="help-request"><h2 class="flow-head">Complaints and refunds</h2><div class="help-request-body" aria-busy="true"><p>One moment…</p></div></section>
    <section class="page-card help-card" id="your-requests" hidden><h2 class="flow-head">Your requests</h2><div class="req-body"></div></section>
    <section class="page-card help-card">
      <h2 class="flow-head">Cancelling and refunds</h2>
      <p><strong>A normal order</strong> can be cancelled within <strong>${hoursWord(cancelHours())} of placing it</strong>, as long as it hasn’t been packed: open it under <a href="/orders" data-route>Your orders</a> and choose “Cancel order”. It is refunded in full to the way you paid. After that, cancelling is closed.<span data-help-reach>${helpReachKnown()}</span></p>
      <p><strong>A pre-order</strong> can’t be cancelled once paid, unless we delay it; then you can cancel it for a full refund until it is packed.</p>
      <p><strong>A paid bulk order</strong> can be cancelled within ${hoursWord(cancelHours())} of paying, until it is dispatched, for a full refund. On <strong>a gift order</strong>, each person’s delivery can be cancelled within ${hoursWord(cancelHours())} of placing it, as long as their box isn’t packed.</p>
      <p>Full policy: <a href="/refund" data-route>Refund and cancellation policy</a></p>
    </section>
    <section class="page-card help-card">
      <h2 class="flow-head">If your mangoes arrive damaged, wrong or missing</h2>
      <p>Open the order under <a href="/orders" data-route>Your orders</a> and choose “Report a problem with this order”<span data-claim-hours>${claimHoursText()}</span>. Add a photo if you can. We look at every report and send a replacement for what went wrong.</p>
    </section>
    <section class="page-card help-card" id="your-information">
      <h2 class="flow-head">Your information</h2>
      <p>We keep your name, mobile number, addresses, orders and the messages you send us, to deliver your mangoes and answer you. Card and UPI details go to Razorpay, never to us, and we do not sell your information. Read the <a href="/privacy" data-route>Privacy policy</a> for what we keep, why, and who else sees it.</p>
      <p><strong>Deleting it.</strong> You can delete your account at any time once no order is on its way. Your name, number, email and addresses are removed and your bag is emptied. The amounts of past orders are kept, without your details, because our accounts need them.</p>
      <div class="help-delete"></div>
    </section>`
  // the claim window once the policy has loaded, if it hadn't yet
  helpCentreOn().then((on) => {
    const el = $('[data-claim-hours]')
    if (el) el.textContent = claimHoursText()
    const reach = $('[data-help-reach]')
    if (reach) reach.innerHTML = helpReachSentence(on)
  })
  MM.restore().then(() => { if (document.body.dataset.page === 'help') { helpRequestBox(); helpDeleteBox(); if (typeof helpRequestsBox === 'function') helpRequestsBox() } })
}

/** Within how long of delivery a problem can be reported (the policy's claimWindowHours), when the policy has loaded. */
function claimHoursText() {
  const p = (typeof policy !== 'undefined' && policy) || helpPolicy
  const h = Number(p && p.claimWindowHours)
  return Number.isFinite(h) && h > 0 ? ` within ${hoursWord(h)} of delivery` : ' soon after delivery'
}

/** The ways to reach us that the build sets (WhatsApp, phone, email), as words for a sentence (HTML); '' when none is. */
function helpReachWords() {
  const wa = helpWa(), b = bizInfo(), ways = []
  if (wa) ways.push(`<a href="https://wa.me/${wa}?text=${encodeURIComponent('Hi VMR Mangoes, I need help with an order')}" target="_blank" rel="noopener">message us on WhatsApp</a>`)
  if (b.phone) ways.push(`call us on <a href="tel:${esc(b.phone.replace(/[^\d+]/g, ''))}">${esc(b.phone)}</a>`)
  if (b.email) ways.push(`email <a href="mailto:${esc(b.email)}">${esc(b.email)}</a>`)
  return ways.length > 1 ? `${ways.slice(0, -1).join(', ')} or ${ways.at(-1)}` : ways[0] || ''
}

/** The end of the cancelling paragraph: the request form above only while the help centre is on, else the ways that exist, else nothing. */
function helpReachSentence(on) {
  if (on) return ' If something is wrong, send us a request above and we’ll help.'
  const w = helpReachWords()
  return w ? ` If something is wrong, ${w} and we’ll help.` : ''
}
/** The same, when the policy has already loaded; '' until it has (helpView fills it in). */
function helpReachKnown() {
  const p = (typeof policy !== 'undefined' && policy) || helpPolicy
  return p ? helpReachSentence(Boolean(p.care && p.care.helpCentre)) : ''
}

/** The help centre is off: the ways to reach us that exist, else our address, else Your orders (cancel and report a problem there). */
function helpOffHTML(waLink) {
  const b = bizInfo(), btns = [waLink]
  if (b.phone) btns.push(`<a class="button secondary" href="tel:${esc(b.phone.replace(/[^\d+]/g, ''))}">Call ${esc(b.phone)} ${icon('phone')}</a>`)
  if (b.email) btns.push(`<a class="button secondary" href="mailto:${esc(b.email)}">Email us ${icon('mail')}</a>`)
  const ways = btns.filter(Boolean).join('')
  if (ways) return `<p>Something wrong with an order, a delivery or a payment? Tell us and we’ll put it right.</p><div class="help-actions">${ways}</div>`
  if (b.address) return `<p>Something wrong with an order, a delivery or a payment? Write to us and we’ll put it right:</p><p>${esc(b.legalName || b.name)}<br>${esc(b.address)}</p>`
  return `<p>Something wrong with an order? Open it under Your orders: you can cancel it there while it can still be cancelled, or report a problem with a delivered box.</p><div class="help-actions"><a class="button primary" href="/orders" data-route>Your orders ${icon('arrow')}</a></div>`
}

/** The help centre is switched on (the policy's care.helpCentre): only then are replies shown on the account. */
let helpPolicy = null
async function helpCentreOn() {
  let p = typeof policy !== 'undefined' && policy ? policy : helpPolicy
  if (!p) p = helpPolicy = await MM.policy().catch(() => null)
  return Boolean(p && p.care && p.care.helpCentre)
}

/** The request form for a signed-in customer; otherwise how to reach us. */
async function helpRequestBox() {
  const box = $('.help-request-body')
  if (!box) return
  const wa = helpWa(), waLink = wa ? `<a class="button secondary" href="https://wa.me/${wa}?text=${encodeURIComponent('Hi VMR Mangoes, I need help with an order')}" target="_blank" rel="noopener">Message us on WhatsApp ${icon('arrow')}</a>` : ''
  box.removeAttribute('aria-busy')
  if (!MM.profile()) {
    const on = await helpCentreOn()
    if (!box.isConnected) return
    box.innerHTML = on
      ? `<p>Something wrong with an order, a delivery or a payment? Sign in and tell us: we answer every request, and you’ll see our reply on this page under “Your requests” and on WhatsApp.</p><div class="help-actions"><a class="button primary" href="/login?next=%2Fhelp" data-route>Sign in to send a request ${icon('arrow')}</a>${waLink}</div>`
      : helpOffHTML(waLink)
    return
  }
  let info = null, orders = []
  // Asked only while the help centre is on (its routes answer 404 while it is off).
  if (await helpCentreOn()) try { info = await MM.helpInfo() } catch { info = null }
  if (document.body.dataset.page !== 'help' || !box.isConnected) return
  if (!info || !Array.isArray(info.topics)) {
    // the help centre is switched off on this shop: point to the other ways
    box.innerHTML = helpOffHTML(waLink)
    return
  }
  try { orders = await MM.orders() } catch { orders = [] }
  if (!box.isConnected) return
  const min = Number(info.firstMessageMin) || 10, max = Number(info.messageMax) || 2000
  box.innerHTML = `<p>Tell us what went wrong. We answer every request; you’ll see our reply below under “Your requests” and on WhatsApp.</p>
    <form id="help-form" novalidate><p class="prototype-tag help-error" role="alert" hidden></p>
      <div class="form-grid">
        <label class="field">What is it about?<select name="topic" required>${info.topics.map((t) => `<option value="${esc(t.id)}"${t.id === 'PAYMENT' ? ' selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label>
        <label class="field">Which order? <small>(optional)</small><select name="orderId"><option value="">Not about one order</option>${(Array.isArray(orders) ? orders : []).slice(0, 30).map((o) => `<option value="${esc(o.id)}">${esc(orderNo(o.number))}</option>`).join('')}</select></label>
      </div>
      <label class="field">What happened?<textarea name="message" rows="5" required minlength="${min}" maxlength="${max}" placeholder="Tell us what went wrong and what you would like us to do."></textarea></label>
      <button class="button primary" type="submit">Send request ${icon('arrow')}</button>
    </form>`
  $('#help-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const f = e.target, err = $('.help-error', f), btn = $('button[type=submit]', f)
    const message = f.message.value.trim()
    err.hidden = true
    if (message.length < min) { err.textContent = `Tell us a little more (${min} characters or more).`; err.hidden = false; f.message.focus(); return }
    btn.disabled = true
    try {
      const r = await MM.helpRequest({ topic: f.topic.value, orderId: f.orderId.value || null, message })
      box.innerHTML = `<div class="help-sent" role="status">${icon('check')}<div><strong>Request sent${r && r.number ? ` · ${esc(String(r.number))}` : ''}.</strong><p>We’ll reply below under “Your requests” and on WhatsApp. Thank you for telling us.</p></div></div>`
      if (typeof helpRequestsBox === 'function') helpRequestsBox()
    } catch (ex) {
      err.textContent = (ex && ex.message) || 'We could not send that just now. Please try again.'
      err.hidden = false
      btn.disabled = false
    }
  })
}

/** "Delete my account", for a signed-in customer. */
function helpDeleteBox() {
  const box = $('.help-delete')
  if (!box || !MM.profile()) return
  box.innerHTML = `<button class="button secondary is-danger" type="button" data-delete-account>${icon('close')} Delete my account</button><p class="help-delete-note" role="status" hidden></p>`
  $('[data-delete-account]', box).addEventListener('click', async (e) => {
    const note = $('.help-delete-note', box)
    if (!window.confirm('Delete your account? Your name, number, email and addresses will be removed. This cannot be undone.')) return
    e.currentTarget.disabled = true
    try {
      await MM.deleteAccount()
      toast('Your account has been deleted.')
      go('/')
    } catch (ex) {
      note.textContent = ex && ex.code === 'OPEN_ORDERS' ? 'You have an order on its way. You can delete your account once it has been delivered or cancelled.' : ((ex && ex.message) || 'We could not delete your account just now. Please try again.')
      note.hidden = false
      e.currentTarget.disabled = false
    }
  })
}

window.addEventListener('mm:route', () => { if ((document.title === HELP_TITLE || document.title === CONTACT_TITLE) && !['help', 'contact'].includes(document.body.dataset.page)) document.title = 'VMR Mangoes — A little taste of summer.' })
