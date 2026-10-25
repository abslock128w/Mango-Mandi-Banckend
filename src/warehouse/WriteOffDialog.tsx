// Asks to write boxes off. Small write-offs apply at once; larger ones wait
// for a second manager (the API answers 202 with status 'pending').

import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Dialog, FormError, useToast } from '../ui'
import { wh } from './api'
import { WRITE_OFF_REASON_LABEL } from './labels'
import type { WriteOffReason, WriteOffResult } from './types'

const REASONS = Object.keys(WRITE_OFF_REASON_LABEL) as WriteOffReason[]

export function WriteOffDialog({ boxIds, what, onClose, onDone }: { boxIds: string[]; what: string; onClose: () => void; onDone?: (r: WriteOffResult) => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [reasonCode, setReasonCode] = useState<WriteOffReason>('damaged')
  const [reason, setReason] = useState('')
  const [formError, setFormError] = useState<unknown>(null)
  const m = useMutation({
    mutationFn: () => wh.requestWriteOff({ boxIds, reasonCode, reason: reason.trim() }),
    onSuccess: (r) => {
      toast.success(
        r.status === 'applied'
          ? `${r.boxes} ${r.boxes === 1 ? 'box' : 'boxes'} written off.`
          : `Sent for approval: another manager must approve writing off ${r.boxes} ${r.boxes === 1 ? 'box' : 'boxes'}.`,
      )
      void queryClient.invalidateQueries({ queryKey: ['wh'] })
      onDone?.(r)
      onClose()
    },
  })
  function submit(e: FormEvent) {
    e.preventDefault()
    if (reason.trim().length < 3) return setFormError('Say what happened (at least 3 characters).')
    setFormError(null)
    m.mutate()
  }
  return (
    <Dialog
      title={`Write off ${what}`}
      tone="danger"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="writeoff-form" className="btn btn-danger" disabled={m.isPending}>
            {m.isPending ? 'Sending…' : 'Write off'}
          </button>
        </>
      }
    >
      <form id="writeoff-form" onSubmit={submit} noValidate>
        <p>Written-off boxes leave stock for good. Large write-offs wait for a second manager.</p>
        <div className="field">
          <label htmlFor="wo-code">Reason</label>
          <select id="wo-code" value={reasonCode} onChange={(e) => setReasonCode(e.target.value as WriteOffReason)} data-autofocus>
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {WRITE_OFF_REASON_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="wo-reason">What happened</label>
          <input id="wo-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
        </div>
        <FormError error={formError ?? m.error} />
      </form>
    </Dialog>
  )
}
