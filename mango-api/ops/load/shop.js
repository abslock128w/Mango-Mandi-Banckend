// k6 load test for the shop API. Two scenarios:
//   browse:   customers checking a pincode and the catalogue (safe on staging).
//   checkout: sign in, add a box, quote and confirm, many at once. Needs a
//             server that returns login codes (NODE_ENV=development, e.g.
//             `npm run dev` against a copy of the staging data), so run it
//             locally or on a scratch server, never on production.
//
//   k6 run -e API=https://api-staging.example.com ops/load/shop.js
//   k6 run -e API=http://localhost:3000 -e CHECKOUT=1 ops/load/shop.js
//
// Pass marks: 95% of requests under 800 ms, under 1% errors, no 500s. A 409
// (sold out, slot full) or 503 BUSY under the checkout spike is expected
// behaviour, not a failure; a 500 or a timeout is.
import http from 'k6/http'
import { check, sleep } from 'k6'
import { Counter } from 'k6/metrics'

const API = __ENV.API || 'http://localhost:3000'
const PIN = __ENV.PINCODE || '560034'
const serverErrors = new Counter('server_errors')

export const options = {
  scenarios: {
    browse: { executor: 'ramping-vus', exec: 'browse', stages: [{ duration: '1m', target: 100 }, { duration: '3m', target: 100 }, { duration: '30s', target: 0 }] },
    ...(__ENV.CHECKOUT
      ? { checkout: { executor: 'per-vu-iterations', exec: 'checkout', vus: 50, iterations: 1, startTime: '30s', maxDuration: '2m' } }
      : {}),
  },
  thresholds: {
    http_req_duration: ['p(95)<800'],
    http_req_failed: ['rate<0.01'],
    server_errors: ['count==0'],
  },
}

const json = { headers: { 'Content-Type': 'application/json' } }
const note = (r) => {
  if (r.status >= 500 && r.status !== 503) serverErrors.add(1)
  return r
}

export function browse() {
  const d = note(http.get(`${API}/v1/delivery/check?pincode=${PIN}`))
  check(d, { 'delivery check ok': (r) => r.status === 200 })
  const c = note(http.get(`${API}/v1/catalogue?pincode=${PIN}`))
  check(c, { 'catalogue ok': (r) => r.status === 200 })
  sleep(1 + Math.random() * 2)
}

export function checkout() {
  const phone = `9${String(100000000 + __VU * 1000 + Math.floor(Math.random() * 1000)).slice(-9)}`
  const req = note(http.post(`${API}/v1/auth/otp/request`, JSON.stringify({ phone }), json))
  if (!check(req, { 'code sent': (r) => r.status === 200 && r.json('devCode') })) return
  const v = note(http.post(`${API}/v1/auth/otp/verify`, JSON.stringify({ phone, code: req.json('devCode') }), json))
  if (!check(v, { 'signed in': (r) => r.status === 200 })) return
  const auth = { headers: { ...json.headers, Authorization: `Bearer ${v.json('accessToken')}` } }
  const cat = note(http.get(`${API}/v1/catalogue?pincode=${PIN}`))
  const item = (cat.json('items') || []).find((i) => i.qty > 0)
  if (!item) return
  note(http.post(`${API}/v1/cart/items`, JSON.stringify({ sku: item.sku, stage: item.stage, qty: 1 }), auth))
  const slots = note(http.get(`${API}/v1/delivery/slots?pincode=${PIN}`)).json('slots') || []
  // The first slot with room, as a customer would pick (slots[0] fills after 40 boxes).
  const slot = slots.find((s) => s.available) ?? slots[0]
  const q = note(http.post(`${API}/v1/checkout/quote`, JSON.stringify({ pincode: PIN, slotId: slot?.id ?? null }), auth))
  if (q.status !== 200) return
  const c = note(
    http.post(`${API}/v1/checkout/confirm`, JSON.stringify({ quoteId: q.json('quoteId'), address: '12, 4th Cross, Koramangala, Bengaluru' }), {
      headers: { ...auth.headers, 'Idempotency-Key': `k6-${__VU}-${Date.now()}` },
    }),
  )
  check(c, { 'confirmed or sold out': (r) => r.status === 201 || r.status === 409 || r.status === 503 })
}
