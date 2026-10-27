import { Link } from 'react-router-dom'
import { useT } from '../i18n'

/** /quality: what we do so the box is at the ripeness the customer chose. Only what the system really does. */
export default function Quality() {
  const t = useT()
  return (
    <>
      <section className="card" aria-labelledby="quality-title">
        <h1 id="quality-title">{t('quality.title')}</h1>
        <p className="lead">{t('quality.lead')}</p>
      </section>
      <ol className="steps-list">
        {([1, 2, 3, 4, 5] as const).map((n) => (
          <li key={n} className="card">
            <h2>{t(`quality.step${n}.title`)}</h2>
            <p>{t(`quality.step${n}.body`)}</p>
          </li>
        ))}
      </ol>
      <Link to="/" className="btn btn-primary btn-block">
        {t('quality.shop')}
      </Link>
    </>
  )
}
