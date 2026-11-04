/* Pages: /checkout, /orders, /orders/:id (and the API's /order/:id), /account.
   They replace the home page (main#home) with #page-view, keep the header, footer and dock, and
   use the History API, so back and forward work and the addresses can be shared or reloaded
   (shop/vercel.json and scripts/serve-shop.mjs serve index.html for them). Checkout and orders
   reuse app.js's flows, which draw wherever `view` points; the profile page is here.
   Loaded before app.js, so top-level code only declares and listens. */

const PAGES = [
  [/^\/checkout\/?$/, () => checkout()],
  [/^\/orders\/?$/, () => signedInThen('Your orders', ordersView)],
  [/^\/orders?\/([^/]+)\/?$/, (m) => signedInThen('Your order', () => orderView(decodeURIComponent(m[1])))],
  [/^\/account\/?$/, () => signedInThen('Your profile', accountView)],
]
const ACCOUNT_TABS = [['/account', 'Profile'], ['/orders', 'My orders']]
let homeScroll = 0

const isPage = (path) => PAGES.some(([re]) => re.test(path))
const pageOpen = () => document.body.classList.contains('page-open')

function go(path) {
  // An entry this app pushed is marked, so the back button knows it can go back within the site.
  if (location.pathname + location.hash !== path) history.pushState({ mm: true }, '', path)
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
function signedInThen(title, then) {
  MM.restore().then(() => {
    if (!pageOpen()) return
    if (MM.profile()) then()
    else startSteps(title, false, then)
  })
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
  const name = me.name || 'Mango lover', phone = me.phone || ''
  const favs = favorites.filter((n) => shelf.some((v) => v.name === n))
  host().innerHTML = head('Your profile') + marker(seq) + `
    ${error ? `<p class="prototype-tag" role="alert">${esc(error)}</p>` : ''}
    <section class="page-card profile-card">
      <span class="avatar" aria-hidden="true">${esc(name.trim()[0] || 'M').toUpperCase()}</span>
      <div><h2>${esc(name)}</h2><p>${esc(phone)}</p></div>
    </section>
    <section class="page-card">
      <h3>Saved addresses</h3>
      ${addresses.length ? addresses.map((a) => `<div class="address-row"><div><strong>${esc(a.name || 'Saved address')}</strong><small>${esc(a.address)} · ${esc(a.pincode)}</small></div><button class="text-button" data-remove-address="${esc(a.id)}">Remove</button></div>`).join('') : '<p class="page-note">The addresses you deliver to are saved here after your first order, ready to pick at checkout.</p>'}
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
