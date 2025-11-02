export function uniqueMetadataEntryId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `meta-${Math.random().toString(16).slice(2)}`
}

export function createMetadataEntry({
  key = '',
  value = '',
  locked = false,
  required = false,
  label,
} = {}) {
  return {
    id: uniqueMetadataEntryId(),
    key,
    value,
    locked,
    required,
    removable: !required,
    label,
  }
}

export function buildEntriesFromValues(values = {}, template = null) {
  const result = []
  const seen = new Set()
  const normalizedValues = {}

  if (values && typeof values === 'object') {
    Object.entries(values).forEach(([rawKey, rawValue]) => {
      if (typeof rawKey !== 'string') {
        return
      }
      const trimmedKey = rawKey.trim()
      if (!trimmedKey) {
        return
      }
      normalizedValues[trimmedKey] = rawValue == null ? '' : String(rawValue)
    })
  }

  const templateFields = template && Array.isArray(template.fields) ? template.fields : []
  templateFields.forEach((field) => {
    if (!field || typeof field !== 'object') {
      return
    }
    const key = typeof field.key === 'string' ? field.key.trim() : ''
    if (!key) {
      return
    }
    const value = Object.prototype.hasOwnProperty.call(normalizedValues, key)
      ? normalizedValues[key]
      : field.default == null
        ? ''
        : String(field.default)
    result.push(
      createMetadataEntry({
        key,
        value,
        locked: true,
        required: Boolean(field.required),
        label: typeof field.label === 'string' && field.label.trim() ? field.label : key,
      }),
    )
    seen.add(key)
  })

  Object.entries(normalizedValues).forEach(([key, value]) => {
    if (seen.has(key)) {
      return
    }
    result.push(
      createMetadataEntry({
        key,
        value,
        locked: false,
        required: false,
      }),
    )
    seen.add(key)
  })

  if (result.length === 0) {
    result.push(createMetadataEntry())
  }

  return result
}

export function resolveEntries(entries, { strict = false } = {}) {
  const values = {}
  const errors = []
  const seen = new Set()

  entries.forEach((entry) => {
    const key = entry.key ? entry.key.trim() : ''
    if (!key) {
      return
    }
    if (seen.has(key) && strict) {
      errors.push(`欄位「${key}」重複，請調整。`)
    }
    seen.add(key)
    values[key] = entry.value == null ? '' : String(entry.value)
  })

  return { values, errors }
}

export function ensureEntriesNotEmpty(entries) {
  return entries.length ? entries : [createMetadataEntry()]
}
