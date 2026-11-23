/* Search and share, in the browser. The pages' titles and descriptions are in routes.js (window.MM_ROUTES), which the
   build also uses to write one HTML file per page (build-config.mjs → _routes/) for crawlers and link previews.
   On every `mm:route` (pages.js):
   - the meta description follows the page (a page's sub-pages, /gifts/send, take its description; others the home one);
   - a title left behind by a page that is no longer open is put back (each view sets its own title; the home page
     with no page open always has the home title);
   - on the home page, structured data for search (JSON-LD): Organization and WebSite, and once the shelf (shelf.js)
     has drawn its cards an ItemList of Products: name, photo and words from catalog.js, each box an Offer in INR
     (price from GET /v1/products) with its availability (pre-order before the season; in stock or sold out once the
     stock for a pincode is known; left out while it is not). Elsewhere the JSON-LD is taken away.
   (The not-found page's noindex is pages.js's.) Loaded last, after app.js and shelf.js, whose globals (shelf, stock,
   qtyOf, preSeason, SOLD_API) it reads at call time. No styles. */
(() => {
  const ROUTES = window.MM_ROUTES || []
  const HOME = ROUTES.find((r) => r.path === '/')
  if (!HOME) return
  const clean = (p) => (p === '/index.html' ? '/' : p.replace(/\/+$/, '') || '/')
  const within = (r, p) => r.path === p || (r.path !== '/' && p.startsWith(r.path + '/'))
  const routeFor = (p) => ROUTES.find((r) => within(r, p)) || HOME
  const atHome = () => !document.body.classList.contains('page-open') && clean(location.pathname) === '/'

  function onRoute() {
    const path = clean(location.pathname), here = routeFor(path)
    const meta = document.querySelector('meta[name="description"]')
    if (meta) meta.content = here.description
    const left = ROUTES.find((r) => r.title === document.title)
    if (atHome()) document.title = HOME.title
    else if (left && !within(left, path)) document.title = here.title
    homeData()
  }

  // ---- JSON-LD
  const origin = () => { try { return new URL(document.querySelector('link[rel="canonical"]').href).origin } catch { return location.origin } }
  const cfg = window.MM_CONFIG || {}
  function ld(id, data) {
    let el = document.getElementById(id)
    if (!data) return el?.remove()
    if (!el) { el = document.createElement('script'); el.type = 'application/ld+json'; el.id = id; document.head.append(el) }
    const text = JSON.stringify(data)
    if (el.textContent !== text) el.textContent = text
  }
  const SCHEMA = 'https://schema.org/'
  function availability(v, s) {
    if (typeof preSeason === 'function' && preSeason()) return SCHEMA + 'PreOrder'
    if (typeof stock === 'undefined' || !stock || typeof qtyOf !== 'function') return undefined
    return (typeof SOLD_API !== 'undefined' ? SOLD_API : ['SEMI_RIPE', 'RAW']).some((st) => qtyOf(s.sku, st) > 0) ? SCHEMA + 'InStock' : SCHEMA + 'OutOfStock'
  }
  function products() {
    const list = typeof shelf !== 'undefined' && Array.isArray(shelf) ? shelf : []
    if (!list.length) return null
    const at = origin(), brand = { '@type': 'Brand', name: cfg.businessName || 'VMR Mangoes' }
    const item = (v, i) => {
      const c = v.c || {}, photo = c.photos && (c.photos.SEMI_RIPE || c.photos.RIPE)
      const offers = (v.skus || []).filter((s) => Number(s.price) > 0).map((s) => ({ '@type': 'Offer', name: `${v.name}, ${String(s.boxSize).replace('kg', ' kg')} box`, price: Number(s.price), priceCurrency: 'INR', availability: availability(v, s), url: at + '/' }))
      return { '@type': 'ListItem', position: i + 1, item: { '@type': 'Product', name: v.name, ...(photo ? { image: new URL(photo, at + '/').href } : {}), ...(c.story || c.flavour ? { description: c.story || c.flavour } : {}), brand, ...(offers.length ? { offers } : {}) } }
    }
    return { '@context': 'https://schema.org', '@type': 'ItemList', name: 'Mangoes', itemListElement: list.map(item) }
  }
  function homeData() {
    const home = atHome(), at = origin(), name = cfg.businessName || 'VMR Mangoes'
    const org = { '@context': 'https://schema.org', '@type': 'Organization', name, url: at + '/', logo: at + '/assets/app-icon.png', ...(cfg.supportEmail ? { email: cfg.supportEmail } : {}), ...(cfg.supportPhone ? { telephone: cfg.supportPhone } : {}), ...(cfg.businessAddress ? { address: cfg.businessAddress } : {}) }
    ld('ld-org', home && org)
    ld('ld-site', home && { '@context': 'https://schema.org', '@type': 'WebSite', name, url: at + '/' })
    ld('ld-products', home && products())
  }

  window.addEventListener('mm:route', onRoute)
  // No event says the shelf is drawn: its grid (#products) is redrawn whole each time, so watch for that.
  const grid = document.getElementById('products')
  if (grid) new MutationObserver(() => { if (atHome()) ld('ld-products', products()) }).observe(grid, { childList: true })
  onRoute()
})()
