import type { FileStore } from '../../adapters/fs/fileStore.js'
import type { Platform } from '../../adapters/fs/configPaths.js'
import { getConfigPaths } from '../../adapters/fs/configPaths.js'
import type { PolicyRule, PolicyRulesFile, PolicyScope } from './schema.js'
import { PolicyRulesFileSchema } from './schema.js'

export type LoadedPolicyRules = {
  paths: {
    globalRulesPath: string
    projectRulesPath: string
  }
  globalRules: PolicyRulesFile | null
  projectRules: PolicyRulesFile | null
  mergedRules: PolicyRule[]
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

function normalizeRuleScopes(args: {
  scope: PolicyScope
  filePath: string
  rules: PolicyRule[]
  warnings: string[]
}): PolicyRule[] {
  let hadMismatch = false
  const normalized = args.rules.map((rule) => {
    if (rule.scope === args.scope) return rule
    hadMismatch = true
    return { ...rule, scope: args.scope }
  })

  if (hadMismatch) {
    args.warnings.push(`Some rules in ${args.filePath} did not match scope "${args.scope}" and were normalized`)
  }

  return normalized
}

function parseRulesFile(args: {
  value: unknown
  scope: PolicyScope
  filePath: string
  warnings: string[]
}): PolicyRulesFile | null {
  const parsed = PolicyRulesFileSchema.safeParse(args.value)
  if (!parsed.success) {
    args.warnings.push(`Invalid rules schema at ${args.filePath}`)
    return null
  }

  return {
    version: parsed.data.version,
    rules: normalizeRuleScopes({
      scope: args.scope,
      filePath: args.filePath,
      rules: parsed.data.rules,
      warnings: args.warnings,
    }),
  }
}

export function mergePolicyRules(args: {
  globalRules: PolicyRulesFile | null
  projectRules: PolicyRulesFile | null
}): PolicyRule[] {
  const project = args.projectRules?.rules ?? []
  const global = args.globalRules?.rules ?? []
  return [...project, ...global]
}

export async function loadPolicyRules(args: {
  fileStore: FileStore
  cwd?: string
  env?: NodeJS.ProcessEnv
  platform?: Platform
  homedir?: string
}): Promise<LoadedPolicyRules> {
  const paths = getConfigPaths(args)
  const warnings: string[] = []

  const rawGlobal = await readJsonIfExists(args.fileStore, paths.globalRulesPath, 'global rules', warnings)
  const rawProject = await readJsonIfExists(args.fileStore, paths.projectRulesPath, 'project rules', warnings)

  const globalRules = rawGlobal
    ? parseRulesFile({ value: rawGlobal, scope: 'global', filePath: paths.globalRulesPath, warnings })
    : null
  const projectRules = rawProject
    ? parseRulesFile({ value: rawProject, scope: 'project', filePath: paths.projectRulesPath, warnings })
    : null

  return {
    paths: { globalRulesPath: paths.globalRulesPath, projectRulesPath: paths.projectRulesPath },
    globalRules,
    projectRules,
    mergedRules: mergePolicyRules({ globalRules, projectRules }),
    warnings,
  }
}

export async function savePolicyRules(args: {
  fileStore: FileStore
  scope: 'global' | 'project'
  rules: PolicyRule[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  platform?: Platform
  homedir?: string
}): Promise<{ filePath: string }> {
  const paths = getConfigPaths(args)
  const filePath = args.scope === 'global' ? paths.globalRulesPath : paths.projectRulesPath

  const file = PolicyRulesFileSchema.parse({
    version: 1,
    rules: args.rules.map((rule) => ({ ...rule, scope: args.scope })),
  })

  await args.fileStore.writeJsonAtomic(filePath, file, { pretty: true, trailingNewline: true })
  return { filePath }
}

