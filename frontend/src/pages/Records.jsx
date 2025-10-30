import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'

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

export default function RecordsPage({
  workspaceState,
  onSelectWorkspace,
  onRefreshWorkspaces,
  onNavigate,
}) {
  const activeWorkspace = workspaceState.current
  const activeWorkspaceSlug = activeWorkspace?.slug
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [refreshIndex, setRefreshIndex] = useState(0)

  const fileInputRef = useRef(null)
  const [uploadFile, setUploadFile] = useState(null)
  const [uploadSlug, setUploadSlug] = useState('')
  const [uploadTitle, setUploadTitle] = useState('')
  const [uploadError, setUploadError] = useState(null)
  const [uploadBusy, setUploadBusy] = useState(false)

  useEffect(() => {
    if (!activeWorkspaceSlug) {
      setRecords([])
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    api
      .getRecords()
      .then((payload) => {
        if (cancelled) {
          return
        }
        setRecords(payload.records ?? [])
      })
      .catch((err) => {
        if (cancelled) {
          return
        }
        setError(err.message ?? '無法載入 Record 清單。')
      })
      .finally(() => {
        if (cancelled) {
          return
        }
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [activeWorkspaceSlug, refreshIndex])

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
        <p>Select a workspace to browse its records.</p>
        {hasOptions ? (
          <div className="workspace-options">
            {workspaceState.options.map((option) => (
              <button
                key={option.slug}
                type="button"
                onClick={() => onSelectWorkspace(option.slug)}
              >
                {option.slug} ({option.records} records)
              </button>
            ))}
          </div>
        ) : (
          <p className="records-empty">
            No workspace directories were found. Add one under the configured root
            and refresh.
          </p>
        )}
        <button type="button" className="link-button" onClick={onRefreshWorkspaces}>
          Refresh list
        </button>
      </section>
    )
  }

  const totalPages = records.reduce(
    (acc, record) => acc + (record.page_count ?? 0),
    0,
  )

  const handleOpenRecord = (slug) => {
    onNavigate(`/records/${encodeURIComponent(slug)}`)
  }

  const handleRefreshRecords = () => {
    setRefreshIndex((value) => value + 1)
  }

  const handleFileChange = (event) => {
    const file = event.target.files?.[0]
    setUploadFile(file ?? null)
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!uploadFile) {
      setUploadError('請選擇包含頁面影像的 ZIP 檔案。')
      return
    }
    setUploadBusy(true)
    setUploadError(null)
    try {
      await api.createRecord({
        file: uploadFile,
        slug: uploadSlug.trim() || undefined,
        title: uploadTitle.trim() || undefined,
      })
      setUploadFile(null)
      setUploadSlug('')
      setUploadTitle('')
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      setRefreshIndex((value) => value + 1)
      onRefreshWorkspaces()
    } catch (err) {
      setUploadError(err.message ?? '上傳失敗，請稍後再試。')
    } finally {
      setUploadBusy(false)
    }
  }

  return (
    <section className="page">
      <header className="records-header">
        <div>
          <h2>Records in {activeWorkspace.slug}</h2>
          <p className="records-summary">
            {loading
              ? 'Loading record list…'
              : records.length
                ? `共 ${records.length} 筆記錄，合計 ${totalPages} 頁`
                : '尚未有任何 Record。'}
          </p>
        </div>
        <div className="records-actions">
          <button type="button" onClick={handleRefreshRecords} disabled={loading}>
            Refresh records
          </button>
        </div>
      </header>

      {error ? <p className="error-banner">Failed to load records: {error}</p> : null}

      <div className="record-list">
        {loading && !records.length ? (
          <div className="records-empty">Loading records…</div>
        ) : null}

        {!loading && records.length === 0 ? (
          <div className="records-empty">
            尚未上傳或掛載任何 Record，請使用下方表單建立。
          </div>
        ) : null}

        {records.map((record) => (
          <article key={record.slug} className="record-summary">
            <div className="record-summary__body">
              <h3>{record.title || record.slug}</h3>
              <p className="record-summary__meta">
                Slug: <code>{record.slug}</code> • Pages: {record.page_count ?? 0} •
                Created: {formatDate(record.created_at)}
              </p>
              {record.source?.name ? (
                <p className="record-summary__source">
                  來源：{record.source.name}
                </p>
              ) : null}
            </div>
            <div className="record-summary__actions">
              <button type="button" onClick={() => handleOpenRecord(record.slug)}>
                Open
              </button>
            </div>
          </article>
        ))}
      </div>

      <section className="record-upload">
        <h3>新增 Record</h3>
        <form onSubmit={handleSubmit} className="record-upload__form">
          <label className="input">
            <span>顯示名稱（選填）</span>
            <input
              type="text"
              value={uploadTitle}
              onChange={(event) => setUploadTitle(event.target.value)}
              placeholder="例如：Demo Record"
            />
          </label>
          <label className="input">
            <span>Slug（選填，未填將自動產生）</span>
            <input
              type="text"
              value={uploadSlug}
              onChange={(event) => setUploadSlug(event.target.value)}
              placeholder="demo-record"
            />
          </label>
          <label className="input">
            <span>Record 壓縮檔（ZIP）</span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip"
              onChange={handleFileChange}
            />
          </label>
          {uploadError ? (
            <p className="record-upload__error">上傳失敗：{uploadError}</p>
          ) : null}
          <div className="record-upload__actions">
            <button type="submit" disabled={uploadBusy || !uploadFile}>
              {uploadBusy ? 'Uploading…' : 'Upload record'}
            </button>
          </div>
        </form>
      </section>
    </section>
  )
}
