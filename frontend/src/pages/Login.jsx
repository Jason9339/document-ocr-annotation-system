export default function LoginPage({ onNavigate }) {
  return (
    <section className="page">
      <h2 className="page-title">Login</h2>
      <p className="page-copy">Authentication flow will live here. For now, use the links below to move around.</p>
      <button type="button" className="primary-button" onClick={() => onNavigate('/records')}>
        Go to Records
      </button>
    </section>
  )
}
