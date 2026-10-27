// Locations: the places boxes sit (shelves, cold rooms, packing benches), each
// with its own label to scan. Adding, renaming and switching one off is for
// managers.

import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge, ConfirmDialog, Dialog, EmptyState, FormError, QueryError, Spinner, scrollRegion, useToast, usePageTitle } from '../../ui'
import { useWh } from '../access'
import { wh } from '../api'
import { LOCATION_TYPES, LOCATION_TYPE_LABEL } from '../labels'
import type { LocationType, WhLocation } from '../types'
import { DownloadButton } from '../ui'

export default function Locations() {
  usePageTitle('Locations')
  const { can } = useWh()
  const toast = useToast()
  const queryClient = useQueryClient()
  const q = useQuery({ queryKey: ['wh', 'locations'], queryFn: wh.locations })
  const [editing, setEditing] = useState<WhLocation | 'new' | null>(null)
  const [toggling, setToggling] = useState<WhLocation | null>(null)
  const manage = can('locations.manage')

  const toggle = useMutation({
    mutationFn: (l: WhLocation) => wh.updateLocation(l.id, { active: !l.active }),
    onSuccess: (l) => {
      setToggling(null)
      toast.success(l.active ? `${l.name} is back on.` : `${l.name} is switched off.`)
      void queryClient.invalidateQueries({ queryKey: ['wh', 'locations'] })
    },
  })

  return (
    <>
      <div className="topbar">
        <h1>Locations</h1>
        <span className="spacer" />
        {manage && (
          <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
            Add location
          </button>
        )}
      </div>
      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState>No locations yet.</EmptyState>
      ) : (
        <div {...scrollRegion('Locations', { cards: true })}>
          <table>
            <thead>
              <tr>
                <th>Location</th>
                <th>Status</th>
                <th>Type</th>
                <th className="num">Boxes</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((l) => (
                <tr key={l.id}>
                  <td className="card-title">
                    {l.name}
                    {l.zone && <div className="muted small">Zone {l.zone}</div>}
                  </td>
                  <td className="card-status">
                    <Badge tone={l.active ? 'good' : 'neutral'}>{l.active ? 'In use' : 'Switched off'}</Badge>
                  </td>
                  <td data-label="Type">
                    {LOCATION_TYPE_LABEL[l.type] ?? l.type}
                    {l.pickable ? ' · pickable' : ''}
                  </td>
                  <td className="num" data-label="Boxes">
                    {l.boxes ?? 0}
                  </td>
                  <td className="card-wide">
                    <div className="btn-row">
                      {can('labels.print') && (
                        <DownloadButton className="btn btn-small" getUrl={() => wh.locationLabelUrl(l.id)} filename={`location-${l.name}.pdf`}>
                          Label<span className="sr-only"> for {l.name}</span>
                        </DownloadButton>
                      )}
                      {manage && (
                        <>
                          <button type="button" className="btn btn-small" onClick={() => setEditing(l)}>
                            Rename<span className="sr-only"> {l.name}</span>
                          </button>
                          <button type="button" className="btn btn-small" onClick={() => setToggling(l)}>
                            {l.active ? 'Switch off' : 'Switch on'}
                            <span className="sr-only"> {l.name}</span>
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <LocationDialog location={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {toggling && (
        <ConfirmDialog
          title={toggling.active ? `Switch off ${toggling.name}?` : `Switch on ${toggling.name}?`}
          confirmLabel={toggling.active ? 'Switch off' : 'Switch on'}
          tone={toggling.active ? 'danger' : undefined}
          busy={toggle.isPending}
          error={toggle.error}
          onConfirm={() => toggle.mutate(toggling)}
          onClose={() => setToggling(null)}
        >
          <p>{toggling.active ? 'No box can be moved here while it is off. Boxes already here stay.' : 'Boxes can be moved here again.'}</p>
        </ConfirmDialog>
      )}
    </>
  )
}

function LocationDialog({ location, onClose }: { location: WhLocation | null; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [name, setName] = useState(location?.name ?? '')
  const [zone, setZone] = useState(location?.zone ?? '')
  const [type, setType] = useState<LocationType>(location?.type ?? 'storage')
  const [formError, setFormError] = useState<unknown>(null)
  const m = useMutation({
    mutationFn: () => {
      const b = { name: name.trim(), type, ...(zone.trim() ? { zone: zone.trim() } : {}) }
      return location ? wh.updateLocation(location.id, b) : wh.addLocation(b)
    },
    onSuccess: (l) => {
      toast.success(location ? `Saved ${l.name}.` : `${l.name} added. Print its label.`)
      void queryClient.invalidateQueries({ queryKey: ['wh', 'locations'] })
      onClose()
    },
  })
  function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setFormError('Give the location a name.')
    setFormError(null)
    m.mutate()
  }
  return (
    <Dialog
      title={location ? `Rename ${location.name}` : 'Add location'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="loc-form" className="btn btn-primary" disabled={m.isPending}>
            {m.isPending ? 'Saving…' : location ? 'Save' : 'Add location'}
          </button>
        </>
      }
    >
      <form id="loc-form" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="loc-name">Name</label>
          <input id="loc-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} data-autofocus />
        </div>
        <div className="field">
          <label htmlFor="loc-zone">Zone (optional)</label>
          <input id="loc-zone" value={zone} onChange={(e) => setZone(e.target.value)} maxLength={40} />
        </div>
        <div className="field">
          <label htmlFor="loc-type">Type</label>
          <select id="loc-type" value={type} onChange={(e) => setType(e.target.value as LocationType)}>
            {LOCATION_TYPES.map((t) => (
              <option key={t} value={t}>
                {LOCATION_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
        <FormError error={formError ?? m.error} />
      </form>
    </Dialog>
  )
}
