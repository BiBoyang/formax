import { describe, expect, it } from 'vitest'
import {
  CANONICAL_EVENT_SCHEMA_VERSION,
  isCanonicalEventSchemaVersion,
  isCanonicalEventSource,
} from './canonicalEvents'

describe('canonicalEvents', () => {
  it('validates canonical event sources', () => {
    expect(isCanonicalEventSource('engine')).toBe(true)
    expect(isCanonicalEventSource('tool')).toBe(true)
    expect(isCanonicalEventSource('ui')).toBe(true)
    expect(isCanonicalEventSource('unknown')).toBe(false)
  })

  it('accepts only current canonical schema version', () => {
    expect(isCanonicalEventSchemaVersion(CANONICAL_EVENT_SCHEMA_VERSION)).toBe(true)
    expect(isCanonicalEventSchemaVersion(0)).toBe(false)
    expect(isCanonicalEventSchemaVersion(2)).toBe(false)
    expect(isCanonicalEventSchemaVersion('1')).toBe(false)
  })
})
