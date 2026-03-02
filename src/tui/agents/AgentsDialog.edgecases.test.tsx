import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { InputScopeProvider } from '../../features/repl/inputScopeContext.js'
import { AgentsDialog } from './AgentsDialog.js'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5))
}

async function waitForText(lastFrame: () => string | undefined, text: string, timeoutMs = 12000): Promise<void> {
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

function isActiveRow(frame: string, label: string): boolean {
  return frame.split('\n').some((line) => line.includes(label) && /[>❯]\s*/.test(line))
}

async function moveDownUntilActiveRow(
  lastFrame: () => string | undefined,
  stdin: { write: (s: string) => void },
  label: string,
): Promise<void> {
  for (let i = 0; i < 12; i += 1) {
    if (isActiveRow(lastFrame() || '', label)) return
    stdin.write('\u001B[B')
    await tick()
  }
  throw new Error(`Could not activate row "${label}"\n\nLast frame:\n${lastFrame() || ''}`)
}

describe('AgentsDialog (edge cases)', () => {
  it('shows validation errors for missing generate description and missing manual description', async () => {
    const userDir = await makeTempDir('formax-agents-user-')
    const projectDir = await makeTempDir('formax-agents-project-')

    const { stdin, lastFrame, unmount } = render(
      <InputScopeProvider initialScope="overlay:agents">
        <AgentsDialog
          agents={[{ name: 'general-purpose', description: 'builtin' }]}
          toolNames={['Read', 'Bash']}
          userAgentsDir={userDir}
          projectAgentsDir={projectDir}
          onGenerateDraft={async () => ({ name: 'x', description: 'x', systemPrompt: 'x' })}
          onSaveAgent={async () => ({ name: 'x', filePath: path.join(projectDir, 'x.md') })}
          onExit={() => {}}
        />
      </InputScopeProvider>,
    )

    await waitForText(lastFrame, 'Agents')
    for (let i = 0; i < 3; i += 1) await tick()

    // Generate path: empty description -> validation error
    stdin.write('\r')
    await waitForText(lastFrame, 'Choose location')
    stdin.write('\r')
    await waitForText(lastFrame, 'Creation method')
    stdin.write('\r')
    await waitForText(lastFrame, 'Describe what this agent should do')
    stdin.write('\r')
    await waitForText(lastFrame, 'Error: Please describe the agent to generate.')
    stdin.write('\r')
    await waitForText(lastFrame, 'Describe what this agent should do')

    // Return to list, then manual path
    stdin.write('\u001b')
    await waitForText(lastFrame, 'Creation method')
    stdin.write('\u001b')
    await waitForText(lastFrame, 'Choose location')
    stdin.write('\u001b')
    await waitForText(lastFrame, 'Agents')

    stdin.write('\r')
    await waitForText(lastFrame, 'Choose location')
    stdin.write('\r')
    await waitForText(lastFrame, 'Creation method')
    await moveDownUntilActiveRow(lastFrame, stdin, 'Manual configuration')
    stdin.write('\r')
    await waitForText(lastFrame, 'Agent name (used as subagent_type):')

    stdin.write('manual-agent')
    await tick()
    stdin.write('\r')
    await waitForText(lastFrame, 'Description (tells Formax when to use this agent):')
    stdin.write('\r')
    await waitForText(lastFrame, 'Error: Missing agent description.')

    unmount()
  }, 30000)

  it('renders generating state and allows Esc cancel while generate is in-flight', async () => {
    const userDir = await makeTempDir('formax-agents-user-')
    const projectDir = await makeTempDir('formax-agents-project-')
    let rejectGenerate: ((e: unknown) => void) | null = null

    const { stdin, lastFrame, unmount } = render(
      <InputScopeProvider initialScope="overlay:agents">
        <AgentsDialog
          agents={[{ name: 'general-purpose', description: 'builtin' }]}
          toolNames={['Read', 'Bash']}
          userAgentsDir={userDir}
          projectAgentsDir={projectDir}
          onGenerateDraft={async () => {
            await new Promise((_resolve, reject) => {
              rejectGenerate = reject
            })
            return { name: 'x', description: 'x', systemPrompt: 'x' }
          }}
          onSaveAgent={async () => ({ name: 'x', filePath: path.join(projectDir, 'x.md') })}
          onExit={() => {}}
        />
      </InputScopeProvider>,
    )

    await waitForText(lastFrame, 'Agents')
    stdin.write('\r')
    await waitForText(lastFrame, 'Choose location')
    stdin.write('\r')
    await waitForText(lastFrame, 'Creation method')
    stdin.write('\r')
    await waitForText(lastFrame, 'Describe what this agent should do')
    stdin.write('desc')
    await tick()
    stdin.write('\r')
    await waitForText(lastFrame, 'Generating agent from description...')
    stdin.write('\u001b')
    await waitForText(lastFrame, 'Describe what this agent should do')

    rejectGenerate?.(new Error('aborted'))
    unmount()
  }, 30000)

  it('renders saving state and allows Esc cancel while save is in-flight', async () => {
    const userDir = await makeTempDir('formax-agents-user-')
    const projectDir = await makeTempDir('formax-agents-project-')
    let rejectSave: ((e: unknown) => void) | null = null

    const { stdin, lastFrame, unmount } = render(
      <InputScopeProvider initialScope="overlay:agents">
        <AgentsDialog
          agents={[{ name: 'general-purpose', description: 'builtin' }]}
          toolNames={['Read', 'Bash']}
          userAgentsDir={userDir}
          projectAgentsDir={projectDir}
          onGenerateDraft={async () => ({ name: 'draft', description: 'd', systemPrompt: 'sys' })}
          onSaveAgent={async () => {
            await new Promise((_resolve, reject) => {
              rejectSave = reject
            })
            return { name: 'x', filePath: path.join(projectDir, 'x.md') }
          }}
          onExit={() => {}}
        />
      </InputScopeProvider>,
    )

    await waitForText(lastFrame, 'Agents')
    stdin.write('\r')
    await waitForText(lastFrame, 'Choose location')
    stdin.write('\r')
    await waitForText(lastFrame, 'Creation method')
    stdin.write('\u001B[B')
    await tick()
    stdin.write('\r')
    await waitForText(lastFrame, 'Agent name (used as subagent_type):')
    stdin.write('x')
    await tick()
    stdin.write('\r')
    await waitForText(lastFrame, 'Description (tells Formax when to use this agent):')
    stdin.write('d')
    await tick()
    stdin.write('\r')
    await waitForText(lastFrame, 'Select tools')
    stdin.write('\r')
    await waitForText(lastFrame, 'Select model')
    stdin.write('\r')
    await waitForText(lastFrame, 'Choose background color')
    stdin.write('\r')
    await waitForText(lastFrame, 'Confirm and save')

    stdin.write('\r')
    await waitForText(lastFrame, 'Saving…')
    stdin.write('\u001b')
    await waitForText(lastFrame, 'Confirm and save')

    rejectSave?.(new Error('aborted'))
    unmount()
  }, 30000)

  it('opens and closes view-agent details from list', async () => {
    const onExit = vi.fn()
    const userDir = await makeTempDir('formax-agents-user-')
    const projectDir = await makeTempDir('formax-agents-project-')

    const { stdin, lastFrame, unmount } = render(
      <InputScopeProvider initialScope="overlay:agents">
        <AgentsDialog
          agents={[
            { name: 'general-purpose', description: 'builtin' },
            { name: 'my-agent', description: 'custom' },
          ]}
          toolNames={['Read']}
          userAgentsDir={userDir}
          projectAgentsDir={projectDir}
          onGenerateDraft={async () => ({ name: 'x', description: 'x', systemPrompt: 'x' })}
          onSaveAgent={async () => ({ name: 'x', filePath: path.join(projectDir, 'x.md') })}
          onExit={onExit}
        />
      </InputScopeProvider>,
    )

    await waitForText(lastFrame, 'Agents')
    stdin.write('\u001B[B')
    await tick()
    stdin.write('\r')
    await waitForText(lastFrame, 'Agent')
    await waitForText(lastFrame, 'Description:')
    stdin.write('\u001b')
    await waitForText(lastFrame, 'Agents')

    unmount()
  }, 20000)

  it('keeps view-agent screen on Enter and handles empty description fallback', async () => {
    const userDir = await makeTempDir('formax-agents-user-')
    const projectDir = await makeTempDir('formax-agents-project-')

    const { stdin, lastFrame, unmount } = render(
      <InputScopeProvider initialScope="overlay:agents">
        <AgentsDialog
          agents={[
            { name: 'general-purpose', description: 'builtin' },
            { name: 'empty-desc', description: '' },
          ]}
          toolNames={['Read']}
          userAgentsDir={userDir}
          projectAgentsDir={projectDir}
          onGenerateDraft={async () => ({ name: 'x', description: 'x', systemPrompt: 'x' })}
          onSaveAgent={async () => ({ name: 'x', filePath: path.join(projectDir, 'x.md') })}
          onExit={() => {}}
        />
      </InputScopeProvider>,
    )

    await waitForText(lastFrame, 'Agents')
    stdin.write('\u001B[B')
    await tick()
    stdin.write('\r')
    await waitForText(lastFrame, 'Agent')
    await waitForText(lastFrame, 'Description:')
    stdin.write('\r')
    await tick()
    expect(lastFrame() || '').toContain('Agent')
    stdin.write('\u001b')
    await waitForText(lastFrame, 'Agents')

    unmount()
  }, 20000)

  it('toggles an individual advanced tool with Enter in tools step', async () => {
    const userDir = await makeTempDir('formax-agents-user-')
    const projectDir = await makeTempDir('formax-agents-project-')

    const { stdin, lastFrame, unmount } = render(
      <InputScopeProvider initialScope="overlay:agents">
        <AgentsDialog
          agents={[{ name: 'general-purpose', description: 'builtin' }]}
          toolNames={['Read', 'Bash']}
          userAgentsDir={userDir}
          projectAgentsDir={projectDir}
          onGenerateDraft={async () => ({ name: 'x', description: 'x', systemPrompt: 'x' })}
          onSaveAgent={async () => ({ name: 'x', filePath: path.join(projectDir, 'x.md') })}
          onExit={() => {}}
        />
      </InputScopeProvider>,
    )

    await waitForText(lastFrame, 'Agents')
    stdin.write('\r')
    await waitForText(lastFrame, 'Choose location')
    stdin.write('\r')
    await waitForText(lastFrame, 'Creation method')
    stdin.write('\u001B[B')
    await tick()
    stdin.write('\r')
    await waitForText(lastFrame, 'Agent name (used as subagent_type):')
    stdin.write('x')
    await tick()
    stdin.write('\r')
    await waitForText(lastFrame, 'Description (tells Formax when to use this agent):')
    stdin.write('d')
    await tick()
    stdin.write('\r')
    await waitForText(lastFrame, 'Select tools')

    await moveDownUntilActiveRow(lastFrame, stdin, '[ Show advanced options ]')
    await tick()
    stdin.write('\r')
    await waitForText(lastFrame, '[ Hide advanced options ]')

    stdin.write('\u001B[B')
    await tick()
    stdin.write('\r')
    await waitForText(lastFrame, '1 tools selected')

    unmount()
  }, 25000)

  it('omits all-tools warning in confirm when at least one tool is deselected', async () => {
    const userDir = await makeTempDir('formax-agents-user-')
    const projectDir = await makeTempDir('formax-agents-project-')

    const { stdin, lastFrame, unmount } = render(
      <InputScopeProvider initialScope="overlay:agents">
        <AgentsDialog
          agents={[{ name: 'general-purpose', description: 'builtin' }]}
          toolNames={['Read', 'Bash']}
          userAgentsDir={userDir}
          projectAgentsDir={projectDir}
          onGenerateDraft={async () => ({ name: 'x', description: 'x', systemPrompt: 'x' })}
          onSaveAgent={async () => ({ name: 'x', filePath: path.join(projectDir, 'x.md') })}
          onExit={() => {}}
        />
      </InputScopeProvider>,
    )

    await waitForText(lastFrame, 'Agents')
    stdin.write('\r')
    await waitForText(lastFrame, 'Choose location')
    stdin.write('\r')
    await waitForText(lastFrame, 'Creation method')
    stdin.write('\u001B[B')
    await tick()
    stdin.write('\r')
    await waitForText(lastFrame, 'Agent name (used as subagent_type):')
    stdin.write('x')
    await tick()
    stdin.write('\r')
    await waitForText(lastFrame, 'Description (tells Formax when to use this agent):')
    stdin.write('d')
    await tick()
    stdin.write('\r')
    await waitForText(lastFrame, 'Select tools')

    await moveDownUntilActiveRow(lastFrame, stdin, '[ Show advanced options ]')
    await tick()
    stdin.write('\r')
    await waitForText(lastFrame, '[ Hide advanced options ]')
    stdin.write('\u001B[B')
    await tick()
    stdin.write('\r')
    await waitForText(lastFrame, '1 tools selected')

    for (let i = 0; i < 7; i += 1) {
      stdin.write('\u001B[A')
      await tick()
    }
    stdin.write('\r')
    await waitForText(lastFrame, 'Select model')
    stdin.write('\r')
    await waitForText(lastFrame, 'Choose background color')
    stdin.write('\r')
    await waitForText(lastFrame, 'Confirm and save')
    expect(lastFrame() || '').not.toContain('Warnings:')

    unmount()
  }, 30000)

  it('returns from manual name input to method selection on Esc', async () => {
    const userDir = await makeTempDir('formax-agents-user-')
    const projectDir = await makeTempDir('formax-agents-project-')

    const { stdin, lastFrame, unmount } = render(
      <InputScopeProvider initialScope="overlay:agents">
        <AgentsDialog
          agents={[{ name: 'general-purpose', description: 'builtin' }]}
          toolNames={['Read']}
          userAgentsDir={userDir}
          projectAgentsDir={projectDir}
          onGenerateDraft={async () => ({ name: 'x', description: 'x', systemPrompt: 'x' })}
          onSaveAgent={async () => ({ name: 'x', filePath: path.join(projectDir, 'x.md') })}
          onExit={() => {}}
        />
      </InputScopeProvider>,
    )

    await waitForText(lastFrame, 'Agents')
    stdin.write('\r')
    await waitForText(lastFrame, 'Choose location')
    stdin.write('\r')
    await waitForText(lastFrame, 'Creation method')
    await moveDownUntilActiveRow(lastFrame, stdin, 'Manual configuration')
    stdin.write('\r')
    await waitForText(lastFrame, 'Agent name (used as subagent_type):')
    stdin.write('\u001b')
    await waitForText(lastFrame, 'Creation method')

    unmount()
  }, 20000)

  it('moves cursor with arrow key in scope step before selecting', async () => {
    const userDir = await makeTempDir('formax-agents-user-')
    const projectDir = await makeTempDir('formax-agents-project-')

    const { stdin, lastFrame, unmount } = render(
      <InputScopeProvider initialScope="overlay:agents">
        <AgentsDialog
          agents={[{ name: 'general-purpose', description: 'builtin' }]}
          toolNames={['Read']}
          userAgentsDir={userDir}
          projectAgentsDir={projectDir}
          onGenerateDraft={async () => ({ name: 'x', description: 'x', systemPrompt: 'x' })}
          onSaveAgent={async () => ({ name: 'x', filePath: path.join(projectDir, 'x.md') })}
          onExit={() => {}}
        />
      </InputScopeProvider>,
    )

    await waitForText(lastFrame, 'Agents')
    stdin.write('\r')
    await waitForText(lastFrame, 'Choose location')
    stdin.write('\u001B[B')
    await tick()
    stdin.write('\r')
    await waitForText(lastFrame, 'Creation method')

    unmount()
  }, 20000)

})
