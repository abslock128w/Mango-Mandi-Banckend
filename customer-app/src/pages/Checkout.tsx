import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ApiError, api, errorMessage, signedInPhone, type Confirmed, type Quote } from '../api'
import { STAGE_LABEL, day, rupees, slotText } from '../format'
import { openRazorpay } from '../payment'
import { useStore, type CartLine } from '../store'
import { ErrorNote, Spinner } from '../ui'
import { AddPhoneCard } from '../auth-ui'

function loadAddress() {
  try {
    return JSON.parse(localStorage.getItem('mm.address') ?? '{}') as { name?: string; address?: string }
  } catch {
    return {}
  }
}

/**
 * Makes the account's cart match this device's cart, which the quote reads.
 * A box we no longer sell is refused with the same PRODUCT_UNAVAILABLE the
 * quote uses, naming it, rather than the API's "Unknown SKU".
 */
export async function syncCart(cart: CartLine[]) {
  const server = await api.serverCart()
  const want = new Set(cart.map((l) => `${l.sku}|${l.stage}`))
  for (const l of server.lines) if (!want.has(`${l.sku}|${l.stage}`)) await api.setCartLine(l.sku, l.stage, 0)
  for (const l of cart) {
    try {
      await api.setCartLine(l.sku, l.stage, l.qty)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INVALID_SKU') {
        throw new ApiError(409, 'PRODUCT_UNAVAILABLE', `${l.name} is no longer sold`, { sku: l.sku, stage: l.stage })
      }
      throw err
    }
  }
}

/** A short pause, for retrying a confirm whose first try is still starting the payment. */
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

export default function Checkout() {
  const { profile } = useStore()
  // Accounts made with Google add a checked mobile number before the first order.
  if (profile && !profile.phone) return <AddPhoneCard />
  return <CheckoutForm />
}

function CheckoutForm() {
  const { pincode, date, cart, clearCart, setQty, setWhere } = useStore()
  const navigate = useNavigate()
  const saved = useRef(loadAddress())
  const [name, setName] = useState(saved.current.name ?? '')
  const [address, setAddress] = useState(saved.current.address ?? '')
  const [slotId, setSlotId] = useState<string | null>(null)
  const [promoCode, setPromoCode] = useState('')
  const [isGift, setIsGift] = useState(false)
  const [gift, setGift] = useState({ recipientName: '', recipientPhone: '', message: '' })
  const [formError, setFormError] = useState<string | null>(null)
  const [quote, setQuote] = useState<Quote | null>(null)
  const idemKey = useRef<string | null>(null)
  // After the gateway failed to start a payment, the quote is spent: the next Pay quotes again with a new key.
  const quoteSpent = useRef(false)

  // Addresses this account has ordered to before, for this pincode.
  const book = useQuery({ queryKey: ['addresses'], queryFn: api.addresses, staleTime: 60_000 })
  const savedHere = (book.data ?? []).filter((a) => a.pincode === pincode)
  const [picked, setPicked] = useState<string | null>(null)
  const typedOwn = useRef(false)
  // Start from the address used last time (or the most recent saved one), until the customer types their own.
  const squash = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim()
  if (!typedOwn.current && picked === null && savedHere.length) {
    const match = address.trim() ? savedHere.find((a) => squash(a.address) === squash(address)) : savedHere[0]
    if (match) {
      setPicked(match.id)
      setAddress(match.address)
      if (match.name && !name) setName(match.name)
    }
  }
  const choose = (id: string | null) => {
    typedOwn.current = true
    setPicked(id)
    const a = savedHere.find((x) => x.id === id)
    setAddress(a ? a.address : '')
    if (a?.name) setName(a.name)
  }

  // The delivery day is chosen here, at checkout.
  const days = useQuery({ queryKey: ['delivery-days', pincode], queryFn: () => api.checkPincode(pincode!), enabled: Boolean(pincode) })
  const slots = useQuery({
    queryKey: ['slots', pincode, date],
    queryFn: () => api.slots(pincode!, date ?? ''),
    enabled: Boolean(pincode),
  })
  // A saved day that has passed or closed: fall back to the earliest open one, as the shop page does.
  const staleDate = Boolean(date) && slots.error instanceof ApiError && slots.error.code === 'INVALID_DATE'
  useEffect(() => {
    if (staleDate) setWhere(pincode, null)
  }, [staleDate, pincode, setWhere])

  const fetchQuote = async () => {
    await syncCart(cart)
    return api.quote({ pincode: pincode!, deliveryDate: slots.data?.deliveryDate ?? date!, slotId, promoCode: promoCode.trim() || null })
  }
  const dropUnsold = (err: unknown) => {
    // Take a box we no longer sell out of the cart, so the next review goes through.
    if (err instanceof ApiError && err.code === 'PRODUCT_UNAVAILABLE' && typeof err.detail.sku === 'string') {
      for (const l of cart) if (l.sku === err.detail.sku) setQty(l, 0)
    }
  }
  const review = useMutation({
    mutationFn: fetchQuote,
    onSuccess: (q) => {
      idemKey.current = crypto.randomUUID()
      quoteSpent.current = false
      setQuote(q)
    },
    onError: dropUnsold,
  })
  const pay = useMutation({
    mutationFn: async () => {
      let q = quote!
      if (quoteSpent.current) {
        // A fresh attempt: new quote, new key. If the price moved, show it before taking money.
        q = await fetchQuote()
        idemKey.current = crypto.randomUUID()
        quoteSpent.current = false
        setQuote(q)
        if (q.total !== quote!.total) throw new Error(`The total is now ${rupees(q.total)}. Check it and tap Pay again.`)
      }
      const input = {
        quoteId: q.quoteId,
        address: address.trim(),
        name: name.trim() || undefined,
        gift: isGift ? { recipientName: gift.recipientName.trim(), recipientPhone: gift.recipientPhone.trim(), message: gift.message.trim() || null } : null,
      }
      let c: Confirmed
      for (let attempt = 1; ; attempt++) {
        try {
          c = await api.confirm(input, idemKey.current!)
          break
        } catch (err) {
          if (err instanceof ApiError && err.code === 'PAYMENT_STARTING' && attempt < 5) {
            await pause(2000)
            continue
          }
          if (err instanceof ApiError && err.code === 'PAYMENT_GATEWAY_ERROR') quoteSpent.current = true
          throw err
        }
      }
      clearCart()
      // From here the order exists: whatever happens to the payment sheet, go to the order page, which can reopen it.
      let sheetError: string | null = null
      if (c.razorpayKeyId && c.razorpayOrderId) {
        try {
          await openRazorpay({ key: c.razorpayKeyId, rzp: c.razorpayOrderId, total: c.total, number: c.number, holdExpiresAt: c.holdExpiresAt }, signedInPhone())
        } catch (err) {
          sheetError = errorMessage(err)
        }
      }
      return { c, sheetError }
    },
    onSuccess: ({ c, sheetError }) => navigate(`/orders/${c.orderId}`, { replace: true, state: sheetError ? { payError: sheetError } : null }),
    onError: dropUnsold,
  })

  if (!pincode) return <Navigate to="/" replace />
  if (!cart.length && !pay.isPending && !pay.isSuccess) return <Navigate to="/cart" replace />

  function submit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (address.trim().length < 10) return setFormError('Enter the full delivery address, with house number and landmark.')
    if (slots.data?.slots.length && !slotId) return setFormError('Choose a delivery time.')
    if (isGift && !gift.recipientName.trim()) return setFormError("Enter the name of the person you're sending it to.")
    if (isGift && !/^(\+?91|0)?[6-9]\d{9}$/.test(gift.recipientPhone.replace(/[\s-]/g, ''))) {
      return setFormError("Enter their 10-digit mobile number, so the rider can reach them.")
    }
    try {
      localStorage.setItem('mm.address', JSON.stringify({ name: name.trim(), address: address.trim() }))
    } catch {
      // ignore
    }
    review.mutate()
  }

  if (quote) {
    // The cart shows the price seen when the box was added; the quote is today's.
    const wasPrice = (l: Quote['lines'][number]) => {
      const seen = cart.find((c) => c.sku === l.sku && c.stage === l.stage)?.price
      return seen != null && seen !== l.unitPrice ? seen : null
    }
    const changed = quote.lines.filter((l) => wasPrice(l) != null)
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
              {(isGift ? gift.recipientName : name) && (
                <>
                  {isGift ? `${gift.recipientName.trim()} (a gift)` : name}
                  <br />
                </>
              )}
              {address}, {quote.pincode}
            </dd>
          </div>
          {isGift && gift.message.trim() && (
            <div>
              <dt>Note</dt>
              <dd>{gift.message.trim()}</dd>
            </div>
          )}
        </dl>
        {changed.length > 0 && (
          <p className="note small" role="status">
            {changed.length === 1 ? 'A price has' : 'Some prices have'} changed since you added {changed.length === 1 ? 'it' : 'them'} to your cart. The total below is what you pay.
          </p>
        )}
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
                {wasPrice(l) != null && (
                  <span className="small price-changed">
                    Now {rupees(l.unitPrice)} each (was {rupees(wasPrice(l)!)})
                  </span>
                )}
              </div>
              <strong className="line-price">{rupees(l.linePrice)}</strong>
            </li>
          ))}
        </ul>
        {quote.promo && (
          <>
            <div className="sum-row">
              <span>Boxes</span>
              <span>{rupees(quote.subtotal)}</span>
            </div>
            <div className="sum-row discount">
              <span>
                Promo {quote.promo.code}
                {quote.promo.description && <span className="muted small"> · {quote.promo.description}</span>}
              </span>
              <span>−{rupees(quote.discount)}</span>
            </div>
          </>
        )}
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
            <fieldset className="field">
              <legend>When should it arrive?</legend>
              <div className="chips" role="radiogroup" aria-label="When should it arrive?">
                {(days.data?.deliveryDates ?? [slots.data.deliveryDate]).map((d) => (
                  <button
                    key={d}
                    type="button"
                    role="radio"
                    aria-checked={d === slots.data.deliveryDate}
                    className="chip"
                    onClick={() => {
                      if (d === slots.data.deliveryDate) return
                      setSlotId(null)
                      setWhere(pincode, d)
                    }}
                  >
                    {day(d)}
                  </button>
                ))}
              </div>
              {days.data?.cutoffTime && <p className="muted small">Orders for the next day close at {days.data.cutoffTime.replace(' IST', '')} (India time).</p>}
            </fieldset>
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
        <label className="option gift-toggle">
          <input
            type="checkbox"
            checked={isGift}
            onChange={(e) => {
              setIsGift(e.target.checked)
              // A gift goes to their address, not one of ours.
              if (e.target.checked && picked !== null) {
                typedOwn.current = true
                setPicked(null)
                setAddress('')
              }
            }}
          />
          <span>This is a gift for someone else</span>
        </label>
        {isGift && (
          <fieldset className="field gift-fields">
            <legend>Who is it for?</legend>
            <div className="field">
              <label htmlFor="gift-name">Their name</label>
              <input id="gift-name" maxLength={80} value={gift.recipientName} onChange={(e) => setGift({ ...gift, recipientName: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="gift-phone">Their mobile number</label>
              <div className="prefixed">
                <span aria-hidden="true">+91</span>
                <input
                  id="gift-phone"
                  type="tel"
                  inputMode="numeric"
                  maxLength={14}
                  value={gift.recipientPhone}
                  onChange={(e) => setGift({ ...gift, recipientPhone: e.target.value })}
                  aria-describedby="gift-phone-hint"
                />
              </div>
              <p id="gift-phone-hint" className="muted small">
                The rider calls them. Your order updates and the delivery code still come to you, so pass the code on.
              </p>
            </div>
            <div className="field">
              <label htmlFor="gift-note">A note in the box (optional)</label>
              <textarea id="gift-note" rows={2} maxLength={200} value={gift.message} onChange={(e) => setGift({ ...gift, message: e.target.value })} />
            </div>
          </fieldset>
        )}
        <div className="field">
          <label htmlFor="name">Your name</label>
          <input id="name" autoComplete="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {!isGift && savedHere.length > 0 && (
          <fieldset className="field">
            <legend>Deliver to</legend>
            <div className="options">
              {savedHere.map((a) => (
                <label key={a.id} className="option">
                  <input type="radio" name="saved-address" checked={picked === a.id} onChange={() => choose(a.id)} />
                  <span className="option-text">
                    {a.name && <strong>{a.name}</strong>}
                    <span>{a.address}</span>
                  </span>
                </label>
              ))}
              <label className="option">
                <input type="radio" name="saved-address" checked={picked === null} onChange={() => choose(null)} />
                <span>A new address</span>
              </label>
            </div>
          </fieldset>
        )}
        <div className="field" hidden={!isGift && picked !== null}>
          <label htmlFor="address">Delivery address</label>
          <textarea
            id="address"
            autoComplete="street-address"
            rows={3}
            maxLength={500}
            value={address}
            onChange={(e) => {
              typedOwn.current = true
              setAddress(e.target.value)
            }}
            aria-describedby="address-hint"
          />
          <p id="address-hint" className="muted small">
            {isGift ? 'Their address: house' : 'House'} or flat number, street, area and a landmark. Pincode {pincode}.
          </p>
        </div>
        <div className="field">
          <label htmlFor="promo">Promo code (optional)</label>
          <input
            id="promo"
            autoComplete="off"
            autoCapitalize="characters"
            maxLength={20}
            value={promoCode}
            onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
          />
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
  if (err.code.startsWith('PROMO_')) return `${err.message}. Change or clear the promo code to go on.`
  if (err.code === 'PAYMENT_GATEWAY_ERROR') return "We couldn't start the payment, and nothing was charged. Tap Pay to try again."
  if (err.code === 'PAYMENT_STARTING') return 'Your payment is still being set up. Tap Pay again in a moment.'
  if (err.code === 'PRODUCT_UNAVAILABLE') return `${err.message}, so we took it out of your cart. Review the order again.`
  if (err.code === 'QUOTE_EXPIRED') return 'This took a little long and the price hold ended. Tap Change details and review again.'
  return err.message
}
