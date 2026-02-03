import fs from 'node:fs'
import path from 'node:path'
import { findSnippetStartLineNumber } from '../../../tools/presenters/snippetStartLine'
import { stripCatNPrefixes } from '../../../utils/catN'

const MAX_FILE_BYTES = 512 * 1024

function resolveAbsPath(cwd: string, rawPath: string): string {
  if (!rawPath) return ''
  if (path.isAbsolute(rawPath)) return rawPath
  return path.resolve(cwd, rawPath)
}

export function computeEditPatchStartLineNumber(args: {
  cwd: string
  input: unknown
}): number | null {
  const input = (args.input || {}) as any
  const rawPath = String(input.file_path || input.path || '')
  const absPath = resolveAbsPath(args.cwd, rawPath)
  if (!absPath) return null

  const oldString = input.old_string
  const newString = input.new_string
  const newSnippet = stripCatNPrefixes(newString)
  const oldSnippet = stripCatNPrefixes(oldString)
  if (!newSnippet.trim() && !oldSnippet.trim()) return null

  try {
    const st = fs.statSync(absPath)
    if (!st.isFile()) return null
    if (st.size > MAX_FILE_BYTES) return null
    const fileText = fs.readFileSync(absPath, 'utf8')

    const newStart = newSnippet.trim() ? findSnippetStartLineNumber({ fileText, snippet: newSnippet }) : null
    if (newStart !== null) return newStart

    // If the full snippet cannot be matched (e.g. model-provided snippet is partial),
    // fall back to anchoring on its first non-empty line to avoid inventing line numbers.
    if (newSnippet.trim()) {
      const firstNewLine = newSnippet
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .split('\n')
        .find((l) => l.trim().length > 0)
      if (firstNewLine) {
        const lineStart = findSnippetStartLineNumber({ fileText, snippet: firstNewLine })
        if (lineStart !== null) return lineStart
      }
    }

    const oldStart = oldSnippet.trim() ? findSnippetStartLineNumber({ fileText, snippet: oldSnippet }) : null
    if (oldStart !== null) return oldStart

    if (oldSnippet.trim()) {
      const firstOldLine = oldSnippet
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .split('\n')
        .find((l) => l.trim().length > 0)
      if (firstOldLine) {
        const lineStart = findSnippetStartLineNumber({ fileText, snippet: firstOldLine })
        if (lineStart !== null) return lineStart
      }
    }

    return null
  } catch {
    return null
  }
}
