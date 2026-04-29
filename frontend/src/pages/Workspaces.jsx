import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Search,
  Plus,
  Folder,
  ArrowRight,
  RefreshCw,
  X,
  Loader2,
  Upload,
  Download,
} from 'lucide-react'
import { api } from '../lib/api.js'

export default function WorkspacesPage({
  workspaceState,
  onCreateWorkspace,
  onSelectWorkspace,
  onRefreshWorkspaces,
  onNavigate,
}) {
  const { loading, options = [], current, error, busy } = workspaceState
  const isLoading = Boolean(loading || busy)
  const isEmpty = !isLoading && options.length === 0
  const [searchTerm, setSearchTerm] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newWorkspace, setNewWorkspace] = useState({ slug: '', title: '' })
  const [createError, setCreateError] = useState(null)
  const [importName, setImportName] = useState('')
  const [importFile, setImportFile] = useState(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState(null)
  const [importSummary, setImportSummary] = useState(null)

  const filteredOptions = useMemo(() => {
    if (!searchTerm.trim()) {
      return options
    }
    const lowered = searchTerm.trim().toLowerCase()
    return options.filter((workspace) => {
      const slugMatch = workspace.slug.toLowerCase().includes(lowered)
      const title = workspace.title ? String(workspace.title).toLowerCase() : ''
      const titleMatch = title ? title.includes(lowered) : false
      return slugMatch || titleMatch
    })
  }, [options, searchTerm])

  const summaryText = useMemo(() => {
    if (isLoading && options.length === 0) {
      return '正在載入 Workspace…'
    }
    if (!options.length) {
      return '尚未找到任何 Workspace，請確認伺服器設定。'
    }
    const totalRecords = options.reduce(
      (acc, workspace) => acc + (workspace.records ?? 0),
      0,
    )
    return `共 ${options.length} 個工作區，內含 ${totalRecords} 筆書籍記錄`
  }, [isLoading, options])

  const importNameRequired = Boolean(importFile && !importName.trim())

  const handleOpenWorkspace = async (slug) => {
    if (!slug) {
      return
    }
    const ok = await onSelectWorkspace?.(slug)
    if (ok) {
      onNavigate('/records')
    }
  }

  const handleExportWorkspace = (slug) => {
    if (!slug) {
      return
    }
    window.location.href = api.getWorkspaceExportUrl(slug)
  }

  const handleEnterActiveWorkspace = () => {
    if (!current?.slug) {
      if (filteredOptions.length === 1) {
        handleOpenWorkspace(filteredOptions[0].slug)
        return
      }
      window.alert('請先選擇欲進入的工作區。')
      return
    }
    onNavigate('/records')
  }

  const handleOpenCreateModal = () => {
    setNewWorkspace({ slug: '', title: '' })
    setCreateError(null)
    setShowCreateModal(true)
  }

  const handleCloseCreateModal = () => {
    if (creating) return
    setShowCreateModal(false)
  }

  const handleCreateSubmit = async (event) => {
    event.preventDefault()
    const slug = newWorkspace.slug.trim()
    const title = newWorkspace.title.trim()

    if (!slug) {
      setCreateError('工作區 ID 不可為空白')
      return
    }

    setCreating(true)
    setCreateError(null)

    try {
      const success = await onCreateWorkspace({ slug, title: title || slug })
      if (success) {
        setShowCreateModal(false)
        setNewWorkspace({ slug: '', title: '' })
      }
    } catch (error) {
      setCreateError(error.message || '建立工作區失敗')
    } finally {
      setCreating(false)
    }
  }

  const handleImportSubmit = async (event) => {
    event.preventDefault()
    const name = importName.trim()
    if (!name) {
      setImportError('Workspace 名稱不可為空白')
      return
    }
    if (!importFile) {
      setImportError('請選擇 Workspace 匯出 ZIP')
      return
    }

    setImporting(true)
    setImportError(null)
    setImportSummary(null)
    try {
      const result = await api.importWorkspace({ file: importFile, name })
      setImportSummary(result.summary ?? null)
      setImportName('')
      setImportFile(null)
      await Promise.resolve(onRefreshWorkspaces?.())
    } catch (error) {
      setImportError(error.message || '匯入 Workspace 失敗')
    } finally {
      setImporting(false)
    }
  }

  const breadcrumbContainer = document.querySelector('.app-header__breadcrumb')

  const breadcrumb = (
    <nav className="breadcrumb">
      <span className="breadcrumb__item">工作區</span>
    </nav>
  )

  return (
    <section className="page workspaces-page">
      {breadcrumbContainer && createPortal(breadcrumb, breadcrumbContainer)}

      <div className="page-header">
        <div className="page-header__titles">
          <h1>工作區</h1>
          <p>{summaryText}</p>
        </div>
        <div className="page-header__actions">
          <button
            type="button"
            className="ghost-button"
            onClick={handleEnterActiveWorkspace}
            disabled={isLoading || (!current && filteredOptions.length === 0)}
          >
            <ArrowRight size={16} />
            進入
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={handleOpenCreateModal}
            disabled={isLoading}
          >
            <Plus size={16} />
            新增工作區
          </button>
        </div>
      </div>

      <div className="workspace-toolbar">
        <div className="workspace-search">
          <Search size={18} className="workspace-search__icon" />
          <input
            type="text"
            placeholder="搜尋工作區..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            disabled={isLoading}
          />
        </div>
        <div className="workspace-toolbar__meta">
          <span>
            {filteredOptions.length} / {options.length} 個工作區
          </span>
          <button
            type="button"
            className="workspace-toolbar__refresh"
            onClick={onRefreshWorkspaces}
            disabled={isLoading}
          >
            <RefreshCw size={16} />
            <span>重新整理</span>
          </button>
        </div>
      </div>

      {error ? <p className="error-banner">無法載入 Workspace：{error}</p> : null}

      <section className="workspace-import">
        <div className="workspace-import__header">
          <div>
            <h2>匯入 Workspace</h2>
            <p>從完整 workspace ZIP 建立新工作區；匯入時會忽略縮圖快取。</p>
          </div>
          <Upload size={22} aria-hidden="true" />
        </div>
        <form className="workspace-import__form" onSubmit={handleImportSubmit}>
          <label className={`input ${importNameRequired ? 'input--invalid' : ''}`}>
            <span className="input__label-row">
              Workspace 名稱
              <strong>必填</strong>
            </span>
            <input
              type="text"
              value={importName}
              onChange={(event) => setImportName(event.target.value)}
              placeholder="例如：羅家倫資料"
              disabled={importing}
              required
              aria-invalid={importNameRequired}
              aria-describedby="workspace-import-name-help"
            />
            <small id="workspace-import-name-help">
              匯入後會以這個名稱顯示，不會沿用 ZIP 內原本的 workspace title。
            </small>
          </label>
          <label className="input">
            <span>Workspace 匯出 ZIP</span>
            <input
              type="file"
              accept=".zip"
              onChange={(event) => setImportFile(event.target.files?.[0] ?? null)}
              disabled={importing}
            />
          </label>
          <button
            type="submit"
            className="primary-button"
            disabled={importing || !importName.trim() || !importFile}
            title={importNameRequired ? '請先填寫 Workspace 名稱' : undefined}
          >
            {importing ? <Loader2 size={16} className="spin" /> : <Upload size={16} />}
            {importNameRequired ? '先填名稱' : '匯入'}
          </button>
        </form>
        {importNameRequired ? (
          <p className="workspace-import__hint">已選擇 ZIP，請先填左側 Workspace 名稱。</p>
        ) : null}
        {importError ? <p className="workspace-import__error">{importError}</p> : null}
        {importSummary ? (
          <p className="workspace-import__success">
            匯入完成：{importSummary.imported ?? 0} 頁，{importSummary.failed ?? 0} 失敗
          </p>
        ) : null}
      </section>

      {isLoading && !options.length ? (
        <div className="workspaces-empty">載入中，請稍候…</div>
      ) : null}

      {isEmpty ? (
        <div className="workspaces-empty">
          在 `WORKSPACE_ROOT` 目錄下尚未建立任何 Workspace。請新增資料夾後再試一次。
        </div>
      ) : null}

      <div className="workspace-grid">
        {filteredOptions.map((workspace) => {
          const isActive = current?.slug === workspace.slug
          const displayName =
            (workspace.title && String(workspace.title).trim()) || workspace.slug
          return (
            <article key={workspace.slug} className="workspace-card">
              <div className="workspace-card__header">
                <div className="workspace-card__icon" aria-hidden="true">
                  <Folder size={24} />
                </div>
                <div className="workspace-card__titles">
                  <h3>{displayName}</h3>
                  <p className="workspace-card__slug">{workspace.slug}</p>
                  {workspace.path ? (
                    <p className="workspace-card__path">{workspace.path}</p>
                  ) : null}
                </div>
                {isActive ? (
                  <span className="workspace-card__status workspace-card__status--active">
                    使用中
                  </span>
                ) : (
                  <span className="workspace-card__status">可供使用</span>
                )}
              </div>
              <div className="workspace-card__meta">
                <div>
                  <span className="workspace-card__metric">{workspace.records ?? 0}</span>
                  <span className="workspace-card__metric-label">書籍</span>
                </div>
                <div>
                  <span className="workspace-card__metric">{workspace.pages ?? 0}</span>
                  <span className="workspace-card__metric-label">頁面</span>
                </div>
              </div>
              <div className="workspace-card__footer">
                <div className="workspace-card__hint">
                  {isActive
                    ? '已選定，可直接管理書籍'
                    : '切換後即可管理此工作區內的資料'}
                </div>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => handleExportWorkspace(workspace.slug)}
                  disabled={isLoading}
                >
                  <Download size={16} />
                  匯出
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => handleOpenWorkspace(workspace.slug)}
                  disabled={isLoading}
                >
                  {isActive ? '進入工作區' : '切換工作區'}
                </button>
              </div>
            </article>
          )
        })}
      </div>

      {showCreateModal && (
        <div className="modal-overlay" onClick={handleCloseCreateModal}>
          <div
            className="modal-container"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-workspace-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2 id="create-workspace-title" className="modal-title">
                  新增工作區
                </h2>
                <p className="modal-subtitle">
                  建立一個新的工作區來管理您的文件標註資料
                </p>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={handleCloseCreateModal}
                disabled={creating}
                aria-label="關閉"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="modal-body">
              <label className="input">
                <span>工作區 ID（目錄名稱）*</span>
                <input
                  type="text"
                  value={newWorkspace.slug}
                  onChange={(e) =>
                    setNewWorkspace((prev) => ({ ...prev, slug: e.target.value }))
                  }
                  placeholder="例如：project-2024"
                  disabled={creating}
                  required
                />
                <small style={{ color: '#666', marginTop: '4px' }}>
                  只能包含英文字母、數字、連字號和底線
                </small>
              </label>

              <label className="input">
                <span>顯示名稱（可選）</span>
                <input
                  type="text"
                  value={newWorkspace.title}
                  onChange={(e) =>
                    setNewWorkspace((prev) => ({ ...prev, title: e.target.value }))
                  }
                  placeholder="例如：2024 專案"
                  disabled={creating}
                />
              </label>

              {createError ? <p className="form-error">{createError}</p> : null}

              <div className="modal-footer">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={handleCloseCreateModal}
                  disabled={creating}
                >
                  取消
                </button>
                <button type="submit" className="primary-button" disabled={creating}>
                  {creating ? (
                    <>
                      <Loader2 size={16} className="spin" />
                      <span>建立中…</span>
                    </>
                  ) : (
                    '建立工作區'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}
