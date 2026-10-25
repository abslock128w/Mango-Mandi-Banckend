// Scan sounds, made with WebAudio (no files). A high blip for accepted, two
// mid tones for a warning, a low buzz for rejected, two quick blips for a
// duplicate. Muting is remembered on this device.

import type { ScanResult } from './types'

const TONES: Partial<Record<ScanResult, [hz: number, ms: number][]>> = {
  accepted: [[1320, 90]],
  warning: [[880, 110], [660, 140]],
  rejected: [[220, 380]],
  duplicate: [[990, 60], [990, 60]],
}

let ctx: AudioContext | null = null

export function beep(result: ScanResult) {
  const tones = TONES[result]
  if (!tones) return
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    let t = ctx.currentTime
    for (const [hz, ms] of tones) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = result === 'rejected' ? 'square' : 'sine'
      osc.frequency.value = hz
      gain.gain.setValueAtTime(0.15, t)
      gain.gain.exponentialRampToValueAtTime(0.001, t + ms / 1000)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + ms / 1000)
      t += ms / 1000 + 0.04
    }
  } catch {
    // No audio on this device: the screen and the live region still say it.
  }
}

const MUTE_KEY = 'wh-scan-muted'
export function loadMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}
export function saveMuted(muted: boolean) {
  try {
    window.localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
  } catch {
    // Not remembered; it still applies now.
  }
}
