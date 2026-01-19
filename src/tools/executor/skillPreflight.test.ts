import { describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createNodeFileStore } from '../../adapters/fs/nodeFileStore.js'
import type { UserInputManager } from '../runtime/userInputManager.js'
import { buildSkillPermissionKey, getProjectSettingsLocalPath } from '../../adapters/permissions/skillAllowList.js'
import { createSkillPreflight } from './skillPreflight.js'

describe('createSkillPreflight', () => {
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
      expect(res?.content).toContain('Sub-agents cannot request approvals')
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
        isPending: () => false,
      }

      const preflight = createSkillPreflight({ fileStore: store, userInput })
      const res = await preflight(
        { id: 't1', name: 'Skill', input: { skill: 'frontend-design' } },
        { cwd: projectDir, agentDepth: 0, interactive: false },
      )

      expect(res?.is_error).toBe(true)
      expect(res?.content).toContain('interactive prompts are disabled')
    } finally {
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
        isPending: () => false,
      }

      const preflight = createSkillPreflight({ fileStore: store, userInput })
      const res = await preflight(
        { id: 't1', name: 'Skill', input: { skill: 'frontend-design' } },
        { cwd: projectDir, agentDepth: 0 },
      )
      expect(res?.is_error).toBe(true)
      expect(res?.content).toContain('Permission denied Skill(frontend-design)')
      expect(res?.content).toContain('PermissionDecision: deny')
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
})
