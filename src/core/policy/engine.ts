import { evaluatePolicy as evaluatePolicyImpl, explainPolicy as explainPolicyImpl } from './engineImpl.js'

export type {
  PolicyMatchedRule,
  PolicyExplainResult,
} from './engineImpl.js'

export function evaluatePolicy(...args: Parameters<typeof evaluatePolicyImpl>): ReturnType<typeof evaluatePolicyImpl> {
  return evaluatePolicyImpl(...args)
}

export function explainPolicy(...args: Parameters<typeof explainPolicyImpl>): ReturnType<typeof explainPolicyImpl> {
  return explainPolicyImpl(...args)
}
