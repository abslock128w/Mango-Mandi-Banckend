import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ApiError } from './apiAnswer'
import { Dialog, FormError } from './ui'

type Method = 'code' | 'password'
type Ask = { method: Method; failed: string | null; resolve: (value: string | null) => void }

const STEP_UP_CODES = new Set(['REAUTH_REQUIRED', 'REAUTH_FAILED'])

/**
 * SEC-07: when the server asks a manager to confirm a staff change (403
 * REAUTH_REQUIRED, or REAUTH_FAILED for a wrong one), asks for their
 * authenticator code or password and sends the same change again with it.
 * `run` wraps a mutation's call; render `dialog` once in the page.
 * Cancelling rejects with the server's own refusal, so the calling dialog
 * shows why nothing changed.
 */
export function useStepUp(why = STAFF_CHANGE_WHY): { run: <T>(call: (confirmCode?: string) => Promise<T>) => Promise<T>; dialog: ReactNode } {
  const [ask, setAsk] = useState<Ask | null>(null)

  async function run<T>(call: (confirmCode?: string) => Promise<T>): Promise<T> {
    let confirmCode: string | undefined
    for (;;) {
      try {
        return await call(confirmCode)
      } catch (err) {
        if (!(err instanceof ApiError) || !STEP_UP_CODES.has(err.code)) throw err
        const method: Method = err.extra.method === 'code' ? 'code' : 'password'
        const given = await new Promise<string | null>((resolve) => setAsk({ method, failed: err.code === 'REAUTH_FAILED' ? err.message : null, resolve }))
        setAsk(null)
        if (!given) throw err
        confirmCode = given
      }
    }
  }

  return { run, dialog: ask ? <StepUpDialog ask={ask} why={why} /> : null }
}

const STAFF_CHANGE_WHY = "Changes to staff accounts need you to confirm who you are, so a session left open can't be used to add or take over an account."

/** Refunds, prices, promo codes, shop rules and costs always ask (the server's STEP_UP_ROUTES). */
export const MONEY_CHANGE_WHY = "Refunds, prices, promo codes, shop rules and costs need you to confirm who you are, so a session left open can't be used to move money."

function StepUpDialog({ ask, why }: { ask: Ask; why: string }) {
  const [value, setValue] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const done = useRef(false)
  const finish = (v: string | null) => {
    if (done.current) return
    done.current = true
    ask.resolve(v)
  }
  const code = ask.method === 'code'

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const v = code ? value.replace(/\s/g, '') : value
    if (code && !/^\d{6}$/.test(v)) return setFormError('Enter the 6 digits from your authenticator app.')
    if (!code && !v) return setFormError('Enter your password.')
    finish(v)
  }

  return (
    <Dialog
      title="Confirm it's you"
      onClose={() => finish(null)}
      footer={
        <>
          <button type="button" className="btn" onClick={() => finish(null)}>
            Cancel
          </button>
          <button type="submit" form="step-up-form" className="btn btn-primary">
            Confirm
          </button>
        </>
      }
    >
      <form id="step-up-form" onSubmit={onSubmit} noValidate>
        <p>{why}</p>
        <div className="field">
          <label htmlFor="step-up-value">{code ? 'Code from your authenticator app' : 'Your password'}</label>
          <input
            id="step-up-value"
            data-autofocus
            type={code ? 'text' : 'password'}
            inputMode={code ? 'numeric' : undefined}
            autoComplete={code ? 'one-time-code' : 'current-password'}
            maxLength={code ? 7 : 200}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <FormError error={formError ?? ask.failed} />
      </form>
    </Dialog>
  )
}
