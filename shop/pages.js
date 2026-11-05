/* Pages: /checkout, /orders, /orders/:id (and the API's /order/:id), /account.
   They replace the home page (main#home) with #page-view, keep the header, footer and dock, and
   use the History API, so back and forward work and the addresses can be shared or reloaded
   (shop/vercel.json and scripts/serve-shop.mjs serve index.html for them). Checkout and orders
   reuse app.js's flows, which draw wherever `view` points; the profile page is here.
   Loaded before app.js, so top-level code only declares and listens. */

const PAGES = [
  [/^\/checkout\/?$/, () => checkout()],
  [/^\/orders\/?$/, () => signedInThen('Your orders', ordersView)],
  [/^\/orders?\/([^/]+)\/?$/, (m) => signedInThen('Your order', () => trackView(decodeURIComponent(m[1])))],
  [/^\/account\/?$/, () => signedInThen('Your profile', accountView)],
  [/^\/login\/?$/, () => loginView()],
]
const ACCOUNT_TABS = [['/account', 'Profile'], ['/orders', 'My orders']]
let homeScroll = 0, nameEditing = false

const isPage = (path) => PAGES.some(([re]) => re.test(path))
const pageOpen = () => document.body.classList.contains('page-open')

function go(path, { replace = false } = {}) {
  // An entry this app pushed is marked, so the back button knows it can go back within the site.
  if (location.pathname + location.search + location.hash !== path) history[replace ? 'replaceState' : 'pushState']({ mm: true }, '', path)
  route()
}

function route() {
  const path = location.pathname
  for (const [re, open] of PAGES) {
    const m = path.match(re)
    if (!m) continue
    showPage(path)
    open(m)
    return
  }
  hidePage()
}

function showPage(path) {
  if (!pageOpen()) homeScroll = scrollY
  closeDialogs()
  view = '#page-body'
  ++sheetSeq
  document.body.classList.add('page-open')
  document.body.dataset.page = path.split('/')[1]
  $('#home').hidden = true
  $('#page-view').hidden = false
  window.scrollTo({ top: 0, behavior: 'instant' })
  window.Liquid?.enter($('#page-view'), { soft: true })
}

function hidePage() {
  if (!pageOpen()) return
  document.body.classList.remove('page-open')
  delete document.body.dataset.page
  $('#page-view').hidden = true
  $('#page-body').innerHTML = ''
  $('#home').hidden = false
  view = '#form-dialog'
  ++sheetSeq
  const target = location.hash && document.getElementById(location.hash.slice(1))
  if (target) target.scrollIntoView({ behavior: 'instant' })
  else window.scrollTo({ top: homeScroll, behavior: 'instant' })
  positionPill(false)
}

/** Signed in already: go on. Otherwise sign in on the page first (the checkout's own steps). */
/** Signed in already: go on. Otherwise the sign-in page first, which comes back here once the code is verified. */
function signedInThen(title, then) {
  MM.restore().then(() => {
    if (!pageOpen()) return
    if (MM.profile()) then()
    else go(`/login?next=${encodeURIComponent(location.pathname)}`, { replace: true })
  })
}

/** Where the sign-in page goes afterwards: only a path on this site (never another site's address). */
function loginNext() {
  const next = new URLSearchParams(location.search).get('next') || '/account'
  return /^\/(?!\/)[\w\-/]*$/.test(next) ? next : '/account'
}

// ---- The sign-in page (/login): the phone and code steps, then on to where the customer was going.

function loginView() {
  MM.restore().then(() => {
    if (!pageOpen()) return
    if (MM.profile()) return go(loginNext(), { replace: true })
    startSteps('Sign in', false, () => go(loginNext(), { replace: true }), 'login')
  })
}

function loginIntro() {
  return `<div class="login-intro"><img class="brand-light" src="assets/brand-original.jpeg" alt=""><img class="brand-dark" src="assets/brand-dark.webp" alt=""><p>Sign in with your mobile number to see your orders, keep your addresses and check out faster. New here? Your account is made when you verify the code.</p></div>`
}

/** The page's heading: a back button, the title, and on the account pages their tabs. */
function pageHead(title) {
  const tabs = ['account', 'orders'].includes(document.body.dataset.page)
    ? `<nav class="page-tabs" aria-label="Your account">${ACCOUNT_TABS.map(([href, label]) => {
      const on = location.pathname === href || (href === '/orders' && location.pathname.startsWith('/order'))
      return `<a href="${href}" data-route ${on ? 'aria-current="page"' : ''}>${label}</a>`
    }).join('')}</nav>`
    : ''
  return `<div class="page-head"><button class="icon-button" data-page-back aria-label="Back">${icon('back')}</button><h1>${title}</h1></div>${tabs}`
}

// ---- The profile page.

async function accountView(seq = ++sheetSeq) {
  host().innerHTML = head('Your profile') + marker(seq) + '<p>Loading your profile…</p>'
  let me = MM.profile() || {}, addresses = [], error = ''
  try {
    ;[me, addresses] = await Promise.all([MM.me(), MM.addresses().catch(() => [])])
  } catch (e) {
    error = e.status === 401 ? 'Please sign in again.' : e.message
  }
  if (!alive(seq)) return
  const named = me.name || (MM.profile() || {}).name || ''
  const name = named || 'Mango lover', phone = me.phone || ''
  const editing = nameEditing || !named
  const favs = favorites.filter((n) => shelf.some((v) => v.name === n))
  host().innerHTML = head('Your profile') + marker(seq) + `
    ${error ? `<p class="prototype-tag" role="alert">${esc(error)}</p>` : ''}
    <section class="page-card profile-card">
      <span class="avatar" aria-hidden="true">${esc(name.trim()[0] || 'M').toUpperCase()}</span>
      ${editing
        ? `<form id="name-form" class="name-form"><label class="field">${named ? 'Your name' : 'What should we call you?'}<input name="name" maxlength="80" autocomplete="name" required value="${esc(named)}" placeholder="Your name"></label><button class="button primary" type="submit">Save</button></form>`
        : `<div><h2>${esc(name)}</h2><p>${esc(phone)} · <button class="text-button inline-link" data-edit-name>Edit name</button></p></div>`}
    </section>
    <section class="page-card">
      <h3>Saved addresses</h3>
      ${addresses.length ? addresses.map((a) => `<div class="address-row"><div><strong>${esc(a.name || 'Saved address')}</strong><small>${esc(addressText(a.address))} · ${esc(a.pincode)}</small></div><button class="text-button" data-remove-address="${esc(a.id)}">Remove</button></div>`).join('') : '<p class="page-note">The addresses you deliver to are saved here after your first order, ready to pick at checkout.</p>'}
    </section>
    <section class="page-card">
      <h3>Favourites</h3>
      ${favs.length ? `<div class="fav-chips">${favs.map((n) => `<button class="occasion" data-fav-open="${esc(n)}">${icon('heart')}${esc(n)}</button>`).join('')}</div>` : '<p class="page-note">Tap the heart on a mango to keep it here.</p>'}
    </section>
    <section class="page-card">
      <h3>Updates</h3>
      <label class="toggle-row"><span><strong>WhatsApp reminders</strong><small>A note a week after delivery to ask how your mangoes were.</small></span><input type="checkbox" role="switch" data-reminders ${me.remindersOptIn ? 'checked' : ''}></label>
    </section>
    <section class="page-card page-actions">
      <button class="button secondary" data-preorders>My pre-orders ${icon('sun')}</button>
      <button class="button secondary" data-signout>Sign out</button>
    </section>`
}

// ---- The order tracking page (/orders/:id).

const TRACK_STEPS = [
  ['Placed', ['PAYMENT_PENDING']],
  ['Confirmed', ['CONFIRMED']],
  ['Packed', ['PROCESSING', 'PACKED']],
  ['On the way', ['SHIPPED', 'OUT_FOR_DELIVERY']],
  ['Delivered', ['DELIVERED']],
]
const ENDED = ['DELIVERED', 'CANCELLED', 'RTO']
const when = (t) => (t ? new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '')
let lastTrack = ''

function trackHeadline(o) {
  const name = o.rider && o.rider.firstName
  const slot = o.slot ? ` · ${esc(o.slot.label)}, ${esc(o.slot.startsAt)}–${esc(o.slot.endsAt)}` : ''
  const arriving = `Arriving ${fmtDate(o.deliveryDate)}${slot}`
  switch (o.status) {
    case 'PAYMENT_PENDING': return ['Waiting for payment', o.holdExpiresAt ? `Your mangoes are held until ${fmtTime(o.holdExpiresAt)}.` : arriving]
    case 'CONFIRMED': return [o.findingStock ? 'Confirmed. Finding your mangoes' : 'Confirmed', o.findingStock ? 'We’re lining up the right fruit for your date and will message you if anything changes.' : arriving]
    case 'PROCESSING': case 'PACKED': return ['Packed and ready', arriving]
    case 'SHIPPED': case 'OUT_FOR_DELIVERY': return [`${name ? esc(name) + ' is' : 'Your mangoes are'} on the way`, o.tracking ? `About ${o.tracking.etaMinutes} min · ${o.tracking.stopsAway ? `${o.tracking.stopsAway} ${o.tracking.stopsAway === 1 ? 'stop' : 'stops'} before yours` : 'you’re next'}` : `Arriving today${slot}`]
    case 'DELIVERED': return ['Delivered', o.delivery ? `${when(o.delivery.at)}${o.delivery.receivedBy ? ` · received by ${esc(o.delivery.receivedBy)}` : ''}` : 'Enjoy your mangoes.']
    case 'DELIVERY_FAILED': return ['We missed you', o.retryScheduled ? 'We’ll try again on the next delivery run.' : 'We’ll call you to arrange a new time.']
    case 'CANCELLED': return ['Cancelled', o.cancelReason === 'HOLD_EXPIRED' ? 'The payment didn’t come through in time, so the hold ran out.' : o.cancelledAt ? `Cancelled ${when(o.cancelledAt)}.` : '']
    case 'RTO': return ['Returned', 'The order came back to us. We’ll be in touch.']
    default: return [STATUS[o.status] || esc(o.status), arriving]
  }
}

function tracker(o) {
  if (['CANCELLED', 'RTO'].includes(o.status)) return ''
  const at = TRACK_STEPS.findIndex(([, list]) => list.includes(o.status === 'DELIVERY_FAILED' ? 'OUT_FOR_DELIVERY' : o.status))
  const stamp = (list) => {
    const t = (o.timeline || []).find((e) => list.includes(e.status))
    return t ? when(t.at) : ''
  }
  return `<ol class="tracker" aria-label="Order progress">${TRACK_STEPS.map(([label, list], i) => {
    const state = i < at ? 'done' : i === at ? (o.status === 'DELIVERY_FAILED' ? 'missed' : 'current') : ''
    return `<li class="${state}"${i === at ? ' aria-current="step"' : ''}><span class="tracker-dot">${i < at || (i === at && o.status === 'DELIVERED') ? icon('check') : ''}</span><strong>${label}</strong><small>${i <= at ? stamp(list) : ''}</small></li>`
  }).join('')}</ol>`
}

const PAY_METHODS = { upi: 'UPI', card: 'Card', netbanking: 'Net banking', wallet: 'Wallet', emi: 'EMI', paylater: 'Pay later', demo: 'Test payment' }

/** How the order was paid, with the references a bank or UPI app shows (the invoice prints the same). */
function paymentBlock(o) {
  const p = o.payment
  if (!p) return ''
  const how = [PAY_METHODS[p.method] || p.method || 'Online', p.vpa, p.card, p.bank, p.wallet].filter(Boolean).map(esc).join(' · ')
  const rows = [
    ['Paid by', how],
    p.upiRef && ['UPI ref no.', esc(p.upiRef)],
    p.bankRef && ['Bank ref', esc(p.bankRef)],
    p.paymentId && [`${esc(p.gateway || 'Razorpay')} payment ID`, esc(p.paymentId)],
    p.paidAt && ['Paid on', when(p.paidAt)],
  ].filter(Boolean)
  return `<dl class="pay-facts">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`
}

async function trackView(id, quiet = false, seq = ++sheetSeq) {
  if (!quiet) {
    lastTrack = ''
    host().innerHTML = head('Your order') + marker(seq) + '<p>Loading your order…</p>'
  }
  let o
  try {
    o = await MM.order(id)
  } catch (e) {
    if (!alive(seq)) return
    if (quiet) setTimeout(() => alive(seq) && trackView(id, true, seq), 30000)
    else host().innerHTML = head('Your order') + marker(seq) + `<p class="prototype-tag" role="alert">${esc(e.message)}</p><button class="text-button" data-orders>All orders</button>`
    return
  }
  if (!alive(seq)) return
  const again = () => setTimeout(() => alive(seq) && trackView(id, true, seq), o.status === 'PAYMENT_PENDING' ? 5000 : 30000)
  // A quiet refresh only redraws when something changed, so the map and photo don't blink.
  const snapshot = JSON.stringify(o)
  if (quiet && snapshot === lastTrack) {
    if (!ENDED.includes(o.status)) again()
    return
  }
  lastTrack = snapshot
  const [title, sub] = trackHeadline(o)
  const left = o.holdExpiresAt ? Date.parse(o.holdExpiresAt) - Date.now() : 0
  const canPay = o.status === 'PAYMENT_PENDING' && o.razorpayOrderId && left > 60000
  const canCancel = ['PAYMENT_PENDING', 'CONFIRMED', 'PROCESSING'].includes(o.status)
  const pin = addressPin(o.deliveryAddress)
  const wa = String((window.MM_CONFIG || {}).supportWhatsapp || '').trim()
  host().innerHTML = head(`Order ${esc(orderNo(o.number))}`) + marker(seq) + `
    <section class="page-card track-hero status-${esc(o.status.toLowerCase())}">
      <h2>${title}</h2><p>${sub}</p>
      ${tracker(o)}
      ${o.deliveryCode ? `<div class="delivery-code"><span>Delivery code</span><strong>${[...String(o.deliveryCode)].map((d) => `<i>${esc(d)}</i>`).join('')}</strong><small>Share it with ${o.rider && o.rider.firstName ? esc(o.rider.firstName) : 'your rider'} when your mangoes arrive.</small></div>` : ''}
      ${o.delivery && o.delivery.hasPhoto ? '<figure class="delivery-photo"><img alt="Photo taken at delivery" hidden><figcaption>Photo at delivery</figcaption></figure>' : ''}
      ${canPay ? `<button class="button primary full" data-pay-order="${esc(o.id)}">Pay now ${currency(o.total)} ${icon('arrow')}</button>` : ''}
    </section>
    <section class="page-card">
      <h3>Delivering to</h3>
      <p class="track-address">${esc(addressText(o.deliveryAddress))}${o.pincode ? ` · ${esc(o.pincode)}` : ''}</p>
      ${pin ? '<div class="track-map" role="img" aria-label="Delivery location on the map"></div>' : ''}
    </section>
    <section class="page-card">
      <h3>Your box${(o.items || []).length > 1 ? 'es' : ''}</h3>
      ${(o.items || []).map((l) => {
        const st = stageOf(l.stage)
        return `<div class="cart-row">${thumb(l.sku, l.stage, l.name)}<div><h3>${esc(l.name)}</h3><small>${st.stage} · ${l.quantity} × ${currency(l.unitPrice)}${l.eatBy ? ` · best by ${fmtDate(l.eatBy)}` : ''}</small><div class="cart-row-bottom"><span></span><strong>${currency(l.linePrice)}</strong></div></div></div>`
      }).join('')}
      ${o.discount ? `<div class="subtotal"><span>Discount</span><strong>−${currency(o.discount)}</strong></div>` : ''}
      <div class="subtotal"><span>Total</span><strong>${currency(o.total)}</strong></div>
      <p class="cart-disclaimer">Placed ${when(o.placedAt)} · Prices include GST.</p>
      ${paymentBlock(o)}
    </section>
    <section class="page-card page-actions">
      ${/^\d+$/.test(wa) ? `<a class="button secondary" href="https://wa.me/${wa}?text=${encodeURIComponent(`Hi Mango Mandi, about my order ${orderNo(o.number)}`)}" target="_blank" rel="noopener">Help on WhatsApp</a>` : ''}
      ${o.bill ? `<button class="button primary" data-invoice="${esc(o.id)}" data-number="${esc(o.number)}">Download invoice ${icon('arrow')}</button>` : ''}
      ${canCancel ? `<button class="button secondary" data-cancel-order="${esc(o.id)}" data-number="${esc(orderNo(o.number))}">Cancel order</button>` : ''}
      <button class="button secondary" data-orders>All orders</button>
    </section>`
  if (pin) MapPick.readOnly($('.track-map', host()), pin).catch(() => {})
  if (o.delivery && o.delivery.hasPhoto) {
    MM.deliveryPhoto(o.id).then((b) => {
      const img = $('.delivery-photo img', host())
      if (!img || !alive(seq)) return
      img.src = URL.createObjectURL(b)
      img.hidden = false
    }, () => $('.delivery-photo', host())?.remove())
  }
  if (!ENDED.includes(o.status)) again()
}

// ---- Events.

// Links inside the app (data-route) and the home anchors (#shop, #bulk…) while a page is open.
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey) return
  const a = e.target instanceof Element ? e.target.closest('a') : null
  if (!a) return
  const href = a.getAttribute('href') || ''
  if (a.hasAttribute('data-route')) {
    e.preventDefault()
    closeDialogs()
    go(href)
  } else if (href.startsWith('#') && pageOpen()) {
    e.preventDefault()
    go('/' + href)
  }
}, true)

document.addEventListener('click', (e) => {
  const b = e.target instanceof Element ? e.target.closest('button') : null
  if (!b) return
  if (b.hasAttribute('data-page-back')) {
    if (history.state && history.state.mm) history.back()
    else go('/')
  } else if (b.hasAttribute('data-edit-name')) {
    nameEditing = true
    accountView()
  } else if (b.dataset.removeAddress) {
    MM.deleteAddress(b.dataset.removeAddress).then(() => {
      toast('Address removed')
      accountView()
    }, (err) => toast(err.message))
  } else if (b.dataset.favOpen) {
    const name = b.dataset.favOpen
    go('/#shop')
    productDetail(name)
  }
})

// The name on the profile page: saved to the account (PATCH /v1/me); if the API doesn't take it yet, kept on
// this device so checkout still fills it in.
document.addEventListener('submit', (e) => {
  if (e.target.id !== 'name-form') return
  e.preventDefault()
  const name = String(new FormData(e.target).get('name') || '').trim()
  if (!name) return
  const b = e.target.querySelector('button')
  b.disabled = true
  MM.updateMe({ name }).then(
    (me) => {
      MM.rememberProfile({ name: me.name ?? name })
      toast('Name saved')
    },
    (err) => {
      if (err.status !== 400) throw err
      MM.rememberProfile({ name })
      toast('Name saved on this device')
    },
  ).then(() => {
    nameEditing = false
    accountView()
  }, (err) => {
    b.disabled = false
    toast(err.message)
  })
})

document.addEventListener('change', (e) => {
  const t = e.target
  if (!t.matches || !t.matches('[data-reminders]')) return
  t.disabled = true
  MM.updateMe({ remindersOptIn: t.checked }).then(
    () => toast(t.checked ? 'WhatsApp reminders on' : 'WhatsApp reminders off'),
    (err) => {
      t.checked = !t.checked
      toast(err.message)
    },
  ).finally(() => {
    t.disabled = false
  })
})

window.addEventListener('popstate', route)
// Signing out on an account page leaves it.
window.addEventListener('mm:profile', () => {
  if (pageOpen() && !MM.profile() && ['account', 'orders'].includes(document.body.dataset.page)) go('/')
})
