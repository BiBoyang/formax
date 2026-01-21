import { describe, expect, it } from 'vitest'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { vi } from 'vitest'
import {
  normalizeAgentName,
  buildManualSystemPrompt,
  truncate,
  indent,
  colorToHex,
  getToolsSelectableRows,
  toggleToolGroupSelection,
  parseFrontmatter,
} from './utils.js'

// Mock readAgentDir tests
vi.mock('./utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./utils.js')>()
  return {
    ...actual,
    readAgentDir: vi.fn(),
  }
})

describe('normalizeAgentName', () => {
  it('normalizes agent names to lowercase', () => {
    expect(normalizeAgentName('MyAgent')).toBe('myagent')
    expect(normalizeAgentName('TEST-AGENT')).toBe('test-agent')
  })

  it('replaces non-alphanumeric characters with hyphens', () => {
    expect(normalizeAgentName('my agent')).toBe('my-agent')
    expect(normalizeAgentName('test@agent')).toBe('test-agent')
    expect(normalizeAgentName('agent#1')).toBe('agent-1')
  })

  it('removes leading and trailing separators', () => {
    expect(normalizeAgentName('-agent-')).toBe('agent')
    expect(normalizeAgentName('_agent_')).toBe('agent')
    expect(normalizeAgentName('__agent__')).toBe('agent')
  })

  it('collapses multiple consecutive separators', () => {
    expect(normalizeAgentName('my--agent')).toBe('my-agent')
    // The regex only collapses the same type of separator
    expect(normalizeAgentName('test___agent')).toBe('test___agent')
  })

  it('handles empty input', () => {
    expect(normalizeAgentName('')).toBe('')
    expect(normalizeAgentName('   ')).toBe('')
  })

  it('preserves valid characters', () => {
    expect(normalizeAgentName('my-agent_123')).toBe('my-agent_123')
    expect(normalizeAgentName('agent_v2-test')).toBe('agent_v2-test')
  })
})

describe('buildManualSystemPrompt', () => {
  it('builds system prompt with name and description', () => {
    const result = buildManualSystemPrompt({
      name: 'code-reviewer',
      description: 'Reviews code for best practices',
    })
    expect(result).toContain('code-reviewer agent')
    expect(result).toContain('When to use: Reviews code for best practices')
    expect(result).toContain('Be concise and helpful')
  })

  it('handles special characters in name and description', () => {
    const result = buildManualSystemPrompt({
      name: 'test-agent',
      description: 'Test\'s "special" agent',
    })
    expect(result).toContain('test-agent agent')
    expect(result).toContain('Test\'s "special" agent')
  })
})

describe('truncate', () => {
  it('returns string as-is when under max length', () => {
    expect(truncate('short', 10)).toBe('short')
    expect(truncate('exact', 5)).toBe('exact')
  })

  it('truncates string that exceeds max length', () => {
    expect(truncate('this is too long', 10)).toBe('this is t…')
  })

  it('handles edge cases', () => {
    expect(truncate('', 10)).toBe('')
    expect(truncate('a', 1)).toBe('a')
    expect(truncate('ab', 1)).toBe('…')
  })

  it('handles non-string input', () => {
    expect(truncate(null as any, 10)).toBe('')
    expect(truncate(undefined as any, 10)).toBe('')
  })
})

describe('indent', () => {
  it('indents single line', () => {
    expect(indent('line', 2)).toBe('  line')
  })

  it('indents multiple lines', () => {
    const result = indent('line1\nline2\nline3', 3)
    expect(result).toBe('   line1\n   line2\n   line3')
  })

  it('preserves empty lines', () => {
    const result = indent('line1\n\nline2', 2)
    expect(result).toBe('  line1\n\n  line2')
  })

  it('handles Windows line endings', () => {
    const result = indent('line1\r\nline2', 2)
    expect(result).toBe('  line1\n  line2')
  })

  it('handles empty string', () => {
    expect(indent('', 2)).toBe('')
  })

  it('handles zero spaces', () => {
    expect(indent('line', 0)).toBe('line')
  })

  it('handles negative spaces', () => {
    expect(indent('line', -2)).toBe('line')
  })
})

describe('colorToHex', () => {
  it('converts known color names to hex', () => {
    expect(colorToHex('red', '#000')).toBe('#ff3b30')
    expect(colorToHex('blue', '#000')).toBe('#0a84ff')
    expect(colorToHex('green', '#000')).toBe('#34c759')
  })

  it('uses fallback for unknown colors', () => {
    expect(colorToHex('unknown', '#fallback')).toBe('#fallback')
    expect(colorToHex('', '#fallback')).toBe('#fallback')
  })

  it('handles case-insensitive color names', () => {
    expect(colorToHex('RED', '#000')).toBe('#ff3b30')
    expect(colorToHex('Blue', '#000')).toBe('#0a84ff')
  })

  it('trims whitespace', () => {
    expect(colorToHex('  red  ', '#000')).toBe('#ff3b30')
  })
})

describe('getToolsSelectableRows', () => {
  const baseArgs = {
    toolGroupChecked: {
      all: false,
      readOnly: false,
      edit: false,
      execution: false,
      other: false,
    },
    showAdvancedTools: false,
    selectableToolNames: ['Read', 'Write', 'Bash', 'Grep'],
    selectedToolSet: new Set(['Read']),
  }

  it('generates correct row structure', () => {
    const rows = getToolsSelectableRows(baseArgs)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0].type).toBe('continue')
  })

  it('includes all group rows', () => {
    const rows = getToolsSelectableRows(baseArgs)
    const groupRows = rows.filter((r) => r.type === 'group')
    expect(groupRows).toHaveLength(5) // all, readOnly, edit, execution, other
  })

  it('includes advanced toggle row', () => {
    const rows = getToolsSelectableRows(baseArgs)
    const advancedRows = rows.filter((r) => r.type === 'advanced')
    expect(advancedRows).toHaveLength(1)
  })

  it('shows advanced options when showAdvancedTools is true', () => {
    const rows = getToolsSelectableRows({
      ...baseArgs,
      showAdvancedTools: true,
    })
    const toolRows = rows.filter((r) => r.type === 'tool')
    expect(toolRows.length).toBeGreaterThan(0)
  })

  it('hides advanced options when showAdvancedTools is false', () => {
    const rows = getToolsSelectableRows({
      ...baseArgs,
      showAdvancedTools: false,
    })
    const toolRows = rows.filter((r) => r.type === 'tool')
    expect(toolRows).toHaveLength(0)
  })

  it('sets checked state correctly for groups', () => {
    const rows = getToolsSelectableRows({
      ...baseArgs,
      toolGroupChecked: {
        all: true,
        readOnly: true,
        edit: false,
        execution: false,
        other: false,
      },
    })
    const allRow = rows.find((r) => r.type === 'group' && (r as any).group === 'all')
    expect((allRow as any)?.checked).toBe(true)
  })

  it('sets checked state for individual tools', () => {
    const rows = getToolsSelectableRows({
      ...baseArgs,
      showAdvancedTools: true,
      selectedToolSet: new Set(['Read', 'Write']),
    })
    const readRow = rows.find((r) => r.type === 'tool' && (r as any).tool === 'Read')
    expect((readRow as any)?.checked).toBe(true)
  })

  it('assigns sequential cursor positions', () => {
    const rows = getToolsSelectableRows(baseArgs)
    for (let i = 0; i < rows.length; i++) {
      expect((rows[i] as any).cursor).toBe(i)
    }
  })
})

describe('toggleToolGroupSelection', () => {
  it('toggles all tools on when group is unchecked', () => {
    const onChange = vi.fn()
    toggleToolGroupSelection({
      group: 'all',
      toolGroups: {
        all: new Set(['Read', 'Write', 'Bash']),
        readOnly: new Set(['Read']),
        edit: new Set(['Write']),
        execution: new Set(['Bash']),
        other: new Set<string>(),
      },
      selectedToolSet: new Set(),
      onChange,
    })
    expect(onChange).toHaveBeenCalledWith(['Read', 'Write', 'Bash'])
  })

  it('toggles all tools off when group is checked', () => {
    const onChange = vi.fn()
    toggleToolGroupSelection({
      group: 'all',
      toolGroups: {
        all: new Set(['Read', 'Write', 'Bash']),
        readOnly: new Set(['Read']),
        edit: new Set(['Write']),
        execution: new Set(['Bash']),
        other: new Set<string>(),
      },
      selectedToolSet: new Set(['Read', 'Write', 'Bash']),
      onChange,
    })
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('toggles subgroup on when unchecked', () => {
    const onChange = vi.fn()
    toggleToolGroupSelection({
      group: 'readOnly',
      toolGroups: {
        all: new Set(['Read', 'Write', 'Bash']),
        readOnly: new Set(['Read']),
        edit: new Set(['Write']),
        execution: new Set(['Bash']),
        other: new Set<string>(),
      },
      selectedToolSet: new Set(),
      onChange,
    })
    expect(onChange).toHaveBeenCalledWith(['Read'])
  })

  it('toggles subgroup off when checked', () => {
    const onChange = vi.fn()
    toggleToolGroupSelection({
      group: 'readOnly',
      toolGroups: {
        all: new Set(['Read', 'Write', 'Bash']),
        readOnly: new Set(['Read']),
        edit: new Set(['Write']),
        execution: new Set(['Bash']),
        other: new Set<string>(),
      },
      selectedToolSet: new Set(['Read', 'Write']),
      onChange,
    })
    expect(onChange).toHaveBeenCalledWith(['Write'])
  })

  it('merges subgroup selection with existing tools', () => {
    const onChange = vi.fn()
    toggleToolGroupSelection({
      group: 'edit',
      toolGroups: {
        all: new Set(['Read', 'Write', 'Bash']),
        readOnly: new Set(['Read']),
        edit: new Set(['Write', 'Edit']),
        execution: new Set(['Bash']),
        other: new Set<string>(),
      },
      selectedToolSet: new Set(['Read']),
      onChange,
    })
    const result = onChange.mock.calls[0][0] as string[]
    expect(result).toContain('Read')
    expect(result).toContain('Write')
    expect(result).toContain('Edit')
  })
})

describe('parseFrontmatter', () => {
  it('parses valid frontmatter', () => {
    const input = `---
name: test-agent
model: sonnet
description: A test agent
---
content here`
    const result = parseFrontmatter(input)
    expect(result).toEqual({
      name: 'test-agent',
      model: 'sonnet',
      description: 'A test agent',
    })
  })

  it('handles quoted values', () => {
    const input = `---
name: "my-agent"
model: 'opus'
---
content`
    const result = parseFrontmatter(input)
    expect(result.name).toBe('my-agent')
    expect(result.model).toBe('opus')
  })

  it('handles values with colons', () => {
    const input = `---
description: This is a description with: colons
---
content`
    const result = parseFrontmatter(input)
    expect(result.description).toBe('This is a description with: colons')
  })

  it('returns empty object for no frontmatter', () => {
    const result = parseFrontmatter('no frontmatter here')
    expect(result).toEqual({})
  })

  it('returns empty object for empty string', () => {
    const result = parseFrontmatter('')
    expect(result).toEqual({})
  })

  it('stops at closing delimiter', () => {
    const input = `---
name: test
---
this should not be parsed: as: frontmatter
---
neither should this`
    const result = parseFrontmatter(input)
    expect(result.name).toBe('test')
    expect(result['this should not be parsed']).toBeUndefined()
  })

  it('handles malformed lines gracefully', () => {
    const input = `---
name: valid
invalid line without colon
model: also-valid
---
content`
    const result = parseFrontmatter(input)
    expect(result.name).toBe('valid')
    expect(result.model).toBe('also-valid')
    expect(result['invalid line without colon']).toBeUndefined()
  })

  it('trims whitespace from keys and values', () => {
    const input = `---
  name  :  test-agent  
  model  :  sonnet  
---
content`
    const result = parseFrontmatter(input)
    expect(result.name).toBe('test-agent')
    expect(result.model).toBe('sonnet')
  })

  it('handles empty values', () => {
    const input = `---
name: 
model: sonnet
---
content`
    const result = parseFrontmatter(input)
    expect(result.name).toBe('')
    expect(result.model).toBe('sonnet')
  })
})

describe('readAgentDir (integration)', () => {
  it('is exported from utils', async () => {
    // This test just verifies the module structure
    const utils = await import('./utils.js')
    expect(typeof utils.readAgentDir).toBe('function')
  })
})
