// Feature switches managers may change (PANEL_FEATURE_SWITCHES, docs/ops.md). Only the safe
// customer-facing ones are listed: security, payment, refund and stock safeguards never are.
// A change asks for the manager's password (or two-step code) again, and is written to the
// activity log. The server's "off" always wins.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { dateTime } from '../format'
import { useStepUp } from '../StepUp'
import type { FeatureSwitch } from '../types'
import { Badge, DisabledReason, EmptyState, QueryError, Spinner, useToast, usePageTitle } from '../ui'

const WHY = 'Turning a feature on or off changes the shop for every customer, so it needs you to confirm who you are.'

/** Where the switch's value comes from, in plain words. */
function source(s: FeatureSwitch): string {
  if (s.killedByEnv) return 'Turned off on the server. That always wins, so it can’t be turned on here.'
  if (s.override === null) return `As the server is set: ${s.envValue ? 'on' : 'off'}.`
  return `Turned ${s.override ? 'on' : 'off'} here${s.updatedBy ? ` by ${s.updatedBy}` : ''}${s.updatedAt ? ` on ${dateTime(s.updatedAt)}` : ''}. The server alone would have it ${s.envValue ? 'on' : 'off'}.`
}

export default function Settings() {
  usePageTitle('Settings')
  const q = useQuery({ queryKey: ['feature-switches'], queryFn: api.featureSwitches })
  const toast = useToast()
  const queryClient = useQueryClient()
  const { run, dialog } = useStepUp(WHY)
  const [busy, setBusy] = useState<string | null>(null)
  const change = useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean | null }) => run((confirmCode) => api.setFeatureSwitch(key, enabled, confirmCode)),
    onMutate: ({ key }) => setBusy(key),
    onSettled: () => setBusy(null),
    onSuccess: (s) => {
      toast.success(`${s.label} is ${s.effective ? 'on' : 'off'}`)
      void queryClient.invalidateQueries({ queryKey: ['feature-switches'] })
    },
    onError: (err) => toast.error(err),
  })

  return (
    <>
      <div className="topbar">
        <h1>Settings</h1>
      </div>
      <section className="card">
        <h2>Features</h2>
        <p className="muted">
          Turn parts of the shop on or off. Every change asks for your password again and goes into the activity log. Other open
          screens and the shop pick a change up within {q.data?.cacheSeconds ?? 30} seconds.
        </p>
        {q.isPending ? (
          <Spinner />
        ) : q.isError ? (
          <QueryError error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data.items.length ? (
          <EmptyState>No features can be switched from here.</EmptyState>
        ) : (
          <ul className="switch-list">
            {q.data.items.map((s) => (
              <li key={s.key} className="switch-item">
                <div className="switch-text">
                  <h3 className="mt-0" id={`switch-${s.key}`}>
                    {s.label} <Badge tone={s.effective ? 'good' : 'neutral'}>{s.effective ? 'On' : 'Off'}</Badge>
                  </h3>
                  <p className="mt-0">{s.description}</p>
                  <p className="muted small mt-0">{source(s)}</p>
                </div>
                <div className="switch-actions" role="group" aria-labelledby={`switch-${s.key}`}>
                  {!s.effective && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={s.killedByEnv || busy === s.key}
                      onClick={() => change.mutate({ key: s.key, enabled: true })}
                    >
                      Turn on<span className="sr-only"> {s.label}</span>
                    </button>
                  )}
                  {s.effective && (
                    <button type="button" className="btn" disabled={busy === s.key} onClick={() => change.mutate({ key: s.key, enabled: false })}>
                      Turn off<span className="sr-only"> {s.label}</span>
                    </button>
                  )}
                  {s.override !== null && (
                    <button type="button" className="btn" disabled={busy === s.key} onClick={() => change.mutate({ key: s.key, enabled: null })}>
                      Use the server’s setting<span className="sr-only"> for {s.label}</span>
                    </button>
                  )}
                  {s.killedByEnv && !s.effective && <DisabledReason>Off on the server.</DisabledReason>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {dialog}
    </>
  )
}
