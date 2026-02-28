import { describe, expect, it } from 'vitest'
import { redactJsonSecrets, redactTextSecrets } from './redaction.js'

describe('redaction', () => {
  it('redacts common token/header formats in text', () => {
    const text = [
      'token sk-abc12345xyz',
      'Authorization: Bearer very-secret-token',
      'x-api-key: super-secret',
    ].join('\n')

    const out = redactTextSecrets(text)
    expect(out).toContain('sk-<redacted>')
    expect(out).toContain('Authorization: Bearer <redacted>')
    expect(out).toContain('x-api-key: <redacted>')
    expect(out).not.toContain('abc12345xyz')
    expect(out).not.toContain('very-secret-token')
    expect(out).not.toContain('super-secret')
  })

  it('recursively redacts secret-ish keys while preserving non-secrets', () => {
    const input = {
      apiKey: 'sk-abc12345',
      nested: {
        API_KEY: 'x',
        token: 'y',
        authorization: 'z',
        password: 'p',
        secretThing: 's',
        value: 'plain',
      },
      arr: [{ ok: 'v' }, { secret: 'hide' }],
      text: 'Authorization: Bearer abc',
    }

    const out = redactJsonSecrets(input) as any
    expect(out.apiKey).toBe('<redacted>')
    expect(out.nested.API_KEY).toBe('<redacted>')
    expect(out.nested.token).toBe('<redacted>')
    expect(out.nested.authorization).toBe('<redacted>')
    expect(out.nested.password).toBe('<redacted>')
    expect(out.nested.secretThing).toBe('<redacted>')
    expect(out.nested.value).toBe('plain')
    expect(out.arr[0].ok).toBe('v')
    expect(out.arr[1].secret).toBe('<redacted>')
    expect(out.text).toContain('Bearer <redacted>')
  })

  it('passes through nullish and primitive values', () => {
    expect(redactJsonSecrets(null)).toBeNull()
    expect(redactJsonSecrets(undefined)).toBeUndefined()
    expect(redactJsonSecrets(123)).toBe(123)
    expect(redactJsonSecrets(true)).toBe(true)
    expect(redactJsonSecrets('sk-abcdefghi')).toBe('sk-<redacted>')
  })
})
