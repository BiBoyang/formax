import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { InputScopeProvider } from '../features/repl/inputScopeContext.js'
import { AgentsDialog } from './AgentsDialog'

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

async function makeTempDir(prefix: string): Promise<string> {
  return await fsp.mkdtemp(path.join(os.tmpdir(), prefix))
}

describe('AgentsDialog', () => {
  it('navigates list rows and opens an agent view', async () => {
    const onExit = vi.fn()
    const userDir = await makeTempDir('formax-agents-user-')
    const projectDir = await makeTempDir('formax-agents-project-')

    const { stdin, lastFrame, unmount } = render(
      <InputScopeProvider initialScope="overlay:agents">
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

    await tick()
    await waitForText(lastFrame, 'Agents')

    expect(lastFrame()).toContain('> Create new agent')

    stdin.write('\u001B[B')
    await tick()
    expect(lastFrame()).toContain('> design-planner')
    expect(lastFrame()).not.toContain('> Create new agent')

    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Agent')
    expect(lastFrame()).toContain('design-planner')

    stdin.write('\u001b')
    await tick()
    await waitForText(lastFrame, 'Agents')

    expect(onExit).not.toHaveBeenCalled()
    unmount()
  })

  it('exits on Esc from the list view', async () => {
    const onExit = vi.fn()
    const userDir = await makeTempDir('formax-agents-user-')
    const projectDir = await makeTempDir('formax-agents-project-')

    const { stdin, lastFrame, unmount } = render(
      <InputScopeProvider initialScope="overlay:agents">
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

    await tick()
    await waitForText(lastFrame, 'Agents')

    stdin.write('\u001b')
    await tick()

    expect(onExit).toHaveBeenCalledTimes(1)
    unmount()
  })
})

