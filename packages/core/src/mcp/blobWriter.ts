import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { McpBlobWriter, McpBlobWriteRequest, McpBlobWriteResult } from './types.js'

export function createFileBackedMcpBlobWriter(args: {
  rootDir: string
  sessionId?: string
}): McpBlobWriter {
  const sessionId = sanitizePathSegment(args.sessionId || randomUUID())
  const outputDir = path.join(args.rootDir, 'mcp-output', sessionId)
  let counter = 0

  return {
    async writeBlob(request: McpBlobWriteRequest): Promise<McpBlobWriteResult> {
      await fs.mkdir(outputDir, { recursive: true })
      counter += 1
      const extension = sanitizeExtension(request.suggestedExtension)
      const fileName = `${String(counter).padStart(4, '0')}-${randomUUID()}.${extension}`
      const filePath = path.join(outputDir, fileName)
      await fs.writeFile(filePath, Buffer.from(request.bytes), { mode: 0o600 })
      return { path: filePath }
    },
  }
}

function sanitizePathSegment(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+$/, '_')
  return sanitized || randomUUID()
}

function sanitizeExtension(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
  return sanitized || 'bin'
}
