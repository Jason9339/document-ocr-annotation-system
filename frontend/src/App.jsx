import { useCallback, useEffect, useMemo, useState } from 'react'
import { Folder, BookOpen, FileText, Bell, Settings, User, Edit3, LayoutTemplate, ClipboardList } from 'lucide-react'
import LoginPage from './pages/Login.jsx'
import RecordsPage from './pages/Records.jsx'
import RecordPagesPage from './pages/RecordPages.jsx'
import RecordItemPage from './pages/RecordItem.jsx'
import WorkspacesPage from './pages/Workspaces.jsx'
import MetadataTemplatesPage from './pages/MetadataTemplates.jsx'
import JobsPage from './pages/Jobs.jsx'
import { api } from './lib/api.js'
import './App.css'

const routes = [
  { name: 'workspaces', pattern: /^\/workspaces$/, component: WorkspacesPage },
  { name: 'templates', pattern: /^\/templates$/, component: MetadataTemplatesPage },
  { name: 'login', pattern: /^\/login$/, component: LoginPage },
  { name: 'records', pattern: /^\/records$/, component: RecordsPage },
  { name: 'jobs', pattern: /^\/jobs$/, component: JobsPage },
  {
    name: 'record-pages',
    pattern: /^\/records\/(?<slug>[^/]+)$/,
    component: RecordPagesPage,
  },
  {
    name: 'record-item',
    pattern: /^\/items\/(?<id>[^/]+)$/,
    component: RecordItemPage,
  },
]

const defaultRoute = '/workspaces'

function matchRoute(pathname) {
  for (const route of routes) {
    const match = route.pattern.exec(pathname)
    if (!match) {
      continue
    }
    return {
      name: route.name,
      component: route.component,
      params: match.groups ?? {},
    }
  }
  return null
}

function useRouter() {
  const [state, setState] = useState(() => {
    const matched = matchRoute(window.location.pathname)
    if (matched) {
      return matched
    }
    window.history.replaceState(null, '', defaultRoute)
    return matchRoute(defaultRoute)
  })

  useEffect(() => {
    const handlePopState = () => {
      const matched = matchRoute(window.location.pathname)
      setState(matched ?? matchRoute(defaultRoute))
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const navigate = useMemo(
    () => (to) => {
      if (to === window.location.pathname) {
        return
      }
      window.history.pushState(null, '', to)
      const matched = matchRoute(window.location.pathname)
      setState(matched ?? matchRoute(defaultRoute))
    },
    [],
  )

  return [state, navigate]
}

function HealthIndicator() {
  const [status, setStatus] = useState({ state: 'loading' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const response = await fetch('/api/health')
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        const payload = await response.json()
        if (!cancelled) {
          setStatus({ state: 'ready', payload })
        }
      } catch (error) {
        if (!cancelled) {
          setStatus({ state: 'error', error: error.message })
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  if (status.state === 'loading') {
    return <span className="badge badge--loading">Checking API…</span>
  }

  if (status.state === 'error') {
    return (
      <span className="badge badge--error">API offline ({status.error})</span>
    )
  }

  return (
    <span className="badge badge--ok">
      API ok {status.payload?.service && `(${status.payload.service})`}
    </span>
  )
}

const navLinks = []

const sidebarLinks = [
  {
    key: 'workspaces',
    label: '工作區',
    icon: Folder,
    to: '/workspaces',
    matches: ['workspaces'],
  },
  {
    key: 'records',
    label: '書籍清單',
    icon: BookOpen,
    to: '/records',
    matches: ['records'],
  },
  {
    key: 'jobs',
    label: '標註工作',
    icon: ClipboardList,
    to: '/jobs',
    matches: ['jobs'],
  },
  {
    key: 'pages',
    label: '頁面列表',
    icon: FileText,
    to: '/records',
    matches: ['record-pages'],
  },
  {
    key: 'annotate',
    label: '標註介面',
    icon: Edit3,
    to: '/annotate',
    matches: ['annotate'],
    disabled: true,
  },
]

function App() {
  const [route, navigate] = useRouter()
  const CurrentPage = route?.component ?? LoginPage
  const [workspaceState, setWorkspaceState] = useState({
    loading: true,
    options: [],
    current: null,
    error: null,
  })
  const [workspaceBusy, setWorkspaceBusy] = useState(false)
  const showNav = route?.name !== 'record-item'
  const showSidebar = route?.name !== 'record-item'

  const activeSidebarKey =
    sidebarLinks.find((link) => link.matches?.includes(route?.name))?.key ?? null

  const loadWorkspaces = useCallback(async () => {
    setWorkspaceState((prev) => ({
      ...prev,
      loading: true,
      error: null,
    }))
    try {
      const [optionsData, currentData] = await Promise.all([
        api.getWorkspaces(),
        api.getCurrentWorkspace(),
      ])
      setWorkspaceState({
        loading: false,
        options: optionsData.workspaces ?? [],
        current: currentData.workspace ?? null,
        error: null,
      })
    } catch (error) {
      setWorkspaceState((prev) => ({
        ...prev,
        loading: false,
        error: error.message ?? 'Unable to load workspaces.',
      }))
    }
  }, [])

  useEffect(() => {
    loadWorkspaces()
  }, [loadWorkspaces])

  const handleCreateWorkspace = useCallback(async ({ slug, title }) => {
    if (!slug) {
      return false
    }
    setWorkspaceBusy(true)
    try {
      const payload = await api.createWorkspace({ slug, title })
      const workspacePayload = payload.workspace
      setWorkspaceState((prev) => ({
        ...prev,
        options: [...prev.options, workspacePayload],
        error: null,
      }))
      return true
    } catch (error) {
      setWorkspaceState((prev) => ({
        ...prev,
        error: error.message ?? 'Unable to create workspace.',
      }))
      return false
    } finally {
      setWorkspaceBusy(false)
    }
  }, [])

  const handleSelectWorkspace = useCallback(async (slug) => {
    if (!slug) {
      return false
    }
    setWorkspaceBusy(true)
    try {
      const payload = await api.openWorkspace(slug)
      const workspacePayload = payload.workspace
      setWorkspaceState((prev) => ({
        ...prev,
        current: workspacePayload ?? prev.current,
        options: (() => {
          if (!workspacePayload) {
            return prev.options
          }
          const exists = prev.options.some((option) => option.slug === slug)
          if (exists) {
            return prev.options.map((option) =>
              option.slug === slug ? workspacePayload : option,
            )
          }
          return [...prev.options, workspacePayload]
        })(),
        error: null,
      }))
      return true
    } catch (error) {
      setWorkspaceState((prev) => ({
        ...prev,
        error: error.message ?? 'Unable to open workspace.',
      }))
      return false
    } finally {
      setWorkspaceBusy(false)
    }
  }, [])

  const handleRefreshWorkspaces = useCallback(() => {
    loadWorkspaces()
  }, [loadWorkspaces])

  const navActivePath = useMemo(() => {
    if (route?.name === 'login') {
      return '/login'
    }
    return '/workspaces'
  }, [route?.name])

  const appShellClass = useMemo(
    () => `app-shell ${showSidebar ? 'app-shell--with-sidebar' : 'app-shell--full'}`,
    [showSidebar],
  )

  const workspaceContext = useMemo(
    () => ({
      ...workspaceState,
      busy: workspaceState.loading || workspaceBusy,
    }),
    [workspaceState, workspaceBusy],
  )

  return (
    <div className={appShellClass}>
      {showSidebar ? (
        <aside className="sidebar">
          <div className="sidebar__brand">
            <h2>OCR Platform</h2>
          </div>
          <nav className="sidebar__nav">
            {sidebarLinks.map((link) => {
              const IconComponent = link.icon
              const isActive = link.key === activeSidebarKey
              return (
                <button
                  key={link.key}
                  type="button"
                  className={isActive ? 'active' : ''}
                  onClick={() => {
                    if (link.disabled) {
                      return
                    }
                    navigate(link.to)
                  }}
                  disabled={link.disabled}
                >
                  <IconComponent size={20} />
                  <span>{link.label}</span>
                </button>
              )
            })}
          </nav>
          <div className="sidebar__footer">
            <button type="button" className="sidebar__footer-btn">
              <Bell size={20} />
              <span>通知</span>
            </button>
            <button type="button" className="sidebar__footer-btn" onClick={() => navigate('/templates')}>
              <LayoutTemplate size={20} />
              <span>Metadata 模板</span>
            </button>
            <button type="button" className="sidebar__footer-btn">
              <Settings size={20} />
              <span>設定</span>
            </button>
            <div className="sidebar__user">
              <div className="sidebar__user-avatar">
                <User size={18} />
              </div>
              <div className="sidebar__user-info">
                <div className="sidebar__user-name">使用者</div>
                <div className="sidebar__user-role">管理員</div>
              </div>
            </div>
          </div>
        </aside>
      ) : null}
      <div className="app">
        <div className="app-header">
          <div className="app-header__breadcrumb">
            {/* Breadcrumb will be rendered by pages */}
          </div>
          <div className="app-header__status">
            <HealthIndicator />
          </div>
        </div>
        {showNav ? (
          <nav className="nav">
            {navLinks.map((link) => (
              <button
                key={link.to}
                type="button"
                className={link.to === navActivePath ? 'active' : ''}
                onClick={() => navigate(link.to)}
              >
                {link.label}
              </button>
            ))}
          </nav>
        ) : null}
        <main className="main">
          <CurrentPage
            params={route?.params ?? {}}
            onNavigate={navigate}
            workspaceState={workspaceContext}
            onCreateWorkspace={handleCreateWorkspace}
            onSelectWorkspace={handleSelectWorkspace}
            onRefreshWorkspaces={handleRefreshWorkspaces}
          />
        </main>
      </div>
    </div>
  )
}

export default App
