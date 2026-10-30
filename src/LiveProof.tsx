// Rider app proof in the panel (docs/rider-app/README.md): the photos a rider
// takes at pickup and at the door with their GPS and the mango check, the
// customer's WhatsApp messages with Meta's delivery report, and where riders
// last were. Used by the Deliveries page (live, every 10 s), the order page
// (Proof) and Today (a toast when a stop is picked up or delivered).
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from './api'
import { dateTime } from './format'
import type { LiveDeliveries, LiveMessage, LiveStop, MangoVerdict, NotificationKind, PhotoStep, ProofPhoto } from './types'
import { Badge, Dialog, FormError, OrderBadge, QueryError, Spinner, useToast } from './ui'

export const LIVE_POLL_MS = 10_000

export const STEP_LABEL: Record<PhotoStep, string> = { pickup: 'Pickup', door: 'At the door', open_box: 'Open box', attempt: 'Missed' }
const SHOWN_STEPS: PhotoStep[] = ['pickup', 'door', 'open_box']

export const MESSAGE_LABEL: Partial<Record<NotificationKind, string>> = {
  OUT_FOR_DELIVERY: 'On its way',
  DELIVERY_CODE: 'Delivery code',
  GIFT_OUT_FOR_DELIVERY: 'On its way (recipient)',
  GIFT_DELIVERY_CODE: 'Delivery code (recipient)',
  DELIVERED: 'Delivered',
  DELIVERY_FAILED: 'Missed',
}

export const mapLink = (lat: number, lng: number) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`

/** "Mango check: passed 93%", "Mango check: needs review", the model's reason when it failed. */
export function verdictWords(p: Pick<ProofPhoto, 'passed' | 'needsReview' | 'verdict'>): { text: string; tone: 'good' | 'warn' | 'bad' | 'neutral' } {
  const v: MangoVerdict | null = p.verdict
  const pct = typeof v?.confidence === 'number' ? ` ${Math.round(v.confidence * 100)}%` : ''
  if (!v) return { text: 'Not checked yet', tone: 'neutral' }
  if (v.skipped) return { text: 'Mango check off (no model key)', tone: 'neutral' }
  if (v.error) return { text: `Mango check could not run (${v.error}): needs review`, tone: 'warn' }
  if (p.needsReview) return { text: `Mango check: needs review${v.reason ? `. ${v.reason}` : ''}`, tone: 'warn' }
  if (v.mode === 'shadow') return { text: `Mango check (shadow): ${v.wouldPass ? 'would pass' : 'would fail'}${pct}${v.reason ? `. ${v.reason}` : ''}`, tone: v.wouldPass ? 'good' : 'warn' }
  if (p.passed) return { text: `Mango check: passed${pct}`, tone: 'good' }
  return { text: `Mango check: failed${pct}${v.reason ? `. ${v.reason}` : ''}`, tone: 'bad' }
}

/** "sent", "delivered", "read", "failed", "logged" (the log provider stood in for WhatsApp). */
export function messageState(m: Pick<LiveMessage, 'status' | 'deliveryStatus' | 'providerId'>): { text: string; tone: 'good' | 'warn' | 'bad' | 'neutral' | 'info' } {
  if (m.status === 'FAILED') return { text: 'failed', tone: 'bad' }
  if (m.status === 'SKIPPED') return { text: 'skipped', tone: 'warn' }
  if (m.status === 'PENDING') return { text: 'queued', tone: 'neutral' }
  if (m.providerId === 'log' || m.deliveryStatus === 'logged') return { text: 'logged (no WhatsApp here)', tone: 'info' }
  if (m.deliveryStatus === 'read') return { text: 'read', tone: 'good' }
  if (m.deliveryStatus === 'delivered') return { text: 'delivered', tone: 'good' }
  if (m.deliveryStatus === 'failed') return { text: 'failed', tone: 'bad' }
  return { text: 'sent', tone: 'info' }
}

/** A delivery photo, fetched with the staff sign-in when it scrolls into view. */
export function PhotoThumb({ orderId, photo, label }: { orderId: string; photo: ProofPhoto; label: string }) {
  const ref = useRef<HTMLElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || visible) return
    if (typeof IntersectionObserver === 'undefined') return setVisible(true)
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [visible])
  const q = useQuery({
    queryKey: ['delivery-photo', orderId, photo.id],
    queryFn: () => api.deliveryPhotoUrl(orderId, photo.id),
    enabled: visible && !photo.removed,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
  })
  return (
    <figure ref={ref} className="proof-thumb">
      {photo.removed ? (
        <span className="proof-thumb-empty">Removed after 90 days</span>
      ) : q.data ? (
        <a href={q.data} target="_blank" rel="noreferrer">
          <img src={q.data} alt={`${label} photo for this order`} width={96} height={72} loading="lazy" />
        </a>
      ) : (
        <span className="proof-thumb-empty" aria-label={`${label} photo loading`} />
      )}
      <figcaption>
        {label}
        <span className="muted"> {dateTime(photo.takenAt ?? photo.at)}</span>
      </figcaption>
    </figure>
  )
}

/** The latest photo of each step (the open box: one that passed, else one flagged, else the latest). */
function byStep(photos: ProofPhoto[]) {
  const out: Partial<Record<PhotoStep, ProofPhoto>> = {}
  for (const p of photos) if (p.step) out[p.step] = p
  const boxes = photos.filter((p) => p.step === 'open_box')
  if (boxes.length) out.open_box = boxes.find((p) => p.passed) ?? boxes.find((p) => p.needsReview) ?? boxes.at(-1)
  return out
}

/**
 * The Deliveries page's live proof for managers and operators: every stop of the
 * day with its photos, mango check, WhatsApp messages and flags, and where each
 * rider last was. Polled every 10 seconds while the page is open.
 */
export function LiveProofPanel({ day, manager }: { day: string; manager: boolean }) {
  const q = useQuery({ queryKey: ['deliveries-live', day], queryFn: () => api.liveDeliveries(day), refetchInterval: LIVE_POLL_MS })
  const [reviewing, setReviewing] = useState<LiveStop | null>(null)
  const [leaving, setLeaving] = useState<LiveStop | null>(null)
  if (q.isPending) return <Spinner label="Loading live deliveries" />
  if (q.isError) return <QueryError error={q.error} onRetry={() => q.refetch()} />
  const live = q.data
  const active = live.stops.filter((s) => ['SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED'].includes(s.status) || s.photos.length > 0)
  return (
    <section className="card live-proof no-print" aria-labelledby="live-proof-title">
      <div className="live-proof-head">
        <h2 id="live-proof-title" className="mt-0">
          Live proof
        </h2>
        <span className="muted small" role="status">
          Updates every 10 seconds · last {dateTime(live.cursor)}
        </span>
      </div>
      {live.riders.length > 0 && (
        <ul className="live-riders" aria-label="Riders' last positions">
          {live.riders.map((r) => (
            <li key={r.id}>
              <strong>{r.firstName}</strong> last seen {dateTime(r.at)}
              {r.accuracy != null ? <span className="muted"> (±{Math.round(r.accuracy)} m)</span> : null}{' '}
              <a href={mapLink(r.lat, r.lng)} target="_blank" rel="noreferrer">
                Map<span className="sr-only"> of where {r.firstName} was</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {active.length === 0 ? (
        <p className="muted">No stop has been picked up yet on this day. Photos, mango checks and WhatsApp status show here as riders work.</p>
      ) : (
        <ul className="live-stops">
          {active.map((s) => (
            <LiveStopRow key={s.id} stop={s} manager={manager} onReview={() => setReviewing(s)} onLeave={() => setLeaving(s)} />
          ))}
        </ul>
      )}
      {reviewing && <ReviewDialog stop={reviewing} day={day} onClose={() => setReviewing(null)} />}
      {leaving && <LeaveAtDoorDialog stop={leaving} day={day} onClose={() => setLeaving(null)} />}
    </section>
  )
}

function LiveStopRow({ stop: s, manager, onReview, onLeave }: { stop: LiveStop; manager: boolean; onReview: () => void; onLeave: () => void }) {
  const steps = byStep(s.photos)
  const box = steps.open_box
  const verdict = box ? verdictWords(box) : null
  const where = s.photos.filter((p) => p.lat != null && p.lng != null).at(-1)
  return (
    <li className="live-stop" data-testid={`live-stop-${s.number}`}>
      <div className="live-stop-head">
        <Link to={`/orders/${s.id}`}>{s.number}</Link> <span>{s.customerName ?? 'Customer'}</span> <OrderBadge status={s.status} />
        {s.rider ? <span className="muted small"> · {s.rider.firstName}</span> : null}
        {s.pickupWarehouse ? <span className="muted small"> · pick up at {s.pickupWarehouse}</span> : null}
        {s.needsReview && (
          <button type="button" className="chip-review" onClick={onReview} disabled={!s.reviewAttemptId} title={s.reviewAttemptId ? 'Check this delivery' : 'Flagged: the review opens once it is delivered'}>
            Needs review
          </button>
        )}
        {s.codeLocked && <Badge tone="bad">Code locked</Badge>}
        {s.leaveAtDoorAllowed && <Badge tone="info">May leave without code</Badge>}
      </div>
      <div className="proof-thumbs">
        {SHOWN_STEPS.map((step) =>
          steps[step] ? (
            <PhotoThumb key={step} orderId={s.id} photo={steps[step]!} label={STEP_LABEL[step]} />
          ) : (
            <figure key={step} className="proof-thumb proof-thumb-missing">
              <span className="proof-thumb-empty" />
              <figcaption>
                {STEP_LABEL[step]}
                <span className="muted"> not yet</span>
              </figcaption>
            </figure>
          ),
        )}
      </div>
      <div className="live-stop-facts small">
        {verdict && <Badge tone={verdict.tone}>{verdict.text}</Badge>}
        {where && (
          <span>
            Last photo at {dateTime(where.takenAt ?? where.at)}{' '}
            <a href={mapLink(where.lat!, where.lng!)} target="_blank" rel="noreferrer">
              Map<span className="sr-only"> of where the {where.step} photo was taken</span>
            </a>
          </span>
        )}
        {s.codeTries > 0 && !s.codeLocked && <span className="muted">{s.codeTries} wrong code{s.codeTries === 1 ? '' : 's'}</span>}
      </div>
      {s.messages.length > 0 && (
        <ul className="live-messages small" aria-label={`WhatsApp messages for ${s.number}`}>
          {s.messages.map((m) => {
            const st = messageState(m)
            return (
              <li key={m.id}>
                WhatsApp {MESSAGE_LABEL[m.kind] ?? m.kind.toLowerCase().replace(/_/g, ' ')}: <Badge tone={st.tone}>{st.text}</Badge>
                {m.error ? <span className="muted"> {m.error}</span> : null}
              </li>
            )
          })}
        </ul>
      )}
      {manager && s.status === 'OUT_FOR_DELIVERY' && !s.leaveAtDoorAllowed && (
        <button type="button" className="btn btn-small" onClick={onLeave}>
          Allow leave at door<span className="sr-only"> for {s.number}</span>
        </button>
      )}
    </li>
  )
}

/** The existing delivery check (Needs attention): looks right, or doubtful with a note. */
function ReviewDialog({ stop, day, onClose }: { stop: LiveStop; day: string; onClose: () => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [note, setNote] = useState('')
  const check = useMutation({
    mutationFn: (ok: boolean) => api.reviewDelivery(stop.reviewAttemptId!, ok, note.trim() || undefined),
    onSuccess: (_r, ok) => {
      toast.success(ok ? `${stop.number} checked` : `${stop.number} flagged as doubtful`)
      qc.invalidateQueries({ queryKey: ['deliveries-live', day] })
      qc.invalidateQueries({ queryKey: ['attention'] })
      onClose()
    },
  })
  const box = byStep(stop.photos).open_box
  return (
    <Dialog
      title={`Check ${stop.number}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn" disabled={check.isPending || !note.trim()} onClick={() => check.mutate(false)}>
            Doubtful
          </button>
          <button type="button" className="btn btn-primary" disabled={check.isPending} onClick={() => check.mutate(true)}>
            Looks right
          </button>
        </>
      }
    >
      <p className="mt-0">The mango check could not pass this delivery's open-box photo. Look at it and say whether it looks right.</p>
      {box && (
        <>
          <PhotoThumb orderId={stop.id} photo={box} label="Open box" />
          <p>{verdictWords(box).text}</p>
        </>
      )}
      <div className="field">
        <label htmlFor="review-note">What looks wrong (needed for Doubtful)</label>
        <textarea id="review-note" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {check.isError && <FormError error={check.error} />}
    </Dialog>
  )
}

function LeaveAtDoorDialog({ stop, day, onClose }: { stop: LiveStop; day: string; onClose: () => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  const allow = useMutation({
    mutationFn: () => api.allowLeaveAtDoor(stop.id, reason.trim()),
    onSuccess: () => {
      toast.success(`${stop.number} may be left without the code`)
      qc.invalidateQueries({ queryKey: ['deliveries-live', day] })
      onClose()
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    allow.mutate()
  }
  return (
    <Dialog
      title={`Allow leaving ${stop.number} without the code`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="leave-form" className="btn btn-primary" disabled={allow.isPending || reason.trim().length < 3}>
            Allow
          </button>
        </>
      }
    >
      <form id="leave-form" onSubmit={submit}>
        <p className="mt-0">The rider can then leave the box with a photo and who took it. Say why: the customer asked on the phone, or said yes on WhatsApp.</p>
        <div className="field">
          <label htmlFor="leave-reason">Why</label>
          <input id="leave-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} required />
        </div>
        {allow.isError && <FormError error={allow.error} />}
      </form>
    </Dialog>
  )
}

/** The order page's Proof section: every photo with its step, time, GPS and mango check, and the raw verdicts. */
export function ProofSection({ orderId, proof, leaveAtDoor }: { orderId: string; proof: ProofPhoto[]; leaveAtDoor?: { by: string; at: string; reason: string } | null }) {
  if (!proof.length && !leaveAtDoor) return null
  return (
    <section className="card" aria-labelledby="proof-title">
      <h2 id="proof-title" className="mt-0">
        Proof
      </h2>
      {leaveAtDoor && (
        <p>
          <Badge tone="info">May leave without code</Badge> {leaveAtDoor.reason} <span className="muted">({leaveAtDoor.by}, {dateTime(leaveAtDoor.at)})</span>
        </p>
      )}
      <ul className="proof-list">
        {proof.map((p) => {
          const label = p.step ? STEP_LABEL[p.step] : 'Photo'
          const v = p.step === 'open_box' ? verdictWords(p) : null
          return (
            <li key={p.id}>
              <PhotoThumb orderId={orderId} photo={p} label={label} />
              <div className="small">
                <div>
                  <strong>{label}</strong>
                  {p.attempt ? <span className="muted"> · attempt {p.attempt}</span> : null}
                </div>
                <div>Taken {dateTime(p.takenAt ?? p.at)} · stored {dateTime(p.at)}</div>
                <div>
                  {p.lat != null && p.lng != null ? (
                    <>
                      GPS {p.lat.toFixed(5)}, {p.lng.toFixed(5)}
                      {p.accuracy != null ? ` (±${Math.round(p.accuracy)} m)` : ''}{' '}
                      <a href={mapLink(p.lat, p.lng)} target="_blank" rel="noreferrer">
                        Map<span className="sr-only"> for the {label} photo</span>
                      </a>
                    </>
                  ) : (
                    <span className="muted">No GPS</span>
                  )}
                </div>
                {v && <Badge tone={v.tone}>{v.text}</Badge>}
                {p.verdict && (
                  <details>
                    <summary>Verdict details</summary>
                    <pre className="proof-json">{JSON.stringify(p.verdict, null, 2)}</pre>
                  </details>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/**
 * Today: a toast when a stop is picked up (out for delivery) or delivered. Polls the live
 * view every 10 seconds with the last cursor; the first answer only sets the cursor.
 */
export function useDeliveryToasts(day: string, enabled: boolean) {
  const toast = useToast()
  const cursor = useRef<string | null>(null)
  const q = useQuery<LiveDeliveries>({
    queryKey: ['deliveries-live-toasts', day],
    queryFn: () => api.liveDeliveries(day, cursor.current),
    refetchInterval: LIVE_POLL_MS,
    enabled,
    gcTime: 0,
  })
  const seen = useRef<string | null>(null)
  useEffect(() => {
    const d = q.data
    if (!d || seen.current === d.cursor) return
    const first = cursor.current === null
    seen.current = d.cursor
    cursor.current = d.cursor
    if (first) return
    for (const e of d.events) {
      if (e.status === 'OUT_FOR_DELIVERY') toast.info(`${e.number} picked up: out for delivery`)
      else if (e.status === 'DELIVERED') toast.success(`${e.number} delivered`)
    }
  }, [q.data, toast])
}
