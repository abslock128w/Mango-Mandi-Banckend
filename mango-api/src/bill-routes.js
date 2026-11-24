// Bill downloads (docs/trust.md): the customer's own order in the shop
// (GET /v1/orders/:id/bill), and any order in the panel for managers and
// operators (GET /admin/v1/orders/:id/bill, written to the staff audit). Both
// answer 404 while BILLS_ENABLED is off.
import express from 'express'
import { billFileName, billFor } from './bills.js'
import { readBillLink } from './bill-link.js'
import { billPdf } from './bill-pdf.js'
import { query } from './db.js'
import { asyncHandler, HttpError, notFound } from './errors.js'
import { auditNow } from './staff-audit.js'
import { isOn } from './feature-switches.js'

const noBill = () => new HttpError(404, 'BILL_NOT_ISSUED', 'This order has no bill: bills are made once an order is paid (a free replacement has none).')

function sendPdf(res, bill, { inline = false } = {}) {
  const pdf = billPdf(bill)
  res.set('Content-Type', 'application/pdf')
  res.set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${billFileName(bill)}"`)
  res.set('Cache-Control', 'no-store')
  res.send(pdf)
}

/**
 * Mounted on /v1 with no sign-in: the "Download invoice" button of the WhatsApp order
 * confirmation (bill-link.js). The signed link is the permission; anything wrong with it
 * answers the same 404. Shown in the browser, not saved as a file: it opens from a chat.
 */
export const linkedBills = express.Router()

linkedBills.get(
  '/invoice/:link',
  asyncHandler(async (req, res) => {
    if (!isOn('BILLS_ENABLED')) throw notFound('Not found')
    const orderId = readBillLink(req.params.link)
    if (!orderId) throw notFound('This invoice link is not valid any more. Sign in to the shop and download it from your orders.')
    // An order whose customer deleted their account has no customer any more: its link stops working.
    const { rows } = await query(
      `SELECT o.id FROM orders o WHERE o.id = $1
          AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.id = o.customer_id AND c.deleted_at IS NOT NULL)`,
      [orderId],
    )
    const bill = rows.length ? await billFor({ query }, rows[0].id) : null
    if (!bill) throw notFound('This invoice link is not valid any more. Sign in to the shop and download it from your orders.')
    res.set('Referrer-Policy', 'no-referrer')
    res.set('X-Robots-Tag', 'noindex')
    sendPdf(res, bill, { inline: true })
  }),
)

/** Mounted on /v1 after requireCustomer. */
export const customerBills = express.Router()

customerBills.get(
  '/orders/:id/bill',
  asyncHandler(async (req, res) => {
    if (!isOn('BILLS_ENABLED')) throw notFound('Not found')
    // Someone else's order answers 404, the same as one that doesn't exist.
    const { rows } = await query('SELECT id FROM orders WHERE id = $1 AND customer_id = $2', [req.params.id, req.customer.id])
    if (!rows.length) throw notFound('Order not found')
    const bill = await billFor({ query }, rows[0].id)
    if (!bill) throw noBill()
    sendPdf(res, bill)
  }),
)

/** Mounted on /admin/v1 behind the staff gate; managers and operators (access.js). */
export const staffBills = express.Router()

staffBills.get(
  '/orders/:id/bill',
  asyncHandler(async (req, res) => {
    if (!isOn('BILLS_ENABLED')) throw notFound('Not found')
    const { rows } = await query('SELECT id FROM orders WHERE id = $1', [req.params.id])
    if (!rows.length) throw notFound('Order not found')
    const bill = await billFor({ query }, rows[0].id)
    if (!bill) throw noBill()
    // Written before the file goes out: no audit row, no download.
    await auditNow(req, 'DOWNLOAD bill', { target: req.params.id, detail: { bill: bill.number } })
    sendPdf(res, bill)
  }),
)
