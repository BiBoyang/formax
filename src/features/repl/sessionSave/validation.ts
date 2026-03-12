function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function isNonEmptyRecord(value: unknown): value is Record<string, unknown> {
  return isObject(value) && !Array.isArray(value) && Object.keys(value).length > 0
}

function coerceNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function coerceString(value: unknown): string | null {
  const s = typeof value === 'string' ? value.trim() : ''
  return s ? s : null
}

function coerceNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export {
  isObject,
  isNonEmptyRecord,
  coerceNonEmptyString,
  coerceString,
  coerceNumber,
}

