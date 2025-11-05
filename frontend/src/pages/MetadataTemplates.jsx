import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Search, Plus, LayoutTemplate, Copy, Edit, ChevronRight } from 'lucide-react'

export default function MetadataTemplatesPage({ onNavigate, workspaceState }) {
  const { activeWorkspace } = workspaceState
  const [templates, setTemplates] = useState([])
  const [searchTerm, setSearchTerm] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // TODO: 從 API 加載模板列表
    // 目前使用示例數據
    setTemplates([
      {
        id: 'default',
        label: '古籍標準模板',
        description: '適用於傳統古籍文獻的標準欄位',
        fields: [
          { key: 'author', label: '作者', type: 'text' },
          { key: 'publication_year', label: '出版年份', type: 'text' },
          { key: 'category', label: '分類', type: 'text' },
          { key: 'dynasty', label: '朝代', type: 'text' },
          { key: 'edition', label: '版本資訊', type: 'text' },
          { key: 'location', label: '藏書地點', type: 'text' },
          { key: 'call_number', label: '索書號', type: 'text' },
          { key: 'description', label: '描述', type: 'textarea' },
        ],
        isDefault: true,
        usedBy: 124,
      },
    ])
    setLoading(false)
  }, [])

  const filteredTemplates = templates.filter((template) =>
    template.label.toLowerCase().includes(searchTerm.toLowerCase()),
  )

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
      <span className="breadcrumb__item">Metadata 模板</span>
    </nav>
  )

  return (
    <section className="page metadata-templates-page">
      {breadcrumbContainer && createPortal(breadcrumb, breadcrumbContainer)}

      <div className="page-header">
        <div className="page-header__titles">
          <h1>Metadata 模板管理</h1>
          <p>建立和管理書籍 metadata 的欄位模板</p>
        </div>
        <div className="page-header__actions">
          <button type="button" className="primary-button" disabled>
            <Plus size={16} />
            建立新模板
          </button>
        </div>
      </div>

      <div className="metadata-templates-callout">
        <h2>功能開發中</h2>
        <p>
          Metadata 模板管理目前僅提供範例資料與介面預覽。實際的新增、編輯與套用功能尚未串接後端服務，
          後續更新將補上完整流程。
        </p>
      </div>

      <div className="metadata-templates-toolbar">
        <div className="metadata-templates-search">
          <Search size={18} className="metadata-templates-search__icon" />
          <input
            type="text"
            placeholder="搜尋模板..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <span className="metadata-templates-count">
          {filteredTemplates.length} / {templates.length} 個模板
        </span>
      </div>

      {loading ? (
        <div className="metadata-templates-loading">載入中...</div>
      ) : (
        <div className="metadata-templates-grid">
          {filteredTemplates.map((template) => (
            <div key={template.id} className="metadata-template-card">
              <div className="metadata-template-card__header">
                <div className="metadata-template-card__icon">
                  <LayoutTemplate size={24} />
                </div>
                {template.isDefault && (
                  <span className="metadata-template-card__badge">預設</span>
                )}
              </div>
              <h3 className="metadata-template-card__title">{template.label}</h3>
              <p className="metadata-template-card__description">
                {template.description}
              </p>
              <div className="metadata-template-card__meta">
                {template.fields.length} 個欄位
                {template.usedBy ? ` · 使用於 ${template.usedBy} 本書` : ''}
              </div>
              <div className="metadata-template-card__actions">
                <button type="button" className="secondary-button" disabled>
                  <Edit size={14} />
                  編輯
                </button>
                <button
                  type="button"
                  className="icon-button"
                  title="複製模板"
                  disabled
                >
                  <Copy size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && filteredTemplates.length === 0 && (
        <div className="metadata-templates-empty">
          <p>找不到符合的模板</p>
        </div>
      )}
    </section>
  )
}
