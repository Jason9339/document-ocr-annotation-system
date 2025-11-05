export default function WorkspaceSelector({
  workspaces,
  current,
  loading,
  error,
  onSelect,
  onRefresh,
}) {
  const options = workspaces ?? []
  const hasCurrent =
    current && options.some((workspace) => workspace.slug === current.slug)

  const handleChange = (event) => {
    const value = event.target.value
    if (value) {
      onSelect?.(value)
    }
  }

  return (
    <div className="workspace-selector">
      <label className="workspace-selector__label">
        Workspace
        <select
          className="workspace-selector__select"
          value={current?.slug ?? ''}
          onChange={handleChange}
          disabled={loading || workspaces.length === 0}
        >
          <option value="" disabled>
            {loading
              ? 'Loading…'
              : options.length
                ? 'Choose a workspace'
                : 'No workspace found'}
          </option>
          {options.map((workspace) => {
            const label = workspace.title?.trim() || workspace.slug
            return (
              <option key={workspace.slug} value={workspace.slug}>
                {label} ({workspace.records} record
                {workspace.records === 1 ? '' : 's'})
              </option>
            )
          })}
          {!hasCurrent && current ? (
            <option value={current.slug}>
              {current.title?.trim() || current.slug}
            </option>
          ) : null}
        </select>
      </label>
      <div className="workspace-selector__meta">
        {current ? (
          <span className="workspace-selector__current">
            Active:{' '}
            <strong>{current.title?.trim() || current.slug}</strong> ({current.pages}{' '}
            pages)
          </span>
        ) : (
          <span className="workspace-selector__hint">
            Select a workspace to start browsing items.
          </span>
        )}
        <button
          type="button"
          className="workspace-selector__refresh"
          onClick={onRefresh}
          disabled={loading}
        >
          Refresh
        </button>
      </div>
      {error ? (
        <p className="workspace-selector__error">Failed: {error}</p>
      ) : null}
    </div>
  )
}
