import { useCallback, useEffect, useMemo, useState } from 'react'
import LoginPage from './pages/Login.jsx'
import RecordsPage from './pages/Records.jsx'
import RecordPagesPage from './pages/RecordPages.jsx'
import RecordItemPage from './pages/RecordItem.jsx'
import WorkspaceSelector from './components/WorkspaceSelector.jsx'
import { api } from './lib/api.js'
import './App.css'

const routes = [
  { name: 'login', pattern: /^\/login$/, component: LoginPage },
  { name: 'records', pattern: /^\/records$/, component: RecordsPage },
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

const defaultRoute = '/records'

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

const navLinks = [
  { to: '/login', label: 'Login' },
  { to: '/records', label: 'Records' },
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

  const handleSelectWorkspace = useCallback(
    async (slug) => {
      if (!slug) {
        return
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
        if (route?.name !== 'records') {
          navigate('/records')
        }
      } catch (error) {
        setWorkspaceState((prev) => ({
          ...prev,
          error: error.message ?? 'Unable to open workspace.',
        }))
      } finally {
        setWorkspaceBusy(false)
      }
    },
    [navigate, route?.name],
  )

  const handleRefreshWorkspaces = useCallback(() => {
    loadWorkspaces()
  }, [loadWorkspaces])

  const navActivePath = useMemo(() => {
    if (route?.name === 'login') {
      return '/login'
    }
    return '/records'
  }, [route?.name])

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>NCCU OCR Annotation</h1>
          <p className="tagline">
            Milestone 2 — Record 上傳與頁面展開
          </p>
        </div>
        <HealthIndicator />
      </header>
      <WorkspaceSelector
        workspaces={workspaceState.options}
        current={workspaceState.current}
        loading={workspaceState.loading || workspaceBusy}
        error={workspaceState.error}
        onSelect={handleSelectWorkspace}
        onRefresh={handleRefreshWorkspaces}
      />
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
      <main className="main">
        <CurrentPage
          params={route?.params ?? {}}
          onNavigate={navigate}
          workspaceState={workspaceState}
          onSelectWorkspace={handleSelectWorkspace}
          onRefreshWorkspaces={handleRefreshWorkspaces}
        />
      </main>
    </div>
  )
}

export default App
