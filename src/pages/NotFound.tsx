import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="card">
      <h1>Page not found</h1>
      <p className="muted">That address doesn't match any screen.</p>
      <Link to="/today" className="btn btn-primary">
        Go to Today
      </Link>
    </div>
  )
}
