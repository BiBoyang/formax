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
  throw new Error(`Timed out waiting for UI to contain: ${text}`)
}

async function makeTempDir(prefix: string): Promise<string> {
  return await fsp.mkdtemp(path.join(os.tmpdir(), prefix))
}

async function writeAgentMd(dir: string, fileName: string, frontmatter: Record<string, string>): Promise<void> {
  const lines = ['---', ...Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`), '---', '', 'body']
  await fsp.writeFile(path.join(dir, fileName), lines.join('\n'), 'utf8')
}

describe('AgentsDialog (disk agents)', () => {
  it('renders user disk agents with model from frontmatter', async () => {
    const onExit = vi.fn()
    const userDir = await makeTempDir('formax-agents-user-')
    const projectDir = await makeTempDir('formax-agents-project-')

    await writeAgentMd(userDir, 'foo.md', { name: 'foo', model: 'Opus' })

    const { lastFrame, unmount } = render(
      <InputScopeProvider initialScope="overlay:agents">
        <AgentsDialog
          agents={[
            { name: 'foo', description: 'from disk' },
            { name: 'general-purpose', description: 'builtin' },
          ]}
          toolNames={['Read']}
          userAgentsDir={userDir}
          projectAgentsDir={projectDir}
          onGenerateDraft={async () => ({ name: 'draft', description: 'draft', systemPrompt: 'sys' })}
          onSaveAgent={async () => ({ name: 'draft', filePath: path.join(projectDir, 'draft.md') })}
          onExit={onExit}
        />
      </InputScopeProvider>,
    )

    await tick()
    await waitForText(lastFrame, 'Agents')
    await waitForText(lastFrame, 'foo · opus')
    expect(lastFrame()).toContain(`User agents (${userDir})`)

    unmount()
  })

  it('project disk agent overrides user (and model)', async () => {
    const onExit = vi.fn()
    const userDir = await makeTempDir('formax-agents-user-')
    const projectDir = await makeTempDir('formax-agents-project-')

    await writeAgentMd(userDir, 'foo.md', { name: 'foo', model: 'Opus' })
    await writeAgentMd(projectDir, 'foo.md', { name: 'foo', model: 'Haiku' })
    await writeAgentMd(userDir, 'bar.md', { name: 'bar', model: 'Sonnet' })

    const { lastFrame, unmount } = render(
      <InputScopeProvider initialScope="overlay:agents">
        <AgentsDialog
          agents={[
            { name: 'foo', description: 'from disk' },
            { name: 'bar', description: 'from disk' },
            { name: 'general-purpose', description: 'builtin' },
          ]}
          toolNames={['Read']}
          userAgentsDir={userDir}
          projectAgentsDir={projectDir}
          onGenerateDraft={async () => ({ name: 'draft', description: 'draft', systemPrompt: 'sys' })}
          onSaveAgent={async () => ({ name: 'draft', filePath: path.join(projectDir, 'draft.md') })}
          onExit={onExit}
        />
      </InputScopeProvider>,
    )

    await tick()
    await waitForText(lastFrame, 'Agents')
    await waitForText(lastFrame, 'bar · sonnet')
    await waitForText(lastFrame, 'Project agents')
    await waitForText(lastFrame, 'foo · haiku')

    expect(lastFrame()).not.toContain('foo · opus')

    unmount()
  })
})

