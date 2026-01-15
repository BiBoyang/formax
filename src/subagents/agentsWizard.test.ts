import { describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { createAgentFromWizardAnswers } from './agentsWizard'

describe('createAgentFromWizardAnswers', () => {
  it('writes a project-level agent file and omits tools when all tools selected', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-agents-project-'))
    try {
      const projectAgentsDir = path.join(cwd, '.formax', 'agents')

      const out = await createAgentFromWizardAnswers({
        cwd,
        projectAgentsDir,
        env: { ...process.env, FORMAX_CONFIG_DIR: path.join(cwd, '.formax-global') },
        answers: {
          scope: 'Project-level (.formax/agents)',
          name: 'Code Reviewer',
          description: 'Review code for quality',
          tools: 'All tools',
          model: 'Sonnet',
          color: 'Automatic',
          systemPrompt: 'You are a code reviewer.',
        },
      })

      expect(out.name).toBe('code-reviewer')
      expect(out.filePath).toBe(path.join(projectAgentsDir, 'code-reviewer.md'))

      const raw = await fsp.readFile(out.filePath, 'utf8')
      expect(raw).toContain('name: code-reviewer')
      expect(raw).toContain('description: Review code for quality')
      expect(raw).toContain('model: sonnet')
      expect(raw).not.toContain('color:')
      expect(raw).not.toContain('tools:')
      expect(raw).toContain('You are a code reviewer.')
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })

  it('writes a user-level agent file under FORMAX_CONFIG_DIR and picks a unique filename', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-agents-user-'))
    const globalConfigDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-config-'))
    try {
      const env = { ...process.env, FORMAX_CONFIG_DIR: globalConfigDir }
      const projectAgentsDir = path.join(cwd, '.formax', 'agents')

      const first = await createAgentFromWizardAnswers({
        cwd,
        projectAgentsDir,
        env,
        answers: {
          scope: 'User-level (~/.formax/agents)',
          name: 'demo',
          description: 'Demo agent',
          tools: 'Read-only tools',
          model: 'Inherit',
          color: 'Blue',
          systemPrompt: 'You are a demo agent.',
        },
      })

      const second = await createAgentFromWizardAnswers({
        cwd,
        projectAgentsDir,
        env,
        answers: {
          scope: 'User-level (~/.formax/agents)',
          name: 'demo',
          description: 'Demo agent',
          tools: 'Read-only tools',
          model: 'Inherit',
          color: 'Blue',
          systemPrompt: 'You are a demo agent.',
        },
      })

      expect(first.filePath).toBe(path.join(globalConfigDir, 'agents', 'demo.md'))
      expect(second.filePath).toBe(path.join(globalConfigDir, 'agents', 'demo-2.md'))

      const raw = await fsp.readFile(first.filePath, 'utf8')
      expect(raw).toContain('model: inherit')
      expect(raw).toContain('color: blue')
      expect(raw).toContain('tools: Read, Glob, Grep')
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
      await fsp.rm(globalConfigDir, { recursive: true, force: true })
    }
  })
})

