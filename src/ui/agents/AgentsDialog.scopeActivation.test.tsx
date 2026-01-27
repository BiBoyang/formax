import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { InputScopeProvider, useInputScope } from '../../features/repl/inputScopeContext.js'
import { AgentsDialog } from './AgentsDialog.js'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function waitForText(lastFrame: () => string | undefined, text: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const frame = lastFrame() || ''
    if (frame.includes(text)) return
    await tick()
  }
  throw new Error(`Timed out waiting for UI to contain: ${text}`)
}

async function waitForPredicate(
  lastFrame: () => string | undefined,
  predicate: (frame: string) => boolean,
  timeoutMs = 15000,
): Promise<string> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const frame = lastFrame() || ''
    if (predicate(frame)) return frame
    await tick()
  }
  throw new Error(`Timed out waiting for predicate.\nLast frame:\n${lastFrame() || ''}`)
}

async function makeTempDir(prefix: string): Promise<string> {
  return await fsp.mkdtemp(path.join(os.tmpdir(), prefix))
}

describe('AgentsDialog scope activation', () => {
  it('activates overlay:agents scope starting from repl and routes keys', async () => {
    const onExit = vi.fn()
    const userDir = await makeTempDir('formax-agents-user-')
    const projectDir = await makeTempDir('formax-agents-project-')

    let activeScope: string = 'repl'
    function ScopeSpy(): React.ReactNode {
      const s = useInputScope()
      activeScope = s.activeScope
      return null
    }

    const { stdin, lastFrame, unmount } = render(
      <InputScopeProvider initialScope="repl">
        <ScopeSpy />
        <AgentsDialog
          agents={[
            { name: 'design-planner', description: 'help design things' },
            { name: 'general-purpose', description: 'builtin' },
          ]}
          toolNames={['Read', 'Grep', 'Write']}
          userAgentsDir={userDir}
          projectAgentsDir={projectDir}
          onGenerateDraft={async () => ({
            name: 'draft',
            description: 'draft',
            systemPrompt: 'sys',
          })}
          onSaveAgent={async () => ({ name: 'draft', filePath: path.join(projectDir, 'draft.md') })}
          onExit={onExit}
        />
      </InputScopeProvider>,
    )

    await waitForText(lastFrame, 'Agents')
    await waitForPredicate(lastFrame, () => activeScope === 'overlay:agents')
    await tick()

    expect(lastFrame()).toContain('> Create new agent')

    stdin.write('\u001B[B')

    await waitForPredicate(lastFrame, (f) => />\s+design-planner/.test(f))

    unmount()
  }, 20000)
})
