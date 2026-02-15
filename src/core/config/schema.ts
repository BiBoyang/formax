import { z } from 'zod'

export const ProviderIdSchema = z.enum(['anthropic', 'openai', 'gemini'])
export type ProviderId = z.infer<typeof ProviderIdSchema>

export const AssistantTextModeSchema = z.enum(['stream', 'buffered'])
export type AssistantTextMode = z.infer<typeof AssistantTextModeSchema>

export const PromptProfileSchema = z.enum(['lite', 'full'])
export type PromptProfile = z.infer<typeof PromptProfileSchema>

export const OutputStyleSchema = z.enum(['default', 'explanatory', 'learning'])
export type OutputStyle = z.infer<typeof OutputStyleSchema>

export const ModelTierSchema = z.enum(['haiku', 'sonnet', 'opus'])
export type ModelTier = z.infer<typeof ModelTierSchema>

const TimeoutMsSchema = z.number().int().positive()
const ContextWindowTokensSchema = z.number().int().positive()
const Percent01Schema = z.number().min(0).max(1)
const NonNegativeIntSchema = z.number().int().nonnegative()

export const LlmConfigSchema = z
  .object({
    provider: ProviderIdSchema.default('anthropic'),
    baseUrl: z.string().default(''),
    model: z.string().default(''),
    defaultTier: ModelTierSchema.default('sonnet'),
    timeoutMs: TimeoutMsSchema.default(600000),
    authRef: z.string().default('default'),
    contextWindowTokens: ContextWindowTokensSchema.optional(),
    thinkingMode: z.boolean().default(true),
  })
  .strict()
  .default({})

export type LlmConfig = z.infer<typeof LlmConfigSchema>

export const LlmConfigPatchSchema = z
  .object({
    provider: ProviderIdSchema.optional(),
    baseUrl: z.string().optional(),
    model: z.string().optional(),
    defaultTier: ModelTierSchema.optional(),
    timeoutMs: TimeoutMsSchema.optional(),
    authRef: z.string().optional(),
    contextWindowTokens: ContextWindowTokensSchema.optional(),
    thinkingMode: z.boolean().optional(),
  })
  .strict()

export type LlmConfigPatch = z.infer<typeof LlmConfigPatchSchema>

export const PathsConfigSchema = z
  .object({
    logsDir: z.string().optional(),
    subagentsDir: z.string().optional(),
    planDir: z.string().optional(),
  })
  .strict()
  .default({})

export type PathsConfig = z.infer<typeof PathsConfigSchema>

export const PathsConfigPatchSchema = z
  .object({
    logsDir: z.string().optional(),
    subagentsDir: z.string().optional(),
    planDir: z.string().optional(),
  })
  .strict()

export type PathsConfigPatch = z.infer<typeof PathsConfigPatchSchema>

export const UiConfigSchema = z
  .object({
    assistantTextMode: AssistantTextModeSchema.default('buffered'),
    promptProfile: PromptProfileSchema.default('full'),
    showContextMeter: z.boolean().default(true),
    showAutoCompactNotice: z.boolean().default(true),
    outputStyle: OutputStyleSchema.default('default'),
    verboseOutput: z.boolean().default(false),
  })
  .strict()
  .default({})

export type UiConfig = z.infer<typeof UiConfigSchema>

export const UiConfigPatchSchema = z
  .object({
    assistantTextMode: AssistantTextModeSchema.optional(),
    promptProfile: PromptProfileSchema.optional(),
    showContextMeter: z.boolean().optional(),
    showAutoCompactNotice: z.boolean().optional(),
    outputStyle: OutputStyleSchema.optional(),
    verboseOutput: z.boolean().optional(),
  })
  .strict()

export type UiConfigPatch = z.infer<typeof UiConfigPatchSchema>

export const ContextConfigSchema = z
  .object({
    effectiveContextWindowPercent: Percent01Schema.default(0.95),
    autoCompactTokenLimitPercent: Percent01Schema.default(0.9),
    baselineTokens: NonNegativeIntSchema.default(12000),
    compactKeepLastTurns: NonNegativeIntSchema.default(4),
    enableAutoCompact: z.boolean().default(true),
    autoCompactMinTurnsBetweenRuns: NonNegativeIntSchema.default(8),
  })
  .strict()
  .default({})

export type ContextConfig = z.infer<typeof ContextConfigSchema>

export const ContextConfigPatchSchema = z
  .object({
    effectiveContextWindowPercent: Percent01Schema.optional(),
    autoCompactTokenLimitPercent: Percent01Schema.optional(),
    baselineTokens: NonNegativeIntSchema.optional(),
    compactKeepLastTurns: NonNegativeIntSchema.optional(),
    enableAutoCompact: z.boolean().optional(),
    autoCompactMinTurnsBetweenRuns: NonNegativeIntSchema.optional(),
  })
  .strict()

export type ContextConfigPatch = z.infer<typeof ContextConfigPatchSchema>

export const FormaxConfigV1Schema = z
  .object({
    version: z.literal(1).default(1),
    llm: LlmConfigSchema,
    paths: PathsConfigSchema,
    ui: UiConfigSchema,
    context: ContextConfigSchema,
  })
  .strict()

export type FormaxConfigV1 = z.infer<typeof FormaxConfigV1Schema>

export const FormaxConfigV1PatchSchema = z
  .object({
    version: z.literal(1).optional(),
    llm: LlmConfigPatchSchema.optional(),
    paths: PathsConfigPatchSchema.optional(),
    ui: UiConfigPatchSchema.optional(),
    context: ContextConfigPatchSchema.optional(),
  })
  .strict()

export type FormaxConfigV1Patch = z.infer<typeof FormaxConfigV1PatchSchema>

export const AuthEntrySchema = z
  .object({
    apiKey: z.string().min(1),
  })
  .strict()

export type AuthEntry = z.infer<typeof AuthEntrySchema>

export const AuthProvidersSchema = z
  .object({
    anthropic: z.record(z.string(), AuthEntrySchema).optional(),
    openai: z.record(z.string(), AuthEntrySchema).optional(),
    gemini: z.record(z.string(), AuthEntrySchema).optional(),
  })
  .strict()
  .default({})

export type AuthProviders = z.infer<typeof AuthProvidersSchema>

export const AuthStoreV1Schema = z
  .object({
    version: z.literal(1).default(1),
    providers: AuthProvidersSchema,
  })
  .strict()

export type AuthStoreV1 = z.infer<typeof AuthStoreV1Schema>
