// Partner With Us (docs/partner-network.md): the form's rules, drawn from the questionnaire the API
// serves (GET /v1/partner-network). Which steps and sections apply to the ticked categories, which
// questions show, and the same checks the API makes, so Next can stop on the step with the problem.
// No React and no browser here, so it is unit tested on its own (customer-app/tests/unit/partner-form.unit.ts).

export type QuestionType =
  | 'TEXT'
  | 'TEXTAREA'
  | 'EMAIL'
  | 'PHONE'
  | 'NUMBER'
  | 'SELECT'
  | 'MULTI_SELECT'
  | 'RADIO'
  | 'CHECKBOX'
  | 'BOOLEAN'
  | 'DATE'
  | 'FILE_UPLOAD'
  | 'CURRENCY'

export interface PartnerOption {
  value: string
  label: string
}
export interface PartnerQuestion {
  key: string
  label: string
  type: QuestionType
  /** true, false, or required only while the question is shown. */
  required: boolean | 'whenShown'
  options?: PartnerOption[]
  description?: string
  placeholder?: string
  min?: number
  max?: number
  pattern?: string
  patternMessage?: string
  /** The pattern applies only while that answer equals the value (the PIN code: only in India). */
  patternOnlyWhen?: { key: string; equals: string }
  default?: unknown
  showIf?: { key: string; in: unknown[] }
  /** primaryCategory: its options are the ticked categories. */
  optionsFrom?: string
}
export interface PartnerSection {
  key: string
  title: string
  /** Shown only when one of these is ticked; null: always. */
  categories: string[] | null
  questions: PartnerQuestion[]
}
export interface PartnerStep {
  key: string
  title: string
  description?: string
  sections: PartnerSection[]
}
export interface PartnerCategory {
  code: string
  name: string
  description: string
}
export interface PartnerNetwork {
  version: string
  categories: PartnerCategory[]
  steps: PartnerStep[]
  documentCategories: { code: string; label: string }[]
  uploads: { maxFiles: number; maxFileBytes: number; types: string[] }
  consent: { text: string; privacyPath: string }
  /** siteKey: the Turnstile site key while the check is on (an older API leaves it out). */
  captcha: { siteKeyRequired: boolean; siteKey?: string | null; action: string }
}
export interface PartnerSubmitted {
  reference: string
  submittedAt: string
  uploadToken: string
  uploadExpiresAt: string
}

/** Answers as the form holds them: numbers stay text until they are sent. */
export type Answers = Record<string, unknown>

/** A problem with one answer, for the page to put into words (partner.err.<code>). */
export interface Problem {
  code:
    | 'required'
    | 'choose'
    | 'chooseOne'
    | 'tooShort'
    | 'tooLong'
    | 'email'
    | 'phone'
    | 'number'
    | 'wholeNumber'
    | 'amount'
    | 'tooSmall'
    | 'tooLarge'
    | 'pattern'
    | 'date'
    | 'consent'
    | 'primaryNotTicked'
  vars?: Record<string, string | number>
  /** The questionnaire's own words for a pattern (patternMessage), when it has them. */
  message?: string
}

const isBlank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0)

export const chosenCategories = (answers: Answers): string[] => (Array.isArray(answers.categories) ? answers.categories.filter((c): c is string => typeof c === 'string') : [])

/**
 * The steps for these answers. A section with categories is kept only when one of them is ticked,
 * and a question key in more than one kept section is asked once, in the first. A step whose
 * sections all depend on categories stays in the list while nothing is ticked yet (so the count
 * of steps does not jump), and is dropped only when none of its sections apply.
 */
export function applicableSteps(steps: PartnerStep[], answers: Answers): PartnerStep[] {
  const chosen = chosenCategories(answers)
  const seen = new Set<string>()
  const out: PartnerStep[] = []
  for (const st of steps) {
    const sections: PartnerSection[] = []
    for (const s of st.sections) {
      if (s.categories && !s.categories.some((c) => chosen.includes(c))) continue
      const questions = s.questions.filter((q) => !seen.has(q.key))
      questions.forEach((q) => seen.add(q.key))
      if (questions.length) sections.push({ ...s, questions })
    }
    if (sections.length || (!chosen.length && st.sections.length > 0 && st.sections.every((s) => s.categories))) out.push({ ...st, sections })
  }
  return out
}

/** True when the question's showIf is met (or it has none). */
export function isShown(q: PartnerQuestion, answers: Answers): boolean {
  if (!q.showIf) return true
  return q.showIf.in.includes(answers[q.showIf.key])
}

/** The questions a step asks now: its sections' shown questions. */
export function shownQuestions(step: PartnerStep, answers: Answers): PartnerQuestion[] {
  return step.sections.flatMap((s) => s.questions.filter((q) => isShown(q, answers)))
}

/** The options a question offers now: primaryCategory offers only the ticked categories. */
export function optionsFor(q: PartnerQuestion, answers: Answers): PartnerOption[] {
  const all = q.options ?? []
  if (q.optionsFrom || q.key === 'primaryCategory') {
    const chosen = chosenCategories(answers)
    return all.filter((o) => chosen.includes(o.value))
  }
  return all
}

/** '+91 98765-43210' → '+919876543210'; null when not a 10-digit Indian mobile (the API's rule). */
export function normaliseMobile(raw: string): string | null {
  const s = raw.replace(/[\s()-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, '')
  return /^[6-9]\d{9}$/.test(s) ? `+91${s}` : null
}

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/

/** A NUMBER or CURRENCY answer as a number, or NaN ("1,20,000" reads as 120000). */
export function readAmount(raw: unknown): number {
  if (typeof raw === 'number') return raw
  if (typeof raw !== 'string') return NaN
  const s = raw.replace(/,/g, '').trim()
  return /^\d+(\.\d{1,2})?$/.test(s) ? Number(s) : NaN
}

/** Whether the pattern applies: patternOnlyWhen compares the other answer (blank counts as its default, India). */
function patternApplies(q: PartnerQuestion, answers: Answers, all: Map<string, PartnerQuestion>): boolean {
  if (!q.pattern) return false
  const when = q.patternOnlyWhen
  if (!when) return true
  const other = answers[when.key]
  const fallback = all.get(when.key)?.default
  const value = isBlank(other) ? fallback : other
  return String(value ?? '').trim().toLowerCase() === when.equals.trim().toLowerCase()
}

/** Checks one shown answer the way the API does; null when it is fine. */
export function checkAnswer(q: PartnerQuestion, raw: unknown, answers: Answers, all: Map<string, PartnerQuestion> = new Map()): Problem | null {
  if (q.type === 'FILE_UPLOAD') return null
  if (q.type === 'CHECKBOX') {
    if (q.required && raw !== true) return { code: q.key === 'consent' ? 'consent' : 'required' }
    return null
  }
  let value = raw
  if (isBlank(value) && q.default !== undefined) value = q.default
  if (isBlank(value)) {
    if (!q.required) return null
    if (q.key === 'categories') return { code: 'chooseOne' }
    return { code: ['BOOLEAN', 'RADIO', 'SELECT', 'MULTI_SELECT'].includes(q.type) ? 'choose' : 'required' }
  }
  switch (q.type) {
    case 'TEXT':
    case 'TEXTAREA': {
      const v = String(value).replace(/\r\n?/g, '\n').trim()
      const max = q.max ?? (q.type === 'TEXT' ? 200 : 3000)
      if (q.min && v.length < q.min) return { code: 'tooShort', vars: { min: q.min } }
      if (v.length > max) return { code: 'tooLong', vars: { max } }
      if (patternApplies(q, answers, all) && !new RegExp(q.pattern!).test(v)) return { code: 'pattern', message: q.patternMessage }
      return null
    }
    case 'EMAIL': {
      const v = String(value).trim()
      if (v.length > (q.max ?? 200)) return { code: 'tooLong', vars: { max: q.max ?? 200 } }
      return EMAIL_RE.test(v) ? null : { code: 'email' }
    }
    case 'PHONE':
      return normaliseMobile(String(value)) ? null : { code: 'phone' }
    case 'NUMBER':
    case 'CURRENCY': {
      const n = readAmount(value)
      if (!Number.isFinite(n)) return { code: q.type === 'CURRENCY' ? 'amount' : 'number' }
      if (q.type === 'NUMBER' && !Number.isInteger(n)) return { code: 'wholeNumber' }
      if (q.min != null && n < q.min) return { code: 'tooSmall', vars: { min: q.min } }
      if (q.max != null && n > q.max) return { code: 'tooLarge' }
      return null
    }
    case 'SELECT':
    case 'RADIO': {
      if (q.key === 'primaryCategory' && !chosenCategories(answers).includes(String(value))) return { code: 'primaryNotTicked' }
      const allowed = optionsFor(q, answers).map((o) => o.value)
      return allowed.includes(String(value)) ? null : { code: 'choose' }
    }
    case 'MULTI_SELECT': {
      const allowed = (q.options ?? []).map((o) => o.value)
      if (!Array.isArray(value) || value.some((v) => !allowed.includes(v))) return { code: 'choose' }
      return null
    }
    case 'BOOLEAN':
      return typeof value === 'boolean' ? null : { code: 'choose' }
    case 'DATE':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) ? null : { code: 'date' }
    default:
      return null
  }
}

/** Every question in the questionnaire, by key (the first time each key appears). */
export function questionMap(steps: PartnerStep[]): Map<string, PartnerQuestion> {
  const m = new Map<string, PartnerQuestion>()
  for (const q of steps.flatMap((st) => st.sections.flatMap((s) => s.questions))) if (!m.has(q.key)) m.set(q.key, q)
  return m
}

/** The problems on one step, by question key, in the order the questions appear. */
export function validateStep(step: PartnerStep, answers: Answers, all: Map<string, PartnerQuestion> = new Map()): Record<string, Problem> {
  const out: Record<string, Problem> = {}
  for (const q of shownQuestions(step, answers)) {
    const p = checkAnswer(q, answers[q.key], answers, all)
    if (p) out[q.key] = p
  }
  return out
}

/** The index of the step (in `steps`) that asks `key` now, or -1. */
export function stepOfKey(steps: PartnerStep[], key: string): number {
  return steps.findIndex((st) => st.sections.some((s) => s.questions.some((q) => q.key === key)))
}

/** Starting answers: each question's default (the country is India), and a category from the landing page. */
export function initialAnswers(network: Pick<PartnerNetwork, 'steps' | 'categories'>, category?: string | null): Answers {
  const a: Answers = {}
  for (const q of questionMap(network.steps).values()) if (q.default !== undefined) a[q.key] = q.default
  if (category && network.categories.some((c) => c.code === category)) {
    a.categories = [category]
    a.primaryCategory = category
  }
  return a
}

/**
 * The answers after one changes. Ticking categories keeps the main interest among them, and
 * picks it when exactly one is ticked.
 */
export function setAnswer(answers: Answers, key: string, value: unknown): Answers {
  const next: Answers = { ...answers, [key]: value }
  if (key === 'categories') {
    const chosen = chosenCategories(next)
    if (chosen.length === 1) next.primaryCategory = chosen[0]
    else if (typeof next.primaryCategory === 'string' && !chosen.includes(next.primaryCategory)) delete next.primaryCategory
  }
  return next
}

/**
 * What is sent (POST /v1/partner-network/enquiries): only the questions shown for these answers,
 * no files, numbers as numbers, text trimmed, blank optional answers left out.
 */
export function buildAnswers(steps: PartnerStep[], answers: Answers): Answers {
  const out: Answers = {}
  for (const st of applicableSteps(steps, answers)) {
    for (const q of shownQuestions(st, answers)) {
      if (q.type === 'FILE_UPLOAD') continue
      let v = answers[q.key]
      if (isBlank(v) && q.default !== undefined) v = q.default
      if (q.type === 'CHECKBOX') {
        if (typeof v === 'boolean') out[q.key] = v
        continue
      }
      if (isBlank(v)) continue
      if (q.type === 'NUMBER' || q.type === 'CURRENCY') {
        const n = readAmount(v)
        out[q.key] = Number.isFinite(n) ? n : v
      } else if (typeof v === 'string') out[q.key] = v.trim()
      else out[q.key] = v
    }
  }
  return out
}

/**
 * The answers that still fit a newer questionnaire (409 QUESTIONNAIRE_CHANGED): kept when the
 * question still exists with the same type and, for a choice, the value is still offered.
 */
export function keepMatchingAnswers(steps: PartnerStep[], categories: PartnerCategory[], answers: Answers): Answers {
  const all = questionMap(steps)
  const codes = categories.map((c) => c.code)
  const out: Answers = {}
  for (const [key, v] of Object.entries(answers)) {
    const q = all.get(key)
    if (!q) continue
    if (key === 'categories') {
      const kept = chosenCategories(answers).filter((c) => codes.includes(c))
      if (kept.length) out[key] = kept
      continue
    }
    if (key === 'primaryCategory') {
      if (typeof v === 'string' && codes.includes(v)) out[key] = v
      continue
    }
    const values = (q.options ?? []).map((o) => o.value)
    if (q.type === 'SELECT' || q.type === 'RADIO') {
      if (typeof v === 'string' && values.includes(v)) out[key] = v
    } else if (q.type === 'MULTI_SELECT') {
      const kept = Array.isArray(v) ? v.filter((x) => values.includes(x)) : []
      if (kept.length) out[key] = kept
    } else if (q.type === 'BOOLEAN' || q.type === 'CHECKBOX') {
      if (typeof v === 'boolean') out[key] = v
    } else if (typeof v === 'string' || typeof v === 'number') out[key] = v
  }
  if (typeof out.primaryCategory === 'string' && !chosenCategories(out).includes(out.primaryCategory)) delete out.primaryCategory
  return out
}

/** Why a picked file cannot be sent, before anything is uploaded; null when it is fine. */
export function fileProblem(file: { type: string; size: number }, uploads: PartnerNetwork['uploads']): 'type' | 'size' | null {
  if (!uploads.types.includes(file.type)) return 'type'
  if (file.size > uploads.maxFileBytes) return 'size'
  return null
}

/** "5 MB" for the upload limit. */
export const megabytes = (bytes: number) => `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`
