// Partner Network categories: the choices applicants tick on the shop's form, with how many
// enquiries chose each. Managers can rename, describe, hide or reorder them; codes never
// change, because the questionnaire refers to them. Operators see the list only.
import { useId, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from '../../session'
import { Badge, Dialog, DisabledReason, EmptyState, FormError, scrollRegion, usePageTitle, useToast } from '../../ui'
import { pn } from './api'
import { LoadError, PartnerSubnav, Skeleton } from './shared'
import type { PartnerCategory } from './types'

export default function Categories() {
  usePageTitle('Partner categories')
  const { me } = useSession()
  const isManager = me?.role === 'MANAGER'
  const q = useQuery({ queryKey: ['pn-categories'], queryFn: pn.categories })
  const [editing, setEditing] = useState<PartnerCategory | null>(null)
  const rows = q.data ? [...q.data.categories].sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)) : []
  return (
    <>
      <div className="topbar">
        <h1>Categories</h1>
      </div>
      <PartnerSubnav />
      <p className="muted">
        The kinds of partnership applicants choose from on the Partner With Us form. A hidden category is no longer offered; enquiries that chose it keep it.
      </p>
      {!isManager && <DisabledReason>Editing categories: requires manager role.</DisabledReason>}
      {q.isPending ? (
        <Skeleton lines={6} />
      ) : q.isError ? (
        <LoadError error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState>No categories.</EmptyState>
      ) : (
        <div {...scrollRegion('Categories', { cards: true })}>
          <table>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Description</th>
                <th scope="col">On the form</th>
                <th scope="col" className="num">
                  Order
                </th>
                <th scope="col" className="num">
                  Enquiries
                </th>
                {isManager && <th scope="col">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.code}>
                  <td className="card-title">
                    <strong>{c.name}</strong>
                    <div className="mono small muted">{c.code}</div>
                  </td>
                  <td className="card-wide" data-label="Description">
                    {c.description || '—'}
                  </td>
                  <td className="card-status">
                    <Badge tone={c.active ? 'good' : 'neutral'}>{c.active ? 'Shown' : 'Hidden'}</Badge>
                  </td>
                  <td className="num" data-label="Order">
                    {c.displayOrder}
                  </td>
                  <td className="num" data-label="Enquiries">
                    {c.enquiries}
                  </td>
                  {isManager && (
                    <td>
                      <button type="button" className="btn btn-small" onClick={() => setEditing(c)}>
                        Edit<span className="sr-only"> {c.name}</span>
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <EditCategory category={editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function EditCategory({ category, onClose }: { category: PartnerCategory; onClose: () => void }) {
  const uid = useId()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [name, setName] = useState(category.name)
  const [description, setDescription] = useState(category.description ?? '')
  const [active, setActive] = useState(category.active)
  const [order, setOrder] = useState(String(category.displayOrder))
  const orderNum = Number(order)
  const valid = name.trim().length >= 2 && description.trim().length >= 2 && order.trim() !== '' && Number.isInteger(orderNum) && orderNum >= 0
  const save = useMutation({
    mutationFn: () => {
      // Only what changed, so a stale form never overwrites someone else's edit of another field.
      const patch: Parameters<typeof pn.patchCategory>[1] = {}
      if (name.trim() !== category.name) patch.name = name.trim()
      if (description.trim() !== (category.description ?? '')) patch.description = description.trim()
      if (active !== category.active) patch.active = active
      if (orderNum !== category.displayOrder) patch.displayOrder = orderNum
      return pn.patchCategory(category.code, patch)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pn-categories'] })
      toast.success(`${name.trim()} saved`)
      onClose()
    },
  })
  function submit(e: FormEvent) {
    e.preventDefault()
    if (valid && !save.isPending) save.mutate()
  }
  return (
    <Dialog
      title={`Edit ${category.name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form={`${uid}-form`} className="btn btn-primary" disabled={!valid || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save category'}
          </button>
        </>
      }
    >
      <form id={`${uid}-form`} onSubmit={submit}>
        <p className="muted small">
          Code <span className="mono">{category.code}</span> stays the same: the questionnaire refers to it.
        </p>
        <div className="field">
          <label htmlFor={`${uid}-name`}>Name</label>
          <input id={`${uid}-name`} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${uid}-desc`}>Description</label>
          <textarea id={`${uid}-desc`} rows={3} required minLength={2} maxLength={600} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${uid}-order`}>Display order</label>
          <input id={`${uid}-order`} type="number" min={0} step={1} inputMode="numeric" value={order} onChange={(e) => setOrder(e.target.value)} aria-describedby={`${uid}-order-hint`} />
          <p id={`${uid}-order-hint`} className="hint">
            Lower numbers come first on the form.
          </p>
        </div>
        <label className="check-inline">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Show on the Partner With Us form
        </label>
        <FormError error={save.error} />
      </form>
    </Dialog>
  )
}
