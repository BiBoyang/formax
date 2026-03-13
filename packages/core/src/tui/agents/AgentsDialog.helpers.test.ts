import { describe, expect, it } from 'vitest'
import { __agentsDialogTestOnly } from './AgentsDialog.js'
import { BUILTIN_AGENT_NAMES } from './constants.js'

describe('__agentsDialogTestOnly', () => {
  it('builds grouped agents with builtin/project/user precedence and fallback model', () => {
    const markerBuiltin = 'x-builtin-fallback'
    BUILTIN_AGENT_NAMES.add(markerBuiltin)
    try {
      const grouped = __agentsDialogTestOnly.buildGroupedAgents(
        [
          { name: 'general-purpose', description: 'builtin existing' } as any,
          { name: markerBuiltin, description: 'builtin fallback' } as any,
          { name: 'proj-only', description: 'project' } as any,
          { name: 'user-only', description: 'user' } as any,
          { name: 'inherit-only', description: 'none' } as any,
          { name: 'proj-only', description: 'duplicate to filter user copy' } as any,
        ],
        { 'proj-only': { model: 'Opus' } as any },
        { 'user-only': { model: 'Sonnet' } as any, 'proj-only': { model: 'Haiku' } as any },
      )

      expect(grouped.projectAgents.some((a) => a.name === 'proj-only' && a.model === 'Opus')).toBe(true)
      expect(grouped.userAgents.some((a) => a.name === 'user-only' && a.model === 'Sonnet')).toBe(true)
      expect(grouped.userAgents.some((a) => a.name === 'inherit-only' && a.model === 'inherit')).toBe(true)
      expect(grouped.builtins.some((a) => a.name.toLowerCase() === markerBuiltin && a.model === 'inherit')).toBe(true)
    } finally {
      BUILTIN_AGENT_NAMES.delete(markerBuiltin)
    }
  })

  it('computes tools answer for all predefined group matches and custom sets', () => {
    const readOnly = new Set(['Read', 'Glob', 'Grep'])
    const edit = new Set(['Edit', 'Write'])
    const execution = new Set(['Bash'])

    expect(
      __agentsDialogTestOnly.computeToolsAnswer(
        ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash'],
        new Set(['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash']),
        { readOnly, edit, execution },
      ),
    ).toBe('All tools')

    expect(
      __agentsDialogTestOnly.computeToolsAnswer(
        ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash'],
        new Set(['Read', 'Glob', 'Grep']),
        { readOnly, edit, execution },
      ),
    ).toBe('Read-only tools')

    expect(
      __agentsDialogTestOnly.computeToolsAnswer(
        ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash'],
        new Set(['Edit', 'Write']),
        { readOnly, edit, execution },
      ),
    ).toBe('Edit tools')

    expect(
      __agentsDialogTestOnly.computeToolsAnswer(
        ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash'],
        new Set(['Bash']),
        { readOnly, edit, execution },
      ),
    ).toBe('Execution tools')

    expect(
      __agentsDialogTestOnly.computeToolsAnswer(
        ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash'],
        new Set(['Write', 'Read']),
        { readOnly, edit, execution },
      ),
    ).toBe('Read, Write')
  })

  it('returns hints for all view categories', () => {
    expect(__agentsDialogTestOnly.getHintForView('confirm')).toContain('save')
    expect(__agentsDialogTestOnly.getHintForView('create_manual_name')).toContain('Enter to continue')
    expect(__agentsDialogTestOnly.getHintForView('create_manual_desc')).toContain('Enter to continue')
    expect(__agentsDialogTestOnly.getHintForView('create_generate_desc')).toContain('Enter to submit')
    expect(__agentsDialogTestOnly.getHintForView('generating_draft')).toContain('Esc to cancel')
    expect(__agentsDialogTestOnly.getHintForView('saving_agent')).toContain('Esc to cancel')
    expect(__agentsDialogTestOnly.getHintForView('create_scope')).toContain('↑↓ to navigate')
    expect(__agentsDialogTestOnly.getHintForView('list')).toContain('Press ↑↓ to navigate')
  })

  it('validates manual draft inputs', () => {
    expect(__agentsDialogTestOnly.validateManualDraft('', 'desc').error).toBe('Missing agent name.')
    expect(__agentsDialogTestOnly.validateManualDraft('agent', '').error).toBe('Missing agent description.')
    expect(__agentsDialogTestOnly.validateManualDraft('Agent Name', '  desc  ').draft).toEqual({
      name: 'agent-name',
      description: 'desc',
      systemPrompt: expect.any(String),
    })
  })

  it('covers generic helper branches for errors, view kinds, cursor math, and confirm data', () => {
    expect(__agentsDialogTestOnly.toErrorMessage(new Error('boom'), 'fallback')).toBe('boom')
    expect(__agentsDialogTestOnly.toErrorMessage('', 'fallback')).toBe('fallback')
    expect(__agentsDialogTestOnly.toErrorMessage('msg', 'fallback')).toBe('msg')

    expect(__agentsDialogTestOnly.isBusyView('generating_draft')).toBe(true)
    expect(__agentsDialogTestOnly.isBusyView('saving_agent')).toBe(true)
    expect(__agentsDialogTestOnly.isBusyView('list')).toBe(false)

    expect(__agentsDialogTestOnly.isManualTextView('create_manual_name')).toBe(true)
    expect(__agentsDialogTestOnly.isManualTextView('create_manual_desc')).toBe(true)
    expect(__agentsDialogTestOnly.isManualTextView('confirm')).toBe(false)

    expect(__agentsDialogTestOnly.isChoiceView('create_scope')).toBe(true)
    expect(__agentsDialogTestOnly.isChoiceView('create_method')).toBe(true)
    expect(__agentsDialogTestOnly.isChoiceView('create_tools')).toBe(true)
    expect(__agentsDialogTestOnly.isChoiceView('create_model')).toBe(true)
    expect(__agentsDialogTestOnly.isChoiceView('create_color')).toBe(true)
    expect(__agentsDialogTestOnly.isChoiceView('list')).toBe(false)

    expect(__agentsDialogTestOnly.shouldAwaitBufferedArrow({ pending: true, delta: 0 })).toBe(true)
    expect(__agentsDialogTestOnly.shouldAwaitBufferedArrow({ pending: true, delta: 1 })).toBe(false)
    expect(__agentsDialogTestOnly.shouldAwaitBufferedArrow({ pending: false, delta: 0 })).toBe(false)

    const toolGroupChecked = { all: true, readOnly: false, edit: false, execution: false, other: false }
    const selectedToolSet = new Set(['Read'])
    expect(
      __agentsDialogTestOnly.getChoiceMaxCursor({
        kind: 'create_scope',
        toolGroupChecked,
        showAdvancedTools: false,
        selectableToolNames: ['Read'],
        selectedToolSet,
      }),
    ).toBeGreaterThanOrEqual(0)
    expect(
      __agentsDialogTestOnly.getChoiceMaxCursor({
        kind: 'create_method',
        toolGroupChecked,
        showAdvancedTools: false,
        selectableToolNames: ['Read'],
        selectedToolSet,
      }),
    ).toBeGreaterThanOrEqual(0)
    expect(
      __agentsDialogTestOnly.getChoiceMaxCursor({
        kind: 'create_tools',
        toolGroupChecked,
        showAdvancedTools: true,
        selectableToolNames: ['Read', 'Bash'],
        selectedToolSet: new Set(['Read', 'Bash']),
      }),
    ).toBeGreaterThanOrEqual(0)
    expect(
      __agentsDialogTestOnly.getChoiceMaxCursor({
        kind: 'create_model',
        toolGroupChecked,
        showAdvancedTools: false,
        selectableToolNames: ['Read'],
        selectedToolSet,
      }),
    ).toBeGreaterThanOrEqual(0)
    expect(
      __agentsDialogTestOnly.getChoiceMaxCursor({
        kind: 'create_color',
        toolGroupChecked,
        showAdvancedTools: false,
        selectableToolNames: ['Read'],
        selectedToolSet,
      }),
    ).toBeGreaterThanOrEqual(0)

    expect(__agentsDialogTestOnly.getToolsSelectionText(true, 3)).toBe('All tools selected')
    expect(__agentsDialogTestOnly.getToolsSelectionText(false, 2)).toBe('2 tools selected')
    expect(__agentsDialogTestOnly.getToolsSelectionText(false, 0)).toBe('No tools selected')

    expect(__agentsDialogTestOnly.getPreviewNameForColor('draft', '')).toBe('draft')
    expect(__agentsDialogTestOnly.getPreviewNameForColor(undefined, 'My Agent')).toBe('my-agent')
    expect(__agentsDialogTestOnly.getPreviewNameForColor(undefined, '')).toBe('agent')

    expect(__agentsDialogTestOnly.getConfirmSaveAction({ input: '', key: { return: true } })).toBe('save')
    expect(__agentsDialogTestOnly.getConfirmSaveAction({ input: 's', key: {} })).toBe('save')
    expect(__agentsDialogTestOnly.getConfirmSaveAction({ input: 'E', key: {} })).toBe('save_and_edit')
    expect(__agentsDialogTestOnly.getConfirmSaveAction({ input: 'x', key: {} })).toBeNull()

    expect(
      __agentsDialogTestOnly.getArrowNavigationMax({
        kind: 'list',
        listLength: 3,
        toolGroupChecked,
        showAdvancedTools: false,
        selectableToolNames: ['Read'],
        selectedToolSet,
      }),
    ).toBe(2)
    expect(
      __agentsDialogTestOnly.getArrowNavigationMax({
        kind: 'create_scope',
        listLength: 3,
        toolGroupChecked,
        showAdvancedTools: false,
        selectableToolNames: ['Read'],
        selectedToolSet,
      }),
    ).toBeGreaterThanOrEqual(1)
    expect(
      __agentsDialogTestOnly.getArrowNavigationMax({
        kind: 'confirm',
        listLength: 3,
        toolGroupChecked,
        showAdvancedTools: false,
        selectableToolNames: ['Read'],
        selectedToolSet,
      }),
    ).toBeUndefined()

    expect(
      __agentsDialogTestOnly.getConfirmViewData({
        draftName: undefined,
        draftDescription: undefined,
        draftSystemPrompt: undefined,
        scope: 'project',
        toolsAnswer: '',
        selectedModel: 'Sonnet',
      }),
    ).toEqual({
      name: 'agent',
      location: '.formax/agents/agent.md',
      tools: 'All tools',
      selectedModel: 'Sonnet',
      description: '',
      systemPrompt: '',
      warnings: [],
    })

    expect(
      __agentsDialogTestOnly.getConfirmViewData({
        draftName: 'a',
        draftDescription: 'd',
        draftSystemPrompt: 's',
        scope: 'user',
        toolsAnswer: 'All tools',
        selectedModel: 'Haiku',
      }),
    ).toEqual({
      name: 'a',
      location: '~/.formax/agents/a.md',
      tools: 'All tools',
      selectedModel: 'Haiku',
      description: 'd',
      systemPrompt: 's',
      warnings: ['Agent has access to all tools'],
    })

    expect(
      __agentsDialogTestOnly.resolveListEnterAction({
        kind: 'confirm',
        row: undefined,
      }),
    ).toEqual({ handled: false })
    expect(
      __agentsDialogTestOnly.resolveListEnterAction({
        kind: 'list',
        row: { type: 'create' },
      }),
    ).toEqual({ handled: true, action: 'start_create' })
    expect(
      __agentsDialogTestOnly.resolveListEnterAction({
        kind: 'list',
        row: {
          type: 'agent',
          agent: { name: 'x', description: '', scope: 'project', model: 'Sonnet' } as any,
        },
      }),
    ).toMatchObject({ handled: true, action: 'view_agent' })

    const baseChoiceArgs = {
      kind: 'create_tools' as const,
      cursor: 999,
      selectedToolSet: new Set<string>(['Read']),
      selectedTools: ['Read'],
      showAdvancedTools: true,
      selectableToolNames: ['Read'],
      toolGroupChecked: { all: false, readOnly: true, edit: false, execution: false, other: false },
    }

    expect(__agentsDialogTestOnly.resolveChoiceEnterAction(baseChoiceArgs)).toEqual({ handled: false })
    expect(
      __agentsDialogTestOnly.resolveChoiceEnterAction({
        ...baseChoiceArgs,
        cursor: 0,
        showAdvancedTools: false,
        selectableToolNames: [],
      }),
    ).toEqual({ handled: true, action: 'tools_continue' })

    expect(
      __agentsDialogTestOnly.resolveChoiceEnterAction({
        ...baseChoiceArgs,
        cursor: 7,
        selectedToolSet: new Set<string>(),
        selectedTools: [],
      }),
    ).toEqual({ handled: true, action: 'tools_set_selection', tools: ['Read'] })
    expect(
      __agentsDialogTestOnly.resolveChoiceEnterAction({
        ...baseChoiceArgs,
        kind: 'create_model',
        cursor: 0,
      }),
    ).toMatchObject({ handled: true, action: 'set_model' })
    expect(
      __agentsDialogTestOnly.resolveChoiceEnterAction({
        ...baseChoiceArgs,
        kind: 'create_model',
        cursor: 999,
      }),
    ).toEqual({ handled: true, action: 'set_model', model: 'Sonnet' })
    expect(
      __agentsDialogTestOnly.resolveChoiceEnterAction({
        ...baseChoiceArgs,
        kind: 'create_color',
        cursor: 0,
      }),
    ).toMatchObject({ handled: true, action: 'set_color' })
    expect(
      __agentsDialogTestOnly.resolveChoiceEnterAction({
        ...baseChoiceArgs,
        kind: 'create_color',
        cursor: 999,
      }),
    ).toEqual({ handled: true, action: 'set_color', color: 'Blue' })
    expect(
      __agentsDialogTestOnly.resolveChoiceEnterAction({
        ...baseChoiceArgs,
        kind: 'create_scope',
        cursor: 999,
      }),
    ).toEqual({ handled: true, action: 'set_scope', scope: 'project' })
    expect(
      __agentsDialogTestOnly.resolveChoiceEnterAction({
        ...baseChoiceArgs,
        kind: 'create_method',
        cursor: 999,
      }),
    ).toEqual({ handled: true, action: 'set_method', method: 'generate' })
  })
})
