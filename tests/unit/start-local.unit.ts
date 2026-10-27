import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// SEC-01: the one-command local run (scripts/start-local.mjs) keeps the shop on
// this computer unless asked, and when it is shared (--phone, --wifi) the API's
// test stand-ins are off: no login codes in answers, /v1/dev not proxied.

interface Plan {
  link: boolean
  shared: boolean
  wifi: string[]
  api: Record<string, string>
  shopEnv: Record<string, string>
  shopCmd: string
}
const { localPlan, installNeeded, markInstalled } = (await import(new URL('../../scripts/start-local.mjs', import.meta.url).href)) as {
  localPlan: (argv: string[], wifi?: string[]) => Plan
  installNeeded: (dir: string) => boolean
  markInstalled: (dir: string) => void
}

test('by default nothing leaves this computer: no link, no Wi-Fi, codes on screen', () => {
  const p = localPlan(['node', 'start-local.mjs'], ['192.168.1.20'])
  assert.equal(p.link, false)
  assert.equal(p.shared, false)
  assert.deepEqual(p.wifi, [])
  assert.equal(p.shopEnv.SHOP_API_PROXY, undefined)
  assert.equal(p.shopEnv.VITE_API_URL, 'http://localhost:3000')
  assert.doesNotMatch(p.shopCmd, /--host/)
  assert.equal(p.api.CUSTOMER_ORIGIN, 'http://localhost:5174')
  assert.equal(p.api.OTP_CODE_IN_RESPONSE, undefined)
  assert.equal(p.api.WAREHOUSE_V2, 'true')
  for (const flag of ['WAREHOUSE_STOCKTAKE', 'WAREHOUSE_REPACK', 'WAREHOUSE_CAMERA_SCAN', 'LIVE_TRACKING', 'FAVOURITES', 'SHOP_SORT_FILTER', 'SHOW_ERROR_DETAILS', 'REFERRALS', 'FUNNEL_ANALYTICS', 'MANAGER_DAILY_SUMMARY', 'STOCK_FORECAST', 'PURCHASE_RECORDS', 'PANEL_FEATURE_SWITCHES', 'MULTI_GIFT', 'HELP_CENTRE', 'SUBSCRIPTIONS', 'SHOP_LANGUAGES']) {
    assert.equal(p.api[flag], 'true', flag)
  }
  assert.match(p.api.SUBSCRIPTION_SEASON_END, /^\d{4}-\d{2}-\d{2}$/)
})

test('--no-phone (the old way to keep it local) still means local', () => {
  assert.equal(localPlan(['node', 'start-local.mjs', '--no-phone'], ['192.168.1.20']).shared, false)
})

test('--phone shares the shop, and the API keeps codes out of its answers', () => {
  const p = localPlan(['node', 'start-local.mjs', '--phone'], ['192.168.1.20'])
  assert.equal(p.link, true)
  assert.equal(p.shared, true)
  assert.deepEqual(p.wifi, ['192.168.1.20'])
  assert.equal(p.api.OTP_CODE_IN_RESPONSE, 'false')
  assert.equal(p.api.LOG_OTP_CODES, 'true')
  assert.equal(p.api.CUSTOMER_ORIGIN, 'http://localhost:5174,http://192.168.1.20:5174')
  assert.equal(p.shopEnv.SHOP_API_PROXY, 'http://localhost:3000')
  assert.equal(p.shopEnv.VITE_API_URL, '')
  assert.match(p.shopCmd, /--host 0\.0\.0\.0/)
})

test('--wifi shares on the Wi-Fi only, with the same protections', () => {
  const p = localPlan(['node', 'start-local.mjs', '--wifi'], ['10.0.0.5'])
  assert.equal(p.link, false)
  assert.equal(p.shared, true)
  assert.equal(p.api.OTP_CODE_IN_RESPONSE, 'false')
  assert.equal(p.shopEnv.SHOP_API_PROXY, 'http://localhost:3000')
})

test('packages are installed again when the downloaded code has a different package-lock.json', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mm-install-'))
  try {
    writeFileSync(path.join(dir, 'package-lock.json'), '{"lockfileVersion":3,"packages":{"node_modules/zod":{"version":"3.25.76"}}}')
    assert.equal(installNeeded(dir), true, 'no node_modules yet')
    mkdirSync(path.join(dir, 'node_modules'))
    assert.equal(installNeeded(dir), true, 'node_modules from an older launcher, never marked')
    markInstalled(dir)
    assert.equal(installNeeded(dir), false, 'same lockfile: no reinstall')
    writeFileSync(path.join(dir, 'package-lock.json'), '{"lockfileVersion":3,"packages":{"node_modules/zod":{"version":"4.6.7"}}}')
    assert.equal(installNeeded(dir), true, 'updated lockfile: reinstall')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
