import { describe, expect, it } from 'vitest'
import type { ToolDefinition } from '../types'
import {
  buildToolSearchIndex,
  parseToolSearchQuery,
  resolveToolSearchEngineMode,
  searchToolsWithMode,
} from './toolSearchEngine'

const CATALOG: ToolDefinition[] = [
  {
    name: 'Bash',
    description: 'Execute shell commands in a POSIX terminal',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'shell command' },
      },
    },
  },
  {
    name: 'Grep',
    description: 'Search files with regular expressions',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'regex pattern' },
      },
    },
  },
  {
    name: 'NotebookEdit',
    description: 'Edit Jupyter notebooks and notebook cells',
    input_schema: {
      type: 'object',
      properties: {
        notebook_path: { type: 'string', description: 'Notebook path' },
      },
    },
  },
]

describe('resolveToolSearchEngineMode', () => {
  it('normalizes known engine values with bm25 default fallback', () => {
    expect(resolveToolSearchEngineMode(undefined)).toBe('bm25')
    expect(resolveToolSearchEngineMode('regex')).toBe('regex')
    expect(resolveToolSearchEngineMode('hybrid')).toBe('hybrid')
    expect(resolveToolSearchEngineMode('keyword')).toBe('keyword')
    expect(resolveToolSearchEngineMode('not-real')).toBe('bm25')
  })
})

describe('parseToolSearchQuery', () => {
  it('supports explicit per-query mode prefixes', () => {
    expect(parseToolSearchQuery('select:Bash', 'bm25')).toEqual({ mode: 'select', query: 'Bash' })
    expect(parseToolSearchQuery('regex:bash|grep', 'bm25')).toEqual({ mode: 'regex', query: 'bash|grep' })
    expect(parseToolSearchQuery('bm25:notebook edit', 'regex')).toEqual({ mode: 'bm25', query: 'notebook edit' })
    expect(parseToolSearchQuery('keyword:shell', 'bm25')).toEqual({ mode: 'keyword', query: 'shell' })
    expect(parseToolSearchQuery('just search', 'hybrid')).toEqual({ mode: 'hybrid', query: 'just search' })
  })
})

describe('searchToolsWithMode', () => {
  const index = buildToolSearchIndex(CATALOG)

  it('matches regex queries and reports invalid regex', () => {
    const ok = searchToolsWithMode({
      index,
      mode: 'regex',
      query: 'bash|grep',
      maxMatches: 5,
    })
    expect(ok.error).toBeUndefined()
    expect(ok.matches.map((tool) => tool.name)).toEqual(['Bash', 'Grep'])

    const bad = searchToolsWithMode({
      index,
      mode: 'regex',
      query: '[',
      maxMatches: 5,
    })
    expect(bad.matches).toEqual([])
    expect(String(bad.error || '')).toContain('Invalid regex query')
  })

  it('preserves slash-regex case sensitivity when flags are omitted', () => {
    const caseSensitiveHit = searchToolsWithMode({
      index,
      mode: 'regex',
      query: '/Bash/',
      maxMatches: 5,
    })
    expect(caseSensitiveHit.matches.map((tool) => tool.name)).toContain('Bash')

    const caseSensitiveMiss = searchToolsWithMode({
      index,
      mode: 'regex',
      query: '/bash/',
      maxMatches: 5,
    })
    expect(caseSensitiveMiss.matches.map((tool) => tool.name)).not.toContain('Bash')
  })

  it('uses bm25 ranking for natural-language queries', () => {
    const out = searchToolsWithMode({
      index,
      mode: 'bm25',
      query: 'run shell command',
      maxMatches: 5,
    })

    expect(out.matches[0]?.name).toBe('Bash')
  })

  it('supports required +keyword filtering', () => {
    const out = searchToolsWithMode({
      index,
      mode: 'bm25',
      query: '+notebook edit',
      maxMatches: 5,
    })
    expect(out.matches.map((tool) => tool.name)).toEqual(['NotebookEdit'])
  })

  it('falls back in hybrid mode when bm25 misses', () => {
    const out = searchToolsWithMode({
      index,
      mode: 'hybrid',
      query: 'regular expressions',
      maxMatches: 5,
    })
    expect(out.matches.map((tool) => tool.name)).toContain('Grep')
  })
})
