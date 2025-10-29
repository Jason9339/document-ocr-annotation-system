import { useEffect, useMemo, useState } from 'react'
import LoginPage from './pages/Login.jsx'
import RecordsPage from './pages/Records.jsx'
import RecordItemPage from './pages/RecordItem.jsx'
import './App.css'

const routes = [
  { name: 'login', pattern: /^\/login$/, component: LoginPage },
  { name: 'records', pattern: /^\/records$/, component: RecordsPage },
  {
    name: 'record-item',
    pattern: /^\/items\/(?<id>[^/]+)$/,
    component: RecordItemPage,
  },
]

const defaultRoute = '/login'

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

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>NCCU OCR Annotation</h1>
          <p className="tagline">Milestone 0 — Environment and scaffolding</p>
        </div>
        <HealthIndicator />
      </header>
      <nav className="nav">
        {navLinks.map((link) => (
          <button
            key={link.to}
            type="button"
            className={link.to === window.location.pathname ? 'active' : ''}
            onClick={() => navigate(link.to)}
          >
            {link.label}
          </button>
        ))}
      </nav>
      <main className="main">
        <CurrentPage params={route?.params ?? {}} onNavigate={navigate} />
      </main>
    </div>
  )
}

export default App
