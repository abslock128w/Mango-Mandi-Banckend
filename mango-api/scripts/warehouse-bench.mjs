// Warehouse measurements on a disposable test database (docs/warehouse/PERFORMANCE.md).
//
//   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/mango_bench_test node scripts/warehouse-bench.mjs
//
// The database name must end in _test (test/setup-env.js refuses anything
// else) and its schema is dropped and rebuilt. Runs the real API in-process
// over HTTP. Prints one line per measurement.
import { adminToken, checkout, client, customerToken, resetDb, startServer } from '../test/helpers.js'
import { randomUUID } from 'node:crypto'
import { addDays, todayIST } from '../src/clock.js'
import { closePool, query } from '../src/db.js'
import { reconciliation } from '../src/warehouse/reports.js'

const target = new URL(process.env.DATABASE_URL)
console.log(`database: ${target.hostname}:${target.port || 5432}${target.pathname} (user ${target.username}, password masked)`)

const srv = await startServer()
const api = client(srv.base)
await resetDb()
const token = await adminToken(api)
const W = '/admin/v1/warehouse'
const ms = async (fn) => {
  const t = performance.now()
  const out = await fn()
  return [performance.now() - t, out]
}
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
}
const f = (n) => `${n.toFixed(0)} ms`
const must = (r, ...ok) => {
  if (!ok.includes(r.status)) throw new Error(`${r.status} ${JSON.stringify(r.body).slice(0, 300)}`)
  return r.body
}
const loc = async (type) => (await query('SELECT id FROM wh_locations WHERE type = $1 LIMIT 1', [type])).rows[0].id

must(await api.patch(`${W}/products/ALP-3`, { boxTrackingEnabled: true, nominalWeightG: 3000 }, { token }), 200)

// 1. Intake: 2000 boxes in one request; 5000 boxes in resumable chunks.
const harvestedOn = addDays(todayIST(), -5)
const [t2000, lot2000] = await ms(async () => must(await api.post(`${W}/lots`, { sku: 'ALP-3', expectedCount: 2000, harvestedOn }, { token }), 201))
console.log(`intake 2000 boxes, one request: ${f(t2000)}`)
const [t5000, lot5000] = await ms(async () => {
  let lot = must(await api.post(`${W}/lots`, { sku: 'ALP-3', expectedCount: 5000, harvestedOn }, { token }), 201)
  let calls = 1
  while (lot.status === 'generating') {
    lot = must(await api.post(`${W}/lots/${lot.id}/continue`, {}, { token }), 200)
    calls++
  }
  return { ...lot, calls }
})
console.log(`intake 5000 boxes, ${lot5000.calls} requests: ${f(t5000)} (${lot5000.generatedCount} boxes)`)

// 2. Labels: 1000 per PDF.
const [tPdf, pdf] = await ms(() => api.raw('GET', `${W}/lots/${lot2000.id}/labels.pdf?from=1&to=1000`, { token }))
console.log(`label PDF, 1000 labels: ${f(tPdf)}, ${(Buffer.byteLength(pdf.body ?? '') / 1024).toFixed(0)} KB`)

// 3. Receive scans: 1000 boxes, 50 per request, one at a time and then 4 at a time.
must(await api.post(`/admin/v1/batches/${lot2000.batchId}/qc`, { ripenessRating: 'SEMI_RIPE', condition: 'GOOD' }, { token }), 201)
const tokens = (await query('SELECT label_token FROM boxes WHERE lot_id = $1 ORDER BY seq', [lot2000.id])).rows.map((r) => r.label_token)
const op = must(await api.post(`${W}/operations`, { type: 'receive', context: { lotId: lot2000.id } }, { token }), 201)
const send = (chunk) => api.post(`${W}/operations/${op.id}/scans`, { scans: chunk.map((t) => ({ scanId: randomUUID(), input: `MMB1:${t}` })) }, { token })
const serial = []
for (let i = 0; i < 1000; i += 50) {
  const [t, r] = await ms(() => send(tokens.slice(i, i + 50)))
  must(r, 200)
  serial.push(t)
}
console.log(`receive scans, 50 per request, sequential: p50 ${f(pct(serial, 50))}, p95 ${f(pct(serial, 95))} per request (${(pct(serial, 50) / 50).toFixed(1)} ms per scan)`)
const parallel = []
const [tPar] = await ms(async () => {
  for (let i = 1000; i < 2000; i += 200) {
    await Promise.all([0, 50, 100, 150].map(async (o) => {
      const [t, r] = await ms(() => send(tokens.slice(i + o, i + o + 50)))
      must(r, 200)
      parallel.push(t)
    }))
  }
})
console.log(`receive scans, 4 requests in flight: 1000 scans in ${f(tPar)}; p50 ${f(pct(parallel, 50))}, p95 ${f(pct(parallel, 95))} per request`)

// 4. Bulk QC and put-away of 2000 boxes.
// Lot-wide actions run in chunks: call again while the answer says `more` (and something changed).
const chunked = async (path, body, key) => {
  const per = []
  let total = 0
  for (;;) {
    const [t, r] = await ms(async () => must(await api.post(path, body, { token }), 200))
    per.push(t)
    total += r[key]
    if (!r.more || !r[key]) return { total, per }
  }
}
const [tQc, qc] = await ms(() => chunked(`${W}/lots/${lot2000.id}/qc`, { result: 'passed' }, 'passed'))
console.log(`QC pass whole lot (${qc.total} boxes, ${qc.per.length} requests): ${f(tQc)}; slowest request ${f(Math.max(...qc.per))}`)
const storage = await loc('storage')
const [tPut, put] = await ms(() => chunked(`${W}/lots/${lot2000.id}/put-away`, { locationId: storage }, 'moved'))
console.log(`put away whole lot (${put.total} boxes, ${put.per.length} requests): ${f(tPut)}; slowest request ${f(Math.max(...put.per))}`)

// 5. Contention: 20 paid orders, 20 pick sessions all scanning the same 10 boxes at once.
const orders = []
for (let i = 0; i < 20; i++) {
  const cust = await customerToken(api)
  const c = await checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage: 'RIPE', qty: 1 }])
  must(c, 201)
  must(await api.post('/v1/dev/pay', { orderId: c.body.orderId, outcome: 'captured' }), 200)
  orders.push(c.body.orderId)
}
const ops = await Promise.all(orders.map(async (id) => must(await api.post(`${W}/operations`, { type: 'pick', context: { orderId: id } }, { token }), 201)))
const contested = tokens.slice(0, 10)
const [tRace, raced] = await ms(() => Promise.all(ops.map((o, i) => api.post(`${W}/operations/${o.id}/scans`, {
  scans: [0, 1, 2].map((k) => ({ scanId: randomUUID(), input: `MMB1:${contested[(i + k) % 10]}` })),
}, { token }))))
const results = raced.flatMap((r) => must(r, 200).results)
const picked = results.filter((r) => r.code === 'OK').length
const doubled = (await query(`SELECT box_id FROM box_events WHERE type = 'PICKED' GROUP BY box_id HAVING count(*) > 1`)).rows.length
console.log(`pick race, 20 sessions × 3 scans over 10 boxes: ${f(tRace)}; ${picked} picks accepted, ${doubled} boxes picked twice, other codes: ${[...new Set(results.filter((r) => r.code !== 'OK').map((r) => r.code))].join(', ')}`)

// 6. Reports over ~7000 boxes.
const boxes = (await query('SELECT count(*)::int AS n FROM boxes')).rows[0].n
const [tRec, rec] = await ms(() => reconciliation({ query }, 'wh_main'))
console.log(`reconciliation over ${boxes} boxes: ${f(tRec)}, clean: ${rec.clean}`)
const [tOv] = await ms(() => api.get(`${W}/overview`, { token }))
console.log(`overview: ${f(tOv)}`)
const [tEx] = await ms(() => api.get(`${W}/exceptions`, { token }))
console.log(`exceptions: ${f(tEx)}`)
const [tPick] = await ms(() => api.get(`${W}/orders/${orders[0]}/pick-list`, { token }))
console.log(`pick list: ${f(tPick)}`)
const [tCsv, csv] = await ms(() => api.raw('GET', `${W}/export/boxes`, { token }))
console.log(`CSV export of every box: ${f(tCsv)}, ${(String(csv.body).length / 1024).toFixed(0)} KB`)

await srv.close()
await closePool()
