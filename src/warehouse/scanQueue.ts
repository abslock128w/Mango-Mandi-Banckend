// The scan queue: every scan gets its scanId on the device, waits here, and is
// sent in batches with at most MAX_IN_FLIGHT requests at once. A network
// failure keeps the scan queued and it is sent again with the same scanId, so
// the API answers a retry with the stored result instead of booking it twice.
// The queue lives in sessionStorage, so a reload or a crash loses nothing.
// A rejected scan pauses sending until someone acknowledges it (stop-on-error).

import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../api'
import { wh } from './api'
import type { Scan } from './types'

export const MAX_IN_FLIGHT = 4
export const BATCH_SIZE = 20
const KEEP_RESULTS = 200
const MAX_BACKOFF_MS = 15_000

export interface QueueItem {
  scanId: string
  input: string
  clientScannedAt: string
  reason?: string
}

/** A result as the workspace shows it: the API's answer plus what was scanned. */
export interface ShownScan extends Scan {
  input: string
  at: string
}

interface Saved {
  pending: QueueItem[]
  results: ShownScan[]
  paused: ShownScan | null
}

const storageKey = (opId: string) => `wh-scan-queue:${opId}`

function load(opId: string): Saved {
  try {
    const raw = window.sessionStorage.getItem(storageKey(opId))
    if (raw) {
      const s = JSON.parse(raw) as Partial<Saved>
      return { pending: s.pending ?? [], results: s.results ?? [], paused: s.paused ?? null }
    }
  } catch {
    // Storage blocked or unreadable: start empty.
  }
  return { pending: [], results: [], paused: null }
}

function save(opId: string, s: Saved) {
  try {
    if (!s.pending.length && !s.results.length && !s.paused) window.sessionStorage.removeItem(storageKey(opId))
    else window.sessionStorage.setItem(storageKey(opId), JSON.stringify(s))
  } catch {
    // Storage full or blocked: the queue still works for this page.
  }
}

export function clearSavedQueue(opId: string) {
  try {
    window.sessionStorage.removeItem(storageKey(opId))
  } catch {
    // Nothing to clear.
  }
}

/** Offline, a dropped connection, a busy or failing server: try the same scans again later. */
export function isTransient(err: unknown): boolean {
  if (err instanceof TypeError) return true
  return err instanceof ApiError && (err.status >= 500 || err.status === 429 || err.status === 408)
}

export function newScanId(): string {
  return crypto.randomUUID()
}

export function useScanQueue(opId: string, opts: { onResults?: (results: ShownScan[]) => void; seed?: Scan[] } = {}) {
  const state = useRef<Saved>(load(opId))
  const inFlight = useRef(new Set<string>())
  const requests = useRef(0)
  const backoff = useRef(0)
  const timer = useRef<number | undefined>(undefined)
  const stopped = useRef(false)
  const onResults = useRef(opts.onResults)
  onResults.current = opts.onResults
  const [, setVersion] = useState(0)
  const [retrying, setRetrying] = useState(false)

  const commit = useCallback(() => {
    save(opId, state.current)
    setVersion((v) => v + 1)
  }, [opId])

  // Scans already stored for this session (opened on another device or after storage was cleared).
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || !opts.seed?.length) return
    seeded.current = true
    if (state.current.results.length) return
    state.current.results = opts.seed.map((s) => ({ ...s, input: s.code, at: s.receivedAt ?? new Date().toISOString() }))
    commit()
  }, [opts.seed, commit])

  const pumpRef = useRef<() => void>(() => {})

  const send = useCallback(
    async (batch: QueueItem[]) => {
      requests.current++
      for (const i of batch) inFlight.current.add(i.scanId)
      let retry = false
      const shown: ShownScan[] = []
      try {
        const { results } = await wh.scans(
          opId,
          batch.map(({ scanId, input, clientScannedAt, reason }) => ({ scanId, input, clientScannedAt, ...(reason ? { reason } : {}) })),
        )
        backoff.current = 0
        setRetrying(false)
        const s = state.current
        for (const r of results) {
          const item = batch.find((b) => b.scanId === r.scanId)
          if (!item) continue
          // Nothing was stored (the database was too busy): send the same scanId again.
          if (r.stored === false) {
            retry = true
            continue
          }
          s.pending = s.pending.filter((p) => p.scanId !== r.scanId)
          const one: ShownScan = { ...r, input: item.input, at: new Date().toISOString() }
          s.results = [one, ...s.results.filter((x) => x.scanId !== r.scanId)].slice(0, KEEP_RESULTS)
          shown.push(one)
          if (r.result === 'rejected' && !s.paused) s.paused = one
        }
      } catch (err) {
        if (isTransient(err)) {
          retry = true
          setRetrying(true)
        } else {
          // The session itself refused (closed, someone else's, gone): these scans can't land here.
          const s = state.current
          const e = err instanceof ApiError ? err : null
          const ids = new Set(batch.map((b) => b.scanId))
          s.pending = s.pending.filter((p) => !ids.has(p.scanId))
          for (const b of batch) {
            const one: ShownScan = {
              scanId: b.scanId,
              result: 'rejected',
              code: e?.code ?? 'ERROR',
              message: e?.message ?? 'This scan could not be sent.',
              input: b.input,
              at: new Date().toISOString(),
            }
            s.results = [one, ...s.results].slice(0, KEEP_RESULTS)
            shown.push(one)
            if (!s.paused) s.paused = one
          }
        }
      } finally {
        requests.current--
        for (const i of batch) inFlight.current.delete(i.scanId)
        commit()
        if (shown.length) onResults.current?.(shown)
        if (retry && !stopped.current) {
          backoff.current = Math.min(backoff.current ? backoff.current * 2 : 1000, MAX_BACKOFF_MS)
          window.clearTimeout(timer.current)
          timer.current = window.setTimeout(() => pumpRef.current(), backoff.current)
        } else {
          pumpRef.current()
        }
      }
    },
    [opId, commit],
  )

  const pump = useCallback(() => {
    if (stopped.current || state.current.paused) return
    while (requests.current < MAX_IN_FLIGHT) {
      const batch = state.current.pending.filter((i) => !inFlight.current.has(i.scanId)).slice(0, BATCH_SIZE)
      if (!batch.length) return
      void send(batch)
    }
  }, [send])
  pumpRef.current = pump

  useEffect(() => {
    stopped.current = false
    pump()
    const online = () => {
      backoff.current = 0
      pump()
    }
    window.addEventListener('online', online)
    return () => {
      stopped.current = true
      window.clearTimeout(timer.current)
      window.removeEventListener('online', online)
    }
  }, [pump])

  const enqueue = useCallback(
    (input: string, reason?: string, { front = false } = {}) => {
      const item: QueueItem = { scanId: newScanId(), input, clientScannedAt: new Date().toISOString(), ...(reason ? { reason } : {}) }
      state.current.pending = front ? [item, ...state.current.pending] : [...state.current.pending, item]
      commit()
      pump()
    },
    [commit, pump],
  )

  /** Clears the stop after a rejected scan and sends what waited behind it. */
  const acknowledge = useCallback(() => {
    state.current.paused = null
    commit()
    pump()
  }, [commit, pump])

  const markUndone = useCallback(
    (scanId: string) => {
      state.current.results = state.current.results.map((r) => (r.scanId === scanId ? { ...r, result: 'undone' } : r))
      commit()
    },
    [commit],
  )

  const s = state.current
  return {
    results: s.results,
    paused: s.paused,
    waiting: s.pending.length,
    retrying,
    enqueue,
    acknowledge,
    markUndone,
  }
}
