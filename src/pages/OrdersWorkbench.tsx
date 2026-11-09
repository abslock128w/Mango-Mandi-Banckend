// The Orders workbench (docs/design/ops-dashboard-v2.md §4): saved views as chips, the DataTable
// with Due and Rider columns, selection with a bulk bar (Mark packed, Assign rider, Export CSV,
// Print) and a peek drawer (Enter, or the row's Peek button) with the order's header, items,
// customer, history and its main actions. A row click still opens the full order, as before.
import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye } from 'lucide-react'
import { api } from '../api'
import { ORDER_STATUS_LABEL, RIPENESS_LABEL, date, dateTime, istDate, rupees, telHref } from '../format'
import { usePref } from '../ops/prefs'
import { dueOf } from '../ops/time'
import { useNow } from '../ops/useQueue'
import type { DeliverySlot, OrderListItem, Ripeness } from '../types'
import { BackorderBadge, DataTable, OrderBadge, PeekDrawer, QueryError, Spinner, rowsToCsv, usePeek, useToast, type Column } from '../ui'

/** The URL parameters a view is made of. */
const VIEW_KEYS = ['status', 'from', 'to', 'q', 'delivery', 'slot', 'unpacked', 'olderThanMinutes'] as const

interface SavedView {
  name: string
  params: string
}

const ist = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+05:30`).toISOString()

function viewParams(p: URLSearchParams): string {
  const out = new URLSearchParams()
  for (const k of VIEW_KEYS) {
    const v = p.get(k)
    if (v) out.set(k, v)
  }
  out.sort()
  return out.toString()
}

const NO_VIEWS: SavedView[] = []

/** Built-in views, then the person's own (this browser). */
export function SavedViews({ slots }: { slots: DeliverySlot[] }) {
  const [params] = useSearchParams()
  const [mine, setMine] = usePref<SavedView[]>('views.orders', NO_VIEWS)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const today = istDate(0)
  const tomorrow = istDate(1)
  const morning = [...slots].filter((s) => s.active !== false).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))[0]
  const q = (o: Record<string, string>) => {
    const p = new URLSearchParams(o)
    p.sort()
    return p.toString()
  }
  const builtIn: SavedView[] = [
    { name: 'All orders', params: '' },
    ...(morning ? [{ name: `Tomorrow ${morning.label.toLowerCase()}`, params: q({ delivery: tomorrow, slot: morning.id }) }] : []),
    { name: 'Unpacked for today', params: q({ delivery: today, unpacked: 'true' }) },
    { name: 'Failed deliveries', params: q({ status: 'DELIVERY_FAILED' }) },
    { name: 'Payment pending > 30 min', params: q({ olderThanMinutes: '30', status: 'PAYMENT_PENDING' }) },
  ]
  const current = viewParams(params)
  const known = [...builtIn, ...mine].some((v) => v.params === current)
  function save(e: FormEvent) {
    e.preventDefault()
    const n = name.trim()
    if (!n) return
    setMine([...mine.filter((v) => v.name !== n), { name: n, params: current }])
    setNaming(false)
    setName('')
  }
  return (
    <nav aria-label="Saved views" className="view-chips">
      {[...builtIn, ...mine].map((v) => (
        <Link key={`${v.name}|${v.params}`} to={v.params ? `/orders?${v.params}` : '/orders'} className="view-chip" aria-current={v.params === current ? 'true' : undefined}>
          {v.name}
        </Link>
      ))}
      {mine.some((v) => v.params === current) && (
        <button type="button" className="link-btn" onClick={() => setMine(mine.filter((v) => v.params !== current))}>
          Forget this view
        </button>
      )}
      {!known &&
        (naming ? (
          <form className="field-inline" onSubmit={save}>
            <div className="field m-0">
              <label htmlFor="view-name" className="sr-only">
                Name this view
              </label>
              <input id="view-name" value={name} maxLength={40} placeholder="Name this view" onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
            <button type="submit" className="btn btn-small">
              Save
            </button>
            <button type="button" className="link-btn" onClick={() => setNaming(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <button type="button" className="btn btn-small" onClick={() => setNaming(true)}>
            Save this view
          </button>
        ))}
    </nav>
  )
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function OrdersWorkbench({ items, canAct }: { items: OrderListItem[]; canAct: boolean }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const nowMs = useNow()
  const [selected, setSelected] = useState<string[]>([])
  const [peekId, openPeek, closePeek] = usePeek('peek')
  const slotsQ = useQuery({ queryKey: ['slots'], queryFn: api.slots, staleTime: 5 * 60_000 })
  const ridersQ = useQuery({ queryKey: ['riders'], queryFn: api.riders, enabled: canAct, staleTime: 60_000 })
  const slots = slotsQ.data ?? []
  const riders = ridersQ.data ?? []
  const slotOf = (o: OrderListItem) => slots.find((s) => s.id === o.slotId) ?? null
  const riderOf = (o: OrderListItem) => riders.find((r) => r.id === o.riderId) ?? null
  const dueAt = (o: OrderListItem) => {
    const s = slotOf(o)
    return s ? ist(o.deliveryDate, s.endsAt) : null
  }
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['orders'] })
    void queryClient.invalidateQueries({ queryKey: ['order'] })
  }

  const pack = useMutation({
    mutationFn: async (ids: string[]) => {
      const done: string[] = []
      const skipped: string[] = []
      for (const id of ids) {
        const o = items.find((x) => x.id === id)
        if (!o) continue
        if (o.status !== 'PROCESSING') {
          skipped.push(o.number)
          continue
        }
        await api.setOrderStatus(id, 'PACKED')
        done.push(o.number)
      }
      return { done, skipped }
    },
    onSuccess: ({ done, skipped }) => {
      if (done.length) toast.success(`${done.length} marked packed`)
      if (skipped.length) toast.info(`Only orders being packed can be marked packed: not ${skipped.join(', ')}`)
      setSelected([])
      refresh()
    },
    onError: (e) => toast.error(e),
  })
  const assign = useMutation({
    mutationFn: async ({ riderId, ids }: { riderId: string; ids: string[] }) => {
      // One call per delivery day: a rider is given stops of a day.
      const byDay = new Map<string, string[]>()
      for (const id of ids) {
        const o = items.find((x) => x.id === id)
        if (o) byDay.set(o.deliveryDate, [...(byDay.get(o.deliveryDate) ?? []), id])
      }
      let n = 0
      for (const [day, orderIds] of byDay) n += (await api.assignRiders({ date: day, riderId, orderIds })).assigned.length
      return n
    },
    onSuccess: (n) => {
      toast.success(`${n} ${n === 1 ? 'order' : 'orders'} given to the rider`)
      setSelected([])
      refresh()
    },
    onError: (e) => toast.error(e),
  })

  const columns: Column<OrderListItem>[] = [
    {
      key: 'number',
      header: 'Order',
      fixed: true,
      card: 'title',
      sort: (a, b) => a.number.localeCompare(b.number),
      cell: (o) => (
        <>
          {o.number}
          {o.channel === 'whatsapp' && <span className="muted small dt-sub"> via WhatsApp</span>}
          {o.giftOrderId && <span className="muted small dt-sub"> Gift delivery</span>}
        </>
      ),
    },
    { key: 'customer', header: 'Customer', sort: (a, b) => (a.customerName ?? '').localeCompare(b.customerName ?? ''), cell: (o) => <>{o.customerName ?? '—'}{o.phone && <div className="muted small">{o.phone}</div>}</> },
    { key: 'items', header: 'Items', num: true, sort: (a, b) => a.itemCount - b.itemCount, cell: (o) => o.itemCount },
    { key: 'total', header: 'Total', num: true, sort: (a, b) => a.total - b.total, cell: (o) => rupees(o.total) },
    { key: 'status', header: 'Status', card: 'status', sort: (a, b) => ORDER_STATUS_LABEL[a.status].localeCompare(ORDER_STATUS_LABEL[b.status]), cell: (o) => (
        <>
          <OrderBadge status={o.status} />
          {o.backorder && (
            <>
              {' '}
              <BackorderBadge awaiting={o.atRisk} />
            </>
          )}
        </>
      ) },
    { key: 'delivery', header: 'Delivery', sort: (a, b) => a.deliveryDate.localeCompare(b.deliveryDate), cell: (o) => date(o.deliveryDate) },
    {
      key: 'due',
      header: 'Due',
      sort: (a, b) => (dueAt(a) ?? '9').localeCompare(dueAt(b) ?? '9'),
      cell: (o) => {
        const s = slotOf(o)
        if (!s) return <span className="muted">—</span>
        const due = ['DELIVERED', 'CANCELLED', 'RTO', 'PAYMENT_PENDING'].includes(o.status) ? null : dueOf(nowMs, dueAt(o))
        // Only today's and late ones get a pill: a week away is not news.
        const show = due && (due.late || due.minutes < 24 * 60)
        return (
          <>
            {s.label} {s.startsAt}–{s.endsAt}
            {show && <div><span className={`due-pill${due.late ? ' is-late' : ''}`}>{due.text}</span></div>}
          </>
        )
      },
    },
    { key: 'rider', header: 'Rider', sort: (a, b) => (riderOf(a)?.name ?? riderOf(a)?.email ?? '~').localeCompare(riderOf(b)?.name ?? riderOf(b)?.email ?? '~'), cell: (o) => { const r = riderOf(o); return r ? (r.name ?? r.email) : <span className="muted">—</span> } },
    { key: 'placed', header: 'Placed', sort: (a, b) => a.placedAt.localeCompare(b.placedAt), cell: (o) => dateTime(o.placedAt) },
    {
      key: 'peek',
      header: 'Peek',
      fixed: true,
      cell: (o) => (
        <button type="button" className="btn btn-small btn-icon" onClick={() => openPeek(o.id)} aria-keyshortcuts="Enter">
          <Eye aria-hidden="true" strokeWidth={1.75} />
          <span className="sr-only">Peek at {o.number}</span>
        </button>
      ),
    },
  ]

  const csvCols = [
    { header: 'Order', value: (o: OrderListItem) => o.number },
    { header: 'Customer', value: (o: OrderListItem) => o.customerName },
    { header: 'Items', value: (o: OrderListItem) => o.itemCount },
    { header: 'Total (₹)', value: (o: OrderListItem) => (o.total / 100).toFixed(2) },
    { header: 'Status', value: (o: OrderListItem) => ORDER_STATUS_LABEL[o.status] },
    { header: 'Delivery', value: (o: OrderListItem) => o.deliveryDate },
    { header: 'Slot', value: (o: OrderListItem) => slotOf(o)?.label ?? '' },
    { header: 'Rider', value: (o: OrderListItem) => riderOf(o)?.name ?? riderOf(o)?.email ?? '' },
    { header: 'Placed', value: (o: OrderListItem) => o.placedAt },
  ]

  return (
    <>
      <DataTable
        label="Orders"
        storageKey="orders"
        rows={items}
        columns={columns}
        rowKey={(o) => o.id}
        rowName={(o) => o.number}
        rowHref={(o) => `/orders/${o.id}`}
        onPeek={(o) => openPeek(o.id)}
        clickOpens
        activeKey={peekId}
        selectable={canAct}
        selected={selected}
        onSelectedChange={setSelected}
        bulk={(ids) => (
          <>
            <button type="button" className="btn btn-small" disabled={pack.isPending} onClick={() => pack.mutate(ids)}>
              Mark packed
            </button>
            {riders.length > 0 && (
              <label className="check-inline small">
                <span className="sr-only">Give the selected orders to</span>
                <select aria-label="Give the selected orders to" value="" disabled={assign.isPending} onChange={(e) => { if (e.target.value) assign.mutate({ riderId: e.target.value, ids }) }}>
                  <option value="">Assign rider…</option>
                  {riders.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name ?? r.email}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button type="button" className="btn btn-small" onClick={() => download(`orders-${istDate(0)}.csv`, rowsToCsv(items.filter((o) => ids.includes(o.id)), csvCols))}>
              Export CSV
            </button>
            <button type="button" className="btn btn-small" onClick={() => window.print()}>
              Print
            </button>
          </>
        )}
      />
      {peekId && <OrderPeek id={peekId} onClose={closePeek} />}
    </>
  )
}

/** The order at a glance: header, items, customer, the last steps, and the main actions. */
function OrderPeek({ id, onClose }: { id: string; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const q = useQuery({ queryKey: ['order', id], queryFn: () => api.order(id) })
  const step = useMutation({
    mutationFn: (status: 'PACKED') => api.setOrderStatus(id, status),
    onSuccess: () => {
      toast.success('Marked packed')
      void queryClient.invalidateQueries({ queryKey: ['order', id] })
      void queryClient.invalidateQueries({ queryKey: ['orders'] })
    },
    onError: (e) => toast.error(e),
  })
  const o = q.data
  return (
    <PeekDrawer title={o ? `Order ${o.number}` : 'Order'} onClose={onClose} openTo={`/orders/${id}`}>
      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <p className="mt-0">
            <OrderBadge status={o!.status} />
            {o!.backorder && (
              <>
                {' '}
                <BackorderBadge awaiting={o!.atRisk} />
              </>
            )}{' '}
            · {rupees(o!.total)} · delivery {date(o!.deliveryDate)}
            {o!.slot ? `, ${o!.slot.label} ${o!.slot.startsAt}–${o!.slot.endsAt}` : ''}
          </p>
          <dl>
            <dt>Customer</dt>
            <dd>{o!.customerName ?? '—'}</dd>
            <dt>Address</dt>
            <dd>
              {o!.deliveryAddress ?? '—'}
              {o!.pincode ? `, ${o!.pincode}` : ''}
            </dd>
            <dt>Items</dt>
            <dd>{o!.items.map((i) => `${i.quantity} × ${i.productName}${i.stage ? ` (${RIPENESS_LABEL[i.stage as Ripeness] ?? i.stage})` : ''}`).join(', ')}</dd>
            <dt>Placed</dt>
            <dd>{dateTime(o!.placedAt)}</dd>
          </dl>
          <div className="peek-actions">
            {o!.status === 'PROCESSING' && (
              <button type="button" className="btn btn-primary" disabled={step.isPending} onClick={() => step.mutate('PACKED')}>
                Mark packed
              </button>
            )}
            {o!.phone && (
              <a className="btn" href={telHref(o!.phone)}>
                Call<span className="sr-only"> {o!.customerName}</span>
              </a>
            )}
            <Link className="btn" to={`/deliveries?date=${o!.deliveryDate}&tab=unassigned`}>
              Deliveries for that day
            </Link>
          </div>
          {o!.events.length > 0 && (
            <div>
              <h3 className="h-small">History</h3>
              <ol className="peek-timeline">
                {o!.events.slice(-5).map((e, i) => (
                  <li key={i}>
                    <strong>{ORDER_STATUS_LABEL[e.status] ?? e.status}</strong> · {dateTime(e.createdAt)}
                    {e.reason ? <span className="muted"> · {e.reason}</span> : null}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </>
      )}
    </PeekDrawer>
  )
}
