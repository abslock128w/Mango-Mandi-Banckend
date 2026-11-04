// Per-browser choices for Mango Ops v2, kept in localStorage like the theme: density, the
// new-order chime, snoozed attention items, pinned screens, recent palette items, table
// columns and saved views. Storage may be blocked (a private window): every read falls back
// to the default and a choice then lasts as long as the page.
import { useSyncExternalStore } from 'react'

const PREFIX = 'mango-ops.'
const EVENT = 'mm:prefs'

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

const memory = new Map<string, unknown>()

export function getPref<T>(key: string, fallback: T): T {
  if (memory.has(key)) return memory.get(key) as T
  const v = read(key, fallback)
  memory.set(key, v)
  return v
}

export function setPref<T>(key: string, value: T) {
  memory.set(key, value)
  try {
    if (value === null || value === undefined) window.localStorage.removeItem(PREFIX + key)
    else window.localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // Blocked storage: kept in memory for this page.
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: key }))
}

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key?.startsWith(PREFIX)) {
      memory.delete(e.key.slice(PREFIX.length))
      cb()
    }
  }
  window.addEventListener(EVENT, cb)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(EVENT, cb)
    window.removeEventListener('storage', onStorage)
  }
}

/** A stored choice as React state. `fallback` must be stable (a constant). */
export function usePref<T>(key: string, fallback: T): [T, (v: T) => void] {
  const value = useSyncExternalStore(subscribe, () => getPref(key, fallback), () => fallback)
  return [value, (v: T) => setPref(key, v)]
}

// ---------- density ----------

/** auto: by pointer (fine pointers get 36px rows); compact or comfortable: the person's choice. */
export type Density = 'auto' | 'compact' | 'comfortable'
export const DENSITY_KEY = 'density'

export function applyDensity(d: Density) {
  const root = document.documentElement
  if (d === 'auto') root.removeAttribute('data-density')
  else root.setAttribute('data-density', d)
}

// ---------- snoozes ----------

export const SNOOZE_KEY = 'snoozes'
const NO_SNOOZES: Record<string, number> = {}
export const useSnoozes = () => usePref<Record<string, number>>(SNOOZE_KEY, NO_SNOOZES)

/** Drops snoozes that have ended, so the list does not grow for ever. */
export function snoozeUntil(id: string, until: number, nowMs: number) {
  const all = getPref<Record<string, number>>(SNOOZE_KEY, NO_SNOOZES)
  const next = Object.fromEntries(Object.entries(all).filter(([, t]) => t > nowMs))
  next[id] = until
  setPref(SNOOZE_KEY, next)
}

// ---------- recent items (palette) ----------

export interface RecentItem {
  id: string
  label: string
  hint?: string
  to: string
  kind: 'order' | 'batch' | 'page' | 'pincode'
}
export const RECENT_KEY = 'recent'
const NO_RECENT: RecentItem[] = []
export const RECENT_MAX = 8
export const useRecent = () => usePref<RecentItem[]>(RECENT_KEY, NO_RECENT)
export function remember(item: RecentItem) {
  const list = getPref<RecentItem[]>(RECENT_KEY, NO_RECENT).filter((x) => x.id !== item.id)
  setPref(RECENT_KEY, [item, ...list].slice(0, RECENT_MAX))
}

// ---------- pinned screens ----------

export const PINNED_KEY = 'pinned'
const NO_PINS: string[] = []
export const usePinned = () => usePref<string[]>(PINNED_KEY, NO_PINS)

// ---------- chime ----------

export const CHIME_KEY = 'chime'
