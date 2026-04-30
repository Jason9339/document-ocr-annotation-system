import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Search,
  ArrowLeft,
  ChevronRight as BreadcrumbSeparator,
  Trash2,
} from 'lucide-react'
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
  const isAllView = recordSlug === '_all'
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
  const [togglingItems, setTogglingItems] = useState(() => new Set())
  const [clearingAnnotations, setClearingAnnotations] = useState(false)
  const [clearStatus, setClearStatus] = useState({
    state: 'idle',
    message: null,
    error: null,
  })
  const [reloadToken, setReloadToken] = useState(0)

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
    setClearStatus({ state: 'idle', message: null, error: null })
  }, [recordSlug])

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

    // 如果是完整檢視，跳過 getRecord API 呼叫
    if (isAllView) {
      setRecordInfo({
        loading: false,
        data: {
          slug: '_all',
          title: '完整檢視',
          page_count: 0,
          has_annotations: false,
        },
        error: null,
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
  }, [recordSlug, activeWorkspaceSlug, isAllView])

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
        record: isAllView ? undefined : recordSlug,
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
  }, [page, query, sort, recordSlug, activeWorkspaceSlug, reloadToken, isAllView])

  const totalPages = useMemo(() => {
    if (!pagination.total || !pagination.page_size) {
      return 1
    }
    return Math.max(1, Math.ceil(pagination.total / pagination.page_size))
  }, [pagination.total, pagination.page_size])
  const paginationPages = useMemo(() => {
    if (totalPages <= 1) {
      return []
    }
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, index) => index + 1)
    }
    const pages = new Set([1, totalPages, page, page - 1, page + 1])
    if (page <= 4) {
      for (let i = 2; i <= 5; i += 1) {
        pages.add(i)
      }
    }
    if (page >= totalPages - 3) {
      for (let i = totalPages - 4; i <= totalPages - 1; i += 1) {
        pages.add(i)
      }
    }
    const sorted = Array.from(pages)
      .filter((value) => value >= 1 && value <= totalPages)
      .sort((a, b) => a - b)
    const result = []
    let previous = 0
    for (const value of sorted) {
      if (previous && value - previous > 1) {
        result.push('ellipsis')
      }
      result.push(value)
      previous = value
    }
    return result
  }, [page, totalPages])

  if (workspaceState.loading) {
    return (
      <section className="page">
        <h2 className="page-title">Record Pages</h2>
        <p className="page-copy">Loading workspace list…</p>
      </section>
    )
  }

  if (!activeWorkspace) {
    return (
      <section className="page record-pages">
        <header className="records-header">
          <div>
            <h2 className="page-title">請先選擇 Workspace</h2>
            <p className="records-summary">
              前往 Workspace 清單後選擇欲瀏覽的 Workspace，再回到此頁。
            </p>
          </div>
          <div className="records-header__actions">
            <button type="button" className="primary-button" onClick={() => onNavigate('/workspaces')}>
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
        <h2 className="page-title">Record Pages</h2>
        <p className="page-copy">Record slug 未提供，請返回記錄列表。</p>
        <button type="button" className="primary-button" onClick={() => onNavigate('/records')}>
          Back to records
        </button>
      </section>
    )
  }

  const handleOpenItem = (item) => {
    onNavigate(`/items/${encodeURIComponent(item.id)}`)
  }

  const handleToggleCompleted = async (item) => {
    if (togglingItems.has(item.id)) {
      return
    }
    const nextCompleted = !item.completed
    setTogglingItems((prev) => new Set(prev).add(item.id))
    setItems((prev) =>
      prev.map((it) => (it.id === item.id ? { ...it, completed: nextCompleted } : it)),
    )
    try {
      await api.setItemCompleted(item.id, nextCompleted)
    } catch {
      setItems((prev) =>
        prev.map((it) => (it.id === item.id ? { ...it, completed: item.completed } : it)),
      )
    } finally {
      setTogglingItems((prev) => {
        const next = new Set(prev)
        next.delete(item.id)
        return next
      })
    }
  }

  const handleClearAnnotations = async () => {
    if (!recordSlug || clearingAnnotations || isAllView) {
      return
    }
    const confirmed = window.confirm('確定要刪除這本書所有頁面的標註嗎？此操作無法復原。')
    if (!confirmed) {
      return
    }
    setClearingAnnotations(true)
    setClearStatus({ state: 'loading', message: '正在清除標註…', error: null })
    try {
      const payload = await api.clearRecordAnnotations(recordSlug)
      const clearedPages =
        typeof payload?.cleared === 'number' ? payload.cleared : pagination.total
      setClearStatus({
        state: 'success',
        message: `已清除 ${clearedPages} 頁的標註。`,
        error: null,
      })
      setReloadToken((token) => token + 1)
    } catch (err) {
      setClearStatus({
        state: 'error',
        message: null,
        error: err.message ?? '無法清除標註，請稍後再試。',
      })
    } finally {
      setClearingAnnotations(false)
    }
  }

  const recordTitle = isAllView
    ? '完整檢視'
    : recordInfo.data?.title || recordSlug.replace(/[-_]/g, ' ').trim() || recordSlug

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
          {!isAllView && (
            <button
              type="button"
              className="ghost-button ghost-button--danger"
              onClick={handleClearAnnotations}
              disabled={clearingAnnotations}
            >
              <Trash2 size={16} />
              {clearingAnnotations ? '清除標註中…' : '刪除本書標註'}
            </button>
          )}
          <button type="button" className="ghost-button" onClick={() => onNavigate('/records')}>
            <ArrowLeft size={16} />
            返回書籍清單
          </button>
        </div>
      </header>

      {error ? <p className="error-banner">Failed to load items: {error}</p> : null}
      {clearStatus.state === 'loading' && clearStatus.message ? (
        <p className="record-pages__notice">{clearStatus.message}</p>
      ) : null}
      {clearStatus.state === 'success' && clearStatus.message ? (
        <p className="record-pages__notice">{clearStatus.message}</p>
      ) : null}
      {clearStatus.state === 'error' && clearStatus.error ? (
        <p className="record-pages__notice record-pages__notice--error">{clearStatus.error}</p>
      ) : null}

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
            <div className="input__control input__control--search">
              <Search size={16} className="input__icon" />
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="輸入檔名或關鍵字"
                className="input__control-field"
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
            <div className="records-empty">頁面載入中…</div>
          ) : null}

          {!loading && items.length === 0 ? (
            <div className="records-empty">沒有符合條件的頁面。</div>
          ) : null}

          {items.map((item) => {
            const isCompleted = Boolean(item.completed)
            const isToggling = togglingItems.has(item.id)
            return (
              <article
                key={item.id}
                className={`record-card record-card--page${isCompleted ? ' record-card--completed' : ''}`}
              >
                <div className="record-card__select">
                  <label title={isCompleted ? '標記為未完成' : '標記為完成'}>
                    <input
                      type="checkbox"
                      checked={isCompleted}
                      disabled={isToggling}
                      onChange={() => handleToggleCompleted(item)}
                      aria-label={isCompleted ? `取消完成 ${item.filename}` : `標記完成 ${item.filename}`}
                    />
                  </label>
                </div>
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
                    開啟原始檔
                  </a>
                </div>
              </article>
            )
          })}
        </div>
      </div>

      <footer className="records-footer record-pages__footer">
        <div className="record-pages__pagination">
          <button
            type="button"
            className="record-pages__pagination-btn"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={page <= 1 || loading}
          >
            <span>上一頁</span>
          </button>
          {paginationPages.map((entry, index) =>
            entry === 'ellipsis' ? (
              <span key={`ellipsis-${index}`} className="record-pages__pagination-ellipsis">
                …
              </span>
            ) : (
              <button
                type="button"
                key={`page-${entry}`}
                className={`record-pages__pagination-btn record-pages__pagination-btn--page${
                  entry === page ? ' record-pages__pagination-btn--active' : ''
                }`}
                onClick={() => {
                  if (entry === page || loading) {
                    return
                  }
                  setPage(entry)
                }}
              >
                {entry}
              </button>
            ),
          )}
          <button
            type="button"
            className="record-pages__pagination-btn"
            onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
            disabled={page >= totalPages || loading}
          >
            <span>下一頁</span>
          </button>
        </div>
      </footer>
    </section>
  )
}
