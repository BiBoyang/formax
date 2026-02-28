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

  it('treats git log without patch flags as non-content', () => {
    const out = extractFilepathsFromCommandOutput({
      command: 'git log --oneline',
      output: 'abc123 feat: add thing\n',
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

  it('parses quoted paths and command separators (&&, ||, ;)', () => {
    const out = extractFilepathsFromCommandOutput({
      command: `cat "docs/with space.md" && cat src/a.ts || cat src/b.ts; cat src/c.ts`,
      output: 'content\n',
    })

    expect(out.isDisplayingContents).toBe(true)
    expect(out.filepaths).toEqual(['docs/with space.md', 'src/a.ts', 'src/b.ts', 'src/c.ts'])
  })

  it('parses escaped whitespace in path tokens', () => {
    const out = extractFilepathsFromCommandOutput({
      command: 'cat docs/with\\ space.md',
      output: 'content\n',
    })

    expect(out.isDisplayingContents).toBe(true)
    expect(out.filepaths).toEqual(['docs/with space.md'])
  })

  it('treats git blame as displaying contents', () => {
    const out = extractFilepathsFromCommandOutput({
      command: 'git blame src/main.ts',
      output: 'abc123 (user 2025-01-01 1) const x = 1',
    })

    expect(out.isDisplayingContents).toBe(true)
    expect(out.filepaths).toEqual([])
    expect(out.confidence).toBe(0.6)
  })

  it('does not treat sed output as content view by default', () => {
    const out = extractFilepathsFromCommandOutput({
      command: "sed -n '1,5p' src/main.ts",
      output: 'line1\nline2\n',
    })

    expect(out.isDisplayingContents).toBe(false)
    expect(out.filepaths).toEqual([])
  })

  it('extracts file paths from head/tail commands and ignores option values', () => {
    const out = extractFilepathsFromCommandOutput({
      command: 'head -n 5 src/a.ts --lines 3 src/b.ts -- -c 2 src/c.ts > out.txt',
      output: 'preview',
    })

    expect(out.isDisplayingContents).toBe(true)
    expect(out.filepaths).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts', 'out.txt'])
  })

  it('handles /dev/null paths in patch output', () => {
    const out = extractFilepathsFromCommandOutput({
      command: 'git diff',
      output: [
        'diff --git a/src/old.ts b/src/old.ts',
        '--- a/src/old.ts',
        '+++ /dev/null',
        'diff --git a/src/new.ts b/src/new.ts',
        '--- /dev/null',
        '+++ b/src/new.ts',
      ].join('\n'),
    })

    expect(out.isDisplayingContents).toBe(true)
    expect(out.filepaths).toEqual(['src/old.ts', 'src/new.ts'])
  })

  it('normalizes quoted tokens and skips redirect-like tokens', () => {
    const out = extractFilepathsFromCommandOutput({
      command: `cat "src/a.ts" 'src/b.ts' 2> err.log 2>&1 &> all.log >& out.log 3<4`,
      output: 'content',
    })

    expect(out.isDisplayingContents).toBe(true)
    expect(out.filepaths).toEqual(['src/a.ts', 'src/b.ts', 'err.log', 'all.log', 'out.log'])
  })
})
