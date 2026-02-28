import { describe, expect, it } from 'vitest'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { vi } from 'vitest'
import * as snippetStartLine from '../../../../tools/presenters/snippetStartLine'
import { computeEditPatchStartLineNumber } from './patchStartLineNumber'

describe('computeEditPatchStartLineNumber', () => {
  it('anchors on the new_string snippet (and strips cat -n prefixes)', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-edit-'))
    try {
      const filePath = path.join(tmpDir, 'demo.txt')
      const prefix = Array.from({ length: 21 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
      await fsp.writeFile(filePath, prefix + 'alpha\nbeta\n' + 'tail\n', 'utf8')

      const lineNo = computeEditPatchStartLineNumber({
        cwd: tmpDir,
        input: {
          file_path: filePath,
          old_string: 'alpha\n',
          // Simulate a cat -n style snippet (either tab or arrow).
          new_string: '   22\talpha\n   23\tbeta\n',
        },
      })

      expect(lineNo).toBe(22)
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('resolves relative file paths from cwd', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-edit-'))
    try {
      const relPath = 'demo.txt'
      const filePath = path.join(tmpDir, relPath)
      await fsp.writeFile(filePath, ['line 1', 'alpha', 'line 3'].join('\n'), 'utf8')

      const lineNo = computeEditPatchStartLineNumber({
        cwd: tmpDir,
        input: {
          file_path: relPath,
          old_string: 'alpha',
          new_string: 'alpha',
        },
      })

      expect(lineNo).toBe(2)
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('anchors on space-expanded cat -n prefixes (tabs rendered as spaces)', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-edit-'))
    try {
      const filePath = path.join(tmpDir, 'demo.txt')
      const prefix = Array.from({ length: 21 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
      await fsp.writeFile(filePath, prefix + 'alpha\nbeta\n' + 'tail\n', 'utf8')

      const lineNo = computeEditPatchStartLineNumber({
        cwd: tmpDir,
        input: {
          file_path: filePath,
          old_string: 'alpha\n',
          // Like `cat -n`, but the tab after the number has been expanded to spaces by a UI/copy step.
          new_string: '   22  alpha\n   23  beta\n',
        },
      })

      expect(lineNo).toBe(22)
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('anchors on single-space cat -n prefixes (after copy/paste)', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-edit-'))
    try {
      const filePath = path.join(tmpDir, 'demo.txt')
      const prefix = Array.from({ length: 21 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
      await fsp.writeFile(filePath, prefix + 'alpha\nbeta\n' + 'tail\n', 'utf8')

      const lineNo = computeEditPatchStartLineNumber({
        cwd: tmpDir,
        input: {
          file_path: filePath,
          old_string: 'alpha\n',
          // Some terminals/copy steps collapse the delimiter to a single space.
          new_string: '22 alpha\n23 beta\n',
        },
      })

      expect(lineNo).toBe(22)
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('falls back to old_string when new_string snippet cannot be found', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-edit-'))
    try {
      const filePath = path.join(tmpDir, 'demo.txt')
      const prefix = Array.from({ length: 21 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
      await fsp.writeFile(filePath, prefix + 'alpha\nbeta\n' + 'tail\n', 'utf8')

      // Simulate: new_string includes content that isn't present verbatim, but old_string exists.
      const lineNo = computeEditPatchStartLineNumber({
        cwd: tmpDir,
        input: {
          file_path: filePath,
          old_string: 'alpha\n',
          new_string: 'alpha\nBETA\n',
        },
      })

      expect(lineNo).toBe(22)
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('anchors appends near end of file (SOFTWARE + added line)', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-edit-'))
    try {
      const filePath = path.join(tmpDir, 'LICENSE')
      const prefix = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
      await fsp.writeFile(filePath, prefix + 'SOFTWARE.\nhello world\n', 'utf8')

      const lineNo = computeEditPatchStartLineNumber({
        cwd: tmpDir,
        input: {
          file_path: filePath,
          old_string: 'SOFTWARE.\n',
          new_string: 'SOFTWARE.\nhello world\n',
        },
      })

      expect(lineNo).toBe(21)
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('falls back to containing-line match when snippet line is partial', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-edit-'))
    try {
      const filePath = path.join(tmpDir, 'demo.txt')
      await fsp.writeFile(
        filePath,
        [
          'line 1',
          'to use, copy, modify, merge, publish, distribute, sublicense, and/or sell',
          'line 3',
        ].join('\n'),
        'utf8',
      )

      const lineNo = computeEditPatchStartLineNumber({
        cwd: tmpDir,
        input: {
          file_path: filePath,
          old_string: 'use, copy, modify, merge, publish, distribute',
          new_string: 'use, copy, modify, merge, publish, distribute, sublicense, and/or sell',
        },
      })

      expect(lineNo).toBe(2)
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('does not anchor to unrelated short lines when partial line is not contained', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-edit-'))
    try {
      const filePath = path.join(tmpDir, 'demo.txt')
      await fsp.writeFile(
        filePath,
        [
          'const',
          'let value = 1',
          'target payload string',
        ].join('\n'),
        'utf8',
      )

      const lineNo = computeEditPatchStartLineNumber({
        cwd: tmpDir,
        input: {
          file_path: filePath,
          old_string: 'const target payload string with extra context',
          new_string: 'const target payload string with extra context updated',
        },
      })

      expect(lineNo).toBeNull()
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('returns null when file cannot be read', () => {
    const lineNo = computeEditPatchStartLineNumber({
      cwd: '/tmp',
      input: {
        file_path: '/tmp/formax-this-file-does-not-exist.txt',
        old_string: 'alpha',
        new_string: 'alpha',
      },
    })

    expect(lineNo).toBeNull()
  })

  it('returns null when no file path is provided', () => {
    const lineNo = computeEditPatchStartLineNumber({
      cwd: '/tmp',
      input: {
        old_string: 'alpha',
        new_string: 'alpha',
      },
    })
    expect(lineNo).toBeNull()
  })

  it('returns null when input is nullish', () => {
    const lineNo = computeEditPatchStartLineNumber({
      cwd: '/tmp',
      input: null,
    })
    expect(lineNo).toBeNull()
  })

  it('returns null when both snippets are empty after normalization', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-edit-'))
    try {
      const filePath = path.join(tmpDir, 'demo.txt')
      await fsp.writeFile(filePath, 'alpha\n', 'utf8')
      const lineNo = computeEditPatchStartLineNumber({
        cwd: tmpDir,
        input: {
          file_path: filePath,
          old_string: '   ',
          new_string: '   ',
        },
      })
      expect(lineNo).toBeNull()
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('returns null for non-file paths and oversized files', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-edit-'))
    try {
      const dirPath = path.join(tmpDir, 'dir')
      await fsp.mkdir(dirPath)
      const dirResult = computeEditPatchStartLineNumber({
        cwd: tmpDir,
        input: {
          file_path: dirPath,
          old_string: 'alpha',
          new_string: 'alpha',
        },
      })
      expect(dirResult).toBeNull()

      const largeFile = path.join(tmpDir, 'large.txt')
      await fsp.writeFile(largeFile, 'x'.repeat(600 * 1024), 'utf8')
      const largeResult = computeEditPatchStartLineNumber({
        cwd: tmpDir,
        input: {
          file_path: largeFile,
          old_string: 'alpha',
          new_string: 'alpha',
        },
      })
      expect(largeResult).toBeNull()
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('falls back to first new snippet line when full new snippet does not match', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-edit-'))
    try {
      const filePath = path.join(tmpDir, 'demo.txt')
      await fsp.writeFile(filePath, ['line 1', 'alpha', 'line 3'].join('\n'), 'utf8')
      const findSpy = vi.spyOn(snippetStartLine, 'findSnippetStartLineNumber')
      findSpy.mockReturnValueOnce(null).mockReturnValueOnce(2)

      const lineNo = computeEditPatchStartLineNumber({
        cwd: tmpDir,
        input: {
          file_path: filePath,
          old_string: '',
          new_string: 'alpha\nbeta',
        },
      })

      expect(lineNo).toBe(2)
      findSpy.mockRestore()
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('returns null when first new snippet line is too short for containing-line fallback', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-edit-'))
    try {
      const filePath = path.join(tmpDir, 'demo.txt')
      await fsp.writeFile(filePath, ['   ', 'abc', 'line 3'].join('\n'), 'utf8')
      const findSpy = vi.spyOn(snippetStartLine, 'findSnippetStartLineNumber')
      findSpy.mockReturnValue(null)

      const lineNo = computeEditPatchStartLineNumber({
        cwd: tmpDir,
        input: {
          file_path: filePath,
          old_string: '',
          new_string: 'abc',
        },
      })

      expect(lineNo).toBeNull()
      findSpy.mockRestore()
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('falls back to containing old snippet line when old snippet does not match exactly', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-edit-'))
    try {
      const filePath = path.join(tmpDir, 'demo.txt')
      await fsp.writeFile(
        filePath,
        ['line 1', 'alpha beta gamma delta', 'line 3'].join('\n'),
        'utf8',
      )
      const findSpy = vi.spyOn(snippetStartLine, 'findSnippetStartLineNumber')
      findSpy.mockReturnValue(null)

      const lineNo = computeEditPatchStartLineNumber({
        cwd: tmpDir,
        input: {
          file_path: filePath,
          old_string: 'beta gamma delta',
          new_string: '',
        },
      })

      expect(lineNo).toBe(2)
      findSpy.mockRestore()
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('falls back to first old snippet line when full old snippet does not match', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-edit-'))
    try {
      const filePath = path.join(tmpDir, 'demo.txt')
      await fsp.writeFile(filePath, ['line 1', 'target old line', 'line 3'].join('\n'), 'utf8')
      const findSpy = vi.spyOn(snippetStartLine, 'findSnippetStartLineNumber')
      // old full snippet -> null, old first line -> 2
      findSpy.mockReturnValueOnce(null).mockReturnValueOnce(2)

      const lineNo = computeEditPatchStartLineNumber({
        cwd: tmpDir,
        input: {
          file_path: filePath,
          old_string: 'target old line\nmissing',
          new_string: '',
        },
      })

      expect(lineNo).toBe(2)
      findSpy.mockRestore()
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('returns oldStart directly when old snippet matches in full', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-edit-'))
    try {
      const filePath = path.join(tmpDir, 'demo.txt')
      await fsp.writeFile(filePath, ['line 1', 'exact old snippet', 'line 3'].join('\n'), 'utf8')

      const lineNo = computeEditPatchStartLineNumber({
        cwd: tmpDir,
        input: {
          file_path: filePath,
          old_string: 'exact old snippet',
          new_string: '',
        },
      })

      expect(lineNo).toBe(2)
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('checks containing-line fallback across blank file lines', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-edit-'))
    try {
      const filePath = path.join(tmpDir, 'demo.txt')
      await fsp.writeFile(filePath, ['   ', 'alpha beta gamma delta epsilon', ''].join('\n'), 'utf8')
      const findSpy = vi.spyOn(snippetStartLine, 'findSnippetStartLineNumber')
      findSpy.mockReturnValue(null)

      const lineNo = computeEditPatchStartLineNumber({
        cwd: tmpDir,
        input: {
          file_path: filePath,
          old_string: '',
          new_string: 'beta gamma delta epsilon zeta',
        },
      })

      expect(lineNo).toBeNull()
      findSpy.mockRestore()
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('uses containing-line fallback when snippet finder cannot match', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-edit-'))
    try {
      const filePath = path.join(tmpDir, 'demo.txt')
      await fsp.writeFile(filePath, ['   ', 'prefix beta gamma delta epsilon suffix'].join('\n'), 'utf8')
      const findSpy = vi.spyOn(snippetStartLine, 'findSnippetStartLineNumber')
      findSpy.mockReturnValue(null)

      const lineNo = computeEditPatchStartLineNumber({
        cwd: tmpDir,
        input: {
          file_path: filePath,
          old_string: '',
          new_string: 'beta gamma delta epsilon',
        },
      })

      expect(lineNo).toBe(2)
      findSpy.mockRestore()
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })
})
