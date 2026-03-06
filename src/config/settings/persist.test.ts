import { describe, expect, it, vi } from 'vitest'
import { FormaxConfigV1Schema } from './schema'
import {
  mergeConfigPatches,
  readConfigPatch,
  stripDefaultsFromPatch,
  updateConfigPatchFile,
} from './persist'

function createFileStore(args?: {
  exists?: Record<string, boolean>
  text?: Record<string, string>
  throwRead?: string[]
}) {
  const throwSet = new Set(args?.throwRead ?? [])
  return {
    exists: vi.fn(async (filePath: string) => Boolean(args?.exists?.[filePath])),
    readText: vi.fn(async (filePath: string) => {
      if (throwSet.has(filePath)) throw new Error('read failed')
      return args?.text?.[filePath] ?? ''
    }),
    writeJsonAtomic: vi.fn(async () => {}),
  } as any
}

describe('stripDefaultsFromPatch', () => {
  it('omits default llm.defaultTier (sonnet) from sparse patch', () => {
    const out = stripDefaultsFromPatch({
      version: 1,
      llm: { defaultTier: 'sonnet' },
    })
    expect(out.llm).toBeUndefined()
  })

  it('keeps non-default llm.defaultTier in sparse patch', () => {
    const out = stripDefaultsFromPatch({
      version: 1,
      llm: { defaultTier: 'opus' },
    })
    expect(out.llm?.defaultTier).toBe('opus')
  })

  it('strips all default sections and keeps non-default values', () => {
    const defaults = FormaxConfigV1Schema.parse({})
    const strippedDefaults = stripDefaultsFromPatch({
      version: 1,
      llm: { ...defaults.llm },
      paths: { ...defaults.paths },
      ui: { ...defaults.ui },
      context: { ...defaults.context },
    })

    expect(strippedDefaults.llm).toBeUndefined()
    expect(strippedDefaults.paths).toBeUndefined()
    expect(strippedDefaults.ui).toBeUndefined()
    expect(strippedDefaults.context).toBeUndefined()

    const kept = stripDefaultsFromPatch({
      version: 1,
      llm: { model: 'custom-model' },
      paths: { logsDir: '/tmp/logs' },
      ui: { verboseOutput: !defaults.ui.verboseOutput },
      context: { baselineTokens: (defaults.context.baselineTokens ?? 0) + 1 },
    })

    expect(kept.llm?.model).toBe('custom-model')
    expect(kept.paths?.logsDir).toBe('/tmp/logs')
    expect(kept.ui?.verboseOutput).toBe(!defaults.ui.verboseOutput)
    expect(kept.context?.baselineTokens).toBe((defaults.context.baselineTokens ?? 0) + 1)
  })
})

describe('readConfigPatch', () => {
  it('returns empty patch when file is missing', async () => {
    const fileStore = createFileStore({ exists: { '/cfg.json': false } })
    const res = await readConfigPatch({ fileStore, filePath: '/cfg.json', label: 'config' })
    expect(res.patch).toEqual({})
    expect(res.warnings).toEqual([])
  })

  it('adds warning when read fails', async () => {
    const fileStore = createFileStore({
      exists: { '/cfg.json': true },
      throwRead: ['/cfg.json'],
    })
    const res = await readConfigPatch({ fileStore, filePath: '/cfg.json', label: 'config' })
    expect(res.patch).toEqual({})
    expect(res.warnings).toContain('Failed to read config at /cfg.json')
  })

  it('adds warning when parse fails', async () => {
    const fileStore = createFileStore({
      exists: { '/cfg.json': true },
      text: { '/cfg.json': '{broken-json' },
    })
    const res = await readConfigPatch({ fileStore, filePath: '/cfg.json', label: 'config' })
    expect(res.patch).toEqual({})
    expect(res.warnings).toContain('Failed to parse config JSON at /cfg.json')
  })

  it('adds warning when patch schema is invalid', async () => {
    const fileStore = createFileStore({
      exists: { '/cfg.json': true },
      text: { '/cfg.json': '{"llm":{"timeoutMs":"bad"}}' },
    })
    const res = await readConfigPatch({ fileStore, filePath: '/cfg.json', label: 'config' })
    expect(res.patch).toEqual({})
    expect(res.warnings).toContain('config is invalid and was ignored')
  })

  it('uses default label fallback when label is omitted', async () => {
    const fileStore = createFileStore({
      exists: { '/cfg.json': true },
      text: { '/cfg.json': '{"llm":{"timeoutMs":"bad"}}' },
    })
    const res = await readConfigPatch({ fileStore, filePath: '/cfg.json' })
    expect(res.warnings).toContain('config is invalid and was ignored')
  })

  it('handles schema-invalid falsy raw value without invalid-warning push', async () => {
    const fileStore = createFileStore({
      exists: { '/cfg.json': true },
      text: { '/cfg.json': 'false' },
    })
    const res = await readConfigPatch({ fileStore, filePath: '/cfg.json' })
    expect(res.patch).toEqual({})
    expect(res.warnings).toEqual([])
  })

  it('returns parsed patch when schema is valid', async () => {
    const fileStore = createFileStore({
      exists: { '/cfg.json': true },
      text: { '/cfg.json': '{"llm":{"model":"x"}}' },
    })
    const res = await readConfigPatch({ fileStore, filePath: '/cfg.json', label: 'config' })
    expect(res.patch).toEqual({ llm: { model: 'x' } })
    expect(res.warnings).toEqual([])
  })
})

describe('merge/update config patch', () => {
  it('mergeConfigPatches deep-merges nested groups', () => {
    const merged = mergeConfigPatches(
      { llm: { model: 'a' }, ui: { } },
      { llm: { timeoutMs: 1 }, paths: { logsDir: '/tmp' } },
    )
    expect(merged).toEqual({
      llm: { model: 'a', timeoutMs: 1 },
      ui: { },
      paths: { logsDir: '/tmp' },
      context: {},
    })
  })

  it('mergeConfigPatches handles missing nested groups on either side', () => {
    const merged = mergeConfigPatches({}, { llm: { model: 'b' }, paths: { planDir: '/tmp/plan' } })
    expect(merged.llm?.model).toBe('b')
    expect(merged.paths?.planDir).toBe('/tmp/plan')
  })

  it('mergeConfigPatches handles missing next.llm branch', () => {
    const merged = mergeConfigPatches({ llm: { model: 'left' } }, { paths: { logsDir: '/tmp' } })
    expect(merged.llm?.model).toBe('left')
    expect(merged.paths?.logsDir).toBe('/tmp')
  })

  it('updateConfigPatchFile merges, strips defaults, and writes output', async () => {
    const fileStore = createFileStore({
      exists: { '/cfg.json': true },
      text: { '/cfg.json': '{"llm":{"model":"a"}}' },
    })

    const res = await updateConfigPatchFile({
      fileStore,
      filePath: '/cfg.json',
      nextPatch: { llm: { model: 'b' } },
      label: 'config',
    })

    expect(res.filePath).toBe('/cfg.json')
    expect(res.patchWritten.llm?.model).toBe('b')
    expect(fileStore.writeJsonAtomic).toHaveBeenCalledTimes(1)
    expect(fileStore.writeJsonAtomic).toHaveBeenCalledWith('/cfg.json', res.patchWritten)
  })

  it('stripDefaultsFromPatch keeps selected non-default nested fields and skips absent sections', () => {
    const out = stripDefaultsFromPatch({
      version: 1,
      llm: { contextWindowTokens: 123456 },
      paths: { subagentsDir: '/tmp/sub', planDir: '/tmp/plan' },
    })

    expect(out.llm?.contextWindowTokens).toBe(123456)
    expect(out.paths?.subagentsDir).toBe('/tmp/sub')
    expect(out.paths?.planDir).toBe('/tmp/plan')

    const noSections = stripDefaultsFromPatch({ version: 1 })
    expect(noSections).toEqual({ version: 1 })
  })
})
