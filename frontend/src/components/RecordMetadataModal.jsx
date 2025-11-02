import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, LayoutTemplate, Loader2, Plus, AlertCircle } from 'lucide-react'
import MetadataEntryRow from './MetadataEntryRow.jsx'
import {
  buildEntriesFromValues,
  createMetadataEntry,
  ensureEntriesNotEmpty,
  resolveEntries,
} from '../utils/metadata.js'

function formatUpdatedAt(value) {
  if (!value) {
    return null
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString('zh-TW')
}

export default function RecordMetadataModal({
  isOpen,
  onClose,
  recordSlug,
  recordTitle,
  metadata = {},
  templates = [],
  onSave,
  saving = false,
  onNavigateToTemplates = null,
}) {
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [entries, setEntries] = useState([createMetadataEntry()])
  const [status, setStatus] = useState({ state: 'idle', error: null })
  const [updatedAt, setUpdatedAt] = useState(null)

  const resolvedRecordName = recordTitle || recordSlug

  useEffect(() => {
    if (!isOpen) {
      return
    }
    const availableTemplateIds = new Set(templates.map((tpl) => tpl.id))
    const defaultTemplateId =
      metadata?.template && availableTemplateIds.has(metadata.template)
        ? metadata.template
        : ''
    const template =
      defaultTemplateId && templates.length
        ? templates.find((tpl) => tpl.id === defaultTemplateId) ?? null
        : null
    setSelectedTemplateId(defaultTemplateId || '')
    setEntries(buildEntriesFromValues(metadata?.values ?? {}, template))
    setUpdatedAt(metadata?.updated_at ?? null)
    setStatus({ state: 'idle', error: null })
  }, [isOpen, metadata, templates])

  const currentTemplate = useMemo(() => {
    if (!selectedTemplateId) {
      return null
    }
    return templates.find((tpl) => tpl.id === selectedTemplateId) ?? null
  }, [selectedTemplateId, templates])

  const handleOverlayClick = (event) => {
    if (event.target === event.currentTarget && !saving) {
      onClose()
    }
  }

  const handleTemplateChange = (event) => {
    const templateId = event.target.value
    setSelectedTemplateId(templateId)
    const { values } = resolveEntries(entries, { strict: false })
    const template =
      templateId && templates.length
        ? templates.find((tpl) => tpl.id === templateId) ?? null
        : null
    setEntries(buildEntriesFromValues(values, template))
    setStatus({ state: 'idle', error: null })
  }

  const handleAddEntry = () => {
    setEntries((prev) => [...prev, createMetadataEntry()])
    setStatus({ state: 'idle', error: null })
  }

  const handleRemoveEntry = (id) => {
    setEntries((prev) => ensureEntriesNotEmpty(prev.filter((entry) => entry.id !== id)))
    setStatus({ state: 'idle', error: null })
  }

  const handleEntryKeyChange = (id, value) => {
    setEntries((prev) =>
      prev.map((entry) => (entry.id === id ? { ...entry, key: value } : entry)),
    )
    setStatus({ state: 'idle', error: null })
  }

  const handleEntryValueChange = (id, value) => {
    setEntries((prev) =>
      prev.map((entry) => (entry.id === id ? { ...entry, value } : entry)),
    )
    setStatus({ state: 'idle', error: null })
  }

  const handleManageTemplates = () => {
    if (typeof onNavigateToTemplates !== 'function') {
      return
    }
    onClose()
    onNavigateToTemplates()
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    const { values, errors } = resolveEntries(entries, { strict: true })
    if (errors.length) {
      setStatus({ state: 'error', error: errors.join(' / ') })
      return
    }
    setStatus({ state: 'idle', error: null })
    onSave({
      template: selectedTemplateId || null,
      values,
    })
  }

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') {
      return undefined
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isOpen])

  if (!isOpen) {
    return null
  }

  const modalContent = (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div
        className="modal-container modal-container--metadata"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2 className="modal-title">編輯 Metadata</h2>
            <p className="modal-subtitle">
              {resolvedRecordName ? `書籍：${resolvedRecordName}` : '調整書籍詳細資訊'}
            </p>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="關閉"
            disabled={saving}
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body metadata-modal__body">
            <section className="metadata-modal__section">
              <div className="metadata-modal__template-header">
                <div className="metadata-modal__template-info">
                  <span className="metadata-modal__template-label">套用模板</span>
                  <p className="metadata-modal__template-hint">
                    套用預先定義欄位，或維持自訂配置。
                  </p>
                </div>
                <div className="metadata-modal__template-actions">
                  <button
                    type="button"
                    className="metadata-modal__template-manage"
                    onClick={handleManageTemplates}
                    disabled={!onNavigateToTemplates || saving}
                  >
                    <LayoutTemplate size={15} />
                    管理模板
                  </button>
                  <button
                    type="button"
                    className="metadata-modal__add-field"
                    onClick={handleAddEntry}
                    disabled={saving}
                  >
                    <Plus size={16} />
                    新增欄位
                  </button>
                </div>
              </div>
              <select
                id="record-metadata-template"
                className="metadata-modal__select"
                value={selectedTemplateId}
                onChange={handleTemplateChange}
                disabled={saving}
              >
                <option value="">自訂</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.label}
                  </option>
                ))}
              </select>
              {currentTemplate?.description ? (
                <p className="metadata-modal__description">{currentTemplate.description}</p>
              ) : null}
            </section>

            {status.state === 'error' && status.error ? (
              <div className="metadata-status metadata-status--error">
                <AlertCircle size={16} />
                <span>{status.error}</span>
              </div>
            ) : null}

            <div className="metadata-editor metadata-editor--modal">
              {entries.map((entry) => (
                <MetadataEntryRow
                  key={entry.id}
                  entry={entry}
                  onChangeKey={handleEntryKeyChange}
                  onChangeValue={handleEntryValueChange}
                  onRemove={handleRemoveEntry}
                  disabled={saving}
                />
              ))}
            </div>
          </div>

          <div className="modal-footer">
            <div className="modal-footer-info">
              {formatUpdatedAt(updatedAt)
                ? `最後更新：${formatUpdatedAt(updatedAt)}`
                : '尚未有更新記錄'}
            </div>
            <div className="modal-footer-actions">
              <button
                type="button"
                className="button button--secondary"
                onClick={onClose}
                disabled={saving}
              >
                取消
              </button>
              <button type="submit" className="button button--primary" disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 size={16} className="spinner" />
                    儲存中…
                  </>
                ) : (
                  '儲存變更'
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )

  if (typeof document !== 'undefined') {
    return createPortal(modalContent, document.body)
  }

  return modalContent
}
