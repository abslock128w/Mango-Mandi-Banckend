// /partner/apply: the Partner With Us enquiry form (docs/partner-network.md). Drawn from the
// questionnaire the API serves, one step at a time: Next checks only the step on screen, Back
// keeps every answer, and a draft in sessionStorage survives a reload. Files are uploaded after
// the enquiry is saved, each on its own, so a failed upload never hides that it was received.
import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent, type MouseEvent, type ReactNode, type RefObject } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, type QueryObserverResult } from '@tanstack/react-query'
import { ApiError, api, errorMessage } from '../api'
import { useTurnstile } from '../auth-ui'
import { Field } from '../forms'
import { useT, type Key, type T } from '../i18n'
import {
  applicableSteps,
  buildAnswers,
  fileProblem,
  initialAnswers,
  keepMatchingAnswers,
  megabytes,
  optionsFor,
  questionMap,
  setAnswer,
  shownQuestions,
  stepOfKey,
  validateStep,
  type Answers,
  type PartnerNetwork,
  type PartnerQuestion,
  type PartnerSubmitted,
  type Problem,
} from '../partner-form'
import { partnerNetworkQuery } from '../queries'
import { DocTitle, ErrorNote, Spinner } from '../ui'
import { PartnerClosed, isSwitchedOff } from './Partner'

const DRAFT_KEY = 'mm.partner.draft'

interface Draft {
  version: string
  answers: Answers
  step: number
  /** One Idempotency-Key per form fill, so a retry after a lost answer never sends it twice. */
  key: string
  /** Files cannot be kept; the form says so when the draft had some. */
  hadFiles?: boolean
}

function readDraft(): Draft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as Draft
    return d && typeof d === 'object' && d.answers && typeof d.key === 'string' ? d : null
  } catch {
    return null
  }
}
function saveDraft(d: Draft) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d))
  } catch {
    // Storage blocked or full: the answers stay on the page for as long as it is open.
  }
}
function clearDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY)
  } catch {
    // Nothing to clear.
  }
}

const newKey = () => (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `pn-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`)

/** A problem from the form's own checks, in words. */
function problemText(t: T, p: Problem): string {
  if (p.code === 'pattern' && p.message) return p.message
  return t(`partner.err.${p.code}` as Key, p.vars)
}

export default function PartnerApply() {
  const q = useQuery(partnerNetworkQuery())
  const t = useT()
  const [result, setResult] = useState<{ submitted: PartnerSubmitted; files: PickedFile[] } | null>(null)
  if (result) return <Received submitted={result.submitted} files={result.files} />
  if (q.isPending) return <Spinner label={t('common.loading')} />
  if (q.isError) return isSwitchedOff(q.error) ? <PartnerClosed /> : <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
  return <ApplyForm network={q.data} refetch={q.refetch} onDone={(submitted, files) => setResult({ submitted, files })} />
}

interface PickedFile {
  id: string
  file: File
  category: string
}

type Notice =
  | { kind: 'fix' }
  | { kind: 'changed' }
  | { kind: 'rate' }
  | { kind: 'failed'; reason: string }
  | { kind: 'duplicate'; reference: string }
  | { kind: 'captcha' }

function ApplyForm({
  network,
  refetch,
  onDone,
}: {
  network: PartnerNetwork
  refetch: () => Promise<QueryObserverResult<PartnerNetwork, Error>>
  onDone: (submitted: PartnerSubmitted, files: PickedFile[]) => void
}) {
  const t = useT()
  const [params] = useSearchParams()
  // The answers start from the draft (a reload), else the defaults; a category picked on the landing page is ticked.
  const [start] = useState(() => {
    const category = params.get('category')
    const draft = readDraft()
    if (!draft) return { answers: initialAnswers(network, category), step: 0, key: newKey(), version: network.version, hadFiles: false }
    let answers = draft.version === network.version ? draft.answers : keepMatchingAnswers(network.steps, network.categories, draft.answers)
    const chosen = Array.isArray(answers.categories) ? (answers.categories as string[]) : []
    if (category && network.categories.some((c) => c.code === category) && !chosen.includes(category)) answers = setAnswer(answers, 'categories', [...chosen, category])
    return { answers, step: draft.version === network.version ? draft.step : 0, key: draft.key, version: network.version, hadFiles: Boolean(draft.hadFiles) }
  })
  const [answers, setAnswers] = useState<Answers>(start.answers)
  const [stepAt, setStepAt] = useState(start.step)
  const [version, setVersion] = useState(start.version)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [files, setFiles] = useState<PickedFile[]>([])
  const [fileErrors, setFileErrors] = useState<string[]>([])
  const [notice, setNotice] = useState<Notice | null>(null)
  const [sending, setSending] = useState(false)
  const [captcha, setCaptcha] = useState<{ token: string | null; round: number }>({ token: null, round: 0 })
  const idemKey = useRef(start.key)
  const all = questionMap(network.steps)

  const steps = applicableSteps(network.steps, answers)
  const at = Math.min(stepAt, steps.length - 1)
  const step = steps[at]
  const last = at === steps.length - 1

  const heading = useRef<HTMLHeadingElement>(null)
  const summary = useRef<HTMLDivElement>(null)
  const noticeRef = useRef<HTMLDivElement>(null)
  // What gets focus once React has drawn the change: the new step's heading, the error summary or a notice.
  const focusNext = useRef<'heading' | 'summary' | 'notice' | null>(null)
  useEffect(() => {
    const want = focusNext.current
    if (!want) return
    const el = want === 'heading' ? heading.current : want === 'summary' ? summary.current : noticeRef.current
    if (!el) return
    focusNext.current = null
    el.focus()
    if (want === 'heading') el.scrollIntoView({ block: 'start' })
  })

  // Every change is kept in the draft, so a reload or a slip of the Back button loses nothing.
  useEffect(() => {
    saveDraft({ version, answers, step: at, key: idemKey.current, hadFiles: files.length > 0 })
  }, [version, answers, at, files.length])

  const change = (key: string, value: unknown) => {
    setAnswers((a) => setAnswer(a, key, value))
    setErrors((e) => {
      if (!(key in e)) return e
      const next = { ...e }
      delete next[key]
      return next
    })
  }

  const checkStep = (i: number) => {
    const found = validateStep(steps[i], answers, all)
    return Object.fromEntries(Object.entries(found).map(([k, p]) => [k, problemText(t, p)]))
  }

  const showErrors = (found: Record<string, string>) => {
    setErrors(found)
    // Once the summary is drawn, focus goes to it so the problems are read out first.
    focusNext.current = 'summary'
  }

  const goTo = (i: number) => {
    focusNext.current = 'heading'
    setNotice(null)
    setStepAt(i)
  }

  const next = () => {
    const found = checkStep(at)
    if (Object.keys(found).length) return showErrors(found)
    setErrors({})
    goTo(at + 1)
  }

  const back = () => {
    setErrors({})
    goTo(at - 1)
  }

  const showNotice = (n: Notice) => {
    setNotice(n)
    focusNext.current = 'notice'
  }

  async function submit() {
    // Every step again (an answer may have been changed by going back), stopping on the first with a problem.
    for (let i = 0; i < steps.length; i++) {
      const found = checkStep(i)
      if (Object.keys(found).length) {
        if (i !== at) goTo(i)
        showErrors(found)
        return
      }
    }
    if (network.captcha.siteKeyRequired && !captcha.token) return showNotice({ kind: 'captcha' })
    setSending(true)
    setNotice(null)
    try {
      const submitted = await api.submitPartnerEnquiry(
        { questionnaireVersion: version, answers: buildAnswers(network.steps, answers), ...(captcha.token ? { captchaToken: captcha.token } : {}) },
        idemKey.current,
      )
      clearDraft()
      onDone(submitted, files)
      return
    } catch (err) {
      // A token works once: the check runs again for the next try.
      setCaptcha((c) => ({ token: null, round: c.round + 1 }))
      if (err instanceof ApiError && err.status === 400 && err.code === 'VALIDATION_ERROR' && err.detail.fields && typeof err.detail.fields === 'object') {
        // The API names each problem by question. A fixed answer is a new submission, so a new key.
        idemKey.current = newKey()
        const fields = err.detail.fields as Record<string, string>
        const placed = Object.keys(fields)
          .map((k) => stepOfKey(steps, k))
          .filter((i) => i >= 0)
        if (!placed.length) return showNotice({ kind: 'failed', reason: Object.values(fields)[0] ?? err.message })
        const first = Math.min(...placed)
        if (first !== at) goTo(first)
        setNotice({ kind: 'fix' })
        // Every message is kept: the summary shows the step's own, and each other step's show when it is reached.
        setErrors(fields)
        focusNext.current = 'summary'
        return
      }
      if (err instanceof ApiError && err.status === 409 && err.code === 'DUPLICATE_ENQUIRY') {
        return showNotice({ kind: 'duplicate', reference: String(err.detail.reference ?? '') })
      }
      if (err instanceof ApiError && err.status === 409 && err.code === 'QUESTIONNAIRE_CHANGED') {
        idemKey.current = newKey()
        const fresh = await refetch()
        if (fresh.data) {
          setAnswers(keepMatchingAnswers(fresh.data.steps, fresh.data.categories, answers))
          setVersion(fresh.data.version)
        }
        setErrors({})
        return showNotice({ kind: 'changed' })
      }
      if (err instanceof ApiError && err.status === 429) return showNotice({ kind: 'rate' })
      // Offline, busy or anything else: the answers and the key stay, so trying again is safe.
      showNotice({ kind: 'failed', reason: errorMessage(err) })
    } finally {
      setSending(false)
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (sending) return
    if (last) void submit()
    else next()
  }

  // The errors for the step on screen, in question order, for the summary.
  const shown = shownQuestions(step, answers)
  const stepErrors = shown.filter((qq) => errors[qq.key]).map((qq) => ({ key: qq.key, label: qq.label, message: errors[qq.key] }))

  return (
    <div className="partner-apply">
      <DocTitle title={`${step.title} · ${t('title.partnerApply')}`} />
      <p className="eyebrow">
        <Link to="/partner">{t('nav.partner')}</Link>
      </p>
      <h1>{t('title.partnerApply')}</h1>

      <Progress titles={steps.map((s) => s.title)} at={at} />

      <form className="card partner-form" noValidate onSubmit={onSubmit} aria-labelledby="partner-step-title">
        <p className="muted small partner-step-count">{t('partner.stepOf', { n: at + 1, total: steps.length })}</p>
        <h2 id="partner-step-title" ref={heading} tabIndex={-1}>
          {step.title}
        </h2>
        {step.description && <p className="muted">{step.description}</p>}

        {notice && <NoticeBox notice={notice} boxRef={noticeRef} />}

        {stepErrors.length > 0 && (
          <div className="note note-error partner-summary" role="alert" tabIndex={-1} ref={summary} aria-labelledby="partner-summary-title">
            <div>
              <p id="partner-summary-title" className="partner-summary-title">
                {t('partner.errorSummary', { count: stepErrors.length })}
              </p>
              <ul>
                {stepErrors.map((e) => (
                  <li key={e.key}>
                    <a href={`#q-${e.key}`} onClick={(ev) => focusQuestion(ev, e.key)}>
                      {e.label}
                    </a>
                    : {e.message}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {start.hadFiles && last && files.length === 0 && <p className="note">{t('partner.files.afterRefresh')}</p>}

        {step.sections.map((s) => {
          const qs = s.questions.filter((qq) => shown.includes(qq))
          if (!qs.length) return null
          const many = step.sections.length > 1 || s.title !== step.title
          return (
            <section key={s.key} className="partner-section" aria-labelledby={many ? `sec-${s.key}` : undefined}>
              {many && <h3 id={`sec-${s.key}`}>{s.title}</h3>}
              {qs.map((qq) =>
                qq.type === 'FILE_UPLOAD' ? (
                  <FilePicker
                    key={qq.key}
                    question={qq}
                    network={network}
                    files={files}
                    errors={fileErrors}
                    onChange={(f) => setFiles(f)}
                    onErrors={setFileErrors}
                  />
                ) : (
                  <Question key={qq.key} q={qq} answers={answers} value={answers[qq.key]} error={errors[qq.key]} onChange={change} network={network} />
                ),
              )}
            </section>
          )
        })}

        {last && network.captcha.siteKeyRequired && (
          <Captcha key={captcha.round} siteKey={network.captcha.siteKey} action={network.captcha.action} onToken={(token) => setCaptcha((c) => ({ ...c, token }))} />
        )}

        <div className="partner-actions">
          {at > 0 && (
            <button type="button" className="btn" onClick={back} disabled={sending}>
              <span aria-hidden="true">← </span>
              {t('partner.back')}
            </button>
          )}
          <button type="submit" className="btn btn-primary" disabled={sending}>
            {last ? (sending ? t('partner.submitting') : t('partner.submit')) : t('common.next')}
          </button>
        </div>
      </form>
    </div>
  )
}

/** Moves focus to a question from the error summary without changing the address. */
function focusQuestion(e: MouseEvent, key: string) {
  e.preventDefault()
  const el = document.getElementById(`q-${key}`)
  el?.focus()
  el?.scrollIntoView({ block: 'center' })
}

/** The steps by name, with the one on screen marked. */
function Progress({ titles, at }: { titles: string[]; at: number }) {
  const t = useT()
  return (
    <ol className="partner-progress" aria-label={t('partner.steps')}>
      {titles.map((title, i) => (
        <li key={title} className={i < at ? 'done' : i === at ? 'current' : undefined} aria-current={i === at ? 'step' : undefined}>
          <span className="partner-progress-n" aria-hidden="true">
            {i + 1}
          </span>
          <span className="partner-progress-title">{title}</span>
          {i < at && <span className="sr-only"> ({t('partner.stepDone')})</span>}
        </li>
      ))}
    </ol>
  )
}

function NoticeBox({ notice, boxRef }: { notice: Notice; boxRef: RefObject<HTMLDivElement> }) {
  const t = useT()
  let body: ReactNode
  if (notice.kind === 'duplicate') {
    body = (
      <div>
        <p className="partner-summary-title">{t('partner.duplicateTitle')}</p>
        <p>{t('partner.duplicateBody', { reference: notice.reference })}</p>
      </div>
    )
  } else if (notice.kind === 'fix') body = <span>{t('partner.fixFields')}</span>
  else if (notice.kind === 'changed') body = <span>{t('partner.changed')}</span>
  else if (notice.kind === 'rate') body = <span>{t('partner.rateLimited')}</span>
  else if (notice.kind === 'captcha') body = <span>{t('partner.captchaWait')}</span>
  else body = <span>{t('partner.sendFailed', { reason: notice.reason })}</span>
  const tone = notice.kind === 'duplicate' || notice.kind === 'changed' ? 'note' : 'note note-error'
  return (
    <div className={tone} role="alert" tabIndex={-1} ref={boxRef}>
      {body}
    </div>
  )
}

/** Browser autofill hints for the contact questions. */
const AUTOCOMPLETE: Record<string, string> = {
  fullName: 'name',
  mobile: 'tel',
  email: 'email',
  city: 'address-level2',
  state: 'address-level1',
  pincode: 'postal-code',
  country: 'country-name',
  businessName: 'organization',
  website: 'url',
}

/** A label with "(optional)" when the question may be left. */
function QLabel({ q }: { q: PartnerQuestion }) {
  const t = useT()
  return (
    <>
      {q.label}
      {!q.required && <span className="muted partner-optional"> ({t('partner.optional')})</span>}
    </>
  )
}

function Question({
  q,
  answers,
  value,
  error,
  onChange,
  network,
}: {
  q: PartnerQuestion
  answers: Answers
  value: unknown
  error?: string
  onChange: (key: string, value: unknown) => void
  network: PartnerNetwork
}) {
  const t = useT()
  const id = `q-${q.key}`
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  const set = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => onChange(q.key, e.target.value)

  switch (q.type) {
    case 'TEXTAREA': {
      const counterId = `${id}-count`
      const left = q.max ? q.max - text.trim().length : null
      return (
        <Field id={id} label={<QLabel q={q} />} hint={q.description} error={error} describedBy={q.max ? counterId : undefined}>
          {(control) => (
            <>
              <textarea {...control} rows={q.max && q.max > 600 ? 5 : 3} value={text} placeholder={q.placeholder} onChange={set} />
              {left !== null && (
                <p id={counterId} className={left < 0 ? 'counter warn' : 'counter'}>
                  {left >= 0 ? t('partner.charsLeft', { count: left }) : t('partner.charsOver', { count: -left })}
                </p>
              )}
            </>
          )}
        </Field>
      )
    }
    case 'CURRENCY':
      return (
        <Field id={id} label={<QLabel q={q} />} hint={q.description} error={error}>
          {(control) => (
            <div className="prefixed">
              <span aria-hidden="true">₹</span>
              <input {...control} type="text" inputMode="decimal" autoComplete="off" value={text} placeholder={q.placeholder} onChange={set} />
            </div>
          )}
        </Field>
      )
    case 'SELECT':
      return (
        <Field id={id} label={<QLabel q={q} />} hint={q.description} error={error}>
          <select value={text} onChange={set} autoComplete={AUTOCOMPLETE[q.key]}>
            <option value="">{t('partner.choose')}</option>
            {optionsFor(q, answers).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      )
    case 'RADIO':
    case 'BOOLEAN': {
      const options = q.type === 'BOOLEAN' ? [{ value: true, label: t('partner.yes') }, { value: false, label: t('partner.no') }] : optionsFor(q, answers)
      return (
        <ChoiceGroup q={q} error={error} name={q.key}>
          {options.map((o, i) => (
            <label key={String(o.value)} className="option">
              <input
                id={i === 0 ? id : `${id}-${i}`}
                type="radio"
                name={q.key}
                checked={value === o.value}
                onChange={() => onChange(q.key, o.value)}
              />
              <span>{o.label}</span>
            </label>
          ))}
        </ChoiceGroup>
      )
    }
    case 'MULTI_SELECT': {
      const picked = Array.isArray(value) ? (value as string[]) : []
      const options = q.options ?? []
      const describe = q.key === 'categories' ? network.categories : null
      return (
        <ChoiceGroup q={q} error={error} name={q.key}>
          {options.map((o, i) => {
            const desc = describe?.find((c) => c.code === o.value)?.description
            return (
              <label key={o.value} className="option">
                <input
                  id={i === 0 ? id : `${id}-${i}`}
                  type="checkbox"
                  checked={picked.includes(o.value)}
                  onChange={(e) => onChange(q.key, e.target.checked ? [...picked, o.value] : picked.filter((v) => v !== o.value))}
                />
                <span className="option-text">
                  <span>{o.label}</span>
                  {desc && <span className="muted small">{desc}</span>}
                </span>
              </label>
            )
          })}
        </ChoiceGroup>
      )
    }
    case 'CHECKBOX':
      return <Checkbox q={q} value={value === true} error={error} onChange={(v) => onChange(q.key, v)} network={network} />
    default: {
      const type = q.type === 'EMAIL' ? 'email' : q.type === 'PHONE' ? 'tel' : q.type === 'DATE' ? 'date' : 'text'
      const inputMode = q.type === 'PHONE' || q.type === 'NUMBER' ? 'numeric' : q.type === 'EMAIL' ? 'email' : undefined
      return (
        <Field id={id} label={<QLabel q={q} />} hint={q.description} error={error}>
          <input
            type={type}
            inputMode={inputMode}
            autoComplete={AUTOCOMPLETE[q.key] ?? 'off'}
            value={text}
            placeholder={q.placeholder}
            onChange={set}
          />
        </Field>
      )
    }
  }
}

/** A question answered with radios or checkboxes: one fieldset, its legend, hint and error. */
function ChoiceGroup({ q, error, name, children }: { q: PartnerQuestion; error?: string; name: string; children: ReactNode }) {
  const hintId = q.description ? `q-${name}-hint` : undefined
  const errorId = error ? `q-${name}-error` : undefined
  const ids = [hintId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <fieldset className="field" aria-describedby={ids}>
      <legend>
        <QLabel q={q} />
      </legend>
      {q.description && (
        <p id={hintId} className="muted small partner-hint">
          {q.description}
        </p>
      )}
      <div className="options">{children}</div>
      {error && (
        <p id={errorId} className="field-error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  )
}

/** One tick box (the consent), with the privacy notice for the consent. */
function Checkbox({ q, value, error, onChange, network }: { q: PartnerQuestion; value: boolean; error?: string; onChange: (v: boolean) => void; network: PartnerNetwork }) {
  const t = useT()
  const id = `q-${q.key}`
  const errorId = error ? `${id}-error` : undefined
  const privacyId = q.key === 'consent' ? `${id}-privacy` : undefined
  return (
    <div className="field">
      <label className="option partner-consent" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
          aria-describedby={[privacyId, errorId].filter(Boolean).join(' ') || undefined}
          aria-invalid={error ? true : undefined}
        />
        <span>{q.label}</span>
      </label>
      {privacyId && (
        <p id={privacyId} className="muted small">
          {t.rich('partner.privacy', { privacy: <Link to={network.consent.privacyPath || '/privacy'}>{t('title.privacy')}</Link> })}
        </p>
      )}
      {error && (
        <p id={errorId} className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

/** The supporting documents: picked here, checked for type, size and count, sent after the enquiry is saved. */
function FilePicker({
  question,
  network,
  files,
  errors,
  onChange,
  onErrors,
}: {
  question: PartnerQuestion
  network: PartnerNetwork
  files: PickedFile[]
  errors: string[]
  onChange: (files: PickedFile[]) => void
  onErrors: (errors: string[]) => void
}) {
  const t = useT()
  const uid = useId().replace(/:/g, '')
  const { maxFiles, maxFileBytes, types } = network.uploads
  const size = megabytes(maxFileBytes)
  const labelId = `q-${question.key}-label`
  const hintId = `q-${question.key}-hint`
  const errorId = `q-${question.key}-error`
  const fallback = network.documentCategories.find((c) => c.code === 'OTHER')?.code ?? network.documentCategories[0]?.code ?? 'OTHER'

  const add = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = [...(e.target.files ?? [])]
    e.target.value = ''
    const problems: string[] = []
    const added: PickedFile[] = []
    for (const file of picked) {
      const p = fileProblem(file, network.uploads)
      if (p === 'type') problems.push(t('partner.files.wrongType', { name: file.name }))
      else if (p === 'size') problems.push(t('partner.files.tooBig', { name: file.name, size }))
      else if (files.length + added.length >= maxFiles) {
        problems.push(t('partner.files.tooMany', { max: maxFiles }))
        break
      } else added.push({ id: `${uid}-${Date.now()}-${added.length}`, file, category: fallback })
    }
    onErrors(problems)
    if (added.length) onChange([...files, ...added])
  }

  return (
    <div className="field partner-files">
      <span className="label" id={labelId}>
        <QLabel q={question} />
      </span>
      <p id={hintId} className="muted small">
        {t('partner.files.limits', { size, max: maxFiles })}
      </p>
      {files.length > 0 && (
        <ul className="partner-file-list" aria-labelledby={labelId}>
          {files.map((f) => {
            const selectId = `${f.id}-kind`
            return (
              <li key={f.id}>
                <div className="partner-file-name">
                  <span>{f.file.name}</span>
                  <span className="muted small">{megabytes(f.file.size)}</span>
                </div>
                <label htmlFor={selectId} className="small">
                  {t('partner.files.kind', { name: f.file.name })}
                </label>
                <div className="partner-file-row">
                  <select id={selectId} value={f.category} onChange={(e) => onChange(files.map((x) => (x.id === f.id ? { ...x, category: e.target.value } : x)))}>
                    {network.documentCategories.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="btn btn-quiet" onClick={() => onChange(files.filter((x) => x.id !== f.id))}>
                    {t('common.remove')}
                    <span className="sr-only"> {f.file.name}</span>
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {files.length < maxFiles && (
        <label className="btn photo-pick">
          {files.length ? t('partner.files.addAnother') : t('partner.files.add')}
          <input
            id={`q-${question.key}`}
            type="file"
            accept={types.join(',')}
            multiple
            className="sr-only"
            onChange={add}
            aria-describedby={errors.length ? `${hintId} ${errorId}` : hintId}
            aria-invalid={errors.length ? true : undefined}
          />
        </label>
      )}
      {errors.length > 0 && (
        <div id={errorId} className="field-error" role="alert">
          {errors.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </div>
      )}
    </div>
  )
}

/** Cloudflare's check, only while the API asks for it, with the action it checks ("partner"). */
function Captcha({ siteKey, action, onToken }: { siteKey?: string | null; action: string; onToken: (token: string | null) => void }) {
  const [error, setError] = useState<string | null>(null)
  const human = useTurnstile(setError, { action, ...(siteKey !== undefined ? { siteKey } : {}) })
  const report = useRef(onToken)
  report.current = onToken
  useEffect(() => {
    report.current(human.token)
  }, [human.token])
  return (
    <>
      {human.needed && <div ref={human.box} className="turnstile" />}
      <ErrorNote error={error} />
    </>
  )
}

type UploadState = { status: 'waiting' | 'uploading' | 'done' } | { status: 'failed'; reason: string }

/** The enquiry is saved: its reference, and each file's upload with Try again for one that failed. */
function Received({ submitted, files }: { submitted: PartnerSubmitted; files: PickedFile[] }) {
  const t = useT()
  const en = t.lang === 'en' ? undefined : 'en'
  const [uploads, setUploads] = useState<Record<string, UploadState>>(() => Object.fromEntries(files.map((f) => [f.id, { status: 'waiting' }])))
  const [copied, setCopied] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const started = useRef(false)

  useEffect(() => {
    heading.current?.focus()
    window.scrollTo(0, 0)
  }, [])

  const upload = async (f: PickedFile) => {
    setUploads((u) => ({ ...u, [f.id]: { status: 'uploading' } }))
    try {
      await api.uploadPartnerDocument(submitted.reference, submitted.uploadToken, f.file, f.category)
      setUploads((u) => ({ ...u, [f.id]: { status: 'done' } }))
    } catch (err) {
      setUploads((u) => ({ ...u, [f.id]: { status: 'failed', reason: errorMessage(err) } }))
    }
  }

  // One at a time, in the order they were added.
  useEffect(() => {
    if (started.current) return
    started.current = true
    void (async () => {
      for (const f of files) await upload(f)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(submitted.reference)
      setCopied(true)
    } catch {
      // No clipboard (an older browser or a blocked permission): the number is on screen to copy by hand.
      setCopied(false)
    }
  }

  const failed = files.filter((f) => uploads[f.id]?.status === 'failed')

  return (
    <section className="card partner-done" aria-labelledby="partner-done-title">
      <h1 id="partner-done-title" ref={heading} tabIndex={-1}>
        {t('partner.doneTitle')}
      </h1>
      <p lang={en}>
        Thank you for your interest in MandiMangoes. Your business enquiry has been successfully submitted. Our team will review your proposal
        and contact you using the details provided.
      </p>
      <div className="partner-reference">
        <p className="muted small" id="partner-reference-label">
          {t('partner.reference')}
        </p>
        <p className="partner-reference-number" aria-labelledby="partner-reference-label">
          {submitted.reference}
        </p>
        <button type="button" className="btn" onClick={() => void copy()}>
          {t('partner.copy')}
          <span className="sr-only"> {submitted.reference}</span>
        </button>
        <span className="muted small" role="status">
          {copied ? t('partner.copied') : ''}
        </span>
      </div>
      <p className="muted small">{t('partner.keepReference')}</p>

      {files.length > 0 && (
        <div className="partner-uploads">
          <h2>{t('partner.uploadsTitle')}</h2>
          {failed.length > 0 && <p className="note note-error">{t('partner.someFailed', { count: failed.length })}</p>}
          <ul>
            {files.map((f) => {
              const u: UploadState = uploads[f.id] ?? { status: 'waiting' }
              return (
                <li key={f.id}>
                  <span className="partner-file-name">{f.file.name}</span>
                  <span className={u.status === 'failed' ? 'partner-upload-failed' : u.status === 'done' ? 'partner-upload-done' : 'muted'} role="status">
                    {u.status === 'waiting'
                      ? t('partner.waiting')
                      : u.status === 'uploading'
                        ? t('partner.uploading')
                        : u.status === 'done'
                          ? t('partner.uploaded')
                          : t('partner.uploadFailed', { reason: 'reason' in u ? u.reason : '' })}
                  </span>
                  {u.status === 'failed' && (
                    <button type="button" className="btn btn-quiet" onClick={() => void upload(f)}>
                      {t('common.tryAgain')}
                      <span className="sr-only"> {f.file.name}</span>
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <Link to="/" className="btn btn-primary">
        {t('common.backToShop')}
      </Link>
    </section>
  )
}
