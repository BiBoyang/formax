import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { WriteToolPresenter } from './presenter'
import type { Msg } from '../../../components/tool/ToolMessage'
import { UserInputProvider } from '../../runtime/userInputContext'
import { createUserInputManager } from '../../runtime/userInputManager'
import { PlanProvider } from '../../../features/repl/planContext'
import { ToolUiBlocks } from '../../../components/tool/ToolUiBlocks'
import { isToolBlocksPresenter } from '../../../shared/toolPresenterContracts'

// Helper to render blocks presenter
function renderBlocksPresenter(presenter: typeof WriteToolPresenter, message: Msg) {
  if (isToolBlocksPresenter(presenter)) {
    const out = presenter({ message })
    return render(<ToolUiBlocks blocks={out.blocks} />)
  }
  return render(<>{presenter({ message })}</>)
}

describe('WriteToolPresenter', () => {
  it('renders unknown header when toolInfo is missing', () => {
    const message: Msg = {
      id: 'tool-unknown',
      role: 'tool',
      content: '',
      timestamp: new Date(),
    }
    const { lastFrame } = renderBlocksPresenter(WriteToolPresenter, message)
    expect(lastFrame()).toContain('Unknown tool')
  })

  it('does not render a partial header while tool input is still streaming', () => {
    const message: Msg = {
      id: 'tool-write',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        toolUseId: 't-write',
        name: 'Write',
        status: 'running',
        input: {},
      },
    }

    if (!isToolBlocksPresenter(WriteToolPresenter)) {
      throw new Error('WriteToolPresenter expected to be a blocks presenter')
    }

    const { lastFrame } = render(<ToolUiBlocks blocks={WriteToolPresenter({ message }).blocks} />)
    const frame = lastFrame() || ''
    expect(frame).not.toContain('Write')
  })

  it('renders a write approval prompt while a write call is pending user input', () => {
    const userInput = createUserInputManager()
    void userInput.requestAnswers({ toolUseId: 't-write', questions: [] })

    const message: Msg = {
      id: 'tool-write',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        toolUseId: 't-write',
        name: 'Write',
        status: 'running',
        input: {
          file_path: '/tmp/new.txt',
          content: 'line1\n\nline3',
        },
      },
    }

    if (!isToolBlocksPresenter(WriteToolPresenter)) {
      throw new Error('WriteToolPresenter expected to be a blocks presenter')
    }

    const { lastFrame } = render(
      <UserInputProvider userInput={userInput}>
        <ToolUiBlocks blocks={WriteToolPresenter({ message }).blocks} />
      </UserInputProvider>,
    )

    const frame = lastFrame()
    expect(frame).toContain('Write')
    expect(frame).toContain('new.txt')
    expect(frame).toContain('Create file')
    expect(frame).toContain('Do you want to create new.txt?')
    expect(frame).toContain('line1')
    expect(frame).toContain('line3')

    // Only one "standalone" separator line (the approval header). Preview box borders should not count.
    const ansi = /\u001B\[[0-9;]*m/g
    const standaloneSeparators = frame
      .split('\n')
      .map((l) => l.replace(ansi, '').trim())
      .filter((l) => /^─{20,}$/.test(l))
    expect(standaloneSeparators).toHaveLength(1)
  })

  it('renders an Updated plan message when writing the active plan file', () => {
    const planPath = '/tmp/plan.md'
    const planSession = {
      getPlanPath: () => planPath,
      startNewPlan: () => planPath,
    }

    const message: Msg = {
      id: 'tool-plan',
      role: 'tool',
      content: 'wrote plan',
      timestamp: new Date(),
      toolInfo: {
        name: 'Write',
        status: 'completed',
        input: { file_path: planPath, content: '# plan' },
      },
    }

    if (!isToolBlocksPresenter(WriteToolPresenter)) {
      throw new Error('WriteToolPresenter expected to be a blocks presenter')
    }

    const { lastFrame } = render(
      <PlanProvider planSession={planSession}>
        <ToolUiBlocks blocks={WriteToolPresenter({ message }).blocks} />
      </PlanProvider>,
    )

    const frame = lastFrame()
    expect(frame).toContain('Updated plan')
    expect(frame).toContain('/plan to preview')
    expect(frame).not.toContain('Write(')
  })

  it('renders completed non-plan write details with middle/expand lines', () => {
    const message: Msg = {
      id: 'tool-write-completed',
      role: 'tool',
      content: 'Wrote 2 lines',
      timestamp: new Date(),
      toolInfo: {
        name: 'Write',
        status: 'completed',
        input: { file_path: '/tmp/out.txt', content: 'a\nb' },
        middleLines: ['line-1', 'line-2'],
        expandInfo: 'extra details',
      },
    }
    const { lastFrame } = renderBlocksPresenter(WriteToolPresenter, message)
    const frame = lastFrame()
    expect(frame).toContain('Wrote 2 lines')
    expect(frame).toContain('line-1')
    expect(frame).toContain('line-2')
    expect(frame).toContain('extra details')
  })

  it('renders plan-file error state', () => {
    const planPath = '/tmp/plan-error.md'
    const planSession = {
      getPlanPath: () => planPath,
      startNewPlan: () => planPath,
    }
    const message: Msg = {
      id: 'tool-plan-error',
      role: 'tool',
      content: 'Error: cannot write plan',
      timestamp: new Date(),
      toolInfo: {
        name: 'Write',
        status: 'error',
        input: { file_path: planPath, content: '# plan' },
      },
    }
    const { lastFrame } = render(
      <PlanProvider planSession={planSession}>
        <ToolUiBlocks blocks={(WriteToolPresenter as any)({ message }).blocks} />
      </PlanProvider>,
    )
    const frame = lastFrame()
    expect(frame).toContain('Updated plan')
    expect(frame).toContain('Error: cannot write plan')
  })

  it('renders non-plan error compact details', () => {
    const message: Msg = {
      id: 'tool-write-error',
      role: 'tool',
      content: 'Error: denied',
      timestamp: new Date(),
      toolInfo: {
        name: 'Write',
        status: 'error',
        input: { file_path: '/tmp/private.txt', content: 'x' },
        middleLines: ['Path: /tmp/private.txt', 'Path (absolute): /tmp/private.txt'],
        expandInfo: 'Workspace roots: /tmp',
      },
    }
    const { lastFrame } = renderBlocksPresenter(WriteToolPresenter, message)
    const frame = lastFrame()
    expect(frame).toContain('Error: denied')
    expect(frame).toContain('Path: /tmp/private.txt')
    expect(frame).not.toContain('Path (absolute):')
  })

  it('supports path input key and runtime content fallback', () => {
    const userInput = createUserInputManager()
    void userInput.requestAnswers({ toolUseId: 'runtime-id', questions: [] })

    const message: Msg = {
      id: 'runtime-id',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'Write',
        status: 'running',
        input: {
          path: '/tmp/runtime-path.txt',
          content: 123 as any,
        } as any,
      },
    }
    const { lastFrame } = render(
      <UserInputProvider userInput={userInput}>
        <ToolUiBlocks blocks={(WriteToolPresenter as any)({ message }).blocks} />
      </UserInputProvider>,
    )
    const frame = lastFrame()
    expect(frame).toContain('runtime-path.txt')
    expect(frame).toContain('Create file')
  })

  it('shows transient/static debug suffix when FORMAX_HOOKS_DEBUG is enabled', () => {
    const prev = process.env.FORMAX_HOOKS_DEBUG
    process.env.FORMAX_HOOKS_DEBUG = 'true'
    try {
      const transientMsg: Msg = {
        id: 'tool-transient-1234',
        role: 'tool',
        content: 'done',
        timestamp: new Date(),
        surfaceHint: 'transient',
        toolInfo: {
          name: 'Write',
          status: 'completed',
          input: { file_path: '/tmp/t.txt', content: 'a' },
        },
      }
      const staticMsg: Msg = {
        id: 'custom-static-id',
        role: 'tool',
        content: 'done',
        timestamp: new Date(),
        surfaceOwner: 'static',
        toolInfo: {
          toolUseId: 'tooluse-9999',
          name: 'Write',
          status: 'completed',
          input: { file_path: '/tmp/s.txt', content: 'b' },
        },
      }
      const tFrame = renderBlocksPresenter(WriteToolPresenter, transientMsg).lastFrame()
      const sFrame = renderBlocksPresenter(WriteToolPresenter, staticMsg).lastFrame()
      expect(tFrame).toContain('trans#')
      expect(sFrame).toContain('static#')
    } finally {
      if (prev === undefined) {
        delete process.env.FORMAX_HOOKS_DEBUG
      } else {
        process.env.FORMAX_HOOKS_DEBUG = prev
      }
    }
  })

  it('handles debug suffix when message id/toolUseId are empty', () => {
    const prev = process.env.FORMAX_HOOKS_DEBUG
    process.env.FORMAX_HOOKS_DEBUG = 'yes'
    try {
      const message: Msg = {
        id: '',
        role: 'tool',
        content: '',
        timestamp: new Date(),
        surfaceHint: 'transient',
        toolInfo: {
          name: 'Write',
          status: 'completed',
          input: {},
        },
      }
      const frame = renderBlocksPresenter(WriteToolPresenter, message).lastFrame()
      expect(frame).toContain('trans')
    } finally {
      if (prev === undefined) delete process.env.FORMAX_HOOKS_DEBUG
      else process.env.FORMAX_HOOKS_DEBUG = prev
    }
  })

  it('covers debug suffix branches for toolUseId and message id combinations', () => {
    const prev = process.env.FORMAX_HOOKS_DEBUG
    process.env.FORMAX_HOOKS_DEBUG = '1'
    try {
      const withToolUseIdNoMessageId: Msg = {
        id: '',
        role: 'tool',
        content: 'done',
        timestamp: new Date(),
        surfaceOwner: 'static',
        toolInfo: {
          toolUseId: 'tooluse-7777',
          name: 'Write',
          status: 'completed',
          input: { file_path: '/tmp/a.txt', content: 'a' },
        },
      }
      const withoutToolUseIdWithMessageId: Msg = {
        id: 'tool-message-8888',
        role: 'tool',
        content: 'done',
        timestamp: new Date(),
        surfaceHint: 'transient',
        toolInfo: {
          name: 'Write',
          status: 'completed',
          input: { file_path: '/tmp/b.txt', content: 'b' },
        },
      }

      const a = renderBlocksPresenter(WriteToolPresenter, withToolUseIdNoMessageId).lastFrame()
      const b = renderBlocksPresenter(WriteToolPresenter, withoutToolUseIdWithMessageId).lastFrame()

      expect(a).toContain('static#')
      expect(b).toContain('trans')
    } finally {
      if (prev === undefined) delete process.env.FORMAX_HOOKS_DEBUG
      else process.env.FORMAX_HOOKS_DEBUG = prev
    }
  })

  it('renders completed write with empty input/content fallbacks', () => {
    const message: Msg = {
      id: 'tool-empty-fallbacks',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'Write',
        status: 'completed',
        input: {},
      },
    }
    const frame = renderBlocksPresenter(WriteToolPresenter, message).lastFrame()
    expect(frame).toContain('Write')
  })

  it('renders non-plan error without compact detail lines', () => {
    const message: Msg = {
      id: 'tool-write-error-no-compact',
      role: 'tool',
      content: 'Error: blocked',
      timestamp: new Date(),
      toolInfo: {
        name: 'Write',
        status: 'error',
        input: { file_path: '/tmp/no-compact.txt', content: 'x' },
      },
    }
    const frame = renderBlocksPresenter(WriteToolPresenter, message).lastFrame()
    expect(frame).toContain('Error: blocked')
    expect(frame).not.toContain('Path (absolute):')
  })
})
