const DEFAULT_HEADERS = {
  Accept: 'application/json',
}

function encodeItemId(itemId) {
  if (!itemId) {
    return ''
  }
  return itemId
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
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

export async function getRecords() {
  return fetchJSON('/api/v1/records')
}

export async function getRecord(slug) {
  return fetchJSON(`/api/v1/records/${encodeURIComponent(slug)}`)
}

export async function createRecord({ file, slug, title }) {
  if (!file) {
    throw new Error('Record file is required.')
  }
  const formData = new FormData()
  formData.append('file', file)
  if (slug) {
    formData.append('slug', slug)
  }
  if (title) {
    formData.append('title', title)
  }
  return fetchJSON('/api/v1/records', {
    method: 'POST',
    body: formData,
  })
}

export async function getItems({
  page = 1,
  pageSize = 20,
  query,
  sort,
  record,
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
  if (record) {
    params.set('record', record)
  }

  return fetchJSON(`/api/v1/items?${params.toString()}`, { signal })
}

export async function getItemAnnotations(itemId) {
  return fetchJSON(`/api/v1/items/${encodeItemId(itemId)}/annotations`)
}

export async function updateItemAnnotations(itemId, payload) {
  return fetchJSON(`/api/v1/items/${encodeItemId(itemId)}/annotations`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export const api = {
  getWorkspaces,
  getCurrentWorkspace,
  openWorkspace,
  getItems,
  getRecords,
  createRecord,
  getRecord,
  getItemAnnotations,
  updateItemAnnotations,
}
