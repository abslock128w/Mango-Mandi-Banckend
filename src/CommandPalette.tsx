import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CornerDownLeft, MapPin, Package, Search, ShoppingBag } from 'lucide-react'
import { api } from './api'
import { BATCH_STATUS_LABEL, ORDER_STATUS_LABEL, date } from './format'
import { canSee } from './permissions'
import { useSession } from './session'
import type { NavGroup } from './nav'

interface Item {
  id: string
  group: string
  label: string
  hint?: string
  icon: ReactNode
  to: string
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
export default function CommandPalette({ groups, onClose }: { groups: NavGroup[]; onClose: () => void }) {
  const { me } = useSession()
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const listId = useId()
  const term = text.trim()
  const debounced = useDebounced(term, 250)

  const ordersOn = canSee(me?.role, 'orders')
  const batchesOn = canSee(me?.role, 'batches')
  const pincodesOn = canSee(me?.role, 'pincodes')

  const orders = useQuery({
    queryKey: ['palette-orders', debounced],
    queryFn: () => api.orders({ q: debounced, page: 1 }),
    enabled: ordersOn && debounced.length >= 3,
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

  const items = useMemo<Item[]>(() => {
    const q = norm(term)
    const pages: Item[] = groups.flatMap((g) =>
      g.links
        .filter((l) => !q || norm(`${l.label} ${g.label} ${l.keywords ?? ''}`).includes(q))
        .map((l) => ({ id: `page:${l.to}`, group: 'Go to', label: l.label, hint: g.label, icon: <l.icon aria-hidden="true" strokeWidth={1.75} />, to: l.to })),
    )
    const out: Item[] = q ? pages : pages.slice(0, 8)
    if (ordersOn && term.length >= 3) {
      for (const o of (orders.data?.items ?? []).slice(0, 6)) {
        out.push({
          id: `order:${o.id}`,
          group: 'Orders',
          label: o.number,
          hint: [o.customerName, ORDER_STATUS_LABEL[o.status], `delivery ${date(o.deliveryDate)}`].filter(Boolean).join(' · '),
          icon: <ShoppingBag aria-hidden="true" strokeWidth={1.75} />,
          to: `/orders/${o.id}`,
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
  }, [term, groups, ordersOn, batchesOn, pincodesOn, orders.data, batches.data, pincodes.data])

  useEffect(() => setActive(0), [term])
  const current = items[Math.min(active, items.length - 1)]
  const loading = (ordersOn && term.length >= 3 && (debounced !== term || orders.isFetching)) || (batchesOn && term.length >= 2 && batches.isPending)

  function go(item: Item | undefined) {
    if (!item) return
    onClose()
    navigate(item.to)
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
            placeholder={ordersOn ? 'Jump to a screen, or find an order, batch or pincode…' : 'Jump to a screen…'}
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
