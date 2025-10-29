export default function RecordsPage({ onNavigate }) {
  const openFirstRecord = () => onNavigate('/items/demo-record')

  return (
    <section className="page">
      <h2>Records</h2>
      <p>Records grid will be rendered here once data wiring is ready.</p>
      <ul className="list">
        <li>
          <span className="list__label">Demo Record</span>
          <button type="button" onClick={openFirstRecord}>
            View details
          </button>
        </li>
      </ul>
    </section>
  )
}
