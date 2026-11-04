// The Attention queue's data for Today and the top bar's bell: the same four queries, shared
// through React Query's cache, so both always agree.
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { istDate } from '../format'
import { useSession } from '../session'
import { buildQueue, visible } from './queue'
import { useSnoozes } from './prefs'

export const summaryQuery = { queryKey: ['summary'], queryFn: api.summary, refetchInterval: 60_000 } as const
export const attentionQueryV2 = { queryKey: ['attention'], queryFn: api.attention, refetchInterval: 60_000 } as const
export const dayQuery = (date: string) => ({ queryKey: ['day', date], queryFn: () => api.day(date), refetchInterval: 60_000, staleTime: 15_000 }) as const
export const liveQuery = (date: string) => ({ queryKey: ['live', date], queryFn: () => api.live(date), refetchInterval: 60_000, staleTime: 10_000 }) as const

/** "Now", ticking once a minute, so ages and "due in" stay right without a refetch. */
export function useNow(everyMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), everyMs)
    return () => window.clearInterval(t)
  }, [everyMs])
  return now
}

/** Managers and operators run the floor: they get the queue, the Day strip and the live board. */
export const runsTheFloor = (role: string | undefined) => role === 'MANAGER' || role === 'OPERATOR'

export function useAttentionQueue() {
  const { me } = useSession()
  const on = runsTheFloor(me?.role)
  const today = istDate(0)
  const nowMs = useNow()
  const attention = useQuery({ ...attentionQueryV2, enabled: on })
  const summary = useQuery({ ...summaryQuery, enabled: on })
  const day = useQuery({ ...dayQuery(today), enabled: on })
  const live = useQuery({ ...liveQuery(today), enabled: on })
  const [snoozes] = useSnoozes()
  const all = on ? buildQueue({ attention: attention.data, summary: summary.data, day: day.data, live: live.data, nowMs }) : []
  const shown = visible(all, snoozes, nowMs)
  return {
    on,
    nowMs,
    all,
    shown,
    snoozed: all.length - shown.length,
    /** The first answer of the alert sources is in (or failed). */
    ready: !attention.isPending || attention.isError,
    attentionError: attention.isError ? attention.error : null,
  }
}
