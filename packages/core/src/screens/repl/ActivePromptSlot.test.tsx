import { beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import type { UserInputManager } from '../../tools/runtime/userInputManager'
import type {
  ApprovalPromptDescriptor,
  ExitPlanPromptSnapshot,
  InteractivePromptDescriptor,
} from '../../tools/runtime/interactivePromptDescriptor'

const mocks = vi.hoisted(() => ({
  userInput: null as UserInputManager | null,
  promptProps: null as any,
}))

vi.mock('../../tools/runtime/userInputContext', () => ({
  useUserInputManager: () => mocks.userInput,
}))

vi.mock('../../components/tool/fsReadApprovalPrompt', () => ({
  FsReadApprovalPrompt: (props: any) => {
    mocks.promptProps = { kind: 'fs_read', ...props }
    return <Text>{props.title}</Text>
  },
}))

vi.mock('../../components/tool/bashApprovalPrompt', () => ({
  BashApprovalPrompt: (props: any) => {
    mocks.promptProps = { kind: 'bash', ...props }
    return <Text>{props.title}</Text>
  },
}))

vi.mock('../../components/tool/editApprovalPrompt', () => ({
  EditApprovalPrompt: (props: any) => {
    mocks.promptProps = { kind: 'edit', ...props }
    return <Text>{props.title}</Text>
  },
}))

vi.mock('../../components/tool/fsWriteApprovalPrompt', () => ({
  FsWriteApprovalPrompt: (props: any) => {
    mocks.promptProps = { kind: 'fs_write', ...props }
    return <Text>{props.title}</Text>
  },
}))

vi.mock('../../components/tool/mcpApprovalPrompt', () => ({
  McpApprovalPrompt: (props: any) => {
    mocks.promptProps = { kind: 'mcp', ...props }
    return <Text>{props.title}</Text>
  },
}))

vi.mock('../../components/tool/skillApprovalPrompt', () => ({
  SkillApprovalPrompt: (props: any) => {
    mocks.promptProps = { kind: 'skill', ...props }
    return <Text>{props.title}</Text>
  },
}))

vi.mock('../../components/tool/AskUserQuestionToolBlock', () => ({
  AskUserQuestionToolBlock: (props: any) => {
    mocks.promptProps = { kind: 'ask_user_question', ...props }
    return <Text>AskUserQuestion:{props.toolUseId}</Text>
  },
}))

vi.mock('../../tools/modules/enterPlanMode/presenter', () => ({
  EnterPlanModePrompt: (props: any) => {
    mocks.promptProps = { kind: 'enter_plan_mode', ...props }
    return <Text>EnterPlanMode</Text>
  },
}))

vi.mock('../../tools/modules/exitPlanMode/presenter', () => ({
  ExitPlanModePrompt: (props: any) => {
    mocks.promptProps = { kind: 'exit_plan_mode', ...props }
    const state = props.planContentState?.status || 'none'
    return <Text>ExitPlanMode:{state}:{props.planText}</Text>
  },
}))

import { ActivePromptSlot, resolvePromptVariant } from './ActivePromptSlot'
import { InteractivePromptSurfaceProvider } from '../../components/tool/InteractivePromptSurfaceContext'
import { ToolUiBlocks } from '../../components/tool/ToolUiBlocks'
import { GlobToolPresenter } from '../../tools/modules/glob/presenter'
import type { Msg } from '../../shared/toolMessageTypes'

function createUserInput(descriptor: InteractivePromptDescriptor | null, submitAnswers = vi.fn()): UserInputManager {
  return {
    requestAnswers: vi.fn(async () => ({})),
    submitAnswers,
    reject: vi.fn(() => true),
    rejectAllPending: vi.fn(() => 0),
    isPending: vi.fn((toolUseId: string) => toolUseId === descriptor?.requestEvent.toolUseId),
    clearBufferedAnswers: vi.fn(),
    getPendingToolUseIds: vi.fn(() => (descriptor ? [descriptor.requestEvent.toolUseId] : [])),
    getActivePrompt: vi.fn(() => descriptor),
    subscribe: vi.fn(() => () => {}),
  }
}

function approvalDescriptor(args: {
  toolUseId?: string
  toolName: string
  action: Record<string, unknown>
  ui?: ApprovalPromptDescriptor['ui']
}): ApprovalPromptDescriptor {
  const toolUseId = args.toolUseId ?? 'tool-1'
  return {
    kind: 'approval',
    requestEvent: {
      type: 'approval_request',
      toolUseId,
      toolName: args.toolName,
      action: args.action,
      effectiveDecision: 'ask',
    },
    ...(args.ui ? { ui: args.ui } : {}),
  }
}

function askDescriptor(args: {
  toolUseId: string
  promptVariant: 'ask_user_question' | 'enter_plan_mode' | 'exit_plan_mode'
  promptData?: ExitPlanPromptSnapshot
}): InteractivePromptDescriptor {
  const base = {
    kind: 'ask_user_question' as const,
    requestEvent: {
      type: 'ask_user_question' as const,
      toolUseId: args.toolUseId,
      questions: [{ question: 'Pick?', header: 'Choice', options: [], multiSelect: false }],
    },
    questions: [{ question: 'Pick?', header: 'Choice', options: [], multiSelect: false }],
  }

  if (args.promptVariant === 'exit_plan_mode') {
    if (!args.promptData) throw new Error('exit_plan_mode tests require promptData')
    return {
      ...base,
      ui: { promptVariant: args.promptVariant },
      promptData: args.promptData,
    }
  }

  if (args.promptVariant === 'enter_plan_mode') {
    return {
      ...base,
      ui: { promptVariant: args.promptVariant },
    }
  }

  return {
    ...base,
    ui: { promptVariant: 'ask_user_question' },
  }
}

function globMessage(toolUseId: string, pattern: string, path: string): Msg {
  return {
    id: `tool-${toolUseId}`,
    role: 'tool',
    content: '',
    timestamp: new Date(),
    toolInfo: { name: 'Glob', toolUseId, status: 'running', input: { pattern, path } },
  }
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}

describe('ActivePromptSlot', () => {
  beforeEach(() => {
    mocks.userInput = null
    mocks.promptProps = null
  })

  it('renders nothing when no active descriptor exists', () => {
    mocks.userInput = createUserInput(null)
    const { lastFrame } = render(<ActivePromptSlot />)
    expect(lastFrame()).toBe('')
  })

  it('renders fs read approval and maps decisions to submit answers', () => {
    const submitAnswers = vi.fn()
    mocks.userInput = createUserInput(
      approvalDescriptor({
        toolUseId: 'search-1',
        toolName: 'Glob',
        action: { kind: 'fs.read', path: '/repo' },
        ui: { promptVariant: 'fs_read', title: 'Approve this Search call?', directoryPath: '/repo' },
      }),
      submitAnswers,
    )

    const { lastFrame } = render(<ActivePromptSlot />)
    expect(lastFrame()).toContain('Approve this Search call?')
    expect(mocks.promptProps.kind).toBe('fs_read')
    expect(mocks.promptProps.directoryPath).toBe('/repo')

    mocks.promptProps.onDecision({ kind: 'approve_remember' })
    expect(submitAnswers).toHaveBeenCalledWith('search-1', { decision: 'approve_remember' })
  })

  it('renders bash approval without a visible transcript row', () => {
    const submitAnswers = vi.fn()
    mocks.userInput = createUserInput(
      approvalDescriptor({
        toolUseId: 'bash-1',
        toolName: 'Bash',
        action: { kind: 'bash.exec', command: 'pwd' },
        ui: { promptVariant: 'bash', title: 'Approve running this command?', command: 'pwd', cwd: '/repo' },
      }),
      submitAnswers,
    )

    const { lastFrame } = render(<ActivePromptSlot />)
    expect(lastFrame()).toContain('Approve running this command?')
    expect(mocks.promptProps.kind).toBe('bash')
    expect(mocks.promptProps.command).toBe('pwd')
    expect(mocks.promptProps.cwd).toBe('/repo')

    mocks.promptProps.onDecision({ kind: 'feedback', feedback: 'nope' })
    expect(submitAnswers).toHaveBeenCalledWith('bash-1', { decision: 'feedback', feedback: 'nope' })
  })

  it('renders web approvals through edit-style prompt and preserves scope', () => {
    const submitAnswers = vi.fn()
    mocks.userInput = createUserInput(
      approvalDescriptor({
        toolUseId: 'web-1',
        toolName: 'WebSearch',
        action: { kind: 'net.search', query: 'formax' },
      }),
      submitAnswers,
    )

    const { lastFrame } = render(<ActivePromptSlot />)
    expect(lastFrame()).toContain('Do you want to search for "formax"?')
    expect(mocks.promptProps.kind).toBe('edit')

    mocks.promptProps.onDecision({ kind: 'approve_remember', scope: 'global' })
    expect(submitAnswers).toHaveBeenCalledWith('web-1', { decision: 'approve_remember', scope: 'global' })
  })

  it('renders write, mcp, and skill approvals with existing payload shapes', () => {
    const submitAnswers = vi.fn()
    const view = render(<ActivePromptSlot />)

    mocks.userInput = createUserInput(
      approvalDescriptor({
        toolUseId: 'write-1',
        toolName: 'Write',
        action: { kind: 'fs.write', path: '/repo/file.ts' },
        ui: { promptVariant: 'fs_write', title: 'Approve this Write call?', targetLabel: '/repo/file.ts' },
      }),
      submitAnswers,
    )
    view.rerender(<ActivePromptSlot />)
    expect(view.lastFrame()).toContain('Approve this Write call?')
    expect(mocks.promptProps.kind).toBe('fs_write')
    mocks.promptProps.onDecision({ kind: 'cancel' })
    expect(submitAnswers).toHaveBeenCalledWith('write-1', { decision: 'cancel' })

    mocks.userInput = createUserInput(
      approvalDescriptor({
        toolUseId: 'mcp-1',
        toolName: 'mcp__server__tool',
        action: { kind: 'tool.name', name: 'mcp__server__tool' },
        ui: {
          promptVariant: 'mcp',
          title: 'Approve this mcp__server__tool call?',
          toolLabel: 'mcp__server__tool',
          rememberLabel: "Yes, don't ask again for mcp__server__tool",
        },
      }),
      submitAnswers,
    )
    view.rerender(<ActivePromptSlot />)
    expect(mocks.promptProps.kind).toBe('mcp')
    expect(mocks.promptProps.toolLabel).toBe('mcp__server__tool')
    mocks.promptProps.onDecision({ kind: 'approve' })
    expect(submitAnswers).toHaveBeenCalledWith('mcp-1', { decision: 'approve' })

    mocks.userInput = createUserInput(
      approvalDescriptor({
        toolUseId: 'skill-1',
        toolName: 'Skill',
        action: { kind: 'skill.use', skill: 'planner' },
        ui: {
          promptVariant: 'skill',
          title: 'Use skill planner?',
          rememberLabel: "Yes, and don't ask again for planner in this repo",
        },
      }),
      submitAnswers,
    )
    view.rerender(<ActivePromptSlot />)
    expect(mocks.promptProps.kind).toBe('skill')
    expect(mocks.promptProps.rememberLabel).toBe("Yes, and don't ask again for planner in this repo")
    mocks.promptProps.onDecision({ kind: 'feedback', feedback: 'later' })
    expect(submitAnswers).toHaveBeenCalledWith('skill-1', { decision: 'feedback', feedback: 'later' })
  })

  it('renders ask-user descriptors without depending on transcript rows', () => {
    mocks.userInput = createUserInput(askDescriptor({ toolUseId: 'ask-1', promptVariant: 'ask_user_question' }))

    const { lastFrame } = render(<ActivePromptSlot />)
    expect(lastFrame()).toContain('AskUserQuestion:ask-1')
    expect(mocks.promptProps.questions).toHaveLength(1)
  })

  it('preserves enter and exit plan mode prompt variants', async () => {
    const submitAnswers = vi.fn()
    mocks.userInput = createUserInput(askDescriptor({ toolUseId: 'enter-1', promptVariant: 'enter_plan_mode' }), submitAnswers)

    const view = render(<ActivePromptSlot />)
    expect(view.lastFrame()).toContain('EnterPlanMode')
    mocks.promptProps.onEnter()
    expect(submitAnswers).toHaveBeenCalledWith('enter-1', { choice: 'enter' })

    mocks.userInput = createUserInput(
      askDescriptor({
        toolUseId: 'exit-1',
        promptVariant: 'exit_plan_mode',
        promptData: {
          kind: 'exit_plan_mode',
          planPath: '/tmp/plan.md',
          planContentState: { status: 'loaded', text: 'plan body' },
        },
      }),
      submitAnswers,
    )
    view.rerender(<ActivePromptSlot />)
    expect(view.lastFrame()).toContain('ExitPlanMode:loaded:plan body')
    expect(mocks.promptProps.kind).toBe('exit_plan_mode')
    expect(mocks.promptProps.planContentState).toEqual({ status: 'loaded', text: 'plan body' })
    mocks.promptProps.onManual()
    expect(submitAnswers).toHaveBeenCalledWith('exit-1', { choice: 'manual' })
  })

  it('keeps the active prompt below later transcript tool rows on the bottom-slot surface', () => {
    mocks.userInput = createUserInput(
      approvalDescriptor({
        toolUseId: 'search-1',
        toolName: 'Glob',
        action: { kind: 'fs.read', path: '/repo' },
        ui: { promptVariant: 'fs_read', title: 'Approve this Search call?', directoryPath: '/repo' },
      }),
    )

    const first = globMessage('search-1', '**/.formax/**/*.md', '/Users/david')
    const second = globMessage('search-2', '**/*browser*node*repl*', '/Users/david')
    const view = render(
      <>
        <InteractivePromptSurfaceProvider surface="bottom-slot">
          <ToolUiBlocks blocks={GlobToolPresenter({ message: first }).blocks} />
        </InteractivePromptSurfaceProvider>
        <ActivePromptSlot />
      </>,
    )

    view.rerender(
      <>
        <InteractivePromptSurfaceProvider surface="bottom-slot">
          <ToolUiBlocks blocks={GlobToolPresenter({ message: first }).blocks} />
          <ToolUiBlocks blocks={GlobToolPresenter({ message: second }).blocks} />
        </InteractivePromptSurfaceProvider>
        <ActivePromptSlot />
      </>,
    )

    const frame = stripAnsi(view.lastFrame() ?? '')
    expect(frame.match(/Approve this Search call\?/g)).toHaveLength(1)
    expect(frame.indexOf('pattern: "**/.formax/**/*.md"')).toBeGreaterThanOrEqual(0)
    expect(frame.indexOf('pattern: "**/*browser*node*repl*"')).toBeGreaterThan(frame.indexOf('pattern: "**/.formax/**/*.md"'))
    expect(frame.indexOf('Approve this Search call?')).toBeGreaterThan(frame.indexOf('pattern: "**/*browser*node*repl*"'))
  })
})

describe('resolvePromptVariant', () => {
  it('uses renderer hints before canonical inference', () => {
    expect(
      resolvePromptVariant(
        approvalDescriptor({
          toolName: 'Bash',
          action: { kind: 'bash.exec', command: 'pwd' },
          ui: { promptVariant: 'mcp' },
        }),
      ),
    ).toBe('mcp')
  })

  it('infers variants from canonical request data', () => {
    expect(resolvePromptVariant(approvalDescriptor({ toolName: 'Glob', action: { kind: 'fs.read', path: '/repo' } }))).toBe('fs_read')
    expect(resolvePromptVariant(approvalDescriptor({ toolName: 'Write', action: { kind: 'fs.write', path: '/repo/a' } }))).toBe('fs_write')
    expect(resolvePromptVariant(approvalDescriptor({ toolName: 'Bash', action: { kind: 'bash.exec', command: 'pwd' } }))).toBe('bash')
  })
})
