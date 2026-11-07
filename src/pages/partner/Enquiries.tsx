// All Partner Network enquiries: filtered, sorted and paged on the server. Every filter
// lives in the address, so a filtered list can be shared or reloaded. Managers can
// download the same selection as CSV (recorded in the activity log by the API).
import { useEffect, useId, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { dateTime, istDate } from '../../format'
import { useSession } from '../../session'
import { DownloadButton, EmptyState, LinkRow, RowLink, scrollRegion, usePageTitle } from '../../ui'
import { pn } from './api'
import { ENQUIRY_STATUS_LABEL, EnquiryStatusBadge, LoadError, PRIORITY_LABEL, PartnerSubnav, PriorityText, Skeleton } from './shared'
import { ENQUIRY_STATUSES, PRIORITIES, type EnquiryQuery, type EnquirySort } from './types'

const PAGE_SIZES = [10, 25, 50, 100]
const FILTER_KEYS = ['q', 'status', 'category', 'state', 'priority', 'assignedTo', 'from', 'to'] as const

const COLUMNS: { key: string; label: string; sort?: EnquirySort }[] = [
  { key: 'reference', label: 'Reference', sort: 'reference' },
  { key: 'name', label: 'Applicant', sort: 'name' },
  { key: 'primary', label: 'Primary category' },
  { key: 'more', label: 'Additional categories' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State', sort: 'state' },
  { key: 'mobile', label: 'Mobile' },
  { key: 'email', label: 'Email' },
  { key: 'submitted', label: 'Submitted', sort: 'submitted' },
  { key: 'status', label: 'Status', sort: 'status' },
  { key: 'assigned', label: 'Assigned to' },
  { key: 'priority', label: 'Priority', sort: 'priority' },
  { key: 'actions', label: 'Actions' },
]

export default function Enquiries() {
  usePageTitle('Partner enquiries')
  const { me } = useSession()
  const uid = useId()
  const [params, setParams] = useSearchParams()
  const get = (k: string) => params.get(k) ?? ''
  const sort = (get('sort') || 'submitted') as EnquirySort
  const dir = get('dir') === 'asc' ? 'asc' : get('dir') === 'desc' ? 'desc' : sort === 'submitted' ? 'desc' : 'asc'
  const page = Math.max(1, Number(get('page') || '1') || 1)
  const pageSize = PAGE_SIZES.includes(Number(get('pageSize'))) ? Number(get('pageSize')) : 25

  const filters: EnquiryQuery = Object.fromEntries(FILTER_KEYS.map((k) => [k, get(k) || undefined]))
  const query: EnquiryQuery = { ...filters, sort, dir, page, pageSize }

  const [search, setSearch] = useState(get('q'))
  const q = get('q')
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

  // Typing waits a moment before it searches; Enter searches at once.
  useEffect(() => {
    if (search.trim() === q) return
    const t = window.setTimeout(() => update({ q: search.trim() || null }), 400)
    return () => window.clearTimeout(t)
    // Only typing restarts the wait (as on Orders): `update` and `q` change with the address it writes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const list = useQuery({
    queryKey: ['pn-enquiries', query],
    queryFn: () => pn.enquiries(query),
    placeholderData: keepPreviousData,
  })
  const categories = useQuery({ queryKey: ['pn-categories'], queryFn: pn.categories })

  function sortBy(key: EnquirySort) {
    const nextDir = sort === key ? (dir === 'asc' ? 'desc' : 'asc') : key === 'submitted' ? 'desc' : 'asc'
    update({ sort: key, dir: nextDir })
  }

  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1
  const anyFilter = FILTER_KEYS.some((k) => get(k))
  const isManager = me?.role === 'MANAGER'
  const staff = list.data?.staff ?? []
  const states = list.data?.states ?? []

  return (
    <>
      <div className="topbar">
        <h1>Enquiries</h1>
        <span className="spacer" />
        {isManager && (
          <DownloadButton getUrl={() => pn.exportUrl(filters)} filename={`mandimangoes-partner-enquiries-${istDate(0)}.csv`}>
            Export CSV
          </DownloadButton>
        )}
      </div>
      <PartnerSubnav />
      {isManager && <p className="muted small">The CSV has the enquiries matching these filters (up to 5,000). Every export is recorded in the activity log.</p>}

      <form
        role="search"
        className="field mb-3"
        onSubmit={(e) => {
          e.preventDefault()
          update({ q: search.trim() || null })
        }}
      >
        <label htmlFor={`${uid}-q`}>Search by name, phone, email or reference</label>
        <input id={`${uid}-q`} type="search" value={search} maxLength={120} onChange={(e) => setSearch(e.target.value)} />
      </form>

      <div className="field-row mb-4 pn-filters">
        <div className="field mb-0">
          <label htmlFor={`${uid}-status`}>Status</label>
          <select id={`${uid}-status`} value={get('status')} onChange={(e) => update({ status: e.target.value || null })}>
            <option value="">All statuses</option>
            {ENQUIRY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ENQUIRY_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="field mb-0">
          <label htmlFor={`${uid}-category`}>Category</label>
          <select id={`${uid}-category`} value={get('category')} onChange={(e) => update({ category: e.target.value || null })}>
            <option value="">All categories</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field mb-0">
          <label htmlFor={`${uid}-state`}>State</label>
          <select id={`${uid}-state`} value={get('state')} onChange={(e) => update({ state: e.target.value || null })}>
            <option value="">All states</option>
            {/* Keep the chosen state listed even before the list (and its states) has loaded. */}
            {[...new Set([...(get('state') ? [get('state')] : []), ...states])].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="field mb-0">
          <label htmlFor={`${uid}-assigned`}>Assigned to</label>
          <select id={`${uid}-assigned`} value={get('assignedTo')} onChange={(e) => update({ assignedTo: e.target.value || null })}>
            <option value="">Anyone</option>
            <option value="me">Me</option>
            <option value="none">Unassigned</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.email}
              </option>
            ))}
          </select>
        </div>
        <div className="field mb-0">
          <label htmlFor={`${uid}-priority`}>Priority</label>
          <select id={`${uid}-priority`} value={get('priority')} onChange={(e) => update({ priority: e.target.value || null })}>
            <option value="">Any priority</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
        <div className="field mb-0">
          <label htmlFor={`${uid}-from`}>Submitted from</label>
          <input id={`${uid}-from`} type="date" value={get('from')} onChange={(e) => update({ from: e.target.value || null })} />
        </div>
        <div className="field mb-0">
          <label htmlFor={`${uid}-to`}>Submitted to</label>
          <input id={`${uid}-to`} type="date" value={get('to')} onChange={(e) => update({ to: e.target.value || null })} />
        </div>
      </div>
      {anyFilter && (
        <p className="mb-3">
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setSearch('')
              update(Object.fromEntries(FILTER_KEYS.map((k) => [k, null])))
            }}
          >
            Clear all filters
          </button>
        </p>
      )}

      {list.isPending ? (
        <Skeleton lines={8} />
      ) : list.isError ? (
        <LoadError error={list.error} onRetry={() => list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState>{anyFilter ? 'No enquiries match these filters.' : 'No enquiries yet.'}</EmptyState>
      ) : (
        <>
          <div {...scrollRegion('Enquiries', { cards: true })} aria-busy={list.isFetching || undefined}>
            <table className="pn-table">
              <thead>
                <tr>
                  {COLUMNS.map((c) => {
                    const active = c.sort && c.sort === sort
                    return (
                      <th
                        key={c.key}
                        scope="col"
                        aria-sort={c.sort ? (active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}
                      >
                        {c.sort ? (
                          <button type="button" className="pn-sort" onClick={() => sortBy(c.sort!)}>
                            {c.label}
                            <span aria-hidden="true" className="pn-sort-mark">
                              {active ? (dir === 'asc' ? '▲' : '▼') : ''}
                            </span>
                          </button>
                        ) : (
                          c.label
                        )}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((e) => {
                  const to = `/partner-network/enquiries/${encodeURIComponent(e.id)}`
                  const more = e.categories.filter((c) => c.code !== e.primaryCategory?.code)
                  return (
                    <LinkRow key={e.id}>
                      <td className="card-title">
                        <RowLink to={to} more={e.name}>
                          <span className="mono">{e.reference}</span>
                        </RowLink>
                      </td>
                      <td data-label="Applicant">
                        {e.name}
                        {e.businessName && <div className="muted small">{e.businessName}</div>}
                      </td>
                      <td data-label="Primary category">{e.primaryCategory?.name ?? '—'}</td>
                      <td data-label="Additional categories">{more.length ? more.map((c) => c.name).join(', ') : '—'}</td>
                      <td data-label="City">{e.city ?? '—'}</td>
                      <td data-label="State">{e.state ?? '—'}</td>
                      <td data-label="Mobile">{e.mobile ?? '—'}</td>
                      <td data-label="Email" className="pn-email">
                        {e.email ?? '—'}
                      </td>
                      <td data-label="Submitted">{dateTime(e.submittedAt)}</td>
                      <td className="card-status">
                        <EnquiryStatusBadge status={e.status} />
                      </td>
                      <td data-label="Assigned to">{e.assignedTo?.email ?? 'Unassigned'}</td>
                      <td data-label="Priority">
                        <PriorityText priority={e.priority} />
                      </td>
                      <td className="card-wide">
                        <Link className="btn btn-small pn-row-action" to={to}>
                          Open<span className="sr-only"> enquiry {e.reference}</span>
                        </Link>
                      </td>
                    </LinkRow>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="pager pn-pager">
            <span className="muted small">
              {list.data.total} {list.data.total === 1 ? 'enquiry' : 'enquiries'} · page {list.data.page} of {totalPages}
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
