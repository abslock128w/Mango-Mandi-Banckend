// Web Push without a library: the message is encrypted for the browser
// (RFC 8291, "aes128gcm" content coding from RFC 8188) and the request carries
// a VAPID token signed with our application server key (RFC 8292). Everything
// here is node:crypto; there is no dependency to keep up to date.
//
// A sender takes one subscription and one payload and answers { status }. The
// real one posts to the browser's push service; WEB_PUSH_PROVIDER=log (the
// default) only logs, and tests swap in a stub (push.js usePushSender).
import { createCipheriv, createDecipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign } from 'node:crypto'

/** One record holds the whole message: payloads are small and the record size is generous. */
export const RECORD_SIZE = 4096
/** The most a payload may be: one record, less the padding delimiter and the AES-GCM tag. */
export const MAX_PAYLOAD = RECORD_SIZE - 17
/** VAPID tokens last 12 hours (RFC 8292 allows up to 24). */
const VAPID_TTL_S = 12 * 3600

export const b64url = (buf) => Buffer.from(buf).toString('base64url')
export const fromB64url = (s) => Buffer.from(String(s), 'base64url')

const hkdf = (ikm, salt, info, length) => Buffer.from(hkdfSync('sha256', ikm, salt, info, length))

/** A fresh P-256 key pair as raw bytes: public is the 65-byte uncompressed point, private the 32-byte scalar. */
export function generateKeyPair() {
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  const d = ecdh.getPrivateKey()
  // Always 32 bytes, even for a scalar with leading zero bytes.
  return { publicKey: ecdh.getPublicKey(), privateKey: Buffer.concat([Buffer.alloc(32 - d.length), d]) }
}

/** True for a usable browser public key (p256dh): 65 bytes, uncompressed, on the curve. */
export function validPublicKey(raw) {
  if (!Buffer.isBuffer(raw) || raw.length !== 65 || raw[0] !== 0x04) return false
  try {
    const probe = createECDH('prime256v1')
    probe.generateKeys()
    probe.computeSecret(raw)
    return true
  } catch {
    return false
  }
}

/** The keys both sides derive (RFC 8291 section 3.4): the content key and the nonce. */
function contentKeys({ ecdhSecret, authSecret, uaPublic, asPublic, salt }) {
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic])
  const ikm = hkdf(ecdhSecret, authSecret, keyInfo, 32)
  return {
    cek: hkdf(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16),
    nonce: hkdf(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12),
  }
}

/**
 * Encrypts `payload` for one browser (RFC 8291). `p256dh` and `auth` are the
 * subscription's keys as raw bytes. `asKeys` and `salt` are for tests only:
 * every real message gets a new ephemeral key and salt.
 * Returns the request body: header (salt, record size, our public key) then one record.
 */
export function encrypt(payload, { p256dh, auth }, { asKeys = null, salt = randomBytes(16) } = {}) {
  const plain = Buffer.from(payload)
  if (plain.length > MAX_PAYLOAD) throw new Error(`push payload too large (${plain.length} bytes)`)
  if (!validPublicKey(p256dh)) throw new Error('the subscription key is not a P-256 point')
  if (!Buffer.isBuffer(auth) || auth.length !== 16) throw new Error('the subscription auth secret must be 16 bytes')
  const ecdh = createECDH('prime256v1')
  if (asKeys) ecdh.setPrivateKey(asKeys.privateKey)
  else ecdh.generateKeys()
  const asPublic = ecdh.getPublicKey()
  const { cek, nonce } = contentKeys({ ecdhSecret: ecdh.computeSecret(p256dh), authSecret: auth, uaPublic: p256dh, asPublic, salt })
  const cipher = createCipheriv('aes-128-gcm', cek, nonce)
  // 0x02: the last (and only) record; no padding after it.
  const body = Buffer.concat([cipher.update(Buffer.concat([plain, Buffer.from([0x02])])), cipher.final(), cipher.getAuthTag()])
  const header = Buffer.alloc(21)
  salt.copy(header, 0)
  header.writeUInt32BE(RECORD_SIZE, 16)
  header.writeUInt8(asPublic.length, 20)
  return Buffer.concat([header, asPublic, body])
}

/**
 * What the browser does with a message: the inverse of encrypt, given the
 * browser's private key. Used by the tests to prove the round trip.
 */
export function decrypt(body, { privateKey, publicKey, auth }) {
  const salt = body.subarray(0, 16)
  const rs = body.readUInt32BE(16)
  const idLen = body.readUInt8(20)
  const asPublic = body.subarray(21, 21 + idLen)
  const record = body.subarray(21 + idLen)
  if (record.length > rs) throw new Error('record larger than the record size')
  const ecdh = createECDH('prime256v1')
  ecdh.setPrivateKey(privateKey)
  const { cek, nonce } = contentKeys({ ecdhSecret: ecdh.computeSecret(asPublic), authSecret: auth, uaPublic: publicKey, asPublic, salt })
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce)
  decipher.setAuthTag(record.subarray(record.length - 16))
  const padded = Buffer.concat([decipher.update(record.subarray(0, record.length - 16)), decipher.final()])
  // Strip padding (zeros) back to the delimiter: 0x02 marks the last record.
  let end = padded.length - 1
  while (end >= 0 && padded[end] === 0) end--
  if (end < 0 || padded[end] !== 0x02) throw new Error('missing the last-record delimiter')
  return padded.subarray(0, end)
}

/** The application server's private key as a KeyObject, from the raw base64url keys (RFC 8292 format). */
export function vapidKey(publicKey, privateKey) {
  const pub = fromB64url(publicKey)
  const d = fromB64url(privateKey)
  if (pub.length !== 65 || pub[0] !== 0x04 || d.length !== 32) throw new Error('VAPID keys must be a 65-byte public point and a 32-byte private key, base64url')
  const check = createECDH('prime256v1')
  check.setPrivateKey(d)
  if (!check.getPublicKey().equals(pub)) throw new Error('the VAPID private key does not belong to the public key')
  return createPrivateKey({ key: { kty: 'EC', crv: 'P-256', x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33)), d: b64url(d) }, format: 'jwk' })
}

/**
 * The VAPID Authorization header for one push service (RFC 8292): a JWT
 * (ES256) for the endpoint's origin, signed with our key, plus our public key.
 */
export function vapidAuthorization(endpoint, { publicKey, privateKey, subject, nowS = Math.floor(Date.now() / 1000) }) {
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))
  const claims = b64url(JSON.stringify({ aud: new URL(endpoint).origin, exp: nowS + VAPID_TTL_S, sub: subject }))
  const signed = `${header}.${claims}`
  const signature = sign('sha256', Buffer.from(signed), { key: vapidKey(publicKey, privateKey), dsaEncoding: 'ieee-p1363' })
  return `vapid t=${signed}.${b64url(signature)}, k=${publicKey}`
}

/**
 * A sender that posts to the push service. `ttl` is how long the service may
 * keep the message for an offline browser; `topic` replaces an older message
 * still waiting under the same topic (so a phone that was off gets the latest
 * order step, not every one).
 */
export function vapidSender({ publicKey, privateKey, subject, timeoutMs = 10_000 }, fetchImpl = fetch) {
  return async function sendWebPush(sub, { payload, ttl = 24 * 3600, urgency = 'normal', topic = null }) {
    const body = encrypt(payload, { p256dh: fromB64url(sub.p256dh), auth: fromB64url(sub.auth) })
    const res = await fetchImpl(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: vapidAuthorization(sub.endpoint, { publicKey, privateKey, subject }),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(ttl),
        Urgency: urgency,
        ...(topic ? { Topic: topic } : {}),
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    })
    // The answer's body is the push service's, not ours: only the status matters.
    await res.arrayBuffer().catch(() => null)
    return { status: res.status }
  }
}
