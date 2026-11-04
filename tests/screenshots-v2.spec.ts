import { test } from './fixtures'
import { mockApi, mockLive, type MockState } from './mock-api'
import type { DayPlan } from '../src/ops/types'

// Mango Ops v2 screenshots for docs/screenshots/panel/ (light and dark at 1280, light at 390), against
// the mock API. Not part of the suite: run with real map tiles on a spare port,
//   PW_SHOTS=1 PANEL_PORT=5192 VITE_MAP_TILES_URL= npx playwright test tests/screenshots-v2.spec.ts --project=desktop

const todayIST = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
const inMin = (m: number) => new Date(Date.now() + m * 60_000).toISOString()

function demo(api: MockState) {
  const today = todayIST()
  // The manifest's day is today, so the Dispatch board has its stops on the map.
  api.manifest = { ...api.manifest, date: today }
  const day: DayPlan = {
    date: today,
    now: new Date().toISOString(),
    rules: { packLeadMinutes: 60, dispatchLeadMinutes: 15, orderCutoff: '18:00 the day before' },
    slots: [
      { id: 'slt1', label: 'Morning', startsAt: '07:00', endsAt: '11:00', capacityBoxes: 40, orderCutoffAt: null, packByAt: inMin(-150), dispatchByAt: inMin(-105), windowStartAt: inMin(-90), windowEndAt: inMin(150), counts: { waiting: 0, packed: 2, out: 6, delivered: 11, failed: 1 }, orders: 20, boxes: 31, unassigned: 2 },
      { id: 'slt2', label: 'Evening', startsAt: '16:00', endsAt: '20:00', capacityBoxes: 40, orderCutoffAt: null, packByAt: inMin(20), dispatchByAt: inMin(65), windowStartAt: inMin(80), windowEndAt: inMin(320), counts: { waiting: 5, packed: 7, out: 0, delivered: 0, failed: 0 }, orders: 12, boxes: 17, unassigned: 7 },
    ],
    unslotted: null,
  }
  api.dayPlan = day
  api.riders = [
    { id: 'adm9', email: 'ravi@mandimangoes.test', name: 'Ravi Kumar' },
    { id: 'adm10', email: 'salma@mandimangoes.test', name: 'Salma Begum' },
    { id: 'adm11', email: 'arjun@mandimangoes.test', name: 'Arjun Rao' },
  ]
  const board = mockLive(api, today)
  board.riders = [
    { id: 'adm9', name: 'Ravi Kumar', email: 'ravi@mandimangoes.test', phone: null, lastAt: inMin(-2), lat: 18.995, lng: 72.828, accuracy: 10, stopsLeft: 3, stopsDone: 6 },
    { id: 'adm10', name: 'Salma Begum', email: 'salma@mandimangoes.test', phone: null, lastAt: inMin(-41), lat: 19.04, lng: 72.84, accuracy: 15, stopsLeft: 3, stopsDone: 5 },
    { id: 'adm11', name: 'Arjun Rao', email: 'arjun@mandimangoes.test', phone: null, lastAt: inMin(-12), lat: 18.955, lng: 72.818, accuracy: 9, stopsLeft: 0, stopsDone: 0 },
  ]
  board.stops = [
    ...board.stops,
    { orderId: 's1', number: 'ORD-1051', status: 'OUT_FOR_DELIVERY', slotId: 'slt1', pincode: '400001', area: 'South', lat: 18.9388, lng: 72.8354, riderId: 'adm9', boxes: 2, customerName: 'Asha Rao', windowStartAt: inMin(-90), dueAt: inMin(150), pickupWarehouseId: 'wh_main' },
    { orderId: 's2', number: 'ORD-1052', status: 'OUT_FOR_DELIVERY', slotId: 'slt1', pincode: '400050', area: 'Bandra', lat: 19.0596, lng: 72.8295, riderId: 'adm10', boxes: 1, customerName: 'Vikram Shah', windowStartAt: inMin(-90), dueAt: inMin(150), pickupWarehouseId: 'wh_main' },
    { orderId: 's3', number: 'ORD-1053', status: 'PACKED', slotId: 'slt2', pincode: '400016', area: 'Mahim', lat: 19.0402, lng: 72.8402, riderId: null, boxes: 2, customerName: 'Meera Iyer', windowStartAt: inMin(80), dueAt: inMin(320), pickupWarehouseId: null },
  ]
  api.liveBoard = board
  api.attention = {
    ...api.attention,
    stuckRefunds: [{ type: 'order', id: 'o2', number: 'ORD-1040', requestedAt: inMin(-95), state: 'needs_manager', attempts: 4 }],
    failedDeliveries: [{ id: 'o2', number: 'ORD-1043', name: 'Vikram S', phone: '9123456780', attempts: 2 }],
    lowRatings: [{ id: 'rv1', rating: 2, comment: 'Two were bruised', sku: 'ALP-3', productName: 'Alphonso 3kg Box', createdAt: inMin(-300), order: { id: 'o2', number: 'ORD-1043' } }],
  }
  // The manifest's day is today, so the Dispatch board has stops on the map.
}

const SHOTS: [string, string][] = [
  ['today', '/today'],
  ['deliveries', `/deliveries?tab=unassigned`],
  ['orders', '/orders'],
  ['analytics', '/analytics'],
]

for (const [theme, width] of [['light', 1280], ['dark', 1280], ['light', 390]] as const) {
  for (const [name, path] of SHOTS) {
    test(`${theme}-${width}-${name}`, async ({ page }) => {
      test.skip(!process.env.PW_SHOTS, 'screenshots: PW_SHOTS=1')
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
      const api = await mockApi(page, { signedIn: true })
      demo(api)
      await page.goto(path.includes('deliveries') ? `${path}&date=${todayIST()}` : path)
      await page.getByRole('heading', { level: 1 }).waitFor()
      await page.waitForTimeout(2500)
      await page.screenshot({ path: `docs/screenshots/panel/${theme}-${width}-${name}.png`, fullPage: true, animations: 'disabled' })
    })
  }
}
