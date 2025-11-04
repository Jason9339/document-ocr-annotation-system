import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { RefreshCw, AlertCircle, Loader2, RotateCcw, XCircle, Trash2 } from 'lucide-react'
import { api } from '../lib/api.js'

const statusMeta = {
  pending: { label: '待處理', tone: 'pending' },
  running: { label: '處理中', tone: 'running' },
  finished: { label: '已完成', tone: 'success' },
  failed: { label: '失敗', tone: 'danger' },
  canceled: { label: '已取消', tone: 'muted' },
}

function formatDate(value) {
  if (!value) {
    return '—'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString()
}

export default function JobsPage({ workspaceState, onNavigate }) {
  const [jobsState, setJobsState] = useState({
    loading: true,
    items: [],
    error: null,
  })
  const [statusFilter, setStatusFilter] = useState('all')
  const [refreshIndex, setRefreshIndex] = useState(0)
  const [processingJobId, setProcessingJobId] = useState(null)

  const activeWorkspace = workspaceState.current

  const loadJobs = useCallback(async () => {
    setJobsState((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const payload = await api.getJobs({ status: statusFilter === 'all' ? undefined : statusFilter })
      setJobsState({
        loading: false,
        items: payload.jobs ?? [],
        error: null,
      })
    } catch (error) {
      setJobsState((prev) => ({
        ...prev,
        loading: false,
        error: error.message ?? '無法載入標註工作列表',
      }))
    }
  }, [statusFilter])

  useEffect(() => {
    loadJobs()
    const interval = setInterval(() => {
      loadJobs()
    }, 8000)
    return () => {
      clearInterval(interval)
    }
  }, [loadJobs, refreshIndex])

  const breadcrumbContainer = document.querySelector('.app-header__breadcrumb')
  const breadcrumb = (
    <nav className="breadcrumb">
      <button type="button" className="breadcrumb__item breadcrumb__link" onClick={() => onNavigate('/workspaces')}>
        工作區
      </button>
      <span className="breadcrumb__separator">/</span>
      <span className="breadcrumb__item">標註工作</span>
    </nav>
  )

  const filteredJobs = jobsState.items

  // Check if any job is running
  const hasRunningJobs = jobsState.items.some((job) => job.status === 'pending' || job.status === 'running')

  const handleRefresh = () => {
    setRefreshIndex((value) => value + 1)
  }

  const handleRetry = async (jobId) => {
    setProcessingJobId(jobId)
    try {
      await api.retryJob(jobId)
      handleRefresh()
    } catch (error) {
      console.error('retry job failed', error)
      alert('重試工作失敗，請稍後再試。')
    } finally {
      setProcessingJobId(null)
    }
  }

  const handleCancel = async (jobId) => {
    const confirmed = window.confirm('確定要取消這個工作嗎？')
    if (!confirmed) {
      return
    }
    setProcessingJobId(jobId)
    try {
      await api.cancelJob(jobId)
      handleRefresh()
    } catch (error) {
      console.error('cancel job failed', error)
      alert('取消失敗，請稍後再試。')
    } finally {
      setProcessingJobId(null)
    }
  }

  const handleClearJobs = async () => {
    const confirmed = window.confirm('確定要清理所有已完成、失敗和已取消的工作記錄嗎？此操作無法復原。')
    if (!confirmed) {
      return
    }
    setJobsState((prev) => ({ ...prev, loading: true }))
    try {
      const result = await api.clearJobs()
      alert(result.message || '清理完成')
      handleRefresh()
    } catch (error) {
      console.error('clear jobs failed', error)
      alert('清理失敗，請稍後再試。')
      setJobsState((prev) => ({ ...prev, loading: false }))
    }
  }

  if (workspaceState.loading) {
    return (
      <section className="page jobs-page">
        <h2>標註工作</h2>
        <p>正在讀取工作區資訊…</p>
      </section>
    )
  }

  if (!activeWorkspace) {
    return (
      <section className="page jobs-page">
        <div className="page-header">
          <div className="page-header__titles">
            <h1>標註工作</h1>
            <p>請先選擇欲瀏覽的工作區。</p>
          </div>
          <div className="page-header__actions">
            <button type="button" className="primary-button" onClick={() => onNavigate('/workspaces')}>
              選擇工作區
            </button>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="page jobs-page">
      {breadcrumbContainer && createPortal(breadcrumb, breadcrumbContainer)}
      <div className="page-header">
        <div className="page-header__titles">
          <h1>標註工作</h1>
          <p>工作區：{activeWorkspace.slug}</p>
        </div>
        <div className="page-header__actions">
          <button
            type="button"
            className="text-button text-button--danger"
            onClick={handleClearJobs}
            disabled={jobsState.loading || jobsState.items.length === 0 || hasRunningJobs}
            title={hasRunningJobs ? '有工作正在執行中，無法清理' : '清理已完成、失敗和已取消的工作記錄'}
          >
            <Trash2 size={16} />
            <span>清理記錄</span>
          </button>
          <button type="button" className="text-button" onClick={handleRefresh} disabled={jobsState.loading}>
            <RefreshCw size={16} />
            <span>重新整理</span>
          </button>
        </div>
      </div>

      <div className="jobs-toolbar">
        {['all', 'pending', 'running', 'finished', 'failed', 'canceled'].map((status) => {
          const meta = statusMeta[status] || { label: '全部', tone: 'muted' }
          const label = status === 'all' ? '全部' : meta.label
          const isActive = statusFilter === status
          return (
            <button
              type="button"
              key={status}
              className={`jobs-filter${isActive ? ' jobs-filter--active' : ''}`}
              onClick={() => setStatusFilter(status)}
              disabled={jobsState.loading && status === statusFilter}
            >
              {label}
            </button>
          )
        })}
      </div>

      {jobsState.error ? (
        <div className="error-banner">
          <AlertCircle size={16} />
          <span>{jobsState.error}</span>
        </div>
      ) : null}

      {jobsState.loading && jobsState.items.length === 0 ? (
        <div className="jobs-empty">工作載入中…</div>
      ) : null}

      {!jobsState.loading && filteredJobs.length === 0 ? (
        <div className="jobs-empty">目前沒有符合條件的標註工作。</div>
      ) : null}

      {filteredJobs.length > 0 ? (
        <div className="jobs-grid">
          {filteredJobs.map((job) => {
            const meta = statusMeta[job.status] || { label: job.status, tone: 'muted' }
            return (
              <article key={job.id} className="job-card">
                <header className="job-card__header">
                  <div>
                    <h3 className="job-card__title">{job.record_title || job.record_slug}</h3>
                    <p className="job-card__subtitle">#{job.id.slice(0, 8)} · {job.job_type.toUpperCase()}</p>
                  </div>
                  <span className={`job-status job-status--${meta.tone}`}>{meta.label}</span>
                </header>
                <div className="job-card__progress">
                  <div className="job-progress">
                    <div className="job-progress__track">
                      <div className="job-progress__fill" style={{ width: `${job.progress ?? 0}%` }} />
                    </div>
                    <span className="job-progress__label">{job.progress ?? 0}%</span>
                  </div>
                </div>
                <dl className="job-card__meta">
                  <div>
                    <dt>建立時間</dt>
                    <dd>{formatDate(job.created_at)}</dd>
                  </div>
                  <div>
                    <dt>開始</dt>
                    <dd>{formatDate(job.started_at)}</dd>
                  </div>
                  <div>
                    <dt>完成</dt>
                    <dd>{formatDate(job.finished_at)}</dd>
                  </div>
                </dl>
                {job.error ? (
                  <div className="job-card__error">
                    <AlertCircle size={16} />
                    <span>{job.error}</span>
                  </div>
                ) : null}
                <footer className="job-card__actions">
                  {(job.status === 'failed' || job.status === 'canceled') && (
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => handleRetry(job.id)}
                      disabled={processingJobId === job.id}
                    >
                      {processingJobId === job.id ? <Loader2 size={16} className="spin" /> : <RotateCcw size={16} />}
                      <span>重試</span>
                    </button>
                  )}
                  {job.status === 'pending' || job.status === 'running' ? (
                    <button
                      type="button"
                      className="ghost-button ghost-button--danger"
                      onClick={() => handleCancel(job.id)}
                      disabled={processingJobId === job.id}
                    >
                      {processingJobId === job.id ? <Loader2 size={16} className="spin" /> : <XCircle size={16} />}
                      <span>取消</span>
                    </button>
                  ) : null}
                </footer>
              </article>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}
