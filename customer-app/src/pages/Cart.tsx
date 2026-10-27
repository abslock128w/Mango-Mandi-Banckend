import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ApiError, api } from '../api'
import { STAGE_LABEL, rupees } from '../format'
import { Stepper } from '../forms'
import { useT } from '../i18n'
import { MangoArt } from '../mango'
import { useStore, type BulkCartLine } from '../store'
import { UnpaidOrderBanner } from '../unpaid'

export default function Cart() {
  const { cart, setQty, bulk, profile } = useStore()
  const navigate = useNavigate()
  const t = useT()
  const total = cart.reduce((s, l) => s + l.price * l.qty, 0) + bulk.reduce((s, l) => s + l.unitPrice * l.qty, 0)

  if (!cart.length && !bulk.length) {
    return (
      <>
        <UnpaidOrderBanner />
        <section className="card empty">
          <h1>{t('error.cartEmpty')}</h1>
          <p className="muted">{t('cart.emptyHint')}</p>
          <Link to="/" className="btn btn-primary">
            {t('quality.shop')}
          </Link>
        </section>
      </>
    )
  }

  return (
    <>
      <UnpaidOrderBanner />
      <section className="card">
        <h1>{t('title.cart')}</h1>
        <p className="muted small">{t('cart.dayAtCheckout')}</p>
        <ul className="lines">
          {bulk.map((l) => (
            <BulkLine key={`bulk-${l.listingId}-${l.stage}`} line={l} />
          ))}
          {cart.map((l) => {
            const label = `${l.name}, ${STAGE_LABEL[l.stage]}`
            return (
              <li key={`${l.sku}-${l.stage}`} className="line line-art">
                <MangoArt stage={l.stage} size={36} />
                <div className="line-info">
                  <strong>{l.name}</strong>
                  <span className="muted small">
                    {STAGE_LABEL[l.stage]} · {t('price.each', { price: rupees(l.price) })}
                  </span>
                </div>
                <Stepper
                  label={t('qty.label', { label })}
                  value={l.qty}
                  min={0}
                  max={20}
                  onChange={(n) => setQty(l, n)}
                  lessLabel={t('qty.less', { label })}
                  moreLabel={t('qty.more', { label })}
                />
                <strong className="line-price">{rupees(l.price * l.qty)}</strong>
              </li>
            )
          })}
        </ul>
        <div className="total-row">
          <span>{t('common.total')}</span>
          <strong>{rupees(total)}</strong>
        </div>
        <p className="muted small">
          {t('cart.freeDelivery')}
          {bulk.length > 0 && ` ${t('cart.bulkConfirmed')}`}
        </p>
        <button type="button" className="btn btn-primary btn-block" onClick={() => navigate(profile ? '/checkout' : '/sign-in?next=/checkout')}>
          {profile ? t('cart.continue') : t('cart.signInToCheckOut')}
        </button>
        <Link to="/" className="btn btn-block btn-quiet">
          {t('cart.keepShopping')}
        </Link>
      </section>
    </>
  )
}

/**
 * A bulk deal in the cart. Its price is asked of the API again, so a deal that changed or ended
 * since it was added says so here, before checkout.
 */
function BulkLine({ line: l }: { line: BulkCartLine }) {
  const { setBulk } = useStore()
  const t = useT()
  const label = `${l.title}, ${STAGE_LABEL[l.stage]}`
  const now = useQuery({ queryKey: ['bulk-price', l.listingId, l.qty], queryFn: () => api.bulkPrice(l.listingId, l.qty), retry: false, staleTime: 30_000 })
  const deal = useQuery({ queryKey: ['bulk-deal', l.listingId, null], queryFn: () => api.bulkDeal(l.listingId, null), retry: false, staleTime: 60_000 })
  const gone = (now.error instanceof ApiError && now.error.status === 404) || (deal.error instanceof ApiError && deal.error.status === 404)
  const badQty = now.error instanceof ApiError && now.error.code === 'BULK_QTY_INVALID' ? now.error.message : null
  const price = now.data?.unitPrice ?? l.unitPrice
  // The price moved since it was added: keep the new one, and say so.
  const moved = now.data && now.data.unitPrice !== l.unitPrice
  const d = deal.data
  return (
    <li className="line line-art">
      <MangoArt stage={l.stage} size={36} />
      <div className="line-info">
        <strong>
          <span className="bulk-tag">{t('bulk.tag')}</span>
          <Link to={`/bulk/${l.listingId}`}>{l.title}</Link>
        </strong>
        <span className="muted small">
          {l.name}, {STAGE_LABEL[l.stage]} · {t('price.aBox', { price: rupees(price) })}
        </span>
        {moved && (
          <span className="small price-changed">
            {t('cart.priceWas', { price: rupees(l.unitPrice) })}{' '}
            <button type="button" className="link-btn" onClick={() => setBulk({ ...l, unitPrice: now.data!.unitPrice }, l.qty)}>
              {t('cart.gotIt')}
            </button>
          </span>
        )}
        {gone && <span className="small sold-out">{t('cart.dealEnded')}</span>}
        {badQty && <span className="small sold-out">{badQty}</span>}
      </div>
      {d && !gone ? (
        <Stepper
          label={t('qty.label', { label })}
          value={l.qty}
          min={d.minQty}
          max={Math.max(d.maxQty, l.qty)}
          step={d.qtyStep}
          onChange={(n) => setBulk(l, n)}
          lessLabel={t('qty.fewer', { label })}
          moreLabel={t('qty.moreBulk', { label })}
        />
      ) : (
        <span>{t('common.boxes', { count: l.qty })}</span>
      )}
      <span className="line-price bulk-line-end">
        <strong>{rupees(price * l.qty)}</strong>
        <button type="button" className="link-btn small" onClick={() => setBulk(l, 0)} aria-label={t('common.removeItem', { label })}>
          {t('common.remove')}
        </button>
      </span>
    </li>
  )
}
