import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { EditToolPresenter } from './presenter'
import type { Msg } from '../../../components/tool/ToolMessage'
import { PlanProvider } from '../../../features/repl/planContext'
import { UserInputProvider } from '../../runtime/userInputContext'
import { createUserInputManager } from '../../runtime/userInputManager'
import { ToolUiBlocks } from '../../../components/tool/ToolUiBlocks'
import { isToolBlocksPresenter } from '../../presenters/types'

// Helper to render blocks presenter
function renderBlocksPresenter(presenter: typeof EditToolPresenter, message: Msg) {
  if (isToolBlocksPresenter(presenter)) {
    const out = presenter({ message })
    return render(<ToolUiBlocks blocks={out.blocks} />)
  }
  return render(presenter({ message }))
}

describe('EditToolPresenter', () => {
  it('renders a stable running header while tool input is still streaming', () => {
    const message: Msg = {
      id: 'tool-edit',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        toolUseId: 't-edit',
        name: 'Edit',
        status: 'running',
        input: {},
      },
    }

    if (!isToolBlocksPresenter(EditToolPresenter)) {
      throw new Error('EditToolPresenter expected to be a blocks presenter')
    }

    const { lastFrame } = render(<ToolUiBlocks blocks={EditToolPresenter({ message }).blocks} />)
    const frame = lastFrame() || ''
    expect(frame).toContain('Edit')
    expect(frame).not.toContain('(…)')
    expect(frame).not.toContain('Edit file')
  })

  it('falls back to ToolMessage when toolInfo is missing', () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: 'some tool output',
      timestamp: new Date(),
    }

    const { lastFrame } = renderBlocksPresenter(EditToolPresenter, message)
    expect(lastFrame()).toContain('Unknown tool')
  })

  it('renders a diff preview from old_string/new_string', () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: 'Edited a.ts',
      timestamp: new Date(),
      toolInfo: {
        name: 'Edit',
        status: 'completed',
        input: {
          file_path: 'a.ts',
          old_string: 'const a = 1\nconst b = 2',
          new_string: 'const a = 1\nconst b = 3',
        },
      },
    }

    const { lastFrame } = renderBlocksPresenter(EditToolPresenter, message)
    const frame = lastFrame()
    expect(frame).toContain('Edit')
    expect(frame).toContain('(a.ts)')
    expect(frame).toContain('-')
    expect(frame).toContain('const b = 2')
    expect(frame).toContain('+')
    expect(frame).toContain('const b = 3')
  })

  it('does not show unchanged context lines as removed on pure insert', () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: 'Edited a.ts',
      timestamp: new Date(),
      toolInfo: {
        name: 'Edit',
        status: 'completed',
        input: {
          file_path: 'a.ts',
          old_string: 'console.log("hello")\n',
          new_string: 'console.log("hello")\nconsole.log("world")\n',
        },
      },
    }

    const { lastFrame } = renderBlocksPresenter(EditToolPresenter, message)
    const frame = lastFrame()
    // The original line should still appear, but must not be marked as removed.
    expect(frame).toContain('console.log("hello")')
    expect(frame).not.toContain('-  console.log("hello")')
    expect(frame).toContain('+')
    expect(frame).toContain('console.log("world")')
  })

  it('renders the plan file banner when editing the active plan', () => {
    const planPath = '/tmp/plan.md'
    const planSession = { getPlanPath: () => planPath, startNewPlan: () => planPath }

    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'Edit',
        status: 'completed',
        input: {
          file_path: planPath,
          old_string: 'a',
          new_string: 'b',
        },
      },
    }

    if (!isToolBlocksPresenter(EditToolPresenter)) {
      throw new Error('EditToolPresenter expected to be a blocks presenter')
    }

    const { lastFrame } = render(
      <PlanProvider planSession={planSession}>
        <ToolUiBlocks blocks={EditToolPresenter({ message }).blocks} />
      </PlanProvider>,
    )

    const frame = lastFrame()
    expect(frame).toContain('Updated plan')
    expect(frame).toContain('/plan to preview')
    expect(frame).not.toContain('Edit(')
  })

  it('shows an approval prompt when running and the tool use is pending', () => {
    const userInput = createUserInputManager()

    const toolUseId = 'pending-1'
    userInput.requestAnswers({
      toolUseId,
      questions: [
        {
          header: 'h',
          question: 'q',
          multiSelect: false,
          options: [{ label: 'ok', description: 'ok' }],
        },
      ],
    }).catch(() => {})

    const message: Msg = {
      id: `tool-${toolUseId}`,
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'Edit',
        status: 'running',
        input: { file_path: 'a.ts', old_string: 'a', new_string: 'b' },
      },
    }

    if (!isToolBlocksPresenter(EditToolPresenter)) {
      throw new Error('EditToolPresenter expected to be a blocks presenter')
    }

    const { lastFrame } = render(
      <UserInputProvider userInput={userInput}>
        <ToolUiBlocks blocks={EditToolPresenter({ message }).blocks} />
      </UserInputProvider>,
    )

    const frame = lastFrame()
    expect(frame).toContain('Edit file a.ts')
    expect(frame).toContain('Do you want to make this edit to')
    expect(frame).toContain('a.ts')
    expect(frame).toContain('-')
    expect(frame).toContain('+')

    userInput.rejectAllPending(new Error('cleanup'))
  })

  it('truncates diff previews longer than the visible limit', () => {
    const mkLines = (n: number) => Array.from({ length: n }, (_, i) => `line-${i + 1}`).join('\n')

    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'Edit',
        status: 'completed',
        input: {
          file_path: 'a.ts',
          old_string: mkLines(250),
          new_string: mkLines(250),
        },
      },
    }

    const { lastFrame } = renderBlocksPresenter(EditToolPresenter, message)
    const frame = lastFrame()
    // PatchPreview truncates with an ellipsis row.
    expect(frame).toContain('…')
  })

  it('uses toolInfo.patchStartLineNumber for completed diff previews', () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: 'Edited demo.txt',
      timestamp: new Date(),
      toolInfo: {
        name: 'Edit',
        status: 'completed',
        patchStartLineNumber: 22,
        input: {
          file_path: 'demo.txt',
          old_string: 'alpha\n',
          new_string: 'alpha\nbeta\n',
        },
      },
    }

    const { lastFrame } = renderBlocksPresenter(EditToolPresenter, message)
    const frame = lastFrame()
    expect(frame).toContain('  22 ')
    expect(frame).toContain('alpha')
    expect(frame).toContain('  23 ')
    expect(frame).toContain('beta')
  })
})
