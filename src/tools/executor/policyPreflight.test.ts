import { describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createNodeFileStore } from '../../adapters/fs/nodeFileStore.js'
import { createApprovalService, type ApprovalService } from './approvalService.js'
import { createPolicyPreflight } from './policyPreflight.js'
import { loadProjectPermissionsAllowList } from '../../adapters/permissions/permissionsStore.js'

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

  it('allows WebFetch when permissions allow the tool', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-perm-allow-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })
      await fs.mkdir(path.join(projectDir, '.formax'), { recursive: true })

      await store.writeJsonAtomic(path.join(projectDir, '.formax', 'settings.local.json'), {
        version: 1,
        permissions: {
          allow: ['WebFetch'],
          ask: [],
          deny: [],
          workspace: { additionalDirectories: [] },
        },
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

  it('denies WebFetch when permissions deny the tool', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-perm-deny-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })
      await fs.mkdir(path.join(projectDir, '.formax'), { recursive: true })

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

      await store.writeJsonAtomic(path.join(projectDir, '.formax', 'settings.local.json'), {
        version: 1,
        permissions: {
          allow: [],
          ask: [],
          deny: ['WebFetch'],
          workspace: { additionalDirectories: [] },
        },
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

      expect(res?.is_error).toBe(true)
      expect(res?.content).toContain('Permission denied WebFetch')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('blocks fs.read outside workspace roots', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-workspace-read-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      const outsideDir = path.join(dir, 'outside')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })
      await fs.mkdir(outsideDir, { recursive: true })

      const preflight = createPolicyPreflight({
        fileStore: store,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })

      const res = await preflight(
        {
          id: 't1',
          name: 'Read',
          input: { file_path: path.join(outsideDir, 'a.txt') },
        },
        { cwd: projectDir, agentDepth: 0 },
      )

      expect(res?.is_error).toBe(true)
      expect(res?.content).toContain('outside the workspace')
      expect(res?.content).toContain('Path:')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('allows fs.read within additional workspace directories', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-workspace-allow-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      const outsideDir = path.join(dir, 'outside')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(path.join(projectDir, '.formax'), { recursive: true })
      await fs.mkdir(outsideDir, { recursive: true })

      await store.writeJsonAtomic(path.join(projectDir, '.formax', 'settings.local.json'), {
        version: 1,
        permissions: {
          allow: [],
          ask: [],
          deny: [],
          workspace: { additionalDirectories: [outsideDir] },
        },
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
          name: 'Read',
          input: { file_path: path.join(outsideDir, 'a.txt') },
        },
        { cwd: projectDir, agentDepth: 0 },
      )

      expect(res).toBeNull()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('blocks fs.write outside workspace roots before approval', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-workspace-write-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      const outsideDir = path.join(dir, 'outside')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })
      await fs.mkdir(outsideDir, { recursive: true })

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
          input: { file_path: path.join(outsideDir, 'a.txt'), content: 'hi' },
        },
        { cwd: projectDir, agentDepth: 0 },
      )

      expect(res?.is_error).toBe(true)
      expect(res?.content).toContain('outside the workspace')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('blocks non-plan file writes during plan mode with a stable error code', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-plan-mode-'))
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
          input: { file_path: path.join(projectDir, 'other.md'), content: 'hi' },
        },
        { cwd: projectDir, agentDepth: 0, replMode: 'plan', planPath: path.join(projectDir, 'PLAN.md') },
      )

      expect(res?.is_error).toBe(true)
      expect(res?.content).toContain('Plan mode is active')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('denies disallowed Bash commands with a stable error code', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-bash-empty-'))
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
        { id: 't1', name: 'Bash', input: { command: 'sudo ls' } },
        { cwd: projectDir, agentDepth: 0 },
      )

      expect(res?.is_error).toBe(true)
      expect(res?.content).toContain('Bash command denied')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('blocks workspace escape via symlink for fs.read', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-workspace-symlink-read-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      const outsideDir = path.join(dir, 'outside')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })
      await fs.mkdir(outsideDir, { recursive: true })
      await fs.writeFile(path.join(outsideDir, 'a.txt'), 'hi')
      await fs.symlink(outsideDir, path.join(projectDir, 'link'), 'dir')

      const preflight = createPolicyPreflight({
        fileStore: store,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })

      const res = await preflight(
        {
          id: 't1',
          name: 'Read',
          input: { file_path: path.join(projectDir, 'link', 'a.txt') },
        },
        { cwd: projectDir, agentDepth: 0 },
      )

      expect(res?.is_error).toBe(true)
      expect(res?.content).toContain('outside the workspace')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('blocks workspace escape via symlink for fs.write', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-workspace-symlink-write-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      const outsideDir = path.join(dir, 'outside')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })
      await fs.mkdir(outsideDir, { recursive: true })
      await fs.symlink(outsideDir, path.join(projectDir, 'link'), 'dir')

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
          input: { file_path: path.join(projectDir, 'link', 'b.txt'), content: 'hi' },
        },
        { cwd: projectDir, agentDepth: 0 },
      )

      expect(res?.is_error).toBe(true)
      expect(res?.content).toContain('outside the workspace')
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
      expect(res?.content).toContain('Approval required for fs.write')

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
      expect(res1?.content).toContain('Approval required for fs.read')

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

  it('stores Bash remembers in permissions.allow and bypasses prompts when allowed', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-remember-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })
      await fs.mkdir(path.join(projectDir, '.formax'), { recursive: true })

      const approval = createApprovalService({
        fileStore: store,
        userInput: {
          requestAnswers: async () => ({ decision: 'approve_remember', scope: 'project' }),
          submitAnswers: () => true,
          reject: () => true,
          rejectAllPending: () => 0,
          clearBufferedAnswers: () => {},
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

      const command = 'mkdir foo'
      const res = await withApproval(
        { id: 't1', name: 'Bash', input: { command } },
        { cwd: projectDir, agentDepth: 0, replMode: 'normal' },
      )
      expect(res).toBeNull()

      const allow = await loadProjectPermissionsAllowList({ fileStore: store, cwd: projectDir })
      expect(allow.has(`Bash(${command})`)).toBe(true)

      const withoutApproval = createPolicyPreflight({
        fileStore: store,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })
      const res2 = await withoutApproval(
        { id: 't2', name: 'Bash', input: { command } },
        { cwd: projectDir, agentDepth: 0, replMode: 'normal' },
      )
      expect(res2).toBeNull()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('applies Bash permission changes immediately within the same session', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-bash-immediate-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })
      await fs.mkdir(path.join(projectDir, '.formax'), { recursive: true })

      const approval = createApprovalService({
        fileStore: store,
        userInput: {
          requestAnswers: async () => ({ decision: 'approve_remember', scope: 'project' }),
          submitAnswers: () => true,
          reject: () => true,
          rejectAllPending: () => 0,
          clearBufferedAnswers: () => {},
          isPending: () => false,
        },
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })

      const preflight = createPolicyPreflight({
        fileStore: store,
        approval,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })

      const command = 'mkdir foo'
      const res1 = await preflight(
        { id: 't1', name: 'Bash', input: { command } },
        { cwd: projectDir, agentDepth: 0, replMode: 'normal' },
      )
      expect(res1).toBeNull()

      const res2 = await preflight(
        { id: 't2', name: 'Bash', input: { command } },
        { cwd: projectDir, agentDepth: 0, replMode: 'normal', interactive: false },
      )
      expect(res2).toBeNull()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('does not bypass an explicit prompt rule even if Bash is in permissions.allow', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-bash-ask-overrides-allow-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })
      await fs.mkdir(path.join(projectDir, '.formax'), { recursive: true })

      await store.writeJsonAtomic(path.join(globalConfigDir, 'rules.json'), {
        version: 1,
        rules: [
          {
            ruleId: 'ask-mkdir',
            createdAt: '2026-01-01T00:00:00Z',
            scope: 'global',
            decision: 'prompt',
            match: { kind: 'bash.exec', commandPrefix: 'mkdir' },
          },
        ],
      })

      await store.writeJsonAtomic(path.join(projectDir, '.formax', 'settings.local.json'), {
        version: 1,
        permissions: { allow: ['Bash(mkdir foo)'] },
      })

      const preflight = createPolicyPreflight({
        fileStore: store,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })

      const res = await preflight(
        { id: 't1', name: 'Bash', input: { command: 'mkdir foo' } },
        { cwd: projectDir, agentDepth: 0, replMode: 'normal', interactive: false },
      )

      expect(res?.is_error).toBe(true)
      expect(res?.content).toContain('Approval required for bash.exec')
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
      expect(res?.content).toContain('Approval required for bash.exec')
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
        { cwd: projectDir, agentDepth: 0, replMode: 'normal', interactive: false },
      )

      expect(res?.is_error).toBe(true)
      expect(res?.content).toContain('Approval required for fs.write')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('denies prompts in sub-agents even when interactive', async () => {
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

      expect(res?.is_error).toBe(true)
      expect(res?.content).toContain('Approval required')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('treats fs.write remembers as accept-edits mode (no permissions.allow persistence)', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-write-permissions-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(path.join(projectDir, '.formax'), { recursive: true })

      const filePath = path.join(projectDir, 'a.txt')

      let mode: any = 'normal'
      const userInput = {
        requestAnswers: async () => ({ decision: 'approve_remember' }),
        submitAnswers: () => true,
        reject: () => true,
        rejectAllPending: () => 0,
        clearBufferedAnswers: () => {},
        isPending: () => true,
      }

      const approval = createApprovalService({ fileStore: store, userInput: userInput as any })
      const preflight = createPolicyPreflight({
        fileStore: store,
        approval,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })

      const first = await preflight(
        { id: 't1', name: 'Write', input: { file_path: filePath, content: 'hi' } },
        {
          cwd: projectDir,
          agentDepth: 0,
          replMode: 'normal',
          getReplMode: () => mode,
          setReplMode: (m) => {
            mode = m
          },
          interactive: true,
        },
      )
      expect(first).toBeNull()

      const allow = await loadProjectPermissionsAllowList({ fileStore: store, cwd: projectDir })
      expect(Array.from(allow)).toEqual([])

      // Once remembered, a non-interactive context should still be able to proceed
      // because accept-edits mode no longer prompts for fs.write.
      const second = await preflight(
        { id: 't2', name: 'Write', input: { file_path: filePath, content: 'hi again' } },
        {
          cwd: projectDir,
          agentDepth: 0,
          replMode: 'normal',
          getReplMode: () => mode,
          setReplMode: (m) => {
            mode = m
          },
          interactive: false,
        },
      )
      expect(second).toBeNull()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
