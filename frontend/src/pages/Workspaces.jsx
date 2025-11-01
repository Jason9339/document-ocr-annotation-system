import { useMemo, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Search, Plus, Folder, RefreshCw, ChevronRight } from 'lucide-react'

export default function WorkspacesPage({
  workspaceState,
  onSelectWorkspace,
  onRefreshWorkspaces,
  onNavigate,
}) {
  const { loading, options = [], current, error, busy } = workspaceState
  const isLoading = Boolean(loading || busy)
  const isEmpty = !isLoading && options.length === 0
  const [searchTerm, setSearchTerm] = useState('')

  const filteredOptions = useMemo(() => {
    if (!searchTerm.trim()) {
      return options
    }
    const lowered = searchTerm.trim().toLowerCase()
    return options.filter((workspace) => workspace.slug.toLowerCase().includes(lowered))
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

  const handleOpenWorkspace = async (slug) => {
    if (!slug) {
      return
    }
    const ok = await onSelectWorkspace?.(slug)
    if (ok) {
      onNavigate('/records')
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
            onClick={onRefreshWorkspaces}
            disabled={isLoading}
          >
            <RefreshCw size={16} />
            重新整理
          </button>
          <button type="button" disabled className="primary-button disabled">
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
        <span className="workspace-toolbar__meta">
          {filteredOptions.length} / {options.length} 個工作區
        </span>
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
        {filteredOptions.map((workspace) => {
          const isActive = current?.slug === workspace.slug
          return (
            <article key={workspace.slug} className="workspace-card">
              <div className="workspace-card__header">
                <div className="workspace-card__icon" aria-hidden="true">
                  <Folder size={24} />
                </div>
                <div className="workspace-card__titles">
                  <h3>{workspace.slug}</h3>
                  {workspace.path ? (
                    <p className="workspace-card__path">{workspace.path}</p>
                  ) : null}
                </div>
                {isActive ? (
                  <span className="workspace-card__status workspace-card__status--active">
                    目前使用中
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
                  className="primary-button"
                  onClick={() => handleOpenWorkspace(workspace.slug)}
                  disabled={isLoading}
                >
                  {isActive ? '重新整理' : '切換工作區'}
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
