import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { api } from './api'
import { useSession } from './session'
import { ErrorBoundary } from './ui'

const LINKS: [string, string][] = [
  ['/today', 'Today'],
  ['/batches', 'Batches'],
  ['/orders', 'Orders'],
  ['/pack-list', 'Pack list'],
  ['/deliveries', 'Deliveries'],
  ['/claims', 'Claims'],
  ['/pincodes', 'Pincodes'],
  ['/planning', 'Planning'],
  ['/preorders', 'Preorders'],
]

export default function Layout() {
  const { me } = useSession()
  const location = useLocation()
  return (
    <div className="app">
      <nav className="app-nav" aria-label="Main">
        <NavLink to="/today" className="brand">
          Mango Ops
        </NavLink>
        <ul>
          {LINKS.map(([to, label]) => (
            <li key={to}>
              <NavLink to={to} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
        <div className="who">
          {me && (
            <span>
              {me.email} · {me.role === 'MANAGER' ? 'Manager' : 'Operator'}
            </span>
          )}
          <button type="button" className="btn btn-small" onClick={() => void api.logout()}>
            Sign out
          </button>
        </div>
      </nav>
      <main className="content">
        {/* Keyed by path so a crash on one screen clears when you navigate away. */}
        <ErrorBoundary key={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  )
}
