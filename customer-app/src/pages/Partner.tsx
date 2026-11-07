// /partner: Partner With Us (docs/partner-network.md). Who MandiMangoes would like to work with,
// the partnership categories (from the API, so the panel's edits show here), and the way into
// the enquiry form, with a category already chosen when one is picked here.
//
// The descriptive copy stays in English in every language (it is marketing text that needs a
// writer's translation, not a word list), marked lang="en"; headings and buttons are translated.
import type { MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ApiError } from '../api'
import { partnerNetworkQuery } from '../queries'
import { useT } from '../i18n'
import { ErrorNote, Spinner } from '../ui'

/** Shown instead of the page while the API's PARTNER_NETWORK switch is off (it answers 404). */
export function PartnerClosed() {
  const t = useT()
  return (
    <section className="card empty">
      <h1>{t('partner.closedTitle')}</h1>
      <p className="muted">{t('partner.closedBody')}</p>
      <Link to="/" className="btn btn-primary">
        {t('common.backToShop')}
      </Link>
    </section>
  )
}

export const isSwitchedOff = (err: unknown) => err instanceof ApiError && err.status === 404

export default function Partner() {
  const q = useQuery(partnerNetworkQuery())
  const t = useT()
  const en = t.lang === 'en' ? undefined : 'en'

  if (q.isPending) return <Spinner label={t('common.loading')} />
  if (q.isError) return isSwitchedOff(q.error) ? <PartnerClosed /> : <ErrorNote error={q.error} onRetry={() => void q.refetch()} />

  const explore = (e: MouseEvent) => {
    // Like the skip link: move focus to the list without adding #partner-ways to the address.
    e.preventDefault()
    const to = document.getElementById('partner-ways-title')
    to?.focus()
    to?.scrollIntoView({ block: 'start' })
  }

  return (
    <article className="partner">
      <header className="partner-hero">
        <div className="partner-hero-text">
          <p className="eyebrow">{t('nav.partner')}</p>
          {en && <p className="note">{t('partner.englishOnly')}</p>}
          <h1 lang={en}>Let's Grow Together.</h1>
          <p className="partner-lead" lang={en}>
            Whether you're an entrepreneur, supplier, farmer, distributor or business owner, there's an opportunity to build something
            meaningful with MandiMangoes. We welcome business ideas, product opportunities, distribution partnerships and collaborations
            that help us grow.
          </p>
          <p className="partner-india" lang={en}>
            MandiMangoes is open to opportunities throughout India.
          </p>
          <div className="partner-ctas">
            <a href="#partner-ways" className="btn btn-primary" onClick={explore}>
              {t('partner.explore')}
            </a>
            <Link to="/partner/apply" className="btn">
              {t('partner.enquire')}
            </Link>
          </div>
        </div>
        <img className="partner-logo" src="/brand/logo-320.webp" srcSet="/brand/logo-320.webp 1x, /brand/logo-640.webp 2x" width="200" height="200" alt="" />
      </header>

      <section className="partner-ways" aria-labelledby="partner-ways-title" id="partner-ways">
        <h2 id="partner-ways-title" tabIndex={-1}>
          {t('partner.waysTitle')}
        </h2>
        <ol className="partner-list">
          {q.data.categories.map((c) => (
            <li key={c.code}>
              <h3>{c.name}</h3>
              <p>{c.description}</p>
              <Link
                to={`/partner/apply?category=${encodeURIComponent(c.code)}`}
                className="partner-start"
                aria-label={`${t('partner.startEnquiry')}: ${c.name}`}
              >
                {t('partner.startEnquiry')}
                <span aria-hidden="true"> →</span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section className="partner-next" aria-labelledby="partner-next-title">
        <h2 id="partner-next-title">{t('partner.nextTitle')}</h2>
        <ol>
          <li>{t('partner.next1')}</li>
          <li>{t('partner.next2')}</li>
          <li>{t('partner.next3')}</li>
        </ol>
        <Link to="/partner/apply" className="btn btn-primary">
          {t('partner.enquire')}
        </Link>
      </section>
    </article>
  )
}
