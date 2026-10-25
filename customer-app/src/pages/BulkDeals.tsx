import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ApiError, api, type BulkDeal, type Stage } from '../api'
import { availableOn, maxFor, nextTier, tierAt, tierRange } from '../bulk'
import { STAGE_HINT, STAGE_LABEL, boxContents, day, rupees } from '../format'
import { DayChips, Stepper } from '../forms'
import { ProductImage, photoAt } from '../mango'
import { useStore } from '../store'
import { DocTitle, ErrorNote, Skeleton } from '../ui'

const endFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })

export const bulkDealsQuery = (pincode: string | null) => ({ queryKey: ['bulk-deals', pincode], queryFn: () => api.bulkDeals(pincode) })

/** /bulk — the Bulk Deals tab: boxes for offices, events and families, priced by how many you order. */
export default function BulkDealsPage() {
  const { pincode } = useStore()
  const q = useQuery(bulkDealsQuery(pincode))
  return (
    <>
      <header className="bulk-intro">
        <h1>Bulk Deals</h1>
        <p className="muted">For offices, events and big families. Order more boxes and pay less per box. The price for your quantity is shown before you add it.</p>
      </header>
      {q.isPending ? (
        <Skeleton label="Loading bulk deals" cards={3} tall />
      ) : q.isError ? (
        <ErrorNote error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data.items.length ? (
        <section className="card empty">
          <h2>No bulk deals right now</h2>
          <p className="muted">New deals appear here when the season's big batches come in. You can still order regular boxes.</p>
          <Link to="/" className="btn btn-primary">
            Shop regular boxes
          </Link>
        </section>
      ) : (
        <ul className="tiles bulk-tiles">
          {q.data.items.map((d, i) => (
            <BulkTile key={d.id} deal={d} eager={i < 2} />
          ))}
        </ul>
      )}
    </>
  )
}

function BulkTile({ deal: d, eager }: { deal: BulkDeal; eager: boolean }) {
  const { bulk } = useStore()
  const inCart = bulk.filter((l) => l.listingId === d.id).reduce((n, l) => n + l.qty, 0)
  const noStock = d.availability ? !d.availability.some((x) => x.enough) : false
  return (
    <li className={noStock ? 'card tile tile-sold-out' : 'card tile'}>
      <div className="tile-img">
        <ProductImage photoUrl={d.photos[0]?.url ?? null} name={d.title} size={88} eager={eager} />
        {inCart > 0 && <span className="tile-badge">{inCart} in cart</span>}
      </div>
      <div className="tile-body">
        <h2 className="tile-name">
          <Link to={`/bulk/${d.id}`} className="card-link">
            {d.title}
          </Link>
        </h2>
        <span className="muted small">
          {d.product.name}
          {d.product.boxSize ? ` · ${d.product.boxSize} box` : ''}
        </span>
        <p className="tile-foot">
          <span>
            <span className="small">From </span>
            <strong className="price">{rupees(d.fromPrice)}</strong>
            <span className="small"> a box</span>
          </span>
          <span className="small muted">Minimum {d.minQty} boxes</span>
          {noStock && <span className="small sold-out">Not enough stock on open days</span>}
        </p>
      </div>
    </li>
  )
}

/** /bulk/:id — one bulk deal: photos, what it is, the price tiers, ripeness, day and quantity, then Add to cart. */
export function BulkDealPage() {
  const { id = '' } = useParams()
  const { pincode, date, setWhere, bulk, setBulk, cart, setQty } = useStore()
  const q = useQuery({ queryKey: ['bulk-deal', id, pincode], queryFn: () => api.bulkDeal(id, pincode) })
  const [photo, setPhoto] = useState(0)
  const [stage, setStage] = useState<Stage | null>(null)
  const [qty, setQtyState] = useState<number | null>(null)
  const [added, setAdded] = useState<string | null>(null)

  const d = q.data
  // The day: the shop's chosen day when this deal can deliver on it, else its first day with enough stock.
  const days = d?.availability ?? []
  const day0 = days.find((x) => x.date === date)?.date ?? days.find((x) => x.enough)?.date ?? days[0]?.date ?? null
  const onDay = days.find((x) => x.date === day0) ?? null
  const pickedStage = stage && d?.stages.includes(stage) ? stage : (d?.stages.find((s) => onDay?.stages.find((x) => x.stage === s)?.enough) ?? d?.stages[0] ?? null)
  const available = d ? availableOn(d, day0, pickedStage) : null
  const max = d ? maxFor(d, available) : 0
  const n = d ? Math.min(Math.max(qty ?? d.minQty, d.minQty), Math.max(max, d.minQty)) : 0

  useEffect(() => {
    if (d) document.title = `${d.title} · MandiMangoes`
  }, [d])

  if (q.isPending) return <Skeleton label="Loading the deal" cards={2} tall />
  if (q.isError) {
    if (q.error instanceof ApiError && q.error.status === 404) {
      return (
        <section className="card empty">
          <DocTitle title="Deal not available" />
          <h1>This bulk deal is not available</h1>
          <p className="muted">It may have ended or been taken down. Other deals are still on.</p>
          <Link to="/bulk" className="btn btn-primary">
            See bulk deals
          </Link>
        </section>
      )
    }
    return <ErrorNote error={q.error} onRetry={() => q.refetch()} />
  }
  const deal = q.data
  const tier = tierAt(deal.tiers, n)
  const next = nextTier(deal, n)
  const contents = boxContents(deal.product)
  const regular = pickedStage ? cart.find((l) => l.sku === deal.product.sku && l.stage === pickedStage) : null
  const inCart = pickedStage ? bulk.find((l) => l.listingId === deal.id && l.stage === pickedStage)?.qty ?? 0 : 0
  const otherDeal = pickedStage ? bulk.find((l) => l.listingId !== deal.id && l.sku === deal.product.sku && l.stage === pickedStage) : null
  const canAdd = Boolean(pickedStage && tier && max >= deal.minQty && (available == null || available >= n))
  const cur = deal.photos[Math.min(photo, deal.photos.length - 1)]

  function add() {
    if (!pickedStage || !tier || !canAdd) return
    setBulk({ listingId: deal.id, title: deal.title, sku: deal.product.sku, name: deal.product.name, stage: pickedStage, unitPrice: tier.unitPrice }, n)
    setAdded(`${n} boxes of ${deal.title} (${STAGE_LABEL[pickedStage]}) are in your cart.`)
  }

  return (
    <section className="card buy bulk-deal" aria-labelledby="deal-title">
      <DocTitle title={deal.title} />
      <div className="buy-media">
        {cur ? (
          <>
            <img
              src={photoAt(cur.url, 960)}
              srcSet={[480, 640, 960, 1200].map((w) => `${photoAt(cur.url, w)} ${w}w`).join(', ')}
              sizes="(min-width: 1024px) 520px, 100vw"
              width={1200}
              height={900}
              alt={`Photo ${photo + 1} of ${deal.photos.length}, ${deal.title}`}
              className="product-hero"
            />
            {deal.photos.length > 1 && (
              <div className="bulk-thumbs" role="group" aria-label="Photos">
                {deal.photos.map((p, i) => (
                  <button key={p.id} type="button" className="bulk-thumb" aria-pressed={i === photo} aria-label={`Show photo ${i + 1}`} onClick={() => setPhoto(i)}>
                    <img src={photoAt(p.url, 160)} width={64} height={64} alt="" loading="lazy" />
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <span className="buy-art">
            <ProductImage name={deal.title} size={240} />
          </span>
        )}
      </div>
      <div className="buy-body">
        <header className="product-head">
          <div className="product-name">
            <p className="eyebrow">Bulk deal</p>
            <h1 id="deal-title">{deal.title}</h1>
            <p className="muted small">
              {deal.product.name} · {deal.product.variety}
              {deal.product.boxSize ? ` · ${deal.product.boxSize} box` : ''}
            </p>
          </div>
        </header>
        {deal.description && <p>{deal.description}</p>}
        <dl className="bulk-facts">
          {deal.origin && (
            <>
              <dt>From</dt>
              <dd>{deal.origin}</dd>
            </>
          )}
          {contents && (
            <>
              <dt>In each box</dt>
              <dd>{contents}</dd>
            </>
          )}
          <dt>Order</dt>
          <dd>
            {deal.minQty} boxes or more{deal.qtyStep > 1 ? `, in steps of ${deal.qtyStep}` : ''}, up to {deal.maxQty} per order
          </dd>
          {deal.endsAt && (
            <>
              <dt>Offer ends</dt>
              <dd>{endFmt.format(new Date(deal.endsAt))}</dd>
            </>
          )}
        </dl>

        <table className="bulk-tiers">
          <caption>Price per box</caption>
          <thead>
            <tr>
              <th scope="col">Boxes</th>
              <th scope="col">Per box</th>
            </tr>
          </thead>
          <tbody>
            {deal.tiers.map((t) => (
              <tr key={t.minQty} className={tier?.minQty === t.minQty ? 'is-current' : undefined} aria-current={tier?.minQty === t.minQty ? 'true' : undefined}>
                <td>{tierRange(t)}</td>
                <td>
                  <strong>{rupees(t.unitPrice)}</strong>
                  {t.savingPerBox != null && <span className="small saving"> {rupees(t.savingPerBox)} less than a single box</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">A single box is {rupees(deal.retailPrice)} in the regular shop. One price whatever the ripeness.</p>

        <fieldset className="field">
          <legend>Choose ripeness</legend>
          <ul className="ripe-options">
            {deal.stages.map((s) => {
              const st = onDay?.stages.find((x) => x.stage === s)
              const short = st ? !st.enough : false
              return (
                <li key={s} className={`ripe-option${s === pickedStage ? ' is-picked' : ''}${short ? ' is-sold' : ''}`}>
                  <label>
                    <input
                      type="radio"
                      name="stage"
                      value={s}
                      checked={s === pickedStage}
                      onChange={() => {
                        setStage(s)
                        setAdded(null)
                      }}
                    />
                    <span className={`stage-dot stage-${s.toLowerCase()}`} aria-hidden="true" />
                    <span className="stage-text">
                      <strong>{STAGE_LABEL[s]}</strong>
                      <span className="muted small">
                        {STAGE_HINT[s]}
                        {st && (short ? (st.available ? ` Only ${st.available} boxes for ${day(onDay!.date)}, below the minimum.` : ` None left for ${day(onDay!.date)}.`) : ` ${st.available} boxes for ${day(onDay!.date)}. Eat by ${day(st.eatBy)}.`)}
                      </span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        </fieldset>

        {!pincode ? (
          <p className="note">
            <Link to="/?where=1">Set your delivery pincode</Link> to see the days we can deliver this deal and the stock for each.
          </p>
        ) : deal.serviceable === false ? (
          <p className="note note-warn">We don't deliver to {pincode} yet.</p>
        ) : !days.length ? (
          <p className="note note-warn">No delivery days are open right now. Please check back soon.</p>
        ) : (
          <div className="field">
            <span className="label">Delivery day</span>
            <DayChips
              label="Delivery day"
              days={days.map((x) => x.date)}
              value={day0}
              onChange={(x) => {
                setWhere(pincode, x)
                setAdded(null)
              }}
              format={(x) => `${day(x)}${days.find((y) => y.date === x)?.enough ? '' : ' (low stock)'}`}
            />
            <p className="muted small">You confirm the day and time at checkout.</p>
          </div>
        )}

        {max >= deal.minQty ? (
          <div className="field">
            <Stepper
              label="How many boxes"
              showLabel
              value={n}
              min={deal.minQty}
              max={max}
              step={deal.qtyStep}
              onChange={(x) => {
                setQtyState(x)
                setAdded(null)
              }}
              lessLabel={`${deal.qtyStep} ${deal.qtyStep === 1 ? 'box' : 'boxes'} fewer`}
              moreLabel={`${deal.qtyStep} ${deal.qtyStep === 1 ? 'box' : 'boxes'} more`}
            />
            {next && (
              <p className="muted small">
                Order {next.minQty} or more and pay {rupees(next.unitPrice)} a box.
              </p>
            )}
            {inCart > 0 && <p className="muted small">{inCart} boxes of this ripeness are in your cart now. Adding again replaces that number.</p>}
          </div>
        ) : (
          <p className="sold-out">{available != null ? `Not enough ${pickedStage ? STAGE_LABEL[pickedStage].toLowerCase() : ''} stock for the minimum of ${deal.minQty} boxes on ${day(day0!)}. Try another day or ripeness.` : `This deal can't be ordered right now.`}</p>
        )}

        {regular && (
          <p className="note note-warn">
            You also have {regular.qty} regular {regular.qty === 1 ? 'box' : 'boxes'} of {regular.name} ({STAGE_LABEL[regular.stage]}) in your cart. One order can take them as regular boxes or as this deal, not both.{' '}
            <button type="button" className="link-btn" onClick={() => setQty(regular, 0)}>
              Remove the regular boxes
            </button>
          </p>
        )}
        {otherDeal && (
          <p className="note note-warn">
            {otherDeal.title} is in your cart for the same box and ripeness. One order can take one of them.
          </p>
        )}

        <div className="buy-bar">
          <button type="button" className="btn btn-primary btn-block" onClick={add} disabled={!canAdd}>
            {tier ? `Add ${n} boxes · ${rupees(tier.unitPrice * n)}` : 'Add to cart'}
          </button>
        </div>
        {tier && (
          <p className="muted small" aria-live="polite">
            {n} × {rupees(tier.unitPrice)} = <strong>{rupees(tier.unitPrice * n)}</strong>. Free delivery. Checkout confirms the price before you pay.
          </p>
        )}
        {added && (
          <p className="note" role="status">
            {added} <Link to="/cart">View cart</Link>
          </p>
        )}
      </div>
    </section>
  )
}
