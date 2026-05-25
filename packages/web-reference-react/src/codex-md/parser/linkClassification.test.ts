import { describe, expect, it } from 'vitest'
import { parseFileReference } from './linkClassification'

describe('parseFileReference', () => {
  it('parses relative file paths with optional line references', () => {
    expect(parseFileReference('./docs/guide.md:3', 'guide')).toEqual({
      path: './docs/guide.md',
      label: 'guide',
      line: 3,
      endLine: undefined,
    })
  })

  it('does not classify bare host-style values as file references', () => {
    expect(parseFileReference('openai.com')).toBeNull()
    expect(parseFileReference('example.dev/path')).toBeNull()
  })

  it('keeps common filename-style references classified as files', () => {
    expect(parseFileReference('README.md')).toEqual({
      path: 'README.md',
      label: undefined,
    })
    expect(parseFileReference('package.json')).toEqual({
      path: 'package.json',
      label: undefined,
    })
  })
})
