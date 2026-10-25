import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ApiError, api } from '../api'
import { STAGE_LABEL, rupees } from '../format'
import { Stepper } from '../forms'
import { MangoArt } from '../mango'
import { useStore, type BulkCartLine } from '../store'
import { UnpaidOrderBanner } from '../unpaid'

export default function Cart() {
  const { cart, setQty, bulk, profile } = useStore()
  const navigate = useNavigate()
  const total = cart.reduce((s, l) => s + l.price * l.qty, 0) + bulk.reduce((s, l) => s + l.unitPrice * l.qty, 0)

  if (!cart.length && !bulk.length) {
    return (
      <>
        <UnpaidOrderBanner />
        <section className="card empty">
          <h1>Your cart is empty</h1>
          <p className="muted">Pick a day and the ripeness you want, and add a box or two.</p>
          <Link to="/" className="btn btn-primary">
            Shop mangoes
          </Link>
        </section>
      </>
    )
  }

  return (
    <>
      <UnpaidOrderBanner />
      <section className="card">
        <h1>Your cart</h1>
        <p className="muted small">You choose the delivery day and time at checkout.</p>
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
                    {STAGE_LABEL[l.stage]} · {rupees(l.price)} each
                  </span>
                </div>
                <Stepper
                  label={`${label} quantity`}
                  value={l.qty}
                  min={0}
                  max={20}
                  onChange={(n) => setQty(l, n)}
                  lessLabel={`One less ${label}`}
                  moreLabel={`One more ${label}`}
                />
                <strong className="line-price">{rupees(l.price * l.qty)}</strong>
              </li>
            )
          })}
        </ul>
        <div className="total-row">
          <span>Total</span>
          <strong>{rupees(total)}</strong>
        </div>
        <p className="muted small">
          Delivery is free. Stock is checked again for your delivery day at checkout.{bulk.length > 0 && ' Bulk deal prices are confirmed at checkout, before you pay.'}
        </p>
        <button type="button" className="btn btn-primary btn-block" onClick={() => navigate(profile ? '/checkout' : '/sign-in?next=/checkout')}>
          {profile ? 'Continue to delivery' : 'Sign in to check out'}
        </button>
        <Link to="/" className="btn btn-block btn-quiet">
          Keep shopping
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
          <span className="bulk-tag">Bulk</span>
          <Link to={`/bulk/${l.listingId}`}>{l.title}</Link>
        </strong>
        <span className="muted small">
          {l.name}, {STAGE_LABEL[l.stage]} · {rupees(price)} a box
        </span>
        {moved && (
          <span className="small price-changed">
            Was {rupees(l.unitPrice)} a box when you added it.{' '}
            <button type="button" className="link-btn" onClick={() => setBulk({ ...l, unitPrice: now.data!.unitPrice }, l.qty)}>
              OK, got it
            </button>
          </span>
        )}
        {gone && <span className="small sold-out">This deal has ended. Remove it to check out.</span>}
        {badQty && <span className="small sold-out">{badQty}</span>}
      </div>
      {d && !gone ? (
        <Stepper
          label={`${label} quantity`}
          value={l.qty}
          min={d.minQty}
          max={Math.max(d.maxQty, l.qty)}
          step={d.qtyStep}
          onChange={(n) => setBulk(l, n)}
          lessLabel={`Fewer ${label}`}
          moreLabel={`More ${label}`}
        />
      ) : (
        <span>{l.qty} boxes</span>
      )}
      <span className="line-price bulk-line-end">
        <strong>{rupees(price * l.qty)}</strong>
        <button type="button" className="link-btn small" onClick={() => setBulk(l, 0)} aria-label={`Remove ${label}`}>
          Remove
        </button>
      </span>
    </li>
  )
}
