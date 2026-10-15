// The signed-in staff member, shared with every screen.

import { createContext, useContext } from 'react'
import type { Me } from './types'

export interface Session {
  me: Me | null
  setMe: (me: Me | null) => void
}

export const SessionContext = createContext<Session>({ me: null, setMe: () => {} })

export function useSession(): Session {
  return useContext(SessionContext)
}
