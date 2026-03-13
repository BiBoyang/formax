import { describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import {
  __agentsWizardTestOnly,
  buildAgentsWizardEntryQuestions,
  buildAgentsWizardGenerateQuestions,
  buildAgentsWizardManualQuestions,
  createAgentFromWizardAnswers,
  generateAgentDraftWithClaude,
  parseAgentArchitectDraft,
} from './agentsWizard'

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

  it('validates required wizard fields', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-agents-required-'))
    try {
      const projectAgentsDir = path.join(cwd, '.formax', 'agents')
      await expect(
        createAgentFromWizardAnswers({
          cwd,
          projectAgentsDir,
          answers: { scope: 'Project-level (.formax/agents)', description: 'x', systemPrompt: 'y' },
        }),
      ).rejects.toThrow(/missing agent name/i)

      await expect(
        createAgentFromWizardAnswers({
          cwd,
          projectAgentsDir,
          answers: { scope: 'Project-level (.formax/agents)', name: 'x', systemPrompt: 'y' },
        }),
      ).rejects.toThrow(/missing agent description/i)

      await expect(
        createAgentFromWizardAnswers({
          cwd,
          projectAgentsDir,
          answers: { scope: 'Project-level (.formax/agents)', name: 'x', description: 'y' },
        }),
      ).rejects.toThrow(/missing system prompt/i)
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })

  it('supports custom tools and omits unknown model/automatic color', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-agents-custom-'))
    try {
      const projectAgentsDir = path.join(cwd, '.formax', 'agents')
      const out = await createAgentFromWizardAnswers({
        cwd,
        projectAgentsDir,
        answers: {
          scope: 'Project-level (.formax/agents)',
          name: 'Ops+Bot',
          description: 'Line1\nLine2',
          model: 'unsupported-model',
          color: 'Automatic',
          tools: 'Read,  Edit ,  ',
          systemPrompt: 'Run ops checks.',
        },
      })
      const raw = await fsp.readFile(out.filePath, 'utf8')
      expect(out.name).toBe('ops-bot')
      expect(raw).toContain('description: Line1\\nLine2')
      expect(raw).toContain('tools: Read, Edit')
      expect(raw).not.toContain('model:')
      expect(raw).not.toContain('color:')
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })
})

describe('parseAgentArchitectDraft', () => {
  it('parses a plain JSON object', () => {
    const raw = JSON.stringify({
      identifier: 'code-reviewer',
      whenToUse: 'Use this agent when you need a review.',
      systemPrompt: 'You are a code reviewer.',
    })

    expect(parseAgentArchitectDraft(raw)).toEqual({
      identifier: 'code-reviewer',
      whenToUse: 'Use this agent when you need a review.',
      systemPrompt: 'You are a code reviewer.',
    })
  })

  it('parses a fenced JSON object and ignores surrounding text', () => {
    const raw = [
      'Sure — here is the JSON:',
      '```json',
      JSON.stringify({
        identifier: 'test-runner',
        whenToUse: 'Use this agent when tests should be run.',
        systemPrompt: 'You are a test runner.',
      }),
      '```',
      'Done.',
    ].join('\n')

    expect(parseAgentArchitectDraft(raw)).toEqual({
      identifier: 'test-runner',
      whenToUse: 'Use this agent when tests should be run.',
      systemPrompt: 'You are a test runner.',
    })
  })

  it('throws when required fields are missing', () => {
    const raw = JSON.stringify({ identifier: 'x', systemPrompt: 'y' })
    expect(() => parseAgentArchitectDraft(raw)).toThrow(/whenToUse/i)
  })

  it('throws when no JSON object is present', () => {
    expect(() => parseAgentArchitectDraft('not json')).toThrow(/json object/i)
  })

  it('supports fallback fields name and description', () => {
    const raw = JSON.stringify({
      name: 'fallback-id',
      description: 'fallback description',
      systemPrompt: 'fallback prompt',
    })
    expect(parseAgentArchitectDraft(raw)).toEqual({
      identifier: 'fallback-id',
      whenToUse: 'fallback description',
      systemPrompt: 'fallback prompt',
    })
  })

  it('throws when payload is not an object-shaped JSON response', () => {
    expect(() => parseAgentArchitectDraft('[]')).toThrow(/none was found/i)
  })

  it('throws for invalid json and missing identifier/systemPrompt', () => {
    expect(() => parseAgentArchitectDraft('{"identifier":}')).toThrow(/failed to parse json/i)
    expect(() =>
      parseAgentArchitectDraft(JSON.stringify({ whenToUse: 'w', systemPrompt: 's', identifier: 123 })),
    ).toThrow(/missing "identifier"/i)
    expect(() =>
      parseAgentArchitectDraft(JSON.stringify({ identifier: 'id', whenToUse: 'w', systemPrompt: 123 })),
    ).toThrow(/missing "systemPrompt"/i)
  })
})

describe('__agentsWizardTestOnly helpers', () => {
  it('builds wizard question sets', () => {
    const entry = buildAgentsWizardEntryQuestions()
    const manual = buildAgentsWizardManualQuestions()
    const generated = buildAgentsWizardGenerateQuestions()
    expect(entry.map((q) => q.header)).toEqual(['scope', 'mode'])
    expect(manual.map((q) => q.header)).toEqual(['name', 'description', 'tools', 'model', 'color', 'systemPrompt'])
    expect(generated.map((q) => q.header)).toEqual(['agentDescription', 'tools', 'model', 'color'])
    expect(manual.find((q) => q.header === 'tools')?.options.length).toBeGreaterThan(0)
  })

  it('normalizes inline yaml values and naming/model/color/tool helpers', async () => {
    expect(__agentsWizardTestOnly.yamlInlineValue(' line1\r\nline2 ')).toBe('line1\\nline2')
    expect(__agentsWizardTestOnly.normalizeAgentName('  __My Agent!!__  ')).toBe('my-agent')
    expect(__agentsWizardTestOnly.normalizeAgentName('---')).toBe('')
    expect(__agentsWizardTestOnly.normalizeAgentModel('')).toBeNull()
    expect(__agentsWizardTestOnly.normalizeAgentModel(' OPUS ')).toBe('opus')
    expect(__agentsWizardTestOnly.normalizeAgentModel('x')).toBeNull()
    expect(__agentsWizardTestOnly.normalizeAgentColor('')).toBeNull()
    expect(__agentsWizardTestOnly.normalizeAgentColor('Automatic')).toBeNull()
    expect(__agentsWizardTestOnly.normalizeAgentColor(' Blue ')).toBe('blue')
    expect(__agentsWizardTestOnly.toolsFrontmatterFromAnswer('')).toBeNull()
    expect(__agentsWizardTestOnly.toolsFrontmatterFromAnswer('All tools')).toBeNull()
    expect(__agentsWizardTestOnly.toolsFrontmatterFromAnswer('Edit tools')).toBe('Read, Edit, Write, NotebookEdit')
    expect(__agentsWizardTestOnly.toolsFrontmatterFromAnswer('*')).toBeNull()
    expect(__agentsWizardTestOnly.toolsFrontmatterFromAnswer('Read, Write')).toBe('Read, Write')

    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-pick-path-'))
    try {
      const first = await __agentsWizardTestOnly.pickNonexistentPath({ dir: tmp, baseName: '', ext: 'md' })
      expect(first).toBe(path.join(tmp, 'agent.md'))
      await fsp.writeFile(first, 'x', 'utf8')
      const second = await __agentsWizardTestOnly.pickNonexistentPath({ dir: tmp, baseName: 'agent', ext: '.md' })
      expect(second).toBe(path.join(tmp, 'agent-2.md'))
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true })
    }
  })

  it('handles prompt helpers and json extraction edge cases', async () => {
    expect(__agentsWizardTestOnly.stripLeadingHtmlComment('<!-- note -->\nPrompt body')).toBe('Prompt body')
    expect(__agentsWizardTestOnly.stripLeadingHtmlComment('No comment')).toBe('No comment')
    expect(__agentsWizardTestOnly.stripLeadingHtmlComment('<!-- open comment')).toBe('<!-- open comment')
    expect(__agentsWizardTestOnly.stripLeadingHtmlComment(undefined as any)).toBe('')
    expect(__agentsWizardTestOnly.interpolatePrompt('hello ${NAME}', { NAME: 'world' })).toBe('hello world')
    expect(__agentsWizardTestOnly.interpolatePrompt('hello ${MISSING}', {})).toBe('hello ${MISSING}')
    expect(__agentsWizardTestOnly.interpolatePrompt('hello ${MISSING}', { NAME: 'world' })).toBe('hello ${MISSING}')
    expect(__agentsWizardTestOnly.interpolatePrompt(undefined as any, { NAME: 'world' })).toBe('')

    const promptFile = path.join(__agentsWizardTestOnly.PROMPTS_DIR, '__tmp-agents-wizard-prompt.md')
    try {
      await fsp.writeFile(promptFile, '<!-- c -->\nUse ${TASK_TOOL_NAME}', 'utf8')
      const loaded = await __agentsWizardTestOnly.loadPrompt('__tmp-agents-wizard-prompt.md', { TASK_TOOL_NAME: 'Task' }, 'fallback')
      expect(loaded).toBe('Use Task')
    } finally {
      await fsp.rm(promptFile, { force: true })
    }

    const fallback = await __agentsWizardTestOnly.loadPrompt('__missing__.md', {}, 'fallback-text')
    expect(fallback).toBe('fallback-text')

    expect(
      __agentsWizardTestOnly.extractAssistantText([
        { type: 'text', text: 'a' } as any,
        { type: 'tool_use' } as any,
        { type: 'text', text: 'b' } as any,
        { type: 'text', text: null } as any,
      ]),
    ).toBe('ab')

    const fenced = [
      'before',
      '```json',
      '{"identifier":"x","whenToUse":"y","systemPrompt":"z"}',
      '```',
      'after',
    ].join('\n')
    expect(__agentsWizardTestOnly.extractFirstJsonObject(fenced)).toBe('{"identifier":"x","whenToUse":"y","systemPrompt":"z"}')
    expect(__agentsWizardTestOnly.extractFirstJsonObject('```json\nno-json\n```\n{"a":1}')).toBe('{"a":1}')
    expect(__agentsWizardTestOnly.extractFirstJsonObject('prefix {"a":"}","b":1} suffix')).toBe('{"a":"}","b":1}')
    expect(__agentsWizardTestOnly.extractFirstJsonObject('{"a":{"b":1}}')).toBe('{"a":{"b":1}}')
    expect(__agentsWizardTestOnly.extractFirstJsonObject('{"a":"\\\\\\"","b":2}')).toBe('{"a":"\\\\\\"","b":2}')
    expect(__agentsWizardTestOnly.extractFirstJsonObject('{"unterminated": true')).toBeNull()
    expect(__agentsWizardTestOnly.extractFirstJsonObject('no object')).toBeNull()
  })

  it('throws when filename slot is exhausted', async () => {
    const accessSpy = vi.spyOn(fsp, 'access').mockResolvedValue(undefined as any)
    try {
      await expect(
        __agentsWizardTestOnly.pickNonexistentPath({ dir: '/tmp', baseName: 'agent', ext: '.md' }),
      ).rejects.toThrow(/failed to find an available filename/i)
    } finally {
      accessSpy.mockRestore()
    }
  })
})

describe('generateAgentDraftWithClaude', () => {
  it('runs engine turn and parses assistant json', async () => {
    const runTurn = vi.fn(async (args: any) => {
      args.onEvent({ type: 'noop' })
      return [
        {
          role: 'assistant',
          content: [{ type: 'text', text: '{"identifier":"draft-a","whenToUse":"when needed","systemPrompt":"do it"}' }],
        },
      ]
    })
    const engine = { runTurn } as any
    const ac = new AbortController()
    const out = await generateAgentDraftWithClaude({
      engine,
      description: 'create an agent',
      cwd: '/tmp',
      model: 'test-model',
      signal: ac.signal,
    })
    expect(out).toEqual({
      name: 'draft-a',
      description: 'when needed',
      systemPrompt: 'do it',
    })
    expect(runTurn).toHaveBeenCalledTimes(1)
    const args = runTurn.mock.calls[0][0]
    expect(args.cwd).toBe('/tmp')
    expect(args.model).toBe('test-model')
    expect(args.signal).toBe(ac.signal)
    expect(args.exec).toEqual({ agentDepth: 1 })
  })

  it('rejects invalid generation inputs and missing assistant json', async () => {
    const engine = { runTurn: vi.fn(async () => [{ role: 'user', content: [] }]) } as any
    await expect(generateAgentDraftWithClaude({ engine, description: '', cwd: '/tmp' })).rejects.toThrow(
      /missing agent description/i,
    )
    await expect(generateAgentDraftWithClaude({ engine, description: 'x', cwd: '/tmp' })).rejects.toThrow(/json object/i)
  })

  it('covers execution tools preset and undefined optional fields', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-agents-exec-'))
    try {
      const projectAgentsDir = path.join(cwd, '.formax', 'agents')
      const out = await createAgentFromWizardAnswers({
        cwd,
        projectAgentsDir,
        answers: {
          scope: undefined,
          name: 'runner',
          description: 'runs commands',
          tools: 'Execution tools',
          model: undefined,
          color: undefined,
          systemPrompt: 'run it',
        } as any,
      })
      const raw = await fsp.readFile(out.filePath, 'utf8')
      expect(raw).toContain('tools: Bash')
      expect(raw).not.toContain('model:')
      expect(raw).not.toContain('color:')

      const withoutTools = await createAgentFromWizardAnswers({
        cwd,
        projectAgentsDir,
        answers: {
          scope: undefined,
          name: 'runner-2',
          description: 'runs commands',
          tools: undefined,
          model: undefined,
          color: undefined,
          systemPrompt: 'run it',
        } as any,
      })
      const raw2 = await fsp.readFile(withoutTools.filePath, 'utf8')
      expect(raw2).not.toContain('tools:')
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })

  it('returns null tools for comma-only custom input', () => {
    expect(__agentsWizardTestOnly.toolsFrontmatterFromAnswer(' , , ')).toBeNull()
  })
})
