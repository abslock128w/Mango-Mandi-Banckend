#!/usr/bin/env node
// Serves the static shop (shop/) on this computer, with no packages to install.
//
//   node scripts/serve-shop.mjs                       http://localhost:5174, this computer only
//   node scripts/serve-shop.mjs --port 5199           another port
//   node scripts/serve-shop.mjs --host 0.0.0.0        also on this Wi-Fi
//   node scripts/serve-shop.mjs --api http://localhost:3000
//                                                     shared mode (start-local --phone/--wifi): /v1 is
//                                                     passed to the API (never /v1/dev) and /config.js
//                                                     says apiUrl '' (this same origin), so a phone
//                                                     needs only this one port
//
// Like the Vercel rewrites (shop/vercel.json), a path with no file extension
// (/preorders/pre_x, /account/orders) gets index.html, which reads location.pathname.
import { createReadStream, statSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const shopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'shop')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

/** Request headers that belong to one connection and are not passed on to the API. */
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authorization', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade'])

function option(argv, name, fallback) {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}

const BASE_HEADERS = { 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' }

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { ...BASE_HEADERS, 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) })
  res.end(res.req.method === 'HEAD' ? undefined : body)
}

/** A file inside shop/ for this path, or null (outside the folder, missing, a dotfile or a folder). */
function fileFor(pathname) {
  const file = path.resolve(shopDir, `.${pathname}`)
  if (file !== shopDir && !file.startsWith(shopDir + path.sep)) return null
  if (path.relative(shopDir, file).split(path.sep).some((part) => part.startsWith('.'))) return null
  try {
    return statSync(file).isFile() ? file : null
  } catch {
    return null
  }
}

function serveFile(req, res, file) {
  const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
  const { size } = statSync(file)
  res.writeHead(200, { ...BASE_HEADERS, 'Content-Type': type, 'Content-Length': size })
  if (req.method === 'HEAD') return res.end()
  createReadStream(file).on('error', () => res.destroy()).pipe(res)
}

/** Passes one /v1 request to the API: same method, headers (cookies, tokens, Idempotency-Key) and body. */
function proxy(req, res, api, pathname, search) {
  const target = new URL(`${pathname}${search}`, api)
  const headers = {}
  for (const [name, value] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(name) && name !== 'host') headers[name] = value
  }
  headers.host = target.host
  // A same-origin call from the shop page needs no cross-site check; the API only knows the
  // shop's localhost and Wi-Fi origins, not the temporary public link's.
  if (headers.origin) {
    try {
      if (new URL(headers.origin).host === req.headers.host) delete headers.origin
    } catch {}
  }
  const upstream = http.request(target, { method: req.method, headers }, (answer) => {
    const out = { ...answer.headers }
    for (const name of HOP_BY_HOP) delete out[name]
    res.writeHead(answer.statusCode ?? 502, out)
    answer.pipe(res)
  })
  upstream.on('error', (err) => {
    if (res.headersSent) return res.destroy()
    send(res, 502, JSON.stringify({ error: { code: 'API_UNREACHABLE', message: `The API at ${api} did not answer (${err.code ?? err.message}).` } }), 'application/json; charset=utf-8')
  })
  req.pipe(upstream)
}

export function createShopServer({ api = null } = {}) {
  return http.createServer((req, res) => {
    let url
    let pathname
    try {
      url = new URL(req.url ?? '/', 'http://shop.invalid')
      pathname = decodeURIComponent(url.pathname)
    } catch {
      return send(res, 400, 'Bad request\n')
    }
    if (pathname.includes('\0')) return send(res, 400, 'Bad request\n')
    pathname = path.posix.normalize(pathname)

    if (pathname === '/v1' || pathname.startsWith('/v1/')) {
      // /v1/dev* (test-mode pay and friends) is never reachable through a shared shop. Express
      // routes ignore case, so compare in lower case.
      if (!api || pathname.toLowerCase().startsWith('/v1/dev')) return send(res, 404, 'Not found\n')
      return proxy(req, res, api, url.pathname, url.search)
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed\n')

    if (api && pathname === '/config.js') {
      // Shared: the shop calls its own address, and this server passes /v1 on.
      return send(res, 200, "window.MM_CONFIG = { apiUrl: '', supportWhatsapp: '' };\n", TYPES['.js'])
    }
    if (!path.posix.extname(pathname)) {
      const index = fileFor('/index.html')
      return index ? serveFile(req, res, index) : send(res, 404, 'shop/index.html is missing\n')
    }
    const file = fileFor(pathname)
    return file ? serveFile(req, res, file) : send(res, 404, 'Not found\n')
  })
}

function main(argv = process.argv.slice(2)) {
  const port = Number(option(argv, '--port', '5174'))
  const host = option(argv, '--host', '127.0.0.1')
  const api = option(argv, '--api', null)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`--port must be a port number, not ${option(argv, '--port')}`)
  if (api && !/^https?:\/\/[^/]+$/.test(api)) throw new Error(`--api must be an origin like http://localhost:3000, not ${api}`)
  const server = createShopServer({ api })
  server.on('error', (err) => {
    console.error(`The shop could not start on ${host}:${port}: ${err.message}`)
    process.exit(1)
  })
  server.listen(port, host, () => {
    const shown = host === '0.0.0.0' ? 'localhost' : host
    console.log(`Shop: http://${shown}:${port}  (shop/${api ? `, /v1 passed to ${api}` : ''})`)
  })
}

const isMain = Boolean(process.argv[1]) && path.resolve(fileURLToPath(import.meta.url)).toLowerCase() === path.resolve(process.argv[1]).toLowerCase()
if (isMain) {
  try {
    main()
  } catch (err) {
    console.error(err.message)
    process.exit(2)
  }
}
