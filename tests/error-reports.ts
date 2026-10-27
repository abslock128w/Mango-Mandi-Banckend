// Helpers for the error report specs (tests/error-reports.spec.ts for the panel,
// customer-app/tests/error-reports.spec.ts for the shop). Each builds its app for
// production with a made-up DSN, serves the build from a temporary folder, and
// answers the SDK's requests itself: nothing is ever sent to Sentry.
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Page } from '@playwright/test'

export const REPO = path.resolve(__dirname, '..')
/** A DSN of the right shape for a project that does not exist. */
export const FAKE_DSN = 'https://public@o0.ingest.sentry.io/0'
const ENVELOPE_URL = 'https://o0.ingest.sentry.io/api/0/envelope/'
/** Every Sentry host: the envelope endpoint is answered here, anything else is refused. */
const SENTRY_HOSTS = /^https?:\/\/([\w-]+\.)*(sentry\.io|sentry-cdn\.com)(:\d+)?\//

/**
 * A production build of one app into a new temporary folder, with the fake DSN and
 * the given settings. Real Sentry settings from the environment are cleared, so the
 * build never uploads anything. Returns the folder.
 */
export async function buildWithDsn(config: string, env: Record<string, string>): Promise<string> {
  const outDir = mkdtempSync(path.join(tmpdir(), 'mango-error-reports-'))
  await promisify(execFile)(process.execPath, [path.join(REPO, 'node_modules/vite/bin/vite.js'), 'build', '--config', config, '--outDir', outDir, '--emptyOutDir', '--logLevel', 'warn'], {
    cwd: REPO,
    env: { ...process.env, SENTRY_AUTH_TOKEN: '', SENTRY_ORG: '', SENTRY_PROJECT: '', VITE_SENTRY_DSN: FAKE_DSN, ...env },
    timeout: 180_000,
  })
  return outDir
}

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.woff2': 'font/woff2' }

/** Serves a built app like the static hosting does: files as they are, index.html for every other path. */
export async function serve(dir: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    const file = path.join(dir, decodeURIComponent((req.url ?? '/').split('?')[0]))
    const found = file.startsWith(dir) && statSync(file, { throwIfNoEntry: false })?.isFile()
    const send = found ? file : path.join(dir, 'index.html')
    res.setHeader('Content-Type', TYPES[path.extname(send)] ?? 'application/octet-stream')
    res.end(readFileSync(send))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      }),
  }
}

export const removeBuild = (dir: string | undefined) => dir && rmSync(dir, { recursive: true, force: true })

/** The JS files the build's index.html loads at once (the first download). */
export function firstLoadFiles(dir: string): string[] {
  const html = readFileSync(path.join(dir, 'index.html'), 'utf8')
  return [...html.matchAll(/<script[^>]*src="([^"]+)"|<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g)].map((m) => m[1] ?? m[2])
}

/** Stands in for Sentry: records each envelope the page sends and refuses every other Sentry request. */
export async function fakeSentry(page: Page): Promise<string[]> {
  const envelopes: string[] = []
  await page.route(SENTRY_HOSTS, (route) => {
    const req = route.request()
    if (req.method() !== 'POST' || !req.url().startsWith(ENVELOPE_URL)) return route.abort()
    envelopes.push(req.postData() ?? '')
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{}' })
  })
  return envelopes
}

export interface SentEvent {
  tags?: Record<string, string>
  environment?: string
  release?: string
  request?: { url?: string; headers?: Record<string, string> }
  exception?: { values?: { type?: string; value?: string; mechanism?: { type?: string; handled?: boolean } }[] }
  contexts?: Record<string, Record<string, unknown>>
  breadcrumbs?: { category?: string; level?: string; message?: string; data?: Record<string, unknown> }[]
  user?: unknown
}

/** The error events in one envelope (newline-separated JSON: a header, then item headers and items). */
export function eventsIn(envelope: string): SentEvent[] {
  const lines = envelope.split('\n').filter(Boolean)
  const events: SentEvent[] = []
  for (let i = 1; i + 1 < lines.length; i += 2) {
    if ((JSON.parse(lines[i]) as { type?: string }).type === 'event') events.push(JSON.parse(lines[i + 1]) as SentEvent)
  }
  return events
}

/** Waits until the SDK has loaded and started (it then owns window.onerror; the apps never set it). */
export const sdkStarted = (page: Page) => page.waitForFunction(() => typeof window.onerror === 'function', null, { timeout: 15_000 })

/** Throws from the page, outside React, the way a bug in a click handler or a timer would. */
export const throwInPage = (page: Page, message: string) =>
  page.evaluate((m) => {
    setTimeout(() => {
      throw new Error(m)
    })
  }, message)
