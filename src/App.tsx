import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { API_URL, SIGNOUT_EVENT, api } from './api'
import { SessionContext } from './session'
import type { Me } from './types'
import { ApiBaseBanner, OfflineBanner, Spinner } from './ui'
import Layout from './Layout'
import Login from './pages/Login'
import Today from './pages/Today'
import Batches from './pages/Batches'
import BatchDetail from './pages/BatchDetail'
import Orders from './pages/Orders'
import OrderDetail from './pages/OrderDetail'
import PackList from './pages/PackList'
import Deliveries from './pages/Deliveries'
import Claims from './pages/Claims'
import Pincodes from './pages/Pincodes'
import Planning from './pages/Planning'
import Preorders from './pages/Preorders'
import NotFound from './pages/NotFound'

function RequireAuth({ me, children }: { me: Me | null; children: ReactNode }) {
  const location = useLocation()
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  return <>{children}</>
}

/** Catches the sign-out event from api.ts (logout or a failed refresh) and navigates. */
function SignOutListener({ onSignOut }: { onSignOut: () => void }) {
  const navigate = useNavigate()
  useEffect(() => {
    function handle(e: Event) {
      const reason = (e as CustomEvent<{ reason?: string }>).detail?.reason
      onSignOut()
      navigate(reason === 'expired' ? '/login?reason=expired' : '/login', { replace: true })
    }
    window.addEventListener(SIGNOUT_EVENT, handle)
    return () => window.removeEventListener(SIGNOUT_EVENT, handle)
  }, [navigate, onSignOut])
  return null
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null)
  const [booting, setBooting] = useState(true)
  const queryClient = useQueryClient()

  // One silent refresh on load restores a session from the httpOnly cookie.
  useEffect(() => {
    let cancelled = false
    api.bootstrap().then((restored) => {
      if (cancelled) return
      setMe(restored)
      setBooting(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const [onSignOut] = useState(() => () => {
    setMe(null)
    queryClient.clear()
  })

  return (
    <SessionContext.Provider value={{ me, setMe }}>
      <ApiBaseBanner apiUrl={API_URL} />
      <OfflineBanner />
      <SignOutListener onSignOut={onSignOut} />
      {booting ? (
        <Spinner label="Restoring session" />
      ) : (
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            element={
              <RequireAuth me={me}>
                <Layout />
              </RequireAuth>
            }
          >
            <Route path="/" element={<Navigate to="/today" replace />} />
            <Route path="/today" element={<Today />} />
            <Route path="/batches" element={<Batches />} />
            <Route path="/batches/:id" element={<BatchDetail />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/orders/:id" element={<OrderDetail />} />
            <Route path="/pack-list" element={<PackList />} />
            <Route path="/deliveries" element={<Deliveries />} />
            <Route path="/claims" element={<Claims />} />
            <Route path="/pincodes" element={<Pincodes />} />
            <Route path="/planning" element={<Planning />} />
            <Route path="/preorders" element={<Preorders />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      )}
    </SessionContext.Provider>
  )
}
