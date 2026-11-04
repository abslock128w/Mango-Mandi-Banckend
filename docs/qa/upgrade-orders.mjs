// Places orders on a running API at BASE and walks them to several states.
const BASE = process.argv[2]
const j = async (method, path, body, token, headers = {}) => {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined })
  const t = await r.text(); let b; try { b = JSON.parse(t) } catch { b = t }
  return { status: r.status, body: b }
}
const mgr = (await j('POST', '/admin/v1/auth/login', { email: 'manager@mandimangoes.test', password: 'manager123' })).body.accessToken
const cat = (await j('GET', '/v1/catalogue?pincode=560034')).body
const sellable = cat.items.filter((i) => i.qty > 0)
console.log('on sale', sellable.map((i) => `${i.sku}|${i.stage}:${i.qty}`).join(' '), 'for', cat.deliveryDate)
const out = {}
for (const [n, target] of [[0, 'CONFIRMED'], [1, 'PACKED'], [2, 'SHIPPED'], [3, 'OUT_FOR_DELIVERY'], [4, 'PAYMENT_PENDING']]) {
  const phone = `98765${String(10000 + n)}`
  const otp = await j('POST', '/v1/auth/otp/request', { phone })
  const tok = (await j('POST', '/v1/auth/otp/verify', { phone, code: otp.body.devCode })).body.accessToken
  const it = sellable[n % sellable.length]
  await j('POST', '/v1/cart/items', { sku: it.sku, stage: it.stage, qty: 1 }, tok)
  const slots = (await j('GET', '/v1/delivery/slots?pincode=560034&date=' + cat.deliveryDate)).body
  const slotId = (slots.slots ?? slots)[0]?.id
  const q = await j('POST', '/v1/checkout/quote', { pincode: '560034', deliveryDate: cat.deliveryDate, slotId }, tok)
  const o = await j('POST', '/v1/checkout/confirm', { quoteId: q.body.quoteId, address: '12, 4th Cross, Koramangala, Bengaluru' }, tok, { 'Idempotency-Key': `upgrade-${n}-${Date.now()}` })
  const id = o.body.orderId
  if (!id) { console.log('  checkout', target, q.status, JSON.stringify(q.body).slice(0, 200), o.status, JSON.stringify(o.body).slice(0, 200)); continue }
  if (target !== 'PAYMENT_PENDING') await j('POST', '/v1/dev/pay', { orderId: id, outcome: 'captured' })
  const steps = { CONFIRMED: [], PACKED: ['PROCESSING', 'alloc', 'PACKED'], SHIPPED: ['PROCESSING', 'alloc', 'PACKED', 'SHIPPED'], OUT_FOR_DELIVERY: ['PROCESSING', 'alloc', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY'], PAYMENT_PENDING: [] }[target]
  for (const s of steps) {
    const r = s === 'alloc' ? await j('POST', `/admin/v1/orders/${id}/allocate`, null, mgr) : await j('PATCH', `/admin/v1/orders/${id}/status`, { status: s }, mgr)
    if (r.status >= 300) console.log('  step', target, s, r.status, JSON.stringify(r.body).slice(0, 160))
  }
  out[target] = id
}
console.log(JSON.stringify(out))
