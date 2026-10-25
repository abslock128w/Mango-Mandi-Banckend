// Boxes: scan or type a label to open one, or list them by state and pick
// several to write off together.

import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useInfiniteQuery, useMutation } from '@tanstack/react-query'
import { date } from '../../format'
import { Badge, EmptyState, FormError, QueryError, Spinner, scrollRegion, usePageTitle } from '../../ui'
import { useWh } from '../access'
import { wh } from '../api'
import { HOLD_LABEL, LIFECYCLE_LABEL, QUALITY_LABEL, qualityTone } from '../labels'
import type { Lifecycle, WriteOffResult } from '../types'
import { WriteOffDialog } from '../WriteOffDialog'

const RESOLVE_ERROR: Record<string, string> = {
  UNKNOWN_CODE: 'No box in this warehouse has that label.',
  MALFORMED_CODE: 'Not a MandiMangoes label.',
  INVALID_CHECK_DIGIT: 'That code has a typo: check the last character.',
  TOO_LONG: 'Too long to be a label.',
  WRONG_LABEL_TYPE: 'That is not a box label.',
}

export default function Boxes() {
  usePageTitle('Boxes')
  const navigate = useNavigate()
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const find = useMutation({
    mutationFn: wh.resolve,
    onSuccess: (r) => {
      if (r.kind === 'box') navigate(`/warehouse/boxes/${r.box.id}`)
      else if (r.kind === 'location') setError(`That is the ${r.location.name} location label. Open Locations to see it.`)
      else setError(RESOLVE_ERROR[r.code] ?? 'That label was not found.')
    },
  })
  function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!input.trim()) return setError('Scan or type a box code.')
    find.mutate(input.trim())
  }
  return (
    <>
      <div className="topbar">
        <h1>Boxes</h1>
      </div>
      <form className="card narrow" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="box-find">Scan or type a box code</label>
          <input id="box-find" value={input} onChange={(e) => setInput(e.target.value)} autoFocus autoComplete="off" autoCapitalize="characters" spellCheck={false} />
        </div>
        <FormError error={error ?? find.error} />
        <button type="submit" className="btn btn-primary" disabled={find.isPending}>
          {find.isPending ? 'Finding…' : 'Open box'}
        </button>
      </form>
      <BoxList />
    </>
  )
}

const LIST_STATES: Lifecycle[] = ['in_stock', 'returned', 'missing', 'picked', 'packed', 'generated', 'dispatched', 'disposed']
const WRITE_OFFABLE: Lifecycle[] = ['in_stock', 'returned', 'missing']

function BoxList() {
  const { can } = useWh()
  const [lifecycle, setLifecycle] = useState<Lifecycle>('in_stock')
  const [held, setHeld] = useState<'' | 'true' | 'false'>('')
  const [chosen, setChosen] = useState<string[]>([])
  const [writingOff, setWritingOff] = useState(false)
  const [lastWriteOff, setLastWriteOff] = useState<WriteOffResult | null>(null)
  const q = useInfiniteQuery({
    queryKey: ['wh', 'boxes', lifecycle, held],
    queryFn: ({ pageParam }) => wh.boxes({ lifecycle, ...(held ? { held } : {}), limit: 100, ...(pageParam ? { after: pageParam } : {}) }),
    initialPageParam: '',
    getNextPageParam: (last) => last.next ?? undefined,
  })
  const boxes = q.data?.pages.flatMap((p) => p.boxes) ?? []
  const canWriteOff = can('warehouse.adjust') && WRITE_OFFABLE.includes(lifecycle)
  const toggle = (id: string, on: boolean) => setChosen(on ? [...chosen, id] : chosen.filter((x) => x !== id))

  return (
    <section aria-labelledby="box-list">
      <h2 id="box-list">List boxes</h2>
      <div className="field-inline mb-3">
        <div className="field">
          <label htmlFor="bl-state">State</label>
          <select
            id="bl-state"
            value={lifecycle}
            onChange={(e) => {
              setLifecycle(e.target.value as Lifecycle)
              setChosen([])
            }}
          >
            {LIST_STATES.map((l) => (
              <option key={l} value={l}>
                {LIFECYCLE_LABEL[l]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="bl-held">Holds</label>
          <select id="bl-held" value={held} onChange={(e) => setHeld(e.target.value as '' | 'true' | 'false')}>
            <option value="">Any</option>
            <option value="true">On hold</option>
            <option value="false">Not on hold</option>
          </select>
        </div>
        {canWriteOff && (
          <button type="button" className="btn btn-danger" disabled={!chosen.length} onClick={() => setWritingOff(true)}>
            Write off {chosen.length || ''} {chosen.length === 1 ? 'box' : 'boxes'}
          </button>
        )}
      </div>
      {lastWriteOff && (
        <p className={`notice ${lastWriteOff.status === 'applied' ? 'notice-info' : 'notice-warn'}`} role="status">
          {lastWriteOff.status === 'applied'
            ? `Written off: ${lastWriteOff.boxes} ${lastWriteOff.boxes === 1 ? 'box' : 'boxes'}.`
            : `Waiting for approval: ${lastWriteOff.boxes} ${lastWriteOff.boxes === 1 ? 'box' : 'boxes'}. Another manager approves it in Warehouse reports.`}
        </p>
      )}
      {canWriteOff && !chosen.length && <p className="hint">Tick boxes to write them off together.</p>}
      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : boxes.length === 0 ? (
        <EmptyState>No boxes {LIFECYCLE_LABEL[lifecycle].toLowerCase()}.</EmptyState>
      ) : (
        <>
          <div {...scrollRegion('Boxes', { cards: true })}>
            <table>
              <thead>
                <tr>
                  {canWriteOff && (
                    <th>
                      <span className="sr-only">Choose</span>
                    </th>
                  )}
                  <th>Box</th>
                  <th>QC</th>
                  <th>Product</th>
                  <th>Location</th>
                  <th>Best before</th>
                  <th>Holds</th>
                </tr>
              </thead>
              <tbody>
                {boxes.map((b) => (
                  <tr key={b.id}>
                    {canWriteOff && (
                      <td className="card-wide">
                        <label className="check-inline">
                          <input type="checkbox" checked={chosen.includes(b.id)} onChange={(e) => toggle(b.id, e.target.checked)} />
                          <span className="sr-only">Choose {b.code}</span>
                        </label>
                      </td>
                    )}
                    <td className="card-title">
                      <Link to={`/warehouse/boxes/${b.id}`}>{b.code}</Link>
                    </td>
                    <td className="card-status">
                      <Badge tone={qualityTone(b.quality)}>{QUALITY_LABEL[b.quality] ?? b.quality}</Badge>
                    </td>
                    <td data-label="Product">{b.skuName}</td>
                    <td data-label="Location">{b.locationName ?? '—'}</td>
                    <td data-label="Best before">{date(b.bestBefore)}</td>
                    <td data-label="Holds">{b.holds.length ? b.holds.map((h) => HOLD_LABEL[h] ?? h).join(', ') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {q.hasNextPage && (
            <button type="button" className="btn mt-3" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
              {q.isFetchingNextPage ? 'Loading…' : 'Show more'}
            </button>
          )}
        </>
      )}
      {writingOff && (
        <WriteOffDialog
          boxIds={chosen}
          what={`${chosen.length} ${chosen.length === 1 ? 'box' : 'boxes'}`}
          onClose={() => setWritingOff(false)}
          onDone={(r) => {
            setChosen([])
            setLastWriteOff(r)
          }}
        />
      )}
    </section>
  )
}
