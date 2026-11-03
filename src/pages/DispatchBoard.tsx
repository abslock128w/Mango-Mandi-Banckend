// The Dispatch board (docs/design/ops-dashboard-v2.md §3), for managers and operators: the day's
// stops and riders on the left, the map on the right (from 1024px; a List / Map switch below).
// Tabs: Unassigned (on top, Onfleet style), By rider, By slot (the run sheet, which also prints)
// and Done. Stops are picked with their checkbox, `x` or shift-click, then given to a rider,
// to the nearest riders, or sent out from the bar at the bottom. Hovering a row lights its pin and
// the other way round; a stop opens in the peek drawer. Riders keep their one-stop route view.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { RIPENESS_LABEL, telHref } from '../format'
import { canSee } from '../permissions'
import { useSession } from '../session'
import { liveQuery, useNow } from '../ops/useQueue'
import { ago, clock, dueOf, freshness, minutesSince } from '../ops/time'
import type { LiveBoard, LiveRider } from '../ops/types'
import type { Manifest, ManifestOrder, Rider } from '../types'
import { Badge, MapView, OrderBadge, PeekDrawer, Tabs, freshnessOpacity, tabPanelProps, usePeek, useToast, type MapMarker, type MapTrail } from '../ui'

type Run = Manifest['runs'][number]
export type BoardTab = 'unassigned' | 'riders' | 'slot' | 'done'
const TABS: BoardTab[] = ['unassigned', 'riders', 'slot', 'done']
/** Ready to go out: packed, handed over, or back for a retry. */
const READY = new Set(['PACKED', 'SHIPPED', 'DELIVERY_FAILED'])
const FINISHED = new Set(['DELIVERED', 'CANCELLED', 'RTO'])
const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

interface BoardStop {
  o: ManifestOrder
  pincode: string
  area: string | null
  slot: Run['slot']
  lat: number | null
  lng: number | null
  dueAt: string | null
}

const EARTH_KM = 6371
const rad = (d: number) => (d * Math.PI) / 180
/** Straight-line km (as the nearest-rider rule measures). */
export function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}
const at = (x: { lat: number | null; lng: number | null } | undefined | null) => (x && x.lat !== null && x.lng !== null ? { lat: x.lat, lng: x.lng } : null)

const tone = (status: string) => (status === 'OUT_FOR_DELIVERY' ? 'out' : status === 'DELIVERY_FAILED' ? 'failed' : FINISHED.has(status) ? 'shipped' : READY.has(status) ? 'packed' : 'confirmed')
const riderName = (r: { name?: string | null; email?: string | null } | null | undefined) => r?.name ?? r?.email ?? 'a rider'
const initial = (s: string) => s.trim().charAt(0).toUpperCase() || '?'

export function DispatchBoard({ day, manifest, riders, bySlot, onRefresh }: { day: string; manifest: Manifest; riders: Rider[]; bySlot: ReactNode; onRefresh: () => void }) {
  const { me } = useSession()
  const toast = useToast()
  const queryClient = useQueryClient()
  const nowMs = useNow(30_000)
  const [params, setParams] = useSearchParams()
  const tab: BoardTab = (TABS as string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as BoardTab) : 'slot'
  const setTab = (t: BoardTab) => {
    const p = new URLSearchParams(params)
    p.set('tab', t)
    setParams(p, { replace: true })
  }
  const [view, setView] = useState<'list' | 'map'>('list')
  const [selected, setSelected] = useState<string[]>([])
  const [hover, setHover] = useState<string | null>(null)
  const [showDone, setShowDone] = useState(false)
  const [showTrails, setShowTrails] = useState(false)
  const [results, setResults] = useState<{ number: string; text: string }[] | null>(null)
  const [peekId, openPeek, closePeek] = usePeek('stop')
  const live = useQuery(liveQuery(day))
  const board: LiveBoard | undefined = live.data

  const stops: BoardStop[] = useMemo(() => {
    const byId = new Map((board?.stops ?? []).map((s) => [s.orderId, s]))
    return manifest.runs.flatMap((r) =>
      r.stops.flatMap((st) =>
        st.orders.map((o) => {
          const l = byId.get(o.id)
          return { o, pincode: st.pincode, area: st.zone ?? st.city ?? null, slot: r.slot, lat: l?.lat ?? null, lng: l?.lng ?? null, dueAt: l?.dueAt ?? null }
        }),
      ),
    )
  }, [manifest, board])

  const unassigned = stops.filter((s) => !s.o.rider && !FINISHED.has(s.o.status))
  const done = stops.filter((s) => FINISHED.has(s.o.status))
  const liveRiders: LiveRider[] = board?.riders.length
    ? board.riders
    : riders.map((r) => ({ id: r.id, email: r.email, name: r.name ?? r.email, phone: null, lat: null, lng: null, accuracy: null, lastAt: null, stopsLeft: 0, stopsDone: 0 }))
  const warehouse = board?.warehouses.find((w) => w.lat !== null) ?? null

  // Rider trails: the day's positions of the riders out, on demand.
  const trailQs = useQueries({
    queries: (showTrails ? liveRiders.filter((r) => r.stopsLeft > 0 || r.lastAt) : []).map((r) => ({
      queryKey: ['trail', r.id, day],
      queryFn: () => api.riderTrail(r.id, day),
      staleTime: 60_000,
    })),
  })
  const trails: MapTrail[] = trailQs.flatMap((q) => (q.data ? [{ id: q.data.riderId, points: q.data.points.filter((p) => nowMs - new Date(p.at).getTime() < 2 * 3_600_000).map((p) => [p.lat, p.lng] as [number, number]) }] : []))

  // One pin per pincode centre (stops have no coordinates of their own): a count when several share it.
  const pins = useMemo(() => {
    const out = new Map<string, BoardStop[]>()
    for (const s of stops) {
      if (s.lat === null || s.lng === null) continue
      if (!showDone && FINISHED.has(s.o.status)) continue
      const key = `pin:${s.pincode}`
      out.set(key, [...(out.get(key) ?? []), s])
    }
    return out
  }, [stops, showDone])
  const markers: MapMarker[] = [
    ...(board?.warehouses ?? []).filter((w) => at(w)).map((w): MapMarker => ({ id: `wh:${w.id}`, kind: 'warehouse', lat: w.lat!, lng: w.lng!, label: `${w.name} (warehouse)` })),
    ...[...pins].map(([key, list]): MapMarker => {
      const worst = list.find((s) => s.o.status === 'DELIVERY_FAILED') ?? list.find((s) => !s.o.rider && !FINISHED.has(s.o.status)) ?? list[0]
      return {
        id: key, kind: 'stop', lat: list[0].lat!, lng: list[0].lng!, tone: tone(worst.o.status), badge: list.length > 1 ? String(list.length) : undefined,
        label: `${list[0].pincode}${list[0].area ? ` · ${list[0].area}` : ''}: ${list.map((s) => s.o.number).join(', ')}`,
      }
    }),
    ...liveRiders.filter((r) => at(r)).map((r): MapMarker => ({ id: `rider:${r.id}`, kind: 'rider', lat: r.lat!, lng: r.lng!, label: `${r.name}: ${ago(nowMs, r.lastAt) ?? 'no position'}, ${n(r.stopsLeft, 'stop', 'stops')} left`, opacity: freshnessOpacity(minutesSince(nowMs, r.lastAt)) })),
  ]

  const refresh = () => {
    onRefresh()
    void queryClient.invalidateQueries({ queryKey: ['live', day] })
    void queryClient.invalidateQueries({ queryKey: ['day', day] })
  }
  const assign = useMutation({
    mutationFn: ({ riderId, orderIds }: { riderId: string | null; orderIds: string[] }) => api.assignRiders({ date: day, riderId, orderIds }),
    onSuccess: (r, v) => {
      const who = v.riderId ? liveRiders.find((x) => x.id === v.riderId)?.name ?? 'the rider' : 'nobody'
      toast.success(`${n(r.assigned.length, 'stop', 'stops')} given to ${who}`)
      setSelected([])
      refresh()
    },
    onError: (e) => toast.error(e),
  })
  const nearest = useMutation({
    mutationFn: (orderIds: string[]) => api.autoAssignSome(day, orderIds),
    onSuccess: (r) => {
      if (!r.assigned.length) toast.error(r.riders ? 'These stops already have riders' : 'There are no riders yet: add one on Staff, with the role Rider')
      else toast.success(`${n(r.assigned.length, 'stop', 'stops')} given to the nearest riders`)
      setResults(r.assigned.map((a) => ({ number: a.number, text: `${a.riderName}${a.riderKm !== null ? `, ${a.riderKm} km away` : ''}${a.warehouseName ? `, pick up at ${a.warehouseName}` : ''}` })))
      setSelected([])
      refresh()
    },
    onError: (e) => toast.error(e),
  })
  const dispatch = useMutation({
    mutationFn: async (orderIds: string[]) => {
      const sent: string[] = []
      const skipped: string[] = []
      for (const id of orderIds) {
        const s = stops.find((x) => x.o.id === id)
        if (!s || !READY.has(s.o.status)) {
          if (s) skipped.push(s.o.number)
          continue
        }
        await api.dispatch(id)
        sent.push(s.o.number)
      }
      return { sent, skipped }
    },
    onSuccess: ({ sent, skipped }) => {
      if (sent.length) toast.success(`${n(sent.length, 'stop', 'stops')} out for delivery`)
      if (skipped.length) toast.info(`Not sent (not packed, or already out): ${skipped.join(', ')}`)
      setSelected([])
      refresh()
    },
    onError: (e) => toast.error(e),
  })
  const busy = assign.isPending || nearest.isPending || dispatch.isPending

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const peek = peekId ? stops.find((s) => s.o.id === peekId) ?? null : null
  // A selection is for the stops on show: switching tab clears it.
  useEffect(() => setSelected([]), [tab])
  const pickerRef = useRef<HTMLSelectElement>(null)

  function onListKey(e: KeyboardEvent<HTMLElement>) {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const t = e.target as HTMLElement
    const row = t.closest<HTMLElement>('[data-stop]')
    if (e.key === 'a' && selected.length && !(t instanceof HTMLSelectElement)) {
      e.preventDefault()
      pickerRef.current?.focus()
      return
    }
    if (!row || (t instanceof HTMLInputElement && t.type !== 'checkbox') || t instanceof HTMLSelectElement) return
    const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-stop]'))
    const i = rows.indexOf(row)
    if (e.key === 'j' || e.key === 'k') {
      e.preventDefault()
      rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'j' ? 1 : -1)))]?.focus()
    } else if (e.key === 'x') {
      e.preventDefault()
      toggle(row.dataset.stop!)
    } else if (e.key === 'Enter' && t === row) {
      e.preventDefault()
      openPeek(row.dataset.stop!)
    }
  }

  const stopRow = (s: BoardStop, opts: { select?: boolean } = {}) => {
    const due = !FINISHED.has(s.o.status) ? dueOf(nowMs, s.dueAt) : null
    const on = hover === `pin:${s.pincode}` || peekId === s.o.id
    const chosen = selected.includes(s.o.id)
    return (
      <li
        key={s.o.id}
        data-stop={s.o.id}
        tabIndex={-1}
        className={`stop-row${on ? ' is-on' : ''}${chosen ? ' is-selected' : ''}`}
        onMouseEnter={() => setHover(`pin:${s.pincode}`)}
        onMouseLeave={() => setHover(null)}
        aria-label={s.o.number}
      >
        {opts.select ? (
          <input type="checkbox" aria-label={`Select ${s.o.number}`} checked={chosen} onChange={() => toggle(s.o.id)} />
        ) : (
          <span className="avatar-sm" aria-hidden="true">
            {initial(s.o.rider ? riderName(s.o.rider) : '–')}
          </span>
        )}
        <div className="stop-main">
          <div className="stop-line1">
            <button type="button" className="stop-open" onClick={() => openPeek(s.o.id)}>
              {s.o.number}
            </button>
            <span>{s.o.customerName ?? '—'}</span>
            {s.slot && <Badge>{s.slot.label}</Badge>}
          </div>
          <div className="stop-line2">
            {s.pincode}
            {s.area ? ` · ${s.area}` : ''} · {n(s.o.boxes, 'box', 'boxes')}
            {s.o.rider ? ` · ${riderName(s.o.rider)}` : ''}
          </div>
        </div>
        <div className="stop-side">
          {s.o.packed ? <OrderBadge status={s.o.status} /> : <Badge tone="warn">Not packed yet</Badge>}
          {due && <span className={`due-pill${due.late ? ' is-late' : ''}`}>{due.text}</span>}
        </div>
      </li>
    )
  }

  const selectable = tab === 'unassigned'
  const riderOptions = liveRiders.map((r) => {
    const first = stops.find((s) => s.o.id === selected[0])
    const d = first && at(r) && at(first) ? km(at(r)!, at(first)!) : null
    return { id: r.id, text: `${r.name}${d !== null ? ` · ${d.toFixed(1)} km` : ''} · ${n(r.stopsLeft, 'stop', 'stops')} left` }
  })

  return (
    <div className="board" data-view={view}>
      <div className="segmented board-switch no-print" role="group" aria-label="Show the board as">
        <button type="button" className="btn" aria-pressed={view === 'list'} onClick={() => setView('list')}>
          List
        </button>
        <button type="button" className="btn" aria-pressed={view === 'map'} onClick={() => setView('map')}>
          Map
        </button>
      </div>
      <div className="board-list">
        <div className="board-tabs no-print">
          <Tabs
            id="board"
            label="Stops"
            value={tab}
            onChange={setTab}
            tabs={[
              ['unassigned', `Unassigned (${unassigned.length})`],
              ['riders', 'By rider'],
              ['slot', 'By slot'],
              ['done', `Done (${done.length})`],
            ]}
          />
        </div>
        <div {...tabPanelProps('board', tab)} onKeyDown={onListKey}>
          {tab === 'slot' && bySlot}
          {tab === 'unassigned' &&
            (unassigned.length === 0 ? (
              <p className="muted">Every stop on this day has a rider.</p>
            ) : (
              <>
                <label className="check-inline small">
                  <input
                    type="checkbox"
                    checked={unassigned.every((s) => selected.includes(s.o.id))}
                    onChange={(e) => setSelected(e.target.checked ? unassigned.map((s) => s.o.id) : [])}
                  />
                  Select all {unassigned.length}
                </label>
                <ul className="stop-rows" aria-label="Stops without a rider">
                  {unassigned.map((s) => stopRow(s, { select: true }))}
                </ul>
              </>
            ))}
          {tab === 'riders' && (
            <div className="rider-lanes">
              {liveRiders.length === 0 && <p className="muted">No riders yet: add one on Staff, with the role Rider.</p>}
              {liveRiders.map((r) => {
                const mine = stops.filter((s) => s.o.rider?.id === r.id)
                const left = mine.filter((s) => !FINISHED.has(s.o.status))
                const fresh = freshness(nowMs, r.lastAt)
                const toWh = warehouse && at(r) ? km(at(r)!, at(warehouse)!) : null
                return (
                  <section key={r.id} className="rider-lane" aria-labelledby={`lane-${r.id}`} onMouseEnter={() => setHover(`rider:${r.id}`)} onMouseLeave={() => setHover(null)}>
                    <div className="rider-lane-head">
                      <span className="avatar-sm" aria-hidden="true">
                        {initial(r.name)}
                      </span>
                      <h3 id={`lane-${r.id}`}>{r.name}</h3>
                      <span className="small muted">
                        {mine.length - left.length} done · {left.length} left
                      </span>
                      <span className={`seen seen-${fresh}`}>{r.lastAt ? `Seen ${ago(nowMs, r.lastAt)}` : 'No position'}</span>
                      {toWh !== null && <span className="small muted">{toWh.toFixed(1)} km from {warehouse!.name}</span>}
                      {r.phone && (
                        <a className="btn btn-small" href={telHref(r.phone)}>
                          Call<span className="sr-only"> {r.name}</span>
                        </a>
                      )}
                    </div>
                    {mine.length > 0 ? <ul className="stop-rows mt-2" aria-label={`${r.name}'s stops`}>{mine.map((s) => stopRow(s))}</ul> : <p className="small muted mb-0">No stops on this day.</p>}
                  </section>
                )
              })}
            </div>
          )}
          {tab === 'done' && (done.length === 0 ? <p className="muted">Nothing delivered yet on this day.</p> : <ul className="stop-rows" aria-label="Done">{done.map((s) => stopRow(s))}</ul>)}
        </div>

        {results && (
          <div className="card mt-3" role="status" aria-label="Nearest riders">
            <div className="topbar">
              <strong>Given to the nearest riders</strong>
              <span className="spacer" />
              <button type="button" className="link-btn" onClick={() => setResults(null)}>
                Hide
              </button>
            </div>
            <ul className="assign-results">
              {results.map((x) => (
                <li key={x.number}>
                  <span className="mono">{x.number}</span>: {x.text}
                </li>
              ))}
            </ul>
          </div>
        )}

        {selectable && selected.length > 0 && (
          <div className="board-bar no-print" role="region" aria-label="Selected stops">
            <span className="board-bar-count" role="status">
              {selected.length} selected
            </span>
            <label className="check-inline small">
              <span className="sr-only">Assign the selected stops to</span>
              <select
                ref={pickerRef}
                aria-label="Assign the selected stops to"
                aria-keyshortcuts="a"
                value=""
                disabled={busy}
                onChange={(e) => { if (e.target.value) assign.mutate({ riderId: e.target.value, orderIds: selected }) }}
              >
                <option value="">Assign to…</option>
                {riderOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.text}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn btn-small" disabled={busy} onClick={() => nearest.mutate(selected)}>
              {nearest.isPending ? 'Assigning…' : 'Assign nearest'}
            </button>
            <button type="button" className="btn btn-small" disabled={busy} onClick={() => dispatch.mutate(selected)}>
              Dispatch
            </button>
            <button type="button" className="btn btn-small" onClick={() => window.print()}>
              Print run sheet
            </button>
            <button type="button" className="link-btn" onClick={() => setSelected([])}>
              Clear
            </button>
          </div>
        )}
      </div>

      <div className="board-map no-print">
        <div className="layer-toggles">
          <label className="check-inline">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
            Done stops
          </label>
          <label className="check-inline">
            <input type="checkbox" checked={showTrails} onChange={(e) => setShowTrails(e.target.checked)} />
            Rider trails (2 h)
          </label>
        </div>
        <MapView
          label="Map of the day's stops, riders and warehouses"
          markers={markers}
          trails={trails}
          highlight={hover}
          fitKey={day}
          onHover={setHover}
          onSelect={(id) => {
            if (id.startsWith('pin:')) {
              const list = pins.get(id)
              if (list?.length) openPeek(list[0].o.id)
            } else if (id.startsWith('rider:')) setTab('riders')
          }}
          empty={live.isError ? 'The map could not load: the list has every stop.' : markers.length === 0 ? 'No places to show: pincodes need a place on the map (Pincodes).' : null}
        />
      </div>

      {peek && (
        <StopPeek
          s={peek}
          others={(pins.get(`pin:${peek.pincode}`) ?? []).filter((x) => x.o.id !== peek.o.id)}
          nowMs={nowMs}
          riders={riderOptions}
          busy={busy}
          canOpen={canSee(me?.role, 'orderDetail')}
          onClose={closePeek}
          onPeek={openPeek}
          onAssign={(riderId) => assign.mutate({ riderId, orderIds: [peek.o.id] })}
          onSend={() => dispatch.mutate([peek.o.id])}
        />
      )}
    </div>
  )
}

function StopPeek({
  s,
  others,
  nowMs,
  riders,
  busy,
  canOpen,
  onClose,
  onPeek,
  onAssign,
  onSend,
}: {
  s: BoardStop
  others: BoardStop[]
  nowMs: number
  riders: { id: string; text: string }[]
  busy: boolean
  canOpen: boolean
  onClose: () => void
  onPeek: (id: string) => void
  onAssign: (riderId: string | null) => void
  onSend: () => void
}) {
  const due = dueOf(nowMs, s.dueAt)
  return (
    <PeekDrawer title={`Stop ${s.o.number}`} onClose={onClose} openTo={canOpen ? `/orders/${s.o.id}` : undefined}>
      <p className="mt-0">
        {s.o.packed ? <OrderBadge status={s.o.status} /> : <Badge tone="warn">Not packed yet</Badge>}{' '}
        {due && !FINISHED.has(s.o.status) && <span className={`due-pill${due.late ? ' is-late' : ''}`}>{due.text}</span>}
      </p>
      <dl>
        <dt>Customer</dt>
        <dd>{s.o.customerName ?? '—'}</dd>
        <dt>Address</dt>
        <dd>
          {s.o.deliveryAddress ?? 'No address'}, {s.pincode}
          {s.area ? ` · ${s.area}` : ''}
        </dd>
        <dt>Slot</dt>
        <dd>{s.slot ? `${s.slot.label} ${s.slot.startsAt}–${s.slot.endsAt}${s.dueAt ? `, due by ${clock(s.dueAt)}` : ''}` : 'No slot'}</dd>
        <dt>Boxes</dt>
        <dd>{s.o.items.map((i) => `${i.quantity} × ${i.productName}${i.stage ? ` (${RIPENESS_LABEL[i.stage]})` : ''}`).join(', ')}</dd>
        <dt>Rider</dt>
        <dd>{s.o.rider ? riderName(s.o.rider) : 'Nobody yet'}</dd>
      </dl>
      <div className="peek-actions">
        {!FINISHED.has(s.o.status) && riders.length > 0 && (
          <label className="check-inline">
            <span className="sr-only">Rider for {s.o.number}</span>
            <select aria-label={`Give ${s.o.number} to`} value="" disabled={busy} onChange={(e) => e.target.value && onAssign(e.target.value === 'none' ? null : e.target.value)}>
              <option value="">{s.o.rider ? 'Give to another rider…' : 'Give to a rider…'}</option>
              {riders.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.text}
                </option>
              ))}
              {s.o.rider && <option value="none">Nobody</option>}
            </select>
          </label>
        )}
        {READY.has(s.o.status) && (
          <button type="button" className="btn" disabled={busy} onClick={onSend}>
            Send out<span className="sr-only"> {s.o.number}</span>
          </button>
        )}
        {s.o.phone && (
          <a className="btn" href={telHref(s.o.phone)}>
            Call<span className="sr-only"> {s.o.customerName}</span>
          </a>
        )}
      </div>
      {others.length > 0 && (
        <div>
          <h3 className="h-small">Also at {s.pincode}</h3>
          <ul className="peek-timeline">
            {others.map((x) => (
              <li key={x.o.id}>
                <button type="button" className="stop-open" onClick={() => onPeek(x.o.id)}>
                  {x.o.number}
                </button>{' '}
                {x.o.customerName ?? ''}
              </li>
            ))}
          </ul>
        </div>
      )}
      {canOpen && (
        <p className="small muted mb-0">
          Press <kbd className="kbd">o</kbd> or <Link to={`/orders/${s.o.id}`}>open the order</Link> for its history and every action.
        </p>
      )}
    </PeekDrawer>
  )
}
