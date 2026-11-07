// Product proposals from Partner Network enquiries (docs/partner-network.md). Approving one
// only accepts it for further consideration: it never adds a product to the shop. That is a
// separate step a manager takes on the Products page.
import { useEffect, useId, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { date, dateTime } from '../../format'
import { useSession } from '../../session'
import { BackLink, Dialog, DisabledReason, EmptyState, FormError, LinkRow, ReasonDialog, RowLink, StatusFilter, scrollRegion, usePageTitle, useToast } from '../../ui'
import { pn } from './api'
import {
  ActivityTimeline,
  ContactButtons,
  DocumentList,
  EnquiryStatusBadge,
  LoadError,
  NotesPanel,
  PROPOSAL_STATUS_LABEL,
  PartnerSubnav,
  ProposalStatusBadge,
  Skeleton,
  inr,
  yesNo,
} from './shared'
import { PROPOSAL_FINAL, PROPOSAL_STATUSES, type ProposalDetail, type ProposalStatus } from './types'

const PAGE_SIZES = [10, 25, 50, 100]

/** Said wherever a proposal can be approved, so no one expects a product to appear in the shop. */
export const NOT_IN_SHOP = 'Approved for further consideration. Adding it to the shop is a separate step on the Products page.'

export default function Proposals() {
  const { id } = useParams()
  return id ? <ProposalPage id={id} /> : <ProposalList />
}

function ProposalList() {
  usePageTitle('Product proposals')
  const uid = useId()
  const [params, setParams] = useSearchParams()
  const status = (params.get('status') as ProposalStatus | null) || null
  const q = params.get('q') ?? ''
  const page = Math.max(1, Number(params.get('page') || '1') || 1)
  const pageSize = PAGE_SIZES.includes(Number(params.get('pageSize'))) ? Number(params.get('pageSize')) : 25
  const [search, setSearch] = useState(q)
  useEffect(() => setSearch(q), [q])

  function update(changes: Record<string, string | null>, resetPage = true) {
    const p = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) {
      if (v) p.set(k, v)
      else p.delete(k)
    }
    if (resetPage) p.delete('page')
    setParams(p)
  }
  useEffect(() => {
    if (search.trim() === q) return
    const t = window.setTimeout(() => update({ q: search.trim() || null }), 400)
    return () => window.clearTimeout(t)
    // Only typing restarts the wait (as on Orders).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const query = { status: status ?? undefined, q: q || undefined, page, pageSize }
  const list = useQuery({ queryKey: ['pn-proposals', query], queryFn: () => pn.proposals(query), placeholderData: keepPreviousData })
  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1

  return (
    <>
      <div className="topbar">
        <h1>Product proposals</h1>
      </div>
      <PartnerSubnav />
      <p className="muted">Products that applicants offered to supply or develop. Approving one does not add it to the shop.</p>
      <StatusFilter className="mb-3" value={status} options={PROPOSAL_STATUSES} labels={PROPOSAL_STATUS_LABEL} onChange={(s) => update({ status: s })} />
      <form
        role="search"
        className="field mb-4"
        onSubmit={(e) => {
          e.preventDefault()
          update({ q: search.trim() || null })
        }}
      >
        <label htmlFor={`${uid}-q`}>Search by product, applicant or reference</label>
        <input id={`${uid}-q`} type="search" value={search} maxLength={120} onChange={(e) => setSearch(e.target.value)} />
      </form>

      {list.isPending ? (
        <Skeleton lines={6} />
      ) : list.isError ? (
        <LoadError error={list.error} onRetry={() => list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState>{status || q ? 'No product proposals match.' : 'No product proposals yet.'}</EmptyState>
      ) : (
        <>
          <div {...scrollRegion('Product proposals', { cards: true })}>
            <table className="pn-table">
              <thead>
                <tr>
                  <th scope="col">Reference</th>
                  <th scope="col">Product</th>
                  <th scope="col">Category</th>
                  <th scope="col">Submitted by</th>
                  <th scope="col">Applicant location</th>
                  <th scope="col">Source location</th>
                  <th scope="col" className="num">
                    Procurement price
                  </th>
                  <th scope="col" className="num">
                    Suggested selling price
                  </th>
                  <th scope="col">Monthly capacity</th>
                  <th scope="col">Samples</th>
                  <th scope="col">Submitted</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((p) => (
                  <LinkRow key={p.id}>
                    <td className="card-title">
                      <RowLink to={`/partner-network/proposals/${encodeURIComponent(p.id)}`} more={p.productName}>
                        <span className="mono">{p.reference}</span>
                      </RowLink>
                    </td>
                    <td data-label="Product">{p.productName}</td>
                    <td data-label="Category">{p.productCategory ?? '—'}</td>
                    <td data-label="Submitted by">{p.submittedBy.name}</td>
                    <td data-label="Applicant location">{p.applicantLocation ?? '—'}</td>
                    <td data-label="Source location">{p.sourceLocation ?? '—'}</td>
                    <td className="num" data-label="Procurement price">
                      {inr(p.procurementPrice)}
                    </td>
                    <td className="num" data-label="Suggested selling price">
                      {inr(p.suggestedSellingPrice)}
                    </td>
                    <td data-label="Monthly capacity">{p.monthlySupplyCapacity ?? '—'}</td>
                    <td data-label="Samples">{yesNo(p.sampleAvailable)}</td>
                    <td data-label="Submitted">{date(p.submittedAt)}</td>
                    <td className="card-status">
                      <ProposalStatusBadge status={p.status} />
                    </td>
                  </LinkRow>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pager pn-pager">
            <span className="muted small">
              {list.data.total} {list.data.total === 1 ? 'proposal' : 'proposals'} · page {list.data.page} of {totalPages}
            </span>
            <div className="field mb-0 pn-page-size">
              <label htmlFor={`${uid}-size`} className="sr-only">
                Rows per page
              </label>
              <select id={`${uid}-size`} value={pageSize} onChange={(e) => update({ pageSize: e.target.value === '25' ? null : e.target.value })}>
                {PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n} per page
                  </option>
                ))}
              </select>
            </div>
            <button type="button" className="btn btn-small" disabled={page <= 1} onClick={() => update({ page: String(page - 1) }, false)}>
              Previous
            </button>
            <button type="button" className="btn btn-small" disabled={page >= totalPages} onClick={() => update({ page: String(page + 1) }, false)}>
              Next
            </button>
          </div>
        </>
      )}
    </>
  )
}

function ProposalPage({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['pn-proposal', id], queryFn: () => pn.proposal(id) })
  usePageTitle(q.data ? `${q.data.reference} · Product proposal` : 'Product proposal')
  return (
    <>
      <BackLink to="/partner-network/proposals">Product proposals</BackLink>
      {q.isPending ? (
        <Skeleton lines={10} />
      ) : q.isError ? (
        <LoadError error={q.error} onRetry={() => q.refetch()} notFound="This product proposal was not found, or Partner Network is switched off." />
      ) : (
        <ProposalView p={q.data} />
      )}
    </>
  )
}

function ProposalView({ p }: { p: ProposalDetail }) {
  const { me } = useSession()
  const toast = useToast()
  const uid = useId()
  const queryClient = useQueryClient()
  const isManager = me?.role === 'MANAGER'
  const [next, setNext] = useState<ProposalStatus | ''>('')
  const [asking, setAsking] = useState<ProposalStatus | null>(null)
  const [sampling, setSampling] = useState(false)
  // Final statuses are for managers; the API refuses anyone else.
  const options = p.allowedStatuses.filter((s) => s !== p.status && (isManager || !PROPOSAL_FINAL.has(s)))

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['pn-proposal', p.id] })
    void queryClient.invalidateQueries({ queryKey: ['pn-proposals'] })
    void queryClient.invalidateQueries({ queryKey: ['pn-overview'] })
    void queryClient.invalidateQueries({ queryKey: ['pn-enquiry', p.enquiry.id] })
  }
  const change = useMutation({
    mutationFn: ({ status, reason }: { status: ProposalStatus; reason?: string }) => pn.patchProposal(p.id, status, reason),
    onSuccess: (_, { status }) => {
      refresh()
      setAsking(null)
      setNext('')
      toast.success(status === 'APPROVED' ? NOT_IN_SHOP : `Status changed to ${PROPOSAL_STATUS_LABEL[status]}`)
    },
  })
  const sample = useMutation({
    mutationFn: (note: string) => pn.requestSample(p.id, note || undefined),
    onSuccess: () => {
      refresh()
      setSampling(false)
      toast.success('Sample request recorded. Contact the applicant to arrange it.')
    },
  })

  function apply() {
    if (!next) return
    if (PROPOSAL_FINAL.has(next)) setAsking(next)
    else change.mutate({ status: next })
  }

  return (
    <>
      <div className="topbar mb-2">
        <h1>{p.productName}</h1>
        <ProposalStatusBadge status={p.status} />
      </div>
      <p className="pn-meta">
        <span className="mono">{p.reference}</span>
        <span>Submitted {dateTime(p.submittedAt)}</span>
        <span>
          From <Link to={`/partner-network/enquiries/${encodeURIComponent(p.enquiry.id)}`}>{p.submittedBy.name}, enquiry {p.enquiry.reference}</Link>{' '}
          <EnquiryStatusBadge status={p.enquiry.status} />
        </span>
      </p>
      <p className="notice notice-info" role="note">
        {p.status === 'APPROVED' ? NOT_IN_SHOP : 'Approving a proposal does not add a product to the shop. Adding it is a separate step on the Products page.'}
      </p>

      <section className="card" aria-labelledby={`${uid}-act`}>
        <h2 id={`${uid}-act`} className="sr-only">
          Actions
        </h2>
        <div className="btn-row">
          <ContactButtons enquiryId={p.enquiry.id} contact={p.contact} who={p.submittedBy.name} />
          {p.status !== 'SAMPLE_REQUESTED' && !PROPOSAL_FINAL.has(p.status) && (
            <button type="button" className="btn" onClick={() => setSampling(true)}>
              Request samples
            </button>
          )}
        </div>
        <form
          className="pn-inline-form mt-3"
          onSubmit={(e) => {
            e.preventDefault()
            apply()
          }}
        >
          <div className="field mb-0">
            <label htmlFor={`${uid}-status`}>Change status</label>
            <select id={`${uid}-status`} value={next} disabled={options.length === 0} onChange={(e) => setNext(e.target.value as ProposalStatus | '')}>
              <option value="">{PROPOSAL_STATUS_LABEL[p.status]} (now)</option>
              {options.map((s) => (
                <option key={s} value={s}>
                  {PROPOSAL_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn" disabled={!next || change.isPending}>
            Change status
          </button>
        </form>
        {!asking && <FormError error={change.error} />}
        {!isManager && <DisabledReason>Approving, rejecting or closing a proposal: requires manager role.</DisabledReason>}
      </section>

      <div className="grid-2">
        <div>
          <section className="card">
            <h2>Product</h2>
            <dl className="kv pn-kv">
              <dt>Product</dt>
              <dd>{p.productName}</dd>
              <dt>Category</dt>
              <dd>{p.productCategory ?? '—'}</dd>
              <dt>Stage</dt>
              <dd>{p.productStage ?? '—'}</dd>
              <dt>Description</dt>
              <dd className="pre-wrap">{p.description ?? '—'}</dd>
              <dt>Why customers would want it</dt>
              <dd className="pre-wrap">{p.commercialAppeal ?? '—'}</dd>
              <dt>Source location</dt>
              <dd>{p.sourceLocation ?? '—'}</dd>
              <dt>Applicant location</dt>
              <dd>{p.applicantLocation ?? '—'}</dd>
              <dt>Procurement price</dt>
              <dd>{inr(p.procurementPrice)}</dd>
              <dt>Suggested selling price</dt>
              <dd>{inr(p.suggestedSellingPrice)}</dd>
              <dt>Monthly supply capacity</dt>
              <dd>{p.monthlySupplyCapacity ?? '—'}</dd>
              <dt>Samples available</dt>
              <dd>{yesNo(p.sampleAvailable)}</dd>
              <dt>Supplier type</dt>
              <dd>{p.supplierType ?? '—'}</dd>
              <dt>Quality certifications</dt>
              <dd>{p.qualityCertifications ?? '—'}</dd>
              <dt>Can manage supply</dt>
              <dd>{p.canManage ?? '—'}</dd>
              <dt>Existing relationships</dt>
              <dd className="pre-wrap">{p.relationships ?? '—'}</dd>
            </dl>
          </section>
          <section className="card">
            <h2>Documents and photos</h2>
            <DocumentList enquiryId={p.enquiry.id} documents={p.documents} previews />
          </section>
        </div>
        <div>
          <section className="card">
            <h2>Notes</h2>
            <NotesPanel
              notes={p.notes}
              label="Add a note about this proposal"
              hint="Only staff see notes."
              onAdd={async (note) => {
                await pn.proposalNote(p.id, note)
                refresh()
              }}
            />
          </section>
          <section className="card">
            <h2>Activity</h2>
            <ActivityTimeline activity={p.activity} />
          </section>
        </div>
      </div>

      {asking && (
        <ReasonDialog
          title={`${PROPOSAL_STATUS_LABEL[asking]}: ${p.productName}?`}
          confirmLabel={asking === 'APPROVED' ? 'Approve' : asking === 'REJECTED' ? 'Reject' : 'Close'}
          tone={asking === 'APPROVED' ? 'primary' : 'danger'}
          minLength={5}
          maxLength={1000}
          busy={change.isPending}
          error={change.error}
          onClose={() => {
            setAsking(null)
            change.reset()
          }}
          onSubmit={(reason) => change.mutate({ status: asking, reason })}
        >
          {asking === 'APPROVED' ? <p>{NOT_IN_SHOP}</p> : <p>The proposal ends here. The reason is kept in its history.</p>}
        </ReasonDialog>
      )}
      {sampling && <SampleDialog busy={sample.isPending} error={sample.error} onClose={() => setSampling(false)} onSubmit={(note) => sample.mutate(note)} />}
    </>
  )
}

function SampleDialog({ busy, error, onClose, onSubmit }: { busy: boolean; error: unknown; onClose: () => void; onSubmit: (note: string) => void }) {
  const uid = useId()
  const [note, setNote] = useState('')
  return (
    <Dialog
      title="Request samples?"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onSubmit(note.trim())}>
            {busy ? 'Saving…' : 'Record sample request'}
          </button>
        </>
      }
    >
      <p>The proposal moves to Sample requested. This does not contact the applicant: call, WhatsApp or email them to arrange it.</p>
      <div className="field">
        <label htmlFor={`${uid}-note`}>Note (optional)</label>
        <textarea id={`${uid}-note`} rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} data-autofocus />
      </div>
      <FormError error={error} />
    </Dialog>
  )
}
