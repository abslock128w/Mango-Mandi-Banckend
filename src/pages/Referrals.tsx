// Refer a friend (REFERRALS, docs/growth.md) on the Promos page, managers only: every
// referral with who entered whose code, the friend's first order, and the thank-you codes.
// Phones come masked from the API. Rewards are issued by the API, never from here.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { date, rupees } from '../format'
import type { Referral, ReferralList, ReferralStatus } from '../types'
import { EmptyState, QueryError, Spinner, scrollRegion } from '../ui'

/** "10%", "10% (up to ₹150)" or "₹100". */
function off(kind: 'PERCENT' | 'FLAT', value: number, capPaise: number | null): string {
  if (kind === 'FLAT') return rupees(value)
  return capPaise ? `${value}% (up to ${rupees(capPaise)})` : `${value}%`
}
const ruleOff = (r: ReferralList['rules']) =>
  r.rewardKind === 'PERCENT' ? off('PERCENT', r.rewardPercent ?? 0, r.rewardMaxRupees ? r.rewardMaxRupees * 100 : null) : off('FLAT', (r.rewardRupees ?? 0) * 100, null)
const rewardOff = (w: Referral['rewards'][number]) => off(w.kind, w.value, w.maxDiscount)

const STATUS_LABEL: Record<ReferralStatus, string> = { PENDING: 'Waiting for payment', REWARDED: 'Rewarded', VOID: 'No reward' }

function Person({ p }: { p: Referral['friend'] }) {
  return (
    <>
      <Link to={`/customers/${encodeURIComponent(p.id)}`}>{p.name || 'Customer'}</Link>
      {p.phone && <div className="small muted">{p.phone}</div>}
    </>
  )
}

export function ReferralsSection() {
  const [status, setStatus] = useState<ReferralStatus | ''>('')
  const q = useQuery({ queryKey: ['referrals', status], queryFn: () => api.referrals(status || null) })

  return (
    <section className="card" aria-labelledby="referrals-title">
      <div className="funnel-head">
        <h2 id="referrals-title">Refer a friend</h2>
        <div className="field m-0">
          <label htmlFor="referral-status">Show</label>
          <select id="referral-status" value={status} onChange={(e) => setStatus(e.target.value as ReferralStatus | '')}>
            <option value="">All</option>
            <option value="PENDING">{STATUS_LABEL.PENDING}</option>
            <option value="REWARDED">{STATUS_LABEL.REWARDED}</option>
            <option value="VOID">{STATUS_LABEL.VOID}</option>
          </select>
        </div>
      </div>
      {q.isPending ? (
        <Spinner label="Loading referrals" />
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <p className="small muted" data-testid="referral-rules">
            When a friend pays for a first order of {rupees(q.data.rules.minOrderRupees * 100)} or more, both get a one-time code for{' '}
            {ruleOff(q.data.rules)} off their next order of boxes. If that first order is cancelled, unused codes are withdrawn. A customer earns at
            most {q.data.rules.maxPerMonth} a month; the friend still gets theirs.
          </p>
          <p className="small" aria-label="Referral counts">
            <strong>{q.data.counts.PENDING}</strong> waiting · <strong>{q.data.counts.REWARDED}</strong> rewarded · <strong>{q.data.counts.VOID}</strong>{' '}
            without a reward
          </p>
          {!q.data.items.length ? (
            <EmptyState>{status ? 'No referrals with this status.' : 'No one has used a referral code yet.'}</EmptyState>
          ) : (
            <div {...scrollRegion('Referrals')}>
              <table>
                <thead>
                  <tr>
                    <th>Entered</th>
                    <th>Referred by</th>
                    <th>Friend</th>
                    <th>First order</th>
                    <th>Status</th>
                    <th>Thank-you codes</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.items.map((r) => (
                    <tr key={r.id}>
                      <td>{date(r.createdAt)}</td>
                      <td>
                        <Person p={r.referrer} />
                        <div className="small muted">{r.code}</div>
                      </td>
                      <td>
                        <Person p={r.friend} />
                      </td>
                      <td>{r.order ? <Link to={`/orders/${r.order.id}`}>{r.order.number}</Link> : <span className="muted">Not yet</span>}</td>
                      <td>
                        {STATUS_LABEL[r.status]}
                        {r.reason && <div className="small muted">{r.reason}</div>}
                        {r.referrerCapped && <div className="small muted">Referrer over the monthly limit</div>}
                      </td>
                      <td className="small">
                        {r.rewards.length
                          ? r.rewards.map((w) => (
                              <div key={w.code}>
                                {w.role === 'FRIEND' ? 'Friend' : 'Referrer'}: <strong>{w.code}</strong> {rewardOff(w)} · {w.used ? 'used' : w.withdrawn ? 'withdrawn' : 'not used'}
                              </div>
                            ))
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  )
}
