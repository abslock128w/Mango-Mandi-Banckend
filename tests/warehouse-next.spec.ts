import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, navLinkAnyState, openNavTo, test } from './fixtures'
import { mockApi, type Role } from './mock-api'
import { mockWarehouse } from './warehouse-mock'

// Warehouse next: stocktake, repack and partial damage screens, lineage in
// the trace, and camera scanning (9.7), against tests/warehouse-mock.ts. The
// rules themselves are the API's (mango-api/test/warehouse-next.test.js); these
// check what staff see and what the panel sends.

type Features = Partial<{ stocktake: boolean; repack: boolean; cameraScan: boolean }>

async function signIn(page: Page, role: Role = 'MANAGER', features: Features = {}) {
  const api = await mockApi(page, { signedIn: true, role })
  const whs = await mockWarehouse(page, api, { role, features })
  return { api, whs }
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
}

/** No sideways page scroll; on failure, names what sticks out. */
async function noSidewaysScroll(page: Page) {
  const r = await page.evaluate(() => {
    const width = document.documentElement.clientWidth
    const wide = Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((el) => el.getBoundingClientRect().right > width + 1)
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`)
    return { scroll: document.documentElement.scrollWidth, width, wide }
  })
  expect(r.scroll, `${page.url()} sticks out: ${r.wide.join(', ')}`).toBeLessThanOrEqual(r.width)
}

const scanInput = (page: Page) => page.getByLabel('Scan or type a box code')
const results = (page: Page) => page.getByRole('list', { name: 'Scans, newest first' }).getByRole('listitem')

async function scan(page: Page, code: string) {
  await scanInput(page).fill(code)
  await scanInput(page).press('Enter')
}

// ---------------------------------------------------------------- flags and roles

test('with stocktake and repack off, their links, scan types and pages are gone', async ({ page }) => {
  await signIn(page, 'MANAGER', { stocktake: false, repack: false })
  await page.goto('/warehouse/scan')
  await expect(page.getByLabel('What are you doing?').locator('option')).toHaveText(['Receive', 'Move', 'QC', 'Pick', 'Take off order', 'Pack', 'Dispatch', 'Return'])
  await expect(navLinkAnyState(page, 'Stocktake')).toHaveCount(0)
  await expect(navLinkAnyState(page, 'Repack')).toHaveCount(0)
  await page.goto('/warehouse/stocktake')
  await expect(page.getByRole('heading', { name: 'Not available for your role' })).toBeVisible()
  await page.goto('/warehouse/repack')
  await expect(page.getByRole('heading', { name: 'Not available for your role' })).toBeVisible()
  // No partial-damage action on a box either.
  await page.goto('/warehouse/boxes/0b6f2a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b')
  await expect(page.getByRole('heading', { name: /Box/, level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Take fruit out' })).toHaveCount(0)
})

test('a packer gets neither stocktake nor repack; QC staff neither', async ({ page }) => {
  await signIn(page, 'PACKER')
  await page.goto('/warehouse/scan')
  await expect(page.getByLabel('What are you doing?').locator('option')).not.toContainText(['Stocktake'])
  await expect(navLinkAnyState(page, 'Stocktake')).toHaveCount(0)
  await expect(navLinkAnyState(page, 'Repack')).toHaveCount(0)
  await page.goto('/warehouse/stocktake')
  await expect(page.getByRole('heading', { name: 'Not available for your role' })).toBeVisible()
})

// ---------------------------------------------------------------- stocktake

test('stocktake: count a place, finish, review what was not found', async ({ page }) => {
  // A manager may review their own count; anyone else needs a second person (next test).
  const { api, whs } = await signIn(page, 'MANAGER')
  await page.goto('/today')
  await (await openNavTo(page, 'Stocktake')).click()
  await expect(page.getByRole('heading', { name: 'Stocktake', level: 1 })).toBeVisible()
  await page.getByRole('link', { name: 'Start a count' }).click()
  await expect(page.getByLabel('What are you doing?')).toHaveValue('stocktake')
  await page.getByRole('button', { name: 'Start scanning' }).click()
  await expect(page.getByRole('alert')).toContainText('Choose the place you are counting.')
  await page.getByLabel('Place to count').selectOption({ label: 'A · Shelf A (Storage)' })
  await page.getByRole('button', { name: 'Start scanning' }).click()
  await expect(page.getByRole('heading', { name: /Stocktake/ })).toContainText('of Shelf A')
  expect(api.calls.find((c) => c.method === 'POST' && c.path === '/warehouse/operations')?.body).toEqual({ type: 'stocktake', context: { locationId: 'loc_a' } })

  await scan(page, 'AAAA-0001-1')
  await expect(results(page).first()).toContainText('AAAA-0001-1 counted')
  await scan(page, 'MISSING-0009-Z')
  await expect(results(page).first()).toContainText('was recorded missing')
  await expect(results(page).first()).toContainText('Warning')
  await expect(page.locator('dl[aria-label="Session counts"]')).toContainText('2 (3 recorded here)')
  await axe(page)

  await page.getByRole('button', { name: 'Finish count' }).click()
  const confirm = page.getByRole('dialog', { name: 'Finish this count?' })
  await expect(confirm).toContainText('You scanned 2 boxes; 3 are recorded here.')
  await confirm.getByRole('button', { name: 'Finish count' }).click()
  await expect(page.getByText('Count finished.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Count finished' })).toBeVisible()
  await expect(page.getByText('2 boxes were not found. A supervisor reviews them')).toBeVisible()
  expect(whs.finalizeBodies).toEqual([{}])

  await page.getByRole('link', { name: 'Open the count' }).click()
  await expect(page.getByRole('heading', { name: 'Count of Shelf A' })).toBeVisible()
  const review = page.getByRole('region', { name: /Review boxes not found/ })
  await review.getByRole('button', { name: 'Save review' }).click()
  await expect(review.getByRole('alert')).toContainText('Decide every box: 2 not decided yet.')
  // The box on an order can only be kept.
  const allocated = review.getByRole('group', { name: /AAAA-0003-3/ })
  await expect(allocated.getByLabel('Mark missing')).toBeDisabled()
  await expect(allocated).toContainText('it can only be kept here')
  await review.getByRole('button', { name: 'Mark all missing' }).click()
  await expect(allocated.getByLabel('Keep as recorded')).toBeChecked()
  await expect(review.getByRole('group', { name: /AAAA-0002-2/ }).getByLabel('Mark missing')).toBeChecked()
  await review.getByLabel('Note (optional)').fill('Looked on every shelf')
  await axe(page)
  await review.getByRole('button', { name: 'Save review' }).click()
  await expect(page.getByText('Review saved: 1 marked missing.')).toBeVisible()
  expect(whs.reviewBodies).toEqual([{ missing: ['bx_1'], keep: ['bx_2'], note: 'Looked on every shelf' }])
  await expect(page.getByRole('region', { name: 'Review', exact: true })).toContainText('Applied')
  await expect(page.getByRole('row', { name: /AAAA-0002-2/ })).toContainText('Marked missing')
  await expect(page.getByRole('row', { name: /AAAA-0003-3/ })).toContainText('Kept as recorded')
})

test('stocktake: a supervisor does not review their own count', async ({ page }) => {
  const { whs } = await signIn(page, 'OPERATOR')
  await page.goto('/warehouse/scan?type=stocktake')
  await page.getByLabel('Place to count').selectOption({ label: 'A · Shelf A (Storage)' })
  await page.getByRole('button', { name: 'Start scanning' }).click()
  await scan(page, 'AAAA-0001-1')
  await expect(results(page).first()).toContainText('AAAA-0001-1 counted')
  await page.getByRole('button', { name: 'Finish count' }).click()
  await page.getByRole('dialog', { name: 'Finish this count?' }).getByRole('button', { name: 'Finish count' }).click()
  await page.getByRole('link', { name: 'Open the count' }).click()
  const review = page.getByRole('region', { name: /Review boxes not found/ })
  await expect(review).toContainText('You did this count, so someone else reviews it')
  await expect(review.getByRole('button', { name: 'Save review' })).toHaveCount(0)
  await axe(page)
  expect(whs.reviewBodies).toEqual([])
})

test('stocktake: a big review waits for a second manager; the supervisor cannot approve it', async ({ page }) => {
  await signIn(page, 'OPERATOR')
  await page.goto('/warehouse/stocktake/st_seed')
  const card = page.getByRole('region', { name: 'Review', exact: true })
  await expect(card).toContainText('Waiting for a second person')
  await expect(card).toContainText('A manager who did not count or review this must approve it.')
  await expect(card.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0)
})

test('stocktake: a manager approves the big review from the exceptions queue', async ({ page }) => {
  const { api } = await signIn(page, 'MANAGER')
  await page.goto('/warehouse/exceptions')
  const group = page.getByRole('region', { name: 'Counts waiting for a review' })
  await expect(group).toContainText('12 to approve by a second person')
  await expect(page.getByRole('region', { name: 'Boxes marked missing' })).toContainText('7K2M-QX4P-3')
  await axe(page)
  await group.getByRole('link', { name: 'Shelf B' }).click()
  const card = page.getByRole('region', { name: 'Review', exact: true })
  await expect(card).toContainText('12 (36 kg)')
  await card.getByRole('button', { name: 'Approve', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Mark 12 boxes missing?' })
  await expect(dialog).toContainText('They leave stock (36 kg)')
  await axe(page)
  await dialog.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(page.getByText('Approved: 12 marked missing.')).toBeVisible()
  await expect(card).toContainText('Applied')
  expect(api.calls.some((c) => c.method === 'POST' && c.path === '/warehouse/stocktakes/st_seed/approve')).toBe(true)
})

// ---------------------------------------------------------------- repack

test('repack: scan boxes in, say what came out, print the new labels', async ({ page }) => {
  const { api, whs } = await signIn(page, 'OPERATOR')
  await page.goto('/today')
  await (await openNavTo(page, 'Repack')).click()
  await page.getByRole('link', { name: 'Start a repack' }).click()
  await expect(page.getByLabel('What are you doing?')).toHaveValue('repack')
  // Only places where repacking happens are offered.
  await expect(page.getByLabel('Where you repack').locator('option')).toHaveText(['Choose a location', 'Receiving (Receiving)', 'Packing bench (Packing)'])
  await page.getByLabel('Where you repack').selectOption({ label: 'Packing bench (Packing)' })
  await page.getByRole('button', { name: 'Start scanning' }).click()
  await expect(page.getByRole('alert')).toContainText('Choose why you are repacking.')
  await page.getByLabel('Why repack?').selectOption({ label: 'Merge part-full boxes' })
  await page.getByLabel('What is being done').fill('Two half boxes into one')
  await page.getByRole('button', { name: 'Start scanning' }).click()
  await expect(scanInput(page)).toBeFocused()
  expect(api.calls.find((c) => c.method === 'POST' && c.path === '/warehouse/operations')?.body).toEqual({
    type: 'repack', context: { locationId: 'loc_p', reasonCode: 'merge_partials', reason: 'Two half boxes into one' },
  })

  await scan(page, '7K2M-QX4P-3')
  await expect(results(page).first()).toContainText('Accepted')
  await scan(page, 'ALLOC-1')
  await expect(page.getByRole('alert').filter({ hasText: 'Scanning paused' })).toContainText('Take it off the order before repacking.')
  await page.getByRole('button', { name: 'Continue scanning' }).click()
  await scan(page, '7K2M-QX4R-8')
  await expect(page.locator('dl[aria-label="Session counts"]')).toContainText('Boxes in2')

  await page.getByRole('button', { name: 'Finish repack' }).click()
  const dialog = page.getByRole('dialog', { name: 'Finish repack' })
  await expect(dialog).toContainText('Going in: 2 boxes, 6 kg (7K2M-QX4P-3, 7K2M-QX4R-8)')
  await dialog.getByRole('button', { name: 'Make 1 new box' }).click()
  await expect(dialog.getByRole('alert')).toContainText('New box 1: enter its weight in whole grams.')
  await dialog.getByLabel('Weight in grams').fill('5200')
  await dialog.getByLabel('Fruit taken out').fill('3')
  await dialog.getByLabel('Weight taken out (g)').fill('800')
  await expect(dialog).toContainText('Out: 5.2 kg in 1 box of 6 kg in.')
  await axe(page)
  await dialog.getByRole('button', { name: 'Make 1 new box' }).click()
  await expect(page.getByText('Repack done: print the new labels.')).toBeVisible()
  expect(whs.finalizeBodies).toEqual([{ outputs: [{ weightG: 5200 }], fruitRemoved: 3, weightLostG: 800 }])
  const done = page.getByRole('region', { name: 'Repack done' })
  await expect(done).toContainText('2 boxes in, 1 new box out')
  await expect(done).toContainText('The new boxes wait for QC before they sell.')
  await expect(done.getByRole('list', { name: 'New boxes' })).toContainText('RPK1-0001-A')

  const download = page.waitForEvent('download')
  await done.getByRole('button', { name: 'Download new labels' }).click()
  expect((await download).suggestedFilename()).toMatch(/^repack-labels-wop_\d+\.pdf$/)
  expect(api.calls.some((c) => c.method === 'GET' && /^\/warehouse\/repacks\/wop_\d+\/labels\.pdf$/.test(c.path))).toBe(true)

  await done.getByRole('link', { name: 'Open the repack' }).click()
  await expect(page.getByRole('heading', { name: 'Merge', level: 1 })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Boxes that went in' })).toContainText('Repacked')
  await expect(page.getByRole('region', { name: 'New boxes' })).toContainText('RPK1-0001-A')
  await expect(page.getByRole('link', { name: 'L2610-ALP3-7K' })).toBeVisible()
  await axe(page)
  await page.locator('a.back-link', { hasText: 'Repack' }).click()
  await expect(page.getByRole('row', { name: /Merge/ })).toContainText('2 → 1')
})

test('repack: a split makes several new boxes, and a box can be removed from the form', async ({ page }) => {
  const { whs } = await signIn(page, 'MANAGER')
  await page.goto('/warehouse/scan?type=repack')
  await page.getByLabel('Where you repack').selectOption({ label: 'Receiving (Receiving)' })
  await page.getByLabel('Why repack?').selectOption({ label: 'Split a box' })
  await page.getByLabel('What is being done').fill('Two smaller gift boxes')
  await page.getByRole('button', { name: 'Start scanning' }).click()
  await scan(page, '7K2M-QX4P-3')
  await expect(results(page).first()).toContainText('Accepted')
  await page.getByRole('button', { name: 'Finish repack' }).click()
  const dialog = page.getByRole('dialog', { name: 'Finish repack' })
  await dialog.getByRole('button', { name: 'Add another new box' }).click()
  await dialog.getByRole('button', { name: 'Add another new box' }).click()
  await dialog.getByRole('group', { name: 'New box 1' }).getByLabel('Weight in grams').fill('1500')
  await dialog.getByRole('group', { name: 'New box 2' }).getByLabel('Weight in grams').fill('1400')
  await dialog.getByRole('group', { name: 'New box 2' }).getByLabel('Fruit (optional)').fill('6')
  await dialog.getByRole('button', { name: 'Remove new box 3' }).click()
  await dialog.getByRole('button', { name: 'Make 2 new boxes' }).click()
  await expect(page.getByRole('region', { name: 'Repack done' })).toContainText('1 box in, 2 new boxes out')
  // Weight taken out left blank: the API records the difference.
  expect(whs.finalizeBodies).toEqual([{ outputs: [{ weightG: 1500 }, { weightG: 1400, fruitCount: 6 }], fruitRemoved: 0 }])
})

test('partial damage: fruit taken out of a box, below tolerance it needs review', async ({ page }) => {
  const { whs } = await signIn(page, 'OPERATOR')
  await page.goto('/warehouse/boxes/0b6f2a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b')
  await page.getByRole('button', { name: 'Take fruit out' }).click()
  const dialog = page.getByRole('dialog', { name: /Take fruit out of 7K2M-QX4P-3/ })
  await dialog.getByRole('button', { name: 'Record' }).click()
  await expect(dialog.getByRole('alert')).toContainText('Say how much fruit or weight came out.')
  await dialog.getByLabel('Why').selectOption({ label: 'Spoiled fruit' })
  await dialog.getByLabel('Fruit taken out').fill('2')
  await dialog.getByLabel('Weight taken out (g)').fill('600')
  await dialog.getByLabel('What happened').fill('Two soft mangoes')
  await axe(page)
  await dialog.getByRole('button', { name: 'Record' }).click()
  await expect(page.getByText('needs review before it sells')).toBeVisible()
  expect(whs.damageBodies).toEqual([{ reasonCode: 'spoiled_fruit', reason: 'Two soft mangoes', fruitRemoved: 2, weightLostG: 600 }])
})

test('trace shows every delivery batch in a merged box and the boxes it was repacked into', async ({ page }) => {
  await signIn(page)
  await page.goto('/warehouse/boxes/rb_merged/trace')
  const batches = page.getByRole('list', { name: 'Delivery batches in this box' })
  await expect(batches).toContainText('L2610-ALP3-7K')
  await expect(batches).toContainText('L2610-ALP3-9Q · Devgad Orchards')
  await expect(page.getByRole('list', { name: 'Boxes this was repacked into' }).getByRole('link', { name: 'RPK1-0001-A' })).toBeVisible()
  await axe(page)
})

test('new screens fit 375px without sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await signIn(page, 'MANAGER', { cameraScan: true })
  for (const path of ['/warehouse/stocktake', '/warehouse/stocktake/st_seed', '/warehouse/repack', '/warehouse/exceptions']) {
    await page.goto(path)
    await expect(page.locator('h1')).toBeVisible()
    await noSidewaysScroll(page)
  }
  await page.goto('/warehouse/scan?type=repack')
  await page.getByLabel('Where you repack').selectOption({ label: 'Receiving (Receiving)' })
  await page.getByLabel('Why repack?').selectOption({ label: 'Other' })
  await page.getByLabel('What is being done').fill('Box crushed at the corner')
  await page.getByRole('button', { name: 'Start scanning' }).click()
  await scan(page, '7K2M-QX4P-3')
  await expect(page.getByRole('button', { name: 'Use camera' })).toBeVisible()
  await noSidewaysScroll(page)
  await page.getByRole('button', { name: 'Finish repack' }).click()
  await page.getByRole('dialog', { name: 'Finish repack' }).getByRole('button', { name: 'Add another new box' }).click()
  await noSidewaysScroll(page)
  // Touch targets: every button in the form is at least 44px tall.
  for (const b of await page.getByRole('dialog').getByRole('button').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44)
})

// ---------------------------------------------------------------- camera scanning (9.7)

interface CamOpts {
  secure?: boolean
  detector?: boolean
  deny?: string
  cameras?: number
  torch?: boolean
  /** getUserMedia waits until the test calls window.__cam.open() (the browser still asking). */
  hold?: boolean
}

/**
 * A stand-in camera and QR reader: getUserMedia returns a canvas stream whose
 * track counts stop() calls, and BarcodeDetector reads codes the test queues
 * in window.__cam.codes (one per frame) plus every code in window.__cam.inView
 * (in every frame, like labels held in front of the camera).
 */
async function fakeCamera(page: Page, opts: CamOpts = {}) {
  await page.addInitScript((o: CamOpts) => {
    type Cam = { codes: string[]; inView: string[]; stopped: number; started: number; torch: boolean[]; constraints: unknown[]; open: () => void }
    const w = window as unknown as { __cam: Cam; BarcodeDetector?: unknown }
    let opened: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      opened = resolve
    })
    w.__cam = { codes: [], inView: [], stopped: 0, started: 0, torch: [], constraints: [], open: () => opened() }
    if (o.secure === false) Object.defineProperty(window, 'isSecureContext', { get: () => false })
    if (o.detector === false) delete w.BarcodeDetector
    else {
      w.BarcodeDetector = class {
        static async getSupportedFormats() {
          return ['qr_code']
        }
        async detect() {
          const c = w.__cam.codes.shift()
          return [...(c ? [c] : []), ...w.__cam.inView].map((rawValue) => ({ rawValue }))
        }
      }
    }
    const md = navigator.mediaDevices
    md.getUserMedia = async (constraints?: MediaStreamConstraints) => {
      w.__cam.constraints.push(constraints)
      if (o.deny) throw new DOMException('Refused', o.deny)
      if (o.hold) await gate
      const canvas = document.createElement('canvas')
      canvas.width = 320
      canvas.height = 240
      const ctx = canvas.getContext('2d')!
      let n = 0
      window.setInterval(() => {
        ctx.fillStyle = n++ % 2 ? '#222' : '#333'
        ctx.fillRect(0, 0, 320, 240)
      }, 50)
      const stream = canvas.captureStream(20)
      const track = stream.getVideoTracks()[0]
      const stop = track.stop.bind(track)
      track.stop = () => {
        w.__cam.stopped++
        stop()
      }
      track.getCapabilities = () => (o.torch ? { torch: true } : {}) as MediaTrackCapabilities
      track.applyConstraints = async (c?: MediaTrackConstraints) => {
        w.__cam.torch.push(Boolean((c?.advanced?.[0] as { torch?: boolean } | undefined)?.torch))
      }
      const id = (constraints?.video as { deviceId?: { exact?: string } } | undefined)?.deviceId?.exact ?? 'cam-back'
      track.getSettings = () => ({ deviceId: id })
      w.__cam.started++
      return stream
    }
    md.enumerateDevices = async () =>
      [
        { kind: 'videoinput', deviceId: 'cam-back', label: 'Back camera', groupId: 'g' },
        ...(o.cameras === 2 ? [{ kind: 'videoinput', deviceId: 'cam-front', label: 'Front camera', groupId: 'g' }] : []),
        { kind: 'audioinput', deviceId: 'mic', label: 'Microphone', groupId: 'g' },
      ] as MediaDeviceInfo[]
  }, opts)
}

const cam = (page: Page) =>
  page.evaluate(() => {
    const c = (window as unknown as { __cam: { stopped: number; started: number; torch: boolean[]; codes: string[] } }).__cam
    return { stopped: c.stopped, started: c.started, torch: c.torch, codes: c.codes }
  })
const showCode = (page: Page, ...codes: string[]) => page.evaluate((c) => (window as unknown as { __cam: { codes: string[] } }).__cam.codes.push(...c), codes)

async function moveSession(page: Page) {
  await page.goto('/warehouse/scan?type=move')
  await page.getByLabel('Moving to').selectOption({ label: 'A · Shelf A (Storage)' })
  await page.getByRole('button', { name: 'Start scanning' }).click()
  await expect(scanInput(page)).toBeFocused()
}

test('camera: off unless the warehouse switches it on', async ({ page }) => {
  await fakeCamera(page)
  await signIn(page, 'MANAGER', { cameraScan: false })
  await moveSession(page)
  await expect(page.getByRole('button', { name: 'Use camera' })).toHaveCount(0)
})

test('camera: a code read goes through the scan queue once, however long it stays in view', async ({ page }) => {
  await fakeCamera(page, { torch: true, cameras: 2 })
  const { whs } = await signIn(page, 'MANAGER', { cameraScan: true })
  await moveSession(page)
  await page.getByRole('button', { name: 'Use camera' }).click()
  await expect(page.getByText('Camera on: hold a label in the frame.')).toBeVisible()
  await expect(page.getByLabel(/Camera view/)).toBeVisible()
  await axe(page)

  // Seen in five frames in a row: one scan.
  await showCode(page, '7K2M-QX4P-3', '7K2M-QX4P-3', '7K2M-QX4P-3', '7K2M-QX4P-3', '7K2M-QX4P-3')
  await expect(results(page).first()).toContainText('7K2M-QX4P-3 moved to Shelf A.')
  await expect.poll(async () => (await cam(page)).codes.length).toBe(0)
  await page.waitForTimeout(400)
  const sent = whs.scanRequests.flat()
  expect(sent.map((x) => x.input)).toEqual(['7K2M-QX4P-3'])
  // Same pipeline as a hand scanner: a scanId of its own.
  expect(sent[0].scanId).toMatch(/\S{8,}/)

  // A different code goes straight through, and the hand scanner still works alongside.
  await showCode(page, '7K2M-QX4R-8')
  await expect(results(page).first()).toContainText('7K2M-QX4R-8 moved to Shelf A.')
  await scan(page, '7K2M-QX4T-1')
  await expect(results(page).first()).toContainText('7K2M-QX4T-1 moved to Shelf A.')

  // A rejected camera read stops the queue like any other.
  await showCode(page, 'BAD-CAMERA')
  await expect(page.getByRole('alert').filter({ hasText: 'Scanning paused' })).toContainText('BAD-CAMERA')
  await page.getByRole('button', { name: 'Continue scanning' }).click()

  // Light and camera choice where the device has them.
  const light = page.getByRole('button', { name: 'Light off' })
  await light.click()
  await expect(page.getByRole('button', { name: 'Light on' })).toHaveAttribute('aria-pressed', 'true')
  expect((await cam(page)).torch).toEqual([true])
  await page.getByLabel('Camera', { exact: true }).selectOption({ label: 'Front camera' })
  await expect.poll(async () => (await cam(page)).started).toBe(2)
  expect((await cam(page)).stopped).toBe(1)

  // Stop gives the camera back.
  await page.getByRole('button', { name: 'Stop camera' }).click()
  await expect.poll(async () => (await cam(page)).stopped).toBe(2)
  await expect(page.getByLabel(/Camera view/)).toBeHidden()
})

test('camera: let go when the page is hidden and when leaving the screen', async ({ page }) => {
  await fakeCamera(page)
  await signIn(page, 'MANAGER', { cameraScan: true })
  await moveSession(page)
  await page.getByRole('button', { name: 'Use camera' }).click()
  await expect(page.getByText('Camera on')).toBeVisible()
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect.poll(async () => (await cam(page)).stopped).toBe(1)
  await expect(page.getByRole('alert')).toContainText('The camera was turned off while this page was hidden.')
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
  })
  await page.getByRole('button', { name: 'Use camera' }).click()
  await expect(page.getByText('Camera on')).toBeVisible()
  await page.locator('a.back-link', { hasText: 'Scan' }).click()
  await expect(page.getByRole('heading', { name: 'Start scanning' })).toBeVisible()
  await expect.poll(async () => (await cam(page)).stopped).toBe(2)
})

test('camera: hidden while the browser is still opening it, the camera is given straight back', async ({ page }) => {
  await fakeCamera(page, { hold: true })
  await signIn(page, 'MANAGER', { cameraScan: true })
  await moveSession(page)
  await page.getByRole('button', { name: 'Use camera' }).click()
  await expect(page.getByText('Starting the camera…')).toBeVisible()
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page.getByRole('alert')).toContainText('The camera was turned off while this page was hidden.')
  // The browser hands the camera over after the page was hidden: it is stopped at once and never shown.
  await page.evaluate(() => (window as unknown as { __cam: { open: () => void } }).__cam.open())
  await expect.poll(async () => (await cam(page)).stopped).toBe(1)
  expect((await cam(page)).started).toBe(1)
  await expect(page.getByLabel(/Camera view/)).toBeHidden()
  await expect(page.getByText('Camera on')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Use camera' })).toBeVisible()
})

test('camera: two labels in view at once are each sent once, not every frame', async ({ page }) => {
  await fakeCamera(page)
  const { whs } = await signIn(page, 'MANAGER', { cameraScan: true })
  await moveSession(page)
  await page.getByRole('button', { name: 'Use camera' }).click()
  await expect(page.getByText('Camera on')).toBeVisible()
  await page.evaluate(() => {
    ;(window as unknown as { __cam: { inView: string[] } }).__cam.inView.push('7K2M-QX4P-3', '7K2M-QX4R-8')
  })
  await expect(results(page)).toHaveCount(2)
  // Both stay in view for well over a second (about ten frames): still one scan each.
  await page.waitForTimeout(1500)
  expect(whs.scanRequests.flat().map((x) => x.input).sort()).toEqual(['7K2M-QX4P-3', '7K2M-QX4R-8'])
  await page.getByRole('button', { name: 'Stop camera' }).click()
})

test('camera: refused permission is explained and typing still works', async ({ page }) => {
  await fakeCamera(page, { deny: 'NotAllowedError' })
  await signIn(page, 'MANAGER', { cameraScan: true })
  await moveSession(page)
  await page.getByRole('button', { name: 'Use camera' }).click()
  await expect(page.getByRole('alert')).toContainText('Camera permission was refused. To use it, allow the camera for this site')
  await axe(page)
  await scan(page, '7K2M-QX4P-3')
  await expect(results(page).first()).toContainText('moved to Shelf A')
})

test('camera: without the QR reader or https, the screen says so and offers typing', async ({ page }) => {
  await fakeCamera(page, { detector: false })
  await signIn(page, 'MANAGER', { cameraScan: true })
  await moveSession(page)
  await page.getByRole('button', { name: 'Use camera' }).click()
  await expect(page.getByRole('alert')).toContainText('This browser cannot read QR codes with the camera. Use the hand scanner or type the code.')
  expect((await cam(page)).started).toBe(0)
})

test('camera: over plain http the camera is not tried', async ({ page }) => {
  await fakeCamera(page, { secure: false })
  await signIn(page, 'MANAGER', { cameraScan: true })
  await moveSession(page)
  await page.getByRole('button', { name: 'Use camera' }).click()
  await expect(page.getByRole('alert')).toContainText('The camera only works over a secure (https) connection.')
  expect((await cam(page)).started).toBe(0)
})
