// One Partner Network enquiry: who applied, every answer they gave, their files, and the
// staff side (assignment, status, priority, notes, follow-ups and the activity history).
// Call, WhatsApp and Email open on this device and are recorded as contact attempts;
// the panel never sends a message itself. Decisions (approve, reject, close, reopen,
// convert) are for managers, and the API checks the same (docs/partner-network.md).
import { useId, useRef, useState, type FormEvent } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '../../api'
import { dateTime, istDate } from '../../format'
import { useSession } from '../../session'
import { BackLink, Badge, ConfirmDialog, Dialog, DisabledReason, EmptyState, FormError, ReasonDialog, Tabs, tabPanelProps, usePageTitle, useToast } from '../../ui'
import { pn } from './api'
import {
  ActivityTimeline,
  CHANNEL_LABEL,
  ContactButtons,
  DocumentList,
  ENQUIRY_STATUS_LABEL,
  EnquiryStatusBadge,
  LoadError,
  NotesPanel,
  PRIORITY_LABEL,
  PriorityText,
  ProposalStatusBadge,
  Skeleton,
  withMessage,
} from './shared'
import { PRIORITIES, type AnswerSection, type Channel, type EnquiryAction, type EnquiryDetail as Detail, type EnquiryStatus, type Followup, type Priority, type StaffOption } from './types'

type Tab = 'overview' | 'personal' | 'business' | 'proposal' | 'category' | 'documents' | 'notes' | 'followups' | 'activity'
const TAB_KEYS: Tab[] = ['overview', 'personal', 'business', 'proposal', 'category', 'documents', 'notes', 'followups', 'activity']

/** Which tab a questionnaire section's answers go under. */
function tabFor(sectionKey: string): Tab {
  if (sectionKey === 'personal' || sectionKey === 'business' || sectionKey === 'proposal') return sectionKey
  if (sectionKey === 'final') return 'overview'
  return 'category'
}

/** Statuses only the decision routes (with a reason or title) may set. */
const ACTION_ONLY: ReadonlySet<EnquiryStatus> = new Set<EnquiryStatus>(['CONVERTED', 'REJECTED', 'CLOSED'])

export default function EnquiryDetailPage() {
  const { id = '' } = useParams()
  const q = useQuery({ queryKey: ['pn-enquiry', id], queryFn: () => pn.enquiry(id) })
  usePageTitle(q.data ? `${q.data.reference} · Partner enquiry` : 'Partner enquiry')
  return (
    <>
      <BackLink to="/partner-network/enquiries">Enquiries</BackLink>
      {q.isPending ? (
        <Skeleton lines={10} />
      ) : q.isError ? (
        <LoadError error={q.error} onRetry={() => q.refetch()} notFound="This enquiry was not found. It may have the wrong address, or Partner Network is switched off." />
      ) : (
        <EnquiryView e={q.data} />
      )}
    </>
  )
}

/** The staff an enquiry can be assigned to: the detail carries them; an older API only had them on the list. */
function useStaff(e: Detail) {
  const fallback = useQuery({
    queryKey: ['pn-staff'],
    queryFn: () => pn.enquiries({ pageSize: 10 }),
    select: (d) => d.staff,
    staleTime: 5 * 60_000,
    enabled: !e.staff,
  })
  return e.staff ?? fallback.data ?? []
}

type Dialogs =
  | null
  | { kind: 'approve' }
  | { kind: 'reject' | 'close' | 'reopen' }
  | { kind: 'convert' }
  | { kind: 'requestInfo' }

function EnquiryView({ e }: { e: Detail }) {
  const { me } = useSession()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const tabParam = params.get('tab') as Tab | null
  const tab: Tab = tabParam && TAB_KEYS.includes(tabParam) ? tabParam : 'overview'
  const [dialog, setDialog] = useState<Dialogs>(null)
  const staff = useStaff(e)

  function saved(next?: Detail) {
    if (next && typeof next === 'object' && 'reference' in next) queryClient.setQueryData(['pn-enquiry', e.id], next)
    else void queryClient.invalidateQueries({ queryKey: ['pn-enquiry', e.id] })
    void queryClient.invalidateQueries({ queryKey: ['pn-enquiries'] })
    void queryClient.invalidateQueries({ queryKey: ['pn-overview'] })
  }

  const act = useMutation({
    mutationFn: ({ action, body }: { action: EnquiryAction; body: Record<string, string> }) => pn.action(e.id, action, body),
    onSuccess: (next, { action }) => {
      saved(next)
      setDialog(null)
      toast.success(ACTION_DONE[action])
    },
  })

  const sections = (t: Tab) => e.sections.filter((s) => tabFor(s.key) === t)
  const pendingFollowups = e.followups.filter((f) => f.status === 'PENDING').length
  const tabs: [Tab, string][] = [
    ['overview', 'Overview'],
    ['personal', 'Personal information'],
    ['business', 'Business information'],
    ['proposal', 'Partnership proposal'],
    ['category', 'Category-specific answers'],
    ['documents', `Supporting documents (${e.documents.length})`],
    ['notes', `Internal notes (${e.notes.length})`],
    ['followups', `Follow-ups (${pendingFollowups})`],
    ['activity', 'Activity history'],
  ]
  const managerActions = (['approve', 'reject', 'close', 'reopen', 'convert'] as const).filter((a) => e.actions[a])
  const who = `${e.name}, ${e.reference}`

  return (
    <>
      <div className="topbar mb-2">
        <h1>{e.name}</h1>
        <EnquiryStatusBadge status={e.status} />
      </div>
      <p className="pn-meta">
        <span className="mono">{e.reference}</span>
        {e.businessName && <span>{e.businessName}</span>}
        <span>
          Priority: <PriorityText priority={e.priority} />
        </span>
        <span>Assigned to: {e.assignedTo?.email ?? 'no one'}</span>
        <span>Submitted {dateTime(e.submittedAt)}</span>
      </p>

      <section className="card" aria-labelledby="pn-actions">
        <h2 id="pn-actions" className="sr-only">
          Actions
        </h2>
        <div className="btn-row">
          <ContactButtons enquiryId={e.id} contact={e.contact} who={e.name} />
          <button type="button" className="btn" onClick={() => setDialog({ kind: 'requestInfo' })}>
            Request more information
          </button>
          {managerActions.map((a) => (
            <button key={a} type="button" className={`btn${a === managerActions[0] && (a === 'approve' || a === 'convert') ? ' btn-primary' : ''}`} onClick={() => setDialog({ kind: a } as Dialogs)}>
              {ACTION_LABEL[a]}
            </button>
          ))}
        </div>
        <p className="muted small mb-0 mt-2">Call, WhatsApp and Email open on this device and are recorded as contact attempts. Nothing is sent from the panel.</p>
        {me?.role !== 'MANAGER' && <DisabledReason>Approve, reject, close, reopen and convert: requires manager role.</DisabledReason>}
      </section>

      <ManageCard e={e} staff={staff} onSaved={saved} />

      <div className="pn-tabs-wrap">
        <Tabs id="pn-enquiry" label="Enquiry details" tabs={tabs} value={tab} onChange={(t) => setParams(t === 'overview' ? {} : { tab: t }, { replace: true })} />
      </div>
      <div {...tabPanelProps('pn-enquiry', tab)} className="pn-tabpanel">
        {tab === 'overview' && <OverviewTab e={e} />}
        {(tab === 'personal' || tab === 'business' || tab === 'proposal' || tab === 'category') && <AnswersTab sections={sections(tab)} />}
        {tab === 'documents' && (
          <section className="card">
            <h2>Supporting documents</h2>
            <p className="muted small">Files open with your sign-in. Every download is recorded in the activity log.</p>
            <DocumentList enquiryId={e.id} documents={e.documents} />
          </section>
        )}
        {tab === 'notes' && (
          <section className="card">
            <h2>Internal notes</h2>
            <NotesPanel
              notes={e.notes}
              onAdd={async (note) => {
                await pn.addNote(e.id, note)
                saved()
              }}
            />
          </section>
        )}
        {tab === 'followups' && <FollowupsTab e={e} staff={staff} myEmail={me?.email} onSaved={() => saved()} />}
        {tab === 'activity' && (
          <section className="card">
            <h2>Activity history</h2>
            <ActivityTimeline activity={e.activity} />
          </section>
        )}
      </div>

      {dialog?.kind === 'approve' && (
        <ApproveDialog busy={act.isPending} error={act.error} onClose={() => setDialog(null)} onSubmit={(note) => act.mutate({ action: 'approve', body: note ? { note } : {} })} />
      )}
      {(dialog?.kind === 'reject' || dialog?.kind === 'close' || dialog?.kind === 'reopen') && (
        <ReasonDialog
          title={`${ACTION_LABEL[dialog.kind]} ${e.reference}?`}
          confirmLabel={ACTION_LABEL[dialog.kind]}
          minLength={5}
          maxLength={1000}
          tone={dialog.kind === 'reopen' ? 'primary' : 'danger'}
          busy={act.isPending}
          error={act.error}
          onClose={() => setDialog(null)}
          onSubmit={(reason) => act.mutate({ action: dialog.kind, body: { reason } })}
        >
          <p>{REASON_WHY[dialog.kind]}</p>
        </ReasonDialog>
      )}
      {dialog?.kind === 'convert' && (
        <ConvertDialog
          reference={e.reference}
          busy={act.isPending}
          error={act.error}
          onClose={() => setDialog(null)}
          onSubmit={(title, notes) => act.mutate({ action: 'convert', body: notes ? { title, notes } : { title } })}
        />
      )}
      {dialog?.kind === 'requestInfo' && <RequestInfoDialog e={e} onClose={() => setDialog(null)} onSaved={() => saved()} who={who} />}
    </>
  )
}

const ACTION_LABEL: Record<EnquiryAction, string> = { approve: 'Approve', reject: 'Reject', close: 'Close', reopen: 'Reopen', convert: 'Convert' }
const ACTION_DONE: Record<EnquiryAction, string> = {
  approve: 'Approved for a business discussion. The enquiry is now in negotiation.',
  reject: 'Enquiry rejected',
  close: 'Enquiry closed',
  reopen: 'Enquiry reopened for review',
  convert: 'Converted. The business opportunity is recorded.',
}
const REASON_WHY: Record<'reject' | 'close' | 'reopen', string> = {
  reject: 'The enquiry ends as rejected. The reason is kept in its history; the applicant is not told from here.',
  close: 'The enquiry is closed. The reason is kept in its history.',
  reopen: 'The enquiry goes back to Under review. The reason is kept in its history.',
}

// ---------- Assignment, status, priority ----------

function ManageCard({ e, staff, onSaved }: { e: Detail; staff: StaffOption[]; onSaved: (next: Detail) => void }) {
  const uid = useId()
  const toast = useToast()
  const [assignee, setAssignee] = useState(e.assignedTo?.id ?? '')
  const [status, setStatus] = useState<EnquiryStatus | ''>('')
  const [priority, setPriority] = useState<Priority>(e.priority)
  const statusOptions = ACTION_ONLY.has(e.status) ? [] : e.allowedStatuses.filter((s) => s !== e.status && !ACTION_ONLY.has(s))

  const patch = useMutation({
    mutationFn: (body: Parameters<typeof pn.patchEnquiry>[1]) => pn.patchEnquiry(e.id, body),
    onSuccess: (next, body) => {
      onSaved(next)
      setStatus('')
      if ('assignedTo' in body) toast.success(body.assignedTo ? 'Assigned' : 'Unassigned')
      else if (body.status) toast.success(`Status changed to ${ENQUIRY_STATUS_LABEL[body.status]}`)
      else if (body.priority) toast.success(`Priority set to ${PRIORITY_LABEL[body.priority]}`)
    },
  })
  // The current assignee stays listed even if the staff list has not loaded or no longer has them.
  const options = e.assignedTo && !staff.some((s) => s.id === e.assignedTo?.id) ? [{ ...e.assignedTo, role: '' }, ...staff] : staff

  return (
    <section className="card" aria-labelledby={`${uid}-h`}>
      <h2 id={`${uid}-h`}>Manage</h2>
      <div className="field-row">
        <form
          className="pn-inline-form"
          onSubmit={(ev) => {
            ev.preventDefault()
            patch.mutate({ assignedTo: assignee || null })
          }}
        >
          <div className="field mb-0">
            <label htmlFor={`${uid}-assign`}>Assigned to</label>
            <select id={`${uid}-assign`} value={assignee} disabled={!e.actions.assign} onChange={(ev) => setAssignee(ev.target.value)}>
              <option value="">No one</option>
              {options.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.email}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn" disabled={!e.actions.assign || patch.isPending || assignee === (e.assignedTo?.id ?? '')}>
            Assign
          </button>
        </form>
        <form
          className="pn-inline-form"
          onSubmit={(ev) => {
            ev.preventDefault()
            if (status) patch.mutate({ status })
          }}
        >
          <div className="field mb-0">
            <label htmlFor={`${uid}-status`}>Change status</label>
            <select id={`${uid}-status`} value={status} disabled={statusOptions.length === 0} onChange={(ev) => setStatus(ev.target.value as EnquiryStatus | '')}>
              <option value="">{ENQUIRY_STATUS_LABEL[e.status]} (now)</option>
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {ENQUIRY_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn" disabled={!status || patch.isPending}>
            Change status
          </button>
        </form>
        <form
          className="pn-inline-form"
          onSubmit={(ev) => {
            ev.preventDefault()
            patch.mutate({ priority })
          }}
        >
          <div className="field mb-0">
            <label htmlFor={`${uid}-priority`}>Priority</label>
            <select id={`${uid}-priority`} value={priority} onChange={(ev) => setPriority(ev.target.value as Priority)}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn" disabled={patch.isPending || priority === e.priority}>
            Set priority
          </button>
        </form>
      </div>
      {statusOptions.length === 0 && (
        <DisabledReason>
          {ACTION_ONLY.has(e.status) ? `A ${ENQUIRY_STATUS_LABEL[e.status].toLowerCase()} enquiry only moves through the actions above.` : 'No other status is open from here.'}
        </DisabledReason>
      )}
      <FormError error={patch.error} />
    </section>
  )
}

// ---------- Tabs ----------

function AnswerList({ section }: { section: AnswerSection }) {
  return (
    <dl className="pn-answers">
      {section.answers.map((a) => (
        <div key={a.key} className="pn-answer">
          <dt>{a.label}</dt>
          <dd>{a.value === null || a.value === '' ? <span className="muted">Not answered</span> : <span className="pre-wrap">{a.value}</span>}</dd>
        </div>
      ))}
    </dl>
  )
}

function AnswersTab({ sections }: { sections: AnswerSection[] }) {
  if (sections.length === 0) return <EmptyState>The applicant was not asked these questions.</EmptyState>
  return (
    <>
      {sections.map((s) => (
        <section key={s.key} className="card" aria-labelledby={`pn-sec-${s.key}`}>
          <h2 id={`pn-sec-${s.key}`}>{s.title}</h2>
          {s.answers.length === 0 ? <p className="muted">No questions in this part.</p> : <AnswerList section={s} />}
        </section>
      ))}
    </>
  )
}

function OverviewTab({ e }: { e: Detail }) {
  const more = e.categories.filter((c) => c.code !== e.primaryCategory?.code)
  const final = e.sections.filter((s) => s.key === 'final')
  return (
    <div className="grid-2">
      <div>
        <section className="card">
          <h2>Summary</h2>
          <dl className="kv pn-kv">
            <dt>Reference</dt>
            <dd className="mono">{e.reference}</dd>
            <dt>Status</dt>
            <dd>
              <EnquiryStatusBadge status={e.status} />
              {e.decision && <span className="muted small"> · decision: {e.decision.toLowerCase()}</span>}
            </dd>
            <dt>Primary category</dt>
            <dd>{e.primaryCategory?.name ?? '—'}</dd>
            <dt>Other categories</dt>
            <dd>{more.length ? more.map((c) => c.name).join(', ') : '—'}</dd>
            <dt>Location</dt>
            <dd>{[e.city, e.state, e.pincode, e.country].filter(Boolean).join(', ') || '—'}</dd>
            <dt>Mobile</dt>
            <dd>{e.mobile ?? '—'}</dd>
            <dt>Email</dt>
            <dd className="pn-email">{e.email ?? '—'}</dd>
            <dt>Prefers</dt>
            <dd>{e.preferredContact ? (CHANNEL_LABEL[e.preferredContact as Channel] ?? e.preferredContact) : '—'}</dd>
            <dt>Best time to call</dt>
            <dd>{e.callbackTime ?? '—'}</dd>
            <dt>Wants to start</dt>
            <dd>{e.startTimeline ?? '—'}</dd>
            <dt>Assigned to</dt>
            <dd>
              {e.assignedTo?.email ?? 'No one'}
              {e.assignedAt && (
                <span className="muted small">
                  {' '}
                  · {dateTime(e.assignedAt)}
                  {e.assignedBy ? ` by ${e.assignedBy.email}` : ''}
                </span>
              )}
            </dd>
            <dt>Submitted</dt>
            <dd>{dateTime(e.submittedAt)}</dd>
            <dt>Form version</dt>
            <dd className="mono small">{e.questionnaireVersion}</dd>
          </dl>
        </section>
        {final.map((s) => (
          <section key={s.key} className="card" aria-labelledby="pn-sec-final">
            <h2 id="pn-sec-final">{s.title}</h2>
            <AnswerList section={s} />
          </section>
        ))}
      </div>
      <div>
        {e.opportunity && (
          <section className="card" aria-labelledby="pn-opp">
            <h2 id="pn-opp">Business opportunity</h2>
            <p className="mb-0">
              <strong>{e.opportunity.title}</strong>
            </p>
            {e.opportunity.notes && <p className="pre-wrap">{e.opportunity.notes}</p>}
            <p className="muted small mb-0">
              Recorded {dateTime(e.opportunity.createdAt)}
              {e.opportunity.createdBy ? ` by ${e.opportunity.createdBy}` : ''}
            </p>
          </section>
        )}
        {e.proposal && (
          <section className="card" aria-labelledby="pn-prop">
            <h2 id="pn-prop">Product proposal</h2>
            <p className="mb-0">
              <Link to={`/partner-network/proposals/${encodeURIComponent(e.proposal.id)}`}>Open product proposal {e.proposal.reference}</Link>{' '}
              <ProposalStatusBadge status={e.proposal.status} />
            </p>
          </section>
        )}
        <section className="card" aria-labelledby="pn-next">
          <h2 id="pn-next">Next follow-up</h2>
          <NextFollowup followups={e.followups} />
        </section>
        {e.consent && (
          <section className="card" aria-labelledby="pn-consent">
            <h2 id="pn-consent">Consent</h2>
            <p className="small">{e.consent.text}</p>
            <p className="muted small mb-0">Given {dateTime(e.consent.at)}</p>
          </section>
        )}
      </div>
    </div>
  )
}

function NextFollowup({ followups }: { followups: Followup[] }) {
  const next = followups.filter((f) => f.status === 'PENDING').sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0]
  if (!next) return <p className="muted mb-0">None scheduled.</p>
  return (
    <p className="mb-0">
      {dateTime(next.scheduledAt)} · {next.assignedTo?.email ?? 'not assigned'} {next.overdue && <Badge tone="bad">Overdue</Badge>}
    </p>
  )
}

// ---------- Follow-ups ----------

const FOLLOWUP_STATUS: Record<Followup['status'], string> = { PENDING: 'Pending', DONE: 'Done', CANCELLED: 'Cancelled' }

/** A date and time typed in IST, as an ISO timestamp. */
function istToIso(day: string, time: string): string {
  return new Date(`${day}T${time}:00+05:30`).toISOString()
}

/** An ISO timestamp as the IST date and time fields. */
function isoToIst(iso: string): { day: string; time: string } {
  const d = new Date(iso)
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d)
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
  return { day, time }
}

function followupError(err: unknown): unknown {
  if (err instanceof ApiError && err.code === 'FOLLOWUP_EXISTS') return 'A follow-up is already scheduled for that moment. Pick another time, or edit the one that is there.'
  if (err instanceof ApiError && err.code === 'ENQUIRY_ENDED') return 'This enquiry is rejected or closed. Reopen it before scheduling a follow-up.'
  return err
}

function FollowupsTab({ e, staff, myEmail, onSaved }: { e: Detail; staff: StaffOption[]; myEmail?: string; onSaved: () => void }) {
  const toast = useToast()
  const [editing, setEditing] = useState<Followup | null>(null)
  const [cancelling, setCancelling] = useState<Followup | null>(null)
  const change = useMutation({
    mutationFn: ({ f, body }: { f: Followup; body: Parameters<typeof pn.patchFollowup>[2] }) => pn.patchFollowup(e.id, f.id, body),
    onSuccess: (_, { body }) => {
      onSaved()
      setEditing(null)
      setCancelling(null)
      toast.success(body.status === 'DONE' ? 'Follow-up marked done' : body.status === 'CANCELLED' ? 'Follow-up cancelled' : 'Follow-up updated')
    },
    onError: (err) => {
      if (!editing && !cancelling) toast.error(err)
    },
  })
  const sorted = [...e.followups].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
  return (
    <>
      <section className="card" aria-labelledby="pn-fu-h">
        <h2 id="pn-fu-h">Follow-ups</h2>
        {sorted.length === 0 ? (
          <EmptyState>No follow-ups yet.</EmptyState>
        ) : (
          <ul className="plain-list" aria-label="Follow-ups">
            {sorted.map((f) => (
              <li key={f.id} className={`pn-followup${f.overdue && f.status === 'PENDING' ? ' pn-overdue' : ''}`}>
                <div>
                  <strong>{dateTime(f.scheduledAt)}</strong> {f.overdue && f.status === 'PENDING' && <Badge tone="bad">Overdue</Badge>}{' '}
                  {f.status !== 'PENDING' && <Badge tone={f.status === 'DONE' ? 'good' : 'neutral'}>{FOLLOWUP_STATUS[f.status]}</Badge>}
                  <div className="small">{f.assignedTo?.email ?? 'Not assigned'}</div>
                  {f.notes && <p className="pre-wrap mb-0 small">{f.notes}</p>}
                  {f.completedAt && <div className="muted small">Done {dateTime(f.completedAt)}</div>}
                </div>
                {f.status === 'PENDING' && (
                  <div className="btn-row">
                    <button type="button" className="btn btn-small" disabled={change.isPending} onClick={() => change.mutate({ f, body: { status: 'DONE' } })}>
                      Mark done<span className="sr-only"> (follow-up {dateTime(f.scheduledAt)})</span>
                    </button>
                    <button type="button" className="btn btn-small" onClick={() => setEditing(f)}>
                      Edit<span className="sr-only"> follow-up {dateTime(f.scheduledAt)}</span>
                    </button>
                    <button type="button" className="btn btn-small" onClick={() => setCancelling(f)}>
                      Cancel<span className="sr-only"> follow-up {dateTime(f.scheduledAt)}</span>
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <AddFollowup e={e} staff={staff} myEmail={myEmail} onSaved={onSaved} />
      {editing && (
        <FollowupDialog
          title="Edit follow-up"
          staff={staff}
          initial={editing}
          busy={change.isPending}
          error={followupError(change.error)}
          onClose={() => {
            setEditing(null)
            change.reset()
          }}
          onSubmit={(body) => change.mutate({ f: editing, body })}
        />
      )}
      {cancelling && (
        <ConfirmDialog
          title="Cancel this follow-up?"
          confirmLabel="Cancel follow-up"
          cancelLabel="Keep it"
          tone="danger"
          busy={change.isPending}
          error={change.error}
          onClose={() => {
            setCancelling(null)
            change.reset()
          }}
          onConfirm={() => change.mutate({ f: cancelling, body: { status: 'CANCELLED' } })}
        >
          <p>
            The follow-up on {dateTime(cancelling.scheduledAt)} is cancelled and no reminder goes out for it. It stays in the history.
          </p>
        </ConfirmDialog>
      )}
    </>
  )
}

function FollowupFields({
  uid,
  staff,
  day,
  time,
  assignee,
  notes,
  set,
}: {
  uid: string
  staff: StaffOption[]
  day: string
  time: string
  assignee: string
  notes: string
  set: (k: 'day' | 'time' | 'assignee' | 'notes', v: string) => void
}) {
  return (
    <>
      <div className="field-row">
        <div className="field">
          <label htmlFor={`${uid}-day`}>Date</label>
          <input id={`${uid}-day`} type="date" required min={istDate(0)} value={day} onChange={(ev) => set('day', ev.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${uid}-time`}>Time (IST)</label>
          <input id={`${uid}-time`} type="time" required value={time} onChange={(ev) => set('time', ev.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${uid}-who`}>Who follows up</label>
          <select id={`${uid}-who`} value={assignee} onChange={(ev) => set('assignee', ev.target.value)}>
            <option value="">No one in particular</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.email}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor={`${uid}-notes`}>Notes (optional)</label>
        <textarea id={`${uid}-notes`} rows={2} maxLength={1000} value={notes} onChange={(ev) => set('notes', ev.target.value)} />
      </div>
    </>
  )
}

function AddFollowup({ e, staff, myEmail, onSaved }: { e: Detail; staff: StaffOption[]; myEmail?: string; onSaved: () => void }) {
  const uid = useId()
  const toast = useToast()
  const mine = staff.find((s) => s.email === myEmail)?.id ?? ''
  const [form, setForm] = useState({ day: istDate(1), time: '11:00', assignee: '', notes: '' })
  const [touchedAssignee, setTouchedAssignee] = useState(false)
  const assignee = touchedAssignee ? form.assignee : form.assignee || mine
  const add = useMutation({
    mutationFn: () =>
      pn.addFollowup(e.id, {
        scheduledAt: istToIso(form.day, form.time),
        ...(assignee ? { assignedTo: assignee } : {}),
        ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
      }),
    onSuccess: () => {
      onSaved()
      setForm((f) => ({ ...f, notes: '' }))
      toast.success('Follow-up scheduled')
    },
  })
  // One request at a time: a double click must not schedule it twice. A ref, because the
  // mutation's pending state reaches the button a moment after the first click.
  const sending = useRef(false)
  function submit(ev: FormEvent) {
    ev.preventDefault()
    if (sending.current) return
    sending.current = true
    add.mutate(undefined, { onSettled: () => void (sending.current = false) })
  }
  return (
    <section className="card" aria-labelledby={`${uid}-h`}>
      <h2 id={`${uid}-h`}>Schedule a follow-up</h2>
      <form onSubmit={submit}>
        <FollowupFields
          uid={uid}
          staff={staff}
          day={form.day}
          time={form.time}
          assignee={assignee}
          notes={form.notes}
          set={(k, v) => {
            if (k === 'assignee') setTouchedAssignee(true)
            setForm((f) => ({ ...f, [k]: v }))
          }}
        />
        <FormError error={followupError(add.error)} />
        <button type="submit" className="btn btn-primary" disabled={add.isPending || !form.day || !form.time}>
          {add.isPending ? 'Scheduling…' : 'Schedule follow-up'}
        </button>
      </form>
    </section>
  )
}

function FollowupDialog({
  title,
  staff,
  initial,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  title: string
  staff: StaffOption[]
  initial: Followup
  busy: boolean
  error: unknown
  onClose: () => void
  onSubmit: (body: { scheduledAt: string; assignedTo: string | null; notes: string }) => void
}) {
  const uid = useId()
  const start = isoToIst(initial.scheduledAt)
  const [form, setForm] = useState({ day: start.day, time: start.time, assignee: initial.assignedTo?.id ?? '', notes: initial.notes ?? '' })
  function submit(ev: FormEvent) {
    ev.preventDefault()
    if (busy) return
    onSubmit({ scheduledAt: istToIso(form.day, form.time), assignedTo: form.assignee || null, notes: form.notes.trim() })
  }
  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form={`${uid}-form`} className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save follow-up'}
          </button>
        </>
      }
    >
      <form id={`${uid}-form`} onSubmit={submit}>
        <FollowupFields uid={uid} staff={staff} {...form} set={(k, v) => setForm((f) => ({ ...f, [k]: v }))} />
        <FormError error={error} />
      </form>
    </Dialog>
  )
}

// ---------- Dialogs ----------

function ApproveDialog({ busy, error, onClose, onSubmit }: { busy: boolean; error: unknown; onClose: () => void; onSubmit: (note: string) => void }) {
  const uid = useId()
  const [note, setNote] = useState('')
  return (
    <Dialog
      title="Approve for a business discussion?"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} data-autofocus>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onSubmit(note.trim())}>
            {busy ? 'Saving…' : 'Approve'}
          </button>
        </>
      }
    >
      <p>The enquiry moves to In negotiation and its decision is recorded as approved. Nothing is sent to the applicant from here.</p>
      <div className="field">
        <label htmlFor={`${uid}-note`}>Note (optional)</label>
        <textarea id={`${uid}-note`} rows={2} maxLength={1000} value={note} onChange={(ev) => setNote(ev.target.value)} />
      </div>
      <FormError error={error} />
    </Dialog>
  )
}

function ConvertDialog({
  reference,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  reference: string
  busy: boolean
  error: unknown
  onClose: () => void
  onSubmit: (title: string, notes: string) => void
}) {
  const uid = useId()
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const valid = title.trim().length >= 3
  return (
    <Dialog
      title={`Convert ${reference}?`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form={`${uid}-form`} className="btn btn-primary" disabled={!valid || busy}>
            {busy ? 'Saving…' : 'Convert'}
          </button>
        </>
      }
    >
      <form
        id={`${uid}-form`}
        onSubmit={(ev) => {
          ev.preventDefault()
          if (valid && !busy) onSubmit(title.trim(), notes.trim())
        }}
      >
        <p>Records a business opportunity and marks the enquiry as converted. It does not create an account, a product or a payment.</p>
        <div className="field">
          <label htmlFor={`${uid}-title`}>Opportunity title</label>
          <input id={`${uid}-title`} value={title} maxLength={160} onChange={(ev) => setTitle(ev.target.value)} aria-describedby={`${uid}-hint`} data-autofocus />
          <p id={`${uid}-hint`} className="hint">
            Required, at least 3 characters. For example “Pune retail pilot, 40 boxes a week”.
          </p>
        </div>
        <div className="field">
          <label htmlFor={`${uid}-notes`}>Notes (optional)</label>
          <textarea id={`${uid}-notes`} rows={3} maxLength={3000} value={notes} onChange={(ev) => setNotes(ev.target.value)} />
        </div>
        <FormError error={error} />
      </form>
    </Dialog>
  )
}

/** Opens a link the way a click on it would (a new tab for WhatsApp, the mail app for mailto:). */
function openLink(href: string, newTab: boolean) {
  const a = document.createElement('a')
  a.href = href
  if (newTab) {
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
  }
  document.body.appendChild(a)
  a.click()
  a.remove()
}

function RequestInfoDialog({ e, onClose, onSaved, who }: { e: Detail; onClose: () => void; onSaved: () => void; who: string }) {
  const uid = useId()
  const channels: Channel[] = [
    ...(e.contact.whatsapp ? (['WHATSAPP'] as const) : []),
    ...(e.contact.mailto ? (['EMAIL'] as const) : []),
    ...(e.contact.tel ? (['PHONE'] as const) : []),
  ]
  const preferred = channels.includes(e.preferredContact as Channel) ? (e.preferredContact as Channel) : (channels[0] ?? 'WHATSAPP')
  const [channel, setChannel] = useState<Channel>(preferred)
  const firstName = e.name.split(/\s+/)[0] || e.name
  const [message, setMessage] = useState(
    `Hello ${firstName}, thank you for your partnership enquiry ${e.reference} with MandiMangoes. To take it forward, could you please share: `,
  )
  const [done, setDone] = useState<{ channel: Channel; link: string | null } | null>(null)
  const subject = `Your MandiMangoes partnership enquiry ${e.reference}`

  const send = useMutation({
    mutationFn: () => pn.requestInfo(e.id, channel, message.trim()),
    onSuccess: () => {
      onSaved()
      const link =
        channel === 'WHATSAPP' && e.contact.whatsapp
          ? withMessage(e.contact.whatsapp, 'WHATSAPP', message.trim())
          : channel === 'EMAIL' && e.contact.mailto
            ? withMessage(e.contact.mailto, 'EMAIL', message.trim(), subject)
            : null
      if (link) openLink(link, channel === 'WHATSAPP')
      setDone({ channel, link })
    },
  })

  if (done) {
    const text: Record<Channel, string> = {
      WHATSAPP: 'Opened in WhatsApp — send it from there.',
      EMAIL: 'Opened in your email app — send it from there.',
      PHONE: 'Request recorded. Ask for this when you call.',
    }
    return (
      <Dialog
        title="Request recorded"
        onClose={onClose}
        footer={
          <button type="button" className="btn btn-primary" onClick={onClose} data-autofocus>
            Done
          </button>
        }
      >
        <p role="status">{text[done.channel]}</p>
        <p className="muted small">The panel does not send messages. The request is in the enquiry’s history{e.status === 'NEW' || e.status === 'UNDER_REVIEW' ? ', and the enquiry is now marked as contacted' : ''}.</p>
        {done.link && (
          <p className="mb-0">
            Nothing opened?{' '}
            <a href={done.link} {...(done.channel === 'WHATSAPP' ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
              {done.channel === 'WHATSAPP' ? 'Open WhatsApp again' : 'Open the email again'}
              <span className="sr-only"> for {who}</span>
            </a>
          </p>
        )}
      </Dialog>
    )
  }

  const valid = message.trim().length >= 5
  return (
    <Dialog
      title="Request more information"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form={`${uid}-form`} className="btn btn-primary" disabled={!valid || send.isPending}>
            {send.isPending ? 'Saving…' : channel === 'PHONE' ? 'Record request' : `Record and open ${channel === 'WHATSAPP' ? 'WhatsApp' : 'email'}`}
          </button>
        </>
      }
    >
      <form
        id={`${uid}-form`}
        onSubmit={(ev) => {
          ev.preventDefault()
          if (valid && !send.isPending) send.mutate()
        }}
      >
        <p>The request is recorded on the enquiry, then {channel === 'PHONE' ? 'you call the applicant' : 'the message opens on this device for you to send'}. The panel does not send it.</p>
        <fieldset className="field">
          <legend className="field-label">How</legend>
          {channels.map((c) => (
            <label key={c} className="check-inline pn-radio">
              <input type="radio" name={`${uid}-channel`} value={c} checked={channel === c} onChange={() => setChannel(c)} />
              {CHANNEL_LABEL[c]}
            </label>
          ))}
        </fieldset>
        <div className="field">
          <label htmlFor={`${uid}-msg`}>Message</label>
          <textarea id={`${uid}-msg`} rows={5} maxLength={2000} value={message} onChange={(ev) => setMessage(ev.target.value)} data-autofocus />
        </div>
        <FormError error={send.error} />
      </form>
    </Dialog>
  )
}

