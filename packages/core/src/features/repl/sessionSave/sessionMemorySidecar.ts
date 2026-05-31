import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const SESSION_MEMORY_FILE_SUFFIX = '.memory.json'

export function getSessionMemoryFilePath(sessionFilePath: string): string {
  const trimmed = String(sessionFilePath || '').trim()
  if (!trimmed) throw new Error('session memory sidecar requires a non-empty session file path')
  if (trimmed.endsWith('.jsonl')) return `${trimmed.slice(0, -'.jsonl'.length)}${SESSION_MEMORY_FILE_SUFFIX}`
  return `${trimmed}${SESSION_MEMORY_FILE_SUFFIX}`
}

export async function writeSessionMemoryFile(args: {
  sessionFilePath: string
  draft: unknown
}): Promise<string> {
  const targetPath = getSessionMemoryFilePath(args.sessionFilePath)
  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  await fs.writeFile(tempPath, `${JSON.stringify(args.draft, null, 2)}\n`, 'utf8')
  await fs.rename(tempPath, targetPath)
  return targetPath
}

export async function readSessionMemoryFile(sessionFilePath: string): Promise<unknown | null> {
  try {
    const raw = await fs.readFile(getSessionMemoryFilePath(sessionFilePath), 'utf8')
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}
