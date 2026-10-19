import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { useStore } from '../store'
import { Dialog, ErrorNote, Spinner } from '../ui'

export default function Account() {
  const { profile } = useStore()
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const remove = useMutation({
    mutationFn: api.deleteAccount,
    onSuccess: () => navigate('/?deleted=1', { replace: true }),
  })

  return (
    <>
      <section className="card narrow" aria-labelledby="account">
        <h1 id="account">Your account</h1>
        <dl className="details">
          <dt>Mobile number</dt>
          <dd>{profile?.phone ? `+91 ${profile.phone.replace(/^\+91/, '')}` : 'Not added yet'}</dd>
          {profile?.email && (
            <>
              <dt>Google account</dt>
              <dd>{profile.email}</dd>
            </>
          )}
          {profile?.name && (
            <>
              <dt>Name</dt>
              <dd>{profile.name}</dd>
            </>
          )}
        </dl>
        <p className="small muted">
          How we use these details is in our <Link to="/privacy">privacy notice</Link>.
        </p>
      </section>

      <SavedAddresses />

      <section className="card narrow" aria-labelledby="delete-account">
        <h2 id="delete-account">Delete your account</h2>
        <p>
          We remove your name, mobile number, email and delivery addresses. Past orders keep only their amounts, for our accounts. You can't
          delete your account while an order or booking is on its way.
        </p>
        <button type="button" className="btn btn-danger" onClick={() => setConfirming(true)}>
          Delete my account
        </button>
      </section>

      {confirming && (
        <Dialog
          title="Delete your account?"
          onClose={() => setConfirming(false)}
          footer={
            <>
              <button type="button" className="btn btn-quiet" onClick={() => setConfirming(false)}>
                Keep my account
              </button>
              <button type="button" className="btn btn-danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
                {remove.isPending ? 'Deleting…' : 'Delete account'}
              </button>
            </>
          }
        >
          <p>This can't be undone. Your order history goes, and you'll be signed out.</p>
          <ErrorNote error={remove.error} />
        </Dialog>
      )}
    </>
  )
}

function SavedAddresses() {
  const queryClient = useQueryClient()
  const q = useQuery({ queryKey: ['addresses'], queryFn: api.addresses })
  const forget = useMutation({
    mutationFn: api.forgetAddress,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['addresses'] }),
  })
  return (
    <section className="card narrow" aria-labelledby="addresses">
      <h2 id="addresses">Saved addresses</h2>
      {q.isPending ? (
        <Spinner label="Loading addresses" />
      ) : q.isError ? (
        <ErrorNote error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <p className="muted">Addresses you order to are kept here, so next time you can pick one instead of typing it.</p>
      ) : (
        <ul className="address-list">
          {q.data.map((a) => (
            <li key={a.id}>
              <div>
                {a.name && <strong>{a.name}</strong>}
                <span>{a.address}</span>
                <span className="muted small">Pincode {a.pincode}</span>
              </div>
              <button type="button" className="link-btn" disabled={forget.isPending} onClick={() => forget.mutate(a.id)} aria-label={`Remove ${a.address}`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <ErrorNote error={forget.error} />
    </section>
  )
}
