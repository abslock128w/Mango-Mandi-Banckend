import { useEffect, useRef, useState, type FormEvent } from 'react'
import { helpLink } from './format'
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { SIGNOUT_EVENT } from './api'
import { useStore } from './store'
import Shop from './pages/Shop'
import Cart from './pages/Cart'
import Checkout from './pages/Checkout'
import SignIn from './pages/SignIn'
import Orders from './pages/Orders'
import OrderPage from './pages/Order'
import ClaimPage from './pages/Claim'
import Account from './pages/Account'
import Privacy from './pages/Privacy'
import BookAhead, { PreorderPage } from './pages/Preorder'
import ReviewPage from './pages/Review'
import ProductPage from './pages/Product'
import Quality from './pages/Quality'

function RequireSignIn({ children }: { children: JSX.Element }) {
  const { profile } = useStore()
  const location = useLocation()
  if (!profile) return <Navigate to={`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  return children
}

export default function App() {
  const { cart, profile } = useStore()
  const queryClient = useQueryClient()
  const location = useLocation()
  const boxes = cart.reduce((n, l) => n + l.qty, 0)
  const bump = useBump(boxes)
  const help = helpLink()
  // Forms with a button at the bottom (checkout, claims, reviews) hide the tabs so they never cover it.
  const focused = /^\/(checkout|review\/|reviews\/)|\/claim$/.test(location.pathname)

  useEffect(() => {
    const onOut = () => queryClient.removeQueries({ predicate: (q) => ['orders', 'order', 'claims', 'preorders', 'preorder', 'my-reviews', 'order-reviews', 'addresses', 'settings', 'stock-alerts', 'rating'].includes(String(q.queryKey[0])) })
    window.addEventListener(SIGNOUT_EVENT, onOut)
    return () => window.removeEventListener(SIGNOUT_EVENT, onOut)
  }, [queryClient])
  // Newer browsers return a promise from scrollTo, so the effect must not return it.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

  return (
    <>
      <header className={profile ? 'top signed-in' : 'top'}>
        <div className="top-inner">
          <div className="top-row">
            <Link to="/" className="brand" aria-label="MandiMangoes, home">
              <svg viewBox="0 0 64 64" width="28" height="28" aria-hidden="true">
                <path d="M34 14c14 2 22 14 20 28-2 12-14 18-26 16S8 46 10 34c2-12 12-21 24-20z" fill="currentColor" />
                <path d="M33 14c1-5 5-8 10-8-1 5-5 8-10 8z" fill="var(--leaf)" />
              </svg>
            </Link>
            <WhereButton />
            <NavLink to={profile ? '/account' : '/sign-in'} className="profile-btn" aria-label={profile ? 'Account' : 'Sign in'}>
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                <circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </NavLink>
          </div>
          <SearchBar />
        </div>
      </header>
      <main className="page">
        <Routes>
          <Route path="/" element={<Shop />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/sign-in" element={<SignIn />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/quality" element={<Quality />} />
          <Route path="/account" element={<RequireSignIn><Account /></RequireSignIn>} />
          <Route path="/checkout" element={<RequireSignIn><Checkout /></RequireSignIn>} />
          <Route path="/orders" element={<RequireSignIn><Orders /></RequireSignIn>} />
          <Route path="/orders/:id" element={<RequireSignIn><OrderPage /></RequireSignIn>} />
          <Route path="/orders/:id/claim" element={<RequireSignIn><ClaimPage /></RequireSignIn>} />
          <Route path="/mangoes/:sku" element={<ProductPage />} />
          <Route path="/review/:itemId" element={<RequireSignIn><ReviewPage /></RequireSignIn>} />
          <Route path="/reviews/:reviewId/edit" element={<RequireSignIn><ReviewPage /></RequireSignIn>} />
          <Route path="/preorder" element={<RequireSignIn><BookAhead /></RequireSignIn>} />
          <Route path="/preorders/:id" element={<RequireSignIn><PreorderPage /></RequireSignIn>} />
          <Route
            path="*"
            element={
              <section className="card">
                <h1>Page not found</h1>
                <Link to="/" className="btn btn-primary">
                  Back to the shop
                </Link>
              </section>
            }
          />
        </Routes>
      </main>
      <footer className={focused ? 'foot foot-flat' : 'foot'}>
        <p>Mangoes picked for the day you want to eat them, delivered to your door.</p>
        <p>
          <Link to="/quality">How we pick and check</Link> · <Link to="/privacy">Privacy notice</Link>
          {help && (
            <>
              {' · '}
              <a href={help} target="_blank" rel="noopener noreferrer">
                Help on WhatsApp
              </a>
            </>
          )}
        </p>
      </footer>
      {!focused && (
      <nav aria-label="Main" className="tabbar">
        <NavLink to="/" end className="tab">
          <TabIcon d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
          <span>Home</span>
        </NavLink>
        <NavLink to="/preorder" className="tab">
          <TabIcon d="M4 6h16v14H4zM4 10h16M8 3v5M16 3v5" />
          <span>Book ahead</span>
        </NavLink>
        <NavLink to="/orders" className="tab">
          <TabIcon d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6" />
          <span>Orders</span>
        </NavLink>
        <NavLink to="/cart" className="tab" aria-label={`Cart, ${boxes} ${boxes === 1 ? 'box' : 'boxes'}`}>
          <span className="tab-icon-wrap">
            <TabIcon d="M3 4h2l2.4 11h11.2L21 7H6.2M9 20a1 1 0 1 0 0-.01M18 20a1 1 0 1 0 0-.01" />
            {boxes > 0 && (
              <span key={bump} className={bump ? 'count bump' : 'count'} aria-hidden="true">
                {boxes}
              </span>
            )}
          </span>
          <span aria-hidden="true">Cart</span>
        </NavLink>
      </nav>
      )}
    </>
  )
}

/** Changes each time the count goes up, so the badge replays its bounce. */
function useBump(count: number) {
  const [bump, setBump] = useState(0)
  const last = useRef(count)
  useEffect(() => {
    if (count > last.current) setBump((b) => b + 1)
    last.current = count
  }, [count])
  return bump
}

function TabIcon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** The delivery pincode at the top; opens the pincode form on the home page. */
function WhereButton() {
  const { pincode } = useStore()
  return (
    <Link to="/?where=1" className="where-btn" aria-label={pincode ? `Delivering to ${pincode}, change` : 'Choose where to deliver'}>
      <span className="where-label">{pincode ? 'Delivering to' : 'Deliver to'}</span>
      <span className="where-value">
        {pincode ?? 'Set your pincode'}
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      </span>
    </Link>
  )
}

/** Searches the mangoes on the home page (?q=). Typing on another page takes you home. */
function SearchBar() {
  const location = useLocation()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const onHome = location.pathname === '/'
  const current = onHome ? (params.get('q') ?? '') : ''
  const [draft, setDraft] = useState(current)
  const value = onHome ? current : draft
  function go(q: string) {
    const next = new URLSearchParams(onHome ? params : undefined)
    if (q.trim()) next.set('q', q)
    else next.delete('q')
    next.delete('where')
    navigate({ pathname: '/', search: next.toString() ? `?${next}` : '' }, { replace: onHome })
  }
  function submit(e: FormEvent) {
    e.preventDefault()
    go(value)
  }
  return (
    <form role="search" className="search" onSubmit={submit}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M20 20l-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <input
        type="search"
        aria-label="Search mangoes"
        placeholder="Search mangoes, e.g. Alphonso"
        value={value}
        onChange={(e) => {
          setDraft(e.target.value)
          if (onHome) go(e.target.value)
        }}
      />
    </form>
  )
}
