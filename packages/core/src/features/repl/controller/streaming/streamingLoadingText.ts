import path from 'node:path'

function truncateLabel(text: string, max: number): string {
  const s = text.trim()
  return s.length > max ? s.slice(0, max) + '…' : s
}

function formatBasename(filePathRaw: unknown): string {
  const raw = String(filePathRaw || '').trim()
  if (!raw) return ''
  const normalized = raw.replace(/\\/g, '/')
  return path.basename(normalized)
}

export function resolveLoadingTextForToolStart(toolName: string): string {
  if (toolName === 'AskUserQuestion') return 'Waiting'
  if (toolName === 'Write') return 'Preparing write'
  if (toolName === 'Edit') return 'Preparing edit'
  return 'Working'
}

export function resolveLoadingTextForToolInput(args: {
  toolName: string | undefined
  input: unknown
}): string | null {
  if (args.toolName !== 'Write' && args.toolName !== 'Edit') return null

  const filePathRaw = (args.input as any)?.file_path ?? (args.input as any)?.path
  const fileName = formatBasename(filePathRaw)
  if (!fileName) return null

  const verb = args.toolName === 'Write' ? 'Writing' : 'Editing'
  return `${verb} ${truncateLabel(fileName, 28)}`
}
