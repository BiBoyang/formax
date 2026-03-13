import fs from 'node:fs'
import path from 'node:path'

const readFiles = new Set<string>()

export function markFileRead(filePath: string): void {
  const normalized = normalizePath(filePath)
  if (!normalized) return
  readFiles.add(normalized)
}

export function hasReadFile(filePath: string): boolean {
  const normalized = normalizePath(filePath)
  if (!normalized) return false
  return readFiles.has(normalized)
}

export function clearReadLedger(): void {
  readFiles.clear()
}

function normalizePath(filePath: string): string {
  const raw = String(filePath || '').trim()
  if (!raw) return ''

  try {
    if (fs.existsSync(raw)) {
      // Prefer native realpath when available for performance.
      const realpathNative = (fs.realpathSync as any).native
      return typeof realpathNative === 'function' ? realpathNative(raw) : fs.realpathSync(raw)
    }
  } catch {
    // fall back to path.normalize below
  }

  return path.normalize(raw)
}

