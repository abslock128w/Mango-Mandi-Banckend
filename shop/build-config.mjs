#!/usr/bin/env node
// Writes shop/config.js from the environment, then scans the folder like every other
// browser build (scripts/scan-bundle.mjs). Vercel runs it as the build command
// (shop/vercel.json); `npm run shop:build` runs it from the repo root. Paths come from
// this file's location, so the working directory does not matter.
//
//   API_URL           mango-api's origin, e.g. https://api.mandimangoes.in (no path, no
//                     trailing slash). Required on a Vercel production build, where it must
//                     be https and not this computer. Elsewhere it defaults to the local API.
//   API_VIA_SHOP      "true" when the shop and the API are on different sites (two
//                     *.vercel.app addresses): the shop then calls /v1 on its own address
//                     and vercel.json forwards it to API_URL, so the sign-in cookie is the
//                     shop's own and phones keep it. Not needed when both are under one
//                     domain (shop.mandimangoes.in and api.mandimangoes.in).
//   SUPPORT_WHATSAPP  the help WhatsApp number, digits only (e.g. 919800000000). Optional.
//   SUPPORT_PHONE     a phone number to show on the Contact page. Optional.
//   SUPPORT_EMAIL     an email address to show on the Contact page. Optional.
//   GOOGLE_MAPS_KEY   a Google Maps browser key. Optional: with it the delivery map, the address
//                     lookup and the place search use Google Maps; without it they stay on
//                     OpenStreetMap. In Google Cloud the key needs Maps JavaScript API, Geocoding
//                     API and Places API (New) enabled, and should be restricted to this shop's
//                     addresses (HTTP referrers). It is a browser key: it is meant to be in the page.
//   BUSINESS_NAME     the registered business name, e.g. "VMR Mangoes" (2 to 80 characters). Optional:
//                     shown in the footer and on the terms page, which fall back to "VMR Mangoes".
//   BUSINESS_ADDRESS  the postal address on one line, commas allowed (10 to 200 characters). Optional:
//                     shown in the footer and as "Our address" on the Contact page.
//   FSSAI_NUMBER      the 14-digit FSSAI licence number. Optional: shown in the footer and on Contact.
//   GSTIN             the 15-character GSTIN, checked like the API checks it (mango-api/src/gstin.js:
//                     shape, state code and check character). Optional: shown in the footer and on Contact.
//   SHOP_URL          the shop's own public origin, e.g. https://mandimangoes.in (no path, no trailing slash).
//                     Optional: without it the build keeps the origin in index.html's canonical link. Every page's
//                     canonical link, og:url and og:image, the sitemap and robots.txt use it, so moving the shop to
//                     its own domain is this one variable (index.html is rewritten when it differs).
//   Each optional detail is written into config.js only when set (supportPhone, supportEmail,
//   businessName, businessAddress, fssaiNumber, gstin); the shop shows no line for one that is not.
//   A production build warns, without failing, for each of SUPPORT_WHATSAPP, SUPPORT_PHONE,
//   SUPPORT_EMAIL, BUSINESS_ADDRESS, FSSAI_NUMBER and GSTIN that is missing.
//
// config.js is committed with the local default so the folder runs as is; this build
// overwrites it. Run `npm run shop:build` with no variables to put the default back.
//
// Then, for search engines and link previews (WhatsApp, which runs no JavaScript), it writes _routes/: one HTML
// file per public page in routes.js (index.html with that page's title, description, canonical and Open Graph
// tags; vercel.json rewrites /bulk to /_routes/bulk.html and so on), sitemap.xml and robots.txt. _routes/ is
// rebuilt every time and never committed (.gitignore). index.html stays the template and the home page.
//
// This folder is served as it is, this file included, so it must not spell out a
// localhost address either: the scan below would refuse it on a production build.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const shopDir = path.dirname(fileURLToPath(import.meta.url))
const production = process.env.VERCEL_ENV === 'production'
const LOCAL_API = ['http:', '', 'localhost:3000'].join('/')

function fail(message) {
  console.error(`shop build: ${message}`)
  process.exit(1)
}

/** The API origin to write, or a reason it is refused. */
export function apiUrlFrom(raw, { production: prod = false } = {}) {
  const value = (raw ?? '').trim()
  if (!value) {
    if (prod) return { error: 'API_URL is required on a production build (e.g. https://api.mandimangoes.in).' }
    return { value: LOCAL_API }
  }
  let url
  try {
    url = new URL(value)
  } catch {
    return { error: `API_URL is not a URL: ${JSON.stringify(value)}` }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { error: `API_URL must be http(s): ${JSON.stringify(value)}` }
  if (value !== url.origin) {
    return { error: `API_URL must be an origin only, with no path and no trailing slash (did you mean ${url.origin}?)` }
  }
  if (prod) {
    if (url.protocol !== 'https:') return { error: `API_URL must be https on a production build: ${value}` }
    const host = url.hostname.toLowerCase()
    if (host === 'localhost' || host.endsWith('.localhost') || host.startsWith('127.') || host === '[::1]' || host === '0.0.0.0') {
      return { error: `API_URL must not point at this computer on a production build: ${value}` }
    }
  }
  return { value: url.origin }
}

/** The help number, digits only, or a reason it is refused. */
export function whatsappFrom(raw) {
  const value = (raw ?? '').trim()
  if (value && !/^\d{8,15}$/.test(value)) {
    return { error: `SUPPORT_WHATSAPP must be digits only, country code first (e.g. 919800000000): ${JSON.stringify(value)}` }
  }
  return { value }
}

/** Where vercel.json forwards /v1 (the API's origin), or null when it does not. */
export function forwardedApi(vercelJson) {
  const hit = (vercelJson?.rewrites ?? []).find((r) => r.source === '/v1/:path*')
  const m = /^(https:\/\/[^/]+)\/v1\/:path\*$/.exec(hit?.destination ?? '')
  return m ? m[1] : null
}

/** Optional contact details for the Contact page (SUPPORT_PHONE, SUPPORT_EMAIL): written only when set. */
export const contactFrom = (envv) => {
  const phone = String(envv.SUPPORT_PHONE ?? '').trim(), email = String(envv.SUPPORT_EMAIL ?? '').trim()
  if (phone && !/^\+?[\d\s-]{8,20}$/.test(phone)) return { error: `SUPPORT_PHONE must be a phone number (digits, spaces, an optional +): ${JSON.stringify(phone)}` }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: `SUPPORT_EMAIL must be an email address: ${JSON.stringify(email)}` }
  return { value: { ...(phone ? { supportPhone: phone } : {}), ...(email ? { supportEmail: email } : {}) } }
}

/** The Google Maps browser key (GOOGLE_MAPS_KEY), or a reason it is refused. Optional. */
export const mapsKeyFrom = (raw) => {
  const value = String(raw ?? '').trim()
  if (value && !/^[A-Za-z0-9_-]{20,100}$/.test(value)) return { error: 'GOOGLE_MAPS_KEY does not look like a Google Maps key (letters, digits, - and _ only).' }
  return { value }
}

// GSTIN: the same shape, state codes and check character as mango-api/src/gstin.js (gstinProblem), kept in step by
// tests/unit/shop-business-config.unit.ts. The shop's build cannot import the API's files on Vercel, so it is copied.
const GSTIN_SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z][A-Z0-9][0-9A-Z]$/
const GST_STATE = /^(0[1-9]|[12]\d|3[0-8]|97|99)$/
const B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
export const gstinCheckChar = (first14) => {
  let sum = 0
  for (let i = 0; i < 14; i++) { const p = B36.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2); sum += Math.floor(p / 36) + (p % 36) }
  return B36[(36 - (sum % 36)) % 36]
}
/** The GSTIN, upper-cased without spaces, or a reason it is refused. */
export const gstinFrom = (raw) => {
  const value = String(raw ?? '').replace(/\s+/g, '').toUpperCase()
  if (!value) return { value }
  if (!GSTIN_SHAPE.test(value) || !GST_STATE.test(value.slice(0, 2)) || gstinCheckChar(value.slice(0, 14)) !== value[14]) {
    return { error: `GSTIN must be a valid 15-character GSTIN (state code, PAN, then 3 characters; the last is a check character): ${JSON.stringify(String(raw).trim())}` }
  }
  return { value }
}
/** The FSSAI licence number, 14 digits (spaces allowed and removed), or a reason it is refused. */
export const fssaiFrom = (raw) => {
  const value = String(raw ?? '').replace(/\s+/g, '')
  if (value && !/^\d{14}$/.test(value)) return { error: `FSSAI_NUMBER must be the 14-digit FSSAI licence number: ${JSON.stringify(String(raw).trim())}` }
  return { value }
}
/** Optional business details (BUSINESS_NAME, BUSINESS_ADDRESS, FSSAI_NUMBER, GSTIN) for the footer, Contact and the legal pages: written only when set. */
export const businessFrom = (envv) => {
  const name = String(envv.BUSINESS_NAME ?? '').trim(), address = String(envv.BUSINESS_ADDRESS ?? '').trim()
  if (name && !/^[^<>\r\n]{2,80}$/.test(name)) return { error: `BUSINESS_NAME must be 2 to 80 characters on one line, without < or >: ${JSON.stringify(name)}` }
  if (address && !/^[^<>\r\n]{10,200}$/.test(address)) return { error: `BUSINESS_ADDRESS must be one line of 10 to 200 characters (commas allowed), without < or >: ${JSON.stringify(address)}` }
  const fssai = fssaiFrom(envv.FSSAI_NUMBER)
  if (fssai.error) return fssai
  const gstin = gstinFrom(envv.GSTIN)
  if (gstin.error) return gstin
  return { value: { ...(name ? { businessName: name } : {}), ...(address ? { businessAddress: address } : {}), ...(fssai.value ? { fssaiNumber: fssai.value } : {}), ...(gstin.value ? { gstin: gstin.value } : {}) } }
}

/** What a customer would look for and the shop cannot show (one warning each on a production build; never a failure). */
const SHOWN = { SUPPORT_WHATSAPP: 'no WhatsApp help link', SUPPORT_PHONE: 'no phone number', SUPPORT_EMAIL: 'no email address', BUSINESS_ADDRESS: 'no postal address', FSSAI_NUMBER: 'no FSSAI licence number', GSTIN: 'no GSTIN' }
export const missingDetails = (envv) => Object.entries(SHOWN).filter(([k]) => !String(envv[k] ?? '').trim()).map(([k, what]) => `shop build: ${k} is not set; the shop shows ${what}.`)

const JS_ESC = { '\\': '\\\\', "'": "\\'", '\n': '\\n', '\r': '\\r', '\u2028': '\\u2028', '\u2029': '\\u2029' }
/** A JavaScript string in the shop's style (single quotes), so a build with no variables leaves the committed config.js as it is. */
const jsString = (v) => `'${String(v).replace(/[\\'\n\r\u2028\u2029]/g, (c) => JS_ESC[c])}'`
export const configSource = (apiUrl, supportWhatsapp, contact = {}) =>
  `window.MM_CONFIG = { apiUrl: ${jsString(apiUrl)}, supportWhatsapp: ${jsString(supportWhatsapp)}${Object.entries(contact).map(([k, v]) => `, ${k}: ${jsString(v)}`).join('')} };\n`

// ---- Search and share: one HTML file per public page, the sitemap and robots.txt (written into _routes/).

await import('./routes.js')
/** The public pages (routes.js, also loaded by the browser): { path, title, description }. '/' is index.html itself. */
export const ROUTES = globalThis.MM_ROUTES

/** The origin in index.html's canonical link: where the shop is when SHOP_URL is not set. */
export const templateOrigin = (html) => {
  const m = /<link rel="canonical" href="([^"]+)">/.exec(html)
  return m ? new URL(m[1]).origin : null
}

/** The shop's public origin (SHOP_URL, else `fallback`, index.html's), or a reason it is refused. */
export function shopUrlFrom(raw, fallback, { production: prod = false } = {}) {
  const value = String(raw ?? '').trim()
  if (!value) return fallback ? { value: fallback } : { error: 'SHOP_URL is not set and index.html has no canonical link to take the address from.' }
  let url
  try { url = new URL(value) } catch { return { error: `SHOP_URL is not a URL: ${JSON.stringify(value)}` } }
  if (value !== url.origin) return { error: `SHOP_URL must be an origin only, with no path and no trailing slash (did you mean ${url.origin}?)` }
  if (url.protocol !== 'https:' && (prod || url.protocol !== 'http:')) return { error: `SHOP_URL must be https${prod ? ' on a production build' : ''}: ${value}` }
  if (prod && /^(localhost|127\.|0\.0\.0\.0|\[::1\])|\.localhost$/.test(url.hostname)) return { error: `SHOP_URL must not point at this computer on a production build: ${value}` }
  return { value: url.origin }
}

const html = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
/** The tags each page gets its own of: [pattern in index.html, the page's tag]. Each must be in index.html exactly once. */
const PAGE_TAGS = [
  [/<title>[^<]*<\/title>/, (r) => `<title>${html(r.title)}</title>`],
  [/<meta name="description" content="[^"]*">/, (r) => `<meta name="description" content="${html(r.description)}">`],
  [/<link rel="canonical" href="[^"]*">/, (r, origin) => `<link rel="canonical" href="${html(origin + r.path)}">`],
  [/<meta property="og:title" content="[^"]*">/, (r) => `<meta property="og:title" content="${html(r.title)}">`],
  [/<meta property="og:description" content="[^"]*">/, (r) => `<meta property="og:description" content="${html(r.description)}">`],
  [/<meta property="og:url" content="[^"]*">/, (r, origin) => `<meta property="og:url" content="${html(origin + r.path)}">`],
]
/** index.html as `route`'s page at `origin`: its own title, description, canonical and share card; index.html's origin
 *  (og:image too) becomes `origin`. The home page at index.html's own origin is index.html unchanged. */
export function renderRoute(template, route, origin) {
  let out = template
  for (const [re, tag] of PAGE_TAGS) {
    const n = (template.match(new RegExp(re.source, 'g')) || []).length
    if (n !== 1) throw new Error(`index.html must have exactly one ${re.source.replace(/\\/g, '').slice(0, 40)}… (found ${n})`)
    out = out.replace(re, () => tag(route, origin))
  }
  const from = templateOrigin(template)
  return from && from !== origin ? out.split(`${from}/`).join(`${origin}/`) : out
}

/** The file a page is written to in _routes/ ('/bulk' → bulk.html). */
export const routeFile = (p) => `${p === '/' ? 'index' : p.slice(1).replace(/\//g, '-')}.html`

export const sitemapXml = (routes, origin) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${routes.map((r) => `  <url><loc>${html(origin + r.path)}</loc></url>\n`).join('')}</urlset>\n`

/** Signed-in, one-person and step-by-step pages: not for search results. (The public pages are in routes.js.) */
export const PRIVATE_PATHS = ['/account', '/orders', '/order/', '/checkout', '/cart', '/login', '/preorders/', '/bulk/orders/', '/gifts/', '/help/requests/', '/farm-bookings', '/farm-experience/book', '/invite/', '/v1/', '/_routes/']
export const robotsTxt = (origin) =>
  `# Written by the shop's build (build-config.mjs).\nUser-agent: *\nAllow: /\n${PRIVATE_PATHS.map((p) => `Disallow: ${p}\n`).join('')}\nSitemap: ${origin}/sitemap.xml\n`

/** Writes `outDir` afresh: one page per route but '/', sitemap.xml and robots.txt. Returns the files written and the
 *  home page as it should be (index.html itself, unless the origin moved). */
export function writeRoutes(outDir, { template, origin, routes = ROUTES }) {
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  const files = []
  const put = (name, text) => { writeFileSync(path.join(outDir, name), text); files.push(name) }
  for (const r of routes) if (r.path !== '/') put(routeFile(r.path), renderRoute(template, r, origin))
  put('sitemap.xml', sitemapXml(routes, origin))
  put('robots.txt', robotsTxt(origin))
  return { files, home: renderRoute(template, routes.find((r) => r.path === '/'), origin) }
}

async function main() {
  const api = apiUrlFrom(process.env.API_URL, { production })
  if (api.error) fail(api.error)
  const wa = whatsappFrom(process.env.SUPPORT_WHATSAPP)
  if (wa.error) fail(wa.error)
  const contact = contactFrom(process.env)
  if (contact.error) fail(contact.error)
  const mapsKey = mapsKeyFrom(process.env.GOOGLE_MAPS_KEY)
  if (mapsKey.error) fail(mapsKey.error)
  if (mapsKey.value) contact.value.googleMapsKey = mapsKey.value
  const business = businessFrom(process.env)
  if (business.error) fail(business.error)
  Object.assign(contact.value, business.value)
  if (production) for (const line of missingDetails(process.env)) console.warn(line)
  const indexFile = path.join(shopDir, 'index.html'), template = readFileSync(indexFile, 'utf8')
  const shop = shopUrlFrom(process.env.SHOP_URL, templateOrigin(template), { production })
  if (shop.error) fail(shop.error)

  // Through the shop's own address: config.js gets an empty apiUrl (api.js then calls this
  // origin) and vercel.json must forward /v1 to the same API that API_URL names.
  const viaShop = (process.env.API_VIA_SHOP ?? '').trim() === 'true'
  if (viaShop) {
    const forwarded = forwardedApi(JSON.parse(readFileSync(path.join(shopDir, 'vercel.json'), 'utf8')))
    if (forwarded !== api.value) fail(`API_VIA_SHOP is on, but vercel.json forwards /v1 to ${forwarded ?? 'nothing'} and API_URL is ${api.value}. Make them the same.`)
  }

  const file = path.join(shopDir, 'config.js')
  writeFileSync(file, configSource(viaShop ? '' : api.value, wa.value, contact.value))
  console.log(`shop build: wrote config.js (apiUrl ${viaShop ? `this site, forwarded to ${api.value}` : api.value}${wa.value ? `, WhatsApp ${wa.value}` : ''}, maps: ${mapsKey.value ? 'Google' : 'OpenStreetMap'})`)

  // The pages for crawlers and link previews. A new SHOP_URL moves the home page's own tags too.
  const pages = writeRoutes(path.join(shopDir, '_routes'), { template, origin: shop.value })
  const moved = pages.home !== template
  if (moved) writeFileSync(indexFile, pages.home)
  console.log(`shop build: wrote _routes/ (${pages.files.length} files) for ${shop.value}${moved ? ', and index.html for that address' : ''}`)

  // The same scan as the panel and the old shop: secrets, dev-only routes, demo accounts, source maps
  // and, on a production build, a localhost address. It lives in the repo's scripts/ folder,
  // which Vercel includes in the build (the project's root directory is shop/).
  let scan
  try {
    scan = await import(pathToFileURL(path.join(shopDir, '..', 'scripts', 'scan-bundle.mjs')).href)
  } catch (err) {
    if (process.env.VERCEL) fail(`could not load scripts/scan-bundle.mjs (${err.message}); keep "Include files outside the root directory" on in Vercel.`)
    console.warn(`shop build: bundle scan skipped (${err.message})`)
    return
  }
  const code = scan.main([shopDir, '--forbid-localhost-in-production'])
  if (code !== 0) process.exit(code)
}

const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) await main()
