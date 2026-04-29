import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Plus,
  Folder,
  ArrowRight,
  RefreshCw,
  X,
  Loader2,
  Upload,
  Download,
  Check,
  FileArchive,
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

  // Unified modal state
  const [showModal, setShowModal] = useState(false)
  const [modalMode, setModalMode] = useState(null) // null | 'new' | 'import'
  const [modalDone, setModalDone] = useState(false)

  // New workspace
  const [creating, setCreating] = useState(false)
  const [newWorkspace, setNewWorkspace] = useState({ slug: '', title: '' })
  const [createError, setCreateError] = useState(null)

  // Import workspace
  const [importStep, setImportStep] = useState(1)
  const [importName, setImportName] = useState('')
  const [importFile, setImportFile] = useState(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState(null)

  const summaryText = useMemo(() => {
    if (isLoading && options.length === 0) return '正在載入 Workspace…'
    if (!options.length) return '尚未找到任何 Workspace，請確認伺服器設定。'
    const totalRecords = options.reduce((acc, ws) => acc + (ws.records ?? 0), 0)
    return `共 ${options.length} 個工作區，內含 ${totalRecords} 筆書籍記錄`
  }, [isLoading, options])

  const handleOpenWorkspace = async (slug) => {
    if (!slug) return
    const ok = await onSelectWorkspace?.(slug)
    if (ok) onNavigate('/records')
  }

  const handleExportWorkspace = (slug) => {
    if (!slug) return
    window.location.href = api.getWorkspaceExportUrl(slug)
  }

  const handleEnterActiveWorkspace = () => {
    if (!current?.slug) {
      if (options.length === 1) { handleOpenWorkspace(options[0].slug); return }
      window.alert('請先選擇欲進入的工作區。')
      return
    }
    onNavigate('/records')
  }

  const handleOpenModal = () => {
    setModalMode(null)
    setModalDone(false)
    setNewWorkspace({ slug: '', title: '' })
    setCreateError(null)
    setImportStep(1)
    setImportName('')
    setImportFile(null)
    setImportError(null)
    setShowModal(true)
  }

  const handleCloseModal = () => {
    if (creating || importing) return
    setShowModal(false)
  }

  const handleAddAnother = () => {
    setModalMode(null)
    setModalDone(false)
    setNewWorkspace({ slug: '', title: '' })
    setCreateError(null)
    setImportStep(1)
    setImportName('')
    setImportFile(null)
    setImportError(null)
  }

  const handleCreateSubmit = async (event) => {
    event.preventDefault()
    const slug = newWorkspace.slug.trim()
    const title = newWorkspace.title.trim()
    if (!slug) { setCreateError('工作區 ID 不可為空白'); return }
    setCreating(true)
    setCreateError(null)
    try {
      const success = await onCreateWorkspace({ slug, title: title || slug })
      if (success) setModalDone(true)
    } catch (err) {
      setCreateError(err.message || '建立工作區失敗')
    } finally {
      setCreating(false)
    }
  }

  const handleImportSubmit = async () => {
    const name = importName.trim()
    if (!name) { setImportError('Workspace 名稱不可為空白'); return }
    if (!importFile) { setImportError('請選擇 Workspace 匯出 ZIP'); return }
    setImporting(true)
    setImportError(null)
    try {
      await api.importWorkspace({ file: importFile, name })
      await Promise.resolve(onRefreshWorkspaces?.())
      setModalDone(true)
    } catch (err) {
      setImportError(err.message || '匯入 Workspace 失敗')
    } finally {
      setImporting(false)
    }
  }

  const fmtSize = (b) => !b ? '' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB'

  const breadcrumbContainer = document.querySelector('.app-header__breadcrumb')
  const breadcrumb = (
    <nav className="breadcrumb">
      <span className="breadcrumb__item">工作區</span>
    </nav>
  )

  const doneLabel = modalMode === 'new'
    ? (newWorkspace.title || newWorkspace.slug)
    : importName

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
            disabled={isLoading || options.length === 0}
          >
            <ArrowRight size={16} />
            進入
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={handleOpenModal}
            disabled={isLoading}
          >
            <Plus size={16} />
            新增 / 匯入工作區
          </button>
        </div>
      </div>

      <div className="workspace-toolbar">
        <div className="workspace-toolbar__meta">
          <span>{options.length} 個工作區</span>
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

      {isLoading && !options.length ? (
        <div className="workspaces-empty">載入中，請稍候…</div>
      ) : null}

      {isEmpty ? (
        <div className="workspaces-empty">
          在 `WORKSPACE_ROOT` 目錄下尚未建立任何 Workspace。請新增資料夾後再試一次。
        </div>
      ) : null}

      <div className="workspace-grid">
        {options.map((workspace) => {
          const isActive = current?.slug === workspace.slug
          const displayName = (workspace.title && String(workspace.title).trim()) || workspace.slug
          return (
            <article key={workspace.slug} className="workspace-card">
              <div className="workspace-card__header">
                <div className="workspace-card__icon" aria-hidden="true">
                  <Folder size={24} />
                </div>
                <div className="workspace-card__titles">
                  <h3>{displayName}</h3>
                  <p className="workspace-card__slug">{workspace.slug}</p>
                  {workspace.path ? <p className="workspace-card__path">{workspace.path}</p> : null}
                </div>
                {isActive ? (
                  <span className="workspace-card__status workspace-card__status--active">使用中</span>
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
                  {isActive ? '已選定，可直接管理書籍' : '切換後即可管理此工作區內的資料'}
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

      {/* Unified add / import workspace modal */}
      {showModal && (
        <div className="modal-overlay" onClick={handleCloseModal}>
          <div
            className="modal-container ws-unified-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ws-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2 id="ws-modal-title" className="modal-title">新增工作區</h2>
                {modalMode && !modalDone && (
                  <p className="modal-subtitle">
                    {modalMode === 'new' ? '建立一個全新的工作區' : '從 ZIP 匯入現有工作區'}
                  </p>
                )}
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={handleCloseModal}
                disabled={creating || importing}
                aria-label="關閉"
              >
                <X size={18} />
              </button>
            </div>

            {/* Success screen */}
            {modalDone && (
              <div className="ws-modal-success">
                <div className="ws-modal-success__icon"><Check size={26} /></div>
                <div className="ws-modal-success__title">
                  {modalMode === 'new' ? '工作區已建立！' : '匯入成功！'}
                </div>
                <div className="ws-modal-success__desc">「{doneLabel}」已新增到工作區列表</div>
                <div className="ws-modal-success__actions">
                  <button type="button" className="primary-button" onClick={handleCloseModal}>完成</button>
                  <button type="button" className="ghost-button" onClick={handleAddAnother}>再新增一個</button>
                </div>
              </div>
            )}

            {/* Mode selection */}
            {!modalMode && !modalDone && (
              <div className="modal-body">
                <p className="ws-modal-hint">請選擇要建立全新工作區，或匯入現有的工作區備份：</p>
                <div className="ws-modal-choices">
                  <button type="button" className="ws-modal-choice" onClick={() => setModalMode('new')}>
                    <div className="ws-modal-choice__icon"><Plus size={22} /></div>
                    <div className="ws-modal-choice__content">
                      <div className="ws-modal-choice__title">建立全新工作區</div>
                      <div className="ws-modal-choice__desc">從頭開始，新增書籍與頁面資料</div>
                    </div>
                    <ArrowRight size={16} className="ws-modal-choice__arrow" />
                  </button>
                  <button type="button" className="ws-modal-choice" onClick={() => setModalMode('import')}>
                    <div className="ws-modal-choice__icon"><Upload size={22} /></div>
                    <div className="ws-modal-choice__content">
                      <div className="ws-modal-choice__title">匯入現有工作區</div>
                      <div className="ws-modal-choice__desc">從 workspace ZIP 壓縮檔還原資料</div>
                    </div>
                    <ArrowRight size={16} className="ws-modal-choice__arrow" />
                  </button>
                </div>
              </div>
            )}

            {/* New workspace form */}
            {modalMode === 'new' && !modalDone && (
              <form className="modal-body" onSubmit={handleCreateSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <label className="input">
                  <span>工作區 ID（目錄名稱）*</span>
                  <input
                    type="text"
                    value={newWorkspace.slug}
                    onChange={(e) => setNewWorkspace((prev) => ({ ...prev, slug: e.target.value }))}
                    placeholder="例如：project-2024"
                    disabled={creating}
                    required
                    autoFocus
                  />
                  <small>只能包含英文字母、數字、連字號和底線</small>
                </label>
                <label className="input">
                  <span>顯示名稱（可選）</span>
                  <input
                    type="text"
                    value={newWorkspace.title}
                    onChange={(e) => setNewWorkspace((prev) => ({ ...prev, title: e.target.value }))}
                    placeholder="例如：羅家倫文稿"
                    disabled={creating}
                  />
                </label>
                {createError ? <p className="form-error">{createError}</p> : null}
                <div className="ws-step-footer">
                  <button type="button" className="ghost-button" onClick={() => setModalMode(null)} disabled={creating}>← 返回</button>
                  <button type="submit" className="primary-button" disabled={creating || !newWorkspace.slug.trim()}>
                    {creating
                      ? <><Loader2 size={16} className="spin" />建立中…</>
                      : <><Plus size={15} />建立工作區</>}
                  </button>
                </div>
              </form>
            )}

            {/* Import workspace (3-step) */}
            {modalMode === 'import' && !modalDone && (
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {/* Step indicators */}
                <div className="ws-import-steps">
                  {['命名', '選擇 ZIP', '確認'].map((label, i) => (
                    <div key={i} className="ws-import-steps__item">
                      <div className={`ws-import-steps__circle${importStep > i + 1 ? ' ws-import-steps__circle--done' : importStep === i + 1 ? ' ws-import-steps__circle--active' : ''}`}>
                        {importStep > i + 1 ? <Check size={11} /> : i + 1}
                      </div>
                      <span className={`ws-import-steps__label${importStep === i + 1 ? ' ws-import-steps__label--active' : ''}`}>{label}</span>
                      {i < 2 && <div className={`ws-import-steps__line${importStep > i + 1 ? ' ws-import-steps__line--done' : ''}`} />}
                    </div>
                  ))}
                </div>

                {/* Step 1: Name */}
                {importStep === 1 && (
                  <div className="ws-import-step">
                    <label className="input">
                      <span>Workspace 名稱 *</span>
                      <input
                        autoFocus
                        type="text"
                        value={importName}
                        onChange={(e) => setImportName(e.target.value)}
                        placeholder="例如：羅家倫文稿"
                        disabled={importing}
                        required
                        onKeyDown={(e) => e.key === 'Enter' && importName.trim() && setImportStep(2)}
                      />
                      <small>匯入後以此名稱顯示，不會套用 ZIP 內的 workspace title</small>
                    </label>
                    <div className="ws-step-footer">
                      <button type="button" className="ghost-button" onClick={() => setModalMode(null)}>← 返回</button>
                      <button
                        type="button"
                        className="primary-button"
                        disabled={!importName.trim()}
                        onClick={() => setImportStep(2)}
                      >
                        繼續 <ArrowRight size={14} />
                      </button>
                    </div>
                  </div>
                )}

                {/* Step 2: File */}
                {importStep === 2 && (
                  <div className="ws-import-step">
                    <label className="input">
                      <span>選擇 Workspace ZIP 檔案</span>
                      <input
                        type="file"
                        accept=".zip"
                        onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
                        disabled={importing}
                      />
                    </label>
                    {importFile && (
                      <div className="ws-import-file-preview">
                        <FileArchive size={15} style={{ color: '#b45309', flexShrink: 0 }} />
                        <span className="ws-import-file-preview__name">{importFile.name}</span>
                        <span className="ws-import-file-preview__size">{fmtSize(importFile.size)}</span>
                        <button type="button" className="ws-import-file-clear" onClick={() => setImportFile(null)}>
                          <X size={13} />
                        </button>
                      </div>
                    )}
                    <div className="ws-step-footer">
                      <button type="button" className="ghost-button" onClick={() => setImportStep(1)}>← 返回</button>
                      <button
                        type="button"
                        className="primary-button"
                        disabled={!importFile}
                        onClick={() => setImportStep(3)}
                      >
                        繼續 <ArrowRight size={14} />
                      </button>
                    </div>
                  </div>
                )}

                {/* Step 3: Confirm */}
                {importStep === 3 && (
                  <div className="ws-import-step">
                    <div>
                      <p className="ws-import-confirm__label">確認匯入資訊</p>
                      <div className="ws-import-confirm__table">
                        {[['Workspace 名稱', importName], ['檔案名稱', importFile?.name], ['檔案大小', fmtSize(importFile?.size)]].map(([k, v]) => (
                          <div key={k} className="ws-import-confirm__row">
                            <span className="ws-import-confirm__key">{k}</span>
                            <span className="ws-import-confirm__val">{v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    {importError ? <p className="form-error">{importError}</p> : null}
                    <div className="ws-step-footer">
                      <button type="button" className="ghost-button" onClick={() => setImportStep(2)} disabled={importing}>← 返回</button>
                      <button
                        type="button"
                        className="primary-button"
                        onClick={handleImportSubmit}
                        disabled={importing}
                      >
                        {importing
                          ? <><Loader2 size={16} className="spin" />匯入中…</>
                          : <><Upload size={15} />確認匯入</>}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
