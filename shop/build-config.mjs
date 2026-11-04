#!/usr/bin/env node
// Writes shop/config.js from the environment, then scans the folder like every other
// browser build (scripts/scan-bundle.mjs). Vercel runs it as the build command
// (shop/vercel.json); `npm run shop:build` runs it from the repo root. Paths come from
// this file's location, so the working directory does not matter.
//
//   API_URL           mango-api's origin, e.g. https://api.mandimangoes.in (no path, no
//                     trailing slash). Required on a Vercel production build, where it must
//                     be https and not this computer. Elsewhere it defaults to the local API.
//   SUPPORT_WHATSAPP  the help WhatsApp number, digits only (e.g. 919800000000). Optional.
//
// config.js is committed with the local default so the folder runs as is; this build
// overwrites it. Run `npm run shop:build` with no variables to put the default back.
//
// This folder is served as it is, this file included, so it must not spell out a
// localhost address either: the scan below would refuse it on a production build.
import { writeFileSync } from 'node:fs'
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

export const configSource = (apiUrl, supportWhatsapp) =>
  `window.MM_CONFIG = { apiUrl: ${JSON.stringify(apiUrl)}, supportWhatsapp: ${JSON.stringify(supportWhatsapp)} };\n`

async function main() {
  const api = apiUrlFrom(process.env.API_URL, { production })
  if (api.error) fail(api.error)
  const wa = whatsappFrom(process.env.SUPPORT_WHATSAPP)
  if (wa.error) fail(wa.error)
  if (production && !wa.value) console.warn('shop build: SUPPORT_WHATSAPP is not set; the shop shows no WhatsApp help link.')

  const file = path.join(shopDir, 'config.js')
  writeFileSync(file, configSource(api.value, wa.value))
  console.log(`shop build: wrote config.js (apiUrl ${api.value}${wa.value ? `, WhatsApp ${wa.value}` : ''})`)

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
