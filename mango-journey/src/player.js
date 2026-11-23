// The playhead: the film's own time (seconds) → the master progress p (0…N) that drives everything (main.js).
//
// Each chapter lasts its own number of seconds (chapters.js SECONDS). p(τ) is a monotone cubic through the chapter
// borders (p = i exactly when chapter i starts), with the speed at each border set to the harmonic mean of the two
// chapters' speeds, so a long chapter after a short one slows down smoothly instead of stepping: the velocity is
// continuous everywhere. It starts from rest after a hold on the title (LEAD) and comes to rest at the very end.
// This curve is the only smoothing: there is no spring or scroll easing on top of it.
export function makeTimeline(secs, lead) {
  const N = secs.length
  const K = [lead]
  for (let i = 0; i < N; i++) K.push(K[i] + secs[i])
  const m = new Array(N + 1).fill(0) // m[0] = m[N] = 0: from rest, to rest
  for (let k = 1; k < N; k++) m[k] = 2 / (secs[k - 1] + secs[k])
  const end = K[N]
  const p = (tau) => {
    if (!(tau > lead)) return 0
    if (tau >= end) return N
    let k = 0
    while (k < N - 1 && tau >= K[k + 1]) k++
    const h = secs[k], s = (tau - K[k]) / h, s2 = s * s, s3 = s2 * s
    return k + (3 * s2 - 2 * s3) + h * (m[k] * (s3 - 2 * s2 + s) + m[k + 1] * (s3 - s2))
  }
  /** The time at which the film reaches p (p is monotone in τ, so a bisection is exact enough). */
  const tauOf = (pp) => {
    if (pp <= 0) return 0
    if (pp >= N) return end
    const k = Math.floor(pp)
    let lo = K[k], hi = K[k + 1]
    for (let j = 0; j < 32; j++) { const mid = (lo + hi) / 2; if (p(mid) < pp) lo = mid; else hi = mid }
    return (lo + hi) / 2
  }
  return { p, tauOf, starts: K, end, N }
}

/** mm:ss */
export const clockText = (sec) => { const s = Math.max(0, Math.round(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
