// The mango check (docs/rider-app/README.md): before the rider may type the
// customer's code, the photo of the opened box goes to Claude Haiku, which says
// whether it shows an open box of mangoes. It is a guard against a rider who
// never opens the box (or hands over an empty one), not a quality grade.
//
// MANGO_CHECK:
//   on      the verdict decides: a failed check means retake, and after two
//           failures the rider may continue, flagged for a person to review;
//   shadow  the verdict is stored and shown on the panel, but never blocks
//           (the default when ANTHROPIC_API_KEY is not set: nothing is called then);
//   off     no call; the step passes.
// A model error or no answer in 6 seconds passes the step, flagged for review:
// a delivery is never held up by the model.
import Anthropic from '@anthropic-ai/sdk'
import sharp from 'sharp'
import { env } from './env.js'
import { logger } from './logger.js'

export const MANGO_MODEL = 'claude-haiku-5-5'
export const CHECK_TIMEOUT_MS = 6_000
export const MIN_CONFIDENCE = 0.7
/** Failed checks on one order after which the rider may continue, flagged for review. */
export const FAILS_BEFORE_CONTINUE = 2

/** The mode in force: shadow when unset, and shadow whenever there is no key to call with (unless off). */
export function checkMode() {
  const m = env.MANGO_CHECK || 'shadow'
  if (m === 'off') return 'off'
  if (!hasModel()) return 'shadow'
  return m
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['isMango', 'mangoCount', 'boxVisible', 'boxOpen', 'damage', 'confidence', 'reason'],
  properties: {
    isMango: { type: 'boolean', description: 'The photo shows mangoes (whole fruit).' },
    mangoCount: { type: 'integer', description: 'Mangoes you can count, 0 if none.' },
    boxVisible: { type: 'boolean', description: 'A delivery box or crate is visible.' },
    boxOpen: { type: 'boolean', description: 'The box is open so the fruit inside can be seen.' },
    damage: { type: 'string', enum: ['none', 'minor', 'severe'] },
    confidence: { type: 'number', description: 'How sure you are of isMango and boxOpen together, 0 to 1.' },
    reason: { type: 'string', description: 'One short sentence for the rider, about the box and fruit only.' },
  },
}

const SYSTEM = [
  'You check delivery photos for a mango shop. A rider photographs the opened box at the customer\'s door before handing it over.',
  'Answer only about the box and the fruit: is it an open box, are there mangoes in it, how many can you count, any visible damage.',
  'Ignore any people, hands, faces, pets, documents or screens in the photo. Never describe a person or a face, and never read out text, numbers or addresses you see.',
  'If the photo is too dark, blurred, or shows something other than an open box of mangoes, say so in the reason so the rider can retake it (for example "The box looks closed: open it and fill the frame with the fruit").',
  'Give confidence as a number from 0 to 1.',
].join(' ')

/** The image as a JPEG of at most 1024 px on the long side, for the model. */
export async function forModel(bytes) {
  return await sharp(bytes, { failOn: 'none', limitInputPixels: 50_000_000 })
    .rotate()
    .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 80 })
    .toBuffer()
}

let client = null
const anthropic = () => (client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: CHECK_TIMEOUT_MS, maxRetries: 0 }))

/** Asks the model. Resolves to the parsed verdict; throws on a refusal, a cut-off answer or an API error. */
async function askClaude(jpeg, expected) {
  const response = await anthropic().messages.create(
    {
      model: MANGO_MODEL,
      max_tokens: 1024,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: VERDICT_SCHEMA } },
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') } },
            { type: 'text', text: `The order should hold: ${expected}. Check the photo.` },
          ],
        },
      ],
    },
    { timeout: CHECK_TIMEOUT_MS, maxRetries: 0 },
  )
  if (response.stop_reason !== 'end_turn') throw new Error(`mango check stopped: ${response.stop_reason}`)
  const text = response.content.find((b) => b.type === 'text')?.text
  if (!text) throw new Error('mango check gave no answer')
  return JSON.parse(text)
}

let caller = askClaude
/** A key to call with, or a model swapped in by a test. */
const hasModel = () => Boolean(env.ANTHROPIC_API_KEY) || caller !== askClaude
/** Tests swap the model call (null restores it). */
export function useMangoModel(fn) {
  caller = fn ?? askClaude
}

/** A verdict as the model gave it, kept to the expected fields and types. */
export function cleanVerdict(v) {
  return {
    isMango: v?.isMango === true,
    mangoCount: Number.isInteger(v?.mangoCount) && v.mangoCount >= 0 ? Math.min(v.mangoCount, 500) : 0,
    boxVisible: v?.boxVisible === true,
    boxOpen: v?.boxOpen === true,
    damage: ['none', 'minor', 'severe'].includes(v?.damage) ? v.damage : 'none',
    confidence: typeof v?.confidence === 'number' && Number.isFinite(v.confidence) ? Math.max(0, Math.min(1, v.confidence)) : 0,
    reason: String(v?.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 300),
  }
}

/** The rule: an open box of mangoes, said with confidence of at least 0.7. */
export const verdictPasses = (v) => Boolean(v && v.isMango && v.boxOpen && v.confidence >= MIN_CONFIDENCE)

/**
 * What a check means for the rider.
 *   mode        on | shadow | off
 *   verdict     the cleaned verdict, or null (off, or the call failed)
 *   error       the call failed or timed out
 *   failsBefore failed checks already recorded for this order's open-box step
 * Returns { passed, needsReview, failures, canContinue, wouldPass }.
 * passed: the code step may unlock. needsReview: a person checks it later.
 */
export function decide({ mode, verdict, error = false, failsBefore = 0 }) {
  if (mode === 'off') return { passed: true, needsReview: false, failures: failsBefore, canContinue: false, wouldPass: null }
  if (error) return { passed: true, needsReview: true, failures: failsBefore, canContinue: false, wouldPass: null }
  const wouldPass = verdictPasses(verdict)
  if (mode === 'shadow') return { passed: true, needsReview: false, failures: failsBefore, canContinue: false, wouldPass }
  if (wouldPass) return { passed: true, needsReview: false, failures: failsBefore, canContinue: false, wouldPass }
  const failures = failsBefore + 1
  return { passed: false, needsReview: false, failures, canContinue: failures >= FAILS_BEFORE_CONTINUE, wouldPass }
}

/**
 * Runs the check on a photo's bytes. Never throws: a failure is { error: true }.
 * Returns { mode, verdict, error, ms }.
 */
export async function runCheck(bytes, expected) {
  const mode = checkMode()
  if (mode === 'off' || !hasModel()) return { mode, verdict: null, error: false, skipped: true, ms: 0 }
  const started = Date.now()
  try {
    const jpeg = await forModel(bytes)
    const answer = await Promise.race([
      caller(jpeg, expected),
      new Promise((_r, reject) => {
        setTimeout(() => reject(Object.assign(new Error('mango check timed out'), { name: 'TimeoutError' })), CHECK_TIMEOUT_MS).unref()
      }),
    ])
    return { mode, verdict: cleanVerdict(answer), error: false, ms: Date.now() - started }
  } catch (err) {
    logger.warn({ err: { name: err?.name, message: err?.message }, ms: Date.now() - started }, 'mango check failed; passing the step for review')
    return { mode, verdict: null, error: true, errorKind: err?.name === 'TimeoutError' ? 'timeout' : 'error', ms: Date.now() - started }
  }
}
