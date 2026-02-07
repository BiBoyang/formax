import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { InputScopeProvider } from '../../features/repl/inputScopeContext.js'
import { AgentsDialog } from './AgentsDialog.js'

function tick(): Promise<void> {
  // Under full-suite + coverage load (Ink 6 / React 19), input + frames can be batched/delayed.
  // A tiny delay keeps these UI/input tests deterministic.
  return new Promise((resolve) => setTimeout(resolve, 5))
}

async function waitForText(lastFrame: () => string | undefined, text: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const frame = lastFrame() || ''
    if (frame.includes(text)) return
    await tick()
  }
  throw new Error(`Timed out waiting for UI to contain: ${text}\n\nLast frame:\n${lastFrame() || ''}`)
}

function escapeRegExp(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function moveUpUntilActiveRow(
  lastFrame: () => string | undefined,
  stdin: { write: (data: string) => void },
  rowText: string,
  maxMoves = 20,
): Promise<void> {
  const gtRe = new RegExp(`>\\s*(?:\\d+\\.)?\\s*${escapeRegExp(rowText)}\\b`)
  const isActive = (frame: string): boolean =>
    gtRe.test(frame) ||
    frame
      .split('\n')
      .some((line) => line.includes(rowText) && line.includes('❯'))

  for (let i = 0; i < maxMoves; i++) {
    const frame = lastFrame() || ''
    if (isActive(frame)) return
    stdin.write('\u001B[A')
    await tick()
  }
  throw new Error(`Failed to move selection to row: ${rowText}`)
}

async function moveDownUntilActiveRow(
  lastFrame: () => string | undefined,
  stdin: { write: (data: string) => void },
  rowText: string,
  maxMoves = 20,
): Promise<void> {
  const gtRe = new RegExp(`>\\s*(?:\\d+\\.)?\\s*${escapeRegExp(rowText)}\\b`)
  const isActive = (frame: string): boolean =>
    gtRe.test(frame) ||
    frame
      .split('\n')
      .some((line) => line.includes(rowText) && line.includes('❯'))

  for (let i = 0; i < maxMoves; i++) {
    const frame = lastFrame() || ''
    if (isActive(frame)) return
    stdin.write('\u001B[B')
    await tick()
  }
  throw new Error(`Failed to move selection to row: ${rowText}`)
}

async function pressEscUntilText(
  lastFrame: () => string | undefined,
  stdin: { write: (data: string) => void },
  text: string,
  timeoutMs = 15000,
): Promise<void> {
  stdin.write('\u001b')
  await waitForText(lastFrame, text, timeoutMs)
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
    for (let i = 0; i < 5; i++) await tick()

    expect(lastFrame()).toContain('> Create new agent')

    stdin.write('\u001B[B')
    await waitForText(lastFrame, '> design-planner', 15000)
    await tick()
    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Agent', 5000)
    expect(lastFrame()).toContain('design-planner')

    await pressEscUntilText(lastFrame, stdin, 'Agents')

    expect(onExit).not.toHaveBeenCalled()
    unmount()
  }, 30000)

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

  it('supports left/right editing in "Generate with Claude" description input', async () => {
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

    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Choose location')

    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Creation method')

    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Describe what this agent should do')

    stdin.write('abcde')
    await tick()
    await waitForText(lastFrame, 'abcde')

    stdin.write('\u001B[D')
    await tick()
    stdin.write('\u001B[D')
    await tick()

    // Backspace should delete the character to the left of the cursor
    stdin.write('\x7f')
    await tick()
    await waitForText(lastFrame, 'abde')

    // Insert should happen at the cursor position (not append-only)
    stdin.write('X')
    await tick()
    await waitForText(lastFrame, 'abXde')

    unmount()
  })

  it('handles arrow escape sequences for Up/Down navigation', async () => {
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

    // Down arrow (escape sequence)
    stdin.write('\u001B[B')
    await tick()

    // Should move selection to the first agent row
    await waitForText(lastFrame, '> design-planner', 15000)

    // Up arrow (escape sequence)
    stdin.write('\u001B[A')
    await tick()

    await waitForText(lastFrame, '> Create new agent')
    unmount()
  })

  it('supports manual agent creation flow', async () => {
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

    // Start create flow
    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Choose location')

    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Creation method')

    // Navigate to manual option
    await moveDownUntilActiveRow(lastFrame, stdin, 'Manual configuration')
    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Write manually')
    await waitForText(lastFrame, 'Agent name (used as subagent_type):')

    // Type agent name
    stdin.write('test-agent')
    await tick()
    await waitForText(lastFrame, 'test-agent')
    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Description (tells Formax when to use this agent):')

    // Type description
    stdin.write('A test agent for testing')
    await tick()
    await waitForText(lastFrame, 'A test agent for testing')

    unmount()
  })

  it('supports cancel operation with Esc key', async () => {
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

    // Enter create flow
    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Choose location')

    // Cancel with Esc
    await pressEscUntilText(lastFrame, stdin, 'Agents')

    // Should be back at list view
    expect(lastFrame()).toContain('Create new agent')

    unmount()
  })

  it('selects user scope in creation flow', async () => {
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

    // Enter create flow
    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Choose location')

    // Navigate to user option
    stdin.write('\u001B[B')
    await tick()
    expect(lastFrame()).toContain('Personal (~/.formax/agents/)')

    // Select user
    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Creation method')

    unmount()
  })

  it('selects manual creation method', async () => {
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

    // Enter create flow
    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Choose location')

    stdin.write('\r') // Select project
    await tick()
    await waitForText(lastFrame, 'Creation method')

    // Navigate to manual option
    stdin.write('\u001B[B')
    await tick()
    await waitForText(lastFrame, '> 2. Manual configuration', 15000)

    // Select manual
    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Agent name', 15000)

    unmount()
  })

  it('navigates between agents in list view', async () => {
    const onExit = vi.fn()
    const userDir = await makeTempDir('formax-agents-user-')
    const projectDir = await makeTempDir('formax-agents-project-')

    const { stdin, lastFrame, unmount } = render(
      <InputScopeProvider initialScope="overlay:agents">
        <AgentsDialog
          agents={[
            { name: 'agent-1', description: 'First agent' },
            { name: 'agent-2', description: 'Second agent' },
            { name: 'agent-3', description: 'Third agent' },
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

    // Should show "Create new agent" first
    expect(lastFrame()).toContain('> Create new agent')

    // Navigate down through agents
    stdin.write('\u001B[B')
    await tick()
    await waitForText(lastFrame, '> agent-1', 15000)

    stdin.write('\u001B[B')
    await tick()
    await waitForText(lastFrame, '> agent-2', 15000)

    // Navigate back up
    stdin.write('\u001B[A')
    await tick()
    await waitForText(lastFrame, '> agent-1', 15000)

    // Navigate to top
    stdin.write('\u001B[A')
    await tick()
    await waitForText(lastFrame, '> Create new agent', 15000)

    unmount()
  })

  it('proceeds with empty name during manual creation', async () => {
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

    // Navigate to manual creation
    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Choose location')

    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Creation method')

    stdin.write('\u001B[B')
    await tick()
    await waitForText(lastFrame, '> 2. Manual configuration', 15000)
    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Agent name')

    // Empty name submission proceeds to next step (no validation)
    stdin.write('\r')
    await tick()
    // Should move to description input
    await waitForText(lastFrame, 'Description')

    unmount()
  })

  it('supports navigating between multiple views with Esc', async () => {
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

    // Open first agent
    await moveDownUntilActiveRow(lastFrame, stdin, 'design-planner')
    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'design-planner')

    // Go back to list
    await pressEscUntilText(lastFrame, stdin, 'Agents')

    // Navigate back to "Create new agent" (cursor is still on design-planner)
    for (let i = 0; i < 2; i++) await tick()
    await moveUpUntilActiveRow(lastFrame, stdin, 'Create new agent')

    // Enter create flow
    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Choose location')

    // Cancel create flow
    await pressEscUntilText(lastFrame, stdin, 'Agents')

    // Should still be at list, verify state is clean
    expect(lastFrame()).toContain('> Create new agent')

    unmount()
  })
})
