import { listRecentSessions, readSessionPreview, type SessionSummary } from '../repl/sessionSave/reader.js'

export type ResumeSessionSummary = SessionSummary

export type ResumePreviewMessage = {
  role: 'user' | 'assistant'
  text: string
}

export async function listResumeDialogSessions(args: {
  cwd: string
  includeAllProjects?: boolean
  limit?: number
}): Promise<ResumeSessionSummary[]> {
  return listRecentSessions(args)
}

export async function loadResumeDialogPreview(
  filePath: string,
  opts?: { maxMessages?: number },
): Promise<ResumePreviewMessage[]> {
  return readSessionPreview(filePath, opts)
}
