import React from 'react'
import {
  AgentsDialogImpl,
  type AgentsDialogGenerateDraft,
  type AgentsDialogSaveArgs,
  type AgentsDialogSaveResult,
} from './AgentsDialogImpl.js'
import type { AgentListItem } from './constants.js'

export type { AgentsDialogGenerateDraft, AgentsDialogSaveArgs, AgentsDialogSaveResult }

export function AgentsDialog(props: {
  agents: AgentListItem[]
  toolNames: string[]
  userAgentsDir: string
  projectAgentsDir: string
  onGenerateDraft: (description: string, signal?: AbortSignal) => Promise<AgentsDialogGenerateDraft>
  onSaveAgent: (args: AgentsDialogSaveArgs) => Promise<AgentsDialogSaveResult>
  onExit: (args: { createdAgents: string[] }) => void
}): React.ReactNode {
  return <AgentsDialogImpl {...props} />
}
