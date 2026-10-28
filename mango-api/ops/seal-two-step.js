// Encrypts staff two-step secrets stored before TOTP_ENCRYPTION_KEY was set
// (each one is also sealed on that person's next sign-in with a code).
//
//   node --env-file=.env ops/seal-two-step.js
//
// Safe to run more than once: sealed secrets are left as they are.
import { closePool, tx } from '../src/db.js'
import { sealStoredSecrets } from '../src/secret-box.js'

try {
  const n = await tx((c) => sealStoredSecrets(c))
  console.log(`two-step secrets sealed: ${n} staff account(s)`)
} finally {
  await closePool()
}
