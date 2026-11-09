// Mango Ops v2 (docs/design/ops-dashboard-v2.md): the shapes of the additive API routes
// GET /day, /live, /riders/:id/trail and /analytics/ops (mango-api/src/admin/ops-v2.js).
import type { OrderStatus } from '../types'

/** Orders of one slot by where they are: waiting = confirmed or being packed. */
export interface DayCounts {
  waiting: number
  packed: number
  out: number
  delivered: number
  failed: number
}

/** One delivery slot on the operating day, with its deadlines as times (IST). */
export interface DaySlot {
  id: string
  label: string
  startsAt: string
  endsAt: string
  capacityBoxes: number | null
  windowStartAt: string
  windowEndAt: string
  packByAt: string
  dispatchByAt: string
  orderCutoffAt: string | null
  counts: DayCounts
  orders: number
  boxes: number
  unassigned: number
}

export interface DayPlan {
  date: string
  now: string
  rules: { packLeadMinutes: number; dispatchLeadMinutes: number; orderCutoff: string | null }
  slots: DaySlot[]
  unslotted: { counts: DayCounts; orders: number; boxes: number; unassigned: number } | null
}

export interface LiveRider {
  id: string
  name: string
  email: string
  phone?: string | null
  lastAt: string | null
  lat: number | null
  lng: number | null
  accuracy: number | null
  stopsLeft: number
  stopsDone: number
}

export interface LiveStop {
  orderId: string
  number: string
  status: OrderStatus
  slotId: string | null
  pincode: string
  area: string | null
  lat: number | null
  lng: number | null
  riderId: string | null
  boxes: number
  customerName: string | null
  windowStartAt: string | null
  dueAt: string | null
  pickupWarehouseId: string | null
}

export interface LiveWarehouse {
  id: string
  name: string
  address: string | null
  lat: number | null
  lng: number | null
}

export interface LiveBoard {
  date: string
  now: string
  riders: LiveRider[]
  stops: LiveStop[]
  warehouses: LiveWarehouse[]
}

export interface RiderTrail {
  riderId: string
  date: string
  points: { lat: number; lng: number; accuracy: number | null; at: string }[]
}

export interface OpsAnalytics {
  from: string
  to: string
  onTime: { delivered: number; onTime: number; rate: number | null }
  slotFill: { slotId: string; label: string; startsAt: string; endsAt: string; days: number; capacityBoxes: number | null; boxes: number; orders: number; fill: number | null }[]
  minutesPerStop: { median: number | null; stops: number }
  riders: { id: string; name: string; delivered: number; failed: number; medianMinutes: number | null; flagged: number }[]
  pincodes: { pincode: string; area: string | null; lat: number | null; lng: number | null; orders: number; boxes: number }[]
  varieties: { variety: string; boxes: number; orders: number }[]
  repeat: { customers: number; repeatCustomers: number; rate: number | null }
  daily: { date: string; orders: number; delivered: number; failed: number }[]
}

/** What the live event stream (GET /events) sends. */
export type LiveEvent =
  | { type: 'hello'; data: { at: string } }
  | { type: 'heartbeat'; data: { at: string } }
  | { type: 'order.changed'; data: { id: string; number: string; status: OrderStatus; date: string | null } }
  | { type: 'rider.position'; data: { riderId: string; at: string } }
  | { type: 'attention.changed'; data: { count: number } }
  | { type: 'bulk.enquiry'; data: { id: string; number: string; status: string; change: 'created' | 'quoted' | 'responded' | 'closed' } }
  | { type: 'bye'; data: unknown }
