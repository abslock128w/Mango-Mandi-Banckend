// The scan workspace: pick what you are doing, then scan box after box.
// A hand scanner types the code and presses Enter into the focused box; each
// scan joins the queue (scanQueue.ts) and its answer appears at the top of the
// list, is read out by the live region and beeps. A rejected scan stops the
// queue until someone presses Continue, so a wrong box is never missed.
// Where the warehouse has camera scanning on, the camera feeds the same queue.
// Stocktake and repack are staged like pack: nothing changes until Finish.

import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from '../../api'
import { canSee } from '../../permissions'
import { dateTime } from '../../format'
import { useSession } from '../../session'
import { Badge, BackLink, ConfirmDialog, Dialog, EmptyState, FormError, QueryError, ReasonDialog, Spinner, useToast, usePageTitle } from '../../ui'
import { opTypesFor, useWh } from '../access'
import { wh } from '../api'
import { beep, loadMuted, saveMuted } from '../beep'
import { CameraScanner } from '../CameraScanner'
import { LOCATION_TYPE_LABEL, OP_LABEL, QC_RESULT_LABEL, QUALITY_LABEL, REPACK_REASON_LABEL, SCAN_RESULT_LABEL, scanTone } from '../labels'
import { clearSavedQueue, useScanQueue, type ShownScan } from '../scanQueue'
import type { Operation, OpType, RepackFinish, RepackReason, RepackResult, StocktakeResult, WhLocation } from '../types'
import { DownloadButton, kg } from '../ui'

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
  const [repackReason, setRepackReason] = useState<RepackReason | ''>('')
  const [formError, setFormError] = useState<unknown>(null)

  const needsLot = type === 'receive'
  const needsLocation = type === 'move' || type === 'stocktake' || type === 'repack'
  const optionalLocation = type === 'receive' || type === 'return'
  const needsOrder = ORDER_TYPES.includes(type)

  const lots = useQuery({ queryKey: ['wh', 'lots', 'open'], queryFn: () => wh.lots(), enabled: needsLot, select: (l) => l.filter((x) => x.status === 'receiving' || x.status === 'received') })
  const locations = useQuery({ queryKey: ['wh', 'locations'], queryFn: wh.locations, enabled: needsLocation || optionalLocation })
  const queue = useQuery({ queryKey: ['wh', 'pick-queue'], queryFn: wh.pickQueue, enabled: needsOrder && types.includes('pick') })
  const open = useQuery({ queryKey: ['wh', 'operations', 'open'], queryFn: wh.operations })
  const settings = useQuery({ queryKey: ['wh', 'settings'], queryFn: wh.settings, enabled: type === 'repack' })

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
      if (type === 'repack') {
        context.reasonCode = repackReason
        context.reason = note.trim()
      }
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
    if (needsLocation && !locationId) {
      return setFormError(type === 'stocktake' ? 'Choose the place you are counting.' : type === 'repack' ? 'Choose where you are repacking.' : 'Choose where the boxes are going.')
    }
    if (type === 'repack' && !repackReason) return setFormError('Choose why you are repacking.')
    if (type === 'repack' && note.trim().length < 3) return setFormError('Say what is being done (at least 3 characters).')
    if (needsOrder && !orderId.trim()) return setFormError('Enter the order number.')
    if (type === 'unpick' && note.trim().length < 3) return setFormError('Say why the boxes come off the order.')
    if (type === 'qc' && qcResult !== 'passed' && !reasonCodes.trim()) return setFormError('Give at least one reason for a failed or review result.')
    start.mutate()
  }

  if (!types.length) return <EmptyState>Your role has no scanning work in the warehouse.</EmptyState>

  const repackPlaces = settings.data?.repackPlaces
  const activeLocations = (locations.data ?? []).filter((l) => l.active && (type !== 'repack' || !!repackPlaces?.includes(l.type)))
  const locationLabel = type === 'stocktake' ? 'Place to count' : type === 'repack' ? 'Where you repack' : needsLocation ? 'Moving to' : 'Location (optional)'
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
            <label htmlFor="scan-location">{locationLabel}</label>
            <LocationSelect
              id="scan-location"
              value={locationId}
              onChange={setLocationId}
              locations={activeLocations}
              loading={locations.isPending || (type === 'repack' && settings.isPending)}
              describedBy={type === 'move' || type === 'stocktake' || type === 'repack' ? 'scan-location-hint' : undefined}
            />
            {type === 'move' && (
              <p className="hint" id="scan-location-hint">
                Or start, then scan the location label to switch.
              </p>
            )}
            {type === 'stocktake' && (
              <p className="hint" id="scan-location-hint">
                Scan every box that is physically here. Boxes recorded here that you do not scan go to a supervisor to review; nothing is marked missing until then.
              </p>
            )}
            {type === 'repack' && (
              <p className="hint" id="scan-location-hint">
                Receiving, QC hold, packing or returns. Then scan each box that goes in.
              </p>
            )}
          </div>
        )}

        {type === 'repack' && (
          <div className="field">
            <label htmlFor="scan-repack-reason">Why repack?</label>
            {settings.isError ? (
              <QueryError error={settings.error} onRetry={() => settings.refetch()} />
            ) : (
              <select id="scan-repack-reason" value={repackReason} onChange={(e) => setRepackReason(e.target.value as RepackReason)} disabled={settings.isPending}>
                <option value="">{settings.isPending ? 'Loading…' : 'Choose a reason'}</option>
                {(settings.data?.repackReasons ?? []).map((r) => (
                  <option key={r} value={r}>
                    {REPACK_REASON_LABEL[r] ?? r}
                  </option>
                ))}
              </select>
            )}
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

        {(type === 'qc' || type === 'unpick' || type === 'return' || type === 'repack') && (
          <div className="field">
            <label htmlFor="scan-note">{type === 'unpick' ? 'Why are the boxes coming off?' : type === 'repack' ? 'What is being done' : 'Note (optional)'}</label>
            <input id="scan-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
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
  describedBy,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  locations: WhLocation[]
  loading?: boolean
  describedBy?: string
}) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={loading} aria-describedby={describedBy}>
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
  if (op.type === 'stocktake') return `of ${c.locationName ?? 'a place'}`
  if (op.type === 'repack') return `at ${c.locationName ?? 'a place'}`
  return c.orderNumber ? `order ${c.orderNumber}` : ''
}

// ---------------------------------------------------------------- workspace

const STAGED_LABEL: Partial<Record<OpType, string>> = { pack: 'Finish packing', dispatch: 'Finish dispatch', stocktake: 'Finish count', repack: 'Finish repack' }
const FINISHED: Partial<Record<OpType, string>> = { pack: 'Order packed.', dispatch: 'Order dispatched.', stocktake: 'Count finished.', repack: 'Repack done: print the new labels.' }

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
  const [finishing, setFinishing] = useState(false)

  const op = useQuery({ queryKey: ['wh', 'operation', opId], queryFn: () => wh.operation(opId) })
  const settings = useQuery({ queryKey: ['wh', 'settings'], queryFn: wh.settings })
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
  /** While the repack form is open its refusals show in the form. */
  const finishingRepack = useRef(false)
  finishingRepack.current = finishing && op.data?.type === 'repack'
  const finalize = useMutation({
    mutationFn: (body?: RepackFinish) => wh.finalize(opId, body),
    onMutate: () => setFinalizeError(null),
    onSuccess: (done) => {
      setFinishing(false)
      clearSavedQueue(opId)
      queryClient.setQueryData(['wh', 'operation', opId], done)
      void queryClient.invalidateQueries({ queryKey: ['wh'] })
      toast.success(FINISHED[done.type] ?? 'Done.')
    },
    onError: (err) => {
      // A repack's own form shows its refusals; a box that changed since its scan is shown on the page.
      if (finishingRepack.current && !(err instanceof ApiError && err.code === 'STALE_SCAN')) return
      setFinishing(false)
      if (err instanceof ApiError) {
        setFinalizeError(err)
        // A repack drops boxes that changed since their scan: show the session as it is now.
        if (err.code === 'STALE_SCAN') void queryClient.invalidateQueries({ queryKey: ['wh', 'operation', opId] })
      } else toast.error(err)
    },
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
  const cameraOn = settings.data?.features.cameraScan === true

  function onFinish() {
    if (o.type === 'stocktake' || o.type === 'repack') setFinishing(true)
    else finalize.mutate(undefined)
  }

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
        {staged && o.progress && o.type === 'stocktake' && (
          <div>
            <dt>Counted</dt>
            <dd>
              {o.progress.staged} <span className="muted small">({o.progress.needed} recorded here)</span>
            </dd>
          </div>
        )}
        {staged && o.progress && o.type === 'repack' && (
          <div>
            <dt>Boxes in</dt>
            <dd>{o.progress.staged}</dd>
          </div>
        )}
        {staged && o.progress && o.type !== 'stocktake' && o.type !== 'repack' && (
          <div>
            <dt>Staged</dt>
            <dd>
              {o.progress.staged} of {o.progress.needed}
            </dd>
          </div>
        )}
      </dl>
      {staged && o.progress && o.type !== 'repack' && (
        <progress className="wh-progress" max={Math.max(o.progress.needed, 1)} value={o.progress.staged} aria-label="Boxes staged">
          {o.progress.staged} of {o.progress.needed}
        </progress>
      )}

      {!isOpen && o.status === 'completed' && o.type === 'stocktake' && o.result ? (
        <StocktakeDone op={o} result={o.result as unknown as StocktakeResult} />
      ) : !isOpen && o.status === 'completed' && o.type === 'repack' && o.result ? (
        <RepackDone op={o} result={o.result as unknown as RepackResult} />
      ) : !isOpen ? (
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
          {cameraOn && <CameraScanner onCode={(code) => q.enqueue(code)} />}
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
            <button type="button" className="btn btn-primary" onClick={onFinish} disabled={finalize.isPending || q.waiting > 0}>
              {finalize.isPending ? 'Finishing…' : (STAGED_LABEL[o.type] ?? 'Finish')}
              {o.progress && (o.type === 'pack' || o.type === 'dispatch') ? ` (${o.progress.staged} of ${o.progress.needed})` : ''}
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
          {stale && stale.length > 0 && (
            <p className="small mb-0">
              {o.type === 'repack' ? 'Taken out of this repack (they changed since you scanned them): ' : 'Scan again: '}
              {stale.join(', ')}
            </p>
          )}
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

      {finishing && o.type === 'stocktake' && (
        <ConfirmDialog
          title="Finish this count?"
          confirmLabel="Finish count"
          cancelLabel="Keep counting"
          busyLabel="Finishing…"
          busy={finalize.isPending}
          error={finalize.error}
          onConfirm={() => finalize.mutate(undefined)}
          onClose={() => setFinishing(false)}
        >
          <p>
            You scanned {o.progress?.staged ?? 0} {o.progress?.staged === 1 ? 'box' : 'boxes'}; {o.progress?.needed ?? 0} are recorded here.
          </p>
          <p>Boxes found here are corrected straight away. Boxes recorded here that you did not scan go to a supervisor to review; nothing is marked missing until then.</p>
        </ConfirmDialog>
      )}
      {finishing && o.type === 'repack' && (
        <RepackFinishDialog
          opId={o.id}
          busy={finalize.isPending}
          error={finalize.error}
          onSubmit={(body) => finalize.mutate(body)}
          onClose={() => setFinishing(false)}
        />
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

// ---------------------------------------------------------------- stocktake and repack results

function StocktakeDone({ op, result: r }: { op: Operation; result: StocktakeResult }) {
  const rows: [string, number][] = [
    ['Boxes counted', r.counted],
    ['Where they should be', r.matched],
    ['Found here, recorded elsewhere (corrected)', r.foundElsewhere],
    ['Found after being missing (back in stock)', r.foundMissing],
    ['Recorded as gone (held for a supervisor)', r.foundGone],
    ['Moved during the count (left alone)', r.movedAfterSnapshot],
    ['Not found: waiting for review', r.toReview],
  ]
  return (
    <section className="card" aria-labelledby="st-done">
      <h2 id="st-done">Count finished</h2>
      <dl className="wh-facts">
        {rows.map(([label, n]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{n}</dd>
          </div>
        ))}
      </dl>
      <p role="status">
        {r.toReview
          ? `${r.toReview} ${r.toReview === 1 ? 'box was' : 'boxes were'} not found. A supervisor reviews them; nothing is marked missing until then.`
          : 'Every box recorded here was found.'}
      </p>
      <div className="btn-row">
        <Link to={`/warehouse/stocktake/${op.id}`} className="btn btn-primary">
          Open the count
        </Link>
        <Link to="/warehouse/scan" className="btn">
          Start another session
        </Link>
      </div>
    </section>
  )
}

function RepackDone({ op, result: r }: { op: Operation; result: RepackResult }) {
  const { can } = useWh()
  return (
    <section className="card" aria-labelledby="rp-done">
      <h2 id="rp-done">Repack done</h2>
      <p role="status">
        {r.sources.length} {r.sources.length === 1 ? 'box' : 'boxes'} in, {r.outputs.length} new {r.outputs.length === 1 ? 'box' : 'boxes'} out. Put the new labels on before the boxes move.
        {r.needsQc ? ' The new boxes wait for QC before they sell.' : ''}
      </p>
      <ul className="plain-list wh-list" aria-label="New boxes">
        {r.outputs.map((b) => (
          <li key={b.id}>
            <Link to={`/warehouse/boxes/${b.id}`}>
              <code>{b.code}</code>
            </Link>{' '}
            · {kg(b.weightG)} · {QUALITY_LABEL[b.quality] ?? b.quality}
          </li>
        ))}
      </ul>
      <div className="btn-row">
        {can('labels.print') && (
          <DownloadButton className="btn btn-primary" getUrl={() => wh.repackLabelsUrl(op.id)} filename={`repack-labels-${op.id}.pdf`}>
            Download new labels
          </DownloadButton>
        )}
        <Link to={`/warehouse/repack/${op.id}`} className="btn">
          Open the repack
        </Link>
        <Link to="/warehouse/scan" className="btn">
          Start another session
        </Link>
      </div>
    </section>
  )
}

const MAX_NEW_BOXES = 20

interface NewBoxRow {
  key: number
  weight: string
  fruit: string
}

const wholeNumber = (v: string, min: number, max: number) => {
  const n = Number(v)
  return v.trim() !== '' && Number.isInteger(n) && n >= min && n <= max ? n : null
}

/** What came out of a repack: one row per new box, and what was taken out. The API checks the totals. */
function RepackFinishDialog({
  opId,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  opId: string
  busy: boolean
  error: unknown
  onSubmit: (body: RepackFinish) => void
  onClose: () => void
}) {
  const detail = useQuery({ queryKey: ['wh', 'repack', opId], queryFn: () => wh.repack(opId) })
  const [rows, setRows] = useState<NewBoxRow[]>([{ key: 1, weight: '', fruit: '' }])
  const nextKey = useRef(2)
  const [fruitRemoved, setFruitRemoved] = useState('0')
  // Blank: the API records what went in less what came out.
  const [weightLost, setWeightLost] = useState('')
  const [note, setNote] = useState('')
  const [formError, setFormError] = useState<unknown>(null)

  const sources = detail.data?.sources ?? []
  const inG = sources.reduce((g, b) => g + (b.weightG ?? 0), 0)
  const outG = rows.reduce((g, r) => g + (Number(r.weight) || 0), 0)

  function setRow(key: number, patch: Partial<NewBoxRow>) {
    setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!sources.length) return setFormError('Scan the boxes that go in first.')
    const outputs: RepackFinish['outputs'] = []
    for (const [i, r] of rows.entries()) {
      const weightG = wholeNumber(r.weight, 1, 100_000)
      if (weightG === null) return setFormError(`New box ${i + 1}: enter its weight in whole grams.`)
      if (r.fruit.trim() === '') outputs.push({ weightG })
      else {
        const fruitCount = wholeNumber(r.fruit, 1, 200)
        if (fruitCount === null) return setFormError(`New box ${i + 1}: fruit is a whole number, 1 to 200.`)
        outputs.push({ weightG, fruitCount })
      }
    }
    const fruit = wholeNumber(fruitRemoved, 0, 10_000)
    const lost = weightLost.trim() === '' ? undefined : wholeNumber(weightLost, 0, 1_000_000)
    if (fruit === null) return setFormError('Fruit taken out is a whole number (0 if none).')
    if (lost === null) return setFormError('Weight taken out is in whole grams, or leave it blank.')
    setFormError(null)
    onSubmit({ outputs, fruitRemoved: fruit, ...(lost !== undefined ? { weightLostG: lost } : {}), ...(note.trim() ? { note: note.trim() } : {}) })
  }

  return (
    <Dialog
      title="Finish repack"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Keep scanning
          </button>
          <button type="submit" form="repack-finish" className="btn btn-primary" disabled={busy || detail.isPending}>
            {busy ? 'Finishing…' : `Make ${rows.length} new ${rows.length === 1 ? 'box' : 'boxes'}`}
          </button>
        </>
      }
    >
      <form id="repack-finish" onSubmit={submit} noValidate>
        {detail.isPending ? (
          <Spinner label="Loading the boxes going in" />
        ) : detail.isError ? (
          <QueryError error={detail.error} onRetry={() => detail.refetch()} />
        ) : (
          <p>
            Going in: {sources.length} {sources.length === 1 ? 'box' : 'boxes'}, {kg(inG)}
            {sources.length ? ` (${sources.map((b) => b.code).join(', ')})` : ''}. The old labels stop scanning; every new box gets a new label.
          </p>
        )}
        <ol className="plain-list wh-new-boxes" aria-label="New boxes">
          {rows.map((r, i) => (
            <li key={r.key}>
              <fieldset className="field">
                <legend className="field-label">New box {i + 1}</legend>
                <div className="wh-new-box">
                  <div className="field">
                    <label htmlFor={`rp-w-${r.key}`}>Weight in grams</label>
                    <input
                      id={`rp-w-${r.key}`}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      step={1}
                      value={r.weight}
                      onChange={(e) => setRow(r.key, { weight: e.target.value })}
                      data-autofocus={i === 0 ? true : undefined}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`rp-f-${r.key}`}>Fruit (optional)</label>
                    <input id={`rp-f-${r.key}`} type="number" inputMode="numeric" min={1} max={200} step={1} value={r.fruit} onChange={(e) => setRow(r.key, { fruit: e.target.value })} />
                  </div>
                </div>
                {rows.length > 1 && (
                  <button type="button" className="btn btn-small" onClick={() => setRows((all) => all.filter((x) => x.key !== r.key))} aria-label={`Remove new box ${i + 1}`}>
                    Remove
                  </button>
                )}
              </fieldset>
            </li>
          ))}
        </ol>
        {rows.length < MAX_NEW_BOXES && (
          <button type="button" className="btn mb-4" onClick={() => setRows((all) => [...all, { key: nextKey.current++, weight: '', fruit: '' }])}>
            Add another new box
          </button>
        )}
        <div className="wh-new-box">
          <div className="field">
            <label htmlFor="rp-fruit-out">Fruit taken out</label>
            <input id="rp-fruit-out" type="number" inputMode="numeric" min={0} step={1} value={fruitRemoved} onChange={(e) => setFruitRemoved(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="rp-weight-out">Weight taken out (g)</label>
            <input
              id="rp-weight-out"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={weightLost}
              onChange={(e) => setWeightLost(e.target.value)}
              aria-describedby="rp-weight-out-hint"
            />
            <p className="hint" id="rp-weight-out-hint">
              Blank: the difference is recorded ({inG ? `${Math.max(0, inG - outG)} g` : 'in less out'}).
            </p>
          </div>
        </div>
        <div className="field">
          <label htmlFor="rp-note">Note (optional)</label>
          <input id="rp-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
        </div>
        <p className="hint" aria-live="polite">
          Out: {kg(outG)} in {rows.length} {rows.length === 1 ? 'box' : 'boxes'}
          {inG ? ` of ${kg(inG)} in` : ''}. What went in must equal the new boxes plus the weight taken out.
        </p>
        <FormError error={formError ?? error} />
      </form>
    </Dialog>
  )
}
