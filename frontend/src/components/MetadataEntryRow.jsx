import { Trash2 } from 'lucide-react'

function MetadataEntryRow({ entry, onChangeKey, onChangeValue, onRemove, disabled = false }) {
  const displayName =
    (entry.label && entry.label.trim()) || (entry.key && entry.key.trim()) || '未命名欄位'

  // For locked (template-defined) fields: show field in single column with label above
  if (entry.locked) {
    return (
      <div className="metadata-entry-row metadata-entry-row--locked">
        <label
          htmlFor={`metadata-value-${entry.id}`}
          className="metadata-entry-row__label"
        >
          {displayName}
          {entry.required ? ' *' : ''}
        </label>
        <input
          id={`metadata-value-${entry.id}`}
          type="text"
          className="metadata-entry-row__input"
          value={entry.value}
          onChange={(event) => onChangeValue(entry.id, event.target.value)}
          placeholder="輸入欄位內容"
          disabled={disabled}
        />
      </div>
    )
  }

  // For custom (unlocked) fields: show both key and value in 2-column grid
  return (
    <div className="metadata-entry-row metadata-entry-row--custom">
      <div className="metadata-entry-row__grid">
        <div className="metadata-entry-row__field">
          <label
            htmlFor={`metadata-key-${entry.id}`}
            className="metadata-entry-row__label"
          >
            欄位名稱
          </label>
          <input
            id={`metadata-key-${entry.id}`}
            type="text"
            className="metadata-entry-row__input"
            value={entry.key}
            onChange={(event) => onChangeKey(entry.id, event.target.value)}
            placeholder="輸入欄位名稱"
            disabled={disabled}
          />
        </div>
        <div className="metadata-entry-row__field">
          <label
            htmlFor={`metadata-value-${entry.id}`}
            className="metadata-entry-row__label"
          >
            欄位值
          </label>
          <input
            id={`metadata-value-${entry.id}`}
            type="text"
            className="metadata-entry-row__input"
            value={entry.value}
            onChange={(event) => onChangeValue(entry.id, event.target.value)}
            placeholder="輸入欄位內容"
            disabled={disabled}
          />
        </div>
      </div>
      {entry.removable ? (
        <button
          type="button"
          className="metadata-entry-row__remove"
          onClick={() => onRemove(entry.id)}
          aria-label="移除欄位"
          disabled={disabled}
          title="移除欄位"
        >
          <Trash2 size={16} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  )
}

export default MetadataEntryRow
