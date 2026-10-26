import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CAMERA_PROBLEM, cameraSupport, codeGate, FRAME_MS, problemFrom, SAME_CODE_MS } from '../../src/warehouse/camera.ts'

// Camera scanning rules (9.7), without a browser: when the camera is offered,
// how a refusal reads, and the two-second same-code gate.

test('the same code is sent once while it stays in view, and again after two quiet seconds', () => {
  const gate = codeGate()
  assert.equal(gate('ABCD-EFGH-K', 0), 'ABCD-EFGH-K')
  assert.equal(gate('ABCD-EFGH-K', 500), null)
  assert.equal(gate('ABCD-EFGH-K', 1900), null)
  // Still in view: each sighting renews the window.
  assert.equal(gate('ABCD-EFGH-K', 3800), null)
  assert.equal(gate('ABCD-EFGH-K', 3800 + SAME_CODE_MS), 'ABCD-EFGH-K')
})

test('a different code goes straight through; the first one stays suppressed within its own two seconds', () => {
  const gate = codeGate()
  assert.equal(gate('AAAA-AAAA-A', 0), 'AAAA-AAAA-A')
  assert.equal(gate('BBBB-BBBB-B', 100), 'BBBB-BBBB-B')
  assert.equal(gate('AAAA-AAAA-A', 200), null)
  // Out of view for two seconds: sent again.
  assert.equal(gate('AAAA-AAAA-A', 200 + SAME_CODE_MS), 'AAAA-AAAA-A')
})

test('two labels in view at once are each sent once, not every frame', () => {
  const gate = codeGate()
  const sent: string[] = []
  // A box label and a shelf label in every frame for five seconds.
  for (let t = 0; t <= 5000; t += FRAME_MS) {
    for (const raw of ['BOX-AAAA', 'LOC-SHELF']) {
      const code = gate(raw, t)
      if (code) sent.push(code)
    }
  }
  assert.deepEqual(sent, ['BOX-AAAA', 'LOC-SHELF'])
})

test('blank reads are dropped and codes are trimmed', () => {
  const gate = codeGate()
  assert.equal(gate('   ', 0), null)
  assert.equal(gate(' LOC-1 \n', 10), 'LOC-1')
  assert.equal(gate('LOC-1', 20), null)
})

const ok = { isSecureContext: true, navigator: { mediaDevices: { getUserMedia: () => undefined } }, BarcodeDetector: { getSupportedFormats: async () => ['qr_code', 'code_128'] } }

test('the camera is offered only over https, with getUserMedia and a QR-capable BarcodeDetector', async () => {
  assert.equal(await cameraSupport(ok), null)
  assert.equal(await cameraSupport({ ...ok, isSecureContext: false }), 'insecure')
  assert.equal(await cameraSupport({ ...ok, navigator: {} }), 'unsupported')
  assert.equal(await cameraSupport({ ...ok, BarcodeDetector: undefined }), 'unsupported')
  assert.equal(await cameraSupport({ ...ok, BarcodeDetector: { getSupportedFormats: async () => ['ean_13'] } }), 'unsupported')
  // A detector without the format list is tried.
  assert.equal(await cameraSupport({ ...ok, BarcodeDetector: {} }), null)
})

test('a refusal reads as denied, no camera, busy or failed, and every message says how to carry on', () => {
  assert.equal(problemFrom({ name: 'NotAllowedError' }), 'denied')
  assert.equal(problemFrom({ name: 'SecurityError' }), 'denied')
  assert.equal(problemFrom({ name: 'NotFoundError' }), 'nocamera')
  assert.equal(problemFrom({ name: 'OverconstrainedError' }), 'nocamera')
  assert.equal(problemFrom({ name: 'NotReadableError' }), 'busy')
  assert.equal(problemFrom(new Error('boom')), 'failed')
  assert.equal(problemFrom(null), 'failed')
  for (const [k, text] of Object.entries(CAMERA_PROBLEM)) assert.match(text, /type the code|Use camera/, k)
})
