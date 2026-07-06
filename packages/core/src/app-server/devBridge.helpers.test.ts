import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { __devBridgeTestHooks } from './devBridge.js'

function runGit(repoDir: string, args: string[]): void {
  execFileSync('git', ['-C', repoDir, ...args], { stdio: 'ignore' })
}

describe('devBridge helper hooks', () => {
  it('normalizes limits and cwd values', () => {
    expect(__devBridgeTestHooks.normalizeMaxBytes('x', 1234)).toBe(1234)
    expect(__devBridgeTestHooks.normalizeMaxBytes(1)).toBe(32 * 1024)
    expect(__devBridgeTestHooks.normalizeMaxBytes(9_999_999)).toBe(2 * 1024 * 1024)

    expect(__devBridgeTestHooks.normalizeMaxFiles('x', 33)).toBe(33)
    expect(__devBridgeTestHooks.normalizeMaxFiles(1)).toBe(20)
    expect(__devBridgeTestHooks.normalizeMaxFiles(9_999)).toBe(5000)
    expect(__devBridgeTestHooks.normalizePreviewMaxBytes('x', 1234)).toBe(1234)
    expect(__devBridgeTestHooks.normalizePreviewMaxBytes(1)).toBe(32 * 1024)
    expect(__devBridgeTestHooks.normalizePreviewMaxBytes(99_999_999)).toBe(8 * 1024 * 1024)

    expect(__devBridgeTestHooks.resolveDiffCwd('/base', undefined)).toBe('/base')
    expect(__devBridgeTestHooks.resolveDiffCwd('/base', '   ')).toBe('/base')
    expect(__devBridgeTestHooks.resolveDiffCwd('/base', './a')).toBe(path.resolve('./a'))
    expect(__devBridgeTestHooks.isPathInsideCwd('/repo', '/repo/images/a.webp')).toBe(true)
    expect(__devBridgeTestHooks.isPathInsideCwd('/repo', '/repo-other/a.webp')).toBe(false)
    expect(__devBridgeTestHooks.getImagePreviewMimeType('a.webp')).toBe('image/webp')
    expect(__devBridgeTestHooks.getImagePreviewMimeType('a.svg')).toBeNull()
  })

  it('writes jsonl lines and broadcasts safely', () => {
    const s = new PassThrough()
    let out = ''
    s.on('data', (chunk) => {
      out += chunk.toString('utf8')
    })
    __devBridgeTestHooks.writeJsonlLine(s, '   ')
    __devBridgeTestHooks.writeJsonlLine(s, '  hello  ')
    expect(out).toBe('hello\n')

    const sent: string[] = []
    const clients = [
      { readyState: 0, send: (_line: string) => sent.push('closed') },
      { readyState: 1, send: (line: string) => sent.push(line) },
      { readyState: 1, send: () => { throw new Error('boom') } },
    ] as any
    __devBridgeTestHooks.broadcastLine(clients, 'x')
    expect(sent).toEqual(['x'])
  })

  it('creates audit writer noop and file-backed modes', async () => {
    const noop = __devBridgeTestHooks.createBridgeAuditWriter(undefined)
    noop.write({ ts: 't', event: 'x' })
    await noop.flush()

    const dir = await mkdtemp(path.join(tmpdir(), 'formax-devbridge-audit-'))
    try {
      const file = path.join(dir, 'logs', 'bridge.jsonl')
      const writer = __devBridgeTestHooks.createBridgeAuditWriter(file)
      writer.write({ ts: '1', event: 'a' })
      writer.write({ ts: '2', event: 'b' })
      await writer.flush()
      const text = await readFile(file, 'utf8')
      expect(text).toContain('"event":"a"')
      expect(text).toContain('"event":"b"')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('swallows audit writer queue failures', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'formax-devbridge-audit-fail-'))
    try {
      const file = path.join(dir, 'logs', 'bridge.jsonl')
      const writer = __devBridgeTestHooks.createBridgeAuditWriter(file)
      const circular: any = { ts: '1', event: 'boom' }
      circular.self = circular
      writer.write(circular)
      await writer.flush()
      await expect(readFile(file, 'utf8')).rejects.toThrow()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('runs git helper on success and failure', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'formax-devbridge-git-'))
    try {
      runGit(dir, ['init'])
      const ok = await __devBridgeTestHooks.runGit(dir, ['rev-parse', '--is-inside-work-tree'])
      expect(ok.ok).toBe(true)

      const bad = await __devBridgeTestHooks.runGit(path.join(dir, 'missing'), ['status'])
      expect(bad.ok).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('handles runGit error fallbacks for message selection', async () => {
    const withStderr = await __devBridgeTestHooks.runGit('/tmp', ['status'], {
      execFileFn: ((_f, _a, _o, cb) => cb?.(new Error('e'), '', 'stderr boom')) as any,
    })
    expect(withStderr).toEqual({ ok: false, error: 'stderr boom' })

    const withMessage = await __devBridgeTestHooks.runGit('/tmp', ['status'], {
      execFileFn: ((_f, _a, _o, cb) => cb?.(new Error('msg boom'), '', '')) as any,
    })
    expect(withMessage).toEqual({ ok: false, error: 'msg boom' })

    const withFallback = await __devBridgeTestHooks.runGit('/tmp', ['status'], {
      execFileFn: ((_f, _a, _o, cb) => cb?.({ message: '' } as any, '', '')) as any,
    })
    expect(withFallback).toEqual({ ok: false, error: 'git command failed' })
  })

  it('runs bridge git commands with unquoted unicode paths', async () => {
    const calls: string[][] = []
    const result = await __devBridgeTestHooks.runGit('/tmp/repo', ['diff', '--numstat'], {
      execFileFn: ((_file, args, _options, cb) => {
        calls.push(args as string[])
        cb?.(null, '', '')
      }) as any,
    })

    expect(result.ok).toBe(true)
    expect(calls[0]).toEqual([
      '-C',
      '/tmp/repo',
      '-c',
      'core.quotepath=false',
      'diff',
      '--numstat',
    ])
  })

  it('parses patch/rename/numstat formats', () => {
    expect(__devBridgeTestHooks.normalizeGitReviewCommitLimit('x')).toBe(10)
    expect(__devBridgeTestHooks.normalizeGitReviewCommitLimit(0)).toBe(1)
    expect(__devBridgeTestHooks.normalizeGitReviewCommitLimit(99)).toBe(50)
    expect(__devBridgeTestHooks.buildGitReviewCommitListArgs(99)).toEqual([
      'log',
      '--max-count=50',
      '--format=%H%x1f%h%x1f%ct%x1f%s',
    ])
    expect(
      __devBridgeTestHooks.parseGitReviewCommitList(
        [
          '0123456789abcdef\x1f0123456\x1f1700000000\x1ffeat: one',
          'bad\x1fline',
        ].join('\n'),
      ),
    ).toEqual([
      {
        sha: '0123456789abcdef',
        shortSha: '0123456',
        subject: 'feat: one',
        committedAt: '2023-11-14T22:13:20.000Z',
        committedAtUnixSeconds: 1700000000,
      },
    ])

    expect(__devBridgeTestHooks.parsePatchFiles('')).toEqual([])
    const parsed = __devBridgeTestHooks.parsePatchFiles([
      'diff --git a/a.ts b/a.ts',
      '--- a/a.ts',
      '+++ b/a.ts',
      '+x',
      '-y',
    ].join('\n'))
    expect(parsed[0]?.path).toBe('a.ts')
    expect(parsed[0]?.additions).toBe(1)
    expect(parsed[0]?.deletions).toBe(1)
    const unknownPath = __devBridgeTestHooks.parsePatchFiles('not-a-diff-line')
    expect(unknownPath[0]?.path).toBe('unknown')
    const emptyB = __devBridgeTestHooks.parsePatchFiles('diff --git a/x b/\n+a')
    expect(emptyB[0]?.path).toBe('unknown')

    const renames = __devBridgeTestHooks.parseRenamePairs(['R100\told.ts\tnew.ts', 'M\told.ts\tnew.ts', 'M\tnope'].join('\n'))
    expect(renames).toEqual([{ oldPath: 'old.ts', newPath: 'new.ts' }])
    expect(__devBridgeTestHooks.parseRenamePairs('')).toEqual([])
    expect(__devBridgeTestHooks.parseRenamePairs('R100\told-only')).toEqual([])
    expect(__devBridgeTestHooks.parseRenamePairs('R100\t\tnew.ts')).toEqual([])
    expect(__devBridgeTestHooks.parseRenamePairs('\told.ts\tnew.ts')).toEqual([])

    expect(__devBridgeTestHooks.normalizeNumstatPath('raw.ts', renames)).toBe('raw.ts')
    expect(__devBridgeTestHooks.normalizeNumstatPath('old.ts => new.ts', [])).toBe('old.ts => new.ts')
    expect(__devBridgeTestHooks.normalizeNumstatPath('old.ts => new.ts', renames)).toBe('new.ts')
    expect(
      __devBridgeTestHooks.normalizeNumstatPath('src/{old.ts => new.ts}', [{ oldPath: 'src/old.ts', newPath: 'src/new.ts' }]),
    ).toBe('src/new.ts')
    expect(
      __devBridgeTestHooks.normalizeNumstatPath('src/{old.ts => new.ts}', [{ oldPath: 'other', newPath: 'other' }]),
    ).toBe('src/{old.ts => new.ts}')
    expect(__devBridgeTestHooks.normalizeNumstatPath('x => y', [{ oldPath: 'a', newPath: 'b' }])).toBe('x => y')

    const numstat = __devBridgeTestHooks.parseNumstatFiles(['1\t2\ta.ts', '-\t-\tb.bin', 'badline'].join('\n'), renames)
    expect(numstat).toEqual([
      { path: 'a.ts', additions: 1, deletions: 2 },
      { path: 'b.bin', additions: 0, deletions: 0 },
    ])
    expect(__devBridgeTestHooks.parseNumstatFiles('', renames)).toEqual([])
  })

  it('merges summary files and clips patch by budget', () => {
    const merged = __devBridgeTestHooks.mergeSummaryFiles(
      [{ path: 'a.ts', additions: 1, deletions: 0 }],
      ['a.ts', 'b.ts'],
    )
    expect(merged).toEqual([
      { path: 'a.ts', additions: 1, deletions: 0 },
      { path: 'b.ts', additions: 0, deletions: 0, untracked: true },
    ])

    expect(__devBridgeTestHooks.estimateDiffFileBaseBytes('a')).toBeGreaterThan(0)

    const out: Array<{ path: string; additions: number; deletions: number; patch: string }> = []
    const noRoom = __devBridgeTestHooks.appendDiffFileWithinBudget(
      out as any,
      { path: 'a', additions: 0, deletions: 0, patch: 'x' } as any,
      100,
      100,
    )
    expect(noRoom.truncated).toBe(true)

    const clippedOut: any[] = []
    const clipped = __devBridgeTestHooks.appendDiffFileWithinBudget(
      clippedOut as any,
      { path: 'a', additions: 0, deletions: 0, patch: 'x'.repeat(10000) } as any,
      0,
      1000,
    )
    expect(clipped.truncated).toBe(true)
    expect(clippedOut[0].patch).toContain('... [file patch truncated]')

    expect(__devBridgeTestHooks.countContentLines('')).toBe(0)
    expect(__devBridgeTestHooks.countContentLines('a\nb\n')).toBe(2)
  })

  it('builds untracked file patches for regular/binary/symlink/non-file/missing', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'formax-devbridge-untracked-hooks-'))
    try {
      await writeFile(path.join(dir, 'a.txt'), 'a\nb\n', 'utf8')
      const regular = await __devBridgeTestHooks.buildUntrackedDiffFile(dir, 'a.txt')
      expect(regular.additions).toBe(2)
      expect(regular.patch).toContain('+++ b/a.txt')

      await writeFile(path.join(dir, 'no-trailing.txt'), 'single-line', 'utf8')
      const noTrailing = await __devBridgeTestHooks.buildUntrackedDiffFile(dir, 'no-trailing.txt')
      expect(noTrailing.additions).toBe(1)
      expect(noTrailing.patch).toContain('@@ -0,0 +1,1 @@')

      await writeFile(path.join(dir, 'empty.txt'), '', 'utf8')
      const empty = await __devBridgeTestHooks.buildUntrackedDiffFile(dir, 'empty.txt')
      expect(empty.additions).toBe(0)
      expect(empty.patch).not.toContain('@@ -0,0')

      await writeFile(path.join(dir, 'b.bin'), Buffer.from([0x61, 0x00, 0x62]))
      const binary = await __devBridgeTestHooks.buildUntrackedDiffFile(dir, 'b.bin')
      expect(binary.patch).toContain('Binary files /dev/null and b/b.bin differ')

      await symlink('./a.txt', path.join(dir, 'link.txt'))
      const link = await __devBridgeTestHooks.buildUntrackedDiffFile(dir, 'link.txt')
      expect(link.patch).toContain('new file mode 120000')

      const summary = await __devBridgeTestHooks.buildUntrackedSummaryFile(dir, 'a.txt')
      expect(summary).toMatchObject({ path: 'a.txt', additions: 2, deletions: 0, untracked: true })

      const largePath = 'large.log'
      await writeFile(path.join(dir, largePath), Buffer.alloc(260 * 1024, 0x61))
      const largeSummary = await __devBridgeTestHooks.buildUntrackedSummaryFile(dir, largePath)
      expect(largeSummary).toMatchObject({ path: largePath, additions: 0, deletions: 0, untracked: true })

      const imagePath = 'preview.webp'
      await writeFile(path.join(dir, imagePath), Buffer.from([0x52, 0x49, 0x46, 0x46]))
      const imageSummary = await __devBridgeTestHooks.buildUntrackedSummaryFile(dir, imagePath)
      expect(imageSummary).toMatchObject({ path: imagePath, additions: 0, deletions: 0, untracked: true })

      const linkSummary = await __devBridgeTestHooks.buildUntrackedSummaryFile(dir, 'link.txt')
      expect(linkSummary).toMatchObject({ path: 'link.txt', additions: 1, deletions: 0, untracked: true })

      const linkUnavailable = await __devBridgeTestHooks.buildUntrackedDiffFile(dir, 'link.txt', {
        readlinkFn: async () => {
          throw new Error('readlink boom')
        },
      })
      expect(linkUnavailable.patch).toContain('+(unavailable)')

      await mkdir(path.join(dir, 'somedir'))
      const nonFile = await __devBridgeTestHooks.buildUntrackedDiffFile(dir, 'somedir')
      expect(nonFile.patch).toContain('(file content unavailable)')

      const missing = await __devBridgeTestHooks.buildUntrackedDiffFile(dir, 'missing.txt')
      expect(missing.patch).toContain('(file content unavailable)')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reads diff image previews as data URLs', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'formax-devbridge-preview-'))
    try {
      runGit(dir, ['init'])
      await mkdir(path.join(dir, 'images'))
      const bytes = Buffer.from([0x52, 0x49, 0x46, 0x46])
      await writeFile(path.join(dir, 'images', 'a.webp'), bytes)

      const result = await __devBridgeTestHooks.readWorkspaceDiffFilePreview(dir, {
        path: 'images/a.webp',
        maxBytes: 1024,
      })

      expect(result.found).toBe(true)
      expect(result.preview?.kind).toBe('image')
      expect(result.preview?.mimeType).toBe('image/webp')
      expect(result.preview?.dataUrl).toBe(`data:image/webp;base64,${bytes.toString('base64')}`)
      expect(result.preview?.sizeBytes).toBe(bytes.byteLength)
      expect(result.preview?.source).toBe('working_tree')
      expect(result.preview?.changeKind).toBe('added')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reads deleted image previews from the index blob for unstaged source', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'formax-devbridge-preview-deleted-'))
    try {
      runGit(dir, ['init'])
      runGit(dir, ['config', 'user.email', 'devbridge@example.com'])
      runGit(dir, ['config', 'user.name', 'Dev Bridge'])
      await mkdir(path.join(dir, 'images'))
      const bytes = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x01])
      await writeFile(path.join(dir, 'images', 'deleted.webp'), bytes)
      runGit(dir, ['add', 'images/deleted.webp'])
      runGit(dir, ['commit', '-m', 'init'])
      await rm(path.join(dir, 'images', 'deleted.webp'))

      const result = await __devBridgeTestHooks.readWorkspaceDiffFilePreview(dir, {
        path: 'images/deleted.webp',
        maxBytes: 1024,
      })

      expect(result.found).toBe(true)
      expect(result.preview?.kind).toBe('image')
      expect(result.preview?.mimeType).toBe('image/webp')
      expect(result.preview?.dataUrl).toBe(`data:image/webp;base64,${bytes.toString('base64')}`)
      expect(result.preview?.sizeBytes).toBe(bytes.byteLength)
      expect(result.preview?.source).toBe('index')
      expect(result.preview?.changeKind).toBe('deleted')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects image preview requests outside the diff set', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'formax-devbridge-preview-reject-'))
    try {
      runGit(dir, ['init'])
      runGit(dir, ['config', 'user.email', 'devbridge@example.com'])
      runGit(dir, ['config', 'user.name', 'Dev Bridge'])
      await writeFile(path.join(dir, 'a.svg'), '<svg />', 'utf8')
      await writeFile(path.join(dir, 'tracked.png'), Buffer.from([1, 2, 3]))
      await writeFile(path.join(dir, 'large.png'), Buffer.alloc(64 * 1024))
      runGit(dir, ['add', 'tracked.png'])
      runGit(dir, ['commit', '-m', 'init'])

      await expect(
        __devBridgeTestHooks.readWorkspaceDiffFilePreview(dir, { path: '../outside.webp' }),
      ).resolves.toMatchObject({ found: false, preview: null, error: 'outside_workspace' })
      await expect(
        __devBridgeTestHooks.readWorkspaceDiffFilePreview(dir, { path: 'a.svg' }),
      ).resolves.toMatchObject({ found: false, preview: null, error: 'not_image' })
      await expect(
        __devBridgeTestHooks.readWorkspaceDiffFilePreview(dir, { path: 'tracked.png' }),
      ).resolves.toMatchObject({ found: false, preview: null, error: 'not_found' })
      await expect(
        __devBridgeTestHooks.readWorkspaceDiffFilePreview(dir, { path: 'large.png', maxBytes: 32 * 1024 }),
      ).resolves.toMatchObject({ found: true, preview: null, error: 'too_large' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reads diff/diffSummary/diffFilePatch paths from git repos', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'formax-devbridge-read-hooks-'))
    try {
      runGit(dir, ['init'])
      runGit(dir, ['config', 'user.email', 'devbridge@example.com'])
      runGit(dir, ['config', 'user.name', 'Dev Bridge'])
      await writeFile(path.join(dir, 'tracked.txt'), 'one\n', 'utf8')
      await mkdir(path.join(dir, 'images', 'momota'), { recursive: true })
      const unicodePath = 'images/momota/note_04_桃田贤斗.webp'
      await writeFile(path.join(dir, unicodePath), 'old\n', 'utf8')
      runGit(dir, ['add', 'tracked.txt'])
      runGit(dir, ['add', unicodePath])
      runGit(dir, ['commit', '-m', 'init'])
      await writeFile(path.join(dir, 'tracked.txt'), 'one\ntwo\n', 'utf8')
      await writeFile(path.join(dir, unicodePath), 'old\nnew\n', 'utf8')
      await writeFile(path.join(dir, 'new.txt'), 'new\n', 'utf8')
      for (let i = 0; i < 25; i++) {
        await writeFile(path.join(dir, `extra-${i}.txt`), `line-${i}\n`, 'utf8')
      }

      const diff = await __devBridgeTestHooks.readWorkspaceDiff(dir, { maxBytes: 200_000 })
      expect(diff.hasChanges).toBe(true)
      expect(diff.files.length).toBeGreaterThan(0)

      const summary = await __devBridgeTestHooks.readWorkspaceDiffSummary(dir, { maxFiles: 20 })
      expect(summary.hasChanges).toBe(true)
      expect(summary.truncated).toBe(true)
      expect(summary.files.length).toBe(20)
      expect(summary.files.some((file) => file.path === unicodePath)).toBe(true)
      expect(summary.files.some((file) => file.path.includes('\\345'))).toBe(false)

      const fullSummary = await __devBridgeTestHooks.readWorkspaceDiffSummary(dir, { maxFiles: 100 })
      expect(fullSummary.files.find((file) => file.path === 'new.txt')).toMatchObject({
        additions: 1,
        deletions: 0,
        untracked: true,
      })

      const patch = await __devBridgeTestHooks.readWorkspaceDiffFilePatch(dir, { path: 'tracked.txt', maxBytes: 200_000 })
      expect(patch.found).toBe(true)
      expect(patch.file?.path).toBe('tracked.txt')

      const unicodePatch = await __devBridgeTestHooks.readWorkspaceDiffFilePatch(dir, { path: unicodePath, maxBytes: 200_000 })
      expect(unicodePatch.found).toBe(true)
      expect(unicodePatch.file?.path).toBe(unicodePath)
      expect(unicodePatch.file?.patch).toContain(unicodePath)
      expect(unicodePatch.file?.patch).not.toContain('\\345')

      const missing = await __devBridgeTestHooks.readWorkspaceDiffFilePatch(dir, { path: 'missing.txt', maxBytes: 200_000 })
      expect(missing.found).toBe(false)

      const emptyPath = await __devBridgeTestHooks.readWorkspaceDiffFilePatch(dir, { path: '   ' })
      expect(emptyPath.found).toBe(false)

      const untrackedPatch = await __devBridgeTestHooks.readWorkspaceDiffFilePatch(dir, { path: 'new.txt', maxBytes: 200_000 })
      expect(untrackedPatch.found).toBe(true)
      expect(untrackedPatch.file?.untracked).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('separates unstaged and staged tracked changes', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'formax-devbridge-review-source-'))
    try {
      runGit(dir, ['init'])
      runGit(dir, ['config', 'user.email', 'devbridge@example.com'])
      runGit(dir, ['config', 'user.name', 'Dev Bridge'])
      await writeFile(path.join(dir, 'tracked.txt'), 'one\n', 'utf8')
      await writeFile(path.join(dir, 'staged-only.txt'), 'old\n', 'utf8')
      runGit(dir, ['add', 'tracked.txt', 'staged-only.txt'])
      runGit(dir, ['commit', '-m', 'init'])

      await writeFile(path.join(dir, 'tracked.txt'), 'one\nstaged\n', 'utf8')
      await writeFile(path.join(dir, 'staged-only.txt'), 'new\n', 'utf8')
      runGit(dir, ['add', 'tracked.txt', 'staged-only.txt'])
      await writeFile(path.join(dir, 'tracked.txt'), 'one\nstaged\nunstaged\n', 'utf8')
      await writeFile(path.join(dir, 'untracked.txt'), 'new\n', 'utf8')

      const unstagedSummary = await __devBridgeTestHooks.readWorkspaceDiffSummary(dir, {
        source: { kind: 'unstaged' },
        maxFiles: 100,
      })
      expect(unstagedSummary.sourceKey).toBe('git:unstaged')
      expect(unstagedSummary.files.map((file) => file.path)).toContain('tracked.txt')
      expect(unstagedSummary.files.map((file) => file.path)).toContain('untracked.txt')
      expect(unstagedSummary.files.map((file) => file.path)).not.toContain('staged-only.txt')
      expect(unstagedSummary.files.find((file) => file.path === 'tracked.txt')).toMatchObject({
        additions: 1,
        deletions: 0,
      })

      const stagedSummary = await __devBridgeTestHooks.readWorkspaceDiffSummary(dir, {
        source: { kind: 'staged' },
        maxFiles: 100,
      })
      expect(stagedSummary.sourceKey).toBe('git:staged')
      expect(stagedSummary.files.map((file) => file.path)).toContain('tracked.txt')
      expect(stagedSummary.files.map((file) => file.path)).toContain('staged-only.txt')
      expect(stagedSummary.files.map((file) => file.path)).not.toContain('untracked.txt')

      const unstagedPatch = await __devBridgeTestHooks.readWorkspaceDiffFilePatch(dir, {
        source: { kind: 'unstaged' },
        path: 'tracked.txt',
        maxBytes: 200_000,
      })
      expect(unstagedPatch.file?.patch).toContain('+unstaged')
      expect(unstagedPatch.file?.patch).not.toContain('+staged')

      const stagedPatch = await __devBridgeTestHooks.readWorkspaceDiffFilePatch(dir, {
        source: { kind: 'staged' },
        path: 'tracked.txt',
        maxBytes: 200_000,
      })
      expect(stagedPatch.file?.patch).toContain('+staged')
      expect(stagedPatch.file?.patch).not.toContain('+unstaged')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reads commit review sources and recent commit list from git repos', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'formax-devbridge-commit-source-'))
    try {
      runGit(dir, ['init'])
      runGit(dir, ['config', 'user.email', 'devbridge@example.com'])
      runGit(dir, ['config', 'user.name', 'Dev Bridge'])

      await writeFile(path.join(dir, 'root.txt'), 'root\n', 'utf8')
      runGit(dir, ['add', 'root.txt'])
      runGit(dir, ['commit', '-m', 'root commit'])
      const rootSha = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()

      await writeFile(path.join(dir, 'root.txt'), 'root\nsecond\n', 'utf8')
      runGit(dir, ['commit', '-am', 'second commit'])
      const secondSha = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()

      runGit(dir, ['checkout', '-b', 'side', 'HEAD~1'])
      await writeFile(path.join(dir, 'side.txt'), 'side\n', 'utf8')
      runGit(dir, ['add', 'side.txt'])
      runGit(dir, ['commit', '-m', 'side commit'])
      runGit(dir, ['checkout', 'master'])
      runGit(dir, ['merge', '--no-ff', 'side', '-m', 'merge commit'])
      const mergeSha = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()

      const commits = await __devBridgeTestHooks.listWorkspaceReviewCommits(dir, { limit: 10 })
      expect(commits.commits[0]?.subject).toBe('merge commit')
      expect(commits.commits.map((commit) => commit.subject)).toEqual(
        expect.arrayContaining(['merge commit', 'side commit', 'second commit', 'root commit']),
      )
      expect(commits.commits[0]?.sha).toBe(mergeSha)

      const secondSummary = await __devBridgeTestHooks.readWorkspaceDiffSummary(dir, {
        source: { kind: 'commit', sha: secondSha },
        maxFiles: 100,
      })
      expect(secondSummary.sourceKey).toBe(`git:commit:${secondSha}`)
      expect(secondSummary.files).toEqual([{ path: 'root.txt', additions: 1, deletions: 0 }])

      const secondPatch = await __devBridgeTestHooks.readWorkspaceDiffFilePatch(dir, {
        source: { kind: 'commit', sha: secondSha },
        path: 'root.txt',
        maxBytes: 200_000,
      })
      expect(secondPatch.found).toBe(true)
      expect(secondPatch.file?.patch).toContain('+second')

      const rootSummary = await __devBridgeTestHooks.readWorkspaceDiffSummary(dir, {
        source: { kind: 'commit', sha: rootSha },
        maxFiles: 100,
      })
      expect(rootSummary.files).toEqual([{ path: 'root.txt', additions: 1, deletions: 0 }])

      const mergeSummary = await __devBridgeTestHooks.readWorkspaceDiffSummary(dir, {
        source: { kind: 'commit', sha: mergeSha },
        maxFiles: 100,
      })
      expect(mergeSummary.files).toEqual([{ path: 'side.txt', additions: 1, deletions: 0 }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('marks staged image preview unavailable without reading the worktree image', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'formax-devbridge-staged-preview-'))
    try {
      runGit(dir, ['init'])
      runGit(dir, ['config', 'user.email', 'devbridge@example.com'])
      runGit(dir, ['config', 'user.name', 'Dev Bridge'])
      await mkdir(path.join(dir, 'images'))
      await writeFile(path.join(dir, 'images', 'a.webp'), Buffer.from([0x52, 0x49, 0x46, 0x46]))
      runGit(dir, ['add', 'images/a.webp'])

      await writeFile(path.join(dir, 'images', 'a.webp'), Buffer.from([0x52, 0x49, 0x46, 0x46, 0xff]))

      const result = await __devBridgeTestHooks.readWorkspaceDiffFilePreview(dir, {
        source: { kind: 'staged' },
        path: 'images/a.webp',
        maxBytes: 1024,
      })

      expect(result).toMatchObject({
        sourceKey: 'git:staged',
        found: true,
        preview: null,
        error: 'unsupported_source',
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reads commit image previews from git blobs instead of the worktree', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'formax-devbridge-commit-preview-'))
    try {
      runGit(dir, ['init'])
      runGit(dir, ['config', 'user.email', 'devbridge@example.com'])
      runGit(dir, ['config', 'user.name', 'Dev Bridge'])
      await mkdir(path.join(dir, 'images'))
      await writeFile(path.join(dir, 'images', 'keep.webp'), Buffer.from([0x52, 0x49, 0x46, 0x46]))
      await writeFile(path.join(dir, 'images', 'delete.webp'), Buffer.from([0x52, 0x49, 0x46, 0x46, 0x01]))
      runGit(dir, ['add', 'images'])
      runGit(dir, ['commit', '-m', 'root images'])
      const rootSha = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()

      await writeFile(path.join(dir, 'images', 'keep.webp'), Buffer.from([0x52, 0x49, 0x46, 0x46, 0x02]))
      runGit(dir, ['rm', 'images/delete.webp'])
      runGit(dir, ['commit', '-am', 'change images'])
      const sha = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()

      await writeFile(path.join(dir, 'images', 'keep.webp'), Buffer.from([0x52, 0x49, 0x46, 0x46, 0xff]))

      const rootAdded = await __devBridgeTestHooks.readWorkspaceDiffFilePreview(dir, {
        source: { kind: 'commit', sha: rootSha },
        path: 'images/keep.webp',
        maxBytes: 1024,
      })
      expect(rootAdded).toMatchObject({
        sourceKey: `git:commit:${rootSha}`,
        found: true,
        preview: {
          kind: 'image',
          mimeType: 'image/webp',
          sizeBytes: 4,
          source: 'commit',
          changeKind: 'added',
        },
      })
      expect(rootAdded.preview?.dataUrl).toBe(`data:image/webp;base64,${Buffer.from([0x52, 0x49, 0x46, 0x46]).toString('base64')}`)

      const modified = await __devBridgeTestHooks.readWorkspaceDiffFilePreview(dir, {
        source: { kind: 'commit', sha },
        path: 'images/keep.webp',
        maxBytes: 1024,
      })
      expect(modified).toMatchObject({
        sourceKey: `git:commit:${sha}`,
        found: true,
        preview: {
          kind: 'image',
          mimeType: 'image/webp',
          sizeBytes: 5,
          source: 'commit',
          changeKind: 'modified',
        },
      })
      expect(modified.preview?.dataUrl).toBe(`data:image/webp;base64,${Buffer.from([0x52, 0x49, 0x46, 0x46, 0x02]).toString('base64')}`)

      const deleted = await __devBridgeTestHooks.readWorkspaceDiffFilePreview(dir, {
        source: { kind: 'commit', sha },
        path: 'images/delete.webp',
        maxBytes: 1024,
      })
      expect(deleted).toMatchObject({
        found: true,
        preview: {
          kind: 'image',
          source: 'commit',
          changeKind: 'deleted',
          sizeBytes: 5,
        },
      })
      expect(deleted.preview?.dataUrl).toBe(`data:image/webp;base64,${Buffer.from([0x52, 0x49, 0x46, 0x46, 0x01]).toString('base64')}`)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects invalid git review source parameters', async () => {
    await expect(
      __devBridgeTestHooks.readWorkspaceDiffSummary('/tmp', {
        source: { kind: 'branch' },
        maxFiles: 100,
      }),
    ).rejects.toThrow('Invalid Git review source.')
  })

  it('handles fallback branches for diff/sum/patch helper readers via injected git responses', async () => {
    const runGitDiffFallback = async (_cwd: string, args: string[]) => {
      if (args[0] === 'ls-files') return { ok: false as const, error: 'ls failed' }
      if (args[1] === 'HEAD') return { ok: false as const, error: 'head failed' }
      return { ok: true as const, stdout: '' }
    }
    const diffFallback = await __devBridgeTestHooks.readWorkspaceDiff('/tmp', { maxBytes: 64 * 1024 }, { runGitFn: runGitDiffFallback })
    expect(diffFallback.hasChanges).toBe(false)
    expect(diffFallback.files).toEqual([])

    const runGitDiffHeadFailFallbackUsed = async (_cwd: string, args: string[]) => {
      if (args[0] === 'ls-files') return { ok: false as const, error: 'ls failed' }
      if (args[1] === 'HEAD') return { ok: false as const, error: 'head failed' }
      return { ok: true as const, stdout: 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n+a\n' }
    }
    const diffWithFallback = await __devBridgeTestHooks.readWorkspaceDiff('/tmp', { maxBytes: 64 * 1024 }, { runGitFn: runGitDiffHeadFailFallbackUsed })
    expect(diffWithFallback.files[0]?.path).toBe('a.ts')

    const runGitSummaryFallback = async (_cwd: string, args: string[]) => {
      if (args.includes('--numstat')) {
        if (args[1] === 'HEAD') return { ok: false as const, error: 'numstat head failed' }
        return { ok: true as const, stdout: '1\t0\ta.ts\n' }
      }
      if (args.includes('--name-status')) {
        if (args[1] === 'HEAD') return { ok: false as const, error: 'name-status head failed' }
        return { ok: true as const, stdout: 'R100\told.ts\tnew.ts\n' }
      }
      return { ok: false as const, error: 'ls failed' }
    }
    const summaryFallback = await __devBridgeTestHooks.readWorkspaceDiffSummary('/tmp', { maxFiles: 100 }, { runGitFn: runGitSummaryFallback })
    expect(summaryFallback.hasChanges).toBe(true)
    expect(summaryFallback.files.some((f) => f.path === 'a.ts')).toBe(true)

    const runGitSummaryHeadFailFallbackUsed = async (_cwd: string, args: string[]) => {
      if (args.includes('--numstat')) {
        if (args[1] === 'HEAD') return { ok: false as const, error: 'numstat head failed' }
        return { ok: true as const, stdout: '1\t0\ta.ts\n' }
      }
      if (args.includes('--name-status')) {
        if (args[1] === 'HEAD') return { ok: false as const, error: 'name-status head failed' }
        return { ok: true as const, stdout: '' }
      }
      return { ok: false as const, error: 'ls failed' }
    }
    const summaryWithFallback = await __devBridgeTestHooks.readWorkspaceDiffSummary('/tmp', { maxFiles: 100 }, { runGitFn: runGitSummaryHeadFailFallbackUsed })
    expect(summaryWithFallback.files[0]?.path).toBe('a.ts')

    const runGitPatchFallback = async (_cwd: string, args: string[]) => {
      if (args[0] === 'ls-files') return { ok: false as const, error: 'ls failed' }
      if (args[1] === 'HEAD') return { ok: false as const, error: 'head failed' }
      return { ok: true as const, stdout: '' }
    }
    const patchFallback = await __devBridgeTestHooks.readWorkspaceDiffFilePatch('/tmp', { path: 'x.ts', maxBytes: 64 * 1024 }, { runGitFn: runGitPatchFallback })
    expect(patchFallback.found).toBe(false)

    const runGitPatchHeadFailFallbackUsed = async (_cwd: string, args: string[]) => {
      if (args[0] === 'ls-files') return { ok: false as const, error: 'ls failed' }
      if (args[1] === 'HEAD') return { ok: false as const, error: 'head failed' }
      return { ok: true as const, stdout: 'diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n+a\n' }
    }
    const patchWithFallback = await __devBridgeTestHooks.readWorkspaceDiffFilePatch(
      '/tmp',
      { path: 'x.ts', maxBytes: 64 * 1024 },
      { runGitFn: runGitPatchHeadFailFallbackUsed },
    )
    expect(patchWithFallback.found).toBe(true)
  })

  it('covers empty-fallback branches when head/fallback diffs both fail but untracked succeeds', async () => {
    const runGitDiffNoPatch = async (_cwd: string, args: string[]) => {
      if (args[0] === 'ls-files') return { ok: true as const, stdout: '' }
      return { ok: false as const, error: 'no diff' }
    }
    const diff = await __devBridgeTestHooks.readWorkspaceDiff('/tmp', { maxBytes: 64 * 1024 }, { runGitFn: runGitDiffNoPatch })
    expect(diff.files).toEqual([])
    expect(diff.hasChanges).toBe(false)

    const runGitSummaryNoPatch = async (_cwd: string, args: string[]) => {
      if (args[0] === 'ls-files') return { ok: true as const, stdout: '' }
      return { ok: false as const, error: 'no diff' }
    }
    const summary = await __devBridgeTestHooks.readWorkspaceDiffSummary('/tmp', { maxFiles: 100 }, { runGitFn: runGitSummaryNoPatch })
    expect(summary.files).toEqual([])
    expect(summary.hasChanges).toBe(false)

    const runGitPatchNoPatch = async (_cwd: string, args: string[]) => {
      if (args[0] === 'ls-files') return { ok: true as const, stdout: '' }
      return { ok: false as const, error: 'no diff' }
    }
    const patch = await __devBridgeTestHooks.readWorkspaceDiffFilePatch('/tmp', { path: 'x.ts', maxBytes: 64 * 1024 }, { runGitFn: runGitPatchNoPatch })
    expect(patch.found).toBe(false)
  })

  it('builds untracked summary entries sequentially to avoid read spikes', async () => {
    let activeBuilds = 0
    let maxActiveBuilds = 0
    const runGitFn = async (_cwd: string, args: string[]) => {
      if (args[0] === 'ls-files') return { ok: true as const, stdout: 'a.txt\nb.txt\nc.txt\n' }
      return { ok: true as const, stdout: '' }
    }
    const buildUntrackedSummaryFileFn = async (_cwd: string, filePath: string) => {
      activeBuilds += 1
      maxActiveBuilds = Math.max(maxActiveBuilds, activeBuilds)
      await new Promise((resolve) => setTimeout(resolve, 0))
      activeBuilds -= 1
      return {
        path: filePath,
        additions: 1,
        deletions: 0,
        untracked: true,
      }
    }

    const summary = await __devBridgeTestHooks.readWorkspaceDiffSummary('/tmp', { maxFiles: 20 }, {
      runGitFn,
      buildUntrackedSummaryFileFn,
    })

    expect(summary.files).toHaveLength(3)
    expect(maxActiveBuilds).toBe(1)
  })

  it('handles readWorkspaceDiffFilePatch with non-string path and untracked fallback builder', async () => {
    const nonStringPath = await __devBridgeTestHooks.readWorkspaceDiffFilePatch('/tmp', { path: 1 as any })
    expect(nonStringPath.found).toBe(false)

    const runGitFn = async (_cwd: string, args: string[]) => {
      if (args[0] === 'ls-files') return { ok: true as const, stdout: 'x.ts\n' }
      return { ok: true as const, stdout: '' }
    }
    const buildUntrackedDiffFileFn = async () =>
      ({
        path: 'x.ts',
        additions: 1,
        deletions: 0,
        patch: 'p',
        untracked: true,
      }) as any
    const patch = await __devBridgeTestHooks.readWorkspaceDiffFilePatch('/tmp', { path: 'x.ts', maxBytes: 64 * 1024 }, { runGitFn, buildUntrackedDiffFileFn })
    expect(patch.found).toBe(true)
    expect(patch.file?.path).toBe('x.ts')
  })

  it('matches path by reverse suffix in findPatchByRequestedPath', () => {
    const file = __devBridgeTestHooks.findPatchByRequestedPath(
      [{ path: 'x.ts', additions: 1, deletions: 0, patch: 'p' }] as any,
      'nested/x.ts',
    )
    expect(file?.path).toBe('x.ts')
  })

  it('returns fallback error payloads when git cannot run', async () => {
    const missing = path.join(tmpdir(), 'formax-devbridge-missing-cwd')
    const diff = await __devBridgeTestHooks.readWorkspaceDiff(missing, { maxBytes: 200_000 })
    expect(diff.files[0]?.path).toBe('git-diff-error')
    expect(diff.files[0]?.patch).toContain('git diff unavailable')

    const summary = await __devBridgeTestHooks.readWorkspaceDiffSummary(missing, { maxFiles: 50 })
    expect(summary.files[0]?.path).toBe('git-diff-error')
  })

  it('marks readWorkspaceDiff truncated when tracked patch exceeds budget', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'formax-devbridge-tracked-truncate-'))
    try {
      runGit(dir, ['init'])
      runGit(dir, ['config', 'user.email', 'devbridge@example.com'])
      runGit(dir, ['config', 'user.name', 'Dev Bridge'])
      const big = `${'a\n'.repeat(25_000)}`
      await writeFile(path.join(dir, 'tracked.txt'), big, 'utf8')
      runGit(dir, ['add', 'tracked.txt'])
      runGit(dir, ['commit', '-m', 'init'])
      await writeFile(path.join(dir, 'tracked.txt'), `${'b\n'.repeat(25_000)}`, 'utf8')

      const diff = await __devBridgeTestHooks.readWorkspaceDiff(dir, { maxBytes: 32 * 1024 })
      expect(diff.truncated).toBe(true)
      expect(diff.files.length).toBe(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('marks readWorkspaceDiff truncated before untracked read when base budget is exhausted', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'formax-devbridge-untracked-precheck-'))
    try {
      runGit(dir, ['init'])
      runGit(dir, ['config', 'user.email', 'devbridge@example.com'])
      runGit(dir, ['config', 'user.name', 'Dev Bridge'])
      await writeFile(path.join(dir, 'tracked-big.txt'), `${'a\n'.repeat(8_000)}`, 'utf8')
      runGit(dir, ['add', 'tracked-big.txt'])
      runGit(dir, ['commit', '-m', 'init'])
      await writeFile(path.join(dir, 'tracked-big.txt'), `${'b\n'.repeat(8_000)}`, 'utf8')
      await writeFile(path.join(dir, 'untracked.txt'), 'new\n', 'utf8')

      const diff = await __devBridgeTestHooks.readWorkspaceDiff(dir, { maxBytes: 32 * 1024 })
      expect(diff.truncated).toBe(true)
      expect(diff.hasChanges).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('truncates before untracked read via deterministic injected git responses', async () => {
    const longBody = 'x'.repeat(32_500)
    const diffText = [
      'diff --git a/t.txt b/t.txt',
      '--- a/t.txt',
      '+++ b/t.txt',
      '@@ -1 +1 @@',
      '-a',
      `+${longBody}`,
    ].join('\n')
    const runGitFn = async (_cwd: string, args: string[]) => {
      if (args[0] === 'ls-files') return { ok: true as const, stdout: 'u.txt\n' }
      return { ok: true as const, stdout: diffText }
    }
    const buildUntrackedDiffFileFn = async () => {
      throw new Error('should not be called when precheck truncates')
    }

    const diff = await __devBridgeTestHooks.readWorkspaceDiff('/tmp', { maxBytes: 32 * 1024 }, { runGitFn, buildUntrackedDiffFileFn })
    expect(diff.truncated).toBe(true)
    expect(diff.files.length).toBe(1)
    expect(diff.files[0]?.patch).not.toContain('... [file patch truncated]')
  })

  it('marks readWorkspaceDiff truncated when untracked patch append exceeds budget', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'formax-devbridge-untracked-append-'))
    try {
      runGit(dir, ['init'])
      await writeFile(path.join(dir, 'huge-untracked.txt'), `${'x\n'.repeat(40_000)}`, 'utf8')
      const diff = await __devBridgeTestHooks.readWorkspaceDiff(dir, { maxBytes: 32 * 1024 })
      expect(diff.truncated).toBe(true)
      expect(diff.files.length).toBe(1)
      expect(diff.files[0]?.path).toBe('huge-untracked.txt')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('handles helper lookups and clipping for empty outputs', () => {
    const match = __devBridgeTestHooks.findPatchByRequestedPath(
      [{ path: 'a/b.ts', additions: 1, deletions: 1, patch: 'p' }] as any,
      'b.ts',
    )
    expect(match?.path).toBe('a/b.ts')
    const mismatch = __devBridgeTestHooks.findPatchByRequestedPath(
      [{ path: 'a.ts', additions: 1, deletions: 0, patch: 'p' }] as any,
      'b.ts',
    )
    expect(mismatch).toBeNull()
    expect(__devBridgeTestHooks.findPatchByRequestedPath([], 'x')).toBeNull()

    const clipped = __devBridgeTestHooks.clipDiffFileWithinBudget(
      { path: 'x.ts', additions: 1, deletions: 1, patch: 'x'.repeat(10000) } as any,
      32 * 1024,
    )
    expect(typeof clipped.truncated).toBe('boolean')
    expect(clipped.file.path).toBe('x.ts')

    const emptyOut = __devBridgeTestHooks.clipDiffFileWithinBudget(
      { path: 'x.ts', additions: 1, deletions: 1, patch: 'x' } as any,
      1,
    )
    expect(emptyOut.truncated).toBe(true)
    expect(emptyOut.file.patch).toBe('')
  })
})
