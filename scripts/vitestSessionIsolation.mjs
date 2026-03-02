import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const VITEST_SESSION_ROOTS_DIR = path.join(os.tmpdir(), 'formax-vitest-session-config-roots')
const VITEST_SESSION_LEDGER_PATH = path.join(os.tmpdir(), 'formax-vitest-session-roots.jsonl')

function setupVitestSessionIsolation() {
  fs.mkdirSync(VITEST_SESSION_ROOTS_DIR, { recursive: true })

  const workerId = process.env.VITEST_WORKER_ID ?? process.env.VITEST_POOL_ID ?? null
  const workerPrefix = workerId ? `worker-${workerId}-` : 'worker-'
  const workerRoot = fs.mkdtempSync(path.join(VITEST_SESSION_ROOTS_DIR, workerPrefix))

  process.env.FORMAX_VITEST_SESSION_CONFIG_DIR = workerRoot

  const ledgerRecord = {
    ts: new Date().toISOString(),
    root: workerRoot,
    pid: process.pid,
    ppid: process.ppid,
    cwd: process.cwd(),
    vitestWorkerId: workerId,
  }
  fs.appendFileSync(VITEST_SESSION_LEDGER_PATH, `${JSON.stringify(ledgerRecord)}\n`, 'utf8')
}

setupVitestSessionIsolation()
