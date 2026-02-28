import { createAllowRuleFromAction as createAllowRuleFromActionImpl } from './rulesImpl.js'

export function createAllowRuleFromAction(...args: Parameters<typeof createAllowRuleFromActionImpl>): ReturnType<typeof createAllowRuleFromActionImpl> {
  return createAllowRuleFromActionImpl(...args)
}
