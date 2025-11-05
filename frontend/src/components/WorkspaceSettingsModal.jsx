import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Loader2 } from 'lucide-react'

export default function WorkspaceSettingsModal({
  isOpen,
  workspace,
  onClose,
  onSave,
  saving = false,
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
    if (event.target === event.currentTarget && !saving) {
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
            disabled={saving}
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
              disabled={saving}
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}

          <div className="modal-footer">
            <button
              type="button"
              className="ghost-button"
              onClick={onClose}
              disabled={saving}
            >
              取消
            </button>
            <button type="submit" className="primary-button" disabled={saving}>
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

