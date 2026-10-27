import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { week } from '../format'
import { useT } from '../i18n'

/** Shop home: shown while any week is open for booking. Its own file, so the home page does not load the whole booking page. */
export function BookAheadCard() {
  const t = useT()
  const q = useQuery({ queryKey: ['preorder-weeks'], queryFn: api.preorderWeeks, staleTime: 60_000 })
  const weeks = [...new Set(q.data?.weeks.map((w) => w.weekStart) ?? [])]
  if (!weeks.length) return null
  return (
    <section className="card book-ahead" aria-labelledby="book-ahead">
      <h2 id="book-ahead">{t('nav.bookAhead')}</h2>
      <p>{t(weeks.length > 1 ? 'bookAheadCard.lockInLater' : 'bookAheadCard.lockIn', { week: week(weeks[0]) })}</p>
      <Link to="/preorder" className="btn btn-primary">
        {t('bookAheadCard.cta')}
      </Link>
    </section>
  )
}
