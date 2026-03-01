import { normalizePathForCompare } from '../../shared/utils/paths.js'

export type FsWriteToolName = 'Write' | 'Edit' | 'NotebookEdit'

export function isFsWriteToolName(raw: string): raw is FsWriteToolName {
  return raw === 'Write' || raw === 'Edit' || raw === 'NotebookEdit'
}

export function buildToolPermissionKey(toolName: string, inner: string): string {
  const tool = String(toolName || '').trim()
  const value = String(inner || '').trim()
  return `${tool}(${value})`
}

export function buildFsWritePermissionKey(args: {
  toolName: FsWriteToolName
  filePath: string
  cwd: string
}): string {
  const normalized = normalizePathForCompare(args.filePath, args.cwd)
  return buildToolPermissionKey(args.toolName, normalized)
}
