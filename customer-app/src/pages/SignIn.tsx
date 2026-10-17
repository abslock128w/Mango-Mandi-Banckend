import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { api, errorMessage } from '../api'
import { useStore } from '../store'

const tenDigits = (s: string) => s.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '')

export default function SignIn() {
  const { phone: signedIn, refreshPhone } = useStore()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next')?.startsWith('/') ? params.get('next')! : '/'
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState<{ channel: 'sms' | 'whatsapp'; devCode?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const request = useMutation({
    mutationFn: (channel?: 'sms' | 'whatsapp') => api.requestCode(tenDigits(phone), channel),
    onSuccess: (r) => {
      setSent(r)
      setCode('')
      setError(null)
    },
    onError: (err) => setError(errorMessage(err)),
  })
  const verify = useMutation({
    mutationFn: () => api.verifyCode(tenDigits(phone), code),
    onSuccess: () => {
      refreshPhone()
      navigate(next, { replace: true })
    },
    onError: (err) => setError(errorMessage(err)),
  })

  if (signedIn && !verify.isSuccess) return <Navigate to={next} replace />

  function sendCode(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!/^[6-9]\d{9}$/.test(tenDigits(phone))) return setError('Enter your 10-digit mobile number.')
    request.mutate(undefined)
  }
  function checkCode(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code.')
    verify.mutate()
  }

  return (
    <section className="card narrow">
      <h1>Sign in</h1>
      {!sent ? (
        <form onSubmit={sendCode} noValidate>
          <p className="muted">We'll send a 6-digit code to your phone. No password needed.</p>
          <div className="field">
            <label htmlFor="phone">Mobile number</label>
            <div className="prefixed">
              <span aria-hidden="true">+91</span>
              <input
                id="phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                maxLength={14}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                aria-describedby={error ? 'signin-error' : undefined}
              />
            </div>
          </div>
          {error && (
            <p id="signin-error" className="field-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-primary btn-block" disabled={request.isPending}>
            {request.isPending ? 'Sending…' : 'Send code'}
          </button>
        </form>
      ) : (
        <form onSubmit={checkCode} noValidate>
          <p className="muted">
            We sent a code by {sent.channel === 'whatsapp' ? 'WhatsApp' : 'SMS'} to +91 {tenDigits(phone)}.{' '}
            <button type="button" className="link-btn" onClick={() => setSent(null)}>
              Change number
            </button>
          </p>
          {sent.devCode && <p className="note">Test mode: your code is {sent.devCode}.</p>}
          <div className="field">
            <label htmlFor="code">6-digit code</label>
            <input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              aria-describedby={error ? 'signin-error' : undefined}
            />
          </div>
          {error && (
            <p id="signin-error" className="field-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-primary btn-block" disabled={verify.isPending}>
            {verify.isPending ? 'Checking…' : 'Sign in'}
          </button>
          <div className="resend">
            <button type="button" className="link-btn" disabled={request.isPending} onClick={() => request.mutate('sms')}>
              Send again by SMS
            </button>
            <button type="button" className="link-btn" disabled={request.isPending} onClick={() => request.mutate('whatsapp')}>
              Send on WhatsApp instead
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
