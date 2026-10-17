import { useRef, useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ApiError, api, errorMessage, signedInPhone, type Quote } from '../api'
import { STAGE_LABEL, day, rupees, slotText } from '../format'
import { openRazorpay, rememberPayment } from '../payment'
import { useStore, type CartLine } from '../store'
import { ErrorNote, Spinner } from '../ui'

function loadAddress() {
  try {
    return JSON.parse(localStorage.getItem('vmr.address') ?? '{}') as { name?: string; address?: string }
  } catch {
    return {}
  }
}

/** Makes the account's cart match this device's cart, which the quote reads. */
async function syncCart(cart: CartLine[]) {
  const server = await api.serverCart()
  const want = new Set(cart.map((l) => `${l.sku}|${l.stage}`))
  for (const l of server.lines) if (!want.has(`${l.sku}|${l.stage}`)) await api.setCartLine(l.sku, l.stage, 0)
  for (const l of cart) await api.setCartLine(l.sku, l.stage, l.qty)
}

export default function Checkout() {
  const { pincode, date, cart, clearCart } = useStore()
  const navigate = useNavigate()
  const saved = useRef(loadAddress())
  const [name, setName] = useState(saved.current.name ?? '')
  const [address, setAddress] = useState(saved.current.address ?? '')
  const [slotId, setSlotId] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [quote, setQuote] = useState<Quote | null>(null)
  const idemKey = useRef<string | null>(null)

  const slots = useQuery({
    queryKey: ['slots', pincode, date],
    queryFn: () => api.slots(pincode!, date ?? ''),
    enabled: Boolean(pincode),
  })

  const review = useMutation({
    mutationFn: async () => {
      await syncCart(cart)
      return api.quote({ pincode: pincode!, deliveryDate: slots.data?.deliveryDate ?? date!, slotId })
    },
    onSuccess: (q) => {
      idemKey.current = crypto.randomUUID()
      setQuote(q)
    },
  })
  const pay = useMutation({
    mutationFn: async () => {
      const c = await api.confirm({ quoteId: quote!.quoteId, address: address.trim(), name: name.trim() || undefined }, idemKey.current!)
      rememberPayment(c)
      clearCart()
      if (c.razorpayKeyId && c.razorpayOrderId) {
        await openRazorpay({ key: c.razorpayKeyId, rzp: c.razorpayOrderId, total: c.total, number: c.number }, signedInPhone())
      }
      return c
    },
    onSuccess: (c) => navigate(`/orders/${c.orderId}`, { replace: true }),
  })

  if (!pincode) return <Navigate to="/" replace />
  if (!cart.length && !pay.isPending && !pay.isSuccess) return <Navigate to="/cart" replace />

  function submit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (address.trim().length < 10) return setFormError('Enter the full delivery address, with house number and landmark.')
    if (slots.data?.slots.length && !slotId) return setFormError('Choose a delivery time.')
    try {
      localStorage.setItem('vmr.address', JSON.stringify({ name: name.trim(), address: address.trim() }))
    } catch {
      // ignore
    }
    review.mutate()
  }

  if (quote) {
    return (
      <section className="card">
        <h1>Review and pay</h1>
        <dl className="facts">
          <div>
            <dt>Arrives</dt>
            <dd>
              {day(quote.deliveryDate)}
              {quote.slot && `, ${slotText(quote.slot)}`}
            </dd>
          </div>
          <div>
            <dt>To</dt>
            <dd>
              {name && (
                <>
                  {name}
                  <br />
                </>
              )}
              {address}, {quote.pincode}
            </dd>
          </div>
        </dl>
        <ul className="lines">
          {quote.lines.map((l) => (
            <li key={`${l.sku}-${l.stage}`} className="line">
              <div>
                <strong>
                  {l.qty} × {l.name}
                </strong>
                <span className="muted small">
                  {STAGE_LABEL[l.stage]} · eat by {day(l.eatBy)}
                </span>
              </div>
              <strong className="line-price">{rupees(l.linePrice)}</strong>
            </li>
          ))}
        </ul>
        <div className="total-row">
          <span>Total</span>
          <strong>{rupees(quote.total)}</strong>
        </div>
        <p className="muted small">
          Your boxes are held for a few minutes while you pay. You can cancel for a full refund any time before your order is packed.
        </p>
        <ErrorNote error={pay.error ? quoteProblem(pay.error) : null} />
        <button type="button" className="btn btn-primary btn-block" disabled={pay.isPending} onClick={() => pay.mutate()}>
          {pay.isPending ? 'Opening payment…' : `Pay ${rupees(quote.total)}`}
        </button>
        <button type="button" className="btn btn-block btn-quiet" disabled={pay.isPending} onClick={() => setQuote(null)}>
          Change details
        </button>
      </section>
    )
  }

  return (
    <section className="card">
      <h1>Delivery details</h1>
      <form onSubmit={submit} noValidate>
        {slots.isPending ? (
          <Spinner label="Loading delivery times" />
        ) : slots.isError ? (
          <ErrorNote error={slots.error} onRetry={() => slots.refetch()} />
        ) : (
          <>
            <p>
              Arrives <strong>{day(slots.data.deliveryDate)}</strong>
            </p>
            {slots.data.slots.length > 0 && (
              <fieldset className="field">
                <legend>Delivery time</legend>
                <div className="options">
                  {slots.data.slots.map((s) => (
                    <label key={s.id} className={`option${s.available ? '' : ' option-off'}`}>
                      <input type="radio" name="slot" value={s.id} checked={slotId === s.id} disabled={!s.available} onChange={() => setSlotId(s.id)} />
                      <span>
                        {slotText(s)}
                        {!s.available && <span className="muted small"> · Full</span>}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </>
        )}
        <div className="field">
          <label htmlFor="name">Your name</label>
          <input id="name" autoComplete="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="address">Delivery address</label>
          <textarea
            id="address"
            autoComplete="street-address"
            rows={3}
            maxLength={500}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            aria-describedby="address-hint"
          />
          <p id="address-hint" className="muted small">
            House or flat number, street, area and a landmark. Pincode {pincode}.
          </p>
        </div>
        {formError && (
          <p className="field-error" role="alert">
            {formError}
          </p>
        )}
        <ErrorNote error={review.error ? quoteProblem(review.error, cart) : null} />
        <button type="submit" className="btn btn-primary btn-block" disabled={review.isPending || slots.isPending}>
          {review.isPending ? 'Checking stock…' : 'Review order'}
        </button>
      </form>
    </section>
  )
}

/** Turns the API's checkout refusals into something a customer can act on. */
function quoteProblem(err: unknown, cart: CartLine[] = []) {
  if (!(err instanceof ApiError)) return errorMessage(err)
  if (err.code === 'STOCK_INSUFFICIENT') {
    const name = cart.find((l) => l.sku === err.detail.sku)?.name ?? 'One of your mangoes'
    return `${name} has run short for this day. Lower the number of boxes or pick another day.`
  }
  if (err.code === 'SLOT_FULL') return 'That delivery time just filled up. Choose another one.'
  if (err.code === 'QUOTE_EXPIRED') return 'This took a little long and the price hold ended. Tap Change details and review again.'
  return err.message
}
