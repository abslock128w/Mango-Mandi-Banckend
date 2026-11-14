/* Contact us (/contact) and Help (/help).
   Contact: the ways to reach the shop that are configured (WhatsApp, and a phone number and email when the build sets
   them), and where bulk buyers and partners should go.
   Help: complaints and refunds. A signed-in customer sends a help request (the API's help centre: a topic, optionally
   one of their orders, and a message; the shop answers on the panel's Help desk and the customer is told on WhatsApp).
   When the help centre is off, or nobody is signed in, the page says how to reach us instead. It also states the
   cancellation rule (four hours) and what the shop does with a customer's information, with the button that deletes
   the account (the API's DELETE /v1/me).
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
  ways.push(`<a class="help-way" href="/help" data-route>${icon('info')}<span><strong>Help, complaints and refunds</strong><small>Tell us what went wrong with an order.</small></span>${icon('arrow')}</a>`)
  return ways.join('')
}

function contactView() {
  document.title = CONTACT_TITLE
  host().innerHTML = pageHead('Contact us') + `
    <section class="page-card help-card">
      <h2 class="flow-head">We’re here for you.</h2>
      <p>Questions about mangoes, an order, or a delivery? Reach us any of these ways.</p>
      <div class="help-ways">${contactWays()}</div>
    </section>
    <section class="page-card help-card">
      <h2 class="flow-head">Looking for something else?</h2>
      <div class="help-ways">
        <a class="help-way" href="/bulk" data-route>${icon('box')}<span><strong>Bulk orders</strong><small>100 kg and more: restaurant kitchens, functions, birthday parties and shops.</small></span>${icon('arrow')}</a>
        <a class="help-way" href="/partner" data-route data-partner-link>${icon('leaf')}<span><strong>Grow with us</strong><small>Mango farmers, sellers and shops.</small></span>${icon('arrow')}</a>
      </div>
    </section>`
}

function helpView() {
  document.title = HELP_TITLE
  host().innerHTML = pageHead('Help') + `
    <section class="page-card help-card" id="help-request"><h2 class="flow-head">Complaints and refunds</h2><div class="help-request-body" aria-busy="true"><p>One moment…</p></div></section>
    <section class="page-card help-card">
      <h2 class="flow-head">Cancelling an order</h2>
      <p>You can cancel an order yourself for <strong>four hours after placing it</strong>: open the order under <a href="/orders" data-route>Your orders</a> and choose “Cancel order”. A paid order cancelled in that time is refunded to the way you paid.</p>
      <p>After four hours, cancelling is closed: by then your box is being picked and packed. If something is wrong, send us a request above and we’ll help.</p>
    </section>
    <section class="page-card help-card">
      <h2 class="flow-head">If your mangoes arrive damaged, wrong or missing</h2>
      <p>Tell us as soon as you can, with a photo if you have one. We look at every case and put right what went wrong.</p>
    </section>
    <section class="page-card help-card" id="your-information">
      <h2 class="flow-head">Your information</h2>
      <p><strong>What we save.</strong> Your name and mobile number, the addresses you deliver to, your orders, and the messages you send us. We use them to deliver your mangoes, to tell you about your order on WhatsApp or SMS, and to answer you.</p>
      <p><strong>Payments.</strong> You pay through Razorpay. Your card or UPI details go to Razorpay and are never stored by us; we keep only the payment’s reference and amount.</p>
      <p><strong>Who sees it.</strong> Our own staff, and the rider who brings your order (your name, address and number for that delivery). We do not sell your information.</p>
      <p><strong>Deleting it.</strong> You can delete your account at any time once no order is on its way. Your name, number, email and addresses are removed and your bag is emptied. The amounts of past orders are kept, without your details, because our accounts need them.</p>
      <div class="help-delete"></div>
    </section>`
  MM.restore().then(() => { if (document.body.dataset.page === 'help') { helpRequestBox(); helpDeleteBox() } })
}

/** The request form for a signed-in customer; otherwise how to reach us. */
async function helpRequestBox() {
  const box = $('.help-request-body')
  if (!box) return
  const wa = helpWa(), waLink = wa ? `<a class="button secondary" href="https://wa.me/${wa}?text=${encodeURIComponent('Hi VMR Mangoes, I need help with an order')}" target="_blank" rel="noopener">Message us on WhatsApp ${icon('arrow')}</a>` : ''
  box.removeAttribute('aria-busy')
  if (!MM.profile()) {
    box.innerHTML = `<p>Something wrong with an order, a delivery or a payment? Sign in and tell us: we answer every request, and you’ll see our reply here and on WhatsApp.</p><div class="help-actions"><a class="button primary" href="/login?next=%2Fhelp" data-route>Sign in to send a request ${icon('arrow')}</a>${waLink}</div>`
    return
  }
  let info = null, orders = []
  try { info = await MM.helpInfo() } catch { info = null }
  if (document.body.dataset.page !== 'help' || !box.isConnected) return
  if (!info || !Array.isArray(info.topics)) {
    // the help centre is switched off on this shop: point to the other ways
    box.innerHTML = `<p>Something wrong with an order, a delivery or a payment? Tell us and we’ll put it right.</p><div class="help-actions">${waLink || `<a class="button primary" href="/contact" data-route>Contact us ${icon('arrow')}</a>`}</div>`
    return
  }
  try { orders = await MM.orders() } catch { orders = [] }
  if (!box.isConnected) return
  const min = Number(info.firstMessageMin) || 10, max = Number(info.messageMax) || 2000
  box.innerHTML = `<p>Tell us what went wrong. We answer every request; you’ll see our reply on your account and on WhatsApp.</p>
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
      box.innerHTML = `<div class="help-sent" role="status">${icon('check')}<div><strong>Request sent${r && r.number ? ` · ${esc(String(r.number))}` : ''}.</strong><p>We’ll reply here and on WhatsApp. Thank you for telling us.</p></div></div>`
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
