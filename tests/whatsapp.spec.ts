import AxeBuilder from '@axe-core/playwright'
import type { Page, Route } from '@playwright/test'
import { expect, openNavTo, test } from './fixtures'
import { mockApi } from './mock-api'

// The WhatsApp page (docs/whatsapp/OPERATIONS.md): the inbox for managers and operators,
// set-up and health for managers. The API is mocked here; mango-api/test/whatsapp.test.js
// covers the server side, including every refusal the page relies on.

const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

function conversation(over: Record<string, unknown> = {}) {
  return {
    id: 'wac_1', phone: '•••• 3210', customer: { id: 'cus_1', name: 'Asha Rao' }, mode: 'STAFF', status: 'WAITING', assignedTo: null as null | { id: string; email: string },
    handoffReason: 'customer sent a photo', waitingSince: '2026-10-15T05:00:00Z', lastInboundAt: '2026-10-15T05:00:00Z', lastOutboundAt: '2026-10-15T05:00:05Z',
    windowOpenUntil: '2099-10-16T05:00:00Z', windowOpen: true, unread: 2, updatedAt: '2026-10-15T05:00:05Z', preview: 'The box was squashed', ...over,
  }
}

function waState() {
  return {
    conv: conversation(),
    messages: [
      { id: 'wam_1', direction: 'IN', type: 'image', body: 'The box was squashed', template: null, author: { kind: 'customer' }, status: 'RECEIVED', error: null, createdAt: '2026-10-15T05:00:00Z', statusAt: null,
        media: { kind: 'image', mime: 'image/jpeg', filename: null, caption: 'The box was squashed', location: null, canOpen: true } },
      { id: 'wam_2', direction: 'OUT', type: 'text', body: 'Thanks, a person from our team will reply here.', template: null, author: { kind: 'bot' }, status: 'READ', error: null, createdAt: '2026-10-15T05:00:05Z', statusAt: null, media: null },
      { id: 'wam_3', direction: 'OUT', type: 'text', body: 'Earlier reply', template: null, author: { kind: 'bot' }, status: 'UNKNOWN', error: 'UNKNOWN: timeout', createdAt: '2026-10-15T04:00:00Z', statusAt: null, media: null },
    ] as Record<string, unknown>[],
    consent: { updates: 'ALLOWED', marketing: 'NONE' },
    automations: [
      { kind: 'ORDER_CONFIRMED', template: 'mandi_order_confirmed', category: 'UTILITY', consent: 'updates', params: ['name', 'order number', 'delivery date', 'slot'], example: [], trigger: 'A verified payment confirms the order.', flag: null, enabled: true, state: 'READY', meta: { status: 'APPROVED', category: 'UTILITY', bodyParams: 4, urlButton: false, reason: null } },
      { kind: 'REORDER_REMINDER', template: 'mandi_reorder_reminder', category: 'MARKETING', consent: 'marketing', params: ['name', 'product'], example: [], trigger: 'A week after delivery, with opt-in.', flag: null, enabled: true, state: 'AWAITING_APPROVAL', meta: { status: 'PENDING', category: 'MARKETING', bodyParams: 2, urlButton: false, reason: null } },
    ],
    checked: false,
  }
}

async function waMock(page: Page) {
  const s = waState()
  const calls: { method: string; path: string; body: unknown }[] = []
  const detail = () => ({ conversation: s.conv, messages: s.messages, consent: s.consent, recentOrders: [{ id: 'o1', number: 'ORD-1042', status: 'CONFIRMED', deliveryDate: '2026-10-16', total: 189900 }] })
  const report = () => ({ language: 'en', synced: true, lastSyncedAt: '2026-10-15T04:00:00Z', automations: s.automations })
  await page.route('**/admin/v1/whatsapp/**', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname.replace(/^.*\/admin\/v1/, '')
    const body = req.postData() ? req.postDataJSON() : undefined
    calls.push({ method: req.method(), path: `${path}${url.search}`, body })
    if (path === '/whatsapp/conversations') {
      const view = url.searchParams.get('view') ?? 'waiting'
      const list = view === 'waiting' && s.conv.status !== 'WAITING' ? [] : [s.conv]
      return json(route, 200, { conversations: list, counts: { waiting: s.conv.status === 'WAITING' ? 1 : 0, staff: s.conv.mode === 'STAFF' ? 1 : 0, mine: 0 } })
    }
    if (path === '/whatsapp/media/wam_1') return route.fulfill({ status: 200, contentType: 'image/png', body: PNG })
    const m = /^\/whatsapp\/conversations\/wac_1(?:\/([a-z-]+))?$/.exec(path)
    if (m) {
      if (m[1] === 'reply') {
        s.messages.push({ id: `wam_${s.messages.length + 10}`, direction: 'OUT', type: 'text', body: (body as { text: string }).text, template: null, author: { kind: 'staff', id: 'adm_2', email: 'ops@mandimangoes.test' }, status: 'SENT', error: null, createdAt: '2026-10-15T05:10:00Z', statusAt: null, media: null })
        s.conv = { ...s.conv, status: 'OPEN', mode: 'STAFF', unread: 0, assignedTo: { id: 'adm_2', email: 'ops@mandimangoes.test' } }
        return json(route, 201, detail())
      }
      if (m[1] === 'hand-back') s.conv = { ...s.conv, mode: 'BOT', status: 'OPEN', assignedTo: null }
      if (m[1] === 'take-over') s.conv = { ...s.conv, mode: 'STAFF', status: 'OPEN', assignedTo: { id: 'adm_2', email: 'ops@mandimangoes.test' } }
      if (m[1] === 'close') s.conv = { ...s.conv, mode: 'BOT', status: 'CLOSED', assignedTo: null }
      if (m[1] === 'opt-out') s.consent = { ...s.consent, marketing: 'OPTED_OUT' }
      return json(route, 200, detail())
    }
    if (path === '/whatsapp/messages/wam_3/retry') {
      s.messages = s.messages.map((x) => (x.id === 'wam_3' ? { ...x, status: 'SENT', error: null } : x))
      return json(route, 202, { queued: 'wam_3' })
    }
    if (path === '/whatsapp/overview') {
      return json(route, 200, {
        readiness: {
          complete: false, missing: ['WHATSAPP_TOKEN'], environment: 'production',
          items: [
            { key: 'WHATSAPP_PROVIDER', label: 'Provider is Meta', ok: true, detail: 'meta', required: true },
            { key: 'WHATSAPP_TOKEN', label: 'Access token (system user)', ok: false, detail: 'not set', required: true },
          ],
        },
        lastCheck: s.checked ? { at: '2026-10-15T05:20:00Z', configured: false, ok: false, phone: { ok: false, problem: 'missing_credentials' }, subscription: null } : null,
        metrics: { inbound: 12, replies: 10, updates_sent: 30, updates_delivered: 28, updates_read: 20, updates_failed: 1, updates_skipped: 2, messages_failed: 1, messages_queued: 0, waiting: 1, oldest_waiting: '2026-10-15T05:00:00Z', stopped: 3, last_webhook_at: '2026-10-15T05:00:00Z', webhooks_unprocessed: 1, webhooks_given_up: 0 },
        health: [{ field: 'message_template_status_update', event: 'APPROVED', detail: { message_template_name: 'mandi_order_confirmed' }, at: '2026-10-15T04:00:00Z' }],
        templates: report(),
        webhookUrl: 'https://api.mandimangoes.example/webhooks/whatsapp',
      })
    }
    if (path === '/whatsapp/check') {
      s.checked = true
      return json(route, 200, { at: '2026-10-15T05:20:00Z', configured: false, ok: false, phone: { ok: false, problem: 'missing_credentials' }, subscription: null })
    }
    if (path === '/whatsapp/templates/sync') return json(route, 200, report())
    const a = /^\/whatsapp\/automations\/([A-Z_]+)$/.exec(path)
    if (a) {
      s.automations = s.automations.map((x) => (x.kind === a[1] ? { ...x, enabled: (body as { enabled: boolean }).enabled, state: (body as { enabled: boolean }).enabled ? 'READY' : 'OFF' } : x))
      return json(route, 200, report())
    }
    if (path === '/whatsapp/failures') {
      return json(route, 200, {
        updates: [{ id: 'ntf_1', kind: 'OUT_FOR_DELIVERY', number: 'ORD-1042', phone: '•••• 3210', unknown: true, error: 'UNKNOWN: timeout', attempts: 1, createdAt: '2026-10-15T05:00:00Z' }],
        messages: [],
        events: [{ id: 'whe_1', receivedAt: '2026-10-15T05:00:00Z', attempts: 2, error: 'database busy', gaveUp: false }],
      })
    }
    if (path === '/whatsapp/events/whe_1/replay') return json(route, 200, { ok: true, error: null })
    return json(route, 404, { error: { code: 'NOT_FOUND', message: 'Not found', requestId: 'req_wa' } })
  })
  await page.route('**/admin/v1/notifications/ntf_1/retry', (route) => {
    calls.push({ method: 'POST', path: '/notifications/ntf_1/retry', body: undefined })
    return route.fulfill({ status: 204 })
  })
  return { s, calls }
}

const scan = async (page: Page) => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
}

test('an operator answers a customer waiting on WhatsApp: inbox, photo, reply, hand back', async ({ page }) => {
  await mockApi(page, { signedIn: true, role: 'OPERATOR' })
  const wa = await waMock(page)
  await page.goto('/today')
  await (await openNavTo(page, 'WhatsApp')).click()
  await expect(page).toHaveURL(/\/whatsapp$/)
  await expect(page.getByTestId('wa-counts')).toHaveText('1 waiting for us · 1 held by staff · 0 assigned to you')
  // Operators have no set-up tab.
  await expect(page.getByRole('tab', { name: 'Set-up and health' })).toHaveCount(0)
  await expect(page.getByText('•••• 3210').first()).toBeVisible()
  await scan(page)

  await page.getByRole('link', { name: /Asha Rao/ }).click()
  await expect(page.getByRole('heading', { name: 'Asha Rao', level: 1 })).toBeVisible()
  await expect(page.getByRole('img', { name: 'The box was squashed' })).toBeVisible()
  // The photo comes from our API, never from Meta.
  await expect.poll(() => wa.calls.some((c) => c.path === '/whatsapp/media/wam_1')).toBe(true)
  await expect(page.locator('img[src*="fbcdn"], img[src*="whatsapp.net"]')).toHaveCount(0)
  await expect(page.getByText('WhatsApp did not answer in time')).toBeVisible()
  await expect(page.getByRole('link', { name: 'ORD-1042' })).toHaveAttribute('href', '/orders/o1')
  await scan(page)

  const send = page.getByRole('button', { name: 'Send reply' })
  await expect(send).toBeDisabled()
  await page.getByLabel('Reply on WhatsApp').fill('Sorry Asha, we will send a new box tomorrow.')
  await send.click()
  await expect(page.getByText('Sorry Asha, we will send a new box tomorrow.')).toBeVisible()
  expect(wa.calls.find((c) => c.path.endsWith('/reply'))?.body).toEqual({ text: 'Sorry Asha, we will send a new box tomorrow.' })

  // Send again on the message WhatsApp gave no answer for.
  await page.getByRole('button', { name: 'Send again' }).click()
  await expect.poll(() => wa.calls.some((c) => c.path === '/whatsapp/messages/wam_3/retry')).toBe(true)

  // Record the customer's own request to stop offers.
  await page.getByRole('button', { name: 'Stop offers for this customer' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Stop offers' }).click()
  await expect(page.getByText('opted out')).toBeVisible()
  expect(wa.calls.find((c) => c.path.endsWith('/opt-out'))?.body).toEqual({ scope: 'marketing' })

  await page.getByRole('button', { name: 'Hand back to the bot' }).click()
  await expect(page.getByText('Bot answering')).toBeVisible()
})

test('outside the 24-hour window the reply box is off and says why', async ({ page }) => {
  await mockApi(page, { signedIn: true, role: 'OPERATOR' })
  const wa = await waMock(page)
  wa.s.conv = conversation({ windowOpen: false, windowOpenUntil: '2026-10-14T05:00:00Z' })
  await page.goto('/whatsapp/wac_1')
  await expect(page.getByLabel('Reply on WhatsApp')).toBeDisabled()
  await expect(page.getByText('More than 24 hours have passed since the customer last wrote').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send again' })).toHaveCount(0)
})

test('a manager checks the set-up: configuration, connection check, templates, a switch, failures', async ({ page }) => {
  await mockApi(page, { signedIn: true, role: 'MANAGER' })
  const wa = await waMock(page)
  await page.goto('/whatsapp')
  await page.getByRole('tab', { name: 'Set-up and health' }).click()
  await expect(page).toHaveURL(/\/whatsapp\/setup$/)
  await expect(page.getByText('Not ready: 1 required setting is missing')).toBeVisible()
  await expect(page.getByText('Access token (system user)')).toBeVisible()
  await expect(page.getByText('https://api.mandimangoes.example/webhooks/whatsapp')).toBeVisible()
  await page.getByRole('button', { name: 'Check connection' }).click()
  await expect(page.getByTestId('wa-check')).toContainText('The token or phone number id is not set')
  await expect(page.getByText('Waiting for Meta approval')).toBeVisible()
  await scan(page)

  await page.getByRole('button', { name: 'Turn off order confirmed' }).click()
  await expect(page.getByText('Turned off here')).toBeVisible()
  expect(wa.calls.find((c) => c.path === '/whatsapp/automations/ORDER_CONFIRMED')?.body).toEqual({ enabled: false })

  await page.getByRole('button', { name: 'Read templates from Meta' }).click()
  await expect.poll(() => wa.calls.some((c) => c.path === '/whatsapp/templates/sync')).toBe(true)

  await expect(page.getByText('Check with the customer before sending again')).toBeVisible()
  await page.getByRole('button', { name: 'Send again' }).click()
  await expect.poll(() => wa.calls.some((c) => c.path === '/notifications/ntf_1/retry')).toBe(true)
  await page.getByRole('button', { name: 'Process again' }).click()
  await expect.poll(() => wa.calls.some((c) => c.path === '/whatsapp/events/whe_1/replay')).toBe(true)
})

test('packers, QC and riders never see the WhatsApp page', async ({ page }) => {
  for (const role of ['PACKER', 'QC', 'RIDER'] as const) {
    await mockApi(page, { signedIn: true, role })
    await waMock(page)
    await page.goto('/whatsapp')
    await expect(page.getByRole('heading', { name: 'WhatsApp', level: 1 })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Not available for your role' })).toBeVisible()
  }
})
