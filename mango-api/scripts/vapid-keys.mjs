// Makes a VAPID key pair for browser notifications (WEB_PUSH, docs/app-feel.md).
//   node scripts/vapid-keys.mjs
// Prints the two lines to put in the API's environment. The private key is a
// secret: keep it in the host's secret store, never in the repository. Changing
// the pair later means every browser has to turn notifications on again.
import { b64url, generateKeyPair } from '../src/webpush.js'

const { publicKey, privateKey } = generateKeyPair()
process.stdout.write(`VAPID_PUBLIC_KEY=${b64url(publicKey)}\nVAPID_PRIVATE_KEY=${b64url(privateKey)}\n`)
