import { describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createNodeFileStore } from '../../adapters/fs/nodeFileStore.js'
import { createApprovalService, type ApprovalService } from './approvalService.js'
import { createPolicyPreflight } from './policyPreflight.js'
import * as ripgrepBinary from '../modules/grep/ripgrepBinary.js'
import { loadProjectPermissionsAllowList } from '../../adapters/permissions/permissionsStore.js'
import {
  addWorkspaceSessionDirectory,
  listWorkspaceSessionDirectories,
  resetWorkspaceSessionForTests,
} from '../../adapters/permissions/workspaceSession.js'
import { createUserInputManager } from '../runtime/userInputManager.js'
import type { HooksRuntime } from '../../hooks/runtime.js'
import type { AuditEventV1 } from '../../core/audit/schema.js'
import { buildAutoMemoryDirectoryPath } from '../../shared/utils/autoMemoryPath.js'

const KNOWN_MCP_TOOL_NAMES = new Set([
  'mcp__github__create_issue',
  'mcp__github__delete_repo',
  'mcp__linear__create_issue',
])

const isKnownMcpToolNameForTest = (toolName: string): boolean => KNOWN_MCP_TOOL_NAMES.has(toolName)

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
        isKnownMcpToolName: isKnownMcpToolNameForTest,
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

  it('prompts MCP tool calls by fully-qualified tool name in the interactive main path', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-mcp-prompt-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })
      const onEvent = vi.fn()
      const auditEntries: any[] = []
      const userInput = {
        requestAnswers: vi.fn(async () => ({ decision: 'approve' })),
      } as any
      const approval = createApprovalService({ fileStore: store, userInput })
      const preflight = createPolicyPreflight({
        fileStore: store,
        approval,
        audit: { append: async (entry) => void auditEntries.push(entry) } as any,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
        isKnownMcpToolName: isKnownMcpToolNameForTest,
      })

      const res = await preflight(
        {
          id: 'mcp-1',
          name: 'mcp__github__create_issue',
          input: { title: 'A' },
        },
        { cwd: projectDir, agentDepth: 0, onEvent },
      )

      expect(res).toBeNull()
      expect(userInput.requestAnswers).toHaveBeenCalledTimes(1)
      expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
        type: 'approval_request',
        toolUseId: 'mcp-1',
        toolName: 'mcp__github__create_issue',
        action: { kind: 'tool.name', toolName: 'mcp__github__create_issue', input: { title: 'A' } },
      }))
      expect(auditEntries).toContainEqual(expect.objectContaining({
        kind: 'policy.decision',
        tool: { name: 'mcp__github__create_issue', toolUseId: 'mcp-1' },
        action: { kind: 'tool.name', toolName: 'mcp__github__create_issue', input: { title: 'A' } },
        decision: expect.objectContaining({
          raw: 'prompt',
          effective: 'prompt',
          suggestions: [],
        }),
      }))
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects unknown MCP tool names before hooks or approval UI', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-mcp-unknown-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })
      const userInput = {
        requestAnswers: vi.fn(async () => ({ decision: 'approve' })),
      } as any
      const permissionRequest = vi.fn(async () => ({
        runs: [],
        blocked: false,
      }))
      const preflight = createPolicyPreflight({
        fileStore: store,
        approval: createApprovalService({ fileStore: store, userInput }),
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
        isKnownMcpToolName: () => false,
      })

      const res = await preflight(
        { id: 'mcp-unknown', name: 'mcp__github__missing_tool', input: { title: 'A' } },
        {
          cwd: projectDir,
          agentDepth: 0,
          onEvent: () => {},
          hooks: { runPermissionRequest: permissionRequest } as any as HooksRuntime,
        },
      )

      expect(res).toEqual({
        tool_use_id: 'mcp-unknown',
        content: 'Error: Unknown MCP tool: mcp__github__missing_tool',
        is_error: true,
      })
      expect(permissionRequest).not.toHaveBeenCalled()
      expect(userInput.requestAnswers).not.toHaveBeenCalled()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('remembers MCP approvals by exact tool name for the session, not arguments', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-mcp-session-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })
      const userInput = {
        requestAnswers: vi.fn(async () => ({ decision: 'approve_remember', scope: 'session' })),
      } as any
      const approval = createApprovalService({ fileStore: store, userInput })
      const preflight = createPolicyPreflight({
        fileStore: store,
        approval,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
        isKnownMcpToolName: isKnownMcpToolNameForTest,
      })

      await expect(preflight(
        { id: 'mcp-1', name: 'mcp__github__create_issue', input: { title: 'A' } },
        { cwd: projectDir, agentDepth: 0, onEvent: () => {} },
      )).resolves.toBeNull()
      await expect(preflight(
        { id: 'mcp-2', name: 'mcp__github__create_issue', input: { title: 'B' } },
        { cwd: projectDir, agentDepth: 0, onEvent: () => {} },
      )).resolves.toBeNull()

      expect(userInput.requestAnswers).toHaveBeenCalledTimes(1)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('keeps broader MCP ask rules ahead of exact session allows', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-mcp-session-ask-'))
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
          ask: ['mcp__github__*'],
          deny: ['mcp__github__delete_repo'],
          workspace: { additionalDirectories: [] },
        },
      })
      const userInput = {
        requestAnswers: vi.fn(async () => ({ decision: 'approve_remember', scope: 'session' })),
      } as any
      const approval = createApprovalService({ fileStore: store, userInput })
      const preflight = createPolicyPreflight({
        fileStore: store,
        approval,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
        isKnownMcpToolName: isKnownMcpToolNameForTest,
      })

      await expect(preflight(
        { id: 'mcp-1', name: 'mcp__github__create_issue', input: { title: 'A' } },
        { cwd: projectDir, agentDepth: 0, onEvent: () => {} },
      )).resolves.toBeNull()
      await expect(preflight(
        { id: 'mcp-2', name: 'mcp__github__create_issue', input: { title: 'B' } },
        { cwd: projectDir, agentDepth: 0, onEvent: () => {} },
      )).resolves.toBeNull()
      const denied = await preflight(
        { id: 'mcp-3', name: 'mcp__github__delete_repo', input: {} },
        { cwd: projectDir, agentDepth: 0, onEvent: () => {} },
      )

      expect(userInput.requestAnswers).toHaveBeenCalledTimes(2)
      expect(denied?.is_error).toBe(true)
      expect(denied?.content).toContain('Permission denied mcp__github__delete_repo')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('keeps broader MCP ask rules ahead of persisted exact allows', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-mcp-persisted-allow-'))
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
          allow: ['mcp__github__create_issue'],
          ask: ['mcp__github__*'],
          deny: ['mcp__github__delete_repo'],
          workspace: { additionalDirectories: [] },
        },
      })
      const userInput = {
        requestAnswers: vi.fn(async () => ({ decision: 'approve' })),
      } as any
      const preflight = createPolicyPreflight({
        fileStore: store,
        approval: createApprovalService({ fileStore: store, userInput }),
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
        isKnownMcpToolName: isKnownMcpToolNameForTest,
      })

      await expect(preflight(
        { id: 'mcp-1', name: 'mcp__github__create_issue', input: { title: 'A' } },
        { cwd: projectDir, agentDepth: 0, onEvent: () => {} },
      )).resolves.toBeNull()
      const denied = await preflight(
        { id: 'mcp-2', name: 'mcp__github__delete_repo', input: {} },
        { cwd: projectDir, agentDepth: 0, onEvent: () => {} },
      )

      expect(userInput.requestAnswers).toHaveBeenCalledTimes(1)
      expect(denied?.is_error).toBe(true)
      expect(denied?.content).toContain('Permission denied mcp__github__delete_repo')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('applies MCP permission rules using deny > ask > allow precedence', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-mcp-perms-'))
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
          allow: ['mcp__github__create_issue'],
          ask: ['mcp__github__*'],
          deny: ['mcp__github'],
          workspace: { additionalDirectories: [] },
        },
      })
      const userInput = {
        requestAnswers: vi.fn(async () => ({ decision: 'approve' })),
      } as any
      const preflight = createPolicyPreflight({
        fileStore: store,
        approval: createApprovalService({ fileStore: store, userInput }),
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
        isKnownMcpToolName: isKnownMcpToolNameForTest,
      })

      const res = await preflight(
        { id: 'mcp-1', name: 'mcp__github__create_issue', input: { title: 'A' } },
        { cwd: projectDir, agentDepth: 0 },
      )

      expect(res?.is_error).toBe(true)
      expect(res?.content).toContain('Permission denied mcp__github__create_issue')
      expect(userInput.requestAnswers).not.toHaveBeenCalled()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('allows MCP server-level and wildcard rules without prompting', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-mcp-allow-'))
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
          allow: ['mcp__github', 'mcp__linear__*'],
          ask: [],
          deny: [],
          workspace: { additionalDirectories: [] },
        },
      })
      const userInput = {
        requestAnswers: vi.fn(async () => ({ decision: 'approve' })),
      } as any
      const preflight = createPolicyPreflight({
        fileStore: store,
        approval: createApprovalService({ fileStore: store, userInput }),
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
        isKnownMcpToolName: isKnownMcpToolNameForTest,
      })

      await expect(preflight(
        { id: 'mcp-1', name: 'mcp__github__create_issue', input: {} },
        { cwd: projectDir, agentDepth: 0 },
      )).resolves.toBeNull()
      await expect(preflight(
        { id: 'mcp-2', name: 'mcp__linear__create_issue', input: {} },
        { cwd: projectDir, agentDepth: 0 },
      )).resolves.toBeNull()
      expect(userInput.requestAnswers).not.toHaveBeenCalled()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('denies MCP prompts in subagents and non-interactive contexts', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-mcp-deny-'))
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
        isKnownMcpToolName: isKnownMcpToolNameForTest,
      })

      const subagent = await preflight(
        { id: 'mcp-1', name: 'mcp__github__create_issue', input: {} },
        { cwd: projectDir, agentDepth: 1 },
      )
      const nonInteractive = await preflight(
        { id: 'mcp-2', name: 'mcp__github__create_issue', input: {} },
        { cwd: projectDir, agentDepth: 0, interactive: false },
      )

      expect(subagent?.content).toBe('Error: Approval required')
      expect(nonInteractive?.content).toBe('Error: Approval required for mcp__github__create_issue')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('blocks MCP tools in plan mode because Phase 1A cannot classify their filesystem effects', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-mcp-plan-mode-'))
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
          allow: ['mcp__github__create_issue'],
          ask: [],
          deny: [],
          workspace: { additionalDirectories: [] },
        },
      })
      const userInput = {
        requestAnswers: vi.fn(async () => ({ decision: 'approve' })),
      } as any
      const preflight = createPolicyPreflight({
        fileStore: store,
        approval: createApprovalService({ fileStore: store, userInput }),
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
        isKnownMcpToolName: isKnownMcpToolNameForTest,
      })

      const res = await preflight(
        { id: 'mcp-plan', name: 'mcp__github__create_issue', input: { title: 'A' } },
        { cwd: projectDir, agentDepth: 0, replMode: 'plan' },
      )

      expect(res?.is_error).toBe(true)
      expect(res?.content).toContain('Plan mode is active. MCP tools are unavailable.')
      expect(userInput.requestAnswers).not.toHaveBeenCalled()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('runs PermissionRequest hooks with full MCP tool names before approval UI', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-mcp-hook-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })
      const userInput = {
        requestAnswers: vi.fn(async () => ({ decision: 'approve' })),
      } as any
      const permissionRequest = vi.fn(async () => ({
        runs: [],
        blocked: false,
      }))
      const hooks = {
        runPermissionRequest: permissionRequest,
      } as any as HooksRuntime
      const preflight = createPolicyPreflight({
        fileStore: store,
        approval: createApprovalService({ fileStore: store, userInput }),
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
        isKnownMcpToolName: isKnownMcpToolNameForTest,
      })

      await expect(preflight(
        { id: 'mcp-1', name: 'mcp__github__create_issue', input: { title: 'A' } },
        { cwd: projectDir, agentDepth: 0, onEvent: () => {}, hooks },
      )).resolves.toBeNull()

      expect(permissionRequest).toHaveBeenCalledWith(expect.objectContaining({
        toolName: 'mcp__github__create_issue',
        toolInput: { title: 'A' },
        cwd: projectDir,
      }))
      expect(userInput.requestAnswers).toHaveBeenCalledTimes(1)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('denies Grep binary installation when tool.install is denied', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-grep-install-deny-'))
    const probeSpy = vi.spyOn(ripgrepBinary, 'probeRipgrepExecutable').mockResolvedValue(null)
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
            ruleId: 'deny-rg-install',
            createdAt: '2026-01-01T00:00:00Z',
            scope: 'global',
            decision: 'deny',
            match: { kind: 'tool.install', tool: 'ripgrep' },
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
        { id: 'g1', name: 'Grep', input: { pattern: 'hello', path: projectDir } },
        { cwd: projectDir, agentDepth: 0 },
      )

      expect(res?.is_error).toBe(true)
      expect(res?.content).toContain('Policy denied tool.install')
    } finally {
      probeSpy.mockRestore()
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
      await fs.mkdir(projectDir, { recursive: true })
      await fs.mkdir(outsideDir, { recursive: true })

      resetWorkspaceSessionForTests()
      addWorkspaceSessionDirectory(projectDir, outsideDir)

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
      resetWorkspaceSessionForTests()
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('allows fs.read from FORMAX_CONFIG_DIR/plans when deferred exposure is disabled', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-plans-read-disabled-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })

      const plansDir = path.join(globalConfigDir, 'plans')
      await fs.mkdir(plansDir, { recursive: true })
      const plansFile = path.join(plansDir, 'snake-plan.md')
      await fs.writeFile(plansFile, '# plan\n', 'utf8')

      const preflight = createPolicyPreflight({
        fileStore: store,
        env: {
          FORMAX_CONFIG_DIR: globalConfigDir,
          FORMAX_DEFERRED_TOOL_EXPOSURE: '0',
        } as any,
        platform: 'linux',
        homedir: dir,
      })

      const res = await preflight(
        { id: 'p1', name: 'Read', input: { file_path: plansFile } },
        { cwd: projectDir, agentDepth: 0, interactive: false },
      )

      expect(res).toBeNull()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('allows fs.read from FORMAX_CONFIG_DIR/plans when deferred exposure is enabled', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-plans-read-enabled-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })

      const plansDir = path.join(globalConfigDir, 'plans')
      await fs.mkdir(plansDir, { recursive: true })
      const plansFile = path.join(plansDir, 'snake-plan.md')
      await fs.writeFile(plansFile, '# plan\n', 'utf8')

      const preflight = createPolicyPreflight({
        fileStore: store,
        env: {
          FORMAX_CONFIG_DIR: globalConfigDir,
          FORMAX_DEFERRED_TOOL_EXPOSURE: '1',
        } as any,
        platform: 'linux',
        homedir: dir,
      })

      const res = await preflight(
        { id: 'p2', name: 'Read', input: { file_path: plansFile } },
        { cwd: projectDir, agentDepth: 0, interactive: false },
      )

      expect(res).toBeNull()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('allows fs.read from auto-memory path without workspace prompt when deferred exposure is enabled', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-auto-memory-allow-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })

      const memoryDir = buildAutoMemoryDirectoryPath({
        cwd: projectDir,
        configDir: globalConfigDir,
      })
      await fs.mkdir(memoryDir, { recursive: true })
      const memoryFile = path.join(memoryDir, 'MEMORY.md')
      await fs.writeFile(memoryFile, '# memory\n', 'utf8')

      const preflight = createPolicyPreflight({
        fileStore: store,
        env: {
          FORMAX_CONFIG_DIR: globalConfigDir,
          FORMAX_DEFERRED_TOOL_EXPOSURE: '1',
        } as any,
        platform: 'linux',
        homedir: dir,
      })

      const res = await preflight(
        { id: 'm1', name: 'Read', input: { file_path: memoryFile } },
        { cwd: projectDir, agentDepth: 0, interactive: false },
      )

      expect(res).toBeNull()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('allows fs.write to auto-memory path without approval when deferred exposure is enabled', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-auto-memory-write-allow-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })

      const memoryDir = buildAutoMemoryDirectoryPath({
        cwd: projectDir,
        configDir: globalConfigDir,
      })
      await fs.mkdir(memoryDir, { recursive: true })
      const memoryFile = path.join(memoryDir, 'MEMORY.md')

      const preflight = createPolicyPreflight({
        fileStore: store,
        env: {
          FORMAX_CONFIG_DIR: globalConfigDir,
          FORMAX_DEFERRED_TOOL_EXPOSURE: '1',
        } as any,
        platform: 'linux',
        homedir: dir,
      })

      const res = await preflight(
        { id: 'mw1', name: 'Write', input: { file_path: memoryFile, content: '# memory\n' } },
        { cwd: projectDir, agentDepth: 0, interactive: false },
      )

      expect(res).toBeNull()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('allows fs.write to auto-memory path without approval when deferred exposure is disabled', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-auto-memory-write-disabled-allow-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })

      const memoryDir = buildAutoMemoryDirectoryPath({
        cwd: projectDir,
        configDir: globalConfigDir,
      })
      await fs.mkdir(memoryDir, { recursive: true })
      const memoryFile = path.join(memoryDir, 'MEMORY.md')

      const preflight = createPolicyPreflight({
        fileStore: store,
        env: {
          FORMAX_CONFIG_DIR: globalConfigDir,
          FORMAX_DEFERRED_TOOL_EXPOSURE: '0',
        } as any,
        platform: 'linux',
        homedir: dir,
      })

      const res = await preflight(
        { id: 'mw1b', name: 'Write', input: { file_path: memoryFile, content: '# memory\n' } },
        { cwd: projectDir, agentDepth: 0, interactive: false },
      )

      expect(res).toBeNull()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('keeps explicit fs.write deny rules for auto-memory paths', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-auto-memory-write-deny-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })

      const memoryDir = buildAutoMemoryDirectoryPath({
        cwd: projectDir,
        configDir: globalConfigDir,
      })
      await fs.mkdir(memoryDir, { recursive: true })
      const memoryFile = path.join(memoryDir, 'MEMORY.md')

      await store.writeJsonAtomic(path.join(globalConfigDir, 'rules.json'), {
        version: 1,
        rules: [
          {
            ruleId: 'deny-auto-memory-write',
            createdAt: '2026-03-08T00:00:00Z',
            scope: 'global',
            decision: 'deny',
            match: { kind: 'fs.write', path: memoryDir },
          },
        ],
      })

      const preflight = createPolicyPreflight({
        fileStore: store,
        env: {
          FORMAX_CONFIG_DIR: globalConfigDir,
          FORMAX_DEFERRED_TOOL_EXPOSURE: '1',
        } as any,
        platform: 'linux',
        homedir: dir,
      })

      const res = await preflight(
        { id: 'mw2', name: 'Write', input: { file_path: memoryFile, content: '# memory\n' } },
        { cwd: projectDir, agentDepth: 0, interactive: false },
      )

      expect(res?.is_error).toBe(true)
      expect(res?.content).toContain('Policy denied fs.write')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('keeps explicit fs.write prompt rules for auto-memory paths', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-auto-memory-write-prompt-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })

      const memoryDir = buildAutoMemoryDirectoryPath({
        cwd: projectDir,
        configDir: globalConfigDir,
      })
      await fs.mkdir(memoryDir, { recursive: true })
      const memoryFile = path.join(memoryDir, 'MEMORY.md')

      await store.writeJsonAtomic(path.join(globalConfigDir, 'rules.json'), {
        version: 1,
        rules: [
          {
            ruleId: 'prompt-auto-memory-write',
            createdAt: '2026-03-08T00:00:00Z',
            scope: 'global',
            decision: 'prompt',
            match: { kind: 'fs.write', path: memoryDir },
          },
        ],
      })

      const preflight = createPolicyPreflight({
        fileStore: store,
        env: {
          FORMAX_CONFIG_DIR: globalConfigDir,
          FORMAX_DEFERRED_TOOL_EXPOSURE: '1',
        } as any,
        platform: 'linux',
        homedir: dir,
      })

      const res = await preflight(
        { id: 'mw3', name: 'Write', input: { file_path: memoryFile, content: '# memory\n' } },
        { cwd: projectDir, agentDepth: 0, interactive: false },
      )

      expect(res?.is_error).toBe(true)
      expect(res?.content).toContain('Approval required for fs.write')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('allows fs.read from auto-memory path when deferred exposure is disabled', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-auto-memory-disabled-allow-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })

      const memoryDir = buildAutoMemoryDirectoryPath({
        cwd: projectDir,
        configDir: globalConfigDir,
      })
      await fs.mkdir(memoryDir, { recursive: true })
      const memoryFile = path.join(memoryDir, 'MEMORY.md')
      await fs.writeFile(memoryFile, '# memory\n', 'utf8')

      const preflight = createPolicyPreflight({
        fileStore: store,
        env: {
          FORMAX_CONFIG_DIR: globalConfigDir,
          FORMAX_DEFERRED_TOOL_EXPOSURE: '0',
        } as any,
        platform: 'linux',
        homedir: dir,
      })

      const res = await preflight(
        { id: 'm2', name: 'Read', input: { file_path: memoryFile } },
        { cwd: projectDir, agentDepth: 0, interactive: false },
      )

      expect(res).toBeNull()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('prompts for fs.read outside workspace roots and approve_remember adds a session workspace directory', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-workspace-approve-read-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      const outsideDir = path.join(dir, 'outside')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })
      await fs.mkdir(outsideDir, { recursive: true })

      resetWorkspaceSessionForTests()

      const baseUserInput = createUserInputManager()
      let requests = 0
      const userInput = {
        ...baseUserInput,
        requestAnswers: (args: any) => {
          requests += 1
          return baseUserInput.requestAnswers(args)
        },
      }

      const approval = createApprovalService({ fileStore: store, userInput })
      const preflight = createPolicyPreflight({
        fileStore: store,
        approval,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })

      const target = path.join(outsideDir, 'a.txt')
      const canonicalOutsideDir = await fs.realpath(outsideDir)

      baseUserInput.submitAnswers('t1', { decision: 'approve_remember' })
      const res1 = await preflight({ id: 't1', name: 'Read', input: { file_path: target } }, { cwd: projectDir, agentDepth: 0 })
      expect(res1).toBeNull()
      expect(requests).toBe(1)
      expect(listWorkspaceSessionDirectories(projectDir).map((e) => e.dir)).toContain(canonicalOutsideDir)

      // Subsequent reads should no longer trigger a workspace prompt (even if an approval service is present).
      baseUserInput.submitAnswers('t2', { decision: 'approve' })
      const res2 = await preflight({ id: 't2', name: 'Read', input: { file_path: target } }, { cwd: projectDir, agentDepth: 0 })
      expect(res2).toBeNull()
      expect(requests).toBe(1)
    } finally {
      resetWorkspaceSessionForTests()
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('prompts for fs.read outside workspace roots and approve does not persist workspace directories', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-workspace-approve-once-read-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      const outsideDir = path.join(dir, 'outside')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })
      await fs.mkdir(outsideDir, { recursive: true })

      resetWorkspaceSessionForTests()

      const baseUserInput = createUserInputManager()
      let requests = 0
      const userInput = {
        ...baseUserInput,
        requestAnswers: (args: any) => {
          requests += 1
          return baseUserInput.requestAnswers(args)
        },
      }

      const approval = createApprovalService({ fileStore: store, userInput })
      const preflight = createPolicyPreflight({
        fileStore: store,
        approval,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })

      const target = path.join(outsideDir, 'a.txt')

      baseUserInput.submitAnswers('t1', { decision: 'approve' })
      const res1 = await preflight({ id: 't1', name: 'Read', input: { file_path: target } }, { cwd: projectDir, agentDepth: 0 })
      expect(res1).toBeNull()
      expect(requests).toBe(1)
      expect(listWorkspaceSessionDirectories(projectDir)).toHaveLength(0)

      baseUserInput.submitAnswers('t2', { decision: 'approve' })
      const res2 = await preflight({ id: 't2', name: 'Read', input: { file_path: target } }, { cwd: projectDir, agentDepth: 0 })
      expect(res2).toBeNull()
      expect(requests).toBe(2)
      expect(listWorkspaceSessionDirectories(projectDir)).toHaveLength(0)
    } finally {
      resetWorkspaceSessionForTests()
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('prompts for fs.read outside workspace roots for Grep file paths and approve_remember stores the directory', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-workspace-approve-grep-file-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      const outsideDir = path.join(dir, 'outside')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })
      await fs.mkdir(outsideDir, { recursive: true })

      resetWorkspaceSessionForTests()

      const targetFile = path.join(outsideDir, 'a.txt')
      await fs.writeFile(targetFile, 'hello', 'utf8')
      const canonicalOutsideDir = await fs.realpath(outsideDir)

      const baseUserInput = createUserInputManager()
      let requests = 0
      const userInput = {
        ...baseUserInput,
        requestAnswers: (args: any) => {
          requests += 1
          return baseUserInput.requestAnswers(args)
        },
      }

      const approval = createApprovalService({ fileStore: store, userInput })
      const preflight = createPolicyPreflight({
        fileStore: store,
        approval,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })

      baseUserInput.submitAnswers('t1', { decision: 'approve_remember' })
      const res1 = await preflight({ id: 't1', name: 'Grep', input: { path: targetFile, pattern: 'x' } }, { cwd: projectDir, agentDepth: 0 })
      expect(res1).toBeNull()
      expect(requests).toBe(1)
      expect(listWorkspaceSessionDirectories(projectDir).map((e) => e.dir)).toContain(canonicalOutsideDir)

      // Subsequent greps in the same directory should no longer trigger a workspace prompt.
      baseUserInput.submitAnswers('t2', { decision: 'approve' })
      const res2 = await preflight({ id: 't2', name: 'Grep', input: { path: outsideDir, pattern: 'x' } }, { cwd: projectDir, agentDepth: 0 })
      expect(res2).toBeNull()
      expect(requests).toBe(1)
    } finally {
      resetWorkspaceSessionForTests()
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('prompts for Grep when workspace symlink escapes and approve_remember stores the target directory', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-workspace-approve-grep-symlink-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      const outsideDir = path.join(dir, 'outside')
      const nestedDir = path.join(projectDir, 'nested')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })
      await fs.mkdir(outsideDir, { recursive: true })
      await fs.mkdir(nestedDir, { recursive: true })
      await fs.writeFile(path.join(outsideDir, 'a.txt'), 'hello', 'utf8')
      await fs.symlink(outsideDir, path.join(nestedDir, 'escape'), 'dir')

      resetWorkspaceSessionForTests()

      const canonicalOutsideDir = await fs.realpath(outsideDir)
      const baseUserInput = createUserInputManager()
      let requests = 0
      const userInput = {
        ...baseUserInput,
        requestAnswers: (args: any) => {
          requests += 1
          return baseUserInput.requestAnswers(args)
        },
      }

      const approval = createApprovalService({ fileStore: store, userInput })
      const preflight = createPolicyPreflight({
        fileStore: store,
        approval,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })

      baseUserInput.submitAnswers('t1', { decision: 'approve_remember' })
      const res1 = await preflight({ id: 't1', name: 'Grep', input: { path: projectDir, pattern: 'hello' } }, { cwd: projectDir, agentDepth: 0 })
      expect(res1).toBeNull()
      expect(requests).toBe(1)
      expect(listWorkspaceSessionDirectories(projectDir).map((e) => e.dir)).toContain(canonicalOutsideDir)

      baseUserInput.submitAnswers('t2', { decision: 'approve' })
      const res2 = await preflight({ id: 't2', name: 'Grep', input: { path: projectDir, pattern: 'hello' } }, { cwd: projectDir, agentDepth: 0 })
      expect(res2).toBeNull()
      expect(requests).toBe(1)
    } finally {
      resetWorkspaceSessionForTests()
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('prompts for nested Grep symlink escapes under an in-workspace symlink directory', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-workspace-approve-grep-nested-symlink-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      const linkedTargetDir = path.join(projectDir, 'linked-target')
      const outsideDir = path.join(dir, 'outside')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })
      await fs.mkdir(linkedTargetDir, { recursive: true })
      await fs.mkdir(outsideDir, { recursive: true })
      await fs.writeFile(path.join(outsideDir, 'a.txt'), 'hello', 'utf8')

      await fs.symlink(linkedTargetDir, path.join(projectDir, 'linked'), 'dir')
      await fs.symlink(outsideDir, path.join(linkedTargetDir, 'escape'), 'dir')

      resetWorkspaceSessionForTests()

      const canonicalOutsideDir = await fs.realpath(outsideDir)
      const baseUserInput = createUserInputManager()
      let requests = 0
      const userInput = {
        ...baseUserInput,
        requestAnswers: (args: any) => {
          requests += 1
          return baseUserInput.requestAnswers(args)
        },
      }

      const approval = createApprovalService({ fileStore: store, userInput })
      const preflight = createPolicyPreflight({
        fileStore: store,
        approval,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })

      baseUserInput.submitAnswers('t1', { decision: 'approve_remember' })
      const res1 = await preflight({ id: 't1', name: 'Grep', input: { path: projectDir, pattern: 'hello' } }, { cwd: projectDir, agentDepth: 0 })
      expect(res1).toBeNull()
      expect(requests).toBe(1)
      expect(listWorkspaceSessionDirectories(projectDir).map((e) => e.dir)).toContain(canonicalOutsideDir)

      baseUserInput.submitAnswers('t2', { decision: 'approve' })
      const res2 = await preflight({ id: 't2', name: 'Grep', input: { path: projectDir, pattern: 'hello' } }, { cwd: projectDir, agentDepth: 0 })
      expect(res2).toBeNull()
      expect(requests).toBe(1)
    } finally {
      resetWorkspaceSessionForTests()
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('blocks Grep symlink escape paths in non-interactive contexts', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-workspace-grep-symlink-noninteractive-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      const outsideDir = path.join(dir, 'outside')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })
      await fs.mkdir(outsideDir, { recursive: true })
      await fs.symlink(outsideDir, path.join(projectDir, 'escape'), 'dir')

      const preflight = createPolicyPreflight({
        fileStore: store,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })

      const res = await preflight(
        { id: 't1', name: 'Grep', input: { path: projectDir, pattern: 'x' } },
        { cwd: projectDir, agentDepth: 0, interactive: false },
      )
      expect(res?.is_error).toBe(true)
      expect(res?.content).toContain('outside the workspace')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('caches Grep symlink scan results across repeated preflights', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-grep-scan-cache-'))
    const probeSpy = vi.spyOn(ripgrepBinary, 'probeRipgrepExecutable').mockResolvedValue('/mock/rg')
    const readdirSpy = vi.spyOn(fs, 'readdir')
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })
      await fs.writeFile(path.join(projectDir, 'a.txt'), 'hello', 'utf8')

      const preflight = createPolicyPreflight({
        fileStore: store,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })

      const res1 = await preflight(
        { id: 't1', name: 'Grep', input: { path: projectDir, pattern: 'hello' } },
        { cwd: projectDir, agentDepth: 0 },
      )
      expect(res1).toBeNull()
      const afterFirst = readdirSpy.mock.calls.length
      expect(afterFirst).toBeGreaterThan(0)

      const res2 = await preflight(
        { id: 't2', name: 'Grep', input: { path: projectDir, pattern: 'hello' } },
        { cwd: projectDir, agentDepth: 0 },
      )
      expect(res2).toBeNull()
      const afterSecond = readdirSpy.mock.calls.length

      expect(afterSecond).toBe(afterFirst)
    } finally {
      readdirSpy.mockRestore()
      probeSpy.mockRestore()
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('deduplicates concurrent Grep symlink scans with an inflight promise', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-grep-scan-inflight-'))
    const probeSpy = vi.spyOn(ripgrepBinary, 'probeRipgrepExecutable').mockResolvedValue('/mock/rg')
    let readdirSpy: ReturnType<typeof vi.spyOn> | null = null
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })
      await fs.writeFile(path.join(projectDir, 'a.txt'), 'hello', 'utf8')

      const originalReaddir = fs.readdir.bind(fs)
      readdirSpy = vi.spyOn(fs, 'readdir').mockImplementation(async (p: any, options?: any) => {
        await new Promise((resolve) => setTimeout(resolve, 20))
        return await (originalReaddir as any)(p, options)
      })

      const preflight = createPolicyPreflight({
        fileStore: store,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })

      const [res1, res2] = await Promise.all([
        preflight(
          { id: 't1', name: 'Grep', input: { path: projectDir, pattern: 'hello' } },
          { cwd: projectDir, agentDepth: 0 },
        ),
        preflight(
          { id: 't2', name: 'Grep', input: { path: projectDir, pattern: 'hello' } },
          { cwd: projectDir, agentDepth: 0 },
        ),
      ])

      expect(res1).toBeNull()
      expect(res2).toBeNull()
      expect(readdirSpy.mock.calls.length).toBe(1)
    } finally {
      readdirSpy?.mockRestore()
      probeSpy.mockRestore()
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

  it('uses outside directory directly for fs.read workspace approval requests', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-read-outside-dir-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      const outsideDir = path.join(dir, 'outside')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })
      await fs.mkdir(outsideDir, { recursive: true })

      let requestedDir: string | null = null
      const preflight = createPolicyPreflight({
        fileStore: store,
        approval: {
          getSessionRules: () => [],
          ensureApproved: async (args: any) => {
            requestedDir = args.workspaceRequest?.dir ?? null
            return { ok: true }
          },
        },
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })

      const res = await preflight(
        { id: 't1', name: 'Read', input: { file_path: outsideDir } },
        { cwd: projectDir, agentDepth: 0, interactive: true },
      )
      expect(res).toBeNull()
      expect(requestedDir).toBe(await fs.realpath(outsideDir))
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('prompts for fs.write outside workspace roots and approve_remember adds a session workspace directory', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-workspace-approve-write-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      const outsideDir = path.join(dir, 'outside')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })
      await fs.mkdir(outsideDir, { recursive: true })

      resetWorkspaceSessionForTests()

      const baseUserInput = createUserInputManager()
      let requests = 0
      const userInput = {
        ...baseUserInput,
        requestAnswers: (args: any) => {
          requests += 1
          return baseUserInput.requestAnswers(args)
        },
      }

      let replMode: string | undefined

      const approval = createApprovalService({ fileStore: store, userInput })
      const preflight = createPolicyPreflight({
        fileStore: store,
        approval,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })

      const target = path.join(outsideDir, 'a.txt')
      const canonicalOutsideDir = await fs.realpath(outsideDir)
      baseUserInput.submitAnswers('t1', { decision: 'approve_remember' })
      const res1 = await preflight(
        { id: 't1', name: 'Write', input: { file_path: target, content: 'hi' } },
        {
          cwd: projectDir,
          agentDepth: 0,
          getReplMode: () => replMode,
          setReplMode: (m: string) => {
            replMode = m
          },
        } as any,
      )
      expect(res1).toBeNull()
      expect(requests).toBe(1)
      expect(replMode).toBe('acceptEdits')
      expect(listWorkspaceSessionDirectories(projectDir).map((e) => e.dir)).toContain(canonicalOutsideDir)

      baseUserInput.submitAnswers('t2', { decision: 'approve' })
      const res2 = await preflight(
        { id: 't2', name: 'Write', input: { file_path: path.join(outsideDir, 'b.txt'), content: 'hi' } },
        {
          cwd: projectDir,
          agentDepth: 0,
          getReplMode: () => replMode,
          setReplMode: (m: string) => {
            replMode = m
          },
        } as any,
      )
      expect(res2).toBeNull()
      expect(requests).toBe(1)
    } finally {
      resetWorkspaceSessionForTests()
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

  it('allows editing the plan file itself in plan mode', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-plan-mode-allow-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      const planPath = path.join(projectDir, 'PLAN.md')
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
          input: { file_path: planPath, content: 'hi' },
        },
        { cwd: projectDir, agentDepth: 0, replMode: 'plan', planPath },
      )

      expect(res).toBeNull()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('returns null when tool call is not mapped to a policy action', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-no-action-'))
    try {
      const store = createNodeFileStore()
      const preflight = createPolicyPreflight({ fileStore: store })
      const res = await preflight({ id: 't1', name: 'UnknownTool', input: {} } as any, {
        cwd: dir,
        agentDepth: 0,
      })
      expect(res).toBeNull()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('falls back to process.cwd() when execution context cwd is missing', async () => {
    const store = createNodeFileStore()
    const preflight = createPolicyPreflight({ fileStore: store })
    const res = await preflight(
      {
        id: 't1',
        name: 'Write',
        input: { file_path: path.join(process.cwd(), 'tmp-policy-preflight.txt'), content: 'x' },
      },
      { agentDepth: 0 } as any,
    )
    expect(res?.is_error).toBe(true)
  })

  it('rejects plan-mode writes when plan path is unavailable', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-plan-mode-missing-path-'))
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
        { id: 't1', name: 'Write', input: { file_path: path.join(projectDir, 'x.md'), content: 'x' } },
        { cwd: projectDir, agentDepth: 0, replMode: 'plan' },
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

  it('handles ripgrep install prompts in sub-agents without approval UI', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-rg-install-subagent-'))
    const probeSpy = vi.spyOn(ripgrepBinary, 'probeRipgrepExecutable').mockResolvedValue(null)
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
            ruleId: 'prompt-rg-install',
            createdAt: '2026-01-01T00:00:00Z',
            scope: 'global',
            decision: 'prompt',
            match: { kind: 'tool.install', tool: 'ripgrep' },
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
        { id: 't1', name: 'Grep', input: { pattern: 'x', path: projectDir } },
        { cwd: projectDir, agentDepth: 1 },
      )
      expect(res?.is_error).toBe(true)
      expect(res?.content).toContain('Approval required')
    } finally {
      probeSpy.mockRestore()
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('requires interactive approval for ripgrep install prompts', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-rg-install-interactive-'))
    const probeSpy = vi.spyOn(ripgrepBinary, 'probeRipgrepExecutable').mockResolvedValue(null)
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
            ruleId: 'prompt-rg-install',
            createdAt: '2026-01-01T00:00:00Z',
            scope: 'global',
            decision: 'prompt',
            match: { kind: 'tool.install', tool: 'ripgrep' },
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
        { id: 't1', name: 'Grep', input: { pattern: 'x', path: projectDir } },
        { cwd: projectDir, agentDepth: 0, interactive: false },
      )
      expect(res?.is_error).toBe(true)
      expect(res?.content).toContain('Approval required for tool.install')
    } finally {
      probeSpy.mockRestore()
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('requires approval service when ripgrep install prompts are active', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-rg-install-approval-service-'))
    const probeSpy = vi.spyOn(ripgrepBinary, 'probeRipgrepExecutable').mockResolvedValue(null)
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
            ruleId: 'prompt-rg-install',
            createdAt: '2026-01-01T00:00:00Z',
            scope: 'global',
            decision: 'prompt',
            match: { kind: 'tool.install', tool: 'ripgrep' },
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
        { id: 't1', name: 'Grep', input: { pattern: 'x', path: projectDir } },
        { cwd: projectDir, agentDepth: 0, interactive: true },
      )
      expect(res?.is_error).toBe(true)
      expect(res?.content).toContain('Approval required for tool.install')
    } finally {
      probeSpy.mockRestore()
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('returns approval result payload for ripgrep install prompts', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-rg-install-result-'))
    const probeSpy = vi.spyOn(ripgrepBinary, 'probeRipgrepExecutable').mockResolvedValue(null)
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
            ruleId: 'prompt-rg-install',
            createdAt: '2026-01-01T00:00:00Z',
            scope: 'global',
            decision: 'prompt',
            match: { kind: 'tool.install', tool: 'ripgrep' },
          },
        ],
      })

      const preflight = createPolicyPreflight({
        fileStore: store,
        approval: {
          getSessionRules: () => [],
          ensureApproved: async () => ({
            ok: false,
            result: { tool_use_id: 't1', content: 'Error: install declined', is_error: true },
          }),
        },
        audit: { append: async () => {} },
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })
      const res = await preflight(
        { id: 't1', name: 'Grep', input: { pattern: 'x', path: projectDir } },
        { cwd: projectDir, agentDepth: 0, interactive: true },
      )
      expect(res?.is_error).toBe(true)
      expect(res?.content).toContain('install declined')
    } finally {
      probeSpy.mockRestore()
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('allows Grep when ripgrep install action is explicitly allowed', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-rg-install-allow-'))
    const probeSpy = vi.spyOn(ripgrepBinary, 'probeRipgrepExecutable').mockResolvedValue(null)
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
            ruleId: 'allow-rg-install',
            createdAt: '2026-01-01T00:00:00Z',
            scope: 'global',
            decision: 'allow',
            match: { kind: 'tool.install', tool: 'ripgrep' },
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
        { id: 't1', name: 'Grep', input: { pattern: 'x', path: projectDir } },
        { cwd: projectDir, agentDepth: 0 },
      )
      expect(res).toBeNull()
    } finally {
      probeSpy.mockRestore()
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('returns deny reason for ripgrep install policy denies', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-rg-install-deny-reason-'))
    const probeSpy = vi.spyOn(ripgrepBinary, 'probeRipgrepExecutable').mockResolvedValue(null)
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
            ruleId: 'deny-rg-install',
            createdAt: '2026-01-01T00:00:00Z',
            scope: 'global',
            decision: 'deny',
            reason: 'rg install blocked',
            match: { kind: 'tool.install', tool: 'ripgrep' },
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
        { id: 't1', name: 'Grep', input: { pattern: 'x', path: projectDir } },
        { cwd: projectDir, agentDepth: 0 },
      )
      expect(res?.is_error).toBe(true)
      expect(res?.content).toContain('Reason: rg install blocked')
    } finally {
      probeSpy.mockRestore()
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('supports successful ripgrep install prompt approvals', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-rg-install-approve-'))
    const probeSpy = vi.spyOn(ripgrepBinary, 'probeRipgrepExecutable').mockResolvedValue(null)
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
            ruleId: 'prompt-rg-install',
            createdAt: '2026-01-01T00:00:00Z',
            scope: 'global',
            decision: 'prompt',
            match: { kind: 'tool.install', tool: 'ripgrep' },
          },
        ],
      })

      const preflight = createPolicyPreflight({
        fileStore: store,
        approval: {
          getSessionRules: () => [],
          ensureApproved: async () => ({ ok: true }),
        },
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })
      await store.writeJsonAtomic(path.join(globalConfigDir, 'rules.json'), {
        version: 1,
        rules: [
          {
            ruleId: 'prompt-read',
            createdAt: '2026-01-01T00:00:00Z',
            scope: 'global',
            decision: 'prompt',
            match: { kind: 'fs.read', path: '/' },
          },
        ],
      })
      const res = await preflight(
        { id: 't1', name: 'Grep', input: { pattern: 'x', path: projectDir } },
        { cwd: projectDir, agentDepth: 0, interactive: true },
      )
      expect(res).toBeNull()
    } finally {
      probeSpy.mockRestore()
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('continues after ripgrep install approval when prompt is accepted', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-rg-install-approve-continue-'))
    const probeSpy = vi.spyOn(ripgrepBinary, 'probeRipgrepExecutable').mockResolvedValue(null)
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
            ruleId: 'prompt-rg-install',
            createdAt: '2026-01-01T00:00:00Z',
            scope: 'global',
            decision: 'prompt',
            match: { kind: 'tool.install', tool: 'ripgrep' },
          },
          {
            ruleId: 'allow-read',
            createdAt: '2026-01-01T00:00:00Z',
            scope: 'global',
            decision: 'allow',
            match: { kind: 'fs.read', path: projectDir },
          },
        ],
      })

      let approvals = 0
      const preflight = createPolicyPreflight({
        fileStore: store,
        approval: {
          getSessionRules: () => [],
          ensureApproved: async () => {
            approvals++
            return { ok: true }
          },
        },
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })
      const res = await preflight(
        { id: 't1', name: 'Grep', input: { pattern: 'x', path: projectDir } },
        { cwd: projectDir, agentDepth: 0, interactive: true },
      )
      expect(res).toBeNull()
      expect(approvals).toBe(1)
    } finally {
      probeSpy.mockRestore()
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

  it('blocks a prompt via PermissionRequest hooks before showing approval UI', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-permission-hook-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })

      let approvals = 0
      const approval: ApprovalService = {
        getSessionRules: () => [],
        ensureApproved: async () => {
          approvals++
          return { ok: true }
        },
      }

      const auditEvents: AuditEventV1[] = []

      const blockedBy = {
        command: 'echo deny',
        exitCode: 2,
        signal: null,
        stdout: '',
        stderr: 'blocked by hook',
        durationMs: 1,
        timedOut: false,
        parsedJson: null,
      }

      const hooks: HooksRuntime = {
        runPreToolUse: async () => ({ runs: [], blocked: false }),
        runPermissionRequest: async () => ({
          runs: [blockedBy],
          blocked: true,
          blockedBy,
        }),
        runUserPromptSubmit: async () => ({ runs: [], additionalContext: [], blocked: false }),
        runSessionStart: async () => ({ runs: [], additionalContext: [], blocked: false }),
        runStop: async () => ({ runs: [], additionalContext: [], blocked: false }),
        runPostToolUse: async () => ({ runs: [], additionalContext: [], blockingErrors: [] }),
      }

      const withApproval = createPolicyPreflight({
        fileStore: store,
        approval,
        audit: {
          append: async (e) => {
            auditEvents.push(e)
          },
        },
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })

      const res = await withApproval(
        {
          id: 't1',
          name: 'Write',
          input: { file_path: path.join(projectDir, 'a.txt'), content: 'hi' },
        },
        { cwd: projectDir, agentDepth: 0, hooks },
      )

      expect(res?.is_error).toBe(true)
      expect(res?.content).toContain('Permission denied Write')
      expect(res?.content).toContain('blocked by hook')
      expect(approvals).toBe(0)

      const hookRuns = auditEvents.filter((e) => e.kind === 'hook.run') as any[]
      expect(hookRuns).toHaveLength(1)
      expect(hookRuns[0].hook.eventName).toBe('PermissionRequest')
      expect(hookRuns[0].hook.command).toBe('echo deny')
      expect(hookRuns[0].hook.status).toBe('blocked')
      expect(hookRuns[0].hook.parsedJson).toBe(false)
      expect(hookRuns[0].hook.stderrPreview).toBe('blocked by hook')
      expect(hookRuns[0].hook.stdoutPreview).toBeUndefined()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('continues to approval when permission hooks do not block', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-hook-pass-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })

      let approvals = 0
      const preflight = createPolicyPreflight({
        fileStore: store,
        approval: {
          getSessionRules: () => [],
          ensureApproved: async () => {
            approvals++
            return { ok: true }
          },
        },
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })

      const hooks: HooksRuntime = {
        runPreToolUse: async () => ({ runs: [], blocked: false }),
        runPermissionRequest: async () => ({ runs: [], blocked: false }),
        runUserPromptSubmit: async () => ({ runs: [], additionalContext: [], blocked: false }),
        runSessionStart: async () => ({ runs: [], additionalContext: [], blocked: false }),
        runStop: async () => ({ runs: [], additionalContext: [], blocked: false }),
        runPostToolUse: async () => ({ runs: [], additionalContext: [], blockingErrors: [] }),
      }

      const res = await preflight(
        { id: 't1', name: 'Write', input: { file_path: path.join(projectDir, 'a.txt'), content: 'x' } },
        { cwd: projectDir, agentDepth: 0, hooks },
      )
      expect(res).toBeNull()
      expect(approvals).toBe(1)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('returns hook block error without stderr details when stderr is empty', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-hook-no-stderr-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })

      const preflight = createPolicyPreflight({
        fileStore: store,
        approval: {
          getSessionRules: () => [],
          ensureApproved: async () => ({ ok: true }),
        },
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })

      const hooks: HooksRuntime = {
        runPreToolUse: async () => ({ runs: [], blocked: false }),
        runPermissionRequest: async () => ({
          runs: [{ command: 'echo', stderr: '   ' } as any],
          blocked: true,
          blockedBy: { command: 'echo', stderr: '   ' } as any,
        }),
        runUserPromptSubmit: async () => ({ runs: [], additionalContext: [], blocked: false }),
        runSessionStart: async () => ({ runs: [], additionalContext: [], blocked: false }),
        runStop: async () => ({ runs: [], additionalContext: [], blocked: false }),
        runPostToolUse: async () => ({ runs: [], additionalContext: [], blockingErrors: [] }),
      }

      const res = await preflight(
        { id: 't1', name: 'Write', input: { file_path: path.join(projectDir, 'a.txt'), content: 'x' } },
        { cwd: projectDir, agentDepth: 0, hooks },
      )
      expect(res?.is_error).toBe(true)
      expect(res?.content).toBe('Error: Permission denied Write')
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

  it('denies Bash when permissions deny the command', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-bash-perm-deny-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(path.join(projectDir, '.formax'), { recursive: true })

      await store.writeJsonAtomic(path.join(globalConfigDir, 'rules.json'), {
        version: 1,
        rules: [
          {
            ruleId: 'allow-mkdir',
            createdAt: '2026-01-01T00:00:00Z',
            scope: 'global',
            decision: 'allow',
            match: { kind: 'bash.exec', commandPrefix: 'mkdir' },
          },
        ],
      })

      await store.writeJsonAtomic(path.join(projectDir, '.formax', 'settings.local.json'), {
        version: 1,
        permissions: {
          allow: [],
          ask: [],
          deny: ['Bash(mkdir foo)'],
          workspace: { additionalDirectories: [] },
        },
      })

      const preflight = createPolicyPreflight({
        fileStore: store,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })

      const result = await preflight(
        { id: 't1', name: 'Bash', input: { command: 'mkdir foo' } },
        { cwd: projectDir, agentDepth: 0, replMode: 'normal' },
      )

      expect(result?.is_error).toBe(true)
      expect(result?.content).toContain('Permission denied Bash')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('prompts Bash when permissions ask overrides policy allow', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-bash-perm-ask-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(path.join(projectDir, '.formax'), { recursive: true })

      await store.writeJsonAtomic(path.join(globalConfigDir, 'rules.json'), {
        version: 1,
        rules: [
          {
            ruleId: 'allow-mkdir',
            createdAt: '2026-01-01T00:00:00Z',
            scope: 'global',
            decision: 'allow',
            match: { kind: 'bash.exec', commandPrefix: 'mkdir' },
          },
        ],
      })

      await store.writeJsonAtomic(path.join(projectDir, '.formax', 'settings.local.json'), {
        version: 1,
        permissions: {
          allow: [],
          ask: ['Bash(mkdir foo)'],
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

      const result = await preflight(
        { id: 't1', name: 'Bash', input: { command: 'mkdir foo' } },
        { cwd: projectDir, agentDepth: 0, replMode: 'normal', interactive: false },
      )

      expect(result?.is_error).toBe(true)
      expect(result?.content).toContain('Approval required for bash.exec')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('keeps Bash decision unchanged when permissions ask but effective decision is already prompt', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-bash-ask-noop-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(path.join(projectDir, '.formax'), { recursive: true })

      await store.writeJsonAtomic(path.join(projectDir, '.formax', 'settings.local.json'), {
        version: 1,
        permissions: {
          allow: [],
          ask: ['Bash(mkdir foo)'],
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

      const result = await preflight(
        { id: 't1', name: 'Bash', input: { command: 'mkdir foo' } },
        { cwd: projectDir, agentDepth: 0, replMode: 'normal', interactive: false },
      )
      expect(result?.is_error).toBe(true)
      expect(result?.content).toContain('Approval required for bash.exec')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('prompts Bash from permissions ask when policy already allows and command is safe', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-bash-safe-ask-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(path.join(projectDir, '.formax'), { recursive: true })

      await store.writeJsonAtomic(path.join(globalConfigDir, 'rules.json'), {
        version: 1,
        rules: [
          {
            ruleId: 'allow-echo',
            createdAt: '2026-01-01T00:00:00Z',
            scope: 'global',
            decision: 'allow',
            match: { kind: 'bash.exec', commandPrefix: 'echo' },
          },
        ],
      })
      await store.writeJsonAtomic(path.join(projectDir, '.formax', 'settings.local.json'), {
        version: 1,
        permissions: { allow: [], ask: ['Bash(echo hi)'], deny: [], workspace: { additionalDirectories: [] } },
      })

      const preflight = createPolicyPreflight({
        fileStore: store,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })
      const res = await preflight(
        { id: 't1', name: 'Bash', input: { command: 'echo hi' } },
        { cwd: projectDir, agentDepth: 0, replMode: 'normal', interactive: false },
      )
      expect(res?.is_error).toBe(true)
      expect(res?.content).toContain('Approval required for bash.exec')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('handles Bash calls with invalid input payloads', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-bash-invalid-input-'))
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

      const r1 = await preflight({ id: 't1', name: 'Bash', input: 'not-object' as any }, { cwd: projectDir, agentDepth: 0 })
      expect(r1).toBeNull()

      const r2 = await preflight(
        { id: 't2', name: 'Bash', input: { command: 42 } as any },
        { cwd: projectDir, agentDepth: 0, replMode: 'normal' },
      )
      expect(r2).toBeNull()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('keeps WebFetch prompt when matched rule is prompt even if permissions allow', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-webfetch-prompt-rule-overrides-allow-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(path.join(projectDir, '.formax'), { recursive: true })

      await store.writeJsonAtomic(path.join(globalConfigDir, 'rules.json'), {
        version: 1,
        rules: [
          {
            ruleId: 'prompt-net',
            createdAt: '2026-01-01T00:00:00Z',
            scope: 'global',
            decision: 'prompt',
            match: { kind: 'net.fetch', urlPrefix: 'https://example.com' },
          },
        ],
      })
      await store.writeJsonAtomic(path.join(projectDir, '.formax', 'settings.local.json'), {
        version: 1,
        permissions: { allow: ['WebFetch'], ask: [], deny: [], workspace: { additionalDirectories: [] } },
      })

      const preflight = createPolicyPreflight({
        fileStore: store,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })
      const res = await preflight(
        { id: 't1', name: 'WebFetch', input: { url: 'https://example.com/a', prompt: 'x' } },
        { cwd: projectDir, agentDepth: 0, interactive: false },
      )
      expect(res?.is_error).toBe(true)
      expect(res?.content).toContain('Approval required for net.fetch')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('prompts WebSearch from permissions ask when policy allows search', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-websearch-ask-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(path.join(projectDir, '.formax'), { recursive: true })

      await store.writeJsonAtomic(path.join(globalConfigDir, 'rules.json'), {
        version: 1,
        rules: [
          {
            ruleId: 'allow-search',
            createdAt: '2026-01-01T00:00:00Z',
            scope: 'global',
            decision: 'allow',
            match: { kind: 'net.search', queryPrefix: 'hello' },
          },
        ],
      })
      await store.writeJsonAtomic(path.join(projectDir, '.formax', 'settings.local.json'), {
        version: 1,
        permissions: { allow: [], ask: ['WebSearch'], deny: [], workspace: { additionalDirectories: [] } },
      })

      const preflight = createPolicyPreflight({
        fileStore: store,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })
      const res = await preflight(
        { id: 't1', name: 'WebSearch', input: { query: 'hello world' } },
        { cwd: projectDir, agentDepth: 0, interactive: false },
      )
      expect(res?.is_error).toBe(true)
      expect(res?.content).toContain('Approval required for net.search')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('does not change denied WebSearch decisions when permissions ask is configured', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-websearch-ask-deny-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(path.join(projectDir, '.formax'), { recursive: true })

      await store.writeJsonAtomic(path.join(projectDir, '.formax', 'settings.local.json'), {
        version: 1,
        permissions: { allow: [], ask: ['WebSearch'], deny: [], workspace: { additionalDirectories: [] } },
      })

      const preflight = createPolicyPreflight({
        fileStore: store,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })

      const result = await preflight(
        { id: 't1', name: 'WebSearch', input: { query: 'hello world' } },
        { cwd: projectDir, agentDepth: 0 },
      )
      expect(result?.is_error).toBe(true)
      expect(result?.content).toContain('Policy denied net.search')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('prompts WebFetch when permissions ask overrides policy allow', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-webfetch-perm-ask-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
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
          ask: ['WebFetch'],
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

      const result = await preflight(
        { id: 't1', name: 'WebFetch', input: { url: 'https://example.com', prompt: 'x' } },
        { cwd: projectDir, agentDepth: 0, interactive: false },
      )

      expect(result?.is_error).toBe(true)
      expect(result?.content).toContain('Approval required for net.fetch')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('returns policy deny reasons for matched rules', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-deny-reason-'))
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
            ruleId: 'deny-net',
            createdAt: '2026-01-01T00:00:00Z',
            scope: 'global',
            decision: 'deny',
            reason: 'security policy',
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

      const result = await preflight(
        { id: 't1', name: 'WebFetch', input: { url: 'https://example.com', prompt: 'x' } },
        { cwd: projectDir, agentDepth: 0 },
      )

      expect(result?.is_error).toBe(true)
      expect(result?.content).toContain('Policy denied net.fetch')
      expect(result?.content).toContain('Reason: security policy')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('returns approval result payload when approval rejects', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-preflight-approval-result-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })

      const preflight = createPolicyPreflight({
        fileStore: store,
        approval: {
          getSessionRules: () => [],
          ensureApproved: async () => ({
            ok: false,
            result: { tool_use_id: 't1', content: 'Error: user declined', is_error: true },
          }),
        },
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: dir,
      })

      const result = await preflight(
        { id: 't1', name: 'Write', input: { file_path: path.join(projectDir, 'a.txt'), content: 'x' } },
        { cwd: projectDir, agentDepth: 0, interactive: true },
      )

      expect(result?.is_error).toBe(true)
      expect(result?.content).toContain('user declined')
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
