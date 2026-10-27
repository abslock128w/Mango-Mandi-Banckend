// Farms and suppliers, and margins per variety (PURCHASE_RECORDS, docs/ops.md).
// Managers add and edit farms and see margins; operators see the list only. Phone numbers are
// always masked: the API never sends them in full.
import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { date, istDate, rupees } from '../format'
import { useSession } from '../session'
import type { Farm, FarmInput } from '../types'
import { Badge, Dialog, EmptyState, FormError, GatedButton, ManagerOnlyNote, QueryError, Spinner, scrollRegion, useToast, usePageTitle } from '../ui'

export default function Farms() {
  usePageTitle('Farms')
  const { me } = useSession()
  const manager = me?.role === 'MANAGER'
  const q = useQuery({ queryKey: ['farms'], queryFn: api.farms })
  const [editing, setEditing] = useState<Farm | 'new' | null>(null)

  return (
    <>
      <div className="topbar">
        <h1>Farms</h1>
        <span className="spacer" />
        <GatedButton allowed={manager} className="btn btn-primary" onClick={() => setEditing('new')}>
          Add farm
        </GatedButton>
      </div>
      {!manager && <ManagerOnlyNote what="Adding and editing farms" />}
      <section className="card">
        <p className="muted">
          Where each batch comes from. Record what a batch cost on its page (Batches, then the batch), so margins can be worked out.
        </p>
        {q.isPending ? (
          <Spinner />
        ) : q.isError ? (
          <QueryError error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data.length ? (
          <EmptyState>No farms yet. Add the farms and suppliers you buy from.</EmptyState>
        ) : (
          <div {...scrollRegion('Farms')}>
            <table>
              <thead>
                <tr>
                  <th>Farm</th>
                  <th>Place</th>
                  <th>Contact</th>
                  <th>Phone</th>
                  <th className="num">Purchases</th>
                  <th>Last bought</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <strong>{f.name}</strong> {!f.active && <Badge tone="neutral">Off</Badge>}
                    </td>
                    <td>{f.place ?? '—'}</td>
                    <td>{f.contactName ?? '—'}</td>
                    <td>{f.phoneMasked ?? '—'}</td>
                    <td className="num">{f.purchases}</td>
                    <td>{f.lastPurchaseOn ? date(f.lastPurchaseOn) : '—'}</td>
                    <td>
                      {manager && (
                        <button type="button" className="btn btn-small" onClick={() => setEditing(f)}>
                          Edit<span className="sr-only"> {f.name}</span>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {manager && <MarginsCard />}
      {editing && <FarmDialog farm={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function FarmDialog({ farm, onClose }: { farm: Farm | null; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [f, setF] = useState({ name: farm?.name ?? '', place: farm?.place ?? '', contactName: farm?.contactName ?? '', phone: '', removePhone: false, active: farm?.active ?? true })
  const [formError, setFormError] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: (input: FarmInput) => (farm ? api.updateFarm(farm.id, input) : api.addFarm(input)),
    onSuccess: (saved) => {
      toast.success(farm ? `${saved.name} saved` : `${saved.name} added`)
      void queryClient.invalidateQueries({ queryKey: ['farms'] })
      onClose()
    },
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    const name = f.name.trim()
    if (!name) return setFormError('Enter the farm’s name.')
    const phone = f.phone.replace(/[\s-]/g, '')
    if (phone && !/^(\+91|0)?[6-9]\d{9}$/.test(phone)) return setFormError('Enter a 10-digit mobile number, or leave it empty.')
    const input: FarmInput = { name, place: f.place.trim() || null, contactName: f.contactName.trim() || null }
    // Empty keeps the number already saved (it is never shown in full); "remove" clears it.
    if (phone) input.phone = phone
    else if (f.removePhone || !farm) input.phone = null
    if (farm) input.active = f.active
    save.mutate(input)
  }

  const set = (k: 'name' | 'place' | 'contactName' | 'phone') => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  return (
    <Dialog
      title={farm ? `Edit ${farm.name}` : 'Add farm'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="farm-form" className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form id="farm-form" onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor="farm-name">Name</label>
          <input id="farm-name" data-autofocus maxLength={120} value={f.name} onChange={set('name')} />
        </div>
        <div className="field">
          <label htmlFor="farm-place">Place (optional)</label>
          <input id="farm-place" maxLength={120} value={f.place} onChange={set('place')} />
        </div>
        <div className="field">
          <label htmlFor="farm-contact">Contact name (optional)</label>
          <input id="farm-contact" maxLength={120} value={f.contactName} onChange={set('contactName')} />
        </div>
        <div className="field">
          <label htmlFor="farm-phone">{farm?.hasPhone ? 'New phone number (optional)' : 'Phone number (optional)'}</label>
          <input id="farm-phone" type="tel" inputMode="tel" autoComplete="off" maxLength={16} value={f.phone} onChange={set('phone')} />
          {farm?.hasPhone && <p className="hint">Saved: {farm.phoneMasked}. Leave empty to keep it.</p>}
        </div>
        {farm?.hasPhone && (
          <div className="field radio-row">
            <label>
              <input type="checkbox" checked={f.removePhone} onChange={(e) => setF({ ...f, removePhone: e.target.checked })} /> Remove the saved number
            </label>
          </div>
        )}
        {farm && (
          <div className="field radio-row">
            <label>
              <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Still buying from this farm
            </label>
          </div>
        )}
        <FormError error={formError ?? save.error} />
      </form>
    </Dialog>
  )
}

/** Margin per box and per variety for batches bought in the range (managers). */
function MarginsCard() {
  const [range, setRange] = useState({ from: istDate(-89), to: istDate(0) })
  const [shown, setShown] = useState(range)
  const q = useQuery({ queryKey: ['margins', shown], queryFn: () => api.margins(shown) })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setShown(range)
  }

  return (
    <section className="card">
      <h2>Margins</h2>
      <p className="muted">
        For batches bought in these dates: what customers paid for the boxes sold (after promo discounts), less what those boxes cost. A
        batch’s cost is spread evenly over the boxes it was bought as. Only batches with a purchase recorded are counted.
      </p>
      <form className="ops-range" onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="margin-from">From</label>
          <input id="margin-from" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="margin-to">To</label>
          <input id="margin-to" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        </div>
        <button type="submit" className="btn">
          Show
        </button>
      </form>
      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data.varieties.length ? (
        <EmptyState>No purchases recorded for batches bought in these dates.</EmptyState>
      ) : (
        <>
          <div {...scrollRegion('Margins by variety')}>
            <table>
              <thead>
                <tr>
                  <th>Variety</th>
                  <th className="num">Boxes bought</th>
                  <th className="num">Cost per box</th>
                  <th className="num">Boxes sold</th>
                  <th className="num">Revenue</th>
                  <th className="num">Cost of boxes sold</th>
                  <th className="num">Margin</th>
                  <th className="num">Margin per box</th>
                  <th className="num">Cost of boxes not sold</th>
                </tr>
              </thead>
              <tbody>
                {q.data.varieties.map((v) => (
                  <tr key={v.variety}>
                    <td>
                      <strong>{v.variety}</strong> <span className="muted small">{v.batches} batches</span>
                    </td>
                    <td className="num">{v.boughtBoxes}</td>
                    <td className="num">{rupees(v.costPerBox)}</td>
                    <td className="num">{v.soldBoxes}</td>
                    <td className="num">{rupees(v.revenue)}</td>
                    <td className="num">{rupees(v.costOfSold)}</td>
                    <td className={`num${v.margin < 0 ? ' text-warn' : ''}`}>
                      <strong>{rupees(v.margin)}</strong>
                    </td>
                    <td className="num">{v.marginPerBox == null ? '—' : rupees(v.marginPerBox)}</td>
                    <td className="num">{rupees(v.costOfUnsold)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 className="mt-4">By batch</h3>
          <div {...scrollRegion('Margins by batch')}>
            <table>
              <thead>
                <tr>
                  <th>Batch</th>
                  <th className="num">Bought</th>
                  <th className="num">Cost per box</th>
                  <th className="num">Sold</th>
                  <th className="num">Revenue</th>
                  <th className="num">Margin</th>
                  <th className="num">Per box</th>
                </tr>
              </thead>
              <tbody>
                {q.data.batches.map((b) => (
                  <tr key={b.batchId}>
                    <td>
                      <Link to={`/batches/${encodeURIComponent(b.batchId)}`}>
                        {b.variety}, plucked {date(b.pluckedOn)}
                      </Link>
                    </td>
                    <td className="num">{b.boughtBoxes}</td>
                    <td className="num">{rupees(b.costPerBox)}</td>
                    <td className="num">{b.soldBoxes}</td>
                    <td className="num">{rupees(b.revenue)}</td>
                    <td className={`num${b.margin < 0 ? ' text-warn' : ''}`}>{rupees(b.margin)}</td>
                    <td className="num">{b.marginPerBox == null ? '—' : rupees(b.marginPerBox)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
