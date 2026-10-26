// Refer a friend (REFERRALS, docs/growth.md).
//   ReferralCard: on the Account page, my code and share link, friends so far, my thank-you codes,
//     and (for a new customer) a place to enter a friend's code.
//   ReferralEntry: at checkout, for a new customer only, prefilled from an invite link.
//   InvitePage: /invite/CODE keeps the code on this device and explains it.
// Every rule (new customers only, once, not your own, the monthly limit) is checked by the API.
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type ReferralView } from '../api'
import { useFeatures } from '../features'
import { day, rupees } from '../format'
import { forgetInvite, invitedCode, rememberInvite } from '../growth'
import { policyQuery } from '../queries'
import { useStore } from '../store'
import { ErrorNote, Spinner } from '../ui'

const referralQuery = { queryKey: ['referral'], queryFn: api.referral }

function useReferral(enabled: boolean) {
  return useQuery({ ...referralQuery, enabled })
}

function useApply(onDone?: () => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (code: string) => api.applyReferral(code.trim().toUpperCase()),
    onSuccess: (v) => {
      forgetInvite()
      queryClient.setQueryData(referralQuery.queryKey, v)
      onDone?.()
    },
  })
}

const ENTERED_TEXT: Record<NonNullable<ReferralView['entered']>['status'], string> = {
  PENDING: 'Your friend gets their thank-you, and you get yours, once your first order is delivered.',
  REWARDED: 'Your first order was delivered: your thank-you code is below.',
  VOID: 'This referral ended without a thank-you',
}

/** A friend's code: a field and a button, in its own small form. */
function CodeForm({ initial, label, onDone }: { initial: string; label: string; onDone?: () => void }) {
  const [code, setCode] = useState(initial)
  const apply = useApply(onDone)
  function submit(e: FormEvent) {
    e.preventDefault()
    if (code.trim()) apply.mutate(code)
  }
  return (
    <form onSubmit={submit} className="referral-form" noValidate>
      <div className="field">
        <label htmlFor="referral-code">{label}</label>
        <div className="row">
          <input
            id="referral-code"
            autoComplete="off"
            autoCapitalize="characters"
            maxLength={12}
            value={code}
            onChange={(e) => {
              apply.reset()
              setCode(e.target.value.toUpperCase())
            }}
          />
          <button type="submit" className="btn" disabled={apply.isPending || !code.trim()}>
            {apply.isPending ? 'Checking…' : 'Use code'}
          </button>
        </div>
      </div>
      <ErrorNote error={apply.error} />
    </form>
  )
}

export function ReferralCard() {
  const features = useFeatures()
  const on = Boolean(features.referrals)
  const q = useReferral(on)
  const [copied, setCopied] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)
  if (!on) return null

  async function share(v: ReferralView) {
    if (!v.shareUrl) return
    setShareError(null)
    const text = `Try MandiMangoes: ${rupees(v.rewardRupees * 100)} off your next box after your first order is delivered. My code: ${v.code}`
    try {
      if (navigator.share) {
        await navigator.share({ title: 'MandiMangoes', text, url: v.shareUrl })
      } else {
        await navigator.clipboard.writeText(v.shareUrl)
        setCopied(true)
      }
    } catch (err) {
      // Closing the share sheet is not a problem.
      if (err instanceof DOMException && err.name === 'AbortError') return
      setShareError('Could not share the link from this browser. Copy it from the box above.')
    }
  }

  return (
    <section className="card narrow" aria-labelledby="refer">
      <h2 id="refer">Refer a friend</h2>
      {q.isPending ? (
        <Spinner label="Loading your referral code" />
      ) : q.isError ? (
        <ErrorNote error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <p className="small">
            When a friend's first order of {rupees(q.data.minOrderRupees * 100)} or more is delivered, you both get {rupees(q.data.rewardRupees * 100)} off a
            later order of boxes.
          </p>
          {q.data.code ? (
            <>
              <dl className="details">
                <dt>Your code</dt>
                <dd>
                  <strong data-testid="referral-code">{q.data.code}</strong>
                </dd>
                <dt>Your link</dt>
                <dd>
                  <input aria-label="Your invite link" readOnly value={q.data.shareUrl ?? ''} onFocus={(e) => e.currentTarget.select()} />
                </dd>
              </dl>
              <div className="row">
                <button type="button" className="btn" onClick={() => void share(q.data)}>
                  Share link
                </button>
                {copied && (
                  <span className="small" role="status">
                    Link copied
                  </span>
                )}
              </div>
              {shareError && <ErrorNote error={shareError} />}
              <p className="small muted">
                Friends so far: {q.data.friends.rewarded} thanked, {q.data.friends.pending} waiting for their first delivery.
              </p>
            </>
          ) : (
            <p className="small">Add your mobile number at checkout to get your own code.</p>
          )}
          {q.data.entered && (
            <p className="small" data-testid="referral-entered">
              You used a friend's code. {ENTERED_TEXT[q.data.entered.status]}
              {q.data.entered.reason ? `: ${q.data.entered.reason}.` : ''}
            </p>
          )}
          {q.data.canEnterCode && <CodeForm initial={invitedCode() ?? ''} label="Got a code from a friend?" />}
          {q.data.rewards.length > 0 && (
            <>
              <h3>Your thank-you codes</h3>
              <ul className="referral-rewards">
                {q.data.rewards.map((r) => (
                  <li key={r.code}>
                    <strong>{r.code}</strong>: {rupees(r.amount)} off boxes, on orders of {rupees(r.minSubtotal)} or more
                    {r.endsOn ? `, until ${day(r.endsOn)}` : ''}. Thanks for {r.for}.{' '}
                    <span className="muted">{r.state === 'READY' ? 'Ready to use at checkout.' : r.state === 'USED' ? 'Used.' : 'Expired.'}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  )
}

/** At checkout: only for a new customer who hasn't entered a code. Separate from the promo code. */
export function ReferralEntry() {
  const features = useFeatures()
  const on = Boolean(features.referrals)
  const q = useReferral(on)
  const [done, setDone] = useState(false)
  if (!on) return null
  if (done)
    return (
      <p className="note" role="status">
        Friend's code added. You both get a thank-you once this first order is delivered.
      </p>
    )
  if (!q.data?.canEnterCode) return null
  return (
    <div className="referral-entry">
      <CodeForm initial={invitedCode() ?? ''} label="Friend's referral code (optional)" onDone={() => setDone(true)} />
    </div>
  )
}

/** /invite/CODE: keeps the code here for checkout. */
export function InvitePage() {
  const { code = '' } = useParams()
  const features = useFeatures()
  const policy = useQuery(policyQuery())
  const { profile } = useStore()
  const [kept] = useState(() => rememberInvite(code))
  // A code that can't be one, or refer-a-friend switched off: just the shop.
  if (!kept || (policy.isSuccess && !features.referrals)) return <Navigate to="/" replace />
  return (
    <section className="card narrow" aria-labelledby="invite">
      <h1 id="invite">A friend invited you</h1>
      <p>
        Your friend's code <strong>{kept}</strong> is saved on this device. It is added at checkout on your first order. Once that order is delivered,
        you both get a thank-you code for a later order.
      </p>
      <div className="row">
        <Link to="/" className="btn btn-primary">
          Pick your mangoes
        </Link>
        {!profile && (
          <Link to="/sign-in" className="btn">
            Sign in
          </Link>
        )}
      </div>
    </section>
  )
}
