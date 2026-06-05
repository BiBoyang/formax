import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFileBackedMcpBlobWriter } from './blobWriter.js'

describe('createFileBackedMcpBlobWriter', () => {
  it('writes blobs under a manager-owned directory and preserves them after runtime cleanup', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-mcp-blob-writer-'))
    try {
      const writer = createFileBackedMcpBlobWriter({
        rootDir: root,
        sessionId: '../unsafe session',
      })

      const written = await writer.writeBlob({
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: 'image/png',
        suggestedExtension: '../png',
      })

      expect(written.path.startsWith(path.join(root, 'mcp-output'))).toBe(true)
      expect(written.path).toContain('unsafe_session')
      expect(written.path.endsWith('.png')).toBe(true)
      await expect(fs.readFile(written.path)).resolves.toEqual(Buffer.from([1, 2, 3]))

      expect(writer.cleanup).toBeUndefined()
      await expect(fs.readFile(written.path)).resolves.toEqual(Buffer.from([1, 2, 3]))
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
