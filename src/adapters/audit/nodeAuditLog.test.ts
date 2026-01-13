import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createNodeAuditLog } from './nodeAuditLog.js'

describe('createNodeAuditLog', () => {
  it('writes NDJSON and redacts secrets', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-audit-'))
    try {
      const audit = createNodeAuditLog({ logsDir: dir })

      await audit.append({
        schemaVersion: 1,
        ts: new Date().toISOString(),
        kind: 'tool.start',
        agentDepth: 0,
        tool: { name: 'Bash', toolUseId: 'tool-1' },
      })

      await audit.append({
        schemaVersion: 1,
        ts: new Date().toISOString(),
        kind: 'approval.result',
        agentDepth: 0,
        tool: { name: 'Write', toolUseId: 'tool-2' },
        action: { kind: 'fs.write', path: '/tmp/x' },
        outcome: 'approve_remember',
        scope: `sk-secret-123`,
      })

      const raw = await fs.readFile(path.join(dir, 'audit.ndjson'), 'utf8')
      expect(raw.split('\n').filter(Boolean).length).toBe(2)
      expect(raw).toContain('sk-<redacted>')
      expect(raw).not.toContain('sk-secret-123')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
