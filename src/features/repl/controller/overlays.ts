import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatEngine } from '../../../chat/engine'
import type { Msg } from '../../../components/tool/ToolMessage'
import { createAgentFromWizardAnswers, generateAgentDraftWithClaude } from '../../../subagents/agentsWizard'
import type {
  AgentsDialogGenerateDraft,
  AgentsDialogSaveArgs,
  AgentsDialogSaveResult,
} from '../../../ui/agents/AgentsDialog.js'
import type { OverlaySpec } from '../../commands/contracts'
import { createOverlayManager } from '../overlays/OverlayManager'

export function useReplOverlays(args: {
  engine: ChatEngine
  projectAgentsDir: string
  reloadSubagents?: () => Promise<Array<{ name: string; description: string }>>
  setAllowedSubagents: (next: Array<{ name: string; description: string }>) => void
  setMessages: (updater: (prev: Msg[]) => Msg[]) => void
  initialOverlay: OverlaySpec | null
}): {
  overlay: OverlaySpec | null
  openOverlay: (spec: OverlaySpec) => void
  closeOverlay: () => void
  closeAgentsDialog: (args: { createdAgents: string[] }) => void
  closePermissionsDialog: () => void
  closeHooksDialog: () => void
  generateAgentDraft: (description: string, signal?: AbortSignal) => Promise<AgentsDialogGenerateDraft>
  saveAgentFromDialog: (args: AgentsDialogSaveArgs) => Promise<AgentsDialogSaveResult>
} {
  const { engine, projectAgentsDir, reloadSubagents, setAllowedSubagents, setMessages } = args
  const overlayManagerRef = useRef(createOverlayManager(args.initialOverlay))
  const [overlay, setOverlay] = useState(overlayManagerRef.current.current())

  useEffect(() => overlayManagerRef.current.subscribe(setOverlay), [])

  const openOverlay = useCallback((spec: OverlaySpec) => overlayManagerRef.current.open(spec), [])
  const closeOverlay = useCallback(() => overlayManagerRef.current.close(), [])

  const closeAgentsDialog = useCallback(
    ({ createdAgents }: { createdAgents: string[] }) => {
      overlayManagerRef.current.close()
      const lines =
        createdAgents.length === 0
          ? ['Agents dialog dismissed']
          : ['Agent changes:', ...createdAgents.map((a) => `Created agent: ${a}`)]
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: lines.map((l) => `  ⎿  ${l}`).join('\n'),
          timestamp: new Date(),
        },
      ])
    },
    [setMessages],
  )

  const closePermissionsDialog = useCallback(() => {
    overlayManagerRef.current.close()
    setMessages((prev) => [
      ...prev,
      {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: '  ⎿  Permissions dialog dismissed',
        timestamp: new Date(),
      },
    ])
  }, [setMessages])

  const closeHooksDialog = useCallback(() => {
    overlayManagerRef.current.close()
    setMessages((prev) => [
      ...prev,
      {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: '  ⎿  Hooks dialog dismissed',
        timestamp: new Date(),
      },
    ])
  }, [setMessages])

  const generateAgentDraft = useCallback(
    async (description: string, signal?: AbortSignal): Promise<AgentsDialogGenerateDraft> => {
      return generateAgentDraftWithClaude({
        engine,
        description,
        cwd: process.cwd(),
        signal,
      })
    },
    [engine],
  )

  const saveAgentFromDialog = useCallback(
    async (saveArgs: AgentsDialogSaveArgs): Promise<AgentsDialogSaveResult> => {
      const out = await createAgentFromWizardAnswers({
        answers: {
          scope:
            saveArgs.scope === 'user'
              ? 'User-level (~/.formax/agents)'
              : 'Project-level (.formax/agents)',
          name: saveArgs.name,
          description: saveArgs.description,
          systemPrompt: saveArgs.systemPrompt,
          tools: saveArgs.tools,
          model: saveArgs.model,
          color: saveArgs.color,
        },
        cwd: process.cwd(),
        projectAgentsDir,
      })

      try {
        const next = await reloadSubagents?.()
        if (next) setAllowedSubagents(next)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setMessages((prev) => [
          ...prev,
          {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: `Note: agent created but reload failed: ${msg}`,
            timestamp: new Date(),
          },
        ])
      }

      if (saveArgs.openInEditor) {
        setMessages((prev) => [
          ...prev,
          {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: `Saved agent: ${out.name} (${out.filePath}). Open this file in your editor to make edits.`,
            timestamp: new Date(),
          },
        ])
      }

      return out
    },
    [projectAgentsDir, reloadSubagents, setAllowedSubagents, setMessages],
  )

  return {
    overlay,
    openOverlay,
    closeOverlay,
    closeAgentsDialog,
    closePermissionsDialog,
    closeHooksDialog,
    generateAgentDraft,
    saveAgentFromDialog,
  }
}
