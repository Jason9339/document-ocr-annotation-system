import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Loader2, Trash2 } from 'lucide-react'

export default function WorkspaceSettingsModal({
  isOpen,
  workspace,
  onClose,
  onSave,
  onDelete,
  saving = false,
  deleting = false,
}) {
  const [title, setTitle] = useState('')
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!isOpen) {
      return
    }
    const fallback = workspace?.slug ?? ''
    const currentTitle = workspace?.title ?? ''
    setTitle(currentTitle || fallback)
    setError(null)
  }, [isOpen, workspace])

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') {
      return undefined
    }
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [isOpen])

  if (!isOpen) {
    return null
  }

  const handleOverlayClick = (event) => {
    if (event.target === event.currentTarget && !saving && !deleting) {
      onClose()
    }
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    const nextTitle = title.trim()
    if (!nextTitle) {
      setError('名稱不可為空白')
      return
    }
    setError(null)
    onSave({ title: nextTitle })
  }

  const handleDelete = () => {
    if (!workspace?.slug || deleting || saving) {
      return
    }
    onDelete?.(workspace)
  }

  const modal = (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div
        className="modal-container"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2 id="workspace-settings-title" className="modal-title">
              編輯工作區
            </h2>
            <p className="modal-subtitle">
              調整工作區顯示名稱；不會影響目錄結構（{workspace?.slug})
            </p>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            disabled={saving || deleting}
            aria-label="關閉"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          <label className="input">
            <span>工作區名稱</span>
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="輸入顯示名稱"
              disabled={saving || deleting}
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}

          <section className="danger-zone">
            <div>
              <h3>刪除工作區</h3>
              <p>
                刪除後會移除這個 workspace 的 records、labels 和設定檔，且無法復原。
              </p>
            </div>
            <button
              type="button"
              className="text-button text-button--danger"
              onClick={handleDelete}
              disabled={saving || deleting}
            >
              {deleting ? <Loader2 size={16} className="spin" /> : <Trash2 size={16} />}
              <span>{deleting ? '刪除中…' : '刪除工作區'}</span>
            </button>
          </section>

          <div className="modal-footer">
            <button
              type="button"
              className="ghost-button"
              onClick={onClose}
              disabled={saving || deleting}
            >
              取消
            </button>
            <button type="submit" className="primary-button" disabled={saving || deleting}>
              {saving ? (
                <>
                  <Loader2 size={16} className="spin" />
                  <span>儲存中…</span>
                </>
              ) : (
                '儲存變更'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )

  const modalRoot = document.getElementById('modal-root')
  if (modalRoot) {
    return createPortal(modal, modalRoot)
  }
  return modal
}
