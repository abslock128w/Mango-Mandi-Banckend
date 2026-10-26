// Bill downloads (docs/trust.md): the customer's own order in the shop
// (GET /v1/orders/:id/bill), and any order in the panel for managers and
// operators (GET /admin/v1/orders/:id/bill, written to the staff audit). Both
// answer 404 while BILLS_ENABLED is off.
import express from 'express'
import { billFileName, billFor } from './bills.js'
import { billPdf } from './bill-pdf.js'
import { query } from './db.js'
import { asyncHandler, HttpError, notFound } from './errors.js'
import { auditNow } from './staff-audit.js'
import { isOn } from './feature-switches.js'

const noBill = () => new HttpError(404, 'BILL_NOT_ISSUED', 'This order has no bill: bills are made once an order is paid (a free replacement has none).')

function sendPdf(res, bill) {
  const pdf = billPdf(bill)
  res.set('Content-Type', 'application/pdf')
  res.set('Content-Disposition', `attachment; filename="${billFileName(bill)}"`)
  res.set('Cache-Control', 'no-store')
  res.send(pdf)
}

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
