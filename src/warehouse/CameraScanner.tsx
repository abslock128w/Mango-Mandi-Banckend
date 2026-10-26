// Scanning with the device camera (9.7). Each QR code read goes to `onCode`,
// which puts it in the same scan queue as a hand scanner (scanQueue.ts), so it
// gets its scanId, retries and stop-on-error exactly like a typed scan.
//
// The camera starts only when asked, and is let go when the screen closes,
// when the page is hidden (another tab, the phone locked) or when it is
// stopped. The rules live in camera.ts.

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { CAMERA_PROBLEM, cameraSupport, codeGate, FRAME_MS, MAX_FRAME_ERRORS, problemFrom, type CameraEnv, type CameraProblem } from './camera'

interface DetectedCode {
  rawValue: string
}
interface Detector {
  detect: (source: HTMLVideoElement) => Promise<DetectedCode[]>
}
type DetectorCtor = new (opts: { formats: string[] }) => Detector

/** Torch is not in the DOM typings yet. */
type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean }
type TorchConstraints = MediaTrackConstraintSet & { torch?: boolean }

type State = 'off' | 'starting' | 'on'

export function CameraScanner({ onCode }: { onCode: (code: string) => void }) {
  const id = useId()
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | undefined>(undefined)
  /** Bumped by every start and stop, so a camera that opens after a stop is closed at once. */
  const runRef = useRef(0)
  const onCodeRef = useRef(onCode)
  onCodeRef.current = onCode

  const [state, setState] = useState<State>('off')
  const [problem, setProblem] = useState<CameraProblem | null>(null)
  const [cameras, setCameras] = useState<{ deviceId: string; label: string }[]>([])
  const [deviceId, setDeviceId] = useState('')
  const [torch, setTorch] = useState<{ supported: boolean; on: boolean }>({ supported: false, on: false })
  const [torchError, setTorchError] = useState<string | null>(null)

  const release = useCallback(() => {
    runRef.current++
    window.clearTimeout(timerRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  const stop = useCallback(
    (why: CameraProblem | null = null) => {
      release()
      setState('off')
      setTorch({ supported: false, on: false })
      setProblem(why)
    },
    [release],
  )

  // Let the camera go when the screen closes and whenever the page is hidden.
  useEffect(() => release, [release])
  useEffect(() => {
    function onHide() {
      if (document.visibilityState === 'hidden' && streamRef.current) stop('hidden')
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onHide)
    }
  }, [stop])

  async function start(wanted?: string) {
    release()
    setProblem(null)
    setTorchError(null)
    const env = window as unknown as CameraEnv & { BarcodeDetector?: DetectorCtor }
    const why = await cameraSupport(env)
    if (why) return stop(why)
    const run = runRef.current
    setState('starting')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: wanted ? { deviceId: { exact: wanted } } : { facingMode: { ideal: 'environment' } },
      })
    } catch (err) {
      return stop(problemFrom(err))
    }
    if (run !== runRef.current) {
      // Stopped (or the page hidden) while the browser was asking: give it straight back.
      stream.getTracks().forEach((t) => t.stop())
      return
    }
    streamRef.current = stream
    const video = videoRef.current
    if (!video) return stop('failed')
    video.srcObject = stream
    try {
      await video.play()
    } catch (err) {
      return stop(problemFrom(err))
    }
    const track = stream.getVideoTracks()[0]
    const caps = (typeof track.getCapabilities === 'function' ? track.getCapabilities() : {}) as TorchCapabilities
    setTorch({ supported: caps.torch === true, on: false })
    setDeviceId(track.getSettings().deviceId ?? '')
    // Labels are readable once permission is given; the list offers a choice only when there is one.
    const devices = await navigator.mediaDevices.enumerateDevices()
    setCameras(devices.filter((d) => d.kind === 'videoinput').map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` })))
    setState('on')

    const Ctor = env.BarcodeDetector as DetectorCtor
    const detector = new Ctor({ formats: ['qr_code'] })
    const gate = codeGate()
    let errors = 0
    const tick = async () => {
      if (run !== runRef.current) return
      try {
        if (video.readyState >= 2) {
          for (const found of await detector.detect(video)) {
            const code = gate(found.rawValue, performance.now())
            if (code) onCodeRef.current(code)
          }
        }
        errors = 0
      } catch (err) {
        // A frame can fail while the camera settles; many in a row means it is not reading.
        if (++errors >= MAX_FRAME_ERRORS) {
          console.warn('Camera scanning stopped: frames could not be read', err instanceof Error ? err.name : err)
          return stop('failed')
        }
      }
      if (run === runRef.current) timerRef.current = window.setTimeout(() => void tick(), FRAME_MS)
    }
    void tick()
  }

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    const next = !torch.on
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as TorchConstraints] })
      setTorch({ supported: true, on: next })
      setTorchError(null)
    } catch {
      setTorchError('The light could not be switched on this camera.')
    }
  }

  const on = state === 'on'
  return (
    <div className="wh-camera">
      <div className="btn-row">
        {state === 'off' ? (
          <button type="button" className="btn" onClick={() => void start(deviceId || undefined)}>
            Use camera
          </button>
        ) : (
          <button type="button" className="btn" onClick={() => stop()}>
            {state === 'starting' ? 'Cancel camera' : 'Stop camera'}
          </button>
        )}
        {on && torch.supported && (
          <button type="button" className="btn" aria-pressed={torch.on} onClick={() => void toggleTorch()}>
            {torch.on ? 'Light on' : 'Light off'}
          </button>
        )}
        {on && cameras.length > 1 && (
          <div className="wh-camera-pick">
            <label htmlFor={`${id}-cam`} className="sr-only">
              Camera
            </label>
            <select id={`${id}-cam`} value={deviceId} onChange={(e) => void start(e.target.value)}>
              {cameras.map((c) => (
                <option key={c.deviceId} value={c.deviceId}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <video ref={videoRef} className="wh-camera-view" hidden={!on} muted playsInline aria-label="Camera view: hold a box or location label in the frame" />
      <p className="hint" role="status" aria-live="polite">
        {state === 'starting' ? 'Starting the camera…' : on ? 'Camera on: hold a label in the frame. Each code is added once.' : ''}
      </p>
      {problem && (
        <p className={`notice ${problem === 'hidden' ? 'notice-info' : 'notice-warn'}`} role="alert">
          {CAMERA_PROBLEM[problem]}
        </p>
      )}
      {torchError && (
        <p className="notice notice-warn" role="alert">
          {torchError}
        </p>
      )}
    </div>
  )
}
