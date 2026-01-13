import { describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createNodeFileStore } from '../../adapters/fs/nodeFileStore.js'
import { createApprovalService, type ApprovalService } from './approvalService.js'
import { createPolicyPreflight } from './policyPreflight.js'

describe('createPolicyPreflight', () => {
  it('denies WebFetch by default when no rules exist', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })

      const preflight = createPolicyPreflight({
        fileStore: store,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })

      const res = await preflight(
        {
          id: 't1',
          name: 'WebFetch',
          input: { url: 'https://example.com', prompt: 'summarize' },
        },
        { cwd: projectDir, agentDepth: 0 },
      )

      expect(res?.is_error).toBe(true)
      expect(res?.content).toContain('Policy denied net.fetch')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('allows WebFetch when an allow rule matches', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-allow-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })

      await store.writeJsonAtomic(path.join(globalConfigDir, 'rules.json'), {
        version: 1,
        rules: [
          {
            ruleId: 'allow-net',
            createdAt: '2026-01-01T00:00:00Z',
            scope: 'global',
            decision: 'allow',
            match: { kind: 'net.fetch', urlPrefix: 'https://' },
          },
        ],
      })

      const preflight = createPolicyPreflight({
        fileStore: store,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })

      const res = await preflight(
        {
          id: 't1',
          name: 'WebFetch',
          input: { url: 'https://example.com', prompt: 'summarize' },
        },
        { cwd: projectDir, agentDepth: 0 },
      )

      expect(res).toBeNull()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('requires an approval service for default fs.write prompts', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-write-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })

      const withoutApproval = createPolicyPreflight({
        fileStore: store,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })

      const res = await withoutApproval(
        {
          id: 't1',
          name: 'Write',
          input: { file_path: path.join(projectDir, 'a.txt'), content: 'hi' },
        },
        { cwd: projectDir, agentDepth: 0 },
      )

      expect(res?.is_error).toBe(true)
      expect(res?.content).toContain('Policy requires approval for fs.write')
      expect(res?.content).toContain('APPROVAL_REQUIRED')
      expect(res?.content).toContain('EffectiveDecision: prompt')
      expect(res?.content).toContain('PolicyDecision: prompt')

      const approval: ApprovalService = {
        getSessionRules: () => [],
        ensureApproved: async () => ({ ok: true }),
      }
      const withApproval = createPolicyPreflight({
        fileStore: store,
        approval,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })
      const allowed = await withApproval(
        {
          id: 't2',
          name: 'Write',
          input: { file_path: path.join(projectDir, 'b.txt'), content: 'hi' },
        },
        { cwd: projectDir, agentDepth: 0 },
      )
      expect(allowed).toBeNull()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('can prompt for Glob/Grep when a matching fs.read rule requires approval', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-read-prompt-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })

      await store.writeJsonAtomic(path.join(globalConfigDir, 'rules.json'), {
        version: 1,
        rules: [
          {
            ruleId: 'prompt-read',
            createdAt: '2026-01-01T00:00:00Z',
            scope: 'global',
            decision: 'prompt',
            match: { kind: 'fs.read', path: projectDir },
          },
        ],
      })

      const withoutApproval = createPolicyPreflight({
        fileStore: store,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })

      const res1 = await withoutApproval(
        { id: 't1', name: 'Glob', input: { pattern: '**/*', path: projectDir } },
        { cwd: projectDir, agentDepth: 0 },
      )
      expect(res1?.is_error).toBe(true)
      expect(res1?.content).toContain('Policy requires approval for fs.read')
      expect(res1?.content).toContain('MatchedRule: prompt-read (global)')

      const approval: ApprovalService = {
        getSessionRules: () => [],
        ensureApproved: async () => ({ ok: true }),
      }
      const withApproval = createPolicyPreflight({
        fileStore: store,
        approval,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })

      const res2 = await withApproval(
        { id: 't2', name: 'Grep', input: { pattern: 'x', path: projectDir } },
        { cwd: projectDir, agentDepth: 0 },
      )
      expect(res2).toBeNull()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('persists allow rules when approval is remembered for project scope', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-remember-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })

      const approval = createApprovalService({
        fileStore: store,
        userInput: {
          requestAnswers: async () => ({ decision: 'approve_remember', scope: 'project' }),
          submitAnswers: () => true,
          reject: () => true,
          isPending: () => false,
        },
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })

      const withApproval = createPolicyPreflight({
        fileStore: store,
        approval,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })

      const targetPath = path.join(projectDir, 'remember.txt')
      const res = await withApproval(
        { id: 't1', name: 'Write', input: { file_path: targetPath, content: 'hi' } },
        { cwd: projectDir, agentDepth: 0, replMode: 'normal' },
      )
      expect(res).toBeNull()

      const rulesPath = path.join(projectDir, '.formax', 'rules.json')
      const json = JSON.parse(await fs.readFile(rulesPath, 'utf8'))
      expect(json.version).toBe(1)
      expect(Array.isArray(json.rules)).toBe(true)
      expect(json.rules.length).toBe(1)
      expect(json.rules[0].scope).toBe('project')
      expect(json.rules[0].decision).toBe('allow')
      expect(json.rules[0].match.kind).toBe('fs.write')
      expect(json.rules[0].match.path).toBe(targetPath)

      const withoutApproval = createPolicyPreflight({
        fileStore: store,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })
      const res2 = await withoutApproval(
        { id: 't2', name: 'Write', input: { file_path: targetPath, content: 'hi' } },
        { cwd: projectDir, agentDepth: 0, replMode: 'normal' },
      )
      expect(res2).toBeNull()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('treats fs.write prompts as allowed in acceptEdits mode', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-write-accept-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })

      const preflight = createPolicyPreflight({
        fileStore: store,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })

      const res = await preflight(
        {
          id: 't1',
          name: 'Write',
          input: { file_path: path.join(projectDir, 'a.txt'), content: 'hi' },
        },
        { cwd: projectDir, agentDepth: 0, replMode: 'acceptEdits' },
      )

      expect(res).toBeNull()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('requires an approval service for risky Bash commands', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-bash-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })

      const preflight = createPolicyPreflight({
        fileStore: store,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })

      const res = await preflight(
        { id: 't1', name: 'Bash', input: { command: 'mkdir foo' } },
        { cwd: projectDir, agentDepth: 0, replMode: 'normal' },
      )

      expect(res?.is_error).toBe(true)
      expect(res?.content).toContain('Policy requires approval for bash.exec')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('does not require approval service for safe Bash commands', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-bash-safe-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })

      const preflight = createPolicyPreflight({
        fileStore: store,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })

      const res = await preflight(
        { id: 't1', name: 'Bash', input: { command: 'tree -L 1 .' } },
        { cwd: projectDir, agentDepth: 0, replMode: 'normal' },
      )

      expect(res).toBeNull()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('denies prompts when interactive prompts are disabled (e.g. background tasks)', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-noninteractive-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })

      const approval: ApprovalService = {
        getSessionRules: () => [],
        ensureApproved: async () => ({ ok: true }),
      }
      const preflight = createPolicyPreflight({
        fileStore: store,
        approval,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })

      const res = await preflight(
        { id: 't1', name: 'Write', input: { file_path: path.join(projectDir, 'a.txt'), content: 'hi' } },
        { cwd: projectDir, agentDepth: 1, replMode: 'normal', interactive: false },
      )

      expect(res?.is_error).toBe(true)
      expect(res?.content).toContain('interactive prompts are disabled')
      expect(res?.content).toContain('APPROVAL_REQUIRED')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('allows sub-agents to request approvals when interactive', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-subagent-approve-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })

      const approval: ApprovalService = {
        getSessionRules: () => [],
        ensureApproved: async () => ({ ok: true }),
      }
      const preflight = createPolicyPreflight({
        fileStore: store,
        approval,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })

      const res = await preflight(
        { id: 't1', name: 'Write', input: { file_path: path.join(projectDir, 'a.txt'), content: 'hi' } },
        { cwd: projectDir, agentDepth: 1, replMode: 'normal', interactive: true },
      )

      expect(res).toBeNull()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
