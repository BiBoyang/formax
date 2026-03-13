export type ConfigDialogExit =
  | { kind: 'dismissed' }
  | { kind: 'changed'; message: string }

export type ModelDialogExit =
  | { kind: 'dismissed' }
  | { kind: 'changed'; message: string }

export type ResumeDialogExit = { kind: 'dismissed' }

export type AgentsDialogGenerateDraft = {
  name: string
  description: string
  systemPrompt: string
}

export type AgentsDialogSaveArgs = {
  scope: 'project' | 'user'
  name: string
  description: string
  systemPrompt: string
  tools: string
  model: string
  color: string
  openInEditor: boolean
}

export type AgentsDialogSaveResult = { name: string; filePath: string }
