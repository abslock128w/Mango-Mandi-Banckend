import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

// Search and share (shop/build-config.mjs, shop/routes.js, shop/vercel.json, shop/404.html): the build writes one HTML
// file per public page with its own title, description, canonical and Open Graph tags; vercel.json serves those, sends
// every page the shop's router knows (the PAGES table) to an HTML file, and has no catch-all, so an unknown address
// gets the real 404 page; the sitemap lists every public page.

type Route = { path: string; title: string; description: string }
type Result<T> = { value?: T; error?: string }
const build = (await import(new URL('../../shop/build-config.mjs', import.meta.url).href)) as {
  ROUTES: Route[]
  PRIVATE_PATHS: string[]
  templateOrigin: (html: string) => string | null
  shopUrlFrom: (raw: unknown, fallback: string | null, o?: { production?: boolean }) => Result<string>
  renderRoute: (template: string, route: Route, origin: string) => string
  routeFile: (p: string) => string
  writeRoutes: (outDir: string, o: { template: string; origin: string; routes?: Route[] }) => { files: string[]; home: string }
  configSource: (apiUrl: string, wa: string, contact?: Record<string, string>) => string
}
const shop = (f: string) => path.join(path.dirname(new URL(import.meta.url).pathname), '../../shop', f)
const read = (f: string) => readFileSync(shop(f), 'utf8')
const template = read('index.html')
const ORIGIN = build.templateOrigin(template)!
const attr = (html: string, re: RegExp) => [...html.matchAll(new RegExp(re.source, 'g'))].map((m) => m[1])

test('the build writes one page per route with its own title, description, canonical and share card', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'shop-routes-'))
  try {
    const out = build.writeRoutes(dir, { template, origin: ORIGIN })
    const pages = build.ROUTES.filter((r) => r.path !== '/')
    assert.deepEqual(readdirSync(dir).sort(), [...pages.map((r) => build.routeFile(r.path)), 'robots.txt', 'sitemap.xml'].sort())
    assert.deepEqual(out.files.sort(), readdirSync(dir).sort())
    for (const r of pages) {
      const html = readFileSync(path.join(dir, build.routeFile(r.path)), 'utf8')
      assert.deepEqual(attr(html, /<title>([^<]*)<\/title>/), [r.title], r.path)
      assert.deepEqual(attr(html, /<meta name="description" content="([^"]*)">/), [r.description], r.path)
      assert.deepEqual(attr(html, /<link rel="canonical" href="([^"]*)">/), [ORIGIN + r.path], r.path)
      assert.deepEqual(attr(html, /<meta property="og:url" content="([^"]*)">/), [ORIGIN + r.path], r.path)
      assert.deepEqual(attr(html, /<meta property="og:title" content="([^"]*)">/), [r.title], r.path)
      assert.deepEqual(attr(html, /<meta property="og:description" content="([^"]*)">/), [r.description], r.path)
      // Everything else is index.html's: the same scripts, the same body.
      assert.equal(html.slice(html.indexOf('<body>')), template.slice(template.indexOf('<body>')), r.path)
    }
    // The home page is index.html itself: at its own origin the build changes nothing in it.
    assert.equal(out.home, template)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('SHOP_URL moves every address, the home page and og:image included', () => {
  const to = 'https://mandimangoes.in'
  const home = build.renderRoute(template, build.ROUTES.find((r) => r.path === '/')!, to)
  assert.ok(!home.includes(ORIGIN), 'the old origin is gone')
  assert.deepEqual(attr(home, /<link rel="canonical" href="([^"]*)">/), [`${to}/`])
  assert.deepEqual(attr(home, /<meta property="og:image" content="([^"]*)">/), [`${to}/assets/og-home.jpg`])
  assert.deepEqual(build.shopUrlFrom('', ORIGIN), { value: ORIGIN })
  assert.deepEqual(build.shopUrlFrom(` ${to} `, ORIGIN, { production: true }), { value: to })
  for (const bad of [`${to}/`, `${to}/shop`, 'http://mandimangoes.in', 'https://localhost:5174', 'not a url']) {
    assert.ok(build.shopUrlFrom(bad, ORIGIN, { production: true }).error, bad)
  }
  assert.deepEqual(build.shopUrlFrom('http://localhost:5174', ORIGIN), { value: 'http://localhost:5174' })
})

test("each page's title is the one its view sets with document.title", () => {
  const js = readdirSync(shop('.')).filter((f) => f.endsWith('.js') && f !== 'routes.js' && f !== 'seo.js').map(read).join('\n')
  for (const r of build.ROUTES) {
    if (r.path === '/') { assert.deepEqual(attr(template, /<title>([^<]*)<\/title>/), [r.title]); continue }
    const stem = r.title.replace(/ · VMR Mangoes$/, '')
    assert.ok(js.includes(`'${r.title}'`) || js.includes(`'${stem}'`), `${r.path}: no view sets "${r.title}"`)
  }
})

// Path-to-regexp as Vercel compiles a rewrite source (strict, case-sensitive), for the forms vercel.json uses:
// literal text, /:name, /:name(a|b), /:name* and a trailing {/}?. Anything else fails here, so a new form is checked
// by hand against Vercel's own compiler first.
function sourceRe(source: string): RegExp {
  let re = '', i = 0
  while (i < source.length) {
    if (source.startsWith('{/}?', i)) { re += '(?:/)?'; i += 4; continue }
    const m = /^\/:(\w+)(?:\(([^)]*)\))?(\*)?/.exec(source.slice(i))
    if (m) {
      const p = m[2] ?? '[^/]+?'
      re += m[3] ? `(?:/(${p}(?:/${p})*))?` : `(?:/(${p}))`
      i += m[0].length
      continue
    }
    assert.match(source[i], /[\w./-]/, `vercel.json source ${source}: unexpected ${source[i]}`)
    re += source[i] === '.' ? '\\.' : source[i]
    i++
  }
  return new RegExp(`^${re}$`)
}
const vercel = JSON.parse(read('vercel.json')) as { rewrites: { source: string; destination: string }[] }
const rewrites = vercel.rewrites.map((r) => ({ ...r, re: sourceRe(r.source) }))
const rewriteOf = (p: string) => rewrites.find((r) => r.re.test(p))

// Every pattern in the shop's router (PAGES in pages.js, help.js, help-requests.js, farm.js, bulk.js, legacy.js,
// gifts.js, partner.js), with addresses it accepts. A new PAGES entry fails the first assertion until it is added here
// and vercel.json serves it.
const PAGES_SAMPLES: Record<string, string[]> = {
  '^\\/cart\\/?$': ['/cart'],
  '^\\/checkout\\/?$': ['/checkout'],
  '^\\/orders\\/?$': ['/orders'],
  '^\\/orders?\\/([^/]+)\\/?$': ['/orders/ord_1', '/order/ord_1'],
  '^\\/account\\/?$': ['/account'],
  '^\\/login\\/?$': ['/login'],
  '^\\/bulk(?:\\/(enquiry|farm-visit))?\\/?$': ['/bulk', '/bulk/enquiry', '/bulk/farm-visit'],
  '^\\/(privacy|terms|refund|shipping)\\/?$': ['/privacy', '/terms', '/refund', '/shipping'],
  '^\\/contact\\/?$': ['/contact'],
  '^\\/help\\/?$': ['/help'],
  '^\\/help\\/requests\\/([^/]+)\\/?$': ['/help/requests/hr_1'],
  '^\\/farm-experience\\/?$': ['/farm-experience'],
  '^\\/farm-experience\\/book\\/?$': ['/farm-experience/book'],
  '^\\/farm-bookings\\/?$': ['/farm-bookings'],
  '^\\/farm-bookings\\/([^/]+)\\/?$': ['/farm-bookings/fb_1'],
  '^\\/bulk\\/orders\\/([^/]+)\\/?$': ['/bulk/orders/bo_1'],
  '^\\/legacy(?:\\/(story|film))?\\/?$': ['/legacy', '/legacy/film'],
  '^\\/gifts\\/?$': ['/gifts'],
  '^\\/gifts\\/send\\/?$': ['/gifts/send'],
  '^\\/gifts\\/send\\/review\\/?$': ['/gifts/send/review'],
  '^\\/gifts\\/done\\/?$': ['/gifts/done'],
  '^\\/gifts\\/([^/]+)\\/?$': ['/gifts/go_1'],
  '^\\/partner\\/?$': ['/partner'],
  '^\\/partner\\/apply\\/?$': ['/partner/apply'],
  '^\\/partner\\/privacy\\/?$': ['/partner/privacy'],
}
// Deep links outside PAGES: app.js opens /preorders/:id itself, and the API's messages link to these (mango-api shopUrl()).
const OTHER_LINKS = ['/preorders/pre_1', '/invite/abc123', '/account/subscriptions/sub_1']

test('vercel.json serves every address the router knows, and nothing else (no catch-all)', () => {
  const found = new Set<string>()
  for (const f of readdirSync(shop('.')).filter((x) => x.endsWith('.js'))) {
    const src = read(f)
    if (!src.includes('PAGES')) continue
    for (const m of src.matchAll(/\[\/(\^\\\/.*?\$)\/, *\(/g)) found.add(m[1])
  }
  assert.deepEqual([...found].sort(), Object.keys(PAGES_SAMPLES).sort(), 'the PAGES patterns and this test list differ')
  const generated = new Set(build.ROUTES.map((r) => `/_routes/${build.routeFile(r.path)}`))
  for (const [pattern, samples] of Object.entries(PAGES_SAMPLES)) {
    for (const p of samples) {
      assert.ok(new RegExp(pattern).test(p), `${p} is not a sample of ${pattern}`)
      for (const at of [p, `${p}/`]) {
        const hit = rewriteOf(at)
        assert.ok(hit, `${at} (PAGES ${pattern}) has no rewrite`)
        assert.ok(hit.destination === '/index.html' || generated.has(hit.destination), `${at} goes to ${hit.destination}`)
      }
    }
  }
  for (const p of OTHER_LINKS) assert.equal(rewriteOf(p)?.destination, '/index.html', p)
  // A public page gets its own HTML, not the home page's.
  for (const r of build.ROUTES.filter((x) => x.path !== '/')) assert.equal(rewriteOf(r.path)?.destination, `/_routes/${build.routeFile(r.path)}`, r.path)
  // Unknown addresses are left to Vercel's 404 (404.html).
  for (const p of ['/nope', '/nope/deeper', '/bulk/nope', '/help/nope', '/partner/nope', '/legacy/nope', '/gifts/a/b']) assert.equal(rewriteOf(p), undefined, p)
  assert.ok(!vercel.rewrites.some((r) => r.source.includes('[^.]') || r.source === '/(.*)' || r.source === '/:path*'), 'no catch-all rewrite')
})

test('404.html is the not-found page: noindex, links home and to help, no inline script', () => {
  assert.ok(existsSync(shop('404.html')))
  const html = read('404.html')
  assert.match(html, /<meta name="robots" content="noindex">/)
  assert.match(html, /<title>Page not found · VMR Mangoes<\/title>/)
  assert.match(html, /href="\/"/)
  assert.match(html, /href="\/help"/)
  for (const s of html.match(/<script\b[^>]*>/g) ?? []) assert.match(s, /\ssrc="\//, `inline script: ${s}`)
  // It is served at any depth: every file it loads is an absolute path on this site.
  for (const [, ref] of html.matchAll(/(?:src|href)="([^"]*)"/g)) assert.match(ref, /^\/(?!\/)/, ref)
})

test('the sitemap lists every public page, and robots.txt points at it and keeps private pages out', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'shop-routes-'))
  try {
    build.writeRoutes(dir, { template, origin: 'https://mandimangoes.in' })
    const sitemap = readFileSync(path.join(dir, 'sitemap.xml'), 'utf8')
    assert.deepEqual(attr(sitemap, /<loc>([^<]*)<\/loc>/), build.ROUTES.map((r) => `https://mandimangoes.in${r.path}`))
    const robots = readFileSync(path.join(dir, 'robots.txt'), 'utf8')
    assert.match(robots, /^Sitemap: https:\/\/mandimangoes\.in\/sitemap\.xml$/m)
    for (const p of ['/account', '/orders', '/checkout', '/cart', '/login', '/v1/']) assert.match(robots, new RegExp(`^Disallow: ${p}$`, 'm'))
    // No public page is disallowed.
    for (const r of build.ROUTES.filter((x) => x.path !== '/')) assert.ok(!build.PRIVATE_PATHS.some((p) => r.path.startsWith(p)), r.path)
    assert.equal(rewriteOf('/robots.txt')?.destination, '/_routes/robots.txt')
    assert.equal(rewriteOf('/sitemap.xml')?.destination, '/_routes/sitemap.xml')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a build with no variables writes config.js exactly as it is committed (single quotes)', () => {
  assert.equal(build.configSource(['http:', '', 'localhost:3000'].join('/'), ''), read('config.js'))
  assert.equal(build.configSource("it's", 'a\\b'), "window.MM_CONFIG = { apiUrl: 'it\\'s', supportWhatsapp: 'a\\\\b' };\n")
})
