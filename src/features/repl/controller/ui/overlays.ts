import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatEngine } from '../../../../chat/engine'
import type { Msg } from '../../../../shared/toolMessageTypes'
import { createAgentFromWizardAnswers, generateAgentDraftWithClaude } from '../../../../subagents/agentsWizard'
import type {
  AgentsDialogGenerateDraft,
  AgentsDialogSaveArgs,
  AgentsDialogSaveResult,
} from '../../../../tui/agents/AgentsDialog.js'
import type { ConfigDialogExit } from '../../../../tui/config/ConfigDialog.js'
import type { ModelDialogExit } from '../../../../tui/model/ModelDialog.js'
import type { ResumeDialogExit } from '../../../../tui/resume/ResumeDialog.js'
import type { OverlaySpec } from '../../../commands/contracts'
import { createOverlayManager } from '../../overlays/OverlayManager'
import { makeMessageId } from '../shared/ids'

export function useReplOverlays(args: {
  engine: ChatEngine
  model?: string
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
  closeConfigDialog: (exit: ConfigDialogExit) => void
  closeModelDialog: (exit: ModelDialogExit) => void
  closeResumeDialog: (exit?: ResumeDialogExit) => void
  generateAgentDraft: (description: string, signal?: AbortSignal) => Promise<AgentsDialogGenerateDraft>
  saveAgentFromDialog: (args: AgentsDialogSaveArgs) => Promise<AgentsDialogSaveResult>
} {
  const { engine, model, projectAgentsDir, reloadSubagents, setAllowedSubagents, setMessages } = args
  const overlayManagerRef = useRef(createOverlayManager(args.initialOverlay))
  const [overlay, setOverlay] = useState(overlayManagerRef.current.current())

  useEffect(() => {
    return overlayManagerRef.current.subscribe(setOverlay)
  }, [])

  const openOverlay = useCallback((spec: OverlaySpec) => overlayManagerRef.current.open(spec), [])
  const closeOverlay = useCallback(() => overlayManagerRef.current.close(), [])

  const appendCommandSublines = useCallback(
    (lines: string[]) => {
      const now = Date.now()
      const timestamp = new Date()
      setMessages((prev) => [
        ...prev,
        ...lines.map((content, idx) => ({
          id: `assistant-${now}-${idx}`,
          role: 'assistant' as const,
          ui: { kind: 'command_subline' as const },
          content,
          timestamp,
        })),
      ])
    },
    [setMessages],
  )

  const appendResumeDismissedRows = useCallback(() => {
    const timestamp = new Date()
    setMessages((prev) => [
      ...prev,
      {
        id: makeMessageId('user'),
        role: 'user',
        content: '/resume',
        timestamp,
      },
      {
        id: makeMessageId('assistant'),
        role: 'assistant',
        ui: { kind: 'command_subline' as const },
        content: 'Resume cancelled',
        timestamp,
      },
    ])
  }, [setMessages])

  const closeAgentsDialog = useCallback(
    ({ createdAgents }: { createdAgents: string[] }) => {
      overlayManagerRef.current.close()
      const lines =
        createdAgents.length === 0
          ? ['Agents dialog dismissed']
          : ['Agent changes:', ...createdAgents.map((a) => `Created agent: ${a}`)]
      appendCommandSublines(lines)
    },
    [appendCommandSublines],
  )

  const closePermissionsDialog = useCallback(() => {
    overlayManagerRef.current.close()
    appendCommandSublines(['Permissions dialog dismissed'])
  }, [appendCommandSublines])

  const closeHooksDialog = useCallback(() => {
    overlayManagerRef.current.close()
    appendCommandSublines(['Hooks dialog dismissed'])
  }, [appendCommandSublines])

  const closeConfigDialog = useCallback((exit: ConfigDialogExit) => {
    overlayManagerRef.current.close()
    if (exit.kind === 'changed') {
      appendCommandSublines([exit.message])
      return
    }
    appendCommandSublines(['Status dialog dismissed'])
  }, [appendCommandSublines])

  const closeModelDialog = useCallback((exit: ModelDialogExit) => {
    overlayManagerRef.current.close()
    if (exit.kind === 'changed') {
      appendCommandSublines(exit.message.split('\n'))
      return
    }
    appendCommandSublines(['Model selection dismissed'])
  }, [appendCommandSublines])

  const closeResumeDialog = useCallback((exit?: ResumeDialogExit) => {
    overlayManagerRef.current.close()
    if (exit?.kind === 'dismissed') {
      appendResumeDismissedRows()
    }
  }, [appendResumeDismissedRows])

  const generateAgentDraft = useCallback(
    async (description: string, signal?: AbortSignal): Promise<AgentsDialogGenerateDraft> => {
      return generateAgentDraftWithClaude({
        engine,
        description,
        cwd: process.cwd(),
        model,
        signal,
      })
    },
    [engine, model],
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
            id: makeMessageId('assistant'),
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
            id: makeMessageId('assistant'),
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
    closeConfigDialog,
    closeModelDialog,
    closeResumeDialog,
    generateAgentDraft,
    saveAgentFromDialog,
  }
}
