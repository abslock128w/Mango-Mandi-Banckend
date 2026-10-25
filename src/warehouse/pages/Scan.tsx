// The scan workspace: pick what you are doing, then scan box after box.
// A hand scanner types the code and presses Enter into the focused box; each
// scan joins the queue (scanQueue.ts) and its answer appears at the top of the
// list, is read out by the live region and beeps. A rejected scan stops the
// queue until someone presses Continue, so a wrong box is never missed.

import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from '../../api'
import { canSee } from '../../permissions'
import { dateTime } from '../../format'
import { useSession } from '../../session'
import { Badge, BackLink, ConfirmDialog, EmptyState, FormError, QueryError, ReasonDialog, Spinner, useToast, usePageTitle } from '../../ui'
import { opTypesFor } from '../access'
import { wh } from '../api'
import { beep, loadMuted, saveMuted } from '../beep'
import { LOCATION_TYPE_LABEL, OP_LABEL, QC_RESULT_LABEL, SCAN_RESULT_LABEL, scanTone } from '../labels'
import { clearSavedQueue, useScanQueue, type ShownScan } from '../scanQueue'
import type { Operation, OpType, WhLocation } from '../types'

export default function Scan() {
  const [params] = useSearchParams()
  const opId = params.get('op')
  usePageTitle('Scan')
  return opId ? <Workspace key={opId} opId={opId} /> : <Setup />
}

// ---------------------------------------------------------------- setup

const ORDER_TYPES: OpType[] = ['pick', 'unpick', 'pack', 'dispatch', 'return']

function Setup() {
  const { me } = useSession()
  const [params, setParams] = useSearchParams()
  const types = opTypesFor(me)
  const wanted = params.get('type') as OpType | null
  const [type, setType] = useState<OpType>(wanted && types.includes(wanted) ? wanted : types[0])
  const [lotId, setLotId] = useState(params.get('lotId') ?? '')
  const [locationId, setLocationId] = useState(params.get('locationId') ?? '')
  const [orderId, setOrderId] = useState(params.get('orderId') ?? '')
  const [qcResult, setQcResult] = useState<keyof typeof QC_RESULT_LABEL>('passed')
  const [reasonCodes, setReasonCodes] = useState('')
  const [note, setNote] = useState('')
  const [formError, setFormError] = useState<unknown>(null)

  const needsLot = type === 'receive'
  const needsLocation = type === 'move'
  const optionalLocation = type === 'receive' || type === 'return'
  const needsOrder = ORDER_TYPES.includes(type)

  const lots = useQuery({ queryKey: ['wh', 'lots', 'open'], queryFn: () => wh.lots(), enabled: needsLot, select: (l) => l.filter((x) => x.status === 'receiving' || x.status === 'received') })
  const locations = useQuery({ queryKey: ['wh', 'locations'], queryFn: wh.locations, enabled: needsLocation || optionalLocation })
  const queue = useQuery({ queryKey: ['wh', 'pick-queue'], queryFn: wh.pickQueue, enabled: needsOrder && types.includes('pick') })
  const open = useQuery({ queryKey: ['wh', 'operations', 'open'], queryFn: wh.operations })

  /**
   * The order as typed: a number like ORD-1042 (from the pick queue, or the orders
   * search for roles that may open Orders) or the order's id.
   */
  async function resolveOrder(input: string): Promise<string> {
    const t = input.trim()
    const same = (n: string) => n.toLowerCase() === t.toLowerCase()
    const queued = queue.data?.find((o) => same(o.number) || o.orderId === t)
    if (queued) return queued.orderId
    if (canSee(me?.role, 'orders')) {
      const found = await api.orders({ q: t })
      const hit = found.items.find((o) => same(o.number))
      if (hit) return hit.id
      if (/^[A-Z]+-\d+$/i.test(t)) throw new Error(`No order ${t.toUpperCase()}.`)
    }
    return t
  }

  const start = useMutation({
    mutationFn: async () => {
      const context: Record<string, unknown> = {}
      if (needsLot) context.lotId = lotId
      if ((needsLocation || optionalLocation) && locationId) context.locationId = locationId
      if (needsOrder) context.orderId = await resolveOrder(orderId)
      if (type === 'unpick' || (type === 'return' && note.trim())) context.reason = note.trim()
      if (type === 'qc') {
        context.result = qcResult
        context.reasonCodes = reasonCodes.split(',').map((s) => s.trim()).filter(Boolean)
        if (note.trim()) context.note = note.trim()
      }
      return wh.startOperation(type, context)
    },
    onSuccess: (op) => setParams({ op: op.id }),
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (needsLot && !lotId) return setFormError('Choose the batch you are receiving.')
    if (needsLocation && !locationId) return setFormError('Choose where the boxes are going.')
    if (needsOrder && !orderId.trim()) return setFormError('Enter the order number.')
    if (type === 'unpick' && note.trim().length < 3) return setFormError('Say why the boxes come off the order.')
    if (type === 'qc' && qcResult !== 'passed' && !reasonCodes.trim()) return setFormError('Give at least one reason for a failed or review result.')
    start.mutate()
  }

  if (!types.length) return <EmptyState>Your role has no scanning work in the warehouse.</EmptyState>

  const activeLocations = (locations.data ?? []).filter((l) => l.active)
  return (
    <>
      <div className="topbar">
        <h1>Scan</h1>
      </div>

      {open.data && open.data.length > 0 && (
        <section className="card" aria-labelledby="open-sessions">
          <h2 id="open-sessions">Your open sessions</h2>
          <ul className="plain-list wh-open-list">
            {open.data.map((op) => (
              <li key={op.id}>
                <button type="button" className="btn" onClick={() => setParams({ op: op.id })}>
                  Resume {OP_LABEL[op.type].toLowerCase()}: {contextSummary(op)}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <form className="card narrow" onSubmit={onSubmit} noValidate aria-labelledby="scan-start">
        <h2 id="scan-start">Start scanning</h2>
        <div className="field">
          <label htmlFor="scan-type">What are you doing?</label>
          <select id="scan-type" value={type} onChange={(e) => setType(e.target.value as OpType)}>
            {types.map((t) => (
              <option key={t} value={t}>
                {OP_LABEL[t]}
              </option>
            ))}
          </select>
        </div>

        {needsLot && (
          <div className="field">
            <label htmlFor="scan-lot">Batch</label>
            {lots.isError ? (
              <QueryError error={lots.error} onRetry={() => lots.refetch()} />
            ) : (
              <select id="scan-lot" value={lotId} onChange={(e) => setLotId(e.target.value)} disabled={lots.isPending}>
                <option value="">{lots.isPending ? 'Loading…' : 'Choose a batch'}</option>
                {(lots.data ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code} · {l.productName} ({l.verifiedCount} of {l.targetCount - l.voidedCount})
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {(needsLocation || optionalLocation) && (
          <div className="field">
            <label htmlFor="scan-location">{needsLocation ? 'Moving to' : 'Location (optional)'}</label>
            <LocationSelect id="scan-location" value={locationId} onChange={setLocationId} locations={activeLocations} loading={locations.isPending} />
            {needsLocation && <p className="hint">Or start, then scan the location label to switch.</p>}
          </div>
        )}

        {needsOrder && (
          <div className="field">
            <label htmlFor="scan-order">Order number</label>
            <input id="scan-order" value={orderId} onChange={(e) => setOrderId(e.target.value)} list="scan-orders" autoComplete="off" autoCapitalize="characters" aria-describedby="scan-order-hint" />
            <datalist id="scan-orders">
              {(queue.data ?? []).map((o) => (
                <option key={o.orderId} value={o.number} label={`${o.toPick} to pick`} />
              ))}
            </datalist>
            <p className="hint" id="scan-order-hint">
              For example ORD-1042, or choose from the orders waiting to be picked.
            </p>
          </div>
        )}

        {type === 'qc' && (
          <>
            <fieldset className="field">
              <legend className="field-label">QC result for every box you scan</legend>
              <div className="segmented">
                {(Object.keys(QC_RESULT_LABEL) as (keyof typeof QC_RESULT_LABEL)[]).map((r) => (
                  <button key={r} type="button" className="btn" aria-pressed={qcResult === r} onClick={() => setQcResult(r)}>
                    {QC_RESULT_LABEL[r]}
                  </button>
                ))}
              </div>
            </fieldset>
            {qcResult !== 'passed' && (
              <div className="field">
                <label htmlFor="scan-reasons">Reasons</label>
                <input id="scan-reasons" value={reasonCodes} onChange={(e) => setReasonCodes(e.target.value)} aria-describedby="scan-reasons-hint" />
                <p className="hint" id="scan-reasons-hint">
                  Separate with commas, e.g. bruised, underweight.
                </p>
              </div>
            )}
          </>
        )}

        {(type === 'qc' || type === 'unpick' || type === 'return') && (
          <div className="field">
            <label htmlFor="scan-note">{type === 'unpick' ? 'Why are the boxes coming off?' : 'Note (optional)'}</label>
            <input id="scan-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        )}

        <FormError error={formError ?? start.error} />
        <button type="submit" className="btn btn-primary" disabled={start.isPending}>
          {start.isPending ? 'Starting…' : 'Start scanning'}
        </button>
      </form>
    </>
  )
}

function LocationSelect({
  id,
  value,
  onChange,
  locations,
  loading,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  locations: WhLocation[]
  loading?: boolean
}) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={loading}>
      <option value="">{loading ? 'Loading…' : 'Choose a location'}</option>
      {locations.map((l) => (
        <option key={l.id} value={l.id}>
          {l.zone ? `${l.zone} · ` : ''}
          {l.name} ({LOCATION_TYPE_LABEL[l.type]})
        </option>
      ))}
    </select>
  )
}

function contextSummary(op: Operation): string {
  const c = op.context as Record<string, string | undefined>
  if (op.type === 'receive') return [c.lotCode, c.locationName].filter(Boolean).join(' into ')
  if (op.type === 'move') return `to ${c.locationName ?? 'a location'}`
  if (op.type === 'qc') return c.result ? QC_RESULT_LABEL[c.result as keyof typeof QC_RESULT_LABEL] ?? '' : ''
  return c.orderNumber ? `order ${c.orderNumber}` : ''
}

// ---------------------------------------------------------------- workspace

const STAGED_LABEL: Partial<Record<OpType, string>> = { pack: 'Finish packing', dispatch: 'Finish dispatch' }

function Workspace({ opId }: { opId: string }) {
  const navigate = useNavigate()
  const [, setParams] = useSearchParams()
  const toast = useToast()
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()
  const [value, setValue] = useState('')
  const [muted, setMuted] = useState(loadMuted)
  const [announce, setAnnounce] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [finalizeError, setFinalizeError] = useState<ApiError | null>(null)
  const [reasonFor, setReasonFor] = useState<ShownScan | null>(null)

  const op = useQuery({ queryKey: ['wh', 'operation', opId], queryFn: () => wh.operation(opId) })
  const mutedRef = useRef(muted)
  mutedRef.current = muted

  const q = useScanQueue(opId, {
    seed: op.data?.scans,
    onResults: (results) => {
      const last = results[results.length - 1]
      if (!mutedRef.current) beep(last.result)
      setAnnounce(`${SCAN_RESULT_LABEL[last.result]}: ${last.message}`)
      // Counts and staged progress come from the session.
      void queryClient.invalidateQueries({ queryKey: ['wh', 'operation', opId] })
    },
  })

  // NON_FEFO asks for a reason: the prompt opens by itself.
  const paused = q.paused
  useEffect(() => {
    if (paused?.code === 'NON_FEFO' && paused.detail?.needsReason) setReasonFor(paused)
  }, [paused])

  const undo = useMutation({
    mutationFn: () => wh.undo(opId),
    onSuccess: ({ undone }) => {
      q.markUndone(undone.scanId)
      toast.success(`Undone: ${undone.message || undone.code}`)
      void queryClient.invalidateQueries({ queryKey: ['wh', 'operation', opId] })
      inputRef.current?.focus()
    },
    onError: (err) => toast.error(err),
  })
  const cancel = useMutation({
    mutationFn: () => wh.cancel(opId),
    onSuccess: () => {
      clearSavedQueue(opId)
      void queryClient.invalidateQueries({ queryKey: ['wh'] })
      toast.success('Session cancelled.')
      navigate('/warehouse/scan')
    },
  })
  const finalize = useMutation({
    mutationFn: () => wh.finalize(opId),
    onMutate: () => setFinalizeError(null),
    onSuccess: (done) => {
      clearSavedQueue(opId)
      queryClient.setQueryData(['wh', 'operation', opId], done)
      void queryClient.invalidateQueries({ queryKey: ['wh'] })
      toast.success(done.type === 'pack' ? 'Order packed.' : 'Order dispatched.')
    },
    onError: (err) => (err instanceof ApiError ? setFinalizeError(err) : toast.error(err)),
  })
  const switchTo = useMutation({
    mutationFn: async (loc: { id: string }) => {
      await wh.cancel(opId)
      return wh.startOperation('move', { locationId: loc.id })
    },
    onSuccess: (next) => {
      clearSavedQueue(opId)
      setParams({ op: next.id })
    },
    onError: (err) => toast.error(err),
  })

  function onScan(e: FormEvent) {
    e.preventDefault()
    const input = value.trim()
    setValue('')
    inputRef.current?.focus()
    if (input) q.enqueue(input)
  }

  function acknowledge() {
    q.acknowledge()
    inputRef.current?.focus()
  }

  if (op.isPending) return <Spinner label="Opening session" />
  if (op.isError) return <QueryError error={op.error} onRetry={() => op.refetch()} />

  const o = op.data
  const isOpen = o.status === 'open'
  const staged = o.class === 'staged'
  const missing = finalizeError?.code === 'INCOMPLETE_SET' ? (finalizeError.extra.missing as string[] | undefined) : undefined
  const toPick = finalizeError?.code === 'INCOMPLETE_SET' ? (finalizeError.extra.toPick as number | undefined) : undefined
  const stale = finalizeError?.code === 'STALE_SCAN' ? (finalizeError.extra.boxes as string[] | undefined) : undefined
  const location = paused?.code === 'WRONG_LABEL_TYPE' && o.type === 'move' ? (paused.detail?.location as { id: string; name: string; active?: boolean } | undefined) : undefined

  return (
    <>
      <BackLink to="/warehouse/scan">Scan</BackLink>
      <div className="topbar">
        <h1>
          {OP_LABEL[o.type]} <span className="muted">{contextSummary(o)}</span>
        </h1>
        <span className="spacer" />
        <button type="button" className="btn" aria-pressed={muted} onClick={() => {
            setMuted(!muted)
            saveMuted(!muted)
          }}>
          {muted ? 'Sound off' : 'Sound on'}
        </button>
      </div>

      <dl className="wh-session-counts" aria-label="Session counts">
        <div>
          <dt>Accepted</dt>
          <dd>{o.accepted}</dd>
        </div>
        <div>
          <dt>Rejected</dt>
          <dd>{o.rejected}</dd>
        </div>
        <div>
          <dt>Already scanned</dt>
          <dd>{o.duplicates}</dd>
        </div>
        {staged && o.progress && (
          <div>
            <dt>Staged</dt>
            <dd>
              {o.progress.staged} of {o.progress.needed}
            </dd>
          </div>
        )}
      </dl>
      {staged && o.progress && (
        <progress className="wh-progress" max={Math.max(o.progress.needed, 1)} value={o.progress.staged} aria-label="Boxes staged">
          {o.progress.staged} of {o.progress.needed}
        </progress>
      )}

      {!isOpen ? (
        <div className={`notice ${o.status === 'completed' ? 'notice-info' : 'notice-warn'}`} role="status">
          {o.status === 'completed'
            ? `Done${o.result && typeof o.result.orderNumber === 'string' ? `: ${o.result.orderNumber} is ${String(o.result.status).toLowerCase()}` : ''}.`
            : o.status === 'expired'
              ? 'This session expired after a long pause. Start a new one.'
              : 'This session is closed.'}{' '}
          <button type="button" className="link-btn" onClick={() => navigate('/warehouse/scan')}>
            Start another session
          </button>
        </div>
      ) : (
        <form className="card wh-scan-form" onSubmit={onScan}>
          <label htmlFor={inputId} className="field-label">
            Scan or type a box code
          </label>
          <div className="wh-scan-row">
            <input
              id={inputId}
              ref={inputRef}
              className="wh-scan-input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              enterKeyHint="send"
              maxLength={128}
            />
            <button type="submit" className="btn btn-primary">
              Add
            </button>
          </div>
          <p className="hint" aria-live="off">
            {q.retrying
              ? `No connection: ${q.waiting} ${q.waiting === 1 ? 'scan' : 'scans'} waiting, trying again…`
              : q.waiting
                ? `${q.waiting} waiting to send`
                : 'Every scan is saved on this device until the server has it.'}
          </p>
        </form>
      )}

      {paused && !reasonFor && (
        <div className="notice notice-bad wh-stop" role="alert">
          <p className="mb-2">
            <strong>Scanning paused.</strong> {paused.message}
          </p>
          <p className="small mb-2">
            Scanned: <code>{paused.input}</code>. Put this box aside, then continue
            {q.waiting ? `; ${q.waiting} more ${q.waiting === 1 ? 'scan waits' : 'scans wait'} behind it` : ''}.
          </p>
          <div className="btn-row">
            <button type="button" className="btn btn-primary" onClick={acknowledge}>
              Continue scanning
            </button>
            {location && location.active !== false && (
              <button type="button" className="btn" disabled={switchTo.isPending} onClick={() => switchTo.mutate(location)}>
                Switch destination to {location.name}
              </button>
            )}
          </div>
        </div>
      )}

      {isOpen && (
        <div className="btn-row mb-4">
          {staged && (
            <button type="button" className="btn btn-primary" onClick={() => finalize.mutate()} disabled={finalize.isPending || q.waiting > 0}>
              {finalize.isPending ? 'Finishing…' : (STAGED_LABEL[o.type] ?? 'Finish')}
              {o.progress ? ` (${o.progress.staged} of ${o.progress.needed})` : ''}
            </button>
          )}
          <button type="button" className="btn" onClick={() => undo.mutate()} disabled={undo.isPending}>
            {undo.isPending ? 'Undoing…' : 'Undo last scan'}
          </button>
          <button type="button" className="btn" onClick={() => setConfirmCancel(true)}>
            Cancel session
          </button>
        </div>
      )}

      {finalizeError && (
        <div className="notice notice-bad" role="alert">
          <p className="mb-2">{finalizeError.message}</p>
          {missing && missing.length > 0 && (
            <>
              <p className="small mb-1">Still to scan:</p>
              <ul className="wh-codes" aria-label="Boxes still to scan">
                {missing.map((c) => (
                  <li key={c}>
                    <code>{c}</code>
                  </li>
                ))}
              </ul>
            </>
          )}
          {toPick !== undefined && <p className="small mb-0">Pick the remaining {toPick} first.</p>}
          {stale && stale.length > 0 && <p className="small mb-0">Scan again: {stale.join(', ')}</p>}
        </div>
      )}

      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announce}
      </div>

      <h2 className="mt-4">Scans</h2>
      {q.results.length === 0 ? (
        <EmptyState>Nothing scanned yet.</EmptyState>
      ) : (
        <ol className="wh-scan-results" aria-label="Scans, newest first">
          {q.results.map((r) => (
            <li key={r.scanId} className={`wh-scan wh-scan-${r.result}`}>
              <Badge tone={scanTone(r.result)}>{SCAN_RESULT_LABEL[r.result]}</Badge>
              <span className="wh-scan-msg">{r.message || r.code}</span>
              <span className="muted small wh-scan-meta">
                <code>{r.input}</code> · {dateTime(r.at)}
              </span>
            </li>
          ))}
        </ol>
      )}

      {reasonFor && (
        <ReasonDialog
          title="Picked from another batch"
          label="Why this box?"
          hint="For example: the reserved batch is not reachable. At least 3 characters."
          confirmLabel="Use this box"
          tone="primary"
          onSubmit={(reason) => {
            setReasonFor(null)
            q.enqueue(reasonFor.input, reason, { front: true })
            q.acknowledge()
            inputRef.current?.focus()
          }}
          onClose={() => {
            setReasonFor(null)
            acknowledge()
          }}
        >
          <p>
            {reasonFor.message}
            {typeof reasonFor.detail?.expectedLot === 'string' ? ` The reserved batch is ${reasonFor.detail.expectedLot}.` : ''}
          </p>
        </ReasonDialog>
      )}

      {confirmCancel && (
        <ConfirmDialog
          title="Cancel this session?"
          confirmLabel="Cancel session"
          cancelLabel="Keep scanning"
          busyLabel="Cancelling…"
          tone="danger"
          busy={cancel.isPending}
          error={cancel.error}
          onConfirm={() => cancel.mutate()}
          onClose={() => setConfirmCancel(false)}
        >
          <p>{staged ? 'Staged boxes are dropped; nothing has changed on the order yet.' : 'Scans already accepted stay done.'}</p>
        </ConfirmDialog>
      )}
    </>
  )
}
