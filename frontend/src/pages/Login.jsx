export default function LoginPage({ onNavigate }) {
  return (
    <section className="page">
      <h2>Login</h2>
      <p>Authentication flow will live here. For now, use the links below to move around.</p>
      <button type="button" onClick={() => onNavigate('/records')}>
        Go to Records
      </button>
    </section>
  )
}
