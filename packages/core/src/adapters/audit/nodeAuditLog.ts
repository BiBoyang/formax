import fs from 'node:fs/promises'
import path from 'node:path'
import type { AuditLog } from './auditLog.js'
import type { AuditEventV1 } from '../../core/audit/schema.js'
import { redactTextSecrets } from '../../core/diagnostics/redaction.js'

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true })
}

async function tryChmod(filePath: string, mode: number): Promise<void> {
  try {
    await fs.chmod(filePath, mode)
  } catch {
    // best-effort (Windows / restricted FS)
  }
}

export function createNodeAuditLog(args: {
  logsDir: string
  fileName?: string
}): AuditLog {
  const fileName = args.fileName ?? 'audit.ndjson'
  const targetPath = path.join(args.logsDir, fileName)

  let chain = Promise.resolve()

  const append: AuditLog['append'] = async (event: AuditEventV1) => {
    const line = redactTextSecrets(JSON.stringify(event)) + '\n'

    chain = chain.then(async () => {
      try {
        await ensureDir(path.dirname(targetPath))
        const handle = await fs.open(targetPath, 'a', 0o600)
        try {
          await handle.writeFile(line, 'utf8')
        } finally {
          await handle.close()
        }
        await tryChmod(targetPath, 0o600)
      } catch {
        // Audit logging is best-effort; never block the main flow.
      }
    })

    await chain
  }

  return { append }
}

