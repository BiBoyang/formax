import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { EditToolPresenter } from './presenter'
import type { Msg } from '../../../components/tool/ToolMessage'
import { PlanProvider } from '../../../features/repl/planContext'
import { UserInputProvider } from '../../runtime/userInputContext'
import { createUserInputManager } from '../../runtime/userInputManager'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

describe('EditToolPresenter', () => {
  it('falls back to ToolMessage when toolInfo is missing', () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: 'some tool output',
      timestamp: new Date(),
    }

    const { lastFrame } = render(<EditToolPresenter message={message} />)
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

    const { lastFrame } = render(<EditToolPresenter message={message} />)
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

    const { lastFrame } = render(<EditToolPresenter message={message} />)
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

    const { lastFrame } = render(
      <PlanProvider planSession={planSession}>
        <EditToolPresenter message={message} />
      </PlanProvider>,
    )

    const frame = lastFrame()
    expect(frame).toContain('Updated plan')
    expect(frame).toContain('/plan to preview')
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

    const { lastFrame } = render(
      <UserInputProvider userInput={userInput}>
        <EditToolPresenter message={message} />
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

    const { lastFrame } = render(<EditToolPresenter message={message} />)
    const frame = lastFrame()
    // PatchPreview truncates with an ellipsis row.
    expect(frame).toContain('…')
  })

  it('anchors completed diff line numbers using the new snippet', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-edit-'))
    try {
      const filePath = path.join(tmpDir, 'demo.txt')

      const prefix = Array.from({ length: 21 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
      const newSnippet = 'alpha\nbeta\n'
      await fsp.writeFile(filePath, prefix + newSnippet + 'tail\n', 'utf8')

      const message: Msg = {
        id: 'tool-1',
        role: 'tool',
        content: `Edited ${filePath}`,
        timestamp: new Date(),
        toolInfo: {
          name: 'Edit',
          status: 'completed',
          input: {
            file_path: filePath,
            old_string: 'alpha\n',
            new_string: newSnippet,
          },
        },
      }

      const { lastFrame } = render(<EditToolPresenter message={message} />)

      await waitFor(() => lastFrame().includes('  22 '), 2000)
      const frame = lastFrame()
      expect(frame).toContain('  22 ')
      expect(frame).toContain('alpha')
      expect(frame).toContain('  23 ')
      expect(frame).toContain('beta')
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })
})

async function waitFor(fn: () => boolean, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (fn()) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('Timed out waiting for condition')
}
