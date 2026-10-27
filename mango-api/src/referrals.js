// Refer a friend (REFERRALS, docs/growth.md).
//
// Every signed-in customer with a mobile number has one stable referral code
// and a share link. A new customer (nothing paid yet) may enter one friend's
// code, once. As soon as that new customer's first order is paid, both people
// get a one-time promo code through the ordinary promo system (promos.js):
// by default 10% off their next order of regular boxes (REFERRAL_REWARD_KIND,
// _PERCENT, _MAX_RUPEES; or a flat REFERRAL_REWARD_RUPEES), usable only by
// them. If that first order is later cancelled or refunded, the codes not used
// yet are withdrawn. Every check is made here, on the server:
//   - no self-referral: not the same account, phone or delivery address, and
//     not two accounts referring each other;
//   - one referral per new customer (referrals.friend_id is UNIQUE);
//   - at most REFERRAL_MAX_PER_MONTH thank-yous per referrer per IST month;
//   - a reward exactly once: the referral row is locked while it is settled,
//     and referral_rewards is UNIQUE (referral_id, role), so a retried or
//     overlapping run gives nothing twice;
//   - a first order that was cancelled or refunded, or smaller than
//     REFERRAL_MIN_ORDER_RUPEES of regular boxes, earns nothing (and takes
//     back unused codes it already earned).
// The maintenance loop settles referrals (settleReferrals); nothing here
// touches stock, payments or order status.
import { randomInt } from 'node:crypto'
import { outOfTime } from './budget.js'
import { addDays, now, todayIST } from './clock.js'
import { query, tx } from './db.js'
import { env } from './env.js'
import { badRequest, conflict, HttpError } from './errors.js'
import { newId } from './ids.js'
import { logger } from './logger.js'
import { enqueueCustomerPush } from './push.js'
import { isOn } from './feature-switches.js'

/** Letters and digits that can't be misread for each other (no 0/O, 1/I/L). */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const randomCode = (n) => Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')

/** How long a thank-you code can be used for. */
export const REWARD_DAYS = 90
const SETTLE_BATCH = 200

export const rewardPaise = () => env.REFERRAL_REWARD_RUPEES * 100
/** The thank-you as the promo system stores it: { kind, value, maxDiscount } (value is a percent or paise). */
export const rewardTerms = () =>
  env.REFERRAL_REWARD_KIND === 'FLAT'
    ? { kind: 'FLAT', value: rewardPaise(), maxDiscount: null }
    : { kind: 'PERCENT', value: env.REFERRAL_REWARD_PERCENT, maxDiscount: env.REFERRAL_REWARD_MAX_RUPEES ? env.REFERRAL_REWARD_MAX_RUPEES * 100 : null }
/** The reward rules the shop and panel show. */
export const rewardRules = () => ({
  rewardKind: env.REFERRAL_REWARD_KIND,
  rewardPercent: env.REFERRAL_REWARD_KIND === 'PERCENT' ? env.REFERRAL_REWARD_PERCENT : null,
  rewardMaxRupees: env.REFERRAL_REWARD_KIND === 'PERCENT' ? (env.REFERRAL_REWARD_MAX_RUPEES ?? null) : null,
  rewardRupees: env.REFERRAL_REWARD_KIND === 'FLAT' ? env.REFERRAL_REWARD_RUPEES : null,
  minOrderRupees: env.REFERRAL_MIN_ORDER_RUPEES,
})
export const minOrderPaise = () => env.REFERRAL_MIN_ORDER_RUPEES * 100

export const normaliseReferralCode = (s) => String(s ?? '').trim().toUpperCase().replace(/[\s-]/g, '')

/** Why a referral ended without a reward, in words for the customer and staff. */
export const VOID_REASONS = {
  ORDER_CANCELLED: 'The first order was cancelled or refunded',
  ORDER_CANCELLED_AFTER_REWARD: 'The first order was cancelled or refunded, so unused thank-you codes were withdrawn',
  ORDER_TOO_SMALL: 'The first order was smaller than the minimum',
  SAME_PHONE: 'The order went to the referrer’s own number',
  SAME_ADDRESS: 'The order went to the referrer’s own address',
  ACCOUNT_DELETED: 'One of the accounts was deleted',
}

/** Two addresses are "the same" when they match ignoring case, spaces and punctuation. */
export const sameAddressKey = (s) => {
  const k = String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  return k.length >= 8 ? k : null
}

const shopUrl = () => env.CUSTOMER_ORIGIN.split(',')[0]?.trim().replace(/\/$/, '') || 'https://mandimangoes.in'
export const shareUrl = (code) => `${shopUrl()}/invite/${encodeURIComponent(code)}`

/** The customer's code, made the first time it is asked for. Needs a mobile number on the account. */
export async function ensureReferralCode(c, customerId) {
  for (let i = 0; i < 6; i++) {
    const { rows } = await c.query('SELECT code FROM referral_codes WHERE customer_id = $1', [customerId])
    if (rows.length) return rows[0].code
    await c.query('INSERT INTO referral_codes (customer_id, code, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [
      customerId, randomCode(8), now(),
    ])
  }
  throw new Error('could not make a unique referral code')
}

/** Nothing paid yet: no order or booking that took money. Unpaid and abandoned checkouts don't count. */
export async function isNewCustomer(c, customerId) {
  const { rows } = await c.query(
    `SELECT EXISTS (SELECT 1 FROM orders WHERE customer_id = $1 AND (payment_status IN ('SUCCEEDED', 'REFUNDED') OR status NOT IN ('PAYMENT_PENDING', 'CANCELLED')))
         OR EXISTS (SELECT 1 FROM preorders WHERE customer_id = $1 AND payment_status IN ('SUCCEEDED', 'REFUNDED')) AS paid`,
    [customerId],
  )
  return !rows[0].paid
}

/** Every address the customer has saved or ordered to, as comparison keys. */
async function addressKeys(c, customerId) {
  const { rows } = await c.query(
    `SELECT address AS a FROM customer_addresses WHERE customer_id = $1
     UNION SELECT delivery_address FROM orders WHERE customer_id = $1 AND delivery_address IS NOT NULL`,
    [customerId],
  )
  return new Set(rows.map((r) => sameAddressKey(r.a)).filter(Boolean))
}

const REFUSED = (message, code, status = 400) => new HttpError(status, code, message)

/**
 * A new customer enters a friend's code. Refused when it is their own (account,
 * phone, address), when they have entered one before, when they have paid for
 * something already, or when the two accounts would refer each other.
 */
export async function applyReferral(c, friendId, rawCode) {
  const code = normaliseReferralCode(rawCode)
  if (!/^[A-Z0-9]{6,12}$/.test(code)) throw badRequest('That referral code is not valid', 'REFERRAL_INVALID')
  const { rows: me } = await c.query('SELECT id, phone FROM customers WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [friendId])
  if (!me.length) throw badRequest('Sign in again to use a referral code', 'REFERRAL_INVALID')
  if (!me[0].phone) throw conflict('Add your mobile number first', 'PHONE_REQUIRED')
  const { rows: owner } = await c.query(
    `SELECT rc.customer_id, cu.phone FROM referral_codes rc JOIN customers cu ON cu.id = rc.customer_id
      WHERE rc.code = $1 AND cu.deleted_at IS NULL`,
    [code],
  )
  if (!owner.length) throw badRequest('That referral code is not valid', 'REFERRAL_INVALID')
  const referrer = owner[0]
  if (referrer.customer_id === friendId || (referrer.phone && referrer.phone === me[0].phone)) {
    throw REFUSED('That is your own referral code. Share it with a friend instead.', 'REFERRAL_SELF')
  }
  const { rows: had } = await c.query('SELECT 1 FROM referrals WHERE friend_id = $1', [friendId])
  if (had.length) throw REFUSED('You have already used a referral code', 'REFERRAL_ALREADY_USED', 409)
  if (!(await isNewCustomer(c, friendId))) throw REFUSED('Referral codes are for a first order, and you have ordered with us before', 'REFERRAL_NOT_NEW', 409)
  const { rows: ring } = await c.query('SELECT 1 FROM referrals WHERE referrer_id = $1 AND friend_id = $2', [friendId, referrer.customer_id])
  if (ring.length) throw REFUSED('You referred this person, so their code cannot be used by you', 'REFERRAL_SELF')
  const mine = await addressKeys(c, friendId)
  const theirs = await addressKeys(c, referrer.customer_id)
  if ([...mine].some((k) => theirs.has(k))) throw REFUSED('This code belongs to someone at your own address', 'REFERRAL_SELF')
  const { rows } = await c.query(
    `INSERT INTO referrals (id, referrer_id, friend_id, code, created_at) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (friend_id) DO NOTHING RETURNING *`,
    [newId('ref'), referrer.customer_id, friendId, code, now()],
  )
  if (!rows.length) throw REFUSED('You have already used a referral code', 'REFERRAL_ALREADY_USED', 409)
  logger.info({ referralId: rows[0].id }, 'referral code entered')
  return rows[0]
}

/** What the Account page shows: the customer's code and link, the code they entered, and their thank-you codes. */
export async function referralView(c, customerId) {
  const { rows: cu } = await c.query('SELECT phone FROM customers WHERE id = $1', [customerId])
  const hasPhone = Boolean(cu[0]?.phone)
  const code = hasPhone ? await ensureReferralCode(c, customerId) : null
  const [entered, friends, rewards] = await Promise.all([
    c.query('SELECT status, void_reason, created_at FROM referrals WHERE friend_id = $1', [customerId]),
    c.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending, COUNT(*) FILTER (WHERE status = 'REWARDED' AND NOT referrer_capped)::int AS rewarded
         FROM referrals WHERE referrer_id = $1`,
      [customerId],
    ),
    c.query(
      `SELECT rr.promo_code, rr.amount, rr.role, rr.created_at, p.kind, p.value, p.max_discount, p.ends_on, p.min_subtotal, p.active, rr.withdrawn_at,
              EXISTS (SELECT 1 FROM promo_redemptions r JOIN orders o ON o.id = r.order_id WHERE r.code = rr.promo_code AND o.status <> 'CANCELLED') AS used
         FROM referral_rewards rr JOIN promo_codes p ON p.code = rr.promo_code
        WHERE rr.customer_id = $1 ORDER BY rr.created_at DESC`,
      [customerId],
    ),
  ])
  const e = entered.rows[0]
  return {
    code,
    shareUrl: code ? shareUrl(code) : null,
    ...rewardRules(),
    // A new customer with a number who hasn't entered a code yet.
    canEnterCode: hasPhone && !e && (await isNewCustomer(c, customerId)),
    entered: e ? { status: e.status, reason: e.void_reason ? (VOID_REASONS[e.void_reason] ?? e.void_reason) : null, at: e.created_at } : null,
    friends: friends.rows[0],
    rewards: rewards.rows.map((r) => ({
      code: r.promo_code, kind: r.kind, percent: r.kind === 'PERCENT' ? r.value : null, amount: r.kind === 'FLAT' ? r.value : null, maxDiscount: r.max_discount,
      minSubtotal: r.min_subtotal, endsOn: r.ends_on, for: r.role === 'FRIEND' ? 'your first order' : 'a friend',
      state: r.used ? 'USED' : r.withdrawn_at ? 'WITHDRAWN' : !r.active || (r.ends_on && r.ends_on < todayIST()) ? 'EXPIRED' : 'READY',
    })),
  }
}

// ---------------------------------------------------------------- settling

/**
 * Settles referrals whose new customer has paid for a first order (or whose
 * first order was cancelled or refunded), or where an account was deleted; then
 * withdraws unused thank-you codes whose first order was cancelled or refunded
 * after the reward. Run by the
 * maintenance loop every minute; safe to run twice at once or again after a
 * failure. Returns { rewarded, voided } (withdrawn counts as voided).
 */
export async function settleReferrals(at = now()) {
  if (!isOn('REFERRALS')) return { rewarded: 0, voided: 0 }
  const { rows } = await query(
    `SELECT r.id FROM referrals r
      WHERE r.status = 'PENDING' AND (
        EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = r.friend_id AND o.replacement_for IS NULL
                   AND o.payment_status IN ('SUCCEEDED', 'REFUNDED'))
        OR EXISTS (SELECT 1 FROM customers cu WHERE cu.id IN (r.friend_id, r.referrer_id) AND cu.deleted_at IS NOT NULL))
      ORDER BY r.created_at LIMIT $1`,
    [SETTLE_BATCH],
  )
  const out = { rewarded: 0, voided: 0 }
  for (const { id } of rows) {
    if (outOfTime(2_000)) break
    const r = await tx((c) => settleOne(c, id, at))
    if (r === 'REWARDED') out.rewarded++
    if (r === 'VOID') out.voided++
  }
  // Rewarded, then the first order was cancelled or refunded: take back what was not used yet.
  const { rows: undone } = await query(
    `SELECT r.id FROM referrals r JOIN orders o ON o.id = r.order_id
      WHERE r.status = 'REWARDED' AND (o.status = 'CANCELLED' OR o.payment_status = 'REFUNDED' OR o.refund_requested_at IS NOT NULL)
      ORDER BY r.settled_at LIMIT $1`,
    [SETTLE_BATCH],
  )
  for (const { id } of undone) {
    if (outOfTime(2_000)) break
    if ((await tx((c) => withdrawOne(c, id, at))) === 'VOID') out.voided++
  }
  return out
}

/**
 * A rewarded referral whose first order was then cancelled or refunded: its thank-you codes that
 * nobody has used on a live order are switched off and marked withdrawn; a code already used stays
 * used (nothing is charged back). The referral ends as VOID. Locked, so it happens once.
 */
export async function withdrawOne(c, id, at = now()) {
  const { rows } = await c.query('SELECT * FROM referrals WHERE id = $1 FOR UPDATE', [id])
  const r = rows[0]
  if (!r || r.status !== 'REWARDED' || !r.order_id) return null
  const { rows: o } = await c.query('SELECT status, payment_status, refund_requested_at FROM orders WHERE id = $1', [r.order_id])
  if (!o[0] || !(o[0].status === 'CANCELLED' || o[0].payment_status === 'REFUNDED' || o[0].refund_requested_at)) return null
  const { rows: gone } = await c.query(
    `UPDATE referral_rewards rr SET withdrawn_at = $2
      WHERE rr.referral_id = $1 AND rr.withdrawn_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM promo_redemptions pr JOIN orders po ON po.id = pr.order_id WHERE pr.code = rr.promo_code AND po.status <> 'CANCELLED')
      RETURNING rr.promo_code`,
    [r.id, at],
  )
  if (gone.length) await c.query('UPDATE promo_codes SET active = FALSE WHERE code = ANY($1)', [gone.map((g) => g.promo_code)])
  await c.query(`UPDATE referrals SET status = 'VOID', void_reason = 'ORDER_CANCELLED_AFTER_REWARD', settled_at = $2 WHERE id = $1`, [r.id, at])
  logger.info({ referralId: r.id, withdrawn: gone.length }, 'referral thank-you codes withdrawn after the first order was cancelled')
  return 'VOID'
}

async function voidReferral(c, r, reason, at, orderId = null) {
  await c.query(`UPDATE referrals SET status = 'VOID', void_reason = $2, settled_at = $3, order_id = COALESCE($4, order_id) WHERE id = $1`, [r.id, reason, at, orderId])
  logger.info({ referralId: r.id, reason }, 'referral ended without a reward')
  return 'VOID'
}

/** One referral, in its own transaction with its row locked. Returns its new status, or null when it waits. */
export async function settleOne(c, id, at = now()) {
  const { rows } = await c.query('SELECT * FROM referrals WHERE id = $1 FOR UPDATE', [id])
  const r = rows[0]
  if (!r || r.status !== 'PENDING') return null
  const { rows: people } = await c.query('SELECT id, phone, name, deleted_at FROM customers WHERE id = ANY($1)', [[r.referrer_id, r.friend_id]])
  const referrer = people.find((p) => p.id === r.referrer_id)
  const friend = people.find((p) => p.id === r.friend_id)
  if (!referrer || !friend || referrer.deleted_at || friend.deleted_at) return voidReferral(c, r, 'ACCOUNT_DELETED', at)
  // The friend's first order that took money; replacements are free and never count.
  const { rows: first } = await c.query(
    `SELECT * FROM orders WHERE customer_id = $1 AND replacement_for IS NULL AND payment_status IN ('SUCCEEDED', 'REFUNDED')
      ORDER BY placed_at, id LIMIT 1`,
    [r.friend_id],
  )
  const o = first[0]
  if (!o) return null
  if (o.status === 'CANCELLED' || o.payment_status === 'REFUNDED' || o.refund_requested_at) return voidReferral(c, r, 'ORDER_CANCELLED', at, o.id)
  // Regular boxes only, before any discount: bulk deals carry their own price (as for promo codes).
  const { rows: sub } = await c.query('SELECT COALESCE(SUM(line_price), 0)::int AS n FROM order_items WHERE order_id = $1 AND listing_id IS NULL', [o.id])
  if (sub[0].n < minOrderPaise()) return voidReferral(c, r, 'ORDER_TOO_SMALL', at, o.id)
  if (referrer.phone && (o.phone === referrer.phone || o.gift_recipient_phone === referrer.phone)) return voidReferral(c, r, 'SAME_PHONE', at, o.id)
  const key = sameAddressKey(o.delivery_address)
  if (key && (await addressKeys(c, r.referrer_id)).has(key)) return voidReferral(c, r, 'SAME_ADDRESS', at, o.id)

  // The referrer's code row is locked so two of their friends settling at once count the month's cap one after the other.
  await c.query('SELECT 1 FROM referral_codes WHERE customer_id = $1 FOR UPDATE', [r.referrer_id])
  const month = `${todayIST(at).slice(0, 7)}-01`
  const { rows: given } = await c.query(
    `SELECT COUNT(*)::int AS n FROM referral_rewards WHERE customer_id = $1 AND role = 'REFERRER' AND created_at >= ($2::date)::timestamp AT TIME ZONE 'Asia/Kolkata'`,
    [r.referrer_id, month],
  )
  const capped = given[0].n >= env.REFERRAL_MAX_PER_MONTH
  await giveReward(c, r, 'FRIEND', friend, at)
  if (!capped) await giveReward(c, r, 'REFERRER', referrer, at)
  await c.query(`UPDATE referrals SET status = 'REWARDED', settled_at = $2, order_id = $3, referrer_capped = $4 WHERE id = $1`, [r.id, at, o.id, capped])
  logger.info({ referralId: r.id, referrerCapped: capped }, 'referral rewarded')
  return 'REWARDED'
}

/** Makes one one-time promo code for `who` and queues the message saying so. Exactly once per referral and side. */
async function giveReward(c, r, role, who, at) {
  const terms = rewardTerms()
  let code = null
  for (let i = 0; i < 6 && !code; i++) {
    const { rows } = await c.query(
      `INSERT INTO promo_codes (code, kind, value, max_discount, min_subtotal, ends_on, max_uses, per_customer, first_order_only, active, description,
                                created_by, created_at, owner_customer_id)
       VALUES ($1, $2, $3, $4, $5, $6, 1, 1, FALSE, TRUE, $7, 'referrals', $8, $9) ON CONFLICT (code) DO NOTHING RETURNING code`,
      [`TY${randomCode(8)}`, terms.kind, terms.value, terms.maxDiscount, minOrderPaise(), addDays(todayIST(at), REWARD_DAYS), 'Referral thank-you', at, who.id],
    )
    code = rows[0]?.code ?? null
  }
  if (!code) throw new Error('could not make a unique reward code')
  const rewardId = newId('rwd')
  const { rows } = await c.query(
    `INSERT INTO referral_rewards (id, referral_id, role, customer_id, promo_code, amount, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (referral_id, role) DO NOTHING RETURNING id`,
    [rewardId, r.id, role, who.id, code, terms.value, at],
  )
  if (!rows.length) {
    // Already given (cannot happen under the row lock, but never twice): the spare code goes.
    await c.query('DELETE FROM promo_codes WHERE code = $1', [code])
    return
  }
  if (who.phone) {
    await c.query(
      `INSERT INTO notifications (id, referral_reward_id, event_id, kind, phone, next_attempt_at, created_at)
       VALUES ($1, $2, $2, 'REFERRAL_REWARD', $3, $4, $4) ON CONFLICT (event_id, kind) DO NOTHING`,
      [newId('ntf'), rewardId, who.phone, at],
    )
  }
  await enqueueCustomerPush(c, who.id, rewardId, 'REFERRAL_REWARD')
}

// ---------------------------------------------------------------- staff view

const maskPhone = (p) => (p ? `${p.slice(0, -6)}••••${p.slice(-2)}` : null)

/** Referrals for the managers' Referrals view, newest first. */
export async function listReferrals({ status = null, limit = 200 } = {}) {
  const { rows } = await query(
    `SELECT r.*, rf.name AS referrer_name, rf.phone AS referrer_phone, fr.name AS friend_name, fr.phone AS friend_phone, o.number AS order_number,
            (SELECT json_agg(json_build_object('role', rr.role, 'code', rr.promo_code, 'kind', rp.kind, 'value', rp.value, 'maxDiscount', rp.max_discount, 'withdrawn', rr.withdrawn_at IS NOT NULL,
                     'used', EXISTS (SELECT 1 FROM promo_redemptions pr JOIN orders po ON po.id = pr.order_id WHERE pr.code = rr.promo_code AND po.status <> 'CANCELLED'))
                     ORDER BY rr.role) FROM referral_rewards rr JOIN promo_codes rp ON rp.code = rr.promo_code WHERE rr.referral_id = r.id) AS rewards
       FROM referrals r JOIN customers rf ON rf.id = r.referrer_id JOIN customers fr ON fr.id = r.friend_id
       LEFT JOIN orders o ON o.id = r.order_id
      WHERE ($1::text IS NULL OR r.status = $1) ORDER BY r.created_at DESC LIMIT $2`,
    [status, limit],
  )
  const { rows: counts } = await query(`SELECT status, COUNT(*)::int AS n FROM referrals GROUP BY status`)
  return {
    counts: { PENDING: 0, REWARDED: 0, VOID: 0, ...Object.fromEntries(counts.map((x) => [x.status, x.n])) },
    rules: { ...rewardRules(), maxPerMonth: env.REFERRAL_MAX_PER_MONTH },
    items: rows.map((r) => ({
      id: r.id, code: r.code, status: r.status, reason: r.void_reason ? (VOID_REASONS[r.void_reason] ?? r.void_reason) : null,
      referrerCapped: r.referrer_capped, createdAt: r.created_at, settledAt: r.settled_at,
      referrer: { id: r.referrer_id, name: r.referrer_name, phone: maskPhone(r.referrer_phone) },
      friend: { id: r.friend_id, name: r.friend_name, phone: maskPhone(r.friend_phone) },
      order: r.order_id ? { id: r.order_id, number: r.order_number } : null,
      rewards: r.rewards ?? [],
    })),
  }
}
