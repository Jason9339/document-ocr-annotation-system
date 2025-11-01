import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, ArrowLeft, ChevronLeft, ChevronRight, FileImage, ChevronRight as BreadcrumbSeparator } from 'lucide-react'
import { api } from '../lib/api.js'

const PAGE_SIZE = 12

function formatDate(value) {
  if (!value) {
    return '未提供'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString()
}

export default function RecordPagesPage({
  params,
  workspaceState,
  onNavigate,
  onRefreshWorkspaces,
}) {
  const recordSlug = params.slug ? decodeURIComponent(params.slug) : null
  const activeWorkspace = workspaceState.current
  const activeWorkspaceSlug = activeWorkspace?.slug

  const [recordInfo, setRecordInfo] = useState({
    loading: true,
    data: null,
    error: null,
  })
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
  }, [query, sort, recordSlug, activeWorkspaceSlug])

  useEffect(() => {
    if (!recordSlug || !activeWorkspaceSlug) {
      setRecordInfo({
        loading: false,
        data: null,
        error: recordSlug
          ? '請先選擇 Workspace。'
          : 'Record slug 不正確，請回到列表重新選擇。',
      })
      return
    }
    let cancelled = false
    setRecordInfo({ loading: true, data: null, error: null })
    api
      .getRecord(recordSlug)
      .then((payload) => {
        if (cancelled) {
          return
        }
        setRecordInfo({
          loading: false,
          data: payload.record ?? null,
          error: null,
        })
      })
      .catch((err) => {
        if (cancelled) {
          return
        }
        setRecordInfo({
          loading: false,
          data: null,
          error: err.message ?? '無法載入 Record 詳細資訊。',
        })
      })

    return () => {
      cancelled = true
    }
  }, [recordSlug, activeWorkspaceSlug])

  useEffect(() => {
    if (!recordSlug || !activeWorkspaceSlug) {
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
        record: recordSlug,
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
  }, [page, query, sort, recordSlug, activeWorkspaceSlug])

  const totalPages = useMemo(() => {
    if (!pagination.total || !pagination.page_size) {
      return 1
    }
    return Math.max(1, Math.ceil(pagination.total / pagination.page_size))
  }, [pagination.total, pagination.page_size])

  if (workspaceState.loading) {
    return (
      <section className="page">
        <h2>Record Pages</h2>
        <p>Loading workspace list…</p>
      </section>
    )
  }

  if (!activeWorkspace) {
    return (
      <section className="page record-pages">
        <header className="records-header">
          <div>
            <h2>請先選擇 Workspace</h2>
            <p className="records-summary">
              前往 Workspace 清單後選擇欲瀏覽的 Workspace，再回到此頁。
            </p>
          </div>
          <div className="records-header__actions">
            <button type="button" onClick={() => onNavigate('/workspaces')}>
              前往 Workspace 清單
            </button>
          </div>
        </header>
        <div className="records-empty records-empty--with-button">
          尚未選擇 Workspace。按下「前往 Workspace 清單」以挑選要瀏覽的 Workspace。
        </div>
        <button
          type="button"
          className="link-button"
          onClick={onRefreshWorkspaces}
        >
          重新整理 Workspace 狀態
        </button>
      </section>
    )
  }

  if (!recordSlug) {
    return (
      <section className="page">
        <h2>Record Pages</h2>
        <p>Record slug 未提供，請返回記錄列表。</p>
        <button type="button" onClick={() => onNavigate('/records')}>
          Back to records
        </button>
      </section>
    )
  }

  const handleOpenItem = (item) => {
    onNavigate(`/items/${encodeURIComponent(item.id)}`)
  }

  const recordTitle =
    recordInfo.data?.title || recordSlug.replace(/[-_]/g, ' ').trim() || recordSlug

  const breadcrumbContainer = document.querySelector('.app-header__breadcrumb')

  const breadcrumb = (
    <nav className="breadcrumb">
      <button
        type="button"
        className="breadcrumb__item breadcrumb__link"
        onClick={() => onNavigate('/workspaces')}
      >
        工作區
      </button>
      <BreadcrumbSeparator size={16} className="breadcrumb__separator" />
      <button
        type="button"
        className="breadcrumb__item breadcrumb__link"
        onClick={() => onNavigate('/records')}
      >
        {activeWorkspace.slug}
      </button>
      <BreadcrumbSeparator size={16} className="breadcrumb__separator" />
      <span className="breadcrumb__item">{recordTitle}</span>
    </nav>
  )

  return (
    <section className="page record-pages">
      {breadcrumbContainer && createPortal(breadcrumb, breadcrumbContainer)}

      <header className="records-header">
        <div>
          <h2>{recordTitle}</h2>
          <p className="records-summary">
            {recordInfo.loading
              ? 'Loading record details…'
              : recordInfo.error
                ? `Record detail unavailable (${recordInfo.error})`
                : `Slug: ${recordInfo.data?.slug ?? recordSlug} • Pages: ${
                    pagination.total
                  } • Created: ${formatDate(recordInfo.data?.created_at)}`}
          </p>
        </div>
        <div className="records-actions">
          <button type="button" className="ghost-button" onClick={() => onNavigate('/records')}>
            <ArrowLeft size={16} />
            返回書籍清單
          </button>
        </div>
      </header>

      {error ? <p className="error-banner">Failed to load items: {error}</p> : null}

      <section className="record-pages__summary">
        <div className="record-pages__meta">
          <div>
            <span className="record-pages__meta-label">總頁數</span>
            <strong>{pagination.total}</strong>
          </div>
          {recordInfo.data?.created_at ? (
            <div>
              <span className="record-pages__meta-label">建立時間</span>
              <span>{formatDate(recordInfo.data.created_at)}</span>
            </div>
          ) : null}
        </div>
        <div className="record-pages__controls">
          <label className="input input--search">
            <span>搜尋頁面</span>
            <div style={{ position: 'relative' }}>
              <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', pointerEvents: 'none' }} />
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="輸入檔名或關鍵字"
                style={{ paddingLeft: '2.5rem' }}
              />
            </div>
          </label>
          <label className="input input--sort">
            <span>排序方式</span>
            <select value={sort} onChange={(event) => setSort(event.target.value)}>
              <option value="record">Record + filename</option>
              <option value="filename">Filename</option>
            </select>
          </label>
        </div>
      </section>

      <div className="records-panel record-pages__panel">
        <div className="record-pages-grid">
          {loading && !items.length ? (
            <div className="records-empty">Loading pages…</div>
          ) : null}

          {!loading && items.length === 0 ? (
            <div className="records-empty">No pages matched your filters.</div>
          ) : null}

          {items.map((item) => (
            <article key={item.id} className="record-card record-card--page">
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
      </div>

      <footer className="records-footer record-pages__footer">
        <div className="pagination">
          <button
            type="button"
            className="ghost-button"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={page <= 1 || loading}
          >
            <ChevronLeft size={16} />
            上一頁
          </button>
          <span className="pagination__info">
            第 {page} / {totalPages} 頁
          </span>
          <button
            type="button"
            className="ghost-button"
            onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
            disabled={page >= totalPages || loading}
          >
            下一頁
            <ChevronRight size={16} />
          </button>
        </div>
      </footer>
    </section>
  )
}
