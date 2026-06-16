import type { FileStore } from './fileStore.js'
import type { FormaxConfigV1, FormaxConfigV1Patch, TierContextWindowMapping } from './schema.js'
import {
  ContextConfigPatchSchema,
  FormaxConfigV1Schema,
  LlmConfigPatchSchema,
  PathsConfigPatchSchema,
  UiConfigPatchSchema,
} from './schema.js'

const DEFAULT_CONFIG: FormaxConfigV1 = FormaxConfigV1Schema.parse({})

function sameTierContextWindowTokens(
  a: TierContextWindowMapping | undefined,
  b: TierContextWindowMapping | undefined,
): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  return a.haiku === b.haiku && a.sonnet === b.sonnet && a.opus === b.opus
}

function sameJsonValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

export type ReadConfigPatchResult = {
  patch: FormaxConfigV1Patch
  warnings: string[]
}

async function readJsonIfExists(
  fileStore: FileStore,
  filePath: string,
  label: string,
  warnings: string[],
): Promise<unknown | null> {
  const exists = await fileStore.exists(filePath)
  if (!exists) return null

  let text = ''
  try {
    text = await fileStore.readText(filePath)
  } catch {
    warnings.push(`Failed to read ${label} at ${filePath}`)
    return null
  }

  try {
    return JSON.parse(text)
  } catch {
    warnings.push(`Failed to parse ${label} JSON at ${filePath}`)
    return null
  }
}

function isPlainObject(input: unknown): input is Record<string, unknown> {
  return !!input && typeof input === 'object' && !Array.isArray(input)
}

type SectionShape = Record<string, { safeParse: (value: unknown) => { success: boolean; data?: unknown } }>

function readSectionPatch<T extends Record<string, unknown>>(args: {
  input: unknown
  section: 'llm' | 'paths' | 'ui' | 'context'
  shape: SectionShape
  label: string
  warnings: string[]
}): T | undefined {
  if (args.input === undefined) return undefined
  if (!isPlainObject(args.input)) {
    args.warnings.push(`${args.label} field "${args.section}" is invalid and was ignored`)
    return undefined
  }

  const out: Record<string, unknown> = {}
  for (const [key, schema] of Object.entries(args.shape)) {
    if (!Object.prototype.hasOwnProperty.call(args.input, key)) continue
    const parsed = schema.safeParse((args.input as Record<string, unknown>)[key])
    if (parsed.success) {
      out[key] = parsed.data
      continue
    }
    args.warnings.push(`${args.label} field "${args.section}.${key}" is invalid and was ignored`)
  }
  return Object.keys(out).length > 0 ? (out as T) : undefined
}

function parseConfigPatchLenient(input: unknown, label: string, warnings: string[]): FormaxConfigV1Patch {
  if (input == null || input === false) return {}
  if (!isPlainObject(input)) {
    warnings.push(`${label} is invalid and was ignored`)
    return {}
  }

  const patch: FormaxConfigV1Patch = {}
  if (Object.prototype.hasOwnProperty.call(input, 'version')) {
    if (input.version === 1) patch.version = 1
    else warnings.push(`${label} field "version" is invalid and was ignored`)
  }

  const llm = readSectionPatch<NonNullable<FormaxConfigV1Patch['llm']>>({
    input: input.llm,
    section: 'llm',
    shape: LlmConfigPatchSchema.shape as SectionShape,
    label,
    warnings,
  })
  if (llm) patch.llm = llm

  const paths = readSectionPatch<NonNullable<FormaxConfigV1Patch['paths']>>({
    input: input.paths,
    section: 'paths',
    shape: PathsConfigPatchSchema.shape as SectionShape,
    label,
    warnings,
  })
  if (paths) patch.paths = paths

  const ui = readSectionPatch<NonNullable<FormaxConfigV1Patch['ui']>>({
    input: input.ui,
    section: 'ui',
    shape: UiConfigPatchSchema.shape as SectionShape,
    label,
    warnings,
  })
  if (ui) patch.ui = ui

  const context = readSectionPatch<NonNullable<FormaxConfigV1Patch['context']>>({
    input: input.context,
    section: 'context',
    shape: ContextConfigPatchSchema.shape as SectionShape,
    label,
    warnings,
  })
  if (context) patch.context = context

  return patch
}

export async function readConfigPatch(args: {
  fileStore: FileStore
  filePath: string
  label?: string
}): Promise<ReadConfigPatchResult> {
  const warnings: string[] = []
  const label = args.label ?? 'config'
  const raw = await readJsonIfExists(args.fileStore, args.filePath, label, warnings)
  return { patch: parseConfigPatchLenient(raw, label, warnings), warnings }
}

export function mergeConfigPatches(base: FormaxConfigV1Patch, next: FormaxConfigV1Patch): FormaxConfigV1Patch {
  return {
    ...base,
    ...next,
    llm: { ...(base.llm || {}), ...(next.llm || {}) },
    paths: { ...(base.paths || {}), ...(next.paths || {}) },
    ui: { ...(base.ui || {}), ...(next.ui || {}) },
    context: { ...(base.context || {}), ...(next.context || {}) },
  }
}

function stripEmptyObject<T extends Record<string, unknown>>(obj: T): T | undefined {
  return Object.keys(obj).length === 0 ? undefined : obj
}

export function stripDefaultsFromPatch(patch: FormaxConfigV1Patch): FormaxConfigV1Patch {
  const out: FormaxConfigV1Patch = { ...patch }

  if (out.llm) {
    const llm = { ...out.llm }
    if (llm.provider === DEFAULT_CONFIG.llm.provider) delete llm.provider
    if (llm.baseUrl === DEFAULT_CONFIG.llm.baseUrl) delete llm.baseUrl
    if (llm.model === DEFAULT_CONFIG.llm.model) delete llm.model
    if (llm.defaultTier === DEFAULT_CONFIG.llm.defaultTier) delete llm.defaultTier
    if (sameTierContextWindowTokens(llm.tierContextWindowTokens, DEFAULT_CONFIG.llm.tierContextWindowTokens)) {
      delete llm.tierContextWindowTokens
    }
    if (sameJsonValue(llm.tierContextWindowSources, DEFAULT_CONFIG.llm.tierContextWindowSources)) {
      delete llm.tierContextWindowSources
    }
    if (sameJsonValue(llm.tierContextWindowConfidence, DEFAULT_CONFIG.llm.tierContextWindowConfidence)) {
      delete llm.tierContextWindowConfidence
    }
    if (sameJsonValue(llm.tierContextWindowBindings, DEFAULT_CONFIG.llm.tierContextWindowBindings)) {
      delete llm.tierContextWindowBindings
    }
    if (llm.timeoutMs === DEFAULT_CONFIG.llm.timeoutMs) delete llm.timeoutMs
    if (llm.authRef === DEFAULT_CONFIG.llm.authRef) delete llm.authRef
    if (llm.contextWindowTokens === DEFAULT_CONFIG.llm.contextWindowTokens) delete llm.contextWindowTokens
    if (llm.thinkingMode === DEFAULT_CONFIG.llm.thinkingMode) delete llm.thinkingMode
    if (llm.thinkingEffort === DEFAULT_CONFIG.llm.thinkingEffort) delete llm.thinkingEffort
    out.llm = stripEmptyObject(llm)
  }

  if (out.paths) {
    const paths = { ...out.paths }
    if (paths.logsDir === DEFAULT_CONFIG.paths.logsDir) delete paths.logsDir
    if (paths.subagentsDir === DEFAULT_CONFIG.paths.subagentsDir) delete paths.subagentsDir
    if (paths.planDir === DEFAULT_CONFIG.paths.planDir) delete paths.planDir
    out.paths = stripEmptyObject(paths)
  }

  if (out.ui) {
    const ui = { ...out.ui }
    if (ui.assistantTextMode === DEFAULT_CONFIG.ui.assistantTextMode) delete ui.assistantTextMode
    if (ui.showContextMeter === DEFAULT_CONFIG.ui.showContextMeter) delete ui.showContextMeter
    if (ui.showAutoCompactNotice === DEFAULT_CONFIG.ui.showAutoCompactNotice) delete ui.showAutoCompactNotice
    if (ui.outputStyle === DEFAULT_CONFIG.ui.outputStyle) delete ui.outputStyle
    if (ui.verboseOutput === DEFAULT_CONFIG.ui.verboseOutput) delete ui.verboseOutput
    out.ui = stripEmptyObject(ui)
  }

  if (out.context) {
    const context = { ...out.context }
    if (context.effectiveContextWindowPercent === DEFAULT_CONFIG.context.effectiveContextWindowPercent) {
      delete context.effectiveContextWindowPercent
    }
    if (context.autoCompactTokenLimitPercent === DEFAULT_CONFIG.context.autoCompactTokenLimitPercent) {
      delete context.autoCompactTokenLimitPercent
    }
    if (context.baselineTokens === DEFAULT_CONFIG.context.baselineTokens) delete context.baselineTokens
    if (context.compactKeepLastTurns === DEFAULT_CONFIG.context.compactKeepLastTurns) delete context.compactKeepLastTurns
    if (context.enableAutoCompact === DEFAULT_CONFIG.context.enableAutoCompact) delete context.enableAutoCompact
    if (context.autoCompactMinTurnsBetweenRuns === DEFAULT_CONFIG.context.autoCompactMinTurnsBetweenRuns) {
      delete context.autoCompactMinTurnsBetweenRuns
    }
    out.context = stripEmptyObject(context)
  }

  return out
}

export async function updateConfigPatchFile(args: {
  fileStore: FileStore
  filePath: string
  nextPatch: FormaxConfigV1Patch
  label?: string
}): Promise<{ filePath: string; patchWritten: FormaxConfigV1Patch; warnings: string[] }> {
  const read = await readConfigPatch({ fileStore: args.fileStore, filePath: args.filePath, label: args.label })
  const merged = mergeConfigPatches(read.patch, args.nextPatch)
  const patchWritten = stripDefaultsFromPatch({ version: 1, ...merged })

  await args.fileStore.writeJsonAtomic(args.filePath, patchWritten)
  return { filePath: args.filePath, patchWritten, warnings: read.warnings }
}
