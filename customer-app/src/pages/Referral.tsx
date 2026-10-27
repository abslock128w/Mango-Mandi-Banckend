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
import { useT } from '../i18n'
import type { Key } from '../i18n-core.ts'
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

const ENTERED_TEXT: Record<NonNullable<ReferralView['entered']>['status'], Key> = {
  PENDING: 'ref.entered.pending',
  REWARDED: 'ref.entered.rewarded',
  VOID: 'ref.entered.void',
}

/** A friend's code: a field and a button, in its own small form. */
function CodeForm({ initial, label, onDone }: { initial: string; label: string; onDone?: () => void }) {
  const [code, setCode] = useState(initial)
  const apply = useApply(onDone)
  const t = useT()
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
            {apply.isPending ? t('auth.checking') : t('ref.useCode')}
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
  const t = useT()
  if (!on) return null

  async function share(v: ReferralView) {
    if (!v.shareUrl) return
    setShareError(null)
    const text = t('ref.shareText', { amount: rupees(v.rewardRupees * 100), code: v.code ?? '' })
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
      setShareError(t('ref.shareFailed'))
    }
  }

  return (
    <section className="card narrow" aria-labelledby="refer">
      <h2 id="refer">{t('ref.title')}</h2>
      {q.isPending ? (
        <Spinner label={t('ref.loading')} />
      ) : q.isError ? (
        <ErrorNote error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <p className="small">
            {t('ref.how', { min: rupees(q.data.minOrderRupees * 100), amount: rupees(q.data.rewardRupees * 100) })}
          </p>
          {q.data.code ? (
            <>
              <dl className="details">
                <dt>{t('ref.yourCode')}</dt>
                <dd>
                  <strong data-testid="referral-code">{q.data.code}</strong>
                </dd>
<dt>{t('ref.yourLink')}</dt>
                <dd>
                  <input aria-label={t('ref.inviteLink')} readOnly value={q.data.shareUrl ?? ''} onFocus={(e) => e.currentTarget.select()} />
                </dd>
              </dl>
              <div className="row">
                <button type="button" className="btn" onClick={() => void share(q.data)}>
                  {t('ref.share')}
                </button>
                {copied && (
                  <span className="small" role="status">
                    {t('ref.copied')}
                  </span>
                )}
              </div>
              {shareError && <ErrorNote error={shareError} />}
              <p className="small muted">
                {t('ref.friends', { rewarded: q.data.friends.rewarded, pending: q.data.friends.pending })}
              </p>
            </>
          ) : (
            <p className="small">{t('ref.addMobile')}</p>
          )}
          {q.data.entered && (
            <p className="small" data-testid="referral-entered">
              {t('ref.usedCode')} {t(ENTERED_TEXT[q.data.entered.status])}
              {q.data.entered.reason ? `: ${q.data.entered.reason}.` : ''}
            </p>
          )}
          {q.data.canEnterCode && <CodeForm initial={invitedCode() ?? ''} label={t('ref.gotCode')} />}
          {q.data.rewards.length > 0 && (
            <>
              <h3>{t('ref.rewards')}</h3>
              <ul className="referral-rewards">
                {q.data.rewards.map((r) => (
                  <li key={r.code}>
                    <strong>{r.code}</strong>:{' '}
                    {r.endsOn
                      ? t('ref.rewardUntil', { amount: rupees(r.amount), min: rupees(r.minSubtotal), day: day(r.endsOn), for: r.for })
                      : t('ref.reward', { amount: rupees(r.amount), min: rupees(r.minSubtotal), for: r.for })}{' '}
                    <span className="muted">{r.state === 'READY' ? t('ref.ready') : r.state === 'USED' ? t('ref.used') : t('ref.expired')}</span>
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
  const t = useT()
  if (!on) return null
  if (done)
    return (
      <p className="note" role="status">
        {t('ref.added')}
      </p>
    )
  if (!q.data?.canEnterCode) return null
  return (
    <div className="referral-entry">
      <CodeForm initial={invitedCode() ?? ''} label={t('ref.codeOptional')} onDone={() => setDone(true)} />
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
  const t = useT()
  // A code that can't be one, or refer-a-friend switched off: just the shop.
  if (!kept || (policy.isSuccess && !features.referrals)) return <Navigate to="/" replace />
  return (
    <section className="card narrow" aria-labelledby="invite">
      <h1 id="invite">{t('title.invite')}</h1>
      <p>{t.rich('ref.inviteBody', { code: <strong>{kept}</strong> })}</p>
      <div className="row">
        <Link to="/" className="btn btn-primary">
          {t('title.home')}
        </Link>
        {!profile && (
          <Link to="/sign-in" className="btn">
            {t('signIn.title')}
          </Link>
        )}
      </div>
    </section>
  )
}
