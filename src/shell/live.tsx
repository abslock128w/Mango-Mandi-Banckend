// Live updates (docs/design/ops-dashboard-v2.md §6). Managers and operators keep one event stream
// open (GET /events): an order that changes, a rider's new position or a new attention count
// refreshes only the queries it touches. A new paid order and a missed delivery also raise a
// toast, with a chime and a flash when the person turned that on. When the stream will not stay
// up (three failed connects in a row) the panel polls every 15 s instead and keeps trying the
// stream every minute; the Live dot in the top bar says which it is doing.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Pause, RefreshCw, Radio } from 'lucide-react'
import { openEventStream } from '../api'
import { useSession } from '../session'
import { useToast } from '../ui'
import { CHIME_KEY, getPref } from '../ops/prefs'
import type { LiveEvent } from '../ops/types'
import { FAILS_BEFORE_POLLING, POLL_MS, backoffMs, createSseParser, parseData } from './sse'

export type LiveStatus = 'off' | 'connecting' | 'live' | 'reconnecting' | 'polling' | 'paused'

interface LiveState {
  status: LiveStatus
  /** Try the stream again now (the Live dot's Reload). */
  reconnect: () => void
}

const LiveContext = createContext<LiveState>({ status: 'off', reconnect: () => {} })
export const useLive = () => useContext(LiveContext)

/** A stream that ends sooner than this after it opened counts as a failed connect. */
const SHORT_LIVED_MS = 5_000
/** While polling, the stream is tried again this often. */
const RETRY_STREAM_MS = 60_000

/** Two short notes, made in the browser (no sound file). Only after the person has used the page. */
function chime() {
  try {
    const activated = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive ?? true
    if (!activated) return
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const tone = (freq: number, at: number) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.frequency.value = freq
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at)
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + at + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.25)
      o.connect(g).connect(ctx.destination)
      o.start(ctx.currentTime + at)
      o.stop(ctx.currentTime + at + 0.3)
    }
    tone(880, 0)
    tone(1320, 0.18)
    window.setTimeout(() => void ctx.close(), 800)
  } catch {
    // No sound: the toast still shows.
  }
}

function flash() {
  const el = document.querySelector('.app-header')
  if (!el) return
  el.classList.remove('is-flashing')
  // Restart the animation.
  void (el as HTMLElement).offsetWidth
  el.classList.add('is-flashing')
  window.setTimeout(() => el.classList.remove('is-flashing'), 1600)
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const { me } = useSession()
  const on = me?.role === 'MANAGER' || me?.role === 'OPERATOR'
  const queryClient = useQueryClient()
  const toast = useToast()
  const toastRef = useRef(toast)
  toastRef.current = toast
  const [status, setStatus] = useState<LiveStatus>('off')
  const [attempt, setAttempt] = useState(0)
  const kick = useCallback(() => setAttempt((n) => n + 1), [])

  useEffect(() => {
    if (!on) {
      setStatus('off')
      return
    }
    const abort = new AbortController()
    let stopped = false
    let fails = 0
    let pollTimer: number | undefined
    let retryTimer: number | undefined
    let riderTimer: number | undefined

    const invalidate = (keys: string[]) => {
      for (const k of keys) void queryClient.invalidateQueries({ queryKey: [k] })
    }
    const pollOnce = () => invalidate(['summary', 'attention', 'day', 'live', 'manifest'])

    function handle(e: LiveEvent) {
      if (e.type === 'order.changed') {
        invalidate(['summary', 'orders', 'manifest', 'day', 'live', 'pack-list'])
        void queryClient.invalidateQueries({ queryKey: ['order', e.data.id] })
        const loud = getPref<boolean>(CHIME_KEY, false)
        if (e.data.status === 'CONFIRMED') {
          toastRef.current.info(`New paid order ${e.data.number}`)
          if (loud) {
            chime()
            flash()
          }
        } else if (e.data.status === 'DELIVERY_FAILED') {
          toastRef.current.error(`Delivery missed: ${e.data.number}`)
          if (loud) {
            chime()
            flash()
          }
        }
      } else if (e.type === 'rider.position') {
        // Positions come every 20 s per rider: refresh the board at most every 10 s.
        if (riderTimer === undefined) {
          riderTimer = window.setTimeout(() => {
            riderTimer = undefined
            invalidate(['live'])
          }, 10_000)
        }
      } else if (e.type === 'attention.changed') {
        invalidate(['attention'])
      } else if (e.type === 'bulk.enquiry') {
        // Bulk enquiries (mango-api README): a new one, a quote, the customer's answer, a close.
        invalidate(['bulk-enquiries'])
        void queryClient.invalidateQueries({ queryKey: ['bulk-enquiry', e.data.id] })
        if (e.data.change === 'created') toastRef.current.info(`New bulk enquiry ${e.data.number}`)
        else if (e.data.change === 'responded') toastRef.current.info(`${e.data.number}: the customer ${e.data.status === 'ACCEPTED' ? 'accepted' : 'declined'} the quote`)
      }
    }

    function startPolling() {
      setStatus('polling')
      if (pollTimer === undefined) pollTimer = window.setInterval(pollOnce, POLL_MS)
      retryTimer = window.setTimeout(() => void connect(), RETRY_STREAM_MS)
    }

    async function connect() {
      if (stopped) return
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setStatus('paused')
        return
      }
      setStatus((s) => (s === 'polling' ? s : fails ? 'reconnecting' : 'connecting'))
      let opened = 0
      let bye = false
      try {
        const res = await openEventStream(abort.signal)
        const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
        const parse = createSseParser()
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          for (const m of parse(value)) {
            if (m.event === 'hello') {
              opened = Date.now()
              setStatus('live')
              if (pollTimer !== undefined) {
                window.clearInterval(pollTimer)
                pollTimer = undefined
              }
              // Anything that changed while the stream was down.
              if (fails > 0) pollOnce()
            } else if (m.event === 'bye') {
              bye = true
            } else {
              const data = parseData<never>(m)
              if (data !== null) handle({ type: m.event, data } as LiveEvent)
            }
          }
        }
      } catch {
        if (stopped) return
      }
      if (stopped) return
      // The server ending the stream on purpose (its time limit), after a while: reconnect at once.
      if (bye || (opened && Date.now() - opened > SHORT_LIVED_MS)) {
        fails = 0
        retryTimer = window.setTimeout(() => void connect(), 250)
        return
      }
      fails++
      if (fails >= FAILS_BEFORE_POLLING) return startPolling()
      setStatus('reconnecting')
      retryTimer = window.setTimeout(() => void connect(), backoffMs(fails))
    }

    const online = () => {
      fails = 0
      window.clearTimeout(retryTimer)
      void connect()
    }
    window.addEventListener('online', online)
    void connect()
    return () => {
      stopped = true
      abort.abort()
      window.clearInterval(pollTimer)
      window.clearTimeout(retryTimer)
      window.clearTimeout(riderTimer)
      window.removeEventListener('online', online)
    }
  }, [on, attempt, queryClient])

  return <LiveContext.Provider value={{ status, reconnect: kick }}>{children}</LiveContext.Provider>
}

const DOT: Record<Exclude<LiveStatus, 'off'>, { word: string; long: string }> = {
  connecting: { word: 'Connecting', long: 'Connecting to live updates' },
  live: { word: 'Live', long: 'Live: changes show as they happen' },
  reconnecting: { word: 'Reconnecting', long: 'Reconnecting to live updates' },
  polling: { word: 'Every 15 s', long: 'Live updates are down: checking every 15 seconds' },
  paused: { word: 'Paused', long: 'Offline: updates are paused' },
}

/** Green and "Live" while the stream is up, amber while it reconnects or polls, grey with Reload when paused. */
export function LiveDot() {
  const { status, reconnect } = useLive()
  if (status === 'off') return null
  const d = DOT[status]
  const Icon = status === 'live' ? Radio : status === 'paused' ? Pause : RefreshCw
  return (
    <span className={`live-status live-${status}`} title={d.long}>
      <Icon aria-hidden="true" strokeWidth={2} className="live-icon" />
      <span className="live-word" aria-hidden="true">
        {d.word}
      </span>
      <span className="sr-only">{d.long}</span>
      {(status === 'paused' || status === 'polling') && (
        <button type="button" className="link-btn live-reload" onClick={reconnect}>
          Reload<span className="sr-only"> live updates</span>
        </button>
      )}
    </span>
  )
}
