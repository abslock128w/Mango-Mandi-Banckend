// The link to a customer's profile (docs/trust.md), used on order detail,
// claims and reviews. Only shown to roles that may open profiles, while
// profiles are switched on; opening one is recorded in the activity log.
import { Link } from 'react-router-dom'
import { trustAllowed } from './permissions'
import { useSession } from './session'

export function CustomerProfileLink({ customerId, children = 'Customer profile' }: { customerId: string | null | undefined; children?: string }) {
  const { me } = useSession()
  if (!customerId || !trustAllowed(me, 'customerProfiles')) return null
  return (
    <Link className="inline-link" to={`/customers/${encodeURIComponent(customerId)}`}>
      {children}
    </Link>
  )
}
