const B = process.argv[2]
const j = async (m, p, b, t) => { const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); const x = await r.text(); try { return { s: r.status, b: JSON.parse(x) } } catch { return { s: r.status, b: x } } }
const t = (await j('POST', '/admin/v1/auth/login', { email: 'manager@mandimangoes.test', password: 'manager123' })).b.accessToken
const list = await j('GET', '/admin/v1/orders', null, t)
console.log('orders list', list.s, (list.b.items ?? list.b.orders ?? []).map((o) => o.status).join(','))
for (const o of list.b.items ?? list.b.orders ?? []) { const d = await j('GET', `/admin/v1/orders/${o.id}`, null, t); console.log(' detail', o.status, d.s) }
for (const p of ['/admin/v1/summary', '/admin/v1/attention', '/admin/v1/manifest', '/admin/v1/deliveries/live', '/admin/v1/pack-list', '/admin/v1/analytics']) console.log(p, (await j('GET', p, null, t)).s)
console.log('ready', (await j('GET', '/ready')).s, 'catalogue', (await j('GET', '/v1/catalogue?pincode=560034')).s)
