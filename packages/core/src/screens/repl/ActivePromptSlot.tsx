import React from 'react'
import type {
  InteractivePromptDescriptor,
  InteractivePromptVariant,
} from '../../tools/runtime/interactivePromptDescriptor'
import { useUserInputManager } from '../../tools/runtime/userInputContext'
import { FsReadApprovalPrompt } from '../../components/tool/fsReadApprovalPrompt'
import { BashApprovalPrompt } from '../../components/tool/bashApprovalPrompt'
import { FsWriteApprovalPrompt } from '../../components/tool/fsWriteApprovalPrompt'
import { EditApprovalPrompt } from '../../components/tool/editApprovalPrompt'
import { McpApprovalPrompt } from '../../components/tool/mcpApprovalPrompt'
import { SkillApprovalPrompt } from '../../components/tool/skillApprovalPrompt'
import { AskUserQuestionToolBlock } from '../../components/tool/AskUserQuestionToolBlock'
import { EnterPlanModePrompt } from '../../tools/modules/enterPlanMode/presenter'
import { ExitPlanModePrompt } from '../../tools/modules/exitPlanMode/presenter'

export function ActivePromptSlot(): React.ReactNode {
  const userInput = useUserInputManager()
  const descriptor = userInput?.getActivePrompt?.() ?? null
  if (!userInput || !descriptor) return null

  const toolUseId = descriptor.requestEvent.toolUseId

  if (descriptor.kind === 'ask_user_question') {
    return renderAskPrompt({ descriptor, userInput, toolUseId })
  }

  return renderApprovalPrompt({ descriptor, userInput, toolUseId })
}

export function resolvePromptVariant(descriptor: InteractivePromptDescriptor): InteractivePromptVariant {
  if (descriptor.ui?.promptVariant) return descriptor.ui.promptVariant
  if (descriptor.kind === 'ask_user_question') return 'ask_user_question'

  const toolName = descriptor.requestEvent.toolName
  const action = descriptor.requestEvent.action as { kind?: string } | null | undefined
  if (toolName === 'Bash' || action?.kind === 'bash.exec') return 'bash'
  if (toolName === 'WebSearch' || action?.kind === 'net.search') return 'web_search'
  if (toolName === 'WebFetch' || action?.kind === 'net.fetch') return 'web_fetch'
  if (toolName === 'Skill' || action?.kind === 'skill.use') return 'skill'
  if (String(toolName || '').startsWith('mcp__') || action?.kind === 'tool.name') return 'mcp'
  if (action?.kind === 'fs.read') return 'fs_read'
  if (action?.kind === 'fs.write') return 'fs_write'
  return 'generic_approval'
}

function defaultApprovalTitle(descriptor: Extract<InteractivePromptDescriptor, { kind: 'approval' }>): string {
  const toolName = descriptor.requestEvent.toolName
  const action = descriptor.requestEvent.action as Record<string, unknown> | null | undefined
  if (toolName === 'WebSearch') {
    const query = typeof action?.query === 'string' ? action.query.trim() : ''
    return query ? `Do you want to search for "${query}"?` : 'Do you want to search the web?'
  }
  if (toolName === 'WebFetch') {
    const url = typeof action?.url === 'string' ? action.url.trim() : ''
    return url ? `Do you want to fetch ${url}?` : 'Do you want to fetch this URL?'
  }
  return `Approve this ${toolName} call?`
}

function readActionString(descriptor: Extract<InteractivePromptDescriptor, { kind: 'approval' }>, field: string): string {
  const action = descriptor.requestEvent.action as Record<string, unknown> | null | undefined
  const value = action?.[field]
  return typeof value === 'string' ? value : ''
}

function getExitPlanPromptSnapshot(
  descriptor: Extract<InteractivePromptDescriptor, { kind: 'ask_user_question' }>,
) {
  if (descriptor.ui?.promptVariant !== 'exit_plan_mode') return null
  return 'promptData' in descriptor && descriptor.promptData.kind === 'exit_plan_mode'
    ? descriptor.promptData
    : null
}

function submitApprovalDecision(
  userInput: NonNullable<ReturnType<typeof useUserInputManager>>,
  toolUseId: string,
  decision: { kind: string; feedback?: string; scope?: string },
): void {
  if (decision.kind === 'approve') {
    userInput.submitAnswers(toolUseId, { decision: 'approve' })
    return
  }
  if (decision.kind === 'approve_remember') {
    userInput.submitAnswers(toolUseId, {
      decision: 'approve_remember',
      ...(decision.scope ? { scope: decision.scope } : {}),
    })
    return
  }
  if (decision.kind === 'feedback') {
    userInput.submitAnswers(toolUseId, { decision: 'feedback', feedback: decision.feedback ?? '' })
    return
  }
  userInput.submitAnswers(toolUseId, { decision: 'cancel' })
}

function renderAskPrompt(args: {
  descriptor: Extract<InteractivePromptDescriptor, { kind: 'ask_user_question' }>
  userInput: NonNullable<ReturnType<typeof useUserInputManager>>
  toolUseId: string
}): React.ReactNode {
  const { descriptor, userInput, toolUseId } = args
  const variant = resolvePromptVariant(descriptor)

  if (variant === 'enter_plan_mode') {
    return (
      <EnterPlanModePrompt
        key={toolUseId}
        onEnter={() => userInput.submitAnswers(toolUseId, { choice: 'enter' })}
        onSkip={() => userInput.submitAnswers(toolUseId, { choice: 'skip' })}
      />
    )
  }

  if (variant === 'exit_plan_mode') {
    const promptData = getExitPlanPromptSnapshot(descriptor)
    return (
      <ExitPlanModePrompt
        key={toolUseId}
        planPath={promptData?.planPath ?? null}
        planText={promptData?.planContentState.status === 'loaded' ? promptData.planContentState.text : ''}
        planContentState={promptData?.planContentState}
        onAuto={() => userInput.submitAnswers(toolUseId, { choice: 'auto' })}
        onManual={() => userInput.submitAnswers(toolUseId, { choice: 'manual' })}
        onFeedback={(feedback) => userInput.submitAnswers(toolUseId, { choice: 'feedback', feedback })}
        onCancel={() => userInput.submitAnswers(toolUseId, { choice: 'cancel' })}
      />
    )
  }

  return <AskUserQuestionToolBlock key={toolUseId} toolUseId={toolUseId} questions={descriptor.questions} />
}

function renderApprovalPrompt(args: {
  descriptor: Extract<InteractivePromptDescriptor, { kind: 'approval' }>
  userInput: NonNullable<ReturnType<typeof useUserInputManager>>
  toolUseId: string
}): React.ReactNode {
  const { descriptor, userInput, toolUseId } = args
  const variant = resolvePromptVariant(descriptor)
  const ui = descriptor.ui ?? {}
  const title = ui.title || defaultApprovalTitle(descriptor)
  const onDecision = (decision: { kind: string; feedback?: string; scope?: string }) =>
    submitApprovalDecision(userInput, toolUseId, decision)

  if (variant === 'fs_read') {
    return (
      <FsReadApprovalPrompt
        key={toolUseId}
        title={title}
        directoryPath={ui.directoryPath || ui.targetLabel || process.cwd()}
        onDecision={onDecision}
      />
    )
  }

  if (variant === 'bash') {
    return (
      <BashApprovalPrompt
        key={toolUseId}
        title={title}
        command={ui.command || readActionString(descriptor, 'command')}
        cwd={ui.cwd || process.cwd()}
        onDecision={onDecision}
      />
    )
  }

  if (variant === 'mcp') {
    const toolLabel = ui.toolLabel || ui.targetLabel || descriptor.requestEvent.toolName
    return (
      <McpApprovalPrompt
        key={toolUseId}
        title={title}
        toolLabel={toolLabel}
        rememberLabel={ui.rememberLabel || `Yes, allow ${toolLabel} during this session`}
        onDecision={onDecision}
      />
    )
  }

  if (variant === 'skill') {
    return (
      <SkillApprovalPrompt
        key={toolUseId}
        title={title}
        rememberLabel={ui.rememberLabel || 'Yes, and don\'t ask again for this skill in this repo'}
        onDecision={onDecision}
      />
    )
  }

  if (variant === 'fs_write') {
    return <FsWriteApprovalPrompt key={toolUseId} title={title} onDecision={onDecision} />
  }

  return <EditApprovalPrompt key={toolUseId} title={title} onDecision={onDecision} />
}
