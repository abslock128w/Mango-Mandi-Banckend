#!/usr/bin/env node
// Razorpay sandbox (test mode) evidence kit. Test keys only: refuses rzp_live_ keys.
//
//   node scripts/razorpay-sandbox.mjs sanitize <raw.json> [more.json...]
//       Masks personal data in webhook bodies copied from the Razorpay
//       dashboard (Settings → Webhooks → the webhook → event log) and writes
//       them to test/fixtures/razorpay/, where `npm test` replays them.
//   node scripts/razorpay-sandbox.mjs check <razorpay order id> [...]
//       Read-only calls to Razorpay's test API for orders placed on staging:
//       the order's payments and each payment's refunds. Prints a sanitized
//       summary to paste into the evidence log. Needs RAZORPAY_KEY_ID and
//       RAZORPAY_KEY_SECRET (test) in the environment, never on the command line.
//
// See deploy/RAZORPAY-SANDBOX.md for the full run.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(here, '..', 'test', 'fixtures', 'razorpay')

/** Keys whose values are personal or secret, wherever they appear. */
const PII = new Set(['email', 'contact', 'vpa', 'name', 'card_id', 'token_id', 'customer_id', 'bank_transfer', 'acquirer_data', 'upi', 'wallet', 'phone', 'address'])
const NOTES_KEEP = new Set(['orderId', 'preorderId', 'kind'])

export function sanitize(value, key = '') {
  if (Array.isArray(value)) return value.map((v) => sanitize(v, key))
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      if (k === 'card' && v && typeof v === 'object') out[k] = { network: v.network ?? null, type: v.type ?? null, last4: 'XXXX' }
      else if (k === 'notes' && v && typeof v === 'object') out[k] = Object.fromEntries(Object.entries(v).filter(([nk]) => NOTES_KEEP.has(nk)))
      else if (PII.has(k)) out[k] = v === null ? null : typeof v === 'object' ? '[removed]' : 'redacted'
      else out[k] = sanitize(v, k)
    }
    return out
  }
  return value
}

function testKeysOnly() {
  const id = process.env.RAZORPAY_KEY_ID ?? ''
  const secret = process.env.RAZORPAY_KEY_SECRET ?? ''
  if (!id.startsWith('rzp_test_')) throw new Error('RAZORPAY_KEY_ID must be a test key (rzp_test_...). Live keys are never used here.')
  if (!secret) throw new Error('RAZORPAY_KEY_SECRET is not set')
  return 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64')
}

async function get(auth, p) {
  const res = await fetch(`https://api.razorpay.com/v1${p}`, { headers: { Authorization: auth } })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`GET ${p} → ${res.status} ${body?.error?.code ?? ''}`)
  return body
}

async function main([cmd, ...args]) {
  if (cmd === 'sanitize') {
    await mkdir(OUT, { recursive: true })
    for (const file of args) {
      const raw = JSON.parse(await readFile(file, 'utf8'))
      if (String(raw?.account_id ?? '').includes('live') || JSON.stringify(raw).includes('rzp_live_')) throw new Error(`${file} looks like live data; refusing`)
      const clean = sanitize(raw)
      const name = `${String(clean.event ?? 'event').replaceAll('.', '-')}-${path.basename(file, '.json')}.json`
      await writeFile(path.join(OUT, name), JSON.stringify(clean, null, 2) + '\n')
      console.log(`wrote test/fixtures/razorpay/${name}`)
    }
    return
  }
  if (cmd === 'check') {
    const auth = testKeysOnly()
    for (const orderId of args) {
      const order = await get(auth, `/orders/${encodeURIComponent(orderId)}`)
      const pays = (await get(auth, `/orders/${encodeURIComponent(orderId)}/payments`)).items ?? []
      console.log(`order ${order.id}: status=${order.status} amount=${order.amount} ${order.currency} receipt=${order.receipt}`)
      for (const p of pays) {
        const refunds = (await get(auth, `/payments/${encodeURIComponent(p.id)}/refunds`)).items ?? []
        console.log(`  payment ${p.id}: status=${p.status} amount=${p.amount} method=${p.method} captured=${p.captured}`)
        for (const r of refunds) console.log(`    refund ${r.id}: status=${r.status} amount=${r.amount}`)
      }
    }
    return
  }
  console.log('usage: razorpay-sandbox.mjs sanitize <file.json...> | check <order_id...>')
  process.exitCode = 2
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err.message)
    process.exit(1)
  })
}
