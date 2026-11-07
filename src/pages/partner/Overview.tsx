// Partner Network overview (docs/partner-network.md): the counts, the latest enquiries,
// where they come from, the follow-ups due, and the product proposals waiting on us.
// Every figure comes from GET /overview; nothing is computed here.
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { date, dateTime } from '../../format'
import { Badge, EmptyState, LinkRow, RowLink, scrollRegion, usePageTitle } from '../../ui'
import { pn } from './api'
import { EnquiryStatusBadge, LoadError, PartnerSubnav, ProposalStatusBadge, Skeleton } from './shared'
import type { EnquiryRow, Followup, Overview as OverviewData } from './types'

const enquiryPath = (enquiryId: string) => `/partner-network/enquiries/${encodeURIComponent(enquiryId)}`

export default function Overview() {
  usePageTitle('Partner Network')
  const q = useQuery({ queryKey: ['pn-overview'], queryFn: pn.overview })
  return (
    <>
      <div className="topbar">
        <h1>Partner Network</h1>
      </div>
      <PartnerSubnav />
      {q.isPending ? (
        <Skeleton tiles={8} lines={6} />
      ) : q.isError ? (
        <LoadError error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <OverviewBody data={q.data} />
      )}
    </>
  )
}

function OverviewBody({ data }: { data: OverviewData }) {
  const c = data.counts
  const list = '/partner-network/enquiries'
  const tiles: [label: string, count: number, to: string | null][] = [
    ['Total enquiries', c.total, list],
    ['New', c.NEW, `${list}?status=NEW`],
    ['Pending review', c.pendingReview, null],
    ['Contacted', c.CONTACTED, `${list}?status=CONTACTED`],
    ['In negotiation', c.NEGOTIATION, `${list}?status=NEGOTIATION`],
    ['Converted', c.CONVERTED, `${list}?status=CONVERTED`],
    ['Rejected', c.REJECTED, `${list}?status=REJECTED`],
    ['Proposals awaiting a decision', c.proposalsAwaiting, '/partner-network/proposals'],
  ]
  return (
    <>
      <ul className="tiles pn-counts" aria-label="Enquiry counts">
        {tiles.map(([label, count, to]) => (
          <li key={label}>
            {to ? (
              <Link className="tile" to={to}>
                <div className="count">{count}</div>
                <div className="label">{label}</div>
              </Link>
            ) : (
              <div className="tile">
                <div className="count">{count}</div>
                <div className="label">
                  {label}
                  <span className="sr-only"> (new and under review)</span>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      <div className="grid-2">
        <div>
          <section className="card" aria-labelledby="pn-latest">
            <h2 id="pn-latest">Latest enquiries</h2>
            <EnquiryMiniTable rows={data.latest} label="Latest enquiries" empty="No enquiries yet." />
            <p className="mb-0">
              <Link to={list}>All enquiries</Link>
            </p>
          </section>

          <section className="card" aria-labelledby="pn-followups">
            <h2 id="pn-followups">Follow-ups</h2>
            <h3 className="mt-0">Overdue</h3>
            <FollowupList items={data.followups.overdue} empty="Nothing overdue." />
            <h3>Due in the next 7 days</h3>
            <FollowupList items={data.followups.upcoming} empty="Nothing due in the next 7 days." />
          </section>

          <section className="card" aria-labelledby="pn-proposals">
            <h2 id="pn-proposals">Product proposals needing attention</h2>
            {data.proposalsNeedingAttention.length === 0 ? (
              <EmptyState>No product proposals are waiting.</EmptyState>
            ) : (
              <ul className="plain-list">
                {data.proposalsNeedingAttention.map((p) => (
                  <li key={p.id} className="pn-line">
                    <span>
                      <Link to={`/partner-network/proposals/${encodeURIComponent(p.id)}`}>{p.productName}</Link>{' '}
                      <span className="mono small muted">{p.reference}</span>
                      <div className="muted small">
                        {p.submittedBy.name} · {date(p.submittedAt)}
                      </div>
                    </span>
                    <ProposalStatusBadge status={p.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div>
          <section className="card" aria-labelledby="pn-by-category">
            <h2 id="pn-by-category">Enquiries by category</h2>
            <p className="muted small">Every category an applicant ticked, so one enquiry can count more than once.</p>
            <CountTable
              label="Enquiries by category"
              head="Category"
              rows={data.byCategory.map((r) => ({ key: r.code, name: r.name, count: r.count, to: `${list}?category=${encodeURIComponent(r.code)}` }))}
            />
          </section>
          <section className="card" aria-labelledby="pn-by-state">
            <h2 id="pn-by-state">Enquiries by state</h2>
            <CountTable
              label="Enquiries by state"
              head="State"
              rows={data.byState.map((r) => ({ key: r.state, name: r.state, count: r.count, to: `${list}?state=${encodeURIComponent(r.state)}` }))}
            />
          </section>
          <section className="card" aria-labelledby="pn-converted">
            <h2 id="pn-converted">Recently converted</h2>
            {data.recentlyConverted.length === 0 ? (
              <EmptyState>No enquiries converted yet.</EmptyState>
            ) : (
              <ul className="plain-list">
                {data.recentlyConverted.map((e) => (
                  <li key={e.id}>
                    <Link to={enquiryPath(e.id)}>{e.name}</Link> <span className="mono small muted">{e.reference}</span>
                    <div className="muted small">
                      {e.primaryCategory?.name ?? '—'} · {[e.city, e.state].filter(Boolean).join(', ') || '—'}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  )
}

function EnquiryMiniTable({ rows, label, empty }: { rows: EnquiryRow[]; label: string; empty: string }) {
  if (rows.length === 0) return <EmptyState>{empty}</EmptyState>
  return (
    <div {...scrollRegion(label, { cards: true })}>
      <table>
        <thead>
          <tr>
            <th scope="col">Applicant</th>
            <th scope="col">Category</th>
            <th scope="col">Submitted</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <LinkRow key={e.id}>
              <td className="card-title">
                <RowLink to={enquiryPath(e.id)} more={e.reference}>
                  {e.name}
                </RowLink>
                <div className="mono small muted">{e.reference}</div>
              </td>
              <td data-label="Category">{e.primaryCategory?.name ?? '—'}</td>
              <td data-label="Submitted">{dateTime(e.submittedAt)}</td>
              <td className="card-status">
                <EnquiryStatusBadge status={e.status} />
              </td>
            </LinkRow>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CountTable({ label, head, rows }: { label: string; head: string; rows: { key: string; name: string; count: number; to: string }[] }) {
  if (rows.length === 0) return <EmptyState>No enquiries yet.</EmptyState>
  return (
    <div {...scrollRegion(label)}>
      <table>
        <thead>
          <tr>
            <th scope="col">{head}</th>
            <th scope="col" className="num">
              Enquiries
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>
                <Link to={r.to}>{r.name}</Link>
              </td>
              <td className="num">{r.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function FollowupList({ items, empty }: { items: Followup[]; empty: string }) {
  if (items.length === 0) return <p className="muted">{empty}</p>
  return (
    <ul className="plain-list">
      {items.map((f) => (
        <li key={f.id} className={`pn-line${f.overdue ? ' pn-overdue' : ''}`}>
          <span>
            <Link to={`${enquiryPath(f.enquiry.id)}?tab=followups`}>{f.enquiry.name}</Link>{' '}
            <span className="mono small muted">{f.enquiry.reference}</span>
            <div className="small">
              {dateTime(f.scheduledAt)} · {f.assignedTo?.email ?? 'Not assigned'}
            </div>
            {f.notes && <div className="muted small pre-wrap">{f.notes}</div>}
          </span>
          {f.overdue && <Badge tone="bad">Overdue</Badge>}
        </li>
      ))}
    </ul>
  )
}
