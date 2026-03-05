import type { ToolDefinition } from '../types'
import { toolSearchToolSpec } from '../modules/toolSearch/spec'
import { toToolReferenceBlock } from '../../shared/utils/toolResultContent'
import type { ToolResultContent } from '../../shared/toolContracts'
import {
  buildToolSearchIndex,
  parseToolSearchQuery,
  resolveToolSearchEngineMode,
  searchToolsWithMode,
  type ToolSearchEngineMode,
  type ToolSearchIndex,
} from './toolSearchEngine'

const MAX_KEYWORD_MATCHES = 5
const MAX_DEFERRED_EXPOSURE_SESSIONS = 200

type DeferredSession = {
  catalog: ToolDefinition[]
  catalogByLowerName: Map<string, ToolDefinition>
  loadedNames: Set<string>
  searchEngine: ToolSearchEngineMode
  searchIndex: ToolSearchIndex
}

export type DeferredToolSearchResult = {
  isError: boolean
  loadedNames: string[]
  matchedNames: string[]
  content: ToolResultContent
}

export class DeferredToolExposureStore {
  private sessions = new Map<string, DeferredSession>()

  resetSession(sessionKey: string): void {
    this.sessions.delete(normalizeSessionKey(sessionKey))
  }

  registerCatalog(args: {
    sessionKey: string
    tools: ToolDefinition[]
    toolSearchEngine?: string | null
  }): void {
    const key = normalizeSessionKey(args.sessionKey)
    const previous = this.sessions.get(key)

    const catalog = args.tools
      .filter((tool) => tool && typeof tool.name === 'string' && tool.name !== toolSearchToolSpec.name)
      .map((tool) => ({ ...tool, defer_loading: true }))
    const searchEngine = resolveToolSearchEngineMode(args.toolSearchEngine ?? previous?.searchEngine)
    const searchIndex = buildToolSearchIndex(catalog)

    const catalogByLowerName = new Map<string, ToolDefinition>()
    for (const tool of catalog) {
      catalogByLowerName.set(tool.name.toLowerCase(), tool)
    }

    const loadedNames = new Set<string>()
    if (previous) {
      for (const name of previous.loadedNames) {
        if (catalogByLowerName.has(name.toLowerCase())) loadedNames.add(name)
      }
    }

    // Refresh insertion order so most recently touched sessions stay resident.
    this.sessions.delete(key)
    this.sessions.set(key, {
      catalog,
      catalogByLowerName,
      loadedNames,
      searchEngine,
      searchIndex,
    })
    this.trimExcessSessions()
  }

  buildAvailableDeferredToolsBlock(sessionKey: string): string {
    const state = this.sessions.get(normalizeSessionKey(sessionKey))
    if (!state || state.catalog.length === 0) return '<available-deferred-tools>\n</available-deferred-tools>'
    const names = state.catalog.map((tool) => tool.name)
    return `<available-deferred-tools>\n${names.join('\n')}\n</available-deferred-tools>`
  }

  resolveToolsForModel(sessionKey: string): ToolDefinition[] {
    const state = this.sessions.get(normalizeSessionKey(sessionKey))
    if (!state) return [toolSearchToolSpec]

    const loaded = state.catalog.filter((tool) => state.loadedNames.has(tool.name))
    return [toolSearchToolSpec, ...loaded]
  }

  searchAndLoad(args: { sessionKey: string; query: string }): DeferredToolSearchResult {
    const key = normalizeSessionKey(args.sessionKey)
    const state = this.sessions.get(key)
    const query = String(args.query || '').trim()

    if (!state || state.catalog.length === 0) {
      return {
        isError: true,
        loadedNames: [],
        matchedNames: [],
        content: 'No deferred tools are currently available in this session.',
      }
    }

    if (!query) {
      return {
        isError: true,
        loadedNames: [],
        matchedNames: [],
        content: 'ToolSearch query must be a non-empty string.',
      }
    }

    const parsedQuery = parseToolSearchQuery(query, state.searchEngine)
    let searchError: string | null = null
    let matched: ToolDefinition[] = []
    if (parsedQuery.mode === 'select') {
      matched = selectByName(state, parsedQuery.query)
    } else {
      const searched = searchToolsWithMode({
        index: state.searchIndex,
        mode: parsedQuery.mode,
        query: parsedQuery.query,
        maxMatches: MAX_KEYWORD_MATCHES,
      })
      matched = searched.matches
      searchError = searched.error || null
    }

    if (searchError) {
      return {
        isError: true,
        loadedNames: state.catalog.filter((tool) => state.loadedNames.has(tool.name)).map((tool) => tool.name),
        matchedNames: [],
        content: searchError,
      }
    }

    for (const tool of matched) state.loadedNames.add(tool.name)

    const matchedNames = matched.map((tool) => tool.name)
    const loadedNames = state.catalog.filter((tool) => state.loadedNames.has(tool.name)).map((tool) => tool.name)

    if (matchedNames.length === 0) {
      return {
        isError: true,
        loadedNames,
        matchedNames,
        content: `No deferred tools matched query: ${query}`,
      }
    }

    const lines: string[] = []
    lines.push(`Loaded ${matchedNames.length} tool(s) for query: ${query}`)
    lines.push('Matched tools:')
    for (const name of matchedNames) lines.push(`- ${name}`)
    lines.push('Currently loaded tools:')
    for (const name of loadedNames) lines.push(`- ${name}`)

    const matchedToolBlocks = matched.map((tool) => toToolReferenceBlock(tool))

    return {
      isError: false,
      loadedNames,
      matchedNames,
      content: [
        { type: 'text', text: lines.join('\n') },
        ...matchedToolBlocks,
      ],
    }
  }

  private trimExcessSessions(): void {
    while (this.sessions.size > MAX_DEFERRED_EXPOSURE_SESSIONS) {
      const oldestKey = this.sessions.keys().next().value
      if (typeof oldestKey !== 'string' || !oldestKey) break
      this.sessions.delete(oldestKey)
    }
  }
}

function selectByName(state: DeferredSession, raw: string): ToolDefinition[] {
  const names = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)

  const out: ToolDefinition[] = []
  for (const name of names) {
    const tool = state.catalogByLowerName.get(name.toLowerCase())
    if (!tool) continue
    if (!out.some((item) => item.name === tool.name)) out.push(tool)
  }
  return out
}

function normalizeSessionKey(input: string): string {
  const trimmed = String(input || '').trim()
  return trimmed || 'default'
}

let singletonStore: DeferredToolExposureStore | null = null

export function getDeferredToolExposureStore(): DeferredToolExposureStore {
  if (!singletonStore) singletonStore = new DeferredToolExposureStore()
  return singletonStore
}

export function resolveToolExposureSessionKey(input: {
  explicitSessionKey?: string | null
  cwd?: string | null
}): string {
  const explicit = String(input.explicitSessionKey || '').trim()
  if (explicit) return explicit

  const cwd = String(input.cwd || '').trim()
  if (cwd) return `cwd:${cwd}`

  return 'default'
}
