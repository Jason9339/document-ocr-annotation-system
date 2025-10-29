export default function RecordItemPage({ params, onNavigate }) {
  return (
    <section className="page">
      <h2>Record Detail</h2>
      <p>Item ID: {params.id}</p>
      <p>Annotations canvas and metadata panels will be mounted here in later milestones.</p>
      <button type="button" onClick={() => onNavigate('/records')}>
        Back to records
      </button>
    </section>
  )
}
