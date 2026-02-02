import { describe, expect, it } from 'vitest'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
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
})

