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

async function pressUp(stdin: { write: (s: string) => void }, times: number): Promise<void> {
  for (let i = 0; i < times; i++) {
    stdin.write('\u001B[A')
    await tick()
  }
}

describe('AgentsDialog (create flow)', () => {
  it('supports Generate with Claude flow and advanced tools toggle', async () => {
    const onExit = vi.fn()
    const userDir = await makeTempDir('formax-agents-user-')
    const projectDir = await makeTempDir('formax-agents-project-')
    const onGenerateDraft = vi.fn(async () => ({
      name: 'draft-agent',
      description: 'generated',
      systemPrompt: 'sys',
    }))

    const { stdin, lastFrame, unmount } = render(
      <InputScopeProvider initialScope="overlay:agents">
        <AgentsDialog
          agents={[
            { name: 'general-purpose', description: 'builtin' },
          ]}
          toolNames={['Read', 'Grep', 'Write', 'Bash', 'Task', 'AskUserQuestion', 'KillShell']}
          userAgentsDir={userDir}
          projectAgentsDir={projectDir}
          onGenerateDraft={onGenerateDraft}
          onSaveAgent={async () => ({ name: 'draft', filePath: path.join(projectDir, 'draft.md') })}
          onExit={onExit}
        />
      </InputScopeProvider>,
    )

    await tick()
    await waitForText(lastFrame, 'Agents')

    // Create new agent -> choose location (project) -> choose method (generate) -> description input
    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Choose location')
    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Creation method')
    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Describe what this agent should do')

    stdin.write('hello world')
    await tick()
    await waitForText(lastFrame, 'hello world')
    stdin.write('\r')
    await tick()

    await waitForText(lastFrame, 'Select tools')
    expect(onGenerateDraft).toHaveBeenCalledTimes(1)

    // Toggle advanced options on
    await pressDown(stdin, 6)
    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, '[ Hide advanced options ]')
    await waitForText(lastFrame, 'Bash')

    // Non-selectable tools must not appear in the advanced list
    expect(lastFrame()).not.toContain('Task')
    expect(lastFrame()).not.toContain('AskUserQuestion')
    expect(lastFrame()).not.toContain('KillShell')

    // Deselect all tools via "All tools" group, then hitting Continue shows the correct error
    await pressUp(stdin, 5) // from cursor 6 -> cursor 1 ("All tools" group)
    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'No tools selected')

    await pressUp(stdin, 1) // cursor 0: [ Continue ]
    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Error: Select at least one tool.')

    // Enter returns to tools view
    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Select tools')

    unmount()
  }, 15000)

  it('supports Manual configuration flow and records created agent on exit', async () => {
    const onExit = vi.fn()
    const userDir = await makeTempDir('formax-agents-user-')
    const projectDir = await makeTempDir('formax-agents-project-')
    const onSaveAgent = vi.fn(async (args: any) => {
      return { name: args.name, filePath: path.join(projectDir, `${args.name}.md`) }
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
          onGenerateDraft={async () => ({ name: 'draft', description: 'draft', systemPrompt: 'sys' })}
          onSaveAgent={onSaveAgent}
          onExit={onExit}
        />
      </InputScopeProvider>,
    )

    await tick()
    await waitForText(lastFrame, 'Agents')

    // Create -> project scope
    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Choose location')
    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Creation method')

    // Choose manual configuration (2nd option)
    stdin.write('\u001B[B')
    await tick()
    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Write manually')
    await waitForText(lastFrame, 'Agent name (used as subagent_type):')

    stdin.write('My Agent')
    await tick()
    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Description (tells Formax when to use this agent):')

    stdin.write('Use this agent for code reviews.')
    await tick()
    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Select tools')

    // Continue -> model -> choose Inherit -> color -> confirm
    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Select model')

    await pressDown(stdin, 3)
    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Choose background color')

    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Confirm and save')

    // Save and edit
    stdin.write('e')
    await tick()
    await waitForText(lastFrame, 'Created agent:')

    expect(onSaveAgent).toHaveBeenCalledTimes(1)
    expect(onSaveAgent.mock.calls[0]?.[0]?.openInEditor).toBe(true)

    // Exit and verify the created agent is returned
    stdin.write('\u001b')
    await tick()
    expect(onExit).toHaveBeenCalledTimes(1)
    expect(onExit.mock.calls[0]?.[0]?.createdAgents).toEqual(['my-agent'])

    unmount()
  }, 15000)
})
