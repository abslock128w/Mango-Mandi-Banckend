// Before migrations-pending/055_drop_delivery_code.sql: gives every order that still has
// only a plaintext delivery code (sent out before migration 053) its hash, so the rider's
// code check keeps working once the plaintext column is gone. Orders out for delivery at
// that moment lose the code on the shop page (WhatsApp already delivered it); run it after
// the day's runs.
//
//   node --env-file=.env ops/hash-delivery-codes.js            hash them
//   node --env-file=.env ops/hash-delivery-codes.js --dry-run  count them only
import { closePool, tx } from '../src/db.js'
import { deliveryCodeHash } from '../src/delivery-code.js'

const dry = process.argv.includes('--dry-run')
const n = await tx(async (c) => {
  const { rows } = await c.query('SELECT id, delivery_code FROM orders WHERE delivery_code IS NOT NULL AND delivery_code_hash IS NULL FOR UPDATE')
  if (!dry) for (const o of rows) await c.query('UPDATE orders SET delivery_code_hash = $2 WHERE id = $1', [o.id, deliveryCodeHash(o.id, o.delivery_code)])
  return rows.length
})
console.log(`${n} order${n === 1 ? '' : 's'} with a plaintext code ${dry ? 'would be' : 'were'} hashed`)
await closePool()
