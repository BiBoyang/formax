import { describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createNodeFileStore } from '../../adapters/fs/nodeFileStore.js'
import type { UserInputManager } from '../runtime/userInputManager.js'
import { buildSkillPermissionKey, getProjectSettingsLocalPath } from '../../adapters/permissions/skillAllowList.js'
import { createSkillPreflight } from './skillPreflight.js'

describe('createSkillPreflight', () => {
  it('returns null for non-Skill calls', async () => {
    const store = createNodeFileStore()
    const preflight = createSkillPreflight({ fileStore: store, userInput: null })
    const res = await preflight({ id: 'noop', name: 'Read', input: {} } as any, { cwd: process.cwd(), agentDepth: 0 })
    expect(res).toBeNull()
  })

  it('returns error for sub-agents (no prompting)', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-skill-preflight-subagent-'))
    try {
      const store = createNodeFileStore()
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(projectDir, { recursive: true })

      const preflight = createSkillPreflight({ fileStore: store, userInput: null })
      const res = await preflight(
        { id: 't1', name: 'Skill', input: { skill: 'frontend-design' } },
        { cwd: projectDir, agentDepth: 1 },
      )
      expect(res?.is_error).toBe(true)
      expect(res?.content).toContain('Skill requires user approval')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('returns stable error when interactive prompts are disabled', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-skill-preflight-noninteractive-'))
    try {
      const store = createNodeFileStore()
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(projectDir, { recursive: true })

      const userInput: UserInputManager = {
        requestAnswers: async () => ({}),
        submitAnswers: () => true,
        reject: () => true,
        rejectAllPending: () => 0,
        clearBufferedAnswers: () => {},
        isPending: () => false,
      }

      const preflight = createSkillPreflight({ fileStore: store, userInput })
      const res = await preflight(
        { id: 't1', name: 'Skill', input: { skill: 'frontend-design' } },
        { cwd: projectDir, agentDepth: 0, interactive: false },
      )

      expect(res?.is_error).toBe(true)
      expect(res?.content).toContain('Skill requires user approval')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('falls back to process.cwd() when ctx.cwd is empty', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-skill-preflight-cwd-fallback-'))
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(dir)
    try {
      const store = createNodeFileStore()
      await fs.mkdir(dir, { recursive: true })

      const key = buildSkillPermissionKey('frontend-design')
      const filePath = getProjectSettingsLocalPath(dir)
      await store.writeJsonAtomic(filePath, {
        version: 1,
        permissions: { allow: [key], ask: [], deny: [], workspace: { additionalDirectories: [] } },
      })

      const preflight = createSkillPreflight({ fileStore: store, userInput: null })
      const res = await preflight(
        { id: 't-cwd-fallback', name: 'Skill', input: { skill: 'frontend-design' } },
        { cwd: '', agentDepth: 0 },
      )
      expect(res).toBeNull()
    } finally {
      cwdSpy.mockRestore()
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('allows Skill when it is already on the repo allow-list', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-skill-preflight-allowed-'))
    try {
      const store = createNodeFileStore()
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(projectDir, { recursive: true })

      const key = buildSkillPermissionKey('frontend-design')
      const filePath = getProjectSettingsLocalPath(projectDir)
      await store.writeJsonAtomic(filePath, { version: 1, permissions: { allow: [key], ask: [], deny: [], workspace: { additionalDirectories: [] } } })

      const preflight = createSkillPreflight({ fileStore: store, userInput: null })
      const res = await preflight(
        { id: 't1', name: 'Skill', input: { skill: 'frontend-design' } },
        { cwd: projectDir, agentDepth: 0 },
      )
      expect(res).toBeNull()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('denies Skill when it is on the repo deny-list (no prompting)', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-skill-preflight-deny-'))
    try {
      const store = createNodeFileStore()
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(projectDir, { recursive: true })

      const key = buildSkillPermissionKey('frontend-design')
      const filePath = getProjectSettingsLocalPath(projectDir)
      await store.writeJsonAtomic(filePath, { version: 1, permissions: { allow: [], ask: [], deny: [key], workspace: { additionalDirectories: [] } } })

      const requestAnswers = vi.fn(async () => ({ decision: 'approve' }))
      const userInput: UserInputManager = {
        requestAnswers,
        submitAnswers: () => true,
        reject: () => true,
        rejectAllPending: () => 0,
        clearBufferedAnswers: () => {},
        isPending: () => false,
      }

      const preflight = createSkillPreflight({ fileStore: store, userInput })
      const res = await preflight(
        { id: 't1', name: 'Skill', input: { skill: 'frontend-design' } },
        { cwd: projectDir, agentDepth: 0 },
      )
      expect(res?.is_error).toBe(true)
      expect(res?.content).toContain('Permission denied Skill(frontend-design)')
      expect(requestAnswers).toHaveBeenCalledTimes(0)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('prompts and persists allow when user chooses approve_remember', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-skill-preflight-remember-'))
    try {
      const store = createNodeFileStore()
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(projectDir, { recursive: true })

      const requestAnswers = vi.fn(async () => ({ decision: 'approve_remember' }))
      const userInput: UserInputManager = {
        requestAnswers,
        submitAnswers: () => true,
        reject: () => true,
        rejectAllPending: () => 0,
        clearBufferedAnswers: () => {},
        isPending: () => false,
      }

      const preflight = createSkillPreflight({ fileStore: store, userInput })
      const res = await preflight(
        { id: 't1', name: 'Skill', input: { skill: 'frontend-design' } },
        { cwd: projectDir, agentDepth: 0 },
      )
      expect(res).toBeNull()
      expect(requestAnswers).toHaveBeenCalledTimes(1)

      const filePath = getProjectSettingsLocalPath(projectDir)
      const parsed = JSON.parse(await store.readText(filePath))
      expect(parsed.permissions.allow).toContain(buildSkillPermissionKey('frontend-design'))
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('applies persisted allow immediately (no restart needed)', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-skill-preflight-immediate-'))
    try {
      const store = createNodeFileStore()
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(projectDir, { recursive: true })

      const requestAnswers = vi.fn(async () => ({ decision: 'approve_remember' }))
      const userInput: UserInputManager = {
        requestAnswers,
        submitAnswers: () => true,
        reject: () => true,
        rejectAllPending: () => 0,
        clearBufferedAnswers: () => {},
        isPending: () => false,
      }

      const preflight = createSkillPreflight({ fileStore: store, userInput })
      const first = await preflight(
        { id: 't1', name: 'Skill', input: { skill: 'frontend-design' } },
        { cwd: projectDir, agentDepth: 0 },
      )
      expect(first).toBeNull()
      expect(requestAnswers).toHaveBeenCalledTimes(1)

      const second = await preflight(
        { id: 't2', name: 'Skill', input: { skill: 'frontend-design' } },
        { cwd: projectDir, agentDepth: 0 },
      )
      expect(second).toBeNull()
      expect(requestAnswers).toHaveBeenCalledTimes(1)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('re-prompts immediately after removing allow entry', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-skill-preflight-remove-'))
    try {
      const store = createNodeFileStore()
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(projectDir, { recursive: true })

      const key = buildSkillPermissionKey('frontend-design')
      const filePath = getProjectSettingsLocalPath(projectDir)
      await store.writeJsonAtomic(filePath, { version: 1, permissions: { allow: [key], ask: [], deny: [], workspace: { additionalDirectories: [] } } })

      const requestAnswers = vi.fn(async () => ({ decision: 'approve' }))
      const userInput: UserInputManager = {
        requestAnswers,
        submitAnswers: () => true,
        reject: () => true,
        rejectAllPending: () => 0,
        clearBufferedAnswers: () => {},
        isPending: () => false,
      }

      const preflight = createSkillPreflight({ fileStore: store, userInput })
      const allowed = await preflight(
        { id: 't1', name: 'Skill', input: { skill: 'frontend-design' } },
        { cwd: projectDir, agentDepth: 0 },
      )
      expect(allowed).toBeNull()
      expect(requestAnswers).toHaveBeenCalledTimes(0)

      const parsed = JSON.parse(await store.readText(filePath))
      parsed.permissions.allow = []
      await store.writeJsonAtomic(filePath, parsed)

      const afterRemove = await preflight(
        { id: 't2', name: 'Skill', input: { skill: 'frontend-design' } },
        { cwd: projectDir, agentDepth: 0 },
      )
      expect(afterRemove).toBeNull()
      expect(requestAnswers).toHaveBeenCalledTimes(1)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('returns error tool_result when user provides feedback', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-skill-preflight-feedback-'))
    try {
      const store = createNodeFileStore()
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(projectDir, { recursive: true })

      const userInput: UserInputManager = {
        requestAnswers: async () => ({ decision: 'feedback', feedback: 'no skill' }),
        submitAnswers: () => true,
        reject: () => true,
        rejectAllPending: () => 0,
        clearBufferedAnswers: () => {},
        isPending: () => false,
      }

      const preflight = createSkillPreflight({ fileStore: store, userInput })
      const res = await preflight(
        { id: 't1', name: 'Skill', input: { skill: 'frontend-design' } },
        { cwd: projectDir, agentDepth: 0 },
      )
      expect(res?.is_error).toBe(true)
      expect(res?.content).toContain('Tool use rejected with user message: no skill')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('returns error tool_result when user cancels', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-skill-preflight-cancel-'))
    try {
      const store = createNodeFileStore()
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(projectDir, { recursive: true })

      const userInput: UserInputManager = {
        requestAnswers: async () => ({ decision: 'cancel' }),
        submitAnswers: () => true,
        reject: () => true,
        rejectAllPending: () => 0,
        clearBufferedAnswers: () => {},
        isPending: () => false,
      }

      const preflight = createSkillPreflight({ fileStore: store, userInput })
      const res = await preflight(
        { id: 't1', name: 'Skill', input: { skill: 'frontend-design' } },
        { cwd: projectDir, agentDepth: 0 },
      )
      expect(res?.is_error).toBe(true)
      expect(res?.content).toContain('Tool use rejected by user')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('returns generic rejection when feedback decision has empty feedback text', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-skill-preflight-feedback-empty-'))
    try {
      const store = createNodeFileStore()
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(projectDir, { recursive: true })

      const userInput: UserInputManager = {
        requestAnswers: async () => ({ decision: 'feedback', feedback: '   ' }),
        submitAnswers: () => true,
        reject: () => true,
        rejectAllPending: () => 0,
        clearBufferedAnswers: () => {},
        isPending: () => false,
      }

      const preflight = createSkillPreflight({ fileStore: store, userInput })
      const res = await preflight(
        { id: 't-feedback-empty', name: 'Skill', input: { skill: 'frontend-design' } },
        { cwd: projectDir, agentDepth: 0 },
      )
      expect(res?.is_error).toBe(true)
      expect(res?.content).toBe('Tool use rejected by user.')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('returns generic rejection when approval answer has no decision', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-skill-preflight-no-decision-'))
    try {
      const store = createNodeFileStore()
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(projectDir, { recursive: true })

      const userInput: UserInputManager = {
        requestAnswers: async () => ({}),
        submitAnswers: () => true,
        reject: () => true,
        rejectAllPending: () => 0,
        clearBufferedAnswers: () => {},
        isPending: () => false,
      }

      const preflight = createSkillPreflight({ fileStore: store, userInput })
      const res = await preflight(
        { id: 't-no-decision', name: 'Skill', input: { skill: 'frontend-design' } },
        { cwd: projectDir, agentDepth: 0 },
      )
      expect(res?.is_error).toBe(true)
      expect(res?.content).toBe('Tool use rejected by user.')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('returns parse errors for invalid Skill input', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-skill-preflight-parse-error-'))
    try {
      const store = createNodeFileStore()
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(projectDir, { recursive: true })

      const preflight = createSkillPreflight({ fileStore: store, userInput: null })
      const res = await preflight(
        { id: 't-parse', name: 'Skill', input: { skill: 'frontend-design', extra: true } as any },
        { cwd: projectDir, agentDepth: 0 },
      )

      expect(res?.is_error).toBe(true)
      expect(res?.content).toContain('unknown field')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('returns missing-skill error for empty or non-string skill input', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-skill-preflight-missing-skill-'))
    try {
      const store = createNodeFileStore()
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(projectDir, { recursive: true })

      const preflight = createSkillPreflight({ fileStore: store, userInput: null })
      const emptyResult = await preflight(
        { id: 't-empty', name: 'Skill', input: { skill: '   ' } },
        { cwd: projectDir, agentDepth: 0 },
      )
      expect(emptyResult?.is_error).toBe(true)
      expect(emptyResult?.content).toContain('Missing skill')

      const nonStringResult = await preflight(
        { id: 't-non-string', name: 'Skill', input: { skill: 123 } as any },
        { cwd: projectDir, agentDepth: 0 },
      )
      expect(nonStringResult?.is_error).toBe(true)
      expect(nonStringResult?.content).toContain('Missing skill')

      const missingInputResult = await preflight(
        { id: 't-missing-input', name: 'Skill' } as any,
        { cwd: projectDir, agentDepth: 0 },
      )
      expect(missingInputResult?.is_error).toBe(true)
      expect(missingInputResult?.content).toContain('Missing skill')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('returns parse errors for non-Error throwables', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-skill-preflight-parse-non-error-'))
    try {
      const store = createNodeFileStore()
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(projectDir, { recursive: true })

      const input: any = {}
      Object.defineProperty(input, 'skill', {
        get() {
          throw 'boom'
        },
      })
      const preflight = createSkillPreflight({ fileStore: store, userInput: null })
      const res = await preflight(
        { id: 't-parse-non-error', name: 'Skill', input } as any,
        { cwd: projectDir, agentDepth: 0 },
      )

      expect(res?.is_error).toBe(true)
      expect(res?.content).toContain('Error: boom')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('returns Request aborted when signal is already aborted', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-skill-preflight-abort-'))
    try {
      const store = createNodeFileStore()
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(projectDir, { recursive: true })

      const userInput: UserInputManager = {
        requestAnswers: async () => ({ decision: 'approve' }),
        submitAnswers: () => true,
        reject: () => true,
        rejectAllPending: () => 0,
        clearBufferedAnswers: () => {},
        isPending: () => false,
      }
      const controller = new AbortController()
      controller.abort()

      const preflight = createSkillPreflight({ fileStore: store, userInput })
      const res = await preflight(
        { id: 't-abort', name: 'Skill', input: { skill: 'frontend-design' } },
        { cwd: projectDir, agentDepth: 0, signal: controller.signal },
      )

      expect(res?.is_error).toBe(true)
      expect(res?.content).toBe('Request aborted')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('returns error when requestAnswers throws non-Error', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-skill-preflight-request-non-error-'))
    try {
      const store = createNodeFileStore()
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(projectDir, { recursive: true })

      const userInput: UserInputManager = {
        requestAnswers: async () => {
          throw 'boom'
        },
        submitAnswers: () => true,
        reject: () => true,
        rejectAllPending: () => 0,
        clearBufferedAnswers: () => {},
        isPending: () => false,
      }

      const preflight = createSkillPreflight({ fileStore: store, userInput })
      const res = await preflight(
        { id: 't-request-non-error', name: 'Skill', input: { skill: 'frontend-design' } },
        { cwd: projectDir, agentDepth: 0 },
      )

      expect(res?.is_error).toBe(true)
      expect(res?.content).toContain('Error: boom')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('returns error when requestAnswers throws Error', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-skill-preflight-request-error-'))
    try {
      const store = createNodeFileStore()
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(projectDir, { recursive: true })

      const userInput: UserInputManager = {
        requestAnswers: async () => {
          throw new Error('kaput')
        },
        submitAnswers: () => true,
        reject: () => true,
        rejectAllPending: () => 0,
        clearBufferedAnswers: () => {},
        isPending: () => false,
      }

      const preflight = createSkillPreflight({ fileStore: store, userInput })
      const res = await preflight(
        { id: 't-request-error', name: 'Skill', input: { skill: 'frontend-design' } },
        { cwd: projectDir, agentDepth: 0 },
      )

      expect(res?.is_error).toBe(true)
      expect(res?.content).toContain('Error: kaput')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('returns save error when approve_remember persistence fails', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-skill-preflight-save-fail-'))
    try {
      const baseStore = createNodeFileStore()
      const store = {
        ...baseStore,
        async writeJsonAtomic() {
          throw new Error('disk failed')
        },
      }
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(projectDir, { recursive: true })

      const userInput: UserInputManager = {
        requestAnswers: async () => ({ decision: 'approve_remember' }),
        submitAnswers: () => true,
        reject: () => true,
        rejectAllPending: () => 0,
        clearBufferedAnswers: () => {},
        isPending: () => false,
      }

      const preflight = createSkillPreflight({ fileStore: store as any, userInput })
      const res = await preflight(
        { id: 't-save-fail', name: 'Skill', input: { skill: 'frontend-design' } },
        { cwd: projectDir, agentDepth: 0 },
      )

      expect(res?.is_error).toBe(true)
      expect(res?.content).toContain('Failed to save settings.local.json: disk failed')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('returns save error when approve_remember persistence throws non-Error', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-skill-preflight-save-fail-non-error-'))
    try {
      const baseStore = createNodeFileStore()
      const store = {
        ...baseStore,
        async writeJsonAtomic() {
          throw 'disk down'
        },
      }
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(projectDir, { recursive: true })

      const userInput: UserInputManager = {
        requestAnswers: async () => ({ decision: 'approve_remember' }),
        submitAnswers: () => true,
        reject: () => true,
        rejectAllPending: () => 0,
        clearBufferedAnswers: () => {},
        isPending: () => false,
      }

      const preflight = createSkillPreflight({ fileStore: store as any, userInput })
      const res = await preflight(
        { id: 't-save-fail-non-error', name: 'Skill', input: { skill: 'frontend-design' } },
        { cwd: projectDir, agentDepth: 0 },
      )

      expect(res?.is_error).toBe(true)
      expect(res?.content).toContain('Failed to save settings.local.json: disk down')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('falls back to process.cwd() when ctx.cwd is missing', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-skill-preflight-cwd-fallback-'))
    const previousCwd = process.cwd()
    try {
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(projectDir, { recursive: true })
      process.chdir(projectDir)

      const store = createNodeFileStore()
      const key = buildSkillPermissionKey('frontend-design')
      const filePath = getProjectSettingsLocalPath(projectDir)
      await store.writeJsonAtomic(filePath, {
        version: 1,
        permissions: { allow: [key], ask: [], deny: [], workspace: { additionalDirectories: [] } },
      })

      const preflight = createSkillPreflight({ fileStore: store, userInput: null })
      const res = await preflight(
        { id: 't-cwd-fallback', name: 'Skill', input: { skill: 'frontend-design' } },
        { cwd: process.cwd(), agentDepth: 0 },
      )
      expect(res).toBeNull()
    } finally {
      process.chdir(previousCwd)
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
