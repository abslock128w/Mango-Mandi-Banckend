import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Breadcrumb, ErrorEvent } from '@sentry/browser'
import { FILTERED, scrubBreadcrumb, scrubEvent, scrubText, scrubUrl, selectorOf, stripSelectorText, type ElementLike } from '../../shared/error-reports/scrub.ts'
import { errorReportDefine, sourceMapUpload, uploadsSourceMaps } from '../../scripts/sentry.ts'

// Browser error reports (shared/error-reports): what the shop and the panel may send
// to Sentry. A customer's phone number, address or e-mail never leaves the browser.

const PHONES = ['9876543210', '+919876543210', '+91 98765 43210', '91-9876543210', '09876543210', '98765-43210', '0091 9876543210']

test('phone numbers are masked in any common spelling', () => {
  for (const p of PHONES) assert.equal(scrubText(`Call ${p} now`), `Call ${FILTERED} now`, p)
  // Not a mobile number: too short, too long, or starting with 1-5.
  for (const n of ['12345', '1234567890', '98765432101234']) assert.match(scrubText(`n=${n}`), new RegExp(n))
})

test('tokens, keys, Razorpay ids, e-mail addresses and codes are masked', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjdXMxIn0.c2lnbmF0dXJlLXZhbHVl'
  const cases: [string, string][] = [
    [`token ${jwt}`, `token ${FILTERED}`],
    ['Authorization: Bearer abc.def-123', `Authorization: Bearer ${FILTERED}`],
    ['key rzp_live_AbCdEf123456 and rzp_test_AbCdEf123456', `key ${FILTERED} and ${FILTERED}`],
    ['secret whsec_abcdef123 blob vercel_blob_rw_abc123def456', `secret ${FILTERED} blob ${FILTERED}`],
    ['paid pay_ABCDEFGH123456 for order_ABCDEFGH123456, refund rfnd_ABCDEFGH123456', `paid ${FILTERED} for ${FILTERED}, refund ${FILTERED}`],
    ['mail asha.rao+mangoes@example.co.in', `mail ${FILTERED}`],
    ['Your code is 482913', `Your code is ${FILTERED}`],
    ['delivery code: 4821', `delivery code: ${FILTERED}`],
    ['OTP 4821', `OTP ${FILTERED}`],
    ['recovery k7qd-2mxp used', `recovery ${FILTERED} used`],
    ['pincode 560034', `pincode ${FILTERED}`],
  ]
  for (const [input, want] of cases) assert.equal(scrubText(input), want, input)
  // Ordinary text survives: order numbers, counts, versions, ids.
  const stack = 'at Oe (https://ops.mandimangoes.in/assets/index-CLeQ9pH9.js:52:123456) at t0 (https://ops.mandimangoes.in/assets/a.js:123456:7)'
  for (const keep of ['ORD-1042 has 3 boxes', 'took 1500 ms', 'version 1.2.3', 'id 550e8400-e29b-41d4-a716-446655440000', 'order_id missing', stack]) {
    assert.equal(scrubText(keep), keep, keep)
  }
  assert.equal(scrubText(undefined), undefined)
})

test('URLs lose their query string and fragment, in fields and in free text', () => {
  assert.equal(scrubUrl('https://mandimangoes.in/mangoes/ALP-3?q=alphonso&next=/checkout#reviews'), 'https://mandimangoes.in/mangoes/ALP-3')
  assert.equal(scrubUrl('/admin/v1/orders?q=9876543210'), '/admin/v1/orders')
  assert.equal(scrubUrl('/admin/v1/customers/+919876543210'), `/admin/v1/customers/${FILTERED}`)
  assert.equal(
    scrubText('Failed to load https://api.mandimangoes.in/v1/catalogue?pincode=560034&date=2027-03-01 (status 500)'),
    'Failed to load https://api.mandimangoes.in/v1/catalogue (status 500)',
  )
})

test('an event loses the body, cookies, query string, user and headers, and its text is scrubbed', () => {
  const event = {
    type: undefined,
    message: 'Saving 9876543210 failed',
    request: {
      url: 'https://ops.mandimangoes.in/orders?q=9876543210#top',
      query_string: 'q=9876543210',
      data: { address: '12 Marine Drive' },
      cookies: { session: 'x' },
      headers: { 'User-Agent': 'Chrome', Referer: 'https://ops.mandimangoes.in/customers?q=Asha', Cookie: 'x' },
    },
    user: { id: 'u1', ip_address: '1.2.3.4', email: 'a@b.in' },
    exception: {
      values: [
        {
          type: 'Error',
          value: 'Could not reach +91 98765 43210 at asha@example.com',
          stacktrace: { frames: [{ filename: 'https://ops.mandimangoes.in/assets/index.js?v=1#x', abs_path: 'https://ops.mandimangoes.in/assets/index.js?v=1', lineno: 1, vars: { phone: '9876543210' } }] },
        },
      ],
    },
    extra: { order: { phone: '9876543210', deliveryAddress: '12 Marine Drive', note: 'call 9876543210', status: 'PAID' } },
    contexts: { react: { componentStack: 'at OrderDetail (https://ops.mandimangoes.in/assets/a.js?t=1:2:3)' } },
    tags: { app: 'panel' },
    breadcrumbs: [
      { category: 'console', level: 'log', message: 'address 12 Marine Drive' },
      { category: 'console', level: 'warning', message: 'retrying 9876543210', data: { arguments: [{ address: '12 Marine Drive' }], logger: 'console' } },
      { category: 'navigation', data: { from: '/orders?q=9876543210', to: '/orders/o1#notes' } },
    ],
  } as unknown as ErrorEvent
  const out = scrubEvent(event)
  const text = JSON.stringify(out)
  for (const leaked of ['9876543210', '98765 43210', 'Marine Drive', 'asha@example.com', 'q=', 'Asha', '#top', '1.2.3.4', 'a@b.in']) {
    assert.ok(!text.includes(leaked), `${leaked} in ${text}`)
  }
  assert.deepEqual(out.request, { url: 'https://ops.mandimangoes.in/orders', headers: { 'User-Agent': 'Chrome' } })
  assert.equal(out.user, undefined)
  assert.equal(out.message, `Saving ${FILTERED} failed`)
  assert.equal(out.exception!.values![0].value, `Could not reach ${FILTERED} at ${FILTERED}`)
  assert.deepEqual(out.exception!.values![0].stacktrace!.frames![0], { filename: 'https://ops.mandimangoes.in/assets/index.js', abs_path: 'https://ops.mandimangoes.in/assets/index.js', lineno: 1 })
  assert.deepEqual(out.extra, { order: { phone: FILTERED, deliveryAddress: FILTERED, note: `call ${FILTERED}`, status: 'PAID' } })
  assert.deepEqual(out.tags, { app: 'panel' })
  assert.deepEqual(out.breadcrumbs, [
    { category: 'console', level: 'warning', message: `retrying ${FILTERED}`, data: { logger: 'console' } },
    { category: 'navigation', message: undefined, data: { from: '/orders', to: '/orders/o1' } },
  ])
})

test('console breadcrumbs: only warnings and errors, without their raw arguments', () => {
  const crumb = (level: Breadcrumb['level']) => ({ category: 'console', level, message: 'x', data: { arguments: [{ phone: '9876543210' }], logger: 'console' } })
  for (const level of ['log', 'info', 'debug'] as const) assert.equal(scrubBreadcrumb(crumb(level)), null, level)
  for (const level of ['warning', 'error'] as const) assert.deepEqual(scrubBreadcrumb(crumb(level))?.data, { logger: 'console' }, level)
})

test('requests keep method, path and status: no query string, body or sizes', () => {
  const b = scrubBreadcrumb({ category: 'fetch', type: 'http', data: { method: 'POST', url: 'https://api.mandimangoes.in/v1/auth/otp/request?phone=9876543210', status_code: 200, request_body_size: 30, body: '{"phone":"9876543210"}' } })
  assert.deepEqual(b?.data, { method: 'POST', url: 'https://api.mandimangoes.in/v1/auth/otp/request', status_code: 200 })
})

/** A small DOM stand-in: tag, id, classes and attributes, with a parent. */
function el(tagName: string, attrs: Record<string, string> = {}, parentElement: ElementLike | null = null): ElementLike {
  return { tagName: tagName.toUpperCase(), id: attrs.id ?? '', className: attrs.class ?? '', getAttribute: (n) => attrs[n] ?? null, parentElement }
}

test('a click is recorded as an element path with no text', () => {
  const html = el('html')
  const body = el('body', {}, html)
  const card = el('dd', { class: 'address', title: '12 Marine Drive, Mumbai' }, el('dl', { class: 'facts' }, el('main', { id: 'main', class: 'content' }, body)))
  const button = el('button', { type: 'button', class: 'btn btn-small', 'aria-label': 'Call Asha Rao on 9876543210' }, card)
  assert.equal(selectorOf(button), 'body > main#main.content > dl.facts > dd.address > button.btn.btn-small[type="button"]')
  const input = el('input', { type: 'tel', name: 'phone', id: 'phone', placeholder: '98765 43210' }, el('form', {}, body))
  assert.equal(selectorOf(input), 'body > form > input#phone[type="tel"][name="phone"]')

  // From the SDK, with the clicked element in the hint: the path is rebuilt from it.
  const sdk = { category: 'ui.click', message: 'dd.address[title="12 Marine Drive, Mumbai"] > button.btn[aria-label="Call Asha Rao"][type="button"]', data: { 'ui.component_name': 'X' } }
  assert.deepEqual(scrubBreadcrumb(sdk, { event: { target: button } }), { category: 'ui.click', message: selectorOf(button), data: undefined })
  // Without it (a second pass in beforeSend), the text attributes are cut out of the SDK's path.
  assert.equal(scrubBreadcrumb(sdk)?.message, 'dd.address > button.btn[type="button"]')
  assert.equal(stripSelectorText('img.photo[alt="Asha "Rao"] at home"][name="p"] > span[title="x"]'), 'img.photo[name="p"] > span')
})

test('build settings: environment and release tags, and source maps only with all three Sentry settings', async () => {
  assert.deepEqual(errorReportDefine({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_SHA: 'abc123' }, 'production'), {
    'import.meta.env.VITE_SENTRY_ENVIRONMENT': '"preview"',
    'import.meta.env.VITE_SENTRY_RELEASE': '"abc123"',
  })
  assert.equal(errorReportDefine({ VITE_SENTRY_ENVIRONMENT: 'staging', VERCEL_ENV: 'preview' }, 'production')['import.meta.env.VITE_SENTRY_ENVIRONMENT'], '"staging"')
  assert.deepEqual(errorReportDefine({}, 'development'), { 'import.meta.env.VITE_SENTRY_ENVIRONMENT': '"development"', 'import.meta.env.VITE_SENTRY_RELEASE': '""' })

  const all = { SENTRY_AUTH_TOKEN: 'sntrys_x', SENTRY_ORG: 'mandimangoes', SENTRY_PROJECT: 'mandimangoes-shop', SENTRY_URL: 'http://127.0.0.1:9' }
  assert.equal(uploadsSourceMaps(all), true)
  for (const missing of ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT']) {
    const env = { ...all, [missing]: '' }
    assert.equal(uploadsSourceMaps(env), false, missing)
    assert.deepEqual(await sourceMapUpload(env), [], missing)
  }
  // With all three: Sentry's plugin, after the one that finds the output folder. Nothing is uploaded here.
  const names = (await sourceMapUpload(all)).map((p) => (p as { name: string }).name)
  assert.equal(names[0], 'mango-source-map-dir')
  assert.ok(names.includes('sentry-vite-plugin'), names.join())
})
