// Pieces the Partner Network pages share: labels, badges, the section's sub-navigation,
// loading skeletons, contact links, documents, notes and the activity timeline.
import { useId, useRef, useState, type FormEvent } from 'react'
import { NavLink } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '../../api'
import type { Tone } from '../../format'
import { dateTime } from '../../format'
import { AuthedPhoto, Badge, DownloadButton, EmptyState, FormError, QueryError, useToast } from '../../ui'
import { pn } from './api'
import type { Activity, Channel, ContactLinks, EnquiryStatus, Note, PartnerDocument, Priority, ProposalStatus } from './types'

export const ENQUIRY_STATUS_LABEL: Record<EnquiryStatus, string> = {
  NEW: 'New',
  UNDER_REVIEW: 'Under review',
  CONTACTED: 'Contacted',
  NEGOTIATION: 'In negotiation',
  CONVERTED: 'Converted',
  REJECTED: 'Rejected',
  CLOSED: 'Closed',
}

export const PRIORITY_LABEL: Record<Priority, string> = { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' }

export const PROPOSAL_STATUS_LABEL: Record<ProposalStatus, string> = {
  SUBMITTED: 'Submitted',
  UNDER_EVALUATION: 'Under evaluation',
  SAMPLE_REQUESTED: 'Sample requested',
  QUALITY_REVIEW: 'Quality review',
  COMMERCIAL_REVIEW: 'Commercial review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CLOSED: 'Closed',
}

export const CHANNEL_LABEL: Record<Channel, string> = { PHONE: 'Phone call', WHATSAPP: 'WhatsApp', EMAIL: 'Email' }

/** Restrained: only a new enquiry (waiting on us) and a converted one carry a colour. */
function enquiryTone(s: EnquiryStatus): Tone {
  if (s === 'NEW') return 'info'
  if (s === 'CONVERTED') return 'good'
  return 'neutral'
}

export function EnquiryStatusBadge({ status }: { status: EnquiryStatus }) {
  return <Badge tone={enquiryTone(status)}>{ENQUIRY_STATUS_LABEL[status] ?? status}</Badge>
}

export function ProposalStatusBadge({ status }: { status: ProposalStatus }) {
  const tone: Tone = status === 'SUBMITTED' ? 'info' : status === 'APPROVED' ? 'good' : 'neutral'
  return <Badge tone={tone}>{PROPOSAL_STATUS_LABEL[status] ?? status}</Badge>
}

/** Normal and low priority are plain text; high and urgent are marked, always with the word. */
export function PriorityText({ priority }: { priority: Priority }) {
  if (priority === 'URGENT') return <Badge tone="bad">Urgent</Badge>
  if (priority === 'HIGH') return <Badge tone="warn">High</Badge>
  return <>{PRIORITY_LABEL[priority] ?? priority}</>
}

/** Rupees as numbers (not paise): "₹1,250". */
const inrFmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 })
export function inr(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : inrFmt.format(n)
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** A Yes/No answer that may come as a boolean or words. */
export function yesNo(v: string | boolean | null | undefined): string {
  if (v === true) return 'Yes'
  if (v === false) return 'No'
  return v || '—'
}

/** The four pages of the section, as a row of links under the title. */
export function PartnerSubnav() {
  const link = ({ isActive }: { isActive: boolean }) => `btn btn-small${isActive ? ' pn-subnav-active' : ''}`
  return (
    <nav className="pn-subnav" aria-label="Partner Network">
      <NavLink to="/partner-network" end className={link}>
        Overview
      </NavLink>
      <NavLink to="/partner-network/enquiries" className={link}>
        Enquiries
      </NavLink>
      <NavLink to="/partner-network/proposals" className={link}>
        Product proposals
      </NavLink>
      <NavLink to="/partner-network/categories" className={link}>
        Categories
      </NavLink>
    </nav>
  )
}

/** Shaded lines in the shape of what is coming. Read out as "Loading". */
export function Skeleton({ lines = 4, tiles = 0 }: { lines?: number; tiles?: number }) {
  return (
    <div className="pn-skeleton" role="status" aria-label="Loading">
      {tiles > 0 && (
        <div className="tiles">
          {Array.from({ length: tiles }, (_, i) => (
            <div key={i} className="tile tile-placeholder pn-skeleton-tile" />
          ))}
        </div>
      )}
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="pn-skeleton-line" />
      ))}
    </div>
  )
}

/** While PARTNER_NETWORK is off the API answers 404 on every route. */
export function isSwitchedOff(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404
}

/** A failed load: the switched-off case in words, anything else with Retry. */
export function LoadError({ error, onRetry, notFound }: { error: unknown; onRetry: () => void; notFound?: string }) {
  if (isSwitchedOff(error)) {
    return <EmptyState>{notFound ?? 'Partner Network is switched off (PARTNER_NETWORK), or this API does not have it yet.'}</EmptyState>
  }
  return <QueryError error={error} onRetry={onRetry} />
}

// ---------- Contact links ----------

/** Adds a prefilled message to a wa.me or mailto: link. */
export function withMessage(link: string, channel: 'WHATSAPP' | 'EMAIL', message: string, subject?: string): string {
  const join = link.includes('?') ? '&' : '?'
  if (channel === 'WHATSAPP') return `${link}${join}text=${encodeURIComponent(message)}`
  return `${link}${join}${subject ? `subject=${encodeURIComponent(subject)}&` : ''}body=${encodeURIComponent(message)}`
}

/**
 * Call, WhatsApp and Email as links that open on this device. Opening one is recorded as a
 * contact attempt on the enquiry: it never means a message was sent or answered.
 */
export function ContactButtons({ enquiryId, contact, who }: { enquiryId: string; contact: ContactLinks; who: string }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const record = useMutation({
    mutationFn: (channel: Channel) => pn.contactAttempt(enquiryId, channel),
    onSuccess: (_, channel) => {
      toast.info(`${CHANNEL_LABEL[channel]} opened on this device. Recorded as a contact attempt.`)
      void queryClient.invalidateQueries({ queryKey: ['pn-enquiry', enquiryId] })
    },
    onError: (err) => toast.error(err),
  })
  const links: [Channel, string | null, string][] = [
    ['PHONE', contact.tel, 'Call'],
    ['WHATSAPP', contact.whatsapp, 'WhatsApp'],
    ['EMAIL', contact.mailto, 'Email'],
  ]
  return (
    <>
      {links.map(([channel, href, label]) =>
        href ? (
          <a
            key={channel}
            className="btn"
            href={href}
            {...(channel === 'WHATSAPP' ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            onClick={() => record.mutate(channel)}
          >
            {label}
            <span className="sr-only">
              {' '}
              {who}
              {channel === 'WHATSAPP' ? ' (opens WhatsApp in a new tab)' : ''}
            </span>
          </a>
        ) : null,
      )}
    </>
  )
}

// ---------- Documents ----------

const isImage = (d: PartnerDocument) => d.mime.startsWith('image/')

/** The applicant's files: open or download with the staff sign-in. Images can show a preview. */
export function DocumentList({ enquiryId, documents, previews = false }: { enquiryId: string; documents: PartnerDocument[]; previews?: boolean }) {
  if (documents.length === 0) return <EmptyState>No documents were uploaded.</EmptyState>
  return (
    <ul className="plain-list pn-docs">
      {documents.map((d) => (
        <li key={d.id} className="pn-doc">
          {previews && isImage(d) && (
            <AuthedPhoto
              load={() => pn.documentUrl(enquiryId, d.id, true)}
              photoKey={d.id}
              alt={d.name}
              what={`preview of ${d.name}`}
              className="pn-doc-preview"
              openInTab
            />
          )}
          <div className="pn-doc-text">
            <strong className="pn-doc-name">{d.name}</strong>
            <div className="muted small">
              {d.categoryLabel || d.category} · {fileSize(d.size)} · {dateTime(d.uploadedAt)}
            </div>
          </div>
          <div className="btn-row">
            {!previews && isImage(d) && <DocumentPreviewButton enquiryId={enquiryId} doc={d} />}
            <DownloadButton className="btn btn-small" getUrl={() => pn.documentUrl(enquiryId, d.id)} filename={d.name}>
              Download<span className="sr-only"> {d.name}</span>
            </DownloadButton>
          </div>
        </li>
      ))}
    </ul>
  )
}

function DocumentPreviewButton({ enquiryId, doc }: { enquiryId: string; doc: PartnerDocument }) {
  const [open, setOpen] = useState(false)
  if (open) {
    return (
      <AuthedPhoto
        load={() => pn.documentUrl(enquiryId, doc.id, true)}
        photoKey={doc.id}
        alt={doc.name}
        what={`preview of ${doc.name}`}
        className="pn-doc-preview"
        openInTab
      />
    )
  }
  return (
    <button type="button" className="btn btn-small" onClick={() => setOpen(true)}>
      Preview<span className="sr-only"> {doc.name}</span>
    </button>
  )
}

// ---------- Notes ----------

/** Mirrors the API's limit on a note. */
export const NOTE_MAX = 3000

export function NotesPanel({
  notes,
  onAdd,
  label = 'Add an internal note',
  hint = 'Only staff see notes. They are kept with the enquiry’s history.',
}: {
  notes: Note[]
  onAdd: (note: string) => Promise<unknown>
  label?: string
  hint?: string
}) {
  const uid = useId()
  const toast = useToast()
  const [text, setText] = useState('')
  const add = useMutation({
    mutationFn: (note: string) => onAdd(note),
    onSuccess: () => {
      setText('')
      toast.success('Note added')
    },
  })
  // A ref as well as the button state, so a double click adds the note once.
  const sending = useRef(false)
  function submit(e: FormEvent) {
    e.preventDefault()
    if (!text.trim() || sending.current) return
    sending.current = true
    add.mutate(text.trim(), { onSettled: () => void (sending.current = false) })
  }
  return (
    <>
      {notes.length === 0 ? (
        <EmptyState>No notes yet.</EmptyState>
      ) : (
        <ol className="plain-list pn-notes" aria-label="Notes">
          {notes.map((n) => (
            <li key={n.id}>
              <p className="small muted mb-0">
                {n.author} · {dateTime(n.createdAt)}
                {n.about === 'PROPOSAL' ? ' · about the product proposal' : ''}
              </p>
              <p className="pre-wrap mb-0">{n.note}</p>
            </li>
          ))}
        </ol>
      )}
      <form className="mt-3" onSubmit={submit}>
        <div className="field">
          <label htmlFor={`${uid}-note`}>{label}</label>
          <textarea
            id={`${uid}-note`}
            rows={3}
            maxLength={NOTE_MAX}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-describedby={`${uid}-hint`}
          />
          <p id={`${uid}-hint`} className="hint">
            {hint} {text.length}/{NOTE_MAX}.
          </p>
        </div>
        <FormError error={add.error} />
        <button type="submit" className="btn btn-primary" disabled={!text.trim() || add.isPending}>
          {add.isPending ? 'Saving…' : 'Add note'}
        </button>
      </form>
    </>
  )
}

// ---------- Activity ----------

export function ActivityTimeline({ activity }: { activity: Activity[] }) {
  if (activity.length === 0) return <EmptyState>Nothing has happened yet.</EmptyState>
  return (
    <ol className="timeline" aria-label="Activity history">
      {activity.map((a) => (
        <li key={a.id}>
          <strong>{a.summary}</strong>
          <div className="muted small">
            {a.actor ?? 'The applicant or the system'} · {dateTime(a.at)}
          </div>
        </li>
      ))}
    </ol>
  )
}
