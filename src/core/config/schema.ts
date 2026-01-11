import { z } from 'zod'

export const ProviderIdSchema = z.enum(['anthropic', 'openai', 'gemini'])
export type ProviderId = z.infer<typeof ProviderIdSchema>

export const AssistantTextModeSchema = z.enum(['stream', 'buffered'])
export type AssistantTextMode = z.infer<typeof AssistantTextModeSchema>

export const PromptProfileSchema = z.enum(['lite', 'full'])
export type PromptProfile = z.infer<typeof PromptProfileSchema>

const TimeoutMsSchema = z.number().int().positive()

export const LlmConfigSchema = z
  .object({
    provider: ProviderIdSchema.default('anthropic'),
    baseUrl: z.string().default(''),
    model: z.string().default(''),
    timeoutMs: TimeoutMsSchema.default(600000),
    authRef: z.string().default('default'),
  })
  .strict()
  .default({})

export type LlmConfig = z.infer<typeof LlmConfigSchema>

export const LlmConfigPatchSchema = z
  .object({
    provider: ProviderIdSchema.optional(),
    baseUrl: z.string().optional(),
    model: z.string().optional(),
    timeoutMs: TimeoutMsSchema.optional(),
    authRef: z.string().optional(),
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
  })
  .strict()
  .default({})

export type UiConfig = z.infer<typeof UiConfigSchema>

export const UiConfigPatchSchema = z
  .object({
    assistantTextMode: AssistantTextModeSchema.optional(),
    promptProfile: PromptProfileSchema.optional(),
  })
  .strict()

export type UiConfigPatch = z.infer<typeof UiConfigPatchSchema>

export const FormaxConfigV1Schema = z
  .object({
    version: z.literal(1).default(1),
    llm: LlmConfigSchema,
    paths: PathsConfigSchema,
    ui: UiConfigSchema,
  })
  .strict()

export type FormaxConfigV1 = z.infer<typeof FormaxConfigV1Schema>

export const FormaxConfigV1PatchSchema = z
  .object({
    version: z.literal(1).optional(),
    llm: LlmConfigPatchSchema.optional(),
    paths: PathsConfigPatchSchema.optional(),
    ui: UiConfigPatchSchema.optional(),
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
