// The managers' evening WhatsApp summary (MANAGER_DAILY_SUMMARY, docs/growth.md).
//   DailySummaryCard (Staff page): my own opt-in and the WhatsApp number it goes to.
//   SummaryPreview (Today page): today's numbers so far and the message as it would read now.
// Both only for managers; the API refuses everyone else and answers 404 while the switch is off.
import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { date } from '../format'
import { Dialog, FormError, QueryError, Spinner, useToast } from '../ui'

export function DailySummaryCard() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const q = useQuery({ queryKey: ['daily-summary-setting'], queryFn: api.dailySummarySetting })
  const [phone, setPhone] = useState('')
  const save = useMutation({
    mutationFn: (optedIn: boolean) => api.saveDailySummarySetting(phone.trim() ? { optedIn, phone: phone.trim() } : { optedIn }),
    onSuccess: (s) => {
      setPhone('')
      queryClient.setQueryData(['daily-summary-setting'], s)
      void queryClient.invalidateQueries({ queryKey: ['staff'] })
      toast.success(s.optedIn ? `The evening summary goes to ${s.phone} at ${s.time}` : 'Evening summary turned off')
    },
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    save.mutate(true)
  }

  return (
    <section className="card" aria-labelledby="summary-title">
      <h2 id="summary-title">My evening summary</h2>
      {q.isPending ? (
        <Spinner label="Loading your summary setting" />
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <p className="small muted">
            Each evening at {q.data.time} (IST) WhatsApp sends you the day's orders and revenue, boxes delivered and failed, new claims, unhappy ratings
            and how many things need attention. Once a day.
          </p>
          <p data-testid="summary-state">
            {q.data.optedIn ? (
              <>
                <strong>On</strong>, to {q.data.phone}
              </>
            ) : (
              <>
                <strong>Off</strong>
                {q.data.phone ? `. Number on file: ${q.data.phone}` : ''}
              </>
            )}
          </p>
          <form onSubmit={submit} className="btn-row">
            <div className="field m-0">
              <label htmlFor="summary-phone">{q.data.phone ? 'New WhatsApp number (optional)' : 'WhatsApp number'}</label>
              <input id="summary-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" />
            </div>
            <button type="submit" className="btn btn-primary" disabled={save.isPending}>
              {q.data.optedIn ? 'Save number' : 'Send me the summary'}
            </button>
            {q.data.optedIn && (
              <button type="button" className="btn" disabled={save.isPending} onClick={() => save.mutate(false)}>
                Stop sending
              </button>
            )}
          </form>
          <FormError error={save.error} />
        </>
      )}
    </section>
  )
}

/** A button on Today that opens today's summary as it would be sent now. Sends nothing. */
export function SummaryPreviewButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        Preview today's summary
      </button>
      {open && <SummaryPreview onClose={() => setOpen(false)} />}
    </>
  )
}

function SummaryPreview({ onClose }: { onClose: () => void }) {
  const q = useQuery({ queryKey: ['daily-summary-preview'], queryFn: api.dailySummaryPreview })
  return (
    <Dialog
      title="Today's summary"
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Close
        </button>
      }
    >
      {q.isPending ? (
        <Spinner label="Loading today's numbers" />
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <pre className="summary-preview" data-testid="summary-text">
            {q.data.text}
          </pre>
          <p className="small muted">
            Numbers so far for {date(q.data.day)}. Sent at {q.data.sendsAt} to {q.data.recipients} {q.data.recipients === 1 ? 'manager' : 'managers'} who
            turned it on (Staff page)
            {q.data.sentToday ? `; already sent to ${q.data.sentToday} today` : ''}.
          </p>
        </>
      )}
    </Dialog>
  )
}
