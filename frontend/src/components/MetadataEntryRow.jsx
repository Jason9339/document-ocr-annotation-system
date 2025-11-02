import { Trash2 } from 'lucide-react'

function MetadataEntryRow({ entry, onChangeKey, onChangeValue, onRemove, disabled = false }) {
  const displayName =
    (entry.label && entry.label.trim()) || (entry.key && entry.key.trim()) || '未命名欄位'

  // For locked (template-defined) fields: show field in single column with label above
  if (entry.locked) {
    return (
      <div>
        <label
          htmlFor={`metadata-value-${entry.id}`}
          className="text-sm font-medium mb-2 block"
        >
          {displayName}
          {entry.required ? ' *' : ''}
        </label>
        <input
          id={`metadata-value-${entry.id}`}
          type="text"
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
    <div className="flex items-start space-x-3">
      <div className="flex-1 grid grid-cols-2 gap-4">
        <div>
          <label
            htmlFor={`metadata-key-${entry.id}`}
            className="text-sm font-medium mb-2 block"
          >
            欄位名稱
          </label>
          <input
            id={`metadata-key-${entry.id}`}
            type="text"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            value={entry.key}
            onChange={(event) => onChangeKey(entry.id, event.target.value)}
            placeholder="輸入欄位名稱"
            disabled={disabled}
          />
        </div>
        <div>
          <label
            htmlFor={`metadata-value-${entry.id}`}
            className="text-sm font-medium mb-2 block"
          >
            欄位值
          </label>
          <input
            id={`metadata-value-${entry.id}`}
            type="text"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
          className="mt-8 p-2 hover:bg-gray-100 rounded-lg transition-colors"
          onClick={() => onRemove(entry.id)}
          aria-label="移除欄位"
          disabled={disabled}
          title="移除欄位"
        >
          <Trash2 size={16} className="text-gray-400" />
        </button>
      ) : null}
    </div>
  )
}

export default MetadataEntryRow
