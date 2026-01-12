import type { ConfigShowResult } from '../config/show.js'
import type { AssistantTextMode, PromptProfile } from '../config/schema.js'

export type RuntimeStatusSnapshot = {
  llm: {
    provider: string
    baseUrl: string
    model: string
    timeoutMs: number
    apiKeyPresent: boolean
  }
  paths: {
    logsDir: string
    subagentsDir: string
    planDir: string
  }
  ui: {
    promptProfile: PromptProfile
    assistantTextMode: AssistantTextMode
  }
}

export type StatusSnapshot = {
  version: string
  cwd: string
  runtime: RuntimeStatusSnapshot
  workspaceRoots: string[]
  policySummary: string | null
  config: Pick<ConfigShowResult, 'paths' | 'files' | 'sources' | 'auth'> | null
  warnings: string[]
}

export function createStatusSnapshot(args: {
  version: string
  cwd: string
  workspaceRoots?: string[]
  policySummary?: string | null
  runtime: {
    llm: { provider: string; baseUrl: string; model: string; timeoutMs: number; apiKey?: string }
    paths: { logsDir: string; subagentsDir: string; planDir: string }
    ui: { promptProfile: PromptProfile; assistantTextMode: AssistantTextMode }
  }
  shown?: ConfigShowResult
}): StatusSnapshot {
  const shown = args.shown ?? null
  const warnings = shown ? [...shown.warnings] : []

  const workspaceRootsRaw = args.workspaceRoots?.length ? args.workspaceRoots : [args.cwd]
  const workspaceRoots = Array.from(
    new Set(workspaceRootsRaw.map((p) => String(p || '').trim()).filter(Boolean)),
  )

  return {
    version: args.version,
    cwd: args.cwd,
    runtime: {
      llm: {
        provider: args.runtime.llm.provider,
        baseUrl: args.runtime.llm.baseUrl,
        model: args.runtime.llm.model,
        timeoutMs: args.runtime.llm.timeoutMs,
        apiKeyPresent: Boolean((args.runtime.llm.apiKey || '').trim()),
      },
      paths: {
        logsDir: args.runtime.paths.logsDir,
        subagentsDir: args.runtime.paths.subagentsDir,
        planDir: args.runtime.paths.planDir,
      },
      ui: {
        promptProfile: args.runtime.ui.promptProfile,
        assistantTextMode: args.runtime.ui.assistantTextMode,
      },
    },
    workspaceRoots,
    policySummary: args.policySummary ?? null,
    config: shown ? { paths: shown.paths, files: shown.files, sources: shown.sources, auth: shown.auth } : null,
    warnings,
  }
}
