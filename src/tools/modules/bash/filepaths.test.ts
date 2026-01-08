import { describe, it, expect } from 'vitest'
import { extractFilepathsFromCommandOutput } from './filepaths'

describe('extractFilepathsFromCommandOutput', () => {
  it('returns empty for non-content commands (ls/find)', () => {
    const ls = extractFilepathsFromCommandOutput({
      command: 'ls -la /tmp',
      output: 'total 0\n-rw-r--r-- 1 me staff 0 Jan 1 00:00 a.txt\n',
    })
    expect(ls.isDisplayingContents).toBe(false)
    expect(ls.filepaths).toEqual([])

    const find = extractFilepathsFromCommandOutput({
      command: 'find src -type f | head',
      output: 'src/index.ts\nsrc/app.ts\n',
    })
    expect(find.isDisplayingContents).toBe(false)
    expect(find.filepaths).toEqual([])
  })

  it('treats git diff name-only as non-content', () => {
    const out = extractFilepathsFromCommandOutput({
      command: 'git diff --name-only',
      output: 'src/a.ts\nsrc/b.ts\n',
    })
    expect(out.isDisplayingContents).toBe(false)
    expect(out.filepaths).toEqual([])
  })

  it('extracts paths from git diff patches', () => {
    const out = extractFilepathsFromCommandOutput({
      command: 'git diff',
      output: [
        'diff --git a/src/a.ts b/src/a.ts',
        'index 1111111..2222222 100644',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -1 +1 @@',
        '-old',
        '+new',
        '',
      ].join('\n'),
    })
    expect(out.isDisplayingContents).toBe(true)
    expect(out.filepaths).toEqual(['src/a.ts'])
  })

  it('extracts paths from cat-like commands', () => {
    const out = extractFilepathsFromCommandOutput({
      command: 'cat src/README.md',
      output: '# hello\n',
    })
    expect(out.isDisplayingContents).toBe(true)
    expect(out.filepaths).toEqual(['src/README.md'])
  })

  it('handles renamed files in diff output', () => {
    const out = extractFilepathsFromCommandOutput({
      command: 'git show',
      output: [
        'diff --git a/old.txt b/new.txt',
        'similarity index 100%',
        'rename from old.txt',
        'rename to new.txt',
        '',
      ].join('\n'),
    })
    expect(out.isDisplayingContents).toBe(true)
    expect(out.filepaths).toEqual(['old.txt', 'new.txt'])
  })
})

