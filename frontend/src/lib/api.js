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
  const textPayload = isJSON ? '' : await response.text()

  if (!response.ok) {
    const detail =
      payload && typeof payload.error === 'string'
        ? payload.error
        : textPayload.trim()
          ? textPayload.trim()
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

export async function createWorkspace({ slug, title }) {
  if (!slug) {
    throw new Error('workspace slug is required')
  }
  return fetchJSON('/api/v1/workspaces/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ slug, title }),
  })
}

export async function importWorkspace({ file, name }) {
  if (!file) {
    throw new Error('Workspace file is required')
  }
  if (!name) {
    throw new Error('workspace name is required')
  }
  const formData = new FormData()
  formData.append('file', file)
  formData.append('name', name)
  return fetchJSON('/api/v1/workspaces/import', {
    method: 'POST',
    body: formData,
  })
}

export function getWorkspaceExportUrl(slug) {
  return `/api/v1/workspaces/${encodeURIComponent(slug)}/export`
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

export async function updateWorkspace(slug, payload = {}) {
  if (!slug) {
    throw new Error('workspace slug is required')
  }
  return fetchJSON(`/api/v1/workspaces/${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export async function deleteWorkspace(slug) {
  if (!slug) {
    throw new Error('workspace slug is required')
  }
  return fetchJSON(`/api/v1/workspaces/${encodeURIComponent(slug)}`, {
    method: 'DELETE',
  })
}

export async function getRecords() {
  return fetchJSON('/api/v1/records')
}

export async function getRecord(slug) {
  return fetchJSON(`/api/v1/records/${encodeURIComponent(slug)}`)
}

export async function clearRecordAnnotations(slug) {
  if (!slug) {
    throw new Error('record slug is required.')
  }
  return fetchJSON(`/api/v1/records/${encodeURIComponent(slug)}/annotations/clear`, {
    method: 'POST',
  })
}

export async function createRecord({ file, files, relativePaths, rootName, slug, title }) {
  if (!file && (!files || files.length === 0)) {
    throw new Error('Record file is required.')
  }
  const formData = new FormData()
  if (file) {
    formData.append('file', file)
  }
  if (files?.length) {
    files.forEach((item) => formData.append('files', item))
    relativePaths?.forEach((item) => formData.append('relative_paths', item))
  }
  if (rootName) {
    formData.append('root_name', rootName)
  }
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

function appendRecordUploadFormData({ file, files, relativePaths, rootName, slug, title }) {
  if (!file && (!files || files.length === 0)) {
    throw new Error('Record file is required.')
  }
  const formData = new FormData()
  if (file) {
    formData.append('file', file)
  }
  if (files?.length) {
    files.forEach((item) => formData.append('files', item))
    relativePaths?.forEach((item) => formData.append('relative_paths', item))
  }
  if (rootName) {
    formData.append('root_name', rootName)
  }
  if (slug) {
    formData.append('slug', slug)
  }
  if (title) {
    formData.append('title', title)
  }
  return formData
}

export async function previewRecordUpload(payload) {
  return fetchJSON('/api/v1/records/upload/preview', {
    method: 'POST',
    body: appendRecordUploadFormData(payload),
  })
}

export async function commitRecordUpload(uploadId) {
  if (!uploadId) {
    throw new Error('upload id is required')
  }
  return fetchJSON('/api/v1/records/upload/commit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ upload_id: uploadId }),
  })
}

export async function cancelRecordUpload(uploadId) {
  if (!uploadId) {
    return { ok: true }
  }
  return fetchJSON('/api/v1/records/upload/cancel', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ upload_id: uploadId }),
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

export async function reOCRItem(itemId) {
  return fetchJSON(`/api/v1/items/${encodeItemId(itemId)}/reocr`, {
    method: 'POST',
  })
}

export async function setItemCompleted(itemId, completed) {
  return fetchJSON(`/api/v1/items/${encodeItemId(itemId)}/completed`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ completed }),
  })
}

export async function getRecordMetadata(slug) {
  return fetchJSON(`/api/v1/records/${encodeURIComponent(slug)}/metadata`)
}

export async function updateRecordMetadata(slug, payload) {
  return fetchJSON(`/api/v1/records/${encodeURIComponent(slug)}/metadata`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export async function getItemMetadata(itemId) {
  return fetchJSON(`/api/v1/items/${encodeItemId(itemId)}/metadata`)
}

export async function updateItemMetadata(itemId, payload) {
  return fetchJSON(`/api/v1/items/${encodeItemId(itemId)}/metadata`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export async function batchUpdateItemMetadata(payload) {
  return fetchJSON('/api/v1/items/metadata/batch', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export async function deleteRecord(slug) {
  if (!slug) {
    throw new Error('record slug is required')
  }
  return fetchJSON(`/api/v1/records/${encodeURIComponent(slug)}`, {
    method: 'DELETE',
  })
}

export async function getJobs({ status, limit } = {}) {
  const params = new URLSearchParams()
  if (status) {
    params.set('status', status)
  }
  if (typeof limit === 'number') {
    params.set('limit', String(limit))
  }
  const query = params.toString()
  return fetchJSON(`/api/v1/jobs${query ? `?${query}` : ''}`)
}

export async function createJob({ record, jobType } = {}) {
  if (!record) {
    throw new Error('record slug is required')
  }
  return fetchJSON('/api/v1/jobs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ record, job_type: jobType }),
  })
}

export async function getJob(jobId) {
  if (!jobId) {
    throw new Error('job id is required')
  }
  return fetchJSON(`/api/v1/jobs/${encodeURIComponent(jobId)}`)
}

export async function retryJob(jobId) {
  return fetchJSON(`/api/v1/jobs/${encodeURIComponent(jobId)}/retry`, {
    method: 'POST',
  })
}

export async function cancelJob(jobId) {
  return fetchJSON(`/api/v1/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
  })
}

export async function clearJobs({ status = ['finished', 'failed', 'canceled'] } = {}) {
  return fetchJSON('/api/v1/jobs/clear', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status }),
  })
}

export const api = {
  getWorkspaces,
  getCurrentWorkspace,
  createWorkspace,
  importWorkspace,
  getWorkspaceExportUrl,
  openWorkspace,
  updateWorkspace,
  deleteWorkspace,
  getItems,
  getRecords,
  createRecord,
  previewRecordUpload,
  commitRecordUpload,
  cancelRecordUpload,
  getRecord,
  clearRecordAnnotations,
  getItemAnnotations,
  updateItemAnnotations,
  reOCRItem,
  setItemCompleted,
  getRecordMetadata,
  updateRecordMetadata,
  getItemMetadata,
  updateItemMetadata,
  batchUpdateItemMetadata,
  deleteRecord,
  getJobs,
  createJob,
  getJob,
  retryJob,
  cancelJob,
  clearJobs,
}
