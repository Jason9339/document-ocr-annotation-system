import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, Upload, RefreshCw, BookOpen, ChevronRight, Edit } from 'lucide-react'
import RecordMetadataModal from '../components/RecordMetadataModal.jsx'
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
  onRefreshWorkspaces,
  onNavigate,
}) {
  const activeWorkspace = workspaceState.current
  const activeWorkspaceSlug = activeWorkspace?.slug
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [refreshIndex, setRefreshIndex] = useState(0)
  const [searchTerm, setSearchTerm] = useState('')
  const [metadataModal, setMetadataModal] = useState({
    isOpen: false,
    recordSlug: null,
    recordTitle: null,
    metadata: {},
    templates: [],
  })
  const [savingMetadata, setSavingMetadata] = useState(false)

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
    return (
      <section className="page records-page">
        <div className="page-header">
          <div className="page-header__titles">
            <h1>書籍清單</h1>
            <p>請先選擇欲瀏覽的工作區。</p>
          </div>
          <div className="page-header__actions">
            <button type="button" className="primary-button" onClick={() => onNavigate('/workspaces')}>
              前往工作區清單
            </button>
          </div>
        </div>
        <div className="records-empty records-empty--with-button">
          尚未選擇工作區。按下「前往工作區清單」以挑選欲瀏覽的 Workspace。
        </div>
      </section>
    )
  }

  const totalPages = records.reduce(
    (acc, record) => acc + (record.page_count ?? 0),
    0,
  )

  const filteredRecords = records.filter((record) => {
    if (!searchTerm.trim()) {
      return true
    }
    const value = searchTerm.trim().toLowerCase()
    return (
      (record.title && record.title.toLowerCase().includes(value)) ||
      record.slug.toLowerCase().includes(value)
    )
  })

  const handleOpenRecord = (slug) => {
    onNavigate(`/records/${encodeURIComponent(slug)}`)
  }

  const handleOpenMetadata = async (record) => {
    try {
      const result = await api.getRecordMetadata(record.slug)
      setMetadataModal({
        isOpen: true,
        recordSlug: record.slug,
        recordTitle: record.title || record.slug,
        metadata: result.metadata || {},
        templates: result.templates || [],
      })
    } catch (err) {
      console.error('Failed to load metadata:', err)
      setMetadataModal({
        isOpen: true,
        recordSlug: record.slug,
        recordTitle: record.title || record.slug,
        metadata: {},
        templates: [],
      })
    }
  }

  const handleSaveMetadata = async (data) => {
    setSavingMetadata(true)
    try {
      await api.updateRecordMetadata(metadataModal.recordSlug, data)
      setMetadataModal((prev) => ({ ...prev, isOpen: false }))
      setRefreshIndex((value) => value + 1)
    } catch (err) {
      console.error('Failed to save metadata:', err)
      alert('儲存失敗：' + (err.message || '請稍後再試'))
    } finally {
      setSavingMetadata(false)
    }
  }

  const handleCloseMetadata = () => {
    if (!savingMetadata) {
      setMetadataModal((prev) => ({ ...prev, isOpen: false }))
    }
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
      <ChevronRight size={16} className="breadcrumb__separator" />
      <span className="breadcrumb__item">{activeWorkspace.slug}</span>
    </nav>
  )

  return (
    <section className="page records-page">
      {breadcrumbContainer && createPortal(breadcrumb, breadcrumbContainer)}

      <div className="page-header">
        <div className="page-header__titles">
          <h1>書籍清單</h1>
          <p>
            {loading
              ? '正在載入書籍…'
              : `共 ${records.length} 筆書籍，合計 ${totalPages} 頁`}
          </p>
        </div>
        <div className="page-header__actions">
          <button
            type="button"
            className="text-button"
            onClick={handleRefreshRecords}
            disabled={loading}
          >
            <RefreshCw size={16} />
            <span>重新整理</span>
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              if (fileInputRef.current) {
                fileInputRef.current.click()
              }
            }}
          >
            <Upload size={16} />
            上傳書籍
          </button>
        </div>
      </div>

      <div className="records-summary-panel">
        <div>
          <span className="records-summary-panel__label">當前工作區</span>
          <h2>{activeWorkspace.slug}</h2>
        </div>
        <div className="records-summary-panel__stats">
          <div>
            <span className="records-summary-panel__metric">{records.length}</span>
            <span className="records-summary-panel__metric-label">書籍</span>
          </div>
          <div>
            <span className="records-summary-panel__metric">{totalPages}</span>
            <span className="records-summary-panel__metric-label">頁面</span>
          </div>
        </div>
      </div>

      <section className="record-create">
        <h3>新增書籍</h3>
        <form onSubmit={handleSubmit} className="record-create__form">
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
            <p className="record-create__error">上傳失敗：{uploadError}</p>
          ) : null}
          <div className="record-create__actions">
            <button
              type="submit"
              className="primary-button"
              disabled={uploadBusy || !uploadFile}
            >
              {uploadBusy ? '上傳中…' : '確認上傳'}
            </button>
          </div>
        </form>
      </section>

      <div className="records-table-card">
        <div className="records-table-toolbar">
          <div className="records-table-search">
            <Search size={18} className="records-table-search__icon" />
            <input
              type="text"
              placeholder="搜尋書名或 slug..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </div>
          <span className="records-table-count">
            {filteredRecords.length} / {records.length} 筆
          </span>
        </div>

        {error ? <p className="error-banner">Failed to load records: {error}</p> : null}

        {loading && !records.length ? (
          <div className="records-empty">正在載入書籍…</div>
        ) : null}

        {!loading && records.length === 0 ? (
          <div className="records-empty">
            尚未上傳或掛載任何書籍，請使用上方表單建立。
          </div>
        ) : null}

        {!loading && filteredRecords.length > 0 ? (
          <div className="records-table-wrapper">
            <table className="records-table">
              <thead>
                <tr>
                  <th>書名</th>
                  <th>編號</th>
                  <th>頁數</th>
                  <th>完成度</th>
                  <th>狀態</th>
                  <th>最後更新</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.map((record) => (
                  <tr key={record.slug}>
                    <td>
                      <div className="records-table__title">
                        <div className="records-table__icon" aria-hidden="true">
                          <BookOpen size={20} />
                        </div>
                        <div>
                          <div className="records-table__name">
                            {record.title || record.slug}
                          </div>
                          <div className="records-table__meta">
                            {record.page_count ?? 0} 頁
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <code className="records-table__code">{record.slug}</code>
                    </td>
                    <td className="records-table__number">{record.page_count ?? 0}</td>
                    <td>
                      <div className="progress-bar">
                        <div className="progress-bar__track">
                          <div className="progress-bar__fill" style={{ width: '0%' }}></div>
                        </div>
                        <span className="progress-bar__label">0%</span>
                      </div>
                    </td>
                    <td>
                      <span className="status-badge status-badge--pending">未開始</span>
                    </td>
                    <td className="records-table__date">{formatDate(record.created_at)}</td>
                    <td>
                      <div className="records-table__actions">
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => handleOpenMetadata(record)}
                        >
                          <Edit size={16} />
                          <span>編輯</span>
                        </button>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => handleOpenRecord(record.slug)}
                        >
                          <BookOpen size={16} />
                          <span>檢視</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <RecordMetadataModal
        isOpen={metadataModal.isOpen}
        onClose={handleCloseMetadata}
        recordSlug={metadataModal.recordSlug}
        recordTitle={metadataModal.recordTitle}
        metadata={metadataModal.metadata}
        templates={metadataModal.templates}
        onSave={handleSaveMetadata}
        saving={savingMetadata}
        onNavigateToTemplates={() => onNavigate('/templates')}
      />
    </section>
  )
}
