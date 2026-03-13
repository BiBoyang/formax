export type PlainObject = Record<string, unknown>

export function requirePlainObject(value: unknown, label = 'input'): PlainObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as PlainObject
}

export function assertNoExtraKeys(obj: PlainObject, allowed: readonly string[], label = 'input'): void {
  const allowedSet = new Set(allowed)
  for (const key of Object.keys(obj)) {
    if (!allowedSet.has(key)) {
      throw new Error(`${label} has unknown field: ${key}`)
    }
  }
}

