// /help: how ordering, delivery days, ripeness, cancelling and problem reports work, and how to
// reach a person (UX-1, UX-3).
//
// NEEDS THE OWNER'S REVIEW before launch: the wording, the help hours and the grievance contact.
// India's Consumer Protection (E-Commerce) Rules, 2020 ask for a grievance officer's name and
// contact details on the site; the owner has not given them, so none are made up here.
// The rules quoted (hold, cutoff, days ahead, report window) come from the API's live rules.
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { STAGE_HINT, STAGE_LABEL, helpLink, helpNumber } from '../format'
import { policyQuery } from '../queries'
import { useCare } from '../features'
import { useT } from '../i18n'
import type { Stage } from '../api'

const STAGES: Stage[] = ['RAW', 'SEMI_RIPE', 'RIPE']

/** The shop's live rules, for help and terms text. */
export const usePolicy = () => useQuery(policyQuery())

/** How to reach a person: WhatsApp (link and number). Production builds always have the number. */
export function SupportContact() {
  const link = helpLink('Hello MandiMangoes, I need help')
  const number = helpNumber()
  const t = useT()
  if (!link) {
    // Only a dev or test build gets here (support.ts stops a production build without the number).
    return <p>{t('help.noNumber')}</p>
  }
  return (
    <p>
      {t.rich('help.messageUs', {
        number: (
          <a href={link} target="_blank" rel="noopener noreferrer">
            {number}
            <span className="sr-only"> {t('common.opensWhatsApp')}</span>
          </a>
        ),
      })}
    </p>
  )
}

/** The help centre (docs/care.md): ask a question in the shop and follow the reply there. Only while it is on. */
function AskInShop() {
  const care = useCare()
  const t = useT()
  if (!care.helpCentre) return null
  return <p>{t.rich('help.askInShop', { ask: <Link to="/help/requests">{t('title.helpRequests')}</Link> })}</p>
}

export default function Help() {
  const policy = usePolicy().data
  const hours = policy?.claimWindowHours
  const t = useT()
  return (
    <article className="card prose">
      <h1>{t('nav.help')}</h1>
      <p className="lead">{t('help.lead')}</p>

      <h2>{t('help.h.talk')}</h2>
      <AskInShop />
      <SupportContact />

      <h2>{t('help.h.ordering')}</h2>
      <ol>
        <li>{t('help.order1')}</li>
        <li>{t('help.order2')}</li>
        <li>{t('help.order3')}</li>
        <li>
          {t('help.order4')} {policy ? t('help.heldMinutes', { minutes: policy.holdMinutes }) : t('help.heldFew')}
        </li>
        <li>{t('help.order5')}</li>
      </ol>

      <h2>{t('help.h.days')}</h2>
      <ul>
        <li>{t('help.days1')}</li>
        <li>
          {policy
            ? t('help.cutoff', { time: policy.cutoffTime.replace(' IST', ''), days: policy.maxDaysAhead })
            : t('help.cutoffUnknown')}
        </li>
        <li>{t.rich('help.laterWeek', { link: <Link to="/preorder">{t('nav.bookAhead')}</Link> })}</li>
        <li>{t('help.days3')}</li>
        <li>{t('help.days4')}</li>
      </ul>

      <h2>{t('help.h.ripeness')}</h2>
      <p>{t('help.ripeness')}</p>
      <ul>
        {STAGES.map((s) => (
          <li key={s}>
            <strong>{STAGE_LABEL[s]}:</strong> {STAGE_HINT[s]}
          </li>
        ))}
      </ul>
      <p>{t.rich('help.eatBy', { link: <Link to="/quality">{t('title.quality')}</Link> })}</p>

      <h2>{t('help.h.changing')}</h2>
      <ul>
        <li>{t('help.change1')}</li>
        <li>{t('help.change2')}</li>
        <li>{t('help.change3')}</li>
      </ul>

      <h2>{t('help.h.wrong')}</h2>
      <ul>
        <li>{hours ? t('help.wrong1Hours', { hours }) : t('help.wrong1Soon')}</li>
        <li>{t('help.wrong2')}</li>
        <li>{t('help.wrong3')}</li>
      </ul>

      <p>
        {t.rich('help.fullRules', {
          terms: <Link to="/terms">{t('help.termsLink')}</Link>,
          privacy: <Link to="/privacy">{t('signIn.privacyNotice')}</Link>,
        })}
      </p>
    </article>
  )
}
