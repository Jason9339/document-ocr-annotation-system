const DEFAULT_HEADERS = {
  Accept: 'application/json',
}

async function fetchJSON(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...DEFAULT_HEADERS,
      ...(options.headers ?? {}),
    },
  })

  const contentType = response.headers.get('Content-Type') ?? ''
  const isJSON = contentType.includes('application/json')
  const payload = isJSON ? await response.json() : null

  if (!response.ok) {
    const detail =
      payload && typeof payload.error === 'string'
        ? payload.error
        : response.statusText || 'Request failed'
    const error = new Error(detail)
    error.status = response.status
    error.payload = payload
    throw error
  }

  return payload
}

export async function getWorkspaces() {
  return fetchJSON('/api/v1/workspaces')
}

export async function getCurrentWorkspace() {
  return fetchJSON('/api/v1/workspace')
}

export async function openWorkspace(slug) {
  return fetchJSON('/api/v1/workspace/open', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ workspace: slug }),
  })
}

export async function getItems({
  page = 1,
  pageSize = 20,
  query,
  sort,
  signal,
}) {
  const params = new URLSearchParams()
  params.set('page', String(page))
  params.set('page_size', String(pageSize))
  if (query) {
    params.set('q', query)
  }
  if (sort) {
    params.set('sort', sort)
  }

  return fetchJSON(`/api/v1/items?${params.toString()}`, { signal })
}

export const api = {
  getWorkspaces,
  getCurrentWorkspace,
  openWorkspace,
  getItems,
}
