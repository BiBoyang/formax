import { constants as fsConstants } from 'node:fs'
import fs from 'node:fs/promises'

export async function checkWritableDir(dirPath: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const dir = String(dirPath || '').trim()
  if (!dir) return { ok: false, error: 'Missing directory path' }

  try {
    await fs.mkdir(dir, { recursive: true })
    await fs.access(dir, fsConstants.W_OK)
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}

