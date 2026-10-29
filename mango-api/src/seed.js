// Reference data on every start (idempotent), staff logins outside production,
// and optional demo batches on an empty database.
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'
import { addDays, now, todayIST } from './clock.js'
import { query, tx } from './db.js'
import { deployEnv, env, isProd } from './env.js'
import { newId } from './ids.js'
import { ledger } from './inventory.js'
import { logger, maskEmail } from './logger.js'

// Fresh mangoes: HSN 0804 50, nil GST. Prices are GST-inclusive paise.
const ALPHONSO = 'Alphonso (Hapus): saffron flesh, rich and sweet, with almost no fibre.'
const BADAMI = "Badami, Karnataka's Alphonso: sweet and juicy, a little lighter, at a friendlier price."
const PRODUCTS = [
  ['ALP-3', 'Alphonso 3kg Box', 'Alphonso', '3kg', 189_900, ALPHONSO],
  ['ALP-5', 'Alphonso 5kg Box', 'Alphonso', '5kg', 299_900, ALPHONSO],
  ['BAD-3', 'Badami 3kg Box', 'Badami', '3kg', 129_900, BADAMI],
  ['BAD-5', 'Badami 5kg Box', 'Badami', '5kg', 199_900, BADAMI],
]

// Demo catalogue (development and staging previews only, like the demo batches): the
// rest of the varieties the shop is built to show, so it is not just two mangoes.
// [code, variety, 3 kg price, 5 kg price, description]
const DEMO_VARIETIES = [
  ['KES', 'Kesar', 159_900, 249_900, 'Kesar from Gir: saffron-orange flesh, very sweet and fragrant. The classic aamras mango.'],
  ['BAN', 'Banganapalli', 99_900, 159_900, 'Banganapalli (Benishan) from Kurnool: mild, sweet and fibreless, slices cleanly.'],
  ['DAS', 'Dasheri', 119_900, 189_900, 'Dasheri from Malihabad: long and slender, aromatic and honey-sweet.'],
  ['LAN', 'Langra', 109_900, 174_900, 'Langra from Varanasi: stays green outside when ripe, juicy with a gentle tang.'],
  ['CHA', 'Chausa', 124_900, 199_900, 'Chausa: a late-season mango, soft, very sweet and juicy. Best chilled.'],
  ['TOT', 'Totapuri', 74_900, 119_900, 'Totapuri: firm and tangy with a parrot-beak tip. Made for pickles, chutney and pulp.'],
  ['HIM', 'Himsagar', 139_900, 219_900, "Himsagar, Bengal's pride: creamy, fibreless and very sweet, with a short season."],
  ['NEE', 'Neelam', 94_900, 149_900, 'Neelam from Krishnagiri: floral and mildly sweet, keeps well. Great in shakes.'],
  ['MAL', 'Mallika', 119_900, 189_900, 'Mallika, a Neelam and Dasheri cross: honeyed, citrusy, deep orange flesh.'],
  ['AMR', 'Amrapali', 124_900, 199_900, 'Amrapali: a Dasheri and Neelam hybrid, intensely sweet with deep orange flesh.'],
  ['RAS', 'Raspuri', 99_900, 159_900, 'Raspuri from Mysuru: full of juice, made for pulp, juice and ice cream.'],
  ['IMP', 'Imam Pasand', 169_900, 269_900, 'Imam Pasand: large, thin-skinned and fibreless, richly sweet. Once a royal favourite.'],
  ['MLG', 'Malgova', 144_900, 229_900, 'Malgova from Salem: round, soft and juicy, a summer staple in Tamil Nadu.'],
  ['MIX', 'Mixed Box', 179_900, 279_900, 'Mixed Box: four favourites in one box, each wrapped and labelled to taste side by side.'],
]
/** [code, age today, status, QC rating or null, farm, 3 kg boxes, 5 kg boxes]; ages spread the stages. */
const DEMO_BATCHES = [
  // Every variety but Chausa gets a young batch (raw now, ripe within the delivery window) and most
  // an older one (semi-ripe or ripe now), so each shows stock on every day a shopper can pick.
  ['KES', 4, 'SELLING', 'SEMI_RIPE', 'Gir', 30, 12], ['KES', 1, 'ARRIVED', 'RAW', 'Junagadh', 24, 10],
  ['BAN', 3, 'SELLING', 'SEMI_RIPE', 'Kurnool', 36, 14], ['BAN', 1, 'ARRIVED', 'RAW', 'Kurnool', 30, 12],
  ['DAS', 3, 'SELLING', 'SEMI_RIPE', 'Malihabad', 20, 8], ['DAS', 0, 'ARRIVED', 'RAW', 'Malihabad', 16, 6],
  ['LAN', 3, 'SELLING', 'SEMI_RIPE', 'Varanasi', 18, 6], ['LAN', 1, 'ARRIVED', 'RAW', 'Varanasi', 12, 6],
  ['TOT', 1, 'ARRIVED', 'RAW', 'Chittoor', 40, 20], ['TOT', 3, 'SELLING', 'SEMI_RIPE', 'Chittoor', 20, 10],
  ['HIM', 4, 'SELLING', 'SEMI_RIPE', 'Murshidabad', 6, 0], ['HIM', 1, 'ARRIVED', 'RAW', 'Malda', 8, 4],
  ['NEE', 1, 'ARRIVED', 'RAW', 'Krishnagiri', 22, 10], ['NEE', 4, 'SELLING', 'SEMI_RIPE', 'Krishnagiri', 14, 6],
  ['MAL', 3, 'SELLING', 'SEMI_RIPE', 'Kolar', 16, 8], ['MAL', 0, 'ARRIVED', 'RAW', 'Kolar', 10, 4],
  ['AMR', 4, 'SELLING', 'SEMI_RIPE', 'Saharanpur', 12, 6], ['AMR', 1, 'ARRIVED', 'RAW', 'Saharanpur', 10, 4],
  ['RAS', 1, 'ARRIVED', 'RAW', 'Mysuru', 20, 10], ['RAS', 4, 'SELLING', 'SEMI_RIPE', 'Mysuru', 18, 8],
  ['IMP', 4, 'SELLING', 'SEMI_RIPE', 'Krishna', 14, 6], ['IMP', 1, 'ARRIVED', 'RAW', 'Krishna', 10, 4],
  ['MLG', 3, 'SELLING', 'SEMI_RIPE', 'Salem', 12, 0], ['MLG', 0, 'ARRIVED', 'RAW', 'Salem', 8, 4],
  ['MIX', 3, 'SELLING', 'SEMI_RIPE', 'Mixed farms', 15, 8], ['MIX', 1, 'ARRIVED', 'RAW', 'Mixed farms', 10, 6],
  // Chausa has no stock in the demo: the shop shows it as sold out, with a stock alert to set.
]

const PINCODES = [
  ['560001', 'Bengaluru', 'Central'],
  ['560008', 'Bengaluru', 'East'],
  ['560034', 'Bengaluru', 'South'],
  ['560038', 'Bengaluru', 'East'],
  ['560066', 'Bengaluru', 'East'],
  ['560076', 'Bengaluru', 'South'],
  ['560095', 'Bengaluru', 'South'],
  ['560102', 'Bengaluru', 'South'],
]

const DEMO_USERS = [
  ['manager@mandimangoes.test', 'manager123', 'MANAGER'],
  ['ops@mandimangoes.test', 'operator123', 'OPERATOR'],
  ['packer@mandimangoes.test', 'packer123', 'PACKER'],
  ['qc@mandimangoes.test', 'qc123', 'QC'],
]

export async function seed() {
  // The starter products go in once, on a new database. After that the
  // catalogue is the managers' (Products page): a deploy never brings back a
  // product they removed or undoes a rename.
  const { rows: existing } = await query('SELECT COUNT(*)::int AS n FROM products')
  if (!existing[0].n) {
    for (const [sku, name, variety, box, price, description] of PRODUCTS) {
      await query(
        `INSERT INTO products (sku, name, variety, box_size, price, gst_rate, hsn_code, description) VALUES ($1, $2, $3, $4, $5, 0, '08045020', $6)`,
        [sku, name, variety, box, price, description],
      )
    }
  }
  for (const [pin, city, zone] of PINCODES) {
    await query('INSERT INTO pincodes (pincode, city, zone) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [pin, city, zone])
  }

  if (!isProd) {
    for (const [email, password, role] of DEMO_USERS) {
      await query('INSERT INTO admin_users (id, email, password_hash, role) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING', [
        newId('adm'), email, await bcrypt.hash(password, 10), role,
      ])
    }
  } else {
    // First start: create one manager if there are no staff yet. Previews use
    // their own login, never production's.
    const [email, password] = deployEnv === 'preview' ? [env.PREVIEW_ADMIN_EMAIL, env.PREVIEW_ADMIN_PASSWORD] : [env.ADMIN_BOOTSTRAP_EMAIL, env.ADMIN_BOOTSTRAP_PASSWORD]
    const { rows } = email && password ? await query('SELECT COUNT(*)::int AS n FROM admin_users') : { rows: [{ n: 1 }] }
    if (rows[0].n === 0) {
      await query(`INSERT INTO admin_users (id, email, password_hash, role) VALUES ($1, $2, $3, 'MANAGER')`, [
        newId('adm'), email.toLowerCase(), await bcrypt.hash(password, 12),
      ])
      logger.info({ email: maskEmail(email) }, 'bootstrap manager created')
    }
  }

  // Demo stock: development, and Vercel previews on the staging branch. Never production.
  if (env.SEED_DEMO_DATA && (!isProd || deployEnv === 'preview')) {
    await seedDemoBatches()
    await seedDemoVarieties()
  }
  // Tests set up their own slots; development gets two to click through.
  if (env.SEED_DEMO_DATA && env.NODE_ENV === 'development') await seedDemoSlots()
}

async function seedDemoSlots() {
  const { rows } = await query('SELECT COUNT(*)::int AS n FROM delivery_slots')
  if (rows[0].n > 0) return
  for (const [label, from, to, sort] of [['Morning', '07:00', '11:00', 1], ['Evening', '16:00', '20:00', 2]]) {
    await query('INSERT INTO delivery_slots (id, label, starts_at, ends_at, max_boxes, sort) VALUES ($1, $2, $3, $4, 40, $5)', [newId('slt'), label, from, to, sort])
  }
}

/** A rolling spread of batches so every stage has stock for the next few days. */
async function seedDemoBatches() {
  const { rows } = await query('SELECT COUNT(*)::int AS n FROM batches')
  if (rows[0].n > 0) return
  const today = todayIST()
  const batches = [
    // [variety, age today, status, latest QC rating or null, farm, lines]
    ['Alphonso', 4, 'SELLING', 'SEMI_RIPE', 'Ratnagiri', { 'ALP-3': 40, 'ALP-5': 20 }],
    ['Alphonso', 2, 'ARRIVED', 'RAW', 'Devgad', { 'ALP-3': 40, 'ALP-5': 20 }],
    ['Alphonso', 0, 'IN_TRANSIT', null, 'Ratnagiri', { 'ALP-3': 30, 'ALP-5': 15 }],
    ['Badami', 5, 'SELLING', 'RIPE', 'Chittoor', { 'BAD-3': 30, 'BAD-5': 15 }],
    ['Badami', 2, 'ARRIVED', 'RAW', 'Krishnagiri', { 'BAD-3': 30, 'BAD-5': 15 }],
  ]
  await tx(async (c) => {
    for (const [variety, age, status, rating, farm, lines] of batches) {
      const id = newId('bat')
      const pluckedOn = addDays(today, -age)
      const arrived = status !== 'IN_TRANSIT'
      await c.query(
        'INSERT INTO batches (id, variety, plucked_on, farm, status, eta_date, arrived_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [id, variety, pluckedOn, farm, status, addDays(pluckedOn, 2), arrived ? now() : null],
      )
      for (const [sku, qty] of Object.entries(lines)) {
        await c.query('INSERT INTO batch_lines (id, batch_id, sku, on_hand) VALUES ($1, $2, $3, $4)', [newId('bl'), id, sku, qty])
        await ledger(c, { batchId: id, eventType: 'INTAKE', sku, delta: qty, actorType: 'system', actorId: 'seed', reason: 'Demo data' })
      }
      if (rating) {
        await c.query(
          `INSERT INTO batch_qc (id, batch_id, ripeness_rating, condition, notes, logged_by, logged_at) VALUES ($1, $2, $3, 'GOOD', 'Demo reading', 'seed', $4)`,
          [newId('qc'), id, rating, now()],
        )
      }
    }
  })
  logger.info('demo batches seeded')
}

/**
 * The demo varieties and their stock, added once: a variety whose products are
 * already there (or were renamed or removed by a manager, see demo_seed_runs) is left alone.
 */
async function seedDemoVarieties() {
  const today = todayIST()
  await tx(async (c) => {
    const done = await c.query("INSERT INTO demo_seed_runs (name) VALUES ('demo-varieties-v2') ON CONFLICT DO NOTHING RETURNING name")
    if (!done.rowCount) return
    for (const [code, variety, price3, price5, description] of DEMO_VARIETIES) {
      for (const [box, price] of [['3kg', price3], ['5kg', price5]]) {
        await c.query(
          `INSERT INTO products (sku, name, variety, box_size, price, gst_rate, hsn_code, description) VALUES ($1, $2, $3, $4, $5, 0, '08045020', $6) ON CONFLICT DO NOTHING`,
          [`${code}-${box.replace('kg', '')}`, `${variety} ${box} Box`, variety, box, price, description],
        )
      }
    }
    for (const [code, age, status, rating, farm, boxes3, boxes5] of DEMO_BATCHES) {
      const variety = DEMO_VARIETIES.find((v) => v[0] === code)[1]
      const id = newId('bat')
      const pluckedOn = addDays(today, -age)
      await c.query(
        'INSERT INTO batches (id, variety, plucked_on, farm, status, eta_date, arrived_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [id, variety, pluckedOn, farm, status, addDays(pluckedOn, 2), now()],
      )
      for (const [sku, qty] of [[`${code}-3`, boxes3], [`${code}-5`, boxes5]]) {
        if (!qty) continue
        await c.query('INSERT INTO batch_lines (id, batch_id, sku, on_hand) VALUES ($1, $2, $3, $4)', [newId('bl'), id, sku, qty])
        await ledger(c, { batchId: id, eventType: 'INTAKE', sku, delta: qty, actorType: 'system', actorId: 'seed', reason: 'Demo data' })
      }
      if (rating) {
        await c.query(
          `INSERT INTO batch_qc (id, batch_id, ripeness_rating, condition, notes, logged_by, logged_at) VALUES ($1, $2, $3, 'GOOD', 'Demo reading', 'seed', $4)`,
          [newId('qc'), id, rating, now()],
        )
      }
    }
  })
}

// `npm run seed`: reference data (and, outside production, demo logins). On
// Vercel it runs in the API's build step after the migrations.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { pool } = await import('./db.js')
  seed()
    .then(() => pool.end())
    .catch((err) => {
      logger.error({ err }, 'seed failed')
      process.exit(1)
    })
}
