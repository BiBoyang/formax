import fs from 'node:fs'
import path from 'node:path'
import { findSnippetStartLineNumber } from '../../../tools/presenters/snippetStartLine'

const MAX_FILE_BYTES = 512 * 1024

function stripCatNPrefixesForSearch(text: unknown): string {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\d+(?:\t|→)/, ''))
    .join('\n')
}

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
  const snippet = stripCatNPrefixesForSearch(newString) || stripCatNPrefixesForSearch(oldString)
  if (!snippet.trim()) return null

  try {
    const st = fs.statSync(absPath)
    if (!st.isFile()) return null
    if (st.size > MAX_FILE_BYTES) return null
    const fileText = fs.readFileSync(absPath, 'utf8')
    return findSnippetStartLineNumber({ fileText, snippet })
  } catch {
    return null
  }
}

