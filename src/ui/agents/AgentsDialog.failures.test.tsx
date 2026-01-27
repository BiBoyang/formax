import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { InputScopeProvider } from '../../features/repl/inputScopeContext.js'
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
  throw new Error(`Timed out waiting for UI to contain: ${text}\n\nLast frame:\n${lastFrame() || ''}`)
}

async function makeTempDir(prefix: string): Promise<string> {
  return await fsp.mkdtemp(path.join(os.tmpdir(), prefix))
}

async function pressDown(stdin: { write: (s: string) => void }, times: number): Promise<void> {
  for (let i = 0; i < times; i++) {
    stdin.write('\u001B[B')
    await tick()
  }
}

describe('AgentsDialog (failures)', () => {
  it('shows a generate failure error and returns to the description input on Enter', async () => {
    const onExit = vi.fn()
    const userDir = await makeTempDir('formax-agents-user-')
    const projectDir = await makeTempDir('formax-agents-project-')
    const onGenerateDraft = vi.fn(async () => {
      throw new Error('boom')
    })

    const { stdin, lastFrame, unmount } = render(
      <InputScopeProvider initialScope="overlay:agents">
        <AgentsDialog
          agents={[
            { name: 'general-purpose', description: 'builtin' },
          ]}
          toolNames={['Read', 'Bash']}
          userAgentsDir={userDir}
          projectAgentsDir={projectDir}
          onGenerateDraft={onGenerateDraft}
          onSaveAgent={async () => ({ name: 'x', filePath: path.join(projectDir, 'x.md') })}
          onExit={onExit}
        />
      </InputScopeProvider>,
    )

    await tick()
    await waitForText(lastFrame, 'Agents')

    // Create -> project scope -> generate with Claude -> description
    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Choose location')
    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Creation method')
    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Describe what this agent should do')

    stdin.write('hello')
    await tick()
    stdin.write('\r')
    await tick()

    await waitForText(lastFrame, 'Error: boom')
    expect(onGenerateDraft).toHaveBeenCalledTimes(1)

    // Enter returns to description input
    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Describe what this agent should do')

    unmount()
  }, 15000)

  it('shows a save failure error and returns to confirm on Enter', async () => {
    const onExit = vi.fn()
    const userDir = await makeTempDir('formax-agents-user-')
    const projectDir = await makeTempDir('formax-agents-project-')
    const onSaveAgent = vi.fn(async () => {
      throw new Error('disk full')
    })

    const { stdin, lastFrame, unmount } = render(
      <InputScopeProvider initialScope="overlay:agents">
        <AgentsDialog
          agents={[
            { name: 'general-purpose', description: 'builtin' },
          ]}
          toolNames={['Read', 'Bash']}
          userAgentsDir={userDir}
          projectAgentsDir={projectDir}
          onGenerateDraft={async () => ({ name: 'draft', description: 'd', systemPrompt: 'sys' })}
          onSaveAgent={onSaveAgent}
          onExit={onExit}
        />
      </InputScopeProvider>,
    )

    await tick()
    await waitForText(lastFrame, 'Agents')

    // Create -> project scope -> manual configuration -> name/desc -> tools -> model -> color -> confirm
    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Choose location')
    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Creation method')
    stdin.write('\u001B[B')
    await tick()
    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Agent name (used as subagent_type):')

    stdin.write('fail-agent')
    await tick()
    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Description (tells Formax when to use this agent):')
    stdin.write('desc')
    await tick()
    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Select tools')

    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Select model')
    await pressDown(stdin, 3) // Inherit from parent
    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Choose background color')

    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Confirm and save')

    // Save triggers failure
    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Error: disk full')
    expect(onSaveAgent).toHaveBeenCalledTimes(1)

    // Enter returns to confirm
    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Confirm and save')

    // Esc goes back
    stdin.write('\u001b')
    await tick()
    await waitForText(lastFrame, 'Choose background color')

    unmount()
  }, 15000)
})

