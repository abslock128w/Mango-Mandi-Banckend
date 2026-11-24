import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { can } from '../permissions'
import { useSession } from '../session'
import type { Pincode } from '../types'
import { Badge, ConfirmDialog, Dialog, EmptyState, FormError, GatedButton, ManagerOnlyNote, QueryError, Spinner, useToast, scrollRegion, usePageTitle } from '../ui'

export default function Pincodes() {
  usePageTitle('Pincodes')
  const { me } = useSession()
  const toast = useToast()
  const queryClient = useQueryClient()
  const q = useQuery({ queryKey: ['pincodes'], queryFn: api.pincodes })
  const [adding, setAdding] = useState(false)
  const [deactivating, setDeactivating] = useState<Pincode | null>(null)
  const [deleting, setDeleting] = useState<Pincode | null>(null)
  const [centring, setCentring] = useState<Pincode | null>(null)

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['pincodes'] })

  const toggle = useMutation({
    mutationFn: (p: { pincode: string; active: boolean }) => api.updatePincode(p.pincode, { active: p.active }),
    onSuccess: (_r, p) => {
      toast.success(`${p.pincode} ${p.active ? 'activated' : 'deactivated'}`)
      setDeactivating(null)
      refresh()
    },
    onError: (err) => toast.error(err),
  })
  const remove = useMutation({
    mutationFn: (pincode: string) => api.deletePincode(pincode),
    onSuccess: (_r, pincode) => {
      toast.success(`${pincode} deleted`)
      setDeleting(null)
      refresh()
    },
  })

  const canDelete = can(me?.role, 'deletePincode')
  // Without a centre the delivery charge can't check a customer's pin, so it charges the assumed distance.
  const noCentre = (q.data ?? []).filter((p) => !hasCentre(p))

  return (
    <>
      <div className="topbar">
        <h1>Pincodes</h1>
        <span className="spacer" />
        <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
          Add pincode
        </button>
      </div>

      {noCentre.length > 0 && (
        <p className="notice notice-warn" role="status">
          {noCentre.length === 1 ? `${noCentre[0].pincode} has` : `${noCentre.length} pincodes have`} no centre ({noCentre.map((p) => p.pincode).join(', ')}).
          The delivery charge there can't be worked out from the customer's map pin: the assumed distance is charged. Set
          the centre's latitude and longitude.
        </p>
      )}

      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState>No delivery areas yet. Add a pincode to start taking orders there.</EmptyState>
      ) : (
        <div {...scrollRegion('Pincodes')}>
          <table>
            <thead>
              <tr>
                <th>Pincode</th>
                <th>City</th>
                <th>Zone</th>
                <th>Centre</th>
                <th>Status</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((p) => (
                <tr key={p.pincode}>
                  <td>
                    <strong>{p.pincode}</strong>
                  </td>
                  <td>{p.city}</td>
                  <td>{p.zone ?? '—'}</td>
                  <td>{hasCentre(p) ? `${p.lat!.toFixed(5)}, ${p.lng!.toFixed(5)}` : <Badge tone="warn">Not set</Badge>}</td>
                  <td>
                    <Badge tone={p.active ? 'good' : 'neutral'}>{p.active ? 'Active' : 'Inactive'}</Badge>
                  </td>
                  <td>
                    <div className="btn-row">
                      <button type="button" className="btn btn-small" onClick={() => setCentring(p)}>
                        {hasCentre(p) ? 'Edit centre' : 'Set centre'}<span className="sr-only"> of {p.pincode}</span>
                      </button>
                      {p.active ? (
                        <button type="button" className="btn btn-small" onClick={() => setDeactivating(p)}>
                          Deactivate<span className="sr-only"> {p.pincode}</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-small"
                          disabled={toggle.isPending}
                          onClick={() => toggle.mutate({ pincode: p.pincode, active: true })}
                        >
                          Activate<span className="sr-only"> {p.pincode}</span>
                        </button>
                      )}
                      <GatedButton allowed={canDelete} className="btn btn-small btn-danger" onClick={() => setDeleting(p)}>
                        Delete<span className="sr-only"> {p.pincode}</span>
                      </GatedButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!canDelete && q.data && q.data.length > 0 && <ManagerOnlyNote what="Deleting a pincode" />}

      {adding && <AddDialog onClose={() => setAdding(false)} onDone={refresh} />}
      {centring && <CentreDialog pincode={centring} onClose={() => setCentring(null)} onDone={refresh} />}

      {deactivating && (
        <ConfirmDialog
          title={`Deactivate ${deactivating.pincode}?`}
          tone="danger"
          confirmLabel="Deactivate"
          cancelLabel="Keep active"
          busy={toggle.isPending}
          onClose={() => setDeactivating(null)}
          onConfirm={() => toggle.mutate({ pincode: deactivating.pincode, active: false })}
        >
          <p>
            Customers in {deactivating.city} ({deactivating.pincode}) will no longer be able to order. You can activate it
            again at any time.
          </p>
        </ConfirmDialog>
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.pincode}?`}
          tone="danger"
          confirmLabel="Delete pincode"
          busy={remove.isPending}
          error={remove.error}
          onClose={() => setDeleting(null)}
          onConfirm={() => remove.mutate(deleting.pincode)}
        >
          <p>
            This removes {deleting.pincode} ({deleting.city}) entirely. If you only want to stop orders there,{' '}
            <strong>deactivate</strong> it instead.
          </p>
        </ConfirmDialog>
      )}
    </>
  )
}

function AddDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [pincode, setPincode] = useState('')
  const [city, setCity] = useState('')
  const [zone, setZone] = useState('')
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const add = useMutation({
    mutationFn: (centre: Centre | null) => api.addPincode({ pincode, city: city.trim(), zone: zone.trim() || undefined, ...(centre ?? {}) }),
    onSuccess: () => {
      toast.success(`${pincode} saved`)
      onDone()
      onClose()
    },
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!/^\d{6}$/.test(pincode)) return setFormError('Pincode must be exactly 6 digits.')
    if (!city.trim()) return setFormError('City is required.')
    const centre = readCentre(lat, lng, true)
    if (typeof centre === 'string') return setFormError(centre)
    add.mutate(centre)
  }

  return (
    <Dialog
      title="Add pincode"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="pin-form" className="btn btn-primary" disabled={add.isPending}>
            {add.isPending ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form id="pin-form" onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor="pin-code">Pincode</label>
          <input
            id="pin-code"
            inputMode="numeric"
            maxLength={6}
            value={pincode}
            onChange={(e) => setPincode(e.target.value.replace(/\D/g, ''))}
          />
          <p className="hint">Adding an existing pincode updates it.</p>
        </div>
        <div className="field">
          <label htmlFor="pin-city">City</label>
          <input id="pin-city" value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pin-zone">Zone (optional)</label>
          <input id="pin-zone" value={zone} onChange={(e) => setZone(e.target.value)} />
        </div>
        <CentreFields lat={lat} lng={lng} setLat={setLat} setLng={setLng} optional />
        <FormError error={formError ?? add.error} />
      </form>
    </Dialog>
  )
}

type Centre = { lat: number; lng: number }

const hasCentre = (p: Pincode) => p.lat != null && p.lng != null

/**
 * The centre typed on the page, checked as the API checks it: both or neither (when optional), numbers,
 * and inside India, which also catches latitude and longitude swapped. Null: none given. A string: what's wrong.
 */
function readCentre(latText: string, lngText: string, optional: boolean): Centre | null | string {
  const a = latText.trim()
  const b = lngText.trim()
  if (!a && !b) return optional ? null : 'Enter the latitude and longitude of the centre.'
  if (!a || !b) return 'Enter both the latitude and the longitude, or neither.'
  const lat = Number(a)
  const lng = Number(b)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 'Latitude and longitude are numbers, like 12.9279 and 77.6271.'
  if (lat < 6 || lat > 37.5) return 'Latitude must be between 6 and 37.5 (India). Check it isn’t swapped with the longitude.'
  if (lng < 68 || lng > 97.5) return 'Longitude must be between 68 and 97.5 (India). Check it isn’t swapped with the latitude.'
  return { lat, lng }
}

function CentreFields({ lat, lng, setLat, setLng, optional = false }: { lat: string; lng: string; setLat: (v: string) => void; setLng: (v: string) => void; optional?: boolean }) {
  return (
    <>
      <div className="field">
        <label htmlFor="pin-lat">Centre latitude{optional ? ' (optional)' : ''}</label>
        <input id="pin-lat" inputMode="decimal" placeholder="12.9279" value={lat} onChange={(e) => setLat(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="pin-lng">Centre longitude{optional ? ' (optional)' : ''}</label>
        <input id="pin-lng" inputMode="decimal" placeholder="77.6271" value={lng} onChange={(e) => setLng(e.target.value)} />
        <p className="hint">The middle of the area, from Google Maps (right-click, the first line). The delivery charge never goes below this point's distance, less 1.5 km.</p>
      </div>
    </>
  )
}

function CentreDialog({ pincode, onClose, onDone }: { pincode: Pincode; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [lat, setLat] = useState(pincode.lat != null ? String(pincode.lat) : '')
  const [lng, setLng] = useState(pincode.lng != null ? String(pincode.lng) : '')
  const [formError, setFormError] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: (centre: Centre) => api.updatePincode(pincode.pincode, centre),
    onSuccess: () => {
      toast.success(`Centre of ${pincode.pincode} saved`)
      onDone()
      onClose()
    },
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    const centre = readCentre(lat, lng, false)
    if (typeof centre === 'string' || centre === null) return setFormError(typeof centre === 'string' ? centre : 'Enter the centre.')
    save.mutate(centre)
  }

  return (
    <Dialog
      title={`Centre of ${pincode.pincode}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="pin-centre-form" className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form id="pin-centre-form" onSubmit={onSubmit} noValidate>
        <CentreFields lat={lat} lng={lng} setLat={setLat} setLng={setLng} />
        <FormError error={formError ?? save.error} />
      </form>
    </Dialog>
  )
}
