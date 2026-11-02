// The contract walk's shared parts: every route the app registers, a signed-in token for
// every role, and the bad-input variants each route is sent.
import { adminToken, customerToken } from '../helpers.js'

/** Every route: { method, path } with the full path, read from the app's own router. */
export function allRoutes(app) {
  const out = []
  // "^\/admin\/v1\/?(?=\/|$)" -> "/admin/v1"; "^\/?(?=\/|$)" -> ""
  const prefixOf = (layer) => {
    const src = layer.regexp.source
    const cut = src.indexOf('\\/?(?=')
    return src.startsWith('^') && cut > 0 ? src.slice(1, cut).replaceAll('\\/', '/') : ''
  }
  const walk = (stack, base) => {
    for (const l of stack) {
      if (l.route) for (const m of Object.keys(l.route.methods)) for (const p of [].concat(l.route.path)) out.push({ method: m.toUpperCase(), path: `${base}${p}` })
      else if (l.handle?.stack) walk(l.handle.stack, base + prefixOf(l))
    }
  }
  walk(app._router.stack, '')
  const seen = new Set()
  return out.filter((r) => {
    const k = `${r.method} ${r.path}`
    return !seen.has(k) && seen.add(k)
  })
}

/** "/orders/:id/photos/:photoId" -> "/orders/qa_none/photos/qa_none" (ids that do not exist). */
export const fillPath = (path, value = 'qa_none') => path.replace(/:(\w+)(\([^)]*\))?\??/g, value)

export const ROLES = ['anonymous', 'customer', 'RIDER', 'PACKER', 'QC', 'OPERATOR', 'MANAGER']

/** A token for every role (anonymous has none). Needs the seeded staff logins (seed.js). */
export async function tokensFor(api, managerToken) {
  const add = await api.post('/admin/v1/staff', { email: 'qa.rider@mandimangoes.test', role: 'RIDER', password: 'long-enough-qa1' }, { token: managerToken })
  if (add.status !== 201) throw new Error(`rider not added: ${add.status} ${JSON.stringify(add.body)}`)
  return {
    anonymous: null,
    customer: (await customerToken(api)).accessToken,
    RIDER: await adminToken(api, 'qa.rider@mandimangoes.test', 'long-enough-qa1'),
    PACKER: await adminToken(api, 'packer@mandimangoes.test', 'packer123'),
    QC: await adminToken(api, 'qc@mandimangoes.test', 'qc123'),
    OPERATOR: await adminToken(api, 'ops@mandimangoes.test', 'operator123'),
    MANAGER: managerToken,
  }
}

/** Bad bodies every write route is sent: none, wrong types, not JSON, too big. */
export const VARIANTS = {
  missing: { raw: undefined },
  wrongTypes: {
    raw: JSON.stringify({ id: { $ne: null }, qty: -1, quantity: 'many', phone: 'abc', email: 7, date: '2026-13-45', status: 'NOT_A_STATUS', items: 'x', reason: ['x'] }),
  },
  array: { raw: '[1,2,3]' },
  notJson: { raw: '{"broken": ' },
  oversized: { raw: JSON.stringify({ note: 'x'.repeat(150 * 1024) }) },
}

/** A GET's bad query string: negative pages, absurd limits, impossible dates, a long search. */
export const BAD_QUERY = `?page=-1&limit=999999&date=2026-02-30&from=bad&to=bad&status=NOPE&q=${'%27%22%3C'.repeat(300)}`

/** The error shape every refusal uses: { error: { code, message, requestId } }. */
export function errorShapeProblem(body) {
  const e = body?.error
  if (!e || typeof e !== 'object') return 'no error object'
  if (typeof e.code !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(e.code)) return `code ${JSON.stringify(e.code)}`
  if (typeof e.message !== 'string' || !e.message) return 'no message'
  if (typeof e.requestId !== 'string' || !e.requestId) return 'no requestId'
  return null
}
