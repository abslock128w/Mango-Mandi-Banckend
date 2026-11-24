import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleAlert, CircleCheck, Lock, Minus, Plus } from 'lucide-react'
import { api } from '../api'
import { RIPENESS_LABEL, date, rupees, type Tone } from '../format'
import { useSession } from '../session'
import { MONEY_CHANGE_WHY, useStepUp } from '../StepUp'
import type { BookingFilter, PlanChange, PlanResult, Preorder, PreorderStatus, PreorderWeeks } from '../types'
import {
  Badge, ConfirmDialog, DisabledReason, EmptyState, FormError, GatedButton, ManagerOnlyNote, PhoneLink, QueryError, ReasonDialog, Spinner, StatusFilter,
  Tabs, scrollRegion, tabPanelProps, usePageTitle, useToast,
} from '../ui'

// The Pre-order plan (the owner, 18 Nov 2026: "expected kg per day per variety; the backend recalculates when each
// customer's order is delivered; the admin panel must be really user friendly"). One page: the plan per variety, the
// delivery weeks with a bar per variety, and the bookings. Every change shows a PREVIEW in plain sentences first
// (mango-api preorder-plan.js, POST /preorder-plan/preview) and is applied only when the manager says so (apply).

/** Kilograms with thousands separators: 1,640 or 2.5. */
const kg = (x: number) => x.toLocaleString('en-IN', { maximumFractionDigits: 1 })
const weekLabel = (d: string) => `Week of ${date(d)}`
const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`

type Tab = 'plan' | 'bookings'

export default function PreorderPlan() {
  usePageTitle('Pre-order plan')
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'bookings' ? 'bookings' : 'plan'
  function go(next: Tab, filter: BookingFilter | null = null) {
    const p = new URLSearchParams(params)
    if (next === 'plan') p.delete('tab')
    else p.set('tab', next)
    if (filter) p.set('filter', filter)
    setParams(p, { replace: true })
  }
  return (
    <>
      <div className="topbar">
        <h1>Pre-order plan</h1>
      </div>
      <Tabs id="preorder-plan" label="Pre-order plan" tabs={[['plan', 'Plan and weeks'], ['bookings', 'Bookings']] as const} value={tab} onChange={(t) => go(t)} />
      <div {...tabPanelProps('preorder-plan', tab)} className="plan-panel">
        {tab === 'plan' ? <PlanTab onShowDelayed={() => go('bookings', 'delayed')} /> : <Bookings />}
      </div>
    </>
  )
}

// ---------------------------------------------------------------- preview, then apply

type Pending = { change: PlanChange; result: PlanResult }

/** The one way any change reaches the plan: preview (plain sentences and a before/after table), then apply. */
function usePlanFlow(onApplied: () => void) {
  const queryClient = useQueryClient()
  const stepUp = useStepUp(MONEY_CHANGE_WHY)
  const [pending, setPending] = useState<Pending | null>(null)
  const [done, setDone] = useState<PlanResult | null>(null)
  const preview = useMutation({
    mutationFn: (change: PlanChange) => api.previewPlan(change),
    onSuccess: (result, change) => setPending({ change, result }),
  })
  const apply = useMutation({
    mutationFn: (change: PlanChange) => stepUp.run((code) => api.applyPlan(change, code)),
    onSuccess: (r) => {
      setPending(null)
      setDone(r)
      onApplied()
      void queryClient.invalidateQueries({ queryKey: ['preorder-weeks'] })
      void queryClient.invalidateQueries({ queryKey: ['preorders'] })
      void queryClient.invalidateQueries({ queryKey: ['rules'] })
      void queryClient.invalidateQueries({ queryKey: ['attention'] })
    },
  })
  return {
    start: (change: PlanChange) => {
      setDone(null)
      preview.mutate(change)
    },
    checking: preview.isPending,
    checkError: preview.error,
    done,
    dismiss: () => setDone(null),
    dialogs: (
      <>
        {pending && (
          <PreviewDialog
            pending={pending}
            busy={apply.isPending}
            error={apply.error}
            onApply={() => apply.mutate(pending.change)}
            onClose={() => {
              apply.reset()
              setPending(null)
            }}
          />
        )}
        {stepUp.dialog}
      </>
    ),
  }
}
type PlanFlow = ReturnType<typeof usePlanFlow>

/** The preview's sentences, said the same way before and after applying. */
function sentences(r: PlanResult, done: boolean): string[] {
  const out: string[] = []
  const d = r.delayed
  if (d.bookings) {
    const msg = d.paid ? ` and ${done ? 'queued a message to' : 'messages'} ${d.paid === d.bookings ? 'those customers' : `the ${plural(d.paid, 'customer', 'customers')} who paid`}` : ''
    out.push(`${done ? 'Delayed' : 'This delays'} ${plural(d.bookings, 'pre-order', 'pre-orders')} (${kg(d.kg)} kg) to a later week${msg}.`)
  } else out.push(done ? 'No pre-order was delayed.' : 'No pre-order is delayed.')
  if (r.earlier.bookings) out.push(`${plural(r.earlier.bookings, 'pre-order', 'pre-orders')} ${done ? 'moved' : 'move'} earlier${r.earlier.paid ? ' (good news: their customers get a message)' : ''}.`)
  if (r.changedWeeks) out.push(`${plural(r.changedWeeks, 'week', 'weeks')} ${done ? 'changed' : r.changedWeeks === 1 ? 'changes' : 'change'}.`)
  if (r.delayedStay?.bookings) out.push(`${plural(r.delayedStay.bookings, 'delayed order stays', 'delayed orders stay')} in ${r.delayedStay.bookings === 1 ? 'its' : 'their'} current week: an order we delayed is never brought forward.${r.delayedStay.overtakenBy ? ` ${plural(r.delayedStay.overtakenBy, 'newer order', 'newer orders')} will arrive before an older delayed one.` : ''}`)
  if (r.planned?.orders) out.push(`${plural(r.planned.orders, 'regular order', 'regular orders')} booked ahead (${kg(r.planned.kg)} kg) ${done ? 'moved' : 'move'} to a later date first, so pre-orders keep their place${r.planned.paid ? `; ${done ? 'those customers were told' : 'those customers are told'} and can cancel for a full refund until packing` : ''}.`)
  if (r.planned?.noRoom) out.push(`${plural(r.planned.noRoom, 'regular order', 'regular orders')} found no later week with room: see Needs attention.`)
  if (r.noRoom.bookings) out.push(`${plural(r.noRoom.bookings, 'pre-order', 'pre-orders')} (${kg(r.noRoom.kg)} kg) fit no week to the season's end: they keep their week, which then shows as over.`)
  return out
}

function PreviewDialog({ pending, busy, error, onApply, onClose }: { pending: Pending; busy: boolean; error: unknown; onApply: () => void; onClose: () => void }) {
  const r = pending.result
  const rows = r.weeks.filter((w) => w.before !== w.after || pending.change.weeks?.some((x) => x.weekStart === w.weekStart && x.variety === w.variety))
  const nothing = !r.delayed.bookings && !r.earlier.bookings && !r.planned?.orders && !r.delayedStay?.bookings && !pending.change.dayKg && pending.change.otherDayKg === undefined && !pending.change.weeks?.length
  return (
    <ConfirmDialog
      title="Check before you apply"
      confirmLabel={nothing ? 'Close' : r.messages ? 'Apply and message customers' : 'Apply'}
      cancelLabel="Cancel"
      busyLabel="Applying…"
      busy={busy}
      error={error}
      onConfirm={nothing ? onClose : onApply}
      onClose={onClose}
    >
      <div className="plan-preview" aria-live="polite">
        {nothing ? (
          <p className="plan-sentence">Nothing would change: every pre-order is already in the earliest week with room.</p>
        ) : (
          sentences(r, false).map((s) => (
            <p key={s} className="plan-sentence">
              {s}
            </p>
          ))
        )}
        {r.delayed.paid > 0 && (
          <p className="small">
            Customers moved later can cancel for a full refund until their box is packed. {r.whatsappConnected ? '' : 'WhatsApp is not connected yet: the messages wait and go out once it is.'}
          </p>
        )}
        {r.delayed.bookings + r.earlier.bookings > r.delayed.paid + r.earlier.paid && <p className="small muted">Unpaid pre-orders get no message: the shop shows them the new week before they pay.</p>}
        {r.frozenWeeks.length > 0 && <p className="small muted">Weeks whose deliveries have started ({r.frozenWeeks.map((w) => date(w)).join(', ')}) stay as they are.</p>}
        {pending.change.dayKg && <p className="small muted">Applying saves the new kg a day as a new version of the shop rules, so it asks for your password.</p>}
        {rows.length > 0 && (
          <div {...scrollRegion('Weeks before and after')}>
            <table className="plan-preview-table">
              <thead>
                <tr>
                  <th>Week</th>
                  <th>Variety</th>
                  <th className="num">Booked now</th>
                  <th className="num">After</th>
                  <th className="num">Expected</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 40).map((w) => (
                  <tr key={`${w.weekStart}|${w.variety}`}>
                    <td>{date(w.weekStart)}</td>
                    <td>{w.variety}</td>
                    <td className="num">{kg(w.before)} kg</td>
                    <td className={`num${w.after > w.limit ? ' text-warn' : ''}`}>{kg(w.after)} kg</td>
                    <td className="num">{kg(w.limit)} kg</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 40 && <p className="small muted">And {rows.length - 40} more.</p>}
          </div>
        )}
      </div>
    </ConfirmDialog>
  )
}

/** After applying: what happened, a link to the delayed pre-orders, and why there is no undo button. */
function ResultBanner({ r, onShowDelayed, onDismiss }: { r: PlanResult; onShowDelayed: () => void; onDismiss: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  // Brought into view after Apply: the manager pressed it far down the page.
  useEffect(() => {
    box.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [r])
  return (
    <div className="plan-result" role="status" ref={box} tabIndex={-1}>
      <CircleCheck aria-hidden="true" className="plan-result-icon" />
      <div>
        <p>
          <strong>Done.</strong> {sentences(r, true).join(' ')}
        </p>
        {r.messages > 0 && (
          <p className="small">
            {plural(r.messages, 'WhatsApp message is', 'WhatsApp messages are')} queued{r.whatsappConnected ? '' : ': they go out once WhatsApp is connected'}.
          </p>
        )}
        <p className="small muted">
          There is no undo button, because customers may already have seen the new week or cancelled. To go back, set the old numbers again: the pre-orders move
          back earlier and their customers get a good-news message.
        </p>
        <div className="btn-row mt-2">
          {r.delayed.bookings > 0 && (
            <button type="button" className="btn" onClick={onShowDelayed}>
              See the delayed pre-orders
            </button>
          )}
          <button type="button" className="btn" onClick={onDismiss}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- the plan tab

function PlanTab({ onShowDelayed }: { onShowDelayed: () => void }) {
  const { me } = useSession()
  const manager = me?.role === 'MANAGER'
  const q = useQuery({ queryKey: ['preorder-weeks'], queryFn: api.preorderWeeks })
  const [resetKey, setResetKey] = useState(0)
  const flow = usePlanFlow(() => setResetKey((k) => k + 1))
  return (
    <>
      <section className="card plan-how">
        <h2>How this works</h2>
        <ol className="plan-how-list">
          <li>Set how many kg of each variety you expect per day. A delivery week holds 7 days of it.</li>
          <li>Pre-orders fill the earliest week with room for their variety, oldest order first.</li>
          <li>When you change a number you see who moves before anything happens. Customers moved later get a WhatsApp and may cancel for a full refund until packing.</li>
        </ol>
        {!manager && (
          <p className="plan-readonly">
            <Lock aria-hidden="true" className="plan-icon" /> Only a manager can change the plan. You can see everything here.
          </p>
        )}
      </section>
      {flow.done && <ResultBanner r={flow.done} onShowDelayed={onShowDelayed} onDismiss={flow.dismiss} />}
      {q.isPending ? (
        <section className="card">
          <Spinner label="Loading the plan" />
        </section>
      ) : q.isError ? (
        <section className="card">
          <QueryError error={q.error} onRetry={() => q.refetch()} />
        </section>
      ) : (
        <>
          <HeldNow data={q.data} />
          <VarietyPlan key={resetKey} data={q.data} manager={manager} flow={flow} />
          <Weeks key={`w${resetKey}`} data={q.data} manager={manager} flow={flow} />
        </>
      )}
      {flow.dialogs}
    </>
  )
}

const OTHER = '__other'
const STEP_KG = 10

/** One line: the boxes regular shoppers can't buy because paid pre-orders this week are owed them. */
function HeldNow({ data }: { data: PreorderWeeks }) {
  const rows = data.held?.rows ?? []
  const forPlanned = data.held?.planned ?? []
  const ahead = data.plannedOrders ?? []
  return (
    <section className="card plan-held" aria-label="Held for pre-orders">
      <p>
        <Lock aria-hidden="true" className="plan-icon" />
        <span>
          <strong>Held for pre-orders this week:</strong>{' '}
          {rows.length
            ? rows.map((r) => `${r.variety} ${(RIPENESS_LABEL[r.stage as keyof typeof RIPENESS_LABEL] ?? r.stage).toLowerCase()} ${r.boxes} ${r.boxes === 1 ? 'box' : 'boxes'} (${r.kg} kg)`).join(' · ')
            : 'nothing'}
          {rows.length ? '. Shoppers can\u2019t buy these, so sellable stock looks lower until the pre-orders are delivery orders.' : '.'}
          {forPlanned.length ? ` Also kept for orders booked ahead: ${forPlanned.map((r) => `${r.variety} ${r.boxes} ${r.boxes === 1 ? 'box' : 'boxes'}`).join(' · ')}.` : ''}
        </span>
      </p>
      {ahead.length > 0 && (
        <p className="plan-ahead">
          <strong>Regular orders booked ahead:</strong>{' '}
          {ahead.map((a) => `${a.variety} ${kg(a.kg)} kg (${plural(a.orders, 'order', 'orders')}), week of ${date(a.week)}`).join(' · ')}. They share each week’s kg with pre-orders, and pre-orders come first.
        </p>
      )}
    </section>
  )
}

/** The plan's lines: one big kg-a-day input per variety, with steppers, the week it makes and what is booked. */
function VarietyPlan({ data, manager, flow }: { data: PreorderWeeks; manager: boolean; flow: PlanFlow }) {
  const all = (data.varieties ?? []).filter((v) => v.onSale || v.bookings > 0)
  // The varieties with their own number or with pre-orders first; the rest (each on "Any other variety") behind one button.
  const [showRest, setShowRest] = useState(false)
  const main = all.filter((v) => v.listed || v.bookings > 0)
  const rest = all.filter((v) => !(v.listed || v.bookings > 0))
  const varieties = showRest ? all : main
  const current = (key: string) => (key === OTHER ? (data.otherDayKg ?? data.dayKg ?? 0) : (all.find((v) => v.variety === key)?.dayKg ?? 0))
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const shown = (key: string) => draft[key] ?? String(Math.round(current(key) * 1000) / 1000)
  const valid = (s: string) => /^\d+(\.\d+)?$/.test(s.trim())
  const changed = Object.entries(draft).filter(([key, s]) => valid(s) && Number(s) !== current(key))
  function step(key: string, by: number) {
    const now = valid(shown(key)) ? Number(shown(key)) : current(key)
    setDraft({ ...draft, [key]: String(Math.max(0, Math.round((now + by) * 1000) / 1000)) })
  }
  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    const bad = Object.entries(draft).find(([, s]) => !valid(s))
    if (bad) return setFormError(`${bad[0] === OTHER ? 'Other varieties' : bad[0]}: enter kilograms a day, for example 300 (0 takes no pre-orders).`)
    if (!changed.length) return setFormError('Nothing changed yet: type a new number first.')
    const dayKg = Object.fromEntries(changed.filter(([k]) => k !== OTHER).map(([k, s]) => [k, Number(s)]))
    const other = changed.find(([k]) => k === OTHER)
    flow.start({ ...(Object.keys(dayKg).length ? { dayKg } : {}), ...(other ? { otherDayKg: Number(other[1]) } : {}) })
  }
  const row = (key: string, name: string, booked: { kg: number; n: number } | null, listed: boolean) => {
    const id = `plan-kg-${key.replace(/\W+/g, '-')}`
    const v = shown(key)
    const week = valid(v) ? Number(v) * 7 : null
    const isChanged = draft[key] !== undefined && valid(draft[key]) && Number(draft[key]) !== current(key)
    return (
      <tr key={key} className={isChanged ? 'is-changed' : undefined}>
        <td data-label="Variety">
          <label htmlFor={id} className="plan-variety">
            {name}
          </label>
          {!listed && key !== OTHER && <div className="small muted">Uses the number for other varieties</div>}
        </td>
        <td data-label="Kg expected per day" className="plan-kg-cell">
          <div className="plan-stepper">
            <button type="button" className="btn plan-step" onClick={() => step(key, -STEP_KG)} disabled={!manager} aria-label={`${STEP_KG} kg less a day of ${name}`}>
              <Minus aria-hidden="true" />
            </button>
            <input
              id={id}
              className="plan-kg-input"
              inputMode="decimal"
              value={v}
              readOnly={!manager}
              aria-describedby={`${id}-week`}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
            />
            <button type="button" className="btn plan-step" onClick={() => step(key, STEP_KG)} disabled={!manager} aria-label={`${STEP_KG} kg more a day of ${name}`}>
              <Plus aria-hidden="true" />
            </button>
          </div>
        </td>
        <td data-label="A week" id={`${id}-week`} className="num plan-week-kg">
          {week == null ? '—' : `= ${kg(week)} kg a week`}
        </td>
        <td data-label="Booked this season" className="num">
          {booked ? (
            <>
              {kg(booked.kg)} kg
              <div className="small muted">{plural(booked.n, 'pre-order', 'pre-orders')}</div>
            </>
          ) : (
            <span className="muted">—</span>
          )}
        </td>
      </tr>
    )
  }
  return (
    <section className="card">
      <h2>Kg expected per day, per variety</h2>
      <form onSubmit={onSubmit} noValidate>
        <div {...scrollRegion('Kg expected per day', { cards: true })}>
          <table className="plan-table">
            <thead>
              <tr>
                <th>Variety</th>
                <th>Kg expected per day</th>
                <th className="num">A week</th>
                <th className="num">Booked this season</th>
              </tr>
            </thead>
            <tbody>
              {varieties.map((v) => row(v.variety, v.variety, { kg: v.bookedKg, n: v.bookings }, v.listed))}
              {row(OTHER, 'Any other variety', null, true)}
            </tbody>
          </table>
        </div>
        {rest.length > 0 && (
          <button type="button" className="btn mt-3" aria-expanded={showRest} onClick={() => setShowRest(!showRest)}>
            {showRest ? 'Show only varieties with their own number or pre-orders' : `Show the other ${rest.length} varieties (they use “Any other variety”)`}
          </button>
        )}
        {manager ? (
          <div className="plan-save">
            <button type="submit" className="btn btn-primary btn-big" disabled={flow.checking}>
              {flow.checking ? 'Checking who moves…' : changed.length ? `Save changes (${changed.length})` : 'Save changes'}
            </button>
            <button type="button" className="btn" disabled={flow.checking} onClick={() => flow.start({})}>
              Recalculate now
            </button>
            {changed.length > 0 && (
              <button type="button" className="btn" onClick={() => setDraft({})}>
                Undo my edits
              </button>
            )}
            <p className="small muted plan-save-hint">Nothing changes until you have seen who moves and pressed Apply.</p>
            {formError ? <p className="small text-warn">{formError}</p> : <FormError error={flow.checkError} />}
          </div>
        ) : (
          <ManagerOnlyNote what="Changing the plan" />
        )}
      </form>
    </section>
  )
}

type Week = PreorderWeeks['weeks'][number]
type WeekVariety = NonNullable<Week['varieties']>[number]

/** One card per delivery week; collapsed to weeks with bookings plus the next two open ones. */
function Weeks({ data, manager, flow }: { data: PreorderWeeks; manager: boolean; flow: PlanFlow }) {
  const [all, setAll] = useState(false)
  const nextOpen = data.weeks.filter((w) => !w.frozen).slice(0, 2).map((w) => w.weekStart)
  const busy = data.weeks.filter((w) => w.orders > 0 || w.over > 0 || nextOpen.includes(w.weekStart) || (w.varieties ?? []).some((v) => v.own != null))
  const shown = all ? data.weeks : busy
  return (
    <section className="card">
      <div className="topbar section-head">
        <h2>Delivery weeks</h2>
        <span className="spacer" />
        {data.waitlisted > 0 && <Badge tone="warn">{plural(data.waitlisted, 'booking waits', 'bookings wait')} on the waitlist</Badge>}
      </div>
      {data.weeks.length === 0 ? (
        <EmptyState>No delivery weeks are open for pre-orders (the season has ended).</EmptyState>
      ) : (
        <>
          <ul className="plan-weeks">
            {shown.map((w) => (
              <WeekCard key={w.weekStart} week={w} weeks={data.weeks} next={w.weekStart === data.nextWeek} manager={manager} flow={flow} />
            ))}
          </ul>
          {data.weeks.length > busy.length && (
            <button type="button" className="btn mt-3" onClick={() => setAll(!all)} aria-expanded={all}>
              {all ? 'Show only busy weeks' : `Show all ${data.weeks.length} weeks`}
            </button>
          )}
        </>
      )}
    </section>
  )
}

const tone = (v: WeekVariety): 'is-over' | 'is-near' | 'is-ok' => (v.over > 0 ? 'is-over' : v.limit > 0 && v.booked / v.limit >= 0.85 ? 'is-near' : 'is-ok')

function WeekCard({ week, weeks, next, manager, flow }: { week: Week; weeks: Week[]; next: boolean; manager: boolean; flow: PlanFlow }) {
  const all = week.varieties ?? []
  const [showAll, setShowAll] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const rows = showAll ? all : all.filter((v) => v.booked > 0 || v.own != null || v.over > 0)
  const over = all.filter((v) => v.over > 0)
  const changed = Object.entries(draft).filter(([variety, s]) => {
    const v = all.find((x) => x.variety === variety)
    return v && (s.trim() === '' ? v.own != null : Number(s) !== v.own)
  })
  // The newest bookings that would leave an over week: counted from this week's bookings, newest first, until the excess is covered.
  const bookings = useQuery({ queryKey: ['preorders', 'week', week.weekStart], queryFn: () => api.preorders(null, { week: week.weekStart }), enabled: over.length > 0 })
  // A booking bigger than every later week of its variety can't move: it is named instead of being offered.
  const { newest, stuck } = useMemo(() => {
    if (!bookings.data) return { newest: null, stuck: [] as { number: string; kg: number; most: number }[] }
    let n = 0
    const tooBig: { number: string; kg: number; most: number }[] = []
    for (const v of over) {
      const most = Math.max(0, ...weeks.filter((w) => w.weekStart > week.weekStart && !w.frozen).map((w) => w.varieties?.find((x) => x.variety === v.variety)?.limit ?? 0))
      const list = bookings.data
        .filter((p) => p.variety === v.variety && (p.status === 'BOOKED' || p.status === 'PAYMENT_PENDING'))
        .sort((a, b) => String(b.bookedAt ?? b.createdAt).localeCompare(String(a.bookedAt ?? a.createdAt)))
      let freed = 0
      for (const p of list) {
        if ((p.kg ?? 0) > most) {
          tooBig.push({ number: p.number, kg: p.kg ?? 0, most })
          continue
        }
        if (freed >= v.over) continue
        freed += p.kg ?? 0
        n++
      }
    }
    return { newest: n, stuck: tooBig }
  }, [bookings.data, over, weeks, week.weekStart])
  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    const bad = changed.find(([, s]) => s.trim() !== '' && !/^\d+(\.\d+)?$/.test(s.trim()))
    if (bad) return setFormError(`${bad[0]}: enter kilograms for this week, or leave it empty for the usual amount.`)
    if (!changed.length) return setFormError('Nothing changed yet.')
    flow.start({ weeks: changed.map(([variety, s]) => ({ weekStart: week.weekStart, variety, limitKg: s.trim() === '' ? null : Number(s) })) })
  }
  return (
    <li className={`plan-week${week.over > 0 ? ' is-over' : ''}`}>
      <div className="plan-week-head">
        <h3>{weekLabel(week.weekStart)}</h3>
        {week.frozen && <Badge tone="neutral">Deliveries started</Badge>}
        {next && <Badge tone="info">New pre-orders start here</Badge>}
        <span className="spacer" />
        <span className="small muted">
          {kg(week.booked)} kg booked · {plural(week.orders, 'pre-order', 'pre-orders')}
          {week.planned ? ` · ${kg(week.planned)} kg regular orders booked ahead` : ''}
          {week.unpaid ? ` · ${week.unpaid} unpaid` : ''}
        </span>
      </div>
      {over.length > 0 && (
        <div className="plan-over" role="alert">
          <CircleAlert aria-hidden="true" className="plan-icon" />
          <div>
            {over.map((v) => (
              <p key={v.variety}>
                <strong>{v.variety} is {kg(v.over)} kg over:</strong> {kg(v.booked)} kg booked, {kg(v.limit)} kg expected this week.
              </p>
            ))}
            {stuck.map((p) => (
              <p key={p.number}>
                <strong>{p.number}</strong> is {kg(p.kg)} kg, more than any later week holds ({kg(p.most)} kg). It can't be moved: raise a week's kg, or cancel it with a full refund from the Bookings tab.
              </p>
            ))}
            {week.frozen ? (
              <DisabledReason>Its deliveries have started, so the plan can't move these. Move single bookings from the Bookings tab if needed.</DisabledReason>
            ) : newest === 0 ? (
              <DisabledReason>No order in this week can move to a later week.</DisabledReason>
            ) : manager ? (
              <button type="button" className="btn btn-primary mt-2" disabled={flow.checking} onClick={() => flow.start({})}>
                {newest ? `Move the newest ${plural(newest, 'order', 'orders')} to the next week` : 'Move the newest orders to the next week'}
              </button>
            ) : (
              <ManagerOnlyNote what="Moving orders out of this week" />
            )}
          </div>
        </div>
      )}
      <form onSubmit={onSubmit} noValidate>
        {rows.length === 0 ? (
          <p className="small muted">No pre-orders in this week yet.</p>
        ) : (
          <ul className="plan-bars">
            {rows.map((v) => {
              const pct = v.limit > 0 ? Math.min(100, Math.round((v.booked / v.limit) * 100)) : v.booked > 0 ? 100 : 0
              const id = `wk-${week.weekStart}-${v.variety.replace(/\W+/g, '-')}`
              return (
                <li key={v.variety} className={`plan-bar-row ${tone(v)}`}>
                  <div className="plan-bar-text">
                    <strong>{v.variety}</strong> {kg(v.booked)} of {kg(v.limit)} kg
                    {v.planned ? <span> · {kg(v.planned)} kg regular orders</span> : null}
                    {v.over > 0 ? <span className="text-warn"> · over by {kg(v.over)} kg</span> : v.remaining <= 0 && v.limit > 0 ? <span> · full</span> : null}
                  </div>
                  <div className="plan-bar" role="img" aria-label={`${v.variety}: ${kg(v.booked)} of ${kg(v.limit)} kg booked`}>
                    <span style={{ width: `${pct}%` }} />
                  </div>
                  <div className="plan-bar-edit">
                    <label htmlFor={id} className="small">
                      Expected this week
                    </label>
                    <input
                      id={id}
                      inputMode="decimal"
                      className="plan-week-input"
                      placeholder={`${kg(v.own == null ? v.limit : v.limit)} (usual)`}
                      value={draft[v.variety] ?? (v.own == null ? '' : String(v.own))}
                      readOnly={!manager || week.frozen}
                      onChange={(e) => setDraft({ ...draft, [v.variety]: e.target.value })}
                    />
                    <span className="small muted">kg</span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        <div className="btn-row mt-2">
          {manager && !week.frozen && (all.length > rows.length || showAll) ? (
            <button type="button" className="btn" onClick={() => setShowAll(!showAll)} aria-expanded={showAll}>
              {showAll ? 'Only varieties with pre-orders' : 'Set another variety for this week'}
            </button>
          ) : null}
          {manager && !week.frozen && changed.length > 0 && (
            <button type="submit" className="btn btn-primary" disabled={flow.checking}>
              {flow.checking ? 'Checking…' : 'Check this week’s change'}
            </button>
          )}
        </div>
        {week.frozen && manager && <DisabledReason>Deliveries for this week have started, so its expected kg can no longer change.</DisabledReason>}
        {formError && <p className="small text-warn">{formError}</p>}
      </form>
    </li>
  )
}

// ---------------------------------------------------------------- the bookings tab

const STATUS_LABEL: Record<PreorderStatus, string> = {
  PAYMENT_PENDING: 'Unpaid',
  BOOKED: 'Paid',
  WAITLISTED: 'Waitlist',
  CONVERTED: 'Order made',
  CANCELLED: 'Cancelled',
}
const STATUS_TONE: Record<PreorderStatus, Tone> = { PAYMENT_PENDING: 'warn', BOOKED: 'info', WAITLISTED: 'neutral', CONVERTED: 'good', CANCELLED: 'neutral' }
const FILTERS: readonly BookingFilter[] = ['delayed', 'unpaid', 'gift', 'waiting', 'cancelledAfterDelay']
const FILTER_LABEL: Record<BookingFilter, string> = {
  delayed: 'Delayed', unpaid: 'Unpaid', gift: 'Gift', waiting: 'Waiting for fruit', cancelledAfterDelay: 'Cancelled after delay',
}
const MESSAGE_KIND: Record<string, string> = {
  PREORDER_DELAYED: 'Delay message', PREORDER_EARLIER: 'Earlier-week message', PREORDER_BOOKED: 'Booking confirmation', PREORDER_MOVED: 'Moved message',
  PREORDER_SPOT_OPEN: 'Spot open', REFUNDED: 'Refund message', CANCELLED: 'Cancelled message',
}

/** The latest WhatsApp message about a booking, in plain words. */
function messageWords(m: Preorder['message']): { text: string; tone: Tone } {
  if (!m) return { text: 'No message', tone: 'neutral' }
  const what = MESSAGE_KIND[m.kind] ?? m.kind.toLowerCase().split('_').join(' ')
  if (m.status === 'PENDING') return { text: `${what}: queued${m.error?.startsWith('waiting for WhatsApp') ? ', waits for WhatsApp to be connected' : ''}`, tone: 'info' }
  if (m.status === 'SENT') return m.logged ? { text: `${what}: not sent, no WhatsApp connected`, tone: 'neutral' } : { text: `${what}: sent`, tone: 'good' }
  if (m.status === 'SKIPPED') return { text: `${what}: not sent${m.error ? ` (${m.error})` : ''}`, tone: 'warn' }
  return { text: `${what}: failed${m.error ? ` (${m.error})` : ''}`, tone: 'bad' }
}

const MOVABLE: PreorderStatus[] = ['PAYMENT_PENDING', 'BOOKED']
const OPEN: PreorderStatus[] = ['PAYMENT_PENDING', 'BOOKED', 'WAITLISTED']

function Bookings() {
  const [params, setParams] = useSearchParams()
  const filter = (FILTERS as readonly string[]).includes(params.get('filter') ?? '') ? (params.get('filter') as BookingFilter) : null
  const [search, setSearch] = useState(params.get('q') ?? '')
  const q = params.get('q') || null
  const list = useQuery({ queryKey: ['preorders', 'list', filter, q], queryFn: () => api.preorders(null, { filter, q }) })
  const { me } = useSession()
  const manager = me?.role === 'MANAGER'
  const [cancelling, setCancelling] = useState<Preorder | null>(null)
  const [moving, setMoving] = useState<Preorder | null>(null)
  function set(key: 'filter' | 'q', value: string | null) {
    const p = new URLSearchParams(params)
    if (value) p.set(key, value)
    else p.delete(key)
    setParams(p, { replace: true })
  }
  return (
    <section className="card">
      <h2>Bookings</h2>
      <StatusFilter value={filter} options={FILTERS} labels={FILTER_LABEL} onChange={(f) => set('filter', f)} className="mb-3" />
      <form
        className="plan-search mb-3"
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          set('q', search.trim() || null)
        }}
      >
        <label htmlFor="plan-search">Find a pre-order</label>
        <div className="btn-row">
          <input id="plan-search" type="search" placeholder="Number (any way), name or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button type="submit" className="btn">
            Find
          </button>
          {q && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setSearch('')
                set('q', null)
              }}
            >
              Clear
            </button>
          )}
        </div>
      </form>
      {list.isPending ? (
        <Spinner label="Loading pre-orders" />
      ) : list.isError ? (
        <QueryError error={list.error} onRetry={() => list.refetch()} />
      ) : list.data.length === 0 ? (
        <EmptyState>{q ? `No pre-order matches “${q}”.` : filter ? `No pre-orders are ${FILTER_LABEL[filter].toLowerCase()}.` : 'No pre-orders yet.'}</EmptyState>
      ) : (
        <div {...scrollRegion('Pre-orders', { cards: true })}>
          <table className="plan-bookings">
            <thead>
              <tr>
                <th>Pre-order</th>
                <th>Customer</th>
                <th>Box</th>
                <th className="num">Kg</th>
                <th>Week</th>
                <th>Status</th>
                <th>WhatsApp</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((p) => {
                const msg = messageWords(p.message)
                return (
                  <tr key={p.id}>
                    <td data-label="Pre-order">
                      <strong className="no-wrap">{p.number}</strong>
                      {p.order && (
                        <div className="small">
                          Order <Link to={`/orders/${p.order.id}`}>{p.order.number}</Link>, {date(p.order.deliveryDate)}
                        </div>
                      )}
                    </td>
                    <td data-label="Customer">
                      {p.customerName ?? '—'}
                      {p.phone && (
                        <div className="small">
                          <PhoneLink phone={p.phone} who={p.customerName ?? 'the customer'} />
                        </div>
                      )}
                      {p.gift && <div className="small">For {p.gift.recipientName}</div>}
                    </td>
                    <td data-label="Box">
                      {p.qty} × {p.productName}
                      <div className="muted small">{RIPENESS_LABEL[p.stage]}</div>
                    </td>
                    <td data-label="Kg" className="num">
                      {p.kg != null ? kg(p.kg) : '—'}
                    </td>
                    <td data-label="Week">
                      {p.delayed ? (
                        <>
                          <span className="no-wrap">{date(p.delayed.fromWeek)}</span> → <strong className="no-wrap">{date(p.delayed.toWeek)}</strong>
                          <div className="small muted">Weeks of: first promised → now</div>
                        </>
                      ) : (
                        weekLabel(p.weekStart)
                      )}
                    </td>
                    <td data-label="Status">
                      <div className="badge-row">
                        <Badge tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Badge>
                        {(p.gift || p.group) && <Badge tone="info">Gift</Badge>}
                        {p.delayed && <Badge tone="warn">{p.delayed.count > 1 ? `Delayed ×${p.delayed.count}` : 'Delayed'}</Badge>}
                        {p.cancelledAfterDelay && <Badge tone="neutral">Cancelled after delay</Badge>}
                      </div>
                      {p.refund && <div className="small muted">{p.refund.refundedAt ? `Refunded ${rupees(p.total)}` : 'Refund pending'}</div>}
                    </td>
                    <td data-label="WhatsApp">
                      <span className={`small plan-msg tone-${msg.tone}`}>{msg.text}</span>
                    </td>
                    <td data-label="Actions">
                      <div className="btn-row">
                        {MOVABLE.includes(p.status) ? (
                          <GatedButton allowed={manager} className="btn" onClick={() => setMoving(p)}>
                            Move<span className="sr-only"> {p.number} to another week</span>
                          </GatedButton>
                        ) : null}
                        {OPEN.includes(p.status) ? (
                          <GatedButton allowed={manager} className="btn" onClick={() => setCancelling(p)}>
                            {p.paymentStatus === 'SUCCEEDED' ? 'Cancel and refund' : 'Cancel'}
                            <span className="sr-only"> {p.number}</span>
                          </GatedButton>
                        ) : null}
                      </div>
                      {p.status === 'CONVERTED' && p.order && <p className="disabled-reason">It is an order now: cancel or move it from its order page.</p>}
                      {p.status === 'CANCELLED' && <p className="disabled-reason">Cancelled: nothing to do.</p>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {!manager && list.data?.some((p) => OPEN.includes(p.status)) && <ManagerOnlyNote what="Moving or cancelling a pre-order" />}
      {cancelling && <CancelPreorderDialog preorder={cancelling} onClose={() => setCancelling(null)} />}
      {moving && <MovePreorderDialog preorder={moving} onClose={() => setMoving(null)} />}
    </section>
  )
}

/** Moves one booking to another delivery week with room for its kg in its variety (the same delayed/earlier path as the plan). */
function MovePreorderDialog({ preorder, onClose }: { preorder: Preorder; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const weeks = useQuery({ queryKey: ['preorder-weeks'], queryFn: api.preorderWeeks })
  const left = (w: Week) => w.varieties?.find((v) => v.variety === preorder.variety)?.remaining ?? w.remaining
  // Only weeks the move can succeed in: room for its kg, and never earlier once we delayed it.
  const choices = (weeks.data?.weeks ?? []).filter((w) => w.weekStart !== preorder.weekStart && !w.frozen && left(w) >= (preorder.kg ?? 0) && (!preorder.delayed || w.weekStart > preorder.weekStart))
  const [to, setTo] = useState('')
  const chosen = to || choices.find((w) => w.weekStart > preorder.weekStart)?.weekStart || choices[0]?.weekStart || ''
  const later = chosen > preorder.weekStart
  const move = useMutation({
    mutationFn: (reason: string) => api.movePreorder(preorder.id, chosen, reason),
    onSuccess: () => {
      toast.success(`${preorder.number} moved to the ${weekLabel(chosen).toLowerCase()}`)
      void queryClient.invalidateQueries({ queryKey: ['preorders'] })
      void queryClient.invalidateQueries({ queryKey: ['preorder-weeks'] })
      onClose()
    },
  })
  return (
    <ReasonDialog
      title={`Move pre-order ${preorder.number}?`}
      tone="primary"
      confirmLabel="Move pre-order"
      busyLabel="Moving…"
      hint="At least 3 characters. Saved on the pre-order's history."
      busy={move.isPending}
      error={move.error}
      confirmDisabled={!chosen}
      onClose={onClose}
      onSubmit={(reason) => chosen && move.mutate(reason)}
    >
      {weeks.data && !choices.length ? (
        <DisabledReason>No open week has room for its {kg(preorder.kg ?? 0)} kg. Raise a week's kg first, or cancel it with a full refund.</DisabledReason>
      ) : (
        <div className="field">
          <label htmlFor="move-week">Move to</label>
          <select id="move-week" value={chosen} onChange={(e) => setTo(e.target.value)}>
            {choices.map((w) => (
              <option key={w.weekStart} value={w.weekStart}>
                {weekLabel(w.weekStart)} · {kg(left(w))} kg of {preorder.variety ?? 'this variety'} left
              </option>
            ))}
          </select>
        </div>
      )}
      {preorder.delayed && <p className="muted small">This order was delayed, so it can't be brought forward.</p>}
      {choices.length > 0 && <p className="muted small">
        Now in the {weekLabel(preorder.weekStart).toLowerCase()}. Its {preorder.kg != null ? `${kg(preorder.kg)} kg move` : 'kg moves'} with it.{' '}
        {preorder.status !== 'BOOKED'
          ? 'It is not paid yet: the customer sees the new week when they pay.'
          : later
            ? 'Later counts as a delay: the customer gets a message and may cancel for a full refund until it is packed.'
            : 'Earlier: the customer gets a good-news message.'}
      </p>}
    </ReasonDialog>
  )
}

/** A manager's cancel: a paid pre-order is refunded in full. */
function CancelPreorderDialog({ preorder, onClose }: { preorder: Preorder; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const paid = preorder.paymentStatus === 'SUCCEEDED'
  const stepUp = useStepUp(MONEY_CHANGE_WHY)
  const cancel = useMutation({
    mutationFn: (reason: string) => stepUp.run((code) => api.cancelPreorder(preorder.id, reason, code)),
    onSuccess: (r) => {
      toast.success(r.refunded ? `${preorder.number} cancelled; ${rupees(preorder.total)} is being refunded` : `${preorder.number} cancelled`)
      void queryClient.invalidateQueries({ queryKey: ['preorders'] })
      void queryClient.invalidateQueries({ queryKey: ['preorder-weeks'] })
      onClose()
    },
  })
  return (
    <>
      <ReasonDialog
        title={`Cancel pre-order ${preorder.number}?`}
        confirmLabel={paid ? `Cancel and refund ${rupees(preorder.total)}` : 'Cancel pre-order'}
        cancelLabel="Keep it"
        busyLabel="Cancelling…"
        hint="At least 3 characters. Saved on the pre-order's history."
        busy={cancel.isPending}
        error={cancel.error}
        onClose={onClose}
        onSubmit={(reason) => cancel.mutate(reason)}
      >
        <p>
          {paid
            ? `The customer paid ${rupees(preorder.total)}. It goes back to them in full. This can't be undone.`
            : 'It has not been paid, so there is nothing to refund.'}{' '}
          Its kg goes back to the week.
        </p>
      </ReasonDialog>
      {stepUp.dialog}
    </>
  )
}
