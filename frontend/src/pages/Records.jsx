import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api.js'

const PAGE_SIZE = 12

export default function RecordsPage({
  workspaceState,
  onSelectWorkspace,
  onRefreshWorkspaces,
  onNavigate,
}) {
  const activeWorkspace = workspaceState.current
  const activeWorkspaceSlug = activeWorkspace?.slug
  const [items, setItems] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [pagination, setPagination] = useState({
    page: 1,
    page_size: PAGE_SIZE,
    total: 0,
  })

  const [page, setPage] = useState(1)
  const [sort, setSort] = useState('record')
  const [searchTerm, setSearchTerm] = useState('')
  const [query, setQuery] = useState('')

  useEffect(() => {
    const handle = setTimeout(() => {
      setQuery(searchTerm.trim())
    }, 350)

    return () => clearTimeout(handle)
  }, [searchTerm])

  useEffect(() => {
    setPage(1)
  }, [query, sort, activeWorkspaceSlug])

  useEffect(() => {
    if (!activeWorkspaceSlug) {
      setItems([])
      setPagination({ page: 1, page_size: PAGE_SIZE, total: 0 })
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setError(null)
    api
      .getItems({
        page,
        pageSize: PAGE_SIZE,
        query,
        sort,
        signal: controller.signal,
      })
      .then((payload) => {
        setItems(payload.items ?? [])
        const paginationPayload = payload.pagination ?? {}
        setPagination({
          page: paginationPayload.page ?? page,
          page_size: paginationPayload.page_size ?? PAGE_SIZE,
          total:
            paginationPayload.total ?? (payload.items ? payload.items.length : 0),
        })
      })
      .catch((err) => {
        if (err.name === 'AbortError') {
          return
        }
        setError(err.message ?? 'Unable to load items.')
      })
      .finally(() => setLoading(false))

    return () => controller.abort()
  }, [page, query, sort, activeWorkspaceSlug])

  const totalPages = useMemo(() => {
    if (!pagination.total || !pagination.page_size) {
      return 1
    }
    return Math.max(1, Math.ceil(pagination.total / pagination.page_size))
  }, [pagination.total, pagination.page_size])

  const rangeStart =
    pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.page_size + 1
  const rangeEnd =
    pagination.total === 0
      ? 0
      : Math.min(rangeStart + items.length - 1, pagination.total)

  if (workspaceState.loading) {
    return (
      <section className="page">
        <h2>Records</h2>
        <p>Loading workspace list…</p>
      </section>
    )
  }

  if (!activeWorkspace) {
    const hasOptions = workspaceState.options && workspaceState.options.length > 0
    return (
      <section className="page">
        <h2>Records</h2>
        <p>Select a workspace to browse its pages.</p>
        {hasOptions ? (
          <div className="workspace-options">
            {workspaceState.options.map((option) => (
              <button
                key={option.slug}
                type="button"
                onClick={() => onSelectWorkspace(option.slug)}
              >
                {option.slug} ({option.pages} pages)
              </button>
            ))}
          </div>
        ) : (
          <p className="records-empty">
            No workspace directories were found. Add one under the configured
            root and refresh.
          </p>
        )}
        <button type="button" className="link-button" onClick={onRefreshWorkspaces}>
          Refresh list
        </button>
      </section>
    )
  }

  const handleOpenItem = (item) => {
    onNavigate(`/items/${encodeURIComponent(item.id)}`)
  }

  return (
    <section className="page">
      <header className="records-header">
        <div>
          <h2>Pages in {activeWorkspace.slug}</h2>
          <p className="records-summary">
            {pagination.total
              ? `Showing ${rangeStart}-${rangeEnd} of ${pagination.total} pages`
              : 'Workspace is empty.'}
          </p>
        </div>
        <div className="records-actions">
          <label className="input input--search">
            <span>Search</span>
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Filename or record…"
            />
          </label>
          <label className="input input--sort">
            <span>Sort</span>
            <select value={sort} onChange={(event) => setSort(event.target.value)}>
              <option value="record">Record + filename</option>
              <option value="filename">Filename</option>
            </select>
          </label>
        </div>
      </header>

      {error ? <p className="error-banner">Failed to load items: {error}</p> : null}

      <div className="records-grid">
        {loading && !items.length ? (
          <div className="records-empty">Loading pages…</div>
        ) : null}

        {!loading && items.length === 0 ? (
          <div className="records-empty">No pages matched your filters.</div>
        ) : null}

        {items.map((item) => (
          <article key={item.id} className="record-card">
            <button
              type="button"
              className="record-card__image"
              onClick={() => handleOpenItem(item)}
            >
              <img src={item.thumbnail_url} alt={item.filename} loading="lazy" />
            </button>
            <div className="record-card__meta">
              <span className="record-card__record">{item.record}</span>
              <span className="record-card__filename">{item.filename}</span>
              <a
                className="record-card__link"
                href={item.original_url}
                target="_blank"
                rel="noreferrer"
              >
                Open original
              </a>
            </div>
          </article>
        ))}
      </div>

      <footer className="records-footer">
        <div className="pagination">
          <button
            type="button"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={page <= 1 || loading}
          >
            Previous
          </button>
          <span>
            Page {page} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
            disabled={page >= totalPages || loading}
          >
            Next
          </button>
        </div>
        <button type="button" className="link-button" onClick={onRefreshWorkspaces}>
          Refresh workspace stats
        </button>
      </footer>
    </section>
  )
}
