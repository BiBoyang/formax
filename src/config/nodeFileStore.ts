import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { FileMode, FileStore } from '../core/config/fileStore.js'

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath)
    return true
  } catch {
    return false
  }
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true })
}

async function tryChmod(filePath: string, mode: FileMode | undefined): Promise<void> {
  if (mode === undefined) return
  try {
    await fs.chmod(filePath, mode)
  } catch {
    // best-effort (Windows / restricted FS)
  }
}

export function createNodeFileStore(): FileStore {
  const exists: FileStore['exists'] = async (filePath) => pathExists(filePath)

  const readText: FileStore['readText'] = async (filePath) => fs.readFile(filePath, 'utf8')

  const writeTextAtomic: FileStore['writeTextAtomic'] = async (filePath, content, options = {}) => {
    const dir = path.dirname(filePath)
    await ensureDir(dir)

    const tmpName = `.${path.basename(filePath)}.${crypto.randomBytes(8).toString('hex')}.tmp`
    const tmpPath = path.join(dir, tmpName)

    await fs.writeFile(tmpPath, content, 'utf8')
    await tryChmod(tmpPath, options.mode)
    await fs.rename(tmpPath, filePath)
    await tryChmod(filePath, options.mode)
  }

  const writeJsonAtomic: FileStore['writeJsonAtomic'] = async (filePath, value, options = {}) => {
    const pretty = options.pretty ?? true
    const trailingNewline = options.trailingNewline ?? true
    const json = JSON.stringify(value, null, pretty ? 2 : undefined) + (trailingNewline ? '\n' : '')
    await writeTextAtomic(filePath, json, options)
  }

  return { exists, readText, writeTextAtomic, writeJsonAtomic }
}
