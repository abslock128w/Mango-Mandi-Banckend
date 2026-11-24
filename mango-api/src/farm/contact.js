// Two optional contact details both farm forms ask for (migration 094): the language the visitor would like our team to
// speak, and another number to reach them on. The Farm Experience booking (routes.js, farm_bookings) and the farm visit
// enquiry (bulk-enquiries.js, bulk_enquiries of kind FARM_VISIT) take the same fields, checked the same way. Only zod is
// imported here: customer.js imports farm/routes.js, so this file must not import it back.
import { z } from 'zod'

/** The languages the shop offers, in its order. The database checks the same list (094). */
export const PREFERRED_LANGUAGES = ['English', 'Telugu', 'Hindi', 'Tamil', 'Kannada', 'Other']

/** An empty answer (missing, null or blank) is "not given". */
const blank = (v) => (v == null || (typeof v === 'string' && !v.trim()) ? null : v)

/** Optional: one of PREFERRED_LANGUAGES, or null. */
export const preferredLanguage = z.preprocess(blank, z.enum(PREFERRED_LANGUAGES, { message: 'Choose a language from the list' }).nullable().optional())

/**
 * Optional: another Indian mobile number, normalised to +91XXXXXXXXXX like the main one (customer.js phoneSchema,
 * bulk-enquiries.js bulkPhone), or null.
 */
export const altPhone = z.preprocess(
  blank,
  z
    .string({ message: 'Enter a 10-digit Indian mobile number' })
    .transform((s) => s.replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, ''))
    .refine((s) => /^[6-9]\d{9}$/.test(s), 'Enter a 10-digit Indian mobile number for the other number, or leave it empty')
    .transform((s) => `+91${s}`)
    .nullable()
    .optional(),
)
