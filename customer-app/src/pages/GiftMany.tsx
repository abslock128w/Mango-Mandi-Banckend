// "Send to many" (MULTI_GIFT): one gift order to many recipients, paid once.
// The buyer adds recipients one by one or from a CSV (read here, checked again
// by the API), picks one delivery day for everyone, reviews every recipient and
// the total, and pays. Each recipient becomes its own delivery; the gift order's
// page follows them (pages/GiftOrder.tsx).
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ApiError, api, errorMessage, signedInPhone, type GiftConfirmed, type GiftQuote, type GiftRecipientInput, type RecipientProblem, type Stage } from '../api'
import { STAGE_LABEL, day, rupees, slotText } from '../format'
import { openRazorpay } from '../payment'
import { useStore } from '../store'
import { DayChips, Field, SlotPicker } from '../forms'
import { DocTitle, ErrorNote, Spinner } from '../ui'
import { AddPhoneCard } from '../auth-ui'
import { UnpaidOrderBanner } from '../unpaid'
import { gstinProblem, tidyGstin } from '../gstin'
import { useFeatures } from '../features'
import { policyQuery, productsQuery } from '../queries'
import { recipientProblems, recipientsFromCsv } from '../gift-csv'
import { useT } from '../i18n'

const STAGES: Stage[] = ['RIPE', 'SEMI_RIPE', 'RAW']
const blank = (pincode: string | null, sku: string): GiftRecipientInput => ({ name: '', phone: '', address: '', pincode: pincode ?? '', sku, stage: 'RIPE', qty: 1, note: '' })
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

export default function GiftMany() {
  const { profile } = useStore()
  const features = useFeatures()
  const policy = useQuery(policyQuery())
  const t = useT()
  if (profile && !profile.phone) return <AddPhoneCard />
  if (policy.isPending) return <Spinner label={t('common.loading')} />
  if (!features.multiGift) return <Navigate to="/checkout" replace />
  return <GiftManyForm max={policy.data?.multiGiftMaxRecipients ?? 25} bills={policy.data?.bills === true} />
}

/** Problems by recipient (index from 0) and field. */
type Problems = Record<number, Record<string, string>>
const byRow = (list: RecipientProblem[]): Problems => {
  const out: Problems = {}
  for (const p of list) if (p.row > 0) (out[p.row - 1] ??= {})[p.field] = p.message
  return out
}

function GiftManyForm({ max, bills }: { max: number; bills: boolean }) {
  const { pincode: shopPincode, date, setWhere } = useStore()
  const t = useT()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const products = useQuery(productsQuery())
  const boxes = products.data?.items ?? []
  const firstSku = boxes[0]?.sku ?? ''
  const [recipients, setRecipients] = useState<GiftRecipientInput[]>(() => [blank(shopPincode, '')])
  const [problems, setProblems] = useState<Problems>({})
  const [fileNote, setFileNote] = useState<{ ok: string | null; problems: RecipientProblem[] }>({ ok: null, problems: [] })
  const [slotId, setSlotId] = useState<string | null>(null)
  const [promoCode, setPromoCode] = useState('')
  const [name, setName] = useState('')
  const [isBusiness, setIsBusiness] = useState(false)
  const [business, setBusiness] = useState({ name: '', gstin: '' })
  const [businessProblem, setBusinessProblem] = useState<string | null>(null)
  const [quote, setQuote] = useState<GiftQuote | null>(null)
  const idemKey = useRef<string | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)

  // A box picked for recipients added before the box list arrived.
  useEffect(() => {
    if (firstSku) setRecipients((rs) => rs.map((r) => (r.sku ? r : { ...r, sku: firstSku })))
  }, [firstSku])

  // One day for everyone: the open days and times come from the first recipient's pincode (or the shop's).
  const dayPin = recipients.find((r) => /^\d{6}$/.test(r.pincode.trim()))?.pincode.trim() ?? shopPincode
  const days = useQuery({ queryKey: ['delivery-days', dayPin], queryFn: () => api.checkPincode(dayPin!), enabled: Boolean(dayPin) })
  const chosen = date && days.data?.deliveryDates.includes(date) ? date : (days.data?.deliveryDates[0] ?? null)
  const slots = useQuery({ queryKey: ['slots', dayPin, chosen], queryFn: () => api.slots(dayPin!, chosen ?? ''), enabled: Boolean(dayPin && chosen) })

  const set = (i: number, patch: Partial<GiftRecipientInput>) => {
    setRecipients((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
    if (problems[i]) {
      const left = { ...problems[i] }
      for (const k of Object.keys(patch)) delete left[k]
      setProblems({ ...problems, [i]: left })
    }
  }
  const add = () => {
    if (recipients.length >= max) return
    setRecipients((rs) => [...rs, blank(rs[rs.length - 1]?.pincode || shopPincode, firstSku)])
    requestAnimationFrame(() => document.getElementById(`r${recipients.length}-name`)?.focus())
  }
  const remove = (i: number) => {
    setRecipients((rs) => (rs.length === 1 ? [blank(shopPincode, firstSku)] : rs.filter((_, j) => j !== i)))
    setProblems({})
  }

  const downloadTemplate = useMutation({
    mutationFn: async () => {
      const url = await api.giftTemplateUrl()
      const a = document.createElement('a')
      a.href = url
      a.download = 'mandimangoes-gift-recipients.csv'
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    },
  })
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 200_000) {
      setFileNote({ ok: null, problems: [{ row: 0, field: 'file', message: t('gift.fileTooBig') }] })
      return
    }
    const read = recipientsFromCsv(await file.text(), boxes, max)
    if (read.recipients.length) {
      setRecipients(read.recipients.map((r) => ({ ...r, note: r.note ?? '' })))
      setProblems(byRow(read.problems))
    }
    setFileNote({ ok: read.recipients.length ? t('gift.loaded', { count: read.recipients.length, file: file.name }) : null, problems: read.problems })
  }

  const review = useMutation({
    mutationFn: () =>
      api.giftQuote({
        recipients: recipients.map((r) => ({ ...r, name: r.name.trim(), address: r.address.trim(), pincode: r.pincode.trim(), note: r.note?.trim() || null })),
        deliveryDate: chosen, slotId, promoCode: promoCode.trim() || null,
      }),
    onSuccess: (q) => {
      idemKey.current = crypto.randomUUID()
      setQuote(q)
      navigate({ search: '?step=review' }, { state: { fromForm: true } })
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'RECIPIENTS_INVALID' && Array.isArray(err.detail.rows)) {
        const found = byRow(err.detail.rows as RecipientProblem[])
        setProblems(found)
        const first = Number(Object.keys(found)[0])
        requestAnimationFrame(() => document.getElementById(`r${first}-${Object.keys(found[first])[0]}`)?.focus())
      }
    },
  })
  const reviewing = Boolean(quote) && params.get('step') === 'review'
  useEffect(() => {
    if (params.get('step') === 'review' && !quote) navigate({ search: '' }, { replace: true })
  }, [params, quote, navigate])
  useEffect(() => {
    window.scrollTo(0, 0)
    heading.current?.focus()
    if (!reviewing) setQuote(null)
  }, [reviewing])

  const pay = useMutation({
    mutationFn: async () => {
      const input = { quoteId: quote!.quoteId, name: name.trim() || undefined, ...(bills && isBusiness ? { business: { name: business.name.trim(), gstin: tidyGstin(business.gstin) } } : {}) }
      let c: GiftConfirmed
      for (let attempt = 1; ; attempt++) {
        try {
          c = await api.giftConfirm(input, idemKey.current!)
          break
        } catch (err) {
          if (err instanceof ApiError && err.code === 'PAYMENT_STARTING' && attempt < 5) {
            await pause(2000)
            continue
          }
          throw err
        }
      }
      let sheetError: string | null = null
      if (c.razorpayKeyId && c.razorpayOrderId) {
        try {
          await openRazorpay(
            { orderId: c.giftOrderId, key: c.razorpayKeyId, rzp: c.razorpayOrderId, total: c.total, number: c.number, holdExpiresAt: c.holdExpiresAt },
            signedInPhone(),
            api.verifyGiftPayment,
          )
        } catch (err) {
          sheetError = errorMessage(err)
        }
      }
      return { c, sheetError }
    },
    onSuccess: ({ c, sheetError }) => navigate(`/gifts/${c.giftOrderId}`, { replace: true, state: { placed: true, ...(sheetError && { payError: sheetError }) } }),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    const found: Problems = {}
    recipients.forEach((r, i) => {
      for (const p of recipientProblems(r)) (found[i] ??= {})[p.field] = p.message
      if (!r.sku) (found[i] ??= {}).sku = t('gift.chooseBox')
    })
    setProblems(found)
    const bad = bills && isBusiness ? (business.name.trim().length < 2 ? t('checkout.businessName') : gstinProblem(business.gstin)) : null
    setBusinessProblem(bad)
    const first = Object.keys(found).map(Number).sort((a, b) => a - b)[0]
    if (first !== undefined) {
      requestAnimationFrame(() => document.getElementById(`r${first}-${Object.keys(found[first])[0]}`)?.focus())
      return
    }
    if (bad) {
      requestAnimationFrame(() => document.getElementById(business.name.trim().length < 2 ? 'business-name' : 'gstin')?.focus())
      return
    }
    if (slots.data?.slots.length && !slotId) return
    review.mutate()
  }

  if (quote && reviewing) {
    const unsellable = pay.error instanceof ApiError && ['PRICE_CHANGED', 'PRODUCT_UNAVAILABLE', 'QUOTE_EXPIRED', 'PAYMENT_GATEWAY_ERROR'].includes(pay.error.code)
    return (
      <section className="card checkout-review gift-review">
        <DocTitle title={t('gift.reviewDocTitle')} />
        <h1 ref={heading} tabIndex={-1}>
          {t('checkout.reviewTitle')}
        </h1>
        <UnpaidOrderBanner />
        <dl className="facts">
          <div>
            <dt>{t('checkout.arrives')}</dt>
            <dd>
              {day(quote.deliveryDate)}
              {quote.slot && `, ${slotText(quote.slot)}`}
            </dd>
          </div>
          <div>
            <dt>{t('gift.recipients')}</dt>
            <dd>
              {t('gift.recipientsBoxes', { recipients: quote.recipients.length, count: quote.boxes })}
            </dd>
          </div>
          {bills && isBusiness && (
            <div>
              <dt>{t('checkout.billTo')}</dt>
              <dd>
                {business.name.trim()}
                <br />
                {t('checkout.gstinValue', { gstin: tidyGstin(business.gstin) })}
              </dd>
            </div>
          )}
        </dl>
        <ol className="gift-review-list">
          {quote.recipients.map((r, i) => (
            <li key={i} className="line">
              <div>
                <strong>{r.name}</strong>
                <span className="muted small">
                  {r.address}, {r.pincode}
                </span>
                <span className="small">
                  {t('gift.reviewLine', { qty: r.qty, box: r.boxName, stage: STAGE_LABEL[r.stage], day: day(r.eatBy) })}
                </span>
                {r.note && <span className="muted small">{t('gift.note', { note: r.note })}</span>}
              </div>
              <strong className="line-price">{rupees(r.linePrice)}</strong>
            </li>
          ))}
        </ol>
        {quote.promo && (
          <>
            <div className="sum-row">
              <span>{t('checkout.boxes')}</span>
              <span>{rupees(quote.subtotal)}</span>
            </div>
            <div className="sum-row discount">
              <span>{t('checkout.promo', { code: quote.promo.code })}</span>
              <span>−{rupees(quote.discount)}</span>
            </div>
          </>
        )}
        <div className="sum-row">
          <span>{t('gift.delivery')}</span>
          <span>{t('checkout.free')}</span>
        </div>
        <div className="total-row">
          <span>{t('gift.totalOnePayment')}</span>
          <strong>{rupees(quote.total)}</strong>
        </div>
        <p className="muted small">{t('gift.holdNote', { minutes: quote.holdMinutes })}</p>
        <ErrorNote error={pay.error ? (unsellable ? t('gift.unsellable', { reason: errorMessage(pay.error) }) : pay.error) : null} />
        {pay.error instanceof ApiError && pay.error.code === 'UNPAID_ORDER_EXISTS' && (
          <Link to={typeof pay.error.detail.giftOrderId === 'string' ? `/gifts/${pay.error.detail.giftOrderId}` : `/orders/${String(pay.error.detail.orderId)}`} className="btn btn-block">
            {t('checkout.openUnpaid')}
          </Link>
        )}
        <button type="button" className="btn btn-primary btn-block" disabled={pay.isPending || unsellable} onClick={() => pay.mutate()}>
          {pay.isPending ? t('checkout.openingPayment') : t('checkout.pay', { total: rupees(quote.total) })}
        </button>
        <p className="small center pay-trust">{t('checkout.secure')}</p>
        <button
          type="button"
          className="btn btn-block btn-quiet"
          disabled={pay.isPending}
          onClick={() => ((location.state as { fromForm?: boolean } | null)?.fromForm ? navigate(-1) : navigate({ search: '' }, { replace: true }))}
        >
          {t('checkout.changeDetails')}
        </button>
      </section>
    )
  }

  const reviewError = review.error && !(review.error instanceof ApiError && review.error.code === 'RECIPIENTS_INVALID') ? review.error : null
  return (
    <section className="card gift-many">
      <DocTitle title={t('title.giftMany')} />
      <h1 ref={heading} tabIndex={-1}>
        {t('title.giftMany')}
      </h1>
      <p className="muted">
        {t.rich('gift.lead', { max, link: <Link to="/checkout">{t('gift.sendingOne')}</Link> })}
      </p>
      <UnpaidOrderBanner />
      <div className="gift-csv card-inset">
        <h2>{t('gift.haveList')}</h2>
        <p className="small muted">
          {t('gift.csvHow', { codes: boxes.map((b) => t('gift.boxCode', { sku: b.sku, name: b.name })).join(', ') })}
        </p>
        <div className="row">
          <button type="button" className="btn" disabled={downloadTemplate.isPending} onClick={() => downloadTemplate.mutate()}>
            {t('gift.downloadTemplate')}
          </button>
          <label className="btn file-btn">
            {t('gift.uploadCsv')}
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={onFile} aria-label={t('gift.uploadCsvLabel')} />
          </label>
        </div>
        <ErrorNote error={downloadTemplate.error} />
        {fileNote.ok && (
          <p className="small" role="status">
            {fileNote.ok}
          </p>
        )}
        {fileNote.problems.length > 0 && (
          <div className="field-error" role="alert">
            <p>{t('gift.fixRows')}</p>
            <ul className="csv-problems">
              {fileNote.problems.slice(0, 20).map((p, i) => (
                <li key={i}>{p.row ? t('gift.row', { row: p.row, message: p.message }) : p.message}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <form onSubmit={submit} noValidate>
        <ol className="gift-recipients">
          {recipients.map((r, i) => {
            const err = problems[i] ?? {}
            const fid = (f: string) => `r${i}-${f}`
            return (
              <li key={i} className="card-inset gift-recipient">
                <div className="title-row">
                  <h2>{t('gift.recipientN', { n: i + 1 })}</h2>
                  <button type="button" className="link-btn" onClick={() => remove(i)} aria-label={t('gift.removeRecipient', { n: i + 1 })}>
                    {t('common.remove')}
                  </button>
                </div>
                <Field id={fid('name')} label={t('gift.theirName')} error={err.name}>
                  <input maxLength={80} value={r.name} onChange={(e) => set(i, { name: e.target.value })} />
                </Field>
                <Field id={fid('phone')} label={t('gift.theirMobile')} hint={t('gift.theirMobileHint')} error={err.phone}>
                  {(control) => (
                    <div className="prefixed">
                      <span aria-hidden="true">+91</span>
                      <input {...control} type="tel" inputMode="numeric" maxLength={14} value={r.phone} onChange={(e) => set(i, { phone: e.target.value })} />
                    </div>
                  )}
                </Field>
                <Field id={fid('address')} label={t('gift.theirAddress')} hint={t('gift.addressHint')} error={err.address}>
                  <textarea rows={2} maxLength={500} value={r.address} onChange={(e) => set(i, { address: e.target.value })} />
                </Field>
                <div className="gift-pair">
                  <Field id={fid('pincode')} label={t('gift.pincode')} error={err.pincode}>
                    <input inputMode="numeric" maxLength={6} value={r.pincode} onChange={(e) => set(i, { pincode: e.target.value.replace(/\D/g, '') })} />
                  </Field>
                  <Field id={fid('qty')} label={t('gift.boxes')} error={err.qty}>
                    <input type="number" inputMode="numeric" min={1} max={20} value={r.qty || ''} onChange={(e) => set(i, { qty: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
                  </Field>
                </div>
                <div className="gift-pair">
                  <Field id={fid('sku')} label={t('gift.box')} error={err.sku}>
                    <select value={r.sku} onChange={(e) => set(i, { sku: e.target.value })}>
                      {!r.sku && <option value="">{t('gift.chooseBox')}</option>}
                      {boxes.map((b) => (
                        <option key={b.sku} value={b.sku}>
                          {t('gift.boxOption', { name: b.name, price: rupees(b.price) })}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field id={fid('stage')} label={t('gift.ripeness')} error={err.stage}>
                    <select value={r.stage} onChange={(e) => set(i, { stage: e.target.value as Stage })}>
                      {STAGES.map((s) => (
                        <option key={s} value={s}>
                          {STAGE_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field id={fid('note')} label={t('checkout.giftNote')} error={err.note}>
                  <textarea rows={2} maxLength={200} value={r.note ?? ''} onChange={(e) => set(i, { note: e.target.value })} />
                </Field>
              </li>
            )
          })}
        </ol>
        <button type="button" className="btn btn-block" onClick={add} disabled={recipients.length >= max}>
          {recipients.length >= max ? t('gift.mostForOne', { max }) : t('gift.addAnother')}
        </button>

        {!dayPin ? (
          <p className="muted small">{t('gift.enterPincode')}</p>
        ) : days.isPending || (chosen && slots.isPending) ? (
          <Spinner label={t('gift.loadingDays')} />
        ) : days.isError ? (
          <ErrorNote error={days.error} onRetry={() => days.refetch()} />
        ) : !days.data.serviceable ? (
          <p className="field-error">{t('gift.notServed', { pincode: dayPin })}</p>
        ) : (
          <>
            <fieldset className="field">
              <legend>{t('gift.whenEveryone')}</legend>
              <DayChips
                label={t('gift.whenEveryone')}
                days={days.data.deliveryDates}
                value={chosen}
                format={day}
                onChange={(d) => {
                  setSlotId(null)
                  setWhere(shopPincode, d)
                }}
              />
            </fieldset>
            {slots.data && <SlotPicker name="slot" slots={slots.data.slots} value={slotId} onChange={setSlotId} error={slots.data.slots.length && !slotId && review.isError ? t('checkout.chooseTime') : null} />}
          </>
        )}

        <Field id="name" label={t('gift.senderName')}>
          <input autoComplete="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {bills && (
          <>
            <label className="option gift-toggle">
              <input type="checkbox" checked={isBusiness} onChange={(e) => setIsBusiness(e.target.checked)} />
              <span>{t('gift.forBusiness')}</span>
            </label>
            {isBusiness && (
              <fieldset className="field gift-fields">
                <legend>{t('checkout.businessLegend')}</legend>
                <Field id="business-name" label={t('checkout.businessNameLabel')} hint={t('checkout.businessNameHint')} error={businessProblem && business.name.trim().length < 2 ? businessProblem : null}>
                  <input autoComplete="organization" maxLength={100} value={business.name} onChange={(e) => setBusiness({ ...business, name: e.target.value })} />
                </Field>
                <Field id="gstin" label={t('checkout.gstinLabel')} hint={t('checkout.gstinHint')} error={businessProblem && business.name.trim().length >= 2 ? businessProblem : null}>
                  <input autoCapitalize="characters" spellCheck={false} maxLength={20} value={business.gstin} onChange={(e) => setBusiness({ ...business, gstin: e.target.value.toUpperCase() })} />
                </Field>
              </fieldset>
            )}
          </>
        )}
        <Field id="promo" label={t('checkout.promoLabel')}>
          <input autoComplete="off" autoCapitalize="characters" maxLength={20} value={promoCode} onChange={(e) => setPromoCode(e.target.value.toUpperCase())} />
        </Field>
        {Object.keys(problems).length > 0 && (
          <p className="field-error" role="alert">
            {t('gift.needFixing', { list: Object.keys(problems).map((k) => t('gift.recipientLower', { n: Number(k) + 1 })).join(', ') })}
          </p>
        )}
        <ErrorNote error={reviewError} />
        <button type="submit" className="btn btn-primary btn-block" disabled={review.isPending || products.isPending}>
          {review.isPending ? t('gift.checkingStock') : t('gift.reviewN', { count: recipients.length })}
        </button>
      </form>
    </section>
  )
}
