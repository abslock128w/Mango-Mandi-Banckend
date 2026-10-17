import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError, api } from '../api'
import { useSession } from '../session'
import { FormError } from '../ui'
import { GoogleSignIn } from '../google'

export default function Login() {
  const { me, setMe } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const from = (location.state as { from?: string } | null)?.from ?? '/'
  if (me) return <Navigate to={from} replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const signedIn = await api.login(email.trim(), password)
      setMe(signedIn)
      navigate(from, { replace: true })
    } catch (err) {
      // Never say which field was wrong.
      setError(err instanceof ApiError && (err.status === 401 || err.status === 400) ? 'Invalid credentials' : err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login-wrap">
      <div className="card login-card">
        <h1>Mango Ops</h1>
        {params.get('reason') === 'expired' && (
          <div className="notice notice-warn" role="status">
            Your session has ended. Please sign in again.
          </div>
        )}
        <GoogleSignIn
          onSignedIn={(signedIn) => {
            setMe(signedIn)
            navigate(from, { replace: true })
          }}
          onError={setError}
        />
        <form onSubmit={onSubmit} noValidate>
          <div className="field">
            <label htmlFor="email">Work email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <FormError error={error} />
          <button type="submit" className="btn btn-primary" disabled={busy || !email.trim() || !password}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  )
}
