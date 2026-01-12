import { z } from 'zod'

export const PolicyDecisionSchema = z.enum(['allow', 'prompt', 'deny'])
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>

export const PolicyScopeSchema = z.enum(['session', 'project', 'global'])
export type PolicyScope = z.infer<typeof PolicyScopeSchema>

const FsReadMatchSchema = z
  .object({
    kind: z.literal('fs.read'),
    path: z.string().min(1),
  })
  .strict()

const FsWriteMatchSchema = z
  .object({
    kind: z.literal('fs.write'),
    path: z.string().min(1),
  })
  .strict()

const BashExecMatchSchema = z
  .object({
    kind: z.literal('bash.exec'),
    commandPrefix: z.string().min(1),
  })
  .strict()

const NetFetchMatchSchema = z
  .object({
    kind: z.literal('net.fetch'),
    urlPrefix: z.string().min(1),
  })
  .strict()

const NetSearchMatchSchema = z
  .object({
    kind: z.literal('net.search'),
    queryPrefix: z.string().min(1),
  })
  .strict()

export const PolicyRuleMatchSchema = z.discriminatedUnion('kind', [
  FsReadMatchSchema,
  FsWriteMatchSchema,
  BashExecMatchSchema,
  NetFetchMatchSchema,
  NetSearchMatchSchema,
])
export type PolicyRuleMatch = z.infer<typeof PolicyRuleMatchSchema>

export const PolicyRuleSchema = z
  .object({
    ruleId: z.string().min(1),
    enabled: z.boolean().default(true),
    createdAt: z.string().min(1),
    scope: PolicyScopeSchema,
    decision: PolicyDecisionSchema,
    reason: z.string().default(''),
    template: z.string().default(''),
    match: PolicyRuleMatchSchema,
  })
  .strict()
export type PolicyRule = z.infer<typeof PolicyRuleSchema>

export const PolicyRulesFileSchema = z
  .object({
    version: z.literal(1),
    rules: z.array(PolicyRuleSchema).default([]),
  })
  .strict()
export type PolicyRulesFile = z.infer<typeof PolicyRulesFileSchema>

