import { describe, expect, it } from 'vitest'
import { formatPathForToolDisplay, sanitizeToolTextPaths } from './pathDisplay'

describe('pathDisplay', () => {
  it('formats absolute paths relative to cwd', () => {
    expect(
      formatPathForToolDisplay(
        '/Users/david/Documents/github/formax/apps/web-reference-react/src/App.tsx',
        '/Users/david/Documents/github/formax',
      ),
    ).toBe('apps/web-reference-react/src/App.tsx')
  })

  it('sanitizes windows home paths using forward slashes', () => {
    const text = 'Wrote C:/Users/david/Documents/github/formax/snake-game/index.html'
    expect(sanitizeToolTextPaths(text, 'C:/Users/david/Documents/github/formax')).toBe(
      'Wrote snake-game/index.html',
    )
  })
})
