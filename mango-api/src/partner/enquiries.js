// Partner With Us: the applicant's side (docs/partner-network.md). No sign-in.
// An enquiry is saved with its answers, categories and any product proposal in
// one transaction, together with the messages it causes (outbox), so a message
// failure can never lose an enquiry. Documents follow, one request per file,
// with a short-lived upload secret that only the submitter's browser holds.
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { now } from '../clock.js'
import { conflict, HttpError } from '../errors.js'
import { gstinProblem, normaliseGstin } from '../gstin.js'
import { newId } from '../ids.js'
import { checkPhoto, storePhoto } from '../photos.js'
import { queuePartnerMessages } from './alerts.js'
import { CURRENT_VERSION, DOCUMENT_CATEGORIES, displayValue, QUESTIONNAIRES, publicQuestionnaire, validateSubmission } from './questionnaire.js'

export const MAX_DOCUMENTS = 10
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024
export const DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
const UPLOAD_TOKEN_MS = 2 * 3_600_000
const DUPLICATE_WINDOW_MS = 24 * 3_600_000

/** Reference alphabet: no 0/O, 1/I/L, so it reads out on a phone call without mistakes. */
const REF_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
export const newReference = () => `MMP-${Array.from({ length: 8 }, () => REF_CHARS[randomInt(REF_CHARS.length)]).join('')}`
export const REFERENCE_RE = /^MMP-[2-9A-HJKMNP-Z]{8}$/

const sha256 = (s) => createHash('sha256').update(s).digest('hex')

/** Categories applicants may choose now, in display order. */
export async function activeCategories(c) {
  const { rows } = await c.query('SELECT code, name, description FROM partnership_categories WHERE is_active ORDER BY display_order, code')
  return rows
}

/** What the shop's form needs (GET /v1/partner-network). */
export async function formFor(c, { captchaRequired }) {
  const categories = await activeCategories(c)
  return {
    ...publicQuestionnaire(categories),
    categories,
    documentCategories: Object.entries(DOCUMENT_CATEGORIES).map(([code, label]) => ({ code, label })),
    uploads: { maxFiles: MAX_DOCUMENTS, maxFileBytes: MAX_DOCUMENT_BYTES, types: DOCUMENT_TYPES },
    consent: { text: QUESTIONNAIRES[CURRENT_VERSION].questions.consent.label, privacyPath: '/privacy' },
    captcha: { siteKeyRequired: Boolean(captchaRequired), siteKey: captchaRequired ? captchaRequired : null, action: 'partner' },
  }
}

/** The same steps, keeping only the sections that apply to one category (GET /questionnaires/:category). */
export function stepsForCategory(form, code) {
  return {
    version: form.version,
    category: form.categories.find((x) => x.code === code),
    steps: form.steps.map((st) => ({ ...st, sections: st.sections.filter((s) => !s.categories || s.categories.includes(code)) })).filter((st) => st.sections.length),
  }
}

/** A hash of what was sent, so the same answers twice under different keys are caught. */
function contentHash(answers) {
  const stable = JSON.stringify(Object.keys(answers).sort().map((k) => [k, answers[k]]))
  return sha256(stable)
}

const validationError = (fields) => {
  const first = Object.entries(fields)[0]
  return new HttpError(400, 'VALIDATION_ERROR', first ? `${first[0]}: ${first[1]}` : 'Check the form', { fields })
}

const issueUploadToken = () => {
  const token = randomBytes(24).toString('base64url')
  return { token, hash: sha256(token), expiresAt: new Date(now().getTime() + UPLOAD_TOKEN_MS) }
}

/**
 * Saves a submission. Returns { status: 201|200, body }.
 * The same Idempotency-Key again answers 200 with the same reference (and a
 * fresh upload token); the same answers under another key within a day is 409.
 */
export async function submitEnquiry(c, { version, answers: input, idempotencyKey }) {
  if (version !== CURRENT_VERSION) throw conflict('The form has changed since it was opened. Please check your answers and send again.', 'QUESTIONNAIRE_CHANGED')

  // Same key: the same enquiry (a retry after a lost answer). Checked first, under a lock, so two at once make one.
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`partner-idem:${idempotencyKey}`])
  const again = await c.query('SELECT id, reference, submitted_at FROM partner_enquiries WHERE idempotency_key = $1', [idempotencyKey])
  if (again.rows.length) {
    const t = issueUploadToken()
    await c.query('UPDATE partner_enquiries SET upload_token_hash = $2, upload_token_expires_at = $3 WHERE id = $1', [again.rows[0].id, t.hash, t.expiresAt])
    return { status: 200, body: { reference: again.rows[0].reference, submittedAt: again.rows[0].submitted_at, uploadToken: t.token, uploadExpiresAt: t.expiresAt } }
  }

  const cats = await activeCategories(c)
  const result = validateSubmission(version, input, cats.map((x) => x.code))
  if (result.errors) throw validationError(result.errors)
  const a = result.answers
  if (a.gstin) {
    const g = normaliseGstin(a.gstin)
    const problem = gstinProblem(g)
    if (problem) throw validationError({ gstin: problem })
    a.gstin = g
  }
  if (a.website && !/^(https?:\/\/)?[^\s<>"]+\.[^\s<>"]+$/i.test(a.website) && !/^@?[A-Za-z0-9_.]{2,60}$/.test(a.website)) {
    throw validationError({ website: 'Enter a web address or a social media handle' })
  }

  const hash = contentHash(a)
  const at = now()
  const dup = await c.query('SELECT reference FROM partner_enquiries WHERE content_hash = $1 AND submitted_at > $2 LIMIT 1', [hash, new Date(at.getTime() - DUPLICATE_WINDOW_MS)])
  if (dup.rows.length) {
    throw new HttpError(409, 'DUPLICATE_ENQUIRY', 'We already have this enquiry. Our team will be in touch.', { reference: dup.rows[0].reference })
  }

  const id = newId('pen')
  const t = issueUploadToken()
  const q = QUESTIONNAIRES[version]
  let reference
  for (let i = 0; ; i++) {
    reference = newReference()
    // A clash is about one in 850 billion per pair; a savepoint keeps the transaction usable if it happens.
    await c.query('SAVEPOINT partner_ref')
    try {
      await c.query(
        `INSERT INTO partner_enquiries (id, reference, applicant_name, mobile_number, email, city, state, pincode, country,
           preferred_contact_method, represents_business, business_name, business_type, website, years_operating, gstin,
           business_address, primary_category, start_timeline, callback_time, additional_comments, questionnaire_version,
           consent_text, consent_at, idempotency_key, content_hash, upload_token_hash, upload_token_expires_at,
           submitted_at, updated_at, status_changed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$29,$29)`,
        [id, reference, a.fullName, a.mobile, a.email, a.city, a.state, a.pincode, a.country ?? 'India', a.preferredContact,
          a.representsBusiness, a.businessName ?? null, a.businessType, a.website ?? null, a.yearsOperating ?? null, a.gstin ?? null,
          a.businessAddress ?? null, a.primaryCategory, a.startWhen, a.callbackTime ?? null, a.additionalComments ?? null, version,
          q.questions.consent.label, at, idempotencyKey, hash, t.hash, t.expiresAt, at],
      )
      await c.query('RELEASE SAVEPOINT partner_ref')
      break
    } catch (err) {
      await c.query('ROLLBACK TO SAVEPOINT partner_ref')
      if (err.code !== '23505' || !/reference/.test(err.constraint ?? '') || i >= 4) throw err
    }
  }

  for (const code of a.categories) {
    await c.query('INSERT INTO partner_enquiry_categories (enquiry_id, category_code, is_primary) VALUES ($1, $2, $3)', [id, code, code === a.primaryCategory])
  }

  // Every shown question, answered or not, with its label as it is now (so later form changes don't rewrite history).
  const names = Object.fromEntries(cats.map((x) => [x.code, x.name]))
  let position = 0
  for (const s of result.sections) {
    for (const key of s.keys) {
      const def = q.questions[key]
      if (def.type === 'FILE_UPLOAD') continue
      if (def.showIf && !def.showIf.in.includes(a[def.showIf.key])) continue
      const value = a[key]
      await c.query(
        `INSERT INTO partner_enquiry_answers (id, enquiry_id, section_key, section_title, question_key, question_label, question_type,
           answer_value, display_value, position, questionnaire_version, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [newId('pea'), id, s.key, s.title, key, def.label, def.type, value === undefined ? null : JSON.stringify(value),
          displayValue(def, value, names), position++, version, at],
      )
    }
  }

  let proposalId = null
  if (a.categories.includes('PRODUCT_DEVELOPMENT')) {
    proposalId = newId('ppr')
    await c.query(
      `INSERT INTO partner_product_proposals (id, reference, enquiry_id, product_name, product_category, description, product_stage,
         source_location, supplier_type, procurement_price, suggested_selling_price, monthly_supply_capacity, quality_certifications,
         sample_available, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)`,
      [proposalId, `${reference}-P`, id, a.pd_productName, a.pd_category, a.pd_description ?? null, a.pd_stage ?? null, a.pd_source ?? null,
        q.questions.pd_canManage.options.find((o) => o.value === a.pd_canManage)?.label ?? null,
        a.pd_cost ?? null, a.pd_price ?? null, a.pd_capacity ?? null, a.fs_certifications ?? null, a.pd_samples ?? null, at],
    )
  }

  await c.query(
    `INSERT INTO partner_enquiry_activities (id, enquiry_id, activity_type, new_value, metadata, created_at)
     VALUES ($1, $2, 'SUBMITTED', 'NEW', $3, $4)`,
    [newId('pac'), id, JSON.stringify({ categories: a.categories, primary: a.primaryCategory, proposal: proposalId ? `${reference}-P` : null }), at],
  )
  await queuePartnerMessages(c, { kind: 'SUBMITTED', enquiryId: id, proposal: Boolean(proposalId) })
  return { status: 201, body: { reference, submittedAt: at, uploadToken: t.token, uploadExpiresAt: t.expiresAt } }
}

// ---------------------------------------------------------------- documents

const PDF_MAGIC = Buffer.from('%PDF-')

/** The file's real type from its first bytes: PDF, JPEG, PNG or WebP, else a 400. */
export function checkDocument(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw new HttpError(400, 'FILE_INVALID', 'Send the file as the request body')
  if (bytes.length > MAX_DOCUMENT_BYTES) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', `The file is too large (${MAX_DOCUMENT_BYTES / 1048576} MB at most)`)
  if (bytes.subarray(0, 5).equals(PDF_MAGIC)) return { mime: 'application/pdf', ext: 'pdf' }
  try {
    return checkPhoto(bytes, MAX_DOCUMENT_BYTES)
  } catch {
    throw new HttpError(400, 'FILE_INVALID', 'Upload a PDF, JPEG, PNG or WebP file')
  }
}

/** A file name safe to store and to offer back: no path, no control or quote characters, at most 160 characters. */
export function cleanFilename(raw, ext) {
  let n = String(raw ?? '').split(/[\\/]/).pop() ?? ''
  n = n.normalize('NFKC').replace(/[\u0000-\u001f\u007f"<>|*?:]/g, '').replace(/\s+/g, ' ').trim()
  if (!n || /^\.+$/.test(n)) n = `document.${ext}`
  if (n.length > 160) n = n.slice(0, 150) + n.slice(-10)
  return n
}

const tokenMatches = (hash, token) => {
  if (!hash || typeof token !== 'string' || token.length < 20 || token.length > 100) return false
  const a = Buffer.from(hash, 'hex')
  const b = Buffer.from(sha256(token), 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

const BAD_TOKEN = () => new HttpError(401, 'UPLOAD_TOKEN_INVALID', 'This upload link has expired. Your enquiry is saved; send any documents when our team contacts you.')

/** Saves one document for the enquiry with this reference, after checking the upload secret. */
export async function addDocument(c, { reference, token, category, filename, bytes }) {
  if (!REFERENCE_RE.test(reference ?? '')) throw BAD_TOKEN()
  const { rows } = await c.query('SELECT id, upload_token_hash, upload_token_expires_at FROM partner_enquiries WHERE reference = $1 FOR UPDATE', [reference])
  const e = rows[0]
  if (!e || !tokenMatches(e.upload_token_hash, token) || !(e.upload_token_expires_at > now())) throw BAD_TOKEN()
  if (!DOCUMENT_CATEGORIES[category]) throw new HttpError(400, 'VALIDATION_ERROR', 'Choose what kind of document this is')
  const { mime, ext } = checkDocument(bytes)
  const count = await c.query('SELECT COUNT(*)::int AS n FROM partner_enquiry_documents WHERE enquiry_id = $1', [e.id])
  if (count.rows[0].n >= MAX_DOCUMENTS) throw conflict(`An enquiry can have at most ${MAX_DOCUMENTS} documents`, 'TOO_MANY_FILES')
  const id = newId('pdc')
  const saved = await storePhoto(`partner-docs/${e.id}`, id, bytes, ext, mime)
  const name = cleanFilename(filename, ext)
  await c.query(
    `INSERT INTO partner_enquiry_documents (id, enquiry_id, original_filename, mime_type, file_size, document_category, blob_path, bytes, uploaded_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, e.id, name, mime, bytes.length, category, saved.blobPath, saved.bytes, now()],
  )
  await c.query(
    `INSERT INTO partner_enquiry_activities (id, enquiry_id, activity_type, new_value, metadata, created_at) VALUES ($1, $2, 'DOCUMENT_ADDED', $3, $4, $5)`,
    [newId('pac'), e.id, name, JSON.stringify({ category, size: bytes.length }), now()],
  )
  return { id, name, category, size: bytes.length }
}
