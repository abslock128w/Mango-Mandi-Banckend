// Favourites (FAVOURITES, docs/app-feel.md): a heart on each box. A signed-in customer's hearts
// are kept by the API (/v1/me/favourites); a guest's stay on this device and are handed to the
// API once, after signing in, then forgotten here. The Account page lists them.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, errorMessage, type FavouriteList } from './api'
import { useFeatures } from './features'
import { useStore } from './store'

const GUEST_KEY = 'mm.favourites'
/** The same cap as the API's, for a guest's device list. */
export const MAX_GUEST_FAVOURITES = 50

function loadGuest(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(GUEST_KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === 'string').slice(0, MAX_GUEST_FAVOURITES) : []
  } catch {
    return []
  }
}
function saveGuest(skus: string[]) {
  try {
    if (skus.length) localStorage.setItem(GUEST_KEY, JSON.stringify(skus))
    else localStorage.removeItem(GUEST_KEY)
  } catch {
    // Storage blocked: a guest's hearts last as long as the tab.
  }
}

interface Favourites {
  /** The switch is on: hearts show. */
  on: boolean
  has: (sku: string) => boolean
  toggle: (sku: string) => void
  /** The last heart that could not be saved, and why (shown beside that heart). */
  problem: { sku: string; message: string } | null
  /** Signed in: the list from the API (for the Account page). */
  list: ReturnType<typeof useFavouriteList>
  /** A guest's hearts that could not be handed over after signing in (kept here, tried again on the next visit). */
  mergeError: unknown
}

const Ctx = createContext<Favourites | null>(null)

export const favouritesKey = ['favourites'] as const
const useFavouriteList = (enabled: boolean) => useQuery({ queryKey: favouritesKey, queryFn: api.favourites, enabled })

export function FavouritesProvider({ children }: { children: ReactNode }) {
  const { favourites: on } = useFeatures()
  const { profile } = useStore()
  const queryClient = useQueryClient()
  const [guest, setGuest] = useState(loadGuest)
  const [problem, setProblem] = useState<Favourites['problem']>(null)
  const signedIn = Boolean(profile)
  useEffect(() => saveGuest(guest), [guest])

  // After signing in, a guest's hearts go to the account once; the device copy goes when the API has them.
  const merge = useMutation({
    mutationFn: (skus: string[]) => api.mergeFavourites(skus),
    onSuccess: (r, skus) => {
      queryClient.setQueryData<FavouriteList>(favouritesKey, { items: r.items, max: r.max })
      setGuest((g) => g.filter((s) => !skus.includes(s)))
    },
  })
  // The account's list is read only once the guest's hearts are in it (or could not be handed over):
  // a read racing the merge could answer with the list from before it and hide the merged hearts.
  const handingOver = signedIn && guest.length > 0 && !merge.isError
  const list = useFavouriteList(on && signedIn && !handingOver)
  const merging = useRef(false)
  const { mutate: mergeNow } = merge
  useEffect(() => {
    // Once per sign-in (or visit) with hearts waiting; after a failure they stay here and go on the next visit.
    if (!on || !signedIn || !guest.length || merging.current) return
    merging.current = true
    mergeNow(guest, { onSettled: () => (merging.current = false) })
  }, [on, signedIn, guest, mergeNow])

  const toggleServer = useMutation({
    mutationFn: async ({ sku, add }: { sku: string; add: boolean }) => (add ? api.addFavourite(sku) : api.removeFavourite(sku)),
    onMutate: async ({ sku, add }) => {
      setProblem(null)
      await queryClient.cancelQueries({ queryKey: favouritesKey })
      const before = queryClient.getQueryData<FavouriteList>(favouritesKey)
      if (before) {
        const items = add
          ? before.items.some((i) => i.sku === sku)
            ? before.items
            : [{ sku, name: sku, variety: null, boxSize: null, price: null, photoUrl: null, onSale: true, addedAt: new Date().toISOString() }, ...before.items]
          : before.items.filter((i) => i.sku !== sku)
        queryClient.setQueryData<FavouriteList>(favouritesKey, { ...before, items })
      }
      return { before }
    },
    onError: (err, { sku }, ctx) => {
      if (ctx?.before) queryClient.setQueryData(favouritesKey, ctx.before)
      setProblem({ sku, message: errorMessage(err) })
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: favouritesKey }),
  })

  const serverSkus = list.data?.items
  const has = useCallback((sku: string) => Boolean(serverSkus?.some((i) => i.sku === sku)) || guest.includes(sku), [serverSkus, guest])
  const { mutate } = toggleServer
  const toggle = useCallback(
    (sku: string) => {
      const add = !has(sku)
      if (signedIn) return mutate({ sku, add })
      setProblem(null)
      if (add && guest.length >= MAX_GUEST_FAVOURITES) {
        return setProblem({ sku, message: `You can keep up to ${MAX_GUEST_FAVOURITES} favourites. Remove one first.` })
      }
      setGuest((g) => (add ? [sku, ...g.filter((s) => s !== sku)] : g.filter((s) => s !== sku)))
    },
    [has, signedIn, mutate, guest.length],
  )

  const value = useMemo<Favourites>(
    () => ({ on, has, toggle, problem, list, mergeError: merge.error }),
    [on, has, toggle, problem, list, merge.error],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useFavourites() {
  const f = useContext(Ctx)
  if (!f) throw new Error('useFavourites outside FavouritesProvider')
  return f
}

/** The heart: a toggle button, pressed when the box is a favourite. Nothing while the switch is off. */
export function HeartButton({ sku, name, className = '' }: { sku: string; name: string; className?: string }) {
  const f = useFavourites()
  if (!f.on) return null
  const on = f.has(sku)
  return (
    <button type="button" className={`heart ${className}`.trim()} aria-pressed={on} aria-label={`Favourite: ${name}`} onClick={() => f.toggle(sku)}>
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path
          d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 8 3.4 4.5 7 4.5c2 0 3.5 1.1 5 3 1.5-1.9 3-3 5-3 3.6 0 5.6 3.5 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"
          fill={on ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}

/** Why the last heart on this box could not be saved, if it couldn't. */
export function HeartProblem({ sku }: { sku: string }) {
  const f = useFavourites()
  if (!f.on || f.problem?.sku !== sku) return null
  return (
    <span className="field-error small" role="alert">
      {f.problem.message}
    </span>
  )
}
