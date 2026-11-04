// Keyboard first, mouse always (docs/design/ops-dashboard-v2.md): `?` shows every shortcut,
// `g` then a letter jumps to a screen, `/` finds on this page, `o` opens the full page from a
// peek. Lists handle j/k/x/Enter themselves (DataTable). Nothing here fires while typing in a
// field, with a modifier held, or while a dialog other than a peek is open.
import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Dialog, Kbd } from '../ui'

export interface Chord {
  key: string
  to: string
  label: string
  /** nav.ts screen id, for canSee. */
  screen: string
}

export const CHORDS: Chord[] = [
  { key: 't', to: '/today', label: 'Today', screen: 'today' },
  { key: 'o', to: '/orders', label: 'Orders', screen: 'orders' },
  { key: 'd', to: '/deliveries', label: 'Deliveries', screen: 'deliveries' },
  { key: 'p', to: '/pack-list', label: 'Pack list', screen: 'packList' },
  { key: 'b', to: '/batches', label: 'Batches', screen: 'batches' },
]

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

/** True when a key press belongs to what the person is typing in. */
export function typing(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  if (!t) return false
  if (t.isContentEditable) return true
  if (t instanceof HTMLInputElement) return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color'].includes(t.type)
  return t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement
}

/** How long after `g` the second key still counts. */
const CHORD_MS = 1500

export function useGlobalKeys({ chords, onSheet, onPalette }: { chords: Chord[]; onSheet: () => void; onPalette: () => void }) {
  const navigate = useNavigate()
  const g = useRef(0)
  const latest = useRef({ chords, onSheet, onPalette })
  latest.current = { chords, onSheet, onPalette }
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || typing(e)) return
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'))
      const peek = document.querySelector<HTMLElement>('[data-peek-open]')
      // Inside a peek, `o` opens the full page; every other dialog keeps its keys.
      if (dialogs.length) {
        if (e.key === 'o' && peek && dialogs.length === 1 && peek.dataset.peekOpen) {
          e.preventDefault()
          navigate(peek.dataset.peekOpen)
        }
        return
      }
      const { chords: list, onSheet: sheet, onPalette: palette } = latest.current
      if (g.current && Date.now() - g.current < CHORD_MS) {
        g.current = 0
        const c = list.find((x) => x.key === e.key)
        if (c) {
          e.preventDefault()
          navigate(c.to)
        }
        return
      }
      if (e.key === 'g') {
        g.current = Date.now()
        return
      }
      if (e.key === '?') {
        e.preventDefault()
        sheet()
      } else if (e.key === '/') {
        e.preventDefault()
        const find = document.querySelector<HTMLElement>('[data-page-search]')
        if (find) find.focus()
        else palette()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [navigate])
}

/** Everything the keyboard can do, in one sheet (`?`). */
export function ShortcutSheet({ chords, onClose }: { chords: Chord[]; onClose: () => void }) {
  const rows: [string[] | string, string][] = [
    [[isMac ? '⌘' : 'Ctrl', 'K'], 'Search and jump to a screen, an order, a batch or a pincode; type > for actions, #1042 for an order'],
    ['?', 'Show these shortcuts'],
    ['/', 'Search on this page (the palette where a page has no search)'],
    ...chords.map((c): [string[], string] => [['g', c.key], `Go to ${c.label}`]),
    [['j', 'k'], 'Next and previous row in a list'],
    ['x', 'Select the row'],
    ['Enter', 'Peek at the row without leaving the list'],
    ['o', 'Open the row, or the peeked order, on its own page'],
    ['a', 'Assign a rider to the selected stops (Deliveries)'],
    ['Esc', 'Close a menu, the peek or a dialog'],
  ]
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose} footer={<button type="button" className="btn" onClick={onClose}>Close</button>}>
      <p className="muted small mt-0">Shortcuts never fire while you type in a field.</p>
      <dl className="shortcuts">
        {rows.map(([k, what]) => (
          <div key={what} className="shortcut-row">
            <dt>
              <Kbd keys={k} />
            </dt>
            <dd>{what}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  )
}
