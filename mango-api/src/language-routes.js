// The shop language a signed-in customer chose (SHOP_LANGUAGES, docs/languages.md),
// mounted inside the /v1 router after its customer sign-in. Both paths act on the
// caller's own account only: there is no customer id in the path or the body.
// While the switch is off they answer 404, as if they did not exist.
import express from 'express'
import { z } from 'zod'
import { query } from './db.js'
import { asyncHandler, notFound, parse } from './errors.js'
import { isOn } from './feature-switches.js'

/** The shop's languages: English, Hindi, Kannada (the CHECK in migration 043 holds the same list). */
export const LANGUAGES = ['en', 'hi', 'kn']

export const languages = express.Router()

const whenOn = (on) => (_req, _res, next) => next(on() ? undefined : notFound())

languages.use('/me/language', whenOn(() => isOn('SHOP_LANGUAGES')))

/** The saved choice, or null when the customer never chose (the shop then keeps the browser's). */
languages.get(
  '/me/language',
  asyncHandler(async (req, res) => {
    const { rows } = await query('SELECT language FROM customers WHERE id = $1 AND deleted_at IS NULL', [req.customer.id])
    if (!rows.length) throw notFound('Customer not found')
    res.json({ language: rows[0].language ?? null, languages: LANGUAGES })
  }),
)

languages.put(
  '/me/language',
  asyncHandler(async (req, res) => {
    const b = parse(z.object({ language: z.enum(LANGUAGES, { message: 'Choose en, hi or kn' }) }).strict(), req.body ?? {})
    const { rows } = await query('UPDATE customers SET language = $2 WHERE id = $1 AND deleted_at IS NULL RETURNING language', [req.customer.id, b.language])
    if (!rows.length) throw notFound('Customer not found')
    res.json({ language: rows[0].language, languages: LANGUAGES })
  }),
)
