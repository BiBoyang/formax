import { describe, expect, it } from 'vitest'
import { buildFileCommandContent, buildFileCommandExpandedText } from './render'

describe('commands/render', () => {
  it('builds command content with and without slash prefix', () => {
    const withSlash = buildFileCommandContent({
      command: '/compact',
      args: '--dry-run',
      body: 'body text',
    })
    expect(withSlash[0]).toEqual(
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('<command-message>compact is running…</command-message>'),
      }),
    )
    expect((withSlash[0] as any).text).toContain('<command-args>--dry-run</command-args>')

    const withoutSlash = buildFileCommandContent({
      command: 'compact',
      args: '',
      body: 'body text',
    })
    expect((withoutSlash[0] as any).text).toContain('<command-message>compact is running…</command-message>')
    expect((withoutSlash[0] as any).text).not.toContain('<command-args>')
  })

  it('builds expanded text and filters non-string block text defensively', () => {
    const normal = buildFileCommandExpandedText({
      command: '/status',
      args: '',
      body: 'details',
    })
    expect(normal).toContain('<command-name>/status</command-name>')
    expect(normal).toContain('details')

    const withNonString = buildFileCommandExpandedText({
      command: '/status',
      args: '',
      body: 123 as any,
    })
    expect(withNonString).not.toContain('123')
  })
})
