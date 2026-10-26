// Camera scanning without React: when the camera can be used, how to read a
// refusal, and the same-code gate. Kept apart from CameraScanner.tsx so the
// rules run in unit tests (tests/unit/camera.unit.ts).
//
// QR codes are read by the browser's own BarcodeDetector (Chrome and Edge on
// Android, Chrome OS and macOS). Where it is missing the screen says so and the
// hand scanner or typing carries on as before (docs/warehouse/DECISIONS.md).

/** The same code seen again within this long (ms) of its last sighting is not sent twice. */
export const SAME_CODE_MS = 2000

/** How often a frame is checked for a code (ms). */
export const FRAME_MS = 120

/** Frames in a row that may fail to read before the camera gives up and says so. */
export const MAX_FRAME_ERRORS = 25

export type CameraProblem = 'insecure' | 'unsupported' | 'nocamera' | 'denied' | 'busy' | 'hidden' | 'failed'

/** What the screen says for each problem; each ends with the way to carry on. */
export const CAMERA_PROBLEM: Record<CameraProblem, string> = {
  insecure: 'The camera only works over a secure (https) connection. Use the hand scanner or type the code.',
  unsupported: 'This browser cannot read QR codes with the camera. Use the hand scanner or type the code. Chrome on Android can read them.',
  nocamera: 'No camera was found on this device. Use the hand scanner or type the code.',
  denied:
    'Camera permission was refused. To use it, allow the camera for this site in the browser settings (the icon next to the address), then press Use camera again. Until then, use the hand scanner or type the code.',
  busy: 'Another app is using the camera. Close it and press Use camera again, or type the code.',
  hidden: 'The camera was turned off while this page was hidden. Press Use camera to start it again.',
  failed: 'The camera stopped reading codes. Press Use camera to try again, or type the code.',
}

/**
 * Lets a code through unless that same code was seen less than `windowMs`
 * ago. Each code keeps its own last sighting, so two labels in view at once
 * (a box and its shelf) are each sent once, not every frame. Each sighting
 * renews the window, so a label held in front of the camera is sent once,
 * not every two seconds. Codes unseen for longer than the window are forgotten.
 */
export function codeGate(windowMs = SAME_CODE_MS) {
  const seen = new Map<string, number>()
  return (raw: string, now: number): string | null => {
    const code = raw.trim()
    if (!code) return null
    for (const [c, at] of seen) if (now - at >= windowMs) seen.delete(c)
    const recent = seen.has(code)
    seen.set(code, now)
    return recent ? null : code
  }
}

interface DetectorClass {
  getSupportedFormats?: () => Promise<string[]>
}

/** The parts of `window` the check reads (a plain object in tests). */
export interface CameraEnv {
  isSecureContext: boolean
  navigator: { mediaDevices?: { getUserMedia?: unknown } }
  BarcodeDetector?: DetectorClass
}

/** Why the camera cannot be offered here, or null when it can. */
export async function cameraSupport(env: CameraEnv): Promise<CameraProblem | null> {
  if (!env.isSecureContext) return 'insecure'
  if (typeof env.navigator.mediaDevices?.getUserMedia !== 'function') return 'unsupported'
  const Detector = env.BarcodeDetector
  if (!Detector) return 'unsupported'
  if (typeof Detector.getSupportedFormats === 'function') {
    const formats = await Detector.getSupportedFormats()
    if (!formats.includes('qr_code')) return 'unsupported'
  }
  return null
}

/** Reads a getUserMedia refusal (a DOMException) as one of the problems above. */
export function problemFrom(err: unknown): CameraProblem {
  const name = err && typeof err === 'object' && 'name' in err ? String((err as { name: unknown }).name) : ''
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'denied'
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return 'nocamera'
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'busy'
  return 'failed'
}
