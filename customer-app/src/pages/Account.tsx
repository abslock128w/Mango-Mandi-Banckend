import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type StockAlert } from '../api'
import { STAGE_LABEL, day } from '../format'
import { LanguagePicker, useLanguage, useT } from '../i18n'
import { useStore } from '../store'
import { ConfirmDialog, ErrorNote, Spinner } from '../ui'
import { MyReviews } from './Review'
import { FavouritesCard, NotificationsCard } from './AppFeelCards'
import { ReferralCard } from './Referral'
import { YourSubscriptions } from './Subscriptions'

export default function Account() {
  const { profile } = useStore()
  const navigate = useNavigate()
  const t = useT()
  const [confirming, setConfirming] = useState(false)
  const remove = useMutation({
    mutationFn: api.deleteAccount,
    onSuccess: () => navigate('/?deleted=1', { replace: true }),
  })
  // A lost or shared phone: every session ends, this one too.
  const everywhere = useMutation({ mutationFn: api.signOutEverywhere, onSuccess: () => navigate('/', { replace: true }) })

  return (
    <>
      <section className="card narrow" aria-labelledby="account">
        <h1 id="account">{t('title.account')}</h1>
        <dl className="details">
          <dt>{t('auth.mobile')}</dt>
          <dd>{profile?.phone ? `+91 ${profile.phone.replace(/^\+91/, '')}` : t('account.notAdded')}</dd>
          {profile?.email && (
            <>
              <dt>{t('account.google')}</dt>
              <dd>{profile.email}</dd>
            </>
          )}
          {profile?.name && (
            <>
              <dt>{t('account.name')}</dt>
              <dd>{profile.name}</dd>
            </>
          )}
        </dl>
        <p className="small muted">
          {t.rich('account.detailsNote', {
            privacy: <Link to="/privacy">{t('signIn.privacyNotice')}</Link>,
            help: <Link to="/help">{t('nav.help')}</Link>,
            terms: <Link to="/terms">{t('help.termsLink')}</Link>,
          })}
        </p>
        <div className="row">
          <button type="button" className="btn btn-quiet" onClick={() => void api.signOut()}>
            {t('account.signOut')}
          </button>
          <button type="button" className="btn btn-quiet" disabled={everywhere.isPending} onClick={() => everywhere.mutate()}>
            {everywhere.isPending ? t('account.signingOut') : t('account.signOutEverywhere')}
          </button>
        </div>
        <ErrorNote error={everywhere.error} />
      </section>

      <LanguageCard />

      <ReferralCard />
      <YourSubscriptions />

      <FavouritesCard />

      <Messages />

      <NotificationsCard />

      <SavedAddresses />

      <MyReviews />

      <YourData />

      <section className="card narrow" aria-labelledby="delete-account">
        <h2 id="delete-account">{t('account.deleteTitle')}</h2>
        <p>{t('account.deleteBody')}</p>
        <button type="button" className="btn btn-danger" onClick={() => setConfirming(true)}>
          {t('account.deleteMine')}
        </button>
      </section>

      {confirming && (
        <ConfirmDialog
          title={t('account.deleteConfirm')}
          keepLabel={t('account.keep')}
          confirmLabel={t('account.deleteAccount')}
          busyLabel={t('account.deleting')}
          busy={remove.isPending}
          error={remove.error}
          onConfirm={() => remove.mutate()}
          onClose={() => setConfirming(false)}
        >
          <p>{t('account.deleteWarning')}</p>
        </ConfirmDialog>
      )}
    </>
  )
}

/** The shop's language (SHOP_LANGUAGES, docs/languages.md): saved to the account. Nothing while the switch is off. */
function LanguageCard() {
  const { available } = useLanguage()
  const t = useT()
  if (!available) return null
  return (
    <section className="card narrow" aria-labelledby="language">
      <h2 id="language">{t('lang.title')}</h2>
      <p className="small muted">{t('lang.accountHint')}</p>
      <LanguagePicker />
    </section>
  )
}

function SavedAddresses() {
  const queryClient = useQueryClient()
  const t = useT()
  const q = useQuery({ queryKey: ['addresses'], queryFn: api.addresses })
  const forget = useMutation({
    mutationFn: api.forgetAddress,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['addresses'] }),
  })
  return (
    <section className="card narrow" aria-labelledby="addresses">
      <h2 id="addresses">{t('account.addresses')}</h2>
      {q.isPending ? (
        <Spinner label={t('account.loadingAddresses')} />
      ) : q.isError ? (
        <ErrorNote error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <p className="muted">{t('account.addressesEmpty')}</p>
      ) : (
        <ul className="address-list">
          {q.data.map((a) => (
            <li key={a.id}>
              <div>
                {a.name && <strong>{a.name}</strong>}
                <span>{a.address}</span>
                <span className="muted small">{t('account.pincode', { pincode: a.pincode })}</span>
              </div>
              <button type="button" className="link-btn" disabled={forget.isPending} onClick={() => forget.mutate(a.id)} aria-label={t('common.removeItem', { label: a.address })}>
                {t('common.remove')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <ErrorNote error={forget.error} />
    </section>
  )
}

/** WhatsApp messages the customer chooses: the reminder, and back-in-stock alerts. */
function Messages() {
  const queryClient = useQueryClient()
  const t = useT()
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings })
  const alerts = useQuery({ queryKey: ['stock-alerts'], queryFn: api.stockAlerts })
  // Shown at once, put back if the save fails.
  const [wanted, setWanted] = useState<boolean | null>(null)
  const save = useMutation({
    mutationFn: api.saveSettings,
    onSuccess: (s) => queryClient.setQueryData(['settings'], s),
    onSettled: () => setWanted(null),
  })
  const remove = useMutation({
    mutationFn: api.removeStockAlert,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['stock-alerts'] }),
  })
  const status = (a: StockAlert) =>
    a.notifiedAt
      ? a.availableOn
        ? t('alerts.backFrom', { day: day(a.availableOn) })
        : t('alerts.back')
      : t('alerts.waiting', { day: day(a.expiresAt.slice(0, 10)) })
  return (
    <section className="card narrow" aria-labelledby="messages">
      <h2 id="messages">{t('account.whatsapp')}</h2>
      <p className="small muted">{t('account.whatsappHint')}</p>
      {settings.isError ? (
        <ErrorNote error={settings.error} onRetry={() => settings.refetch()} />
      ) : (
        <label className="option">
          <input
            type="checkbox"
            checked={wanted ?? !!settings.data?.remindersOptIn}
            disabled={!settings.data || save.isPending}
            onChange={(e) => {
              setWanted(e.target.checked)
              save.mutate({ remindersOptIn: e.target.checked })
            }}
          />
          <span>{t('account.remindMe')}</span>
        </label>
      )}
      <ErrorNote error={save.error} />
      <h3 className="sub-title">{t('alerts.title')}</h3>
      {alerts.isPending ? (
        <Spinner label={t('alerts.loading')} />
      ) : alerts.isError ? (
        <ErrorNote error={alerts.error} onRetry={() => alerts.refetch()} />
      ) : alerts.data.length === 0 ? (
        <p className="muted small">{t('alerts.empty')}</p>
      ) : (
        <ul className="address-list">
          {alerts.data.map((a) => (
            <li key={a.id}>
              <div>
                <strong>
                  {a.name}, {STAGE_LABEL[a.stage].toLowerCase()}
                </strong>
                <span className="muted small">{status(a)}</span>
              </div>
              {!a.notifiedAt && (
                <button type="button" className="link-btn" disabled={remove.isPending} onClick={() => remove.mutate(a.id)} aria-label={t('alerts.stopLabel', { name: a.name, stage: STAGE_LABEL[a.stage] })}>
                  {t('alerts.stop')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ErrorNote error={remove.error} />
    </section>
  )
}

/** A copy of what we hold about the customer, saved as a JSON file. */
function YourData() {
  const t = useT()
  const download = useMutation({
    mutationFn: api.exportData,
    onSuccess: (data) => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = 'mandimangoes-my-data.json'
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    },
  })
  return (
    <section className="card narrow" aria-labelledby="your-data">
      <h2 id="your-data">{t('account.data')}</h2>
      <p className="small muted">{t('account.dataHint')}</p>
      <button type="button" className="btn btn-quiet" disabled={download.isPending} onClick={() => download.mutate()}>
        {download.isPending ? t('account.preparing') : t('account.download')}
      </button>
      <ErrorNote error={download.error} />
    </section>
  )
}
