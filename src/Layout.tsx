import { Suspense, lazy, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { ChevronDown, ChevronsLeft, ChevronsRight, KeyRound, LogOut, Menu as MenuIcon, Search, X } from 'lucide-react'
import { api } from './api'
import { ROLE_LABEL, homeFor } from './permissions'
import { useSession } from './session'
import { ErrorBoundary, Spinner } from './ui'
import { isHere, navGroups, primaryLinks, type NavItem } from './nav'

// The palette is code nobody needs for the first paint: fetched the first time it opens.
const CommandPalette = lazy(() => import('./CommandPalette'))

/** Which disclosure is open: the phone Menu sheet or the account menu. */
type Open = null | 'menu' | 'account'

const COLLAPSED_KEY = 'mango-ops.sidebar'

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === 'collapsed'
  } catch {
    return false
  }
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

/**
 * The shell. From 900px: a top bar across the page (name, search, account) and a grouped sidebar
 * that collapses to icons. Below 900px: the same top bar and a bottom tab bar with the role's most
 * used screens and Menu, which opens every other screen in a sheet. Every menu is a disclosure:
 * aria-expanded on its button, focus moves to its first link, Escape closes it and returns focus,
 * and it closes when focus or a click leaves it. Ctrl/Cmd+K opens the command palette.
 */
export default function Layout() {
  const { me } = useSession()
  const location = useLocation()
  const [open, setOpen] = useState<Open>(null)
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [palette, setPalette] = useState(false)
  const mainRef = useRef<HTMLElement>(null)
  // Set when a disclosure opens from its button, so the effect below moves focus into it.
  const focusInto = useRef(false)

  const groups = navGroups(me)
  const primary = primaryLinks(groups)
  const primaryTo = new Set(primary.map((l) => l.to))
  const twoStepOff = !!me?.twoStep && !me.twoStep.enabled
  const here = groups.flatMap((g) => g.links.map((l) => ({ group: g.label, link: l }))).find((x) => isHere(x.link.to, location.pathname))

  // A new page closes whatever was open.
  useEffect(() => setOpen(null), [location.pathname])

  useEffect(() => {
    if (!open) return
    const wrapper = document.querySelector(`[data-disclosure="${open}"]`)
    if (focusInto.current) {
      focusInto.current = false
      const panel = document.getElementById(panelId(open))
      // The first link that shows (the sheet leaves out what the tab bar already has).
      const first = Array.from(panel?.querySelectorAll<HTMLElement>('a, button') ?? []).find((el) => el.getClientRects().length > 0)
      first?.focus()
    }
    function leave(e: Event) {
      if (wrapper && e.target instanceof Node && !wrapper.contains(e.target)) setOpen(null)
    }
    document.addEventListener('pointerdown', leave)
    document.addEventListener('focusin', leave)
    return () => {
      document.removeEventListener('pointerdown', leave)
      document.removeEventListener('focusin', leave)
    }
  }, [open])

  // Ctrl/Cmd+K anywhere opens the palette (a second press closes it).
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(null)
        setPalette((p) => !p)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  function toggle(id: Exclude<Open, null>) {
    focusInto.current = open !== id
    setOpen(open === id ? null : id)
  }

  function toggleCollapsed() {
    const next = !collapsed
    setCollapsed(next)
    try {
      window.localStorage.setItem(COLLAPSED_KEY, next ? 'collapsed' : 'expanded')
    } catch {
      // A private window without storage: the choice lasts until reload.
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !open) return
    e.preventDefault()
    const button = document.querySelector<HTMLElement>(`[aria-controls="${panelId(open)}"]`)
    setOpen(null)
    button?.focus()
  }

  // A link chosen from an open menu: the menu closes on the new page, so focus goes to the page.
  function onNavClick(e: MouseEvent) {
    if (open && e.target instanceof Element && e.target.closest('a')) {
      window.requestAnimationFrame(() => mainRef.current?.focus({ preventScroll: true }))
    }
  }

  function skipToContent(e: MouseEvent<HTMLAnchorElement>) {
    e.preventDefault()
    mainRef.current?.focus()
    mainRef.current?.scrollIntoView()
  }

  const link = (l: NavItem, extra = '') => (
    <NavLink
      to={l.to}
      end={l.to === '/warehouse'}
      className={({ isActive }) => `nav-link${isActive || isHere(l.to, location.pathname) ? ' active' : ''}${extra}`}
      title={collapsed ? l.label : undefined}
    >
      <l.icon className="nav-icon" aria-hidden="true" strokeWidth={1.75} />
      <span className="nav-text">{l.label}</span>
    </NavLink>
  )

  return (
    <div className={`app${collapsed ? ' is-collapsed' : ''}`} onKeyDown={onKeyDown} onClick={onNavClick}>
      <a href="#main" className="skip-link" onClick={skipToContent}>
        Skip to content
      </a>
      <header className="app-header">
        <div className="app-bar">
          <NavLink to={homeFor(me?.role)} className="brand">
            <img src="/brand/mark-96.webp" width="28" height="28" alt="" className="brand-mark" />
            <span className="brand-text">Mango Ops</span>
          </NavLink>
          {here && (
            <p className="crumbs" aria-hidden="true">
              <span>{here.group}</span>
              <span className="crumb-sep">/</span>
              <span className="crumb-here">{here.link.label}</span>
            </p>
          )}
          <button type="button" className="search-btn" onClick={() => setPalette(true)} aria-haspopup="dialog" aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}>
            <Search className="search-icon" aria-hidden="true" strokeWidth={2} />
            <span className="search-text">Search</span>
            <kbd className="kbd" aria-hidden="true">
              {isMac ? '⌘' : 'Ctrl'} K
            </kbd>
          </button>
          <div className={`account${open === 'account' ? ' open' : ''}`} data-disclosure="account">
            <button type="button" className="account-btn" aria-expanded={open === 'account'} aria-controls={panelId('account')} onClick={() => toggle('account')}>
              <span className="avatar" aria-hidden="true">
                {(me?.email ?? '?').charAt(0).toUpperCase()}
              </span>
              <span className="account-label">
                <span className="account-email">{me?.email} · </span>
                {me ? ROLE_LABEL[me.role] : 'Account'}
              </span>
              {twoStepOff && (
                <>
                  <span className="dot-warn" aria-hidden="true" />
                  <span className="sr-only"> (two-step sign-in is off)</span>
                </>
              )}
              <ChevronDown className="chevron" aria-hidden="true" strokeWidth={2} />
            </button>
            <div id={panelId('account')} className="account-menu">
              {me && (
                <div className="account-who">
                  <span className="avatar avatar-lg" aria-hidden="true">
                    {me.email.charAt(0).toUpperCase()}
                  </span>
                  <span className="account-who-text">
                    <span className="account-who-email">{me.email}</span>
                    <span className="account-who-role">{ROLE_LABEL[me.role]}</span>
                  </span>
                </div>
              )}
              <NavLink to="/two-step" className={({ isActive }) => `menu-item${isActive ? ' active' : ''}`}>
                <KeyRound aria-hidden="true" className="menu-item-icon" strokeWidth={1.75} />
                Two-step sign-in{twoStepOff ? ' (off)' : ''}
              </NavLink>
              <button type="button" className="menu-item" onClick={() => void api.logout()}>
                <LogOut aria-hidden="true" className="menu-item-icon" strokeWidth={1.75} />
                Sign out
              </button>
            </div>
          </div>
        </div>
      </header>

      <nav id="main-nav" aria-label="Main" className={`sidebar${open === 'menu' ? ' open' : ''}`} data-disclosure="menu">
        <div id={panelId('menu')} className="nav-sheet">
          <ul className="nav-groups">
            {groups.map((g) => {
              const labelId = `nav-${g.id}-label`
              const onlyPrimary = g.links.every((l) => primaryTo.has(l.to))
              return (
                <li key={g.id} className={`nav-group${onlyPrimary ? ' only-primary' : ''}`}>
                  <span className="nav-group-label" id={labelId}>
                    {g.label}
                  </span>
                  <ul className="nav-group-list" aria-labelledby={labelId}>
                    {g.links.map((l) => (
                      <li key={l.to} className={primaryTo.has(l.to) ? 'is-primary' : undefined}>
                        {link(l)}
                      </li>
                    ))}
                  </ul>
                </li>
              )
            })}
          </ul>
          {primary.length === groups.flatMap((g) => g.links).length && <p className="sheet-empty">Every screen you use is in the bar below.</p>}
        </div>
        <div className="sidebar-foot">
          <button type="button" className="collapse-btn" onClick={toggleCollapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <ChevronsRight aria-hidden="true" strokeWidth={1.75} /> : <ChevronsLeft aria-hidden="true" strokeWidth={1.75} />}
            <span className="nav-text" aria-hidden="true">
              Collapse
            </span>
          </button>
        </div>
        <ul className="tabbar">
          {primary.map((l) => (
            <li key={l.to}>{link(l, ' tab')}</li>
          ))}
          <li>
            <button type="button" className="tab menu-btn" aria-expanded={open === 'menu'} aria-controls={panelId('menu')} onClick={() => toggle('menu')}>
              {open === 'menu' ? <X className="nav-icon" aria-hidden="true" strokeWidth={1.75} /> : <MenuIcon className="nav-icon" aria-hidden="true" strokeWidth={1.75} />}
              <span className="nav-text">Menu</span>
            </button>
          </li>
        </ul>
      </nav>
      {open === 'menu' && <div className="sheet-backdrop" aria-hidden="true" />}

      <main className="content" id="main" tabIndex={-1} ref={mainRef}>
        {/* Keyed by path so a crash on one screen clears when you navigate away. */}
        <ErrorBoundary key={location.pathname}>
          <Suspense fallback={<Spinner />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>

      {palette && (
        <Suspense fallback={null}>
          <CommandPalette groups={groups} onClose={() => setPalette(false)} />
        </Suspense>
      )}
    </div>
  )
}

function panelId(open: Exclude<Open, null>) {
  return open === 'menu' ? 'nav-sheet' : `${open}-menu`
}
