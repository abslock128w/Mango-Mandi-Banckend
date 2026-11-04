import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bike, Clock, CornerDownLeft, Keyboard, MapPin, Moon, Package, PackagePlus, Pin, Search, ShoppingBag, Sun, Truck, Zap } from 'lucide-react'
import { api } from './api'
import { BATCH_STATUS_LABEL, ORDER_STATUS_LABEL, date, istDate } from './format'
import { remember, useRecent, type RecentItem } from './ops/prefs'
import { applyTheme, readTheme, shownTheme } from './theme'
import type { OrderDetail } from './types'
import { canSee } from './permissions'
import { useSession } from './session'
import type { NavGroup } from './nav'

interface Item {
  id: string
  group: string
  label: string
  hint?: string
  icon: ReactNode
  /** Where it goes, or `run` for an action done here (switching the theme). */
  to?: string
  run?: () => void
  /** Kept in Recent when opened. */
  recent?: RecentItem['kind']
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N} ]/gu, '')

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])
  return v
}

/**
 * Ctrl/Cmd+K: jump to any screen this role can see, or look up an order (number, phone or name, via
 * the orders search), a batch (variety, farm) or a pincode. Only lists the API already serves, and
 * only for roles that may read them. A combobox: arrow keys move, Enter opens, Escape closes.
 */
export default function CommandPalette({ groups, onClose, onShortcuts, pin }: { groups: NavGroup[]; onClose: () => void; onShortcuts?: () => void; pin?: { label: string; pinned: boolean; toggle: () => void } | null }) {
  const { me } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const [recent] = useRecent()
  const [text, setText] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const listId = useId()
  // ">" lists actions only; "#1042" jumps to that order.
  const actionsOnly = text.trimStart().startsWith('>')
  const jump = /^#\s*(\d{2,8})$/.exec(text.trim())?.[1] ?? null
  const term = actionsOnly ? text.trim().slice(1).trim() : jump ?? text.trim()
  const debounced = useDebounced(term, jump ? 0 : 250)

  const ordersOn = canSee(me?.role, 'orders')
  const batchesOn = canSee(me?.role, 'batches')
  const pincodesOn = canSee(me?.role, 'pincodes')

  const orders = useQuery({
    queryKey: ['palette-orders', debounced],
    queryFn: () => api.orders({ q: debounced, page: 1 }),
    enabled: ordersOn && (debounced.length >= 3 || (Boolean(jump) && debounced.length >= 2)),
    staleTime: 30_000,
  })
  const batches = useQuery({ queryKey: ['palette-batches'], queryFn: () => api.batches(null), enabled: batchesOn && term.length >= 2, staleTime: 60_000 })
  const pincodes = useQuery({ queryKey: ['palette-pincodes'], queryFn: api.pincodes, enabled: pincodesOn && /^\d{2,6}$/.test(term), staleTime: 60_000 })

  // Back to where focus was when the palette closes.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    input.current?.focus()
    return () => previous?.focus?.()
  }, [])

  // The order open on this page, if any: its actions come first ("Assign rider to ORD-1042").
  const here = /^\/orders\/([^/]+)$/.exec(location.pathname)?.[1]
  const hereOrder = here ? queryClient.getQueryData<OrderDetail>(['order', here]) : undefined

  const actions = useMemo<Item[]>(() => {
    const role = me?.role
    const today = istDate(0)
    const tomorrow = istDate(1)
    const floor = role === 'MANAGER' || role === 'OPERATOR'
    const theme = shownTheme(readTheme()) === 'dark' ? 'light' : 'dark'
    const list: (Item | false)[] = [
      Boolean(hereOrder) && floor && !['DELIVERED', 'CANCELLED', 'RTO', 'PAYMENT_PENDING'].includes(hereOrder!.status) && {
        id: 'act:assign-here', group: 'Actions', label: `Assign rider to ${hereOrder!.number}`, hint: `delivery ${date(hereOrder!.deliveryDate)}`,
        icon: <Bike aria-hidden="true" strokeWidth={1.75} />, to: `/deliveries?date=${hereOrder!.deliveryDate}&tab=unassigned&stop=${hereOrder!.id}`,
      },
      canSee(role, 'batches') && { id: 'act:receive', group: 'Actions', label: 'Receive a batch', icon: <PackagePlus aria-hidden="true" strokeWidth={1.75} />, to: '/batches?receive=1' },
      floor && { id: 'act:dispatch', group: 'Actions', label: "Dispatch today's run", hint: 'Deliveries, by slot', icon: <Truck aria-hidden="true" strokeWidth={1.75} />, to: `/deliveries?date=${today}&tab=slot` },
      floor && { id: 'act:assign', group: 'Actions', label: 'Give stops without a rider to riders', hint: 'today', icon: <Zap aria-hidden="true" strokeWidth={1.75} />, to: `/deliveries?date=${today}&tab=unassigned` },
      canSee(role, 'packList') && { id: 'act:pack', group: 'Actions', label: 'Open the pack list for tomorrow', icon: <Package aria-hidden="true" strokeWidth={1.75} />, to: `/pack-list?date=${tomorrow}` },
      { id: 'act:theme', group: 'Actions', label: `Switch to ${theme} theme`, icon: theme === 'dark' ? <Moon aria-hidden="true" strokeWidth={1.75} /> : <Sun aria-hidden="true" strokeWidth={1.75} />, run: () => applyTheme(theme) },
      Boolean(pin) && { id: 'act:pin', group: 'Actions', label: pin!.pinned ? `Unpin ${pin!.label}` : `Pin ${pin!.label} to the sidebar`, icon: <Pin aria-hidden="true" strokeWidth={1.75} />, run: pin!.toggle },
      Boolean(onShortcuts) && { id: 'act:keys', group: 'Actions', label: 'Keyboard shortcuts', icon: <Keyboard aria-hidden="true" strokeWidth={1.75} />, run: onShortcuts },
    ]
    return list.filter((x): x is Item => Boolean(x))
  }, [me?.role, hereOrder, pin, onShortcuts])

  const items = useMemo<Item[]>(() => {
    const q = norm(term)
    const acts = actions.filter((a) => !q || norm(`${a.label} ${a.hint ?? ''}`).includes(q))
    if (actionsOnly) return acts
    if (jump) {
      const hit = (orders.data?.items ?? []).find((o) => o.number.replace(/\D/g, '').endsWith(jump))
      const out: Item[] = hit
        ? [{ id: `order:${hit.id}`, group: 'Orders', label: hit.number, hint: [hit.customerName, ORDER_STATUS_LABEL[hit.status]].filter(Boolean).join(' · '), icon: <ShoppingBag aria-hidden="true" strokeWidth={1.75} />, to: `/orders/${hit.id}`, recent: 'order' }]
        : []
      out.push({ id: 'order-search', group: 'Orders', label: `Search orders for “${jump}”`, icon: <Search aria-hidden="true" strokeWidth={1.75} />, to: `/orders?q=${encodeURIComponent(jump)}` })
      return out
    }
    const pages: Item[] = groups.flatMap((g) =>
      g.links
        .filter((l) => !q || norm(`${l.label} ${g.label} ${l.keywords ?? ''}`).includes(q))
        .map((l) => ({ id: `page:${l.to}`, group: 'Go to', label: l.label, hint: g.label, icon: <l.icon aria-hidden="true" strokeWidth={1.75} />, to: l.to })),
    )
    const recentItems: Item[] = q
      ? []
      : recent.map((r) => ({ id: `recent:${r.id}`, group: 'Recent', label: r.label, hint: r.hint, icon: <Clock aria-hidden="true" strokeWidth={1.75} />, to: r.to }))
    // Typed: the screens it names first, then actions. Empty: a few actions, Recent, then screens.
    const out: Item[] = q ? [...pages, ...acts] : [...acts.slice(0, 4), ...recentItems, ...pages.slice(0, 8)]
    if (ordersOn && term.length >= 3) {
      for (const o of (orders.data?.items ?? []).slice(0, 6)) {
        out.push({
          id: `order:${o.id}`,
          group: 'Orders',
          label: o.number,
          hint: [o.customerName, ORDER_STATUS_LABEL[o.status], `delivery ${date(o.deliveryDate)}`].filter(Boolean).join(' · '),
          icon: <ShoppingBag aria-hidden="true" strokeWidth={1.75} />,
          to: `/orders/${o.id}`,
          recent: 'order',
        })
      }
      out.push({ id: 'order-search', group: 'Orders', label: `Search orders for “${term}”`, icon: <Search aria-hidden="true" strokeWidth={1.75} />, to: `/orders?q=${encodeURIComponent(term)}` })
    }
    if (batchesOn && q.length >= 2) {
      for (const b of (batches.data ?? []).filter((x) => norm(`${x.variety} ${x.farm ?? ''} ${x.id}`).includes(q)).slice(0, 5)) {
        out.push({
          id: `batch:${b.id}`,
          group: 'Batches',
          label: `${b.variety} batch`,
          hint: [`plucked ${date(b.pluckedOn)}`, b.farm, BATCH_STATUS_LABEL[b.status], `${b.available} available`].filter(Boolean).join(' · '),
          icon: <Package aria-hidden="true" strokeWidth={1.75} />,
          to: `/batches/${b.id}`,
          recent: 'batch',
        })
      }
    }
    if (pincodesOn && /^\d{2,6}$/.test(term)) {
      for (const p of (pincodes.data ?? []).filter((x) => x.pincode.startsWith(term)).slice(0, 5)) {
        out.push({
          id: `pin:${p.pincode}`,
          group: 'Pincodes',
          label: p.pincode,
          hint: [p.city, p.zone, p.active ? 'Delivering' : 'Not delivering'].filter(Boolean).join(' · '),
          icon: <MapPin aria-hidden="true" strokeWidth={1.75} />,
          to: '/pincodes',
        })
      }
    }
    return out
  }, [term, groups, ordersOn, batchesOn, pincodesOn, orders.data, batches.data, pincodes.data, actions, actionsOnly, jump, recent])

  useEffect(() => setActive(0), [term])
  const current = items[Math.min(active, items.length - 1)]
  const loading = (ordersOn && term.length >= 3 && (debounced !== term || orders.isFetching)) || (batchesOn && term.length >= 2 && batches.isPending)

  function go(item: Item | undefined) {
    if (!item) return
    if (item.recent && item.to) remember({ id: item.id, label: item.label, hint: item.hint, to: item.to, kind: item.recent })
    onClose()
    if (item.run) item.run()
    else if (item.to) navigate(item.to)
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (items.length ? (i + 1) % items.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (items.length ? (i - 1 + items.length) % items.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      go(current)
    } else if (e.key === 'Tab') {
      // One stop: the box. The list is reached with the arrow keys.
      e.preventDefault()
    }
  }

  useEffect(() => {
    if (!current) return
    panel.current?.querySelector(`[data-id="${CSS.escape(current.id)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [current])

  let lastGroup = ''
  return (
    <div
      className="backdrop palette-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search and jump to" ref={panel} onKeyDown={onKeyDown}>
        <div className="palette-input">
          <Search aria-hidden="true" className="palette-search-icon" strokeWidth={2} />
          <input
            ref={input}
            type="text"
            role="combobox"
            aria-label="Search screens, orders, batches and pincodes"
            aria-expanded={items.length > 0}
            aria-controls={listId}
            aria-activedescendant={current ? `${listId}-${current.id}` : undefined}
            aria-autocomplete="list"
            placeholder={ordersOn ? 'Jump to a screen, find an order, batch or pincode; > for actions, #1042 for an order' : 'Jump to a screen; > for actions'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="kbd" aria-hidden="true">
            Esc
          </kbd>
        </div>
        <ul className="palette-list" id={listId} role="listbox" aria-label="Results">
          {items.map((it, i) => {
            const head = it.group !== lastGroup ? it.group : null
            lastGroup = it.group
            return (
              <li key={it.id} role="presentation">
                {head && (
                  <div className="palette-group" role="presentation" aria-hidden="true">
                    {head}
                  </div>
                )}
                <div
                  id={`${listId}-${it.id}`}
                  data-id={it.id}
                  role="option"
                  aria-selected={i === active}
                  className={`palette-item${i === active ? ' active' : ''}`}
                  onMouseMove={() => setActive(i)}
                  onClick={() => go(it)}
                >
                  <span className="palette-icon">{it.icon}</span>
                  <span className="palette-label">
                    {it.label}
                    {it.hint && <span className="palette-hint"> {it.hint}</span>}
                  </span>
                  {i === active && <CornerDownLeft aria-hidden="true" className="palette-enter" strokeWidth={1.75} />}
                </div>
              </li>
            )
          })}
        </ul>
        {items.length === 0 && !loading && <p className="palette-empty">Nothing matches “{term}”.</p>}
        <p className="palette-foot" aria-live="polite">
          {loading ? 'Searching…' : `${items.length} ${items.length === 1 ? 'result' : 'results'}`}
          <span className="palette-keys" aria-hidden="true">
            <kbd className="kbd">↑</kbd>
            <kbd className="kbd">↓</kbd> to move · <kbd className="kbd">↵</kbd> to open
          </span>
        </p>
      </div>
    </div>
  )
}
