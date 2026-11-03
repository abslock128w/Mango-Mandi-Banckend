// DataTable (docs/design/ops-dashboard-v2.md §4): a working table, not a reading one. A sticky
// header with sortable columns, a column chooser kept per browser, row selection with a bulk bar,
// keyboard movement (j/k move between rows, x selects, Enter peeks, o opens the full page), a peek
// on click and 36px rows on a fine pointer. Below 640px the rows become cards (scrollRegion's cards).
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowDown, ArrowUp, ChevronsUpDown, Columns3 } from 'lucide-react'
import { usePref } from '../ops/prefs'
import { scrollRegion } from './core'

export interface Column<T> {
  key: string
  header: string
  cell: (row: T) => ReactNode
  /** Client-side sort on the rows shown (the page): a compare function. */
  sort?: (a: T, b: T) => number
  num?: boolean
  /** Card layout below 640px: card-title, card-status, card-wide. */
  card?: 'title' | 'status' | 'wide'
  /** Off by default; the column chooser turns it on. */
  hidden?: boolean
  /** The first column (the link) can't be hidden. */
  fixed?: boolean
}

type SortState = { key: string; dir: 'asc' | 'desc' } | null

export interface DataTableProps<T> {
  label: string
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  /** The full page of a row: the first column links to it and `o` opens it. */
  rowHref?: (row: T) => string
  /** A quick look (PeekDrawer): row click and Enter. Without it a row click opens rowHref. */
  onPeek?: (row: T) => void
  /** A row click opens rowHref even when there is a peek (Enter still peeks). */
  clickOpens?: boolean
  /** How a row is named to screen readers in "Select ORD-1042". */
  rowName: (row: T) => string
  selectable?: boolean
  selected?: string[]
  onSelectedChange?: (ids: string[]) => void
  /** The sticky bar shown while rows are selected. */
  bulk?: (ids: string[], clear: () => void) => ReactNode
  /** localStorage key for the chosen columns. */
  storageKey?: string
  /** Extra controls on the toolbar's right (export, print). */
  tools?: ReactNode
  /** A row the peek is showing (highlighted). */
  activeKey?: string | null
  className?: string
}

const NO_COLUMNS: string[] = []

export function DataTable<T>({
  label,
  rows,
  columns,
  rowKey,
  rowHref,
  onPeek,
  clickOpens = false,
  rowName,
  selectable = false,
  selected = NO_COLUMNS,
  onSelectedChange,
  bulk,
  storageKey,
  tools,
  activeKey,
  className,
}: DataTableProps<T>) {
  const navigate = useNavigate()
  const chooserId = useId()
  const body = useRef<HTMLTableSectionElement>(null)
  const [sort, setSort] = useState<SortState>(null)
  const [chooser, setChooser] = useState(false)
  const defaults = useMemo(() => columns.filter((c) => c.hidden).map((c) => c.key), [columns])
  const [hiddenStored, setHidden] = usePref<string[] | null>(`columns.${storageKey ?? label}`, null)
  const hidden = hiddenStored ?? defaults
  const shown = columns.filter((c) => c.fixed || !hidden.includes(c.key))

  const sorted = useMemo(() => {
    if (!sort) return rows
    const col = columns.find((c) => c.key === sort.key)
    if (!col?.sort) return rows
    const out = [...rows].sort(col.sort)
    return sort.dir === 'desc' ? out.reverse() : out
  }, [rows, sort, columns])

  const ids = sorted.map(rowKey)
  const chosen = new Set(selected)
  const allOn = ids.length > 0 && ids.every((id) => chosen.has(id))
  const someOn = ids.some((id) => chosen.has(id))
  const setSelected = (next: string[]) => onSelectedChange?.(next)
  const toggle = (id: string) => setSelected(chosen.has(id) ? selected.filter((x) => x !== id) : [...selected, id])
  const lastClicked = useRef<number | null>(null)

  // A row that left the list (filtered away, a new page) leaves the selection too.
  useEffect(() => {
    if (!selectable || selected.length === 0) return
    const keep = selected.filter((id) => ids.includes(id))
    if (keep.length !== selected.length) onSelectedChange?.(keep)
    // Only when the rows change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join('|')])

  function onHeader(c: Column<T>) {
    if (!c.sort) return
    setSort((s) => (s?.key !== c.key ? { key: c.key, dir: 'asc' } : s.dir === 'asc' ? { key: c.key, dir: 'desc' } : null))
  }

  function rowsEls() {
    return Array.from(body.current?.querySelectorAll<HTMLTableRowElement>('tr[data-key]') ?? [])
  }

  function onKeyDown(e: KeyboardEvent<HTMLTableSectionElement>) {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const target = e.target as HTMLElement
    if (target.closest('input, select, textarea, [contenteditable="true"]') && e.key !== 'Escape') {
      if (!(target instanceof HTMLInputElement && target.type === 'checkbox')) return
    }
    const tr = target.closest<HTMLTableRowElement>('tr[data-key]')
    const els = rowsEls()
    const i = tr ? els.indexOf(tr) : -1
    const row = i >= 0 ? sorted[i] : null
    if (e.key === 'j' || e.key === 'k') {
      e.preventDefault()
      const next = els[Math.min(els.length - 1, Math.max(0, i + (e.key === 'j' ? 1 : -1)))]
      next?.focus()
    } else if (e.key === 'x' && row && selectable) {
      e.preventDefault()
      toggle(rowKey(row))
    } else if (e.key === 'Enter' && row && target === tr) {
      e.preventDefault()
      if (onPeek) onPeek(row)
      else if (rowHref) navigate(rowHref(row))
    } else if (e.key === 'o' && row && rowHref) {
      e.preventDefault()
      navigate(rowHref(row))
    }
  }

  function onRowClick(e: MouseEvent<HTMLTableRowElement>, row: T, index: number) {
    const t = e.target as HTMLElement
    if (t.closest('a, button, input, select, label, textarea')) return
    if (selectable && e.shiftKey && lastClicked.current !== null) {
      const [a, b] = [lastClicked.current, index].sort((x, y) => x - y)
      setSelected([...new Set([...selected, ...ids.slice(a, b + 1)])])
      return
    }
    lastClicked.current = index
    if (onPeek && !clickOpens) onPeek(row)
    else if (rowHref) navigate(rowHref(row))
  }

  const clear = () => setSelected([])
  return (
    <div className={`data-table${className ? ` ${className}` : ''}`}>
      <div className="dt-toolbar">
        {selectable && selected.length > 0 && bulk ? (
          <div className="dt-bulk" role="region" aria-label="Selected rows">
            <span className="dt-bulk-count" role="status">
              {selected.length} selected
            </span>
            {bulk(selected, clear)}
            <button type="button" className="btn btn-small" onClick={clear}>
              Clear
            </button>
          </div>
        ) : (
          <span className="spacer" />
        )}
        {tools}
        <div
          className="dt-chooser"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && chooser) {
              e.stopPropagation()
              setChooser(false)
              ;(e.currentTarget.querySelector('button') as HTMLButtonElement | null)?.focus()
            }
          }}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setChooser(false)
          }}
        >
          <button type="button" className="btn btn-small" aria-expanded={chooser} aria-controls={chooserId} onClick={() => setChooser(!chooser)}>
            <Columns3 aria-hidden="true" strokeWidth={1.75} className="btn-icon-lead" />
            Columns
          </button>
          <fieldset id={chooserId} className="dt-chooser-menu" hidden={!chooser}>
            <legend className="sr-only">Columns to show in {label}</legend>
            {columns
              .filter((c) => !c.fixed)
              .map((c) => (
                <label key={c.key} className="check-inline">
                  <input
                    type="checkbox"
                    checked={!hidden.includes(c.key)}
                    onChange={(e) => setHidden(e.target.checked ? hidden.filter((k) => k !== c.key) : [...hidden, c.key])}
                  />
                  {c.header}
                </label>
              ))}
          </fieldset>
        </div>
      </div>
      <div {...scrollRegion(label, { cards: true })}>
        <table className="dt">
          <thead>
            <tr>
              {selectable && (
                <th className="dt-select">
                  <label className="dt-check">
                  <input
                    type="checkbox"
                    aria-label={`Select all ${rows.length} on this page`}
                    checked={allOn}
                    ref={(el) => {
                      if (el) el.indeterminate = !allOn && someOn
                    }}
                    onChange={() => setSelected(allOn ? selected.filter((id) => !ids.includes(id)) : [...new Set([...selected, ...ids])])}
                  />
                  </label>
                </th>
              )}
              {shown.map((c) => {
                const dir = sort?.key === c.key ? sort.dir : null
                return (
                  <th key={c.key} className={c.num ? 'num' : undefined} aria-sort={dir ? (dir === 'asc' ? 'ascending' : 'descending') : c.sort ? 'none' : undefined}>
                    {c.sort ? (
                      <button type="button" className="dt-sort" onClick={() => onHeader(c)}>
                        {c.header}
                        {dir === 'asc' ? <ArrowUp aria-hidden="true" /> : dir === 'desc' ? <ArrowDown aria-hidden="true" /> : <ChevronsUpDown aria-hidden="true" />}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody ref={body} onKeyDown={onKeyDown}>
            {sorted.map((row, index) => {
              const key = rowKey(row)
              const on = chosen.has(key)
              return (
                <tr
                  key={key}
                  data-key={key}
                  tabIndex={-1}
                  className={`dt-row${on ? ' is-selected' : ''}${activeKey === key ? ' is-active' : ''}${onPeek || rowHref ? ' is-clickable' : ''}`}
                  onClick={(e) => onRowClick(e, row, index)}
                >
                  {selectable && (
                    <td className="dt-select">
                      <label className="dt-check">
                        <input type="checkbox" aria-label={`Select ${rowName(row)}`} checked={on} onChange={() => toggle(key)} />
                      </label>
                    </td>
                  )}
                  {shown.map((c, ci) => (
                    <td
                      key={c.key}
                      className={[c.num ? 'num' : '', c.card ? `card-${c.card}` : ''].filter(Boolean).join(' ') || undefined}
                      data-label={c.card ? undefined : c.header}
                    >
                      {ci === 0 && rowHref ? (
                        <Link to={rowHref(row)} className="dt-link">
                          {c.cell(row)}
                        </Link>
                      ) : (
                        c.cell(row)
                      )}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** The CSV of the rows and columns shown (for "Export CSV" on a page without a server export). */
export function rowsToCsv<T>(rows: T[], columns: { header: string; value: (row: T) => string | number | null | undefined }[]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [columns.map((c) => esc(c.header)).join(','), ...rows.map((r) => columns.map((c) => esc(c.value(r))).join(','))].join('\n')
}
